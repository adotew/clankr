import * as React from 'react'
import { ArrowUpIcon, SquareIcon } from 'lucide-react'

import { ModelPicker } from '@/components/model-picker'
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
  // Undefined means the model's default level.
  effort?: string
  onEffortChange: (effort: string | undefined) => void
  onSend: (text: string) => void
  onStop: () => void
}) {
  const { busy, models, model } = props
  const [text, setText] = React.useState('')
  const formRef = React.useRef<HTMLFormElement>(null)
  const canSend = !busy && text.trim().length > 0

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
          <ModelPicker
            models={models}
            model={model}
            backend={props.backend}
            effort={props.effort}
            disabled={busy}
            onModelChange={props.onModelChange}
            onEffortChange={props.onEffortChange}
          />
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
