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

createRoot(document.getElementById('root')!).render(
  location.hash === '#settings' ? <SettingsPage /> : <App />,
)
