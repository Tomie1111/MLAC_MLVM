'use strict';

/**
 * MLAC-MLVM FULL DEMO
 * Matches paper system:
 * Phase 1: Keycloak identity token
 * Phase 2: Fabric policy + Redis verifiable cache
 * Phase 3: Dual-token validation
 * Phase 4: Security-aware VM allocation
 * Phase 5: EMA predictive scaling using MacBook M2 metrics
 * Phase 6: Merkle audit + Fabric anchoring
 */

const express = require('express');
const grpc = require('@grpc/grpc-js');
const crypto = require('crypto');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const si = require('systeminformation');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

const FABRIC = {
  channel: 'mychannel',
  cc: 'policy_cc',
  msp: 'Org1MSP',
  peer: 'localhost:7051',
  cryptoBase: path.resolve(
    os.homedir(),
    'fabric-samples/test-network/organizations/peerOrganizations/org1.example.com'
  )
};

const KEYCLOAK = {
  issuer: 'http://localhost:8080/realms/mlac-realm',
  clientId: 'mlac-client',
  jwksUri: 'http://localhost:8080/realms/mlac-realm/protocol/openid-connect/certs'
};

const SESSION_SECRET = 'mlac_mlvm_session_secret_2026';
const REDIS_URL = 'redis://localhost:6379';
const PORT = 3000;
const VM_BASE_CAPACITY = 100;
const VM_RISK_THRESHOLD = 0.5;
const VM_TRUST_THRESHOLD = 0.5;
const AUDIT_BATCH_TTL_SECONDS = 3600;

let contract;
let redis;

// ---------------------------
// L0-L5 Policy Matrix
// ---------------------------
const policyMatrix = [
  { level: 0, label: 'L0', role: 'Absolute Top', cap: 'read, write, exec, override' },
  { level: 1, label: 'L1', role: 'Top Secret', cap: 'read, write, exec' },
  { level: 2, label: 'L2', role: 'Secret', cap: 'read, write' },
  { level: 3, label: 'L3', role: 'Confidential', cap: 'read, exec' },
  { level: 4, label: 'L4', role: 'Restricted', cap: 'read' },
  { level: 5, label: 'L5', role: 'Public', cap: 'view-only' }
];

function getPolicyMatrixEntry(level) {
  return policyMatrix.find(row => row.level === level);
}

function getCapabilitiesByLevel(level) {
  const entry = getPolicyMatrixEntry(level);
  if (!entry) return [];
  return entry.cap.split(',').map(cap => cap.trim());
}

function parseSecurityLevel(value) {
  if (typeof value === 'string' && /^L[0-5]$/i.test(value.trim())) {
    return Number(value.trim().slice(1));
  }

  const level = Number(value);
  if (!Number.isInteger(level) || !getPolicyMatrixEntry(level)) {
    return null;
  }

  return level;
}

// Demo VM pool
const vmPool = [
  {
    id: 'vm-finance-absolute-01',
    level: 0,
    compartment: 'finance',
    load: 0.35,
    queue: 0.12,
    risk: 0.09,
    trust: 0.96,
    cap: VM_BASE_CAPACITY
  },
  {
    id: 'vm-finance-topsecret-01',
    level: 1,
    compartment: 'finance',
    load: 0.32,
    queue: 0.11,
    risk: 0.10,
    trust: 0.94,
    cap: VM_BASE_CAPACITY
  },
  {
    id: 'vm-finance-01',
    level: 2,
    compartment: 'finance',
    load: 0.30,
    queue: 0.10,
    risk: 0.12,
    trust: 0.92,
    cap: VM_BASE_CAPACITY
  },
  {
    id: 'vm-finance-02',
    level: 2,
    compartment: 'finance',
    load: 0.55,
    queue: 0.20,
    risk: 0.20,
    trust: 0.86,
    cap: VM_BASE_CAPACITY
  },
  {
    id: 'vm-finance-restricted-01',
    level: 4,
    compartment: 'finance',
    load: 0.25,
    queue: 0.08,
    risk: 0.10,
    trust: 0.90,
    cap: VM_BASE_CAPACITY
  },
  {
    id: 'vm-public-01',
    level: 5,
    compartment: 'public',
    load: 0.20,
    queue: 0.05,
    risk: 0.08,
    trust: 0.93,
    cap: VM_BASE_CAPACITY
  },
  {
    id: 'vm-hr-01',
    level: 3,
    compartment: 'hr',
    load: 0.40,
    queue: 0.15,
    risk: 0.18,
    trust: 0.88,
    cap: VM_BASE_CAPACITY
  }
];

// ---------------------------
// EMA Predictive Controller
// ---------------------------
const scalingState = {
  history: [],
  predLoad: 0,
  action: 'stable',
  cap: VM_BASE_CAPACITY
};

function evaluateAccess(policy, vm, action) {
  const attrOk = hasRequiredAttr(policy, action);
  if (!attrOk) {
    return {
      allowed: false,
      reason: 'ATTRIBUTE_NOT_MATCH'
    };
  }

  if (!vm) {
    return {
      allowed: false,
      reason: 'NO_ELIGIBLE_VM'
    };
  }

  const blpOk = blpCheck(policy.level, vm.level, action);
  if (!blpOk) {
    return {
      allowed: false,
      reason: 'CLEARANCE_LEVEL_NOT_MATCH'
    };
  }

  const compOk = policy.compartment === vm.compartment;
  if (!compOk) {
    return {
      allowed: false,
      reason: 'COMPARTMENT_NOT_MATCH'
    };
  }

  return {
    allowed: true,
    reason: 'GRANTED'
  };
}

function ema(values, period = 5) {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  let result = values[0];

  for (let i = 1; i < values.length; i++) {
    result = alpha * values[i] + (1 - alpha) * result;
  }

  return result;
}

async function getMacMetrics() {
  const load = await si.currentLoad();
  const mem = await si.mem();
  const temp = await si.cpuTemperature();

  const cpuLoad = load.currentLoad / 100;
  const memLoad = mem.used / mem.total;
  const normalizedLoad = (cpuLoad + memLoad) / 2;

  return {
    device: 'MacBook M2 / local machine',
    cpuPercent: Number(load.currentLoad.toFixed(2)),
    memPercent: Number((memLoad * 100).toFixed(2)),
    temperature: temp.main || null,
    normalizedLoad: Number(normalizedLoad.toFixed(4))
  };
}

function predictiveScaling(loadValue) {
  scalingState.history.push(loadValue);
  if (scalingState.history.length > 20) scalingState.history.shift();

  const pred = ema(scalingState.history, 5);
  const risk = 0.05 + loadValue * 0.1;

  scalingState.predLoad = Number(pred.toFixed(4));

  if (pred > 0.70 && risk <= 0.5) {
    scalingState.cap += Math.ceil(scalingState.cap * 0.4);
    scalingState.action = 'scale_up_in_place';
  } else if (loadValue < 0.30 && scalingState.cap > VM_BASE_CAPACITY) {
    scalingState.cap = Math.max(VM_BASE_CAPACITY, Math.floor(scalingState.cap * 0.85));
    scalingState.action = 'scale_down';
  } else {
    scalingState.action = 'stable';
  }

  return {
    emaPrediction: scalingState.predLoad,
    risk: Number(risk.toFixed(4)),
    capacity: scalingState.cap,
    action: scalingState.action
  };
}

// ---------------------------
// Fabric Init
// ---------------------------
async function initFabric() {
  const keyDir = path.join(FABRIC.cryptoBase, 'users/Admin@org1.example.com/msp/keystore');
  const keyFile = (await fs.readdir(keyDir))[0];

  const privateKeyPem = await fs.readFile(path.join(keyDir, keyFile));
  const cert = await fs.readFile(
    path.join(FABRIC.cryptoBase, 'users/Admin@org1.example.com/msp/signcerts/cert.pem')
  );
  const tlsCert = await fs.readFile(
    path.join(FABRIC.cryptoBase, 'peers/peer0.org1.example.com/tls/ca.crt')
  );

  const client = new grpc.Client(
    FABRIC.peer,
    grpc.credentials.createSsl(tlsCert),
    { 'grpc.ssl_target_name_override': 'peer0.org1.example.com' }
  );

  const gateway = connect({
    client,
    identity: { mspId: FABRIC.msp, credentials: cert },
    signer: signers.newPrivateKeySigner(crypto.createPrivateKey(privateKeyPem))
  });

  contract = gateway.getNetwork(FABRIC.channel).getContract(FABRIC.cc);
  console.log('✅ Fabric connected');
}

// ---------------------------
// Keycloak Verification
// ---------------------------
const jwks = jwksClient({ jwksUri: KEYCLOAK.jwksUri });

function getSigningKey(header, callback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function verifyKeycloakToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        issuer: KEYCLOAK.issuer,
        //audience: KEYCLOAK.clientId,
        algorithms: ['RS256']
      },
      (err, decoded) => (err ? reject(err) : resolve(decoded))
    );
  });
}

function keycloakTokenErrorResponse(err) {
  if (err instanceof jwt.TokenExpiredError) {
    return {
      status: 401,
      body: {
        error: 'KEYCLOAK_TOKEN_EXPIRED',
        message: 'Keycloak access token expired. Request a fresh token and retry.',
        expiredAt: err.expiredAt
      }
    };
  }

  if (err instanceof jwt.JsonWebTokenError) {
    return {
      status: 401,
      body: {
        error: 'KEYCLOAK_TOKEN_INVALID',
        message: err.message
      }
    };
  }

  return null;
}

// ---------------------------
// Merkle / Hash Helpers
// ---------------------------
function computePolicyMerkleRoot(policy) {
  const leaves = [
    `uid:${policy.uid}`,
    `level:${policy.level}`,
    `compartment:${policy.compartment}`,
    ...[...policy.attrs].sort().map(a => `attr:${a}`)
  ].map(x => keccak256(x));

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  return tree.getHexRoot();
}

function hashLog(log) {
  return crypto.createHash('sha256').update(JSON.stringify(log)).digest('hex');
}

function buildAuditBatch(logs) {
  let chainHead = '';
  const records = logs.map(log => {
    const logHash = hashLog(log);
    chainHead = crypto.createHash('sha256').update(chainHead + logHash).digest('hex');
    return { log, logHash, chainHead };
  });

  const leaves = records.map(record => keccak256(record.logHash));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

  return {
    records,
    merkleRoot: tree.getHexRoot(),
    hashChainHead: chainHead
  };
}

async function saveAuditBatch(auditBatch) {
  const auditId = crypto.randomUUID();

  await redis.set(
    `audit:${auditId}`,
    JSON.stringify(auditBatch),
    { EX: AUDIT_BATCH_TTL_SECONDS }
  );

  return auditId;
}

async function getAuditBatch(auditId) {
  const raw = await redis.get(`audit:${auditId}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

function verifyAuditBatch(auditBatch) {
  const logs = auditBatch.records.map(record => record.log);
  const recomputed = buildAuditBatch(logs);

  const storedHashes = auditBatch.records.map(record => record.logHash);
  const recomputedHashes = recomputed.records.map(record => record.logHash);

  return {
    ok:
      auditBatch.merkleRoot === recomputed.merkleRoot &&
      auditBatch.hashChainHead === recomputed.hashChainHead &&
      JSON.stringify(storedHashes) === JSON.stringify(recomputedHashes),
    expectedMerkleRoot: auditBatch.merkleRoot,
    actualMerkleRoot: recomputed.merkleRoot,
    expectedHashChainHead: auditBatch.hashChainHead,
    actualHashChainHead: recomputed.hashChainHead
  };
}

// ---------------------------
// Redis Verified Policy Cache
// ---------------------------
function mac(data) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(JSON.stringify(data))
    .digest('hex');
}

async function getVerifiedPolicy(uid) {
  const cacheKey = `policy:${uid}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    const obj = JSON.parse(cached);

    const localRoot = computePolicyMerkleRoot(obj.policy);
    if (localRoot !== obj.merkleRoot) {
      throw new Error('Redis tampering detected: local Merkle root mismatch');
    }

    const expectedMac = mac({
      policy: obj.policy,
      merkleRoot: obj.merkleRoot
    });

    if (expectedMac !== obj.mac) {
      throw new Error('Redis MAC verification failed');
    }

    return { policy: obj.policy, merkleRoot: obj.merkleRoot, source: 'redis-verified' };
  }

  const policyBytes = await contract.evaluateTransaction('ReadPolicy', uid);
    const policyText = Buffer.from(policyBytes).toString('utf8');
    const policy = JSON.parse(policyText);

    const fabricRootBytes = await contract.evaluateTransaction('GetMerkleRoot', uid);
    const fabricRoot = Buffer.from(fabricRootBytes).toString('utf8');

  const localRoot = computePolicyMerkleRoot(policy);

  if (fabricRoot !== localRoot) {
    throw new Error(`Fabric root mismatch. Fabric=${fabricRoot}, Local=${localRoot}`);
  }

  const cacheObj = {
    policy,
    merkleRoot: fabricRoot,
    mac: mac({ policy, merkleRoot: fabricRoot })
  };

  await redis.set(cacheKey, JSON.stringify(cacheObj), { EX: 60 });

  return { policy, merkleRoot: fabricRoot, source: 'fabric-to-redis' };
}

// ---------------------------
// Access Control / Allocation
// ---------------------------
function blpCheck(userLevel, vmLevel, action) {
  // In your paper: L0 > L1 > ... > L5, but code uses 0 highest, 5 lowest.
  // Read no-read-up: user can read if userLevel <= vmLevel
  // Write no-write-down: user can write if userLevel >= vmLevel
  if (action === 'read') return userLevel <= vmLevel;
  if (action === 'write') return userLevel >= vmLevel;
  if (action === 'exec') return userLevel <= vmLevel;
  if (action === 'override') return userLevel === 0;
  return false;
}

function hasRequiredAttr(policy, action) {
  return policy.attrs.some(attr => {
    if (attr === action) return true;
    if (attr === 'view-only' && action === 'read') return true;
    return false;
  });
}

function scoreVM(vm) {
  const λ1 = 0.35;
  const λ2 = 0.20;
  const λ3 = 0.30;
  const λ4 = 0.15;

  return λ1 * vm.load + λ2 * vm.queue + λ3 * vm.risk - λ4 * vm.trust;
}

function getEligibleVMs(policy, action) {
  return vmPool
    .filter(vm => {
      const blpOk = blpCheck(policy.level, vm.level, action);
      const compOk = policy.compartment === vm.compartment;
      const attrOk = hasRequiredAttr(policy, action);
      const riskOk = vm.risk <= VM_RISK_THRESHOLD;
      const trustOk = vm.trust >= VM_TRUST_THRESHOLD;
      return blpOk && compOk && attrOk && riskOk && trustOk;
    })
    .map(vm => ({ ...vm, score: Number(scoreVM(vm).toFixed(4)) }))
    .sort((a, b) => a.score - b.score);
}

// ---------------------------
// Dual Token Session
// ---------------------------
async function issueSession(uid, vmId, merkleRoot, ip, device) {
  const sid = crypto.randomUUID();

  const payload = {
    sid,
    uid,
    vmId,
    merkleRoot,
    ip,
    device,
    iat: Math.floor(Date.now() / 1000)
  };

  const token = jwt.sign(payload, SESSION_SECRET, { expiresIn: '30m' });

  await redis.set(`session:${sid}`, JSON.stringify(payload), { EX: 1800 });

  return token;
}

async function verifySession(sessionToken, req) {
  const decoded = jwt.verify(sessionToken, SESSION_SECRET);
  const savedRaw = await redis.get(`session:${decoded.sid}`);

  if (!savedRaw) throw new Error('Session expired or revoked');

  const saved = JSON.parse(savedRaw);
  const reqIp = req.ip;
  const reqDevice = req.headers['user-agent'] || 'unknown';

  if (saved.ip !== reqIp) throw new Error('IP binding mismatch');
  if (saved.device !== reqDevice) throw new Error('Device binding mismatch');

  const fabricRootBytes = await contract.evaluateTransaction('GetMerkleRoot', saved.uid);
    const fabricRoot = Buffer.from(fabricRootBytes).toString('utf8');

  if (fabricRoot !== saved.merkleRoot) {
    throw new Error('Policy changed: session invalid');
  }

  return saved;
}

function logAccessAsync(uid, vmId, action, decision) {
  contract
    .submitTransaction('LogAccess', uid, vmId, action, decision)
    .catch(err => {
      console.error('Async access log failed:', err.message);
    });
}

// ---------------------------
// Demo API
// ---------------------------
async function main() {
  redis = createClient({ url: REDIS_URL });
  await redis.connect();

  await initFabric();

  const app = express();
  app.use(express.json());

  app.get('/health', async (req, res) => {
    res.json({
      api: 'ok',
      fabric: FABRIC.cc,
      redis: 'connected',
      keycloak: KEYCLOAK.issuer,
      phases: [
        'Keycloak Identity',
        'Fabric Policy',
        'Redis Verified Cache',
        'Dual Token',
        'MLAC VM Allocation',
        'EMA Scaling',
        'Merkle Audit'
      ]
    });
  });

  app.get('/policy-matrix', (req, res) => {
    res.json(policyMatrix);
  });

  app.post('/seed/:uid', async (req, res) => {
    try {
      const { uid } = req.params;
      const body = req.body || {};
      const requestedLevel = body.level ?? body.clearance ?? req.query.level ?? req.query.clearance;
      const level = parseSecurityLevel(requestedLevel);

      if (level === null) {
        return res.status(400).json({
          error: 'Missing or invalid clearance level',
          expected: 'Send JSON body or query param with level/clearance from 0-5 or L0-L5',
          examples: [
            'POST /seed/newuser with {"level":4,"compartment":"finance"}',
            'POST /seed/newuser?clearance=L3&compartment=hr'
          ]
        });
      }

      const compartment = body.compartment || req.query.compartment || 'public';
      const attrs = getCapabilitiesByLevel(level);

      const policy = {
        uid,
        level,
        compartment,
        attrs
      };

      const root = computePolicyMerkleRoot(policy);

      try {
        await contract.submitTransaction(
          'CreatePolicy',
          policy.uid,
          String(policy.level),
          policy.compartment,
          JSON.stringify(policy.attrs),
          root
        );
      } catch {
        await contract.submitTransaction(
          'UpdatePolicy',
          policy.uid,
          String(policy.level),
          policy.compartment,
          JSON.stringify(policy.attrs),
          root
        );
      }

      await redis.del(`policy:${policy.uid}`);

      res.json({ seeded: true, policy, merkleRoot: root });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/validate', async (req, res) => {
    try {
      const t0 = performance.now();
      const action = req.body.action || 'read';

      const authHeader = req.headers.authorization || '';
      const keycloakToken = authHeader.replace('Bearer ', '');

      if (!keycloakToken) {
        throw new Error('Missing Keycloak Bearer token');
      }

      const identity = await verifyKeycloakToken(keycloakToken);

      const uid = identity.preferred_username || identity.sub;
      const { policy, merkleRoot, source } = await getVerifiedPolicy(uid);

      const eligibleVMs = getEligibleVMs(policy, action);
      const allocatedVM = eligibleVMs[0] || null;
      const decision = evaluateAccess(policy, allocatedVM, action);
      const allowed = decision.allowed;

      const sessionToken = allowed
        ? await issueSession(
            uid,
            allocatedVM.id,
            merkleRoot,
            req.ip,
            req.headers['user-agent'] || 'unknown'
          )
        : null;

      logAccessAsync(
        uid,
        allocatedVM ? allocatedVM.id : 'none',
        action,
        allowed ? 'GRANT' : `DENY:${decision.reason}`
      );

      res.json({
        allowed,
        reason: decision.reason,
        uid,
        action,
        policy,
        source,
        merkleRoot,
        eligibleVMCount: eligibleVMs.length,
        eligibleVMs,
        allocatedVM,
        sessionToken,
        latencyMs: Number((performance.now() - t0).toFixed(2))
      });
    } catch (e) {
      const tokenError = keycloakTokenErrorResponse(e);
      if (tokenError) {
        return res.status(tokenError.status).json(tokenError.body);
      }

      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/access', async (req, res) => {
    try {
      const session = await verifySession(req.body.sessionToken, req);

      res.json({
        access: 'granted',
        uid: session.uid,
        vmId: session.vmId,
        merkleRoot: session.merkleRoot
      });
    } catch (e) {
      res.status(403).json({ error: e.message });
    }
  });

  app.get('/predict', async (req, res) => {
    try {
      const metrics = await getMacMetrics();
      const prediction = predictiveScaling(metrics.normalizedLoad);

      res.json({
        metrics,
        prediction,
        historySize: scalingState.history.length
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/audit/anchor', async (req, res) => {
    try {
      const logs = (req.body && req.body.logs) || [
        { uid: 'user1', vm: 'vm-finance-01', action: 'read', decision: '1', ts: Date.now() },
        { uid: 'user1', vm: 'vm-finance-01', action: 'write', decision: '1', ts: Date.now() }
      ];

      const auditBatch = buildAuditBatch(logs);
      const auditId = await saveAuditBatch(auditBatch);
      const tx = await contract.submitTransaction('AnchorLogRoot', auditBatch.merkleRoot);

      res.json({
        anchored: true,
        auditId,
        fabricKey: Buffer.from(tx).toString('utf8'),
        logMerkleRoot: auditBatch.merkleRoot,
        hashChainHead: auditBatch.hashChainHead,
        logHashes: auditBatch.records.map(record => record.logHash)
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/audit/verify/:auditId', async (req, res) => {
    try {
      const auditBatch = await getAuditBatch(req.params.auditId);

      if (!auditBatch) {
        return res.status(404).json({ error: 'Audit batch not found or expired' });
      }

      const verification = verifyAuditBatch(auditBatch);

      res.json({
        auditId: req.params.auditId,
        verified: verification.ok,
        reason: verification.ok ? 'AUDIT_OK' : 'AUDIT_TAMPERED',
        ...verification
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/attack/audit-tamper/:auditId', async (req, res) => {
    try {
      const auditBatch = await getAuditBatch(req.params.auditId);

      if (!auditBatch) {
        return res.status(404).json({ error: 'Audit batch not found or expired' });
      }

      if (!auditBatch.records.length) {
        return res.status(400).json({ error: 'Audit batch has no records to tamper' });
      }

      const index = Number(req.body && req.body.index) || 0;
      const record = auditBatch.records[index];

      if (!record) {
        return res.status(400).json({ error: 'Invalid audit record index' });
      }

      record.log.action = (req.body && req.body.action) || 'tampered-action';

      await redis.set(
        `audit:${req.params.auditId}`,
        JSON.stringify(auditBatch),
        { EX: AUDIT_BATCH_TTL_SECONDS }
      );

      res.json({
        attack: 'Audit log action changed without updating hashes/root',
        auditId: req.params.auditId,
        tamperedIndex: index,
        expected: 'GET /audit/verify/:auditId should return AUDIT_TAMPERED'
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/attack/redis-tamper/:uid', async (req, res) => {
    const uid = req.params.uid;
    const key = `policy:${uid}`;
    const cached = await redis.get(key);

    if (!cached) {
      return res.status(404).json({
        error: 'No Redis cache found. Run /validate first.'
      });
    }

    const obj = JSON.parse(cached);
    obj.policy.level = 0;

    await redis.set(key, JSON.stringify(obj), { EX: 300 });

    res.json({
      attack: 'Redis policy level changed to L0 without updating MAC/root',
      expected: 'Next validate should fail: Redis tampering detected'
    });
  });

  app.listen(PORT, () => {
    console.log(`🚀 MLAC-MLVM full demo running at http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log('GET  /health');
    console.log('GET  /policy-matrix');
    console.log('POST /seed/:uid body {"level":4,"compartment":"finance"}');
    console.log('POST /validate');
    console.log('POST /access');
    console.log('GET  /predict');
    console.log('POST /audit/anchor');
    console.log('GET  /audit/verify/:auditId');
    console.log('POST /attack/redis-tamper/user1');
    console.log('POST /attack/audit-tamper/:auditId');
  });
}

main().catch(console.error);
