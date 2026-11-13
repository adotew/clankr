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

// A short, human label for the call, e.g. the command or file path.
function describe(input: Record<string, unknown>) {
  const value = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ?? input.description
  return typeof value === 'string' ? value : ''
}

// Edits show as a diff; everything else shows the tool's output.
function Details({ tool }: { tool: ToolItem }) {
  const { old_string, new_string, content } = tool.input
  if (!tool.result?.isError && typeof old_string === 'string' && typeof new_string === 'string') {
    return (
      <CodeBlockContent wrap className="max-h-72">
        {old_string.split('\n').map((line, i) => (
          <CodeBlockLine key={`-${i}`} variant="removed">
            {line}
          </CodeBlockLine>
        ))}
        {new_string.split('\n').map((line, i) => (
          <CodeBlockLine key={`+${i}`} variant="added">
            {line}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    )
  }
  const text = tool.name === 'Write' && typeof content === 'string' ? content : (tool.result?.text ?? '')
  return (
    <CodeBlockContent wrap className="max-h-72">
      {text || '(no output)'}
    </CodeBlockContent>
  )
}

export function ToolStep({ tool, running }: { tool: ToolItem; running: boolean }) {
  const Icon = icons[tool.name] ?? WrenchIcon
  const failed = tool.result?.isError
  const pending = !tool.result

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger disabled={pending}>
        <TraceLine status={failed ? 'error' : pending ? (running ? 'running' : 'pending') : undefined}>
          <TraceIcon>{pending && running ? <LoaderCircleIcon className="animate-spin" /> : <Icon />}</TraceIcon>
          <TraceTitle>
            <span className="font-medium">{tool.name}</span> <span className="font-mono text-xs">{describe(tool.input)}</span>
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
