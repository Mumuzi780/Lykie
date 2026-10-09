import type { Node } from '@xyflow/react'
import { TYPING_MS_PER_CHAR, typingDelayHint, typingDelayMs } from '../io/typing'
import { TIMEOUT_HANDLE, uid, type ChoiceOption, type FreeReplyBranch, type StoryNodeType } from '../types'

type Props = {
  node: Node | null
  startNodeId: string
  onChange: (id: string, data: Record<string, unknown>) => void
  onSetStart: (id: string) => void
  onDelete: (id: string) => void
}

export function Inspector({ node, startNodeId, onChange, onSetStart, onDelete }: Props) {
  if (!node) {
    return (
      <aside className="inspector">
        <h3>属性</h3>
        <p className="hint">选中一个节点进行编辑</p>
      </aside>
    )
  }

  const type = (node.type || 'lykie') as StoryNodeType
  const data = node.data as Record<string, unknown>

  const set = (patch: Record<string, unknown>) => {
    onChange(node.id, { ...data, ...patch })
  }

  const delayMs = Number(data.delayMs) || 0
  const timeoutMs = Number(data.timeoutMs) || 0
  const options = (data.options as ChoiceOption[]) || []
  const branches = (data.branches as FreeReplyBranch[]) || []
  const text = String(data.text || '')
  const prompt = String(data.prompt || '')
  const suggested = typingDelayMs(text)

  return (
    <aside className="inspector">
      <h3>属性 · {type}</h3>
      <div className="field">
        <label>节点 ID</label>
        <code>{node.id}</code>
      </div>
      {node.id === startNodeId ? (
        <p className="badge start">起点</p>
      ) : (
        <button type="button" className="btn" onClick={() => onSetStart(node.id)}>
          设为起点
        </button>
      )}

      {(type === 'lykie' || type === 'system') && (
        <>
          <div className="field">
            <label>文案</label>
            <textarea
              rows={5}
              value={text}
              onChange={(e) => {
                const next = e.target.value
                if (type === 'lykie') {
                  set({ text: next, delayMs: typingDelayMs(next) })
                } else {
                  set({ text: next })
                }
              }}
            />
          </div>
          <DelayFields
            delayMs={delayMs}
            onMs={(v) => set({ delayMs: v })}
            label={
              type === 'lykie'
                ? '出现前延迟（默认=打字时间）'
                : '出现前延迟'
            }
          />
          {type === 'lykie' && (
            <>
              <p className="hint">
                打字速度：每字 {TYPING_MS_PER_CHAR}ms；标点不计；纯符号默认 0.5s。思考请另加「等待」节点。
              </p>
              <p className="hint">{typingDelayHint(text)}</p>
              {delayMs !== suggested && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => set({ delayMs: suggested })}
                >
                  按打字速度重算（{suggested} ms）
                </button>
              )}
            </>
          )}
          {type === 'system' && (
            <p className="hint">系统提示不受打字速度影响，默认 0.5s，可手动改。</p>
          )}
        </>
      )}

      {type === 'wait' && (
        <>
          <DelayFields delayMs={delayMs} onMs={(v) => set({ delayMs: v })} label="等待时长（思考/行动）" />
          <div className="field">
            <label>备注（可选）</label>
            <input
              value={String(data.note || '')}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="例如：她去交卷了"
            />
          </div>
          <p className="hint">等待节点不含打字时间，专留给思考、交卷等。</p>
        </>
      )}

      {type === 'end' && (
        <div className="field">
          <label>结束标签</label>
          <input
            value={String(data.label || '')}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>
      )}

      {type === 'choice' && (
        <>
          <DelayFields
            delayMs={timeoutMs}
            onMs={(v) => set({ timeoutMs: v })}
            label="选项限时（0=不限）"
          />
          <div className="field">
            <label>选项列表</label>
            {options.map((opt, idx) => (
              <div key={opt.id} className="opt-edit">
                <input
                  value={opt.label}
                  onChange={(e) => {
                    const next = options.map((o, i) =>
                      i === idx ? { ...o, label: e.target.value } : o,
                    )
                    set({ options: next })
                  }}
                />
                <button
                  type="button"
                  className="btn danger"
                  disabled={options.length <= 1}
                  onClick={() => set({ options: options.filter((o) => o.id !== opt.id) })}
                >
                  删
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn"
              onClick={() =>
                set({
                  options: [...options, { id: uid('opt'), label: `选项 ${options.length + 1}` }],
                })
              }
            >
              加选项
            </button>
          </div>
          <p className="hint">右侧圆点：每个选项一条出边；最后一项为「{TIMEOUT_HANDLE}」超时分支。</p>
        </>
      )}

      {type === 'free_reply' && (
        <>
          <div className="field">
            <label>提示文案（可选）</label>
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => set({ prompt: e.target.value })}
              placeholder="例如：随便回一句"
            />
          </div>
          <div className="field">
            <label>预设分支（运行时由 Lykie 判定）</label>
            {branches.map((br, idx) => (
              <div key={br.id} className="opt-edit">
                <input
                  value={br.label}
                  onChange={(e) => {
                    const next = branches.map((o, i) =>
                      i === idx ? { ...o, label: e.target.value } : o,
                    )
                    set({ branches: next })
                  }}
                  placeholder="分支含义，供判定对照"
                />
                <button
                  type="button"
                  className="btn danger"
                  disabled={branches.length <= 1}
                  onClick={() => set({ branches: branches.filter((o) => o.id !== br.id) })}
                >
                  删
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn"
              onClick={() =>
                set({
                  branches: [
                    ...branches,
                    { id: uid('br'), label: `分支 ${branches.length + 1}` },
                  ],
                })
              }
            >
              加分支
            </button>
          </div>
          <p className="hint">
            玩家自由打字；右侧每个圆点对应一条预设分支出线。判定逻辑不在编辑器里，交给 Lykie。
          </p>
        </>
      )}

      <button type="button" className="btn danger block" onClick={() => onDelete(node.id)}>
        删除节点
      </button>
    </aside>
  )
}

function DelayFields({
  delayMs,
  onMs,
  label = '出现前延迟',
}: {
  delayMs: number
  onMs: (v: number) => void
  label?: string
}) {
  const sec = delayMs / 1000
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <input
          type="number"
          min={0}
          step={1}
          value={delayMs}
          onChange={(e) => onMs(Math.max(0, Number(e.target.value) || 0))}
        />
        <span className="unit">ms</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={Number.isFinite(sec) ? sec : 0}
          onChange={(e) => onMs(Math.max(0, Math.round((Number(e.target.value) || 0) * 1000)))}
        />
        <span className="unit">秒</span>
      </div>
    </div>
  )
}
