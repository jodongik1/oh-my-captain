package com.ohmycaptain.ipc

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * Core(Node.js) 측 IPC 프로토콜 상수와 정확히 같은 문자열인지 회귀 방지용 테스트.
 *
 * Core 측 코드에서 같은 상수가 어떻게 정의되어 있는지 변경되면 이 테스트가 실패해야 한다.
 * 테스트가 실패하면 프로토콜 동기화가 깨졌다는 신호이므로, Core/Kotlin 양쪽을 함께 수정해야 한다.
 */
class IpcMessageTypeTest {

    @Test
    fun `Webview Core 송신 타입 문자열 회귀 방지`() {
        assertEquals("init", IpcMessageType.INIT)
        assertEquals("code_action", IpcMessageType.CODE_ACTION)
        assertEquals("approval_response", IpcMessageType.APPROVAL_RESPONSE)
        assertEquals("context_response", IpcMessageType.CONTEXT_RESPONSE)
    }

    @Test
    fun `Core to Kotlin 수신 타입 문자열 회귀 방지`() {
        assertEquals("context_request", IpcMessageType.CONTEXT_REQUEST)
        assertEquals("approval_request", IpcMessageType.APPROVAL_REQUEST)
        assertEquals("invoke_action", IpcMessageType.INVOKE_ACTION)
    }

    @Test
    fun `양방향 타입 문자열 회귀 방지`() {
        assertEquals("open_in_editor", IpcMessageType.OPEN_IN_EDITOR)
        assertEquals("open_tool_output", IpcMessageType.OPEN_TOOL_OUTPUT)
    }

    @Test
    fun `Webview 전용 타입 문자열 회귀 방지`() {
        assertEquals("core_ready", IpcMessageType.CORE_READY)
        assertEquals("ready", IpcMessageType.READY)
        assertEquals("error", IpcMessageType.ERROR)
    }
}
