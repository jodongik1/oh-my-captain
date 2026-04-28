package com.ohmycaptain.actions

import com.intellij.openapi.editor.Editor
import com.intellij.psi.PsiFile

/**
 * Webview 슬래시 명령 ID → Core 가 인식하는 action type 변환표.
 *
 * 우클릭 컨텍스트 메뉴([BaseCodeAction]) 와 1:1 짝을 이룬다.
 * 새 액션 추가 시: (1) [BaseCodeAction] 자식 클래스, (2) plugin.xml `<action id="omc.xxx">`,
 * (3) 이 맵에 한 줄 — 셋이 함께 갱신되어야 한다.
 */
val CODE_ACTION_ID_TO_TYPE: Map<String, String> = mapOf(
    "omc.explain" to "explain",
    "omc.review"  to "review",
    "omc.impact"  to "impact",
    "omc.query"   to "query_validation",
    "omc.improve" to "improve",
    "omc.test"    to "generate_test",
)

/**
 * `code_action` IPC 메시지의 페이로드를 빌드한다.
 *
 * 우클릭 컨텍스트 메뉴([BaseCodeAction.actionPerformed]) 와 Webview 슬래시 명령
 * (`JBCEFBridgeManager.handleInvokeAction`) 두 진입점에서 동일한 형태가 만들어져야 하므로
 * 한 곳에서 관리한다 — 형식이 어긋나면 Core 가 동일하게 처리할 수 없다.
 *
 * 규약:
 * - 선택 영역이 없으면 파일 전체 텍스트가 `code` 로 들어가고 `lineRange` 는 null.
 * - line 은 1-base (사용자 표시용) — IntelliJ LogicalPosition 의 0-base 에 +1.
 *
 * 주의: `editor.selectionModel` 접근은 EDT 에서 안전하다. 호출자가 EDT 컨텍스트를 보장해야 한다.
 */
fun buildCodeActionPayload(
    actionType: String,
    editor: Editor,
    psiFile: PsiFile,
): Map<String, Any?> {
    val selection = editor.selectionModel
    val selectedText = selection.selectedText ?: psiFile.text  // 선택 없으면 파일 전체

    val lineRange = if (selection.hasSelection()) {
        mapOf(
            "start" to (selection.selectionStartPosition?.line?.plus(1) ?: 0),
            "end"   to (selection.selectionEndPosition?.line?.plus(1)   ?: 0),
        )
    } else null

    return mapOf(
        "action"    to actionType,
        "code"      to selectedText,
        "filePath"  to (psiFile.virtualFile?.path ?: ""),
        "language"  to psiFile.language.id.lowercase(),
        "lineRange" to lineRange,
    )
}
