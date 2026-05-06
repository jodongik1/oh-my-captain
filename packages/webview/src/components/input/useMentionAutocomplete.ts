// `@` 멘션 자동완성 로직 — 입력 변경/키보드/선택을 한 곳에서 관리.
import { useCallback, useState, type RefObject } from 'react'
import { useMentionActions } from '../../hooks/useMentionActions'

interface AtFilter { query: string; index: number }

export interface MentionAutocomplete {
  atFilter: AtFilter | null
  mentionIndex: number
  /** onChange 에서 호출 — text 변경 시 @ 트리거 검사 */
  detectFromText: (val: string, cursorPos: number) => void
  /** 화살표/Enter 처리 — 처리됐으면 true */
  handleKey: (e: React.KeyboardEvent, files: string[], onSelect: (file: string) => void) => boolean
  /** 파일 선택 시 호출 — text 갱신은 호출자가 담당 */
  selectMention: (file: string, currentText: string, cursorPos: number) => string
  /** 폴더 선택 시 호출 — text 를 `@<folderPath>` (trailing slash 포함) 까지 확장하고 그 폴더의 직속 자식 listing 모드로 popup 갱신 */
  drillIntoFolder: (folderPath: string, currentText: string, cursorPos: number) => string
  /** 외부에서 강제로 닫기 (Escape 등) */
  close: () => void
  /** "+ 컨텍스트 추가" 메뉴 → 텍스트 끝에 @ 삽입 후 자동완성 trigger */
  insertAtCursor: (currentText: string, cursorPos: number) => { next: string; cursor: number }
}

export function useMentionAutocomplete(textareaRef: RefObject<HTMLTextAreaElement>): MentionAutocomplete {
  const [atFilter, setAtFilter] = useState<AtFilter | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const { searchFiles } = useMentionActions()

  const detectFromText = useCallback((val: string, cursor: number) => {
    const before = val.slice(0, cursor)
    const match = /(?:^|\s)(@([^\s]*))$/.exec(before)
    if (match) {
      const query = match[2]
      const index = match.index + (match[0].startsWith(' ') ? 1 : 0)
      setAtFilter({ query, index })
      setMentionIndex(0)
      searchFiles(query)
    } else {
      setAtFilter(null)
    }
  }, [searchFiles])

  const handleKey = useCallback((
    e: React.KeyboardEvent,
    files: string[],
    onSelect: (file: string) => void
  ): boolean => {
    if (atFilter === null) return false
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex(prev => Math.max(0, prev - 1))
      return true
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIndex(prev => Math.min(files.length - 1, prev + 1))
      return true
    }
    if (
      (e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing) ||
      (e.key === 'Tab' && !e.shiftKey)
    ) {
      e.preventDefault()
      if (files[mentionIndex]) onSelect(files[mentionIndex])
      return true
    }
    if (e.key === 'Escape') {
      setAtFilter(null)
      return true
    }
    return false
  }, [atFilter, mentionIndex])

  const selectMention = useCallback((file: string, currentText: string, cursorPos: number): string => {
    const upToCursor = currentText.slice(0, cursorPos)
    const match = /(?:^|\s)(@([^\s]*))$/.exec(upToCursor)
    if (match) {
      const replaceStart = match.index + (match[0].startsWith(' ') ? 1 : 0)
      const replaceEnd = replaceStart + match[1].length
      const next = currentText.slice(0, replaceStart) + `@${file} ` + currentText.slice(replaceEnd)
      setAtFilter(null)
      textareaRef.current?.focus()
      return next
    }
    setAtFilter(null)
    textareaRef.current?.focus()
    return currentText.slice(0, cursorPos) + `@${file} ` + currentText.slice(cursorPos)
  }, [textareaRef])

  const drillIntoFolder = useCallback((folderPath: string, currentText: string, cursorPos: number): string => {
    // text 의 마지막 @xxx 를 @folderPath (trailing slash 포함) 로 교체. 공백을 붙이지 않아 atFilter 가 살아있고
    // detectFromText 정규식 [^\s]* 와 호환되어 popup 이 그대로 listing 모드로 전환된다.
    const upToCursor = currentText.slice(0, cursorPos)
    const match = /(?:^|\s)(@([^\s]*))$/.exec(upToCursor)
    let next: string
    let newCursor: number
    if (match) {
      const replaceStart = match.index + (match[0].startsWith(' ') ? 1 : 0)
      const replaceEnd = replaceStart + match[1].length
      next = currentText.slice(0, replaceStart) + `@${folderPath}` + currentText.slice(replaceEnd)
      newCursor = replaceStart + 1 + folderPath.length
    } else {
      next = currentText.slice(0, cursorPos) + `@${folderPath}` + currentText.slice(cursorPos)
      newCursor = cursorPos + 1 + folderPath.length
    }
    setAtFilter({ query: folderPath, index: newCursor - 1 - folderPath.length })
    setMentionIndex(0)
    searchFiles(folderPath)
    requestAnimationFrame(() => {
      const t = textareaRef.current
      if (!t) return
      t.focus()
      t.setSelectionRange(newCursor, newCursor)
    })
    return next
  }, [searchFiles, textareaRef])

  const close = useCallback(() => setAtFilter(null), [])

  const insertAtCursor = useCallback((currentText: string, cursorPos: number) => {
    const before = currentText.slice(0, cursorPos)
    const after = currentText.slice(cursorPos)
    const prefix = before.length > 0 && !/\s$/.test(before) ? ' @' : '@'
    const next = before + prefix + after
    const cursor = before.length + prefix.length
    requestAnimationFrame(() => {
      const t = textareaRef.current
      if (!t) return
      t.focus()
      t.setSelectionRange(cursor, cursor)
      searchFiles('')
      setAtFilter({ query: '', index: cursor - 1 })
      setMentionIndex(0)
    })
    return { next, cursor }
  }, [searchFiles, textareaRef])

  return { atFilter, mentionIndex, detectFromText, handleKey, selectMention, drillIntoFolder, close, insertAtCursor }
}
