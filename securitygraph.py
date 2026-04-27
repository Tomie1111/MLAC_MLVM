import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

# 1. อ่านข้อมูลจากไฟล์ benchmark จริง
csv_file = 'real_env_final_benchmark.csv'
df = pd.read_csv(csv_file)

# 2. กำหนดชื่อและสีของเทคโนโลยีที่ต้องการเปรียบเทียบ
block_columns = [
    'Redis_Block_%',
    'MLVM_Block_%',
    'BC_BLPM_Block_%',
    'Fabric_Block_%'
]
latency_columns = [
    'Redis_Lat_ms',
    'MLVM_Lat_ms',
    'BC_BLPM_Lat_ms',
    'Fabric_Lat_ms'
]
series_labels = ['Redis', 'Proposed MLVM', 'BC-BLPM', 'Fabric']
colors = ['#1f77b4', '#9467bd', '#2ca02c', '#d62728']

# 3. กำหนดตำแหน่งแกน X และความกว้างของแท่งกราฟ
x = np.arange(len(df))
width = 0.18

# 4. สร้างรูปและแกน 2 แผนภูมิ
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 7))
fig.suptitle('Real Environment Benchmark: Block Rate and Latency Comparison', fontsize=18, fontweight='bold', y=1.02)

# เลือกชื่อ Scenario ให้กระชับสำหรับแกน X
short_labels = [
    'Test 1:\nCache Poisoning',
    'Test 2:\nPrivilege Esc.',
    'Test 3:\nReplay Attack',
    'Test 4:\nAudit Tampering'
]

# ------------------------------------------
# กราฟที่ 1: Block Rate Comparison
# ------------------------------------------
for i, (col, label, color) in enumerate(zip(block_columns, series_labels, colors)):
    ax1.bar(x + (i - 1.5) * width, df[col], width, label=label, color=color, edgecolor='black', linewidth=0.5)

ax1.set_title('Attack Block Rate (%)', fontsize=14, fontweight='bold')
ax1.set_ylabel('Block Rate (%)', fontsize=12)
ax1.set_xticks(x)
ax1.set_xticklabels(short_labels, fontsize=10)
ax1.set_ylim(0, 110)
ax1.legend(fontsize=10)
ax1.grid(axis='y', linestyle='--', alpha=0.5)

for i, col in enumerate(block_columns):
    for xi, value in enumerate(df[col]):
        ax1.annotate(f'{value:.0f}%',
                     xy=(xi + (i - 1.5) * width + width / 2, value),
                     xytext=(0, 3),
                     textcoords='offset points',
                     ha='center', va='bottom', fontsize=9)

# ------------------------------------------
# กราฟที่ 2: Latency Comparison
# ------------------------------------------
for i, (col, label, color) in enumerate(zip(latency_columns, series_labels, colors)):
    ax2.bar(x + (i - 1.5) * width, df[col], width, label=label, color=color, edgecolor='black', linewidth=0.5)

ax2.set_title('Processing Latency (ms)', fontsize=14, fontweight='bold')
ax2.set_ylabel('Latency (ms)', fontsize=12)
ax2.set_xticks(x)
ax2.set_xticklabels(short_labels, fontsize=10)
max_latency = df[latency_columns].max().max()
ax2.set_ylim(0, max_latency * 1.2)
ax2.legend(fontsize=10)
ax2.grid(axis='y', linestyle='--', alpha=0.5)

for i, col in enumerate(latency_columns):
    for xi, value in enumerate(df[col]):
        ax2.annotate(f'{value:.4f}',
                     xy=(xi + (i - 1.5) * width + width / 2, value),
                     xytext=(0, 3),
                     textcoords='offset points',
                     ha='center', va='bottom', fontsize=8)

# ------------------------------------------
# จัด layout และบันทึกภาพ
# ------------------------------------------
plt.tight_layout(rect=[0, 0, 1, 0.96])
output_filename = 'evaluation_dashboard.png'
plt.savefig(output_filename, dpi=300, bbox_inches='tight')
print(f'✅ บันทึกกราฟสำเร็จ: {output_filename}')
plt.show()
