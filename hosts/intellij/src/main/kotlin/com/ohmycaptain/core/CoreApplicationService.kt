package com.ohmycaptain.core

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import java.io.File
import java.nio.charset.StandardCharsets
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

@Service(Service.Level.APP)
class CoreApplicationService : Disposable {
    private val log = logger<CoreApplicationService>()
    private var coreProcess: Process? = null
    var socketPath: String? = null
        private set

    fun startCore(projectRoot: String): Process {
        // 이전 프로세스가 남아있으면 정리
        coreProcess?.let { proc ->
            if (proc.isAlive) {
                log.info("[OMC] 이전 Core 프로세스 종료")
                proc.destroyForcibly()
                proc.waitFor(3, TimeUnit.SECONDS)
            }
            coreProcess = null
        }

        val nodeExec = findNodeExecutable()
        if (nodeExec == null) {
            log.error("[OMC] Node.js를 찾을 수 없습니다")
            error("Node.js 20+ 가 설치되어 있지 않습니다.")
        }
        log.info("[OMC] Node.js 경로: $nodeExec")

        val coreBundle = getCoreResourcePath()
        if (coreBundle == null) {
            log.error("[OMC] Core 번들(core/index.js)을 찾을 수 없습니다")
            error("Core 번들을 찾을 수 없습니다.")
        }
        log.info("[OMC] Core 번들 경로: $coreBundle")

        val proc = ProcessBuilder(nodeExec, coreBundle)
            .redirectErrorStream(false)
            .start()
        coreProcess = proc

        // stderr 로깅 (백그라운드)
        Thread {
            proc.errorStream.bufferedReader().forEachLine { log.warn("[Core stderr] $it") }
        }.also { it.isDaemon = true; it.name = "omc-core-stderr" }.start()

        log.info("[OMC] Core 프로세스 시작. Stdio IPC 준비 완료.")
        return proc
    }

    private fun findNodeExecutable(): String? {
        val home = System.getProperty("user.home")
        val nvmDir = System.getenv("NVM_DIR") ?: "$home/.nvm"

        // 1) nvm default alias
        val nvmDefault = File("$nvmDir/alias/default")
        val defaultVersion = if (nvmDefault.exists()) nvmDefault.readText().trim() else null
        val defaultNode = if (defaultVersion != null) {
            File("$nvmDir/versions/node").listFiles()
                ?.filter { it.isDirectory && it.name.removePrefix("v").startsWith(defaultVersion) && File(it, "bin/node").exists() }
                ?.maxByOrNull { it.name }
                ?.let { "${it.absolutePath}/bin/node" }
        } else null
        if (defaultNode != null && File(defaultNode).exists()) return defaultNode

        // 2) nvm 스캔
        val nvmVersions = File("$nvmDir/versions/node").listFiles()
            ?.filter { it.isDirectory && File(it, "bin/node").exists() }
            ?.sortedWith(compareByDescending<File> {
                it.name.removePrefix("v").split(".").firstOrNull()?.toIntOrNull() == 24
            }.thenByDescending { it.name })
            ?.map { "${it.absolutePath}/bin/node" }
            ?: emptyList()
        if (nvmVersions.isNotEmpty()) return nvmVersions.first()

        // 3) PATH fallback
        val extraPaths = listOfNotNull(
            "$home/.local/share/fnm/aliases/default/bin",
            "/usr/local/bin",
            "/opt/homebrew/bin"
        )
        val pathEnv = (System.getenv("PATH") ?: "") + ":" + extraPaths.joinToString(":")
        val isWindows = System.getProperty("os.name").startsWith("Windows")
        val name = if (isWindows) "node.exe" else "node"

        return try {
            val pb = ProcessBuilder(if (isWindows) "where" else "which", name)
            pb.environment()["PATH"] = pathEnv
            pb.start().inputStream.bufferedReader().readLine()?.trim()
                ?.takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            null
        }
    }

    private fun getCoreResourcePath(): String? {
        val pluginId = com.intellij.openapi.extensions.PluginId.getId("com.ohmycaptain")
        val pluginPath = com.intellij.ide.plugins.PluginManagerCore.getPlugin(pluginId)?.pluginPath ?: return null
        val coreDir = java.io.File(pluginPath.toFile(), "core")
        val indexJs = java.io.File(coreDir, "index.js")
        return if (indexJs.exists()) indexJs.absolutePath else null
    }

    override fun dispose() {
        coreProcess?.destroyForcibly()
    }
}
