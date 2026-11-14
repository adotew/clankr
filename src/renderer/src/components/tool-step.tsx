import {
  BotIcon,
  FileTextIcon,
  GlobeIcon,
  ListTodoIcon,
  LoaderCircleIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react'

import { CodeBlock, CodeBlockContent, CodeBlockLine } from '@/components/ui/code-block'
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace'

export type ToolItem = {
  kind: 'tool'
  id: string
  name: string
  input: Record<string, unknown>
  result?: { text: string; isError: boolean }
}

const icons: Record<string, LucideIcon> = {
  Bash: TerminalIcon,
  Read: FileTextIcon,
  Write: PencilIcon,
  Edit: PencilIcon,
  MultiEdit: PencilIcon,
  NotebookEdit: PencilIcon,
  Glob: SearchIcon,
  Grep: SearchIcon,
  WebFetch: GlobeIcon,
  WebSearch: GlobeIcon,
  TodoWrite: ListTodoIcon,
  Task: BotIcon,
  Agent: BotIcon,
}

// Claude names tools "Bash", Pi names them "bash".
const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

// A short, human label for the call, e.g. the command or file path.
function describe(input: Record<string, unknown>) {
  const value =
    input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description
  return typeof value === 'string' ? value : ''
}

// Claude edits carry old_string/new_string; Pi edits carry a list of { oldText, newText }.
function edits(input: Record<string, unknown>): [string, string][] {
  const { old_string, new_string } = input
  if (typeof old_string === 'string' && typeof new_string === 'string') return [[old_string, new_string]]
  if (!Array.isArray(input.edits)) return []
  return input.edits.flatMap((e: { oldText?: unknown; newText?: unknown }) =>
    typeof e.oldText === 'string' && typeof e.newText === 'string' ? [[e.oldText, e.newText] as [string, string]] : [],
  )
}

// Edits show as a diff; everything else shows the tool's output.
function Details({ tool }: { tool: ToolItem }) {
  const diff = tool.result?.isError ? [] : edits(tool.input)
  if (diff.length) {
    return (
      <CodeBlockContent wrap className="max-h-72">
        {diff.map(([before, after], n) => [
          ...before.split('\n').map((line, i) => (
            <CodeBlockLine key={`${n}-${i}`} variant="removed">
              {line}
            </CodeBlockLine>
          )),
          ...after.split('\n').map((line, i) => (
            <CodeBlockLine key={`${n}+${i}`} variant="added">
              {line}
            </CodeBlockLine>
          )),
        ])}
      </CodeBlockContent>
    )
  }
  const { content } = tool.input
  const text = title(tool.name) === 'Write' && typeof content === 'string' ? content : (tool.result?.text ?? '')
  return (
    <CodeBlockContent wrap className="max-h-72">
      {text || '(no output)'}
    </CodeBlockContent>
  )
}

export function ToolStep({ tool, running }: { tool: ToolItem; running: boolean }) {
  const name = title(tool.name)
  const Icon = icons[name] ?? WrenchIcon
  const failed = tool.result?.isError
  const pending = !tool.result

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger disabled={pending}>
        <TraceLine status={failed ? 'error' : pending ? (running ? 'running' : 'pending') : undefined}>
          <TraceIcon>{pending && running ? <LoaderCircleIcon className="animate-spin" /> : <Icon />}</TraceIcon>
          <TraceTitle>
            <span className="font-medium">{name}</span>{' '}
            <span className="font-mono text-xs">{describe(tool.input)}</span>
          </TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock size="sm" variant={failed ? 'destructive' : 'default'}>
          <Details tool={tool} />
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}
