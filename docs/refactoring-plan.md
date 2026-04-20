# Oh My Captain 프로젝트 구조 분석 및 개선 방향

## Context
사용자가 프로젝트 전반을 한눈에 파악하고, 잠재적 문제점과 개선 방향에 대한 코멘트를 요청함. 본 문서는 실제 코드 수정 계획이 아니라 **진단·개선 로드맵**이며, 이후 어떤 영역을 실제로 개선할지 선택하기 위한 기초 자료임.

---

## 1. 프로젝트 한눈에 보기

**Oh My Captain** — IntelliJ용 AI 코딩 어시스턴트 플러그인 (Claude Code 유사).

### 1.1 3층 모노레포 구조
```
oh-my-captain/
├── packages/
│   ├── core/          ← Node.js 에이전트 (LLM, 도구, IPC 서버)   [TS × 35]
│   └── webview/       ← React UI (타임라인, diff 뷰, 승인 플로우) [TS × 23]
└── hosts/
    └── intellij/      ← Kotlin 플러그인 셸 (JCEF 브릿지)
```
빌드 산출물이 `hosts/intellij/src/main/resources/{core,webview}`에 주입되어 플러그인으로 패키징됨.

### 1.2 런타임 데이터 흐름
```
[IntelliJ(Kotlin)] ⇄ JCEF ⇄ [Webview(React)]
                                  │
                                  ▼ NDJSON stdio
                          [Core(Node.js)]
                                  ├── Providers: Anthropic / OpenAI / Ollama
                                  ├── Tools(13개): read/write/edit/grep/…
                                  ├── Agent Loop + 3-Tier Compactor
                                  └── SQLite(~/.oh-my-captain/sessions.db)
```

### 1.3 기술 스택 요약
| 레이어 | 스택 |
|---|---|
| Core | TypeScript 5.7, esbuild, better-sqlite3, tree-sitter, pino |
| Webview | React 18, Vite 6, useReducer, react-markdown, syntax-highlighter |
| Host | Kotlin, Gradle, IntelliJ Platform, JCEF |
| 통신 | Stdio + NDJSON (IPC 메시지 ~20종) |

### 1.4 핵심 기능이 사는 곳
| 기능 | 위치 |
|---|---|
| Agent Loop (LLM↔Tool 사이클) | [packages/core/src/agent/loop.ts](packages/core/src/agent/loop.ts) |
| 3-Tier 컨텍스트 압축 | [packages/core/src/agent/compactor.ts](packages/core/src/agent/compactor.ts) |
| IPC 서버·프로토콜 | [packages/core/src/ipc/server.ts](packages/core/src/ipc/server.ts), [protocol.ts](packages/core/src/ipc/protocol.ts) |
| 도구 레지스트리 | [packages/core/src/tools/registry.ts](packages/core/src/tools/registry.ts) |
| 타임라인 UI | [packages/webview/src/components/Timeline.tsx](packages/webview/src/components/Timeline.tsx) + [timeline/*](packages/webview/src/components/timeline/) |
| Diff 승인 플로우 | [ApprovalRow.tsx](packages/webview/src/components/timeline/ApprovalRow.tsx), [DiffView.tsx](packages/webview/src/components/timeline/DiffView.tsx) |
| 전역 상태 | [packages/webview/src/store.ts](packages/webview/src/store.ts) |

---

## 2. 발견된 문제점 (중요도 순)

### 🔴 H1. 테스트/CI 완전 부재
> **🟡 진행 중** — Step 1(vitest 테스트 하네스) ✅ / Step 2(ESLint+Prettier) ✅ / Step 3(GitHub Actions CI) 대기. 자세한 변경 내역은 §7 참조.

- 테스트 파일 0개, ESLint·Prettier·GitHub Actions 모두 없음.
- Agent Loop·edit_file처럼 **부작용이 큰 핵심 로직**을 수동 검증에 의존.
- 회귀 위험이 가장 큰 리스크.

### 🔴 H2. God files — 책임 과밀
> **🟡 진행 중** — Step 1(main.ts 분할) ✅ · Step 2(App.tsx useIpcMessageHandler) ✅ 2026-04-21 완료. 나머지 3개 파일(store.ts / loop.ts / edit_file.ts)은 후속 작업. 자세한 변경 내역은 §7 참조.

| 파일 | 라인 | 증상 |
|---|---|---|
| ~~[packages/core/src/main.ts](packages/core/src/main.ts)~~ | ~~339~~ → 43 | ✅ ipc/handlers/* 9개 파일로 분할 완료 |
| [packages/webview/src/store.ts](packages/webview/src/store.ts) | 380 | 21+ 액션을 한 reducer가 처리 |
| ~~[packages/webview/src/App.tsx](packages/webview/src/App.tsx)~~ | ~~316~~ → 173 | ✅ 144줄 useEffect → useIpcMessageHandler() 훅 + handlers.ts 분리 완료 |
| [packages/core/src/tools/edit_file.ts](packages/core/src/tools/edit_file.ts) | 338 | 편집 + 캐시 검증 + 정규화 폴백 + 진단이 한 파일에 섞임 |
| [packages/core/src/agent/loop.ts](packages/core/src/agent/loop.ts) | 315 | 루프·타임아웃·스티어링·도구 디스패치 혼재 |

### 🟡 M1. Provider 중복 (DRY 위반)
[anthropic.ts](packages/core/src/providers/anthropic.ts) / [openai.ts](packages/core/src/providers/openai.ts) / [ollama.ts](packages/core/src/providers/ollama.ts) 세 파일이 **타임아웃 signal 합성, abort 처리, 메시지 변환 try-catch 뼈대**를 거의 동일하게 반복. → `BaseProvider` 추상화 필요.

### 🟡 M2. 타입 경계의 `any` 누출 (18곳)
특히 IPC payload 경계에서 `as any` 캐스팅이 반복됨.
- [App.tsx:94,104,110,141](packages/webview/src/App.tsx#L94) — IPC 수신 payload 캐스팅
- [store.ts:60,86](packages/webview/src/store.ts#L60) — `settings: any | null` (CaptainSettings 미사용)
- [Timeline.tsx:57,95-96,103,122](packages/webview/src/components/Timeline.tsx#L57) — entry 내부 필드 캐스팅
- [ollama.ts:47,75,86-89](packages/core/src/providers/ollama.ts#L47) — 외부 SDK 응답
- `protocol.ts`에 이미 타입이 있음에도 **수신측에서 unknown→any로 떨어뜨려 쓰는 패턴**이 반복됨 → Webview에 판별 유니온 + type guard 도입 필요.

### 🟡 M3. 타임라인 렌더링 성능 리스크
- [Timeline.tsx:43-129](packages/webview/src/components/Timeline.tsx#L43)가 entry map 안에서 if-chain 9개로 dot 상태 재계산 + 재렌더링마다 모든 자식 재평가.
- `React.memo`·`useMemo`·row 단위 메모이제이션 없음.
- 긴 세션이 쌓이면 스크롤/입력 지연이 누적될 수 있음. 가상화는 아직 불필요하지만 memo는 우선.

### 🟡 M4. 에러 경계 부재
- Webview에 **React ErrorBoundary 없음**. JCEF 내부에서 렌더 오류 시 블랭크 화면으로 떨어질 수 있음.
- Core에서는 try-catch가 140곳에 고르게 있으나 일부는 `catch(err: any)` + log only. 사용자에게 전파되지 않는 무성 실패가 있을 수 있음.

### 🟢 L1. 디버그 로깅 잔존
- [App.tsx:142](packages/webview/src/App.tsx#L142), [InputConsole.tsx:71](packages/webview/src/components/InputConsole.tsx#L71), [SettingsPanel.tsx:92,94](packages/webview/src/components/settings/SettingsPanel.tsx#L92) 등에 `[REACT IPC DEBUG]` 류 console 로그가 남아있음.
- [ipc/server.ts:12-13](packages/core/src/ipc/server.ts#L12)의 `console.log = console.error` 리다이렉트는 **의도적**(stdout이 IPC 채널이라서 오염 방지) — 이건 유지.
- DEBUG 플래그 기반 조건부 로깅으로 정리 필요.

### 🟢 L2. 빌드/배포 인프라 최소화
- [build.sh](build.sh)만으로 build/dist/clean 처리 — 동작은 함.
- 버저닝, 릴리즈 노트, 서명(JetBrains Marketplace) 흐름이 아직 없음. 플러그인을 외부 배포할 시점이 오면 필수.

---

## 3. 잘 된 점 (유지할 것)

- **아키텍처 경계가 명확**: Kotlin ↔ React ↔ Node.js가 stdio/NDJSON으로 느슨하게 결합되어 각 층 독립 교체 가능.
- **IPC 프로토콜이 타입으로 정의**됨 ([protocol.ts](packages/core/src/ipc/protocol.ts)) — 경계 개선 여지는 있으나 기반은 탄탄.
- **3-Tier 압축 / 스티어링 큐 / 병렬 도구 실행**은 본격 Agent의 필수 구성요소를 이미 갖춤.
- **시크릿 하드코딩 없음**, `.env*` / `*.local.json` gitignore 처리 양호.
- **주석은 한국어로 맥락 설명이 충실** (loop Tier 설명, edit_file 캐시 TTL 등).
- TypeScript `strict: true` + `noUnusedLocals/Parameters` 활성화, `@ts-ignore`/`@ts-nocheck` 없음.

---

## 4. 개선 로드맵 (권장 우선순위)

### Phase 1 — 기초 안전망 (가장 먼저)
1. ✅ **최소 테스트 하네스 구축** *(2026-04-20 완료)* — vitest 4.1.4 + [`TextToolCallFilter` 유닛 테스트 7개](packages/core/src/providers/__tests__/text_tool_call_filter.test.ts). `edit_file`·`compactor`·`registry`·`protocol` 직렬화 테스트는 후속 작업으로.
2. ✅ **ESLint + Prettier 설정** *(2026-04-20 완료)* — flat config([eslint.config.mjs](eslint.config.mjs)), warning 중심 정책(0 error / 63 warning). Prettier 67파일 일괄 포맷은 별도 PR로 분리 예정.
3. ⏳ **React ErrorBoundary** 추가 → [App.tsx](packages/webview/src/App.tsx) 루트에 래핑.

### Phase 2 — 구조 정리
4. ✅ **main.ts → ipc/handlers/* 분할** *(2026-04-21 완료)* — 339줄 main.ts를 43줄(부트스트랩 + 팩토리 와이어링)로 축소, 핸들러 9개 파일로 분리. 자세한 변경 내역은 §7 참조.
5. [App.tsx](packages/webview/src/App.tsx)의 144줄 useEffect → `useIpcMessageHandler()` 훅 + 메시지 타입별 서브핸들러로 분리.
6. IPC payload 타입 판별 유니온 + type guard로 **Webview쪽 `any` 전면 제거** (특히 [store.ts](packages/webview/src/store.ts) settings, [Timeline.tsx](packages/webview/src/components/Timeline.tsx) entry).

### Phase 3 — 품질·성능
7. `BaseProvider` 추상 클래스로 [providers/*](packages/core/src/providers/) 공통 로직 흡수 (timeout signal, abort, 공통 error shape).
8. Timeline row `React.memo` + dot 상태 `useMemo`.
9. [edit_file.ts](packages/core/src/tools/edit_file.ts)를 `edit_file.ts` / `edit_file_fallback.ts` / `match_diagnostics.ts`로 분리.
10. 디버그 `console.log` 조건부화 (`DEBUG` env 또는 설정 플래그).

### Phase 4 — 배포 인프라 (필요해질 때)
11. GitHub Actions — Core/Webview 빌드, 테스트, 타입체크.
12. 플러그인 zip 서명/버저닝, JetBrains Marketplace 배포 흐름.

---

## 5. 참고 지표
- Core TS 파일: 35 / Webview TS+TSX: 23 / 테스트: 0
- 300줄 이상 파일: 5개 (위 H2 표)
- `any` 출현: 18곳 / `@ts-ignore`: 0 / `TODO|FIXME|HACK`: 0
- try-catch: core 140곳 / webview ≈ 0 (UI는 상태로 전파)
- 종합 품질 점수(주관): **7.1 / 10** — 구조는 건강하나 규모 증가에 따른 국소 과밀 + 안전망 부재가 최대 리스크.

---

## 6. 다음 단계
본 문서는 분석 보고서이며 이 자체로는 코드를 수정하지 않음. 사용자가 어떤 Phase/항목부터 실제 작업할지 선택하면, 해당 항목 단위로 별도 실행 플랜을 작성해 진행.

---

## 7. 진행 현황

### 2026-04-20 · H1 Step 1 — vitest 테스트 하네스 도입 ✅
**추가**
- [packages/core/vitest.config.ts](packages/core/vitest.config.ts) — node 환경, `src/**/__tests__/**/*.test.ts` 패턴
- [packages/core/src/providers/__tests__/text_tool_call_filter.test.ts](packages/core/src/providers/__tests__/text_tool_call_filter.test.ts) — 7 시나리오

**수정**
- [packages/core/package.json](packages/core/package.json) — `vitest^4.1.4` devDep, `test` / `test:run` 스크립트
- [packages/core/tsconfig.json](packages/core/tsconfig.json) — `src/**/*.test.ts`·`src/**/__tests__/**` exclude
- [package.json](package.json) (루트) — `pnpm -r --if-present test` 래퍼

**검증**: `pnpm test:run` 7/7 통과, `pnpm build:all` 회귀 없음. 기존 `src/**` 코드 미변경.

---

### 2026-04-20 · H1 Step 2 — ESLint + Prettier 인프라 ✅
**추가**
- [eslint.config.mjs](eslint.config.mjs) — ESLint 9 flat config. core=node / webview=browser+React / tests=완화 정책 분리
- [.prettierrc.json](.prettierrc.json) — `semi:false, singleQuote, trailingComma:all, printWidth:100`
- [.prettierignore](.prettierignore) — 빌드 산출물·lock·`.captain/` 등 제외

**수정**
- [package.json](package.json) (루트) — devDep 9종(eslint 9 + typescript-eslint + react/react-hooks/react-refresh + prettier + eslint-config-prettier + globals), `lint` / `lint:fix` / `format` / `format:check` 스크립트

**정책 결정**
- ESLint 10 → 9로 다운그레이드: `eslint-plugin-react` peer dep 호환
- `@typescript-eslint/no-explicit-any`: **warn** (M2에서 error 전환)
- `no-console`: core만 warn (logger.ts는 의도적, 추후 예외 처리)
- Prettier 실제 포맷 적용은 이 PR 제외 — 67파일 대량 diff는 별도 "포맷 일괄 적용" PR로 분리

**현황**
- `pnpm lint`: **0 error / 63 warning** (any ~50, logger no-console 4, exhaustive-deps 1, unused 2)
- `pnpm format:check`: 67파일 차이
- `pnpm test:run`·`pnpm build:all` 회귀 없음

---

### 2026-04-21 · H2 Step 1 — main.ts IPC 핸들러 분할 ✅
**목적**: 13종 IPC 핸들러가 단일 파일에 등록되던 [packages/core/src/main.ts](packages/core/src/main.ts) 339줄을 책임별로 분할하고, settings 갱신 시 provider 재생성 로직 3곳 중복을 단일 진입점으로 통합.

**추가** — 모두 [packages/core/src/ipc/handlers/](packages/core/src/ipc/handlers/)
- [state.ts](packages/core/src/ipc/handlers/state.ts) — `CoreState` 인터페이스 + `createState()` 팩토리
- [provider_factory.ts](packages/core/src/ipc/handlers/provider_factory.ts) — `createProvider()` + `applySettings(state, next, opts)` 유틸 (3곳 중복 제거)
- [lifecycle.ts](packages/core/src/ipc/handlers/lifecycle.ts) — `init`, `mode_change`
- [chat.ts](packages/core/src/ipc/handlers/chat.ts) — `user_message`, `abort`
- [steering.ts](packages/core/src/ipc/handlers/steering.ts) — `steer_inject`, `steer_interrupt`
- [session.ts](packages/core/src/ipc/handlers/session.ts) — `session_select/new/list/delete/rename`
- [settings.ts](packages/core/src/ipc/handlers/settings.ts) — `settings_get`, `settings_update`
- [model.ts](packages/core/src/ipc/handlers/model.ts) — `connection_test`, `model_list`, `model_switch`
- [code_action.ts](packages/core/src/ipc/handlers/code_action.ts) — `code_action`
- [client_log.ts](packages/core/src/ipc/handlers/client_log.ts) — `client_log`

**수정**
- [packages/core/src/main.ts](packages/core/src/main.ts) — 339 → 43줄. 부트스트랩(프로세스 에러 핸들러 + 도구 side-effect import + `startServer`) + 핸들러 팩토리 호출만 남김.

**설계 결정**
- 팩토리 패턴 (`registerSessionHandlers(state)`) 선택 — 전역 state export 대비 테스트 주입 용이, DI 컨테이너 대비 추가 의존성 없음.
- `applySettings(state, next, { save, keepCachedModels })` 유틸 도입 — `settings_get` / `settings_update` / `model_switch` 3곳에 반복되던 "settings 덮어쓰기 → provider 재생성 → (옵션) 저장" 패턴 통합.
- M2(IPC payload type guard)는 범위 제외 — 별도 PR로 분리.

**검증**: `pnpm build:all` 통과 / `pnpm test:run` 7/7 통과 / `pnpm lint` 0 error · 63 warning (회귀 없음).

**현황**
- main.ts: 339 → **43줄** (-87%)
- 분리된 핸들러 파일: 평균 35줄, 최대 72줄(chat.ts)
- H2 나머지 4개 파일(store.ts / App.tsx / loop.ts / edit_file.ts)은 후속 작업.

---

### 대기
- **H1 Step 3 — GitHub Actions CI**: `.github/workflows/ci.yml`에서 install → build → test → lint 실행. 트리거는 PR·main push.
- **H2 Step 2 — store.ts slice 분리**: 21개 액션을 의미 단위(stream / session / settings / approval / ui 등) 순수 reducer 함수로 분리. 이번 PR의 팩토리 패턴과 유사한 접근.
- **H2 Step 3 — App.tsx useIpcMessageHandler() 훅 분리**: 144줄 useEffect를 메시지 타입별 핸들러로 쪼갬. M2 type guard와 함께 진행 가능.
- **후속(H1 범위 외)**: Prettier 67파일 일괄 포맷 PR, webview 테스트 하네스, `edit_file`·`compactor` 통합 테스트.

---

### 참고 — 실행 계획 보관
각 Step의 상세 실행 계획은 `~/.claude/plans/*.md`에 세션별로 기록됨. 최신 H2 Step 1 계획: `~/.claude/plans/h1-staged-nest.md`.
