import type { NodeProps } from '@xyflow/react'
import { MovableHandle } from '../handles/MovableHandle'
import type { HandleLayoutMap } from '../handles/layout'
import { TIMEOUT_HANDLE, type ChoiceData } from '../types'

export function ChoiceNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as ChoiceData & { handleLayout?: HandleLayoutMap }
  const options = d.options || []
  const timeoutMs = Number(d.timeoutMs) || 0
  const rows = [...options, { id: TIMEOUT_HANDLE, label: '超时分支' }]

  return (
    <div className={`sn choice ${selected ? 'selected' : ''}`}>
      <MovableHandle
        nodeId={id}
        id="in"
        handleType="target"
        defaultSide="left"
        handleLayout={d.handleLayout}
      />
      <div className="sn-tag">玩家选项</div>
      <div className="sn-meta">
        限时 {timeoutMs > 0 ? `${timeoutMs} ms` : '不限'}
      </div>
      <div className="choice-opts">
        {rows.map((opt) => {
          const isTimeout = opt.id === TIMEOUT_HANDLE
          return (
            <div key={opt.id} className={`choice-opt-row ${isTimeout ? 'timeout' : ''}`}>
              <span className="choice-opt-label">{opt.label}</span>
            </div>
          )
        })}
      </div>
      {rows.map((opt, i) => (
        <MovableHandle
          key={`h-${opt.id}`}
          nodeId={id}
          id={opt.id}
          handleType="source"
          defaultSide="right"
          defaultT={(i + 1) / (rows.length + 1)}
          handleLayout={d.handleLayout}
          className={opt.id === TIMEOUT_HANDLE ? 'timeout-handle' : ''}
        />
      ))}
    </div>
  )
}
