// KeyboardEvent ↔ keybinding 문자열 매칭 헬퍼.
//
// 형식 규칙:
//   - 단일 키: 'ArrowUp', 'Enter', 'Tab', 'Escape', 'a', 'F2'
//   - modifier+key: 'Cmd+Enter', 'Ctrl+Up', 'Shift+Tab', 'Alt+ArrowDown'
//   - modifier 순서는 자유 (내부 정규화)
//   - macOS 의 'Cmd' 와 Windows/Linux 의 'Ctrl' 은 별개로 매칭 — 사용자가 의도한 그대로.

const MODIFIER_ALIASES: Record<string, 'cmd' | 'ctrl' | 'shift' | 'alt'> = {
  cmd: 'cmd', meta: 'cmd', command: 'cmd',
  ctrl: 'ctrl', control: 'ctrl',
  shift: 'shift',
  alt: 'alt', option: 'alt', opt: 'alt',
}

interface ParsedBinding {
  key: string  // 정규화된 key (소문자, 단 'ArrowUp' 등 표준 KeyboardEvent.key 는 그대로)
  cmd: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
}

function parseBinding(binding: string): ParsedBinding | null {
  if (!binding) return null
  const parts = binding.split('+').map(p => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  let key = ''
  let cmd = false, ctrl = false, shift = false, alt = false
  for (const p of parts) {
    const mod = MODIFIER_ALIASES[p.toLowerCase()]
    if (mod === 'cmd') cmd = true
    else if (mod === 'ctrl') ctrl = true
    else if (mod === 'shift') shift = true
    else if (mod === 'alt') alt = true
    else key = p
  }
  if (!key) return null
  return { key: normalizeKey(key), cmd, ctrl, shift, alt }
}

/** 사용자 표기를 KeyboardEvent.key 와 비교 가능한 형태로 정규화. */
function normalizeKey(k: string): string {
  // 단일 글자는 소문자 (KeyboardEvent.key 는 shift 따라 케이스 변하지만 비교는 lower)
  if (k.length === 1) return k.toLowerCase()
  // 표준 이름은 그대로 (ArrowUp, Enter, Escape, Tab, F2 ...)
  return k
}

/** 이벤트가 binding 문자열과 일치하는지 검사. */
export function matchesBinding(e: React.KeyboardEvent | KeyboardEvent, binding: string): boolean {
  const parsed = parseBinding(binding)
  if (!parsed) return false
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (eventKey !== parsed.key) return false
  if (parsed.cmd !== !!e.metaKey) return false
  if (parsed.ctrl !== !!e.ctrlKey) return false
  if (parsed.shift !== !!e.shiftKey) return false
  if (parsed.alt !== !!e.altKey) return false
  return true
}
