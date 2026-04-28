package com.ohmycaptain.logging

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

/**
 * [RecordingLogger] 자체 검증 — 다른 단위 테스트들이 의존하는 fake 이므로 기본 동작을 회귀 방지.
 */
class RecordingLoggerTest {

    @Test
    fun `debug lazy supplier 가 호출되어 메시지가 기록된다`() {
        val log = RecordingLogger()

        log.debug { "computed=${1 + 1}" }

        assertEquals(1, log.debugs.size)
        assertEquals("computed=2", log.debugs[0].message)
        assertNull(log.debugs[0].error)
    }

    @Test
    fun `debug 는 throwable 변형도 받아 스택 트레이스를 보존한다`() {
        val log = RecordingLogger()
        val boom = RuntimeException("boom")

        log.debug(boom) { "context" }

        assertEquals(1, log.debugs.size)
        assertEquals("context", log.debugs[0].message)
        assertSame(boom, log.debugs[0].error)
    }

    @Test
    fun `info, warn, error 메시지가 레벨별 리스트로 분리된다`() {
        val log = RecordingLogger()

        log.info("hello")
        log.warn("watch out")
        log.error("kaboom")

        assertEquals(1, log.infos.size)
        assertEquals(1, log.warns.size)
        assertEquals(1, log.errors.size)
        assertEquals("hello", log.infos[0].message)
        assertEquals("watch out", log.warns[0].message)
        assertEquals("kaboom", log.errors[0].message)
    }

    @Test
    fun `warn 와 error 는 throwable 을 보존해 스택 트레이스가 사라지지 않는다`() {
        val log = RecordingLogger()
        val boom = RuntimeException("boom")

        log.warn("warn msg", boom)
        log.error("err msg", boom)

        assertSame(boom, log.warns[0].error)
        assertSame(boom, log.errors[0].error)
    }

    @Test
    fun `entries 는 전체 호출 순서를 그대로 보존한다`() {
        val log = RecordingLogger()

        log.info("a")
        log.warn("b")
        log.debug { "c" }
        log.error("d")

        assertEquals(
            listOf(
                RecordingLogger.Level.INFO,
                RecordingLogger.Level.WARN,
                RecordingLogger.Level.DEBUG,
                RecordingLogger.Level.ERROR,
            ),
            log.entries.map { it.level },
        )
    }
}
