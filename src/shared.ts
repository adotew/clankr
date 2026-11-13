export type AgentEvent =
  | { kind: 'user' | 'text' | 'error'; text: string }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'result'; id: string; text: string; isError: boolean }
  | { kind: 'permission'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'done' }

export type Thread = { id: string; title: string; cwd: string; folder: string }
export type Model = { value: string; displayName: string }

export type Api = {
  models: () => Promise<Model[]>
  threads: () => Promise<Thread[]>
  newThread: () => Promise<string | undefined>
  openThread: (thread: Thread) => Promise<AgentEvent[]>
  send: (prompt: string, model: string) => Promise<string | undefined>
  stop: () => Promise<void>
  reply: (id: string, allow: boolean) => void
  onEvent: (cb: (e: AgentEvent) => void) => () => void
}

declare global {
  interface Window {
    api: Api
  }
}
