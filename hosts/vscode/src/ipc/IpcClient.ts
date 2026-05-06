// Core(Node.js) 자식 프로세스의 stdin/stdout 으로 NDJSON 메시지를 주고받는 IpcChannel 구현.
// IntelliJ 측 IpcClient.kt 와 동일한 시맨틱 ─ EOF/송신 실패 시 connected=false 전이.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import * as readline from 'node:readline'
import type { IpcChannel, IpcMessage } from './IpcChannel.js'
import { loggerFor } from '../logging/logger.js'

const log = loggerFor('IpcClient')
const LINE_PREVIEW_LIMIT = 200

export class IpcClient implements IpcChannel {
  private connected = true

  constructor(private readonly process: ChildProcessWithoutNullStreams) {
    process.once('exit', (code, signal) => {
      this.connected = false
      log.info(`Core process exited (code=${code}, signal=${signal})`)
    })
  }

  isConnected(): boolean {
    return this.connected && !this.process.killed
  }

  send(message: IpcMessage): void {
    if (!this.isConnected()) {
      // 사용자 액션 + 종료 race 의 정상 시나리오. type 만 기록 — payload 는 노출 금지.
      log.debug(`Skip send: channel disconnected (type=${String(message['type'])})`)
      return
    }
    try {
      this.process.stdin.write(JSON.stringify(message) + '\n')
    } catch (e) {
      log.warn(`Stdio IPC send failed (type=${String(message['type'])}) — channel disconnected`, e)
      this.connected = false
    }
  }

  startReceiving(handler: (msg: IpcMessage) => void): void {
    const rl = readline.createInterface({ input: this.process.stdout })
    rl.on('line', line => {
      try {
        const msg = JSON.parse(line) as IpcMessage
        handler(msg)
      } catch (e) {
        const preview = line.slice(0, LINE_PREVIEW_LIMIT)
        log.warn(`IPC line parse failed (length=${line.length}, preview=${preview})`, e)
      }
    })
    rl.on('close', () => {
      log.info('Stdio IPC receive loop closed')
      this.connected = false
    })
    rl.on('error', e => {
      log.warn('Stdio IPC receive loop error', e)
      this.connected = false
    })
  }

  close(): void {
    this.connected = false
    try { this.process.stdin.end() } catch { /* ignore */ }
    this.process.kill('SIGTERM')
  }
}
