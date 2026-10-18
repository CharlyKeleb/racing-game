import { useId } from 'react'
import { GiInfo } from 'react-icons/gi'

/** Native popovers dismiss on outside click or Escape and work with keyboard activation. */
export function Help({ label, children }: { label:string; children:string }) {
  const id = useId()
  return <span className="ui-help">
    <button type="button" className="ui-help__button" popoverTarget={id} aria-label={`Help: ${label}`}><GiInfo aria-hidden="true"/></button>
    <span id={id} popover="auto" className="ui-help__popover"><strong>{label}</strong><span>{children}</span></span>
  </span>
}

