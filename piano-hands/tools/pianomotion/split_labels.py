"""Labels for the hand split, from the real wrists: for each note in a clip, which wrist was
nearer to its key? Notes less than 6 cm closer to one wrist than the other are left unlabelled.
Writes <data_dir>/labels.json for split_eval.mjs.

    python3 split_labels.py <data_dir> [<video>_<start frame>]   # optional: list one clip's notes
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pmlib import *
root = sys.argv[1]; show = sys.argv[2] if len(sys.argv) > 2 else None
offs = json.load(open(os.path.join(root, 'offsets.json')))
labels = collections.defaultdict(list)
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
nm = lambda p: NAMES[p % 12] + str(p // 12 - 1)
for c in sorted(glob.glob(os.path.join(root, 'data/annotation/*/*/*.json'))):
    d = load_clip(c); bv = d['bv']; lag = offs[bv]['wrist']
    if abs(lag) > 0.99 or d['L']['vis'].mean() < 0.9 or d['R']['vis'].mean() < 0.9: continue
    o = load_ours(os.path.join(root, 'ours', bv + '.json'))
    Zm = np.median(np.concatenate([d['L']['Z'][d['L']['vis']], d['R']['Z'][d['R']['vis']]]))
    u = {k: d[k]['X'] / d[k]['Z'] * Zm for k in 'LR'}
    off = {k: np.mean(sg(ours_at(o, k, 'x', d['t'] + lag))[d[k]['vis']] - u[k][d[k]['vis']]) for k in 'LR'}
    rows = []
    for nt in sorted(o['notes'], key=lambda n: (n['start'], n['pitch'])):
        tv = nt['start'] - lag
        if not (d['t'][0] <= tv <= d['t'][-1]): continue
        i = min(max(int(round((tv - d['t'][0]) * d['fps'])), 0), d['n'] - 1)
        pos = {k: u[k][i] + off[k] for k in 'LR'}
        dist = {k: abs(pos[k] - nt['x']) for k in 'LR'}
        lab = None if abs(dist['L'] - dist['R']) < 0.06 else min(dist, key=dist.get)
        labels[bv].append([round(nt['start'], 3), nt['pitch'], lab])
        rows.append((nt, pos, lab))
    if show and show == f"{bv}_{d['start']}":
        print('time   note  ours real | real wrists L/R (cm) | key x')
        for nt, pos, lab in rows:
            flag = '' if lab is None or lab == nt['hand'] else '  <-- MISMATCH'
            print('%6.2f %-4s %s    %s    | %6.1f %6.1f | %6.1f  dur %.2f%s' % (nt['start'], nm(nt['pitch']), nt['hand'], lab or '?', pos['L'] * 100, pos['R'] * 100, nt['x'] * 100, nt['end'] - nt['start'], flag))
json.dump(labels, open(os.path.join(root, 'labels.json'), 'w'))
tot = sum(1 for v in labels.values() for r in v if r[2]); print('labelled notes:', tot, 'in', len(labels), 'videos')
