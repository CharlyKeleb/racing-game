#!/usr/bin/env python3
"""
Clean the noise out of an engine bank (public/audio/<car>/engine-bank.wav), in place.

An engine repeats itself every firing cycle; wind, hiss, the recorder's noise and MP3
artefacts don't. So each cycle of each layer (cut at the bank's pitch marks) is blended with
the average of its neighbours, time-aligned to its own length: what the cycles share (the
engine) stays, what differs between them (the noise) falls by up to ~7 dB. Layers whose energy
is mostly above 5 kHz (hiss, not exhaust) are also low-passed. Cycle lengths and marks don't
move, so the bank's JSON stays valid.

    python3 scripts/audio/denoise_engine_bank.py r33 [--keep 0.25] [--reach 3]

Prints each layer's engine-over-noise ratio (HNR) and share above 5 kHz before and after.
Needs numpy.
"""
import argparse, json, wave
import numpy as np


def hnr_and_hf(seg, marks, sr):
    per = int(np.median(np.diff(marks)))
    cyc = np.array([seg[a:a + per] for a in marks[:-1] if a + per <= len(seg)])
    mean = cyc.mean(0)
    hnr = 10 * np.log10((mean ** 2).sum() * len(cyc) / (((cyc - mean) ** 2).sum() + 1e-12))
    sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / sr)
    return hnr, 10 * np.log10(sp[f > 5000].sum() / (sp.sum() + 1e-20) + 1e-12)


def stretch(cycle, n):
    """Resample one cycle to n samples (linear)."""
    return np.interp(np.linspace(0, len(cycle) - 1, n), np.arange(len(cycle)), cycle)


def lowpass(x, sr, hz):
    """Zero-phase FFT low-pass with a soft 1 kHz roll-off."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / sr)
    X *= np.clip((hz + 1000 - f) / 1000, 0, 1)
    return np.fft.irfft(X, len(x))


def clean_layer(seg, marks, keep, reach):
    out = seg.copy()
    cycles = [(marks[i], marks[i + 1]) for i in range(len(marks) - 1)]
    for i, (a, b) in enumerate(cycles):
        n = b - a
        neigh = [stretch(seg[c:d], n) for c, d in cycles[max(0, i - reach):i + reach + 1]]
        avg = np.mean(neigh, axis=0)
        out[a:b] = keep * seg[a:b] + (1 - keep) * avg
    # Short crossfades at the cycle joins so the averaged cycles meet without a step.
    for a in marks[1:-1]:
        if 8 <= a < len(out) - 8:
            w = np.linspace(0, 1, 16)
            out[a - 8:a + 8] = out[a - 8:a + 8] * (1 - 0.5 * np.sin(np.pi * w)) + seg[a - 8:a + 8] * 0.5 * np.sin(np.pi * w) * keep
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('car')
    ap.add_argument('--keep', type=float, default=0.25, help='share of each original cycle kept (texture)')
    ap.add_argument('--reach', type=int, default=3, help='neighbouring cycles averaged each side')
    ap.add_argument('--hiss-db', type=float, default=-15, help='low-pass layers with more than this above 5 kHz')
    ap.add_argument('--hiss-hz', type=float, default=5500)
    args = ap.parse_args()
    base = f'public/audio/{args.car}/engine-bank'
    bank = json.load(open(base + '.json'))
    with wave.open(base + '.wav') as w:
        sr, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        assert ch == 1 and width == 2, 'expects 16-bit mono'
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    y = x.copy()
    for layer in bank['layers']:
        s, n = layer['start'], layer['length']
        marks = np.array(layer['marks'], dtype=int)
        seg = x[s:s + n]
        before = hnr_and_hf(seg, marks, sr)
        out = clean_layer(seg, marks, args.keep, args.reach)
        if before[1] > args.hiss_db:
            out = lowpass(out, sr, args.hiss_hz)
        # Keep the layer's loudness (banks are levelled per layer, and crossfades rely on it):
        # a layer that was mostly hiss comes back up as engine.
        out *= np.sqrt((seg ** 2).mean() / ((out ** 2).mean() + 1e-20))
        y[s:s + n] = out
        after = hnr_and_hf(out, marks, sr)
        print(f"{layer['name']:>6} {layer['rpm']:5.0f} rpm  HNR {before[0]:5.1f} -> {after[0]:5.1f} dB   >5k {before[1]:6.1f} -> {after[1]:6.1f} dB")
    peak = np.abs(y).max()
    if peak > 0.999:
        y *= 0.999 / peak
    with wave.open(base + '.wav', 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes())


if __name__ == '__main__':
    main()
