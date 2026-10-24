# Compact trusted simulation assets (#120)

The separate staging image now loads `simulation-assets.bin` instead of parsing
the large numeric JSON collision arrays at runtime. `build:simulation` still
exports inspectable JSON and the browser compatibility manifest. The staging
build then packs that JSON with `build-compact-assets.mjs`; the ordinary local
runner and earlier benchmark reports retain their JSON path.

RGAS/1 has a 48-byte header: ASCII magic `RGAS`, a little-endian uint32 file
version, JSON metadata length, numeric payload length, and a 32-byte SHA-256 of
the bytes after the header. Metadata contains provenance, stock configs,
spawn/line/checkpoints, mesh element counts and surface-grid information. Its
UTF-8 JSON is padded to four-byte alignment. Each mesh then stores float32 vertex
coordinates and uint32 triangle indices, followed by uint8 surface cells after
all meshes. The checksum detects corruption; it does not authenticate an upload.
Only trusted offline build output is loaded from the configured local file.

Encoding/decoding require a little-endian runtime, at most 64 MiB total, 1 MiB of
metadata and 4,096 meshes. Decoding checks version, exact lengths/counts,
checksum, triangle arity, finite vertices, in-range indices, grid dimensions and
surface codes before handing typed arrays to physics. It rejects truncated or
appended data. Aligned input retains views over one file buffer; unaligned input
copies once into aligned storage. No per-mesh numeric JS arrays are reconstructed.
Shared headless initialization uses those typed views directly and does not
convert/copy them again before Rapier creates its own collision structures.
Callers must treat the trusted bundle as immutable for its lifetime.

The current exported package is 9,804,077 bytes as JSON and 4,320,728 bytes packed.
The compiler's asset fingerprint changes with the shared source change; browser
and backend must both rebuild. Historical reports retain their older fingerprints.

Tests compare every real-track vertex, index, surface cell, configuration and
compatibility field after conversion. Two ghost cars run 240 ticks from each
representation with exactly equal body/controller results in the same runtime.
Corruption checks cover headers, digest, truncation/tails, invalid/oversized
counts, nonfinite vertices, invalid indices/surface codes and unaligned input.
The existing real-asset headless and synthetic prediction network checks pass.

Short compiled artifact samples after twelve steps fell from about 283–285 MiB
with JSON arrays to about 245–253 MiB in the [recorded packed-array check](measurements/staging-assets-2026-10-23-compact.json). These are local final
RSS samples from separate fresh processes, not a controlled steady-state/peak
capacity result. They leave little headroom within 256 MiB, especially before
real socket traffic/outbox activity. Container/hosted profiling, longer sessions,
world disposal/rematch and platform differences still require acceptance.
