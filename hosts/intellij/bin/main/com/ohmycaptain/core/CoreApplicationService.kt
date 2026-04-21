package com.ohmycaptain.core

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Oh My Captain Core 프로세스 생명주기를 관리하는 애플리케이션 서비스.
 *
 * IntelliJ 플러그인 시작 시 Node.js Core 프로세스를 구동하고, 플러그인 종료 시 프로세스를 정리한다.
 *
 * ─ 역할 분담 ─────────────────────────────────────────────────── IntelliJ (Kotlin) : "창구" — UI 렌더링,
 * IDE 파일 접근, 사용자 승인 처리 Core (Node.js) : "두뇌" — LLM 호출, 도구 실행, 대화 히스토리 관리 LLM 서버 : Ollama / OpenAI /
 * Anthropic (HTTP로 연결)
 *
 * 사용자 입력 → Kotlin(UI) → IPC → Core → LLM HTTP → 응답 스트리밍 → IPC → Kotlin → Webview
 *
 * 통신 구조: Webview (React) ←→ JBCEFBridgeManager (Kotlin) ←→ IpcClient (Kotlin) ←→ Core (Node.js)
 *
 * IPC (Inter-Process Communication, 프로세스 간 통신): IntelliJ(JVM)와 Core(Node.js)는 서로 다른 프로세스라 메모리를 공유할
 * 수 없다. 이 프로젝트는 stdio(표준 입출력)를 IPC 채널로 사용한다.
 *
 * ┌─ 채널별 역할 ──────────────────────────────────────────────┐ │ stdin : Kotlin → Core 메시지 전송
 * (IpcClient가 JSON 씀) │ │ stdout : Core → Kotlin 메시지 전송 (Core가 JSON 씀) │ │ stderr : Core 로그 전용 →
 * IntelliJ 로그창에 출력 │ └────────────────────────────────────────────────────────────┘ stdout과 stderr를
 * 분리(redirectErrorStream=false)한 이유: stdout은 NDJSON 메시지 통신 전용이므로 로그가 섞이면 파싱 오류가 발생한다.
 *
 * @Service(APP) : IntelliJ 애플리케이션 전체에서 싱글톤으로 관리됨 Disposable : 플러그인 언로드 시 dispose()가 자동 호출되어 프로세스 정리
 */
@Service(Service.Level.APP)
class CoreApplicationService : Disposable {
    private val log = logger<CoreApplicationService>()

    /** 현재 실행 중인 Node.js Core 프로세스. 미구동 시 null. */
    private var coreProcess: Process? = null

    /** IpcClient가 사용하는 소켓 경로 (현재 미사용, stdio IPC로 대체됨). */
    var socketPath: String? = null
        private set

    /**
     * Node.js Core 프로세스를 시작한다.
     *
     * 흐름:
     * 1. 이전 프로세스가 살아있으면 강제 종료
     * 2. Node.js 실행 파일 탐색 (nvm → fnm → PATH 순)
     * 3. 플러그인 번들 내 core/index.js 경로 확인
     * 4. ProcessBuilder로 `node core/index.js` 실행
     * 5. stderr를 백그라운드 스레드에서 읽어 IntelliJ 로그창에 출력
     * ```
     *    → Core에서 출력하는 [Core:INFO], [Webview:ERROR] 등 모든 로그가 여기로 집결
     *
     * @param projectRoot
     * ```
     * 현재 열린 프로젝트 루트 경로 (init 메시지로 Core에 전달됨)
     * @return 시작된 Core Process 객체
     */
    fun startCore(projectRoot: String): Process {
        // 이전 프로세스가 남아있으면 정리 (재시작 또는 재연결 시나리오)
        coreProcess?.let { proc ->
            if (proc.isAlive) {
                log.warn("[OMC] 이전 Core 프로세스 종료.")
                proc.destroyForcibly()
                proc.waitFor(3, TimeUnit.SECONDS)
            }
            coreProcess = null
        }

        val nodeExec = findNodeExecutable()
        if (nodeExec == null) {
            log.error("[OMC] Node.js를 찾을 수 없습니다")
            error("[OMC] Node.js 20+ 가 설치되어 있지 않습니다.")
        }
        log.warn("[OMC] Node.js 경로: $nodeExec")

        val coreBundle = getCoreResourcePath()
        if (coreBundle == null) {
            log.error("[OMC] Core 번들(core/index.js)을 찾을 수 없습니다")
            error("Core 번들을 찾을 수 없습니다.")
        }
        log.warn("[OMC] Core 번들 경로: $coreBundle")

        // stdout과 stderr를 분리 (redirectErrorStream=false)
        // - stdout : IpcClient가 NDJSON 메시지로 파싱 → 로그가 섞이면 파싱 오류 발생
        // - stderr : 아래 스레드에서 별도로 읽어 IntelliJ 로그창에 출력
        val proc = ProcessBuilder(nodeExec, coreBundle).redirectErrorStream(false).start()
        coreProcess = proc

        // Core의 stderr(console.error 출력)를 IntelliJ 로그창에 실시간 출력
        // Core 패키지의 [Core:INFO], [Core:DEBUG], [Webview:ERROR] 등 모든 로그가 이 스트림으로 들어옴
        Thread { proc.errorStream.bufferedReader().forEachLine { log.warn("[OMC] [stderr] $it") } }
                .also {
                    it.isDaemon = true
                    it.name = "omc-core-stderr"
                }
                .start()

        log.warn("[OMC] Core 프로세스 시작. Stdio IPC 준비 완료.")
        return proc
    }

    /**
     * 시스템에 설치된 Node.js 실행 파일 경로를 탐색한다.
     *
     * 탐색 우선순위:
     * 1. nvm default alias (~/.nvm/alias/default) → 사용자가 지정한 기본 버전
     * 2. nvm versions 디렉터리 스캔 → v24 우선, 이후 버전명 내림차순
     * 3. fnm default alias 및 시스템 PATH fallback (/usr/local/bin, /opt/homebrew/bin 등)
     *
     * @return node 실행 파일 절대 경로, 찾지 못하면 null
     */
    private fun findNodeExecutable(): String? {
        val home = System.getProperty("user.home")
        val nvmDir = System.getenv("NVM_DIR") ?: "$home/.nvm"

        // 1) nvm default alias: ~/.nvm/alias/default 파일에서 버전 문자열 읽기
        val nvmDefault = File("$nvmDir/alias/default")
        val defaultVersion = if (nvmDefault.exists()) nvmDefault.readText().trim() else null
        val defaultNode =
                if (defaultVersion != null) {
                    File("$nvmDir/versions/node")
                            .listFiles()
                            ?.filter {
                                it.isDirectory &&
                                        it.name.removePrefix("v").startsWith(defaultVersion) &&
                                        File(it, "bin/node").exists()
                            }
                            ?.maxByOrNull { it.name }
                            ?.let { "${it.absolutePath}/bin/node" }
                } else null
        if (defaultNode != null && File(defaultNode).exists()) return defaultNode

        // 2) nvm 설치된 버전 전체 스캔 (v24 최우선, 이후 버전명 내림차순)
        val nvmVersions =
                File("$nvmDir/versions/node")
                        .listFiles()
                        ?.filter { it.isDirectory && File(it, "bin/node").exists() }
                        ?.sortedWith(
                                compareByDescending<File> {
                                    it.name
                                            .removePrefix("v")
                                            .split(".")
                                            .firstOrNull()
                                            ?.toIntOrNull() == 24
                                }
                                        .thenByDescending { it.name }
                        )
                        ?.map { "${it.absolutePath}/bin/node" }
                        ?: emptyList()
        if (nvmVersions.isNotEmpty()) return nvmVersions.first()

        // 3) fnm, 시스템 PATH fallback (nvm 미사용 환경 대응)
        val extraPaths =
                listOfNotNull(
                        "$home/.local/share/fnm/aliases/default/bin",
                        "/usr/local/bin",
                        "/opt/homebrew/bin"
                )
        val pathEnv = (System.getenv("PATH") ?: "") + ":" + extraPaths.joinToString(":")
        val isWindows = System.getProperty("os.name").startsWith("Windows")
        val name = if (isWindows) "node.exe" else "node"

        // which/where 명령으로 PATH에서 node 탐색
        return try {
            val pb = ProcessBuilder(if (isWindows) "where" else "which", name)
            pb.environment()["PATH"] = pathEnv
            pb.start().inputStream.bufferedReader().readLine()?.trim()?.takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * 플러그인 리소스 디렉터리에서 Core 번들(index.js) 경로를 반환한다.
     *
     * 플러그인 배포 구조: plugin/ ├── lib/ (Kotlin 플러그인 jar) └── core/
     * ```
     *       └── index.js ← 이 파일을 탐색
     *
     * @return
     * ```
     * core/index.js 절대 경로, 존재하지 않으면 null
     */
    private fun getCoreResourcePath(): String? {
        val pluginId = com.intellij.openapi.extensions.PluginId.getId("com.ohmycaptain")
        val pluginPath =
                com.intellij.ide.plugins.PluginManagerCore.getPlugin(pluginId)?.pluginPath
                        ?: return null
        val coreDir = java.io.File(pluginPath.toFile(), "core")
        val indexJs = java.io.File(coreDir, "index.js")
        return if (indexJs.exists()) indexJs.absolutePath else null
    }

    /** 플러그인 종료 또는 언로드 시 Core 프로세스를 강제 종료한다. IntelliJ의 Disposable 계약에 의해 자동 호출됨. */
    override fun dispose() {
        coreProcess?.destroyForcibly()
    }
}
