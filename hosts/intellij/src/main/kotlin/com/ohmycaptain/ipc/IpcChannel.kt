package com.ohmycaptain.ipc

/**
 * Core 와 메시지를 주고받는 양방향 채널 추상화.
 *
 * 구현체:
 * - [IpcClient] : Node.js 자식 프로세스의 stdin/stdout 을 사용하는 NDJSON 채널 (실제 운영용)
 * - 테스트 fake : 단위 테스트에서 [com.ohmycaptain.bridge.JBCEFBridgeManager] 를 검증할 때 사용
 *
 * 의존성 역전(DIP) 목적:
 * `JBCEFBridgeManager` 는 stdio 라는 구체 메커니즘이 아니라 "메시지를 보내고 받을 수 있는 채널" 만 알면 된다.
 * 향후 도메인 소켓·HTTP·in-memory 채널 등으로 교체해도 호출 측 코드가 바뀌지 않는다.
 */
interface IpcChannel {

    /** 송신 가능 여부 — 채널이 살아있고 닫히지 않았는지. */
    fun isConnected(): Boolean

    /**
     * 메시지를 Core 로 송신.
     *
     * 구현체는 끊긴 상태 호출을 silently 무시할 수도 있고 예외를 던질 수도 있다 — 호출자는
     * [isConnected] 로 사전 확인하거나 결과를 best-effort 로 다룬다.
     */
    fun send(message: Map<String, Any?>)

    /**
     * 수신 루프 시작. 구현체는 별도 스레드에서 라인/메시지 단위로 [handler] 를 호출한다.
     *
     * 한 채널당 한 번만 호출되는 것을 가정한다 (구현체가 두 번째 호출을 어떻게 다루는지는 구현 선택).
     */
    fun startReceiving(handler: (Map<String, Any?>) -> Unit)

    /** 채널 닫기. 호출 후 [isConnected] 는 false 가 되어야 한다. */
    fun close()
}
