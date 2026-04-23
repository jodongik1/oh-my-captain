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
 * @param rawPath  LLM이 제공한 경로 (상대 또는 절대)
 * @param projectRoot  허용된 최상위 디렉토리
 * @returns 정규화된 절대 경로
 * @throws Error  경로가 projectRoot 밖인 경우
 */
export function resolveSecurePath(rawPath: string, projectRoot: string): string {
  const absPath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(projectRoot, rawPath)
  const normalizedRoot = resolve(projectRoot)

  if (!absPath.startsWith(normalizedRoot + '/') && absPath !== normalizedRoot) {
    throw new Error(
      `보안 위반: 경로 '${rawPath}'는 프로젝트 루트(${projectRoot}) 밖에 있습니다. ` +
      `프로젝트 내부 경로만 접근할 수 있습니다.`
    )
  }

  return absPath
}
