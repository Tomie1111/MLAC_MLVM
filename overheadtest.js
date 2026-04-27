'use strict';

const grpc = require('@grpc/grpc-js');
const crypto = require('crypto');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { createClient } = require('redis');
const { performance } = require('perf_hooks');
const { MerkleTree } = require('merkletreejs');

// =================================================================
// 1. Configuration
// =================================================================
const channelName      = 'mychannel';
const chaincodeName    = 'policy_cc';
const mspId            = 'Org1MSP';
const cryptoPath       = path.resolve(os.homedir(), 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com');
const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const certPath         = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts', 'cert.pem');
const tlsCertPath      = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
const peerEndpoint     = 'localhost:7051';
const peerHostAlias    = 'peer0.org1.example.com';

const PHYSICAL_DATA_FILE = './physical_system_logs.json';
const BATCH_SIZE = 50; 
const REPORT_ROWS = [];

// =================================================================
// 2. Helpers
// =================================================================
const SHA256 = data => crypto.createHash('sha256').update(Buffer.isBuffer(data) ? data : String(data)).digest();
const SHA256hex = data => crypto.createHash('sha256').update(Buffer.isBuffer(data) ? data : String(data)).digest('hex');

let realDataStore = [];
let recordCursor = 0;

async function preparePhysicalData() {
    realDataStore = JSON.parse(await fs.readFile(PHYSICAL_DATA_FILE, 'utf8'));
}

function getRealRecord() {
    const rec = JSON.parse(JSON.stringify(realDataStore[recordCursor]));
    recordCursor = (recordCursor + 1) % realDataStore.length;
    if (!rec.vm) rec.vm = `vm${(parseInt(rec.uid.replace('user', '')) % 3) + 1}`;
    if (!rec.token) rec.token = `tok-${crypto.randomBytes(4).toString('hex')}`;
    return rec;
}

// =================================================================
// 3. True Overhead Benchmark Runner (No Mocks)
// =================================================================
async function runRealOverheadTest(contract, redis) {
    console.log(`\n${'='.repeat(70)}\n⚙️  TRUE OVERHEAD TEST: Ingesting ${BATCH_SIZE} Real Records\n${'='.repeat(70)}`);
    const records = Array.from({ length: BATCH_SIZE }, () => getRealRecord());
    
    let plainBytes = 0;
    let hashChainBytes = 0;
    let fullOnChainBytes = 0;
    let proposedFabricBytes = 0;
    let proposedRedisBytes = 0;

    // -------------------------------------------------------------
    // 1. Plain Log (Local Array)
    // -------------------------------------------------------------
    let t0 = performance.now();
    const plainDb = [];
    for (const r of records) {
        plainDb.push(r);
        plainBytes += Buffer.byteLength(JSON.stringify(r)); // Measure exact payload
    }
    const plainTime = performance.now() - t0;
    console.log(`   🔸 1_Plain_Log      : Time ${plainTime.toFixed(2)} ms | Size ${plainBytes} bytes`);

    // -------------------------------------------------------------
    // 2. HashChain Only (Local Array with Chains)
    // -------------------------------------------------------------
    t0 = performance.now();
    const hashChainDb = [];
    let prev = Buffer.alloc(32, 0);
    for (const r of records) {
        const hi = SHA256(JSON.stringify(r));
        const chain = SHA256(Buffer.concat([prev, hi]));
        prev = chain;
        const entry = { record: r, hi: hi.toString('hex'), chain: chain.toString('hex') };
        hashChainDb.push(entry);
        hashChainBytes += Buffer.byteLength(JSON.stringify(entry)); // Measure exact payload
    }
    const hashTime = performance.now() - t0;
    console.log(`   🔸 2_HashChain_Only : Time ${hashTime.toFixed(2)} ms | Size ${hashChainBytes} bytes`);

    // -------------------------------------------------------------
    // 3. Full On-Chain (Real Fabric Submission)
    // -------------------------------------------------------------
    console.log(`   ⏳ Running Full On-Chain (Executing ${BATCH_SIZE} Real Fabric Txs)...`);
    t0 = performance.now();
    for (const r of records) {
        const hash = SHA256hex(JSON.stringify(r));
        const args = ['CreateAsset', r.eventId, hash, '1', 'Baseline', '0'];
        fullOnChainBytes += Buffer.byteLength(JSON.stringify(args)); // Exact bytes sent to network
        
        try {
            await contract.submitTransaction(...args);
        } catch(e) {
            await contract.submitTransaction('UpdateAsset', r.eventId, hash, '1', 'Baseline', '0');
        }
    }
    const fullOnChainTime = performance.now() - t0;
    console.log(`   🔸 3_Full_OnChain   : Time ${fullOnChainTime.toFixed(2)} ms | On-Chain Size ${fullOnChainBytes} bytes`);

    // -------------------------------------------------------------
    // 4. Proposed MLVM (Real Redis I/O + 1 Fabric Tx + Real Proofs)
    // -------------------------------------------------------------
    console.log(`   ⏳ Running Proposed MLVM (Real Redis Writes + 1 Fabric Tx)...`);
    t0 = performance.now();
    
    const bufferData = [];
    const leaves = [];
    
    // Step A: Real writes to Redis
    for (const r of records) {
        const hi = SHA256(JSON.stringify(r));
        leaves.push(hi);
        bufferData.push({ id: r.eventId, hi });
        
        const redisPayload = JSON.stringify({ record: r, hi: hi.toString('hex') });
        proposedRedisBytes += Buffer.byteLength(redisPayload);
        await redis.set(`audit:${r.eventId}`, redisPayload, { EX: 60 });
    }

    // Step B: Build Merkle Tree & Submit Root to Fabric
    const tree = new MerkleTree(leaves, SHA256, { sortPairs: true });
    const root = tree.getRoot().toString('hex');
    const batchId = `anchor_${Date.now()}`;
    
    const mlvmFabricArgs = ['CreateAsset', batchId, root, '1', 'Auditor', '0'];
    proposedFabricBytes = Buffer.byteLength(JSON.stringify(mlvmFabricArgs)); // Exact bytes sent to network
    
    try {
        await contract.submitTransaction(...mlvmFabricArgs);
    } catch(e) {
        await contract.submitTransaction('UpdateAsset', batchId, root, '1', 'Auditor', '0');
    }
    
    // Step C: Update Redis with Real Proofs (Real I/O)
    for (const item of bufferData) {
        const proof = tree.getProof(item.hi);
        const raw = await redis.get(`audit:${item.id}`);
        if(raw) {
            const parsed = JSON.parse(raw);
            parsed.proof = proof;
            const updatedPayload = JSON.stringify(parsed);
            
            // Subtract old size, add new size with proof included
            proposedRedisBytes -= Buffer.byteLength(raw);
            proposedRedisBytes += Buffer.byteLength(updatedPayload);
            
            await redis.set(`audit:${item.id}`, updatedPayload, { EX: 60 });
        }
    }
    const proposedTime = performance.now() - t0;
    console.log(`   🔸 4_Proposed_MLVM  : Time ${proposedTime.toFixed(2)} ms | On-Chain Size ${proposedFabricBytes} bytes | Redis Size ${proposedRedisBytes} bytes`);

    // Record results
    REPORT_ROWS.push({ Metric: `Time to Ingest ${BATCH_SIZE} logs (ms)`, Plain: plainTime.toFixed(2), HashChain: hashTime.toFixed(2), FullOnChain: fullOnChainTime.toFixed(2), Proposed: proposedTime.toFixed(2) });
    REPORT_ROWS.push({ Metric: `On-Chain Fabric Storage (bytes)`, Plain: 0, HashChain: 0, FullOnChain: fullOnChainBytes, Proposed: proposedFabricBytes });
    REPORT_ROWS.push({ Metric: `Off-Chain Storage (bytes)`, Plain: plainBytes, HashChain: hashChainBytes, FullOnChain: 0, Proposed: proposedRedisBytes });
}

// =================================================================
// 4. Main
// =================================================================
async function main() {
    await preparePhysicalData();
    const redis = createClient(); await redis.connect();
    
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const certificate = await fs.readFile(certPath, 'utf8');
    const keyFiles    = await fs.readdir(keyDirectoryPath);
    const privateKeyPem = await fs.readFile(path.resolve(keyDirectoryPath, keyFiles[0]), 'utf8');
    
    const grpcClient = new grpc.Client(peerEndpoint, grpc.credentials.createSsl(tlsRootCert), { 'grpc.ssl_target_name_override': peerHostAlias });
    const gateway  = connect({ client: grpcClient, identity: { mspId, credentials: Buffer.from(certificate) }, signer: signers.newPrivateKeySigner(crypto.createPrivateKey(privateKeyPem)) });
    const contract = gateway.getNetwork(channelName).getContract(chaincodeName);

    try {
        await runRealOverheadTest(contract, redis);

        const csvLines = ['Metric,Plain,HashChain,FullOnChain,Proposed'];
        for (const r of REPORT_ROWS) { csvLines.push(`"${r.Metric}",${r.Plain},${r.HashChain},${r.FullOnChain},${r.Proposed}`); }
        await fs.writeFile('overhead_benchmark.csv', csvLines.join('\n'));
        console.log(`\n🎉 Real Overhead Test Complete! Check overhead_benchmark.csv`);

    } finally {
        await redis.disconnect();
        gateway.close();
        grpcClient.close();
    }
}

main().catch(console.error);