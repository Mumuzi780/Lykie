import type { NodeProps } from '@xyflow/react'
import { MovableHandle } from '../handles/MovableHandle'
import type { HandleLayoutMap } from '../handles/layout'
import type { FreeReplyData } from '../types'

export function FreeReplyNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as FreeReplyData & { handleLayout?: HandleLayoutMap }
  const branches = d.branches || []
  const prompt = (d.prompt || '').trim()

  return (
    <div className={`sn free_reply ${selected ? 'selected' : ''}`}>
      <MovableHandle
        nodeId={id}
        id="in"
        handleType="target"
        defaultSide="left"
        handleLayout={d.handleLayout}
      />
      <div className="sn-tag">自由回复</div>
      {prompt ? <div className="sn-body">{prompt}</div> : null}
      <div className="sn-meta">玩家打字 · Lykie 判定分支</div>
      <div className="choice-opts">
        {branches.map((br) => (
          <div key={br.id} className="choice-opt-row">
            <span className="choice-opt-label">{br.label}</span>
          </div>
        ))}
      </div>
      {branches.map((br, i) => (
        <MovableHandle
          key={`h-${br.id}`}
          nodeId={id}
          id={br.id}
          handleType="source"
          defaultSide="right"
          defaultT={(i + 1) / (branches.length + 1)}
          handleLayout={d.handleLayout}
        />
      ))}
    </div>
  )
}
