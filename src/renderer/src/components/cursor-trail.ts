import { CanvasRenderer } from 'ghostty-web'

// Neovide-like cursor trail, ported from cursor_warp.glsl in sahaj-b/cursor-shaders (MIT, © 2026 Sahaj Bhatt).
// A quad stretches from the old cursor to the new one: leading corners arrive fast, trailing corners catch up.

type Rect = { x: number; y: number; w: number; h: number }
type Renderer = {
  ctx: CanvasRenderingContext2D
  metrics: { width: number; height: number }
  theme: { cursor: string }
  currentBuffer: { getCursor(): { x: number; y: number; visible: boolean } }
}

// SAFETY: private CanvasRenderer members in ghostty-web 0.4; recheck when upgrading.
const proto = CanvasRenderer.prototype as unknown as { render(this: Renderer, ...args: unknown[]): void }
const listeners = new WeakMap<HTMLCanvasElement, (cursor: Rect, color: string) => void>()
const render = proto.render
proto.render = function (...args) {
  render.apply(this, args)
  const cursor = this.currentBuffer.getCursor()
  const { width: w, height: h } = this.metrics
  // args[2] is the scrollback offset; the cursor isn't drawn while scrolled up.
  if (cursor.visible && !args[2])
    listeners.get(this.ctx.canvas)?.({ x: cursor.x * w, y: cursor.y * h, w, h }, this.theme.cursor)
}

const DURATION = 200
const LEAD = DURATION * 0.2
const SIDE = (LEAD + DURATION) / 2
const MIN_DISTANCE = 1.5 // in cursor heights; shorter moves (typing) get no trail
const THICKNESS_X = 0.9
const ease = (x: number) => Math.sqrt(1 - (x - 1) ** 2) // easeOutCirc
const corners = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const
const center = (r: Rect) => [r.x + r.w / 2, r.y + r.h / 2]
const corner = (r: Rect, x: number, y: number) => [r.x + (r.w * (1 + x * THICKNESS_X)) / 2, r.y + (r.h * (1 + y)) / 2]
// Corners facing the move arrive fast, trailing ones last. Both corners on the leading
// horizontal side count as leading, so horizontal moves keep a straight front edge.
const duration = (x: number, y: number, sx: number, sy: number) => {
  const dot = x * sx + y * sy
  if ((sx && x === sx) || dot > 0) return LEAD
  return dot === 0 ? SIDE : DURATION
}

export function cursorTrail(canvas: HTMLCanvasElement) {
  const overlay = document.createElement('canvas')
  overlay.style.cssText = 'position:absolute;pointer-events:none'
  canvas.after(overlay)
  const ctx = overlay.getContext('2d')
  let last: Rect | undefined
  let from: Rect
  let to: Rect
  let start = 0
  let frame = 0

  const draw = (now: number) => {
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    const t = now - start
    if (t >= DURATION) return void (frame = 0)
    const [fx, fy] = center(from)
    const [tx, ty] = center(to)
    const sx = Math.sign(tx - fx)
    const sy = Math.sign(ty - fy)
    ctx.beginPath()
    for (const [x, y] of corners) {
      const p = ease(Math.min(t / duration(x, y, sx, sy), 1))
      const [ax, ay] = corner(from, x, y)
      const [bx, by] = corner(to, x, y)
      ctx.lineTo(ax + (bx - ax) * p, ay + (by - ay) * p)
    }
    ctx.fill()
    // Keep the real cursor (and the glyph under it) visible.
    ctx.clearRect(to.x, to.y, to.w, to.h)
    frame = requestAnimationFrame(draw)
  }

  listeners.set(canvas, (cursor, color) => {
    const prev = last
    last = cursor
    if (!ctx || !prev || (prev.x === cursor.x && prev.y === cursor.y)) return
    const [px, py] = center(prev)
    const [cx, cy] = center(cursor)
    if (Math.hypot(cx - px, cy - py) <= cursor.h * MIN_DISTANCE) return
    from = prev
    to = cursor
    start = performance.now()
    if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
      overlay.width = canvas.width
      overlay.height = canvas.height
    }
    overlay.style.left = `${canvas.offsetLeft}px`
    overlay.style.top = `${canvas.offsetTop}px`
    overlay.style.width = `${canvas.clientWidth}px`
    overlay.style.height = `${canvas.clientHeight}px`
    ctx.setTransform(canvas.width / canvas.clientWidth, 0, 0, canvas.height / canvas.clientHeight, 0, 0)
    ctx.fillStyle = color
    if (!frame) frame = requestAnimationFrame(draw)
  })

  return () => {
    cancelAnimationFrame(frame)
    listeners.delete(canvas)
    overlay.remove()
  }
}
