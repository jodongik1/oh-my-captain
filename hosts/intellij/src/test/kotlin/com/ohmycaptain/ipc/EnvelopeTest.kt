package com.ohmycaptain.ipc

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class EnvelopeTest {

    @Test
    fun `envelope 은 id, type, payload 3개 키만 갖는다`() {
        val env = ipcEnvelope("init", mapOf("foo" to "bar"))

        assertEquals(setOf("id", "type", "payload"), env.keys)
        assertEquals("init", env["type"])
        assertEquals(mapOf("foo" to "bar"), env["payload"])
        assertNotNull(env["id"])
    }

    @Test
    fun `id 를 명시하지 않으면 매번 다른 UUID 가 생성된다`() {
        val a = ipcEnvelope("init", null)["id"]
        val b = ipcEnvelope("init", null)["id"]

        assertNotNull(a)
        assertNotNull(b)
        assertNotEquals(a, b)
    }

    @Test
    fun `id 를 명시하면 그 값이 그대로 보존된다 - 응답 매칭용`() {
        val env = ipcEnvelope(type = "approval_response", payload = mapOf("approved" to true), id = "req-42")

        assertEquals("req-42", env["id"])
    }

    @Test
    fun `payload 가 null 이어도 envelope 자체는 만들어진다`() {
        val env = ipcEnvelope("ping", payload = null)

        assertNull(env["payload"])
        assertEquals("ping", env["type"])
    }
}
