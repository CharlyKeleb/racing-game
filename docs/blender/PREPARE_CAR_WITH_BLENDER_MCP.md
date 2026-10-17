# Prepare a car with Blender MCP

Hand this file to Claude Code while Blender is open with the car's `.blend`
loaded and the Blender MCP add-on connected:

```
Read docs/blender/PREPARE_CAR_WITH_BLENDER_MCP.md and execute it using Blender MCP for the McLaren.
```

## One-time setup (macOS)

```bash
brew install uv
```

```bash
uvx blender-mcp install-addon
```

Then enable the add-on in Blender (Edit → Preferences → Add-ons → "Blender MCP"),
start the server from the add-on's sidebar panel, and add the `blender` MCP
server to Claude Code.

> ⚠️ Blender MCP can run arbitrary Python inside Blender. Only connect MCP servers
> you trust. Back up the `.blend` first. Step 0 below makes the agent do this too.

---

## Instructions for the agent

You are preparing a car model for a Three.js + Rapier racing game in this repo.
The runtime contract is in `docs/ASSET_PIPELINE.md`. Read it first; it is the
source of truth for names, axes and the `vehicle-config.json` shape.

Work **incrementally**. Inspect, change one thing, verify, then move on. Never
delete geometry, apply destructive modifiers or overwrite the original file
without asking me first.

### 0. Safety
- Save a working copy next to the original as `<name>_gameprep.blend` and
  work only on the copy.

### 1. Audit (report, don't change anything yet)
Report as a table:
- Full object hierarchy: name, type, parent, vertex/triangle count, and
  modifiers.
- Overall dimensions (L × W × H), current unit scale, and which axis the nose
  points along.
- Materials per object, texture images with their resolutions, and anything
  that is not Principled BSDF (it won't export to glTF cleanly).
- Which objects are the wheels. Are they separate objects, or joined into the
  body? Where are their origins relative to the axle centers?
- Total triangles. Flag anything over the budget (≤ ~150k car, ≤ ~10k per wheel).
- License or credit info, if any is embedded or in the source folder.

Stop here and show me the audit before modifying anything.

### 2. Wheels
- If the wheels are joined to the body, separate each wheel (tire + rim + disc)
  into its own object by selecting linked geometry. Leave calipers on the
  chassis.
- Set each wheel's **origin to its axle center**: the bounding-box center of
  the tire.
- Name the wheels exactly `Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`. Front
  and rear are by the nose; left and right are from the driver's seat.
- Verify: rotating each wheel on its local axle axis must not wobble.

### 3. Hierarchy and naming
Organize the model into one root with these direct children:
`Chassis`, `Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`, `Glass`,
`Headlights`, `Taillights`, `Interior`. Merge small static body parts into
`Chassis`, grouped by material. Drop hidden or helper objects only after asking
me.

### 4. Scale and orientation
- Meters, real-world size. A McLaren 720S is about 4.54 m L × 1.93 m W ×
  1.20 m H. Rescale if needed, then **apply scale and rotation**.
- Orient the car so its nose exports to **glTF +Z** with Y up. In Blender's
  Z-up space, the nose points **−Y**. The glTF exporter converts it with
  "+Y Up" enabled.
- Put the root origin at ground level under the wheelbase center: the midpoint
  between the axles, with the tire bottoms at Z = 0.

### 5. Materials
- Preserve the look. Keep PBR metallic/roughness, and convert non-Principled
  nodes to Principled BSDF by baking if needed.
- Car paint: metallic ~0.6–0.9, roughness ~0.2–0.35, clearcoat 1.
- Glass: low roughness with transmission or alpha blend.
- Lights: emissive strength > 1 so bloom picks them up.
- Merge duplicate materials. Aim for ≤ ~30 materials and draw calls.

### 6. Optimize
- Reduce to budget with Decimate (Collapse) on dense, non-silhouette parts
  only. Keep the body silhouette and wheel roundness. Show me before and after
  triangle counts.
- Downscale textures over 2048². Remove unused images and materials.

### 7. Physics data
Measure in **glTF/game space** (meters, +Y up, +Z forward, +X left, origin as
in step 4):
- Axle center of each wheel, wheel radius and tire width.
- Chassis collision box: `chassisHalfExtents` and `chassisCenter`, covering the
  body above the wheels with its bottom at ride height. Do not include the
  wheels.
- Mount points: `position = axleCenter + [0, restLength, 0]`, with
  `restLength = 0.32`.

Write `public/models/cars/mclaren/vehicle-config.json` following the example in
`docs/ASSET_PIPELINE.md`. Include `id`, `name`, `massKg` (1420 for a 720S),
`chassisHalfExtents`, `chassisCenter`, `centerOfMass` (low: about 0.35 m up,
slightly rear-biased), and all four `wheels` (front steered, rear driven and
handbrake).

### 8. Export
Export `public/models/cars/mclaren/mclaren.glb` with the glTF 2.0 exporter:
- Format: glTF Binary (.glb). Include: selected or visible objects, custom
  properties off.
- Transform: **+Y Up** enabled. Apply modifiers.
- Materials: export. Images: automatic (JPEG for color maps if size matters).
- Compression: off for now. We'll run `gltf-transform`/meshopt in the build
  later.

### 9. Validate
- Reimport the GLB into a **new, empty** scene. Check the hierarchy names, that
  each wheel origin is at its axle, that scale and orientation are right (nose
  toward glTF +Z, which is Blender −Y after import), and that materials and
  textures came through.
- Report the final file size, triangle count, material count and the contents
  of `vehicle-config.json`.
- Finally, run `npm run dev` in this repo and confirm the car loads instead of
  the placeholder. Check that the wheels steer and spin around the right axis.

### 10. Credits
Add the model's source URL, author and license to `public/models/CREDITS.md`.
