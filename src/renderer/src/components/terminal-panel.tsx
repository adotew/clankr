import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Columns2Icon, Rows2Icon, XIcon } from 'lucide-react'
import { FitAddon, init, Terminal } from 'ghostty-web'

import { BrowserView } from '@/components/browser-view'
import { cursorTrail, sweepCursor } from '@/components/cursor-trail'
import { DiffView } from '@/components/diff-view'
import { DocsView } from '@/components/docs-view'
import { PanelHeader, type PanelView } from '@/components/panel'
import { ResizeHandle, useStoredWidth } from '@/components/resize-handle'
import { Button } from '@/components/ui/button'
import { arrows, neighbour, pct, rects, removePane, splitPane, type Dir, type Layout } from '@/lib/panes'
import { font, hidden, idle, repaint, themes } from '@/lib/terminal'
import { folderName } from '@/lib/ui'
import { cn } from '@/lib/utils'

// The last pane to show a cursor, so focusing another can sweep the cursor across to it.
let lastFocused: HTMLCanvasElement | undefined

function TerminalPane({
  cwd,
  visible,
  focused,
  split,
  onFocus,
  onProc,
  onExit,
}: {
  cwd?: string
  visible: boolean
  focused: boolean
  split: boolean
  onFocus: () => void
  onProc: (name: string) => void
  onExit: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [term, setTerm] = useState<Terminal>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ focused, onProc, onExit })
  latest.current = { focused, onProc, onExit }

  // A pane keeps its shell for life; a new folder starts new panes.
  useEffect(() => {
    let disposed = false
    const cleanups: (() => void)[] = []

    ;(async () => {
      await Promise.all([init(), document.fonts.load(`12px ${font}`)])
      if (disposed || !ref.current) return
      const dark = document.documentElement.classList.contains('dark')
      const t = new Terminal({
        fontSize: 12,
        fontFamily: font,
        cursorBlink: latest.current.focused,
        cursorStyle: 'bar',
        theme: dark ? themes.dark : themes.light,
      })
      const fit = new FitAddon()
      t.loadAddon(fit)
      t.open(ref.current)
      fit.fit()
      fit.observeResize()
      cleanups.push(() => t.dispose())
      canvas.current = ref.current.querySelector('canvas')
      if (canvas.current) {
        cleanups.push(cursorTrail(canvas.current))
        if (latest.current.focused) lastFocused = canvas.current
        else idle.add(canvas.current)
      }

      const { id, name } = await window.api.term.start(cwd, t.cols, t.rows)
      if (disposed) return window.api.term.kill(id)
      latest.current.onProc(name)
      const input = t.onData((data) => window.api.term.input(id, data))
      const resize = t.onResize(({ cols, rows }) => window.api.term.resize(id, cols, rows))
      cleanups.push(
        window.api.term.onData((pane, data) => pane === id && t.write(data)),
        window.api.term.onProc((pane, name) => pane === id && latest.current.onProc(name)),
        window.api.term.onExit((pane) => pane === id && latest.current.onExit()),
        () => input.dispose(),
        () => resize.dispose(),
        () => window.api.term.kill(id),
      )
      setTerm(t)
    })()

    return () => {
      disposed = true
      for (const fn of cleanups) fn()
    }
  }, [])

  // Only the active pane shows a cursor.
  useEffect(() => {
    const c = canvas.current
    if (!term || !c) return
    term.options.cursorBlink = focused
    if (focused) {
      idle.delete(c)
      if (lastFocused && lastFocused !== c) sweepCursor(lastFocused, c)
      lastFocused = c
    } else idle.add(c)
    repaint.add(c)
    if (focused) term.focus()
  }, [term, focused])

  // A hidden pane doesn't draw, even as output arrives; it redraws in full when it shows again.
  useEffect(() => {
    const c = canvas.current
    if (!term || !c) return
    if (!visible) return void hidden.add(c)
    hidden.delete(c)
    repaint.add(c)
  }, [term, visible])

  return (
    <div
      ref={ref}
      onFocus={onFocus}
      className={cn(
        'h-full overflow-hidden rounded-xl pt-1 pl-2 caret-transparent transition-opacity',
        // A lone pane blends into the panel; splits become separate boxes, with inactive ones dimmed.
        split && 'bg-foreground/5',
        split && !focused && 'opacity-60',
      )}
    />
  )
}

export function TerminalPanel({
  cwd,
  thread,
  browserOpen,
  visible,
  view,
  doc,
  onDoc,
  onExit,
}: {
  cwd?: string
  thread?: string
  browserOpen?: { url: string }
  visible: boolean
  view: PanelView
  // The Markdown file open in the docs view; its file list when undefined.
  doc?: string
  onDoc: (doc: string | undefined) => void
  onExit: () => void
}) {
  const asideRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useStoredWidth('terminalWidth', Math.round(innerWidth * 0.42))
  const [layout, setLayout] = useState<Layout | undefined>({ pane: 0 })
  const [active, setActive] = useState(0)
  const nextId = useRef(1)
  // The program each pane's shell has in the foreground, e.g. "nvim"; the header shows the active pane's.
  const [procs, setProcs] = useState<Record<number, string>>({})
  const panes = rects(layout)

  // Switching project keeps the panel open and starts over with one fresh shell in the new folder.
  const [shellCwd, setShellCwd] = useState(cwd)
  if (cwd !== shellCwd) {
    setShellCwd(cwd)
    setProcs({})
    setLayout({ pane: nextId.current })
    setActive(nextId.current++)
  }

  // Mounted on first open and then kept, so switching tabs doesn't reload the page.
  const browserOpened = useRef(false)
  if (view === 'browser') browserOpened.current = true
  // A fresh browser per thread, except when a new thread gets its id on the first send.
  const browser = useRef({ key: 0, thread })
  if (browser.current.thread !== thread) {
    if (browser.current.thread !== undefined) browser.current.key++
    browser.current.thread = thread
  }

  const split = (dir: Dir) => {
    if (!layout) return
    const pane = nextId.current++
    setLayout(splitPane(layout, active, dir, pane))
    setActive(pane)
  }
  const close = (pane: number) => setLayout((l) => l && removePane(l, pane))
  const focusDir = (d: readonly [number, number]) => {
    const pane = neighbour(panes, active, d)
    if (pane !== undefined) setActive(pane)
  }
  const latest = useRef({ split, close, focusDir, view, active })
  latest.current = { split, close, focusDir, view, active }
  // Buttons in the header for the shortcuts below.
  const paneActions = [
    { label: 'Split right', keys: '⌘D', icon: <Columns2Icon className="size-3.5" />, run: () => split('row') },
    { label: 'Split down', keys: '⇧⌘D', icon: <Rows2Icon className="size-3.5" />, run: () => split('col') },
    { label: 'Close pane', keys: '⌘W', icon: <XIcon className="size-3.5" />, run: () => close(active) },
  ]

  useEffect(() => {
    if (panes.length === 0) onExit()
    else if (!panes.some(([p]) => p === active)) setActive(panes[panes.length - 1][0])
  }, [layout])

  useEffect(() => {
    // ghostty-web sends Cmd shortcuts to the shell and cancels them, so Cmd+Q, Cmd+W and the
    // menu never fire. Stop them above the terminal; the app's own handlers run earlier, on window.
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      e.stopPropagation()
      const { view, active } = latest.current
      if (e.ctrlKey || view !== 'terminal') return
      if (e.altKey) {
        // Cmd+Option+Arrow moves focus to the neighbouring pane.
        if (!(e.code in arrows)) return
        latest.current.focusDir(arrows[e.code as keyof typeof arrows])
        e.preventDefault()
        return
      }
      // Cmd+D splits right and Cmd+Shift+D splits down, as in Ghostty; Cmd+W closes the active pane.
      // preventDefault also stops the menu's Cmd+W from closing the window.
      if (e.code === 'KeyD') latest.current.split(e.shiftKey ? 'col' : 'row')
      else if (e.code === 'KeyW' && !e.shiftKey) latest.current.close(active)
      else return
      e.preventDefault()
    }
    const aside = asideRef.current
    aside?.addEventListener('keydown', onKey, true)
    return () => aside?.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    // No left margin: the chat's scrollbar runs right along the panel edge.
    // Toggling slides the panel past the window edge with a negative margin of its full width, which is the same
    // clamp as its sizing classes. Closed, it stays laid out there but invisible, so the terminals keep their size
    // and nothing redraws when it opens.
    <aside
      ref={asideRef}
      data-slot="side-panel"
      data-open={visible || undefined}
      className={cn(
        'relative my-2 flex max-w-[70%] min-w-80 shrink-0 duration-300 ease-in-out motion-reduce:transition-none',
        // Visibility only animates on close: animated on open too, the panel stays hidden for its first frame and
        // can't take focus then.
        visible
          ? 'mr-2 transition-[margin-right] starting:mr-(--hidden-margin)'
          : 'invisible mr-(--hidden-margin) transition-[margin-right,visibility]',
      )}
      style={{ width, '--hidden-margin': `calc(-1 * max(20rem, min(${width}px, 70%)))` } as CSSProperties}
    >
      {/* The panel is inset 8px from the window's right edge. */}
      <ResizeHandle
        // Clamp to the same bounds as min-w-80 and max-w-[70%], so dragging back responds immediately.
        onDrag={(x) =>
          setWidth(
            Math.max(320, Math.min(innerWidth - 8 - x, (asideRef.current?.parentElement?.clientWidth ?? innerWidth) * 0.7)),
          )
        }
        className="left-0"
      />
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-sidebar/50 backdrop-blur-xl">
        {/* Hidden with `invisible`, not `hidden`, so the terminals keep their size and don't reflow. Each view below
            covers the panel with its own header. */}
        <div className={cn('flex min-h-0 flex-1 flex-col', view !== 'terminal' && 'invisible')}>
          <PanelHeader>
            <span className="truncate px-1 text-xs text-muted-foreground" title={cwd}>
              {procs[active] ?? (cwd && folderName(cwd))}
            </span>
            <div className="ml-auto flex shrink-0 items-center text-muted-foreground">
              {paneActions.map(({ label, keys, icon, run }) => (
                <Button key={label} variant="ghost" size="icon-sm" onClick={run} aria-label={label} title={`${label} (${keys})`}>
                  {icon}
                </Button>
              ))}
            </div>
            <div className="mx-1 h-4 w-px shrink-0 bg-foreground/10" />
          </PanelHeader>
          {/* Each pane is padded 4px, so neighbours sit 8px apart and 8px from the panel edge. */}
          <div className="relative mx-1 mb-1 min-h-0 flex-1">
            {panes.map(([pane, r]) => (
              <div
                key={pane}
                className="absolute p-1"
                style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
              >
                <TerminalPane
                  cwd={cwd}
                  visible={visible && view === 'terminal'}
                  focused={visible && view === 'terminal' && active === pane}
                  split={panes.length > 1}
                  onFocus={() => setActive(pane)}
                  onProc={(name) => setProcs((p) => ({ ...p, [pane]: name }))}
                  onExit={() => close(pane)}
                />
              </div>
            ))}
          </div>
        </div>
        {view === 'diff' && (
          <div className="absolute inset-0 flex flex-col">
            <DiffView key={cwd} cwd={cwd} visible={visible} />
          </div>
        )}
        {view === 'docs' && (
          <div className="absolute inset-0 flex flex-col">
            <DocsView key={cwd} cwd={cwd} visible={visible} doc={doc} onDoc={onDoc} />
          </div>
        )}
        {browserOpened.current && (
          <div className={cn('absolute inset-0 flex flex-col', view !== 'browser' && 'invisible')}>
            <BrowserView key={browser.current.key} thread={thread} open={browserOpen} />
          </div>
        )}
      </div>
    </aside>
  )
}
