package com.ohmycaptain.bridge

import com.google.gson.Gson
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.testFramework.LightVirtualFile
import com.intellij.ui.jcef.JBCefBrowser
import com.ohmycaptain.ipc.IpcClient
import com.ohmycaptain.psi.PsiContextCollector
import com.ohmycaptain.ui.ApprovalDialog
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefQueryCallback
import org.cef.handler.CefLoadHandlerAdapter
import org.cef.handler.CefMessageRouterHandlerAdapter

val BRIDGE_KEY = com.intellij.openapi.util.Key.create<JBCEFBridgeManager>("omc.bridge")

class JBCEFBridgeManager(
    private val browser: JBCefBrowser,
    private val project: Project
) {
    private val gson = Gson()
    private var ipcClient: IpcClient? = null
    private val psiCollector = PsiContextCollector()
    private val pendingMessages = mutableListOf<Map<String, Any?>>()
    private var toolOutputFile: LightVirtualFile? = null

    fun register() {
        // React → Kotlin 수신 (CefMessageRouter 패턴)
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
                callback.success("")
                return true
            }
        }, true)
        browser.jbCefClient.cefClient.addMessageRouter(router)

        // WebView 로드 완료 시 브릿지 초기화 JS 주입
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                if (frame.isMain) injectBridgeScript()
            }
        }, browser.cefBrowser)

        // project UserData에 등록 (CodeAction에서 접근)
        project.putUserData(BRIDGE_KEY, this)
    }

    fun connectCore(process: Process) {
        // 기존 연결 안전 종료
        ipcClient?.close()

        ipcClient = IpcClient(process).also { client ->
            client.connect()
            client.startReceiving { msg -> handleFromCore(msg) }
            
            // Core에 초기화 메시지 전송
            client.send(mapOf(
                "id" to java.util.UUID.randomUUID().toString(),
                "type" to "init",
                "payload" to mapOf(
                    "projectRoot" to (project.basePath ?: ""),
                    "nodeVersion" to "20",
                    "mode" to "ask"
                )
            ))

            // 큐에 쌓인 메시지 전송
            synchronized(pendingMessages) {
                pendingMessages.forEach { client.send(it) }
                pendingMessages.clear()
            }

        }
    }

    // Kotlin → React 메시지 전송
    fun postToBrowser(type: String, payload: Any) {
        val json = gson.toJson(mapOf("type" to type, "payload" to payload))
        ApplicationManager.getApplication().invokeLater {
            browser.cefBrowser.executeJavaScript(
                "window.__omcBridge && window.__omcBridge.onMessage(${gson.toJson(json)})",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun postError(message: String) {
        postToBrowser("error", mapOf("message" to message, "retryable" to false))
    }

    // Core에게 메시지 전송 (CodeAction 등에서 사용)
    fun sendToCore(message: Map<String, Any?>) {
        val client = ipcClient
        if (client != null) {
            client.send(message)
        } else {
            synchronized(pendingMessages) { pendingMessages.add(message) }
        }
    }

    // React에서 받은 메시지 처리
    private fun handleFromReact(query: String) {
        @Suppress("UNCHECKED_CAST")
        val msg = gson.fromJson(query, Map::class.java) as Map<String, Any?>

        // React에서 직접 처리해야 하는 메시지
        when (msg["type"]) {
            "open_in_editor" -> handleOpenInEditor(msg)
            "open_tool_output" -> handleOpenToolOutput(msg)
            "ready" -> {
                // React가 부팅을 끝냈다고 알려오면, Core 준비 상태를 통보
                // (Core는 이미 떠있거나 큐에 있는 상태이므로 무방)
                postToBrowser("core_ready", emptyMap<String, Any>())
            }
            "approval_response" -> {
                // Webview에서 온 승인 응답 → Core에 IPC 프로토콜 형식으로 전달
                @Suppress("UNCHECKED_CAST")
                val payload = msg["payload"] as? Map<*, *> ?: return
                val requestId = payload["requestId"] as? String ?: return
                val approved = payload["approved"] as? Boolean ?: false
                sendToCore(mapOf(
                    "id" to requestId,
                    "type" to "approval_response",
                    "payload" to mapOf("approved" to approved)
                ))
            }
            else -> {
                // 나머지는 Core로 전달 (sendToCore에서 큐잉 또는 자동 재연결 처리)
                sendToCore(msg)
            }
        }
    }

    // Core에서 받은 메시지 처리
    private fun handleFromCore(msg: Map<String, Any?>) {
        when (msg["type"]) {
            "context_request" -> handleContextRequest(msg)
            "approval_request" -> {
                // approval_request는 webview로 포워딩 (id를 payload에 포함하여 응답 상관관계 유지)
                @Suppress("UNCHECKED_CAST")
                val payload = (msg["payload"] as? Map<String, Any?>) ?: emptyMap()
                val enrichedPayload = payload.toMutableMap().apply {
                    put("id", msg["id"] ?: "")
                }
                postToBrowser("approval_request", enrichedPayload)
            }
            "open_in_editor" -> handleOpenInEditor(msg)
            // 나머지는 그대로 WebView로 전달
            else -> postToBrowser(msg["type"] as String, msg["payload"] ?: emptyMap<String, Any>())
        }
    }

    private fun handleContextRequest(msg: Map<String, Any?>) {
        @Suppress("UNCHECKED_CAST")
        val paths = ((msg["payload"] as? Map<*, *>)?.get("paths") as? List<*>)
            ?.filterIsInstance<String>() ?: emptyList()

        ApplicationManager.getApplication().executeOnPooledThread {
            val contexts = try {
                if (paths.isEmpty()) {
                    // 빈 배열 = "현재 열린 파일 모두"
                    com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project)
                        .openFiles
                        .mapNotNull { vf ->
                            try { psiCollector.collect(project, vf) } catch (_: Throwable) { null }
                        }
                } else {
                    paths.mapNotNull { path ->
                        val vf = LocalFileSystem.getInstance().findFileByPath(path) ?: return@mapNotNull null
                        try { psiCollector.collect(project, vf) } catch (_: Throwable) { null }
                    }
                }
            } catch (_: Throwable) {
                // PsiContextCollector 전체가 실패해도 빈 응답을 보내서 Core Promise 교착 방지
                emptyList()
            }

            ipcClient?.send(mapOf(
                "id" to (msg["id"] ?: ""),
                "type" to "context_response",
                "payload" to contexts
            ))
        }
    }

    private fun handleApprovalRequest(msg: Map<String, Any?>) {
        @Suppress("UNCHECKED_CAST")
        val payload = msg["payload"] as? Map<*, *> ?: return
        val action = payload["action"] as? String ?: ""
        val description = payload["description"] as? String ?: ""
        val risk = payload["risk"] as? String ?: "low"

        ApplicationManager.getApplication().invokeLater {
            val dialog = ApprovalDialog(project, action, description, risk)
            val approved = dialog.showAndGet()
            ipcClient?.send(mapOf(
                "id" to (msg["id"] ?: ""),
                "type" to "approval_response",
                "payload" to mapOf("approved" to approved)
            ))
        }
    }

    private fun handleOpenInEditor(msg: Map<String, Any?>) {
        @Suppress("UNCHECKED_CAST")
        val payload = msg["payload"] as? Map<*, *> ?: return
        val path = payload["path"] as? String ?: return
        val line = (payload["line"] as? Double)?.toInt()

        ApplicationManager.getApplication().invokeLater {
            val vf = LocalFileSystem.getInstance().findFileByPath(path) ?: return@invokeLater
            val descriptor = if (line != null)
                OpenFileDescriptor(project, vf, line - 1, 0)
            else
                OpenFileDescriptor(project, vf)
            FileEditorManager.getInstance(project).openTextEditor(descriptor, true)
        }
    }

    private fun handleOpenToolOutput(msg: Map<String, Any?>) {
        @Suppress("UNCHECKED_CAST")
        val payload = msg["payload"] as? Map<*, *> ?: return
        val title = payload["title"] as? String ?: "Tool Output"
        val content = payload["content"] as? String ?: ""

        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val fem = FileEditorManager.getInstance(project)
            // 기존 탭을 닫고 새 파일로 교체
            toolOutputFile?.let { fem.closeFile(it) }
            val lightFile = LightVirtualFile(title, PlainTextFileType.INSTANCE, content)
            toolOutputFile = lightFile
            fem.openFile(lightFile, true)
        }
    }

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
