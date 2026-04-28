package com.ohmycaptain.bridge

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.testFramework.LightVirtualFile
import com.ohmycaptain.logging.loggerFor

/**
 * IDE 에디터 측 부수 동작(파일 열기·도구 출력 표시·경로 정규화) 처리기.
 *
 * [JBCEFBridgeManager] 가 너무 많은 책임을 짊어지지 않도록 "에디터 영역 동작" 만 모은 분리체.
 * Webview 와 Core 어느 쪽에서 와도 동일한 메시지(open_in_editor, open_tool_output) 가 처리되므로
 * 두 라우팅 경로([JBCEFBridgeManager.handleFromReact], [JBCEFBridgeManager.handleFromCore]) 모두
 * 동일한 [EditorActionHandler] 인스턴스를 통해 위임한다.
 *
 * 상태: [toolOutputFile] 는 마지막에 띄운 도구 출력 LightVirtualFile 을 보관해 다음 호출 시 교체한다.
 * 인스턴스가 한 프로젝트에 1개라는 가정 — [JBCEFBridgeManager] 가 프로젝트당 하나이므로 자연스럽게 보장된다.
 */
internal class EditorActionHandler(private val project: Project) {

    private val log = loggerFor<EditorActionHandler>()

    /** 직전에 띄운 도구 출력 가상 파일. 새 출력이 오면 닫고 교체해 탭 누적을 막는다. */
    private var toolOutputFile: LightVirtualFile? = null

    /**
     * `open_in_editor` 메시지 처리. line 이 주어지면 1-base → 0-base 변환 후 캐럿 이동.
     *
     * gson 은 숫자를 기본적으로 Double 로 역직렬화하므로 toInt 변환이 필요하다.
     * 경로 해석 실패(파일 없음·권한 없음) 시에는 조용히 무시한다 — 사용자에게 별도 알림 없음.
     */
    fun openInEditor(payload: Map<*, *>) {
        val rawPath = (payload["path"] as? String)?.trim()
        if (rawPath == null) {
            log.warn("[OMC] open_in_editor 에 path 없음 — 메시지 drop")
            return
        }
        val line = (payload["line"] as? Double)?.toInt()

        ApplicationManager.getApplication().invokeLater {
            val vf = resolveProjectFile(rawPath)
            if (vf == null) {
                // 사용자에게 보여줄만 한 정보지만 알림은 시끄러우므로 로그만 — Webview 의 링크 클릭 흐름에서 자주 발생할 수 있음.
                log.warn("[OMC] open_in_editor 실패 — 파일 해석 불가 (path=$rawPath)")
                return@invokeLater
            }
            val descriptor = if (line != null)
                OpenFileDescriptor(project, vf, line - 1, 0)
            else
                OpenFileDescriptor(project, vf)
            FileEditorManager.getInstance(project).openTextEditor(descriptor, true)
        }
    }

    /**
     * `open_tool_output` 메시지 처리. 도구 stdout 같은 결과를 IDE 안의 가상 파일로 띄운다.
     *
     * - [LightVirtualFile] 사용 → 디스크에 쓰지 않으며 IDE 종료 시 자동 소멸.
     * - 같은 종류의 출력을 여러 번 받을 때 탭이 누적되지 않도록 직전 파일을 닫고 새 탭으로 교체.
     * - project 가 dispose 된 시점이라면 작업 자체를 스킵 — 닫힌 프로젝트에 파일을 여는 것은 무의미.
     */
    fun openToolOutput(payload: Map<*, *>) {
        val title = payload["title"] as? String ?: "Tool Output"
        val content = payload["content"] as? String ?: ""

        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) {
                log.debug { "[OMC] open_tool_output 스킵 — 프로젝트가 이미 dispose 됨" }
                return@invokeLater
            }
            val fem = FileEditorManager.getInstance(project)
            toolOutputFile?.let { fem.closeFile(it) }  // 누적 방지
            val lightFile = LightVirtualFile(title, PlainTextFileType.INSTANCE, content)
            toolOutputFile = lightFile
            fem.openFile(lightFile, true)
            // size 만 — 도구 출력 본문은 사용자 코드/명령 결과를 담을 수 있어 노출 금지.
            log.debug { "[OMC] 도구 출력 표시 (title=$title, size=${content.length})" }
        }
    }

    /**
     * 도구 args 의 path 정규화.
     *
     * 입력 케이스:
     * - 절대경로 ("/Users/foo/x.kt", "C:\foo\x.kt")
     * - 프로젝트 루트 기준 상대경로 ("src/foo.kt")
     * - "/" 로 시작하는 프로젝트 상대경로 ("/src/foo.kt")
     * - 멘션 prefix `@` 가 남아있는 형태 ("@src/foo.kt")
     *
     * 절대경로 → 프로젝트 루트 결합 순으로 시도. 어느 쪽도 매치되지 않으면 null.
     */
    private fun resolveProjectFile(rawPath: String): VirtualFile? {
        val cleaned = rawPath.trimStart('@').trim()
        val lfs = LocalFileSystem.getInstance()

        // 1) 유닉스 절대경로 / 윈도우 드라이브 절대경로 우선 시도.
        if (cleaned.startsWith("/") || cleaned.matches(ABSOLUTE_PATH_REGEX)) {
            lfs.findFileByPath(cleaned)?.let { return it }
        }

        // 2) 프로젝트 루트 기준으로 결합. "/src/.." 와 "src/.." 모두 한 형태로 합친다.
        val base = project.basePath ?: return null
        val joined = if (cleaned.startsWith("/")) "$base$cleaned" else "$base/$cleaned"
        return lfs.findFileByPath(joined)
    }

    private companion object {
        // 윈도우 드라이브 절대경로 (예: "C:\foo", "D:/bar") — 매번 컴파일하지 않도록 캐싱.
        private val ABSOLUTE_PATH_REGEX = Regex("^[A-Za-z]:[\\\\/].*")
    }
}
