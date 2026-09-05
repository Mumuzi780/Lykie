import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { EditorCanvas } from './canvas/EditorCanvas'
import { formatSavedAt, loadDraft, saveDraft } from './io/persistence'
import { downloadJson, emptyGraph, fragment01Graph, fromStoryGraph, toStoryGraph } from './io/serialize'
import { Inspector } from './panels/Inspector'
import { Palette } from './panels/Palette'
import { Toolbar } from './panels/Toolbar'
import { PreviewModal } from './preview/PreviewModal'
import type { StoryNodeType } from './types'

const IDLE_SAVE_MS = 30_000
const INTERVAL_SAVE_MS = 5 * 60_000

type CanvasApi = {
  addNode: (type: StoryNodeType, position?: { x: number; y: number }) => void
  setGraph: (nodes: Node[], edges: Edge[]) => void
  deleteNode: (id: string) => void
  updateNodeData: (id: string, data: Record<string, unknown>) => void
}

function contentFingerprint(
  id: string,
  title: string,
  startNodeId: string,
  nodes: Node[],
  edges: Edge[],
) {
  return JSON.stringify(
    toStoryGraph(id, title, startNodeId, nodes, edges),
  )
}

function initialLoad() {
  const draft = loadDraft()
  if (draft) {
    return { ...fromStoryGraph(draft.graph), savedAt: draft.savedAt }
  }
  return { ...fromStoryGraph(fragment01Graph), savedAt: null as number | null }
}

export default function App() {
  const loaded = initialLoad()

  const [storyId, setStoryId] = useState(loaded.id)
  const [title, setTitle] = useState(loaded.title)
  const [startNodeId, setStartNodeId] = useState(loaded.startNodeId)
  const [selected, setSelected] = useState<Node | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(loaded.savedAt)
  const [saveFlash, setSaveFlash] = useState(false)
  const [dirty, setDirty] = useState(false)

  const nodesRef = useRef<Node[]>(loaded.nodes)
  const edgesRef = useRef<Edge[]>(loaded.edges)
  const apiRef = useRef<CanvasApi | null>(null)
  const storyIdRef = useRef(storyId)
  const titleRef = useRef(title)
  const startNodeIdRef = useRef(startNodeId)
  const dirtyRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedFpRef = useRef(
    contentFingerprint(loaded.id, loaded.title, loaded.startNodeId, loaded.nodes, loaded.edges),
  )

  storyIdRef.current = storyId
  titleRef.current = title
  startNodeIdRef.current = startNodeId
  dirtyRef.current = dirty

  const [canvasKey, setCanvasKey] = useState(0)
  const [seedNodes, setSeedNodes] = useState(loaded.nodes)
  const [seedEdges, setSeedEdges] = useState(loaded.edges)

  const persist = useCallback((reason: 'manual' | 'idle' | 'interval') => {
    const graph = toStoryGraph(
      storyIdRef.current,
      titleRef.current,
      startNodeIdRef.current,
      nodesRef.current,
      edgesRef.current,
    )
    const at = saveDraft(graph)
    savedFpRef.current = JSON.stringify(graph)
    setSavedAt(at)
    setDirty(false)
    dirtyRef.current = false
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (reason === 'manual') {
      setSaveFlash(true)
      window.setTimeout(() => setSaveFlash(false), 1200)
    }
  }, [])

  const syncDirtyFromContent = useCallback(() => {
    const fp = contentFingerprint(
      storyIdRef.current,
      titleRef.current,
      startNodeIdRef.current,
      nodesRef.current,
      edgesRef.current,
    )
    const nextDirty = fp !== savedFpRef.current
    if (nextDirty === dirtyRef.current) {
      if (nextDirty) {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        idleTimerRef.current = setTimeout(() => {
          if (dirtyRef.current) persist('idle')
        }, IDLE_SAVE_MS)
      }
      return
    }
    setDirty(nextDirty)
    dirtyRef.current = nextDirty
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (nextDirty) {
      idleTimerRef.current = setTimeout(() => {
        if (dirtyRef.current) persist('idle')
      }, IDLE_SAVE_MS)
    }
  }, [persist])

  const onGraphChange = useCallback(
    (nodes: Node[], edges: Edge[]) => {
      nodesRef.current = nodes
      edgesRef.current = edges
      syncDirtyFromContent()
    },
    [syncDirtyFromContent],
  )

  const registerApi = useCallback((api: CanvasApi) => {
    apiRef.current = api
  }, [])

  const reloadGraph = (
    nodes: Node[],
    edges: Edge[],
    meta: { id: string; title: string; start: string },
  ) => {
    setStoryId(meta.id)
    setTitle(meta.title)
    setStartNodeId(meta.start)
    storyIdRef.current = meta.id
    titleRef.current = meta.title
    startNodeIdRef.current = meta.start
    setSeedNodes(nodes)
    setSeedEdges(edges)
    nodesRef.current = nodes
    edgesRef.current = edges
    setSelected(null)
    setCanvasKey((k) => k + 1)
    queueMicrotask(() => syncDirtyFromContent())
  }

  const handleNew = () => {
    if (!confirm('新建将清空当前画布，确定？')) return
    const g = emptyGraph()
    const { nodes, edges, startNodeId: s, id, title: t } = fromStoryGraph(g)
    reloadGraph(nodes, edges, { id, title: t, start: s })
    queueMicrotask(() => persist('manual'))
  }

  const handleLoadFragment01 = () => {
    if (!confirm('重新加载「期末错接」片段01？未保存的修改会丢失。')) return
    const { nodes, edges, startNodeId: s, id, title: t } = fromStoryGraph(fragment01Graph)
    reloadGraph(nodes, edges, { id, title: t, start: s })
  }

  const handleExport = () => {
    const graph = toStoryGraph(storyId, title, startNodeId, nodesRef.current, edgesRef.current)
    downloadJson(`${storyId || 'story'}.json`, graph)
  }

  const handleSave = useCallback(() => {
    persist('manual')
  }, [persist])

  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      const raw = JSON.parse(text)
      const { nodes, edges, startNodeId: s, id, title: t } = fromStoryGraph(raw)
      reloadGraph(nodes, edges, { id, title: t, start: s || nodes[0]?.id || '' })
    } catch (e) {
      alert(`导入失败：${e}`)
    }
  }

  const onTitle = (v: string) => {
    setTitle(v)
    titleRef.current = v
    syncDirtyFromContent()
  }
  const onStoryId = (v: string) => {
    setStoryId(v)
    storyIdRef.current = v
    syncDirtyFromContent()
  }
  const onSetStart = (id: string) => {
    setStartNodeId(id)
    startNodeIdRef.current = id
    syncDirtyFromContent()
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() !== 's') return
      e.preventDefault()
      handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (dirtyRef.current) persist('interval')
    }, INTERVAL_SAVE_MS)
    return () => clearInterval(id)
  }, [persist])

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [])

  // 离开页面前若有未保存改动，再写一次
  useEffect(() => {
    const onBeforeUnload = () => {
      if (dirtyRef.current) {
        saveDraft(
          toStoryGraph(
            storyIdRef.current,
            titleRef.current,
            startNodeIdRef.current,
            nodesRef.current,
            edgesRef.current,
          ),
        )
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return (
    <div className="app-shell">
      <Toolbar
        title={title}
        storyId={storyId}
        startNodeId={startNodeId}
        dirty={dirty}
        savedLabel={formatSavedAt(savedAt)}
        saveFlash={saveFlash}
        onTitle={onTitle}
        onStoryId={onStoryId}
        onNew={handleNew}
        onImport={handleImport}
        onExport={handleExport}
        onSave={handleSave}
        onPreview={() => setPreviewOpen(true)}
        onLoadFragment01={handleLoadFragment01}
      />
      <div className="main-row">
        <Palette onAdd={(type) => apiRef.current?.addNode(type)} />
        <ReactFlowProvider key={canvasKey}>
          <EditorCanvas
            initialNodes={seedNodes}
            initialEdges={seedEdges}
            startNodeId={startNodeId}
            onSelectionChange={setSelected}
            onGraphChange={onGraphChange}
            registerApi={registerApi}
          />
        </ReactFlowProvider>
        <Inspector
          node={selected}
          startNodeId={startNodeId}
          onChange={(id, data) => {
            apiRef.current?.updateNodeData(id, data)
            setSelected((s) => (s && s.id === id ? { ...s, data } : s))
          }}
          onSetStart={onSetStart}
          onDelete={(id) => {
            if (id === startNodeId) {
              alert('请先把起点改到其他节点，再删除')
              return
            }
            apiRef.current?.deleteNode(id)
            setSelected(null)
          }}
        />
      </div>
      <PreviewModal
        open={previewOpen}
        nodes={nodesRef.current}
        edges={edgesRef.current}
        startNodeId={startNodeId}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  )
}
