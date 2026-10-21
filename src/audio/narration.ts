import camillePortrait from '../assets/narrators/profiles/camille.png'
import alexPortrait from '../assets/narrators/profiles/alex.png'

/** Recording IDs are filenames; each commentator has their own wording. */
export const NARRATION = {
  focus: 'Keep your focus.',
  rhythm: 'Settle in and pick your moment.',
  driftFlow: 'Link your slides and bank your points.',
  driftSetup: 'Build speed, then tap the brake as you turn.',
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
export function narrationClip(narrator: Narrator, id: NarrationId, variant = 0): string | undefined {
  return clips[`../assets/narrators/${narrator}/${id}${variant === -1 ? '-exchange' : variant ? `-v${variant}` : ''}.mp3`]
}
/** Approximate character reveal; audio playback is the clock when a clip is available. */
export function revealedCharacters(text: string, progress: number): number {
  return Math.min(text.length, Math.max(0, Math.ceil(text.length * progress)))
}

export const CAMILLE_NARRATION: Record<NarrationId, string> = {
  focus: 'Keep it tidy from here.',
  rhythm: 'Find some space and build your pace.',
  driftFlow: 'Hold that slide... link the next one, then bank it.',
  driftSetup: 'Carry some speed, turn in, and give the brake a quick tap.',
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

export function narrationText(narrator: NarratorVoice, id: NarrationId, variant = 0): string {
  if (variant === -1) return COMMENTARY_EXCHANGES[id]?.[narrator] ?? narrationText(narrator, id)
  if (variant) return NARRATION_VARIATIONS[narrator][id]?.[variant - 1] ?? narrationText(narrator, id)
  return narrator === 'camille' ? CAMILLE_NARRATION[id] : NARRATION[id]
}

/** New takes activate only when their MP3 exists; never caption unheard wording. */
export const NARRATION_VARIATIONS: Record<NarratorVoice, Partial<Record<NarrationId, readonly string[]>>> = {
  alex: {
    overtake: ['Clean pass! Now build a gap.', 'You made that one stick. Keep pushing.'],
    lead: ['First place is yours. Set the pace.', 'You’ve got the lead. Make them chase you.'],
    lostLead: ['You’ve lost the lead. Look for your chance.', 'Lead’s changed hands. There’s still a race to run.'],
    finalLap: ['Last time around. Bring it home.', 'One more lap. Stay sharp all the way to the line.'],
    finish: ['Nothing between you at the line! That’s a photo finish.', 'Wow! That one’s too close to call.'],
    raceComplete: ['You’re across the line. That’s your race done.', 'And that’s the flag! Take a breather.'],
  },
  camille: {
    overtake: ['Lovely bit of racing. On to the next one.', 'There’s your opening... and through you go!'],
    lead: ['Clear road ahead. This is your race to control.', 'Nobody in front now. Find that rhythm.'],
    lostLead: ['They’ve found a way through. Keep them within reach.', 'You’ve got company up front again. Be patient.'],
    finalLap: ['Just one lap left. Keep those corners tidy.', 'This is the last one. Let’s finish it properly.'],
    finish: ['You couldn’t get much closer than that! We’ll need another look.', 'Together at the line! That was quite a finish.'],
    raceComplete: ['There we are. Chequered flag. You can breathe again.', 'Run complete. A moment to catch your breath.'],
  },
}

export function availableNarrationVariants(voice: NarratorVoice, id: NarrationId): number[] {
  const count = NARRATION_VARIATIONS[voice][id]?.length ?? 0
  return Array.from({ length: count + 1 }, (_, variant) => variant).filter(variant => !!narrationClip(voice, id, variant))
}

/** Turns cut from joint recordings; -1 distinguishes exchanges from solo takes. */
export const COMMENTARY_EXCHANGES: Partial<Record<NarrationId, Record<NarratorVoice, string>>> = {
  overtake: { alex: 'That’s one way through!', camille: 'Lovely timing. Now keep it tidy.' },
  lead: { alex: 'Clear road ahead!', camille: 'For now. Keep an eye on those mirrors.' },
  raceComplete: { alex: 'And that’s the flag!', camille: 'Race done. Time to catch your breath.' },
}
export function hasCommentaryExchange(id: NarrationId): boolean {
  return !!COMMENTARY_EXCHANGES[id] && !!narrationClip('alex', id, -1) && !!narrationClip('camille', id, -1)
}
