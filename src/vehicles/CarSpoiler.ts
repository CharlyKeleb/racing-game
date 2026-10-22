import * as THREE from 'three'
import type { AssetManager } from '../engine/AssetManager'
import type { CarBuild } from './CarBuild'
import type { CarModel } from './CarModel'
import { SPOILER_FIT, SPOILER_URL, sanitizeSpoiler, spoilerStripe, type SpoilerId } from './SpoilerCatalog'

/** Player-only bolt-on parts. AssetManager owns shared GLB geometry; this owns materials. */
/** Cars whose stock wing is part of their body meshes, so it goes when a custom spoiler is fitted. */
const STOCK_WINGS: Record<string,{materials:readonly string[];minY:number;maxZ:number}> = {
  bmw:{materials:['Mat.3'],minY:.86,maxZ:-2.0},
  diablo:{materials:['WC_TEAM_WINDOWS_PL.001','BLACK.001'],minY:.93,maxZ:-1.75},
  amg:{materials:['amgMercedesAMG_GT3_2020Paint_Material1','amgMercedesAMG_GT3_2020Coloured_Material1','amgMercedesAMG_GT3_2020Carbon1_Material1','white'],minY:.98,maxZ:-1.9},
}

export class CarSpoiler {
  readonly group = new THREE.Group()
  private readonly blade = new THREE.MeshStandardMaterial({name:'custom_spoiler_blade',color:0x192127,metalness:.35,roughness:.34,side:THREE.DoubleSide})
  private readonly mount = new THREE.MeshStandardMaterial({name:'custom_spoiler_mount',color:0x11171c,metalness:.3,roughness:.5,side:THREE.DoubleSide})
  private readonly pixels=new Uint8Array(256*128*4)
  private readonly design=new THREE.DataTexture(this.pixels,256,128)
  private readonly color=new THREE.Color()
  private appearance=''
  private readonly originals: {mesh:THREE.Mesh;original:THREE.BufferGeometry;without:THREE.BufferGeometry}[]=[]
  private selected:SpoilerId|null=null
  private revision=0
  private disposed=false
  private fit
  private readonly model:CarModel
  private readonly assets:Pick<AssetManager,'loadModel'>
  private readonly onStatus:(loading:boolean,error:string|null)=>void

  constructor(model:CarModel,assets:Pick<AssetManager,'loadModel'>,onStatus:(loading:boolean,error:string|null)=>void=()=>{}) {
    this.model=model;this.assets=assets;this.onStatus=onStatus
    this.design.colorSpace=THREE.SRGBColorSpace;this.design.magFilter=THREE.LinearFilter;this.design.minFilter=THREE.LinearFilter
    this.blade.map=this.design;this.blade.color.set(0xffffff)
    this.fit=SPOILER_FIT[model.root.name]??SPOILER_FIT.porsche911
    this.group.name='CustomSpoiler';this.group.position.fromArray(this.fit.position);this.group.scale.setScalar(this.fit.width)
    model.body.add(this.group)
  }

  async apply(build:CarBuild):Promise<void> {
    if(this.disposed)return
    this.updateDesign(build)
    this.blade.metalness=build.spoilerFinish==='paint'?.65:.35
    this.blade.roughness=build.spoilerFinish==='paint'?(build.finish==='matte'?.8:.24):.34
    const id=sanitizeSpoiler(build.spoiler)
    if(id===this.selected)return
    this.selected=id;const revision=++this.revision
    // Immediately restore stock while loading; a failed request leaves a complete car.
    this.group.clear();this.restoreStock();this.onStatus(id!=='stock',null)
    if(id==='stock')return
    try{
      const pack=await this.assets.loadModel(SPOILER_URL)
      if(this.disposed||revision!==this.revision)return
      const part=pack.getObjectByName(id)
      if(!part)throw new Error(`Missing spoiler ${id}`)
      const fitted=part.clone(true)
      fitted.traverse(node=>{if(node instanceof THREE.Mesh){
        const original=Array.isArray(node.material)?node.material[0]:node.material
        node.material=original.name==='spoiler_mount'?this.mount:this.blade
        node.castShadow=node.receiveShadow=true
      }})
      this.prepareStockWing();this.hideStock()
      this.group.add(fitted)
      this.onStatus(false,null)
    }catch{
      if(this.disposed||revision!==this.revision)return
      this.selected='stock'
      this.onStatus(false,'Spoiler could not load. Stock is fitted — select a part to retry.')
    }
  }

  private updateDesign(build:CarBuild):void {
    const base=build.spoilerFinish==='paint'?build.paint:build.spoilerFinish==='custom'?build.spoilerColor:'#192127'
    const key=`${base}/${build.spoilerPattern}/${build.spoilerStripeColor}/${build.spoilerStripeWidth}`
    if(key===this.appearance)return
    this.appearance=key
    const baseHex=this.color.set(base).getHex(THREE.SRGBColorSpace),stripeHex=this.color.set(build.spoilerStripeColor).getHex(THREE.SRGBColorSpace)
    for(let y=0;y<128;y++)for(let x=0;x<256;x++){
      const hex=spoilerStripe(build.spoilerPattern,(x+.5)/256,(y+.5)/128,build.spoilerStripeWidth)?stripeHex:baseHex,index=(y*256+x)*4
      this.pixels[index]=(hex>>16)&255;this.pixels[index+1]=(hex>>8)&255;this.pixels[index+2]=hex&255;this.pixels[index+3]=255
    }
    this.design.needsUpdate=true
  }

  /** A stock wing merged into body materials: drop only its triangles above `minY` and behind `maxZ` (body metres). */
  private prepareStockWing():void {
    const wing=STOCK_WINGS[this.model.root.name]
    if(this.originals.length||!wing)return
    this.model.body.updateWorldMatrix(true,true)
    const inverse=this.model.body.matrixWorld.clone().invert(),point=new THREE.Vector3()
    this.model.body.traverse(node=>{
      if(!(node instanceof THREE.Mesh)||Array.isArray(node.material))return
      const originalNames:unknown=node.userData.garageMaterialNames
      if(!wing.materials.includes(node.material.name)&&!(Array.isArray(originalNames)&&originalNames.some(n=>wing.materials.includes(n))))return
      const geometry=node.geometry,positions=geometry.getAttribute('position'),index=geometry.getIndex(),count=index?.count??positions.count
      const transform=new THREE.Matrix4().multiplyMatrices(inverse,node.matrixWorld),keep:number[]=[]
      let removed=0
      for(let i=0;i<count;i+=3){let inWing=true
        for(let j=0;j<3;j++){const v=index?index.getX(i+j):i+j;point.fromBufferAttribute(positions,v).applyMatrix4(transform);if(point.y<wing.minY||point.z>wing.maxZ)inWing=false}
        if(inWing)removed++;else for(let j=0;j<3;j++)keep.push(index?index.getX(i+j):i+j)
      }
      if(removed){const without=geometry.clone();without.setIndex(keep);this.originals.push({mesh:node,original:geometry,without})}
    })
  }
  private hideStock():void {for(const p of this.originals)p.mesh.geometry=p.without}
  private restoreStock():void {for(const p of this.originals)p.mesh.geometry=p.original}
  dispose():void {
    if(this.disposed)return
    this.disposed=true;this.revision++;this.restoreStock();this.group.removeFromParent();this.group.clear()
    for(const p of this.originals)p.without.dispose()
    this.design.dispose();this.blade.dispose();this.mount.dispose()
  }
}
