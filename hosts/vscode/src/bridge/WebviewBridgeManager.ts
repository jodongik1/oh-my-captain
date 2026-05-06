// Webview(React) ↔ Core(Node.js) IPC 의 중계 허브.
// IntelliJ 측 JBCEFBridgeManager.kt 의 라우팅 책임만 그대로 가져온다.
//
// 메시지 흐름:
//   Webview ──postMessage──▶ handleFromWebview ──IpcChannel──▶ Core
//   Webview ◀─postMessage──  handleFromCore   ◀─IpcChannel──  Core
//
// 분리된 책임 (위임자):
// - 파일 열기·도구 출력 → EditorActionHandler
// - PSI(symbol/diagnostic) 컨텍스트 수집 → ContextRequestHandler
// - 승인 envelope 양방향 변환 → ApprovalEnvelopeAdapter

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import * as vscode from 'vscode'
import type { IpcChannel, IpcMessage } from '../ipc/IpcChannel.js'
import { IpcClient } from '../ipc/IpcClient.js'
import { ipcEnvelope } from '../ipc/envelope.js'
import { IpcMessageType } from '../ipc/messageType.js'
import { ApprovalEnvelopeAdapter } from './ApprovalEnvelopeAdapter.js'
import { ContextRequestHandler } from './ContextRequestHandler.js'
import { EditorActionHandler } from './EditorActionHandler.js'
import { CODE_ACTION_ID_TO_TYPE, buildCodeActionPayload } from '../actions/codeActionPayload.js'
import { loggerFor } from '../logging/logger.js'

const log = loggerFor('WebviewBridgeManager')

export class WebviewBridgeManager {
  private ipcChannel: IpcChannel | null = null
  private readonly editorActions = new EditorActionHandler()
  private readonly contextRequestHandler: ContextRequestHandler
  /** Core 미연결 시 메시지를 큐잉했다가 connectCore 시 일괄 flush. */
  private readonly pendingMessages: Record<string, unknown>[] = []

  constructor(private readonly webview: vscode.Webview) {
    this.contextRequestHandler = new ContextRequestHandler(() => this.ipcChannel)

    // Webview → Host 수신.
    webview.onDidReceiveMessage((msg: unknown) => {
      if (typeof msg === 'object' && msg !== null) {
        this.handleFromWebview(msg as Record<string, unknown>)
      }
    })
  }

  /**
   * Core 프로세스가 떴을 때 호출 — IpcChannel 을 만들고 init 핸드셰이크 송신.
   * 재연결 시 기존 채널은 안전 종료.
   */
  connectCore(process: ChildProcessWithoutNullStreams, projectRoot: string): void {
    this.ipcChannel?.close()
    const channel = new IpcClient(process)
    this.ipcChannel = channel

    channel.startReceiving(msg => this.handleFromCore(msg))

    channel.send(ipcEnvelope(IpcMessageType.INIT, {
      projectRoot,
      nodeVersion: '20',
      mode: 'ask',
    }))

    // pending flush
    const flushed = this.pendingMessages.length
    while (this.pendingMessages.length > 0) {
      const m = this.pendingMessages.shift()!
      channel.send(m)
    }
    log.info(`IPC handshake done, flushed ${flushed} pending messages`)
  }

  /** Host → Webview 메시지. webview.postMessage 한 번 호출. */
  postToWebview(type: string, payload: unknown): void {
    void this.webview.postMessage({ type, payload })
  }

  postError(message: string): void {
    this.postToWebview(IpcMessageType.ERROR, { message, retryable: false })
  }

  /** Core 로 메시지 전송. 미연결이면 pendingMessages 에 큐잉. */
  sendToCore(message: IpcMessage): void {
    if (this.ipcChannel) {
      this.ipcChannel.send(message)
    } else {
      log.debug(`Core not connected — queueing message (type=${String(message['type'])})`)
      this.pendingMessages.push(message as Record<string, unknown>)
    }
  }

  dispose(): void {
    this.ipcChannel?.close()
    this.ipcChannel = null
  }

  // ── 라우팅 ────────────────────────────────────────────────────────

  private handleFromWebview(msg: Record<string, unknown>): void {
    log.debug(`Webview→Core routing (type=${String(msg['type'])})`)

    switch (msg['type']) {
      case IpcMessageType.OPEN_IN_EDITOR: {
        const p = msg['payload'] as Record<string, unknown> | undefined
        if (p) void this.editorActions.openInEditor(p)
        return
      }
      case IpcMessageType.OPEN_TOOL_OUTPUT: {
        const p = msg['payload'] as Record<string, unknown> | undefined
        if (p) void this.editorActions.openToolOutput(p)
        return
      }
      case IpcMessageType.READY: {
        // Webview 가 늦게 부팅된 경우라도 Core 가 이미 떠있을 수 있으므로 즉시 통보.
        this.postToWebview(IpcMessageType.CORE_READY, {})
        return
      }
      case IpcMessageType.APPROVAL_RESPONSE: {
        const env = ApprovalEnvelopeAdapter.toApprovalResponse(msg)
        if (env) this.sendToCore(env)
        return
      }
      default: {
        // 라우팅 불필요 메시지(prompt, cancel 등) 는 그대로 Core 로.
        this.sendToCore(msg)
      }
    }
  }

  private handleFromCore(msg: Record<string, unknown>): void {
    log.debug(`Core→Webview routing (type=${String(msg['type'])})`)

    switch (msg['type']) {
      case IpcMessageType.CONTEXT_REQUEST: {
        void this.contextRequestHandler.handle(msg)
        return
      }
      case IpcMessageType.APPROVAL_REQUEST: {
        this.postToWebview(IpcMessageType.APPROVAL_REQUEST, ApprovalEnvelopeAdapter.enrichRequestForWebview(msg))
        return
      }
      case IpcMessageType.OPEN_IN_EDITOR: {
        const p = msg['payload'] as Record<string, unknown> | undefined
        if (p) void this.editorActions.openInEditor(p)
        return
      }
      case IpcMessageType.INVOKE_ACTION: {
        void this.handleInvokeAction(msg)
        return
      }
      default: {
        const type = msg['type']
        if (typeof type !== 'string') {
          log.warn('Message without type — drop')
          return
        }
        this.postToWebview(type, msg['payload'] ?? {})
      }
    }
  }

  /** Webview 슬래시 명령(`/explain` 등) 처리 — 우클릭 메뉴와 동일 페이로드 형태. */
  private async handleInvokeAction(msg: Record<string, unknown>): Promise<void> {
    const payload = msg['payload'] as Record<string, unknown> | undefined
    const actionId = payload?.['actionId']
    if (typeof actionId !== 'string') {
      log.warn('invoke_action without actionId — drop')
      return
    }
    const actionType = CODE_ACTION_ID_TO_TYPE[actionId]
    if (!actionType) {
      log.warn(`Unknown actionId='${actionId}' — webview slash command mapping missing?`)
      this.postError(`알 수 없는 액션입니다: ${actionId}`)
      return
    }

    const editor = vscode.window.activeTextEditor
    if (!editor) {
      log.debug(`invoke_action='${actionId}' — no active editor`)
      this.postError('열린 에디터가 없습니다. 코드 파일을 먼저 열고 다시 시도해주세요.')
      return
    }
    const codePayload = buildCodeActionPayload(actionType, editor)
    this.sendToCore(ipcEnvelope(IpcMessageType.CODE_ACTION, codePayload))
  }
}
