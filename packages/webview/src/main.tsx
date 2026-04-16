import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/theme.css'
import { sendToHost } from './bridge/jcef'

function serializeArgs(args: unknown[]): string {
  return args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
}

const originalError = console.error
console.error = (...args) => {
  originalError(...args)
  sendToHost({ type: 'client_log', payload: { level: 'error', message: serializeArgs(args) } })
}

const originalWarn = console.warn
console.warn = (...args) => {
  originalWarn(...args)
  sendToHost({ type: 'client_log', payload: { level: 'warn', message: serializeArgs(args) } })
}

const originalLog = console.log
console.log = (...args) => {
  originalLog(...args)
  sendToHost({ type: 'client_log', payload: { level: 'info', message: serializeArgs(args) } })
}

const originalDebug = console.debug
console.debug = (...args) => {
  originalDebug(...args)
  sendToHost({ type: 'client_log', payload: { level: 'debug', message: serializeArgs(args) } })
}

// 처리되지 않은 Promise 거부도 IntelliJ 로그에 전달
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason instanceof Error
    ? `${e.reason.message}\n${e.reason.stack ?? ''}`
    : String(e.reason)
  sendToHost({ type: 'client_log', payload: { level: 'error', message: `[UnhandledRejection] ${msg}` } })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
