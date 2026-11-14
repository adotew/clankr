import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { PencilIcon, SearchIcon, Trash2Icon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type PaletteRow = {
  key: string
  label: string
  detail?: string
  icon: ReactNode
  hint?: string
  disabled?: boolean
  run: () => void
  onRename?: (title: string) => void
  onDelete?: () => void
}

// Searchable popup list, used for the command palette and the thread switcher.
export function Palette(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  placeholder: string
  sections: [string, PaletteRow[]][]
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [editing, setEditing] = useState<string>()
  const list = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const filtered = props.sections
    .map(([title, rows]) => [title, rows.filter((r) => `${r.label} ${r.detail ?? ''}`.toLowerCase().includes(q))] as const)
    .filter(([, rows]) => rows.length)
  const rows = filtered.flatMap(([, rows]) => rows)
  const current = Math.min(selected, rows.length - 1)

  useEffect(() => {
    if (props.open) {
      setQuery('')
      setSelected(0)
      setEditing(undefined)
    }
  }, [props.open])

  useEffect(() => {
    list.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const run = (row: PaletteRow) => {
    if (row.disabled) return
    props.onOpenChange(false)
    row.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || !rows.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((current + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(rows[current])
    }
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          onKeyDown={onKeyDown}
          className="fixed top-[15%] left-1/2 z-50 flex max-h-[60vh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-popover/80 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-xl transition-[opacity,scale] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
        >
          <Dialog.Title className="sr-only">{props.title}</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-foreground/10 px-4">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected(0)
              }}
              placeholder={props.placeholder}
              aria-label={props.placeholder}
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div ref={list} role="listbox" aria-label={props.title} className="overflow-y-auto p-2">
            {filtered.map(([title, sectionRows]) => (
              <div key={title} role="group" aria-label={title} className="not-first:mt-2">
                <div className="px-2 py-1 text-xs text-muted-foreground">{title}</div>
                {sectionRows.map((row) => {
                  const index = rows.indexOf(row)
                  const finish = (title?: string) => {
                    setEditing(undefined)
                    if (title?.trim() && title !== row.label) row.onRename?.(title)
                  }
                  return (
                    <div
                      key={row.key}
                      role="option"
                      aria-selected={index === current}
                      aria-disabled={row.disabled}
                      data-selected={index === current || undefined}
                      onMouseMove={() => setSelected(index)}
                      onClick={() => editing !== row.key && run(row)}
                      title={row.detail}
                      className={cn(
                        'group flex h-8 cursor-default items-center gap-3 rounded-lg px-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0',
                        index === current && 'bg-foreground/10',
                        row.disabled && 'opacity-50',
                      )}
                    >
                      <span className="text-muted-foreground">{row.icon}</span>
                      {editing === row.key ? (
                        <input
                          defaultValue={row.label}
                          aria-label="Title"
                          className="w-full min-w-0 rounded-sm bg-transparent outline-1 outline-ring"
                          autoFocus
                          onFocus={(e) => e.target.select()}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') finish(e.currentTarget.value)
                            if (e.key === 'Escape') finish()
                          }}
                          onBlur={(e) => finish(e.target.value)}
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate">
                          {row.label}
                          {row.detail && <span className="ml-2 text-muted-foreground">{row.detail}</span>}
                        </span>
                      )}
                      {row.hint && <span className="text-xs text-muted-foreground">{row.hint}</span>}
                      {!row.disabled && editing !== row.key && (row.onRename || row.onDelete) && (
                        <span className="hidden items-center gap-1 group-hover:flex group-data-selected:flex">
                          {row.onRename && (
                            <RowAction label="Rename" onClick={() => setEditing(row.key)}>
                              <PencilIcon />
                            </RowAction>
                          )}
                          {row.onDelete && (
                            <RowAction label="Delete" onClick={row.onDelete}>
                              <Trash2Icon />
                            </RowAction>
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
            {!rows.length && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</p>}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="rounded-md p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground [&_svg]:size-3.5"
    >
      {children}
    </button>
  )
}
