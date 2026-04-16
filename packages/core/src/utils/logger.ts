import pino from 'pino'
import pretty from 'pino-pretty'

const stream = pretty({
  colorize: true,
  translateTime: 'SYS:HH:MM:ss',
  ignore: 'pid,hostname',
  destination: process.stderr,
})

export const logger = pino({ level: 'info' }, stream)

// 모듈별 레벨 prefix 로거 팩토리
// 모든 출력은 stderr → IntelliJ 로그창에 [Module:LEVEL] 형태로 표시됨
export function makeLogger(module: string) {
  return {
    info:  (...args: unknown[]) => console.error(`[${module}:INFO]`,  ...args),
    warn:  (...args: unknown[]) => console.error(`[${module}:WARN]`,  ...args),
    error: (...args: unknown[]) => console.error(`[${module}:ERROR]`, ...args),
    debug: (...args: unknown[]) => console.error(`[${module}:DEBUG]`, ...args),
  }
}
