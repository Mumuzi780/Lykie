import { Handle, Position, useUpdateNodeInternals, type HandleType } from '@xyflow/react'
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useHandleEdit } from './HandleEditContext'
import {
  layoutToStyle,
  pointToHandleLayout,
  type HandleLayout,
  type HandleSide,
} from './layout'

const SIDE_TO_POS: Record<HandleSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

type Props = {
  nodeId: string
  id: string
  handleType: HandleType
  defaultSide: HandleSide
  defaultT?: number
  handleLayout?: Record<string, HandleLayout>
  className?: string
}

export function MovableHandle({
  nodeId,
  id,
  handleType,
  defaultSide,
  defaultT = 0.5,
  handleLayout,
  className,
}: Props) {
  const { altHeld, beginHandleDrag, setHandleLayout } = useHandleEdit()
  const updateNodeInternals = useUpdateNodeInternals()
  const dragging = useRef(false)
  const layout: HandleLayout = handleLayout?.[id] || {
    side: defaultSide,
    t: defaultT,
  }
  const mapped = layoutToStyle(layout)

  const applyLayout = useCallback(
    (next: HandleLayout) => {
      setHandleLayout(nodeId, id, next)
      requestAnimationFrame(() => {
        updateNodeInternals(nodeId)
        requestAnimationFrame(() => updateNodeInternals(nodeId))
      })
    },
    [setHandleLayout, nodeId, id, updateNodeInternals],
  )

  const startReposition = useCallback(
    (e: ReactPointerEvent) => {
      // 左 Alt（altHeld）+ 鼠标左键
      if (!altHeld || e.button !== 0) return false
      e.preventDefault()
      e.stopPropagation()
      beginHandleDrag()
      dragging.current = true
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)

      const nodeEl = el.closest('.react-flow__node') as HTMLElement | null
      if (!nodeEl) return true

      const move = (ev: PointerEvent) => {
        if (!dragging.current) return
        ev.preventDefault()
        const rect = nodeEl.getBoundingClientRect()
        const localX = ev.clientX - rect.left
        const localY = ev.clientY - rect.top
        const next = pointToHandleLayout(localX, localY, rect.width, rect.height)
        applyLayout(next)
      }
      const up = (ev: PointerEvent) => {
        dragging.current = false
        try {
          el.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        updateNodeInternals(nodeId)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
      return true
    },
    [altHeld, beginHandleDrag, nodeId, applyLayout, updateNodeInternals],
  )

  return (
    <Handle
      type={handleType}
      position={SIDE_TO_POS[mapped.position]}
      id={id}
      className={`movable-handle ${altHeld ? 'reposition' : ''} ${className || ''}`}
      style={{
        ...mapped.style,
        zIndex: altHeld ? 40 : undefined,
        pointerEvents: 'all',
      }}
      onPointerDownCapture={startReposition}
      onPointerDown={startReposition}
      isConnectable={!altHeld}
    />
  )
}
