import type { Edge, Node } from '@xyflow/react'
import { systemDefaultDelayMs, typingDelayMs } from './io/typing'

export type StoryNodeType =
  | 'lykie'
  | 'choice'
  | 'free_reply'
  | 'system'
  | 'wait'
  | 'end'

export type ChoiceOption = {
  id: string
  label: string
}

/** 自由回复的预设分支（运行时由 Lykie 判定走哪条；编辑器只存标签与出线） */
export type FreeReplyBranch = {
  id: string
  label: string
}

export type LykieData = {
  text: string
  delayMs: number
}

export type ChoiceData = {
  options: ChoiceOption[]
  timeoutMs: number
}

export type FreeReplyData = {
  /** 给玩家看的提示，可空 */
  prompt: string
  branches: FreeReplyBranch[]
}

export type SystemData = {
  text: string
  delayMs: number
}

export type WaitData = {
  delayMs: number
  note?: string
}

export type EndData = {
  label: string
}

export type StoryNodeData =
  | LykieData
  | ChoiceData
  | FreeReplyData
  | SystemData
  | WaitData
  | EndData

export type StoryNode = Node<Record<string, unknown>, StoryNodeType>

export type StoryEdge = Edge<{ label?: string }>

export type StoryGraph = {
  id: string
  title: string
  startNodeId: string
  nodes: Array<{
    id: string
    type: StoryNodeType
    position: { x: number; y: number }
    data: Record<string, unknown>
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
    data?: { label?: string }
  }>
}

export const TIMEOUT_HANDLE = 'timeout'
export const OUT_HANDLE = 'out'

export function uid(prefix = 'n'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

export function defaultData(type: StoryNodeType): Record<string, unknown> {
  switch (type) {
    case 'lykie': {
      const text = '……'
      return { text, delayMs: typingDelayMs(text) }
    }
    case 'choice':
      return {
        options: [
          { id: uid('opt'), label: '选项 A' },
          { id: uid('opt'), label: '选项 B' },
        ],
        timeoutMs: 0,
      }
    case 'free_reply':
      return {
        prompt: '',
        branches: [
          { id: uid('br'), label: '分支 A' },
          { id: uid('br'), label: '分支 B' },
        ],
      }
    case 'system':
      return { text: '系统提示', delayMs: systemDefaultDelayMs() }
    case 'wait':
      return { delayMs: 2000, note: '' }
    case 'end':
      return { label: '结束' }
  }
}

export function typeLabel(type: StoryNodeType): string {
  const map: Record<StoryNodeType, string> = {
    lykie: 'Lykie',
    choice: '玩家选项',
    free_reply: '自由回复',
    system: '系统',
    wait: '等待',
    end: '结束',
  }
  return map[type]
}
