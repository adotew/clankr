import { useState } from 'react'
import { CheckIcon, CircleAlertIcon, CopyIcon, ShieldQuestionIcon } from 'lucide-react'

import { Markdown } from '@/components/markdown'
import { ToolStep } from '@/components/tool-step'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import { Trace } from '@/components/ui/trace'
import { groupReplies, type Item as ReplyItem } from '@/lib/items'
import type { AgentEvent, Answer } from '../../../shared'

const k = (n: number) => `${Math.round(n / 1000)}k`

export type Ask = Extract<AgentEvent, { kind: 'ask' }>

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? 'Copied' : 'Copy'}
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

export function Reply({ replies, streaming, waiting }: { replies: ReplyItem[]; streaming: boolean; waiting: boolean }) {
  const text = replies.flatMap((r) => (r.kind === 'assistant' ? [r.text] : [])).join('\n\n')
  const groups = groupReplies(replies)
  const last = replies.at(-1)
  // Streaming text and running tools show their own progress; cover the silent gaps in between.
  const thinking = streaming && !waiting && last?.kind !== 'assistant' && !(last?.kind === 'tool' && !last.result)

  return (
    <Message>
      <MessageContent className="w-full gap-3">
        {groups.map((group, i) => {
          if (Array.isArray(group))
            return (
              <Trace key={i}>
                {group.map((tool) => (
                  <ToolStep key={tool.id} tool={tool} running={streaming} />
                ))}
              </Trace>
            )
          if (group.kind === 'error')
            return (
              <p key={i} className="flex items-center gap-2 text-sm text-destructive">
                <CircleAlertIcon className="size-4" /> {group.text}
              </p>
            )
          if (group.kind === 'compacted')
            return (
              <div key={i} className="flex items-center gap-3 text-xs text-muted-foreground">
                <hr className="flex-1 border-foreground/10" />
                Context compacted
                {group.before !== undefined && ` · ${k(group.before)}${group.after === undefined ? '' : ` → ${k(group.after)}`}`}
                <hr className="flex-1 border-foreground/10" />
              </div>
            )
          return (
            <Markdown key={i} streaming={streaming && i === groups.length - 1}>
              {group.kind === 'tool' ? '' : group.text}
            </Markdown>
          )
        })}
        {thinking && (
          <p
            role="status"
            className="shimmer text-sm text-muted-foreground/60 [--shimmer-color:var(--color-foreground)] motion-reduce:shimmer-none"
          >
            Thinking…
          </p>
        )}
        {!streaming && text && (
          <MessageFooter className="px-0 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
            <CopyButton text={text} />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}

// Claude permission requests (yes/no) and Pi extension dialogs (yes/no, a choice, or free text).
export function AskCard({ ask, onReply }: { ask: Ask; onReply: (answer: Answer) => void }) {
  const [text, setText] = useState('')
  let actions
  if (ask.options)
    actions = (
      <>
        {ask.options.map((option) => (
          <Button key={option} size="sm" variant="outline" onClick={() => onReply(option)}>
            {option}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onReply(undefined)}>
          Cancel
        </Button>
      </>
    )
  else if (ask.input)
    actions = (
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onReply(text)
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={ask.detail} className="h-8 w-56" autoFocus />
        <Button type="button" size="sm" variant="outline" onClick={() => onReply(undefined)}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Send
        </Button>
      </form>
    )
  else
    actions = (
      <>
        <Button size="sm" variant="outline" onClick={() => onReply(false)}>
          Deny
        </Button>
        <Button size="sm" onClick={() => onReply(true)}>
          Allow
        </Button>
      </>
    )
  return (
    <Item variant="outline" size="sm" className="flex-wrap">
      <ItemMedia variant="icon">
        <ShieldQuestionIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{ask.title}</ItemTitle>
        {ask.detail && !ask.input && <ItemDescription className="truncate font-mono text-xs">{ask.detail}</ItemDescription>}
      </ItemContent>
      <ItemActions className="flex-wrap">{actions}</ItemActions>
    </Item>
  )
}
