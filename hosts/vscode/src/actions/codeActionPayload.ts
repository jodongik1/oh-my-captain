// 우클릭 컨텍스트 메뉴와 Webview 슬래시 명령 두 진입점에서 동일한 형태가 만들어져야 하는
// `code_action` IPC 페이로드 빌더. IntelliJ 측 CodeActionPayload.kt 와 1:1 동기화.
//
// 새 액션 추가 시: (1) codeActions.ts 에서 commands 등록,
// (2) package.json contributes.commands/menus 추가, (3) 이 맵에 한 줄.

import * as vscode from 'vscode'

export const CODE_ACTION_ID_TO_TYPE: Record<string, string> = {
  'omc.explain': 'explain',
  'omc.review':  'review',
  'omc.impact':  'impact',
  'omc.query':   'query_validation',
  'omc.improve': 'improve',
  'omc.test':    'generate_test',
}

export interface CodeActionPayload {
  action: string
  code: string
  filePath: string
  language: string
  lineRange: { start: number; end: number } | null
}

/**
 * `code_action` IPC 메시지의 페이로드를 빌드한다.
 *
 * 규약 (IntelliJ 측과 동일):
 * - 선택 영역이 없으면 파일 전체 텍스트가 `code` 로, `lineRange` 는 null.
 * - line 은 1-base (사용자 표시용).
 */
export function buildCodeActionPayload(
  actionType: string,
  editor: vscode.TextEditor,
): CodeActionPayload {
  const selection = editor.selection
  const hasSelection = !selection.isEmpty
  const code = hasSelection ? editor.document.getText(selection) : editor.document.getText()

  const lineRange = hasSelection
    ? { start: selection.start.line + 1, end: selection.end.line + 1 }
    : null

  return {
    action: actionType,
    code,
    filePath: editor.document.uri.fsPath,
    language: editor.document.languageId.toLowerCase(),
    lineRange,
  }
}
