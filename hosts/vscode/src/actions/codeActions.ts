// 6개 코드 액션 commands 등록. IntelliJ 의 CodeActionGroup.kt + BaseCodeAction 동치.
//
// 우클릭 컨텍스트 메뉴(package.json contributes) 에서 호출되며, 활성 에디터의 선택/전체 텍스트로
// `code_action` IPC 페이로드를 빌드해 Core 로 발사한다.

import * as vscode from 'vscode'
import { ipcEnvelope } from '../ipc/envelope.js'
import type { IpcMessage } from '../ipc/IpcChannel.js'
import { IpcMessageType } from '../ipc/messageType.js'
import { buildCodeActionPayload, CODE_ACTION_ID_TO_TYPE } from './codeActionPayload.js'
import { loggerFor } from '../logging/logger.js'

const log = loggerFor('codeActions')

export interface CodeActionDispatcher {
  sendToCore(message: IpcMessage): void
  /** 사이드바 webview 가 닫혀 있으면 가시화. */
  revealView?(): Promise<void>
}

export function registerCodeActions(
  context: vscode.ExtensionContext,
  dispatcher: CodeActionDispatcher,
): void {
  for (const [actionId, actionType] of Object.entries(CODE_ACTION_ID_TO_TYPE)) {
    const cmd = vscode.commands.registerCommand(actionId, async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        log.debug(`${actionId} — no active editor`)
        vscode.window.showWarningMessage('열린 에디터가 없습니다. 코드 파일을 먼저 열고 다시 시도해주세요.')
        return
      }
      const payload = buildCodeActionPayload(actionType, editor)
      await dispatcher.revealView?.()
      dispatcher.sendToCore(ipcEnvelope(IpcMessageType.CODE_ACTION, payload))
    })
    context.subscriptions.push(cmd)
  }
}
