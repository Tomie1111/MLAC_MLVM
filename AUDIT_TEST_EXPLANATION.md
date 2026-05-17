================================================================================
AUDIT TEST (auditTest.js) — COMPLETE EXPLANATION
================================================================================
This file tests 4 audit logging systems against 4 types of attacks:
modification, deletion, insertion, and replay attacks.

================================================================================
SECTION 1: IMPORTS & CONFIGURATION (Lines 1-35)
================================================================================

**Imports:**
- grpc, crypto, fabric-gateway: Blockchain connection
- fs, path, os: File system operations
- redis: Cache client
- performance: Timing measurements
- merkletreejs: Merkle tree for proofs

**Config:**
- Fabric connection: localhost:7051, mychannel, policy_cc
- PHYSICAL_DATA_FILE: './physical_system_logs.json' (real audit data)
- BENCH_ITERATIONS: 5 (real blockchain calls per test)
- BATCH_SIZES: [10, 50, 100] (for batching)

================================================================================
SECTION 2: HELPER FUNCTIONS (Lines 38-50)
================================================================================

**SHA256(data):** Creates cryptographic hash
**SHA256hex(data):** Returns hash as hex string

**p99(arr):** Calculates 99th percentile latency
- Sorts array ascending
- Returns value at 99% position
- Example: p99([1,2,3,4,5]) ≈ 5

================================================================================
SECTION 3: REAL DATA PREPARATION (Lines 53-70)
================================================================================

**preparePhysicalData():**
- Loads real audit records from JSON file
- Stores in realDataStore array
- Used for realistic testing

**getRealRecord(override):**
- Returns next record from data store
- Cycles through records (cursor++)
- Adds missing fields (vm, token) if needed
- Applies overrides for testing

**extractHashFromFabricResponse(rawBuffer):**
- Parses blockchain response to extract hash
- Handles different response formats
- Returns hash or null if invalid

================================================================================
SECTION 4: CRYPTOGRAPHIC CLASSES (Lines 73-95)
================================================================================

**HashChain Class:**
- Maintains chain of hashes for integrity
- **append(record):** Adds record with chained hash
- **verify():** Checks if chain is unbroken

**buildMerkleTree(hashes):** Creates Merkle tree from hash array
**verifyMerkleProof(tree, leaf, proof, root):** Verifies Merkle proof

================================================================================
SECTION 5: AUDIT SYSTEM IMPLEMENTATIONS
================================================================================

================================================================================
SYSTEM 1: PLAIN CENTRALIZED LOG (Lines 98-102)
================================================================================

**Class: PlainCentralizedLog**
- **write(record):** Just stores in array (no security)
- **verify(idx):** Always returns {ok: true} (trusts database)

**Security:** NONE - completely vulnerable to all attacks

================================================================================
SYSTEM 2: HASH CHAIN ONLY (Lines 105-115)
================================================================================

**Class: HashChainOnlyLog**
- **write(record):** Appends to hash chain
- **verify():** Checks if hash chain is intact

**Security:** 
- Detects modification (hash changes)
- Detects deletion (chain breaks)
- Cannot detect insertion (chain still valid)
- No replay protection

================================================================================
SYSTEM 3: FULL ON-CHAIN LOG (Lines 118-145)
================================================================================

**Class: FullOnChainLog**
- **write(record):**
  - Computes SHA256 hash of record
  - Stores hash on blockchain via CreateAsset/UpdateAsset
  - Returns hash

- **verify(record):**
  - Reads hash from blockchain (evaluateTransaction)
  - Compares with current record hash
  - Returns verification result

**Security:**
- Immutable (blockchain)
- Detects all modifications
- Detects deletions (record missing from chain)
- Detects insertions (fake records not on chain)
- Slow (every write/read hits blockchain)

================================================================================
SYSTEM 4: PROPOSED MLVM AUDIT LAYER (Lines 148-205)
================================================================================

**Class: ProposedAuditLayer (Redis + Merkle + Fabric)**
- **Constructor:** Takes Redis client and Fabric contract
- **buffer:** Batches records before anchoring
- **batchMap:** Maps eventId → batchId for lookups

**write(record):**
1. Appends to local hash chain
2. Adds to buffer with hash
3. Stores in Redis: `audit:${eventId}` → {record, hi}
4. Returns hash

**flushBatch():**
1. Creates Merkle tree from buffered hashes
2. Gets Merkle root
3. Stores root on blockchain (CreateAsset)
4. Stores Merkle proofs in Redis for each record
5. Clears buffer

**verify(eventId):**
1. Gets record from Redis
2. Checks if proof exists
3. Verifies record hash matches stored hi
4. Gets batchId from batchMap
5. Reads Merkle root from blockchain
6. Verifies Merkle proof against root
7. Returns verification result

**Security:**
- Fast writes (Redis)
- Batched anchoring (Merkle + Fabric)
- Detects all attacks
- Balances performance/security

================================================================================
SECTION 6: ATTACK INJECTORS (Lines 208-214)
================================================================================

**attackModifyRedisRecord(redis, eventId, field, newValue):**
- Modifies a field in Redis-stored audit record
- Used to simulate tampering attacks

================================================================================
SECTION 7: BENCHMARK RUNNER (Lines 217-250)
================================================================================

**runAuditBenchmark(scenarioName, attackDetail, systems):**
- Tests all 4 systems against one attack scenario
- For each system:
  ├─ Setup attack scenario
  ├─ Test detection (1 sample)
  ├─ Run 5 real iterations with timing
  ├─ Calculate detection rate and P99 latency
- Collects results for CSV

================================================================================
SECTION 8: MAIN TEST SUITE — 4 ATTACK TESTS
================================================================================

================================================================================
TEST 1: LOG MODIFICATION ATTACK
================================================================================

**Attack:** Changes record field (e.g., action: 'login' → 'hacked')

**Systems Response:**

**Plain Log:**
- Setup: Modify store[0].action = 'hacked'
- Verify: Always ok (no check)
- **Result:** detected = false (missed)

**HashChain Only:**
- Setup: Modify record, break chain
- Verify: Chain broken
- **Result:** detected = true (caught)

**Full OnChain:**
- Setup: Write real record, then verify modified version
- Verify: Hash mismatch with blockchain
- **Result:** detected = true (caught)

**Proposed MLVM:**
- Setup: Write record, flush batch, then modify Redis
- Verify: Merkle proof fails
- **Result:** detected = true (caught)

================================================================================
TEST 2: LOG DELETION ATTACK
================================================================================

**Attack:** Removes record from storage

**Systems Response:**

**Plain Log:**
- Setup: Remove from store array
- Verify: No check
- **Result:** detected = false (missed)

**HashChain Only:**
- Setup: Remove entry from chain
- Verify: Chain verification fails
- **Result:** detected = true (caught)

**Full OnChain:**
- Setup: Write record to blockchain
- Verify: Check if record exists on chain
- **Result:** detected = true (immutable)

**Proposed MLVM:**
- Setup: Write record, flush batch, delete from Redis
- Verify: Missing from Redis
- **Result:** detected = true (caught)

================================================================================
TEST 3: LOG INSERTION ATTACK
================================================================================

**Attack:** Injects fake record into log

**Systems Response:**

**Plain Log:**
- Setup: No special setup
- Verify: Accepts everything
- **Result:** detected = false (missed)

**HashChain Only:**
- Setup: Add fake entry with broken hash
- Verify: Chain verification fails
- **Result:** detected = true (caught)

**Full OnChain:**
- Setup: Create fake record ID
- Verify: Record not found on blockchain
- **Result:** detected = true (caught)

**Proposed MLVM:**
- Setup: Write real record, add fake to Redis
- Verify: Fake record has no valid proof
- **Result:** detected = true (caught)

================================================================================
TEST 4: DUPLICATE/REPLAY ATTACK
================================================================================

**Attack:** Submits same record twice

**Systems Response:**

**Plain Log:**
- Setup: No check
- Verify: Accepts duplicates
- **Result:** detected = false (missed)

**HashChain Only:**
- Setup: No check
- Verify: Chain accepts duplicates
- **Result:** detected = false (missed)

**Full OnChain:**
- Setup: Write record once
- Verify: Try to write same ID again (fails)
- **Result:** detected = true (blockchain rejects dups)

**Proposed MLVM:**
- Setup: Write record
- Verify: Check if Redis key exists
- **Result:** detected = true (Redis prevents dups)

================================================================================
SECTION 9: CSV OUTPUT (Lines 352-356)
================================================================================

**Output:** real_audit_benchmark.csv
- Columns: Scenario, Detection_% and P99_ms for each system
- Example: "Test 1: Log Modification Attack",0.00,0.1234,100.00,1.2345,100.00,89.0123,100.00,2.3456

================================================================================
PERFORMANCE & SECURITY SUMMARY
================================================================================

**Detection Rates (Expected):**

| Attack Type | Plain | HashChain | FullOnChain | Proposed MLVM |
|-------------|-------|-----------|-------------|---------------|
| Modification| 0%   | 100%     | 100%       | 100%         |
| Deletion    | 0%   | 100%     | 100%       | 100%         |
| Insertion   | 0%   | 100%     | 100%       | 100%         |
| Replay      | 0%   | 0%       | 100%       | 100%         |

**Performance (P99 Latency):**

| System | Expected Latency | Why |
|--------|------------------|-----|
| Plain | ~0.1ms | Just array operations |
| HashChain | ~0.5ms | Hash computations |
| FullOnChain | ~80-150ms | Blockchain calls |
| Proposed MLVM | ~2-5ms | Redis + batched Fabric |

**Why Proposed MLVM is Best:**
- **100% Detection** of all attacks
- **Fast Performance** (Redis for reads, batched writes)
- **Scalable** (Merkle trees for batch verification)
- **Balanced** (security without full blockchain overhead)

================================================================================
END OF AUDIT TEST EXPLANATION
================================================================================