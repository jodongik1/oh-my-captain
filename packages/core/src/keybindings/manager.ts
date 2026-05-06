/**
 * 사용자 정의 키바인딩 로더 + 핫 리로드.
 *
 * 파일 위치: ~/.captain/keybindings.json
 * 형식    : { "<actionId>": "<key>" } — 평면 매핑.
 *
 * 정책:
 *   - 파일이 없으면 기본값을 그대로 반환 (자동 생성하지 않음 — `/keybindings` 슬래시가 ensureFile 호출 시 생성).
 *   - 사용자 파일은 기본값을 덮어쓰지 않고 **개별 키만 override** (defaults 스프레드 후 user 스프레드).
 *   - 파일 변경(저장/외부 편집) 은 fs.watch 로 감지, 작은 debounce 로 멀티 fire 흡수.
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises'
import { watch, mkdirSync, type FSWatcher } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { makeLogger } from '../utils/logger.js'
import type { KeybindingsConfig } from '@omc/protocol'

const log = makeLogger('keybindings.ts')

const KEYBINDINGS_PATH = join(homedir(), '.captain', 'keybindings.json')

/** 기본 키바인딩 — 파일이 비어있거나 일부만 정의해도 누락된 항목은 이 값으로 채워진다. */
export const DEFAULT_KEYBINDINGS: KeybindingsConfig = {
  'history:previous': 'ArrowUp',
  'history:next': 'ArrowDown',
}

export function getKeybindingsPath(): string {
  return KEYBINDINGS_PATH
}

/** 파일을 읽어 기본값과 병합한 키바인딩을 반환. 파일 없거나 손상되어도 기본값을 안전하게 돌려준다. */
export async function loadKeybindings(): Promise<KeybindingsConfig> {
  try {
    const raw = await readFile(KEYBINDINGS_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      log.warn(`keybindings.json 형식 오류 — 기본값 사용`)
      return { ...DEFAULT_KEYBINDINGS }
    }
    // value 가 string 인 항목만 채택해 사용자 실수(숫자/배열) 가 default 를 깨지 않도록.
    const sanitized: KeybindingsConfig = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.length > 0) sanitized[k] = v
    }
    return { ...DEFAULT_KEYBINDINGS, ...sanitized }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      log.warn(`keybindings.json 로드 실패 (${code ?? 'unknown'}) — 기본값 사용`)
    }
    return { ...DEFAULT_KEYBINDINGS }
  }
}

/** 파일이 없으면 기본값으로 생성. 이미 있으면 손대지 않는다. */
export async function ensureKeybindingsFile(): Promise<void> {
  try {
    await access(KEYBINDINGS_PATH)
    return
  } catch {
    // not exists → create
  }
  await mkdir(dirname(KEYBINDINGS_PATH), { recursive: true })
  const body = JSON.stringify(DEFAULT_KEYBINDINGS, null, 2) + '\n'
  await writeFile(KEYBINDINGS_PATH, body, 'utf-8')
  log.info(`keybindings.json 생성: ${KEYBINDINGS_PATH}`)
}

/**
 * 파일 변경 감지 워처. 변경 시 onChange 가 새 키바인딩으로 호출된다.
 * 파일이 없는 상태에서도 디렉토리 워처로 등록해 사후 생성에도 반응.
 */
export function watchKeybindings(onChange: (cfg: KeybindingsConfig) => void): FSWatcher | null {
  const dir = dirname(KEYBINDINGS_PATH)
  let timer: NodeJS.Timeout | null = null
  try {
    // 디렉토리가 없으면 워처 등록 자체가 ENOENT — 미리 만들어두면 첫 파일 생성에도 watcher 가 반응.
    try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    const w = watch(dir, { persistent: false }, (_evt, fname) => {
      if (fname !== 'keybindings.json') return
      // 에디터에 따라 rename + write 로 두세 번 fire — debounce 로 묶음.
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        try {
          const cfg = await loadKeybindings()
          onChange(cfg)
          log.info('keybindings.json 변경 감지 — 재적용')
        } catch (e) {
          log.warn(`keybindings 재로딩 실패: ${(e as Error).message}`)
        }
      }, 80)
    })
    return w
  } catch (e) {
    log.warn(`keybindings watcher 등록 실패: ${(e as Error).message}`)
    return null
  }
}
