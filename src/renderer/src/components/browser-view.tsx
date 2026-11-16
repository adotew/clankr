import { useEffect, useRef, useState } from 'react'
import { ArrowLeftIcon, ArrowRightIcon, RotateCwIcon } from 'lucide-react'

import { PanelHeader } from '@/components/panel'
import { store, stored } from '@/lib/ui'

// Text that doesn't look like an address, e.g. with spaces or without a dot or port, is a DuckDuckGo search.
const toUrl = (s: string) =>
  /^([a-z]+:\/\/|about:)/i.test(s)
    ? s
    : /\s/.test(s) || !/[.:]|^localhost$/.test(s)
      ? `https://duckduckgo.com/?q=${encodeURIComponent(s)}`
      : (/^(localhost|127\.|\[::1\])/.test(s) ? 'http://' : 'https://') + s
// Web pages only: no files or app schemes.
const allowed = (url: string) => /^(https?:|about:blank$)/i.test(url)

// Each thread remembers its own page.
const urls = () => stored<Record<string, string>>('browserUrls', {})
const saveUrl = (thread: string, url: string) => store('browserUrls', { ...urls(), [thread]: url })

export function BrowserView({ thread }: { thread?: string }) {
  const ref = useRef<Electron.WebviewTag>(null)
  const [src, setSrc] = useState(() => (thread && urls()[thread]) || '')
  const url = useRef(src)
  const [address, setAddress] = useState(src)
  const loaded = src !== ''
  const [nav, setNav] = useState({ back: false, forward: false })

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    const onNavigate = () => {
      url.current = wv.getURL()
      setAddress(url.current)
      setNav({ back: wv.canGoBack(), forward: wv.canGoForward() })
      if (thread) saveUrl(thread, url.current)
    }
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigate)
    return () => {
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigate)
    }
    // The webview mounts with the first URL.
  }, [loaded, thread])

  // A new thread gets its id on the first send; the page opened before that becomes its page.
  useEffect(() => {
    if (thread && url.current) saveUrl(thread, url.current)
  }, [thread])

  const button =
    'rounded-md p-1 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground [&_svg]:size-3.5'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader>
        <form
          className="flex min-w-0 flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            const next = toUrl(address.trim())
            if (!address.trim() || !allowed(next)) return
            if (ref.current) ref.current.src = next
            else setSrc(next)
          }}
        >
          <button type="button" aria-label="Back" className={button} disabled={!nav.back} onClick={() => ref.current?.goBack()}>
            <ArrowLeftIcon />
          </button>
          <button
            type="button"
            aria-label="Forward"
            className={button}
            disabled={!nav.forward}
            onClick={() => ref.current?.goForward()}
          >
            <ArrowRightIcon />
          </button>
          <button type="button" aria-label="Reload" className={button} disabled={!loaded} onClick={() => ref.current?.reload()}>
            <RotateCwIcon />
          </button>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="Search DuckDuckGo or enter a URL"
            aria-label="Address"
            spellCheck={false}
            autoFocus={!address}
            className="h-6 min-w-0 flex-1 rounded-md bg-muted/60 px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </form>
      </PanelHeader>
      {loaded ? (
        <div className="mx-2 mb-2 flex min-h-0 flex-1 overflow-hidden rounded-xl">
          <webview ref={ref} src={src} partition="persist:browser" className="flex-1" />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">No page open</div>
      )}
    </div>
  )
}
