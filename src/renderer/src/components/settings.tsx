import { useEffect, useState } from 'react'

import type { PiInfo, Settings } from '../../../shared'

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
          </section>
        )}
      </main>
    </div>
  )
}
