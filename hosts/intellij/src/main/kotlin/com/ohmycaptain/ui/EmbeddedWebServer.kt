package com.ohmycaptain.ui

import com.intellij.openapi.Disposable
import com.ohmycaptain.logging.loggerFor
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress

/**
 * 플러그인 jar 안에 번들된 webview 정적 파일을 로컬 HTTP 로 서빙하는 임베디드 서버.
 *
 * 왜 커스텀 스킴(jbcef://) 대신 HTTP 인가:
 * - JCEF 의 커스텀 스킴은 일부 fetch/모듈 로딩 케이스에서 CORS·MIME 제약이 까다롭다.
 * - HTTP 는 브라우저가 그대로 처리하므로 sourcemap, dynamic import, ServiceWorker 가 자연스럽게 동작한다.
 * - 개발(Vite) ↔ 프로덕션(번들) 사이 URL 차이만 빼면 동작이 거의 동일해 디버깅이 쉽다.
 *
 * 보안: localhost(127.0.0.1) 바인딩 + OS 자동 포트 할당. 외부 네트워크 노출은 없다.
 *
 * 라이프사이클: [com.ohmycaptain.ui.CaptainToolWindowFactory] 에서 `Disposer.register` 로
 * 툴 윈도우 disposable 에 묶어둔다. 툴 윈도우가 disposed 되면 [dispose] 가 자동 호출되어 서버를 종료.
 */
class EmbeddedWebServer : Disposable {

    private val log = loggerFor<EmbeddedWebServer>()
    private lateinit var server: HttpServer

    /** 실제 바인드된 포트. 0 으로 요청해 OS 가 자유 포트를 할당하므로 동시 다중 IDE 실행도 충돌 없음. */
    val port: Int get() = (server.address as InetSocketAddress).port

    /**
     * 서버를 기동한다. 멱등 — 두 번째 호출은 silent no-op.
     *
     * 라우팅: 모든 요청은 classpath 의 `webview/` 리소스로 매핑된다.
     * 빈 path 또는 `/` 요청은 `index.html` 로 자동 fallback.
     */
    fun start() {
        // 이미 기동된 상태에서 재호출되면 새 서버를 만들지 않고 그냥 반환 (이전 인스턴스 leak 방지).
        if (::server.isInitialized) {
            log.debug { "[OMC] EmbeddedWebServer.start 재호출 — 무시 (port=$port)" }
            return
        }

        // backlog=0 → JDK 기본값 사용. 단일 클라이언트(JCEF) 대상이라 크게 의미 없음.
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            val rawPath = exchange.requestURI.path.trimStart('/')
                .ifEmpty { "index.html" }

            // 경로 순회(.. 사용) 차단 — classpath 자원만 접근하므로 디스크 노출 위험은 없지만
            // 무관한 jar 자원(예: META-INF/...) 이 노출되지 않도록 한 번 더 방어.
            val safePath = rawPath.replace("..", "").trimStart('/')
            val resourcePath = "webview/$safePath"
            val resource = javaClass.classLoader.getResourceAsStream(resourcePath)

            if (resource == null) {
                // 404 는 보통 webview 빌드 누락 또는 잘못된 자산 참조 — 디버그 가치 있음.
                log.debug { "[OMC] EmbeddedWebServer 404 (path=$safePath)" }
                val body = "Not Found".toByteArray()
                exchange.sendResponseHeaders(404, body.size.toLong())
                exchange.responseBody.use { it.write(body) }
                return@createContext
            }

            val bytes = resource.readBytes()
            exchange.responseHeaders.add("Content-Type", guessMimeType(safePath))
            // 캐시 비활성화: 같은 IDE 세션 안에서 webview hot-reload 시 stale 자원 방지.
            exchange.responseHeaders.add("Cache-Control", "no-cache")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        // null = HttpServer 의 기본 executor (요청별 단일 스레드). 트래픽이 적어 충분.
        server.executor = null
        server.start()
        log.info("[OMC] EmbeddedWebServer 기동 (port=$port)")
    }

    /**
     * 확장자 기반 Content-Type 추정.
     *
     * webview 번들에서 실제로 등장하는 파일만 등록 — 새 자원 타입(예: woff)이 추가되면 여기에 매핑을 더한다.
     * 미지원 타입은 application/octet-stream 으로 떨어져 브라우저가 다운로드 처리할 수 있으니 명시적 매핑이 안전.
     */
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

    /**
     * delay=0: 이미 처리 중인 요청을 기다리지 않고 즉시 종료. 툴 윈도우 닫힘 응답성을 우선.
     * server 가 미초기화 상태에서 dispose 가 호출될 수 있어 isInitialized 가드 필요.
     */
    override fun dispose() {
        if (!::server.isInitialized) return
        runCatching { server.stop(0) }
            .onFailure { log.debug(it) { "[OMC] EmbeddedWebServer 종료 중 예외 — 무시" } }
        log.info("[OMC] EmbeddedWebServer 종료")
    }
}
