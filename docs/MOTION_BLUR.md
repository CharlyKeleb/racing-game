# Motion blur (#55)

Settings → Driving → Motion blur sets the amount (0–100%). Zero skips the velocity render and blur samples. Post effects must be enabled. Reduced-motion preferences default new settings to zero; existing saved choices persist.

The pass records current and previous camera/object transforms in a full render-resolution RGBA16F target: signed UV displacement, player-body protection, and linear depth / 2000. Wheel meshes live outside the body subtree, so their actual spinner transforms produce rotational motion vectors. The player body, including its glass, writes a zero-velocity protection mask; the React HUD is outside the post pipeline. Opponents retain their own motion.

WebGL uses cached per-mesh velocity materials and a postprocessing convolution. WebGPU has a matching TSL material and depth-aware gather before bloom, tone mapping and AA. Static instancing and batching retain their local transforms. Both use 6/8/12 samples on Low/Medium/High, a 24-pixel maximum smear, depth rejection and protection-mask rejection to limit bleeding across silhouettes. Transparent effects do not write velocity. Alpha-tested scenery currently uses solid geometry in the velocity/depth pass; foliage cutout edges can therefore be conservative. Skin deformation and individually animated instance transforms do not have previous-pose buffers.

Strength ramps from 15 to 160 km/h. Exposure is normalized to a 1/120-second shutter at full amount, independent of refresh rate. Pausing, resizing, disabling blur, changing the player body/camera mode, hitches over 100 ms, large camera jumps and hard angle cuts invalidate history. Intro whip pans use the same velocity pass and amount setting, replacing the horizontal screen smear.

The extra opaque-geometry pass has a GPU/draw-call cost; no device-wide performance target is claimed. Zero blur disables it. Cached materials are disposed when meshes leave the scene and when the post stack is rebuilt/disposed. Render target, scene/material overrides, layers, clear state and WebGL shadow update state are restored after capture, including exceptions.

## Verification fixture

Open `/src/dev/motion-preview.html`, or append `?renderer=webgpu`. It reads the actual half-float velocity buffer for stationary geometry, camera/object movement and the body mask, checks camera-cut rejection, then renders a moving scene through the real post stack. The reported renderer must be `webgpu` to establish native WebGPU coverage.
