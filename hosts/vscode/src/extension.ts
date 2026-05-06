// VS Code 확장 진입점 — IntelliJ 의 plugin.xml + Application Service 등록과 동치.
//
// 부팅 시퀀스:
// 1. CoreProcessManager 인스턴스 생성 (Disposable, deactivate 시 자식 프로세스 정리)
// 2. CaptainWebviewViewProvider 등록 — viewType 'omcView'
// 3. 6개 코드 액션 commands 등록 (omc.explain 등)

import * as vscode from 'vscode'
import { CoreProcessManager } from './core/CoreProcessManager.js'
import { CaptainWebviewViewProvider } from './ui/CaptainWebviewViewProvider.js'
import { registerCodeActions } from './actions/codeActions.js'
import { disposeLogger, loggerFor, showOutputChannel } from './logging/logger.js'

const log = loggerFor('extension')

let coreManager: CoreProcessManager | null = null

export function activate(context: vscode.ExtensionContext): void {
  log.info(`Oh My Captain extension activating (path=${context.extensionPath}, mode=${vscode.ExtensionMode[context.extensionMode]})`)
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    showOutputChannel()
  }

  coreManager = new CoreProcessManager(context.extensionPath)
  context.subscriptions.push(coreManager)

  const provider = new CaptainWebviewViewProvider(
    context.extensionUri,
    context.extensionPath,
    coreManager,
    context.extensionMode,
  )

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CaptainWebviewViewProvider.viewType, provider, {
      // hide 상태에서도 webview 컨텍스트 보존 — IntelliJ ToolWindow 와 거동 맞춤.
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  registerCodeActions(context, {
    sendToCore: msg => provider.sendToCore(msg),
    revealView: () => provider.revealView(),
  })

  log.info('Oh My Captain extension activated')
}

export function deactivate(): void {
  log.info('Oh My Captain extension deactivating')
  coreManager?.dispose()
  coreManager = null
  disposeLogger()
}
