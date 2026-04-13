package com.ohmycaptain.ui

import com.intellij.openapi.Disposable
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress

class EmbeddedWebServer : Disposable {
    private lateinit var server: HttpServer

    // OS가 빈 포트 자동 할당 (포트 충돌 없음)
    val port: Int get() = (server.address as InetSocketAddress).port

    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            val rawPath = exchange.requestURI.path.trimStart('/')
                .ifEmpty { "index.html" }

            // 경로 순회 공격 방지 (../../ 등)
            val safePath = rawPath.replace("..", "").trimStart('/')
            val resourcePath = "webview/$safePath"
            val resource = javaClass.classLoader.getResourceAsStream(resourcePath)

            if (resource == null) {
                val body = "Not Found".toByteArray()
                exchange.sendResponseHeaders(404, body.size.toLong())
                exchange.responseBody.use { it.write(body) }
                return@createContext
            }

            val bytes = resource.readBytes()
            exchange.responseHeaders.add("Content-Type", guessMimeType(safePath))
            exchange.responseHeaders.add("Cache-Control", "no-cache")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.executor = null  // 기본 executor 사용 (JDK 내장)
        server.start()
    }

    private fun guessMimeType(path: String) = when {
        path.endsWith(".html")    -> "text/html; charset=utf-8"
        path.endsWith(".js")      -> "application/javascript"
        path.endsWith(".css")     -> "text/css"
        path.endsWith(".svg")     -> "image/svg+xml"
        path.endsWith(".wasm")    -> "application/wasm"
        path.endsWith(".png")     -> "image/png"
        path.endsWith(".ico")     -> "image/x-icon"
        path.endsWith(".ttf")     -> "font/ttf"
        path.endsWith(".woff2")   -> "font/woff2"
        else -> "application/octet-stream"
    }

    override fun dispose() {
        runCatching { server.stop(0) }
    }
}
