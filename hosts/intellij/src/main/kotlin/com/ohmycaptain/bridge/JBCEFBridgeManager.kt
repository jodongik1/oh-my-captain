package com.ohmycaptain.bridge

import com.google.gson.Gson
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.psi.PsiDocumentManager
import com.intellij.ui.jcef.JBCefBrowser
import com.ohmycaptain.actions.CODE_ACTION_ID_TO_TYPE
import com.ohmycaptain.actions.buildCodeActionPayload
import com.ohmycaptain.ipc.IpcChannel
import com.ohmycaptain.ipc.IpcClient
import com.ohmycaptain.ipc.IpcMessageType
import com.ohmycaptain.ipc.ipcEnvelope
import com.ohmycaptain.logging.loggerFor
import com.ohmycaptain.psi.PsiContextCollector
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefQueryCallback
import org.cef.handler.CefLoadHandlerAdapter
import org.cef.handler.CefMessageRouterHandlerAdapter

/**
 * 프로젝트별로 단 하나의 [JBCEFBridgeManager] 를 보관하는 UserData 키.
 *
 * [BaseCodeAction] 같은 글로벌 액션이 현재 프로젝트의 브릿지를 찾을 때 이 키를 사용한다.
 * 등록은 [JBCEFBridgeManager.attachToBrowser] 에서 수행.
 */
val BRIDGE_KEY = com.intellij.openapi.util.Key.create<JBCEFBridgeManager>("omc.bridge")

/**
 * Webview(React) ↔ Core(Node.js) IPC 의 중계 허브.
 *
 * 메시지 흐름:
 * ```
 *   React  ──cefQuery──►  handleFromReact  ──IpcChannel──►  Core
 *   React  ◄──executeJS── postToBrowser   ◄──IpcChannel──  Core (handleFromCore)
 * ```
 *
 * 책임 (라우팅 허브 역할만):
 * - JCEF 메시지 라우터 등록 + `window.__omcBridge` 초기화 스크립트 주입.
 * - Webview ↔ Core 메시지 분기 처리 (handleFromReact / handleFromCore).
 * - IPC 채널 생명주기 관리 (connectCore — 핸드셰이크 + 큐 flush).
 * - Core 미연결 상태에서 들어온 메시지를 [pendingMessages] 큐에 보관 후 연결 시 일괄 송신.
 *
 * 분리된 책임 (위임자):
 * - 파일 열기·도구 출력 → [EditorActionHandler]
 * - PSI 컨텍스트 수집 → [ContextRequestHandler]
 * - 승인 envelope 양방향 변환 → [ApprovalEnvelopeAdapter]
 *
 * 멀티 프로젝트: 각 프로젝트(툴 윈도우)마다 인스턴스가 1개씩 생성되며 [BRIDGE_KEY] 로 분리된다.
 */
class JBCEFBridgeManager(
    private val browser: JBCefBrowser,
    private val project: Project
) {
    private val log = loggerFor<JBCEFBridgeManager>()
    private val gson = Gson()

    /**
     * Core 와의 IPC 채널. [IpcChannel] 인터페이스만 의존하여 DIP 준수 — 실제 구현은
     * [connectCore] 가 [IpcClient] 인스턴스를 주입한다.
     */
    private var ipcChannel: IpcChannel? = null
    private val psiCollector = PsiContextCollector()

    /** 파일 열기·도구 출력 표시 등 에디터 측 부수 동작 위임자. */
    private val editorActions = EditorActionHandler(project)

    /** PSI 컨텍스트 요청을 풀 스레드에서 처리하고 회신하는 위임자. */
    private val contextRequestHandler = ContextRequestHandler(
        project = project,
        collector = psiCollector,
        channelProvider = { ipcChannel },
    )

    /** Core 연결 전에 도착한 메시지를 보관하는 큐. [connectCore] 시 일괄 flush 한다. */
    private val pendingMessages = mutableListOf<Map<String, Any?>>()

    /**
     * 브릿지를 브라우저에 부착하고 활성화한다.
     *
     * 수행: 메시지 라우터 등록 + 초기화 스크립트 주입 + project UserData 에 인스턴스 등록.
     * [com.ohmycaptain.ui.CaptainToolWindowFactory] 가 툴 윈도우를 만든 직후 1회 호출한다.
     */
    fun attachToBrowser() {
        // React → Kotlin 수신: window.cefQuery({request:...}) 호출이 onQuery 로 도달한다.
        val router = org.cef.browser.CefMessageRouter.create()
        router.addHandler(object : CefMessageRouterHandlerAdapter() {
            override fun onQuery(
                browser: CefBrowser,
                frame: CefFrame,
                queryId: Long,
                request: String,
                persistent: Boolean,
                callback: CefQueryCallback
            ): Boolean {
                handleFromReact(request)
                callback.success("")  // 즉시 ack — 응답은 별도 postToBrowser 로 전달
                return true
            }
        }, true)
        browser.jbCefClient.cefClient.addMessageRouter(router)

        // 페이지 로드(또는 새로고침) 직후마다 window.__omcBridge 를 다시 주입해야 한다.
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                if (frame.isMain) injectBridgeScript()
            }
        }, browser.cefBrowser)

        // CodeAction 같이 직접 참조하기 어려운 곳에서 브릿지를 꺼낼 수 있도록 project 에 보관.
        project.putUserData(BRIDGE_KEY, this)
    }

    /**
     * Core 프로세스가 떴을 때 호출 — [IpcChannel] 을 만들고 첫 핸드셰이크(`init`) 를 보낸다.
     * 재연결 시나리오를 위해 기존 채널은 안전하게 종료한다.
     *
     * @param process [com.ohmycaptain.core.CoreApplicationService.startCore] 가 띄운 Node 프로세스.
     *   현재는 [IpcClient] 가 stdio 로 통신 — 미래에 다른 [IpcChannel] 구현으로 교체 가능.
     */
    fun connectCore(process: Process) {
        ipcChannel?.close()  // 재연결: 기존 stdio 핸들 정리

        ipcChannel = IpcClient(process).also { channel ->
            channel.startReceiving { msg -> handleFromCore(msg) }

            // 핸드셰이크: 프로젝트 루트와 모드를 Core 에 알린다.
            // mode 는 "plan" | "ask" | "auto" — 추후 사용자 설정에서 가져올 수 있게 확장 가능.
            channel.send(ipcEnvelope(IpcMessageType.INIT, mapOf(
                "projectRoot" to (project.basePath ?: ""),
                "nodeVersion" to "20",
                "mode" to "ask",
            )))

            // Core 가 뜨기 전에 사용자가 이미 액션을 눌렀다면 큐에 메시지가 쌓여 있다 — 이때 일괄 전송.
            val flushed = synchronized(pendingMessages) {
                val size = pendingMessages.size
                pendingMessages.forEach { channel.send(it) }
                pendingMessages.clear()
                size
            }
            // 큐 flush 는 사용자 행동 timing 의존이라 원인 추적에 유용 — 0개여도 정보가치 있음.
            log.info("[OMC] IPC 핸드셰이크 완료, 보류 메시지 ${flushed}건 flush")
        }
    }

    /**
     * Kotlin → React 메시지 전송.
     *
     * `window.__omcBridge.onMessage(jsonString)` 형태로 호출한다. JSON 을 한 번 더 toJson 해서
     * JS 문자열 리터럴로 안전하게 이스케이프한다(따옴표·역슬래시 처리). EDT 보장을 위해 [invokeLater] 로 dispatch.
     */
    fun postToBrowser(type: String, payload: Any) {
        val json = gson.toJson(mapOf("type" to type, "payload" to payload))
        ApplicationManager.getApplication().invokeLater {
            browser.cefBrowser.executeJavaScript(
                "window.__omcBridge && window.__omcBridge.onMessage(${gson.toJson(json)})",
                browser.cefBrowser.url, 0
            )
        }
    }

    /** 사용자에게 보여줄 비치명적 에러를 webview 로 push. retryable=false 로 자동재시도 유도 안 함. */
    fun postError(message: String) {
        postToBrowser(IpcMessageType.ERROR, mapOf("message" to message, "retryable" to false))
    }

    /**
     * Core 로 메시지 전송. Core 미연결 상태면 [pendingMessages] 에 큐잉했다가
     * [connectCore] 가 완료되는 시점에 자동으로 flush 된다.
     *
     * 호출처: [BaseCodeAction], [handleFromReact], [handleInvokeAction] 등.
     */
    fun sendToCore(message: Map<String, Any?>) {
        val channel = ipcChannel
        if (channel != null) {
            channel.send(message)
        } else {
            // 큐잉은 디버그 가치 있음(IPC 미연결 timing 추적). type 만 — payload 본문 노출 금지.
            log.debug { "[OMC] Core 미연결 — 메시지 큐잉 (type=${message["type"]})" }
            synchronized(pendingMessages) { pendingMessages.add(message) }
        }
    }

    /**
     * React 에서 도착한 메시지를 분기 처리.
     *
     * 분기 정책:
     * - IDE-side 동작이 필요한 메시지 (`open_in_editor`, `open_tool_output`) 는 여기서 직접 처리.
     * - `ready` 는 Webview 부팅 완료 신호 → Core 준비 사실을 다시 알려준다.
     * - `approval_response` 는 IPC 프로토콜 포맷(top-level id) 으로 변환해 Core 에 포워딩.
     * - 그 외 평문 메시지는 그대로 Core 로 흘려보낸다.
     */
    private fun handleFromReact(query: String) {
        @Suppress("UNCHECKED_CAST")
        val msg = gson.fromJson(query, Map::class.java) as Map<String, Any?>

        // Hot path — type 만 기록. payload 는 사용자 입력/코드를 담을 수 있어 노출 금지.
        log.debug { "[OMC] Webview→Core 메시지 라우팅 (type=${msg["type"]})" }

        when (msg["type"]) {
            IpcMessageType.OPEN_IN_EDITOR -> (msg["payload"] as? Map<*, *>)?.let { editorActions.openInEditor(it) }
            IpcMessageType.OPEN_TOOL_OUTPUT -> (msg["payload"] as? Map<*, *>)?.let { editorActions.openToolOutput(it) }
            IpcMessageType.READY -> {
                // Webview 가 늦게 부팅된 경우라도 Core 는 이미 떠있을 수 있으므로 즉시 통보해 UX 정합 유지.
                postToBrowser(IpcMessageType.CORE_READY, emptyMap<String, Any>())
            }
            IpcMessageType.APPROVAL_RESPONSE -> {
                ApprovalEnvelopeAdapter.toApprovalResponse(msg)?.let { sendToCore(it) }
            }
            else -> {
                // 라우팅이 필요 없는 메시지(prompt, cancel 등)는 그대로 Core 로 전달.
                // sendToCore 가 미연결 시 큐잉을 처리하므로 여기서 별도 분기 불필요.
                sendToCore(msg)
            }
        }
    }

    /**
     * Core 에서 도착한 메시지를 분기 처리.
     *
     * 정책: IDE 가 처리해야 하는 동작(컨텍스트 수집, 파일 열기, 액션 호출, 승인 다이얼로그) 만 여기서 가로채고
     * 나머지는 그대로 Webview 로 흘려보낸다.
     */
    private fun handleFromCore(msg: Map<String, Any?>) {
        log.debug { "[OMC] Core→IDE/Webview 메시지 라우팅 (type=${msg["type"]})" }

        when (msg["type"]) {
            IpcMessageType.CONTEXT_REQUEST -> contextRequestHandler.handle(msg)
            IpcMessageType.APPROVAL_REQUEST -> {
                postToBrowser(IpcMessageType.APPROVAL_REQUEST, ApprovalEnvelopeAdapter.enrichRequestForWebview(msg))
            }
            IpcMessageType.OPEN_IN_EDITOR -> (msg["payload"] as? Map<*, *>)?.let { editorActions.openInEditor(it) }
            IpcMessageType.INVOKE_ACTION -> handleInvokeAction(msg)
            // 그 외 (chunk, tool_call, done 등) 은 표시 전용 → Webview 가 직접 렌더한다.
            else -> {
                val type = msg["type"] as? String
                if (type == null) {
                    // 비정상 메시지 — 프로토콜 위반 의심. 과거에는 unsafe cast 였음.
                    log.warn("[OMC] type 필드 없는 메시지 drop")
                } else {
                    postToBrowser(type, msg["payload"] ?: emptyMap<String, Any>())
                }
            }
        }
    }

    /**
     * Webview 슬래시 명령(예: `/explain`) 처리.
     *
     * 우클릭 컨텍스트 메뉴([BaseCodeAction]) 와 동일한 `code_action` IPC 페이로드를 만들어 Core 로 보낸다.
     * 두 진입점에서 페이로드 형태가 어긋나면 Core 가 동일하게 처리하지 못하므로 형식을 정확히 일치시킨다.
     *
     * EDT 필요: selectedTextEditor / PsiDocumentManager 접근은 EDT 에서 수행해야 한다.
     */
    private fun handleInvokeAction(msg: Map<String, Any?>) {
        val actionId = (msg["payload"] as? Map<*, *>)?.get("actionId") as? String
        if (actionId == null) {
            log.warn("[OMC] invoke_action 에 actionId 없음 — 메시지 drop")
            return
        }
        val actionType = CODE_ACTION_ID_TO_TYPE[actionId] ?: run {
            log.warn("[OMC] 알 수 없는 actionId='$actionId' — Webview 슬래시 명령과 매핑 누락 의심")
            postError("알 수 없는 액션입니다: $actionId")
            return
        }

        ApplicationManager.getApplication().invokeLater {
            val editor = FileEditorManager.getInstance(project).selectedTextEditor
            if (editor == null) {
                log.debug { "[OMC] invoke_action='$actionId' — 활성 에디터 없음" }
                postError("열린 에디터가 없습니다. 코드 파일을 먼저 열고 다시 시도해주세요.")
                return@invokeLater
            }
            val psiFile = PsiDocumentManager.getInstance(project).getPsiFile(editor.document)
            if (psiFile == null) {
                log.debug { "[OMC] invoke_action='$actionId' — 활성 에디터의 PSI 파일 없음" }
                postError("PSI 파일을 찾을 수 없습니다.")
                return@invokeLater
            }

            val payload = buildCodeActionPayload(actionType, editor, psiFile)
            sendToCore(ipcEnvelope(IpcMessageType.CODE_ACTION, payload))
        }
    }

    /**
     * `window.__omcBridge` 객체를 webview 에 주입한다.
     *
     * - `send(msg)`  : React → Kotlin (cefQuery 로 onQuery 트리거)
     * - `onMessage`  : Kotlin → React 콜백 슬롯. React 부팅 시 자체적으로 함수를 할당한다.
     *
     * 페이지 로드/리로드마다 [register] 의 LoadHandler 가 다시 호출하여 스크립트를 재주입한다.
     */
    private fun injectBridgeScript() {
        browser.cefBrowser.executeJavaScript("""
            window.__omcBridge = {
                onMessage: null,
                send: function(msg) {
                    window.cefQuery({ request: JSON.stringify(msg) })
                }
            };
        """.trimIndent(), browser.cefBrowser.url, 0)
    }
}
