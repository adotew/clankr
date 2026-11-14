import { useEffect, useRef, useState } from 'react'
import { FileDiffIcon, GlobeIcon, SquareTerminalIcon } from 'lucide-react'
import { CanvasRenderer, FitAddon, init, Terminal } from 'ghostty-web'

import { cn } from '@/lib/utils'
import { BrowserView } from './browser-view'
import { cursorTrail } from './cursor-trail'
import { DiffView } from './diff-view'
import { ResizeHandle, useStoredWidth } from './resize-handle'

const font = '"JetBrainsMono Nerd Font", "JetBrainsMono NF", monospace'

// Make ghostty-web render like native Ghostty.
type Metrics = { width: number; height: number; baseline: number }
// SAFETY: these are private CanvasRenderer members in ghostty-web 0.4; recheck when upgrading.
const renderer = CanvasRenderer.prototype as unknown as {
  measureFont(this: { fontSize: number; fontFamily: string }): Metrics
  resize(this: { ctx: CanvasRenderingContext2D; theme: { background: string } }, cols: number, rows: number): void
}
const transparent = new WeakSet<CanvasRenderingContext2D>()

// Chromium hints and smooths canvas text on macOS, making glyphs ~30% heavier than Ghostty's.
// Resizing the canvas resets its state, so reapply after every resize.
// Also clear wherever ghostty-web paints the theme background, so the translucent panel shows through.
const resize = renderer.resize
renderer.resize = function (cols, rows) {
  resize.call(this, cols, rows)
  const ctx = this.ctx
  ctx.textRendering = 'geometricPrecision'
  if (transparent.has(ctx)) return
  transparent.add(ctx)
  const fillRect = ctx.fillRect.bind(ctx)
  ctx.fillRect = (x, y, w, h) =>
    ctx.fillStyle === this.theme.background.toLowerCase() ? ctx.clearRect(x, y, w, h) : fillRect(x, y, w, h)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}

// Size cells like Ghostty: the font's advance and line height snapped to device pixels.
// ghostty-web's default rounds up the width of "M", which makes cells 1px wider and rows 2px shorter.
const measureFont = renderer.measureFont
renderer.measureFont = function () {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return measureFont.call(this)
  ctx.textRendering = 'geometricPrecision'
  ctx.font = `${this.fontSize}px ${this.fontFamily}`
  const m = ctx.measureText('M')
  const snap = (n: number) => Math.round(n * devicePixelRatio) / devicePixelRatio
  return {
    width: snap(m.width),
    height: snap(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent),
    baseline: snap(m.fontBoundingBoxAscent),
  }
}

// ghostty-web only accepts hex colors, so these mirror the app's neutral theme.
const themes = {
  dark: {
    background: '#0a0a0a',
    foreground: '#fafafa',
    cursor: '#fafafa',
    selectionBackground: '#404040',
  },
  light: {
    background: '#ffffff',
    foreground: '#0a0a0a',
    cursor: '#0a0a0a',
    selectionBackground: '#d4d4d4',
  },
}

export type PanelView = 'terminal' | 'diff' | 'browser'

const viewIcons = {
  terminal: <SquareTerminalIcon />,
  diff: <FileDiffIcon />,
  browser: <GlobeIcon />,
}

// Unique across panel remounts, so a late exit from an old shell can't close a new pane.
let nextPane = 0

function TerminalPane({
  cwd,
  focused,
  split,
  onFocus,
  onExit,
}: {
  cwd?: string
  focused: boolean
  split: boolean
  onFocus: () => void
  onExit: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal>(null)

  useEffect(() => {
    let disposed = false
    const cleanups: (() => void)[] = []
    const id = nextPane++

    ;(async () => {
      await Promise.all([init(), document.fonts.load(`12px ${font}`)])
      if (disposed || !ref.current) return
      const dark = document.documentElement.classList.contains('dark')
      const term = new Terminal({
        fontSize: 12,
        fontFamily: font,
        cursorBlink: focused,
        cursorStyle: focused ? 'block' : 'underline',
        theme: dark ? themes.dark : themes.light,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(ref.current)
      fit.fit()
      fit.observeResize()
      termRef.current = term
      const canvas = ref.current.querySelector('canvas')
      if (canvas) cleanups.push(cursorTrail(canvas))

      window.api.term.start(id, cwd, term.cols, term.rows)
      const input = term.onData((data) => window.api.term.input(id, data))
      const resize = term.onResize(({ cols, rows }) => window.api.term.resize(id, cols, rows))
      cleanups.push(
        window.api.term.onData((pane, data) => pane === id && term.write(data)),
        window.api.term.onExit((pane) => pane === id && onExit()),
        () => input.dispose(),
        () => resize.dispose(),
        () => term.dispose(),
        () => window.api.term.kill(id),
      )
      if (focused) term.focus()
    })()

    return () => {
      disposed = true
      termRef.current = null
      for (const fn of cleanups) fn()
    }
    // A pane keeps its shell for life; a new folder remounts the whole panel.
  }, [])

  // Only the active pane gets a blinking block cursor; the rest show a still underline.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.cursorBlink = focused
    term.options.cursorStyle = focused ? 'block' : 'underline'
    if (focused) term.focus()
  }, [focused])

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

// Panes form a tree of splits; 'row' lays children side by side, 'col' stacks them.
type Dir = 'row' | 'col'
type Layout = { pane: number } | { dir: Dir; children: Layout[] }
type Rect = { x: number; y: number; w: number; h: number }

function splitPane(node: Layout, target: number, dir: Dir, pane: number): Layout {
  if ('pane' in node) return node.pane === target ? { dir, children: [node, { pane }] } : node
  const i = node.children.findIndex((c) => 'pane' in c && c.pane === target)
  if (node.dir === dir && i >= 0) return { dir, children: node.children.toSpliced(i + 1, 0, { pane }) }
  return { dir: node.dir, children: node.children.map((c) => splitPane(c, target, dir, pane)) }
}

function removePane(node: Layout, target: number): Layout | undefined {
  if ('pane' in node) return node.pane === target ? undefined : node
  const children = node.children.flatMap((c) => removePane(c, target) ?? [])
  return children.length > 1 ? { dir: node.dir, children } : children[0]
}

// Flattened to absolute rects (in fractions of the area) so splitting never remounts a pane and kills its shell.
function rects(node: Layout | undefined, r: Rect = { x: 0, y: 0, w: 1, h: 1 }): [number, Rect][] {
  if (!node) return []
  if ('pane' in node) return [[node.pane, r]]
  const n = node.children.length
  return node.children.flatMap((c, i) =>
    rects(
      c,
      node.dir === 'row' ? { ...r, x: r.x + (r.w * i) / n, w: r.w / n } : { ...r, y: r.y + (r.h * i) / n, h: r.h / n },
    ),
  )
}

const pct = (n: number) => `${n * 100}%`

const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const

// The pane touching the active one on the given side, preferring the one level with its centre.
function neighbour(panes: [number, Rect][], active: number, [dx, dy]: readonly [number, number]) {
  const cur = panes.find(([p]) => p === active)?.[1]
  if (!cur) return
  const eps = 1e-6
  const [ax, ay] = [cur.x + cur.w / 2, cur.y + cur.h / 2]
  let best: { pane: number; score: number } | undefined
  for (const [pane, r] of panes) {
    const touches =
      (dx > 0 && Math.abs(r.x - (cur.x + cur.w)) < eps) ||
      (dx < 0 && Math.abs(r.x + r.w - cur.x) < eps) ||
      (dy > 0 && Math.abs(r.y - (cur.y + cur.h)) < eps) ||
      (dy < 0 && Math.abs(r.y + r.h - cur.y) < eps)
    const overlaps = dx ? r.y < cur.y + cur.h && r.y + r.h > cur.y : r.x < cur.x + cur.w && r.x + r.w > cur.x
    if (!touches || !overlaps) continue
    const score = dx ? Math.abs(r.y + r.h / 2 - ay) : Math.abs(r.x + r.w / 2 - ax)
    if (!best || score < best.score) best = { pane, score }
  }
  return best?.pane
}

export function TerminalPanel({
  cwd,
  visible,
  view,
  onView,
  onExit,
}: {
  cwd?: string
  visible: boolean
  view: PanelView
  onView: (view: PanelView) => void
  onExit: () => void
}) {
  const asideRef = useRef<HTMLElement>(null)
  const browserOpened = useRef(false)
  if (view === 'browser') browserOpened.current = true
  const [width, setWidth] = useStoredWidth('terminalWidth', Math.round(innerWidth * 0.42))
  const [layout, setLayout] = useState<Layout | undefined>({ pane: 0 })
  const [active, setActive] = useState(0)
  const nextId = useRef(1)
  const panes = rects(layout)
  const split = (dir: Dir) => {
    if (!layout) return
    const pane = nextId.current++
    setLayout(splitPane(layout, active, dir, pane))
    setActive(pane)
  }
  const close = () => setLayout((l) => l && removePane(l, active))
  const focusDir = (d: readonly [number, number]) => {
    const pane = neighbour(panes, active, d)
    if (pane !== undefined) setActive(pane)
  }
  const latest = useRef({ split, close, focusDir, view })
  latest.current = { split, close, focusDir, view }

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
      if (e.ctrlKey || latest.current.view !== 'terminal') return
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
      else if (e.code === 'KeyW' && !e.shiftKey) latest.current.close()
      else return
      e.preventDefault()
    }
    const aside = asideRef.current
    aside?.addEventListener('keydown', onKey, true)
    return () => aside?.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <aside
      ref={asideRef}
      className={
        visible
          // ml-11 leaves room for the 36px rail hanging off the left edge.
          ? 'relative my-2 mr-2 ml-11 flex max-w-[70%] min-w-80 shrink-0'
          : 'hidden'
      }
      style={{ width }}
    >
      {/* The panel is inset 8px from the window's right edge. */}
      <ResizeHandle
        // Clamp to the same bounds as min-w-80 and max-w-[70%], so dragging back responds immediately.
        onDrag={(x) =>
          setWidth(
            Math.max(
              320,
              Math.min(
                innerWidth - 8 - x,
                (asideRef.current?.parentElement?.clientWidth ?? innerWidth) * 0.7,
              ),
            ),
          )
        }
        className="left-0"
      />
      {/* The rail is a tab joined to the content, with a concave corner filling the gap beneath it. */}
      <div className="absolute top-0 right-full flex flex-col items-center gap-1 rounded-l-2xl bg-sidebar/50 py-2 pl-2 backdrop-blur-xl [-webkit-app-region:drag]">
        <div className="absolute top-full right-0 size-4 bg-sidebar/50 backdrop-blur-xl [mask-image:radial-gradient(circle_at_0_100%,transparent_16px,black_16.5px)]" />
        {(['terminal', 'diff', 'browser'] as const).map((v) => (
          <button
            type="button"
            key={v}
            onClick={() => onView(v)}
            aria-pressed={view === v}
            aria-label={v}
            title={v[0].toUpperCase() + v.slice(1)}
            className="rounded-md p-1.5 text-muted-foreground outline-none [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-ring/50 hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground [&_svg]:size-4"
          >
            {viewIcons[v]}
          </button>
        ))}
      </div>
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl rounded-tl-none bg-sidebar/50 backdrop-blur-xl">
        {/* Hidden with `invisible`, not `hidden`, so the terminals keep their size and don't reflow. */}
        {/* Each pane is padded 4px, so neighbours sit 8px apart and 8px from the panel edge. */}
        <div className={cn('relative m-1 min-h-0 flex-1', view !== 'terminal' && 'invisible')}>
          {panes.map(([pane, r]) => (
            <div
              key={pane}
              className="absolute p-1"
              style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
            >
              <TerminalPane
                cwd={cwd}
                focused={visible && view === 'terminal' && active === pane}
                split={panes.length > 1}
                onFocus={() => setActive(pane)}
                onExit={() => setLayout((l) => l && removePane(l, pane))}
              />
            </div>
          ))}
        </div>
        {view === 'diff' && (
          <div className="absolute inset-0 flex flex-col">
            <DiffView cwd={cwd} visible={visible} />
          </div>
        )}
        {/* Mounted on first open and then kept, so switching tabs doesn't reload the page. */}
        {(view === 'browser' || browserOpened.current) && (
          <div className={cn('absolute inset-0 flex flex-col', view !== 'browser' && 'invisible')}>
            <BrowserView />
          </div>
        )}
      </div>
    </aside>
  )
}
