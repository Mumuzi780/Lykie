import type { Edge, Node } from '@xyflow/react'
import type { StoryGraph, StoryNodeType } from '../types'
import { TIMEOUT_HANDLE } from '../types'
import { typingDelayMs } from './typing'

export function toStoryGraph(
  id: string,
  title: string,
  startNodeId: string,
  nodes: Node[],
  edges: Edge[],
): StoryGraph {
  return {
    id,
    title,
    startNodeId,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.type || 'lykie') as StoryNodeType,
      position: { ...n.position },
      data: { ...(n.data as Record<string, unknown>) },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      data: e.data ? { ...(e.data as object) } : {},
    })),
  }
}

export function fromStoryGraph(graph: StoryGraph): {
  nodes: Node[]
  edges: Edge[]
  startNodeId: string
  id: string
  title: string
} {
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { ...n.data },
  }))

  const edges: Edge[] = graph.edges.map((e) => {
    const handle = e.sourceHandle
    let label = ''
    if (handle === TIMEOUT_HANDLE) label = '超时'
    else if (handle) {
      const src = graph.nodes.find((n) => n.id === e.source)
      const opts = (src?.data as { options?: { id: string; label: string }[] })?.options
      const opt = opts?.find((o) => o.id === handle)
      label = opt?.label?.slice(0, 8) || handle
    }
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      label: label || undefined,
      data: e.data || {},
    }
  })

  return {
    nodes,
    edges,
    startNodeId: graph.startNodeId,
    id: graph.id,
    title: graph.title,
  }
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const emptyGraph = (): StoryGraph => {
  const startId = 'n_start'
  return {
    id: 'untitled',
    title: '未命名剧情',
    startNodeId: startId,
    nodes: [
      {
        id: startId,
        type: 'lykie',
        position: { x: 80, y: 80 },
        data: (() => {
          const text = '（起点）在这里写 Lykie 的第一句话'
          return { text, delayMs: typingDelayMs(text) }
        })(),
      },
    ],
    edges: [],
  }
}

export { fragment01Graph } from '../stories/fragment_01'

