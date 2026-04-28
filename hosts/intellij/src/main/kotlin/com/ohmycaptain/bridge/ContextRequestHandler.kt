package com.ohmycaptain.bridge

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.ohmycaptain.ipc.IpcChannel
import com.ohmycaptain.ipc.IpcMessageType
import com.ohmycaptain.ipc.ipcEnvelope
import com.ohmycaptain.logging.loggerFor
import com.ohmycaptain.psi.PsiContextCollector

/**
 * Core 의 `context_request` 메시지를 처리해 PSI 컨텍스트를 수집하고 응답한다.
 *
 * 분리한 이유: PSI 분석은 (1) 풀 스레드에서 돌아야 하고, (2) 응답 누락 시 Core 의 await 가 영구 교착되며,
 * (3) 빈 paths 는 "현재 열린 파일 모두" 를 의미한다는 비자명한 정책 3가지를 함께 책임진다.
 * 이를 [JBCEFBridgeManager] 의 메시지 라우팅 안에 두면 라우팅 로직과 도메인 정책이 섞인다.
 *
 * 의존성:
 * - [Project] : 열린 파일·LocalFileSystem 접근용 (IntelliJ Platform)
 * - [IpcChannel] : 응답 송신 채널 (DIP 위해 인터페이스로 의존)
 * - [PsiContextCollector] : 실제 PSI 분석기 — 향후 strategy 패턴으로 다언어 확장 가능
 */
internal class ContextRequestHandler(
    private val project: Project,
    private val collector: PsiContextCollector,
    private val channelProvider: () -> IpcChannel?,
) {
    private val log = loggerFor<ContextRequestHandler>()

    /**
     * `context_request` 메시지를 받아 비동기로 PSI 분석 후 `context_response` 송신.
     *
     * 정책:
     * - paths 가 비어있으면 현재 열린 파일 전부.
     * - 개별 파일 분석 실패는 응답에서 빠진다(Core 가 부분 응답 허용) — 단 디버그 로그는 남긴다.
     * - collector 가 통째로 깨져도 빈 응답이라도 무조건 회신 — Core await 교착 방지.
     * - channel 이 null(연결 끊김) 이어도 silent 하게 끝나면 안 되므로 로그를 남긴다.
     */
    fun handle(message: Map<String, Any?>) {
        val paths = ((message["payload"] as? Map<*, *>)?.get("paths") as? List<*>)
            ?.filterIsInstance<String>() ?: emptyList()

        ApplicationManager.getApplication().executeOnPooledThread {
            val contexts = runCatching { collectContexts(paths) }
                .onFailure { log.warn("[OMC] context 수집 통째 실패 — 빈 응답 회신", it) }
                .getOrDefault(emptyList())

            log.debug { "[OMC] context_response 송신 (요청paths=${paths.size}, 결과=${contexts.size})" }

            val channel = channelProvider()
            if (channel == null) {
                log.warn("[OMC] context_response 송신 불가 — IPC 채널 끊김 (Core await 교착 가능)")
                return@executeOnPooledThread
            }
            channel.send(ipcEnvelope(
                type = IpcMessageType.CONTEXT_RESPONSE,
                payload = contexts,
                id = (message["id"] as? String) ?: "",
            ))
        }
    }

    /** paths 정책에 맞춰 분석 대상 파일을 결정하고 collector 로 변환. 개별 실패는 debug 로 추적. */
    private fun collectContexts(paths: List<String>): List<Any> {
        val files = if (paths.isEmpty()) {
            FileEditorManager.getInstance(project).openFiles.toList()
        } else {
            paths.mapNotNull { path ->
                LocalFileSystem.getInstance().findFileByPath(path).also { vf ->
                    if (vf == null) log.debug { "[OMC] context 요청 path 해석 실패 — 무시 (path=$path)" }
                }
            }
        }
        return files.mapNotNull { vf ->
            runCatching { collector.collect(project, vf) }
                .onFailure { log.debug(it) { "[OMC] PSI 수집 실패 — 부분 응답에서 제외 (path=${vf.path})" } }
                .getOrNull()
        }
    }
}
