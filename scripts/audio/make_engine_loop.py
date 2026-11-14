"""Cut one steady stretch of an engine recording into a seamless loop.

usage: python3 scripts/audio/make_engine_loop.py <car spec .json> <recordings dir> <out dir>
  e.g. python3 scripts/audio/make_engine_loop.py scripts/audio/r33.json ~/recordings public/audio/r33

The spec gives firingPerRev and "loop": [file, start s, end s, expected rpm]. Writes
engine-bank.wav (the loop: its last `XFADE` seconds crossfaded into its head, so it repeats
without a click) and engine-bank.json with "loop": {"rpm"} and one ordinary layer, so rival
cars can still play it through GranularEngine. The player's car plays the loop as recorded,
its speed following the rpm (AudioManager). Needs numpy.
"""
import json
import sys
import wave

import numpy as np

from make_engine_bank import TARGET_RMS, firing_freq, load, pitch_marks

XFADE = 0.06


def main(spec_path, src, out):
    with open(spec_path) as f:
        spec = json.load(f)
    firing = spec['firingPerRev']
    fn, a, b, guess = spec['loop']
    x, sr = load(f'{src}/{fn}')
    seg = x[int(a * sr): int(b * sr)].copy()
    seg -= seg.mean()
    g = guess * firing / 60
    marks = pitch_marks(seg, sr, firing_freq(seg[: int(0.2 * sr)], sr, g * 0.8, g * 1.25))
    rpm = sr / np.median(np.diff(marks)) * 60 / firing
    # Loop length ends on a firing pulse, so the seam falls where the next pulse would.
    x_n = int(XFADE * sr)
    usable = [m for m in marks if m + x_n < len(seg)]
    length = int(usable[-1] - usable[0])
    head = seg[usable[0]: usable[0] + length + x_n].copy()
    fade = np.linspace(0, 1, x_n, dtype=np.float32)
    loop = head[:length].copy()
    loop[:x_n] = head[:x_n] * fade + head[length:length + x_n] * (1 - fade)
    loop = np.clip(loop * TARGET_RMS / np.sqrt((loop ** 2).mean()), -1, 1)
    loop_marks = [int(m - usable[0]) for m in marks if usable[0] <= m < usable[0] + length]
    pcm = (loop * 32767).astype('<i2')
    with wave.open(f'{out}/engine-bank.wav', 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    with open(f'{out}/engine-bank.json', 'w') as f:
        json.dump({'sampleRate': sr, 'firingPerRev': firing, 'loop': {'rpm': round(float(rpm))},
                   'layers': [{'name': 'loop', 'rpm': round(float(rpm)), 'start': 0, 'length': length, 'marks': loop_marks}]}, f)
    print(f'loop: {length / sr:.3f}s at {rpm:.0f} rpm, {len(loop_marks)} marks')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
