import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import java.time.LocalDate

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.1.20"
    id("org.jetbrains.intellij.platform") version "2.11.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

kotlin { jvmToolchain(21) }

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity(providers.gradleProperty("platformVersion"))
        bundledPlugin("com.intellij.java")
        bundledPlugin("org.jetbrains.kotlin")
        bundledPlugin("Git4Idea")
        bundledPlugin("org.jetbrains.plugins.terminal")
        testFramework(TestFrameworkType.Platform)
    }
    // Gson: IntelliJ Platform에 번들되어 있지만 컴파일 시 명시 필요
    implementation("com.google.code.gson:gson:2.10.1")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")
}

// ── pnpm 경로 탐색 ──────────────────────────────────────────────
fun findPnpm(): String {
    val isWin = System.getProperty("os.name").startsWith("Windows")
    val cmd = if (isWin) "pnpm.cmd" else "pnpm"
    val pathEnv = (System.getenv("PATH") ?: "") + File.pathSeparator +
            System.getProperty("user.home") + "/.local/bin" + File.pathSeparator +
            "/opt/homebrew/bin" + File.pathSeparator +
            "/usr/local/bin"
    for (p in pathEnv.split(File.pathSeparator)) {
        val f = File(p, cmd)
        if (f.exists() && f.canExecute()) {
            return f.absolutePath
        }
    }
    return cmd
}

// ── 웹뷰 빌드 태스크 ──────────────────────────────────────────────
val buildWebview = tasks.register<Exec>("buildWebview") {
    group = "build"
    description = "packages/webview를 Vite로 빌드해 plugin 리소스에 복사"
    workingDir(file("../../packages/webview"))
    commandLine(findPnpm(), "run", "build")
    inputs.dir(file("../../packages/webview/src"))
    inputs.file(file("../../packages/webview/package.json"))
    inputs.file(file("../../packages/webview/vite.config.ts"))
    outputs.dir(file("src/main/resources/webview"))
    outputs.upToDateWhen { file("src/main/resources/webview/index.html").exists() }
}

// ── Core 번들 태스크 ──────────────────────────────────────────────
val bundleCore = tasks.register<Exec>("bundleCore") {
    group = "build"
    description = "packages/core를 esbuild로 번들해 plugin 리소스에 복사"
    workingDir(file("../../packages/core"))
    commandLine(findPnpm(), "run", "bundle")
    inputs.dir(file("../../packages/core/src"))
    inputs.file(file("../../packages/core/package.json"))
    outputs.dir(file("src/main/resources/core"))
    outputs.upToDateWhen {
        file("src/main/resources/core/index.js").exists() &&
        file("src/main/resources/core/prompts/explain.md").exists()
    }
}

// processResources에 hookup → runIde, buildPlugin 모두 자동 연동
tasks.named<ProcessResources>("processResources") {
    dependsOn(buildWebview, bundleCore)
    exclude("core/**")
}

tasks.named<org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask>("prepareSandbox") {
    from("src/main/resources/core") {
        into("${rootProject.name}/core")
    }
}

intellijPlatform {
    pluginConfiguration {
        name = providers.gradleProperty("pluginName")
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            untilBuild = providers.gradleProperty("pluginUntilBuild")
        }
    }
}

tasks.withType<org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask> {
    val homeDir = System.getProperty("user.home")
    val today = LocalDate.now().toString()
    val logDir = File("$homeDir/.oh-my-captain/logs/$today")
    if (!logDir.exists()) {
        logDir.mkdirs()
    }

    val jcefLogLevel = project.findProperty("jcefLogLevel")?.toString() ?: "warning"
    
    // JCEF 로그를 지정된 디렉터리로 라우팅 (IDE 네이티브)
    systemProperty("ide.browser.jcef.log.path", "${logDir.absolutePath}/jcef.log")
    systemProperty("ide.browser.jcef.log.level", jcefLogLevel)
}

