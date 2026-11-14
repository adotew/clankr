import { useState } from 'react'
import {
  FolderIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
} from 'lucide-react'

import { ResizeHandle } from '@/components/resize-handle'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import type { Backend, Thread } from '../../../shared'

// `cwd` is unset until a "No project" thread gets its scratch folder; `folder` is unset for "No project".
export type Active = { id?: string; cwd?: string; folder?: string; backend?: Backend }

export const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

function ThreadButton(props: {
  title: string
  cwd?: string
  folder?: string
  backend?: Backend
  active: boolean
  running: boolean
  disabled?: boolean
  onClick?: () => void
  onRename?: (title: string) => void
  onDelete?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const finish = (title?: string) => {
    setEditing(false)
    if (title?.trim() && title !== props.title) props.onRename?.(title)
  }

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
          {editing ? (
            <input
              defaultValue={props.title}
              aria-label="Thread title"
              className="w-full min-w-0 rounded-sm bg-transparent outline-1 outline-sidebar-ring"
              autoFocus
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') finish(e.currentTarget.value)
                if (e.key === 'Escape') finish()
              }}
              onBlur={(e) => finish(e.target.value)}
            />
          ) : (
            <span className="truncate">{props.title}</span>
          )}
          {props.running && <LoaderCircleIcon className="ml-auto size-3.5 shrink-0 animate-spin" />}
        </span>
        <span className="flex w-full items-center gap-1 text-xs text-muted-foreground">
          {props.folder ? (
            <FolderIcon className="size-3 shrink-0" />
          ) : (
            <MessageCircleIcon className="size-3 shrink-0" />
          )}
          <span className="truncate">{props.folder ?? 'No project'}</span>
          {props.backend === 'pi' && <span className="ml-auto shrink-0">Pi</span>}
        </span>
      </SidebarMenuButton>
      {props.onDelete && !props.disabled && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label="Thread actions" />}>
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={props.onDelete}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  )
}

export function AppSidebar(props: {
  threads: Thread[]
  active: Active
  busy: boolean
  onNew: () => void
  onOpen: (thread: Thread) => void
  onRename: (thread: Thread, title: string) => void
  onDelete: (thread: Thread) => void
  onSettings: () => void
  onResize: (x: number) => void
}) {
  const { threads, active, busy } = props

  return (
    <Sidebar
      variant="floating"
      className="[&>[data-slot=sidebar-inner]]:rounded-2xl [&>[data-slot=sidebar-inner]]:bg-sidebar/50 [&>[data-slot=sidebar-inner]]:backdrop-blur-xl"
    >
      <ResizeHandle onDrag={props.onResize} className="-right-1" />
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
                  backend={t.backend}
                  active={t.id === active.id}
                  running={busy && t.id === active.id}
                  disabled={busy}
                  onClick={() => props.onOpen(t)}
                  onRename={(title) => props.onRename(t, title)}
                  onDelete={() => props.onDelete(t)}
                />
              ))}
              {threads.length === 0 && !busy && (
                <p className="px-2 py-1 text-xs text-muted-foreground">No threads yet.</p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={props.onSettings} aria-label="Settings" title="Settings" className="w-fit">
              <SettingsIcon />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
