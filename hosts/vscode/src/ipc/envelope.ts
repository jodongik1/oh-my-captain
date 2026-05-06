// IPC envelope 표준 빌더 — IntelliJ 의 ipcEnvelope() 와 동일.
//
// 모든 IPC 메시지는 `{id, type, payload}` 3-키 구조. id 는 응답 매칭에 쓰이므로
// 새 메시지는 매번 UUID 자동 생성, 응답 메시지는 호출자가 원본 id 를 그대로 넘긴다.

import { randomUUID } from 'node:crypto'

export interface IpcEnvelope {
  id: string
  type: string
  payload: unknown
  /** 라우팅 어댑터가 envelope 위에 추가 메타를 끼워 넣는 케이스 허용. */
  [key: string]: unknown
}

export function ipcEnvelope(type: string, payload: unknown, id?: string): IpcEnvelope {
  return { id: id ?? randomUUID(), type, payload }
}
