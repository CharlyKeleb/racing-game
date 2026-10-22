import type { WheelId } from '../vehicles/VehicleConfig'
import { SPOILERS } from '../vehicles/SpoilerCatalog'
import { PLATE_STYLES, type PlateStyle } from '../vehicles/PlateStyles'
import { DEFAULT_LIVERY, hasLivery, type LiveryDesign, type StripePattern, type NumberPanel, type LiveryDecal } from '../vehicles/LiveryDesign'
import { GiPaintBrush, GiCarWheel, GiIdCard, GiAutoRepair, GiCheckeredFlag, GiSave } from 'react-icons/gi'
import { useEffect, useState } from 'react'
import { getCar } from '../vehicles/carRegistry'
import { nextPresetName, PRESET_NAME_MAX, PRESET_SLOTS, previewPreset, sameBuild, type BuildPreset } from '../vehicles/BuildPresets'
import {
  CALIPER_PRESETS,
  DEFAULT_BUILD,
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
import { Button, ClassBadge, Panel, Segmented } from './kit'

type Tab = 'paint' | 'wheels' | 'performance' | 'livery' | 'plates' | 'spoilers' | 'presets'
const TABS: [Tab, string][] = [
  ['paint', 'Paint'],
  ['wheels', 'Wheels'],
  ['spoilers', 'Spoilers'],
  ['livery', 'Livery'],
  ['plates', 'Plates'],
  ['performance', 'Upgrades'],
  ['presets', 'Presets'],
]

const tabIcons = { paint: GiPaintBrush, wheels: GiCarWheel, performance: GiAutoRepair, livery: GiCheckeredFlag, plates: GiIdCard, spoilers: GiAutoRepair, presets: GiSave }

/**
 * The workshop: category tabs and their options. It lives in the festival
 * hub's right-hand panel (MainMenu, Garage tab), so the hub's tabs, car card
 * and race button stay put while the camera moves in on what's being changed.
 */
export function GarageWorkshop() {
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
    game?.setShowroomFocus(tab === 'wheels' ? `wheel-${wheel}` : tab === 'plates' ? (plateSide === 'front' ? 'plate-front' : 'plate-rear') : tab === 'spoilers' ? 'spoiler' : 'car')
  }, [game, tab, plateSide, wheel])
  useEffect(() => () => game?.setShowroomFocus('car'), [game])

  return (
    <div className="hub-workshop">
      <nav className="hub-workshop__tabs" role="tablist" aria-label="Customise">
        {TABS.map(([id, text]) => {
          const Icon = tabIcons[id]
          return (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              <Icon aria-hidden="true" focusable="false" />
              <span>{text}</span>
            </button>
          )
        })}
      </nav>
      <Panel className="hub-workshop__options">
        {tab === 'paint' && <PaintTab build={build} update={update} />}
        {tab === 'wheels' && <WheelsTab build={build} update={update} wheel={wheel} onWheel={setWheel} disabled={switching} />}
        {tab === 'spoilers' && <SpoilersTab build={build} update={update} disabled={switching}/>}
        {tab === 'performance' && <PerformanceTab build={build} update={update} />}
        {tab === 'livery' && <LiveryTab build={build} update={update} disabled={switching} />}
        {tab === 'plates' && <PlatesTab build={build} update={update} disabled={switching} side={plateSide} onSide={setPlateSide} />}
        {tab === 'presets' && <PresetsTab build={build} disabled={switching} />}
        {tab !== 'livery' && tab !== 'plates' && tab !== 'spoilers' && tab !== 'presets' && <Button size="sm" variant="ghost" onClick={reset}>
          Reset to stock
        </Button>}
      </Panel>
    </div>
  )
}

/**
 * Named setups for this car (#35): save the current build, preview a preset's
 * class and stat changes before applying it, rename, duplicate, delete.
 */
function PresetsTab({ build, disabled }: { build: CarBuild; disabled: boolean }) {
  const car = useGame((s) => s.settings.car)
  const list = useGame((s) => s.presets[car]) ?? []
  const save = useGame((s) => s.savePreset)
  const apply = useGame((s) => s.applyPreset)
  const rename = useGame((s) => s.renamePreset)
  const duplicate = useGame((s) => s.duplicatePreset)
  const remove = useGame((s) => s.deletePreset)
  const [name, setName] = useState('')
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const stock = getCar(car).stats
  const full = list.length >= PRESET_SLOTS
  const rows: (BuildPreset & { stock?: boolean })[] = [{ id: 'stock', name: 'Stock', build: DEFAULT_BUILD, stock: true }, ...list]
  const target = rows.find((p) => p.id === previewing)
  const preview = target ? previewPreset(build, target.build, stock) : null
  return (
    <div className="presets">
      <form className="presets__save" onSubmit={(e) => { e.preventDefault(); if (!full) { save(name || nextPresetName(list)); setName('') } }}>
        <label className="ui-field">
          <span className="ui-field__label">Save this setup <em>{list.length}/{PRESET_SLOTS}</em></span>
          <span className="presets__save-row">
            <input className="ui-input" value={name} maxLength={PRESET_NAME_MAX} placeholder={nextPresetName(list)} aria-label="Preset name" onChange={(e) => setName(e.target.value)} disabled={full || disabled} />
            <Button size="sm" variant="primary" type="submit" disabled={full || disabled}>Save</Button>
          </span>
          {full && <span className="settings__help">All {PRESET_SLOTS} slots are used. Delete one to save another.</span>}
        </label>
      </form>
      <ul className="presets__list" aria-label="Saved setups">
        {rows.map((p) => {
          const rank = previewPreset(build, p.build, stock)
          const active = sameBuild(p.build, build)
          return (
            <li key={p.id} className={`presets__row${active ? ' is-active' : ''}${previewing === p.id ? ' is-previewing' : ''}`}>
              {renaming?.id === p.id ? (
                <form className="presets__rename" onSubmit={(e) => { e.preventDefault(); rename(p.id, renaming.name); setRenaming(null) }}>
                  <input className="ui-input" autoFocus value={renaming.name} maxLength={PRESET_NAME_MAX} aria-label={`Rename ${p.name}`} onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} />
                  <Button size="sm" type="submit">OK</Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>Cancel</Button>
                </form>
              ) : (
                <button className="presets__pick" onClick={() => setPreviewing(previewing === p.id ? null : p.id)} aria-expanded={previewing === p.id}>
                  <ClassBadge value={rank.carClass} />
                  <span className="presets__name">{p.name}{p.stock && <small>Factory setup</small>}{active && <small>Current</small>}</span>
                  <span className="presets__rank mono">{rank.rank}</span>
                </button>
              )}
              {confirming === p.id ? (
                <span className="presets__confirm" role="alertdialog" aria-label={`Delete ${p.name}?`}>
                  Delete “{p.name}”?
                  <Button size="sm" variant="primary" onClick={() => { remove(p.id); setConfirming(null); if (previewing === p.id) setPreviewing(null) }}>Delete</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Keep</Button>
                </span>
              ) : !p.stock && renaming?.id !== p.id && (
                <span className="presets__actions">
                  <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: p.id, name: p.name })}>Rename</Button>
                  <Button size="sm" variant="ghost" disabled={full} onClick={() => duplicate(p.id)}>Duplicate</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(p.id)}>Delete</Button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {target && preview && (
        <section className="presets__preview" aria-label={`Preview ${target.name}`}>
          <header>
            <ClassBadge value={preview.carClass} size="lg" />
            <div><b>{target.name}</b><span className="mono">Rank {preview.rank} <em className={preview.rankDelta > 0 ? 'up' : preview.rankDelta < 0 ? 'down' : ''}>{preview.rankDelta > 0 ? '+' : ''}{preview.rankDelta || '±0'}</em></span></div>
          </header>
          <dl>
            {preview.stats.map((s) => (
              <div key={s.key}><dt>{s.label}</dt><dd className="mono">{Math.round(s.value * 100)} <em className={s.delta > 0.005 ? 'up' : s.delta < -0.005 ? 'down' : ''}>{s.delta > 0.005 ? '+' : ''}{Math.abs(s.delta) < 0.005 ? '±0' : Math.round(s.delta * 100)}</em></dd></div>
            ))}
          </dl>
          <Button variant="primary" disabled={disabled || sameBuild(target.build, build)} onClick={() => { apply(target.build); setPreviewing(null) }}>
            {sameBuild(target.build, build) ? 'Already applied' : `Apply ${target.name}`}
          </Button>
        </section>
      )}
    </div>
  )
}

interface TabProps {
  build: CarBuild
  update(patch: Partial<CarBuild>): void
}

function SpoilersTab({build,update,disabled}:TabProps & {disabled:boolean}) {
  const loading=useGame(s=>s.spoilerLoading),error=useGame(s=>s.spoilerError)
  return <fieldset className="spoiler-editor" disabled={disabled}>
    <legend>Rear spoiler</legend>
    <p className="settings__help">Choose a profile. Drag the car to inspect the fit. Saved for this car.</p>
    <details className="spoiler-design" open>
      <summary>Color &amp; stripes</summary>
      <Segmented<CarBuild['spoilerFinish']> label="Spoiler color" value={build.spoilerFinish} options={[[ 'carbon','Black'],['paint','Body'],['custom','Custom']]} onPick={spoilerFinish=>update({spoilerFinish})}/>
      {build.spoilerFinish==='custom'&&<Swatches label="Spoiler paint" presets={PAINT_PRESETS} value={build.spoilerColor} onPick={spoilerColor=>update({spoilerColor})}/>}
      <Segmented<CarBuild['spoilerPattern']> label="Spoiler stripes" value={build.spoilerPattern} options={[[ 'none','None'],['center','Center'],['twin','Twin'],['edges','Edges'],['diagonal','Slashes']]} onPick={spoilerPattern=>update({spoilerPattern})}/>
      {build.spoilerPattern!=='none'&&<>
        <Swatches label="Stripe color" presets={PAINT_PRESETS} value={build.spoilerStripeColor} onPick={spoilerStripeColor=>update({spoilerStripeColor})}/>
        <label className="ui-field"><span className="ui-field__label">Stripe width <em>{Math.round(build.spoilerStripeWidth*100)}%</em></span>
          <input aria-label="Spoiler stripe width" className="ui-range" type="range" min={.03} max={.18} step={.01} value={build.spoilerStripeWidth} onChange={e=>update({spoilerStripeWidth:Number(e.target.value)})}/></label>
      </>}
      <div className="livery-actions"><Button size="sm" variant="ghost" onClick={()=>update({spoilerPattern:'none'})}>Clear stripes</Button></div>
    </details>
    <div className="spoiler-grid" aria-label="Spoiler designs">
      <button className="spoiler-option spoiler-option--stock" aria-pressed={build.spoiler==='stock'} onClick={()=>update({spoiler:'stock'})}>
        <span className="spoiler-stock-mark" aria-hidden="true">—</span><strong>Stock</strong><small>Original rear styling</small>
      </button>
      {SPOILERS.map((part,i)=><button key={part.id} className="spoiler-option" aria-label={`${part.name} spoiler`} aria-pressed={build.spoiler===part.id} onClick={()=>update({spoiler:part.id})}>
        <img src={`/models/parts/spoilers/${part.id}.svg`} alt="" width="160" height="85"/>
        <strong><span>{String(i+1).padStart(2,'0')}</span> {part.name}</strong><small>{part.description}</small>
      </button>)}
    </div>
    <p className="settings__help" role="status">{loading?'Fitting spoiler…':error??'Visual customization · handling stays the same.'}</p>
    {error&&<Button size="sm" onClick={()=>update({spoiler:build.spoiler})}>Retry spoiler</Button>}
  </fieldset>
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
