import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SettingsPage } from '@/components/settings'
import 'streamdown/styles.css'
import './styles.css'

// Follow the OS light/dark setting.
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches)
applyTheme()
dark.addEventListener('change', applyTheme)

// Marks whatever is scrolling for a moment, so styles.css can show its scrollbar only then.
const scrollTimers = new WeakMap<Element, number>()
document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target instanceof Element ? e.target : document.documentElement
    el.setAttribute('data-scrolling', '')
    clearTimeout(scrollTimers.get(el))
    scrollTimers.set(el, window.setTimeout(() => el.removeAttribute('data-scrolling'), 800))
  },
  { capture: true, passive: true },
)

createRoot(document.getElementById('root')!).render(
  location.hash === '#settings' ? <SettingsPage /> : <App />,
)
