type Props = {
  title: string
  storyId: string
  startNodeId: string
  dirty: boolean
  savedLabel: string
  saveFlash: boolean
  onTitle: (v: string) => void
  onStoryId: (v: string) => void
  onNew: () => void
  onImport: (file: File) => void
  onExport: () => void
  onSave: () => void
  onPreview: () => void
  onLoadFragment01: () => void
}

export function Toolbar({
  title,
  storyId,
  startNodeId,
  dirty,
  savedLabel,
  saveFlash,
  onTitle,
  onStoryId,
  onNew,
  onImport,
  onExport,
  onSave,
  onPreview,
  onLoadFragment01,
}: Props) {
  return (
    <header className="toolbar">
      <div className="brand">剧情分支编辑器</div>
      <input
        className="title-input"
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        placeholder="故事标题"
      />
      <input
        className="id-input"
        value={storyId}
        onChange={(e) => onStoryId(e.target.value)}
        placeholder="id"
      />
      <span className="start-hint">起点: {startNodeId || '未设置'}</span>
      <span className={`save-status ${dirty ? 'dirty' : ''} ${saveFlash ? 'flash' : ''}`}>
        {saveFlash ? '已保存' : dirty ? '未保存' : `已保存 ${savedLabel}`}
      </span>
      <div className="spacer" />
      <button type="button" className="btn" onClick={onLoadFragment01} title="重新载入档案中的片段01">
        片段01
      </button>
      <button type="button" className="btn" onClick={onNew}>
        新建
      </button>
      <label className="btn file-btn">
        导入
        <input
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImport(f)
            e.target.value = ''
          }}
        />
      </label>
      <button type="button" className="btn" onClick={onExport}>
        导出
      </button>
      <button
        type="button"
        className="btn"
        onClick={onSave}
        title="Ctrl+S 保存到本机，下次打开自动载入"
      >
        保存
      </button>
      <button type="button" className="btn primary" onClick={onPreview}>
        预览
      </button>
    </header>
  )
}
