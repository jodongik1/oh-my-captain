// 슬래시 명령 정의 — 모델/사용자/컨텍스트 카테고리.
// IDE action 호출은 'omc.*' 액션 ID 로 host 에 전달된다.
import type { IHostBridge } from '../../bridge/jcef'
import type { SlashCommand } from '../SlashCommandPopup'
import { INIT_PROMPT } from './initPrompt'

interface Hooks {
  bridge: IHostBridge
  currentModel: string
  onToggleModelSelector: () => void
  onNewSession: () => void
  onToggleHistory: () => void
  onOpenSettings: () => void
  /** /init 같은 사전 정의 prompt 를 사용자 메시지로 보낼 때 사용 */
  onSend: (text: string) => void
  closeSlash: () => void
}

export function buildSlashCommands(h: Hooks): SlashCommand[] {
  const invokeIdeAction = (actionId: string) => {
    h.closeSlash()
    h.bridge.send('invoke_ide_action', { actionId })
  }

  return [
    // ── 모델 ──
    {
      name: '/model', label: '모델 변경', category: '모델',
      description: h.currentModel ? `현재: ${h.currentModel}` : '기본값 (권장)',
      action: () => {
        h.onToggleModelSelector()
        h.closeSlash()
        h.bridge.send('model_list', {})
      },
    },
    // ── 사용자 설정 ──
    { name: '/new', label: '새 대화', category: '사용자 설정',
      action: () => { h.onNewSession(); h.closeSlash() } },
    { name: '/history', label: '대화 히스토리', category: '사용자 설정',
      description: '이전 대화 목록',
      action: () => { h.onToggleHistory(); h.closeSlash() } },
    { name: '/settings', label: '설정', category: '사용자 설정',
      action: () => { h.onOpenSettings(); h.closeSlash() } },
    // ── 프로젝트 부트스트랩 ──
    { name: '/init', label: '프로젝트 분석 & 메모리 초기화', category: '사용자 설정',
      description: 'README/구조/컨벤션을 분석해 .captain/MEMORY.md 에 영구 저장',
      action: () => { h.closeSlash(); h.onSend(INIT_PROMPT) } },
    // ── 컨텍스트 (IDE 등록 액션 호출 — 우클릭 메뉴와 동일 진입점) ──
    { name: '/explain', label: '코드 설명', category: '컨텍스트',
      description: 'Explain This Code', action: () => invokeIdeAction('omc.explain') },
    { name: '/review', label: '코드 리뷰', category: '컨텍스트',
      description: 'Review This Code', action: () => invokeIdeAction('omc.review') },
    { name: '/impact', label: '변경 영향 분석', category: '컨텍스트',
      description: 'Impact Analysis', action: () => invokeIdeAction('omc.impact') },
    { name: '/query', label: 'SQL 쿼리 검증', category: '컨텍스트',
      description: 'Query Validation', action: () => invokeIdeAction('omc.query') },
    { name: '/improve', label: '코드 개선', category: '컨텍스트',
      description: 'Improve This Code', action: () => invokeIdeAction('omc.improve') },
    { name: '/test', label: '테스트 생성', category: '컨텍스트',
      description: 'Generate Test', action: () => invokeIdeAction('omc.test') },
  ]
}
