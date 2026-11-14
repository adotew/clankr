import { FolderIcon, LoaderCircleIcon, MessageCircleIcon, PlusIcon } from 'lucide-react'

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
  SidebarTrigger,
} from '@/components/ui/sidebar'
import type { Thread } from '../../../shared'

// `cwd` is unset until a "No project" thread gets its scratch folder; `folder` is unset for "No project".
export type Active = { id?: string; cwd?: string; folder?: string }

export const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

function ThreadButton(props: {
  title: string
  cwd?: string
  folder?: string
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
        title={props.folder && props.cwd}
        className="h-auto flex-col items-start gap-0.5 py-2"
      >
        <span className="flex w-full items-center gap-2">
          <span className="truncate">{props.title}</span>
          {props.running && <LoaderCircleIcon className="ml-auto size-3.5 shrink-0 animate-spin" />}
        </span>
        <span className="flex w-full items-center gap-1 text-xs text-muted-foreground">
          {props.folder ? (
            <FolderIcon className="size-3 shrink-0" />
          ) : (
            <MessageCircleIcon className="size-3 shrink-0" />
          )}
          <span className="truncate">{props.folder ?? 'No project'}</span>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppSidebar(props: {
  threads: Thread[]
  active: Active
  busy: boolean
  onNew: () => void
  onOpen: (thread: Thread) => void
}) {
  const { threads, active, busy } = props

  return (
    <Sidebar
      variant="floating"
      className="[&>[data-slot=sidebar-inner]]:rounded-2xl [&>[data-slot=sidebar-inner]]:bg-sidebar/50 [&>[data-slot=sidebar-inner]]:backdrop-blur-xl"
    >
      <SidebarHeader className="pt-0 [-webkit-app-region:drag]">
        {/* Left padding leaves room for the macOS traffic lights. */}
        <div className="flex h-9 items-center gap-2 pl-18 fullscreen:pl-2">
          <SidebarTrigger className="[-webkit-app-region:no-drag]" />
          <span className="font-heming text-sm font-medium [text-box:trim-both_cap_alphabetic]">Clankr</span>
        </div>
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
              {!active.id && busy && (
                <ThreadButton title="New thread" cwd={active.cwd} folder={active.folder} active running />
              )}
              {threads.map((t) => (
                <ThreadButton
                  key={t.id}
                  title={t.title}
                  cwd={t.cwd}
                  folder={t.folder}
                  active={t.id === active.id}
                  running={busy && t.id === active.id}
                  disabled={busy}
                  onClick={() => props.onOpen(t)}
                />
              ))}
              {threads.length === 0 && !busy && (
                <p className="px-2 py-1 text-xs text-muted-foreground">No threads yet.</p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
