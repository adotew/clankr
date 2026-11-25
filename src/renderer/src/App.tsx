import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitCompareIcon,
  GlobeIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  PlusIcon,
  SettingsIcon,
  SquareTerminalIcon,
  XIcon,
} from 'lucide-react'
import type { BotAvatarState } from 'bot-avatars'

import {
  block,
  BotAvatar,
  botFromId,
  BotPicker,
  randomBot,
  Roster,
  type Bot,
  type RosterEntry,
} from '@/components/bots'
import { DocLinksContext } from '@/components/markdown'
import { Palette, type PaletteRow } from '@/components/palette'
import { PanelRail, type PanelView } from '@/components/panel'
import { PromptInput, type PromptInputHandle } from '@/components/prompt-input'
import { AskCard, Reply, type Ask } from '@/components/reply'
import { saveUrl } from '@/components/browser-view'
import { TerminalPanel } from '@/components/terminal-panel'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { applyEvent, toTurns, type Item } from '@/lib/items'
import { folderName, popup, store, stored } from '@/lib/ui'
import { cn } from '@/lib/utils'
import type { Answer, Backend, Command, Context, Model, Thread } from '../../shared'

// A thread open in the window or running in the background. `key` names it before it has an `id`, which a new
// thread's first turn returns. `cwd` is unset until a "Chat" thread gets its scratch folder; `folder` is unset for
// "Chat". `title` is a new thread's first prompt, until the thread list has its real title.
type Session = {
  key: string
  id?: string
  cwd?: string
  folder?: string
  backend?: Backend
  title?: string
  items: Item[]
  asks: Ask[]
  busy: boolean
  // Unknown until the thread's first turn in this window.
  context?: Context
}
const blank = (key: string, cwd?: string): Session => ({
  key,
  cwd,
  folder: cwd && folderName(cwd),
  items: [],
  asks: [],
  busy: false,
})

const backendOf = (model: string) => model.split(':')[0] as Backend

// State that handlers can also read and write synchronously, through the ref, after an await or from a listener
// registered once.
function useRefState<T>(initial: () => T) {
  const [value, setValue] = useState(initial)
  const ref = useRef(value)
  const set = useCallback((next: T) => {
    ref.current = next
    setValue(next)
  }, [])
  return [value, set, ref] as const
}

const shortcuts: Record<string, Command> = {
  KeyJ: 'terminal',
  KeyG: 'diff',
  KeyB: 'browser',
  KeyP: 'threads',
  KeyN: 'newThread',
}
const shiftShortcuts: Record<string, Command> = { KeyP: 'commands', KeyE: 'effort', KeyM: 'docs' }

function MenuItem({
  label,
  icon,
  run,
  title,
  onRemove,
}: {
  label: string
  icon: ReactNode
  run: () => void
  title?: string
  onRemove?: () => void
}) {
  return (
    <div className="group relative flex">
      <button
        type="button"
        popoverTarget="project-menu"
        popoverTargetAction="hide"
        onClick={run}
        title={title}
        className={cn(
          'flex flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-foreground/10 focus-visible:bg-foreground/10 [&_svg]:size-4 [&_svg]:text-muted-foreground',
          onRemove && 'pr-7',
        )}
      >
        {icon}
        {label}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          title="Remove from recents"
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5"
        >
          <XIcon />
        </button>
      )}
    </div>
  )
}

export function App() {
  const [threads, setThreads] = useState<Thread[]>([])

  // A new thread shows its bot before it has an ID; the bot is stored under the ID once the first turn returns one.
  const [bots, setBots, botsRef] = useRefState(() => stored<Record<string, Bot>>('bots', {}))
  // New threads' bots by key, from their first prompt until their first turn returns an ID.
  const [keyBots, setKeyBots, keyBotsRef] = useRefState<Record<string, Bot>>(() => ({}))
  // The next new thread's key and bot. The key is also its dock slot; the thread keeps it once it has an ID, so the
  // slot never remounts.
  const [pending, setPending, pendingRef] = useRefState(() => ({
    key: crypto.randomUUID() as string,
    bot: randomBot(Object.values(botsRef.current).slice(-8)),
  }))
  const dockKeys = useRef(new Map<string, string>())
  const keyOf = (id: string) => dockKeys.current.get(id) ?? id
  const botOf = (key: string, id?: string) => (id && bots[id]) || keyBots[key] || (id ? botFromId(id) : pending.bot)
  // Where the new thread's bot was clicked to pick its look.
  const [picking, setPicking] = useState<DOMRect>()

  // Set on mount: the last project, or "Chat" before any project was opened.
  const [sessions, setSessions, sessionsRef] = useRefState(() => ({ [pendingRef.current.key]: blank(pendingRef.current.key) }))
  const [activeKey, setActiveKey, activeKeyRef] = useRefState<string>(() => pendingRef.current.key)
  const active = sessions[activeKey] ?? blank(activeKey)

  const [models, setModels] = useState<Model[]>([])
  const [model, setModel] = useState(() => stored('model', 'claude:default'))
  const [recents, setRecents] = useState(() => stored<string[]>('recentProjects', []))
  // 'hidden' keeps the shell running while the panel is closed.
  const [terminal, setTerminal] = useState<'off' | 'open' | 'hidden'>('off')
  const [panelView, setPanelView] = useState<PanelView>('terminal')
  // The Markdown file open in the panel's docs view; its file list when undefined.
  const [doc, setDoc] = useState<string>()
  // A page an agent opened in the thread showing.
  const [browserOpen, setBrowserOpen] = useState<{ url: string }>()
  // Pages agents opened in other threads that have no session ID yet to keep them under.
  const agentUrls = useRef(new Map<string, string>())
  const [palette, setPalette] = useState<'commands' | 'threads'>()
  const [branch, setBranch] = useState<string>()
  // Effort is remembered per model, so switching models brings back that model's level.
  const [efforts, setEfforts] = useState(() => stored<Record<string, string>>('efforts', {}))

  const project = active.folder !== undefined
  // Recent projects to switch to, for the project menu.
  const otherProjects = recents.filter((dir) => !(project && dir === active.cwd))
  const turns = toTurns(active.items)
  const levels = models.find((m) => m.value === model)?.efforts ?? []
  const effort = levels.includes(efforts[model]) ? efforts[model] : undefined

  const promptInput = useRef<PromptInputHandle>(null)
  // Bumped to focus the prompt once it has rendered, e.g. on a new thread.
  const [focusPrompt, setFocusPrompt] = useState(0)
  useEffect(() => promptInput.current?.focus(), [focusPrompt])

  useEffect(() => {
    const cwd = active.folder && active.cwd
    setBranch(undefined)
    if (!cwd) return
    let stale = false
    window.api.branch(cwd).then((b) => stale || setBranch(b))
    return () => {
      stale = true
    }
  }, [active.folder, active.cwd])

  // A new project starts the docs view on its file list.
  const panelCwd = project ? active.cwd : undefined
  const [docCwd, setDocCwd] = useState(panelCwd)
  if (docCwd !== panelCwd) {
    setDocCwd(panelCwd)
    setDoc(undefined)
  }

  // Shows `view` in the panel, or hides the panel if `view` is already showing. "Chat" threads have no panel.
  const toggle = (view: PanelView) => {
    if (!project) return
    setTerminal(terminal === 'open' && panelView === view ? 'hidden' : 'open')
    setPanelView(view)
  }
  // Paths to Markdown files in replies open in the docs view.
  const openDoc = useCallback((path: string) => {
    setDoc(path)
    setTerminal('open')
    setPanelView('docs')
  }, [])
  const docLinks = useMemo(() => ({ base: panelCwd, open: openDoc }), [panelCwd, openDoc])
  const togglePalette = (p: 'commands' | 'threads') => setPalette((x) => (x === p ? undefined : p))

  // Menu commands; their shortcuts too while the page has focus.
  const run = (command: Command) => {
    if (command === 'terminal' || command === 'diff' || command === 'browser' || command === 'docs') toggle(command)
    else if (command === 'threads' || command === 'commands') togglePalette(command)
    else if (command === 'newThread') newThread()
    else if (command === 'effort' && !active.busy) cycleEffort()
  }
  const runRef = useRef(run)
  runRef.current = run

  const update = (key: string, fn: (s: Session) => Partial<Session>) => {
    const s = sessionsRef.current[key]
    if (s) setSessions({ ...sessionsRef.current, [key]: { ...s, ...fn(s) } })
  }

  const refreshThreads = () => window.api.threads().then(setThreads)
  const refreshModels = () =>
    window.api.models().then(
      (list) => {
        setModels(list)
        // Fall back when the saved model's backend was disabled or the model went away.
        setModel((m) => (list.some((x) => x.value === m) || !list.length ? m : list[0].value))
      },
      (err) =>
        update(activeKeyRef.current, () => ({
          items: [{ kind: 'error', text: `Could not load models: ${err instanceof Error ? err.message : err}` }],
        })),
    )

  useEffect(() => {
    if (recents[0]) chooseProject(recents[0])
    refreshThreads()
    refreshModels()
    // Capture phase so the shortcut still works while the terminal has focus. Handled here, the menu doesn't fire
    // too; it does while the browser panel's page has focus.
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      const command = (e.shiftKey ? shiftShortcuts : shortcuts)[e.code]
      if (!command) return
      e.preventDefault()
      e.stopPropagation()
      runRef.current(command)
    }
    window.addEventListener('keydown', onKey, true)
    const offs = [
      window.api.onChanged(() => {
        refreshModels()
        refreshThreads()
      }),
      window.api.onEvent((thread, e) => {
        if (e.kind === 'ask') update(thread, (s) => ({ asks: [...s.asks, e] }))
        else if (e.kind === 'done') update(thread, () => ({ asks: [], busy: false }))
        else update(thread, (s) => ({ items: applyEvent(s.items, e) }))
      }),
      window.api.onCommand((command) => runRef.current(command)),
      // Only the agent's own thread changes: a thread in the background keeps the page for when it's shown.
      window.api.onBrowserOpen((key, url) => {
        const id = sessionsRef.current[key]?.id
        if (key === activeKeyRef.current) {
          setBrowserOpen({ url })
          setTerminal('open')
          setPanelView('browser')
        } else if (id) saveUrl(id, url)
        else agentUrls.current.set(key, url)
      }),
    ]
    return () => {
      window.removeEventListener('keydown', onKey, true)
      offs.forEach((off) => off())
    }
  }, [])

  // Forgets an idle thread; its history is on disk.
  const drop = (key: string) => {
    const { [key]: _, ...rest } = sessionsRef.current
    setSessions(rest)
    window.api.release(key)
  }

  // Shows `next`. The thread being left is forgotten, unless its turn is still running; then it carries on in the
  // dock and is forgotten when the turn ends.
  const activate = (next: Session) => {
    const prev = sessionsRef.current[activeKeyRef.current]
    if (prev && !prev.busy && prev.key !== next.key) drop(prev.key)
    if (next.backend && backendOf(model) !== next.backend) pickModel(`${next.backend}:default`)
    setSessions({ ...sessionsRef.current, [next.key]: next })
    setActiveKey(next.key)
    setBrowserOpen(undefined)
  }

  // Starts a fresh thread in a project folder, or in "Chat" when `cwd` is undefined.
  const chooseProject = (cwd: string | undefined) => {
    activate(blank(pendingRef.current.key, cwd))
    setFocusPrompt((n) => n + 1)
    if (cwd)
      setRecents((rs) => {
        const next = [cwd, ...rs.filter((r) => r !== cwd)].slice(0, 5)
        store('recentProjects', next)
        return next
      })
  }

  const removeRecent = (dir: string) => {
    const next = recents.filter((r) => r !== dir)
    setRecents(next)
    store('recentProjects', next)
  }

  const pickFolder = async () => {
    const dir = await window.api.pickFolder()
    if (dir) chooseProject(dir)
  }

  // A "Chat" thread's scratch folder is never reused; the next one gets its own.
  const newThread = () => chooseProject(active.folder ? active.cwd : undefined)

  const openThread = async (thread: Thread) => {
    const key = keyOf(thread.id)
    // A thread still running in the background is already loaded, and its history on disk may lag behind.
    const running = sessionsRef.current[key]
    activate(running ?? { ...blank(key), id: thread.id, cwd: thread.cwd, folder: thread.folder, backend: thread.backend })
    if (running) return
    const items = (await window.api.openThread(thread)).reduce(applyEvent, [])
    update(key, () => ({ items }))
  }

  const renameThread = async (thread: Thread, title: string) => {
    await window.api.renameThread(thread, title)
    refreshThreads()
  }

  const deleteThread = async (thread: Thread) => {
    if (!(await window.api.deleteThread(thread))) return
    const key = keyOf(thread.id)
    if (key === activeKeyRef.current) chooseProject(thread.folder ? thread.cwd : undefined)
    else if (sessionsRef.current[key]) drop(key)
    refreshThreads()
  }

  const pickModel = (value: string) => {
    setModel(value)
    store('model', value)
  }

  const pickEffort = (value: string | undefined) => {
    const { [model]: _, ...rest } = efforts
    const next = value ? { ...rest, [model]: value } : rest
    setEfforts(next)
    store('efforts', next)
  }

  // Steps through Default and the model's levels, wrapping around.
  const cycleEffort = () => {
    if (!levels.length) return
    const order = [undefined, ...levels]
    pickEffort(order[(order.indexOf(effort) + 1) % order.length])
  }

  // Where the empty thread's large bot was when the first prompt went out; its dock slot flies in from there.
  const hero = useRef<HTMLButtonElement>(null)
  const flight = useRef<DOMRect>(undefined)
  // A bot works while its thread's turn runs, looks around while it waits for an answer or is open, and sleeps
  // otherwise.
  const entry = (key: string, id?: string) => {
    const s = sessions[key]
    const waiting = !!s?.busy && s.asks.length > 0
    const state: BotAvatarState = s?.busy && !waiting ? 'working' : waiting || key === activeKey ? 'default' : 'sleeping'
    return {
      key,
      bot: botOf(key, id),
      state,
      status: s?.busy ? (waiting ? 'waiting for you' : 'working') : undefined,
      waiting,
      selected: key === activeKey,
    }
  }

  const send = async (text: string) => {
    const { key, id, cwd, backend } = active
    // The new thread takes the pending bot; the next new thread gets another.
    if (key === pending.key) {
      flight.current = hero.current?.getBoundingClientRect()
      setKeyBots({ ...keyBotsRef.current, [key]: pending.bot })
      const taken = [pending.bot, ...threads.slice(0, 7).map((t) => botOf(keyOf(t.id), t.id))]
      setPending({ key: crypto.randomUUID(), bot: randomBot(taken) })
    }
    update(key, (s) => ({
      items: [...s.items, { kind: 'user', text }],
      busy: true,
      title: s.title ?? text,
      backend: s.backend ?? backendOf(model),
    }))
    const r = await window.api.send({ key, id, cwd, backend }, text, model, effort)
    if (!id && r?.sessionId) {
      dockKeys.current.set(r.sessionId, key)
      const next = { ...botsRef.current, [r.sessionId]: keyBotsRef.current[key] }
      setBots(next)
      store('bots', next)
    }
    if (r) update(key, () => ({ id: r.sessionId, cwd: r.cwd, backend: r.backend, context: r.context }))
    const url = agentUrls.current.get(key)
    if (url && r?.sessionId) {
      agentUrls.current.delete(key)
      if (key === activeKeyRef.current) setBrowserOpen({ url })
      else saveUrl(r.sessionId, url)
    }
    // Refreshed first, so a new thread finishing in the background moves into the list without leaving the dock.
    await refreshThreads()
    if (key !== activeKeyRef.current && !sessionsRef.current[key]?.busy) drop(key)
  }

  const reply = (id: string, answer: Answer) => {
    window.api.reply(id, answer)
    update(activeKeyRef.current, (s) => ({ asks: s.asks.filter((x) => x.id !== id) }))
  }

  const commands: PaletteRow[] = [
    { key: 'new', label: 'New thread', icon: <PlusIcon />, hint: '⌘N', run: newThread },
    { key: 'threads', label: 'Switch thread…', icon: <MessagesSquareIcon />, hint: '⌘P', run: () => setPalette('threads') },
    { key: 'folder', label: 'Open folder…', icon: <FolderOpenIcon />, run: pickFolder },
    { key: 'none', label: 'New chat', icon: <MessageCircleIcon />, run: () => chooseProject(undefined) },
    { key: 'terminal', label: 'Toggle terminal', icon: <SquareTerminalIcon />, hint: '⌘J', disabled: !project, run: () => toggle('terminal') },
    { key: 'diff', label: 'Toggle diff', icon: <GitCompareIcon />, hint: '⌘G', disabled: !project, run: () => toggle('diff') },
    { key: 'browser', label: 'Toggle browser', icon: <GlobeIcon />, hint: '⌘B', disabled: !project, run: () => toggle('browser') },
    { key: 'docs', label: 'Toggle docs', icon: <FileTextIcon />, hint: '⇧⌘M', disabled: !project, run: () => toggle('docs') },
    { key: 'settings', label: 'Settings', icon: <SettingsIcon />, hint: '⌘,', run: window.api.openSettings },
  ]
  const threadRows: PaletteRow[] = threads.map((t) => ({
    key: t.id,
    label: t.title,
    detail: [t.folder ?? 'Chat', t.backend === 'pi' && 'Pi'].filter(Boolean).join(' · '),
    icon: <BotAvatar {...botOf(keyOf(t.id), t.id)} state={entry(keyOf(t.id), t.id).state} size={20} />,
    run: () => openThread(t),
    onRename: (title) => renameThread(t, title),
    onDelete: () => deleteThread(t),
  }))

  // Threads not in the thread list yet (the open new thread, and new threads running in the background), then the
  // latest threads, and any open or running one wherever it is in the list.
  const listed = new Set(threads.map((t) => t.id))
  const entries: RosterEntry[] = [
    ...Object.values(sessions)
      .filter((s) => !(s.id && listed.has(s.id)))
      .map((s) => ({
        ...entry(s.key, s.id),
        title: s.title ?? 'New thread',
        folder: s.folder,
        branch: threads.find((t) => t.cwd === s.cwd)?.branch,
        away: s.items.length === 0,
        flyFrom: flight.current,
        onClick: s.key === activeKey ? undefined : () => activate(s),
      })),
    ...threads
      .filter((t, i) => i < 8 || !!sessions[keyOf(t.id)])
      .map((t) => ({
        ...entry(keyOf(t.id), t.id),
        title: t.title,
        folder: t.folder,
        branch: t.branch,
        onClick: keyOf(t.id) === activeKey ? undefined : () => openThread(t),
      })),
  ]

  const title = (active.id && threads.find((t) => t.id === active.id)?.title) || active.title || 'New thread'

  const prompt = (
    <PromptInput
      ref={promptInput}
      placeholder={active.folder ? 'Ask the agent to change your code…' : 'Ask anything…'}
      busy={active.busy}
      context={active.context}
      models={models}
      model={model}
      backend={active.id ? active.backend : undefined}
      onModelChange={pickModel}
      effort={effort}
      onEffortChange={pickEffort}
      onSend={send}
      onAttach={() => window.api.pickFiles(active.folder && active.cwd)}
      onCommands={() => window.api.commands(active.backend ?? backendOf(model), active.folder && active.cwd)}
      onStop={() => window.api.stop(activeKey)}
    />
  )

  return (
    <DocLinksContext value={docLinks}>
      <Palette
        open={palette === 'commands'}
        onOpenChange={(open) => setPalette(open ? 'commands' : undefined)}
        title="Commands"
        placeholder="Run a command…"
        sections={[['Commands', commands]]}
      />
      <Palette
        open={palette === 'threads'}
        onOpenChange={(open) => setPalette(open ? 'threads' : undefined)}
        title="Threads"
        placeholder="Search threads…"
        sections={[['Threads', threadRows]]}
      />
      <div className="relative flex h-svh min-w-0 flex-row overflow-clip">
        <Roster entries={entries} />
        {picking && (
          <BotPicker
            bot={pending.bot}
            anchor={picking}
            onChange={(bot) => setPending({ ...pendingRef.current, bot })}
            onClose={() => setPicking(undefined)}
          />
        )}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Window drag strip; once the chat has messages, it fades them out under the thread title. Stops short of the 10px scrollbar so the thumb stays on top. */}
          <div
            className={cn(
              'pointer-events-none absolute top-0 right-2.5 left-0 z-10 h-28',
              turns.length > 0 && 'bg-linear-to-b from-background from-40% to-transparent',
            )}
          >
            {/* Height centers the title on the macOS traffic lights. */}
            <div className="pointer-events-auto flex h-[54px] items-center gap-4 pr-12 pl-12 [-webkit-app-region:drag] fullscreen:pl-6">
              {turns.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPalette('threads')}
                  title="Switch thread (⌘P)"
                  className="-mx-2 min-w-0 truncate rounded-lg px-2 py-1 text-sm font-medium text-foreground/80 transition-colors outline-none [-webkit-app-region:no-drag] hover:bg-foreground/10 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {title}
                </button>
              )}
            </div>
          </div>

          {turns.length === 0 ? (
            // Empty thread: heading and prompt sit together in the middle.
            <div className="relative flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-16">
              <div className="relative flex flex-col items-center gap-3">
                {/* The new thread's dock bot, shown large here; it flies to its dock slot with the first prompt. */}
                <button
                  ref={hero}
                  type="button"
                  title="Change look"
                  onClick={(e) => setPicking(e.currentTarget.getBoundingClientRect())}
                  className="mb-3 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <BotAvatar {...pending.bot} size={64} style={block} />
                </button>
                <h1 className="text-4xl tracking-tight text-foreground/85">What should we work on?</h1>
              </div>
              <div className="relative flex w-full max-w-3xl flex-col gap-2">
                {prompt}
                <div className="flex items-center gap-1 self-start">
                  <button
                    type="button"
                    popoverTarget="project-menu"
                    title={active.folder && active.cwd}
                    style={{ anchorName: '--project-menu' }}
                    className="rounded-md px-2 py-1 text-xs font-medium text-foreground/70 transition-colors outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {active.folder ?? 'Chat'}
                  </button>
                  {branch && (
                    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" title="Current branch">
                      <GitBranchIcon className="size-3 shrink-0" />
                      <span className="truncate">{branch}</span>
                    </span>
                  )}
                </div>
                <div
                  id="project-menu"
                  popover="auto"
                  style={{ positionAnchor: '--project-menu' } as CSSProperties}
                  className={cn(
                    'inset-auto m-0 mt-1 min-w-40 flex-col rounded-lg p-1 text-sm [position-area:bottom_span-right] open:flex',
                    popup,
                  )}
                >
                  {otherProjects.map((dir) => (
                    <MenuItem
                      key={dir}
                      label={folderName(dir)}
                      icon={<FolderIcon />}
                      run={() => chooseProject(dir)}
                      title={dir}
                      onRemove={() => removeRecent(dir)}
                    />
                  ))}
                  {otherProjects.length > 0 && <hr className="mx-1.5 my-1 border-foreground/10" />}
                  <MenuItem label="Chat" icon={<MessageCircleIcon />} run={() => chooseProject(undefined)} />
                  <MenuItem label="Open folder…" icon={<FolderOpenIcon />} run={pickFolder} />
                </div>
              </div>
            </div>
          ) : (
            // Remounted per thread, so each one opens scrolled to its end.
            <MessageScrollerProvider key={activeKey} autoScroll>
              <div className="min-h-0 flex-1">
                <MessageScroller>
                  <MessageScrollerViewport>
                    <MessageScrollerContent aria-busy={active.busy} className="mx-auto w-full max-w-3xl px-6 pt-25 pb-6">
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
                            {(turn.replies.length > 0 || (last && active.busy)) && (
                              <Reply
                                replies={turn.replies}
                                streaming={last && active.busy}
                                waiting={active.asks.length > 0}
                              />
                            )}
                            {last &&
                              active.asks.map((a) => (
                                <AskCard key={a.id} ask={a} onReply={(answer) => reply(a.id, answer)} />
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
        {terminal !== 'off' && project && (
          <TerminalPanel
            cwd={active.cwd}
            thread={active.id}
            browserOpen={browserOpen}
            visible={terminal === 'open'}
            view={panelView}
            doc={doc}
            onDoc={setDoc}
            onExit={() => setTerminal('off')}
          />
        )}
        {/* The panel's view tabs stay put while it slides: open, they sit in its header (8px panel margin, then the
            header's centre and 8px padding); closed, at the same spot in the window corner. */}
        {project && (
          <PanelRail
            floating
            view={terminal === 'open' ? panelView : undefined}
            onView={toggle}
            className="top-3.5 right-4"
          />
        )}
      </div>
    </DocLinksContext>
  )
}
