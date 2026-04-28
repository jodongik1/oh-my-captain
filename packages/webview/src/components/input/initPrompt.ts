// /init 슬래시 커맨드가 사용자 메시지로 전송하는 프롬프트.
// 에이전트가 프로젝트를 분석해 .captain/MEMORY.md 에 영구 저장하도록 지시한다.
//
// 자동 감지된 "프로젝트 스택" 섹션이 시스템 프롬프트에 이미 들어가 있으므로,
// 여기서는 LLM 만 추출 가능한 의미적 정보(README 요약 / 모듈 책임 / 컨벤션)에 집중시킨다.

export const INIT_PROMPT = `[/init] 이 프로젝트의 핵심 메타정보를 \`.captain/MEMORY.md\` 에 영구 저장하세요.

이미 시스템 프롬프트의 "프로젝트 스택" 섹션에 빌드 도구/테스트 프레임워크/명령어는 자동 감지되어 있으니, 그건 다시 적지 말고 다음 *의미적 정보*에 집중하세요:

1. **프로젝트 한 줄 요약** — README 에서 추출한 목적·도메인 (1~2문장)
2. **모듈 / 디렉토리 구조** — 모노레포면 패키지별 책임, 단일 레포면 핵심 디렉토리의 역할
3. **컨벤션** — 테스트 위치·파일 네이밍, import 스타일, 폴더 구조 규칙 등 *코드를 읽어 관찰 가능한 것만*
4. **위험·주의** — \`.editorconfig\`, \`.nvmrc\`, \`CONTRIBUTING.md\`, \`CHANGELOG.md\` 에서 발견한 함정 (특정 노드 버전 강제, 마이그레이션 정책 등)

수집 절차:
- **첫 turn**: \`glob_tool\` + \`read_file\` 을 병렬로 호출해 README.md, CONTRIBUTING.md, .editorconfig, .nvmrc, tsconfig*.json, **모노레포라면 packages/*/package.json 또는 그 등가물** 등 메타파일을 동시에 읽기
- **둘째 turn (필요시)**: \`list_dir\` 로 top-level 구조 또는 \`grep_tool\` 로 핵심 패턴 확인
- **마지막**: \`save_memory\` 도구를 호출해 위 4개 항목을 markdown 으로 정리해 저장. category 는 'architecture' 또는 'convention' 중 적절히 선택.

저장 후 사용자에게 **무엇을 저장했는지 한 단락(3~5줄)** 으로 보고하세요. 본문에 코드 블록은 자제하고 핵심만.`
