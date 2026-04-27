const grpc = require('@grpc/grpc-js');
const crypto = require('crypto');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { createClient } = require('redis');
const { performance } = require('perf_hooks');

// =================================================================
// 1. Configuration & All Security Levels
// =================================================================
const STEPS = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const BATCH_SIZE = 100; 

// Fabric Config
const mspId = 'Org1MSP';
const cryptoPath = path.resolve(os.homedir(), 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com');
const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const certPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts', 'cert.pem');
const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';

// 🛡️ USER POOL: ครบทุกระดับชั้นสิทธิ์ (Clearances)
const userPool = [
    { id: 'user_L0', clearance: 0 }, // สิทธิ์สูงสุด
    { id: 'user_L1', clearance: 1 },
    { id: 'user_L2', clearance: 2 },
    { id: 'user_L3', clearance: 3 },
    { id: 'user_L4', clearance: 4 },
    { id: 'user_L5', clearance: 5 }  // สิทธิ์ต่ำสุด
];

// 📄 POLICY MATRIX: ครบทุกระดับความลับ (Classification Levels)
const policyMatrix = [
    { level: 0, label: 'L0', role: 'Absolute Top', cap: 'read, write, exec, override' },
    { level: 1, label: 'L1', role: 'Top Secret', cap: 'read, write, exec' },
    { level: 2, label: 'L2', role: 'Secret', cap: 'read, write' },
    { level: 3, label: 'L3', role: 'Confidential', cap: 'read, exec' },
    { level: 4, label: 'L4', role: 'Restricted', cap: 'read' },
    { level: 5, label: 'L5', role: 'Public', cap: 'view-only' }
];

// =================================================================
// 2. Core Workload Runner (P99 + Allocation Metrics)
// =================================================================
async function runAllocationWorkload(scenarioName, targetFunction) {
    console.log(`\n▶️ Starting Scenario: ${scenarioName}`);
    let lastPoint = 0;
    const stepResults = [];

    for (const currentStep of STEPS) {
        const amountToRun = currentStep - lastPoint; 
        const latencies = [];
        let errorCount = 0;
        
        console.log(`   🚀 Load Step: ${currentStep} (+${amountToRun} requests)`);
        const startTime = performance.now();

        for (let i = 0; i < amountToRun; i += BATCH_SIZE) {
            const currentBatch = Math.min(BATCH_SIZE, amountToRun - i);
            const batchPromises = [];

            for (let j = 0; j < currentBatch; j++) {
                const reqPromise = (async () => {
                    const start = performance.now();
                    try {
                        await targetFunction(lastPoint + i + j);
                    } catch (e) {
                        errorCount++;
                    }
                    latencies.push(performance.now() - start);
                })();
                batchPromises.push(reqPromise);
            }
            await Promise.all(batchPromises);
        }

        const endTime = performance.now();
        const durationSec = (endTime - startTime) / 1000;
        const throughput = amountToRun / durationSec;
        
        latencies.sort((a, b) => a - b);
        const avgLat = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const p99Lat = latencies[Math.floor(0.99 * latencies.length)] || latencies[latencies.length - 1];

        stepResults.push({
            scenario: scenarioName,
            step_load: currentStep,
            throughput: throughput.toFixed(2),
            avg_latency: avgLat.toFixed(4),
            p99_latency: p99Lat.toFixed(4),
            error_rate: ((errorCount / amountToRun) * 100).toFixed(2)
        });

        lastPoint = currentStep; 
    }
    return stepResults;
}

// =================================================================
// 3. Main Engine Execution
// =================================================================
async function main() {
    const redisClient = createClient();
    await redisClient.connect();

    // Fabric Connection
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const certificate = await fs.readFile(certPath, 'utf8');
    const files = await fs.readdir(keyDirectoryPath);
    const keyPath = path.resolve(keyDirectoryPath, files[0]);
    const privateKeyPem = await fs.readFile(keyPath, 'utf8');
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const grpcCredentials = grpc.credentials.createSsl(tlsRootCert);
    const client = new grpc.Client(peerEndpoint, grpcCredentials, { 'grpc.ssl_target_name_override': peerHostAlias });
    const gateway = connect({
        client,
        identity: { mspId, credentials: Buffer.from(certificate) },
        signer: signers.newPrivateKeySigner(privateKey),
    });
    const contract = gateway.getNetwork('mychannel').getContract('policy_cc');

    console.log('⏳ Seeding 100,000 Policies (L0-L5) into Redis...');
    for (let i = 0; i < 100000; i++) {
        const p = policyMatrix[i % policyMatrix.length];
        const pStr = JSON.stringify(p);
        const hash = crypto.createHash('sha256').update(pStr).digest('hex');
        await redisClient.set(`policy_${i}`, JSON.stringify({ policy: pStr, hash: hash }));
    }

    const finalReport = [];

    try {
        // 1. Redis Only (Baseline)
        finalReport.push(...(await runAllocationWorkload("1. Redis Only", async (i) => {
            await redisClient.get(`policy_${i}`);
        })));

        // 2. Fabric Only (Baseline)
        finalReport.push(...(await runAllocationWorkload("2. Fabric Only", async (i) => {
            await contract.evaluateTransaction('AssetExists', `policy_${i % 10000}`);
        })));

        // 3. BC-BLPM (Sync Hybrid)
        finalReport.push(...(await runAllocationWorkload("3. BC-BLPM (Sync)", async (i) => {
            await redisClient.get(`policy_${i}`);
            await contract.evaluateTransaction('AssetExists', `policy_${i % 10000}`);
        })));

        // 4. Proposed MLVM (Full Allocation Decision with L0-L5)
        finalReport.push(...(await runAllocationWorkload("4. Proposed MLVM", async (i) => {
            const data = await redisClient.get(`policy_${i}`);
            if (!data) throw new Error();

            const parsed = JSON.parse(data);
            const computedHash = crypto.createHash('sha256').update(parsed.policy).digest('hex');
            if (computedHash !== parsed.hash) throw new Error("Security Violation!");

            const policy = JSON.parse(parsed.policy);
            const user = userPool[i % userPool.length]; // สุ่ม User จาก L0-L5
            
            // MLAC DECISION: อนุมัติการจัดสรรตามกฎระดับชั้น
            if (user.clearance <= policy.level) {
                await redisClient.set(`alloc_status_${i}`, `ALLOWED_FOR_${user.id}`);
            } else {
                await redisClient.set(`alloc_status_${i}`, `DENIED_FOR_${user.id}`);
            }
        })));

        const header = "Scenario,Target_Step_Load,Throughput_RPS,Avg_Latency_ms,P99_Latency_ms,Error_Rate_%\n";
        const rows = finalReport.map(r => 
            `${r.scenario},${r.step_load},${r.throughput},${r.avg_latency},${r.p99_latency},${r.error_rate}`
        ).join('\n');

        await fs.writeFile('full_allocation_p99_report.csv', header + rows, 'utf8');
        console.log(`\n🎉 Test Complete! Results for all levels (L0-L5) saved.`);

    } finally {
        await redisClient.disconnect();
        gateway.close();
        client.close();
    }
}

main().catch(console.error);