import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronRight, type LucideIcon, MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { cn } from '#/lib/utils'

// Layout pieces shared by the detail pages (lease, invoice, tenant, property, unit): a header
// with status and actions, a row of key figures, and a main column next to a side column.

/** Breadcrumb, title with status, one line of context and the page's actions. */
export function DetailHeader({
  back,
  crumb,
  title,
  badge,
  meta,
  actions,
  className,
}: {
  back: { label: string } & Pick<LinkProps, 'to' | 'params' | 'search'>
  /** The current page in the breadcrumb, e.g. "Avtal #3". */
  crumb: string
  title: ReactNode
  badge?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const { label, ...link } = back
  return (
    <header className={cn('grid gap-3', className)}>
      <nav
        aria-label="Sökväg"
        className="flex items-center gap-1 text-[13px] text-muted-foreground"
      >
        <Link {...link} className="hover:text-foreground hover:underline">
          {label}
        </Link>
        <ChevronRight aria-hidden="true" className="size-3.5" />
        <span className="truncate">{crumb}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 font-bold text-2xl tracking-tight md:text-3xl">{title}</h1>
            {badge}
          </div>
          {meta && <p className="text-muted-foreground text-sm">{meta}</p>}
        </div>
        {actions && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto [&>*]:h-11 sm:[&>*]:h-9">
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}

/** Rare actions behind a "⋯" button. Children are `DropdownMenuItem`s. */
export function MoreActions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="size-11 sm:size-9" aria-label={label}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Key figures: two per row on phones, four from `md` up. */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Nyckeltal" className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-4">
      {children}
    </section>
  )
}

/**
 * Main column with a narrower side column from `lg` up; stacked on smaller screens, where
 * `sideFirst` puts the side column on top (when it holds the page's main action).
 */
export function DetailColumns({
  main,
  side,
  sideFirst = false,
}: {
  main: ReactNode
  side: ReactNode
  sideFirst?: boolean
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid min-w-0 gap-6">{main}</div>
      <aside className={cn('grid min-w-0 gap-4', sideFirst && 'order-first lg:order-none')}>
        {side}
      </aside>
    </div>
  )
}

/** A titled card. `action` sits at the right of the title (e.g. "Visa alla"). */
export function Panel({
  title,
  action,
  className,
  children,
}: {
  title: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('grid gap-3 rounded-xl border bg-card p-4 md:p-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-[15px]">{title}</h2>
        {action && <div className="text-[13px]">{action}</div>}
      </div>
      {children}
    </section>
  )
}

/** Label–value pairs, values right-aligned. */
export function FactList({ facts }: { facts: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
      {facts.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export type EventTone = 'neutral' | 'good' | 'warn' | 'bad'

export interface DetailEvent {
  readonly key: string
  readonly icon: LucideIcon
  readonly tone: EventTone
  readonly text: ReactNode
  /** ISO date. */
  readonly date: string
}

const toneClass: Record<EventTone, string> = {
  neutral: 'text-muted-foreground',
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-destructive',
}

/** Things that happened, newest first. */
export function EventList({ events }: { events: readonly DetailEvent[] }) {
  if (events.length === 0) {
    return <p className="text-[13px] text-muted-foreground">Inget har hänt ännu.</p>
  }
  return (
    <ol className="grid gap-3">
      {events.map((e) => (
        <li key={e.key} className="flex items-start gap-2.5 text-[13px]">
          <e.icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', toneClass[e.tone])} />
          <span className="min-w-0 flex-1">{e.text}</span>
          <time dateTime={e.date} className="shrink-0 text-muted-foreground tabular-nums">
            {e.date}
          </time>
        </li>
      ))}
    </ol>
  )
}

/** A row in a panel list that links somewhere. */
export function PanelRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t py-2.5 text-[13px] first:border-t-0 first:pt-0 last:pb-0">
      {children}
    </div>
  )
}
