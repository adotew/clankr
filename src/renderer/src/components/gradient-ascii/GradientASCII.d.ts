// Types for the vendored React Bits component in GradientASCII.jsx.
import type { CSSProperties, HTMLAttributes } from 'react'

export type GradientASCIIProps = Omit<HTMLAttributes<HTMLDivElement>, 'style'> & {
  colors?: string[]
  shape?: 'horizon' | 'pinch' | 'rise' | 'eclipse'
  characters?: string
  cellSize?: number
  density?: number
  glyphOpacity?: number
  glow?: number
  depthOfField?: number
  flicker?: number
  softness?: number
  scale?: number
  flow?: number
  speed?: number
  gradientOpacity?: number
  grain?: number
  variation?: number
  mouseInteraction?: boolean
  scrambleRadius?: number
  clickEffect?: 'wave' | 'burst' | 'none'
  intro?: boolean
  lightMode?: boolean
  fontFamily?: string
  dpr?: number
  style?: CSSProperties
}

declare const GradientASCII: (props: GradientASCIIProps) => React.JSX.Element
export default GradientASCII
