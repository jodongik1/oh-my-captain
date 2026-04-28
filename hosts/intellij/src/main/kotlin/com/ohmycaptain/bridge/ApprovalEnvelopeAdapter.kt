package com.ohmycaptain.bridge

import com.ohmycaptain.ipc.IpcMessageType
import com.ohmycaptain.ipc.ipcEnvelope
import com.ohmycaptain.logging.loggerFor

/**
 * 승인(approval) 메시지의 envelope ↔ payload 사이 양방향 변환을 모은 어댑터.
 *
 * 비대칭의 출처:
 * - Core 와의 IPC 프로토콜은 envelope.id 만 사용해 요청/응답을 매칭한다.
 * - Webview UI 코드는 envelope 단위가 아니라 payload 만 다루므로 id 를 payload 안에서도 볼 수 있어야 편하다.
 *
 * 그래서 변환이 두 번 일어난다:
 * 1. Core → Webview : envelope.id 를 payload.id 로도 복제 ([enrichRequestForWebview])
 * 2. Webview → Core : payload.requestId 를 envelope.id 로 승격 ([toApprovalResponse])
 *
 * 두 변환이 서로 어긋나면(예: 한쪽 키가 requestId, 다른 쪽이 id) 승인 응답이 영구히 매칭되지 않으므로
 * 동일 파일에서 함께 관리한다.
 */
internal object ApprovalEnvelopeAdapter {

    private val log = loggerFor(ApprovalEnvelopeAdapter::class)

    /**
     * Core 가 보낸 `approval_request` envelope 을 Webview 에서 다루기 좋은 payload 로 변환.
     *
     * 동작: 원본 payload 를 복제한 뒤 envelope.id 를 payload["id"] 로 추가한다.
     * 원본 payload 가 없으면 빈 맵에 id 만 넣는다.
     */
    fun enrichRequestForWebview(envelope: Map<String, Any?>): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        val payload = (envelope["payload"] as? Map<String, Any?>) ?: emptyMap()
        if (envelope["id"] == null) {
            // Core 가 envelope.id 없이 보낸 경우 — 응답이 매칭되지 않아 사실상 승인 흐름이 끊긴다.
            log.warn("[OMC] approval_request envelope 에 id 없음 — Webview 응답 매칭 불가")
        }
        return payload.toMutableMap().apply {
            put("id", envelope["id"] ?: "")
        }
    }

    /**
     * Webview 가 보낸 응답 메시지(`{requestId, approved}` 페이로드)를 Core 가 기대하는
     * `approval_response` envelope 으로 변환.
     *
     * @return 변환된 envelope. requestId 가 없거나 잘못된 형태면 null — 호출 측이 무시한다.
     */
    fun toApprovalResponse(webviewMessage: Map<String, Any?>): Map<String, Any?>? {
        val payload = webviewMessage["payload"] as? Map<*, *>
        if (payload == null) {
            log.warn("[OMC] approval_response 메시지에 payload 없음 — drop")
            return null
        }
        val requestId = payload["requestId"] as? String
        if (requestId == null) {
            log.warn("[OMC] approval_response payload 에 requestId 없음 — drop (Webview 측 송신 버그 의심)")
            return null
        }
        val approved = payload["approved"] as? Boolean ?: false
        return ipcEnvelope(
            type = IpcMessageType.APPROVAL_RESPONSE,
            payload = mapOf("approved" to approved),
            id = requestId,
        )
    }
}
