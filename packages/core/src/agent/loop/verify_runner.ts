/**
 * Auto Verify — write 도구 사용 직후 빌드/타입체크/lint 를 실행해 결과를 LLM 에 피드백.
 *
 * "환경 피드백의 강제" 원칙을 검증 단계까지 확장한 모듈.
 * verifier.ts (실제 명령 실행) 위에 얇게 얹은 상태머신 — 반복 실패 추적과 hint/break 결정만 담당.
 */

import { runAutoVerify, verifySignature } from '../verifier.js'
import type { HostAdapter } from '../../host/interface.js'
import type { Message } from '../../providers/types.js'
import { makeLogger } from '../../utils/logger.js'
import { VERIFY_TUNING } from '../tuning.js'

const log = makeLogger('verify_runner.ts')

export interface VerifyObservation {
  hint?: Message
  shouldBreak: boolean
  userMessage?: string
}

export class VerifyRunner {
  private lastSignature: string | null = null
  private failures = 0

  async run(host: HostAdapter, signal: AbortSignal): Promise<VerifyObservation> {
    host.emit('verify_start', { command: 'auto', projectKind: '' })
    let result
    try {
      result = await runAutoVerify(host.getProjectRoot(), signal)
    } catch (e) {
      log.error('runAutoVerify 실패:', e)
      return { shouldBreak: false }
    }
    if (!result) {
      host.emit('verify_result', {
        command: '(skip)',
        projectKind: 'unknown',
        passed: true,
        exitCode: 0,
        output: '',
        durationMs: 0,
        timedOut: false,
      })
      return { shouldBreak: false }
    }
    host.emit('verify_result', {
      command: result.command,
      projectKind: result.projectKind,
      passed: result.passed,
      exitCode: result.exitCode,
      output: result.output,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      failureKind: result.failureKind,
    })

    if (result.passed) {
      log.info(`Auto Verify 통과: ${result.command} (${result.durationMs}ms)`)
      this.lastSignature = null
      this.failures = 0
      return { shouldBreak: false }
    }

    if (result.failureKind === 'env') {
      log.warn(`Auto Verify 환경 에러 — 자가수정 대상 아님: ${result.command}`)
      return {
        hint: {
          role: 'system',
          content: `[Auto Verify] 코드 변경과 무관한 빌드 환경 문제로 검증이 실행되지 않았습니다. **이 오류를 코드로 고치려 하지 마세요.** 작업이 끝났다면 마무리하면서 사용자에게 환경 문제를 한 줄로 안내하세요.\n\n명령: ${result.command}\n\n${result.output}`,
        },
        shouldBreak: false,
      }
    }

    const sig = verifySignature(result)
    if (sig === this.lastSignature) {
      this.failures++
    } else {
      this.lastSignature = sig
      this.failures = 1
    }
    log.warn(`Auto Verify 실패 [${this.failures}/${VERIFY_TUNING.break}]: ${result.command} (exit ${result.exitCode})`)

    const breakNow = this.failures >= VERIFY_TUNING.break
    const content = breakNow
      ? `[Auto Verify] 동일 오류가 ${this.failures}회 반복되어 중단합니다. 사용자에게 막힌 지점을 보고하세요.`
      : this.failures >= VERIFY_TUNING.hint
        ? `[Auto Verify] 같은 오류가 ${this.failures}회 반복됩니다. 다른 접근(관련 파일 다시 읽기, 시그니처/import 재검토)을 시도하세요.\n\n명령: ${result.command}\n\n${result.output}`
        : `[Auto Verify] '${result.command}' 가 실패했습니다 (exit ${result.exitCode}, ${result.durationMs}ms).\n\n${result.output}\n\n위 오류를 분석하고 수정하세요. 통과 전에는 작업이 완료되었다고 답하지 마세요.`

    return {
      hint: { role: 'system', content },
      shouldBreak: breakNow,
      userMessage: breakNow ? `자동 검증이 ${this.failures}회 연속 실패하여 작업을 중단합니다.` : undefined,
    }
  }
}
