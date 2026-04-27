import pandas as pd
import matplotlib.pyplot as plt

# 1. โหลดข้อมูล
df = pd.read_csv('full_allocation_p99_report.csv')

# 2. กำหนดสีและเครื่องหมายให้คงที่สำหรับแต่ละ Scenario
# การล็อกสีไว้แบบนี้จะทำให้ทุกกราฟใช้มาตรฐานเดียวกัน
color_map = {
    '1. Redis Only': '#1f77b4',       # สีน้ำเงิน
    '2. Fabric Only': '#d62728',      # สีแดง
    '3. BC-BLPM (Sync)': '#2ca02c',   # สีเขียว
    '4. Proposed MLVM': '#9467bd'     # สีม่วง
}

marker_map = {
    '1. Redis Only': 'o',
    '2. Fabric Only': 's',
    '3. BC-BLPM (Sync)': '^',
    '4. Proposed MLVM': 'D'
}

# ดึงรายชื่อ Scenario ทั้งหมด
scenarios = df['Scenario'].unique()

# --- กราฟที่ 1: Throughput (RPS) ---
plt.figure(figsize=(10, 6))
for scenario in scenarios:
    subset = df[df['Scenario'] == scenario]
    plt.plot(subset['Target_Step_Load'], subset['Throughput_RPS'], 
             color=color_map.get(scenario, 'black'),
             marker=marker_map.get(scenario, 'x'), 
             linewidth=2, label=scenario)

plt.xscale('log')
plt.xlabel('Load Size (Accumulated Requests)')
plt.ylabel('Throughput (RPS)')
plt.title('System Throughput Comparison')
plt.legend()
plt.grid(True, which="both", ls="-", alpha=0.3)
plt.tight_layout()
plt.savefig('1_Allocation_throughput_fixed_colors.png')
plt.show()

# --- กราฟที่ 2: Average Latency (ms) ---
plt.figure(figsize=(10, 6))
for scenario in scenarios:
    subset = df[df['Scenario'] == scenario]
    plt.plot(subset['Target_Step_Load'], subset['Avg_Latency_ms'], 
             color=color_map.get(scenario, 'black'),
             marker=marker_map.get(scenario, 'x'), 
             linewidth=2, label=scenario)

plt.xscale('log')
plt.xlabel('Load Size (Accumulated Requests)')
plt.ylabel('Average Latency (ms)')
plt.title('Average Latency Comparison')
plt.legend()
plt.grid(True, which="both", ls="-", alpha=0.3)
plt.tight_layout()
plt.savefig('2_Allocation_avg_latency_fixed_colors.png')
plt.show()

# --- กราฟที่ 3: P99 Latency (ms) ---
plt.figure(figsize=(10, 6))
for scenario in scenarios:
    subset = df[df['Scenario'] == scenario]
    plt.plot(subset['Target_Step_Load'], subset['P99_Latency_ms'], 
             color=color_map.get(scenario, 'black'),
             marker=marker_map.get(scenario, 'x'), 
             linewidth=2, label=scenario)

plt.xscale('log')
plt.xlabel('Load Size (Accumulated Requests)')
plt.ylabel('99th Percentile Latency (ms)')
plt.title('P99 Latency Comparison')
plt.legend()
plt.grid(True, which="both", ls="-", alpha=0.3)
plt.tight_layout()
plt.savefig('3_Allocation_P99_latency_fixed_colors.png')
plt.show()