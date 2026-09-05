import { useEffect, useRef, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { OUT_HANDLE, TIMEOUT_HANDLE, type ChoiceOption } from '../types'

type Props = {
  open: boolean
  nodes: Node[]
  edges: Edge[]
  startNodeId: string
  onClose: () => void
}

type Bubble = { role: 'lykie' | 'system' | 'player' | 'meta'; text: string }

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const t = window.setTimeout(() => resolve(), ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function nextVia(edges: Edge[], source: string, handle: string | null) {
  const h = handle || OUT_HANDLE
  return (
    edges.find((e) => e.source === source && (e.sourceHandle || OUT_HANDLE) === h) ||
    edges.find((e) => e.source === source && !e.sourceHandle)
  )
}

export function PreviewModal({ open, nodes, edges, startNodeId, onClose }: Props) {
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [choices, setChoices] = useState<ChoiceOption[] | null>(null)
  const [status, setStatus] = useState('准备…')
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const choiceResolver = useRef<((v: string) => void) | null>(null)

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      setBubbles([])
      setChoices(null)
      setRunning(false)
      return
    }
    void run()
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function run() {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setBubbles([])
    setChoices(null)
    setRunning(true)
    setStatus('播放中…')

    const byId = new Map(nodes.map((n) => [n.id, n]))
    let cur = startNodeId
    if (!byId.has(cur)) {
      setStatus('未设置有效起点')
      setRunning(false)
      return
    }

    try {
      while (cur) {
        const node = byId.get(cur)
        if (!node) break
        const type = node.type || 'lykie'
        const data = node.data as Record<string, unknown>

        if (type === 'wait') {
          const ms = Number(data.delayMs) || 0
          setStatus(`等待 ${ms} ms${data.note ? ` · ${data.note}` : ''}`)
          setBubbles((b) => [...b, { role: 'meta', text: `（等待 ${ms} ms）` }])
          await sleep(ms, ac.signal)
          const edge = nextVia(edges, cur, OUT_HANDLE)
          cur = edge?.target || ''
          continue
        }

        if (type === 'end') {
          setBubbles((b) => [
            ...b,
            { role: 'meta', text: String(data.label || '结束') },
          ])
          setStatus('结束')
          break
        }

        if (type === 'choice') {
          const opts = (data.options as ChoiceOption[]) || []
          const timeoutMs = Number(data.timeoutMs) || 0
          setChoices(opts)
          setStatus(
            timeoutMs > 0 ? `请选择（${timeoutMs} ms 内）` : '请选择',
          )

          const picked = await new Promise<string>((resolve, reject) => {
            choiceResolver.current = resolve
            if (timeoutMs > 0) {
              const t = window.setTimeout(() => resolve(TIMEOUT_HANDLE), timeoutMs)
              ac.signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(t)
                  reject(new DOMException('aborted', 'AbortError'))
                },
                { once: true },
              )
            }
          })

          setChoices(null)
          choiceResolver.current = null
          if (picked === TIMEOUT_HANDLE) {
            setBubbles((b) => [...b, { role: 'meta', text: '（超时）' }])
          } else {
            const label = opts.find((o) => o.id === picked)?.label || picked
            setBubbles((b) => [...b, { role: 'player', text: label }])
          }
          const edge = nextVia(edges, cur, picked)
          if (!edge) {
            setStatus('该选项没有连线')
            break
          }
          cur = edge.target
          continue
        }

        // lykie / system
        const delayMs = Number(data.delayMs) || 0
        if (delayMs > 0) {
          setStatus(`延迟 ${delayMs} ms…`)
          await sleep(delayMs, ac.signal)
        }
        const text = String(data.text || '')
        setBubbles((b) => [
          ...b,
          { role: type === 'system' ? 'system' : 'lykie', text },
        ])
        setStatus('…')
        const edge = nextVia(edges, cur, OUT_HANDLE)
        cur = edge?.target || ''
        if (!cur) setStatus('到达末尾（无下一节点）')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setStatus(String(e))
    } finally {
      setRunning(false)
      setChoices(null)
      if (!ac.signal.aborted) setStatus((s) => (s === '播放中…' || s === '…' ? '播放结束' : s))
    }
  }

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <div className="modal preview-modal">
        <div className="modal-head">
          <h3>预览播放</h3>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="preview-status">{status}</div>
        <div className="preview-log">
          {bubbles.map((b, i) => (
            <div key={i} className={`pbub ${b.role}`}>
              {b.text}
            </div>
          ))}
        </div>
        {choices && (
          <div className="preview-choices">
            {choices.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn"
                onClick={() => choiceResolver.current?.(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <div className="modal-foot">
          <button type="button" className="btn" disabled={running} onClick={() => void run()}>
            重来
          </button>
        </div>
      </div>
    </div>
  )
}
