import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { AgentEvent } from '../shared'

// Apps started from Finder miss the login shell's environment (PATH, PI_CODING_AGENT_DIR, …),
// so read it once from an interactive login shell, the way a terminal would see it.
export const shellEnv: Promise<NodeJS.ProcessEnv> = new Promise((resolve) => {
  const marker = '__CLANKR_ENV__'
  execFile(
    process.env.SHELL ?? '/bin/zsh',
    ['-ilc', `printf '${marker}'; env -0`],
    { timeout: 10_000, maxBuffer: 10_000_000 },
    (_, stdout) => {
      const env = { ...process.env }
      const body = String(stdout ?? '').split(marker)[1]
      for (const pair of body?.split('\0') ?? []) {
        const i = pair.indexOf('=')
        if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1)
      }
      // These leak in when the app itself is launched from a pi session.
      for (const k of [
        'PI_SESSION_FILE',
        'PI_SESSION_ID',
        'PI_MODEL',
        'PI_PROVIDER',
        'PI_REASONING_LEVEL',
        'PI_CODING_AGENT',
      ])
        delete env[k]
      resolve(env)
    },
  )
})

const run = async (bin: string, args: string[]) =>
  new Promise<{ ok: boolean; out: string }>(async (resolve) => {
    execFile(bin, args, { env: await shellEnv, timeout: 30_000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() || String(err ?? '') }),
    )
  })

export const piVersion = (bin: string) => run(bin, ['--version'])

type Content = { type: string; text?: string }
type PiMessage = {
  role: string
  content?: string | (Content & { id?: string; name?: string; arguments?: Record<string, unknown> })[]
  toolCallId?: string
  isError?: boolean
  stopReason?: string
  errorMessage?: string
}
export type PiModel = { id: string; name: string; provider: string }

// The subset of RPC records this app reads; see pi's docs/rpc.md and docs/json.md.
export type PiRecord =
  | { type: 'response'; id?: string; success: boolean; error?: string; data?: unknown }
  | { type: 'message_update'; assistantMessageEvent: { type: string; delta?: string } }
  | { type: 'message_end'; message: PiMessage }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_execution_end'; toolCallId: string; result: { content?: Content[] }; isError: boolean }
  | {
      type: 'extension_ui_request'
      id: string
      method: string
      title?: string
      message?: string
      options?: string[]
      placeholder?: string
      notifyType?: string
    }
  | { type: 'agent_settled' }

// Skips lines that aren't JSON, e.g. a session file's half-written last line.
const parse = <T>(line: string): T[] => {
  try {
    return [JSON.parse(line) as T]
  } catch {
    return []
  }
}

const toText = (content: PiMessage['content']) =>
  typeof content === 'string'
    ? content
    : (content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')

// A long-lived `pi --mode rpc` process: JSON commands on stdin, responses and events on stdout.
export class PiRpc {
  private proc: ChildProcessWithoutNullStreams
  private calls = new Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void }>()
  private next = 0
  private stderr = ''
  onRecord: (r: PiRecord) => void = () => {}
  onSettled: () => void = () => {}
  onExit: (reason: string) => void = () => {}

  constructor(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.proc = spawn(bin, ['--mode', 'rpc', ...args], { cwd, env })
    let buf = ''
    this.proc.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buf += chunk
      // Split on LF only: JSON strings may contain U+2028/U+2029, which readline would split on.
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i).replace(/\r$/, '')
        buf = buf.slice(i + 1)
        parse<PiRecord>(line).forEach((r) => this.receive(r))
      }
    })
    this.proc.stderr
      .setEncoding('utf8')
      .on('data', (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-2000)))
    this.proc.on('error', (err) => this.exit(err.message))
    this.proc.on('exit', (code) => this.exit(this.stderr.trim() || `pi exited with code ${code}`))
  }

  private receive(r: PiRecord) {
    const call = r.type === 'response' && r.id ? this.calls.get(r.id) : undefined
    if (r.type === 'response' && call) {
      this.calls.delete(r.id!)
      if (r.success) call.resolve(r.data)
      else call.reject(new Error(r.error))
    } else if (r.type === 'agent_settled') this.onSettled()
    else this.onRecord(r)
  }

  private exit(reason: string) {
    for (const call of this.calls.values()) call.reject(new Error(reason))
    this.calls.clear()
    this.onExit(reason)
  }

  call<T>(command: Record<string, unknown>): Promise<T> {
    const id = String(++this.next)
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve: (data) => resolve(data as T), reject })
      this.send({ ...command, id })
    })
  }

  send(record: Record<string, unknown>) {
    this.proc.stdin.write(JSON.stringify(record) + '\n')
  }

  // Closing stdin asks pi to shut down cleanly; kill it if it hangs.
  close() {
    this.onExit = () => {}
    this.proc.stdin.end()
    setTimeout(() => this.proc.kill(), 5000).unref()
  }
}

export async function piModels(bin: string): Promise<PiModel[]> {
  const pi = new PiRpc(bin, ['--no-session'], homedir(), await shellEnv)
  try {
    return (await pi.call<{ models: PiModel[] }>({ type: 'get_available_models' })).models
  } finally {
    pi.close()
  }
}

// Live RPC records to UI events. Assistant text streams as deltas, so full messages are only used for errors.
export function toEvents(r: PiRecord): AgentEvent[] {
  switch (r.type) {
    case 'message_update': {
      const e = r.assistantMessageEvent
      if (e.type === 'text_start') return [{ kind: 'text', text: '' }]
      if (e.type === 'text_delta') return [{ kind: 'delta', text: e.delta ?? '' }]
      return []
    }
    case 'message_end':
      return r.message.role === 'assistant' && r.message.stopReason === 'error'
        ? [{ kind: 'error', text: r.message.errorMessage ?? 'Error' }]
        : []
    case 'tool_execution_start':
      return [{ kind: 'tool', id: r.toolCallId, name: r.toolName, input: r.args }]
    case 'tool_execution_end':
      return [{ kind: 'result', id: r.toolCallId, text: toText(r.result.content), isError: r.isError }]
    case 'extension_ui_request':
      if (r.method === 'notify' && r.notifyType === 'error') return [{ kind: 'error', text: r.message ?? '' }]
      if (r.method === 'confirm') return [{ kind: 'ask', id: r.id, title: r.title ?? '', detail: r.message }]
      if (r.method === 'select') return [{ kind: 'ask', id: r.id, title: r.title ?? '', options: r.options }]
      if (r.method === 'input' || r.method === 'editor')
        return [{ kind: 'ask', id: r.id, title: r.title ?? '', detail: r.placeholder, input: true }]
      return []
    default:
      return []
  }
}

// Reads a session file's active branch: the chain of parents from its last entry.
export async function readPiSession(file: string): Promise<AgentEvent[]> {
  type Entry = { type: string; id?: string; parentId?: string | null; message?: PiMessage }
  const entries = (await readFile(file, 'utf8')).split('\n').flatMap((line) => parse<Entry>(line))
  const byId = new Map(entries.filter((e) => e.id).map((e) => [e.id, e]))
  const branch: PiMessage[] = []
  for (let e = entries.findLast((e) => e.id); e; e = e.parentId ? byId.get(e.parentId) : undefined)
    if (e.type === 'message' && e.message) branch.unshift(e.message)

  return branch.flatMap((m): AgentEvent[] => {
    if (m.role === 'user') return [{ kind: 'user', text: toText(m.content) }]
    if (m.role === 'toolResult')
      return [{ kind: 'result', id: m.toolCallId ?? '', text: toText(m.content), isError: m.isError === true }]
    if (m.role !== 'assistant' || typeof m.content === 'string') return []
    const events = (m.content ?? []).flatMap((c): AgentEvent[] =>
      c.type === 'text'
        ? [{ kind: 'text', text: c.text ?? '' }]
        : c.type === 'toolCall'
          ? [{ kind: 'tool', id: c.id ?? '', name: c.name ?? '', input: c.arguments ?? {} }]
          : [],
    )
    return m.stopReason === 'error' ? [...events, { kind: 'error', text: m.errorMessage ?? 'Error' }] : events
  })
}

export const modified = async (file: string) => (await stat(file).catch(() => undefined))?.mtimeMs
