"""Offset between each clip's audio and the video's MIDI file (onset cross-correlation)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pmlib import *
import soundfile as sf
root = sys.argv[1]
res = {}
for c in sorted(glob.glob(os.path.join(root, 'data/annotation/*/*/*.json'))):
    d = json.load(open(c)); bv, up, fps, f0 = d['bv'], d['up'], d['fps'], d['start_frame']
    o = json.load(open(os.path.join(root, 'ours', bv + '.json')))
    y, sr = sf.read(c.replace('/annotation/', '/audio/').replace('.json', '.mp3'))
    hop, win = 160, 512
    n = 1 + (len(y) - win) // hop
    fr = np.lib.stride_tricks.sliding_window_view(y, win)[::hop][:n] * np.hanning(win)
    S = np.log1p(50 * np.abs(np.fft.rfft(fr, axis=1)))
    flux = np.maximum(0, np.diff(S, axis=0)).sum(1)
    flux = np.concatenate([[0], flux]); flux -= uniform_filter1d(flux, 50)
    env_t = (np.arange(n) * hop + win / 2) / sr  # seconds within the clip
    t0 = f0 / fps
    starts = np.array([nt['start'] for nt in o['notes']])
    best = (-9, 0); curve = []
    for delta in np.arange(-2, 2.0001, 0.01):
        tr = np.zeros(n)
        idx = np.round((starts - delta - t0 - win / 2 / sr) * sr / hop).astype(int)
        idx = idx[(idx >= 0) & (idx < n)]
        np.add.at(tr, idx, 1.0)
        tr = gaussian_filter1d(tr, 2.0)
        r = np.corrcoef(tr, flux)[0, 1] if tr.std() > 0 else -9
        curve.append(r)
        if r > best[0]: best = (r, delta)
    curve = np.array(curve)
    second = np.sort(curve)[-40]  # sharpness: peak vs. 40th best value
    res[f'{bv}_{f0}'] = {'delta': round(float(best[1]), 3), 'r': round(float(best[0]), 3)}
    print(f"{up:>10} {bv} f{f0:<5} fps {fps}  MIDI later than audio by {best[1]:+.2f} s  (onset corr {best[0]:.2f}, background {second:.2f})")
json.dump(res, open(os.path.join(root, 'sync.json'), 'w'))
