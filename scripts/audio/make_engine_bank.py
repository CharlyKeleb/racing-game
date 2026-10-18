"""Cut steady segments of engine recordings into a grain bank for GranularEngine.

usage: python3 scripts/audio/make_engine_bank.py <car spec .json> <recordings dir> <out dir>
  e.g. python3 scripts/audio/make_engine_bank.py scripts/audio/porsche911.json ~/recordings public/audio/porsche911

The spec (scripts/audio/<car>.json) gives the engine's firing pulses per rev
(flat-six 3, V8 4) and the segments: [name, file, start s, end s, expected rpm].
Pick stretches where the rpm is nearly steady; the expected rpm stops the pitch
tracker locking an octave off. <recordings dir> holds those files as 16-bit
mono WAV (macOS: afconvert -f WAVE -d LEI16@44100 -c 1 in.mp3 out.wav).
Writes engine-bank.wav + engine-bank.json: each layer is a level-matched
segment with a pitch mark on every firing pulse. Needs numpy.
"""
import json
import sys
import wave

import numpy as np

TARGET_RMS = 10 ** (-16 / 20)
PAD = 2048


def load(path):
    w = wave.open(path)
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x, w.getframerate()


def firing_freq(seg, sr, lo, hi):
    """Autocorrelation pitch within [lo, hi] Hz."""
    seg = seg - seg.mean()
    n = len(seg)
    f = np.fft.rfft(seg * np.hanning(n), 2 * n)
    ac = np.fft.irfft(np.abs(f) ** 2)[:n]
    a, b = int(sr / hi), int(sr / lo)
    return sr / (a + np.argmax(ac[a:b]))


def pitch_marks(seg, sr, freq):
    """One mark per firing pulse: the low-passed peak, tracked period by period."""
    period = sr / freq
    k = max(3, int(period / 3))
    lp = np.convolve(seg, np.hanning(k) / np.hanning(k).sum(), mode='same')
    m = int(np.argmax(lp[: int(period)]))
    marks = [m]
    while True:
        lo, hi = int(m + 0.8 * period), int(m + 1.2 * period)
        if hi + int(period) >= len(seg):
            return np.array(marks)
        n = lo + int(np.argmax(lp[lo:hi]))
        period = 0.85 * period + 0.15 * (n - m)
        marks.append(n)
        m = n


def main(spec_path, src, out):
    with open(spec_path) as f:
        spec = json.load(f)
    firing = spec['firingPerRev']
    bank, layers, cursor, sr = [], [], 0, 44100
    for name, fn, a, b, guess in spec['segments']:
        x, sr = load(f'{src}/{fn}')
        seg = x[int(a * sr): int(b * sr)].copy()
        seg -= seg.mean()
        g = guess * firing / 60
        marks = pitch_marks(seg, sr, firing_freq(seg[: int(0.2 * sr)], sr, g * 0.8, g * 1.25))
        rpm = sr / np.median(np.diff(marks)) * 60 / firing
        seg = np.clip(seg * TARGET_RMS / np.sqrt((seg ** 2).mean()), -1, 1)
        layers.append({'name': name, 'rpm': round(float(rpm)), 'start': cursor, 'length': len(seg),
                       'marks': [int(v) for v in marks]})
        print(f'{name}: {b - a:.2f}s, {rpm:.0f} rpm, {len(marks)} marks')
        bank += [seg, np.zeros(PAD, np.float32)]
        cursor += len(seg) + PAD
    pcm = (np.concatenate(bank) * 32767).astype('<i2')
    with wave.open(f'{out}/engine-bank.wav', 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    with open(f'{out}/engine-bank.json', 'w') as f:
        json.dump({'sampleRate': sr, 'firingPerRev': firing, 'layers': layers}, f)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
