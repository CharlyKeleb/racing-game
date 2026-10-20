# Garage spoiler customization

Garage → Spoilers offers Stock and ten designs from DevPoly3D's Ultimate Car
Spoiler Pack. Selecting a part fits it live and moves the showroom camera to a
rear three-quarter view. Dragging inspects the part within the normal detail
camera orbit limits.

Color & stripes provides satin black, body-matched paint or a separate custom
color (presets and a color picker). Center, twin, edge and diagonal stripe
patterns have independent color and width controls. Clear stripes keeps the
spoiler and paint. Stock restores the original rear styling without clearing
other garage customizations. All spoiler fields save within the existing
per-car build; old saves default to Stock. These are visual parts and do not
change the car's aerodynamic forces, rank or handling.

## Asset preparation

The supplied `ultimate_car_spoiler_pack__game-ready.glb` embeds the author, source
and CC BY 4.0 license. Attribution and modifications are recorded beside the
runtime model and in `public/models/CREDITS.md`.

Rebuild with:

```sh
node scripts/parts/prepare-spoilers.mjs <source.glb>
```

The source's 19 meshes form ten complete styles: blade 1 pairs with mount 11,
blade 2 stands alone, and blades 3–10 pair with mounts 12–19. Transform baking
retains each design's original proportions. Each style is centred horizontally
with its lowest mounting point at Y=0 and its full width normalized to one
metre. Runtime fits uniformly scale it and position it on each car's rear deck.
The preparation script generates planar blade UVs, geometry-derived SVG previews
and one meshopt-compressed pack. Only the selected style enters the car scene.

There are 102–656 triangles per part and at most two material draws. Each player
car owns a small 256×128 design texture, redrawn only when color/pattern settings
change. Both renderers use standard Three.js materials; there are no custom
shaders, additional lights or render passes. Mounts remain dark while the blade
receives the chosen paint/stripes. Stripe projection can stretch on vertical
endplates; it is intended primarily for the upper wing surface.

## Runtime ownership and fit

`CarSpoiler` loads through `AssetManager` only for a non-stock selection. It
rejects stale asynchronous results after another part is selected, a car is
swapped or the game is disposed. Failed loads restore the stock view and expose
a retry control. Geometry remains shared with the cached pack; this component
owns its materials and design texture.

Fits are in body coordinates (`SPOILER_FIT`) and follow the visible suspension
lean. The BMW includes a raised stock wing merged into material `Mat.3`. The
replacement filters only its upper-rear triangles into an owned geometry copy;
Stock/dispose restores the original geometry. Porsche and Koenigsegg preserve
their integrated deck/body surfaces. These are bolt-on visual fits rather than
new body kits or collision meshes.

## Checks

`tests/spoilers.test.ts` covers actual packed part geometry/UVs, old-save
migration, per-car persistence, independent paint/stripe pixels, cosmetic-only
handling, stock reset, failed/stale loads and disposal. Both real BMW LODs are
checked for stock-wing replacement and unchanged/restored source geometry.

`/src/dev/spoilers.html` loads the real garage with the Papaya track and Low
quality. Optional `car=bmw`, `car=koenigsegg`, `quality=high` and
`renderer=webgpu` parameters select verification variants. The initial setup is
ephemeral; editing uses the normal garage persistence path.
