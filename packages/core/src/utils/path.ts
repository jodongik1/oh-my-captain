/**
 * 경로 보안 유틸리티.
 *
 * LLM이 생성한 경로가 프로젝트 루트 밖을 가리키는 경우(Path Traversal)를 방지합니다.
 * 모든 파일 I/O 도구에서 경로 해석 시 이 함수를 사용해야 합니다.
 */

import { resolve, isAbsolute } from 'path'

/**
 * 주어진 경로를 절대 경로로 해석하되, projectRoot 밖이면 에러를 던집니다.
 *
 * 복구 시나리오:
 * - LLM 이 멘션 텍스트(`@src/foo.ts`) 의 `@` 를 떼면서 절대경로처럼 `/src/foo.ts` 로 보낼 수 있음
 *   → 이런 경우 leading `/` 를 떼고 root-relative 로 재해석하여 프로젝트 내부에 있으면 허용
 * - LLM 이 path 자체에 `@` prefix 를 남겨둔 경우도 자동 정리
 *
 * @param rawPath  LLM이 제공한 경로 (상대 또는 절대)
 * @param projectRoot  허용된 최상위 디렉토리
 * @returns 정규화된 절대 경로
 * @throws Error  복구 시도 후에도 projectRoot 밖인 경우
 */
export function resolveSecurePath(rawPath: string, projectRoot: string): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('경로가 비어 있거나 유효하지 않습니다.')
  }

  // 1) 멘션 prefix(`@`) 가 남아있으면 정리 (LLM 이 텍스트를 그대로 path 로 보낸 경우)
  const cleaned = rawPath.replace(/^@+/, '').trim()

  // 2) 1차 해석
  const absPath = isAbsolute(cleaned) ? resolve(cleaned) : resolve(projectRoot, cleaned)
  const normalizedRoot = resolve(projectRoot)

  if (absPath === normalizedRoot || absPath.startsWith(normalizedRoot + '/')) {
    return absPath
  }

  // 3) 1차 해석이 프로젝트 밖일 때 — leading `/` 만 붙은 root-relative 경로일 가능성 검사.
  //    예: LLM 이 `/src/foo.ts` 를 보냈는데 실제로는 프로젝트 내부 `src/foo.ts` 를 의미한 경우.
  if (cleaned.startsWith('/')) {
    const stripped = cleaned.replace(/^\/+/, '')
    const recovered = resolve(projectRoot, stripped)
    if (recovered === normalizedRoot || recovered.startsWith(normalizedRoot + '/')) {
      return recovered
    }
  }

  throw new Error(
    `경로 '${rawPath}' 는 프로젝트 루트(${projectRoot}) 밖에 있습니다. ` +
    `프로젝트 루트 기준 상대 경로(예: 'src/main/...')로 다시 시도해 주세요.`
  )
}
