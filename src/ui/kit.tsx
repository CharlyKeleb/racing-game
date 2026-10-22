import { Help } from './Help'
import { optionHelp } from './optionHelp'
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

/** Slanted chevron button, for stepping through options (cars, tracks). */
export function Chevron({ dir, label, disabled, onClick }: { dir: 'left' | 'right'; label: string; disabled?: boolean; onClick(): void }) {
  return (
    <button className={`ui-chevron ui-chevron--${dir}`} onClick={onClick} disabled={disabled} aria-label={label}>
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path d={dir === 'left' ? 'M15 4 7 12l8 8' : 'm9 4 8 8-8 8'} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
      </svg>
    </button>
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

/**
 * Slanted continuous gauge for a 0..1 resource (nitro, boost, damage).
 * `state` drives the look: 'empty' is dim, 'ready' glows, 'active' pulses.
 */
export function Meter({
  label,
  value,
  state = 'ready',
  hint,
}: {
  label: string
  value: number
  state?: 'empty' | 'ready' | 'active'
  hint?: ReactNode
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className={`ui-meter ui-meter--${state}`}>
      <span className="ui-meter__label">
        {label}
        {hint && <span className="ui-meter__hint">{hint}</span>}
      </span>
      <span className="ui-meter__track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i className="ui-meter__fill" style={{ transform: `scaleX(${pct / 100})` }} />
        <i className="ui-meter__ticks" aria-hidden="true" />
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
  help = false,
}: {
  label: string
  value: T
  options: [T, string][]
  onPick(v: T): void
  help?: boolean
}) {
  return (
    <div className="ui-field">
      <span className="ui-field__label">{label}{help && optionHelp[label] && <Help label={label}>{optionHelp[label]}</Help>}</span>
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
