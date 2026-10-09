import type { StoryNodeType } from '../types'
import { typeLabel } from '../types'

const items: StoryNodeType[] = ['lykie', 'choice', 'free_reply', 'system', 'wait', 'end']

type Props = {
  onAdd: (type: StoryNodeType) => void
}

export function Palette({ onAdd }: Props) {
  return (
    <aside className="palette">
      <h3>节点</h3>
      <p className="hint">点击添加到画布</p>
      {items.map((t) => (
        <button
          key={t}
          type="button"
          className={`palette-btn ${t}`}
          onClick={() => onAdd(t)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/story-node', t)
            e.dataTransfer.effectAllowed = 'move'
          }}
        >
          {typeLabel(t)}
        </button>
      ))}
    </aside>
  )
}
