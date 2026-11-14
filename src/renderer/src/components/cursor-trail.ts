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

// Draws one frame of the trail from `from` to `to`, `t` ms in; returns false once it has finished.
function drawTrail(ctx: CanvasRenderingContext2D, from: Rect, to: Rect, t: number) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (t >= DURATION) return false
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
  return true
}

// Each canvas's last cursor, in canvas CSS pixels, and its colour.
const cursors = new WeakMap<HTMLCanvasElement, { rect: Rect; color: string }>()

// Sweeps the cursor from one terminal canvas to another, over a temporary window-sized overlay.
export function sweepCursor(fromCanvas: HTMLCanvasElement, toCanvas: HTMLCanvasElement) {
  const a = cursors.get(fromCanvas)
  const b = cursors.get(toCanvas)
  if (!a || !b || !fromCanvas.isConnected) return
  const at = (canvas: HTMLCanvasElement, r: Rect) => {
    const box = canvas.getBoundingClientRect()
    return { ...r, x: box.left + r.x, y: box.top + r.y }
  }
  const from = at(fromCanvas, a.rect)
  const to = at(toCanvas, b.rect)
  const overlay = document.createElement('canvas')
  overlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:50'
  overlay.width = innerWidth * devicePixelRatio
  overlay.height = innerHeight * devicePixelRatio
  document.body.append(overlay)
  const ctx = overlay.getContext('2d')
  if (!ctx) return overlay.remove()
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  ctx.fillStyle = b.color
  const start = performance.now()
  const draw = (now: number) => (drawTrail(ctx, from, to, now - start) ? requestAnimationFrame(draw) : overlay.remove())
  requestAnimationFrame(draw)
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
    frame = drawTrail(ctx, from, to, now - start) ? requestAnimationFrame(draw) : 0
  }

  listeners.set(canvas, (cursor, color) => {
    const prev = last
    last = cursor
    cursors.set(canvas, { rect: cursor, color })
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
