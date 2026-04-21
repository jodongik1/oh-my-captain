import fs from 'fs'
import path from 'path'
import os from 'os'
import { CaptainSettings, DEFAULT_SETTINGS } from './types.js'
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

      // Merge with defaults to ensure schema consistency
      const merged: CaptainSettings = {
        provider: {
          ...DEFAULT_SETTINGS.provider,
          ...(parsed.provider || {})
        },
        model: {
          ...DEFAULT_SETTINGS.model,
          ...(parsed.model || {})
        },
        cachedModels: parsed.cachedModels ?? []
      }
      log.info("\n", merged)
      return { settings: merged, isFirstTime: false }
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
