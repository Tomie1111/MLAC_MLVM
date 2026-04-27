import pandas as pd
import matplotlib.pyplot as plt
import io

# If you have the data in a CSV file, replace the io.StringIO(csv_data) with 'your_file.csv'
df = pd.read_csv('real_audit_benchmark.csv')
df.set_index('Scenario', inplace=True)

# 2. Separate the columns into Detection and Latency
det_cols = ['Plain_Det', 'HashChain_Det', 'FullOnChain_Det', 'Proposed_Det']
p99_cols = ['Plain_P99', 'HashChain_P99', 'FullOnChain_P99', 'Proposed_P99']

# Define display names for the legend
legend_labels = ['Plain Log', 'HashChain Only', 'Full On-Chain', 'Proposed MLVM']

# ==========================================
# CHART 1: Detection Rate (%)
# ==========================================
fig, ax = plt.subplots(figsize=(10, 6))
df[det_cols].plot(kind='bar', ax=ax, width=0.7)

ax.set_title('Detection Rate by System and Attack Scenario', fontsize=14, fontweight='bold')
ax.set_ylabel('Detection Rate (%)', fontsize=12)
ax.set_xlabel('Attack Scenario', fontsize=12)
ax.set_ylim(0, 110) # Set to 110 so the 100% bars have some headroom
plt.xticks(rotation=15, ha='right')
ax.legend(legend_labels, title='System', bbox_to_anchor=(1.05, 1), loc='upper left')

plt.tight_layout()
plt.savefig('detection_rate.png', dpi=300)
print("Saved Detection Rate chart as 'detection_rate.png'")

# ==========================================
# CHART 2: P99 Latency (ms) - Log Scale
# ==========================================
fig, ax = plt.subplots(figsize=(10, 6))
df[p99_cols].plot(kind='bar', ax=ax, width=0.7)

ax.set_title('P99 Latency by System and Attack Scenario (Log Scale)', fontsize=14, fontweight='bold')
ax.set_ylabel('P99 Latency (ms)', fontsize=12)
ax.set_xlabel('Attack Scenario', fontsize=12)
ax.set_yscale('log') # Log scale helps visualize both 0.001ms and 37ms on the same chart

plt.xticks(rotation=15, ha='right')
ax.legend(legend_labels, title='System', bbox_to_anchor=(1.05, 1), loc='upper left')

plt.tight_layout()
plt.savefig('latency_p99.png', dpi=300)
print("Saved Latency chart as 'latency_p99.png'")

# Uncomment the line below if you want to display the plots interactively
# plt.show()