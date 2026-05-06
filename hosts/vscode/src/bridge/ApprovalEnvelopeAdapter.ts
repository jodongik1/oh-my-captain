// Approval 메시지의 envelope ↔ payload 양방향 변환. IntelliJ 의 ApprovalEnvelopeAdapter.kt 와 1:1.
//
// 비대칭의 출처:
// - Core 와의 IPC 프로토콜은 envelope.id 만 사용해 요청/응답을 매칭.
// - Webview UI 코드는 payload 만 다루므로 id 를 payload 안에서도 볼 수 있어야 편함.
//
// 두 변환 (한 곳에서 같이 관리해야 어긋나지 않음):
//   1) Core → Webview : envelope.id 를 payload.id 로 복제 (enrichRequestForWebview)
//   2) Webview → Core : payload.requestId 를 envelope.id 로 승격 (toApprovalResponse)

import { ipcEnvelope, type IpcEnvelope } from '../ipc/envelope.js'
import { IpcMessageType } from '../ipc/messageType.js'
import { loggerFor } from '../logging/logger.js'

const log = loggerFor('ApprovalEnvelopeAdapter')

export const ApprovalEnvelopeAdapter = {
  /** Core → Webview 변환: envelope.id 를 payload['id'] 로 추가. */
  enrichRequestForWebview(envelope: Record<string, unknown>): Record<string, unknown> {
    const payload = (envelope['payload'] as Record<string, unknown> | undefined) ?? {}
    if (envelope['id'] == null) {
      log.warn('approval_request envelope without id — webview response cannot be matched')
    }
    return { ...payload, id: envelope['id'] ?? '' }
  },

  /** Webview → Core 변환: payload.requestId 를 envelope.id 로 승격. 잘못된 형태면 null. */
  toApprovalResponse(webviewMessage: Record<string, unknown>): IpcEnvelope | null {
    const payload = webviewMessage['payload'] as Record<string, unknown> | undefined
    if (!payload) {
      log.warn('approval_response without payload — drop')
      return null
    }
    const requestId = payload['requestId']
    if (typeof requestId !== 'string') {
      log.warn('approval_response payload without requestId — drop (webview send bug?)')
      return null
    }
    const approved = payload['approved'] === true
    return ipcEnvelope(IpcMessageType.APPROVAL_RESPONSE, { approved }, requestId)
  },
}
