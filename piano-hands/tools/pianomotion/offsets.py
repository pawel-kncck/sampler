"""Per-video timing offset between pose frames and MIDI, estimated two ways
(whole wrist path, and fast leaps only, where physics bounds how early a hand can leave)."""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pmlib import *
root = sys.argv[1]
vids = collections.defaultdict(list)
for c in sorted(glob.glob(os.path.join(root, 'data/annotation/*/*/*.json'))):
    vids[c.split('/')[-2]].append(c)
lags = np.arange(-1.5, 1.5001, 1 / 30)
out = {}
print('video: offset (s) by which pose frames lead the MIDI/audio timeline, estimated from ...')
print('%-12s %-10s | %-24s | %-24s' % ('video', 'pianist', 'wrist path (all)', 'fast leaps only'))
for bv, cl in vids.items():
    o = load_ours(os.path.join(root, 'ours', bv + '.json'))
    clips = [load_clip(c) for c in cl]
    notes = {k: sorted([n for n in o['notes'] if n['hand'] == k], key=lambda n: n['start']) for k in 'LR'}
    # fast leaps per hand: consecutive chords > 10 cm apart, < 0.35 s between onsets
    leaps = {k: [] for k in 'LR'}
    for k in 'LR':
        groups = []
        for n in notes[k]:
            if groups and n['start'] - groups[-1][0] < 0.035: groups[-1][1].append(n['x'])
            else: groups.append([n['start'], [n['x']]])
        for a, b in zip(groups, groups[1:]):
            if abs(np.mean(b[1]) - np.mean(a[1])) > 0.10 and b[0] - a[0] < 0.35: leaps[k].append((a[0] + b[0]) / 2)
    cw, cl_ = np.zeros(len(lags)), np.zeros(len(lags)); nleap = 0
    for d in clips:
        fps = d['fps']
        for k in 'LR':
            h = d[k]; m = h['vis']
            if m.mean() < 0.9: continue
            Zm = np.median(h['Z'][m]); u = h['X'] / h['Z'] * Zm
            lm = np.zeros(len(u), bool)
            for tl in leaps[k]: lm |= np.abs(d['t'] - tl) < 0.4
            nleap += sum(1 for tl in leaps[k] if d['t'][0] < tl < d['t'][-1])
            for i, lag in enumerate(lags):
                ours = sg(ours_at(o, k, 'x', d['t'] + lag))
                cw[i] += np.corrcoef(u[m], ours[m])[0, 1]
                mm = m & lm
                if mm.sum() > 30 and ours[mm].std() > 1e-4: cl_[i] += np.corrcoef(u[mm], ours[mm])[0, 1] * mm.sum()
    def pk(c):
        if not np.any(c): return 'n/a'
        i = c.argmax(); half = c > c.max() - 0.1 * (c.max() - np.median(c))
        return '%+.2f (peak width %.2f)' % (lags[i], half.sum() / 30)
    out[bv] = {'wrist': float(lags[cw.argmax()]), 'leaps': float(lags[cl_.argmax()]) if nleap >= 4 else None, 'nleap': nleap}
    print('%-12s %-10s | %-24s | %-24s' % (bv, clips[0]['up'], pk(cw), (pk(cl_) + ' n=%d' % nleap) if nleap >= 4 else 'too few (%d)' % nleap))
json.dump(out, open(os.path.join(root, 'offsets.json'), 'w'))
