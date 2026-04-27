'use strict';
/**
 * EMA Prediction Error vs Actual Load — Focused Test
 *
 * Timeline (20 seconds total):
 *   0–2s   : normal
 *   2–5s   : BURST 1
 *   5–7s   : normal
 *   7–10s  : BURST 2
 *   10–12s : normal
 *   12–16s : BURST 3
 *   16–20s : normal
 *
 * Outputs: ema_pred_error.csv  →  feed into plot_ema.py
 */

const crypto = require('crypto');
const os     = require('os');
const fs     = require('fs/promises');
const { createClient } = require('redis');
const { performance }  = require('perf_hooks');
const jwt              = require('jsonwebtoken');
const { MerkleTree }   = require('merkletreejs');

const grpc     = require('@grpc/grpc-js');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const path     = require('path');

// ── Fabric config ─────────────────────────────────────────────
const channelName   = 'mychannel';
const chaincodeName = 'policy_cc';
const mspId         = 'Org1MSP';
const cryptoBase    = path.resolve(os.homedir(), 'fabric-samples', 'test-network',
  'organizations', 'peerOrganizations', 'org1.example.com');
const keyDir   = path.resolve(cryptoBase, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const certFile = path.resolve(cryptoBase, 'users', 'User1@org1.example.com', 'msp', 'signcerts', 'cert.pem');
const tlsFile  = path.resolve(cryptoBase, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
const peerEndpoint  = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';

const JWT_SECRET = 'thesis_secret_key';
const CACHE_KEY  = 'ema_test_policy';

// ── Exact burst windows (seconds) ────────────────────────────
const BURSTS = [
  { start: 2,  end: 5  },   // burst 1
  { start: 7,  end: 10 },   // burst 2
  { start: 12, end: 16 },   // burst 3
];
const TOTAL_S       = 20;
const NORMAL_WORKERS = 15;   // workers outside burst
const BURST_WORKERS  = 220;  // workers during burst
const VM_CAPACITY    = 80;   // semaphore slots
const TICK_MS        = 100;  // sample every 100ms → 200 samples over 20s

// ── Helpers ───────────────────────────────────────────────────
const SHA256 = d => crypto.createHash('sha256').update(d).digest();
const sleep  = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

// ── Semaphore ─────────────────────────────────────────────────
class Semaphore {
  constructor(cap) { this.cap = cap; this.n = 0; }
  tryAcquire()     { if (this.n >= this.cap) return false; this.n++; return true; }
  release()        { this.n = Math.max(0, this.n - 1); }
  get load()       { return this.cap > 0 ? this.n / this.cap : 1; }
}

// ── EMA (k=5 window) ─────────────────────────────────────────
function ema(history, k = 5) {
  const w = history.slice(-k);
  if (!w.length) return 0;
  const α = 2 / (w.length + 1);
  return w.reduce((e, v, i) => i === 0 ? v : α * v + (1 - α) * e, w[0]);
}

// ── Core MLVM request ─────────────────────────────────────────
async function mlvmRequest({ redis, contract, jwtToken, policyTree, policyRoot }) {
  jwt.verify(jwtToken, JWT_SECRET);

  const raw = await redis.get(CACHE_KEY);
  if (!raw) throw new Error('Cache miss');
  const doc = JSON.parse(raw);

  const proof = doc.proof.map(p => ({
    position: p.position,
    data: Buffer.from(p.data.data || p.data)
  }));
  if (!policyTree.verify(proof, SHA256(doc.data), policyRoot))
    throw new Error('Merkle mismatch');

  try { await contract.evaluateTransaction('ReadAsset', 'root_01'); } catch (_) {}
  if (5 < 2) throw new Error('BLP violation');
}

// ── Worker loop ───────────────────────────────────────────────
// Each worker runs continuously; the controller changes
// how many workers are active by adjusting a shared "active" flag array.
async function workerLoop(id, activeSet, sem, ctx, deadline) {
  while (performance.now() < deadline) {
    if (!activeSet.has(id)) { await sleep(10); continue; }
    if (!sem.tryAcquire())  { await sleep(5);  continue; }
    try   { await mlvmRequest(ctx); }
    catch (_) {}
    finally { sem.release(); }
  }
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('EMA Prediction Error Test — 20 s, 3 burst windows');
  console.log('  2–5 s  |  7–10 s  |  12–16 s\n');

  // Redis
  const redis = createClient({ socket: { host: '127.0.0.1', port: 6379 } });
  await redis.connect();

  // Fabric
  const tlsCert       = await fs.readFile(tlsFile);
  const certificate   = await fs.readFile(certFile, 'utf8');
  const keyFiles      = await fs.readdir(keyDir);
  const privateKeyPem = await fs.readFile(path.resolve(keyDir, keyFiles[0]), 'utf8');
  const grpcClient    = new grpc.Client(peerEndpoint,
    grpc.credentials.createSsl(tlsCert),
    { 'grpc.ssl_target_name_override': peerHostAlias });
  const gateway = connect({
    client  : grpcClient,
    identity: { mspId, credentials: Buffer.from(certificate) },
    signer  : signers.newPrivateKeySigner(crypto.createPrivateKey(privateKeyPem)),
  });
  const contract = gateway.getNetwork(channelName).getContract(chaincodeName);
  console.log('✅ Fabric + Redis connected');

  // Crypto
  const jwtToken   = jwt.sign({ userId: 'user1', role: 'user', clearance: 5 }, JWT_SECRET);
  const leaves     = ['Policy_A', 'Policy_B', 'Policy_C'].map(SHA256);
  const policyTree = new MerkleTree(leaves, SHA256);
  const policyRoot = policyTree.getRoot().toString('hex');
  await redis.set(CACHE_KEY, JSON.stringify({
    data : 'Policy_B',
    proof: policyTree.getProof(SHA256('Policy_B'))
  }));

  const ctx = { redis, contract, jwtToken, policyTree, policyRoot };

  // ── Launch worker pool ──────────────────────────────────────
  const sem        = new Semaphore(VM_CAPACITY);
  const activeSet  = new Set();
  const startTime  = performance.now();
  const deadline   = startTime + TOTAL_S * 1000;

  // Spawn max workers (burst count); only those in activeSet do work
  const allWorkers = Array.from({ length: BURST_WORKERS }, (_, i) => i);
  const workerPromises = allWorkers.map(id => workerLoop(id, activeSet, sem, ctx, deadline));

  // Activate normal workers immediately
  for (let i = 0; i < NORMAL_WORKERS; i++) activeSet.add(i);

  // ── Telemetry + EMA controller ──────────────────────────────
  const rows = []; // { time_s, actual_load, predicted_load, pred_error, phase }
  const loadHistory = [];

  const isBurst = (t) => BURSTS.some(b => t >= b.start && t < b.end);
  const burstIndex = (t) => {
    const i = BURSTS.findIndex(b => t >= b.start && t < b.end);
    return i >= 0 ? `burst_${i + 1}` : 'normal';
  };

  let lastWorkerCount = NORMAL_WORKERS;

  const ticker = setInterval(() => {
    const elapsed = (performance.now() - startTime) / 1000;
    if (elapsed >= TOTAL_S) { clearInterval(ticker); return; }

    // Adjust active workers based on current phase
    const inBurst    = isBurst(elapsed);
    const targetCount = inBurst ? BURST_WORKERS : NORMAL_WORKERS;

    if (targetCount !== lastWorkerCount) {
      activeSet.clear();
      for (let i = 0; i < targetCount; i++) activeSet.add(i);
      lastWorkerCount = targetCount;
    }

    // EMA prediction
    const actualLoad = +sem.load.toFixed(4);
    loadHistory.push(actualLoad);
    const predicted  = +ema(loadHistory, 5).toFixed(4);
    const predError  = +Math.abs(predicted - actualLoad).toFixed(4);
    const phase      = burstIndex(elapsed);

    rows.push({
      time_s       : +elapsed.toFixed(2),
      actual_load  : actualLoad,
      predicted_load: predicted,
      pred_error   : predError,
      phase
    });

    process.stdout.write(
      `\r  t=${elapsed.toFixed(1).padStart(4)}s  load=${actualLoad.toFixed(2)}  ` +
      `pred=${predicted.toFixed(2)}  err=${predError.toFixed(3)}  [${phase.padEnd(8)}]`
    );
  }, TICK_MS);

  // Wait for all workers to finish
  await Promise.all(workerPromises);
  clearInterval(ticker);
  console.log('\n\n✅ Test complete');

  // ── Write CSV ───────────────────────────────────────────────
  const header = 'time_s,actual_load,predicted_load,pred_error,phase';
  const lines  = rows.map(r =>
    `${r.time_s},${r.actual_load},${r.predicted_load},${r.pred_error},"${r.phase}"`
  );
  await fs.writeFile('ema_pred_error.csv', [header, ...lines].join('\n'));
  console.log('📄 ema_pred_error.csv written —', rows.length, 'samples');

  gateway.close();
  grpcClient.close();
  await redis.disconnect();
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });