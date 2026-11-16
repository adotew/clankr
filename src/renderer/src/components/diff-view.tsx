import { useCallback, useEffect, useMemo, useState } from 'react'
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { ChevronRight } from 'lucide-react'

import { PanelHeader } from '@/components/panel'
import { font } from '@/lib/terminal'
import { cn } from '@/lib/utils'

// A transparent base lets the pane show through; diffs mixes its line colors from it, so they turn translucent too.
// Code uses the terminal's font at the app's text sizes; headers and separators use the app's own font.
// Headers are solid in the pane's colour (its 50% sidebar tint over the background) and sit above the gutter (z-index 3), so
// code never shows through a sticky one. Separators stay fainter than headers so files read as the main divisions.
const unsafeCSS = `
  :host {
    --diffs-bg: transparent;
    --diffs-font-family: ${font};
    --diffs-font-size: 12px;
    --diffs-line-height: 18px;
    --diffs-font-features: "liga" 0, "calt" 0;
    --diffs-header-font-family: ui-sans-serif, system-ui, sans-serif;
    --diffs-bg-separator-override: color-mix(in oklab, var(--foreground) 2%, transparent);
  }
  [data-diffs-header],
  [data-diffs-header][data-sticky] {
    font-size: 12px;
    min-height: 32px;
    z-index: 10;
    background-color: color-mix(in srgb, var(--sidebar) 50%, var(--background));
  }
  /* Covers the diff list's 8px top padding too, so code doesn't scroll past above a stuck header. */
  [data-diffs-header][data-sticky] {
    top: -8px;
  }
`
const base = { themeType: 'system', hunkSeparators: 'simple', overflow: 'wrap', stickyHeader: true, unsafeCSS } as const
const split = { ...base, diffStyle: 'split' } as const
const stacked = { ...base, diffStyle: 'unified' } as const
// Below this width, side-by-side columns get too narrow to read.
const SPLIT_MIN_WIDTH = 900

// Uncommitted changes in `cwd`; refreshes when shown, whenever the agent finishes a turn, and every few seconds
// while shown to catch edits from the terminal, an editor, or mid-turn tool calls.
export function DiffView({ cwd, visible }: { cwd?: string; visible: boolean }) {
  // null while loading; undefined outside a git repo.
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
    const off = window.api.onEvent((_, e) => e.kind === 'done' && load())
    // shortcut: polls `git diff`; switch to a file watcher in main if this gets slow on big repos.
    const timer = setInterval(load, 2000)
    return () => {
      stale = true
      off()
      clearInterval(timer)
    }
  }, [cwd, visible])

  const files = useMemo(() => (patch ? parsePatchFiles(patch).flatMap((p) => p.files) : []), [patch])

  const message = !cwd || patch === undefined ? 'Not a git repository' : patch === null ? null : !files.length && 'No changes'
  return (
    <>
      <PanelHeader>
        {files.length > 0 && (
          <span className="px-1 text-xs text-muted-foreground">
            {files.length} {files.length === 1 ? 'file' : 'files'} changed
          </span>
        )}
      </PanelHeader>
      {message !== false ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{message}</div>
      ) : (
        <div ref={measure} className="min-h-0 flex-1 space-y-2 overflow-auto px-2 pb-2">
          {files.map((file) => (
            <FileItem key={file.prevName ? `${file.prevName}→${file.name}` : file.name} file={file} wide={wide} />
          ))}
        </div>
      )}
    </>
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
