// React Context 로 IHostBridge 를 주입한다. 컴포넌트는 useHostBridge() 로 받아 호스트와 통신.
// 테스트 시 임의의 MockBridge 를 <HostBridgeProvider value={mock}> 로 갈아 끼울 수 있다.

import { createContext, useContext, ReactNode } from 'react'
import type { IHostBridge } from './jcef'
import { defaultHostBridge } from './jcef'

const HostBridgeContext = createContext<IHostBridge>(defaultHostBridge)

export function HostBridgeProvider({
  bridge = defaultHostBridge,
  children,
}: { bridge?: IHostBridge; children: ReactNode }) {
  return <HostBridgeContext.Provider value={bridge}>{children}</HostBridgeContext.Provider>
}

export function useHostBridge(): IHostBridge {
  return useContext(HostBridgeContext)
}
