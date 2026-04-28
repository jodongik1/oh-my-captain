// 설정 타입 + DEFAULT_SETTINGS 는 @omc/protocol 의 단일 소스에서 가져온다.
// 본 파일은 호환 re-export — 신규 import 는 @omc/protocol 에서 직접.
export type {
  ApiProvider,
  ProviderSettings,
  ModelSettings,
  CachedModelInfo,
  CaptainSettings,
} from '@omc/protocol'
export { DEFAULT_SETTINGS } from '@omc/protocol'
