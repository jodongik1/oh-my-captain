// 키바인딩 IPC 핸들러 — 로드, 변경 감지(워처), `/keybindings` 슬래시 진입점.
//
// 흐름:
//   - keybindings_get   : 파일 읽어 webview 로 push (부트 시 webview 가 한 번 보냄)
//   - keybindings_open  : 파일이 없으면 기본값으로 생성 후 IDE 에서 열기 (open_in_editor)
//   - 워처 자동 부착    : 본 핸들러 등록 시 fs.watch 로 파일을 감시 → 변경 시 keybindings_loaded push

import { registerHandler, send } from '../server.js'
import { makeLogger } from '../../utils/logger.js'
import {
  loadKeybindings,
  ensureKeybindingsFile,
  watchKeybindings,
  getKeybindingsPath,
} from '../../keybindings/manager.js'
import type { CoreState } from './state.js'

const log = makeLogger('keybindings_ipc.ts')

export function registerKeybindingsHandlers(_state: CoreState) {
  registerHandler('keybindings_get', async (msg) => {
    const cfg = await loadKeybindings()
    send({ id: msg.id, type: 'keybindings_loaded', payload: { keybindings: cfg, path: getKeybindingsPath() } })
  })

  registerHandler('keybindings_open', async (msg) => {
    await ensureKeybindingsFile()
    // open_in_editor 는 host 가 IDE 에서 파일 열기를 수행. webview 에서 직접 보내지 않고 core 가 발사 —
    // 파일 보장(생성) 후 IDE 가 열도록 흐름을 한 번에 묶는다.
    send({ id: msg.id, type: 'open_in_editor', payload: { path: getKeybindingsPath() } })
    log.info(`keybindings 파일 열기 요청: ${getKeybindingsPath()}`)
  })

  // 부트 시 워처 등록 — 변경되면 자발적 push (id 빈 문자열 — 응답 매칭 대상 아님).
  watchKeybindings((cfg) => {
    send({ id: '', type: 'keybindings_loaded', payload: { keybindings: cfg, path: getKeybindingsPath() } })
  })
}
