import { useEffect, useState } from 'react'
import {
  CALIPER_PRESETS,
  PAINT_PRESETS,
  RIM_PRESETS,
  type CarBuild,
  type PaintFinish,
  type Stage,
  type SuspensionKit,
  type TireCompound,
} from '../vehicles/CarBuild'
import { useGameInstance } from './GameContext'
import { useGame } from './hooks'
import { Button, Panel, ScreenHeader, Segmented } from './kit'
import { CarCard } from './MainMenu'
import { OrbitLayer } from './OrbitLayer'

type Tab = 'paint' | 'wheels' | 'performance'
const TABS: [Tab, string][] = [
  ['paint', 'Paint'],
  ['wheels', 'Wheels'],
  ['performance', 'Upgrades'],
]

export function Garage() {
  const game = useGameInstance()
  const build = useGame((s) => s.build)
  const update = useGame((s) => s.updateBuild)
  const reset = useGame((s) => s.resetBuild)
  const [tab, setTab] = useState<Tab>('paint')

  // Wheels tab zooms the camera onto a wheel; everything else frames the whole car.
  useEffect(() => {
    game?.setShowroomFocus(tab === 'wheels' ? 'wheel' : 'car')
  }, [game, tab])
  useEffect(() => () => game?.setShowroomFocus('car'), [game])

  return (
    <div className="screen screen--garage">
      <OrbitLayer />
      <ScreenHeader title="Garage" onBack={() => game?.closeGarage()} />

      <div className="garage-left">
        <nav className="garage-tabs" role="tablist" aria-label="Customise">
          {TABS.map(([id, text]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              <span>{text}</span>
            </button>
          ))}
        </nav>
        <Panel className="garage-options">
          {tab === 'paint' && <PaintTab build={build} update={update} />}
          {tab === 'wheels' && <WheelsTab build={build} update={update} />}
          {tab === 'performance' && <PerformanceTab build={build} update={update} />}
          <Button size="sm" variant="ghost" onClick={reset}>
            Reset to stock
          </Button>
        </Panel>
      </div>

      <div className="garage-right">
        {tab !== 'wheels' && <CarCard />}
        <Button size="lg" variant="primary" onClick={() => game?.startRace()}>
          Race
        </Button>
      </div>
    </div>
  )
}

interface TabProps {
  build: CarBuild
  update(patch: Partial<CarBuild>): void
}

function PaintTab({ build, update }: TabProps) {
  return (
    <>
      <Swatches label="Color" presets={PAINT_PRESETS} value={build.paint} onPick={(paint) => update({ paint })} />
      <Segmented<PaintFinish>
        label="Finish"
        value={build.finish}
        options={[
          ['gloss', 'Gloss'],
          ['metallic', 'Metal'],
          ['matte', 'Matte'],
          ['pearl', 'Pearl'],
        ]}
        onPick={(finish) => update({ finish })}
      />
    </>
  )
}

function WheelsTab({ build, update }: TabProps) {
  return (
    <>
      <Swatches label="Rims" presets={RIM_PRESETS} value={build.rims} onPick={(rims) => update({ rims })} />
      <Swatches label="Calipers" presets={CALIPER_PRESETS} value={build.calipers} onPick={(calipers) => update({ calipers })} />
      <label className="ui-field">
        <span className="ui-field__label">
          Window tint <em>{Math.round(build.tint * 100)}%</em>
        </span>
        <input
          className="ui-range"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={build.tint}
          onChange={(e) => update({ tint: Number(e.target.value) })}
        />
      </label>
    </>
  )
}

function PerformanceTab({ build, update }: TabProps) {
  return (
    <>
      <Segmented<Stage>
        label="Engine"
        value={build.engine}
        options={[
          [0, 'Stock'],
          [1, 'I'],
          [2, 'II'],
          [3, 'III'],
        ]}
        onPick={(engine) => update({ engine })}
      />
      <Segmented<TireCompound>
        label="Tires"
        value={build.tires}
        options={[
          ['street', 'Street'],
          ['sport', 'Sport'],
          ['race', 'Race'],
        ]}
        onPick={(tires) => update({ tires })}
      />
      <Segmented<SuspensionKit>
        label="Suspension"
        value={build.suspension}
        options={[
          ['stock', 'Stock'],
          ['sport', 'Sport'],
          ['race', 'Race'],
        ]}
        onPick={(suspension) => update({ suspension })}
      />
      <Segmented<CarBuild['weight']>
        label="Weight"
        value={build.weight}
        options={[
          [0, 'Stock'],
          [1, '−5%'],
          [2, '−10%'],
        ]}
        onPick={(weight) => update({ weight })}
      />
      <Segmented<CarBuild['brakes']>
        label="Brakes"
        value={build.brakes}
        options={[
          [0, 'Stock'],
          [1, 'Sport'],
          [2, 'Carbon'],
        ]}
        onPick={(brakes) => update({ brakes })}
      />
    </>
  )
}

function Swatches({
  label,
  presets,
  value,
  onPick,
}: {
  label: string
  presets: readonly { name: string; hex: string }[]
  value: string
  onPick(hex: string): void
}) {
  const known = presets.find((p) => p.hex === value)
  return (
    <div className="ui-field">
      <span className="ui-field__label">
        {label} <em>{known?.name ?? 'Custom'}</em>
      </span>
      <div className="swatches">
        {presets.map((p) => (
          <button
            key={p.hex}
            className={`swatch${p.hex === value ? ' on' : ''}`}
            style={{ background: p.hex }}
            title={p.name}
            aria-label={p.name}
            aria-pressed={p.hex === value}
            onClick={() => onPick(p.hex)}
          />
        ))}
        <label className={`swatch swatch--custom${known ? '' : ' on'}`} title="Custom color" style={known ? undefined : { background: value }}>
          <input type="color" value={value} onChange={(e) => onPick(e.target.value)} aria-label={`Custom ${label.toLowerCase()} color`} />
        </label>
      </div>
    </div>
  )
}
