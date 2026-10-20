import type { WheelId } from '../vehicles/VehicleConfig'
import { PLATE_STYLES, type PlateStyle } from '../vehicles/PlateStyles'
import { DEFAULT_LIVERY, hasLivery, type LiveryDesign, type StripePattern, type NumberPanel, type LiveryDecal } from '../vehicles/LiveryDesign'
import { GiPaintBrush, GiCarWheel, GiIdCard, GiAutoRepair, GiCheckeredFlag } from 'react-icons/gi'
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
import { CarPicker } from './CarPicker'
import { Button, Panel, ScreenHeader, Segmented } from './kit'
import { CarCard } from './MainMenu'
import { MenuMusicBar } from './MenuMusicBar'
import { OrbitLayer } from './OrbitLayer'

type Tab = 'paint' | 'wheels' | 'performance' | 'livery' | 'plates'
const TABS: [Tab, string][] = [
  ['paint', 'Paint'],
  ['wheels', 'Wheels'],
  ['livery', 'Livery'],
  ['plates', 'Plates'],
  ['performance', 'Upgrades'],
]

const tabIcons = { paint: GiPaintBrush, wheels: GiCarWheel, performance: GiAutoRepair, livery: GiCheckeredFlag, plates: GiIdCard }

export function Garage() {
  const game = useGameInstance()
  const build = useGame((s) => s.build)
  const update = useGame((s) => s.updateBuild)
  const reset = useGame((s) => s.resetBuild)
  const [tab, setTab] = useState<Tab>('paint')
  const [wheel, setWheel] = useState<WheelId>('FL')
  const [plateSide, setPlateSide] = useState<'front' | 'rear'>('rear')
  const switching = useGame((s) => s.carSwitching)

  // Detail tabs share the showroom camera's damped transition.
  useEffect(() => {
    game?.setShowroomFocus(tab === 'wheels' ? `wheel-${wheel}` : tab === 'plates' ? (plateSide === 'front' ? 'plate-front' : 'plate-rear') : 'car')
  }, [game, tab, plateSide, wheel])
  useEffect(() => () => game?.setShowroomFocus('car'), [game])

  return (
    <div className="screen screen--garage">
      <OrbitLayer />
      <ScreenHeader title="Garage" onBack={() => game?.closeGarage()} />

      <div className="garage-left">
        <nav className="garage-tabs" role="tablist" aria-label="Customise">
          {TABS.map(([id, text]) => {
            const Icon = tabIcons[id]
            return (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              <span><Icon aria-hidden="true" focusable="false"/>{text}</span>
            </button>
          )})}
        </nav>
        <Panel className="garage-options">
          {tab === 'paint' && <PaintTab build={build} update={update} />}
          {tab === 'wheels' && <WheelsTab build={build} update={update} wheel={wheel} onWheel={setWheel} disabled={switching} />}
          {tab === 'performance' && <PerformanceTab build={build} update={update} />}
          {tab === 'livery' && <LiveryTab build={build} update={update} disabled={switching} />}
          {tab === 'plates' && <PlatesTab build={build} update={update} disabled={switching} side={plateSide} onSide={setPlateSide} />}
          {tab !== 'livery' && tab !== 'plates' && <Button size="sm" variant="ghost" onClick={reset}>
            Reset to stock
          </Button>}
        </Panel>
        <MenuMusicBar />
      </div>

      <CarPicker className="garage-carpicker" />

      <div className="garage-right">
        {tab !== 'wheels' && tab !== 'plates' && <CarCard />}
        <Button size="lg" variant="primary" className="menu-icon-action" disabled={switching} onClick={() => game?.startRace()}>
          <GiCheckeredFlag aria-hidden="true"/> Race
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
      <FinishPicker build={build} update={update} />
    </>
  )
}

function FinishPicker({ build, update }: TabProps) {
  return <Segmented<PaintFinish>
        label="Finish"
        value={build.finish}
        options={[
          ['gloss', 'Gloss'],
          ['metallic', 'Metallic'],
          ['matte', 'Matte'],
          ['pearl', 'Pearl'],
        ]}
        onPick={(finish) => update({ finish })}
      />
}

function WheelsTab({ build, update, wheel, onWheel, disabled }: TabProps & { wheel: WheelId; onWheel(wheel: WheelId): void; disabled: boolean }) {
  return (
    <fieldset className="livery-editor" disabled={disabled}>
      <legend>Wheels &amp; fitment</legend>
      <Segmented<WheelId> label="Inspect wheel" value={wheel} options={[
        ['FL', 'Front left'], ['FR', 'Front right'], ['RL', 'Rear left'], ['RR', 'Rear right'],
      ]} onPick={onWheel} />
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
    </fieldset>
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

function LiveryTab({ build, update, disabled }: TabProps & { disabled: boolean }) {
  const undo = useGame((s) => s.undoLivery)
  const canUndo = useGame((s) => (s.liveryHistory[s.settings.car]?.length ?? 0) > 0)
  const design = build.livery
  const change = (patch: Partial<LiveryDesign>) => update({ livery: { ...design, ...patch } })
  return (
    <fieldset className="livery-editor" disabled={disabled}>
      <legend className="sr-only">Livery</legend>
      <FinishPicker build={build} update={update} />

      <Segmented<StripePattern> label="Stripes" value={design.pattern} options={[
        ['none', 'None'], ['center', 'Center'], ['twin', 'Twin'], ['offset', 'Offset'], ['chevron', 'V'], ['triple', 'Triple'], ['sash', 'Sash'], ['pinstripe', 'Pinstripe'],
      ]} onPick={(pattern) => change({ pattern })} />
      <Swatches label="Primary" presets={PAINT_PRESETS} value={design.primary} onPick={(primary) => change({ primary })} />
      <Swatches label="Accent" presets={PAINT_PRESETS} value={design.accent} onPick={(accent) => change({ accent })} />
      <Segmented<NumberPanel> label="Number panel" value={design.panel} options={[
        ['none', 'None'], ['roundel', 'Roundel'], ['square', 'Square'],
      ]} onPick={(panel) => change({ panel })} />
      <label className="livery-toggle">
        <input type="checkbox" checked={design.hoodNumber} onChange={(event) => change({ hoodNumber: event.target.checked })} />
        Hood number
      </label>
      <label className="ui-field">
        <span className="ui-field__label">Race number</span>
        <input className="livery-number" type="number" min={0} max={999} step={1} value={design.number}
          onChange={(event) => change({ number: Number(event.target.value) })} />
      </label>
      <Segmented<LiveryDecal> label="Decal" value={design.decal} options={[
        ['none', 'None'], ['bolt', 'Bolt'], ['chequer', 'Chequer'], ['apex', 'Apex'], ['star', 'Star'], ['target', 'Target'], ['speed', 'Speed bars'],
      ]} onPick={(decal) => change({ decal })} />
      <div className="livery-actions">
        <Button size="sm" variant="ghost" disabled={!canUndo} onClick={undo}>Undo</Button>
        <Button size="sm" variant="ghost" disabled={!hasLivery(design)} onClick={() => change({ pattern: 'none', panel: 'none', decal: 'none', hoodNumber: false })}>Clear</Button>
        <Button size="sm" variant="ghost" disabled={JSON.stringify({ ...design, plateEnabled: false, plateText: DEFAULT_LIVERY.plateText, plateStyle: DEFAULT_LIVERY.plateStyle }) === JSON.stringify(DEFAULT_LIVERY)} onClick={() => change({ ...DEFAULT_LIVERY, plateEnabled: design.plateEnabled, plateText: design.plateText, plateStyle: design.plateStyle })}>Reset to stock</Button>
      </div>
    </fieldset>
  )
}

function PlatesTab({ build, update, disabled, side, onSide }: TabProps & {
  disabled: boolean
  side: 'front' | 'rear'
  onSide(side: 'front' | 'rear'): void
}) {
  const design = build.livery
  const change = (patch: Partial<LiveryDesign>) => update({ livery: { ...design, ...patch } })
  return (
    <fieldset className="livery-editor" disabled={disabled}>
      <legend>License plates</legend>
      <Segmented<'front' | 'rear'> label="Camera" value={side} options={[
        ['front', 'Front plate'], ['rear', 'Rear plate'],
      ]} onPick={onSide} />
      <section className="plate-editor" aria-label="License plate">
        <div className="plate-editor__heading"><span>YOUR SIGNATURE</span><span>LICENSE PLATE</span></div>
        <label className="livery-toggle">
          <input type="checkbox" checked={design.plateEnabled} onChange={(event) => change({ plateEnabled: event.target.checked })} />
          Custom front &amp; rear plates
        </label>
        <div className={`plate-preview plate-preview--${design.plateStyle}`} aria-label={`Plate preview: ${design.plateText || 'YOUR TAG'}`}>
          {design.plateStyle === 'euro' && <span className="plate-preview__band">✦<br />GT</span>}
          <small>{PLATE_STYLES[design.plateStyle].caption}</small>
          <strong>{design.plateText || 'YOUR TAG'}</strong>
          <span>RACING CLUB · BUILT TO DRIVE</span>
        </div>
        <label className="ui-field">
          <span className="ui-field__label">Plate text <em>{design.plateText.length}/8</em></span>
          <input className="livery-number plate-text" type="text" maxLength={8} value={design.plateText}
            placeholder="YOUR TAG" autoComplete="off" spellCheck={false}
            onChange={(event) => change({ plateText: event.target.value, plateEnabled: true })} />
        </label>
        <Segmented<PlateStyle> label="Plate style" value={design.plateStyle}
          options={Object.entries(PLATE_STYLES).map(([id, style]) => [id as PlateStyle, style.name])}
          onPick={(plateStyle) => change({ plateStyle, plateEnabled: true })} />
      </section>
      <Button size="sm" variant="ghost" onClick={() => change({
        plateEnabled: DEFAULT_LIVERY.plateEnabled, plateText: DEFAULT_LIVERY.plateText, plateStyle: DEFAULT_LIVERY.plateStyle,
      })}>Reset plates to stock</Button>
    </fieldset>
  )
}
