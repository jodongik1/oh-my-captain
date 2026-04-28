package com.ohmycaptain.logging

import com.intellij.openapi.diagnostic.Logger as IjLogger
import kotlin.reflect.KClass

/**
 * 추상 로거.
 *
 * 우리 코드는 구체 로깅 라이브러리(IntelliJ Logger / SLF4J / java.util.logging) 에 직접 결합되지 않는다 — DIP 준수.
 *
 * 운영 구현: [IntelliJLoggerAdapter] 가 `com.intellij.openapi.diagnostic.Logger` 위에 얹는다.
 * 그 IntelliJ Logger 자체가 이미 SLF4J 위에 얹혀 있으므로 외부 SLF4J 직접 의존을 피하면서
 * idea.log 라우팅·JCEF 로그 분리 등 IntelliJ Platform 의 로그 인프라 혜택을 그대로 받는다.
 *
 * 테스트 구현: `RecordingLogger` (test source-set) 가 발생한 로그를 메모리에 기록해 검증 가능.
 *
 * 설계 원칙:
 * - [debug] 는 `() -> String` 을 받아 lazy evaluation — DEBUG 비활성 시 메시지 빌드 자체를 회피.
 * - [warn]/[error] 는 [Throwable] 인자를 명시적으로 노출 — catch 블록에서 스택 트레이스를 절대 누락하지 않도록 강제.
 * - [info] 는 1회성 마일스톤 가정. hot path 에는 [debug] 사용.
 *
 * 로그 레벨 가이드:
 * - debug : 개발자 도구. 메시지 라우팅·내부 상태·실패 분기의 상세.
 * - info  : 정상 마일스톤. 1회성 이벤트(Core 시작·IPC 연결 완료·서버 기동).
 * - warn  : 회복 가능한 비정상. 끊긴 채널 송신·fallback 사용·메시지 drop.
 * - error : 명확한 실패. Core 부팅 실패 같은 사용자 영향 사건. 반드시 Throwable 동반.
 *
 * 모든 로그 메시지는 `[OMC]` prefix 로 시작해 grep 가능성을 유지한다.
 * 민감정보(API 키·전체 IPC payload·LLM 응답 본문) 는 메시지에 포함하지 않는다.
 */
interface OmcLogger {

    /**
     * DEBUG 레벨 로그. lazy supplier — DEBUG 비활성 시 [message] 가 호출되지 않는다.
     * Hot path 에서 비싼 문자열 빌드를 안전하게 사용할 수 있다.
     */
    fun debug(message: () -> String)

    /** DEBUG 레벨 + 예외. 부분 실패 추적용 (silent catch 보다 정보 보존). */
    fun debug(error: Throwable, message: () -> String)

    fun info(message: String)

    fun warn(message: String, error: Throwable? = null)

    fun error(message: String, error: Throwable? = null)
}

/**
 * IntelliJ Platform Logger 위에 [OmcLogger] 를 얹는 어댑터.
 *
 * 각 메서드는 IntelliJ Logger 의 동일 메서드로 위임한다. throwable 이 null 일 때만 단일 인자
 * 시그니처를 골라 IntelliJ Logger 의 내부 분기를 회피.
 */
internal class IntelliJLoggerAdapter(private val delegate: IjLogger) : OmcLogger {

    override fun debug(message: () -> String) {
        // isDebugEnabled gating — DEBUG OFF 환경에서 supplier 호출 자체를 생략해 hot path 비용을 0 으로 만든다.
        if (delegate.isDebugEnabled) delegate.debug(message())
    }

    override fun debug(error: Throwable, message: () -> String) {
        if (delegate.isDebugEnabled) delegate.debug(message(), error)
    }

    override fun info(message: String) {
        delegate.info(message)
    }

    override fun warn(message: String, error: Throwable?) {
        if (error != null) delegate.warn(message, error) else delegate.warn(message)
    }

    override fun error(message: String, error: Throwable?) {
        if (error != null) delegate.error(message, error) else delegate.error(message)
    }
}

/**
 * 클래스 단위 로거 팩토리. 운영 코드에서 호출.
 *
 * 사용 예:
 * ```kotlin
 *   private val log = loggerFor<JBCEFBridgeManager>()
 * ```
 */
fun loggerFor(clazz: KClass<*>): OmcLogger =
    IntelliJLoggerAdapter(IjLogger.getInstance(clazz.java))

inline fun <reified T : Any> loggerFor(): OmcLogger = loggerFor(T::class)
