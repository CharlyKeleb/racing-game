import * as THREE from 'three'
import { hasLivery, type LiveryDesign, type LiveryPlacement } from './LiveryDesign'

/** Original geometric marks; no sponsor logos, external images, or licensed fonts. */
export class LiveryGraphics {
  readonly texture: THREE.CanvasTexture
  private readonly canvas = document.createElement('canvas')
  private readonly context: CanvasRenderingContext2D
  private key = ''
  readonly uniforms = {
    uLiveryDoorNumber: { value: 0 }, uLiveryHoodNumber: { value: 0 },
    uLiveryHood: { value: new THREE.Vector2() },
    uLiveryEnabled: { value: 0 }, uLiveryPattern: { value: 0 },
    uLiveryPrimary: { value: new THREE.Color() }, uLiveryAccent: { value: new THREE.Color() },
    uLiveryStripe: { value: new THREE.Vector4() },
    uLiveryPanel: { value: new THREE.Vector4() },
    uLiveryDecal: { value: new THREE.Vector2() },
    uLiveryAtlas: { value: null as THREE.Texture | null },
  }

  constructor(placement: LiveryPlacement) {
    this.canvas.width = 512; this.canvas.height = 256
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('Livery graphics require a 2D canvas')
    this.context = context
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.uniforms.uLiveryAtlas.value = this.texture
    this.uniforms.uLiveryStripe.value.set(placement.stripeWidth, placement.stripeGap, placement.stripeOffset, placement.topMinY)
    this.uniforms.uLiveryPanel.value.set(placement.panelY, placement.panelZ, placement.panelWidth, placement.panelHeight)
    this.uniforms.uLiveryHood.value.set(placement.hoodZ, placement.hoodWidth)
    this.uniforms.uLiveryDecal.value.set(placement.decalZ, placement.decalWidth)
  }

  apply(design: LiveryDesign): void {
    const key = JSON.stringify(design)
    if (key === this.key) return
    this.key = key
    this.uniforms.uLiveryEnabled.value = hasLivery(design) ? 1 : 0
    this.uniforms.uLiveryPattern.value = ['none', 'center', 'twin', 'offset', 'chevron', 'triple', 'sash', 'pinstripe'].indexOf(design.pattern)
    this.uniforms.uLiveryDoorNumber.value = design.panel !== 'none' ? 1 : 0
    this.uniforms.uLiveryHoodNumber.value = design.hoodNumber ? 1 : 0
    this.uniforms.uLiveryPrimary.value.set(design.primary)
    this.uniforms.uLiveryAccent.value.set(design.accent)
    const ctx = this.context
    ctx.clearRect(0, 0, 512, 256)
    if (design.panel !== 'none' || design.hoodNumber) {
      ctx.fillStyle = design.primary
      ctx.strokeStyle = design.accent
      ctx.lineWidth = 12
      ctx.beginPath()
      if (design.panel !== 'square') ctx.arc(128, 128, 112, 0, Math.PI * 2)
      else ctx.rect(16, 16, 224, 224)
      ctx.fill(); ctx.stroke()
      // Choose legible digits against the selected panel colour.
      const color = new THREE.Color(design.primary)
      ctx.fillStyle = .2126 * color.r + .7152 * color.g + .0722 * color.b > .35 ? '#10131a' : '#ffffff'
      ctx.font = `900 ${design.number > 99 ? 112 : 148}px sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(design.number), 128, 137, 204)
    }
    ctx.save(); ctx.translate(256, 0)
    ctx.fillStyle = design.accent
    if (design.decal === 'bolt') {
      ctx.beginPath(); ctx.moveTo(140, 24); ctx.lineTo(55, 143); ctx.lineTo(112, 143)
      ctx.lineTo(92, 232); ctx.lineTo(207, 101); ctx.lineTo(146, 101); ctx.closePath(); ctx.fill()
    } else if (design.decal === 'chequer') {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        ctx.fillStyle = (x + y) % 2 ? design.accent : design.primary
        ctx.fillRect(32 + x * 48, 32 + y * 48, 48, 48)
      }
    } else if (design.decal === 'star') {
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const angle = i * Math.PI / 5 - Math.PI / 2
        const radius = i % 2 ? 46 : 105
        const x = 128 + Math.cos(angle) * radius
        const y = 128 + Math.sin(angle) * radius
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath(); ctx.fill()
    } else if (design.decal === 'target') {
      for (let i = 3; i > 0; i--) {
        ctx.fillStyle = i % 2 ? design.accent : design.primary
        ctx.beginPath(); ctx.arc(128, 128, i * 34, 0, Math.PI * 2); ctx.fill()
      }
    } else if (design.decal === 'speed') {
      for (let i = 0; i < 3; i++) {
        const y = 48 + i * 62
        ctx.beginPath(); ctx.moveTo(48, y); ctx.lineTo(216, y)
        ctx.lineTo(184, y + 36); ctx.lineTo(16, y + 36); ctx.closePath(); ctx.fill()
      }
    } else if (design.decal === 'apex') {
      ctx.beginPath(); ctx.moveTo(128, 28); ctx.lineTo(224, 220); ctx.lineTo(160, 220)
      ctx.lineTo(128, 148); ctx.lineTo(96, 220); ctx.lineTo(32, 220); ctx.closePath(); ctx.fill()
      ctx.fillStyle = design.primary; ctx.fillRect(108, 201, 40, 19)
    }
    ctx.restore()
    this.texture.needsUpdate = true
  }

  dispose(): void { this.texture.dispose() }
}

export const LIVERY_VERTEX_DECLARATIONS = `
attribute vec3 liveryPosition;
attribute vec3 liveryNormal;
varying vec3 vLiveryPosition;
varying vec3 vLiveryNormal;
`
export const LIVERY_FRAGMENT_DECLARATIONS = `
varying vec3 vLiveryPosition;
varying vec3 vLiveryNormal;
uniform float uLiveryDoorNumber;
uniform float uLiveryHoodNumber;
uniform vec2 uLiveryHood;
uniform float uLiveryEnabled;
uniform float uLiveryPattern;
uniform vec3 uLiveryPrimary;
uniform vec3 uLiveryAccent;
uniform vec4 uLiveryStripe;
uniform vec4 uLiveryPanel;
uniform vec2 uLiveryDecal;
uniform sampler2D uLiveryAtlas;
`

/** Applied to diffuse colour before physical lighting, keeping paint/clearcoat intact. */
export const LIVERY_FRAGMENT = `
if (uLiveryEnabled > .5) {
  vec3 lp = vLiveryPosition;
  vec3 ln = normalize(vLiveryNormal);
  float edge = max(fwidth(lp.x), .001);
  if (uLiveryPattern > .5 && ln.y > .45 && lp.y > uLiveryStripe.w) {
    float stripeDistance = abs(lp.x);
    float stripeWidth = uLiveryStripe.x;
    if (uLiveryPattern < 1.5) stripeWidth *= 1.8;
    else if (uLiveryPattern < 2.5) stripeDistance = abs(abs(lp.x) - uLiveryStripe.y);
    else if (uLiveryPattern < 3.5) stripeDistance = abs(lp.x - uLiveryStripe.z);
    else if (uLiveryPattern < 4.5) stripeDistance = abs(abs(lp.x) - .18 * abs(lp.z - .4));
    else if (uLiveryPattern < 5.5) { stripeDistance = min(abs(lp.x), abs(abs(lp.x) - uLiveryStripe.y * 1.8)); stripeWidth *= .65; }
    else if (uLiveryPattern < 6.5) stripeDistance = abs(lp.x - lp.z * .32);
    else { stripeDistance = abs(abs(lp.x) - .47); stripeWidth *= .25; }
    float outer = 1. - smoothstep(stripeWidth + .018, stripeWidth + .018 + edge, stripeDistance);
    float inner = 1. - smoothstep(stripeWidth, stripeWidth + edge, stripeDistance);
    diffuseColor.rgb = mix(diffuseColor.rgb, uLiveryAccent, outer);
    diffuseColor.rgb = mix(diffuseColor.rgb, uLiveryPrimary, inner);
  }
  if (uLiveryHoodNumber > .5 && ln.y > .55 && lp.y > uLiveryStripe.w) {
    vec2 huv = vec2(lp.x / uLiveryHood.y + .5, (lp.z - uLiveryHood.x) / uLiveryHood.y + .5);
    if (all(greaterThanEqual(huv, vec2(0.))) && all(lessThanEqual(huv, vec2(1.)))) {
      vec4 hood = texture2D(uLiveryAtlas, vec2(huv.x * .5, huv.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, hood.rgb, hood.a);
    }
  }
  if (abs(ln.x) > .55) {
    // Reverse projection on the opposite door so both numbers read normally.
    float direction = ln.x > 0. ? 1. : -1.;
    vec2 uv = vec2((lp.z - uLiveryPanel.y) * direction / uLiveryPanel.z + .5,
                   (lp.y - uLiveryPanel.x) / uLiveryPanel.w + .5);
    if (uLiveryDoorNumber > .5 && all(greaterThanEqual(uv, vec2(0.))) && all(lessThanEqual(uv, vec2(1.)))) {
      vec4 panel = texture2D(uLiveryAtlas, vec2(uv.x * .5, uv.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, panel.rgb, panel.a);
    }
    vec2 duv = vec2((lp.z - uLiveryDecal.x) * direction / uLiveryDecal.y + .5,
                    (lp.y - uLiveryPanel.x) / uLiveryDecal.y + .5);
    if (all(greaterThanEqual(duv, vec2(0.))) && all(lessThanEqual(duv, vec2(1.)))) {
      vec4 decal = texture2D(uLiveryAtlas, vec2(.5 + duv.x * .5, duv.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, decal.rgb, decal.a);
    }
  }
}
`
