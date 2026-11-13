import { FolderIcon, LoaderCircleIcon, PlusIcon } from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import type { Thread } from '../../../shared'

export type Active = { id?: string; cwd: string }

const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

function ThreadButton(props: {
  title: string
  cwd: string
  active: boolean
  running: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={props.active}
        disabled={props.disabled}
        onClick={props.onClick}
        title={props.cwd}
        className="h-auto flex-col items-start gap-0.5 py-2"
      >
        <span className="flex w-full items-center gap-2">
          <span className="truncate">{props.title}</span>
          {props.running && <LoaderCircleIcon className="ml-auto size-3.5 shrink-0 animate-spin" />}
        </span>
        <span className="flex w-full items-center gap-1 text-xs text-muted-foreground">
          <FolderIcon className="size-3 shrink-0" />
          <span className="truncate">{folderName(props.cwd)}</span>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppSidebar(props: {
  threads: Thread[]
  active?: Active
  busy: boolean
  onNew: () => void
  onOpen: (thread: Thread) => void
}) {
  const { threads, active, busy } = props

  return (
    <Sidebar>
      {/* Leaves room for the macOS traffic lights and makes the top bar draggable. */}
      <SidebarHeader className="pt-10 [-webkit-app-region:drag]">
        <SidebarMenu className="[-webkit-app-region:no-drag]">
          <SidebarMenuItem>
            <SidebarMenuButton onClick={props.onNew} disabled={busy}>
              <PlusIcon />
              New thread
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Threads</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {active && !active.id && <ThreadButton title="New thread" cwd={active.cwd} active running={busy} />}
              {threads.map((t) => (
                <ThreadButton
                  key={t.id}
                  title={t.title}
                  cwd={t.cwd}
                  active={t.id === active?.id}
                  running={busy && t.id === active?.id}
                  disabled={busy}
                  onClick={() => props.onOpen(t)}
                />
              ))}
              {threads.length === 0 && !active && (
                <p className="px-2 py-1 text-xs text-muted-foreground">No threads yet.</p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
