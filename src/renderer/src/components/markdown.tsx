import * as React from 'react'
import { Streamdown, useIsCodeFenceIncomplete, type ExtraProps } from 'streamdown'

import { useHighlightedCode } from '@/hooks/use-highlighted-code'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockLine,
} from '@/components/ui/code-block'

// Paths to Markdown files open in the side panel. `base` is the folder relative paths resolve against; undefined
// leaves them as text, e.g. in "Chat" threads, which have no panel.
type DocLinks = { base?: string; open: (path: string) => void }
export const DocLinksContext = React.createContext<DocLinks | undefined>(undefined)

// The absolute path of a `.md` link or code span, e.g. `docs/plan.md` or `/abs/notes.md#usage`.
function docPath(links: DocLinks | undefined, ref: string) {
  const path = ref.split('#')[0]
  if (links?.base && /^\S+\.md$/i.test(path)) return decodeURIComponent(new URL(path, `file://${links.base}/`).pathname)
}

function DocLink({ path, href, children }: { path: string; href: string; children: React.ReactNode }) {
  const links = React.useContext(DocLinksContext)
  return (
    <a
      href={href}
      title={path}
      data-streamdown="link"
      onClick={(e) => {
        e.preventDefault()
        links?.open(path)
      }}
    >
      {children}
    </a>
  )
}

function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
  // True while the closing fence has not arrived yet.
  const incomplete = useIsCodeFenceIncomplete()
  const lines = useHighlightedCode(code, language)

  return (
    <CodeBlock size="sm">
      {/* Floats top-right and shows on hover, instead of a header row. */}
      <CodeBlockActions>
        <CodeBlockCopyButton value={code} disabled={incomplete} />
      </CodeBlockActions>
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

// `node` is pulled out so it doesn't reach the DOM.
function MarkdownCode({ node: _node, className, children, ...props }: React.ComponentProps<'code'> & ExtraProps) {
  const links = React.useContext(DocLinksContext)
  // Streamdown marks fenced code with data-block. Everything else is inline.
  if (!('data-block' in props)) {
    const code = (
      <code className="rounded-sm bg-foreground/[0.06] px-1 py-0.5 font-mono text-[0.875em] text-foreground" {...props}>
        {children}
      </code>
    )
    const path = typeof children === 'string' ? docPath(links, children) : undefined
    return path && typeof children === 'string' ? (
      <DocLink path={path} href={children}>
        {code}
      </DocLink>
    ) : (
      code
    )
  }
  return (
    <MarkdownCodeBlock
      code={typeof children === 'string' ? children : ''}
      language={/language-(\S+)/.exec(className ?? '')?.[1] ?? ''}
    />
  )
}

// Web links open in the default browser, not in place of the app; `.md` paths open in the docs view.
function MarkdownLink({ href = '', title, children }: React.ComponentProps<'a'> & ExtraProps) {
  const links = React.useContext(DocLinksContext)
  if (/^https?:\/\//i.test(href))
    return (
      <a
        href={href}
        title={title}
        data-streamdown="link"
        onClick={(e) => {
          e.preventDefault()
          window.api.openExternal(href)
        }}
      >
        {children}
      </a>
    )
  const path = docPath(links, href)
  return path ? (
    <DocLink path={path} href={href}>
      {children}
    </DocLink>
  ) : (
    <>{children}</>
  )
}

const components = { code: MarkdownCode, a: MarkdownLink }

export function Markdown({ children, streaming }: { children: string; streaming?: boolean }) {
  return (
    <Streamdown className="reading" controls={false} components={components} isAnimating={streaming}>
      {children}
    </Streamdown>
  )
}
