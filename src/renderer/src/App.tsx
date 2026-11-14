import { useEffect, useState } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  FolderOpenIcon,
  MessageCircleIcon,
  ShieldQuestionIcon,
} from 'lucide-react'

import { AppSidebar, folderName, type Active } from '@/components/app-sidebar'
import GradientASCII from '@/components/gradient-ascii/GradientASCII'
import { Markdown } from '@/components/markdown'
import { cn } from '@/lib/utils'
import { PromptInput } from '@/components/prompt-input'
import { TerminalPanel } from '@/components/terminal-panel'
import { ToolStep, type ToolItem } from '@/components/tool-step'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
    <div className="absolute inset-x-0 top-0 z-10 h-11 [-webkit-app-region:drag]">
      {/* Mirrors the floating sidebar's top row so the traffic lights and toggle stay put when it closes. */}
      {!open && (
        <div className="absolute top-2 left-2 flex h-9 items-center gap-2 rounded-2xl bg-sidebar/50 pr-3 pl-20 shadow-sm ring-1 ring-sidebar-border backdrop-blur-xl fullscreen:pl-2">
          <SidebarTrigger className="[-webkit-app-region:no-drag]" />
          <span className="font-heming text-sm font-medium [text-box:trim-both_cap_alphabetic]">Clankr</span>
        </div>
      )}
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
  // Starts in "No project": a plain chat without any project context.
  const [active, setActive] = useState<Active>({})
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

  // Starts a fresh thread in a project folder, or in "No project" when `cwd` is undefined.
  const chooseProject = async (cwd: string | undefined) => {
    await window.api.newThread(cwd)
    setActive({ cwd, folder: cwd && folderName(cwd) })
    setItems([])
  }

  const pickFolder = async () => {
    const dir = await window.api.pickFolder()
    if (dir) chooseProject(dir)
  }

  // A "No project" thread's scratch folder is never reused; the next one gets its own.
  const newThread = () => chooseProject(active.folder ? active.cwd : undefined)

  const openThread = async (thread: Thread) => {
    setActive({ id: thread.id, cwd: thread.cwd, folder: thread.folder })
    setItems((await window.api.openThread(thread)).reduce(applyEvent, []))
  }

  const pickModel = (value: string) => {
    setModel(value)
    localStorage.setItem('model', value)
  }

  const send = async (text: string) => {
    setItems((xs) => [...xs, { kind: 'user', text }])
    setBusy(true)
    const r = await window.api.send(text, model)
    if (r) setActive((a) => ({ ...a, id: r.sessionId, cwd: r.cwd }))
    refreshThreads()
  }

  const reply = (id: string, allow: boolean) => {
    window.api.reply(id, allow)
    setPermissions((ps) => ps.filter((p) => p.id !== id))
  }

  const turns = toTurns(items)
  const [background, setBackground] = useState(true)
  if (turns.length === 0 && !background) setBackground(true)

  const prompt = (
    <PromptInput
      placeholder={active.folder ? 'Ask the agent to change your code…' : 'Ask anything…'}
      busy={busy}
      models={models}
      model={model}
      onModelChange={pickModel}
      onSend={send}
      onStop={() => window.api.stop()}
    />
  )

  return (
    <SidebarProvider>
      {background && (
        // Shows through the translucent sidebar; fades out once the first prompt is sent, then unmounts to free the GPU.
        <GradientASCII
          className={cn(
            'pointer-events-none !fixed inset-0 transition-opacity duration-700',
            turns.length > 0 && 'opacity-0',
          )}
          onTransitionEnd={() => turns.length > 0 && setBackground(false)}
          colors={['#1e3fd8', '#f6f8ff', '#a5d8ff', '#38bdf8']}
          shape="horizon"
          characters=" 01"
          cellSize={12}
          density={0.8}
          glyphOpacity={0.84}
          scale={1.85}
          gradientOpacity={0.83}
          grain={0.16}
          variation={20}
          scrambleRadius={0.29}
          fontFamily='"JetBrainsMono Nerd Font", ui-monospace, monospace'
        />
      )}
      <AppSidebar threads={threads} active={active} busy={busy} onNew={newThread} onOpen={openThread} />
      <SidebarInset className="h-svh min-w-0 flex-row bg-transparent">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <TitleBar />

          {turns.length === 0 ? (
            // Empty thread: heading and prompt sit together in the middle.
            <div className="relative flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-16">
              <div className="relative flex flex-col items-center gap-3">
                <h1 className="text-4xl tracking-tight text-foreground/85">What should we work on?</h1>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={busy}
                    title={active.folder && active.cwd}
                    className="flex items-center gap-1 rounded-md px-2 font-medium text-foreground/70 transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {active.folder ?? 'No project'}
                    <ChevronDownIcon className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="min-w-40">
                    <DropdownMenuItem onClick={() => chooseProject(undefined)}>
                      <MessageCircleIcon />
                      No project
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={pickFolder}>
                      <FolderOpenIcon />
                      Open folder…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="relative w-full max-w-3xl rounded-2xl bg-background/30 backdrop-blur-md [&_[data-slot=input-group]]:border-transparent">
                {prompt}
              </div>
            </div>
          ) : (
            <MessageScrollerProvider autoScroll>
              <div className="min-h-0 flex-1">
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
              </div>
            </MessageScrollerProvider>
          )}

          {turns.length > 0 && <div className="mx-auto w-full max-w-3xl px-6 pb-6">{prompt}</div>}
        </div>
        {terminal !== 'off' && (
          <TerminalPanel
            key={active.cwd}
            cwd={active.cwd}
            visible={terminal === 'open'}
            onExit={() => setTerminal('off')}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
