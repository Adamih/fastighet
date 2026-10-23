import { createLink } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { type AnchorHTMLAttributes, forwardRef, type ReactNode } from 'react'
import { cn } from '#/lib/utils'

// Layout pieces for pages that must work at phone width. Tables stay as tables from `md`
// up; below that, pages show the same rows as a stacked list (`MobileList`).

/** Page title with an optional subtitle and primary action, on one row that wraps if needed. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 md:items-end">
      <div className="grid min-w-0 gap-1">
        <h1 className="font-bold text-2xl tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** Filter chips: one scrolling row on phones (edge to edge), wrapping from `sm` up. */
export function FilterChips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav
      aria-label={label}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
    >
      {children}
    </nav>
  )
}

export const filterChipClass = (active: boolean) =>
  cn(
    'inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3.5 text-sm',
    active
      ? 'border-foreground bg-foreground font-semibold text-background'
      : 'bg-background text-muted-foreground',
  )

/** A filter tab in the bar on top of a list card (from `md` up). */
export const filterTabClass = (active: boolean) =>
  cn(
    'whitespace-nowrap rounded-md px-3 py-2 text-sm',
    active
      ? 'bg-accent font-semibold text-accent-foreground'
      : 'text-muted-foreground hover:text-foreground',
  )

/** A summary figure: label, value and an optional hint. `danger` marks money that is overdue. */
export function StatCard({
  label,
  hint,
  hintClass,
  tone = 'default',
  className,
  children,
}: {
  label: string
  hint?: ReactNode
  hintClass?: string
  tone?: 'default' | 'danger'
  className?: string
  children: ReactNode
}) {
  const danger = tone === 'danger'
  return (
    <div
      className={cn(
        'grid min-w-0 content-start gap-1 rounded-xl border bg-card px-4 py-3 lg:gap-1.5 lg:px-5 lg:py-4',
        danger && 'border-destructive/30 bg-destructive/5',
        className,
      )}
    >
      <span
        className={cn(
          'truncate font-medium text-[13px]',
          danger ? 'font-semibold text-destructive' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span className="whitespace-nowrap font-bold text-xl tabular-nums tracking-tight lg:text-2xl">
        {children}
      </span>
      {hint && (
        <span
          className={cn(
            'text-xs',
            danger ? 'text-destructive' : 'text-muted-foreground',
            hintClass,
          )}
        >
          {hint}
        </span>
      )}
    </div>
  )
}

/** The phone version of a table: a bordered card of rows. Hidden from `md` up. */
export function MobileList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul className={cn('divide-y overflow-hidden rounded-lg border bg-card md:hidden', className)}>
      {children}
    </ul>
  )
}

const MobileRowAnchor = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
  ({ className, children, ...props }, ref) => (
    <a
      ref={ref}
      className={cn('flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50', className)}
      {...props}
    >
      <span className="grid min-w-0 flex-1 gap-1">{children}</span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </a>
  ),
)

/** One tappable row of a `MobileList`, linking like a router `Link`. */
export const MobileListLink = createLink(MobileRowAnchor)

/** A row's first line: the main text on the left, something short (amount, badge) on the right. */
export function RowTitle({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <span className="flex items-start justify-between gap-3">
      <span className="min-w-0 truncate font-medium">{children}</span>
      {end && <span className="shrink-0 text-right">{end}</span>}
    </span>
  )
}

/** A row's secondary line. */
export function RowMeta({ children }: { children: ReactNode }) {
  return <span className="truncate text-muted-foreground text-sm">{children}</span>
}

/** Table shown from `md` up; pair it with a `MobileList` holding the same rows. */
export const desktopTableClass = 'hidden w-full text-left text-sm md:table'
