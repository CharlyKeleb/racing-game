import * as THREE from 'three'
import { Effect, EffectAttribute } from 'postprocessing'

/** Normalize shutter duration across display refresh rates, with bounded hitch recovery. */
export function motionExposure(speedKmh: number, amount: number, dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0 || dt > .1 || !Number.isFinite(amount) || !Number.isFinite(speedKmh)) return 0
  const ramp = THREE.MathUtils.smoothstep(Math.abs(speedKmh), 15, 160)
  return ramp * THREE.MathUtils.clamp(amount, 0, 1) / (120 * Math.max(dt, 1 / 240))
}

export class MotionBlurEffect extends Effect {
  constructor(vectors: THREE.Texture, samples: number) {
    super('VelocityMotionBlur', `
      uniform sampler2D vectors;
      uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec4 center = texture2D(vectors, uv);
        if (center.b > .5 || exposure <= 0.) { outputColor = inputColor; return; }
        vec2 motion = center.rg * exposure;
        float pixels = length(motion / texelSize);
        motion *= min(1., 24. / max(pixels, .001));
        vec4 sum = inputColor;
        float weight = 1.;
        for (int i = 1; i < ${samples}; i++) {
          float t = float(i) / float(${samples - 1}) - .5;
          vec2 at = clamp(uv + motion * t, vec2(0.), vec2(1.));
          vec4 sampleMotion = texture2D(vectors, at);
          float accept = (1. - step(.5, sampleMotion.b)) * step(abs(center.a - sampleMotion.a), max(.0005, center.a * .03));
          sum += texture2D(inputBuffer, at) * accept;
          weight += accept;
        }
        outputColor = sum / weight;
      }`, { attributes: EffectAttribute.CONVOLUTION, uniforms: new Map<string, THREE.Uniform>([
      ['vectors', new THREE.Uniform(vectors)], ['exposure', new THREE.Uniform(0)],
    ]) })
  }
}
