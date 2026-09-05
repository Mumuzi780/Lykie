import type { NodeProps } from '@xyflow/react'
import { MovableHandle } from '../handles/MovableHandle'
import type { HandleLayoutMap } from '../handles/layout'
import { OUT_HANDLE, type SystemData } from '../types'

export function SystemNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as SystemData & { handleLayout?: HandleLayoutMap }
  return (
    <div className={`sn system ${selected ? 'selected' : ''}`}>
      <MovableHandle
        nodeId={id}
        id="in"
        handleType="target"
        defaultSide="top"
        handleLayout={d.handleLayout}
      />
      <div className="sn-tag">系统</div>
      <div className="sn-body">{d.text || '（空）'}</div>
      <div className="sn-meta">
        延迟 {Number(d.delayMs) || 0} ms
        {Number(d.delayMs) > 0 ? ` · ${(Number(d.delayMs) / 1000).toFixed(1)}s` : ''}
      </div>
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
