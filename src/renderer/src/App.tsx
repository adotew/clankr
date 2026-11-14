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
import { SettingsSheet } from '@/components/settings'
import { TerminalPanel } from '@/components/terminal-panel'
import { ToolStep, type ToolItem } from '@/components/tool-step'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import type { AgentEvent, Backend, Model, Thread } from '../../shared'

type Item = { kind: 'user' | 'assistant' | 'error'; text: string } | ToolItem
type Ask = Extract<AgentEvent, { kind: 'ask' }>
type Answer = boolean | string | undefined

const backendOf = (model: string) => model.split(':')[0] as Backend
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

// Claude permission requests (yes/no) and Pi extension dialogs (yes/no, a choice, or free text).
function AskCard({ ask, onReply }: { ask: Ask; onReply: (answer: Answer) => void }) {
  const [text, setText] = useState('')
  return (
    <Item variant="outline" size="sm" className="flex-wrap">
      <ItemMedia variant="icon">
        <ShieldQuestionIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{ask.title}</ItemTitle>
        {ask.detail && !ask.input && (
          <ItemDescription className="truncate font-mono text-xs">{ask.detail}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions className="flex-wrap">
        {ask.options ? (
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
        ) : ask.input ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              onReply(text)
            }}
          >
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={ask.detail}
              className="h-8 w-56"
              autoFocus
            />
            <Button type="button" size="sm" variant="outline" onClick={() => onReply(undefined)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Send
            </Button>
          </form>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => onReply(false)}>
              Deny
            </Button>
            <Button size="sm" onClick={() => onReply(true)}>
              Allow
            </Button>
          </>
        )}
      </ItemActions>
    </Item>
  )
}

export function App() {
  const [threads, setThreads] = useState<Thread[]>([])
  // Starts in "No project": a plain chat without any project context.
  const [active, setActive] = useState<Active>({})
  const [models, setModels] = useState<Model[]>([])
  // Saved models from before Pi support carry no backend prefix.
  const [model, setModel] = useState(() => {
    const saved = localStorage.getItem('model') ?? 'default'
    return /^(claude|pi):/.test(saved) ? saved : `claude:${saved}`
  })
  const [items, setItems] = useState<Item[]>([])
  const [asks, setAsks] = useState<Ask[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const refreshModels = () =>
    window.api.models().then(
      (list) => {
        setModels(list)
        // Fall back when the saved model's backend was disabled or the model went away.
        setModel((m) => (list.some((x) => x.value === m) || !list.length ? m : list[0].value))
      },
      (err) => setItems([{ kind: 'error', text: `Could not load models: ${err}` }]),
    )

  useEffect(() => {
    refreshThreads()
    refreshModels()
    return window.api.onEvent((e) => {
      if (e.kind === 'ask') setAsks((xs) => [...xs, e])
      else if (e.kind === 'done') {
        setAsks([])
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
    setActive({ id: thread.id, cwd: thread.cwd, folder: thread.folder, backend: thread.backend })
    if (backendOf(model) !== thread.backend) pickModel(`${thread.backend}:default`)
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
    if (r) setActive((a) => ({ ...a, id: r.sessionId, cwd: r.cwd, backend: r.backend }))
    refreshThreads()
  }

  const reply = (id: string, answer: Answer) => {
    window.api.reply(id, answer)
    setAsks((xs) => xs.filter((x) => x.id !== id))
  }

  // Runs a command (e.g. `pi auth login`) in the terminal panel, opening it if needed.
  const runInTerminal = (command: string) => {
    window.api.term.run(command)
    setTerminal('open')
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
      backend={active.id ? active.backend : undefined}
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
      <AppSidebar
        threads={threads}
        active={active}
        busy={busy}
        onNew={newThread}
        onOpen={openThread}
        onSettings={() => setSettingsOpen(true)}
      />
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        models={models}
        onRunInTerminal={(command) => {
          setSettingsOpen(false)
          runInTerminal(command)
        }}
        onChange={() => {
          refreshModels()
          refreshThreads()
        }}
      />
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
                              asks.map((a) => <AskCard key={a.id} ask={a} onReply={(answer) => reply(a.id, answer)} />)}
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
