package com.ohmycaptain.logging

/**
 * 테스트용 [OmcLogger] fake — 발생한 로그를 메모리에 기록해 검증 가능하도록 한다.
 *
 * 사용 예:
 * ```kotlin
 *   val log = RecordingLogger()
 *   subject.doSomething(log)
 *   assertEquals(1, log.warns.size)
 *   assertTrue(log.warns[0].message.contains("expected"))
 * ```
 *
 * 의도적으로 단순화 — debug 의 lazy supplier 도 항상 평가해 메시지를 캡처한다 (테스트 시점에는 비용 무관).
 */
class RecordingLogger : OmcLogger {

    data class Entry(val level: Level, val message: String, val error: Throwable? = null)

    enum class Level { DEBUG, INFO, WARN, ERROR }

    private val _entries = mutableListOf<Entry>()
    val entries: List<Entry> get() = _entries.toList()

    val debugs: List<Entry> get() = _entries.filter { it.level == Level.DEBUG }
    val infos: List<Entry> get() = _entries.filter { it.level == Level.INFO }
    val warns: List<Entry> get() = _entries.filter { it.level == Level.WARN }
    val errors: List<Entry> get() = _entries.filter { it.level == Level.ERROR }

    override fun debug(message: () -> String) {
        _entries.add(Entry(Level.DEBUG, message()))
    }

    override fun debug(error: Throwable, message: () -> String) {
        _entries.add(Entry(Level.DEBUG, message(), error))
    }

    override fun info(message: String) {
        _entries.add(Entry(Level.INFO, message))
    }

    override fun warn(message: String, error: Throwable?) {
        _entries.add(Entry(Level.WARN, message, error))
    }

    override fun error(message: String, error: Throwable?) {
        _entries.add(Entry(Level.ERROR, message, error))
    }
}
