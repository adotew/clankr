import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { ArrowUpIcon, FileIcon, PaperclipIcon, SquareIcon, XIcon } from 'lucide-react'

import { ModelPicker } from '@/components/model-picker'
import { Button } from '@/components/ui/button'
import { folderName, popup } from '@/lib/ui'
import { cn } from '@/lib/utils'
import type { Backend, Context, Model, SlashCommand } from '../../../shared'

const k = (n: number) => `${Math.round(n / 1000)}k`
const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false

export type PromptInputHandle = { focus: () => void }

export function PromptInput(props: {
  ref?: Ref<PromptInputHandle>
  placeholder: string
  busy: boolean
  context?: Context
  models: Model[]
  model: string
  // Set once a thread has started: only that backend's models can continue it.
  backend?: Backend
  onModelChange: (model: string) => void
  // Undefined means the model's default level.
  effort?: string
  onEffortChange: (effort: string | undefined) => void
  onSend: (text: string) => void
  // Lets the user pick files; resolves their absolute paths.
  onAttach: () => Promise<string[]>
  // The skills and commands a prompt can start with, as `/name`.
  onCommands: () => Promise<SlashCommand[]>
  onStop: () => void
}) {
  const { busy, context } = props
  const [text, setText] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const textarea = useRef<HTMLTextAreaElement>(null)
  const canSend = !busy && (text.trim().length > 0 || files.length > 0)

  useImperativeHandle(props.ref, () => ({ focus: () => textarea.current?.focus() }), [])

  const percent =
    context?.tokens == null ? undefined : Math.min(100, Math.round((context.tokens / context.window) * 100))
  const [showPercent, setShowPercent] = useState(false)

  const add = (picked: string[]) => {
    setFiles((fs) => [...new Set([...fs, ...picked])])
    textarea.current?.focus()
  }

  // Typing `/` at the start opens a menu of commands, filtered by the rest of the word.
  const slash = text.match(/^\/(\S*)$/)?.[1].toLowerCase()
  const slashing = slash !== undefined
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [dismissed, setDismissed] = useState(false)
  const [selected, setSelected] = useState(0)
  const menu = useRef<HTMLDivElement>(null)
  const hits = slash === undefined ? [] : commands.filter((c) => c.name.toLowerCase().includes(slash))
  // Names that start with the query come first.
  const starts = (c: SlashCommand) => c.name.toLowerCase().startsWith(slash ?? '')
  const matches = [...hits.filter(starts), ...hits.filter((c) => !starts(c))]
  const menuOpen = !dismissed && matches.length > 0
  const current = Math.min(selected, matches.length - 1)

  const onCommands = useRef(props.onCommands)
  onCommands.current = props.onCommands
  useEffect(() => {
    setDismissed(false)
    setSelected(0)
    if (!slashing) return
    onCommands.current().then(setCommands, () => setCommands([]))
  }, [slashing, slash])

  useEffect(() => {
    menu.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const complete = (c: SlashCommand) => {
    setText(`/${c.name} `)
    textarea.current?.focus()
  }

  // Returns whether the menu took the key.
  const menuKey = (e: React.KeyboardEvent) => {
    if (!menuOpen) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      setSelected((current + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') complete(matches[current])
    else if (e.key === 'Escape') setDismissed(true)
    else return false
    e.preventDefault()
    return true
  }

  // Files dropped anywhere in the window attach here; without this, the page would navigate to the dropped file.
  const [drags, setDrags] = useState(0)
  useEffect(() => {
    const enter = (e: DragEvent) => hasFiles(e) && setDrags((n) => n + 1)
    const leave = (e: DragEvent) => hasFiles(e) && setDrags((n) => Math.max(0, n - 1))
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return
      e.preventDefault()
      setDrags(0)
      // Read before any await: the drop's data is gone after the event.
      const dropped = [...e.dataTransfer.files]
      // Files without a path of their own, e.g. images dragged from a web page, are saved to a temp folder.
      const paths = await Promise.all(
        dropped.map(
          async (f) =>
            window.api.pathOf(f) || window.api.saveAttachment(f.name, await f.arrayBuffer()).catch(() => undefined),
        ),
      )
      add(paths.filter((p) => p !== undefined))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSend) return
    // The agents read attachments with their own file tools, so they only need the paths.
    const list = files.map((f) => `- ${f}`).join('\n')
    props.onSend([text.trim(), list && `Attached files:\n${list}`].filter(Boolean).join('\n\n'))
    setText('')
    setFiles([])
  }

  const contextLabel =
    context &&
    (percent === undefined
      ? 'Context: recalculating after compaction'
      : `Context: ${k(context.tokens ?? 0)} / ${k(context.window)} tokens`)

  return (
    <>
      {/* Doesn't take pointer events, so the drag keeps reaching the page and the counter above stays right. */}
      {drags > 0 && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-3 backdrop-blur-sm transition-opacity starting:opacity-0">
          <div className="flex size-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-foreground/20 text-muted-foreground">
            <PaperclipIcon className="size-8" />
            <p className="text-sm font-medium text-foreground/80">Drop files to attach</p>
          </div>
        </div>
      )}
      <form onSubmit={submit}>
        <div
          className={cn(
            'relative flex w-full min-w-0 flex-col rounded-2xl ring-2 ring-transparent transition-shadow dark:bg-input/30',
            drags > 0 && 'ring-ring/50',
          )}
        >
          {menuOpen && (
            <div
              ref={menu}
              id="slash-commands"
              role="listbox"
              aria-label="Commands"
              className={cn('absolute inset-x-0 bottom-full z-10 mb-1.5 max-h-72 overflow-y-auto rounded-xl p-1', popup)}
            >
              {matches.map((c, i) => (
                <div
                  key={c.name}
                  role="option"
                  id={`slash-${i}`}
                  tabIndex={-1}
                  aria-selected={i === current}
                  data-selected={i === current || undefined}
                  onMouseMove={() => setSelected(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => complete(c)}
                  title={c.description}
                  className={cn(
                    'flex h-8 cursor-default items-center gap-3 rounded-md px-2 text-sm',
                    i === current && 'bg-foreground/10',
                  )}
                >
                  <span className="shrink-0">/{c.name}</span>
                  {c.description && <span className="min-w-0 truncate text-muted-foreground">{c.description}</span>}
                </div>
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {files.map((file) => (
                <span
                  key={file}
                  title={file}
                  className="flex max-w-60 items-center gap-1 rounded-md bg-foreground/[0.06] py-0.5 pr-0.5 pl-1.5 text-xs text-foreground/80"
                >
                  <FileIcon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{folderName(file)}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((fs) => fs.filter((f) => f !== file))}
                    aria-label={`Remove ${folderName(file)}`}
                    className="rounded p-0.5 text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* Grows with its text, up to max-h-60. */}
          <textarea
            ref={textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={props.placeholder}
            aria-label="Message"
            aria-controls={menuOpen ? 'slash-commands' : undefined}
            aria-activedescendant={menuOpen ? `slash-${current}` : undefined}
            rows={1}
            className="field-sizing-content max-h-60 min-h-16 w-full resize-none bg-transparent p-3 text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || menuKey(e)) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="flex w-full items-center justify-end gap-2 px-2.5 pb-2 text-sm font-medium text-muted-foreground">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={async () => add(await props.onAttach())}
              disabled={busy}
              aria-label="Attach files"
              title="Attach files"
              className="mr-auto"
            >
              <PaperclipIcon />
            </Button>
            <ModelPicker
              models={props.models}
              model={props.model}
              backend={props.backend}
              effort={props.effort}
              disabled={busy}
              onModelChange={props.onModelChange}
              onEffortChange={props.onEffortChange}
            />
            {context && (
              <div className="group relative">
                <button
                  type="button"
                  aria-label={contextLabel}
                  aria-expanded={showPercent}
                  onClick={() => setShowPercent((s) => !s)}
                  className={cn(
                    'flex items-center rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    percent !== undefined && percent >= 85 && 'text-destructive',
                    percent !== undefined && percent >= 70 && percent < 85 && 'text-amber-500',
                  )}
                >
                  <svg viewBox="0 0 16 16" className="size-4 -rotate-90">
                    <circle
                      cx="8"
                      cy="8"
                      r="6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      opacity="0.2"
                      strokeDasharray={percent === undefined ? '2 2' : undefined}
                    />
                    {percent !== undefined && (
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        pathLength="100"
                        strokeDasharray={`${percent} 100`}
                      />
                    )}
                  </svg>
                </button>
                <div
                  className={cn(
                    'pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 origin-bottom -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap tabular-nums transition duration-150 ease-out group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100',
                    popup,
                    showPercent ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-1 scale-95 opacity-0',
                  )}
                >
                  <span className="absolute top-full left-1/2 -translate-x-1/2 border-x-[5px] border-t-[5px] border-x-transparent border-t-popover/80" />
                  {percent === undefined ? (
                    'Recalculating after compaction'
                  ) : (
                    <>
                      <span className="font-semibold text-foreground">{percent}%</span>{' '}
                      <span className="text-muted-foreground">
                        · {k(context.tokens ?? 0)} / {k(context.window)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
            {busy ? (
              <Button className="size-8 rounded-full" size="icon" onClick={props.onStop} aria-label="Stop">
                <SquareIcon className="fill-current" />
              </Button>
            ) : (
              <Button type="submit" className="size-8 rounded-full" size="icon" disabled={!canSend} aria-label="Send">
                <ArrowUpIcon />
              </Button>
            )}
          </div>
        </div>
      </form>
    </>
  )
}
