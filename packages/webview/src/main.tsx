import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/theme.css'
import { sendToHost } from './bridge/jcef'

const originalError = console.error
console.error = (...args) => {
  originalError(...args)
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  sendToHost({ type: 'client_log', payload: { level: 'error', message: msg } })
}

const originalWarn = console.warn
console.warn = (...args) => {
  originalWarn(...args)
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  sendToHost({ type: 'client_log', payload: { level: 'warn', message: msg } })
}

const originalLog = console.log
console.log = (...args) => {
  originalLog(...args)
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  sendToHost({ type: 'client_log', payload: { level: 'info', message: msg } })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
