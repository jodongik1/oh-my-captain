import fs from 'fs'
import path from 'path'
import os from 'os'
import { CaptainSettings, DEFAULT_SETTINGS } from './types.js'
import { captainSettingsSchema } from './schema.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('manager.ts')

export interface LoadSettingsResult {
  settings: CaptainSettings
  isFirstTime: boolean
}

export class SettingsManager {
  private static getFilePath(): string {
    const home = os.homedir()
    return path.join(home, '.oh-my-captain', 'settings.json')
  }

  static load(): LoadSettingsResult {
    const filePath = this.getFilePath()
    try {
      if (!fs.existsSync(filePath)) {
        return { settings: { ...DEFAULT_SETTINGS }, isFirstTime: true }
      }
      const fileData = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(fileData) as Partial<CaptainSettings>

      // 기본값 병합 후 zod 로 최종 검증 — 손상된 settings.json 도 fallback 으로 복구.
      const merged: CaptainSettings = {
        provider: { ...DEFAULT_SETTINGS.provider, ...(parsed.provider ?? {}) },
        model: { ...DEFAULT_SETTINGS.model, ...(parsed.model ?? {}) },
        cachedModels: parsed.cachedModels ?? [],
      }
      const validation = captainSettingsSchema.safeParse(merged)
      if (!validation.success) {
        log.warn('settings.json 검증 실패 — 기본값 사용:', validation.error.message)
        return { settings: { ...DEFAULT_SETTINGS }, isFirstTime: true }
      }
      log.info('Loaded settings:\n', validation.data)
      return { settings: validation.data, isFirstTime: false }
    } catch (e) {
      log.error('Load error, using defaults:\n', e)
      return { settings: { ...DEFAULT_SETTINGS }, isFirstTime: true }
    }
  }

  static save(settings: CaptainSettings): void {
    const filePath = this.getFilePath()
    try {
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
      log.info(`Saved successfully to ${filePath}`)
    } catch (e) {
      log.error('Save error:', e)
    }
  }
}
