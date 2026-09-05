import type { CSSProperties } from 'react'

export type HandleSide = 'top' | 'right' | 'bottom' | 'left'

export type HandleLayout = {
  side: HandleSide
  /** 0~1，沿该边从左/上到右/下 */
  t: number
}

export type HandleLayoutMap = Record<string, HandleLayout>

export function clamp01(n: number, lo = 0.05, hi = 0.95) {
  return Math.min(hi, Math.max(lo, n))
}

/** 将节点本地坐标映射到最近边缘上的接口位置 */
export function pointToHandleLayout(
  localX: number,
  localY: number,
  width: number,
  height: number,
): HandleLayout {
  const w = Math.max(width, 1)
  const h = Math.max(height, 1)
  const x = localX
  const y = localY
  const dTop = y
  const dBottom = h - y
  const dLeft = x
  const dRight = w - x
  const min = Math.min(dTop, dBottom, dLeft, dRight)
  if (min === dTop) return { side: 'top', t: clamp01(x / w) }
  if (min === dBottom) return { side: 'bottom', t: clamp01(x / w) }
  if (min === dLeft) return { side: 'left', t: clamp01(y / h) }
  return { side: 'right', t: clamp01(y / h) }
}

export function layoutToStyle(layout: HandleLayout): {
  position: HandleSide
  style: CSSProperties
} {
  const t = clamp01(layout.t)
  const pct = `${t * 100}%`
  switch (layout.side) {
    case 'top':
      return { position: 'top', style: { left: pct, top: 0, transform: 'translate(-50%, -50%)' } }
    case 'bottom':
      return {
        position: 'bottom',
        style: { left: pct, top: 'auto', bottom: 0, transform: 'translate(-50%, 50%)' },
      }
    case 'left':
      return { position: 'left', style: { top: pct, left: 0, transform: 'translate(-50%, -50%)' } }
    case 'right':
      return {
        position: 'right',
        style: { top: pct, left: 'auto', right: 0, transform: 'translate(50%, -50%)' },
      }
  }
}
