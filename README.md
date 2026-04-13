# Oh My Captain

> **IntelliJ IDE를 위한 로컬 AI 코딩 에이전트**  
> Ollama, OpenAI, Anthropic 연동 — IDE 안에서 모든 것이 동작합니다.

![Plugin Version](https://img.shields.io/badge/version-0.1.0-blue)
![IntelliJ Platform](https://img.shields.io/badge/IntelliJ-2025.1%2B-orange)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## 소개

Oh My Captain은 IntelliJ IDEA에 완전한 AI 코딩 에이전트를 내장한 플러그인입니다.  
단순 자동완성이나 채팅 도구와 달리, Captain은 **파일 읽기·쓰기, 터미널 명령어 실행**을 자율적으로 수행하며 각 단계의 추론 과정을 실시간으로 스트리밍합니다.

```
┌──────────────────────────────────────────────────────┐
│  IntelliJ 플러그인 (Kotlin)                           │
│  툴 윈도우 · JBCef 웹뷰 · PSI 컨텍스트 수집          │
└────────────────────┬─────────────────────────────────┘
                     │  Stdio IPC (NDJSON)
┌────────────────────▼─────────────────────────────────┐
│  코어 에이전트 (TypeScript / Node.js)                 │
│  ReAct 루프 · LLM 프로바이더 · 도구 레지스트리        │
└────────────────────┬─────────────────────────────────┘
                     │  JBCef JS 브리지
┌────────────────────▼─────────────────────────────────┐
│  채팅 UI (React + Vite)                              │
│  타임라인 · 설정 · 세션 히스토리                     │
└──────────────────────────────────────────────────────┘
```

---

## 주요 기능

### 🤖 에이전트 루프
- ReAct(Reason + Act) 방식으로 최대 20 iteration 자율 실행
- LLM 응답을 토큰 단위로 실시간 스트리밍
- 컨텍스트 윈도우 자동 관리 (truncation + 요약 압축)

### 🛠️ 내장 도구
| 도구 | 설명 |
|---|---|
| `read_file` | 프로젝트 내 모든 파일 읽기 |
| `write_file` | 파일 생성 또는 덮어쓰기 |
| `run_terminal` | 셸 명령어 실행 (stdout/stderr 캡처) |

### 🔒 권한 모드
| 모드 | 동작 |
|---|---|
| **Ask before edits** | 파일 쓰기·터미널 실행 전 매번 승인 다이얼로그 표시 |
| **Edit automatically** | 승인 없이 자동 실행 |
| **Plan mode** | 읽기 전용 탐색 후 실행 계획 제시 |

### 🎯 코드 액션
에디터에서 코드를 우클릭하면 다음 액션을 바로 실행할 수 있습니다:
- **코드 설명** — 선택한 코드를 자연어로 설명
- **코드 리뷰** — 코드 품질 및 개선점 검토
- **변경 영향 분석** — 수정 시 영향을 받는 코드 파악
- **쿼리 검증** — SQL 쿼리 정확성 검사
- **코드 개선** — 리팩터링 제안
- **테스트 생성** — 유닛 테스트 자동 작성

### 🧠 LLM 프로바이더
- **Ollama** (로컬, 기본값) — `qwen`, `llama`, `codestral` 등 모든 모델 지원
- **OpenAI** — GPT-4o, GPT-4-turbo 및 OpenAI 호환 엔드포인트
- **Anthropic** — Claude 3.5 Sonnet, Claude 3 Opus (Extended Thinking 지원)

### 💬 세션 관리
- 대화 히스토리를 `~/.omc/sessions.db`에 영구 저장
- 세션 목록 조회, 이름 변경, 삭제 기능
- 대화 내용 기반 세션 제목 자동 생성

---

## 시스템 요구사항

| 항목 | 최소 버전 |
|---|---|
| IntelliJ IDEA (Community 또는 Ultimate) | 2025.1+ |
| Java (Gradle 빌드용) | 17+ |
| Node.js | 20+ |
| pnpm | 8+ |

> **LLM 백엔드**: Ollama(로컬), OpenAI API 키, Anthropic API 키 중 하나 이상 필요

---

## 시작하기

### 1. 저장소 클론

```bash
git clone https://github.com/your-org/oh-my-captain.git
cd oh-my-captain
```

### 2. 빌드 및 실행

```bash
# 전체 빌드 + IntelliJ 실행 (기본)
./build-and-run.sh

# 개별 실행
./build-and-run.sh build    # 빌드만 (Core + Webview)
./build-and-run.sh run      # IntelliJ만 실행 (이전 빌드 사용)
./build-and-run.sh core     # Core만 빌드
./build-and-run.sh webview  # Webview만 빌드
./build-and-run.sh clean    # 빌드 산출물 삭제
```

스크립트가 자동으로 수행하는 작업:
1. `pnpm install`로 Node.js 의존성 설치
2. `esbuild`로 TypeScript 코어 번들링
3. `Vite`로 React 웹뷰 빌드
4. Gradle `runIde`로 샌드박스 IntelliJ 실행

### 3. 프로바이더 설정

최초 실행 시 프로바이더 설정 화면이 표시됩니다.

**Ollama (로컬 실행 권장)**
```bash
# Ollama 설치
brew install ollama

# 모델 다운로드
ollama pull qwen2.5-coder:7b

# 서버 시작
ollama serve
```

설정 패널에서 Base URL을 `http://localhost:11434`로 입력하고 모델을 선택하면 됩니다.

---

## 프로젝트 구조

```
oh-my-captain/
├── build-and-run.sh              # 빌드 & 실행 스크립트
├── package.json                  # pnpm 워크스페이스 루트
├── pnpm-workspace.yaml
│
├── hosts/
│   └── intellij/                 # Kotlin IntelliJ 플러그인
│       ├── build.gradle.kts
│       ├── gradle.properties     # 플러그인 버전 및 플랫폼 설정
│       └── src/main/kotlin/com/ohmycaptain/
│           ├── actions/          # 에디터 우클릭 메뉴 액션
│           ├── bridge/           # JBCef ↔ Core 메시지 브리지
│           ├── core/             # Node.js 프로세스 생명주기 관리
│           ├── ipc/              # Stdio NDJSON 클라이언트
│           ├── psi/              # IntelliJ PSI 컨텍스트 수집
│           ├── settings/         # 플러그인 설정 영속화
│           └── ui/               # 툴 윈도우, 승인 다이얼로그
│
└── packages/
    ├── core/                     # TypeScript 에이전트 코어 (Node.js)
    │   └── src/
    │       ├── main.ts           # IPC 서버 + 전체 메시지 핸들러
    │       ├── agent/            # ReAct 루프, 컨텍스트, 압축기
    │       ├── providers/        # Ollama, OpenAI, Anthropic
    │       ├── tools/            # 도구 레지스트리 + 구현체
    │       ├── ipc/              # 프로토콜 타입, Stdio 서버
    │       ├── host/             # HostAdapter 인터페이스 + IPC 구현
    │       ├── settings/         # 설정 타입 + 파일 관리자
    │       ├── db/               # SQLite 세션 저장소
    │       └── actions/          # 코드 액션 핸들러 + 프롬프트
    │
    └── webview/                  # React + Vite 채팅 UI
        └── src/
            ├── App.tsx           # 루트: 호스트 메시지 라우팅
            ├── store.ts          # 전역 상태 (useReducer)
            ├── bridge/           # JBCef postMessage 브리지
            └── components/
                ├── timeline/     # StreamRow, ToolRow, BashRow ...
                ├── settings/     # 설정 패널
                └── ...           # 헤더, 입력창, 히스토리, 모드 ...
```

---

## 개발 가이드

### 개별 패키지 빌드

```bash
# Core만 빌드 (TypeScript → esbuild 번들)
./build-and-run.sh core

# Webview만 빌드 (Vite)
./build-and-run.sh webview

# Webview hot-reload 개발 서버 (포트 5173)
pnpm --filter @omc/webview dev
# IDE 실행 시: JAVA_TOOL_OPTIONS="-Domc.dev=true" ./build-and-run.sh run
```

### IPC 프로토콜

Kotlin과 Node.js 간 통신은 **Stdio NDJSON** 방식을 사용합니다 (한 줄 = JSON 객체 하나).

```
IntelliJ → Core : init | user_message | abort | settings_get | ...
Core → IntelliJ : stream_chunk | stream_end | tool_start | tool_result | error | ...
```

전체 타입 정의는 [`packages/core/src/ipc/protocol.ts`](packages/core/src/ipc/protocol.ts)를 참고하세요.

### 런타임 데이터

사용자 설정과 세션 히스토리는 `~/.omc/`에 저장됩니다:

```
~/.omc/
├── settings.json     # 프로바이더 설정, 모델 선택
├── sessions.db       # SQLite: 대화 히스토리
└── logs/             # 에이전트 stderr 로그
```

---

## 설정

설정은 `~/.omc/settings.json`에 저장되며, 플러그인 설정 패널(`/settings` 커맨드 또는 설정 아이콘)에서 수정할 수 있습니다.

```json
{
  "provider": {
    "provider": "ollama",
    "ollamaBaseUrl": "http://localhost:11434",
    "ollamaModel": "qwen2.5-coder:7b",
    "openAiApiKey": "",
    "openAiModel": "gpt-4o",
    "anthropicApiKey": "",
    "anthropicModel": "claude-sonnet-4-5"
  },
  "model": {
    "contextWindow": 32768,
    "requestTimeoutMs": 120000
  }
}
```

### 프로젝트 규칙 파일

프로젝트 루트에 `.captain/rules.md`를 생성하면 Captain에게 프로젝트 전용 지침을 제공할 수 있습니다:

```markdown
# 프로젝트 규칙

- 새 함수에는 반드시 테스트를 작성한다
- 콜백 대신 Kotlin 코루틴을 사용한다
- 기존 패키지 구조를 유지한다
```

---

## 슬래시 커맨드

입력창에 `/`를 입력하면 사용 가능한 커맨드 목록이 표시됩니다:

| 커맨드 | 설명 |
|---|---|
| `/clear` | 현재 대화 초기화 |
| `/new` | 새 세션 시작 |
| `/explain` | 열린 파일 코드 설명 |
| `/review` | 코드 품질 리뷰 |
| `/improve` | 코드 개선 제안 |
| `/test` | 유닛 테스트 생성 |
| `/model` | LLM 모델 전환 |
| `/settings` | 설정 패널 열기 |

---

## 로드맵

- [ ] **@-mention 파일 참조** — `@src/Main.kt` 입력으로 특정 파일을 컨텍스트에 명시적 포함
- [ ] **Native Diff Viewer** — IntelliJ 내장 Diff UI로 파일 변경 사항 Accept/Reject
- [ ] **Plan Mode 개선** — 진정한 읽기 전용 탐색 + 원클릭 계획 실행
- [ ] **/compact 커맨드** — 수동 컨텍스트 압축으로 토큰 공간 확보
- [ ] **Git 워크플로우** — `/commit`, `/pr` 자동화
- [ ] **이미지 입력** — 스크린샷 붙여넣기로 UI 분석

---

## 기여하기

1. 저장소를 Fork합니다
2. 기능 브랜치를 생성합니다: `git checkout -b feat/my-feature`
3. 변경 후 `./build-and-run.sh`로 테스트합니다
4. Pull Request를 오픈합니다

---

## 라이선스

MIT © Oh My Captain Contributors
