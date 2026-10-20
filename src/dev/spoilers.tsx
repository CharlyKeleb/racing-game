import { createRoot } from 'react-dom/client'
import App from '../App'
import { gameStore } from '../stores/gameStore'
import { DEFAULT_BUILD } from '../vehicles/CarBuild'
import { getCar } from '../vehicles/carRegistry'
import '../index.css'
// Isolated inspection setup. Garage edits retain the normal per-car persistence path.
const query=new URLSearchParams(location.search)
const car=getCar(query.get('car')??'porsche911').id
const build=gameStore.getState().builds[car]??DEFAULT_BUILD
gameStore.setState({settings:{...gameStore.getState().settings,car,track:'test-circuit',quality:query.get('quality')==='high'?'high':'low',renderer:query.get('renderer')==='webgpu'?'webgpu':'webgl',postfx:false},build})
createRoot(document.querySelector('#root')!).render(<App/> )
