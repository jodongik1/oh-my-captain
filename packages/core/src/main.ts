import { startServer } from './ipc/server.js'
import { makeLogger } from './utils/logger.js'
import { createState } from './ipc/handlers/state.js'
import { registerLifecycleHandlers } from './ipc/handlers/lifecycle.js'
import { registerChatHandlers } from './ipc/handlers/chat.js'
import { registerSessionHandlers } from './ipc/handlers/session.js'
import { registerSettingsHandlers } from './ipc/handlers/settings.js'
import { registerModelHandlers } from './ipc/handlers/model.js'
import { registerCodeActionHandlers } from './ipc/handlers/code_action.js'
import { registerClientLogHandlers } from './ipc/handlers/client_log.js'
import { registerFileSearchHandlers } from './ipc/handlers/file_search.js'
import { registerKeybindingsHandlers } from './ipc/handlers/keybindings.js'
import { registerShellHandlers } from './ipc/handlers/shell.js'

// ── 도구 등록 (barrel import — 모든 도구를 일괄 등록) ──
import './tools/index.js'

const log = makeLogger('main.ts')

// 프로세스 크래시 방지
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason)
})
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err)
})

const state = createState()

startServer(() => {
  log.info('IPC 서버 대기 중...')
})

registerLifecycleHandlers(state)
registerChatHandlers(state)
registerSessionHandlers(state)
registerSettingsHandlers(state)
registerModelHandlers(state)
registerCodeActionHandlers(state)
registerClientLogHandlers()
registerFileSearchHandlers(state)
registerKeybindingsHandlers(state)
registerShellHandlers(state)
