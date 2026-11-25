import { useEffect, useState, type ReactNode } from 'react'
import { BotIcon, BoxIcon, SearchIcon, XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { Model, PiInfo, Settings } from '../../../shared'

function Toggle(props: { title: string; description: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{props.title}</span>
        <span className="text-xs text-muted-foreground">{props.description}</span>
      </span>
    </label>
  )
}

// The models the picker offers, like Pi's scoped models. None checked offers every model.
function ScopedModels({ settings, save }: { settings: Settings; save: (next: Settings) => void }) {
  const [models, setModels] = useState<Model[]>()
  const [query, setQuery] = useState('')

  useEffect(() => {
    const load = () => window.api.models(true).then(setModels, () => setModels([]))
    load()
    return window.api.onChanged(load)
  }, [])

  const scoped = settings.models ?? []
  const toggle = (value: string, on: boolean) =>
    save({ ...settings, models: on ? [...scoped, value] : scoped.filter((v) => v !== value) })

  const q = query.trim().toLowerCase()
  const rows = (models ?? []).filter((m) => `${m.displayName} ${m.group}`.toLowerCase().includes(q))
  const groups = [...new Set(rows.map((m) => m.group))]

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {scoped.length ? `The model picker offers the ${scoped.length} checked.` : 'Check the models you use; the model picker offers only those.'}
        </p>
        {scoped.length > 0 && (
          <button type="button" onClick={() => save({ ...settings, models: [] })} className="text-xs text-muted-foreground hover:text-foreground">
            Clear
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-foreground/5 px-2.5">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
          aria-label="Search models"
          className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {!models && <p className="text-xs text-muted-foreground">Loading…</p>}
      {groups.map((group) => (
        <div key={group} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{group}</span>
          {rows
            .filter((m) => m.group === group)
            .map((m) => (
              <label key={m.value} className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-foreground/5">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={scoped.includes(m.value)}
                  onChange={(e) => toggle(m.value, e.target.checked)}
                />
                {m.displayName}
              </label>
            ))}
        </div>
      ))}
    </>
  )
}

function Agents({ settings, save }: { settings: Settings; save: (next: Settings) => void }) {
  const [info, setInfo] = useState<PiInfo>()
  useEffect(() => void window.api.piInfo().then(setInfo), [])
  return (
    <>
      <Toggle
        title="Claude"
        description="Claude Agent SDK, signed in with your Claude subscription through Claude Code."
        checked={settings.claude}
        onChange={(claude) => save({ ...settings, claude })}
      />
      <Toggle
        title="Pi"
        description="Your Pi install, with its settings, extensions, skills and logins. Manage providers with pi in the terminal."
        checked={settings.pi}
        onChange={(pi) => save({ ...settings, pi })}
      />
      {settings.pi && (
        <p className={cn('-mt-2 pl-7 text-xs', info && !info.ok ? 'text-destructive' : 'text-muted-foreground')}>
          {info ? (info.ok ? `pi ${info.version}` : `pi not found: ${info.version}`) : 'Checking…'}
        </p>
      )}
    </>
  )
}

type Props = { settings: Settings; save: (next: Settings) => void }
const pages: { id: string; label: string; icon: ReactNode; Page: (props: Props) => ReactNode }[] = [
  { id: 'agents', label: 'Agents', icon: <BotIcon />, Page: Agents },
  { id: 'models', label: 'Models', icon: <BoxIcon />, Page: ScopedModels },
]

// A window over the app: a page list on the left, the chosen page on the right. Esc or a click outside closes it.
export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings>()
  const [pageId, setPageId] = useState(pages[0].id)
  const page = pages.find((p) => p.id === pageId) ?? pages[0]

  useEffect(() => {
    window.api.settings().then(setSettings)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const save = (next: Settings) => {
    setSettings(next)
    window.api.saveSettings(next)
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(36rem,100%)] w-[min(48rem,100%)] overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10"
      >
        <nav aria-label="Settings pages" className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-foreground/10 p-2 pt-3">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={p.id === page.id ? 'page' : undefined}
              onClick={() => setPageId(p.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4',
                p.id === page.id ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
              )}
            >
              {p.icon}
              {p.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-end p-2">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              title="Close (Esc)"
              className="rounded-md p-1 text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4"
            >
              <XIcon />
            </button>
          </header>
          <main className="flex-1 overflow-y-auto">
            <section className="flex flex-col gap-4 px-6 pb-6">
              <h2 className="text-lg font-medium">{page.label}</h2>
              {settings && <page.Page settings={settings} save={save} />}
            </section>
          </main>
        </div>
      </div>
    </div>
  )
}
