import { createContext, useContext } from 'react'
import type { HandleLayout } from './layout'

export type HandleEditApi = {
  /** Alt 按住：可拖动接口位置 */
  altHeld: boolean
  beginHandleDrag: () => void
  setHandleLayout: (nodeId: string, handleId: string, layout: HandleLayout) => void
}

export const HandleEditContext = createContext<HandleEditApi>({
  altHeld: false,
  beginHandleDrag: () => {},
  setHandleLayout: () => {},
})

export function useHandleEdit() {
  return useContext(HandleEditContext)
}
