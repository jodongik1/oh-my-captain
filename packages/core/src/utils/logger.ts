import pino from 'pino'
import pretty from 'pino-pretty'

const stream = pretty({
  colorize: true,
  translateTime: 'SYS:HH:MM:ss',
  ignore: 'pid,hostname',
  destination: process.stderr,
})

export const logger = pino({ level: 'info' }, stream)
