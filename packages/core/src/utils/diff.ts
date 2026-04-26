import { createTwoFilesPatch } from 'diff'

/**
 * 두 파일 내용의 unified diff를 생성합니다.
 * 새 파일인 경우 oldContent를 빈 문자열로 전달하세요.
 */
export function generateUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string
): string {
  const fileName = filePath.split('/').pop() || filePath
  return createTwoFilesPatch(
    fileName,
    fileName,
    oldContent,
    newContent,
    '', '',
    { context: 3 }
  )
}
