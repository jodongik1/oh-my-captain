package com.ohmycaptain.core

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.ohmycaptain.logging.loggerFor
import java.util.concurrent.TimeUnit

/**
 * Oh My Captain Core(Node.js) 프로세스의 생명주기를 관리하는 애플리케이션 서비스.
 *
 * 역할 분담:
 * - IntelliJ (Kotlin) : "창구" — UI 렌더링, IDE 파일 접근, 사용자 승인 처리
 * - Core (Node.js)    : "두뇌" — LLM 호출, 도구 실행, 대화 히스토리 관리
 * - LLM 서버          : Ollama / OpenAI / Anthropic (HTTP)
 *
 * 메시지 흐름:
 *   사용자 입력 → Kotlin(UI) → IPC → Core → LLM HTTP → 응답 스트리밍 → IPC → Kotlin → Webview
 *
 * 컴포넌트 체인:
 *   Webview (React) ←→ JBCEFBridgeManager (Kotlin) ←→ IpcClient (Kotlin) ←→ Core (Node.js)
 *
 * IPC 채널 (stdio):
 *   IntelliJ(JVM) 와 Core(Node.js) 는 별도 프로세스라 메모리 공유가 불가능하므로 표준 입출력으로 통신한다.
 *
 *   - stdin  : Kotlin → Core 메시지 전송 (IpcClient 가 NDJSON 으로 씀)
 *   - stdout : Core → Kotlin 메시지 전송 (Core 가 NDJSON 으로 씀)
 *   - stderr : Core 로그 전용 → IntelliJ 로그창에 출력
 *
 *   stdout 과 stderr 를 분리(redirectErrorStream=false)한 이유:
 *   stdout 은 NDJSON 메시지 통신 전용이라 로그가 섞이면 파싱이 깨진다. 그래서 로그는 반드시 stderr 로만 흐르게 한다.
 *
 * 어노테이션:
 * - [Service] (Level.APP) : IntelliJ 애플리케이션 전체에서 싱글톤으로 관리.
 * - [Disposable]          : 플러그인 언로드 시 [dispose] 가 자동 호출되어 자식 프로세스 정리.
 */
@Service(Service.Level.APP)
class CoreApplicationService : Disposable {
    private val log = loggerFor<CoreApplicationService>()

    /** 현재 실행 중인 Node.js Core 프로세스. 미구동 시 null. */
    private var coreProcess: Process? = null

    /**
     * Node.js Core 프로세스를 시작한다.
     *
     * 흐름:
     * 1. 이전 프로세스가 살아있으면 강제 종료(재시작/재연결 대응)
     * 2. Node.js 실행 파일 탐색 — [NodeExecutableLocator.find] 가 nvm → fnm → PATH 순으로 탐색
     * 3. 플러그인 번들 내 core/index.js 경로 확인 ([getCoreResourcePath])
     * 4. ProcessBuilder 로 `node core/index.js` 실행 — stdin/stdout 을 IPC 채널로 노출
     * 5. stderr 를 백그라운드 데몬 스레드에서 읽어 IntelliJ 로그창에 실시간 출력
     *    → Core 가 출력하는 `[Core:INFO]`, `[Webview:ERROR]` 등 모든 로그가 한 곳으로 집결
     *
     * 프로젝트 루트는 [com.ohmycaptain.bridge.JBCEFBridgeManager.connectCore] 의 `init` 메시지에서
     * 별도로 전달되므로 startCore 자체는 프로젝트 정보를 받지 않는다.
     *
     * @return 시작된 Core Process 객체. 호출자는 [com.ohmycaptain.ipc.IpcClient] 에 넘겨 통신 시작.
     */
    fun startCore(): Process {
        // 이전 프로세스가 남아있으면 정리 (재시작 또는 재연결 시나리오).
        // 재시작은 정상 흐름이지만 자주 일어나는 일은 아니므로 INFO 레벨 — 디버그 시 트레이싱에 도움.
        coreProcess?.let { proc ->
            if (proc.isAlive) {
                log.info("[OMC] 이전 Core 프로세스 강제 종료 (재시작/재연결).")
                proc.destroyForcibly()
                proc.waitFor(3, TimeUnit.SECONDS)
            }
            coreProcess = null
        }

        val nodeExec = NodeExecutableLocator.find()
        if (nodeExec == null) {
            // 사용자 영향이 큰 실패 — ERROR + 명시 메시지. error() 가 IllegalStateException 던짐.
            log.error("[OMC] Node.js 실행 파일을 찾을 수 없음 — Core 부팅 불가")
            error("[OMC] Node.js 20+ 가 설치되어 있지 않습니다.")
        }
        log.info("[OMC] Node.js 실행 파일 위치: $nodeExec")

        val coreBundle = getCoreResourcePath()
        if (coreBundle == null) {
            log.error("[OMC] Core 번들(core/index.js)을 찾을 수 없음 — 플러그인 패키징 손상 의심")
            error("Core 번들을 찾을 수 없습니다.")
        }
        log.info("[OMC] Core 번들 위치: $coreBundle")

        // stdout/stderr 분리 (redirectErrorStream=false):
        // - stdout : IpcClient 가 NDJSON 메시지로 파싱 — 로그가 섞이면 파싱 실패.
        // - stderr : 아래 데몬 스레드가 IntelliJ 로그창으로 라우팅.
        val proc = ProcessBuilder(nodeExec, coreBundle).redirectErrorStream(false).start()
        coreProcess = proc

        // Core 의 stderr 한 줄을 그대로 INFO 로 흘려보낸다.
        // Core 측이 자체 레벨([Core:INFO]/[Core:ERROR]/[Webview:WARN] 등) 을 prefix 로 박아두므로
        // IntelliJ Logger 의 레벨 한 칸으로 전부 묶어도 idea.log 에서 grep 으로 분류 가능.
        // WARN 이상으로 올리면 정상 stderr 까지 경고로 보이는 false positive 가 생기므로 INFO 가 적절.
        Thread { proc.errorStream.bufferedReader().forEachLine { log.info("[OMC] [stderr] $it") } }
                .also {
                    it.isDaemon = true
                    it.name = "omc-core-stderr"
                }
                .start()

        log.info("[OMC] Core 프로세스 시작 완료 — stdio IPC 준비됨")
        return proc
    }


    /**
     * 플러그인 리소스 디렉터리에서 Core 번들(`core/index.js`) 경로를 반환한다.
     *
     * 플러그인 배포 구조:
     * ```
     *   plugin/
     *     ├── lib/         (Kotlin 플러그인 jar)
     *     └── core/
     *         └── index.js  ← 이 파일을 탐색
     * ```
     *
     * @return core/index.js 절대 경로. 번들이 누락되었거나 PluginId 가 다른 경우 null.
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
