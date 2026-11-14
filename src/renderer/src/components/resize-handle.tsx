import { useState } from 'react'

import { cn } from '@/lib/utils'

export function useStoredWidth(key: string, initial: number) {
  const [width, setWidth] = useState(() => Number(localStorage.getItem(key)) || initial)
  const set = (w: number) => {
    setWidth(w)
    localStorage.setItem(key, String(w))
  }
  return [width, set] as const
}

// Vertical drag handle; reports the pointer's x position while dragging.
export function ResizeHandle({ onDrag, className }: { onDrag: (x: number) => void; className?: string }) {
  const end = () => document.body.classList.remove('resizing')
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize"
      className={cn('absolute inset-y-0 z-20 w-2 cursor-col-resize [-webkit-app-region:no-drag]', className)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('resizing')
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && onDrag(e.clientX)}
      onPointerUp={end}
      onLostPointerCapture={end}
    />
  )
}
