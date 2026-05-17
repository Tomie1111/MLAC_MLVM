# MLAC-MLVM Test Project

This project contains Node.js demos and benchmarks for MLAC/MLVM policy validation, Redis verified cache, Hyperledger Fabric anchoring, VM allocation, scaling, and audit/security tests.

## What You Need To Install

Install these before running the scripts:

- **Node.js 18+** recommended
- **npm** bundled with Node.js
- **Redis Server** running on `localhost:6379`
- **Hyperledger Fabric test network v2.4+**
- **Keycloak** running on `localhost:8080` only if you want to run `demo.js`
- **Python 3** only for graph scripts and some curl examples

Optional Python packages for graph generation:

```bash
python3 -m pip install pandas matplotlib numpy
```

## Required Local Services

Most benchmark scripts expect Fabric and Redis to already be running.

Fabric is expected at:

```text
peer: localhost:7051
channel: mychannel
chaincode: policy_cc
crypto path: ~/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com
```

Redis is expected at:

```text
localhost:6379
```

The full API demo also expects Keycloak at:

```text
realm: mlac-realm
client: mlac-client
url: http://localhost:8080
```

## Install Project Dependencies

From this project folder:

```bash
npm install
```

Do not install `crypto` separately. It is already built into Node.js.

## Run The Full Demo API

Start Redis, Fabric, and Keycloak first. Then run:

```bash
node demo.js
```

The API runs at:

```text
http://localhost:3000
```

Check that it started:

```bash
curl http://localhost:3000/health
```

Useful demo endpoints:

```bash
curl http://localhost:3000/policy-matrix

curl -X POST http://localhost:3000/seed/user2 \
  -H "Content-Type: application/json" \
  -d '{"level":4,"compartment":"finance"}'

curl http://localhost:3000/predict
```

For the full Keycloak token and access validation flow, see:

```text
demoreadme.md
```

## Run Benchmark Scripts

Run one script at a time after Redis and Fabric are running.

Performance benchmark:

```bash
node Performance-Test.js
```

P99 latency test:

```bash
node P99test.js
```

Audit attack benchmark:

```bash
node auditTest.js
```

Real security attack test:

```bash
node realSecurityTest.js
```

Allocation benchmark:

```bash
node allocationTest.js
```

Scaling benchmark:

```bash
node scalingTest.js
```

New scaling test:

```bash
node scailtestnew.js
```

Storage/time overhead test:

```bash
node overheadtest.js
```

## Generate Graphs

After running the benchmarks, generate graphs with:

```bash
python3 performgraph.py
python3 auditgraph.py
python3 securitygraph.py
python3 overheadgraph.py
python3 scalingtestgraph.py
python3 grapscalinema.py
```

The graph scripts read the CSV files in this folder and write PNG files back into the project folder.

## Common Problems

If a script cannot connect to Redis, start Redis and confirm port `6379` is open.

If a script cannot connect to Fabric, confirm the Fabric test network is running, the channel is named `mychannel`, and chaincode `policy_cc` is deployed.

If `demo.js` rejects the token, check that Keycloak is running, the `mlac-realm` realm exists, the `mlac-client` client exists, and the user credentials in `demoreadme.md` are valid.
