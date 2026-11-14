import * as React from 'react'
import { ArrowUpIcon, ChevronDownIcon, SquareIcon } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import type { Backend, Model } from '../../../shared'

export function PromptInput(props: {
  placeholder: string
  busy: boolean
  models: Model[]
  model: string
  // Set once a thread has started: only that backend's models can continue it.
  backend?: Backend
  onModelChange: (model: string) => void
  onSend: (text: string) => void
  onStop: () => void
}) {
  const { busy, models, model } = props
  const [text, setText] = React.useState('')
  const formRef = React.useRef<HTMLFormElement>(null)
  const canSend = !busy && text.trim().length > 0
  const modelName = models.find((m) => m.value === model)?.displayName ?? model
  const groups = [...new Set(models.map((m) => m.group))]

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSend) return
    props.onSend(text.trim())
    setText('')
  }

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <InputGroup className="rounded-2xl">
        <InputGroupTextarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={props.placeholder}
          aria-label="Message"
          className="max-h-60 min-h-16 p-3"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              formRef.current?.requestSubmit()
            }
          }}
        />
        <InputGroupAddon align="block-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<InputGroupButton size="sm" variant="ghost" disabled={busy} aria-label={`Model: ${modelName}`} />}
            >
              {modelName}
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="max-h-96 w-64">
              <DropdownMenuRadioGroup value={model} onValueChange={(value) => props.onModelChange(String(value))}>
                {groups.map((group, i) => (
                  <DropdownMenuGroup key={group}>
                    {i > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>{group}</DropdownMenuLabel>
                    {models
                      .filter((m) => m.group === group)
                      .map((m) => (
                        <DropdownMenuRadioItem
                          key={m.value}
                          value={m.value}
                          disabled={!!props.backend && m.backend !== props.backend}
                          closeOnClick
                        >
                          {m.displayName}
                        </DropdownMenuRadioItem>
                      ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {busy ? (
            <InputGroupButton
              type="button"
              size="icon-sm"
              variant="default"
              className="ml-auto rounded-full"
              onClick={props.onStop}
              aria-label="Stop"
            >
              <SquareIcon className="fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="ml-auto rounded-full"
              disabled={!canSend}
              aria-label="Send"
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
