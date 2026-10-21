import camillePortrait from '../assets/narrators/profiles/camille.png'
import alexPortrait from '../assets/narrators/profiles/alex.png'

/** Recording IDs are filenames; each commentator has their own wording. */
export const NARRATION = {
  introduction: 'Hey, I’m Alex Carter. I’ll be with you from the first green light to the finish line. First time here? Take a breath. We’ll get you up to speed. All right... let’s go racing!',
  raceComplete: 'That’s the finish. Well driven!',
  welcome: 'Welcome to the grid. Find your rhythm. Make every corner count.',
  countdown: 'Eyes on the lights. Get ready.',
  start: 'Go! Settle in and pick your moment.',
  overtake: 'Nice move. Keep it clean.',
  lead: 'You’re in the lead. Keep your focus.',
  lostLead: 'They’ve taken the lead. Stay close.',
  finalLap: 'Final lap. Make it count.',
  finish: 'That was close. A photo finish!',
  quickTip: 'Brake before the corner, then ease onto the power as you exit.',
  timeTrial: 'It’s you against the clock. Pass every checkpoint and build a clean lap.',
  drift: 'Build speed, then tap the brake as you turn. Link your slides and bank your points.',
  freeRoam: 'The road is yours. Explore at your own pace.',
} as const
export type NarrationId = keyof typeof NARRATION
export type NarratorVoice = 'camille' | 'alex'
export type Narrator = 'off' | 'duo' | NarratorVoice
export const NARRATOR_PORTRAITS: Record<NarratorVoice, string> = { alex: alexPortrait, camille: camillePortrait }
export const NARRATOR_NAMES = { camille: 'Camille Laurent', alex: 'Alex Carter' } as const
const clips = import.meta.glob<string>('../assets/narrators/*/*.mp3', { eager: true, query: '?url', import: 'default' })
export function narrationClip(narrator: Narrator, id: NarrationId): string | undefined {
  return clips[`../assets/narrators/${narrator}/${id}.mp3`]
}
/** Approximate character reveal; audio playback is the clock when a clip is available. */
export function revealedCharacters(text: string, progress: number): number {
  return Math.min(text.length, Math.max(0, Math.ceil(text.length * progress)))
}

export const CAMILLE_NARRATION: Record<NarrationId, string> = {
  introduction: 'Hello, I’m Camille Laurent. You handle the wheel. I’ll keep an eye on the race. New to this? No pressure. We’ll take it one corner at a time. Right then... shall we?',
  welcome: 'Here we are. On the grid. Find your flow, and give them something to chase.',
  countdown: 'Watch those lights... Any second now.',
  start: 'Away we go! Find some space and build your pace.',
  overtake: 'Beautifully done! That’s another place yours.',
  lead: 'You’re out in front! Keep it tidy from here.',
  lostLead: 'Someone’s slipped past. You’re still in this. Stay on them.',
  finalLap: 'One lap to go. Leave nothing on the table.',
  finish: 'Oh, that was incredibly tight! We’ll need the photo for that one.',
  quickTip: 'Get your braking done before you turn in, then feed the power back in as the road opens up.',
  timeTrial: 'Just you, the circuit, and the stopwatch. Hit every checkpoint. Let’s put a clean lap together.',
  drift: 'Carry some speed, turn in, and give the brake a quick tap. Hold that slide... link the next one, then bank it.',
  freeRoam: 'No clock to chase here. Pick a road and see where it takes you.',
  raceComplete: 'Across the line! Nicely done. Take a breath—you’ve earned it.',
}

export function narrationText(narrator: NarratorVoice, id: NarrationId): string {
  return narrator === 'camille' ? CAMILLE_NARRATION[id] : NARRATION[id]
}
