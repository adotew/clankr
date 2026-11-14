import { useEffect, useRef } from 'react'
import { CanvasRenderer, FitAddon, init, Terminal } from 'ghostty-web'

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

export function TerminalPanel({ cwd, visible, onExit }: { cwd?: string; visible: boolean; onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal>(null)

  useEffect(() => {
    let disposed = false
    const cleanups: (() => void)[] = []

    ;(async () => {
      await Promise.all([init(), document.fonts.load(`12px ${font}`)])
      if (disposed || !ref.current) return
      const dark = document.documentElement.classList.contains('dark')
      const term = new Terminal({
        fontSize: 12,
        fontFamily: font,
        cursorBlink: true,
        theme: dark ? themes.dark : themes.light,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(ref.current)
      fit.fit()
      fit.observeResize()
      termRef.current = term

      window.api.term.start(cwd, term.cols, term.rows)
      const input = term.onData((data) => window.api.term.input(data))
      const resize = term.onResize(({ cols, rows }) => window.api.term.resize(cols, rows))
      cleanups.push(
        window.api.term.onData((data) => term.write(data)),
        window.api.term.onExit(onExit),
        () => input.dispose(),
        () => resize.dispose(),
        () => term.dispose(),
        () => window.api.term.kill(),
      )
      term.focus()
    })()

    return () => {
      disposed = true
      termRef.current = null
      cleanups.forEach((fn) => fn())
    }
    // Only a new folder restarts the shell.
  }, [cwd])

  useEffect(() => {
    if (visible) termRef.current?.focus()
  }, [visible])

  return (
    <aside
      className={
        visible
          ? 'm-2 flex w-[42%] min-w-80 shrink-0 flex-col overflow-hidden rounded-2xl bg-sidebar/50 shadow-sm ring-1 ring-sidebar-border backdrop-blur-xl'
          : 'hidden'
      }
    >
      <div className="h-9 shrink-0 [-webkit-app-region:drag]" />
      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden pl-2 caret-transparent" />
    </aside>
  )
}
