import type { StoryGraph } from '../types'

const DRAFT_KEY = 'story-editor:draft'

export type SavedDraft = {
  savedAt: number
  graph: StoryGraph
}

export function loadDraft(): SavedDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedDraft
    if (!parsed?.graph?.nodes || !Array.isArray(parsed.graph.nodes)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveDraft(graph: StoryGraph): number {
  const savedAt = Date.now()
  const payload: SavedDraft = { savedAt, graph }
  localStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
  return savedAt
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY)
}

export function formatSavedAt(ts: number | null): string {
  if (!ts) return '尚未保存'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
