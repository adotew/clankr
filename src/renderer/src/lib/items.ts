import type { AgentEvent } from '../../../shared'
import type { ToolItem } from '@/components/tool-step'

export type Item = { kind: 'user' | 'assistant' | 'error'; text: string } | ToolItem
// One user prompt and everything the agent did in reply.
export type Turn = { prompt?: string; replies: Item[] }

export function applyEvent(items: Item[], e: AgentEvent): Item[] {
  switch (e.kind) {
    case 'user':
    case 'error':
      return [...items, { kind: e.kind, text: e.text }]
    case 'text':
      return [...items, { kind: 'assistant', text: e.text }]
    case 'delta': {
      const last = items.at(-1)
      return last?.kind === 'assistant'
        ? [...items.slice(0, -1), { ...last, text: last.text + e.text }]
        : [...items, { kind: 'assistant', text: e.text }]
    }
    case 'tool':
      return [...items, e]
    case 'result':
      return items.map((x) =>
        x.kind === 'tool' && x.id === e.id ? { ...x, result: { text: e.text, isError: e.isError } } : x,
      )
    default:
      return items
  }
}

export function toTurns(items: Item[]): Turn[] {
  const turns: Turn[] = []
  for (const item of items) {
    if (item.kind === 'user') turns.push({ prompt: item.text, replies: [] })
    else if (turns.length === 0) turns.push({ replies: [item] })
    else turns.at(-1)!.replies.push(item)
  }
  return turns
}

// Runs of tool calls render as one trace; text and errors render on their own.
export function groupReplies(replies: Item[]): (Item | ToolItem[])[] {
  const groups: (Item | ToolItem[])[] = []
  for (const item of replies) {
    const last = groups.at(-1)
    if (item.kind === 'tool' && Array.isArray(last)) last.push(item)
    else groups.push(item.kind === 'tool' ? [item] : item)
  }
  return groups
}
