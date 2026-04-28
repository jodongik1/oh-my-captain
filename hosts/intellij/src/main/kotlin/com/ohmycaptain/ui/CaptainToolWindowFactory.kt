package com.ohmycaptain.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefBrowser
import com.ohmycaptain.bridge.JBCEFBridgeManager
import com.ohmycaptain.core.CoreApplicationService
import com.ohmycaptain.logging.loggerFor

/**
 * "Oh My Captain" 툴 윈도우 콘텐츠를 생성하는 팩토리.
 *
 * plugin.xml 의 `<toolWindow>` extension 에 등록되어, 사용자가 툴 윈도우를 처음 열 때 한 번 호출된다.
 * 이 한 번의 호출이 "Webview + 브릿지 + Core 프로세스" 일체의 부팅 시퀀스를 책임진다.
 *
 * 부팅 시퀀스:
 * 1. EmbeddedWebServer 기동 (정적 webview 번들 서빙용 로컬 HTTP)
 * 2. JBCefBrowser 생성 — OSR OFF (한글 IME 입력 보존)
 * 3. JBCEFBridgeManager 등록 — JS ↔ Kotlin 메시지 라우터 + project UserData 등록
 * 4. CefDisplayHandler 로 webview 의 console.* 출력을 IntelliJ 로그로 흘려보냄
 * 5. 풀 스레드에서 CoreApplicationService.startCore 호출 → connectCore 로 IPC 연결
 * 6. 브라우저에 webview URL 로딩 (dev 모드면 Vite, 아니면 임베디드 HTTP 서버)
 *
 * 비동기성: Core 부팅은 풀 스레드에서 진행되어 EDT 를 차단하지 않는다.
 * Webview 가 먼저 부팅되어 사용자 액션이 들어올 수 있지만, 브릿지가 메시지를 큐잉했다가 connectCore 에서 flush 한다.
 */
class CaptainToolWindowFactory : ToolWindowFactory {
    private val log = loggerFor<CaptainToolWindowFactory>()

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        // 정적 webview 번들(html/js/css)을 로컬 HTTP 로 서빙. 커스텀 스킴(jbcef://) 보다 호환성·디버깅 용이.
        // 툴 윈도우가 닫힐 때 Disposer 가 server.stop() 을 자동 호출.
        val webServer = EmbeddedWebServer().also {
            it.start()
            Disposer.register(toolWindow.disposable, it)
        }

        // OSR(Off-Screen Rendering) OFF: macOS/Linux 에서 한글 IME 합성 입력이 OSR 모드일 때 깨지는 이슈 회피.
        // 일부 IDE 테마(특히 다크 테마)에서 깜빡임이 있을 수 있으나 입력 정합성을 우선.
        val browser = JBCefBrowser.createBuilder()
            .setOffScreenRendering(false)
            .build()

        val bridge = JBCEFBridgeManager(browser, project)
        bridge.attachToBrowser()

        // Webview 의 console.log / warn / error 를 IntelliJ 로그창으로 라우팅.
        // return true → JCEF 기본 콘솔 출력을 끄고 우리 로거만 사용해 중복 방지.
        // ERROR 레벨은 WARN 으로 승격 — idea.log 스캔 시 webview 측 에러를 놓치지 않도록.
        // message 본문은 사용자 코드/LLM 응답을 담을 수 있어 [Webview:LEVEL] prefix 로 grep 가능성을
        // 유지하되, 본문 자체는 webview 가 의도적으로 출력한 것이라 그대로 노출한다.
        browser.jbCefClient.addDisplayHandler(object : org.cef.handler.CefDisplayHandlerAdapter() {
            override fun onConsoleMessage(
                b: org.cef.browser.CefBrowser,
                level: org.cef.CefSettings.LogSeverity,
                message: String,
                source: String,
                line: Int
            ): Boolean {
                val fileName = source.substringAfterLast("/")
                val tagged = "[Webview:${level.name}] [$fileName:$line] $message"
                when (level) {
                    org.cef.CefSettings.LogSeverity.LOGSEVERITY_ERROR,
                    org.cef.CefSettings.LogSeverity.LOGSEVERITY_FATAL ->
                        log.warn(tagged)  // WARN 으로 승격
                    org.cef.CefSettings.LogSeverity.LOGSEVERITY_WARNING ->
                        log.warn(tagged)
                    else -> log.info(tagged)
                }
                return true
            }
        }, browser.cefBrowser)

        // Core 부팅은 startCore 안에서 실제 노드 프로세스를 띄우므로 수십~수백 ms 가 걸린다.
        // EDT 차단 방지를 위해 풀 스레드에서 실행하고, 완료되면 IPC 를 연결한다.
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                log.info("[OMC] Core 부팅 시퀀스 시작 (project=${project.name})")
                val svc = ApplicationManager.getApplication()
                    .getService(CoreApplicationService::class.java)
                val proc = svc.startCore()
                bridge.connectCore(proc)  // 이 시점에 큐잉된 메시지가 일괄 flush 됨
                log.info("[OMC] Core 부팅 완료 — IPC 핸드셰이크 송신")
            } catch (e: Exception) {
                // 사용자 영향이 큰 실패 — ERROR + 스택트레이스, 동시에 webview 알림으로 표시.
                log.error("[OMC] Core 부팅 실패: ${e.message}", e)
                bridge.postError("Core 시작 실패: ${e.message}")
            }
        }

        // 개발 모드 토글: -Domc.dev=true 로 IDE 실행 시 Vite dev server(HMR 가능) 를 가리킨다.
        // 프로덕션은 EmbeddedWebServer 의 OS 가 할당한 임의 포트 사용.
        val isDev = System.getProperty("omc.dev") == "true"
        val url = if (isDev) "http://localhost:5173/index.html"
                  else       "http://localhost:${webServer.port}/index.html"
        browser.loadURL(url)

        val content = ContentFactory.getInstance().createContent(browser.component, null, false)
        toolWindow.contentManager.addContent(content)
    }
}
