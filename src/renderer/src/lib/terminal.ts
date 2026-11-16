import { CanvasRenderer, GhosttyTerminal, type GhosttyCell } from 'ghostty-web'

export const font = '"JetBrainsMono Nerd Font", "JetBrainsMono NF", monospace'

// Make ghostty-web render like native Ghostty.
type Metrics = { width: number; height: number; baseline: number }
// SAFETY: these are private CanvasRenderer members in ghostty-web 0.4; recheck when upgrading.
const renderer = CanvasRenderer.prototype as unknown as {
  measureFont(this: { fontSize: number; fontFamily: string }): Metrics
  resize(this: { ctx: CanvasRenderingContext2D; theme: { background: string } }, cols: number, rows: number): void
  render(
    this: RenderState,
    buffer: GhosttyTerminal,
    forceAll?: boolean,
    viewportY?: number,
    scrollback?: unknown,
    scrollbarOpacity?: number,
  ): void
  renderCursor(
    this: { ctx: CanvasRenderingContext2D; metrics: Metrics; theme: { cursor: string }; cursorStyle: string },
    x: number,
    y: number,
  ): void
}
type RenderState = {
  ctx: CanvasRenderingContext2D
  lastViewportY: number
  selectionManager?: { hasSelection(): boolean; getDirtySelectionRows(): Set<number> }
  hoveredHyperlinkId: number
  previousHoveredHyperlinkId: number
  hoveredLinkRange: unknown
  previousHoveredLinkRange: unknown
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
  // ghostty-web draws every blank cell as a space; most cells are blank.
  const fillText = ctx.fillText.bind(ctx)
  ctx.fillText = (...args) => {
    if (args[0] !== ' ') fillText(...args)
  }
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}

// Inactive panes draw no cursor. ghostty-web only repaints the cursor's row when it moves or blinks,
// so a pane whose focus changed repaints fully once to clear or restore it.
export const idle = new WeakSet<HTMLCanvasElement>()
export const repaint = new WeakSet<HTMLCanvasElement>()
// Panes out of sight skip rendering; showing one again should add it to `repaint`.
export const hidden = new WeakSet<HTMLCanvasElement>()
const renderCursor = renderer.renderCursor
renderer.renderCursor = function (x, y) {
  if (idle.has(this.ctx.canvas)) return
  if (this.cursorStyle !== 'bar') return renderCursor.call(this, x, y)
  // A 1px bar like Ghostty's, instead of ghostty-web's 15% of a cell.
  this.ctx.fillStyle = this.theme.cursor
  this.ctx.fillRect(x * this.metrics.width, y * this.metrics.height, 1, this.metrics.height)
}
// ghostty-web's getLine fetches and decodes the whole screen from WASM to return one row, so a full redraw did that
// once per row. During a render, nothing writes to the terminal, so its rows all come from one fetch.
let frame: { term: unknown; cells?: GhosttyCell[] } | undefined
const getLine = GhosttyTerminal.prototype.getLine
GhosttyTerminal.prototype.getLine = function (y) {
  if (frame?.term !== this) return getLine.call(this, y)
  if (y < 0 || y >= this.rows) return null
  frame.cells ??= (this.update(), this.getViewport())
  return frame.cells.slice(y * this.cols, (y + 1) * this.cols)
}

// Scrolled back into history, ghostty-web redraws every row on every frame, even when nothing changed. Here such a
// frame is skipped: same scroll position and scrollbar fade, no new output, and no selection or link hover.
const opacities = new WeakMap<RenderState, number>()
function unchanged(r: RenderState, buffer: GhosttyTerminal, viewportY = 0, opacity = 1) {
  const selection = r.selectionManager
  return (
    viewportY > 0 &&
    viewportY === r.lastViewportY &&
    opacity === opacities.get(r) &&
    !buffer.isDirty() &&
    !selection?.hasSelection() &&
    !selection?.getDirtySelectionRows().size &&
    r.hoveredHyperlinkId === r.previousHoveredHyperlinkId &&
    JSON.stringify(r.hoveredLinkRange) === JSON.stringify(r.previousHoveredLinkRange)
  )
}

const render = renderer.render
renderer.render = function (buffer, forceAll, viewportY, scrollback, scrollbarOpacity) {
  const canvas = this.ctx.canvas
  if (hidden.has(canvas)) return
  forceAll ||= repaint.delete(canvas)
  if (!forceAll && unchanged(this, buffer, viewportY, scrollbarOpacity)) return
  opacities.set(this, scrollbarOpacity ?? 1)
  frame = { term: buffer }
  try {
    render.call(this, buffer, forceAll, viewportY, scrollback, scrollbarOpacity)
  } finally {
    frame = undefined
  }
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
export const themes = {
  dark: {
    background: '#141414',
    foreground: '#fafafa',
    cursor: '#38bdf8', // from the app icon's gradient
    selectionBackground: '#404040',
  },
  light: {
    background: '#ffffff',
    foreground: '#0a0a0a',
    cursor: '#1e3fd8',
    selectionBackground: '#d4d4d4',
  },
}
