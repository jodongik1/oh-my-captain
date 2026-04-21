import readline from 'readline'
import type { IPCMessage, CoreMessage } from './protocol.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('server.ts')

type MessageHandler = (msg: IPCMessage, reply: (msg: CoreMessage) => void) => void

const pendingRequests = new Map<string, (payload: unknown) => void>()
const handlers = new Map<string, MessageHandler>()

export function registerHandler(type: string, handler: MessageHandler) {
  handlers.set(type, handler)
}

export function send(msg: CoreMessage): boolean {
  try {
    process.stdout.write(JSON.stringify(msg) + '\n')
    return true
  } catch (e) {
    log.error(`메시지 전송 실패: ${msg.type}`, e)
    return false
  }
}

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
  const rl = readline.createInterface({
    input: process.stdin,
    output: undefined,
    terminal: false
  })

  rl.on('line', (line) => {
    if (!line.trim()) return
    try {
      const msg = JSON.parse(line) as IPCMessage
      if (msg.type !== 'client_log') {
        log.debug("IPCMessage from Kotlin -> \n", msg)
      }

      if (pendingRequests.has(msg.id)) {
        pendingRequests.get(msg.id)!(msg.payload)
        pendingRequests.delete(msg.id)
        return
      }
      const handler = handlers.get(msg.type)
      if (handler) handler(msg, send)
    } catch (e) {
      log.error('IPCMessage Parse Error : ', e)
    }
  })

  rl.on('close', () => {
    log.warn('Stdin closed, exiting process')
    process.exit(0)
  })

  onReady()
}
