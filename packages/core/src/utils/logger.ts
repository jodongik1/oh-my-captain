import util from 'util'
import pino from 'pino'
import pretty from 'pino-pretty'

// pino-pretty 설정을 통해 터미널 가독성을 높입니다.
const stream = pretty({
  // true: 로그 레벨(INFO, ERROR 등)에 따라 색상을 입혀서 가독성 향상
  colorize: true,
  // 타임스탬프 포맷 설정 (SYS: 시스템 로컬 시간, HH:MM:ss 형태) 
  // 원한다면 'SYS:yyyy-mm-dd HH:MM:ss.l' 형태로 밀리초까지 표시 가능
  translateTime: 'SYS:HH:MM:ss',
  // pino가 기본적으로 출력하는 잡음(프로세스 ID, 호스트네임) 및 커스텀 포맷으로 출력할 name 숨김 처리
  ignore: 'pid,hostname,name',
  // [모듈명] 메시지 형태로 커스텀 포맷 적용
  messageFormat: '[{name}] {msg}',
  // 줄바꿈이 있는 객체나 에러 스택도 한 줄로 압축해서 출력 (세로 공간 절약)
  singleLine: false,
  // 별도의 JSON 파라미터로 넘어오는 Object 자체를 숨김 (msg 문자열만 깔끔하게 출력)
  hideObject: false,
  // 출력 대상을 지정. IntelliJ 플러그인이 모니터링하기 쉽도록 표준 에러(stderr)로 설정
  destination: process.stderr,
})

export const logger = pino({ level: 'debug' }, stream)

// 모듈별 레벨 prefix 로거 팩토리
// 모든 출력은 stderr → IntelliJ 로그창에 [Module:LEVEL] 형태로 표시됨
export function makeLogger(module: string) {
  const child = logger.child({ name: module })
  return {
    // util.format을 사용해 객체나 다중 파라미터를 누락 없이 깔끔한 문자열 하나로 합침
    info: (...args: unknown[]) => child.info(util.format(...args)),
    warn: (...args: unknown[]) => child.warn(util.format(...args)),
    error: (...args: unknown[]) => child.error(util.format(...args)),
    debug: (...args: unknown[]) => child.debug(util.format(...args)),
  }
}
