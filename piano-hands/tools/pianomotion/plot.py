import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pmlib import *
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root, out = sys.argv[1], sys.argv[2]
ex = list(np.load(os.path.join(root, 'examples.npy'), allow_pickle=True))
ex = [e for e in ex if e[6].mean() > 0.98 and e[7] > 0]
ex.sort(key=lambda e: e[7])
picks = [('Close match', ex[-2]), ('Typical', ex[len(ex) // 2]), ('Poor match', ex[len(ex) // 10])]
REAL, OURS, INK, MUTED, GRID, SURF = '#2a78d6', '#eb6834', '#0b0b0b', '#52514e', '#e6e5e1', '#fcfcfb'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.edgecolor': GRID, 'axes.labelcolor': MUTED,
                     'xtick.color': MUTED, 'ytick.color': MUTED, 'text.color': INK})
fig, axes = plt.subplots(3, 1, figsize=(10, 8.6), dpi=130, sharex=False)
fig.patch.set_facecolor(SURF)
for ax, (label, (bv, start, k, t, u, y, m, r)) in zip(axes, picks):
    ax.set_facecolor(SURF)
    tt = t - t[0]
    uu = np.where(m, u, np.nan) * 100; yy = y * 100
    ax.plot(tt, uu, color=REAL, lw=2, solid_capstyle='round', solid_joinstyle='round', label='Real pianist (PianoMotion10M)')
    ax.plot(tt, yy, color=OURS, lw=2, solid_capstyle='round', solid_joinstyle='round', label='Our planner')
    ax.grid(axis='y', color=GRID, lw=1); ax.set_axisbelow(True)
    for s in ('top', 'right', 'left'): ax.spines[s].set_visible(False)
    ax.tick_params(length=0)
    ax.set_xlim(0, 30)
    hand = 'right' if k == 'R' else 'left'
    ax.set_title(f'{label}: {hand} hand, correlation {r:.2f}', loc='left', fontsize=11.5, color=INK, pad=8)
    ax.set_ylabel('cm from keyboard middle')
    # direct labels at the line ends
    er, eo = uu[~np.isnan(uu)][-1], yy[-1]
    lo, hi = ax.get_ylim(); close = abs(er - eo) < 0.07 * (hi - lo)
    nudge = (6 if er >= eo else -6) if close else 0
    ax.annotate('real', (30, er), xytext=(6, nudge), textcoords='offset points', va='center', color=MUTED, fontsize=9, annotation_clip=False)
    ax.annotate('ours', (30, eo), xytext=(6, -nudge), textcoords='offset points', va='center', color=MUTED, fontsize=9, annotation_clip=False)
axes[-1].set_xlabel('seconds')
h, l = axes[0].get_legend_handles_labels()
fig.legend(h, l, loc='upper right', bbox_to_anchor=(0.985, 0.955), ncol=2, frameon=False, fontsize=10)
fig.suptitle('Wrist position along the keyboard: real pianists vs. our planner', x=0.065, y=0.985, ha='left', fontsize=14, color=INK)
fig.text(0.065, 0.945, '30-second clips; the higher the line, the further right the wrist', ha='left', color=MUTED, fontsize=10)
fig.tight_layout(rect=(0, 0, 0.97, 0.93), h_pad=2.2)
fig.savefig(out, facecolor=SURF)
print([(p[0], p[1][0], p[1][1], p[1][2], round(float(p[1][7]), 2)) for p in picks])
