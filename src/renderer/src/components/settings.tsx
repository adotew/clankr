import { useEffect, useState } from 'react'
import { SearchIcon } from 'lucide-react'

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
      <div className="mt-4 flex items-baseline justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">Models</h3>
        {scoped.length > 0 && (
          <button type="button" onClick={() => save({ ...settings, models: [] })} className="text-xs text-muted-foreground hover:text-foreground">
            Clear
          </button>
        )}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {scoped.length ? `The model picker offers ${scoped.length} checked.` : 'Check the models you use; the model picker offers only those.'}
      </p>
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

// Rendered in its own window (loaded with #settings).
export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>()
  const [info, setInfo] = useState<PiInfo>()

  useEffect(() => {
    window.api.settings().then(setSettings)
    window.api.piInfo().then(setInfo)
  }, [])

  const save = (next: Settings) => {
    setSettings(next)
    window.api.saveSettings(next)
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center justify-center text-sm font-medium [-webkit-app-region:drag]">
        Settings
      </header>
      <main className="flex-1 overflow-y-auto">
        {settings && (
          <section className="mx-auto flex max-w-lg flex-col gap-4 px-6 pt-2 pb-6">
            <h3 className="text-xs font-medium text-muted-foreground">Agents</h3>
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
              <p className={info && !info.ok ? '-mt-2 pl-7 text-xs text-destructive' : '-mt-2 pl-7 text-xs text-muted-foreground'}>
                {info ? (info.ok ? `pi ${info.version}` : `pi not found: ${info.version}`) : 'Checking…'}
              </p>
            )}
            <ScopedModels settings={settings} save={save} />
          </section>
        )}
      </main>
    </div>
  )
}
