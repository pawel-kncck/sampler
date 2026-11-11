"""Follow-up diagnostics: unit scale, hand rotation (yaw), what-if smoothing, hand-split agreement."""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pmlib import *
root = sys.argv[1]
vids = collections.defaultdict(list)
for c in sorted(glob.glob(os.path.join(root, 'data/annotation/*/*/*.json'))):
    vids[c.split('/')[-2]].append(c)
offs = json.load(open(os.path.join(root, 'offsets.json')))

def rotmat(aa):
    th = np.linalg.norm(aa, axis=1, keepdims=True); k = aa / np.maximum(th, 1e-9)
    K = np.zeros((len(aa), 3, 3)); K[:, 0, 1], K[:, 0, 2], K[:, 1, 0], K[:, 1, 2], K[:, 2, 0], K[:, 2, 1] = -k[:, 2], k[:, 1], k[:, 2], -k[:, 0], -k[:, 1], k[:, 0]
    s, c = np.sin(th)[:, :, None], np.cos(th)[:, :, None]
    return np.eye(3) + s * K + (1 - c) * (K @ K)

def real_u(d, k):
    Zm = np.median(np.concatenate([d['L']['Z'][d['L']['vis']], d['R']['Z'][d['R']['vis']]]))
    return d[k]['X'] / d[k]['Z'] * Zm

def yaw(d, k):
    """angle of the fingers' direction in the image: 0 = straight into the keys, + = towards the high notes"""
    f = rotmat(d[k]['orient'])[:, :, 0] * -1.0          # MANO template: fingers point along -x
    fx = f[:, 0] * (1 if k == 'R' else -1)
    return np.arctan2(fx, -f[:, 1]), f

# 1. unit scale from the distance between the two wrists (clip means): static, independent of how much the hand "follows"
D = []
fwd = []; yawstats = []; rel = []
whatif = collections.defaultdict(list)
split = []
for bv, cl in vids.items():
    o = load_ours(os.path.join(root, 'ours', bv + '.json'))
    lag = offs[bv]['wrist']
    if abs(lag) > 0.99: continue
    for c in cl:
        d = load_clip(c)
        ok = d['L']['vis'].mean() > 0.9 and d['R']['vis'].mean() > 0.9
        if ok:
            m = d['L']['vis'] & d['R']['vis']
            D.append((np.mean(real_u(d, 'R')[m] - real_u(d, 'L')[m]), np.mean(sg(ours_at(o, 'R', 'x', d['t'] + lag))[m] - sg(ours_at(o, 'L', 'x', d['t'] + lag))[m]), d['up']))
        for k in 'LR':
            m = d[k]['vis']
            if m.mean() < 0.9: continue
            u = real_u(d, k); y = sg(ours_at(o, k, 'x', d['t'] + lag))
            a, f = yaw(d, k)
            fwd.append(np.r_[f[m].mean(0), (1 if k == 'R' else 0)])
            oy = -(1 if k == 'R' else -1) * sg(ours_at(o, k, 'yaw', d['t'] + lag))
            sl = np.polyfit(u[m] - u[m].mean(), np.degrees(a[m]), 1)[0] / 10  # deg per 10 cm... (u in m → per m /10 = per 10 cm)
            yawstats.append((np.degrees(a[m]).mean(), np.degrees(a[m]).std(), np.degrees(oy[m]).std(), sl, np.corrcoef(u[m], a[m])[0, 1], k))
            # does a point ahead of the wrist (knuckles, ~9 cm) track our wrist better than the real wrist does?
            kn = u + 0.09 * np.sin(a)
            rel.append((np.corrcoef(u[m], y[m])[0, 1], np.corrcoef(kn[m], y[m])[0, 1], u[m].std(), kn[m].std(), y[m].std()))
            # what-if: calmer versions of our path
            c0 = lambda z: z[m] - z[m].mean()
            for name, z in [('ours', y)] + [('ours smoothed %.1fs' % s, gaussian_filter1d(y, s * d['fps'])) for s in (0.15, 0.3, 0.5)] + \
                           [('ours, fast part x%.1f' % g, gaussian_filter1d(y, 1.0 * d['fps']) + g * (y - gaussian_filter1d(y, 1.0 * d['fps']))) for g in (0.7, 0.5)]:
                whatif[name].append((np.sqrt(np.mean((c0(u) - c0(z)) ** 2)), np.corrcoef(u[m], z[m])[0, 1], z[m].std()))
        # hand split: which real wrist is closer to each note? (needs both hands; offsets from this clip)
        if ok:
            offk = {k: np.mean(sg(ours_at(o, k, 'x', d['t'] + lag))[d[k]['vis']] - real_u(d, k)[d[k]['vis']]) for k in 'LR'}
            agree = n = 0
            for nt in o['notes']:
                tv = nt['start'] - lag
                if not (d['t'][0] <= tv <= d['t'][-1]): continue
                i = int(round((tv - d['t'][0]) * d['fps'])); i = min(max(i, 0), d['n'] - 1)
                dist = {k: abs(real_u(d, k)[i] + offk[k] - nt['x']) for k in 'LR'}
                if abs(dist['L'] - dist['R']) < 0.06: continue   # ambiguous: between the hands
                n += 1; agree += (min(dist, key=dist.get) == nt['hand'])
            if n > 20: split.append((bv, d['start'], agree / n, n))

D = np.array([(a, b) for a, b, _ in D])
A = np.c_[D[:, 0], np.ones(len(D))]
(sc, ic), *_ = np.linalg.lstsq(A, D[:, 1], rcond=None)
print('1. units: distance between wrists, ours = %.2f x real %+.1f cm (r=%.2f over %d clips); mean real %.1f cm, ours %.1f cm'
      % (sc, ic * 100, np.corrcoef(D[:, 0], D[:, 1])[0, 1], len(D), D[:, 0].mean() * 100, D[:, 1].mean() * 100))
fwd = np.array(fwd)
print('2. finger direction in camera axes (x right, y down, z away), mean: R', fwd[fwd[:, 3] == 1][:, :3].mean(0).round(2), 'L (mirrored frame)', fwd[fwd[:, 3] == 0][:, :3].mean(0).round(2))
ys = np.array([s[:5] for s in yawstats]); hk = np.array([s[5] for s in yawstats])
for k in 'LR':
    s = ys[hk == k]
    print('   %s hand yaw: mean %+.0f deg; swing within a clip (sd) real %.1f deg vs ours %.1f deg; real yaw changes %+.1f deg per 10 cm of wrist travel (corr %.2f)'
          % (k, np.median(s[:, 0]), np.median(s[:, 1]), np.median(s[:, 2]), np.median(s[:, 3]), np.median(s[:, 4])))
rel = np.array(rel)
print('3. our wrist vs real wrist: r %.2f; vs real knuckles (wrist + 9 cm along the fingers): r %.2f; spread: real wrist %.1f, real knuckles %.1f, our wrist %.1f cm'
      % (np.median(rel[:, 0]), np.median(rel[:, 1]), np.median(rel[:, 2]) * 100, np.median(rel[:, 3]) * 100, np.median(rel[:, 4]) * 100))
print('4. what-if (median shape error cm, r, spread cm):')
for name, v in whatif.items():
    v = np.array(v); print('   %-26s error %.1f  r %.2f  spread %.1f' % (name, np.median(v[:, 0]) * 100, np.median(v[:, 1]), np.median(v[:, 2]) * 100))
sp = np.array([s[2] for s in split])
print('5. hand split: our split agrees with "nearest real wrist" for %.0f%% of clear-cut notes (median clip); worst clips: %s'
      % (np.median(sp) * 100, ', '.join('%s f%d %.0f%%' % (s[0], s[1], s[2] * 100) for s in sorted(split, key=lambda s: s[2])[:6])))
json.dump({'split': split}, open(os.path.join(root, 'diag.json'), 'w'))
