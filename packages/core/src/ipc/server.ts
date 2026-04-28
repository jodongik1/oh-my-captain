import readline from 'readline'
import type {
  IPCMessage,
  IntellijMessage,
  CoreMessage,
  CorePayloadOf,
} from '@omc/protocol'
import { parseIpcMessage } from './schema.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('server.ts')

/**
 * 타입 안전 핸들러. type 으로 IntellijMessage 의 정확한 변형을 좁혀
 * 핸들러가 `msg.payload as { ... }` 캐스트 없이 typed 접근할 수 있게 한다.
 */
export type TypedHandler<T extends IntellijMessage['type']> = (
  msg: Extract<IntellijMessage, { type: T }>,
  reply: (msg: CoreMessage) => void,
) => void | Promise<void>

/** 내부 저장용 wide 형 — 디스패치 시점에 type 으로 좁힘 */
type AnyHandler = (msg: IntellijMessage, reply: (m: CoreMessage) => void) => void | Promise<void>

/**
 * stdin/stdout 기반 IPC 서버.
 *
 * - 모듈 전역 Map 대신 인스턴스 필드로 핸들러/pending request 를 보관 → 테스트 격리, 다중 인스턴스 가능.
 * - 기본 인스턴스(defaultIpcServer)와 그 메서드를 wrapping 한 모듈 함수(registerHandler/send/request/emit)는
 *   호환성을 위해 그대로 export 한다 — 호출 사이트는 변경 불필요.
 */
export class IpcServer {
  private readonly pendingRequests = new Map<string, (payload: unknown) => void>()
  private readonly handlers = new Map<string, AnyHandler>()
  private readonly input: NodeJS.ReadableStream
  private readonly output: NodeJS.WritableStream

  constructor(opts: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {}) {
    this.input = opts.input ?? process.stdin
    this.output = opts.output ?? process.stdout
  }

  registerHandler<T extends IntellijMessage['type']>(type: T, handler: TypedHandler<T>): void {
    this.handlers.set(type, handler as AnyHandler)
  }

  send(msg: CoreMessage): boolean {
    try {
      this.output.write(JSON.stringify(msg) + '\n')
      return true
    } catch (e) {
      log.error(`메시지 전송 실패: ${msg.type}`, e)
      return false
    }
  }

  /**
   * type 으로 payload 를 type-safe 하게 강제하는 헬퍼.
   * discriminated union 의 정확한 한 변형을 컴파일 타임에 보장한다.
   */
  emit<T extends CoreMessage['type']>(id: string, type: T, payload: CorePayloadOf<T>): boolean {
    return this.send({ id, type, payload } as Extract<CoreMessage, { type: T }>)
  }

  request<T>(msg: CoreMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(msg.id, resolve as (v: unknown) => void)
      if (!this.send(msg)) {
        this.pendingRequests.delete(msg.id)
        reject(new Error('IPC Stdio 전송 실패'))
      }
    })
  }

  /** stdin readline 시작. onReady 는 첫 라인 처리 직전에 한 번 호출. */
  start(onReady: () => void): void {
    const rl = readline.createInterface({
      input: this.input,
      output: undefined,
      terminal: false,
    })

    rl.on('line', (line) => this.handleLine(line))
    rl.on('close', () => {
      log.warn('Stdin closed, exiting process')
      process.exit(0)
    })
    onReady()
  }

  /** 단일 라인 메시지 처리. 테스트에서 직접 호출 가능. */
  handleLine(line: string): void {
    if (!line.trim()) return

    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch (e) {
      log.error('IPCMessage JSON parse error:', e)
      return
    }

    const msg = parseIpcMessage(raw)
    if (!msg) {
      log.warn('IPCMessage 형식 오류 — 봉투 검증 실패:', raw)
      return
    }
    if (msg.type !== 'client_log') {
      log.debug('IPCMessage from Kotlin -> \n', msg)
    }

    if (this.pendingRequests.has(msg.id)) {
      this.pendingRequests.get(msg.id)!(msg.payload)
      this.pendingRequests.delete(msg.id)
      return
    }
    const handler = this.handlers.get(msg.type)
    if (handler) handler(msg as IntellijMessage, (m) => { this.send(m) })
  }
}

/** 프로세스 표준 입출력에 바인딩된 단일 인스턴스. main.ts 에서 start() 호출. */
export const defaultIpcServer = new IpcServer()

// ── 호환 wrapper — 기존 호출자(registerHandler/send/request/emit) 는 변경 없이 동작 ──
export function registerHandler<T extends IntellijMessage['type']>(
  type: T,
  handler: TypedHandler<T>,
): void {
  defaultIpcServer.registerHandler(type, handler)
}

export function send(msg: CoreMessage): boolean {
  return defaultIpcServer.send(msg)
}

export function emit<T extends CoreMessage['type']>(
  id: string,
  type: T,
  payload: CorePayloadOf<T>,
): boolean {
  return defaultIpcServer.emit(id, type, payload)
}

export function request<T>(msg: CoreMessage): Promise<T> {
  return defaultIpcServer.request<T>(msg)
}

export function startServer(onReady: () => void): void {
  defaultIpcServer.start(onReady)
}

/** 외부 export — IPCMessage 봉투 형식 (testing 등) */
export type { IPCMessage }
