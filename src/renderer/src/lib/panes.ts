// Panes form a tree of splits; 'row' lays children side by side, 'col' stacks them.
export type Dir = 'row' | 'col'
export type Layout = { pane: number } | { dir: Dir; children: Layout[] }
export type Rect = { x: number; y: number; w: number; h: number }

export function splitPane(node: Layout, target: number, dir: Dir, pane: number): Layout {
  if ('pane' in node) return node.pane === target ? { dir, children: [node, { pane }] } : node
  const i = node.children.findIndex((c) => 'pane' in c && c.pane === target)
  if (node.dir === dir && i >= 0) return { dir, children: node.children.toSpliced(i + 1, 0, { pane }) }
  return { dir: node.dir, children: node.children.map((c) => splitPane(c, target, dir, pane)) }
}

export function removePane(node: Layout, target: number): Layout | undefined {
  if ('pane' in node) return node.pane === target ? undefined : node
  const children = node.children.flatMap((c) => removePane(c, target) ?? [])
  return children.length > 1 ? { dir: node.dir, children } : children[0]
}

// Flattened to absolute rects (in fractions of the area) so splitting never remounts a pane and kills its shell.
export function rects(node: Layout | undefined, r: Rect = { x: 0, y: 0, w: 1, h: 1 }): [number, Rect][] {
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

export const pct = (n: number) => `${n * 100}%`

export const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const

// The pane touching the active one on the given side, preferring the one level with its centre.
export function neighbour(panes: [number, Rect][], active: number, [dx, dy]: readonly [number, number]) {
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
