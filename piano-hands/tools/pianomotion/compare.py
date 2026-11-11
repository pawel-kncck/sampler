"""How well do our planned wrist paths match the real ones? (lateral position along the keyboard)

Cross-validated: each video has two 30 s clips. The video's timing offset and each hand's
position offset are estimated on one clip and applied to the other. The scale is NOT fitted:
the dataset's image-plane units are used as metres.
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pmlib import *
root = sys.argv[1]
vids = collections.defaultdict(list)
for c in sorted(glob.glob(os.path.join(root, 'data/annotation/*/*/*.json'))):
    vids[c.split('/')[-2]].append(c)
LAGS = np.arange(-1.0, 1.0001, 1 / 30)

def real_u(d, k):
    h = d[k]
    Zm = np.median(np.concatenate([d['L']['Z'][d['L']['vis']], d['R']['Z'][d['R']['vis']]]))
    return h['X'] / h['Z'] * Zm

def model(o, name, k, t):
    if name == 'ours': return sg(ours_at(o, k, 'x', t))
    if name == 'centroid': return sg(centroid_track(o, k, t, 0.12))
    if name == 'slow': return sg(centroid_track(o, k, t, 0.5))

def best_lag(o, name, d):
    best = (-9, 0)
    for lag in LAGS:
        r = 0
        for k in 'LR':
            m = d[k]['vis']
            if m.mean() < 0.9: continue
            y = model(o, name, k, d['t'] + lag)
            if y[m].std() > 1e-5: r += np.corrcoef(real_u(d, k)[m], y[m])[0, 1]
        if r > best[0]: best = (r, lag)
    return best[1]

rows = []; examples = []
for bv, cl in vids.items():
    o = load_ours(os.path.join(root, 'ours', bv + '.json'))
    clips = [load_clip(c) for c in cl]
    for name in ('ours', 'centroid', 'slow'):
        lagfit = [best_lag(o, name, d) for d in clips]
        for i, d in enumerate(clips):
            tr = clips[1 - i]; lag = lagfit[1 - i]            # calibrate on the other clip
            for k in 'LR':
                if d[k]['vis'].mean() < 0.9 or tr[k]['vis'].mean() < 0.9: continue
                m, mt = d[k]['vis'], tr[k]['vis']
                off = np.mean(model(o, name, k, tr['t'] + lag)[mt] - real_u(tr, k)[mt])
                u = real_u(d, k) + off                         # real wrist in keyboard metres
                y0, y = model(o, name, k, d['t']), model(o, name, k, d['t'] + lag)
                dt = 1 / d['fps']
                rows.append(dict(bv=bv, up=d['up'], clip=d['start'], hand=k, model=name, lag=lag,
                    r0=np.corrcoef(u[m], y0[m])[0, 1], r=np.corrcoef(u[m], y[m])[0, 1],
                    rmse=np.sqrt(np.mean((u[m] - y[m]) ** 2)), rmse_c=np.sqrt(np.mean((u[m] - u[m].mean() - y[m] + y[m].mean()) ** 2)),
                    sd_real=u[m].std(), sd_model=y[m].std(),
                    travel_real=np.abs(np.diff(u)[m[1:]]).sum() / (m.sum() * dt), travel_model=np.abs(np.diff(y)[m[1:]]).sum() / (m.sum() * dt),
                    slope=np.polyfit(y[m], u[m], 1)[0]))
                if name == 'ours': examples.append((bv, d['start'], k, d['t'].copy(), u.copy(), y.copy(), m.copy(), rows[-1]['r']))
json.dump(rows, open(os.path.join(root, 'results.json'), 'w'))
np.save(os.path.join(root, 'examples.npy'), np.array(examples, dtype=object), allow_pickle=True)

def summ(sel, label):
    R = [r for r in rows if sel(r)]
    if not R: return
    med = lambda f: np.median([r[f] for r in R])
    print('%-34s n=%2d | r %.2f (no lag fix %.2f) | error %4.1f cm, shape-only %4.1f cm | spread: real %4.1f, model %4.1f cm | travel real %4.1f, model %4.1f cm/s | real per 1 cm of model: %.2f'
          % (label, len(R), med('r'), med('r0'), med('rmse') * 100, med('rmse_c') * 100, med('sd_real') * 100, med('sd_model') * 100, med('travel_real') * 100, med('travel_model') * 100, med('slope')))
print('medians over hand-clips (cross-validated)')
for name in ('ours', 'centroid', 'slow'):
    summ(lambda r: r['model'] == name, f'{name}: all')
print()
for hand in 'LR': summ(lambda r: r['model'] == 'ours' and r['hand'] == hand, f'ours: {hand} hand')
for up in sorted(set(r['up'] for r in rows)): summ(lambda r: r['model'] == 'ours' and r['up'] == up, f'ours: pianist {up}')
print()
ours = [r for r in rows if r['model'] == 'ours']
rs = np.array([r['r'] for r in ours])
print('ours: share of hand-clips with r > 0.8: %.0f%%, r > 0.6: %.0f%%, r < 0.3: %.0f%%' % ((rs > 0.8).mean() * 100, (rs > 0.6).mean() * 100, (rs < 0.3).mean() * 100))
cen = {(r['bv'], r['clip'], r['hand']): r for r in rows if r['model'] == 'centroid'}
better = [r['rmse'] < cen[(r['bv'], r['clip'], r['hand'])]['rmse'] for r in ours]
print('ours has lower error than the naive centroid baseline in %d of %d hand-clips' % (sum(better), len(better)))
print('worst:', ', '.join('%s f%d %s r=%.2f' % (r['bv'], r['clip'], r['hand'], r['r']) for r in sorted(ours, key=lambda r: r['r'])[:8]))
