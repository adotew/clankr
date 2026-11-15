import { BotAvatar, botAvatarPalette, botAvatarTypes, type BotAvatarState, type BotAvatarType } from 'bot-avatars'
import { FolderIcon } from 'lucide-react'

import { Dock, DockIcon } from '@/components/ui/dock'
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

// Thread bots in a vertical Magic UI dock: the ones near the pointer swell, the hovered one shows its thread.
// Clicks are ignored while `disabled`, but the dock still swells so it can be read mid-turn.
export function Roster({ entries, disabled }: { entries: RosterEntry[]; disabled: boolean }) {
  if (!entries.length) return null
  return (
    <nav aria-label="Threads" className="relative z-20 flex shrink-0 items-center pl-3">
      {/* Left-aligned, so a swelling bot grows out to the right, away from the window edge. */}
      <Dock vertical direction="top" iconSize={40} iconMagnification={64} iconDistance={120} className="m-0 border-0">
        {entries.map((entry) => (
          <DockIcon
            key={entry.key}
            // A size container, so the bot can fill whatever size the dock springs the icon to.
            className={cn('group relative [container-type:size]', entry.selected ? 'bg-foreground/10' : 'hover:bg-foreground/5')}
          >
            {/* Drawn at the icon's live size, so it stays sharp as it swells. */}
            <BotAvatar {...entry.bot} state={entry.state} size="100cqw" style={{ display: 'block' }} />
            <button
              type="button"
              aria-label={[entry.title, entry.folder, entry.status].filter(Boolean).join(', ')}
              aria-current={entry.selected || undefined}
              aria-disabled={disabled || undefined}
              onClick={() => !disabled && entry.onClick?.()}
              className="absolute inset-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <span className="pointer-events-none absolute top-1/2 left-full ml-2 flex -translate-y-1/2 flex-col items-start rounded-lg bg-popover/90 px-2.5 py-1.5 whitespace-nowrap text-popover-foreground opacity-0 shadow-lg ring-1 ring-foreground/10 backdrop-blur-xl transition-opacity duration-150 group-hover:opacity-100 group-has-focus-visible:opacity-100">
              <span className="max-w-72 truncate text-sm font-medium">{entry.title}</span>
              {(entry.folder || entry.status) && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {entry.folder && <FolderIcon className="size-3" />}
                  {[entry.folder, entry.status].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
          </DockIcon>
        ))}
      </Dock>
    </nav>
  )
}
