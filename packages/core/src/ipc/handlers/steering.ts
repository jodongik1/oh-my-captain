import { registerHandler } from '../server.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('steering.ts')

export function registerSteeringHandlers(state: CoreState) {
  registerHandler('steer_inject', (msg) => {
    const { text } = msg.payload
    if (state.run.busy) {
      state.run.loopController.injectSteering(text)
      log.debug(`스티어링 주입: ${text.slice(0, 80)}...`)
    } else {
      log.warn('스티어링 무시 (루프 미실행 중)')
    }
  })

  registerHandler('steer_interrupt', () => {
    state.run.loopController.abort()
    log.info('스티어링 인터럽트')
  })
}
