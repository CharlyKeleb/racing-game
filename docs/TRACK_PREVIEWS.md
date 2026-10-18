# Adding and updating race previews

The main-menu track card and the selector's **Aerial** view use committed WebP
images. They never load track geometry or create another WebGL renderer.
**Outline** uses `src/ui/trackPreviews.json` independently of these images.

## Capture an aerial

1. Install dependencies (`npm ci`) and make sure Git LFS assets are present
   (`git lfs pull`). Build or update the track first using `docs/TRACK_STREAMING.md`.
2. Run `npm run capture:previews`. This starts a localhost-only Vite capture
   server on port **5175** and opens `/preview-capture.html`.
3. Choose a track. Wait until its aerial and **Download** link appear.
4. Inspect the entire route, blue edging, yellow start/finish pin, scenery and
   framing. The **Fullscreen** button enlarges the inspection view.
5. Click **Save to project**. Confirm the “Saved <track-id>.webp” status. This
   writes `public/previews/tracks/<track-id>.webp`. Alternatively, **Download**
   the WebP and put it at that path manually.
6. Repeat for each changed track, then stop the capture server with Ctrl+C.
7. Run `npm test`, `npm run build` and `npm run lint`. Inspect the main menu,
   both selector views, and a narrow screen before committing the images.

The capture is exported directly from the renderer at **1600 × 1040** (WebP,
quality 0.9). It is independent of browser size and display scaling and contains
no buttons or page chrome. Prefer this export over an operating-system screenshot:
fullscreen is for inspection, not required for a high-resolution output.

## Registering a new circuit

- Add the circuit to `TRACKS` in `src/world/tracks.ts` and follow the track asset
  pipeline. The capture dropdown reads that registry automatically.
- The save endpoint derives its allowed track IDs from `TRACKS`; it will accept
  the new registered ID without a second mapping.
- Add its location, character and description to `src/ui/TrackSelection.tsx`.
- Add its outline and lap distance to `src/ui/trackPreviews.json`. Use the actual
  route: a streamed manifest's `line` projected from `[x,y,z]` to `[x,z]`, or the
  procedural track's closed centripetal Catmull–Rom curve sampled at ~4 m spacing.
  Compute lap distance from the full closed route before reducing outline samples.
- Generate and save `<track-id>.webp`. The runtime path is derived from the track
  ID in `TrackAerial.tsx`; no per-image import or runtime renderer is needed.
- Confirm the asset test covers the new track. An unregistered or missing preview
  must be corrected before shipping.

## Appearance and regeneration

`src/dev/AerialCapture.tsx` owns capture lighting, framing, route ribbon and pin.
It uses the actual procedural track builder or every streamed LOD0 chunk with
the low-tier material library and backdrop, so the layout matches the game.
It renders only during authoring and disposes its geometry, materials, textures
and WebGL context afterward. Procedural scenery may vary when regenerated;
the saved image is stable for players.

Regenerate after changes to a circuit's route, scenery, materials or capture
styling. Regenerate **all** images when changing shared framing or route styling
so the selector stays visually consistent. Keep the fixed aspect ratio and enough
margin for the selector's full-width cover crop and compact menu thumbnail.

## Loading, caching and missing files

The menu and selector share the browser image cache. They decode a new image
before fading it in, keeping the previous preview dimmed while it loads. A missing
image displays an unavailable message; players can still choose **Outline**.
There is deliberately no runtime geometry fallback.

Deploy the `dist` output including `dist/previews/tracks/*.webp`. These filenames
are stable, so use revalidation or a bounded cache lifetime (not immutable caching)
unless the deployment adds content-versioned URLs. Purge the CDN after replacing
an image if necessary. Only gameplay should load the streamed track's geometry.

The capture page is not a production build entry and is not emitted to `dist`.
Its save endpoint exists **only** when `CAPTURE_TRACK_PREVIEWS=1` is explicitly set;
normal `npm run dev` and production builds do not enable it. It accepts same-origin
POST requests, validates WebP signatures and a 5 MB limit, and can write only the
allowlisted preview filenames in this project's preview directory.
