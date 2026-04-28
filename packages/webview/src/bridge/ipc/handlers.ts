// Core → Webview 핸들러 맵을 도메인별 팩토리에서 합성.
// 새 도메인이 생기면 여기에 한 줄(import + spread) 만 추가하면 된다.

import type { IpcHandlerCtx, IpcHandlerMap } from './types'
import { createStreamHandlers } from './handlers/stream'
import { createToolHandlers } from './handlers/tool'
import { createSessionHandlers } from './handlers/session'
import { createSystemHandlers } from './handlers/system'

export type { IpcHandlerCtx, IpcHandlerMap } from './types'

export function createIpcHandlers(ctx: IpcHandlerCtx): IpcHandlerMap {
  return {
    ...createStreamHandlers(ctx),
    ...createToolHandlers(ctx),
    ...createSessionHandlers(ctx),
    ...createSystemHandlers(ctx),
  }
}
