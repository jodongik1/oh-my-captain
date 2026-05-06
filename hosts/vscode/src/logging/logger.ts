// VS Code OutputChannel 기반 로거. IntelliJ 의 com.ohmycaptain.logging.OmcLogger 와 동일한 역할.
//
// 모든 로그는 "Oh My Captain" 채널 한 곳으로 모이며, prefix([OMC]) 와 레벨([INFO]/[WARN]/...)
// 로 IntelliJ 측 idea.log 형식과 grep 호환을 유지한다.

import * as vscode from 'vscode'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

let channel: vscode.OutputChannel | null = null

function getChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('Oh My Captain')
  return channel
}

function format(level: LogLevel, tag: string, msg: string): string {
  const ts = new Date().toISOString()
  return `${ts} [${level.toUpperCase()}] [${tag}] ${msg}`
}

export interface Logger {
  debug(msg: string, err?: unknown): void
  info(msg: string, err?: unknown): void
  warn(msg: string, err?: unknown): void
  error(msg: string, err?: unknown): void
}

// 환경변수로 디버그 토글 — IntelliJ 의 idea.log.debug.categories=com.ohmycaptain 과 동치.
const DEBUG_ENABLED = process.env.OMC_DEBUG_LOG !== 'false'

export function loggerFor(tag: string): Logger {
  return {
    debug(msg, err) {
      if (!DEBUG_ENABLED) return
      const line = format('debug', tag, msg) + (err ? `\n${formatErr(err)}` : '')
      getChannel().appendLine(line)
    },
    info(msg, err) {
      const line = format('info', tag, msg) + (err ? `\n${formatErr(err)}` : '')
      getChannel().appendLine(line)
    },
    warn(msg, err) {
      const line = format('warn', tag, msg) + (err ? `\n${formatErr(err)}` : '')
      getChannel().appendLine(line)
    },
    error(msg, err) {
      const line = format('error', tag, msg) + (err ? `\n${formatErr(err)}` : '')
      getChannel().appendLine(line)
    },
  }
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`
  return String(err)
}

/** extension deactivate 시 채널 정리. */
export function disposeLogger(): void {
  channel?.dispose()
  channel = null
}

/** dev 모드에서 자동으로 Output 채널을 띄워 디버깅 가능. preserveFocus=true 로 webview 포커스 유지. */
export function showOutputChannel(): void {
  getChannel().show(true)
}
