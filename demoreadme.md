# MLAC-MLVM Demo Test Guide

This guide shows the bash commands to test `demo.js` end to end with Keycloak, Hyperledger Fabric, Redis, VM allocation, scaling, and audit anchoring.

## System Stage Map

This is the demo flow and what each stage proves:

```text
Phase 1: Keycloak token
  Keycloak authenticates the user and gives an access token.
  API validates the token and extracts uid from preferred_username.

Phase 2: Fabric policy_cc
  Fabric chaincode stores the authoritative policy and Merkle root.
  /seed/:uid writes policy level, compartment, attrs, and root to Fabric.

Phase 2 cache path: Redis verified cache
  Redis caches policy for fast runtime validation.
  Cached policy is protected by MAC plus local Merkle-root recomputation.
  Redis is fast but untrusted; verification blocks tampering.

Phase 3: Dual-token validation
  Request uses Keycloak identity token first.
  If access is granted, API creates a VM-bound session token.
  Session token is bound to uid, VM id, Merkle root, IP, and device/User-Agent.

Phase 4: VM allocation
  API filters only secure candidate VMs.
  Checks BLP level, compartment, attrs, risk, and trust.
  Selects the lowest-score secure VM.

Phase 5: EMA predictor
  /predict uses real local MacBook CPU/RAM metrics.
  EMA predicts load and decides stable, scale up, or scale down.

Phase 6: Merkle audit + Fabric anchoring
  Yes, Phase 6 is Merkle audit plus Fabric anchoring.
  Logs are hashed, linked with a hash chain, grouped into a Merkle root,
  and the root is anchored on Fabric.

Attack demo
  Redis policy tamper changes cached policy and verification blocks it.
  Audit tamper changes a stored log and Merkle/hash-chain verification detects it.
  Replay test reuses a session token with a different device and gets blocked.
```

## Presentation Demo Script

Use this section when presenting the system. Each step has what to say and what to run.

### Step 0: Start The API

Say:

```text
First I start the MLAC-MLVM API. This API connects to Redis, Hyperledger Fabric, and Keycloak.
Fabric is the trusted policy source. Redis is the fast verified cache.
```

Run:

```bash
cd /Users/pannawatthawonwong/project-test
node demo.js
```

In another terminal, check health:

```bash
curl http://localhost:3000/health
```

Say:

```text
The health endpoint confirms that the API is running and connected to the required services.
```

### Step 1: Get A Keycloak Token

Say:

```text
The first security layer is identity. The user logs in through Keycloak.
This command asks Keycloak for an access token for user2.
The API will later verify this token and extract the username from it.
If the token expires, I run this same command again to get a fresh token.
```

Run:

```bash
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/mlac-realm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mlac-client" \
  -d "username=user2" \
  -d "password=1234" \
  -d "grant_type=password" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
```

Explain the command:

```text
TOKEN=... stores the access token into a shell variable.
curl sends username and password to Keycloak.
client_id=mlac-client tells Keycloak which client is requesting the token.
grant_type=password means this is a direct username/password login.
python3 extracts only the access_token field from the JSON response.
```

Check:

```bash
echo "$TOKEN"
```

If token fails:

```bash
curl -s -X POST "http://localhost:8080/realms/mlac-realm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mlac-client" \
  -d "username=user2" \
  -d "password=1234" \
  -d "grant_type=password"
```

Say:

```text
If access_token is missing, the user may not exist in Keycloak, the password may be wrong, or the password may still be temporary.
```

### Step 2: Seed The User Policy

Say:

```text
Now I create the authorization policy for the same user, user2.
This writes the policy into Fabric through policy_cc.
The policy contains the user's clearance level, compartment, and attributes.
Attributes are derived from the policy matrix, not manually typed.
```

Run:

```bash
curl -X POST http://localhost:3000/seed/user2 \
  -H "Content-Type: application/json" \
  -d '{"level":4,"compartment":"finance"}'
```

Explain the command:

```text
/seed/user2 means create or update the Fabric policy for uid=user2.
level=4 means L4 Restricted.
compartment=finance means the user can only access finance VMs.
The API derives attrs from the policy matrix. For L4, attrs becomes ["read"].
The API also computes a Merkle root and stores it with the policy in Fabric.
```

Expected:

```json
{
  "seeded": true,
  "policy": {
    "uid": "user2",
    "level": 4,
    "compartment": "finance",
    "attrs": ["read"]
  }
}
```

Say:

```text
This user is read-only. So read should be granted, but write should be denied.
```

### Step 3: Validate Read Access

Say:

```text
Now I request read access using the Keycloak token.
The API verifies the token, loads the policy, checks Redis/Fabric integrity,
checks BLP, compartment, attributes, and then allocates a secure VM.
```

Run:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"read"}'
```

Expected:

```json
{
  "allowed": true,
  "reason": "GRANTED",
  "uid": "user2",
  "source": "fabric-to-redis",
  "allocatedVM": {
    "id": "vm-finance-restricted-01"
  }
}
```

Say:

```text
The first request may show source=fabric-to-redis because the API fetches the policy from Fabric and prepares the Redis verified cache.
```

Run the same command again:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"read"}'
```

Say:

```text
The second request should show source=redis-verified.
This is the fast runtime path. Redis is used only after MAC and Merkle verification.
```

### Step 4: Validate Write Denial

Say:

```text
Now I try a write action with the same L4 user.
L4 has only the read attribute, so the system should deny the request.
It should also not allocate a VM.
```

Run:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"write"}'
```

Expected:

```json
{
  "allowed": false,
  "reason": "ATTRIBUTE_NOT_MATCH",
  "allocatedVM": null,
  "sessionToken": null
}
```

Say:

```text
This proves attribute-based authorization works.
A denied request does not receive a VM allocation or session token.
```

### Step 5: Demonstrate Dual Token And Replay Protection

Say:

```text
When access is granted, the API creates a second token: a VM session token.
This token is bound to the selected VM, the policy Merkle root, IP, and device/User-Agent.
If an attacker replays this session token from a different device string, the API blocks it.
```

Run:

```bash
SESSION_TOKEN=$(curl -s -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: legit-client" \
  -d '{"action":"read"}' | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r.get("sessionToken") or r)')
```

Normal use:

```bash
curl -X POST http://localhost:3000/access \
  -H "Content-Type: application/json" \
  -H "User-Agent: legit-client" \
  -d "{\"sessionToken\":\"$SESSION_TOKEN\"}"
```

Expected:

```json
{
  "access": "granted"
}
```

Replay attack:

```bash
curl -X POST http://localhost:3000/access \
  -H "Content-Type: application/json" \
  -H "User-Agent: attacker-client" \
  -d "{\"sessionToken\":\"$SESSION_TOKEN\"}"
```

Expected:

```json
{
  "error": "Device binding mismatch"
}
```

Say:

```text
The same session token is valid from the original device context, but rejected from a different device context.
This demonstrates replay/session-drift protection.
```

### Step 6: Demonstrate Redis Tamper Detection

Say:

```text
Redis is intentionally treated as untrusted.
Now I modify the cached policy in Redis without updating its MAC or Merkle root.
The next validation should detect tampering and reject the request.
```

Create cache:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"read"}'
```

Tamper:

```bash
curl -X POST http://localhost:3000/attack/redis-tamper/user2
```

Validate again:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"read"}'
```

Expected:

```json
{
  "error": "Redis tampering detected: local Merkle root mismatch"
}
```

Say:

```text
This proves the cache is fast but not trusted. A modified Redis entry is blocked by cryptographic verification.
```

### Step 7: Demonstrate Predictive Scaling

Say:

```text
The system also includes a resource-management phase.
It reads real local CPU and RAM data and applies EMA prediction to decide whether to scale.
```

Run:

```bash
curl http://localhost:3000/predict
```

Say:

```text
The response shows current CPU/RAM, normalized load, EMA predicted load, risk, capacity, and scaling action.
```

### Step 8: Demonstrate Merkle Audit And Fabric Anchoring

Say:

```text
Phase 6 is Merkle audit plus Fabric anchoring.
The API hashes logs, links them with a hash chain, builds a Merkle root, and anchors the root on Fabric.
```

Run:

```bash
AUDIT_ID=$(curl -s -X POST http://localhost:3000/audit/anchor \
  -H "Content-Type: application/json" \
  -d '{
    "logs": [
      {"uid":"user2","vm":"vm-finance-restricted-01","action":"read","decision":"GRANT","ts":1777400000001},
      {"uid":"user2","vm":"vm-finance-restricted-01","action":"write","decision":"DENY:ATTRIBUTE_NOT_MATCH","ts":1777400000002}
    ]
  }' | python3 -c 'import sys,json; print(json.load(sys.stdin)["auditId"])')
```

Verify:

```bash
curl http://localhost:3000/audit/verify/$AUDIT_ID
```

Expected:

```json
{
  "verified": true,
  "reason": "AUDIT_OK"
}
```

Tamper:

```bash
curl -X POST http://localhost:3000/attack/audit-tamper/$AUDIT_ID \
  -H "Content-Type: application/json" \
  -d '{"index":0,"action":"hacked-read"}'
```

Verify again:

```bash
curl http://localhost:3000/audit/verify/$AUDIT_ID
```

Expected:

```json
{
  "verified": false,
  "reason": "AUDIT_TAMPERED"
}
```

Say:

```text
This proves log tampering is detected because the recomputed hash-chain head and Merkle root no longer match the anchored batch.
```

## 1. Start Required Services

Make sure these services are already running:

- Keycloak: `http://localhost:8080`
- Redis: `localhost:6379`
- Hyperledger Fabric test network
- Chaincode: `policy_cc`

Then start the demo API from the project directory:

```bash
cd /Users/pannawatthawonwong/project-test
node demo.js
```

Expected startup output:

```text
Fabric connected
MLAC-MLVM full demo running at http://localhost:3000
```

## 2. Health Check

```bash
curl http://localhost:3000/health
```

Expected:

```json
{
  "api": "ok",
  "redis": "connected"
}
```

## 3. Check Policy Matrix

```bash
curl http://localhost:3000/policy-matrix
```

Expected levels:

```text
L0: read, write, exec, override
L1: read, write, exec
L2: read, write
L3: read, exec
L4: read
L5: view-only
```

## 4. Create User In Keycloak

Before testing `/validate`, the user must exist in Keycloak because the API reads the username from the Keycloak token.

In Keycloak Admin Console:

```text
Realm: mlac-realm
Users -> Add user
Username: user2
Save
Credentials -> Set password
Password: 1234
Temporary: Off
Save
```

## 5. Get Keycloak Token

```bash
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/mlac-realm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mlac-client" \
  -d "username=user2" \
  -d "password=1234" \
  -d "grant_type=password" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
```

Check that token exists:

```bash
echo "$TOKEN"
```

If this fails with `KeyError: access_token`, inspect the raw Keycloak response:

```bash
curl -s -X POST "http://localhost:8080/realms/mlac-realm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mlac-client" \
  -d "username=user2" \
  -d "password=1234" \
  -d "grant_type=password"
```

## 6. Seed A Policy

Seed `user2` as L4 Restricted finance user:

```bash
curl -X POST http://localhost:3000/seed/user2 \
  -H "Content-Type: application/json" \
  -d '{"level":4,"compartment":"finance"}'
```

Expected:

```json
{
  "seeded": true,
  "policy": {
    "uid": "user2",
    "level": 4,
    "compartment": "finance",
    "attrs": ["read"]
  }
}
```

## 7. Test Read Access

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"read"}'
```

Expected:

```json
{
  "allowed": true,
  "reason": "GRANTED"
}
```

## 8. Test Write Denial

L4 has only `read`, so `write` must fail.

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"write"}'
```

Expected:

```json
{
  "allowed": false,
  "reason": "ATTRIBUTE_NOT_MATCH",
  "allocatedVM": null,
  "sessionToken": null
}
```

## 9. Test L5 Public User

Seed user as L5 public:

```bash
curl -X POST http://localhost:3000/seed/user2 \
  -H "Content-Type: application/json" \
  -d '{"level":5,"compartment":"public"}'
```

Test read:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"read"}'
```

Expected:

```json
{
  "allowed": true,
  "reason": "GRANTED"
}
```

Test write:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"write"}'
```

Expected:

```json
{
  "allowed": false,
  "reason": "ATTRIBUTE_NOT_MATCH"
}
```

## 10. Test Session Token

First request read access and extract the VM session token:

```bash
SESSION_TOKEN=$(curl -s -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"read"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["sessionToken"])')
```

Then use the session token:

```bash
curl -X POST http://localhost:3000/access \
  -H "Content-Type: application/json" \
  -d "{\"sessionToken\":\"$SESSION_TOKEN\"}"
```

Expected:

```json
{
  "access": "granted"
}
```

## 11. Test Redis Tamper Detection

First validate once so Redis has a verified cache entry:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"read"}'
```

Tamper Redis policy:

```bash
curl -X POST http://localhost:3000/attack/redis-tamper/user2
```

Validate again:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"read"}'
```

Expected:

```json
{
  "error": "Redis tampering detected: local Merkle root mismatch"
}
```

## 12. Test Replay Attack Protection

The VM session token is bound to the request IP and User-Agent. A replay from a different device string should fail.

First get a valid session token:

```bash
curl -X POST http://localhost:3000/seed/user2 \
  -H "Content-Type: application/json" \
  -d '{"level":4,"compartment":"finance"}'

SESSION_TOKEN=$(curl -s -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: legit-client" \
  -d '{"action":"read"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["sessionToken"])')
```

Use it with the same User-Agent:

```bash
curl -X POST http://localhost:3000/access \
  -H "Content-Type: application/json" \
  -H "User-Agent: legit-client" \
  -d "{\"sessionToken\":\"$SESSION_TOKEN\"}"
```

Expected:

```json
{
  "access": "granted"
}
```

Replay it with a different User-Agent:

```bash
curl -X POST http://localhost:3000/access \
  -H "Content-Type: application/json" \
  -H "User-Agent: attacker-client" \
  -d "{\"sessionToken\":\"$SESSION_TOKEN\"}"
```

Expected:

```json
{
  "error": "Device binding mismatch"
}
```

This demonstrates replay/session-drift protection.

## 13. Test Privilege Escalation Protection

Seed `user2` as L5 public:

```bash
curl -X POST http://localhost:3000/seed/user2 \
  -H "Content-Type: application/json" \
  -d '{"level":5,"compartment":"public"}'
```

Try to write:

```bash
curl -X POST http://localhost:3000/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"write"}'
```

Expected:

```json
{
  "allowed": false,
  "reason": "ATTRIBUTE_NOT_MATCH",
  "allocatedVM": null
}
```

This demonstrates that a low-clearance/public user cannot escalate into write execution.

## 14. Test Predictive Scaling

```bash
curl http://localhost:3000/predict
```

Expected fields:

```json
{
  "metrics": {
    "cpuPercent": 0,
    "memPercent": 0,
    "normalizedLoad": 0
  },
  "prediction": {
    "emaPrediction": 0,
    "risk": 0,
    "capacity": 100,
    "action": "stable"
  }
}
```

## 15. Test Audit Anchoring

```bash
curl -X POST http://localhost:3000/audit/anchor \
  -H "Content-Type: application/json" \
  -d '{
    "logs": [
      {"uid":"user2","vm":"vm-public-01","action":"read","decision":"GRANT","ts":1777400000001},
      {"uid":"user2","vm":"vm-public-01","action":"write","decision":"DENY:ATTRIBUTE_NOT_MATCH","ts":1777400000002}
    ]
  }'
```

Expected:

```json
{
  "anchored": true,
  "auditId": "...",
  "logMerkleRoot": "0x...",
  "hashChainHead": "...",
  "logHashes": ["...", "..."]
}
```

## 16. Test Audit Log Tamper Detection

Create an anchored audit batch and store the `auditId`:

```bash
AUDIT_ID=$(curl -s -X POST http://localhost:3000/audit/anchor \
  -H "Content-Type: application/json" \
  -d '{
    "logs": [
      {"uid":"user2","vm":"vm-public-01","action":"read","decision":"GRANT","ts":1777400000001},
      {"uid":"user2","vm":"vm-public-01","action":"write","decision":"DENY:ATTRIBUTE_NOT_MATCH","ts":1777400000002}
    ]
  }' | python3 -c 'import sys,json; print(json.load(sys.stdin)["auditId"])')
```

Verify before tampering:

```bash
curl http://localhost:3000/audit/verify/$AUDIT_ID
```

Expected:

```json
{
  "verified": true,
  "reason": "AUDIT_OK"
}
```

Tamper one log entry in Redis:

```bash
curl -X POST http://localhost:3000/attack/audit-tamper/$AUDIT_ID \
  -H "Content-Type: application/json" \
  -d '{"index":0,"action":"hacked-read"}'
```

Verify again:

```bash
curl http://localhost:3000/audit/verify/$AUDIT_ID
```

Expected:

```json
{
  "verified": false,
  "reason": "AUDIT_TAMPERED"
}
```

This demonstrates log tamper detection through recomputed hashes, hash-chain head, and Merkle root.

## 17. Full L0-L5 Matrix Test

This tests all levels with `read`, `write`, `exec`, and `override`.

```bash
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/mlac-realm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=mlac-client" \
  -d "username=user2" \
  -d "password=1234" \
  -d "grant_type=password" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

for level in 0 1 2 3 4 5; do
  case $level in
    0|1|2|4) compartment=finance ;;
    3) compartment=hr ;;
    5) compartment=public ;;
  esac

  seed=$(curl -s -X POST http://localhost:3000/seed/user2 \
    -H "Content-Type: application/json" \
    -d "{\"level\":$level,\"compartment\":\"$compartment\"}")

  attrs=$(printf '%s' "$seed" | python3 -c 'import sys,json; print(",".join(json.load(sys.stdin)["policy"]["attrs"]))')

  echo "L$level compartment=$compartment attrs=$attrs"

  for action in read write exec override; do
    resp=$(curl -s -X POST http://localhost:3000/validate \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"action\":\"$action\"}")

    printf '%s' "$resp" | python3 -c 'import sys,json; r=json.load(sys.stdin); vm=r.get("allocatedVM") or {}; print("  {}: allowed={} reason={} vm={}".format(r.get("action"), r.get("allowed"), r.get("reason"), vm.get("id")))'
  done
done
```

Expected result:

```text
L0 attrs=read,write,exec,override
  read:  allowed=True
  write: allowed=True
  exec:  allowed=True
  override: allowed=True

L1 attrs=read,write,exec
  read:  allowed=True
  write: allowed=True
  exec:  allowed=True
  override: allowed=False reason=ATTRIBUTE_NOT_MATCH

L2 attrs=read,write
  read:  allowed=True
  write: allowed=True
  exec:  allowed=False reason=ATTRIBUTE_NOT_MATCH
  override: allowed=False reason=ATTRIBUTE_NOT_MATCH

L3 attrs=read,exec
  read:  allowed=True
  write: allowed=False reason=ATTRIBUTE_NOT_MATCH
  exec:  allowed=True
  override: allowed=False reason=ATTRIBUTE_NOT_MATCH

L4 attrs=read
  read:  allowed=True
  write: allowed=False reason=ATTRIBUTE_NOT_MATCH
  exec:  allowed=False reason=ATTRIBUTE_NOT_MATCH
  override: allowed=False reason=ATTRIBUTE_NOT_MATCH

L5 attrs=view-only
  read:  allowed=True
  write: allowed=False reason=ATTRIBUTE_NOT_MATCH
  exec:  allowed=False reason=ATTRIBUTE_NOT_MATCH
  override: allowed=False reason=ATTRIBUTE_NOT_MATCH
```

## 18. Important Notes

- Restart `node demo.js` after editing `demo.js`.
- If `/seed/user2` returns an old hardcoded `user1` policy, an old Node process is still running.
- If Keycloak token fails, confirm `user2` exists and password is non-temporary.
- The username in Keycloak must match the seeded policy uid.
- `view-only` is treated as `read` for L5.
- Denied requests should return `allocatedVM: null`.
- The first `/validate` after seeding may be slower because it reads policy from Fabric and writes Redis cache.
- The second `/validate` should use `source: "redis-verified"` and should be much faster.
- Access logging is submitted to Fabric asynchronously so the runtime decision path stays close to the paper's verifiable-cache design.
