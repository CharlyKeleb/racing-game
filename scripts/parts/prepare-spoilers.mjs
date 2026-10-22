// Normalize the supplied pack into ten independently selectable, metre-ready parts.
// Usage: node scripts/parts/prepare-spoilers.mjs ~/Downloads/ultimate_car_spoiler_pack__game-ready.glb
import fs from 'node:fs/promises'
import path from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, meshopt } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import * as THREE from 'three'

const source = process.argv[2]
if (!source) throw new Error('Supply the source spoiler GLB')
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder})
const input = await io.read(source), output = new Document(), scene = output.createScene('SpoilerPack'), buffer = output.createBuffer()
const blade = output.createMaterial('spoiler_blade').setBaseColorFactor([.07,.08,.09,1]).setRoughnessFactor(.32).setMetallicFactor(.35).setDoubleSided(true)
const mount = output.createMaterial('spoiler_mount').setBaseColorFactor([.025,.03,.035,1]).setRoughnessFactor(.48).setMetallicFactor(.2).setDoubleSided(true)
const nodes = input.getRoot().listNodes().filter(n=>n.getMesh())
const outDir = 'public/models/parts/spoilers'
await fs.mkdir(outDir,{recursive:true})
for(let i=0;i<10;i++){
  // Material1: ten blades. Material2: matching mounts/endplates; blade #2 is one piece.
  const parts = [nodes[i],...(i===1?[]:[nodes[i===0?10:i+9]])]
  const primitives=[], bounds=new THREE.Box3()
  for(const node of parts){
    const matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix()),normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix)
    for(const primitive of node.getMesh().listPrimitives()){
      const pos=primitive.getAttribute('POSITION'),normal=primitive.getAttribute('NORMAL'),positions=[],normals=[]
      for(let j=0;j<pos.getCount();j++){
        const p=new THREE.Vector3().fromArray(pos.getElement(j,[])).applyMatrix4(matrix);bounds.expandByPoint(p);positions.push(...p.toArray())
        if(normal)normals.push(...new THREE.Vector3().fromArray(normal.getElement(j,[])).applyNormalMatrix(normalMatrix).toArray())
      }
      primitives.push({positions,normals,indices:primitive.getIndices()?.getArray(),mount:node!==nodes[i]})
    }
  }
  const width=bounds.max.x-bounds.min.x, center=bounds.getCenter(new THREE.Vector3()), mesh=output.createMesh()
  for(const part of primitives){
    for(let j=0;j<part.positions.length;j+=3){part.positions[j]=(part.positions[j]-center.x)/width;part.positions[j+1]=(part.positions[j+1]-bounds.min.y)/width;part.positions[j+2]=(part.positions[j+2]-center.z)/width}
    const uv=new Float32Array(part.positions.length/3*2),depth=(bounds.max.z-bounds.min.z)/width
    for(let j=0;j<part.positions.length/3;j++){uv[j*2]=Math.max(0,Math.min(1,part.positions[j*3]+.5));uv[j*2+1]=Math.max(0,Math.min(1,part.positions[j*3+2]/depth+.5))}
    const p=output.createPrimitive().setMaterial(part.mount?mount:blade)
      .setAttribute('POSITION',output.createAccessor().setType('VEC3').setArray(new Float32Array(part.positions)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0',output.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer))
    if(part.normals.length)p.setAttribute('NORMAL',output.createAccessor().setType('VEC3').setArray(new Float32Array(part.normals)).setBuffer(buffer))
    if(part.indices)p.setIndices(output.createAccessor().setType('SCALAR').setArray(new Uint16Array(part.indices)).setBuffer(buffer))
    mesh.addPrimitive(p)
  }
  const id=`wing-${String(i+1).padStart(2,'0')}`
  scene.addChild(output.createNode(id).setMesh(mesh))
  // Front/elevated wire silhouettes are actual geometry, not generic repeated icons.
  const lines=[]
  for(const part of primitives){const indices=part.indices??Array.from({length:part.positions.length/3},(_,j)=>j)
    for(let j=0;j<indices.length;j+=3){const pts=[0,1,2].map(k=>{const q=indices[j+k]*3,x=part.positions[q],y=part.positions[q+1],z=part.positions[q+2];return `${(80+x*115+z*30).toFixed(1)},${(66-y*115+z*30).toFixed(1)}`});lines.push(`<polygon points="${pts.join(' ')}"/>`)}
  }
  await fs.writeFile(path.join(outDir,`${id}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 85"><g fill="#263b4a" stroke="#99c5db" stroke-width=".45" stroke-linejoin="round">${lines.join('')}</g></svg>\n`)
  console.log(id,primitives.reduce((s,p)=>s+(p.indices?.length??p.positions.length/3)/3,0),'triangles')
}
Object.assign(output.getRoot().getAsset(), {copyright:"DevPoly3D - Ultimate Car Spoiler Pack - CC BY 4.0"}); output.getRoot().setExtras({source: input.getRoot().getAsset()})
await MeshoptEncoder.ready
await output.transform(dedup(),prune({keepAttributes:true}),meshopt({encoder:MeshoptEncoder,level:'high'}))
await io.write(path.join(outDir,'spoilers.glb'),output)
