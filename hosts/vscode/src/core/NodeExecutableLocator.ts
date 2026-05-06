// 시스템에 설치된 Node.js 실행 파일 경로 탐색기.
// IntelliJ 측 NodeExecutableLocator.kt 의 nvm/fnm/PATH fallback 로직을 그대로 포팅한다.
//
// 마지막 fallback 으로 process.execPath (extension host 의 Electron Node) 도 시도해
// 사용자가 system Node 미설치 환경에서도 일단 동작하도록 한다.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { loggerFor } from '../logging/logger.js'

const log = loggerFor('NodeExecutableLocator')

/** Node 실행 파일 절대 경로 또는 null. 어떤 fallback 단계에서 찾았는지 디버그 로그를 남긴다. */
export function findNodeExecutable(): string | null {
  const found = findFromNvmDefault() ?? findFromNvmVersions() ?? findFromPathFallback()
  if (found) return found

  // 최후 fallback — extension host 가 돌고 있는 Electron Node. better-sqlite3 ABI 가
  // VS Code 버전과 정확히 맞으면 동작, 아니면 어차피 spawn 후 die 한다.
  const electronNode = process.execPath
  if (electronNode && fs.existsSync(electronNode)) {
    log.warn(`Falling back to extension host's process.execPath (${electronNode}) — system Node not found`)
    return electronNode
  }
  log.warn('Node executable not found in any fallback')
  return null
}

function nvmDir(): string {
  return process.env.NVM_DIR ?? path.join(process.env.HOME ?? '', '.nvm')
}

/** 1) ~/.nvm/alias/default 에 적힌 버전. */
function findFromNvmDefault(): string | null {
  const aliasFile = path.join(nvmDir(), 'alias/default')
  if (!fs.existsSync(aliasFile)) return null
  const versionPrefix = fs.readFileSync(aliasFile, 'utf8').trim()

  const versionsDir = path.join(nvmDir(), 'versions/node')
  if (!fs.existsSync(versionsDir)) return null

  const candidates = fs.readdirSync(versionsDir)
    .filter(name => {
      const ver = name.replace(/^v/, '')
      return ver.startsWith(versionPrefix) && fs.existsSync(path.join(versionsDir, name, 'bin/node'))
    })
    .sort()
    .reverse()

  if (candidates.length === 0) return null
  const found = path.join(versionsDir, candidates[0]!, 'bin/node')
  log.debug(`Node found via nvm default alias (${found})`)
  return found
}

/** 2) ~/.nvm/versions/node 스캔 — v24 우선, 그 외 버전 내림차순. */
function findFromNvmVersions(): string | null {
  const versionsDir = path.join(nvmDir(), 'versions/node')
  if (!fs.existsSync(versionsDir)) return null

  const candidates = fs.readdirSync(versionsDir)
    .filter(name => fs.existsSync(path.join(versionsDir, name, 'bin/node')))
    .sort((a, b) => {
      const aMajor = parseInt(a.replace(/^v/, '').split('.')[0]!, 10)
      const bMajor = parseInt(b.replace(/^v/, '').split('.')[0]!, 10)
      const aV24 = aMajor === 24 ? 1 : 0
      const bV24 = bMajor === 24 ? 1 : 0
      if (aV24 !== bV24) return bV24 - aV24
      return b.localeCompare(a)
    })

  if (candidates.length === 0) return null
  const found = path.join(versionsDir, candidates[0]!, 'bin/node')
  log.debug(`Node found via nvm versions scan (${found})`)
  return found
}

/** 3) which/where node — fnm/Homebrew 경로 보강. */
function findFromPathFallback(): string | null {
  const home = process.env.HOME ?? ''
  const extras = [
    path.join(home, '.local/share/fnm/aliases/default/bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ]
  const isWindows = process.platform === 'win32'
  const sep = isWindows ? ';' : ':'
  const pathEnv = (process.env.PATH ?? '') + sep + extras.join(sep)
  const cmd = isWindows ? 'where node' : 'which node'

  try {
    const out = execSync(cmd, { env: { ...process.env, PATH: pathEnv }, encoding: 'utf8' })
    const first = out.split('\n')[0]?.trim()
    if (first) {
      log.debug(`Node found via PATH fallback (${first})`)
      return first
    }
  } catch (e) {
    log.debug('which/where node failed', e)
  }
  return null
}
