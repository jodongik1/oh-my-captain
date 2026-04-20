import { registerHandler } from '../server.js'
import { abortLoop, injectSteering } from '../../agent/loop.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('Core')

export function registerSteeringHandlers(state: CoreState) {
  registerHandler('steer_inject', (msg) => {
    const { text } = msg.payload as { text: string }
    if (state.busy) {
      injectSteering(text)
      log.debug(`스티어링 주입: ${text.slice(0, 80)}...`)
    } else {
      log.warn('스티어링 무시 (루프 미실행 중)')
    }
  })

  registerHandler('steer_interrupt', () => {
    abortLoop()
    log.info('스티어링 인터럽트')
  })
}
