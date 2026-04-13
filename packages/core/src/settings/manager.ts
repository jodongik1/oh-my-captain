import fs from 'fs'
import path from 'path'
import os from 'os'
import { CaptainSettings, DEFAULT_SETTINGS } from './types.js'

export interface LoadSettingsResult {
  settings: CaptainSettings
  isFirstTime: boolean
}

export class SettingsManager {
  private static getFilePath(): string {
    const home = os.homedir()
    return path.join(home, '.omc', 'settings.json')
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
        }
      }
      console.error('[Core DEBUG] SettingsManager.load parsed JSON object:', JSON.stringify(parsed));
      console.error('[Core DEBUG] SettingsManager.load merged result:', JSON.stringify(merged));
      return { settings: merged, isFirstTime: false }
    } catch (e) {
      console.error('[Settings] Load error, using defaults:', e)
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
      console.error(`[Settings] Saved successfully to ${filePath}`)
    } catch (e) {
      console.error('[Settings] Save error:', e)
    }
  }
}
