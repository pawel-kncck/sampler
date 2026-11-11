"""Calibration targets from the real data, next to the same measurements of our planner:
how much the wrist follows the notes at slow / fast time scales (split with a 0.5 s and a
1 s Gaussian), peak wrist speed, and what drives the hand's rotation.

    python3 calibrate.py <data_dir>
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pmlib import *
root = sys.argv[1]; oursdir = 'ours'
offs = json.load(open(os.path.join(root, 'offsets.json')))

def rotmat(aa):
    th = np.linalg.norm(aa, axis=1, keepdims=True); k = aa / np.maximum(th, 1e-9)
    K = np.zeros((len(aa), 3, 3)); K[:, 0, 1], K[:, 0, 2], K[:, 1, 0], K[:, 1, 2], K[:, 2, 0], K[:, 2, 1] = -k[:, 2], k[:, 1], k[:, 2], -k[:, 0], -k[:, 1], k[:, 0]
    s, c = np.sin(th)[:, :, None], np.cos(th)[:, :, None]
    return np.eye(3) + s * K + (1 - c) * (K @ K)

def slope(x, y):
    x = x - x.mean(); y = y - y.mean()
    return float((x * y).sum() / max((x * x).sum(), 1e-12))

acc = collections.defaultdict(list)
for c in sorted(glob.glob(os.path.join(root, 'data/annotation/*/*/*.json'))):
    d = load_clip(c); bv = d['bv']
    if abs(offs[bv]['wrist']) > 0.99: continue
    o = load_ours(os.path.join(root, oursdir, bv + '.json')); lag = offs[bv]['wrist']
    fps = d['fps']
    Zm = np.median(np.concatenate([d['L']['Z'][d['L']['vis']], d['R']['Z'][d['R']['vis']]]))
    for k in 'LR':
        h = d[k]; m = h['vis']
        if m.mean() < 0.98: continue
        u = h['X'] / h['Z'] * Zm
        cn = sg(centroid_track(o, k, d['t'] + lag, 0.05))
        y = sg(ours_at(o, k, 'x', d['t'] + lag))
        f = rotmat(h['orient'])[:, :, 0] * -1.0
        th = np.arctan2(f[:, 0] * (1 if k == 'R' else -1), -f[:, 1])
        oth = -(1 if k == 'R' else -1) * sg(ours_at(o, k, 'yaw', d['t'] + lag))
        for sig in (0.5, 1.0):
            lp = lambda z: gaussian_filter1d(z, sig * fps)
            us, cs, ys = lp(u), lp(cn), lp(y)
            uf, cf, yf = u - us, cn - cs, y - ys
            acc[f'gain slow real s{sig}'].append(slope(cs, us)); acc[f'gain fast real s{sig}'].append(slope(cf, uf))
            acc[f'gain slow ours s{sig}'].append(slope(cs, ys)); acc[f'gain fast ours s{sig}'].append(slope(cf, yf))
            acc[f'sd fast real s{sig} cm'].append(uf.std() * 100); acc[f'sd fast ours s{sig} cm'].append(yf.std() * 100); acc[f'sd fast notes s{sig} cm'].append(cf.std() * 100)
            acc[f'sd slow real s{sig} cm'].append(us.std() * 100); acc[f'sd slow ours s{sig} cm'].append(ys.std() * 100); acc[f'sd slow notes s{sig} cm'].append(cs.std() * 100)
        # yaw model: theta = k_slow * wrist_slow + lam * (notes - wrist)   [reach offset]
        lp = lambda z: gaussian_filter1d(z, 0.5 * fps)
        dreach = (cn - cn.mean()) - (u - u.mean())
        A = np.c_[lp(u) - lp(u).mean(), dreach - dreach.mean()]
        coef, *_ = np.linalg.lstsq(A, th - th.mean(), rcond=None)
        pred = A @ coef
        acc[f'yaw {k}: per m of slow wrist travel (rad/m)'].append(coef[0]); acc[f'yaw {k}: per m of reach offset (rad/m)'].append(coef[1])
        acc[f'yaw {k}: R2 of this model'].append(1 - ((th - th.mean() - pred) ** 2).sum() / ((th - th.mean()) ** 2).sum())
        acc[f'yaw {k}: sd real deg'].append(np.degrees(th.std())); acc[f'yaw {k}: sd ours deg'].append(np.degrees(oth.std()))
        acc[f'yaw {k}: corr real vs ours'].append(np.corrcoef(th, oth)[0, 1] if oth.std() > 1e-6 else 0)
        acc[f'yaw {k}: fast sd real deg'].append(np.degrees((th - lp(th)).std()))
        acc['wrist speed p95 real cm/s'].append(np.percentile(np.abs(np.diff(u)) * fps, 95) * 100); acc['wrist speed p95 ours cm/s'].append(np.percentile(np.abs(np.diff(y)) * fps, 95) * 100)
for k in acc:
    v = np.array(acc[k]); print('%-52s median %+7.2f   IQR [%+.2f, %+.2f]  n=%d' % (k, np.median(v), np.percentile(v, 25), np.percentile(v, 75), len(v)))
