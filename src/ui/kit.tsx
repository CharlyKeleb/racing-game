import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { CarClass } from '../vehicles/CarBuild'

/**
 * Shared UI kit. Every screen builds from these so the game reads as one
 * system: slanted buttons, angled glass panels, class badges and segmented
 * stat bars. Styling lives in index.css under the `.ui-*` classes.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button className={`ui-btn ui-btn--${variant} ui-btn--${size} ${className}`} {...rest}>
      <span className="ui-btn__label">{children}</span>
    </button>
  )
}

export function Panel({ title, className = '', children }: { title?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`ui-panel ${className}`}>
      {title && <h2 className="ui-panel__title">{title}</h2>}
      {children}
    </section>
  )
}

/** Back chevron + screen title, pinned top-left. */
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="ui-header">
      {onBack && (
        <button className="ui-back" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
          </svg>
        </button>
      )}
      <h1 className="ui-header__title">{title}</h1>
    </header>
  )
}

export function ClassBadge({ value, size = 'md' }: { value: CarClass; size?: 'md' | 'lg' }) {
  return (
    <span className={`ui-class ui-class--${value} ui-class--${size}`} aria-label={`Class ${value}`}>
      <span>{value}</span>
    </span>
  )
}

/** Ten-segment bar, the racing-game way of showing a 0..1 stat. */
export function StatBar({ label, value }: { label: string; value: number }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * 10)
  return (
    <div className="ui-stat">
      <span className="ui-stat__label">{label}</span>
      <span className="ui-stat__segments" role="meter" aria-valuemin={0} aria-valuemax={10} aria-valuenow={lit} aria-label={label}>
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < lit ? 'on' : ''} />
        ))}
      </span>
    </div>
  )
}

/** Slanted segmented control for picking one option. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onPick,
}: {
  label: string
  value: T
  options: [T, string][]
  onPick(v: T): void
}) {
  return (
    <div className="ui-field">
      <span className="ui-field__label">{label}</span>
      <div className="ui-segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            role="radio"
            aria-checked={v === value}
            className={v === value ? 'on' : ''}
            onClick={() => onPick(v)}
          >
            <span>{text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
