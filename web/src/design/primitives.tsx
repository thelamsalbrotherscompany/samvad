import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Select as RadixSelect, Switch, Tooltip } from 'radix-ui'
import { CheckIcon, ChevronDownIcon } from '@/design/icons'
import { cn } from '@/lib/cn'

/* Radix supplies behaviour and accessibility only — every pixel here is ours. */

/**
 * Themed dropdown. A native <select> can't be styled past its trigger — the OS draws
 * the option list — so we use Radix Select, which renders (and lets us style) the
 * whole thing.
 */
export function Select({
  value,
  onValueChange,
  items,
  placeholder,
  label,
}: {
  value: string
  onValueChange: (value: string) => void
  items: { value: string; label: string }[]
  placeholder?: string
  /** Accessible name — without it two like-named options (e.g. two mics) read ambiguously. */
  label?: string
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange}>
      <RadixSelect.Trigger
        aria-label={label}
        className="inline-flex h-9 w-full items-center justify-between gap-2 overflow-hidden rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] text-ink outline-none focus:border-accent/60"
      >
        <span className="truncate">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon className="shrink-0 text-ink-muted">
          <ChevronDownIcon className="size-4" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className="z-70 max-h-64 min-w-(--radix-select-trigger-width) overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        >
          <RadixSelect.Viewport className="p-1">
            {items.map((item) => (
              <RadixSelect.Item
                key={item.value}
                value={item.value}
                className="flex cursor-pointer items-center gap-2 rounded-lg py-2 pr-2.5 pl-2 text-[13px] text-ink-muted outline-none select-none data-highlighted:bg-surface-2 data-highlighted:text-ink data-[state=checked]:text-ink"
              >
                <span className="grid w-4 shrink-0 place-items-center text-accent">
                  <RadixSelect.ItemIndicator>
                    <CheckIcon className="size-4" />
                  </RadixSelect.ItemIndicator>
                </span>
                <RadixSelect.ItemText>{item.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 ease-out',
        checked ? 'bg-accent' : 'bg-surface-2',
      )}
    >
      <Switch.Thumb
        className={cn(
          'block size-5 rounded-full bg-ink shadow-sm transition-transform duration-200 ease-out',
          checked ? 'translate-x-4.5' : 'translate-x-0.5',
        )}
      />
    </Switch.Root>
  )
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </Tooltip.Provider>
  )
}

export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={10}
          className="z-50 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] font-medium text-ink shadow-xl select-none"
        >
          {label}
          <Tooltip.Arrow className="fill-surface-2" width={10} height={5} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'md' | 'lg'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium',
        'transition-all duration-200 ease-out',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'lg' ? 'h-12 px-6 text-[15px]' : 'h-10 px-4 text-[14px]',
        variant === 'primary' &&
          'bg-accent text-base hover:brightness-110 active:brightness-95',
        variant === 'secondary' &&
          'bg-surface-2 text-ink hover:bg-line active:brightness-95',
        variant === 'ghost' && 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        className,
      )}
      {...props}
    />
  )
}

type ControlProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  /** `active` is the *engaged* state (muted, camera off) — not "currently focused". */
  active?: boolean
  /**
   * Colour when engaged (neutral tone only): `danger` for a disabled capability
   * (mic/camera off), `accent` for a positive one (sharing, hand raised).
   */
  activeTone?: 'danger' | 'accent'
  tone?: 'neutral' | 'danger'
  size?: 'md' | 'lg'
}

/**
 * A round control-bar button. State is never conveyed by colour alone — the icon
 * changes too (docs/DESIGN.md, accessibility).
 */
export function ControlButton({
  label,
  active,
  activeTone = 'danger',
  tone = 'neutral',
  size = 'lg',
  className,
  children,
  ...props
}: ControlProps) {
  return (
    <Hint label={label}>
      <button
        aria-label={label}
        // Only a real toggle announces pressed state; a one-shot action (no `active`) doesn't.
        aria-pressed={tone === 'danger' || active === undefined ? undefined : active}
        className={cn(
          'inline-grid place-items-center rounded-full transition-all duration-200 ease-out',
          'active:scale-95',
          size === 'lg' ? 'size-12' : 'size-10',
          tone === 'danger' && 'bg-danger text-base hover:brightness-110',
          tone === 'neutral' &&
            (active
              ? activeTone === 'accent'
                ? 'bg-accent-soft text-accent hover:brightness-125'
                : 'bg-danger-soft text-danger hover:brightness-125'
              : 'bg-surface-2 text-ink hover:bg-line'),
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            '[&_svg]:size-full',
            size === 'lg' ? 'size-5.5' : 'size-4.75',
          )}
        >
          {children}
        </span>
      </button>
    </Hint>
  )
}
