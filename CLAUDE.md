# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 본 저장소는 한국어 위주로 운영됩니다. 코드 코멘트·시스템 프롬프트·로그 메시지가 모두 한국어이며, 응답도 한국어로 작성하세요.

## 빌드 / 실행 / 테스트

`./build.sh`가 모든 빌드·실행 작업의 진입점입니다. pnpm workspace + Gradle을 직접 호출하지 말고 가능하면 build.sh의 서브커맨드를 사용하세요.

| 목적 | 명령 |
|---|---|
| 전체 빌드 후 IntelliJ 실행 | `./build.sh` |
| IntelliJ 개발 모드(Vite HMR + esbuild watch + runIde) | `./build.sh dev` |
| Core만 / Webview만 빌드 | `./build.sh core` / `./build.sh webview` |
| IntelliJ 빌드 결과로 실행만 | `./build.sh run` |
| IntelliJ 배포 zip 생성 | `./build.sh dist` |
| sandbox `idea.log` tail | `./build.sh logs` (OMC 로그는 `\| grep OMC` 권장) |
| VS Code 전체 빌드 (core+webview+extension) | `./build.sh vscode` |
| VS Code 개발 모드(Vite + Core watch + extension watch + Dev Host) | `./build.sh vscode:dev` |
| VS Code Extension Development Host 실행만 | `./build.sh vscode:run` |
| VS Code `.vsix` 패키징 | `./build.sh vscode:dist` |
| 산출물 정리 (IntelliJ + VS Code) | `./build.sh clean` |

루트 스크립트(`pnpm run ...`):
- 타입체크: `pnpm type-check` (모든 패키지에 `tsc --noEmit`)
- 테스트 전체: `pnpm test:run` (vitest run, 모든 워크스페이스)
- 코어만 테스트: `pnpm -C packages/core test:run`
- 단일 파일: `pnpm -C packages/core exec vitest run src/agent/__tests__/loop.test.ts`
- 단일 케이스(이름 패턴): `... vitest run -t "공백 변형"`
- 린트/포맷: `pnpm lint`, `pnpm format`

IntelliJ 측 Kotlin 단위 테스트는 `(cd hosts/intellij && ./gradlew test)` — JUnit 5 Platform.

**중요**: `packages/core` 변경 시 IntelliJ가 새 코드를 사용하려면 반드시 `./build.sh core` 또는 `dev` 모드로 esbuild 번들을 `hosts/intellij/src/main/resources/core`에 다시 떨궈야 합니다. core 소스만 수정하고 IDE를 다시 띄우면 옛 번들이 도는 함정에 빠집니다. VS Code 호스트는 `./build.sh vscode` 명령이 IntelliJ 산출물(`hosts/intellij/src/main/resources/{core,webview}`)을 `hosts/vscode/resources/{core,webview}`로 **미러링**해서 사용합니다 — 즉 VS Code만 띄우려 해도 IntelliJ용 core/webview 빌드가 선행되어야 합니다(`vscode` 서브커맨드는 자동으로 함께 호출).

## 아키텍처 — 3-tier 분리 + IPC

```
Host (IntelliJ Kotlin │ VS Code Node)         Webview (React)
   ├─ Bridge (JBCEF │ vscode.Webview)  ◀──postMessage──▶ src/bridge/*
   └─ IpcClient (Node 자식 프로세스 spawn + stdin/stdout)
            │
            ▼ JSON line IPC (@omc/protocol 정의)
       Core (Node, TypeScript)
       ├─ ipc/server.ts          ─ 라우팅
       ├─ agent/loop.ts          ─ ReAct 루프
       ├─ providers/{anthropic,openai,ollama}.ts
       ├─ tools/                 ─ read_file/edit_file/run_terminal/...
       └─ db/session.ts          ─ SQLite 세션 영속화
                │
                ▼
         LLM API (Anthropic / OpenAI / Ollama)
```

핵심 사실:
- **Host가 Core를 spawn**: 두 호스트(`hosts/intellij` Kotlin, `hosts/vscode` TypeScript)가 각각 `node <bundled core>`를 자식 프로세스로 띄우고 stdin/stdout으로 JSON line IPC를 한다. UI(React)는 호스트 IDE 안의 webview(JBCEFBridge / VS Code Webview API)로 떠 있는 별도 컨텍스트. Host는 둘 사이의 router.
- **두 호스트가 동일 core·동일 webview 산출물을 공유**: VS Code 호스트의 `resources/{core,webview}`는 IntelliJ 빌드 산출물의 미러. core/webview 패키지는 호스트를 모름 — 호스트별 차이는 `hosts/<host>/src` 전체에만 격리되어 있다.
- **모든 IPC 메시지 타입은 `packages/protocol`에서 단일 정의**. core/webview/host가 모두 import해서 컴파일 타임에 일치 보장.
- **Webview는 호스트 IDE 플러그인의 일부지만 코드는 React/Vite로 독립 빌드**. 산출물이 `hosts/intellij/src/main/resources/webview`(VS Code는 미러)로 떨어진다.
- **`state.history`(LLM 컨텍스트) ≠ `timeline`(화면 시각)**. core 는 `Message[]` 형식 history 를 LLM 에 보내고, webview 는 `TimelineEntry[]` 를 그린다. 영속화 경로도 분리 — sessionDb 의 `messages.payload` JSON 컬럼이 thinking/toolCalls/toolCallId/attachments 를 함께 보관해 세션 재개 시 *둘 다* 복원한다 (legacy row=`payload IS NULL` 은 단순 user/stream 으로 폴백). 이 분리 덕에 `!cmd` 같은 LLM 우회 흐름은 history 에만 누적되고 sessionDb 는 비워둘 수 있다.

## ReAct 에이전트 루프 (`packages/core/src/agent/loop.ts`)

매 turn 4단계: **Reason → Act → Observe → Evaluate(optional)**. 종료 조건과 안전망이 분산되어 있으므로 loop.ts를 직접 수정하기 전에 흐름을 이해할 것:

1. **Reason**: 컨텍스트 압축(`compactor.ts`) → `provider.stream()` 호출. 응답에 `thinking`, `content`, `tool_calls`가 들어옴.
2. **Act**: `validator.ts`로 pre-flight 검증 → `tools/registry.ts`의 dispatcher가 도구 실행. `concurrencySafe` 도구는 병렬, 그 외는 직렬.
3. **Observe**: `observer.ts`가 직접 환경 측정(파일 존재, exit code 등)해 system 메시지 주입. 도구 보고와 어긋나면 Observation을 진실로 간주하라는 규율이 시스템 프롬프트에 있음.
4. **Evaluate** (sparse): `evaluator.ts`가 별도 LLM 호출로 drift/done 판정.

종료는 자연 종료(도구 호출 없음) / abort / max iteration / 동일 에러 N회 / Auto Verify 실패 / Evaluator force 중 하나.

`runLoop()` 은 `RunLoopResult` 에 `persistedTurn[]` 을 함께 반환한다 — 한 turn 의 assistant/tool 행 시퀀스(thinking·tool_calls·tool_call_id 메타 동봉). chat handler 가 이걸 받아 sessionDb 에 한 행씩 저장하고, 재개 시 `getSessionMessages` 가 동일 시퀀스로 복원해 LLM 컨텍스트와 timeline 을 모두 살린다. 즉 *영속화 단위는 메시지가 아니라 turn 의 시퀀스*.

또한 turn 도중 사용자 입력을 끼워넣는 steering 경로는 제거되었다 — `isBusy=true` 동안 webview 가 send 를 차단하고 Stop 버튼만 노출한다. 이는 PersistedTurn 시퀀스의 결정성과 짝을 이룬다.

## Provider 계층의 핵심 비-자명한 동작

`packages/core/src/providers/`의 세 provider는 표면적으로 동일한 인터페이스(`stream(messages, tools, onChunk)`)지만 내부 동작이 다르며, 그 차이가 여러 회귀의 원인이 되어 왔습니다.

- **Stream processor 분리** (`stream_processor.ts`):
  - `BasicStreamProcessor` — Anthropic/OpenAI용. native tool_use를 신뢰하지만 모델이 가끔 텍스트로 `<function=...>` XML을 흘리는 사고에 대비해 `TextToolCallFilter`도 함께 통과시킨다. `extractedToolCalls`는 의도적으로 빈 배열(native와 중복 dispatch 방지).
  - `XmlFilteringStreamProcessor` — Ollama용. 모델이 native tool_calls를 못 줄 때 텍스트 XML에서 도구 호출을 추출하는 폴백을 노출.
- **Thinking 태그 처리** (`thinking_tag_filter.ts`): `<thinking>...</thinking>`은 UI 채널과 분리. 시스템 프롬프트가 도구 호출 turn에 한해서만 thinking을 강제. 답변 본문이 비고 thinking에만 내용이 있으면 `sanitizeContent`가 자동 폴백 promotion + loop가 빈 말풍선 방지용 1회 emit.
- **Tool 정의 형식**은 `tools/registry.ts`의 `ToolDefinition` 단일 형식이고, 각 provider가 자기 SDK에 맞게 변환. 새 도구 추가는 `tools/`에 파일 + `registry.ts` 등록만 하면 모든 provider에 자동 노출.

## 시스템 프롬프트와 컨텍스트 주입 (`packages/core/src/agent/context.ts`)

매 세션 시작 시 다음이 자동으로 시스템 프롬프트에 합쳐집니다 (`prompts/system_prompt.md` 템플릿):

- `{{projectStackSection}}` — `project_stack.ts`가 manifest(pom.xml/build.gradle*/package.json/Cargo.toml/go.mod/pyproject.toml)를 스캔해 빌드도구·언어·테스트 프레임워크·테스트 명령을 자동 주입. 토큰 비용 0, 결정적.
- `{{rulesSection}}` — `<projectRoot>/.captain/rules.md` (사용자 손편집).
- `{{memorySection}}` — `<projectRoot>/.captain/MEMORY.md` (에이전트가 `save_memory` 도구로 자율 저장 + `/init` 슬래시 커맨드로 부트스트랩).

세 layer가 겹쳐 작동: **자동 감지(코드)** + **에이전트 학습(memory)** + **사용자 손편집(rules)**. 새 메타정보를 추가할 때 어느 layer가 맞는지 먼저 판단하세요 — 결정적·기계 추출 가능한 정보는 자동 감지(`project_stack.ts`)에 추가, 의미적 정보는 `/init`이 채우게 두거나 rules.md에 사용자가 직접.

## 모드 (plan / ask / auto)

UI에서 사용자가 선택하는 mode가 도구 권한과 시스템 프롬프트의 `{{modeInstructions}}`에 영향을 줍니다(`context.ts:MODE_INSTRUCTIONS`). plan은 읽기·탐색만 허용하고 write 도구는 차단, ask는 write 시 사용자 승인, auto는 무승인. 도구 카테고리(read/write/exec)에 따라 `permissions.ts`가 mode와 cross check.

## 작업 시 주의

- **core 빌드 누락 함정**: 위 섹션 참고. `./build.sh core` 없이 IDE만 다시 띄우면 옛 번들이 돈다.
- **테스트 위치 컨벤션**: `packages/core/src/<area>/__tests__/<name>.test.ts`. vitest는 ESM이므로 import에 `.js` 확장자(TS 파일도) 필수.
- **로그 확인**: core stdout은 IPC 채널과 섞이므로 디버깅 로그는 `makeLogger`가 stderr 또는 IDE 로그로 흘림. UI 콘솔이 아닌 `./build.sh logs`로 확인.
- **시스템 프롬프트 수정**: `packages/core/src/agent/prompts/system_prompt.md`는 모델 행동의 1차 근거다. 변경 시 `loop.ts`/`evaluator.ts`/도구 디스패처와의 상호작용을 함께 검토.
- **gradle.properties 변경**: 플러그인 메타(이름·버전·플랫폼)는 `hosts/intellij/gradle.properties`. `build.gradle.kts`의 하드코딩이 아니라 properties에서 읽음.
- **VS Code 미러링 함정**: `hosts/vscode/resources/{core,webview}`는 IntelliJ 빌드 산출물의 복사본일 뿐, 직접 편집해도 다음 `./build.sh vscode` 호출에 덮어쓰여 사라진다. core/webview는 항상 `packages/`에서만 수정.
- **`!cmd` 셸 직통은 휘발성**: webview 입력이 `!` 로 시작하면 `shell_exec` 핸들러(`ipc/handlers/shell.ts`) 가 LLM 을 거치지 않고 `run_terminal` 과 동일한 execa 백엔드로 직접 실행 — 결과를 `tool_start/tool_result` 채널로 emit 해 `BashRow` 가 자동 라우팅. **state.history 에는 user 메시지로 누적해 다음 LLM turn 컨텍스트로 들어가지만 sessionDb 는 건드리지 않으므로 세션 재개 시 사라진다**. 가드: 빈 명령·multi-line·hard-block 패턴(`rm -rf /` 등) 차단, plan 모드는 readonly 명령만 허용.
- **키바인딩은 *홈 디렉토리***: `~/.captain/keybindings.json` (프로젝트 `<root>/.captain/` 과 별개). `keybindings/manager.ts` 가 fs.watch 로 핫 리로드 → 자발적 `keybindings_loaded` push. webview 는 `core_ready` 시 한 번 fetch + watcher push 를 같이 받음. 매칭 표기는 `Cmd+Enter` 같은 modifier+key, macOS Cmd 와 Win/Linux Ctrl 은 별개로 매칭.
