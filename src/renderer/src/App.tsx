import { useEffect, useState } from 'react'
import {
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  FolderOpenIcon,
  MessageCircleDashedIcon,
  ShieldQuestionIcon,
} from 'lucide-react'

import { AppSidebar, type Active } from '@/components/app-sidebar'
import { Markdown } from '@/components/markdown'
import { PromptInput } from '@/components/prompt-input'
import { TerminalPanel } from '@/components/terminal-panel'
import { ToolStep, type ToolItem } from '@/components/tool-step'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Trace } from '@/components/ui/trace'
import type { AgentEvent, Model, Thread } from '../../shared'

type Item = { kind: 'user' | 'assistant' | 'error'; text: string } | ToolItem
type Permission = Extract<AgentEvent, { kind: 'permission' }>
// One user prompt and everything the agent did in reply.
type Turn = { prompt?: string; replies: Item[] }

function applyEvent(items: Item[], e: AgentEvent): Item[] {
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

function toTurns(items: Item[]): Turn[] {
  const turns: Turn[] = []
  for (const item of items) {
    if (item.kind === 'user') turns.push({ prompt: item.text, replies: [] })
    else if (turns.length === 0) turns.push({ replies: [item] })
    else turns.at(-1)!.replies.push(item)
  }
  return turns
}

// Runs of tool calls render as one trace; text and errors render on their own.
function groupReplies(replies: Item[]): (Item | ToolItem[])[] {
  const groups: (Item | ToolItem[])[] = []
  for (const item of replies) {
    const last = groups.at(-1)
    if (item.kind === 'tool' && Array.isArray(last)) last.push(item)
    else groups.push(item.kind === 'tool' ? [item] : item)
  }
  return groups
}

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

function Reply({ replies, streaming }: { replies: Item[]; streaming: boolean }) {
  const text = replies.flatMap((r) => (r.kind === 'assistant' ? [r.text] : [])).join('\n\n')
  const groups = groupReplies(replies)

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
          return (
            <Markdown key={i} streaming={streaming && i === groups.length - 1}>
              {group.kind === 'tool' ? '' : group.text}
            </Markdown>
          )
        })}
        {!streaming && text && (
          <MessageFooter className="px-0">
            <CopyButton text={text} />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}

// Invisible strip for dragging the window; shows the sidebar toggle while the sidebar is hidden.
function TitleBar() {
  const { open } = useSidebar()
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-9 items-center pl-20 fullscreen:pl-3 [-webkit-app-region:drag]">
      {!open && <SidebarTrigger className="[-webkit-app-region:no-drag]" />}
    </div>
  )
}

function Confirmation({ permission, onReply }: { permission: Permission; onReply: (allow: boolean) => void }) {
  const { command, file_path, description } = permission.input
  const detail = [command, file_path, description].find((v) => typeof v === 'string') as string | undefined
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <ShieldQuestionIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>Allow {permission.name}?</ItemTitle>
        {detail && <ItemDescription className="truncate font-mono text-xs">{detail}</ItemDescription>}
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline" onClick={() => onReply(false)}>
          Deny
        </Button>
        <Button size="sm" onClick={() => onReply(true)}>
          Allow
        </Button>
      </ItemActions>
    </Item>
  )
}

export function App() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [active, setActive] = useState<Active>()
  const [models, setModels] = useState<Model[]>([])
  const [model, setModel] = useState(() => localStorage.getItem('model') ?? 'default')
  const [items, setItems] = useState<Item[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [busy, setBusy] = useState(false)
  // 'hidden' keeps the shell running while the panel is closed.
  const [terminal, setTerminal] = useState<'off' | 'open' | 'hidden'>('off')

  useEffect(() => {
    // Capture phase so the shortcut still works while the terminal has focus.
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.code === 'KeyJ') {
        e.preventDefault()
        e.stopPropagation()
        setTerminal((t) => (t === 'open' ? 'hidden' : 'open'))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const refreshThreads = () => window.api.threads().then(setThreads)

  useEffect(() => {
    refreshThreads()
    window.api.models().then(setModels, (err) => setItems([{ kind: 'error', text: `Could not load models: ${err}` }]))
    return window.api.onEvent((e) => {
      if (e.kind === 'permission') setPermissions((ps) => [...ps, e])
      else if (e.kind === 'done') {
        setPermissions([])
        setBusy(false)
      } else setItems((xs) => applyEvent(xs, e))
    })
  }, [])

  const newThread = async () => {
    const cwd = await window.api.newThread()
    if (!cwd) return
    setActive({ cwd })
    setItems([])
  }

  const openThread = async (thread: Thread) => {
    setActive({ id: thread.id, cwd: thread.cwd })
    setItems((await window.api.openThread(thread)).reduce(applyEvent, []))
  }

  const pickModel = (value: string) => {
    setModel(value)
    localStorage.setItem('model', value)
  }

  const send = async (text: string) => {
    if (!active) return
    setItems((xs) => [...xs, { kind: 'user', text }])
    setBusy(true)
    const id = await window.api.send(text, model)
    setActive((a) => a && { ...a, id })
    refreshThreads()
  }

  const reply = (id: string, allow: boolean) => {
    window.api.reply(id, allow)
    setPermissions((ps) => ps.filter((p) => p.id !== id))
  }

  const turns = toTurns(items)

  return (
    <SidebarProvider>
      <AppSidebar threads={threads} active={active} busy={busy} onNew={newThread} onOpen={openThread} />
      <SidebarInset className="h-svh min-w-0 flex-row">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <TitleBar />

          <MessageScrollerProvider autoScroll>
            <div className="min-h-0 flex-1">
              {turns.length === 0 ? (
                <Empty className="h-full">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">{active ? <MessageCircleDashedIcon /> : <FolderOpenIcon />}</EmptyMedia>
                    <EmptyTitle>{active ? 'What should we build?' : 'Open a project'}</EmptyTitle>
                    <EmptyDescription>
                      {active
                        ? 'The agent can read your code, run commands and make changes. It asks before editing files or running commands.'
                        : 'Pick a folder to start a new thread, or continue one from the sidebar.'}
                    </EmptyDescription>
                  </EmptyHeader>
                  {!active && (
                    <EmptyContent>
                      <Button onClick={newThread}>Open folder</Button>
                    </EmptyContent>
                  )}
                </Empty>
              ) : (
                <MessageScroller>
                  <MessageScrollerViewport>
                    <MessageScrollerContent aria-busy={busy} className="mx-auto w-full max-w-3xl px-6 pt-12 pb-6">
                      {turns.map((turn, i) => {
                        const last = i === turns.length - 1
                        return (
                          <MessageScrollerItem
                            key={i}
                            messageId={String(i)}
                            scrollAnchor={!!turn.prompt}
                            className="flex flex-col gap-6"
                          >
                            {turn.prompt && (
                              <Message align="end">
                                <MessageContent>
                                  <Bubble align="end" variant="muted">
                                    <BubbleContent className="whitespace-pre-wrap">{turn.prompt}</BubbleContent>
                                  </Bubble>
                                </MessageContent>
                              </Message>
                            )}
                            {(turn.replies.length > 0 || (last && busy)) && (
                              <Reply replies={turn.replies} streaming={last && busy} />
                            )}
                            {last &&
                              permissions.map((p) => (
                                <Confirmation key={p.id} permission={p} onReply={(allow) => reply(p.id, allow)} />
                              ))}
                          </MessageScrollerItem>
                        )
                      })}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton />
                </MessageScroller>
              )}
            </div>
          </MessageScrollerProvider>

          <div className="mx-auto w-full max-w-3xl px-6 pb-6">
            <PromptInput
              disabled={!active}
              busy={busy}
              models={models}
              model={model}
              onModelChange={pickModel}
              onSend={send}
              onStop={() => window.api.stop()}
            />
          </div>
        </div>
        {terminal !== 'off' && (
          <TerminalPanel
            key={active?.cwd}
            cwd={active?.cwd}
            visible={terminal === 'open'}
            onExit={() => setTerminal('off')}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
