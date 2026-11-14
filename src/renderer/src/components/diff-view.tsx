import { useCallback, useEffect, useMemo, useState } from 'react'
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

// A transparent base lets the pane show through; diffs mixes its line colors from it, so they turn translucent too.
// The sticky header gets the pane's own tint and blur so code doesn't show through it while scrolling.
const unsafeCSS = `
  :host { --diffs-bg: transparent; }
  [data-diffs-header][data-sticky] {
    background-color: color-mix(in oklab, var(--sidebar) 80%, transparent);
    backdrop-filter: blur(24px);
  }
`
const base = { themeType: 'system', overflow: 'wrap', stickyHeader: true, unsafeCSS } as const
const split = { ...base, diffStyle: 'split' } as const
const stacked = { ...base, diffStyle: 'unified' } as const
// Below this width, side-by-side columns get too narrow to read.
const SPLIT_MIN_WIDTH = 900

// Uncommitted changes in `cwd`; refreshes when shown and whenever the agent finishes a turn.
export function DiffView({ cwd, visible }: { cwd?: string; visible: boolean }) {
  const [patch, setPatch] = useState<string | undefined | null>(null)
  const [wide, setWide] = useState(false)
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= SPLIT_MIN_WIDTH))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !cwd) return
    let stale = false
    const load = () =>
      window.api.diff(cwd).then(
        (p) => stale || setPatch(p),
        () => stale || setPatch(undefined),
      )
    load()
    const off = window.api.onEvent((e) => e.kind === 'done' && load())
    return () => {
      stale = true
      off()
    }
  }, [cwd, visible])

  const files = useMemo(() => (patch ? parsePatchFiles(patch).flatMap((p) => p.files) : []), [patch])

  const message = !cwd || patch === undefined ? 'Not a git repository' : patch === null ? null : !files.length && 'No changes'
  if (message !== false) return <Centered>{message}</Centered>
  return (
    <div ref={measure} className="min-h-0 flex-1 space-y-2 overflow-auto px-2 pb-2">
      {files.map((file) => (
        <FileItem key={file.prevName ? `${file.prevName}→${file.name}` : file.name} file={file} wide={wide} />
      ))}
    </div>
  )
}

// Keyed by path, so a file stays collapsed across refreshes.
function FileItem({ file, wide }: { file: FileDiffMetadata; wide: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const options = useMemo(() => ({ ...(wide ? split : stacked), collapsed }), [wide, collapsed])
  return (
    <FileDiff
      fileDiff={file}
      options={options}
      renderHeaderPrefix={() => (
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand file' : 'Collapse file'}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')} />
        </button>
      )}
    />
  )
}

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{children}</div>
)
