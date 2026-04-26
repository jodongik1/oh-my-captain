import { registerHandler, send } from '../server.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'
import { globby } from 'globby'

const log = makeLogger('file_search.ts')

export function registerFileSearchHandlers(state: CoreState) {
  registerHandler('file_search', async (msg) => {
    try {
      const { query } = msg.payload as { query: string }
      
      if (!state.host) {
        throw new Error('Core is not initialized')
      }

      const root = state.host.getProjectRoot()
      const searchPattern = query ? `**/*${query}*` : '**/*'
      
      // Limit to 50 results to avoid massive payloads
      const files = await globby([searchPattern, '!**/node_modules/**', '!**/.git/**', '!**/build/**', '!**/dist/**'], {
        cwd: root,
        onlyFiles: true,
        absolute: false,
      })

      // Get top 20 matches
      const topFiles = files.slice(0, 20)

      send({ 
        id: msg.id, 
        type: 'file_search_result', 
        payload: { files: topFiles } 
      })
    } catch (e: any) {
      log.error('file_search failed:', e)
      send({ 
        id: msg.id, 
        type: 'file_search_result', 
        payload: { files: [] } 
      })
    }
  })
}
