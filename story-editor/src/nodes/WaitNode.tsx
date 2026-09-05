import type { NodeProps } from '@xyflow/react'
import { MovableHandle } from '../handles/MovableHandle'
import type { HandleLayoutMap } from '../handles/layout'
import { OUT_HANDLE, type WaitData } from '../types'

export function WaitNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as WaitData & { handleLayout?: HandleLayoutMap }
  const ms = Number(d.delayMs) || 0
  const sec = (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)
  return (
    <div className={`sn wait ${selected ? 'selected' : ''}`}>
      <MovableHandle
        nodeId={id}
        id="in"
        handleType="target"
        defaultSide="top"
        handleLayout={d.handleLayout}
      />
      <div className="sn-tag">等待</div>
      <div className="sn-body">{sec}s</div>
      {d.note ? <div className="sn-meta">{d.note}</div> : null}
      <MovableHandle
        nodeId={id}
        id={OUT_HANDLE}
        handleType="source"
        defaultSide="bottom"
        handleLayout={d.handleLayout}
      />
    </div>
  )
}
