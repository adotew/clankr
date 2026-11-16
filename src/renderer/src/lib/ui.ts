// The translucent surface of popups, menus and the palette.
export const popup = 'bg-popover/80 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-xl'

export const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

// A JSON value from localStorage, or `fallback` when it's missing or unreadable.
export function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback
  } catch {
    return fallback
  }
}
export const store = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value))
