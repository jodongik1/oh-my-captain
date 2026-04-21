/**
 * 프로젝트 경로 해석 유틸리티.
 *
 * 도구(tool) 구현에서 반복되는 "상대경로 → 절대경로" 변환 패턴을 공통화합니다.
 */

import { join, isAbsolute } from 'path'
import type { HostAdapter } from '../host/interface.js'

/**
 * 주어진 경로가 절대 경로면 그대로 반환하고,
 * 상대 경로면 프로젝트 루트를 기준으로 절대 경로로 변환합니다.
 */
export function resolveProjectPath(host: HostAdapter, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(host.getProjectRoot(), filePath)
}
