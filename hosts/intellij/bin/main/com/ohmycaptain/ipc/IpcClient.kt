package com.ohmycaptain.ipc

import com.google.gson.Gson
import com.intellij.openapi.diagnostic.logger
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets

class IpcClient(private val process: Process) {
    private val log = logger<IpcClient>()
    private val gson = Gson()
    
    private val writer = BufferedWriter(OutputStreamWriter(process.outputStream, StandardCharsets.UTF_8))
    private val reader = BufferedReader(InputStreamReader(process.inputStream, StandardCharsets.UTF_8))

    @Volatile
    private var connected = true
    private var messageHandler: ((Map<String, Any?>) -> Unit)? = null

    fun connect() {
        log.info("[OMC] Stdio 통신 초기화 완료")
    }

    fun isConnected(): Boolean = connected && process.isAlive

    fun send(message: Map<String, Any?>) {
        if (!isConnected()) {
            log.warn("[OMC Trace] 프로세스가 종료되어 전송할 수 없습니다.")
            return
        }
        try {
            val json = gson.toJson(message)
            writer.write(json + "\n")
            writer.flush()
        } catch (e: Exception) {
            log.warn("[OMC] Stdio IPC 메시지 전송 오류", e)
            connected = false
        }
    }

    // 수신 루프 (별도 스레드에서 실행)
    fun startReceiving(handler: (Map<String, Any?>) -> Unit) {
        this.messageHandler = handler
        Thread {
            try {
                reader.forEachLine { line ->
                    try {
                        @Suppress("UNCHECKED_CAST")
                        val msg = gson.fromJson(line, Map::class.java) as Map<String, Any?>
                        handler(msg)
                    } catch (e: Exception) {
                        log.warn("[OMC] IPC 메시지 파싱 오류: $line", e)
                    }
                }
            } catch (e: Exception) {
                log.warn("[OMC] Stdio IPC 수신 루프 종료", e)
            } finally {
                connected = false
            }
        }.also { it.isDaemon = true; it.name = "omc-ipc-receiver" }.start()
    }

    fun close() {
        connected = false
        runCatching { writer.close() }
        runCatching { reader.close() }
        process.destroyForcibly()
    }
}
