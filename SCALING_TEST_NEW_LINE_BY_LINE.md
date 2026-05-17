================================================================================
SCALING TEST NEW (scailtestnew.js) — LINE-BY-LINE EXPLANATION
================================================================================
This file tests EMA prediction accuracy during burst loads over 20 seconds.

================================================================================
LINES 1-4: STRICT MODE & COMMENTS
================================================================================

Line 1: 'use strict';
    • Enables strict mode for better error detection
    • Prevents unsafe JavaScript practices

Lines 2-12: Multi-line comment explaining the test
    • EMA Prediction Error vs Actual Load test
    • Timeline: 20 seconds with 3 burst periods
    • Outputs: ema_pred_error.csv for plotting

================================================================================
LINES 13-30: IMPORTS
================================================================================

Line 13: const crypto = require('crypto');
    • Cryptographic functions (SHA256 hashing)

Line 14: const os     = require('os');
    • Operating system utilities (not used in this file)

Line 15: const fs     = require('fs/promises');
    • File system operations (async write to CSV)

Line 16: const { createClient } = require('redis');
    • Redis client for cache operations

Line 17: const { performance }  = require('perf_hooks');
    • High-precision timing (performance.now())

Line 18: const jwt              = require('jsonwebtoken');
    • JWT token creation/verification

Line 19: const { MerkleTree }   = require('merkletreejs');
    • Merkle tree for cryptographic proofs

Lines 21-22: Fabric blockchain imports
Line 21: const grpc     = require('@grpc/grpc-js');
    • gRPC protocol for blockchain communication

Line 22: const { connect, signers } = require('@hyperledger/fabric-gateway');
    • Fabric blockchain connection and transaction signing

Line 23: const path     = require('path');
    • File path utilities

================================================================================
LINES 26-38: FABRIC BLOCKCHAIN CONFIGURATION
================================================================================

Line 26: const channelName   = 'mychannel';
    • Blockchain channel name

Line 27: const chaincodeName = 'policy_cc';
    • Smart contract name

Line 28: const mspId         = 'Org1MSP';
    • Organization membership ID

Lines 29-35: Certificate paths
Line 29-31: const cryptoBase = path.resolve(os.homedir(), 'fabric-samples', ...);
    • Base path to Fabric certificates

Line 32: const keyDir   = path.resolve(cryptoBase, 'users', 'User1@org1.example.com', 'msp', 'keystore');
    • Private key directory

Line 33: const certFile = path.resolve(cryptoBase, 'users', 'User1@org1.example.com', 'msp', 'signcerts', 'cert.pem');
    • Client certificate file

Line 34: const tlsFile  = path.resolve(cryptoBase, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
    • TLS certificate for secure connection

Line 35: const peerEndpoint  = 'localhost:7051';
    • Fabric peer address

Line 36: const peerHostAlias = 'peer0.org1.example.com';
    • Peer hostname alias

================================================================================
LINES 38-40: SECURITY CONSTANTS
================================================================================

Line 38: const JWT_SECRET = 'thesis_secret_key';
    • Secret key for JWT token signing/verification

Line 39: const CACHE_KEY  = 'ema_test_policy';
    • Redis key for storing policy data

================================================================================
LINES 42-51: TEST TIMING CONFIGURATION
================================================================================

Lines 42-46: BURST WINDOWS
const BURSTS = [
  { start: 2,  end: 5  },   // First burst: 2-5 seconds
  { start: 7,  end: 10 },   // Second burst: 7-10 seconds
  { start: 12, end: 16 },   // Third burst: 12-16 seconds
];
    • Defines when burst loads occur
    • Normal load between bursts

Line 47: const TOTAL_S       = 20;
    • Total test duration: 20 seconds

Line 48: const NORMAL_WORKERS = 15;
    • 15 concurrent requests during normal periods

Line 49: const BURST_WORKERS  = 220;
    • 220 concurrent requests during burst periods

Line 50: const VM_CAPACITY    = 80;
    • Semaphore capacity: max 80 concurrent requests

Line 51: const TICK_MS        = 100;
    • Sample metrics every 100ms (10 samples/second)

================================================================================
LINES 54-56: HELPER FUNCTIONS
================================================================================

Line 54: const SHA256 = d => crypto.createHash('sha256').update(d).digest();
    • Helper: Create SHA256 hash of data

Line 55: const sleep  = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
    • Helper: Async sleep function

================================================================================
LINES 59-65: SEMAPHORE CLASS
================================================================================

Line 59: class Semaphore {
    • Controls concurrent access (simulates VM capacity limits)

Line 60: constructor(cap) { this.cap = cap; this.n = 0; }
    • cap = capacity, n = current usage

Line 61: tryAcquire()
    • Try to get a slot: if n >= cap, return false (rejected)
    • Else increment n, return true (accepted)

Line 62: release()
    • Decrement n when request finishes

Line 63: get load()
    • Return utilization: n / cap (0.0 to 1.0)

================================================================================
LINES 66-73: EMA FUNCTION
================================================================================

Line 66: function ema(history, k = 5) {
    • Exponential Moving Average predictor
    • history = array of past load values
    • k = window size (default 5)

Line 67: const w = history.slice(-k);
    • Take last k values from history

Line 68: if (!w.length) return 0;
    • If no history, return 0

Line 69: const α = 2 / (w.length + 1);
    • Smoothing factor α = 2/(n+1)
    • Higher α = more weight on recent values

Line 70-71: return w.reduce((e, v, i) => i === 0 ? v : α * v + (1 - α) * e, w[0]);
    • EMA calculation: start with first value
    • Each step: e = α×current + (1-α)×previous_e

================================================================================
LINES 76-87: CORE MLVM REQUEST FUNCTION
================================================================================

Line 76: async function mlvmRequest({ redis, contract, jwtToken, policyTree, policyRoot }) {
    • Simulates a complete MLVM policy request
    • Takes dependencies as parameter object

Line 77: jwt.verify(jwtToken, JWT_SECRET);
    • Verify JWT token signature
    • Throws error if invalid

Lines 79-81: Redis cache read
    const raw = await redis.get(CACHE_KEY);
    if (!raw) throw new Error('Cache miss');
    • Fetch policy from Redis cache

Line 82: const doc = JSON.parse(raw);
    • Parse JSON response

Lines 84-87: Merkle proof reconstruction
    const proof = doc.proof.map(p => ({
        position: p.position,
        data: Buffer.from(p.data.data || p.data)
    }));
    • Convert stored proof to proper format

Lines 88-89: Merkle verification
    if (!policyTree.verify(proof, SHA256(doc.data), policyRoot))
        throw new Error('Merkle mismatch');
    • Verify proof against Merkle root
    • Ensures data integrity

Lines 91-92: Fabric anchor call
    try { await contract.evaluateTransaction('ReadAsset', 'root_01'); } catch (_) {}
    • Blockchain verification call (measures real latency)

Line 93: if (5 < 2) throw new Error('BLP violation');
    • Bell-LaPadula check (always false, just for consistency)

================================================================================
LINES 96-108: WORKER LOOP FUNCTION
================================================================================

Line 96: async function workerLoop(id, activeSet, sem, ctx, deadline) {
    • Worker function that runs requests
    • id = worker ID, activeSet = which workers are active
    • sem = semaphore, ctx = request context, deadline = end time

Line 97: while (performance.now() < deadline) {
    • Run until test deadline

Line 98: if (!activeSet.has(id)) { await sleep(10); continue; }
    • If this worker is not active, sleep and check again

Line 99: if (!sem.tryAcquire())  { await sleep(5);  continue; }
    • Try to get semaphore slot; if full, wait and retry

Lines 100-103: Execute request
    try   { await mlvmRequest(ctx); }
    catch (_) {}
    finally { sem.release(); }
    • Run MLVM request, always release semaphore

================================================================================
LINES 111-114: MAIN FUNCTION START
================================================================================

Line 111: async function main() {
    • Main test execution function

Lines 112-114: Console output
    console.log('EMA Prediction Error Test — 20 s, 3 burst windows');
    console.log('  2–5 s  |  7–10 s  |  12–16 s\n');
    • Display test description

================================================================================
LINES 116-135: REDIS CONNECTION
================================================================================

Line 116: const redis = createClient({ socket: { host: '127.0.0.1', port: 6379 } });
    • Create Redis client

Line 117: await redis.connect();
    • Connect to Redis server

================================================================================
LINES 120-135: FABRIC CONNECTION
================================================================================

Line 120: const tlsCert       = await fs.readFile(tlsFile);
    • Read TLS certificate

Line 121: const certificate   = await fs.readFile(certFile, 'utf8');
    • Read client certificate

Line 122: const keyFiles      = await fs.readdir(keyDir);
    • List private key files

Line 123: const privateKeyPem = await fs.readFile(path.resolve(keyDir, keyFiles[0]), 'utf8');
    • Read first private key file

Line 124-127: Create gRPC client
    const grpcClient = new grpc.Client(peerEndpoint,
        grpc.credentials.createSsl(tlsCert),
        { 'grpc.ssl_target_name_override': peerHostAlias });
    • Secure gRPC connection to Fabric peer

Lines 128-133: Connect to Fabric
    const gateway = connect({
        client  : grpcClient,
        identity: { mspId, credentials: Buffer.from(certificate) },
        signer  : signers.newPrivateKeySigner(crypto.createPrivateKey(privateKeyPem)),
    });
    • Establish Fabric gateway connection

Line 134: const contract = gateway.getNetwork(channelName).getContract(chaincodeName);
    • Get smart contract reference

Line 135: console.log('✅ Fabric + Redis connected');
    • Confirmation message

================================================================================
LINES 138-148: CRYPTO SETUP
================================================================================

Line 138: const jwtToken = jwt.sign({ userId: 'user1', role: 'user', clearance: 5 }, JWT_SECRET);
    • Create signed JWT token

Lines 139-140: Create Merkle tree
    const leaves     = ['Policy_A', 'Policy_B', 'Policy_C'].map(SHA256);
    const policyTree = new MerkleTree(leaves, SHA256);
    • Create Merkle tree from policy hashes

Line 141: const policyRoot = policyTree.getRoot().toString('hex');
    • Get Merkle root hash

Lines 142-146: Seed Redis with policy data
    await redis.set(CACHE_KEY, JSON.stringify({
        data : 'Policy_B',
        proof: policyTree.getProof(SHA256('Policy_B'))
    }));
    • Store policy and Merkle proof in Redis

Line 148: const ctx = { redis, contract, jwtToken, policyTree, policyRoot };
    • Bundle context for requests

================================================================================
LINES 151-159: WORKER POOL SETUP
================================================================================

Line 151: const sem        = new Semaphore(VM_CAPACITY);
    • Create semaphore with 80 slot capacity

Line 152: const activeSet  = new Set();
    • Track which workers are currently active

Line 153: const startTime  = performance.now();
    • Record test start time

Line 154: const deadline   = startTime + TOTAL_S * 1000;
    • Calculate end time (20 seconds later)

Line 157: const allWorkers = Array.from({ length: BURST_WORKERS }, (_, i) => i);
    • Create array of worker IDs (0 to 219)

Line 158: const workerPromises = allWorkers.map(id => workerLoop(id, activeSet, sem, ctx, deadline));
    • Start all workers (they will wait for activation)

================================================================================
LINES 161-163: INITIAL WORKER ACTIVATION
================================================================================

Line 161: for (let i = 0; i < NORMAL_WORKERS; i++) activeSet.add(i);
    • Activate first 15 workers for normal load

================================================================================
LINES 166-169: TELEMETRY SETUP
================================================================================

Line 166: const rows = [];
    • Array to store telemetry data

Line 167: const loadHistory = [];
    • History of load values for EMA calculation

================================================================================
LINES 171-177: HELPER FUNCTIONS FOR TIMING
================================================================================

Line 171: const isBurst = (t) => BURSTS.some(b => t >= b.start && t < b.end);
    • Check if time t is within any burst window

Line 172-175: const burstIndex = (t) => {
    const i = BURSTS.findIndex(b => t >= b.start && t < b.end);
    return i >= 0 ? `burst_${i + 1}` : 'normal';
};
    • Get current phase name (burst_1, burst_2, burst_3, or normal)

================================================================================
LINES 177-179: WORKER COUNT TRACKING
================================================================================

Line 177: let lastWorkerCount = NORMAL_WORKERS;
    • Track previous worker count for change detection

================================================================================
LINES 181-210: TELEMETRY TICKER (MAIN CONTROL LOOP)
================================================================================

Line 181: const ticker = setInterval(() => {
    • Run every 100ms to collect metrics and control load

Line 182-184: Time check
    const elapsed = (performance.now() - startTime) / 1000;
    if (elapsed >= TOTAL_S) { clearInterval(ticker); return; }
    • Calculate elapsed seconds, stop at 20s

Lines 187-193: Dynamic worker activation
    const inBurst    = isBurst(elapsed);
    const targetCount = inBurst ? BURST_WORKERS : NORMAL_WORKERS;

    if (targetCount !== lastWorkerCount) {
        activeSet.clear();
        for (let i = 0; i < targetCount; i++) activeSet.add(i);
        lastWorkerCount = targetCount;
    }
    • Activate 220 workers during bursts, 15 during normal

Lines 196-200: EMA calculation
    const actualLoad = +sem.load.toFixed(4);
    loadHistory.push(actualLoad);
    const predicted  = +ema(loadHistory, 5).toFixed(4);
    const predError  = +Math.abs(predicted - actualLoad).toFixed(4);
    • Calculate actual load, EMA prediction, and prediction error

Line 201: const phase = burstIndex(elapsed);
    • Get current phase name

Lines 203-209: Store telemetry data
    rows.push({
        time_s       : +elapsed.toFixed(2),
        actual_load  : actualLoad,
        predicted_load: predicted,
        pred_error   : predError,
        phase
    });
    • Record all metrics for this timestamp

Lines 211-215: Real-time display
    process.stdout.write(
        `\r  t=${elapsed.toFixed(1).padStart(4)}s  load=${actualLoad.toFixed(2)}  ` +
        `pred=${predicted.toFixed(2)}  err=${predError.toFixed(3)}  [${phase.padEnd(8)}]`
    );
    • Update console with live metrics

Line 216: }, TICK_MS);
    • Close setInterval (runs every 100ms)

================================================================================
LINES 219-223: WAIT FOR COMPLETION
================================================================================

Line 219: await Promise.all(workerPromises);
    • Wait for all workers to finish

Line 220: clearInterval(ticker);
    • Stop the ticker

Line 221: console.log('\n\n✅ Test complete');
    • Completion message

================================================================================
LINES 224-230: CSV OUTPUT
================================================================================

Line 224: const header = 'time_s,actual_load,predicted_load,pred_error,phase';
    • CSV header row

Line 225-227: const lines = rows.map(r =>
    `${r.time_s},${r.actual_load},${r.predicted_load},${r.pred_error},"${r.phase}"`
);
    • Convert each data row to CSV format

Line 228: await fs.writeFile('ema_pred_error.csv', [header, ...lines].join('\n'));
    • Write CSV file

Line 229: console.log('📄 ema_pred_error.csv written —', rows.length, 'samples');
    • Confirmation with sample count

================================================================================
LINES 231-235: CLEANUP
================================================================================

Line 231: gateway.close();
Line 232: grpcClient.close();
    • Close Fabric connections

Line 233: await redis.disconnect();
    • Close Redis connection

================================================================================
LINES 237-239: ERROR HANDLING
================================================================================

Line 237: main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
    • Run main function with error handling
    • Exit with error code 1 on failure

================================================================================
WHAT THIS TEST MEASURES
================================================================================

**Timeline:**
- 0-2s: Normal (15 workers)
- 2-5s: Burst 1 (220 workers) ← Load spike
- 5-7s: Normal (15 workers)
- 7-10s: Burst 2 (220 workers) ← Load spike
- 10-12s: Normal (15 workers)
- 12-16s: Burst 3 (220 workers) ← Load spike
- 16-20s: Normal (15 workers)

**Metrics Collected (every 100ms):**
- actual_load: Current semaphore utilization (0.0-1.0)
- predicted_load: EMA prediction based on last 5 samples
- pred_error: |predicted - actual| (accuracy measure)
- phase: normal, burst_1, burst_2, burst_3

**Purpose:**
- Test how well EMA predicts load changes
- Measure prediction error during transitions
- Generate data for plotting EMA accuracy
- Validate predictive scaling algorithms

================================================================================
END OF LINE-BY-LINE EXPLANATION
================================================================================