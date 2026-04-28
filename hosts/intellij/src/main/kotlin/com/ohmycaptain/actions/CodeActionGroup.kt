package com.ohmycaptain.actions

import com.intellij.openapi.actionSystem.*
import com.ohmycaptain.bridge.BRIDGE_KEY
import com.ohmycaptain.ipc.IpcMessageType
import com.ohmycaptain.ipc.ipcEnvelope

/**
 * 에디터 우클릭 컨텍스트 메뉴의 "Oh My Captain" 하위 메뉴 그룹.
 *
 * plugin.xml 의 `<group id="omc.CodeActionGroup">` 에 바인딩되며, 자식 항목으로
 * [ExplainCodeAction] · [ReviewCodeAction] 등 [BaseCodeAction] 구현체가 노출된다.
 *
 * 활성화 조건: 활성 에디터가 있을 때만 보임 (선택 영역은 BaseCodeAction 에서 별도 처리).
 * - 선택 영역 유무는 [BaseCodeAction.actionPerformed] 에서 분기되므로 그룹 자체는
 *   "에디터 존재" 만 확인한다. 선택이 없으면 파일 전체를 대상으로 동작한다.
 *
 * [getActionUpdateThread] 는 BGT 로 지정 — IntelliJ 2022.3+ 의 ActionUpdateThread 정책
 * 으로, EDT 블로킹 방지를 위해 백그라운드에서 update 가 호출된다.
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
 * 코드 액션 공통 동작을 담은 추상 클래스.
 *
 * 책임: 현재 선택 영역(또는 파일 전체)을 패키징하여 Core 로 `code_action` IPC 메시지를 발사한다.
 * 동일한 페이로드 형태가 [com.ohmycaptain.bridge.JBCEFBridgeManager.handleInvokeAction]
 * (Webview 슬래시 명령) 에서도 재현되므로, 두 경로의 형식을 변경할 때 함께 맞춰야 한다.
 *
 * @param actionType Core 가 어떤 프롬프트/도구 흐름을 실행할지 식별하는 키
 *                   (예: "explain", "review", "impact" — 하단 클래스 선언 참조).
 */
abstract class BaseCodeAction(private val actionType: String) : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val psiFile = e.getData(CommonDataKeys.PSI_FILE) ?: return

        // BRIDGE_KEY 는 JBCEFBridgeManager.register() 에서 project UserData 에 심어둠.
        // 툴 윈도우가 한 번도 열리지 않았다면 null — 이 경우 사용자에게 별도 안내 없이 무시한다.
        val bridge = project.getUserData(BRIDGE_KEY) ?: return

        val payload = buildCodeActionPayload(actionType, editor, psiFile)
        bridge.sendToCore(ipcEnvelope(IpcMessageType.CODE_ACTION, payload))
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.getData(CommonDataKeys.EDITOR) != null
    }

    override fun getActionUpdateThread() = ActionUpdateThread.BGT
}

// ── 각 액션 클래스 ─────────────────────────────────────────────────────────────
// plugin.xml 의 `<action id="omc.xxx" class="...">` 와 1:1 매핑된다.
// 새 액션 추가 시: (1) 여기에 클래스 추가, (2) plugin.xml 에 등록,
// (3) JBCEFBridgeManager.ACTION_ID_TO_TYPE 에도 등록(슬래시 명령 라우팅용).
class ExplainCodeAction     : BaseCodeAction("explain")
class ReviewCodeAction      : BaseCodeAction("review")
class ImpactAnalysisAction  : BaseCodeAction("impact")
class QueryValidationAction : BaseCodeAction("query_validation")
class ImproveCodeAction     : BaseCodeAction("improve")
class GenerateTestAction    : BaseCodeAction("generate_test")
