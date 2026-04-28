package com.ohmycaptain.ipc

import com.google.gson.Gson
import com.ohmycaptain.logging.loggerFor
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets

/**
 * Core(Node.js) 프로세스의 stdin/stdout 으로 NDJSON 메시지를 주고받는 [IpcChannel] 구현.
 *
 * 프레이밍은 "JSON 한 줄 = 메시지 하나" (`\n` delimiter). 메시지 본문은 임의의
 * `Map<String, Any?>` 구조이며 envelope 스키마(id/type/payload)는 호출 측이 [ipcEnvelope] 로 책임진다.
 *
 * 스레드 모델:
 * - [send] 는 호출 스레드에서 직렬화 후 즉시 flush. 동시 호출이 거의 없는 운영 환경에 맞춰 락은 두지 않는다.
 * - [startReceiving] 은 데몬 스레드를 띄워 stdout 을 라인 단위로 읽어 핸들러 호출.
 *
 * 종료 조건:
 * - Core 가 stdout 을 닫거나 프로세스가 죽으면 reader 가 EOF/예외 → connected=false.
 * - [close] 가 호출되면 즉시 disconnected 상태로 전이하고 자식 프로세스를 강제 종료.
 */
class IpcClient(private val process: Process) : IpcChannel {
    private val log = loggerFor<IpcClient>()
    private val gson = Gson()

    private val writer = BufferedWriter(OutputStreamWriter(process.outputStream, StandardCharsets.UTF_8))
    private val reader = BufferedReader(InputStreamReader(process.inputStream, StandardCharsets.UTF_8))

    /** 송수신 가능 여부. send 실패/수신 EOF/close 호출 시 false 로 전이. @Volatile 로 가시성 보장. */
    @Volatile
    private var connected = true

    override fun isConnected(): Boolean = connected && process.isAlive

    override fun send(message: Map<String, Any?>) {
        if (!isConnected()) {
            // 프로세스 종료 후의 송신은 흔하게 발생할 수 있는 정상 시나리오 (사용자 액션 + 종료 race).
            // type 만 기록 — payload 본문은 사용자 코드/LLM 응답을 담고 있을 수 있어 유출 금지.
            log.debug { "[OMC] 송신 스킵: 채널 끊김 (type=${message["type"]})" }
            return
        }
        try {
            val json = gson.toJson(message)
            writer.write(json + "\n")
            writer.flush()
        } catch (e: Exception) {
            // 송신 실패는 채널 단절 신호 — WARN + 스택 트레이스. 다음 호출은 isConnected=false 로 빠르게 fail.
            log.warn("[OMC] Stdio IPC 송신 실패 (type=${message["type"]}) — 채널 단절 처리", e)
            connected = false
        }
    }

    override fun startReceiving(handler: (Map<String, Any?>) -> Unit) {
        Thread {
            try {
                reader.forEachLine { line ->
                    try {
                        @Suppress("UNCHECKED_CAST")
                        val msg = gson.fromJson(line, Map::class.java) as Map<String, Any?>
                        handler(msg)
                    } catch (e: Exception) {
                        // 한 줄이 부분 데이터/잘못된 JSON 이어도 다른 메시지는 계속 처리.
                        // line 본문은 길이를 자르고 노출 — 사용자 코드 일부가 포함될 수 있어 절단해도 충분.
                        val preview = line.take(LINE_PREVIEW_LIMIT)
                        log.warn("[OMC] IPC 라인 파싱 실패 (length=${line.length}, preview=$preview)", e)
                    }
                }
            } catch (e: Exception) {
                // EOF 가 아닌 진짜 IO 예외 — 스레드 종료 직전이지만 원인 추적 위해 WARN.
                log.warn("[OMC] Stdio IPC 수신 루프 비정상 종료", e)
            } finally {
                // 정상 EOF 도 여기로 도달 — 채널 종료 사실만 INFO 로 한 번 알림.
                log.info("[OMC] Stdio IPC 수신 루프 종료")
                connected = false
            }
        }.also { it.isDaemon = true; it.name = "omc-ipc-receiver" }.start()
    }

    private companion object {
        // 파싱 실패 라인 본문을 idea.log 에 남길 때의 절단 길이.
        // 너무 길면 로그 스팸·민감정보 노출 위험, 너무 짧으면 디버그 가치 없음. 200자 절충.
        private const val LINE_PREVIEW_LIMIT = 200
    }

    override fun close() {
        connected = false
        runCatching { writer.close() }
        runCatching { reader.close() }
        process.destroyForcibly()
    }
}
