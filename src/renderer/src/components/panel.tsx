import type { ReactNode } from 'react'
import { FileDiffIcon, FileTextIcon, GlobeIcon, SquareTerminalIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type PanelView = 'terminal' | 'diff' | 'browser' | 'docs'

const views = {
  terminal: <SquareTerminalIcon />,
  diff: <FileDiffIcon />,
  browser: <GlobeIcon />,
  docs: <FileTextIcon />,
}

// The side panel's view tabs. Floating, they sit at the window's top-right, over the open panel's header; otherwise
// they only hold the header's space.
export function PanelRail({
  view,
  floating = false,
  onView,
  className,
}: {
  view?: PanelView
  floating?: boolean
  onView: (view: PanelView) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-0.5', floating && 'absolute z-20 [-webkit-app-region:drag]', className)}>
      {(Object.keys(views) as PanelView[]).map((v) => (
        <button
          type="button"
          key={v}
          onClick={() => onView(v)}
          aria-pressed={view === v}
          aria-label={v}
          title={v[0].toUpperCase() + v.slice(1)}
          className="rounded-md p-1.5 text-muted-foreground outline-none [-webkit-app-region:no-drag] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-muted aria-pressed:text-foreground [&_svg]:size-4"
        >
          {views[v]}
        </button>
      ))}
    </div>
  )
}

// The panel's top row: the view's own controls on the left, and on the right an empty slot the size of the view
// tabs, which App draws at a fixed spot above the panel so they hold still while it slides.
export function PanelHeader({ children }: { children?: ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
      <PanelRail onView={() => {}} className="invisible" />
    </div>
  )
}
