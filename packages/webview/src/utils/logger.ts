// Webview 측 얇은 로거 래퍼 — main.tsx 의 console hook 이 파일명을 자동 prefix 하고
// IntelliJ 로 client_log 메시지를 전달하므로, 본 모듈은 일관된 API 만 제공한다.
//
// 사용: `import { makeLogger } from '../utils/logger'`
//      `const log = makeLogger()`  (또는 makeLogger('CustomTag') — 강제 tag 가 필요한 경우)
//      `log.debug('...')` `log.info(...)` 등.
export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function makeLogger(tag?: string): Logger {
  if (!tag) {
    return {
      debug: (...a) => console.debug(...a),
      info: (...a) => console.log(...a),
      warn: (...a) => console.warn(...a),
      error: (...a) => console.error(...a),
    }
  }
  const prefix = `[${tag}]`
  return {
    debug: (...a) => console.debug(prefix, ...a),
    info: (...a) => console.log(prefix, ...a),
    warn: (...a) => console.warn(prefix, ...a),
    error: (...a) => console.error(prefix, ...a),
  }
}
