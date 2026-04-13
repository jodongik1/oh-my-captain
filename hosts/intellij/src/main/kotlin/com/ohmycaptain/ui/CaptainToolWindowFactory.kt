package com.ohmycaptain.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefBrowser
import com.ohmycaptain.bridge.JBCEFBridgeManager
import com.ohmycaptain.core.CoreApplicationService

class CaptainToolWindowFactory : ToolWindowFactory {
    private val log = Logger.getInstance("OMC")

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        // 임베디드 HTTP 서버 시작 (커스텀 스킴 불필요)
        val webServer = EmbeddedWebServer().also {
            it.start()
            Disposer.register(toolWindow.disposable, it)  // 툴 윈도우 닫힐 때 자동 종료
        }

        val browser = JBCefBrowser.createBuilder()
            .setOffScreenRendering(false)  // 한글 IME 필수: OSR OFF
            .build()

        val bridge = JBCEFBridgeManager(browser, project)
        bridge.register()

        // Core 시작 (비동기, 별도 스레드)
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                log.info("[OMC] Core 시작 시도...")
                val svc = ApplicationManager.getApplication()
                    .getService(CoreApplicationService::class.java)
                val proc = svc.startCore(project.basePath ?: "")
                log.info("[OMC] Core 시작 완료. Stdio 통신 준비.")
                bridge.connectCore(proc)
                log.info("[OMC] IPC 연결 완료")
            } catch (e: Exception) {
                log.error("[OMC] Core 시작 에러: ${e.message}", e)
                bridge.postError("Core 시작 실패: ${e.message}")
            }
        }

        // 개발: Vite dev server (5173) / 프로덕션: 임베디드 서버 (랜덤 포트)
        val isDev = System.getProperty("omc.dev") == "true"
        val url = if (isDev) "http://localhost:5173/index.html"
                  else       "http://localhost:${webServer.port}/index.html"
        browser.loadURL(url)

        val content = ContentFactory.getInstance().createContent(browser.component, null, false)
        toolWindow.contentManager.addContent(content)
    }
}
