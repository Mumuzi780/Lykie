import type { NodeProps } from '@xyflow/react'
import { MovableHandle } from '../handles/MovableHandle'
import type { HandleLayoutMap } from '../handles/layout'
import type { EndData } from '../types'

export function EndNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as EndData & { handleLayout?: HandleLayoutMap }
  return (
    <div className={`sn end ${selected ? 'selected' : ''}`}>
      <MovableHandle
        nodeId={id}
        id="in"
        handleType="target"
        defaultSide="top"
        handleLayout={d.handleLayout}
      />
      <div className="sn-tag">结束</div>
      <div className="sn-body">{d.label || '结束'}</div>
    </div>
  )
}
