// Oh My Captain Core(Node.js) 프로세스의 생명주기 관리자.
// IntelliJ 측 CoreApplicationService.kt 와 동등한 역할.
//
// 메시지 흐름:
//   사용자 입력 → Webview → IPC → Core → LLM HTTP → 응답 스트리밍 → IPC → Webview
//
// stdout / stderr 분리 이유:
//   - stdout : IpcClient 가 NDJSON 메시지로 파싱 (로그가 섞이면 파싱 실패)
//   - stderr : OutputChannel 로 라우팅 — Core 측이 [Core:INFO] 등 prefix 를 찍어 grep 가능

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import * as vscode from 'vscode'
import { findNodeExecutable } from './NodeExecutableLocator.js'
import { loggerFor } from '../logging/logger.js'

const log = loggerFor('CoreProcessManager')

export class CoreProcessManager implements vscode.Disposable {
  private coreProcess: ChildProcessWithoutNullStreams | null = null

  constructor(private readonly extensionPath: string) {}

  /**
   * Node Core 프로세스를 시작한다. 이전 프로세스가 살아있으면 강제 종료 후 재시작.
   * IntelliJ 의 CoreApplicationService.startCore() 와 동등.
   */
  start(): ChildProcessWithoutNullStreams {
    if (this.coreProcess && !this.coreProcess.killed) {
      log.info('Killing previous Core process (restart/reconnect)')
      this.coreProcess.kill('SIGKILL')
      this.coreProcess = null
    }

    const nodeExec = findNodeExecutable()
    if (!nodeExec) {
      log.error('Node.js executable not found — Core boot impossible')
      throw new Error('Node.js 20+ 가 설치되어 있지 않습니다.')
    }
    log.info(`Node executable: ${nodeExec}`)

    const coreBundle = this.getCoreBundlePath()
    if (!coreBundle) {
      log.error('Core bundle (core/index.js) not found — packaging corrupted?')
      throw new Error('Core 번들을 찾을 수 없습니다. (resources/core/index.js)')
    }
    log.info(`Core bundle: ${coreBundle}`)

    const proc = spawn(nodeExec, [coreBundle], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Core 가 자기 자신의 cwd 를 의지하지 않도록 번들 디렉터리에서 실행. 프로젝트 루트는
      // 핸드셰이크(init 메시지)에서 별도 전달된다.
      cwd: path.dirname(coreBundle),
    })
    this.coreProcess = proc

    // stderr 를 OutputChannel 로 라우팅. Core 측 prefix 그대로 보존.
    const stderrLines = readline.createInterface({ input: proc.stderr })
    stderrLines.on('line', line => log.info(`[stderr] ${line}`))

    proc.once('error', e => log.error('Core process error', e))

    log.info('Core process started — stdio IPC ready')
    return proc
  }

  private getCoreBundlePath(): string | null {
    const indexJs = path.join(this.extensionPath, 'resources', 'core', 'index.js')
    return fs.existsSync(indexJs) ? indexJs : null
  }

  dispose(): void {
    if (this.coreProcess && !this.coreProcess.killed) {
      this.coreProcess.kill('SIGKILL')
      this.coreProcess = null
    }
  }
}
