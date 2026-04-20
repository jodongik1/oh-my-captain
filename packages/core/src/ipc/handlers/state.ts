import type { IpcHostAdapter } from '../../host/ipc_adapter.js'
import type { LLMProvider, Message } from '../../providers/types.js'
import type { CaptainSettings } from '../protocol.js'
import { DEFAULT_SETTINGS } from '../../settings/types.js'

export interface CoreState {
  host: IpcHostAdapter | null
  provider: LLMProvider | null
  settings: CaptainSettings
  sessionId: string | null
  history: Message[]
  busy: boolean
  codeActionController: AbortController | null
}

export function createState(): CoreState {
  return {
    host: null,
    provider: null,
    settings: DEFAULT_SETTINGS as unknown as CaptainSettings,
    sessionId: null,
    history: [],
    busy: false,
    codeActionController: null,
  }
}
