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
  // Streamdown marks fenced code with data-block. Everything else is inline.
  if (!('data-block' in props)) {
    return (
      <code className="rounded-sm bg-foreground/[0.06] px-1 py-0.5 font-mono text-[0.875em] text-foreground" {...props}>
        {children}
      </code>
    )
  }
  return (
    <MarkdownCodeBlock
      code={typeof children === 'string' ? children : ''}
      language={/language-(\S+)/.exec(className ?? '')?.[1] ?? ''}
    />
  )
}

const components = { code: MarkdownCode }

export function Markdown({ children, streaming }: { children: string; streaming?: boolean }) {
  return (
    <Streamdown className="reading" controls={false} components={components} isAnimating={streaming}>
      {children}
    </Streamdown>
  )
}
