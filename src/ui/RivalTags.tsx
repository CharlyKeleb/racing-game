import { useEffect, useRef } from 'react'
import { rivalTagStore, type RivalTagState } from '../stores/rivalTagStore'
import { useTelemetry } from './hooks'

const STYLE_TAG: Record<string, string> = { power: 'Straight-line specialist', drift: 'Corner attacker' }

interface TagNodes { root: HTMLDivElement; distance: HTMLElement; shown: number }

/**
 * Need for Speed-style rival tags: a slanted chip with race position, name and
 * live distance, on a stem down to the roof. Who they name re-renders with
 * telemetry; where they sit is written to the DOM every frame from rivalTagStore.
 */
export function RivalTags() {
  const rivals = useTelemetry((s) => s.rivalLabels)
  const nodes = useRef(new Map<number, TagNodes>())

  useEffect(() => {
    const apply = ({ tags }: RivalTagState) => {
      for (const tag of tags) {
        const n = nodes.current.get(tag.id)
        if (!n) continue
        n.root.style.opacity = tag.opacity.toFixed(3)
        if (tag.opacity === 0) continue
        n.root.style.left = `${tag.x}%`
        n.root.style.top = `${tag.y}%`
        n.root.style.setProperty('--tag-scale', tag.scale.toFixed(3))
        n.root.style.zIndex = String(1000 - Math.round(tag.distance))
        n.root.classList.toggle('is-near', tag.scale > 0.9)
        const meters = Math.round(tag.distance)
        if (meters !== n.shown) { n.shown = meters; n.distance.textContent = `${meters} m` }
      }
    }
    apply(rivalTagStore.getState())
    return rivalTagStore.subscribe(apply)
  }, [rivals.length])

  return (
    <div className="rival-tags" aria-hidden="true">
      {rivals.map((rival) => (
        <div
          key={rival.id}
          className={`rival-tag rival-tag--${rival.style}${rival.position === 1 ? ' rival-tag--leader' : ''}`}
          ref={(root) => {
            if (!root) { nodes.current.delete(rival.id); return }
            const distance = root.querySelector<HTMLElement>('.rival-tag__distance')!
            nodes.current.set(rival.id, { root, distance, shown: -1 })
          }}
        >
          <div className="rival-tag__chip">
            <b className="rival-tag__position">{rival.position}</b>
            <span className="rival-tag__name">
              {rival.name}
              <small>{STYLE_TAG[rival.style] ?? 'Precision driver'}</small>
            </span>
            <span className="rival-tag__distance" />
          </div>
          <i className="rival-tag__stem" />
        </div>
      ))}
    </div>
  )
}
