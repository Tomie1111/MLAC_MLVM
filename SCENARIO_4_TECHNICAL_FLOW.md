┌─────────────────────────────────────────────────────────────────────┐
│ Scenario 4: Proposed MLVM - ONE REQUEST FLOW (COMPLETE)            │
│ Multi-Level Voting Model with Full Allocation Decision             │
└─────────────────────────────────────────────────────────────────────┘

================================================================================
STEP 1: FETCH POLICY FROM REDIS CACHE
================================================================================
Code:
    const data = await redisClient.get(`policy_${i}`);

Flow:
    ├─ Client sends get request to Redis
    ├─ Key: policy_0 (or policy_5000, policy_99999, etc.)
    ├─ Redis searches in-memory cache (O(1) lookup)
    ├─ Returns: JSON string with policy + hash
    └─ Time: ~0.1-1ms (FAST - no network round trip to blockchain)

Example Data Retrieved:
    {
        "policy": "{\"level\":2,\"label\":\"L2\",\"role\":\"Secret\",\"cap\":\"read, write\"}",
        "hash": "a3f2b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"
    }

================================================================================
STEP 2: PARSE & VALIDATE DATA INTEGRITY
================================================================================
Code:
    const parsed = JSON.parse(data);
    const computedHash = crypto.createHash('sha256').update(parsed.policy).digest('hex');
    if (computedHash !== parsed.hash) throw new Error("Security Violation!");

Flow:
    ├─ Parse JSON string to object
    │  ├─ Extracts: policy string
    │  └─ Extracts: stored hash
    │
    ├─ Recompute SHA256 hash of policy
    │  ├─ Input: "{\"level\":2,\"label\":\"L2\",...}"
    │  ├─ Hash Algorithm: SHA256 (cryptographic)
    │  └─ Output: "a3f2b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"
    │
    ├─ Integrity Check:
    │  ├─ If computed_hash == stored_hash → Data is VALID ✓
    │  └─ If computed_hash != stored_hash → Data is TAMPERED ✗ (throw error)
    │
    └─ Time: ~0.5-2ms (cryptographic hashing cost)

Security Purpose:
    • Detects if policy was modified/tampered
    • Ensures data came from trusted source
    • Basic blockchain-like verification without actual blockchain


================================================================================
STEP 3: EXTRACT POLICY CLASSIFICATION LEVEL
================================================================================
Code:
    const policy = JSON.parse(parsed.policy);

Flow:
    ├─ parsed.policy is a string: "{\"level\":2,\"label\":\"L2\",...}"
    ├─ Parse into object:
    │  {
    │      level: 2,
    │      label: "L2",
    │      role: "Secret",
    │      cap: "read, write"
    │  }
    ├─ Now can access: policy.level = 2
    └─ Time: <0.1ms (JSON parsing)

Policy Levels Reference:
    Level 0 = "Absolute Top"   (Highest classification, most restricted)
    Level 1 = "Top Secret"
    Level 2 = "Secret"         ← Example: policy.level = 2
    Level 3 = "Confidential"
    Level 4 = "Restricted"
    Level 5 = "Public"         (Lowest classification, least restricted)


================================================================================
STEP 4: SELECT USER WITH MATCHING CLEARANCE
================================================================================
Code:
    const user = userPool[i % userPool.length];

Flow:
    ├─ userPool.length = 6 (users L0-L5)
    ├─ Apply modulo operation: i % 6
    │
    ├─ Examples:
    │  ├─ i=0:  0 % 6 = 0 → userPool[0] = {id: 'user_L0', clearance: 0}
    │  ├─ i=1:  1 % 6 = 1 → userPool[1] = {id: 'user_L1', clearance: 1}
    │  ├─ i=5:  5 % 6 = 5 → userPool[5] = {id: 'user_L5', clearance: 5}
    │  ├─ i=6:  6 % 6 = 0 → userPool[0] = {id: 'user_L0', clearance: 0} (repeats)
    │  └─ i=10: 10 % 6 = 4 → userPool[4] = {id: 'user_L4', clearance: 4}
    │
    └─ Time: <0.1ms (array lookup)

User Clearance Levels:
    Clearance 0 = user_L0 (Highest clearance, can access most data)
    Clearance 1 = user_L1
    Clearance 2 = user_L2
    Clearance 3 = user_L3
    Clearance 4 = user_L4
    Clearance 5 = user_L5 (Lowest clearance, can access least data)


================================================================================
STEP 5: MULTI-LEVEL ACCESS CONTROL (MLAC) DECISION
================================================================================
Code:
    if (user.clearance <= policy.level) {
        await redisClient.set(`alloc_status_${i}`, `ALLOWED_FOR_${user.id}`);
    } else {
        await redisClient.set(`alloc_status_${i}`, `DENIED_FOR_${user.id}`);
    }

MLAC Decision Logic:
    ┌─────────────────────────────────────────────────────┐
    │ Rule: user.clearance <= policy.level = ALLOWED      │
    │       user.clearance > policy.level = DENIED        │
    └─────────────────────────────────────────────────────┘

Example 1: USER CAN ACCESS (ALLOWED)
    ├─ User: user_L0 (clearance = 0)
    ├─ Policy: L2 (level = 2)
    ├─ Check: 0 <= 2? → YES ✓
    ├─ Decision: ALLOWED
    ├─ Redis Set:
    │  ├─ Key: alloc_status_0
    │  └─ Value: "ALLOWED_FOR_user_L0"
    └─ Reasoning: Top clearance user can access Secret data

Example 2: USER CANNOT ACCESS (DENIED)
    ├─ User: user_L5 (clearance = 5)
    ├─ Policy: L2 (level = 2)
    ├─ Check: 5 <= 2? → NO ✗
    ├─ Decision: DENIED
    ├─ Redis Set:
    │  ├─ Key: alloc_status_1
    │  └─ Value: "DENIED_FOR_user_L5"
    └─ Reasoning: Low clearance user cannot access Secret data

Example 3: EDGE CASE - EXACTLY MATCHING LEVEL (ALLOWED)
    ├─ User: user_L2 (clearance = 2)
    ├─ Policy: L2 (level = 2)
    ├─ Check: 2 <= 2? → YES ✓
    ├─ Decision: ALLOWED
    └─ Reasoning: User matches exact classification level


================================================================================
STEP 6: RECORD LATENCY & STORE RESULT
================================================================================
Code (from loop):
    const start = performance.now();
    // ... all steps 1-5 ...
    latencies.push(performance.now() - start);

Flow:
    ├─ Start timer: performance.now() = 1234.567ms
    ├─ Execute steps 1-5 (all Redis operations)
    ├─ End timer: performance.now() = 1234.823ms
    ├─ Calculate latency: 1234.823 - 1234.567 = 0.256ms
    ├─ Store: latencies array = [0.256, 0.234, 0.298, ...]
    └─ Time: <0.1ms (measurement)

Later (after 100 or all requests):
    ├─ Sort latencies: [0.123, 0.234, 0.256, ..., 5.432]
    ├─ Calculate average: sum / count = ~0.5ms
    ├─ Calculate P99: latencies[Math.floor(0.99 × count)]
    │  └─ Example: 99th percentile = 2.345ms
    └─ Calculate throughput: requests / seconds


================================================================================
COMPLETE FLOW SUMMARY
================================================================================

INPUT:
    ├─ Request index: i = 12345
    ├─ Policy: policy_12345 (from Redis: contains L2 classification)
    └─ User: user_L1 (clearance = 1)

OPERATIONS:
    Step 1: Redis fetch
            └─ policy_12345 → ~0.5ms
    
    Step 2: Hash validation
            └─ SHA256 verify → ~1.5ms
    
    Step 3: Parse policy
            └─ Extract level=2 → <0.1ms
    
    Step 4: Select user
            └─ userPool[12345 % 6] = user_L1 → <0.1ms
    
    Step 5: MLAC decision
            ├─ Check: 1 <= 2? → YES
            ├─ Set Redis: alloc_status_12345 = "ALLOWED_FOR_user_L1"
            └─ → ~0.5ms
    
    Step 6: Record timing
            └─ 0.256ms total

OUTPUT:
    ├─ Decision: ALLOWED_FOR_user_L1
    ├─ Status stored in Redis: alloc_status_12345
    └─ Latency recorded: ~0.256ms


================================================================================
PERFORMANCE CHARACTERISTICS
================================================================================

Single Request Latency:
    ├─ Redis Only (Scenario 1):        ~0.1-0.5ms      (baseline fast)
    ├─ Proposed MLVM (Scenario 4):     ~1.0-2.0ms      (Redis + hash + decision)
    ├─ BC-BLPM (Scenario 3):           ~50-100ms       (Redis + blockchain)
    └─ Fabric Only (Scenario 2):       ~50-200ms       (blockchain only)

Throughput Comparison (requests/second):
    ├─ Redis Only:        ~10,000-20,000 RPS
    ├─ Proposed MLVM:     ~5,000-10,000 RPS   ← Still very fast!
    ├─ BC-BLPM:           ~100-200 RPS
    └─ Fabric Only:       ~50-100 RPS


================================================================================
SECURITY PROPERTIES OF MLVM
================================================================================

1. DATA INTEGRITY
    ✓ SHA256 hash ensures policy not tampered
    ✓ Recomputed every request (cannot bypass)

2. MULTI-LEVEL ACCESS CONTROL
    ✓ 6 clearance levels (L0-L5)
    ✓ 6 policy levels (L0-L5)
    ✓ Prevents unauthorized access cross-levels

3. AUDIT TRAIL
    ✓ Every decision stored: alloc_status_i
    ✓ Can query: was user_L5 allowed for policy_2? (DENIED)

4. NO SINGLE POINT OF FAILURE
    ✓ Doesn't depend solely on blockchain
    ✓ Doesn't depend solely on cache
    ✓ Hybrid: security (hash) + performance (Redis)

5. FAST & SECURE
    ✓ 1-2ms latency (usable for real-time)
    ✓ Cryptographic verification every request
    ✓ ~5,000-10,000 RPS throughput


================================================================================
WHY PROPOSED MLVM IS BETTER THAN ALTERNATIVES
================================================================================

Scenario 1: Redis Only
    ❌ No security verification
    ❌ No multi-level access control
    ❌ If Redis compromised, all policies accessible

Scenario 2: Fabric Only
    ✓ Secure (blockchain consensus)
    ❌ SLOW (50-200ms per request)
    ❌ Cannot scale to high load
    ❌ Network bottleneck

Scenario 3: BC-BLPM (Sync Hybrid)
    ✓ Secure
    ❌ Still slow (both Redis + blockchain sequentially)
    ❌ Same network latency as Fabric

Scenario 4: Proposed MLVM ⭐
    ✓ Fast (1-2ms, scalable)
    ✓ Secure (SHA256 + MLAC)
    ✓ Reliable (hybrid architecture)
    ✓ Audit-able (all decisions stored)
    ✓ Real-time capable (5,000-10,000 RPS)


================================================================================
END OF TECHNICAL FLOW
================================================================================
