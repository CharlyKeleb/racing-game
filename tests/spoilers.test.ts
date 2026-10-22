import {afterEach,describe,expect,it,vi} from 'vitest'
import * as THREE from 'three'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {MeshoptDecoder} from 'meshoptimizer'
import {CarSpoiler} from '../src/vehicles/CarSpoiler'
import {DEFAULT_BUILD,samePerformance,sanitizeBuild} from '../src/vehicles/CarBuild'
import {SPOILERS,spoilerStripe} from '../src/vehicles/SpoilerCatalog'
import type {CarModel} from '../src/vehicles/CarModel'
import {gameStore} from '../src/stores/gameStore'
const saved=gameStore.getState()
afterEach(()=>{vi.unstubAllGlobals();gameStore.setState(saved)})
function model(id='porsche911') {const root=new THREE.Group(),body=new THREE.Group();root.name=id;root.add(body);return {root,body,wheels:{}} as CarModel}
function pack(){const root=new THREE.Group();for(const s of SPOILERS){const part=new THREE.Group();part.name=s.id;part.add(new THREE.Mesh(new THREE.BoxGeometry(1,.1,.2),new THREE.MeshStandardMaterial({name:'spoiler_blade'})));root.add(part)}return root}
async function document(path:string){await MeshoptDecoder.ready;return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(path)}

describe('garage spoiler parts',()=>{
  it('migrates old builds to stock, rejects invalid parts and keeps cosmetics out of handling',()=>{
    expect(sanitizeBuild({paint:'#123456'}).spoiler).toBe('stock')
    expect(sanitizeBuild({spoiler:'../../wrong',spoilerFinish:'bad'})).toMatchObject({spoiler:'stock',spoilerFinish:'carbon'})
    for(const part of SPOILERS){const build=sanitizeBuild({...DEFAULT_BUILD,spoiler:part.id,spoilerFinish:'paint'});expect(build.spoiler).toBe(part.id);expect(samePerformance(build,DEFAULT_BUILD)).toBe(true)}
  })
  it('persists independently per car and stock reset leaves other car parts intact',()=>{
    let data='';vi.stubGlobal('localStorage',{setItem:(_key:string,value:string)=>{data=value}})
    gameStore.getState().updateSettings({car:'porsche911'});gameStore.getState().updateBuild({spoiler:'wing-03'})
    gameStore.getState().updateSettings({car:'bmw'});gameStore.getState().updateBuild({spoiler:'wing-10',spoilerFinish:'paint'})
    expect(JSON.parse(data).porsche911.spoiler).toBe('wing-03')
    gameStore.getState().updateSettings({car:'porsche911'});expect(gameStore.getState().build.spoiler).toBe('wing-03')
    gameStore.getState().updateBuild({spoiler:'stock'});expect(gameStore.getState().builds.bmw.spoiler).toBe('wing-10')
  })
  it('ignores stale loads and disposal; stock requires no download',async()=>{
    const m=model(),p=pack(),pending:((p:THREE.Group)=>void)[]=[],loadModel=vi.fn(()=>new Promise<THREE.Group>(resolve=>pending.push(resolve))),status=vi.fn(),rig=new CarSpoiler(m,{loadModel},status)
    await rig.apply(DEFAULT_BUILD);expect(loadModel).not.toHaveBeenCalled();expect(status).toHaveBeenLastCalledWith(false,null)
    const first=rig.apply({...DEFAULT_BUILD,spoiler:'wing-01'}),second=rig.apply({...DEFAULT_BUILD,spoiler:'wing-10'})
    pending[1](p);await second;pending[0](p);await first
    expect(rig.group.children[0].name).toBe('wing-10')
    await rig.apply({...DEFAULT_BUILD,spoiler:'wing-10',spoilerFinish:'paint',paint:'#ff0000'})
    const material=(rig.group.children[0].children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(Array.from((material.map as THREE.DataTexture).image.data.slice(0,4))).toEqual([255,0,0,255])
    const third=rig.apply({...DEFAULT_BUILD,spoiler:'wing-02'});rig.dispose();pending[2](p);await third
    expect(rig.group.parent).toBeNull();expect(rig.group.children).toHaveLength(0)
  })
  it('paints the blade independently of body paint and lays stripes over its UVs',async()=>{
    const rig=new CarSpoiler(model(),{loadModel:async()=>pack()})
    const build={...DEFAULT_BUILD,spoiler:'wing-05' as const,spoilerFinish:'custom' as const,spoilerColor:'#ff0000',spoilerPattern:'center' as const,spoilerStripeColor:'#ffffff',spoilerStripeWidth:.1}
    await rig.apply(build)
    const material=(rig.group.children[0].children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial,data=(material.map as THREE.DataTexture).image.data
    const pixel=(x:number)=>Array.from(data.slice(x*4,x*4+4))
    expect(pixel(128)).toEqual([255,255,255,255]);expect(pixel(5)).toEqual([255,0,0,255])
    expect(spoilerStripe('none',.5,.5,.1)).toBe(false);expect(spoilerStripe('twin',.4,.5,.1)).toBe(true);expect(spoilerStripe('twin',.5,.5,.1)).toBe(false)
    expect(sanitizeBuild({...build,spoilerStripeWidth:99,spoilerStripeColor:'invalid'})).toMatchObject({spoilerStripeWidth:.18,spoilerStripeColor:DEFAULT_BUILD.spoilerStripeColor})
    rig.dispose()
  })
  it('restores the stock view after load failure and permits retry',async()=>{
    const loadModel=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(pack()),status=vi.fn(),rig=new CarSpoiler(model(),{loadModel},status)
    const build={...DEFAULT_BUILD,spoiler:'wing-04' as const}
    await rig.apply(build);expect(status).toHaveBeenLastCalledWith(false,expect.stringContaining('Stock is fitted'));expect(rig.group.children).toHaveLength(0)
    await rig.apply(build);expect(rig.group.children[0].name).toBe('wing-04');expect(status).toHaveBeenLastCalledWith(false,null)
    await rig.apply(DEFAULT_BUILD);expect(rig.group.children).toHaveLength(0);rig.dispose()
  })
  it('ships all ten complete, normalized low-poly source designs',async()=>{
    const doc=await document('public/models/parts/spoilers/spoilers.glb')
    for(const part of SPOILERS){const node=doc.getRoot().listNodes().find(n=>n.getName()===part.id)!;expect(node).toBeDefined()
      const bounds=new THREE.Box3();let tris=0
      for(const primitive of node.getMesh()!.listPrimitives()){expect(primitive.getAttribute('TEXCOORD_0')).not.toBeNull();const positions=primitive.getAttribute('POSITION')!,matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix());for(let i=0;i<positions.getCount();i++)bounds.expandByPoint(new THREE.Vector3().fromArray(positions.getElement(i,[])).applyMatrix4(matrix));tris+=(primitive.getIndices()?.getCount()??positions.getCount())/3}
      expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(1,3);expect(bounds.min.y).toBeCloseTo(0,3);expect(tris).toBeLessThan(700);expect(tris).toBeGreaterThan(50)
    }
  })
  it('replaces and restores the real BMW stock wing in both LODs without altering cached geometry',async()=>{
    for(const tier of ['','_low']){const doc=await document(`public/models/cars/bmw/bmw${tier}.glb`),m=model('bmw'),originals:THREE.Mesh[]=[]
      for(const node of doc.getRoot().listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){if(p.getMaterial()?.getName()!=='Mat.3')continue
        const pos=p.getAttribute('POSITION')!,data=new Float32Array(pos.getCount()*3);for(let i=0;i<pos.getCount();i++)data.set(pos.getElement(i,[]),i*3)
        const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(data,3));const idx=p.getIndices();if(idx)geometry.setIndex(Array.from({length:idx.getCount()},(_,i)=>idx.getScalar(i)))
        geometry.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()));const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({name:'livery_paint'}));mesh.userData.garageMaterialNames=['Mat.3'];m.body.add(mesh);originals.push(mesh)
      }
      const source=originals.map(mesh=>mesh.geometry),counts=source.map(g=>g.getIndex()!.count),rig=new CarSpoiler(m,{loadModel:async()=>pack()})
      await rig.apply({...DEFAULT_BUILD,spoiler:'wing-08'})
      const removed=originals.reduce((sum,mesh,i)=>sum+counts[i]-mesh.geometry.getIndex()!.count,0);expect(removed).toBeGreaterThan(100)
      source.forEach((g,i)=>expect(g.getIndex()!.count).toBe(counts[i]))
      await rig.apply(DEFAULT_BUILD);originals.forEach((mesh,i)=>expect(mesh.geometry).toBe(source[i]));rig.dispose()
    }
  })
})
