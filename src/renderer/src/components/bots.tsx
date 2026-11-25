import { forwardRef, memo, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import {
  BotAvatar as LibBotAvatar,
  botAvatarPalette,
  botAvatarTypes,
  type BotAvatarProps,
  type BotAvatarState,
  type BotAvatarType,
} from 'bot-avatars'
import { FolderIcon, GitBranchIcon } from 'lucide-react'

import { Dock, DockIcon } from '@/components/ui/dock'
import { popup } from '@/lib/ui'
import { cn } from '@/lib/utils'

// Updating a bot redraws it after forcing a layout, and parents re-render on every streamed reply chunk; so only
// renders that change a prop go through. Pass a stable `style`.
// Every bot wears the prompt eyes: a terminal `>_` that blinks through its glyphs. Props still win, so a caller
// can ask for the plain dots instead.
export const BotAvatar = memo(
  forwardRef<HTMLCanvasElement, BotAvatarProps>((props, ref) => <LibBotAvatar ref={ref} eyes="prompt" {...props} />),
)

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

const swatch = (on: boolean) =>
  cn(
    'outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
    on ? 'bg-foreground/15' : 'hover:bg-foreground/10',
  )

// Picks a bot's body and colour. Mounted only while open, since every body preview is a live canvas.
export function BotPicker({
  bot,
  anchor,
  onChange,
  onClose,
}: {
  bot: Bot
  anchor: DOMRect
  onChange: (bot: Bot) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => ref.current?.showPopover(), [])
  const position: CSSProperties = { left: anchor.left + anchor.width / 2, top: anchor.bottom + 8, translate: '-50% 0' }
  return (
    <div
      ref={ref}
      popover="auto"
      onToggle={(e) => e.newState === 'closed' && onClose()}
      style={position}
      className={cn('fixed inset-auto m-0 w-80 flex-col gap-5 rounded-xl p-3 open:flex', popup)}
    >
      {/* Bodies and colours share one six-column grid, so the swatches line up under the bodies. */}
      <div className="grid grid-cols-6 gap-1">
        {botAvatarTypes.map((type) => (
          <button
            key={type}
            type="button"
            title={type}
            onClick={() => onChange({ ...bot, type })}
            className={cn('flex justify-center rounded-md p-1', swatch(type === bot.type))}
          >
            <BotAvatar type={type} color={bot.color} state="sleeping" size={32} style={block} />
          </button>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-x-1 gap-y-2.5">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            onClick={() => onChange({ ...bot, color })}
            style={{ background: color }}
            className={cn(
              'size-6 justify-self-center rounded-full outline-none ring-offset-2 ring-offset-popover focus-visible:ring-2 focus-visible:ring-ring/50',
              color === bot.color && 'ring-2 ring-foreground/60',
            )}
          />
        ))}
      </div>
    </div>
  )
}

// `folder` and `branch` are set for project threads; `status` says what a busy thread's bot is doing.
// `away` leaves the slot empty while the bot is shown large on the empty thread; when it turns false the bot
// flies in from `flyFrom`. Without `onClick`, a click pokes the bot instead.
export type RosterEntry = {
  key: string
  bot: Bot
  state: BotAvatarState
  title: string
  folder?: string
  branch?: string
  status?: string
  waiting?: boolean
  selected: boolean
  away?: boolean
  flyFrom?: DOMRect
  onClick?: () => void
}

// Thread bots in a vertical Magic UI dock: the ones near the pointer swell, the hovered one shows its thread.
export function Roster({ entries }: { entries: RosterEntry[] }) {
  if (!entries.length) return null
  return (
    <nav aria-label="Threads" className="relative z-20 flex shrink-0 items-center pl-3">
      {/* Left-aligned, so a swelling bot grows out to the right, away from the window edge. */}
      <Dock vertical direction="top" iconSize={40} iconMagnification={64} iconDistance={120} className="relative m-0 border-0">
        {/* A layer, not the dock itself: a blurred ancestor would keep the hover cards' own blur from reaching the page. */}
        <div className="pointer-events-none absolute inset-0 rounded-2xl backdrop-blur-md" />
        {entries.map((entry) => (
          <DockIcon
            key={entry.key}
            // A size container, so the bot can fill whatever size the dock springs the icon to.
            className={cn('group relative [container-type:size]', entry.away ? '' : entry.selected ? 'bg-foreground/10' : 'hover:bg-foreground/5')}
          >
            <RosterBot entry={entry} />
          </DockIcon>
        ))}
      </Dock>
    </nav>
  )
}

export const block = { display: 'block' }

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function RosterBot({ entry }: { entry: RosterEntry }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const body = useRef<HTMLSpanElement>(null)
  // BotAvatar hops when its canvas is clicked, and the button lies over the canvas.
  const poke = () => canvas.current?.click()

  // Like a dock icon that needs attention: a hop now and every few seconds until answered.
  useEffect(() => {
    if (!entry.waiting) return
    poke()
    const timer = setInterval(poke, 5000)
    return () => clearInterval(timer)
  }, [entry.waiting])

  // Lands from the empty thread: start where the large bot was and settle into the slot.
  useLayoutEffect(() => {
    const from = entry.flyFrom
    if (entry.away || !from || !body.current || reducedMotion.matches) return
    const to = body.current.getBoundingClientRect()
    const dx = from.left + from.width / 2 - (to.left + to.width / 2)
    const dy = from.top + from.height / 2 - (to.top + to.height / 2)
    body.current.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` }, { transform: 'none' }],
      { duration: 550, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    )
  }, [entry.away])

  return (
    <>
      {!entry.away && (
        <span ref={body} className="block">
          {/* Drawn at the icon's live size, so it stays sharp as it swells. */}
          <BotAvatar ref={canvas} {...entry.bot} state={entry.state} size="100cqw" style={block} />
        </span>
      )}
      <button
        type="button"
        aria-label={[entry.title, entry.folder, entry.branch, entry.status].filter(Boolean).join(', ')}
        aria-current={entry.selected || undefined}
        onClick={() => (entry.onClick ? entry.onClick() : poke())}
        className="absolute inset-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <span className="pointer-events-none absolute top-1/2 left-full ml-2 flex -translate-y-1/2 flex-col items-start rounded-lg bg-popover/90 px-2.5 py-1.5 whitespace-nowrap text-popover-foreground opacity-0 shadow-lg ring-1 ring-foreground/10 backdrop-blur-xl transition-opacity duration-150 group-hover:opacity-100 group-has-focus-visible:opacity-100">
        <span className="max-w-72 truncate text-sm font-medium">{entry.title}</span>
        {(entry.folder || entry.status) && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {entry.folder && <FolderIcon className="size-3" />}
            {entry.folder}
            {entry.branch && <GitBranchIcon className="ml-1 size-3" />}
            {entry.branch}
            {entry.status && (entry.folder ? `· ${entry.status}` : entry.status)}
          </span>
        )}
      </span>
    </>
  )
}
