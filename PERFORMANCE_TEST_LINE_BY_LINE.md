================================================================================
PERFORMANCE TEST (Performance-Test.js) — LINE-BY-LINE EXPLANATION
================================================================================
This file benchmarks 4 policy access scenarios with incremental load testing.

================================================================================
LINES 1-8: IMPORTS
================================================================================

Line 1: const grpc = require('@grpc/grpc-js');
    • gRPC protocol for blockchain communication

Line 2: const crypto = require('crypto');
    • Cryptographic functions (SHA256 hashing)

Line 3: const { connect, signers } = require('@hyperledger/fabric-gateway');
    • Fabric blockchain connection and transaction signing

Line 4: const fs = require('fs/promises');
    • File system operations (async CSV writing)

Line 5: const path = require('path');
    • File path utilities

Line 6: const os = require('os');
    • Operating system utilities (homedir)

Line 7: const { createClient } = require('redis');
    • Redis client for cache operations

Line 8: const { performance } = require('perf_hooks');
    • High-precision timing measurements

================================================================================
LINES 11-13: TEST CONFIGURATION
================================================================================

Line 11: const STEPS = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
    • Load levels: incrementally increase from 100 to 100,000 requests
    • Each step adds more load to test scalability

Line 12: const BATCH_SIZE = 100;
    • Process requests in batches of 100 for parallel execution
    • Balances memory usage with throughput

================================================================================
LINES 16-28: FABRIC BLOCKCHAIN CONFIGURATION
================================================================================

Line 16: const channelName = 'mychannel';
    • Blockchain channel name

Line 17: const chaincodeName = 'policy_cc';
    • Smart contract name for policy operations

Line 18: const mspId = 'Org1MSP';
    • Organization membership service provider ID

Line 19-21: const cryptoPath = path.resolve(os.homedir(), 'fabric-samples', ...);
    • Base path to Fabric network certificates and keys

Line 22: const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
    • Directory containing private keys for signing

Line 23: const certPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts', 'cert.pem');
    • Path to client certificate file

Line 24: const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
    • Path to TLS certificate for secure connection

Line 25: const peerEndpoint = 'localhost:7051';
    • Fabric peer network address

Line 26: const peerHostAlias = 'peer0.org1.example.com';
    • Peer hostname alias for SSL verification

================================================================================
LINES 31-32: WORKLOAD FUNCTION SIGNATURE
================================================================================

Line 31: async function runIncrementalWorkload(scenarioName, targetFunction) {
    • Main benchmarking function
    • scenarioName: descriptive name for the test scenario
    • targetFunction: async function to execute for each request

================================================================================
LINES 33-36: INITIALIZATION
================================================================================

Line 33: console.log(`\n▶️ เริ่มการทดสอบ Scenario: ${scenarioName}`);
    • Display scenario start message

Line 34: let lastPoint = 0;
    • Track cumulative requests from previous steps

Line 35: const stepResults = [];
    • Array to collect results for each load step

================================================================================
LINES 38-39: LOAD STEP LOOP
================================================================================

Line 38: for (const currentStep of STEPS) {
    • Iterate through each load level (100, 500, 1000, ...)

Line 39: const amountToRun = currentStep - lastPoint;
    • Calculate incremental requests for this step
    • Example: Step 500 - previous 100 = 400 new requests

================================================================================
LINES 40-44: METRICS INITIALIZATION
================================================================================

Line 40: const latencies = [];
    • Array to store response times for all requests

Line 41: let errorCount = 0;
    • Counter for failed requests

Line 43: console.log(`   🚀 ช่วงโหลดสะสม: ${currentStep} (+${amountToRun})`);
    • Display current step progress

Line 44: const startTime = performance.now();
    • Record step start time

================================================================================
LINES 46-47: BATCH PROCESSING LOOP
================================================================================

Line 46: for (let i = 0; i < amountToRun; i += BATCH_SIZE) {
    • Process requests in batches of 100
    • i increments by BATCH_SIZE each iteration

Line 47: const currentBatch = Math.min(BATCH_SIZE, amountToRun - i);
    • Calculate actual batch size (may be smaller for last batch)

================================================================================
LINES 48-49: BATCH PROMISE ARRAY
================================================================================

Line 48: const batchPromises = [];
    • Array to hold promises for parallel batch execution

================================================================================
LINES 51-62: INDIVIDUAL REQUEST LOOP
================================================================================

Line 51: for (let j = 0; j < currentBatch; j++) {
    • Loop through each request in the current batch

Line 52: const reqPromise = (async () => {
    • Create async function for each individual request

Line 53: const start = performance.now();
    • Record individual request start time

Lines 54-58: Execute target function
    try {
        await targetFunction(lastPoint + i + j);
    } catch (e) {
        errorCount++;
    }
    • Execute the scenario-specific function
    • Count errors if function throws exception

Line 59: latencies.push(performance.now() - start);
    • Record response time for this request

Line 60: })();
    • Close async function

Line 61: batchPromises.push(reqPromise);
    • Add promise to batch array

================================================================================
LINES 63-64: WAIT FOR BATCH COMPLETION
================================================================================

Line 63: await Promise.all(batchPromises);
    • Wait for all requests in current batch to complete
    • Enables parallel execution within each batch

================================================================================
LINES 67-72: CALCULATE STEP METRICS
================================================================================

Line 67: const endTime = performance.now();
    • Record step end time

Line 68: const durationSec = (endTime - startTime) / 1000;
    • Calculate total step duration in seconds

Line 69: const throughput = amountToRun / durationSec;
    • Calculate requests per second (RPS)

================================================================================
LINES 71-74: CALCULATE LATENCY METRICS
================================================================================

Line 71: latencies.sort((a, b) => a - b);
    • Sort latencies from fastest to slowest

Line 72: const avgLat = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    • Calculate average latency across all requests

Line 73: const p95Lat = latencies[Math.floor(0.95 * latencies.length)] || 0;
    • Calculate 95th percentile latency
    • 95% of requests are faster than this value

================================================================================
LINES 76-86: STORE STEP RESULTS
================================================================================

Lines 76-86: stepResults.push({
    scenario: scenarioName,
    step_load: currentStep,
    throughput: throughput.toFixed(2),
    avg_latency: avgLat.toFixed(4),
    p95_latency: p95Lat.toFixed(4),
    error_rate: ((errorCount / amountToRun) * 100).toFixed(2)
});
    • Store all metrics for this load step
    • Format numbers with appropriate decimal places

Line 88: lastPoint = currentStep;
    • Update for next iteration (incremental load)

================================================================================
LINES 90-91: RETURN RESULTS
================================================================================

Line 90: return stepResults;
    • Return array of results for all load steps

================================================================================
LINES 96-97: MAIN FUNCTION START
================================================================================

Line 96: async function main() {
    • Main execution function

Line 97: const redisClient = createClient();
    • Create Redis client instance

Line 98: await redisClient.connect();
    • Connect to Redis server

================================================================================
LINES 101-108: POLICY MATRIX DEFINITION
================================================================================

Lines 101-108: const policyMatrix = [
    { level: 'L0', class: 'Absolute Top', cap: 'read, write, exec, vm_mgmt, audit, override' },
    { level: 'L1', class: 'Top Secret', cap: 'read, write, execute_scripts' },
    { level: 'L2', class: 'Secret', cap: 'read, execute_approved_apps' },
    { level: 'L3', class: 'Confidential', cap: 'read, write (No execution)' },
    { level: 'L4', class: 'Restricted', cap: 'write, exec_readonly (No read)' },
    { level: 'L5', class: 'Public', cap: 'read (View-only; no write/exec)' }
];
    • Define 6 security classification levels
    • Each level has different access capabilities
    • L0 = highest privileges, L5 = lowest

================================================================================
LINES 110-118: SEED REDIS WITH POLICIES
================================================================================

Line 110: console.log('⏳ กำลังเตรียมข้อมูล Policy 100,000 ชุด...');
    • Display seeding progress

Line 111: for (let i = 0; i < 100000; i++) {
    • Create 100,000 policy entries

Line 112: const p = policyMatrix[i % policyMatrix.length];
    • Cycle through policy levels (L0, L1, L2, L3, L4, L5, repeat)

Line 113: const pStr = JSON.stringify(p);
    • Convert policy object to JSON string

Line 114: const hash = crypto.createHash('sha256').update(pStr).digest('hex');
    • Create SHA256 hash for integrity verification

Line 115: await redisClient.set(`policy_${i}`, JSON.stringify({ policy: pStr, hash: hash }));
    • Store policy and hash in Redis
    • Key format: policy_0, policy_1, ..., policy_99999

================================================================================
LINES 120-135: FABRIC CONNECTION SETUP
================================================================================

Line 120: const tlsRootCert = await fs.readFile(tlsCertPath);
    • Read TLS certificate for secure connection

Line 121: const certificate = await fs.readFile(certPath, 'utf8');
    • Read client certificate

Line 122: const files = await fs.readdir(keyDirectoryPath);
    • List private key files

Line 123: const keyPath = path.resolve(keyDirectoryPath, files[0]);
    • Get path to first private key file

Line 124: const privateKeyPem = await fs.readFile(keyPath, 'utf8');
    • Read private key content

Line 125: const privateKey = crypto.createPrivateKey(privateKeyPem);
    • Parse private key for signing

Line 126: const grpcCredentials = grpc.credentials.createSsl(tlsRootCert);
    • Create SSL credentials for gRPC

Line 127: const client = new grpc.Client(peerEndpoint, grpcCredentials, { 'grpc.ssl_target_name_override': peerHostAlias });
    • Create gRPC client to Fabric peer

Lines 128-133: const gateway = connect({...});
    • Connect to Fabric network with identity and signer

Line 134: const contract = gateway.getNetwork(channelName).getContract(chaincodeName);
    • Get reference to smart contract

================================================================================
LINES 137-139: RESULTS COLLECTION
================================================================================

Line 137: const finalReport = [];
    • Array to collect all scenario results

Line 138: try {
    • Start error handling block

================================================================================
LINES 141-144: SCENARIO 1 - REDIS ONLY
================================================================================

Lines 141-144: finalReport.push(...(await runIncrementalWorkload("1. Redis Only", async (i) => {
    await redisClient.get(`policy_${i}`);
})));
    • Test pure Redis performance
    • Each request: fetch policy from cache
    • No blockchain calls, no verification

================================================================================
LINES 147-150: SCENARIO 2 - FABRIC ONLY
================================================================================

Lines 147-150: finalReport.push(...(await runIncrementalWorkload("2. Fabric Only", async (i) => {
    await contract.evaluateTransaction('AssetExists', `policy_${i % 10000}`);
})));
    • Test pure blockchain performance
    • Each request: call smart contract AssetExists
    • Uses modulo 10000 to cycle through policies

================================================================================
LINES 153-157: SCENARIO 3 - BC-BLPM (SYNC HYBRID)
================================================================================

Lines 153-157: finalReport.push(...(await runIncrementalWorkload("3. BC-BLPM (Sync)", async (i) => {
    await redisClient.get(`policy_${i}`);
    await contract.evaluateTransaction('AssetExists', `policy_${i % 10000}`);
})));
    • Test traditional hybrid approach
    • Each request: Redis fetch + blockchain verification
    • Sequential execution (both must succeed)

================================================================================
LINES 160-172: SCENARIO 4 - PROPOSED MLVM
================================================================================

Lines 160-172: finalReport.push(...(await runIncrementalWorkload("4. Proposed MLVM", async (i) => {
    const data = await redisClient.get(`policy_${i}`);
    if (data) {
        const parsed = JSON.parse(data);
        const computedHash = crypto.createHash('sha256').update(parsed.policy).digest('hex');
        if (computedHash !== parsed.hash) throw new Error("Security Violation!");
        
        const policy = JSON.parse(parsed.policy);
        if (policy.level === 'L2') { /* Access Granted */ }
    }
})));
    • Test optimized hybrid approach
    • Redis fetch + hash verification + policy parsing
    • No blockchain call (trusts hash integrity)
    • Checks if policy level allows access

================================================================================
LINES 175-183: CSV OUTPUT GENERATION
================================================================================

Line 175: const header = "Scenario,Target_Step_Load,Throughput_RPS,Avg_Latency_ms,P95_Latency_ms,Error_Rate_%\n";
    • CSV header with column names

Line 176-179: const rows = finalReport.map(r =>
    `${r.scenario},${r.step_load},${r.throughput},${r.avg_latency},${r.p95_latency},${r.error_rate}`
).join('\n');
    • Convert results to CSV rows

Line 181: await fs.writeFile('final_incremental_report.csv', header + rows, 'utf8');
    • Write complete CSV file

Line 182: console.log(`\n🎉 บันทึกไฟล์สำเร็จ: final_incremental_report.csv (ครบ 4 Scenarios x 9 Steps)`);
    • Success message

================================================================================
LINES 185-190: CLEANUP
================================================================================

Lines 185-190: } finally {
    await redisClient.disconnect();
    gateway.close();
    client.close();
}
    • Clean up connections regardless of success/failure
    • Prevent resource leaks

================================================================================
LINES 192-193: ERROR HANDLING
================================================================================

Line 192: main().catch(console.error);
    • Execute main function with error logging

================================================================================
WHAT THIS TEST MEASURES
================================================================================

**4 Scenarios Compared:**

1. **Redis Only**
   - Pure cache performance
   - Fastest but no security verification
   - ~0.1-0.5ms latency

2. **Fabric Only**
   - Pure blockchain performance
   - Secure but slowest
   - ~50-200ms latency

3. **BC-BLPM (Sync)**
   - Traditional hybrid: cache + blockchain
   - Secure but slow (sequential calls)
   - ~50-250ms latency

4. **Proposed MLVM**
   - Optimized hybrid: cache + hash verification
   - Balanced security and performance
   - ~1-5ms latency

**Load Progression:**
- Starts at 100 requests
- Scales to 100,000 requests
- Measures throughput, latency, and error rates
- Each step adds incremental load

**Output:** CSV file with performance metrics for analysis and plotting

================================================================================
END OF LINE-BY-LINE EXPLANATION
================================================================================