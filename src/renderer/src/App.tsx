import { useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '../../shared'

type Item =
  | { kind: 'user' | 'assistant' | 'error'; text: string }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown>; result?: { text: string; isError: boolean } }

type Permission = Extract<AgentEvent, { kind: 'permission' }>

// One-line hint shown next to a tool name, e.g. the command or file path.
const summarize = (input: Record<string, unknown>) =>
  String(input.command ?? input.file_path ?? input.pattern ?? input.url ?? '')

export function App() {
  const [folder, setFolder] = useState<string>()
  const [items, setItems] = useState<Item[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      window.api.onEvent((e) => {
        switch (e.kind) {
          case 'text':
            return setItems((xs) => [...xs, { kind: 'assistant', text: e.text }])
          case 'error':
            return setItems((xs) => [...xs, { kind: 'error', text: e.text }])
          case 'tool':
            return setItems((xs) => [...xs, e])
          case 'result':
            return setItems((xs) =>
              xs.map((x) => (x.kind === 'tool' && x.id === e.id ? { ...x, result: { text: e.text, isError: e.isError } } : x)),
            )
          case 'permission':
            return setPermissions((ps) => [...ps, e])
          case 'done':
            setPermissions([])
            return setBusy(false)
        }
      }),
    [],
  )

  useEffect(() => {
    bottom.current?.scrollIntoView()
  }, [items, permissions])

  const pickFolder = async () => {
    const dir = await window.api.pickFolder()
    if (dir !== folder) setItems([])
    setFolder(dir)
  }

  const send = () => {
    const text = prompt.trim()
    if (!text || busy || !folder) return
    setItems((xs) => [...xs, { kind: 'user', text }])
    setPrompt('')
    setBusy(true)
    window.api.send(text)
  }

  const reply = (id: string, allow: boolean) => {
    window.api.reply(id, allow)
    setPermissions((ps) => ps.filter((p) => p.id !== id))
  }

  return (
    <div className="app">
      <header>
        <button onClick={pickFolder} disabled={busy}>
          {folder ?? 'Open folder…'}
        </button>
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
          placeholder={folder ? 'Ask something… (Shift+Enter for newline)' : 'Open a folder first'}
          disabled={!folder}
          rows={3}
        />
        {busy ? (
          <button onClick={() => window.api.stop()}>Stop</button>
        ) : (
          <button onClick={send} disabled={!folder || !prompt.trim()}>
            Send
          </button>
        )}
      </footer>
    </div>
  )
}
