"""
MLAC-MLVM Scaling Test — Figure Generator
Produces 5 figures matching paper Section D (Fig 11–16):
  Fig 11 — Scaling Response Time (bar chart)
  Fig 12 — Session Survival & Dropped Requests
  Fig 13 — Latency Distribution (box plot, burst vs cooldown)
  Fig 14 — CPU % and VM Load over time
  Fig 16 — EMA Prediction Error vs Actual Load
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.gridspec import GridSpec
import warnings
warnings.filterwarnings('ignore')

# ── Style ────────────────────────────────────────────────────────
plt.rcParams.update({
    'font.family'      : 'DejaVu Sans',
    'font.size'        : 11,
    'axes.titlesize'   : 12,
    'axes.titleweight' : 'bold',
    'axes.labelsize'   : 11,
    'axes.spines.top'  : False,
    'axes.spines.right': False,
    'axes.grid'        : True,
    'grid.alpha'       : 0.3,
    'grid.linestyle'   : '--',
    'figure.dpi'       : 150,
    'savefig.dpi'      : 150,
    'savefig.bbox'     : 'tight',
})

# ── Colours per strategy (consistent across all figures) ─────────
COLORS = {
    'Proposed Predictive In-Place' : '#2ecc71',   # green
    'Reactive Threshold'           : '#e67e22',   # orange
    'Horizontal (New VM)'          : '#3498db',   # blue
    'No Scaling'                   : '#e74c3c',   # red
}
SHORT = {
    'Proposed Predictive In-Place' : 'Proposed\nPredictive',
    'Reactive Threshold'           : 'Reactive\nThreshold',
    'Horizontal (New VM)'          : 'Horizontal\n(New VM)',
    'No Scaling'                   : 'No Scaling',
}

# ── Load data ────────────────────────────────────────────────────
t6   = pd.read_csv('scaling_table_VI.csv')
f14  = pd.read_csv('scaling_fig14_cpu_mem.csv')
f13  = pd.read_csv('scaling_fig13_latency.csv')
f16  = pd.read_csv('scaling_fig16_pred_error.csv')

# Convert Response_Time_ms — N/A → NaN
t6['Response_Time_ms'] = pd.to_numeric(t6['Response_Time_ms'], errors='coerce')

strategies = list(COLORS.keys())
colors     = [COLORS[s] for s in strategies]

# ════════════════════════════════════════════════════════════════
# FIG 11 — Scaling Response Time
# ════════════════════════════════════════════════════════════════
fig, ax = plt.subplots(figsize=(8, 4.5))

valid = t6.dropna(subset=['Response_Time_ms'])
bars  = ax.bar(
    [SHORT[s] for s in valid['Strategy']],
    valid['Response_Time_ms'],
    color=[COLORS[s] for s in valid['Strategy']],
    width=0.5, edgecolor='white', linewidth=1.2, zorder=3
)

# Value labels on bars
for bar in bars:
    h = bar.get_height()
    ax.text(bar.get_x() + bar.get_width()/2, h + 15,
            f'{h:.0f} ms', ha='center', va='bottom', fontsize=10, fontweight='bold')

# Mark No Scaling as N/A
no_scale = t6[t6['Strategy'] == 'No Scaling']
if not no_scale.empty:
    ax.text(3, 30, 'N/A\n(never acts)', ha='center', va='bottom',
            fontsize=10, color='#e74c3c', fontweight='bold')
    ax.bar([SHORT['No Scaling']], [50], color='#e74c3c', alpha=0.25,
           width=0.5, edgecolor='white', zorder=3)

ax.set_ylabel('Response Time (ms)')
ax.set_title('Fig 11 — Scaling Response Time Across Methods')
ax.set_xlabel('Scaling Strategy')
ax.set_ylim(0, max(valid['Response_Time_ms']) * 1.25)
plt.tight_layout()
plt.savefig('fig11_scaling_response_time.png')
plt.close()
print('✅  fig11_scaling_response_time.png')

# ════════════════════════════════════════════════════════════════
# FIG 12 — Dropped Requests & Session Survival (dual axis)
# ════════════════════════════════════════════════════════════════
fig, ax1 = plt.subplots(figsize=(9, 5))
ax2 = ax1.twinx()
ax2.spines['right'].set_visible(True)

x   = np.arange(len(strategies))
w   = 0.38

bars1 = ax1.bar(x - w/2, t6['Dropped_Requests'], width=w,
                color=colors, alpha=0.85, label='Dropped Requests',
                edgecolor='white', linewidth=1, zorder=3)
bars2 = ax2.bar(x + w/2, t6['Session_Survival_Pct'], width=w,
                color=colors, alpha=0.45, label='Session Survival %',
                edgecolor='white', linewidth=1, zorder=3, hatch='//')

for bar in bars1:
    h = bar.get_height()
    ax1.text(bar.get_x() + bar.get_width()/2, h + 500,
             f'{int(h):,}', ha='center', va='bottom', fontsize=8.5)
for bar in bars2:
    h = bar.get_height()
    ax2.text(bar.get_x() + bar.get_width()/2, h + 0.5,
             f'{h}%', ha='center', va='bottom', fontsize=8.5)

ax1.set_xticks(x)
ax1.set_xticklabels([SHORT[s] for s in strategies])
ax1.set_ylabel('Dropped Requests', color='#2c3e50')
ax2.set_ylabel('Session Survival Rate (%)', color='#2c3e50')
ax2.set_ylim(0, 120)
ax1.set_title('Fig 12 — Dropped Requests & Session Survival Rate')

p1 = mpatches.Patch(color='grey', alpha=0.85, label='Dropped Requests')
p2 = mpatches.Patch(color='grey', alpha=0.45, hatch='//', label='Session Survival %')
ax1.legend(handles=[p1, p2], loc='upper left')
plt.tight_layout()
plt.savefig('fig12_dropped_survival.png')
plt.close()
print('✅  fig12_dropped_survival.png')

# ════════════════════════════════════════════════════════════════
# FIG 13 — Latency Distribution (box plot)
# ════════════════════════════════════════════════════════════════
fig, axes = plt.subplots(1, 2, figsize=(13, 5), sharey=False)

for ax, phase, title in zip(
    axes,
    ['burst', 'cooldown'],
    ['During Burst', 'After Burst (Cooldown)']
):
    data   = []
    labels = []
    cols   = []
    for s in strategies:
        subset = f13[(f13['Strategy'] == s) & (f13['Phase'] == phase)]['Latency_ms']
        if not subset.empty:
            data.append(subset.values)
            labels.append(SHORT[s])
            cols.append(COLORS[s])

    bp = ax.boxplot(data, patch_artist=True, notch=False,
                    medianprops=dict(color='black', linewidth=2),
                    whiskerprops=dict(linewidth=1.2),
                    flierprops=dict(marker='o', markersize=2, alpha=0.3),
                    widths=0.5)

    for patch, col in zip(bp['boxes'], cols):
        patch.set_facecolor(col)
        patch.set_alpha(0.75)

    ax.set_xticklabels(labels, fontsize=9.5)
    ax.set_ylabel('Latency (ms)')
    ax.set_title(f'Fig 13 — {title}')
    ax.set_xlabel('Scaling Strategy')

plt.suptitle('Fig 13 — Latency Distribution per Strategy', fontsize=13, fontweight='bold', y=1.01)
plt.tight_layout()
plt.savefig('fig13_latency_distribution.png')
plt.close()
print('✅  fig13_latency_distribution.png')

# ════════════════════════════════════════════════════════════════
# FIG 14 — CPU % and VM Load over time (2-row subplot per strategy)
# ════════════════════════════════════════════════════════════════
fig, axes = plt.subplots(2, 2, figsize=(14, 8), sharex=False)
axes = axes.flatten()

# Phase boundaries (in 200 ms ticks) — same as benchmark config
NORMAL_TICKS = 3000 // 200   # 15
BURST_TICKS  = NORMAL_TICKS + 6000 // 200   # 45

for ax, s in zip(axes, strategies):
    df   = f14[f14['Strategy'] == s].reset_index(drop=True)
    t    = df['Tick_200ms'] * 0.2   # convert to seconds

    ax2  = ax.twinx()
    ax2.spines['right'].set_visible(True)

    ax.plot(t, df['CPU_Pct'], color=COLORS[s], linewidth=1.5, label='CPU %', zorder=3)
    ax2.plot(t, df['VM_Load'], color='#2c3e50', linewidth=1.5,
             linestyle='--', label='VM Load', zorder=3)

    # Phase shading
    tmax = t.max()
    n_s  = NORMAL_TICKS * 0.2
    b_s  = BURST_TICKS  * 0.2

    ax.axvspan(0,    n_s,  alpha=0.06, color='green',  label='Normal')
    ax.axvspan(n_s,  b_s,  alpha=0.06, color='red',    label='Burst')
    ax.axvspan(b_s,  tmax, alpha=0.06, color='blue',   label='Cooldown')
    ax.axvline(n_s, color='green', linestyle=':', linewidth=1)
    ax.axvline(b_s, color='red',   linestyle=':', linewidth=1)

    ax.set_title(s, fontsize=10)
    ax.set_xlabel('Time (s)')
    ax.set_ylabel('CPU %', color=COLORS[s])
    ax2.set_ylabel('VM Load', color='#2c3e50')
    ax.set_ylim(0, 110)
    ax2.set_ylim(0, 1.15)

    # Legend
    lines  = [plt.Line2D([0],[0], color=COLORS[s], lw=1.5, label='CPU %'),
              plt.Line2D([0],[0], color='#2c3e50', lw=1.5, ls='--', label='VM Load')]
    shades = [mpatches.Patch(color='green', alpha=0.2, label='Normal'),
              mpatches.Patch(color='red',   alpha=0.2, label='Burst'),
              mpatches.Patch(color='blue',  alpha=0.2, label='Cooldown')]
    ax.legend(handles=lines + shades, loc='lower right', fontsize=7.5, ncol=2)

plt.suptitle('Fig 14 — CPU % and VM Load over Time (All Strategies)',
             fontsize=13, fontweight='bold')
plt.tight_layout()
plt.savefig('fig14_cpu_vmload.png')
plt.close()
print('✅  fig14_cpu_vmload.png')

# ════════════════════════════════════════════════════════════════
# FIG 16 — EMA Prediction Error vs Actual Load (Proposed only)
# ════════════════════════════════════════════════════════════════
fig, ax1 = plt.subplots(figsize=(10, 4.5))
ax2 = ax1.twinx()
ax2.spines['right'].set_visible(True)

t = f16['Tick_200ms'] * 0.2   # seconds

ax1.fill_between(t, f16['Pred_Error'], alpha=0.25, color='#e74c3c')
ax1.plot(t, f16['Pred_Error'], color='#e74c3c', linewidth=1.8,
         label='Prediction Error', zorder=3)

ax2.plot(t, f16['Actual_Load'], color='#3498db', linewidth=1.8,
         linestyle='--', label='Actual VM Load', zorder=3)

# Phase lines
NORMAL_S = 3000 / 1000
BURST_S  = NORMAL_S + 6000 / 1000
ax1.axvline(NORMAL_S, color='green', linestyle=':', linewidth=1.2, label='Burst start')
ax1.axvline(BURST_S,  color='blue',  linestyle=':', linewidth=1.2, label='Cooldown start')
ax1.axvspan(0,        NORMAL_S, alpha=0.05, color='green')
ax1.axvspan(NORMAL_S, BURST_S,  alpha=0.05, color='red')
ax1.axvspan(BURST_S,  t.max(),  alpha=0.05, color='blue')

ax1.set_xlabel('Time (s)')
ax1.set_ylabel('Prediction Error (load units)', color='#e74c3c')
ax2.set_ylabel('Actual VM Load',                color='#3498db')
ax1.set_title('Fig 16 — EMA Prediction Error vs Actual Load\n(Proposed Predictive In-Place only)')

lines = [
    plt.Line2D([0],[0], color='#e74c3c', lw=1.8, label='Prediction Error'),
    plt.Line2D([0],[0], color='#3498db', lw=1.8, ls='--', label='Actual VM Load'),
    plt.Line2D([0],[0], color='green', lw=1, ls=':', label='Burst start'),
    plt.Line2D([0],[0], color='blue',  lw=1, ls=':', label='Cooldown start'),
]
ax1.legend(handles=lines, loc='upper right', fontsize=9)
plt.tight_layout()
plt.savefig('fig16_prediction_error.png')
plt.close()
print('✅  fig16_prediction_error.png')

print('\n🎉  All figures saved.')