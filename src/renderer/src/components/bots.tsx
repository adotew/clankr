import { useRef, useState } from 'react'
import { BotAvatar, botAvatarPalette, botAvatarTypes, type BotAvatarState, type BotAvatarType } from 'bot-avatars'
import { FolderIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// Each thread has its own bot: a body and a colour, mixed freely.
export type Bot = { type: BotAvatarType; color: string }

const colors = [...new Set(Object.values(botAvatarPalette))]
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]

// Threads from before bots were stored still get a stable one, from their ID (FNV-1a).
export function botFromId(id: string): Bot {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  h >>>= 0
  const n = botAvatarTypes.length
  return { type: botAvatarTypes[h % n], color: colors[Math.floor(h / n) % colors.length] }
}

// A random bot whose body none of `taken` has while one is left, so recent threads are easy to tell apart.
export function randomBot(taken: Bot[]): Bot {
  const free = botAvatarTypes.filter((t) => !taken.some((b) => b.type === t))
  return { type: pick(free.length ? free : botAvatarTypes), color: pick(colors) }
}

// `folder` is set for project threads; `status` says what a busy thread's bot is doing.
export type RosterEntry = {
  key: string
  bot: Bot
  state: BotAvatarState
  title: string
  folder?: string
  status?: string
  selected: boolean
  onClick?: () => void
}

const SLOT = 32 // a button at rest
const BOT = 24 // the bot inside it at rest
const ZOOM = 1.8 // scale right under the pointer
const REACH = 96 // px from the pointer where the zoom has faded out
// Bots draw at full zoom and scale down, so they stay sharp when they swell.
const DRAWN = Math.round(BOT * ZOOM)

// The threads as a dock: bots near the pointer swell and push their neighbours apart, the hovered one
// shows its thread. Clicks are ignored while `disabled`, but the dock still swells so it can be read mid-turn.
export function Roster({ entries, disabled }: { entries: RosterEntry[]; disabled: boolean }) {
  const items = useRef<(HTMLElement | null)[]>([])
  const [zooms, setZooms] = useState<number[]>([])

  const onMouseMove = (e: React.MouseEvent) =>
    setZooms(
      items.current.map((el) => {
        if (!el) return 1
        const r = el.getBoundingClientRect()
        const d = Math.min(1, Math.abs(e.clientY - (r.top + r.height / 2)) / REACH)
        return 1 + ((ZOOM - 1) * (1 + Math.cos(Math.PI * d))) / 2
      }),
    )

  return (
    <nav
      aria-label="Threads"
      onMouseMove={onMouseMove}
      onMouseLeave={() => setZooms([])}
      className="relative z-20 flex w-12 shrink-0 flex-col items-start justify-center gap-1 pl-2"
    >
      {entries.map((entry, i) => {
        const zoom = zooms[i] ?? 1
        return (
          <button
            key={entry.key}
            ref={(el) => {
              items.current[i] = el
            }}
            type="button"
            aria-label={[entry.title, entry.folder, entry.status].filter(Boolean).join(', ')}
            aria-current={entry.selected || undefined}
            aria-disabled={disabled || undefined}
            onClick={() => !disabled && entry.onClick?.()}
            style={{ width: SLOT * zoom, height: SLOT * zoom }}
            className={cn(
              'group relative shrink-0 rounded-full transition-[width,height,background-color] duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
              entry.selected ? 'bg-foreground/10' : !disabled && 'hover:bg-foreground/5',
            )}
          >
            <span
              className="absolute top-1/2 left-1/2 transition-transform duration-150 ease-out motion-reduce:transition-none"
              style={{ transform: `translate(-50%, -50%) scale(${(BOT * zoom) / DRAWN})` }}
            >
              <BotAvatar {...entry.bot} state={entry.state} size={DRAWN} />
            </span>
            <span className="pointer-events-none absolute top-1/2 left-full ml-2 flex -translate-y-1/2 flex-col items-start rounded-lg bg-popover/90 px-2.5 py-1.5 whitespace-nowrap text-popover-foreground opacity-0 shadow-lg ring-1 ring-foreground/10 backdrop-blur-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="max-w-72 truncate text-sm font-medium">{entry.title}</span>
              {(entry.folder || entry.status) && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {entry.folder && <FolderIcon className="size-3" />}
                  {[entry.folder, entry.status].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
