import { registerHandler } from '../server.js'
import { makeLogger } from '../../utils/logger.js'

const log = makeLogger('webview')

/** 클라이언트 로그 레벨 → makeLogger 메서드 매핑 */
const LOG_METHOD: Record<string, keyof typeof log> = {
  error: 'error',
  warn: 'warn',
  debug: 'debug',
  info: 'info',
}

export function registerClientLogHandlers() {
  registerHandler('client_log', async (msg) => {
    const payload = msg.payload as { level: string; message: string }
    const method = LOG_METHOD[payload.level] ?? 'info'
    log[method](payload.message)
  })
}
