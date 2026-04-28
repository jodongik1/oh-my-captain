/**
 * 에이전트 루프 동작 튜닝 상수.
 *
 * ReAct(Reason-Act-Observe) 아키텍처의 모든 임계값을 한 곳에 모아 둔다.
 * 운영 중 빈번하게 조정될 가능성이 높은 값만 두고, 도구별 안전 기본값은 도구 모듈 안에 둔다.
 */

/** 메인 루프 안전망. */
export const LOOP_TUNING = {
  /** 일반 작업은 15회 이내 완료. 30회 도달 시 강제 종료. */
  maxIterations: 30,
  /** 동일 시그니처 에러가 N회 연속 → 루프 조기 중단. */
  maxConsecutiveErrors: 3,
  /** 동일 도구가 N회 연속 호출되면 hint 주입. */
  repeatHint: 4,
  /** 동일 도구 N회 연속 → 차단 + 강제 종결 hint. */
  repeatBlock: 7,
} as const

/**
 * 5-stage Context Compaction Pipeline 임계값 (모두 contextWindow 대비 비율).
 *
 * 1. budgetReduction — 잉여 시스템 프롬프트(rules/memory) 슬림화
 * 2. snip            — 가장 오래된 대용량 tool_result content 삭제 (메타데이터만 유지)
 * 3. microcompact    — 남은 모든 대용량 tool_result content 를 head/tail 만 보존
 * 4. contextCollapse — 오래된 user/assistant 턴들을 구조화 요약으로 대체
 * 5. autoCompact     — LLM 요약으로 전체 히스토리 압축
 *
 * 이 순서로 단계적으로 진입한다 (이전 단계로 충분하면 다음 단계 skip).
 */
export const COMPACTOR_TUNING = {
  budgetReduction: 0.55,
  snip:            0.68,
  microcompact:    0.78,
  contextCollapse: 0.86,
  autoCompact:     0.93,
  /** maybeCompact() 진입 임계 — 이 미만이면 압축 검사 자체를 스킵. */
  checkRatio:      0.50,
} as const

/** 자동 검증 (write 도구 사용 후 빌드/타입체크 실행) */
export const VERIFY_TUNING = {
  /** 동일 검증 실패 N회 시 다른 접근 권유 hint */
  hint: 3,
  /** 동일 검증 실패 N회 시 루프 조기 중단 */
  break: 5,
} as const

/**
 * Evaluator (Optimizer-Evaluator 패턴).
 * 일정 주기마다 또는 write 도구 직후 "지금 진행 방향이 옳은가?" 를 별도 LLM 호출로 평가.
 */
export const EVALUATOR_TUNING = {
  /** 일반 모드에서 Evaluator 실행 주기 (iteration 수). 0이면 비활성화. */
  cadence: 6,
  /** write 도구 사용 직후 무조건 Evaluator 실행 여부 */
  evalAfterWrite: true,
  /** Evaluator 가 "이탈" 판정한 횟수가 N에 도달하면 강제 마무리 hint. */
  driftThreshold: 2,
} as const

/** 도구 결과 본문 축약 시 보존할 최대 글자 수 */
export const TOOL_RESULT_LIMITS = {
  /** Snip 단계 — 매우 오래된 결과는 0 으로 축소 */
  snipMaxChars: 0,
  /** Microcompact 단계 — head/tail 만 보존 */
  microcompactHead: 600,
  microcompactTail: 600,
} as const
