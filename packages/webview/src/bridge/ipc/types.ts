// IPC 핸들러 모듈 공통 타입.
// 각 도메인 핸들러는 IpcHandlerCtx 를 받아 `Partial<IpcHandlerMap>` 을 반환하며,
// useIpcMessageHandler 가 모두 spread 하여 단일 핸들러 맵을 구성한다.

import type { Dispatch, MutableRefObject } from 'react'
import type { AppAction } from '../../store'
import type { IHostBridge } from '../jcef'
import type { ReceiveType, ReceivePayload } from '../types'

export interface IpcHandlerCtx {
  dispatch: Dispatch<AppAction>
  /** stream_start 시점의 source 를 stream_chunk 로 전달하기 위한 ref. */
  sourceRef: MutableRefObject<'chat' | 'action'>
  bridge: IHostBridge
}

/**
 * 핸들러는 ReceiveType 별 정확한 payload 를 받는다.
 * 미등록 type 에 대한 호출은 useIpcMessageHandler 가 무시한다.
 */
export type IpcHandler<T extends ReceiveType> = (payload: ReceivePayload<T>) => void

/** 도메인 핸들러는 자기가 다루는 type 만 채워서 반환한다. */
export type IpcHandlerMap = {
  [T in ReceiveType]?: IpcHandler<T>
}

/** 도메인 핸들러 팩토리 시그니처. */
export type IpcHandlerFactory = (ctx: IpcHandlerCtx) => IpcHandlerMap
