import { z } from 'zod'
import type { IPCMessage } from '@omc/protocol'

/**
 * IPC 봉투(`{id, type, payload}`) 의 런타임 검증 스키마.
 * payload 의 세부 형식은 핸들러가 자체 검증한다 — 여기서는 봉투 형식만 보장하여
 * 손상된 JSON / 누락 필드를 호출 사이트에 도달하기 전에 차단한다.
 */
const ipcEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown(),
})

export function parseIpcMessage(raw: unknown): IPCMessage | null {
  const result = ipcEnvelopeSchema.safeParse(raw)
  return result.success ? (result.data as IPCMessage) : null
}
