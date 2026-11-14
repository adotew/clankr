import { useEffect, useRef, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { CheckIcon, SearchIcon } from 'lucide-react'

import { InputGroupButton } from '@/components/ui/input-group'
import { cn } from '@/lib/utils'
import type { Backend, Model } from '../../../shared'

const effortLabel = (effort: string) => (effort === 'xhigh' ? 'X-High' : effort[0].toUpperCase() + effort.slice(1))

// Searchable model list with the effort levels pinned below it; stays open so both can be changed in one visit.
export function ModelPicker(props: {
  models: Model[]
  model: string
  // Set once a thread has started: only that backend's models can continue it.
  backend?: Backend
  // Undefined means the model's default level.
  effort?: string
  disabled: boolean
  onModelChange: (model: string) => void
  onEffortChange: (effort: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const current = props.models.find((m) => m.value === props.model)
  const modelName = current?.displayName ?? props.model
  const effortName = props.effort && effortLabel(props.effort)

  const q = query.trim().toLowerCase()
  const rows = props.models.filter((m) => `${m.displayName} ${m.group}`.toLowerCase().includes(q))
  const groups = [...new Set(rows.map((m) => m.group))]
  const index = Math.min(selected, rows.length - 1)
  const usable = (m: Model) => !props.backend || m.backend === props.backend

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setQuery('')
    setSelected(Math.max(0, props.models.findIndex((m) => m.value === props.model)))
  }

  useEffect(() => {
    if (open) list.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [open, index])

  const pick = (m: Model) => {
    if (!usable(m)) return
    props.onModelChange(m.value)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(rows[index])
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        render={
          <InputGroupButton
            size="sm"
            variant="ghost"
            disabled={props.disabled}
            aria-label={`Model: ${modelName}${effortName ? `, effort: ${effortName}` : ''}`}
          />
        }
      >
        {modelName}
        {effortName && <span className="text-muted-foreground">{effortName}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        {/* Always above the button, shrinking to fit: when it doesn't fit, Base UI moves it beside the button,
            where it then follows the button's width as the effort label changes. */}
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={6}
          collisionAvoidance={{ side: 'none', fallbackAxisSide: 'none' }}
          className="isolate z-50 outline-none"
        >
          <Popover.Popup
            initialFocus={input}
            className="flex max-h-(--available-height) w-96 origin-(--transform-origin) flex-col overflow-hidden rounded-xl bg-popover/80 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-xl duration-100 outline-none data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
          >
            <div className="flex items-center gap-2 border-b border-foreground/10 px-3">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={input}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelected(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="Search models…"
                aria-label="Search models"
                className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div ref={list} role="listbox" aria-label="Models" className="max-h-72 overflow-y-auto p-1">
              {groups.map((group) => (
                <div key={group} role="group" aria-label={group}>
                  <div className="px-2 pt-2 pb-1 text-xs text-muted-foreground">{group}</div>
                  {rows
                    .filter((m) => m.group === group)
                    .map((m) => {
                      const i = rows.indexOf(m)
                      return (
                        <div
                          key={m.value}
                          role="option"
                          aria-selected={m.value === props.model}
                          aria-disabled={!usable(m)}
                          data-selected={i === index || undefined}
                          onMouseMove={() => setSelected(i)}
                          onClick={() => pick(m)}
                          className={cn(
                            'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm',
                            i === index && 'bg-foreground/10',
                            !usable(m) && 'opacity-50',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                          {m.value === props.model && <CheckIcon className="size-4 shrink-0" />}
                        </div>
                      )
                    })}
                </div>
              ))}
              {!rows.length && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</p>}
            </div>
            {current?.efforts && (
              <div className="border-t border-foreground/10 p-2">
                <div role="radiogroup" aria-label="Effort" className="flex gap-0.5 rounded-lg bg-foreground/5 p-0.5">
                  {[undefined, ...current.efforts].map((e) => (
                    <button
                      key={e ?? 'default'}
                      type="button"
                      role="radio"
                      aria-checked={e === props.effort}
                      onClick={() => props.onEffortChange(e)}
                      className={cn(
                        'h-7 min-w-0 flex-1 rounded-md px-1 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                        e === props.effort && 'bg-foreground/15 text-foreground',
                      )}
                    >
                      {e ? effortLabel(e) : 'Default'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
