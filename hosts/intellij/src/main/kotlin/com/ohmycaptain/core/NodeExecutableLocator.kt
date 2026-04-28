package com.ohmycaptain.core

import com.ohmycaptain.logging.loggerFor
import java.io.File

/**
 * 시스템에 설치된 Node.js 실행 파일 경로를 탐색하는 헬퍼.
 *
 * 관리되는 Node 버전(nvm/fnm) 우선, 없으면 시스템 PATH 로 fallback.
 * IntelliJ 가 띄워진 환경(맥OS GUI 런처)에서는 셸 환경변수가 일부 누락되므로
 * 직접 파일시스템을 훑는 방식으로 첫 번째 후보를 만든다.
 *
 * 탐색 우선순위:
 * 1. nvm default alias (`~/.nvm/alias/default`) → 사용자가 명시적으로 지정한 기본 버전
 * 2. nvm versions 디렉터리 스캔 → v24 우선, 그 외에는 버전명 내림차순
 * 3. fnm default alias 및 시스템 PATH (`/usr/local/bin`, `/opt/homebrew/bin`) — `which`/`where` 호출
 *
 * 어느 단계에서도 못 찾으면 null. [CoreApplicationService.startCore] 가 사용자에게 에러를 노출한다.
 */
internal object NodeExecutableLocator {

    private val log = loggerFor(NodeExecutableLocator::class)

    /**
     * Node 실행 파일 절대 경로 또는 null.
     *
     * 어떤 fallback 단계에서 찾았는지 디버그 로그로 남긴다 — 사용자 환경별 동작 차이를 진단하는 데 결정적.
     */
    fun find(): String? {
        findFromNvmDefault()?.let {
            log.debug { "[OMC] Node 발견: nvm default alias ($it)" }
            return it
        }
        findFromNvmVersions()?.let {
            log.debug { "[OMC] Node 발견: nvm versions 스캔 ($it)" }
            return it
        }
        findFromPathFallback()?.let {
            log.debug { "[OMC] Node 발견: PATH fallback ($it)" }
            return it
        }
        log.warn("[OMC] Node 실행 파일을 모든 fallback 단계에서 찾지 못함")
        return null
    }

    /**
     * 1) nvm default alias 파일에서 기본 버전을 읽고, 해당 버전의 node 바이너리 경로를 반환.
     *
     * `~/.nvm/alias/default` 는 `lts/iron`, `v24.0.0`, `node` 등 다양한 형태가 들어있을 수 있어
     * `versions/node/v{버전}` 디렉터리와 prefix 매칭하는 가장 최신 버전을 고른다.
     */
    private fun findFromNvmDefault(): String? {
        val nvmDir = nvmDir()
        val aliasFile = File("$nvmDir/alias/default")
        if (!aliasFile.exists()) return null
        val versionPrefix = aliasFile.readText().trim()

        val resolved = File("$nvmDir/versions/node")
            .listFiles()
            ?.filter {
                it.isDirectory &&
                    it.name.removePrefix("v").startsWith(versionPrefix) &&
                    File(it, "bin/node").exists()
            }
            ?.maxByOrNull { it.name }
            ?.let { "${it.absolutePath}/bin/node" }

        return resolved?.takeIf { File(it).exists() }
    }

    /**
     * 2) nvm 설치 디렉터리 전체 스캔.
     *
     * 정렬: v24 가 가장 우선(현재 권장 LTS), 그 외에는 버전 문자열 내림차순(v22 > v20 > v18 ...).
     * v24 우선 가중치는 `removePrefix("v").split(".").firstOrNull()?.toIntOrNull() == 24` 비교로 부여.
     */
    private fun findFromNvmVersions(): String? {
        val candidates = File("${nvmDir()}/versions/node")
            .listFiles()
            ?.filter { it.isDirectory && File(it, "bin/node").exists() }
            ?.sortedWith(
                compareByDescending<File> {
                    it.name.removePrefix("v").split(".").firstOrNull()?.toIntOrNull() == 24
                }.thenByDescending { it.name }
            )
            ?.map { "${it.absolutePath}/bin/node" }
            .orEmpty()
        return candidates.firstOrNull()
    }

    /**
     * 3) nvm 미사용 환경 fallback — `which node` (Windows: `where node`) 를 직접 호출.
     *
     * 환경변수 PATH 를 OS 기본 + fnm + Homebrew 경로로 보강한다 — IntelliJ GUI 런치 시
     * 사용자 셸의 PATH 가 그대로 상속되지 않기 때문.
     */
    private fun findFromPathFallback(): String? {
        val home = System.getProperty("user.home")
        val extraPaths = listOfNotNull(
            "$home/.local/share/fnm/aliases/default/bin",
            "/usr/local/bin",
            "/opt/homebrew/bin",
        )
        val pathEnv = (System.getenv("PATH") ?: "") + ":" + extraPaths.joinToString(":")
        val isWindows = System.getProperty("os.name").startsWith("Windows")
        val name = if (isWindows) "node.exe" else "node"

        return try {
            val pb = ProcessBuilder(if (isWindows) "where" else "which", name)
            pb.environment()["PATH"] = pathEnv
            pb.start().inputStream.bufferedReader().readLine()?.trim()?.takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            // which/where 자체가 없거나 실행 권한 문제 — 매우 드문 환경 이슈. 디버깅 가치 있음.
            log.debug(e) { "[OMC] PATH fallback 의 which/where 호출 실패" }
            null
        }
    }

    /** NVM_DIR 환경변수가 있으면 그걸, 없으면 ~/.nvm 사용. */
    private fun nvmDir(): String =
        System.getenv("NVM_DIR") ?: "${System.getProperty("user.home")}/.nvm"
}
