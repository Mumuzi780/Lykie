import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { HandleEditContext } from '../handles/HandleEditContext'
import type { HandleLayout } from '../handles/layout'
import { ChoiceNode } from '../nodes/ChoiceNode'
import { EndNode } from '../nodes/EndNode'
import { FreeReplyNode } from '../nodes/FreeReplyNode'
import { LykieNode } from '../nodes/LykieNode'
import { SystemNode } from '../nodes/SystemNode'
import { WaitNode } from '../nodes/WaitNode'
import {
  OUT_HANDLE,
  TIMEOUT_HANDLE,
  defaultData,
  type StoryNodeType,
  uid,
} from '../types'

const nodeTypes = {
  lykie: LykieNode,
  choice: ChoiceNode,
  free_reply: FreeReplyNode,
  system: SystemNode,
  wait: WaitNode,
  end: EndNode,
}

type Snapshot = { nodes: Node[]; edges: Edge[] }

type Props = {
  initialNodes: Node[]
  initialEdges: Edge[]
  startNodeId: string
  onSelectionChange: (node: Node | null) => void
  onGraphChange: (nodes: Node[], edges: Edge[]) => void
  registerApi: (api: {
    addNode: (type: StoryNodeType, position?: { x: number; y: number }) => void
    setGraph: (nodes: Node[], edges: Edge[]) => void
    deleteNode: (id: string) => void
    updateNodeData: (id: string, data: Record<string, unknown>) => void
  }) => void
}

function cloneGraph(nodes: Node[], edges: Edge[]): Snapshot {
  return {
    nodes: nodes.map((n) => ({
      ...n,
      position: { ...n.position },
      data: { ...(n.data as object) },
    })),
    edges: edges.map((e) => ({ ...e })),
  }
}

function edgeLabel(connection: Connection, nodes: Node[]): string | undefined {
  const handle = connection.sourceHandle
  if (!handle || handle === OUT_HANDLE) return undefined
  if (handle === TIMEOUT_HANDLE) return '超时'
  const src = nodes.find((n) => n.id === connection.source)
  const data = src?.data as {
    options?: { id: string; label: string }[]
    branches?: { id: string; label: string }[]
  }
  const opt =
    data?.options?.find((o) => o.id === handle) ||
    data?.branches?.find((o) => o.id === handle)
  return opt?.label?.slice(0, 10) || handle
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

export function EditorCanvas({
  initialNodes,
  initialEdges,
  startNodeId,
  onSelectionChange,
  onGraphChange,
  registerApi,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const { screenToFlowPosition } = useReactFlow()
  const [altHeld, setAltHeld] = useState(false)

  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const selectedEdgeIdsRef = useRef<string[]>([])
  const selectedNodeIdsRef = useRef<string[]>([])
  nodesRef.current = nodes
  edgesRef.current = edges

  const pastRef = useRef<Snapshot[]>([])
  const futureRef = useRef<Snapshot[]>([])
  const applyingHistory = useRef(false)

  const commit = useCallback(() => {
    if (applyingHistory.current) return
    pastRef.current.push(cloneGraph(nodesRef.current, edgesRef.current))
    if (pastRef.current.length > 80) pastRef.current.shift()
    futureRef.current = []
  }, [])

  const undo = useCallback(() => {
    const past = pastRef.current
    if (!past.length) return
    const cur = cloneGraph(nodesRef.current, edgesRef.current)
    const prev = past.pop()!
    futureRef.current.push(cur)
    applyingHistory.current = true
    setNodes(prev.nodes)
    setEdges(prev.edges)
    queueMicrotask(() => {
      applyingHistory.current = false
    })
  }, [setNodes, setEdges])

  const redo = useCallback(() => {
    const future = futureRef.current
    if (!future.length) return
    const cur = cloneGraph(nodesRef.current, edgesRef.current)
    const next = future.pop()!
    pastRef.current.push(cur)
    applyingHistory.current = true
    setNodes(next.nodes)
    setEdges(next.edges)
    queueMicrotask(() => {
      applyingHistory.current = false
    })
  }, [setNodes, setEdges])

  useEffect(() => {
    onGraphChange(nodes, edges)
  }, [nodes, edges, onGraphChange])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'AltLeft') {
        e.preventDefault()
        setAltHeld(true)
      }

      if (isTypingTarget(e.target)) return

      // 选中连线时 Backspace/Delete 只删线，保留节点与接口
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const edgeIds = selectedEdgeIdsRef.current
        const nodeIds = selectedNodeIdsRef.current
        if (edgeIds.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          commit()
          const remove = new Set(edgeIds)
          setEdges((eds) => eds.filter((ed) => !remove.has(ed.id)))
          selectedEdgeIdsRef.current = []
          return
        }
        if (nodeIds.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          commit()
          const remove = new Set(nodeIds)
          setNodes((nds) => nds.filter((n) => !remove.has(n.id)))
          setEdges((eds) =>
            eds.filter((ed) => !remove.has(ed.source) && !remove.has(ed.target)),
          )
          selectedNodeIdsRef.current = []
          return
        }
      }

      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'AltLeft' || e.key === 'Alt') setAltHeld(false)
    }
    const onBlur = () => setAltHeld(false)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [undo, redo, commit, setEdges, setNodes])

  const setHandleLayout = useCallback(
    (nodeId: string, handleId: string, layout: HandleLayout) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n
          const data = { ...(n.data as Record<string, unknown>) }
          const map = {
            ...((data.handleLayout as Record<string, HandleLayout>) || {}),
          }
          map[handleId] = layout
          data.handleLayout = map
          return { ...n, data }
        }),
      )
    },
    [setNodes],
  )

  const dataEditSession = useRef(false)

  const handleEditApi = useMemo(
    () => ({
      altHeld,
      beginHandleDrag: () => {
        commit()
      },
      setHandleLayout,
    }),
    [altHeld, setHandleLayout, commit],
  )

  useEffect(() => {
    registerApi({
      addNode: (type, position) => {
        commit()
        const id = uid('n')
        const node: Node = {
          id,
          type,
          position: position || {
            x: 120 + Math.random() * 80,
            y: 100 + Math.random() * 80,
          },
          data: defaultData(type),
        }
        setNodes((nds) => nds.concat(node))
      },
      setGraph: (n, e) => {
        setNodes(n)
        setEdges(e)
        pastRef.current = []
        futureRef.current = []
        dataEditSession.current = false
      },
      deleteNode: (id) => {
        commit()
        setNodes((nds) => nds.filter((n) => n.id !== id))
        setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
      },
      updateNodeData: (id, data) => {
        if (!dataEditSession.current) {
          commit()
          dataEditSession.current = true
        }
        setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: { ...data } } : n)),
        )
      },
    })
  }, [registerApi, setNodes, setEdges, commit])

  const onConnect = useCallback(
    (connection: Connection) => {
      commit()
      setEdges((eds) => {
        const label = edgeLabel(connection, nodesRef.current)
        return addEdge(
          {
            ...connection,
            id: uid('e'),
            label,
            sourceHandle: connection.sourceHandle || OUT_HANDLE,
          },
          eds,
        )
      })
    },
    [commit, setEdges],
  )

  const onSel = useCallback(
    ({ nodes: ns, edges: es }: OnSelectionChangeParams) => {
      dataEditSession.current = false
      selectedNodeIdsRef.current = ns.map((n) => n.id)
      selectedEdgeIdsRef.current = es.map((e) => e.id)
      onSelectionChange(ns[0] || null)
    },
    [onSelectionChange],
  )

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      const type = e.dataTransfer.getData('application/story-node') as StoryNodeType
      if (!type) return
      commit()
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const id = uid('n')
      setNodes((nds) =>
        nds.concat({
          id,
          type,
          position,
          data: defaultData(type),
        }),
      )
    },
    [screenToFlowPosition, setNodes, commit],
  )

  const onNodeDragStart = useCallback(() => {
    commit()
  }, [commit])

  const wrappedEdgesChange: typeof onEdgesChange = useCallback(
    (changes) => {
      const destructive = changes.some(
        (c) => c.type === 'remove' || (c.type === 'add' ? false : false),
      )
      if (destructive) commit()
      onEdgesChange(changes)
    },
    [onEdgesChange, commit],
  )

  const wrappedNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      const destructive = changes.some((c) => c.type === 'remove')
      if (destructive) commit()
      onNodesChange(changes)
    },
    [onNodesChange, commit],
  )

  const styledNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        className: n.id === startNodeId ? 'is-start' : undefined,
      })),
    [nodes, startNodeId],
  )

  return (
    <HandleEditContext.Provider value={handleEditApi}>
      <div
        className={`canvas-wrap ${altHeld ? 'alt-held' : ''}`}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {altHeld && (
          <div className="space-hint">左 Alt + 左键：拖动接口 · 空格：拖动画布</div>
        )}
        <ReactFlow
          nodes={styledNodes}
          edges={edges}
          onNodesChange={wrappedNodesChange}
          onEdgesChange={wrappedEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSel}
          onNodeDragStart={onNodeDragStart}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={null}
          panOnDrag={false}
          panActivationKeyCode="Space"
          selectionOnDrag={!altHeld}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode={null}
          multiSelectionKeyCode="Shift"
          nodesDraggable={!altHeld}
          nodesConnectable={!altHeld}
          elementsSelectable
          edgesFocusable
          selectNodesOnDrag
          defaultEdgeOptions={{
            interactionWidth: 28,
            selectable: true,
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              switch (n.type) {
                case 'lykie':
                  return '#3b82f6'
                case 'choice':
                  return '#f59e0b'
                case 'free_reply':
                  return '#14b8a6'
                case 'system':
                  return '#8b5cf6'
                case 'wait':
                  return '#64748b'
                case 'end':
                  return '#ef4444'
                default:
                  return '#94a3b8'
              }
            }}
          />
        </ReactFlow>
      </div>
    </HandleEditContext.Provider>
  )
}
