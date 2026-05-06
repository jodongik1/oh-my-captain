// Core 의 context_request 메시지를 처리해 파일 컨텍스트를 수집/응답.
// IntelliJ 의 ContextRequestHandler.kt 동치 — PSI 대신 VS Code DocumentSymbol/Diagnostics API 사용.

import * as fs from 'node:fs/promises'
import * as vscode from 'vscode'
import type { IpcChannel } from '../ipc/IpcChannel.js'
import { ipcEnvelope } from '../ipc/envelope.js'
import { IpcMessageType } from '../ipc/messageType.js'
import { loggerFor } from '../logging/logger.js'

const log = loggerFor('ContextRequestHandler')

interface SymbolDto { kind: string; name: string; line: number }
interface DiagnosticDto { severity: string; message: string; line: number }
interface FileContextDto {
  path: string
  language: string
  content: string
  symbols: SymbolDto[]
  imports: string[]
  diagnostics: DiagnosticDto[]
}

export class ContextRequestHandler {
  constructor(private readonly channelProvider: () => IpcChannel | null) {}

  async handle(message: Record<string, unknown>): Promise<void> {
    const payload = message['payload'] as Record<string, unknown> | undefined
    const rawPaths = payload?.['paths']
    const paths = Array.isArray(rawPaths) ? rawPaths.filter((x): x is string => typeof x === 'string') : []

    let contexts: FileContextDto[] = []
    try {
      contexts = await this.collectContexts(paths)
    } catch (e) {
      log.warn('Context collection wholly failed — sending empty response', e)
    }

    log.debug(`context_response sending (requested=${paths.length}, results=${contexts.length})`)

    const channel = this.channelProvider()
    if (!channel) {
      log.warn('context_response send impossible — IPC channel disconnected (Core await may deadlock)')
      return
    }
    channel.send(ipcEnvelope(
      IpcMessageType.CONTEXT_RESPONSE,
      contexts,
      (message['id'] as string | undefined) ?? '',
    ))
  }

  /** paths 가 비면 visibleTextEditors 의 문서를 모두 분석. */
  private async collectContexts(paths: string[]): Promise<FileContextDto[]> {
    const uris: vscode.Uri[] = paths.length === 0
      ? vscode.window.visibleTextEditors.map(ed => ed.document.uri)
      : paths.map(p => vscode.Uri.file(p))

    const results: FileContextDto[] = []
    for (const uri of uris) {
      try {
        results.push(await this.collectOne(uri))
      } catch (e) {
        log.debug(`Per-file context collection failed (${uri.fsPath})`, e)
      }
    }
    return results
  }

  private async collectOne(uri: vscode.Uri): Promise<FileContextDto> {
    let content = ''
    let language = 'unknown'
    let doc: vscode.TextDocument | null = null
    try {
      doc = await vscode.workspace.openTextDocument(uri)
      content = doc.getText()
      language = doc.languageId
    } catch {
      // PSI 등록 실패 동치 — content/path 만 채운 부분 응답.
      try { content = await fs.readFile(uri.fsPath, 'utf8') } catch { /* ignore */ }
      return { path: uri.fsPath, language, content, symbols: [], imports: [], diagnostics: [] }
    }

    const [symbols, diagnostics] = await Promise.all([
      this.collectSymbols(uri),
      Promise.resolve(this.collectDiagnostics(uri)),
    ])
    const imports = this.collectImports(content)

    return {
      path: uri.fsPath,
      language,
      content,
      symbols,
      imports,
      diagnostics,
    }
  }

  private async collectSymbols(uri: vscode.Uri): Promise<SymbolDto[]> {
    try {
      const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined>(
        'vscode.executeDocumentSymbolProvider',
        uri,
      )
      if (!result) return []
      const out: SymbolDto[] = []
      const visit = (sym: vscode.DocumentSymbol | vscode.SymbolInformation) => {
        const kind = vscode.SymbolKind[sym.kind].toLowerCase()
        const range: vscode.Range =
          'range' in sym ? sym.range : sym.location.range
        out.push({ kind, name: sym.name, line: range.start.line + 1 })
        if ('children' in sym && sym.children) sym.children.forEach(visit)
      }
      result.forEach(visit)
      return out
    } catch (e) {
      log.debug(`executeDocumentSymbolProvider failed (${uri.fsPath})`, e)
      return []
    }
  }

  private collectDiagnostics(uri: vscode.Uri): DiagnosticDto[] {
    return vscode.languages.getDiagnostics(uri).map(d => ({
      severity: severityToString(d.severity),
      message: d.message,
      line: d.range.start.line + 1,
    }))
  }

  /** PSI textBasedImportFallback 동치 — 정확도 낮으므로 50개 절단. */
  private collectImports(content: string): string[] {
    const out: string[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('import ')) {
        out.push(trimmed.slice('import '.length).replace(/;$/, '').trim())
        if (out.length >= 50) break
      }
    }
    return out
  }
}

function severityToString(s: vscode.DiagnosticSeverity): string {
  switch (s) {
    case vscode.DiagnosticSeverity.Error: return 'error'
    case vscode.DiagnosticSeverity.Warning: return 'warning'
    case vscode.DiagnosticSeverity.Information: return 'info'
    case vscode.DiagnosticSeverity.Hint: return 'hint'
  }
}
