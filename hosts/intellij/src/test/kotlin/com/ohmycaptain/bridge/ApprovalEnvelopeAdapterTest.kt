package com.ohmycaptain.bridge

import com.ohmycaptain.ipc.IpcMessageType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class ApprovalEnvelopeAdapterTest {

    // ── enrichRequestForWebview: Core envelope → Webview payload ──

    @Test
    fun `enrich 는 envelope id 를 payload id 에 복제한다`() {
        val coreEnvelope = mapOf(
            "id" to "req-7",
            "type" to "approval_request",
            "payload" to mapOf("tool" to "exec", "args" to listOf("ls"))
        )

        val enriched = ApprovalEnvelopeAdapter.enrichRequestForWebview(coreEnvelope)

        assertEquals("req-7", enriched["id"])
        assertEquals("exec", enriched["tool"])
        assertEquals(listOf("ls"), enriched["args"])
    }

    @Test
    fun `enrich 는 payload 가 비어있어도 id 만이라도 채운다`() {
        val coreEnvelope = mapOf("id" to "req-9", "type" to "approval_request", "payload" to null)

        val enriched = ApprovalEnvelopeAdapter.enrichRequestForWebview(coreEnvelope)

        assertEquals("req-9", enriched["id"])
    }

    @Test
    fun `enrich 는 envelope id 가 없으면 빈 문자열로 채운다 - silent fail 회피`() {
        val coreEnvelope = mapOf("type" to "approval_request", "payload" to mapOf("tool" to "x"))

        val enriched = ApprovalEnvelopeAdapter.enrichRequestForWebview(coreEnvelope)

        assertEquals("", enriched["id"])
        assertEquals("x", enriched["tool"])
    }

    // ── toApprovalResponse: Webview message → Core envelope ──

    @Test
    fun `toApprovalResponse 는 requestId 를 envelope id 로 승격한다`() {
        val webviewMsg = mapOf(
            "type" to "approval_response",
            "payload" to mapOf("requestId" to "req-7", "approved" to true)
        )

        val env = ApprovalEnvelopeAdapter.toApprovalResponse(webviewMsg)

        assertNotNull(env)
        assertEquals("req-7", env!!["id"])
        assertEquals(IpcMessageType.APPROVAL_RESPONSE, env["type"])
        assertEquals(mapOf("approved" to true), env["payload"])
    }

    @Test
    fun `toApprovalResponse 는 approved 가 빠지면 false 로 안전하게 처리한다`() {
        val webviewMsg = mapOf(
            "type" to "approval_response",
            "payload" to mapOf("requestId" to "req-1")
        )

        val env = ApprovalEnvelopeAdapter.toApprovalResponse(webviewMsg)

        assertNotNull(env)
        assertEquals(mapOf("approved" to false), env!!["payload"])
    }

    @Test
    fun `toApprovalResponse 는 requestId 가 없으면 null 반환 - silent drop 보다 명시적 거절`() {
        val webviewMsg = mapOf(
            "type" to "approval_response",
            "payload" to mapOf("approved" to true)  // requestId 누락
        )

        assertNull(ApprovalEnvelopeAdapter.toApprovalResponse(webviewMsg))
    }

    @Test
    fun `toApprovalResponse 는 payload 가 비어있으면 null 반환`() {
        val webviewMsg = mapOf("type" to "approval_response", "payload" to null)

        assertNull(ApprovalEnvelopeAdapter.toApprovalResponse(webviewMsg))
    }
}
