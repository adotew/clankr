import { useEffect, useRef, useState } from 'react'
import { ArrowLeftIcon, ArrowRightIcon, RotateCwIcon } from 'lucide-react'

const toUrl = (s: string) =>
  /^[a-z]+:/i.test(s) ? s : (/^(localhost|127\.|\[::1\])/.test(s) ? 'http://' : 'https://') + s

// Each thread remembers its own page.
const urls = (): Record<string, string> => JSON.parse(localStorage.getItem('browserUrls') ?? '{}')
const saveUrl = (thread: string, url: string) => localStorage.setItem('browserUrls', JSON.stringify({ ...urls(), [thread]: url }))

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
      <form
        className="flex shrink-0 items-center gap-1 p-2"
        onSubmit={(e) => {
          e.preventDefault()
          const s = address.trim()
          if (!s) return
          if (ref.current) ref.current.src = toUrl(s)
          else setSrc(toUrl(s))
        }}
      >
        <button type="button" aria-label="Back" className={button} disabled={!nav.back} onClick={() => ref.current?.goBack()}>
          <ArrowLeftIcon />
        </button>
        <button type="button" aria-label="Forward" className={button} disabled={!nav.forward} onClick={() => ref.current?.goForward()}>
          <ArrowRightIcon />
        </button>
        <button type="button" aria-label="Reload" className={button} disabled={!loaded} onClick={() => ref.current?.reload()}>
          <RotateCwIcon />
        </button>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => e.target.select()}
          placeholder="Enter a URL, e.g. localhost:5173"
          aria-label="Address"
          spellCheck={false}
          autoFocus={!address}
          className="h-6 min-w-0 flex-1 rounded-md bg-muted/60 px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </form>
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
