import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { trackLookRole, withTrackLook, setTrackLook, trackLookStrength } from '../src/world/TrackLook'
import { WetRoads } from '../src/effects/WetRoads'
import { RainSurface } from '../src/effects/RainSurface'
import { backend } from '../src/engine/backend'

afterEach(()=>{setTrackLook('road-focus');backend.kind='webgl';backend.nodes=null})
function shader(material: THREE.Material) {
  const data={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader}
  material.onBeforeCompile(data as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  return data
}

describe('global track appearance',()=>{
  it('has a road and scenery path in all four shipped material libraries, preserving markings/props',()=>{
    for(const id of ['nurburgring','singapore','drift-park','u2city']) {
      const glb=readFileSync(`public/models/tracks/${id}/materials_high.glb`)
      const json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString())
      const roles=json.materials.map((m:{name:string;extras?:{layer:string}})=>trackLookRole(m.name,m.extras?.layer))
      expect(roles).toContain('road');expect(roles).toContain('scenery')
      expect(roles).toContain('protected')
    }
    for(const name of ['curbs_new.001','lines_yellow','astroturf.001','1111Mtl','1101Mtl']) expect(trackLookRole(name,'road')).toBe('protected')
    expect(trackLookRole('SGN_NEON','prop')).toBe('protected')
    expect(trackLookRole('__vertex_color')).toBe('mixed')
  })
  it('switches existing and newly loaded materials through one uniform, preserving maps and shader boundaries',()=>{
    const map=new THREE.Texture(), source=new THREE.MeshStandardMaterial({name:'asphalt',map,roughness:.9})
    source.userData.layer='road'
    const material=withTrackLook(source)
    const compiled=shader(material)
    expect(material).toBe(source);expect(source.map).toBe(map)
    expect(compiled.fragmentShader).not.toMatch(/}#define/)
    expect(compiled.fragmentShader.match(/diffuseColor.rgb=mix/g)).toHaveLength(1)
    expect(compiled.uniforms).toHaveProperty('uTrackLook',trackLookStrength)
    setTrackLook('default');expect(trackLookStrength.value).toBe(0)
    const later=new THREE.MeshLambertMaterial({name:'__vertex_color',vertexColors:true})
    expect(shader(withTrackLook(later)).uniforms).toHaveProperty('uTrackLook',trackLookStrength)
    expect(later.vertexColors).toBe(true)
    setTrackLook('road-focus');expect(trackLookStrength.value).toBe(1)
    material.dispose();later.dispose();map.dispose()
  })
  it('keeps grading before wet-road darkening and leaves protected kerbs untouched',()=>{
    const kerb=new THREE.MeshStandardMaterial({name:'kerb',color:0xff0000})
    expect(withTrackLook(kerb)).toBe(kerb)
    const source=new THREE.MeshStandardMaterial({name:'asphalt'})
    source.userData.layer='road'
    const material=withTrackLook(source), mesh=new THREE.Mesh(new THREE.PlaneGeometry(),material), root=new THREE.Group()
    root.add(mesh)
    const field=new RainSurface(), wet=new WetRoads(field.uniforms)
    wet.update(root,1,1)
    const compiled=shader(mesh.material as THREE.Material)
    expect(compiled.fragmentShader.indexOf('diffuseColor.rgb=mix')).toBeLessThan(compiled.fragmentShader.indexOf('float rainWet='))
    wet.dispose();field.dispose();source.dispose();kerb.dispose();mesh.geometry.dispose()
  })
})
