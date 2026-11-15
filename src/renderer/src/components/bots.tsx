import { BotAvatar, botAvatarPalette, botAvatarTypes, type BotAvatarState, type BotAvatarType } from 'bot-avatars'

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

// A thread in the title bar roster; `label` names the thread and what its bot is doing.
export function ThreadBot(props: {
  bot: Bot
  state: BotAvatarState
  label: string
  selected: boolean
  disabled: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      aria-current={props.selected || undefined}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        'rounded-full p-1 transition-colors outline-none hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:hover:bg-transparent',
        props.selected && 'bg-foreground/10 disabled:hover:bg-foreground/10',
      )}
    >
      <BotAvatar {...props.bot} state={props.state} size={24} />
    </button>
  )
}
