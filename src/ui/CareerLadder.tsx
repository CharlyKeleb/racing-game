import { useMemo, useState } from 'react'
import { GiCheckeredFlag, GiStopwatch, GiDeathSkull, GiPadlock, GiTrophyCup, GiCoins } from 'react-icons/gi'
import { careerWinBonus } from '../racing/Economy'
import { AI_DIFFICULTIES } from '../racing/AiProfiles'
import { CAREER, CAREER_RUNGS, SUMMIT, careerEvent, careerStatus, formatLap, type CareerEvent, type CareerStatus } from '../racing/Career'
import { getCar } from '../vehicles/carRegistry'
import { BAYVIEW, CANYON_DAM, MARINA_BAY, NURBURGRING, PARIS } from '../world/tracks'
import { useGameInstance } from './GameContext'
import { useCareer, useGame } from './hooks'
import { Button } from './kit'

const TRACK_NAMES: Record<string, string> = Object.fromEntries([NURBURGRING, MARINA_BAY, BAYVIEW, PARIS, CANYON_DAM].map((t) => [t.id, t.name]))
const KIND_LABEL = { race: 'Race', elimination: 'Elimination', timeTrial: 'Time trial' } as const
const KIND_ICON = { race: GiCheckeredFlag, elimination: GiDeathSkull, timeTrial: GiStopwatch } as const
/** SVG units per ladder cell (the grid is 3 columns × CAREER_RUNGS rows). */
const CELL = 100

function goal(e: CareerEvent): string {
  if (e.kind === 'timeTrial') return `Lap under ${formatLap(e.targetMs ?? 0)}`
  if (e.kind === 'elimination') return `Survive: last car out every lap`
  return e.maxPosition === 1 ? `Win against ${e.rivals} ${e.rivals === 1 ? 'rival' : 'rivals'}` : `Finish P${e.maxPosition} or better`
}

const centre = (e: CareerEvent) => ({ x: e.column * CELL + CELL / 2, y: (CAREER_RUNGS - 1 - e.rung) * CELL + CELL / 2 })

/**
 * Career: the ladder. You start at the bottom and climb; each win lights the paths to the
 * events it opens on the rung above. Routes branch, merge and dead-end, like a maze, and
 * only some reach the summit. Events are driven in the Audi RS6-R or the Nissan Skyline.
 */
export function CareerLadder() {
  const game = useGameInstance()
  const wonList = useCareer((s) => s.won)
  const won = useMemo(() => new Set(wonList), [wonList])
  const switching = useGame((s) => s.carSwitching || s.trackSwitching)
  const status = (id: string): CareerStatus => careerStatus(id, won)
  // Start on the highest open event: where you are on the climb.
  const [selected, setSelected] = useState<string>(() => [...CAREER].filter((e) => status(e.id) === 'open').sort((a, b) => b.rung - a.rung)[0]?.id ?? CAREER[0].id)
  const event = careerEvent(selected) ?? CAREER[0]
  const st = status(event.id)
  const Icon = KIND_ICON[event.kind]

  const prize = (e: CareerEvent) => careerWinBonus(e.rung, e.difficulty, e.id === SUMMIT)
  const totalPrize = CAREER.reduce((sum, e) => sum + prize(e), 0)
  const earned = CAREER.reduce((sum, e) => sum + (won.has(e.id) ? prize(e) : 0), 0)
  const links = CAREER.flatMap((from) => from.next.map((to) => ({ from, to: careerEvent(to)! })).filter((l) => l.to))
  const height = CAREER_RUNGS * CELL

  return (
    <div className="career">
      <header className="career__head">
        <span className="eyebrow">Career · RS6-R &amp; Skyline</span>
        <h2>The Ladder</h2>
        <p><b>{won.size}</b> / {CAREER.length} events won · <GiCoins aria-hidden="true" /> {earned.toLocaleString()} / {totalPrize.toLocaleString()}{won.has(SUMMIT) ? ' · Summit reached' : ''}</p>
      </header>
      <div className="career__body">
        <div className="career__ladder" style={{ gridTemplateRows: `repeat(${CAREER_RUNGS}, minmax(64px, 1fr))` }} role="listbox" aria-label="Career events, summit at the top">
          <svg className="career__paths" viewBox={`0 0 ${3 * CELL} ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {/* The ladder: two rails, a rung per row. */}
            <line className="career__rail" x1="3" y1="0" x2="3" y2={height} />
            <line className="career__rail" x1={3 * CELL - 3} y1="0" x2={3 * CELL - 3} y2={height} />
            {Array.from({ length: CAREER_RUNGS }, (_, r) => <line key={r} className="career__rung" x1="3" x2={3 * CELL - 3} y1={r * CELL + CELL / 2} y2={r * CELL + CELL / 2} />)}
            {/* The maze: up from an event, across, up into the one it opens. */}
            {links.map(({ from, to }) => {
              const a = centre(from), b = centre(to), mid = a.y - CELL / 2
              const state = won.has(from.id) ? (won.has(to.id) ? 'climbed' : 'open') : 'locked'
              return <path key={`${from.id}-${to.id}`} className={`career__path career__path--${state}`} d={`M${a.x} ${a.y} V${mid} H${b.x} V${b.y}`} />
            })}
          </svg>
          {CAREER.map((e) => {
            const s = status(e.id), K = e.id === SUMMIT ? GiTrophyCup : s === 'locked' ? GiPadlock : KIND_ICON[e.kind]
            return (
              <button key={e.id} role="option" aria-selected={e.id === selected}
                className={`career-node career-node--${s}${e.id === selected ? ' is-selected' : ''}${e.id === SUMMIT ? ' career-node--summit' : ''}${e.next.length === 0 && e.id !== SUMMIT ? ' career-node--dead-end' : ''}`}
                style={{ gridRow: CAREER_RUNGS - e.rung, gridColumn: e.column + 1 }}
                aria-label={`${e.name}, ${KIND_LABEL[e.kind]}, ${s === 'won' ? 'won' : s === 'open' ? 'open' : 'locked'}`}
                onClick={() => setSelected(e.id)}>
                <K aria-hidden="true" />
                <span className="career-node__name">{e.name}</span>
                <small>{s === 'won' ? 'Won' : KIND_LABEL[e.kind]}</small>
              </button>
            )
          })}
        </div>

        <aside className={`career__detail career__detail--${st}`} aria-live="polite">
          <span className="eyebrow"><Icon aria-hidden="true" /> {KIND_LABEL[event.kind]} · Rung {event.rung + 1}</span>
          <h3>{event.name}</h3>
          <dl>
            <dt>Circuit</dt><dd>{TRACK_NAMES[event.track] ?? event.track}</dd>
            <dt>Car</dt><dd>{getCar(event.car).name}</dd>
            <dt>Rivals</dt><dd>{event.kind === 'timeTrial' ? 'Their lap, as the target' : `${event.rivals} · ${AI_DIFFICULTIES[event.difficulty].label}`}</dd>
            <dt>Laps</dt><dd>{event.laps}</dd>
            <dt>Goal</dt><dd className="career__goal">{goal(event)}</dd>
            <dt>Prize</dt><dd className={`career__prize${st === 'won' ? ' is-paid' : ''}`}><GiCoins aria-hidden="true" /> {careerWinBonus(event.rung, event.difficulty, event.id === SUMMIT).toLocaleString()}{st === 'won' ? ' · paid' : ' · first win'}</dd>
          </dl>
          <p className="career__note">
            {event.kind === 'timeTrial' ? `${AI_DIFFICULTIES[event.difficulty].label} AI's best lap in this car here. ` : ''}
            {event.kind === 'elimination' ? 'Each time the leader starts a lap, the last car still running is out. ' : ''}
            {st === 'locked' ? 'Locked: win an event that links here from the rung below.'
              : event.id === SUMMIT ? 'The top of the ladder. Built to be beaten by almost nobody.'
              : event.next.length === 0 ? 'A dead end: this route goes no higher.'
              : `Opens ${event.next.map((id) => careerEvent(id)?.name).join(' and ')}.`}
          </p>
          <Button variant="primary" size="lg" disabled={st === 'locked' || switching} onClick={() => game?.startCareerEvent(event.id)}>
            {st === 'locked' ? 'Locked' : st === 'won' ? 'Race it again' : 'Start event'}
          </Button>
        </aside>
      </div>
    </div>
  )
}
