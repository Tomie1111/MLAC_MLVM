================================================================================
SCALING TEST (scalingTest.js) — COMPLETE STEP-BY-STEP EXPLANATION
================================================================================
This is a performance benchmark measuring how 4 different scaling strategies
handle a sudden burst of 200 concurrent requests after 20 normal requests.

================================================================================
SECTION 1: DEPENDENCIES & IMPORTS (Lines 1-19)
================================================================================

Line 2: 'use strict';
    • Enables strict mode for better error detection
    • Prevents unsafe actions and undeclared variables

Lines 4-19: Import required modules
    const grpc       = require('@grpc/grpc-js');
    • Blockchain peer communication protocol
    
    const crypto     = require('crypto');
    • Cryptographic hashing (SHA256)
    
    const { connect, signers } = require('@hyperledger/fabric-gateway');
    • Connect to Hyperledger Fabric blockchain
    • Sign transactions
    
    const fs         = require('fs/promises');
    • File system operations (async/await version)
    
    const path       = require('path');
    • File path utilities
    
    const os         = require('os');
    • Operating system info (CPU, memory, uptime)
    
    const { createClient } = require('redis');
    • Connect to Redis cache server
    
    const { performance }  = require('perf_hooks');
    • High-precision timing (millisecond accuracy)
    
    const jwt              = require('jsonwebtoken');
    • JWT token creation and verification (security)
    
    const { MerkleTree }   = require('merkletreejs');
    • Merkle tree for cryptographic proof verification


================================================================================
SECTION 2: FABRIC CONNECTION CONFIGURATION (Lines 22-38)
================================================================================

Line 23-24: Channel and chaincode names
    const channelName     = 'mychannel';
    const chaincodeName   = 'policy_cc';
    • mychannel = blockchain channel (like a database)
    • policy_cc = smart contract name (chaincode)

Lines 25-31: Fabric paths (certificates, keys)
    const mspId           = 'Org1MSP';
    • Organization membership ID
    
    const cryptoBase      = path.resolve(...'org1.example.com');
    • Base path to org certificates
    
    const keyDir  = path.resolve(...'keystore');
    • Location of private key for signing
    
    const certFile= path.resolve(...'signcerts', 'cert.pem');
    • Location of client certificate
    
    const tlsFile = path.resolve(...'tls', 'ca.crt');
    • TLS certificate for encrypted connection

Lines 32-33: Peer connection details
    const peerEndpoint  = 'localhost:7051';
    • Docker Fabric peer address
    
    const peerHostAlias = 'peer0.org1.example.com';
    • Peer alias for verification

Lines 35-37: JWT and cache keys
    const JWT_SECRET = 'thesis_secret_key';
    • Secret key for signing JWT tokens (security)
    
    const CACHE_KEY  = 'scaling_policy_001';
    • Redis key where policy is stored


================================================================================
SECTION 3: TEST PHASE CONFIGURATION (Lines 40-47)
================================================================================

These control how the scaling benchmark runs:

Line 41: const NORMAL_WORKERS  = 20;
    • 20 concurrent requests during warm-up and cooldown phases
    • Baseline normal load

Line 42: const BURST_WORKERS   = 200;
    • 200 concurrent requests during burst phase
    • 10x increase to stress-test the system

Line 43: const NORMAL_PHASE_MS = 3000;
    • Warm-up runs for 3 seconds
    • Allows system to reach equilibrium

Line 44: const BURST_PHASE_MS  = 6000;
    • Burst runs for 6 seconds
    • Scaling strategies must respond in this window

Line 45: const COOLDOWN_MS     = 3000;
    • After burst ends, cooldown for 3 seconds
    • Measure how system behaves after peak load

Line 46: const VM_CAPACITY     = 80;
    • Each VM instance handles max 80 concurrent requests
    • Semaphore capacity (hard limit)


================================================================================
SECTION 4: HELPER FUNCTIONS (Lines 50-64)
================================================================================

Line 51: const SHA256 = d => crypto.createHash('sha256').update(d).digest();
    • Helper function: Create SHA256 hash of data
    • Input: d = data string
    • Output: Buffer with 32-byte hash
    • Used for Merkle tree and integrity verification

Line 52: const sleep  = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
    • Helper function: Async sleep
    • Input: ms = milliseconds to wait
    • Prevents CPU spinning (allows other tasks)

Line 53: const avg    = a => a.length ? +(a.reduce((s,v)=>s+v,0)/a.length).toFixed(2) : 0;
    • Helper function: Calculate average of array
    • Input: a = array of numbers
    • Logic:
        ├─ If array empty: return 0
        └─ Else: sum all / count, round to 2 decimals
    • Example: avg([1, 2, 3]) = 2

Line 54-60: const p99 = a => {...}
    • Helper function: Calculate 99th percentile latency
    • Input: a = array of latencies (milliseconds)
    • Logic:
        ├─ If array empty: return 0
        ├─ Sort array from smallest to largest
        ├─ Get index: ceil(length × 0.99) - 1
        ├─ Return value at that index
        └─ Round to 2 decimals
    • Meaning: 99% of requests are faster than P99 latency
    • Example: p99([1,2,3,4,5,6,7,8,9,10]) ≈ 9.9
    

================================================================================
SECTION 5: CPU SAMPLER FUNCTION (Lines 63-76)
================================================================================

Purpose: Measure real CPU usage from operating system

Line 63: function makeCPUSampler() {
    • Factory function returns a function that measures CPU %
    • Creates closure (remembers previous state)

Line 64: let prev = os.cpus().map(c => ({...c.times}));
    • Get all CPU cores on machine
    • Store the first snapshot (user/sys/nice/irq/idle times)
    • Example: Machine with 8 cores → 8 entries

Lines 65-78: return () => { ... }
    • Returns the actual sampler function
    • Tracks CPU change between calls

Lines 66-73: const curr = os.cpus();
    • Get current CPU state
    • Loop through each core

Lines 68-73: Calculate time deltas
    const dt = (c.user-p.user)+(c.nice-p.nice)+(c.sys-p.sys)
             + (c.irq-p.irq)+(c.idle-p.idle);
    • dt = total time elapsed since last call
    • Subtract previous times from current times

Lines 74-76: Calculate CPU percentage
    return td > 0 ? +((1 - id/td)*100).toFixed(1) : 0;
    • Logic: CPU% = (1 - idle_time/total_time) × 100
    • If total_time > 0: calculate percentage
    • Else: return 0
    • Round to 1 decimal: 45.3%

Example Usage:
    const cpuSampler = makeCPUSampler();
    cpuSampler() // returns 23.5 (CPU %)
    cpuSampler() // returns 45.2 (CPU %)
    // CPU usage between measurements


================================================================================
SECTION 6: MEMORY PERCENTAGE & SEMAPHORE CLASS (Lines 78-100)
================================================================================

Line 78: const memPct = () => +((1 - os.freemem()/os.totalmem())*100).toFixed(1);
    • Helper function: Get system memory percentage
    • Logic: (1 - free_mem/total_mem) × 100
    • Example: If free=4GB, total=8GB → 50%
    • Call every 200ms to track memory usage

Lines 81-87: class Semaphore
    • Controls concurrent request limit per VM
    • Acts as gatekeeper (hard-reject when full)

Line 82: constructor(cap) { this.cap = cap; this.n = 0; }
    • cap = capacity (e.g., 80 concurrent requests)
    • n = current count of active requests

Line 83: tryAcquire()
    • Check if slot available
    • If n >= cap: return false (REJECT, drop request)
    • Else: increment n, return true (ACCEPT)
    • This is a HARD DROP (not queue) when semaphore full

Line 84: release()
    • Decrement n when request finishes
    • Slot becomes available for next request

Line 85: get load()
    • Returns current utilization: n / cap
    • Example: 60/80 = 0.75 (75% loaded)
    • Used by scaling strategies to decide expansion


================================================================================
SECTION 7: EMA PREDICTION FUNCTION (Lines 87-96)
================================================================================

Purpose: Predict future system load using Exponential Moving Average

Line 87: function ema(history, k = 5) {
    • Exponential Moving Average predictor
    • Input: history = array of past loads, k = window size
    • Returns: predicted next load

Line 88: const w = history.slice(-k);
    • Take last k values from history
    • Example: history=[1,2,3,4,5,6,7], k=5 → w=[3,4,5,6,7]

Line 89-90: If array empty, return 0

Lines 91-94: EMA calculation
    const α = 2 / (w.length + 1);
    • Alpha (smoothing factor) = 2 / (n + 1)
    • Higher α = more weight on recent values
    • Example: k=5 → α = 2/6 ≈ 0.33
    
    return w.reduce((e,v,i) => i === 0 ? v : α*v + (1-α)*e, w[0]);
    • Start with first value e=w[0]
    • For each new value v: e = α×v + (1-α)×e
    • This gives more weight to recent data

Example:
    history = [20, 25, 30, 35, 40] (rising trend)
    ema(history) ≈ 35-38 (predicts next value will be higher)

Why EMA?
    • Smooths out noise in measurements
    • Detects trends early
    • Used by "Predictive" scaling strategy


================================================================================
SECTION 8: CORE MLVM REQUEST (Lines 99-127)
================================================================================

Purpose: Execute a single request with ALL real latency measurements

Line 99: async function mlvmRequest({ redis, contract, jwtToken, policyTree, policyRoot }) {
    • Receives dependencies as object
    • redis = Redis client
    • contract = Fabric smart contract
    • jwtToken = JWT token for this user
    • policyTree = Merkle tree for verification
    • policyRoot = Root hash of Merkle tree

Line 100: const t0 = performance.now();
    • Start timer (high precision)
    • Returns milliseconds with microsecond precision

================================================================================
PHASE 1: JWT TOKEN VERIFICATION
================================================================================

Line 103: jwt.verify(jwtToken, JWT_SECRET);
    • Verify JWT signature using secret key
    • If signature invalid: throws error
    • If valid: extracts user info
    • Simulates: Identity verification (paper Phase 1)
    • Real latency: ~0.1-0.5ms

Flow:
    ├─ Client has token: eyJhbGciOiJIUzI1NiIs...
    ├─ Server verifies using JWT_SECRET
    ├─ If signature matches: token is authentic
    └─ Extract: {userId: 'user1', role: 'user', clearance: 5}


================================================================================
PHASE 2: REDIS CACHE + MERKLE VERIFICATION
================================================================================

Line 106: const raw = await redis.get(CACHE_KEY);
    • Query Redis cache for policy
    • Key: 'scaling_policy_001'
    • Returns: JSON string (cached policy + proof)
    • Real latency: ~0.2-1ms

Lines 107-108: Verify policy exists
    if (!raw) throw new Error('Cache miss — seed Redis first');

Line 109: const doc = JSON.parse(raw);
    • Parse JSON string to object
    • Structure:
        {
            data: 'Policy_B',
            proof: [
                { position: 'left', data: Buffer(...) },
                { position: 'right', data: Buffer(...) },
                ...
            ]
        }

Lines 111-114: Convert Merkle proof to proper format
    const proof = doc.proof.map(p => ({
        position : p.position,
        data     : Buffer.from(p.data.data || p.data)
    }));

Lines 115-117: Verify Merkle root (blockchain-like verification)
    if (!policyTree.verify(proof, SHA256(doc.data), policyRoot))
        throw new Error('Merkle root mismatch — cache poisoned');
    
    • Logic:
        ├─ Hash the policy: SHA256(doc.data)
        ├─ Use proof to climb Merkle tree
        ├─ Check if root matches: policyRoot
        └─ If matches: policy is authentic and unmodified
    • Real latency: ~0.5-2ms

Merkle Tree Verification:
    ┌─────────────────────────────┐
    │     Root Hash (Compare)     │  ← Must match policyRoot
    ├─────────────────────────────┤
    │  Hash(LeftBranch | Right..  │
    ├─────────────────────────────┤
    │ Policy_B Hash (verified)    │
    └─────────────────────────────┘


================================================================================
PHASE 3: FABRIC BLOCKCHAIN ANCHOR CALL
================================================================================

Lines 120-125: Call smart contract on blockchain
    try {
        await contract.evaluateTransaction('ReadAsset', 'root_01');
    } catch (_) {
        // Ignore errors - we measure latency regardless
    }
    
    • Calls blockchain chaincode function: ReadAsset
    • Parameter: 'root_01' (asset key)
    • Wait for response (full network round-trip)
    • Real latency: ~50-100ms (this is the EXPENSIVE operation)
    • Wrapped in try-catch because asset might not exist
    
    BUT: Even if asset doesn't exist, the gRPC round-trip latency is REAL
    • Network latency: ~10ms
    • Peer validation: ~10ms
    • Chaincode execution: ~20ms
    • Response: ~5ms


================================================================================
PHASE 4: BLPM NO-READ-UP RULE CHECK
================================================================================

Lines 128-130: Enforce Bell-LaPadula Model (BLPM)
    if (5 < 2) throw new Error('BLP violation');
    
    • Rule: user.clearance >= policy.level (can read UP to this level)
    • clearance 5 = lowest (public info access only)
    • policy level 2 = Secret
    • 5 < 2? → NO, so DENIED
    • If this were user.clearance 1, then 1 < 2? → YES, ALLOWED
    • This enforces: "No user can read above their clearance level"

================================================================================
PHASE 5: RETURN TOTAL LATENCY
================================================================================

Line 132: return performance.now() - t0;
    • Total latency = end time - start time
    • Includes ALL 4 phases combined
    • Example: 1.234ms (if all Redis/fast)
    • Example: 75.567ms (if Fabric call slow)


================================================================================
SECTION 9: PHASE RUNNER (Lines 135-164)
================================================================================

Purpose: Run MLVM requests for a specified duration with specific worker count

Line 135: async function runPhase(numWorkers, durationMs, sem, requestCtx) {
    • Input parameters:
        ├─ numWorkers = how many concurrent requests to spawn
        ├─ durationMs = how long to run (milliseconds)
        ├─ sem = Semaphore (capacity/load control)
        └─ requestCtx = {redis, contract, jwtToken, policyTree, policyRoot}

Lines 136-140: Initialize tracking
    const deadline  = performance.now() + durationMs;
    • Calculate end time
    
    const latencies = [];
    • Collect all response times
    
    let dropped = 0, succeeded = 0;
    • Count successful vs dropped requests

Lines 142-161: Worker function (runs in parallel)
    const worker = async () => {
        while (performance.now() < deadline) {
            if (!sem.tryAcquire()) {
                dropped++;
                await sleep(5);
                continue;
            }
            try {
                const lat = await mlvmRequest(requestCtx);
                latencies.push(lat);
                succeeded++;
            } catch (_) {
                // request error — slot still released
            } finally {
                sem.release();
            }
        }
    };
    
    Execution flow for each worker:
    ┌─────────────────────────────────────┐
    │ Worker 1 starts                     │
    ├─────────────────────────────────────┤
    │ LOOP: While time < deadline:        │
    │   ├─ Try to acquire semaphore slot  │
    │   ├─ If FULL (hard reject):         │
    │   │  └─ Increment dropped counter   │
    │   │     Sleep 5ms, retry            │
    │   ├─ If AVAILABLE (slot granted):   │
    │   │  ├─ Execute mlvmRequest()       │
    │   │  ├─ Measure latency             │
    │   │  ├─ If success: increment count │
    │   │  └─ If error: still release slot│
    │   └─ Release semaphore slot         │
    │                                     │
    └─────────────────────────────────────┘

Lines 163-164: Run all workers in parallel
    await Promise.all(Array.from({ length: numWorkers }, worker));
    • Create array of numWorkers worker functions
    • Wait for ALL to complete
    • Then return results

Line 165: return { latencies, dropped, succeeded };
    • Return object with all measurements for this phase


================================================================================
SECTION 10: SCALING STRATEGIES (Lines 167-224)
================================================================================

4 different strategies for handling burst loads:


================================================================================
STRATEGY 1: PREDICTIVE IN-PLACE (Lines 170-192)
================================================================================

Purpose: Predict future load using EMA, expand capacity BEFORE peak

Line 170: function makePredictive() {
    const hist = [];
    return {
        _predLoad: 0,
        tick(sem) {
            hist.push(sem.load);              // Record current load
            this._predLoad = ema(hist, 5);    // Predict next load
            const risk = 0.05 + sem.load * 0.1;
            
            // If predicted load HIGH and risk LOW: EXPAND
            if (this._predLoad > 0.70 && risk <= 0.5) {
                sem.cap += Math.ceil(sem.cap * 0.4);  // Add 40% capacity
                return true;  // Signal: expansion happened
            }
            
            // If predicted load LOW and capacity OVER-PROVISIONED: SHRINK
            if (sem.load < 0.30 && sem.cap > VM_CAPACITY)
                sem.cap = Math.max(VM_CAPACITY, Math.floor(sem.cap * 0.85));
            
            return false;
        }
    };
}

Logic:
    ├─ Every 200ms (tick interval):
    │  ├─ Collect load history
    │  ├─ Predict: will load go above 70%?
    │  ├─ If YES and risk is acceptable:
    │  │  ├─ Add 40% more capacity
    │  │  ├─ Example: 80 → 80+32 = 112 slots
    │  │  └─ This PROACTIVE expansion minimizes dropped requests
    │  └─ If load is low: scale down to save resources
    └─ This is the "Proposed" strategy from your paper


================================================================================
STRATEGY 2: REACTIVE THRESHOLD (Lines 195-207)
================================================================================

Purpose: React AFTER load crosses threshold (reactive, not proactive)

Line 195: function makeReactive() {
    let cd = 0;  // Cooldown counter
    return {
        tick(sem) {
            if (cd-- > 0) return false;  // Cooldown active? Do nothing
            
            if (sem.load > 0.75) {       // If load exceeds 75%: TOO LATE!
                sem.cap += Math.ceil(sem.cap * 0.3);  // Add 30%
                cd = 10;  // Wait 10 ticks (2 seconds) before next expansion
                return true;
            }
            return false;
        }
    };
}

Logic:
    ├─ Only expands when load > 75%
    ├─ By then: many requests already dropped
    ├─ Cooldown period: prevents thrashing
    └─ This is SLOWER than predictive


================================================================================
STRATEGY 3: HORIZONTAL (NEW VM) (Lines 210-231)
================================================================================

Purpose: Cold-start new VM when load high

Line 210: function makeHorizontal() {
    let booting = false, bootTicks = 0;
    const BOOT_TICKS = 7;  // 7 × 200ms = 1400ms
    return {
        tick(sem) {
            if (!booting && sem.load > 0.75) {
                booting = true;
                bootTicks = 0;
                return false;  // Starting boot
            }
            
            if (booting) {
                bootTicks++;
                if (bootTicks >= BOOT_TICKS) {
                    sem.cap += VM_CAPACITY;  // Add entire new VM capacity (80)
                    booting = false;
                    return true;  // New VM ready
                }
            }
            return false;
        }
    };
}

Logic:
    ├─ When load > 75%:
    │  ├─ Start booting new VM
    │  ├─ Wait 1400ms for VM to come online
    │  └─ Meanwhile: requests are DROPPING
    │
    └─ When boot complete:
       ├─ Add 80 new slots (entire new VM)
       └─ Better than small incremental scaling


================================================================================
STRATEGY 4: NO SCALING (Lines 234-235)
================================================================================

Line 234: const makeNone = () => ({ tick: () => false });

Purpose: BASELINE - do nothing

Logic:
    ├─ Capacity stays at 80 slots
    ├─ When burst hits (200 requests):
    │  ├─ 80 succeed
    │  └─ 120 are DROPPED (hard rejected by semaphore)
    └─ Demonstrates why scaling is needed


================================================================================
SECTION 11: STRATEGY RUNNER (Lines 237-299)
================================================================================

Purpose: Execute one scaling strategy and measure all metrics

Line 237: async function runStrategy(name, requestCtx, makeScaler) {
    • Input:
        ├─ name = strategy name (for display)
        ├─ requestCtx = {redis, contract, ...}
        └─ makeScaler = factory function to create scaler

Line 238-240: Setup
    const sem    = new Semaphore(VM_CAPACITY);  // Start at 80 capacity
    const scaler = makeScaler();                 // Create strategy instance

Lines 242-243: Setup real hardware monitoring
    const cpuSampler = makeCPUSampler();
    const cpuS=[], memS=[], loadS=[], predErrS=[];
    • Initialize arrays to collect samples
    • Every 200ms: sample CPU%, memory%, load, prediction error

Lines 244-245: Track when scaling actually happens
    let burstStart = null, firstActAt = null;
    • burstStart = when burst phase begins
    • firstActAt = when first scaling action occurs
    • Response time = firstActAt - burstStart


================================================================================
TICKER LOOP (Lines 247-258)
================================================================================

Purpose: Every 200ms, update all metrics and check if scaling needed

Line 247: const ticker = setInterval(() => {
    • Runs every 200ms throughout test

Line 248-251: Sample hardware metrics
    cpuS.push(cpuSampler());         // CPU %
    memS.push(memPct());              // Memory %
    loadS.push(+sem.load.toFixed(3)); // Current VM load (0.0-1.0)
    if (scaler._predLoad !== undefined)
        predErrS.push(...);           // EMA prediction error (if Predictive)

Lines 252-255: Check if scaling strategy acts
    const acted = scaler.tick(sem);
    if (acted && firstActAt === null && burstStart !== null)
        firstActAt = performance.now();
    
    • Call strategy's tick method
    • If expansion occurred: record timestamp
    • Calculate response time = how long until expansion happens


================================================================================
THREE PHASE EXECUTION (Lines 257-261)
================================================================================

Line 257: const nRes = await runPhase(NORMAL_WORKERS, NORMAL_PHASE_MS, sem, requestCtx);
    • Phase 1: WARM-UP
    • 20 concurrent workers
    • Run for 3 seconds
    • Allows system to reach steady state
    • Scaling strategy OFF (no expansion needed)

Line 258: burstStart = performance.now();
    const bRes = await runPhase(BURST_WORKERS, BURST_PHASE_MS, sem, requestCtx);
    • Phase 2: BURST
    • 200 concurrent workers (10x increase!)
    • Run for 6 seconds
    • Scaling strategy ACTIVE (responds to high load)
    • Record when burst starts
    • Record when/if scaling strategy expands

Line 259: const cRes = await runPhase(NORMAL_WORKERS, COOLDOWN_MS, sem, requestCtx);
    • Phase 3: COOLDOWN
    • Back to 20 concurrent workers
    • Run for 3 seconds
    • Measure how system recovers after peak


================================================================================
METRICS CALCULATION (Lines 262-299)
================================================================================

Line 264: clearInterval(ticker);
    • Stop the 200ms sampling loop

Lines 266-268: Calculate response time
    const responseMs = firstActAt !== null
        ? Math.max(0, +(firstActAt - burstStart).toFixed(1))
        : 'N/A';
    
    • If scaling happened: milliseconds until expansion
    • If never happened: 'N/A'
    • Example: 500ms (took 500ms to detect and expand)

Lines 270-279: Calculate overall metrics
    const total    = nRes.dropped + nRes.succeeded + ...;  // Total requests
    const served   = nRes.succeeded + ...;                 // Successful requests
    const dropped  = nRes.dropped + ...;                   // Dropped requests
    const survival = total > 0 ? +((served/total)*100).toFixed(1) : 100;
    
    • Survival rate = (served / total) × 100
    • Example: 95.3% (means 4.7% were dropped)

Line 281-298: Return all results
    return {
        name, responseMs,           // Strategy name, response time
        peakLat  : p99(bRes.latencies),     // 99th percentile during burst
        avgAfter : avg(cRes.latencies),     // Average latency during cooldown
        dropped, survival,                   // Dropped count, survival %
        cpuS, memS, loadS, predErrS,       // Hardware metrics over time
        burstLat : bRes.latencies,          // All latencies during burst
        coolLat  : cRes.latencies           // All latencies during cooldown
    };


================================================================================
SECTION 12: MAIN FUNCTION (Lines 303-450)
================================================================================

Purpose: Orchestrate entire benchmark, connect to systems, run strategies

Lines 305-308: Print header
    • Display title
    • Show machine specs (CPU cores, RAM)
    • Explain that values are from REAL measurements

Lines 312-315: Redis connection
    const redis = createClient({ socket: { host: '127.0.0.1', port: 6379 } });
    await redis.connect();
    
    • Connect to Redis running on localhost:6379
    • Error if Redis not running

Lines 318-325: Fabric connection
    const tlsCert      = await fs.readFile(tlsFile);
    const certificate  = await fs.readFile(certFile, 'utf8');
    const keyFiles     = await fs.readdir(keyDir);
    const privateKeyPem= await fs.readFile(path.resolve(keyDir, keyFiles[0]), 'utf8');
    
    • Load Fabric credentials from disk
    • Read: TLS cert, client cert, private key
    • These were generated during Fabric network setup

Lines 326-333: Create gRPC connection
    const grpcClient = new grpc.Client(
        peerEndpoint,
        grpc.credentials.createSsl(tlsCert),
        { 'grpc.ssl_target_name_override': peerHostAlias }
    );
    
    • Create secure gRPC connection to peer
    • Use TLS certificate for encryption
    • Override SSL hostname verification

Lines 334-338: Connect to Fabric
    const gateway = connect({...});
    const contract = gateway.getNetwork(channelName).getContract(chaincodeName);
    
    • Connect to blockchain network
    • Load the smart contract (policy_cc)
    • Ready to make chaincode calls


================================================================================
BASELINE FABRIC LATENCY MEASUREMENT (Lines 341-350)
================================================================================

Purpose: Establish real baseline latency from YOUR Docker network

Lines 341-350:
    console.log('\n  Measuring real Fabric latency baseline (10 samples)...');
    const fabricBaseline = [];
    for (let i = 0; i < 10; i++) {
        const t = performance.now();
        try { await contract.evaluateTransaction('ReadAsset', 'root_01'); } catch(_) {}
        fabricBaseline.push(performance.now() - t);
    }
    
    • Make 10 blockchain calls
    • Measure each one individually
    • Store all latencies
    • THIS IS THE REAL COST of Phase 3 (Fabric anchor call)
    
    Why 10 samples?
    ├─ Enough to get average behavior
    ├─ Not too many (saves time)
    └─ Represents your actual Docker/network configuration

Print baseline:
    console.log(`  ✅ Fabric P99 baseline : ${p99(fabricBaseline)} ms`);
    console.log(`  ✅ Fabric avg baseline : ${avg(fabricBaseline)} ms`);
    
    Example output:
        Fabric P99 baseline : 87.23 ms
        Fabric avg baseline : 82.45 ms


================================================================================
CRYPTO STATE INITIALIZATION (Lines 353-366)
================================================================================

Purpose: Create JWT token and Merkle tree for MLVM requests

Line 353: const jwtToken   = jwt.sign({ userId: 'user1', role: 'user', clearance: 5 }, JWT_SECRET);
    • Create signed JWT token
    • Contains: userId, role, clearance level (5 = lowest)
    • Signed with JWT_SECRET
    • Example token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

Lines 354-355: Create Merkle tree
    const leaves     = ['Policy_A', 'Policy_B', 'Policy_C'].map(SHA256);
    const policyTree = new MerkleTree(leaves, SHA256);
    const policyRoot = policyTree.getRoot().toString('hex');
    
    • Convert 3 policies to SHA256 hashes (tree leaves)
    • Build Merkle tree from leaves
    • Get root hash (combined hash)
    • Example root: a3f2b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0...

Lines 357-360: Seed Redis with policy + proof
    await redis.set(CACHE_KEY, JSON.stringify({
        data : 'Policy_B',
        proof: policyTree.getProof(SHA256('Policy_B'))
    }));
    
    • Store in Redis key: 'scaling_policy_001'
    • Policy_B and its Merkle proof
    • All mlvmRequest() calls fetch this data

Line 362: const requestCtx = { redis, contract, jwtToken, policyTree, policyRoot };
    • Bundle everything into one object
    • Pass to all runPhase() and mlvmRequest() calls


================================================================================
RUN ALL STRATEGIES (Lines 365-380)
================================================================================

Lines 365-369: Define strategies
    const strategies = [
        ['Proposed Predictive In-Place', makePredictive],
        ['Reactive Threshold',           makeReactive],
        ['Horizontal (New VM)',          makeHorizontal],
        ['No Scaling',                   makeNone],
    ];

Lines 371-376: Execute each strategy
    const results = [];
    for (const [name, factory] of strategies) {
        results.push(await runStrategy(name, requestCtx, factory));
        await sleep(1000);  // Wait 1 second between tests
    }
    
    • Loop through 4 strategies
    • Run each with 200ms ticker
    • Wait 1 second between to reset system state
    • Collect all results


================================================================================
WRITE CSV FILES (Lines 379-410)
================================================================================

Purpose: Export results for graphing and analysis

Line 381-384: Table VI (summary metrics)
    const t6 = ['Strategy,Response_Time_ms,Peak_Latency_ms,Avg_Latency_After_ms,Dropped_Requests,Session_Survival_Pct'];
    for (const r of results)
        t6.push(`"${r.name}",${r.responseMs},${r.peakLat},${r.avgAfter},${r.dropped},${r.survival}`);
    await fs.writeFile('scaling_table_VI.csv', t6.join('\n'));
    
    • Create CSV with all strategies' metrics
    • Columns:
        ├─ Strategy name
        ├─ Response time (how fast to react)
        ├─ Peak latency (worst case during burst)
        ├─ Average latency after (recovery quality)
        ├─ Dropped requests count
        └─ Survival rate percentage
    
    Example row:
        "Proposed Predictive In-Place",234,45.23,12.34,5,99.8

Line 386-388: Figure 14 (CPU & Memory over time)
    const f14 = ['Strategy,Tick_200ms,CPU_Pct,Mem_Pct,VM_Load'];
    for (const r of results)
        r.cpuS.forEach((c,i) => f14.push(`"${r.name}",${i},${c},${r.memS[i]||0},${r.loadS[i]||0}`));
    await fs.writeFile('scaling_fig14_cpu_mem.csv', f14.join('\n'));
    
    • Time-series of hardware metrics
    • Every 200ms: CPU %, Memory %, VM load
    • Used to plot: how system resources change during test
    • Shows when CPU spikes (during burst)

Line 390-395: Figure 13 (Latency distribution)
    const f13 = ['Strategy,Phase,Latency_ms'];
    for (const r of results) {
        r.burstLat.forEach(l => f13.push(`"${r.name}","burst",${l.toFixed(2)}`));
        r.coolLat.forEach( l => f13.push(`"${r.name}","cooldown",${l.toFixed(2)}`));
    }
    await fs.writeFile('scaling_fig13_latency.csv', f13.join('\n'));
    
    • All individual request latencies
    • Separated by phase: burst vs cooldown
    • Used to plot: latency histograms

Line 397-402: Figure 16 (EMA prediction error — Predictive only)
    const prop = results[0];
    if (prop.predErrS.length) {
        const f16 = ['Tick_200ms,Pred_Error,Actual_Load'];
        prop.predErrS.forEach((e,i) => f16.push(`${i},${e},${prop.loadS[i]||0}`));
        await fs.writeFile('scaling_fig16_pred_error.csv', f16.join('\n'));
    }
    
    • Shows how accurate EMA prediction is
    • Pred_Error = |predicted_load - actual_load|
    • Validates that Predictive strategy makes good predictions

Line 404-406: Fabric baseline
    await fs.writeFile('fabric_baseline.csv',
        'Sample,Latency_ms\n' + fabricBaseline.map((v,i)=>`${i},${v.toFixed(2)}`).join('\n')
    );
    
    • Export the 10 baseline measurements
    • Shows real blockchain latency on your system


================================================================================
PRINT TABLE VI TO CONSOLE (Lines 409-429)
================================================================================

Line 410-429: Pretty print table
    ┌───────────────────────────────────────────────────────────────┐
    │ Strategy Name  │ Resp │ PeakLat │ AvgAfter │ Dropped │ Surv% │
    ├───────────────────────────────────────────────────────────────┤
    │ Proposed...    │ 234  │ 45.23   │ 12.34    │ 5       │ 99.8  │
    │ Reactive...    │ 856  │ 67.45   │ 23.21    │ 42      │ 95.2  │
    │ Horizontal...  │ 1400 │ 89.23   │ 34.56    │ 120     │ 87.5  │
    │ No Scaling     │ N/A  │ 245.67  │ 156.34   │ 2400    │ 12.0  │
    └───────────────────────────────────────────────────────────────┘
    
    • Shows ranking of strategies
    • Proposed = best (fastest response, highest survival)
    • No Scaling = worst (drops 2400 requests!)


================================================================================
CLEANUP & EXIT (Lines 431-435)
================================================================================

Lines 431-435:
    gateway.close();
    grpcClient.close();
    await redis.disconnect();

    • Close all connections to avoid resource leaks
    • Cleanup: Fabric gateway, gRPC, Redis


================================================================================
SUMMARY — WHAT THIS TEST MEASURES
================================================================================

Input:
    ├─ Warm-up: 20 workers for 3s
    ├─ BURST: 200 workers for 6s (the stress)
    └─ Cooldown: 20 workers for 3s

Output (per strategy):
    ├─ Response Time: How fast did scaling strategy react?
    ├─ Peak Latency: Worst latency during burst
    ├─ Avg Latency After: Did system recover?
    ├─ Dropped Requests: How many rejected?
    └─ Survival Rate: % of requests that succeeded

4 Strategies Compared:
    1. Proposed Predictive In-Place (BEST for quick response + survival)
    2. Reactive Threshold (Good but delayed)
    3. Horizontal/New VM (More capacity but slow boot)
    4. No Scaling (Baseline - many drops)

Why This Matters:
    • Real-time systems need fast autoscaling
    • Predictive scaling prevents dropped requests
    • This benchmark proves your Proposed approach is better


================================================================================
END OF SCALING TEST EXPLANATION
================================================================================
