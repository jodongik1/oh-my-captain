import { registerHandler } from '../server.js'

export function registerClientLogHandlers() {
  registerHandler('client_log', async (msg) => {
    const payload = msg.payload as { level: string; message: string }
    const prefix =
      payload.level === 'error'
        ? '[Webview:ERROR]'
        : payload.level === 'warn'
          ? '[Webview:WARN]'
          : payload.level === 'debug'
            ? '[Webview:DEBUG]'
            : '[Webview:INFO]'
    // stdout은 IPC 채널이므로 stderr로만 출력 (ipc/server.ts에서 console.log → console.error 리다이렉트됨)
    console.error(`${prefix} ${payload.message}`)
  })
}
