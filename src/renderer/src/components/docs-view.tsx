import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftIcon } from 'lucide-react'

import { DocLinksContext, Markdown } from '@/components/markdown'
import { PanelHeader } from '@/components/panel'
import { Button } from '@/components/ui/button'

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'))

// The project's Markdown files, or the open one (`doc`, an absolute path). Reloads when shown and whenever the
// agent finishes a turn, which may have edited it.
export function DocsView({
  cwd,
  visible,
  doc,
  onDoc,
}: {
  cwd?: string
  visible: boolean
  doc?: string
  onDoc: (doc: string | undefined) => void
}) {
  const [files, setFiles] = useState<string[]>()
  // Kept with its path, so switching files never shows the previous one's text.
  const [loaded, setLoaded] = useState<{ path: string; text?: string }>()

  useEffect(() => {
    if (!visible || !cwd) return
    let stale = false
    const load = () =>
      doc
        ? window.api.readDoc(doc).then((text) => stale || setLoaded({ path: doc, text }))
        : window.api.docs(cwd).then((f) => stale || setFiles(f))
    load()
    const off = window.api.onEvent((_, e) => e.kind === 'done' && load())
    return () => {
      stale = true
      off()
    }
  }, [cwd, visible, doc])

  // Links inside a file resolve against its own folder.
  const links = useMemo(() => ({ base: doc && dirOf(doc), open: onDoc }), [doc, onDoc])
  const name = doc && cwd && doc.startsWith(`${cwd}/`) ? doc.slice(cwd.length + 1) : doc
  const text = loaded?.path === doc ? loaded?.text : null

  let body = null
  if (doc)
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {text === undefined && <p className="pt-4 text-sm text-muted-foreground">Can't read this file.</p>}
        {typeof text === 'string' && (
          <DocLinksContext value={links}>
            <Markdown>{text}</Markdown>
          </DocLinksContext>
        )}
      </div>
    )
  else if (files?.length)
    body = (
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5 text-sm">
        {files.map((file) => (
          <li key={file}>
            <button
              type="button"
              onClick={() => onDoc(`${cwd}/${file}`)}
              className="w-full truncate rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {file}
            </button>
          </li>
        ))}
      </ul>
    )
  else if (files)
    body = <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No Markdown files</div>

  return (
    <>
      <PanelHeader>
        {doc && (
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => onDoc(undefined)} aria-label="All files">
              <ArrowLeftIcon />
            </Button>
            <span className="truncate text-xs text-muted-foreground" title={doc}>
              {name}
            </span>
          </>
        )}
      </PanelHeader>
      {body}
    </>
  )
}
