import { useEffect, useRef, useState } from 'react'
import type { AgentEvent, Model, Thread } from '../../shared'

type Item =
  | { kind: 'user' | 'assistant' | 'error'; text: string }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown>; result?: { text: string; isError: boolean } }

type Permission = Extract<AgentEvent, { kind: 'permission' }>

// The open conversation; `id` is unset until the first message of a new thread is sent.
type Active = { id?: string; cwd: string }

// One-line hint shown next to a tool name, e.g. the command or file path.
const summarize = (input: Record<string, unknown>) =>
  String(input.command ?? input.file_path ?? input.pattern ?? input.url ?? '')

const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

function applyEvent(items: Item[], e: AgentEvent): Item[] {
  switch (e.kind) {
    case 'user':
    case 'error':
      return [...items, { kind: e.kind, text: e.text }]
    case 'text':
      return [...items, { kind: 'assistant', text: e.text }]
    case 'tool':
      return [...items, e]
    case 'result':
      return items.map((x) => (x.kind === 'tool' && x.id === e.id ? { ...x, result: { text: e.text, isError: e.isError } } : x))
    default:
      return items
  }
}

export function App() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [active, setActive] = useState<Active>()
  const [models, setModels] = useState<Model[]>([])
  const [model, setModel] = useState(() => localStorage.getItem('model') ?? 'default')
  const [items, setItems] = useState<Item[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    bottom.current?.scrollIntoView()
  }, [items, permissions])

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

  const send = async () => {
    const text = prompt.trim()
    if (!text || busy || !active) return
    setItems((xs) => [...xs, { kind: 'user', text }])
    setPrompt('')
    setBusy(true)
    const id = await window.api.send(text, model)
    setActive((a) => a && { ...a, id })
    refreshThreads()
  }

  const reply = (id: string, allow: boolean) => {
    window.api.reply(id, allow)
    setPermissions((ps) => ps.filter((p) => p.id !== id))
  }

  return (
    <div className="app">
      <aside>
        <button onClick={newThread} disabled={busy}>
          + New thread
        </button>
        <nav>
          {active && !active.id && (
            <button className="thread active">
              <span className="title">New thread</span>
              <span className="folder">{folderName(active.cwd)}</span>
            </button>
          )}
          {threads.map((t) => (
            <button
              key={t.id}
              className={`thread ${t.id === active?.id ? 'active' : ''}`}
              onClick={() => openThread(t)}
              disabled={busy}
              title={t.cwd}
            >
              <span className="title">{t.title}</span>
              <span className="folder">{t.folder}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="chat">
        <header>
          <span className="path">{active?.cwd ?? 'No thread selected'}</span>
          <select value={model} onChange={(e) => pickModel(e.target.value)} disabled={busy}>
            {models.length === 0 && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.displayName}
              </option>
            ))}
          </select>
        </header>

        <main>
          {items.map((item, i) =>
            item.kind === 'tool' ? (
              <details key={i} className={`tool ${item.result?.isError ? 'error' : ''}`}>
                <summary>
                  <b>{item.name}</b> {summarize(item.input)} {!item.result && '…'}
                </summary>
                <pre>{JSON.stringify(item.input, null, 2)}</pre>
                {item.result && <pre>{item.result.text}</pre>}
              </details>
            ) : (
              <div key={i} className={`msg ${item.kind}`}>
                {item.text}
              </div>
            ),
          )}
          {permissions.map((p) => (
            <div key={p.id} className="permission">
              <div>
                Allow <b>{p.name}</b>?
              </div>
              <pre>{JSON.stringify(p.input, null, 2)}</pre>
              <button onClick={() => reply(p.id, true)}>Allow</button>
              <button onClick={() => reply(p.id, false)}>Deny</button>
            </div>
          ))}
          <div ref={bottom} />
        </main>

        <footer>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={active ? 'Ask something… (Shift+Enter for newline)' : 'Start a new thread first'}
            disabled={!active}
            rows={3}
          />
          {busy ? (
            <button onClick={() => window.api.stop()}>Stop</button>
          ) : (
            <button onClick={send} disabled={!active || !prompt.trim()}>
              Send
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
