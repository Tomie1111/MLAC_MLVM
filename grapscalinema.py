"""
Fig 16 — EMA Prediction Error vs Actual VM Load
100% data-driven — reads ema_pred_error.csv, derives everything from it.
No hardcoded burst windows, no hardcoded error values, no mock data.

Usage:
    python3 plot_ema.py                  # reads ema_pred_error.csv in same folder
    python3 plot_ema.py my_output.csv    # custom path
"""

import sys
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

# ── Load CSV ──────────────────────────────────────────────────
csv_path = sys.argv[1] if len(sys.argv) > 1 else 'ema_pred_error.csv'
df = pd.read_csv(csv_path)
print(f"Loaded   : {len(df)} rows from {csv_path}")
print(f"Columns  : {list(df.columns)}")
print(f"Time     : {df['time_s'].min():.1f}s → {df['time_s'].max():.1f}s")
print(f"Phases   : {df['phase'].unique()}")

t     = df['time_s']
load  = df['actual_load']
pred  = df['predicted_load']
err   = df['pred_error']
phase = df['phase']

# ── Derive burst windows from phase column (no hardcoding) ────
burst_windows = {}   # { 'burst_1': (start_t, end_t), ... }
prev_phase = phase.iloc[0]
seg_start  = float(t.iloc[0])

for i in range(1, len(df)):
    cur = phase.iloc[i]
    if cur != prev_phase:
        if prev_phase.startswith('burst_'):
            burst_windows[prev_phase] = (seg_start, float(t.iloc[i]))
        seg_start  = float(t.iloc[i])
        prev_phase = cur
if prev_phase.startswith('burst_'):
    burst_windows[prev_phase] = (seg_start, float(t.iloc[-1]))

burst_keys = sorted(burst_windows.keys())
print(f"\nBurst windows from data:")
for k, (s, e) in burst_windows.items():
    print(f"  {k}: {s:.2f}s → {e:.2f}s")

# ── Style ─────────────────────────────────────────────────────
plt.rcParams.update({
    'font.family'       : 'DejaVu Sans',
    'font.size'         : 11,
    'axes.titlesize'    : 12,
    'axes.titleweight'  : 'bold',
    'axes.labelsize'    : 11,
    'axes.spines.top'   : False,
    'axes.spines.right' : False,
    'axes.grid'         : True,
    'grid.alpha'        : 0.25,
    'grid.linestyle'    : '--',
    'figure.dpi'        : 150,
    'savefig.dpi'       : 150,
    'savefig.bbox'      : 'tight',
})

# ── Figure ────────────────────────────────────────────────────
fig, ax1 = plt.subplots(figsize=(13, 5.5))
ax2 = ax1.twinx()
ax2.spines['right'].set_visible(True)
ax2.spines['top'].set_visible(False)

# ── Phase shading from real data ──────────────────────────────
for key, (s, e) in burst_windows.items():
    ax1.axvspan(s, e, color='#ffcdd2', alpha=0.35, zorder=0)
    ax1.axvline(s, color='#c0392b', lw=1.2, ls=':', alpha=0.7, zorder=1)
    ax1.axvline(e, color='#27ae60', lw=1.2, ls=':', alpha=0.7, zorder=1)

prev_phase = phase.iloc[0]
seg_start  = float(t.iloc[0])
for i in range(1, len(df)):
    cur = phase.iloc[i]
    if cur != prev_phase:
        if not prev_phase.startswith('burst_'):
            ax1.axvspan(seg_start, float(t.iloc[i]),
                        color='#e8f5e9', alpha=0.30, zorder=0)
        seg_start  = float(t.iloc[i])
        prev_phase = cur
if not prev_phase.startswith('burst_'):
    ax1.axvspan(seg_start, float(t.iloc[-1]),
                color='#e8f5e9', alpha=0.30, zorder=0)

# ── Plot lines ────────────────────────────────────────────────
ax2.fill_between(t, load, alpha=0.10, color='#2980b9')
ax2.plot(t, load, color='#2980b9', lw=2.2, ls='--',
         label='Actual VM Load', zorder=4)
ax2.plot(t, pred, color='#8e44ad', lw=1.6, ls='-.',
         label='EMA Predicted Load', zorder=4, alpha=0.85)
ax1.fill_between(t, err, alpha=0.20, color='#c0392b')
ax1.plot(t, err, color='#c0392b', lw=2.2,
         label='EMA Prediction Error', zorder=5)

# ── Find real peak per burst ──────────────────────────────────
peaks = {}
for key in burst_keys:
    s, e = burst_windows[key]
    mask = (t >= s) & (t < e)
    sub  = err[mask]
    if sub.empty:
        continue
    idx = sub.idxmax()
    peaks[key] = (float(t[idx]), float(sub[idx]))

# ── Stagger annotations so they never overlap ─────────────────
max_err = float(err.max())

def find_free_y(peak_v, used_y, margin=0.07):
    candidate = peak_v - 0.10
    for _ in range(20):
        if not any(abs(candidate - y) < margin for y in used_y):
            break
        candidate -= margin
    return max(0.02, candidate)

used_y = []
for key in burst_keys:
    if key not in peaks:
        continue
    peak_t, peak_v = peaks[key]
    label_num = key.replace('burst_', 'Burst ')

    ty = find_free_y(peak_v, used_y)
    used_y.append(ty)

    tx = peak_t + 0.3
    if tx + 1.8 > float(t.max()):
        tx = peak_t - 2.2

    ax1.annotate(
        f'{label_num}\nerr = {peak_v:.3f}',
        xy=(peak_t, peak_v),
        xytext=(tx, ty),
        fontsize=8.5, color='#c0392b', fontweight='bold',
        arrowprops=dict(arrowstyle='->', color='#c0392b', lw=1.3,
                        connectionstyle='arc3,rad=0.2'),
        bbox=dict(boxstyle='round,pad=0.3', fc='white', ec='#c0392b',
                  alpha=0.92, lw=0.9),
        zorder=7
    )

# ── Burst label inside each band ─────────────────────────────
for key, (s, e) in burst_windows.items():
    mid       = (s + e) / 2
    label_num = key.replace('burst_', 'Burst ')
    ax1.text(mid, 0.97, label_num,
             transform=ax1.get_xaxis_transform(),
             ha='center', va='top', fontsize=9,
             color='#c0392b', fontweight='bold')

# ── Axes ──────────────────────────────────────────────────────
ax1.set_xlabel('Time (s)', fontsize=12)
ax1.set_ylabel('Prediction Error  (load units)', color='#c0392b', fontsize=11)
ax2.set_ylabel('VM Load  (0 – 1)',               color='#2980b9', fontsize=11)
ax1.set_xlim(float(t.min()), float(t.max()))
ax1.set_ylim(0, max_err * 1.55)
ax2.set_ylim(0, max(float(load.max()), float(pred.max())) * 1.30)
ax1.set_xticks(range(int(t.min()), int(t.max()) + 1))

# ── Subtitle built from real burst windows ────────────────────
burst_str = '  ·  '.join(
    f'{burst_windows[k][0]:.0f}–{burst_windows[k][1]:.0f} s'
    for k in burst_keys if k in burst_windows
)

# ── Legend ────────────────────────────────────────────────────
legend_handles = [
    plt.Line2D([0],[0], color='#c0392b', lw=2.2,
               label='EMA Prediction Error'),
    plt.Line2D([0],[0], color='#2980b9', lw=2.2, ls='--',
               label='Actual VM Load'),
    plt.Line2D([0],[0], color='#8e44ad', lw=1.6, ls='-.',
               label='EMA Predicted Load'),
    mpatches.Patch(color='#ffcdd2', alpha=0.5, label='Burst phase'),
    mpatches.Patch(color='#e8f5e9', alpha=0.5, label='Normal phase'),
]
ax1.legend(handles=legend_handles, loc='upper right',
           fontsize=9, framealpha=0.9)

ax1.set_title(
    f'Fig 16 — EMA Prediction Error vs Actual VM Load\n'
    f'Proposed Predictive In-Place  |  Bursts: {burst_str}',
    loc='left', pad=14
)

plt.tight_layout()
out = 'fig16_prediction_error.png'
plt.savefig(out)
plt.close()
print(f'\n✅  {out} saved')