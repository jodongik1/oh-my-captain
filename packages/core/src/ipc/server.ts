import readline from 'readline'
import type { IPCMessage, CoreMessage } from './protocol.js'
import { logger, makeLogger } from '../utils/logger.js'

const log = makeLogger('IPC')

type MessageHandler = (msg: IPCMessage, reply: (msg: CoreMessage) => void) => void

const pendingRequests = new Map<string, (payload: unknown) => void>()
const handlers = new Map<string, MessageHandler>()

// console.log 출력 방지 (stdout 오염 방지)
console.log = console.error

export function registerHandler(type: string, handler: MessageHandler) {
  handlers.set(type, handler)
}

// Core → IntelliJ 메시지 전송 (stdout)
export function send(msg: CoreMessage): boolean {
  try {
    process.stdout.write(JSON.stringify(msg) + '\n')
    return true
  } catch (e) {
    log.error(`메시지 전송 실패: ${msg.type}`, e)
    return false
  }
}

// Core → IntelliJ 요청-응답 (비동기 대기)
export function request<T>(msg: CoreMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    pendingRequests.set(msg.id, resolve as (v: unknown) => void)
    if (!send(msg)) {
      pendingRequests.delete(msg.id)
      reject(new Error('IPC Stdio 전송 실패'))
    }
  })
}

export function startServer(onReady: () => void) {
  // [흐름 4] Kotlin이 Node.js 프로세스의 stdin으로 전송하는 NDJSON을 한 줄씩 읽음
  const rl = readline.createInterface({
    input: process.stdin,
    output: undefined, // stdout으로 에코 방지
    terminal: false
  })

  rl.on('line', (line) => {
    // 빈 줄 무시
    if (!line.trim()) return

    logger.info({ raw: line }, '[IPC RECV]')
    try {
      const msg = JSON.parse(line) as IPCMessage
      // request()로 보낸 요청에 대한 응답인 경우 (context_request, approval_request 등)
      // pendingRequests Map에 id로 등록된 Promise를 resolve
      if (pendingRequests.has(msg.id)) {
        pendingRequests.get(msg.id)!(msg.payload)
        pendingRequests.delete(msg.id)
        return
      }
      // [흐름 4-계속] 일반 메시지 → main.ts에서 registerHandler로 등록한 핸들러로 라우팅
      const handler = handlers.get(msg.type)
      if (handler) handler(msg, send)
    } catch (e) {
      log.error('parse error:', e)
    }
  })

  rl.on('close', () => {
    log.warn('Stdin closed, exiting process')
    process.exit(0)
  })

  // 프로세스 시작 알림 (이제 Kotlin 파서는 이 줄을 기다리지 않거나 무시해도 됨)
  // Kotlin이 구동 후 이 프로세스로 stdio 통신을 바로 시작할 수 있도록 로그로 알림
  log.info('Stdio IPC 서버 대기 중...')
  onReady()
}
