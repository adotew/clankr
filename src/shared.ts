export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'result'; id: string; text: string; isError: boolean }
  | { kind: 'permission'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'error'; text: string }
  | { kind: 'done' }

export type Api = {
  pickFolder: () => Promise<string | undefined>
  send: (prompt: string) => Promise<void>
  stop: () => Promise<void>
  reply: (id: string, allow: boolean) => void
  onEvent: (cb: (e: AgentEvent) => void) => () => void
}

declare global {
  interface Window {
    api: Api
  }
}
