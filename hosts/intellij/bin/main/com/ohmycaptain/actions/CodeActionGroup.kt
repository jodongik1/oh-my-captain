package com.ohmycaptain.actions

import com.intellij.openapi.actionSystem.*
import com.intellij.openapi.editor.Editor
import com.ohmycaptain.bridge.BRIDGE_KEY

/**
 * 에디터 컨텍스트 메뉴의 "Oh My Captain" 하위 메뉴 그룹.
 * 코드 선택 상태에서만 활성화된다.
 */
class CodeActionGroup : DefaultActionGroup() {
    init {
        templatePresentation.text = "Oh My Captain"
        templatePresentation.isPopupGroup = true
    }

    override fun update(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        e.presentation.isEnabledAndVisible = editor != null
    }

    override fun getActionUpdateThread() = ActionUpdateThread.BGT
}

/**
 * 각 코드 액션의 기본 클래스.
 * action 타입별로 하나씩 상속하여 plugin.xml에 등록한다.
 */
abstract class BaseCodeAction(private val actionType: String) : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val psiFile = e.getData(CommonDataKeys.PSI_FILE) ?: return

        val selectedText = editor.selectionModel.selectedText
            ?: psiFile.text  // 선택 없으면 전체 파일

        val selectionStart = editor.selectionModel.selectionStartPosition
        val selectionEnd = editor.selectionModel.selectionEndPosition

        val payload = mapOf(
            "action" to actionType,
            "code" to selectedText,
            "filePath" to (psiFile.virtualFile?.path ?: ""),
            "language" to (psiFile.language.id.lowercase()),
            "lineRange" to if (editor.selectionModel.hasSelection())
                mapOf("start" to (selectionStart?.line?.plus(1) ?: 0),
                      "end" to (selectionEnd?.line?.plus(1) ?: 0))
            else null
        )

        val bridge = project.getUserData(BRIDGE_KEY) ?: return
        bridge.sendToCore(mapOf(
            "id" to java.util.UUID.randomUUID().toString(),
            "type" to "code_action",
            "payload" to payload
        ))
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(CommonDataKeys.EDITOR) != null
    }

    override fun getActionUpdateThread() = ActionUpdateThread.BGT
}

// ── 각 액션 클래스 (plugin.xml에 등록) ──
class ExplainCodeAction     : BaseCodeAction("explain")
class ReviewCodeAction      : BaseCodeAction("review")
class ImpactAnalysisAction  : BaseCodeAction("impact")
class QueryValidationAction : BaseCodeAction("query_validation")
class ImproveCodeAction     : BaseCodeAction("improve")
class GenerateTestAction    : BaseCodeAction("generate_test")
