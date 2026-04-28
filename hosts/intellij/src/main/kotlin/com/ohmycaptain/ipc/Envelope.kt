package com.ohmycaptain.ipc

import java.util.UUID

/**
 * IPC envelope 표준 빌더.
 *
 * 모든 IPC 메시지는 `{id, type, payload}` 3-키 구조를 갖는다 — Core 와 합의된 NDJSON 프로토콜.
 * `id` 는 응답 매칭(예: approval_request → approval_response)에 사용되므로 새 메시지는 매번 UUID 를 자동 생성하고,
 * 응답 메시지는 호출자가 원본 요청 id 를 그대로 넘겨줄 수 있다.
 *
 * 호출자는 [com.ohmycaptain.bridge.JBCEFBridgeManager.sendToCore] 또는
 * [IpcClient.send] 에 결과 맵을 그대로 넘기면 된다.
 *
 * @param type    Core 가 라우팅에 사용하는 메시지 타입 (예: "init", "code_action", "approval_response")
 * @param payload 메시지 본문 — Map 또는 임의 객체. Gson 이 직렬화한다.
 * @param id      응답 메시지에서 원본 요청 id 를 보존하고 싶을 때만 명시. 기본값은 새 UUID.
 */
fun ipcEnvelope(
    type: String,
    payload: Any?,
    id: String = UUID.randomUUID().toString(),
): Map<String, Any?> = mapOf(
    "id" to id,
    "type" to type,
    "payload" to payload,
)
