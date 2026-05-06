// open_in_editor / open_tool_output 메시지 처리기.
// IntelliJ 의 EditorActionHandler.kt 와 동치 — 에디터 측 부수 동작만 모은 분리체.

import * as path from 'node:path'
import * as vscode from 'vscode'
import { loggerFor } from '../logging/logger.js'

const log = loggerFor('EditorActionHandler')

export class EditorActionHandler {
  /** 직전에 띄운 도구 출력 문서. 새 출력이 오면 닫고 교체해 탭 누적 방지. */
  private toolOutputDoc: vscode.TextDocument | null = null

  async openInEditor(payload: Record<string, unknown>): Promise<void> {
    const rawPath = (payload['path'] as string | undefined)?.trim()
    if (!rawPath) {
      log.warn('open_in_editor without path — drop')
      return
    }
    const line = payload['line']
    const lineNum = typeof line === 'number' ? line : undefined

    const uri = this.resolveProjectFile(rawPath)
    if (!uri) {
      log.warn(`open_in_editor failed — cannot resolve path (${rawPath})`)
      return
    }
    try {
      const doc = await vscode.workspace.openTextDocument(uri)
      const options: vscode.TextDocumentShowOptions = {}
      if (lineNum != null) {
        const zeroBased = Math.max(0, lineNum - 1)
        options.selection = new vscode.Range(zeroBased, 0, zeroBased, 0)
      }
      await vscode.window.showTextDocument(doc, options)
    } catch (e) {
      log.warn(`open_in_editor open failed (${rawPath})`, e)
    }
  }

  async openToolOutput(payload: Record<string, unknown>): Promise<void> {
    const title = (payload['title'] as string | undefined) ?? 'Tool Output'
    const content = (payload['content'] as string | undefined) ?? ''

    // 직전 도구 출력 닫기 — 같은 종류의 출력으로 탭이 누적되지 않도록.
    if (this.toolOutputDoc) {
      // 이미 닫혔을 수 있어 try
      try {
        await vscode.window.showTextDocument(this.toolOutputDoc, { preserveFocus: false, preview: true })
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      } catch { /* ignore */ }
      this.toolOutputDoc = null
    }

    try {
      const doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content })
      this.toolOutputDoc = doc
      await vscode.window.showTextDocument(doc, { preview: true })
      log.debug(`Tool output displayed (title=${title}, size=${content.length})`)
    } catch (e) {
      log.warn(`openToolOutput failed (${title})`, e)
    }
  }

  /**
   * 도구 args 의 path 정규화.
   * IntelliJ 측 resolveProjectFile 와 동일 케이스 처리:
   *  - 절대경로 ("/Users/foo/x.kt", "C:\foo\x.kt")
   *  - 프로젝트 루트 기준 상대경로 ("src/foo.kt")
   *  - "/" 로 시작하는 프로젝트 상대경로 ("/src/foo.kt")
   *  - 멘션 prefix `@` ("@src/foo.kt")
   */
  private resolveProjectFile(rawPath: string): vscode.Uri | null {
    const cleaned = rawPath.replace(/^@/, '').trim()
    const isAbsolute = cleaned.startsWith('/') || /^[A-Za-z]:[\\/].*/.test(cleaned)

    if (isAbsolute) {
      return vscode.Uri.file(cleaned)
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!root) return null
    const joined = cleaned.startsWith('/') ? path.join(root, cleaned) : path.join(root, cleaned)
    return vscode.Uri.file(joined)
  }
}
