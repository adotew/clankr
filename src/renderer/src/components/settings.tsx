import { useEffect, useState } from 'react'
import { ChevronDownIcon, LogInIcon, RefreshCwIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
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

// Rendered in its own window (loaded with #settings).
export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>()
  const [piPath, setPiPath] = useState('')
  const [info, setInfo] = useState<PiInfo>()
  const [models, setModels] = useState<Model[]>([])

  const loadInfo = () => {
    setInfo(undefined)
    window.api.piInfo().then(setInfo)
  }
  const loadModels = () => window.api.models().then(setModels, () => setModels([]))

  useEffect(() => {
    window.api.settings().then((s) => {
      setSettings(s)
      setPiPath(s.piPath)
    })
    loadInfo()
    loadModels()
    return window.api.onChanged(loadModels)
  }, [])

  const save = async (next: Settings) => {
    setSettings(next)
    await window.api.saveSettings(next)
    if (next.piPath !== settings?.piPath) loadInfo()
  }

  // Providers with Pi models: logged in, set through environment variables, or added by extensions.
  const connected = Object.entries(
    models.reduce<Record<string, number>>((acc, m) => {
      const provider = m.value.match(/^pi:([^/]+)\//)?.[1]
      if (provider) acc[provider] = (acc[provider] ?? 0) + 1
      return acc
    }, {}),
  )
  const unconnected = info?.providers.filter((p) => !connected.some(([c]) => c === p)) ?? []

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center justify-center text-sm font-medium [-webkit-app-region:drag]">
        Settings
      </header>
      <main className="flex-1 overflow-y-auto">
        {settings && (
          <div className="mx-auto flex max-w-lg flex-col gap-6 px-6 pt-2 pb-6">
            <section className="flex flex-col gap-4">
              <h3 className="text-xs font-medium text-muted-foreground">Agents</h3>
              <Toggle
                title="Claude"
                description="Claude Agent SDK, signed in with your Claude subscription through Claude Code."
                checked={settings.claude}
                onChange={(claude) => save({ ...settings, claude })}
              />
              <Toggle
                title="Pi"
                description="Your Pi install, with its settings, extensions, skills and logins."
                checked={settings.pi}
                onChange={(pi) => save({ ...settings, pi })}
              />
              {settings.pi && (
                <form
                  className="flex flex-col gap-1.5 pl-7"
                  onSubmit={(e) => {
                    e.preventDefault()
                    save({ ...settings, piPath: piPath.trim() || 'pi' })
                  }}
                >
                  <label htmlFor="pi-path" className="text-xs text-muted-foreground">
                    Pi executable
                  </label>
                  <div className="flex gap-2">
                    <Input id="pi-path" value={piPath} onChange={(e) => setPiPath(e.target.value)} className="h-8" />
                    <Button type="submit" size="sm" variant="outline" disabled={piPath === settings.piPath}>
                      Save
                    </Button>
                  </div>
                  <p className={info && !info.ok ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                    {info ? (info.ok ? `pi ${info.version}` : `Not found: ${info.version}`) : 'Checking…'}
                  </p>
                </form>
              )}
            </section>

            {settings.pi && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium text-muted-foreground">Pi providers</h3>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Refresh"
                    onClick={() => {
                      window.api.refresh()
                      loadInfo()
                    }}
                  >
                    <RefreshCwIcon />
                  </Button>
                </div>
                {connected.length === 0 && <p className="text-xs text-muted-foreground">No providers connected yet.</p>}
                {connected.map(([provider, count]) => (
                  <Item key={provider} variant="outline" size="sm">
                    <ItemContent>
                      <ItemTitle>{provider}</ItemTitle>
                      <ItemDescription>
                        {count} {count === 1 ? 'model' : 'models'}
                      </ItemDescription>
                    </ItemContent>
                    {/* Only credentials saved by `pi auth login` can be removed here; env vars and extensions can't. */}
                    {info?.stored.includes(provider) && (
                      <ItemActions>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await window.api.piLogout(provider)
                            loadInfo()
                          }}
                        >
                          Log out
                        </Button>
                      </ItemActions>
                    )}
                  </Item>
                ))}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={!unconnected.length}
                    render={<Button size="sm" variant="outline" className="self-start" />}
                  >
                    <LogInIcon />
                    Add provider
                    <ChevronDownIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 min-w-56">
                    {unconnected.map((provider) => (
                      <DropdownMenuItem key={provider} onClick={() => window.api.term.run(`pi auth login ${provider}`)}>
                        {provider}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <p className="text-xs text-muted-foreground">
                  Signing in runs <code>pi auth login</code> in the terminal. Refresh here when it's done.
                </p>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
