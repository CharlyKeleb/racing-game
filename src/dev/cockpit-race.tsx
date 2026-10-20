import { createRoot } from 'react-dom/client'
import App from '../App'
import { gameStore } from '../stores/gameStore'
import { getCar } from '../vehicles/carRegistry'
import '../index.css'

// Ephemeral race setup; never overwrite the user's saved car/view selection.
const car = getCar(new URLSearchParams(location.search).get('car') ?? 'porsche911').id
gameStore.setState({settings:{...gameStore.getState().settings,car,camera:'cockpit',mode:'quick',track:'test-circuit',laps:1,opponents:1,timeOfDay:'noon',weather:'dry'}})
createRoot(document.querySelector('#root')!).render(<App />)
