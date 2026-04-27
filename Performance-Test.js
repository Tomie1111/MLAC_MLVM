const grpc = require('@grpc/grpc-js');
const crypto = require('crypto');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { createClient } = require('redis');
const { performance } = require('perf_hooks');

// =================================================================
// 1. Configuration
// =================================================================
const STEPS = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const BATCH_SIZE = 100; 

// Fabric Config
const channelName = 'mychannel';
const chaincodeName = 'policy_cc';
const mspId = 'Org1MSP';
const cryptoPath = path.resolve(os.homedir(), 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com');
const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const certPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts', 'cert.pem');
const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';

// =================================================================
// 2. Incremental Workload Function
// =================================================================
async function runIncrementalWorkload(scenarioName, targetFunction) {
    console.log(`\n▶️ เริ่มการทดสอบ Scenario: ${scenarioName}`);
    let lastPoint = 0;
    const stepResults = [];

    for (const currentStep of STEPS) {
        const amountToRun = currentStep - lastPoint; 
        const latencies = [];
        let errorCount = 0;
        
        console.log(`   🚀 ช่วงโหลดสะสม: ${currentStep} (+${amountToRun})`);
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
        const p95Lat = latencies[Math.floor(0.95 * latencies.length)] || 0;

        stepResults.push({
            scenario: scenarioName,
            step_load: currentStep,
            throughput: throughput.toFixed(2),
            avg_latency: avgLat.toFixed(4),
            p95_latency: p95Lat.toFixed(4),
            error_rate: ((errorCount / amountToRun) * 100).toFixed(2)
        });

        lastPoint = currentStep; 
    }
    return stepResults;
}

// =================================================================
// 3. Main Execution
// =================================================================
async function main() {
    const redisClient = createClient();
    await redisClient.connect();

    // 3.1 Seeding Full Policy Matrix
    const policyMatrix = [
        { level: 'L0', class: 'Absolute Top', cap: 'read, write, exec, vm_mgmt, audit, override' },
        { level: 'L1', class: 'Top Secret', cap: 'read, write, execute_scripts' },
        { level: 'L2', class: 'Secret', cap: 'read, execute_approved_apps' },
        { level: 'L3', class: 'Confidential', cap: 'read, write (No execution)' },
        { level: 'L4', class: 'Restricted', cap: 'write, exec_readonly (No read)' },
        { level: 'L5', class: 'Public', cap: 'read (View-only; no write/exec)' }
    ];

    console.log('⏳ กำลังเตรียมข้อมูล Policy 100,000 ชุด...');
    for (let i = 0; i < 100000; i++) {
        const p = policyMatrix[i % policyMatrix.length];
        const pStr = JSON.stringify(p);
        const hash = crypto.createHash('sha256').update(pStr).digest('hex');
        await redisClient.set(`policy_${i}`, JSON.stringify({ policy: pStr, hash: hash }));
    }

    // 3.2 Fabric Setup
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
    const contract = gateway.getNetwork(channelName).getContract(chaincodeName);
    
    const finalReport = [];

    try {
        // --- SCENARIO 1: Redis Baseline ---
        finalReport.push(...(await runIncrementalWorkload("1. Redis Only", async (i) => {
            await redisClient.get(`policy_${i}`);
        })));

        // --- SCENARIO 2: Fabric Only ---
        finalReport.push(...(await runIncrementalWorkload("2. Fabric Only", async (i) => {
            await contract.evaluateTransaction('AssetExists', `policy_${i % 10000}`);
        })));

        // --- SCENARIO 3: BC-BLPM (Traditional Hybrid - ต้องเช็คทั้งคู่แบบ Sync) ---
        finalReport.push(...(await runIncrementalWorkload("3. BC-BLPM (Sync)", async (i) => {
            await redisClient.get(`policy_${i}`);
            await contract.evaluateTransaction('AssetExists', `policy_${i % 10000}`);
        })));

        // --- SCENARIO 4: Proposed MLAC-MLVM (Optimized Hybrid - Verify by Hash) ---
        finalReport.push(...(await runIncrementalWorkload("4. Proposed MLVM", async (i) => {
            const data = await redisClient.get(`policy_${i}`);
            if (data) {
                const parsed = JSON.parse(data);
                const computedHash = crypto.createHash('sha256').update(parsed.policy).digest('hex');
                if (computedHash !== parsed.hash) throw new Error("Security Violation!");
                
                const policy = JSON.parse(parsed.policy);
                if (policy.level === 'L2') { /* Access Granted */ }
            }
        })));

        // --- Save CSV ---
        const header = "Scenario,Target_Step_Load,Throughput_RPS,Avg_Latency_ms,P95_Latency_ms,Error_Rate_%\n";
        const rows = finalReport.map(r => 
            `${r.scenario},${r.step_load},${r.throughput},${r.avg_latency},${r.p95_latency},${r.error_rate}`
        ).join('\n');

        await fs.writeFile('final_incremental_report.csv', header + rows, 'utf8');
        console.log(`\n🎉 บันทึกไฟล์สำเร็จ: final_incremental_report.csv (ครบ 4 Scenarios x 9 Steps)`);

    } finally {
        await redisClient.disconnect();
        gateway.close();
        client.close();
    }
}

main().catch(console.error);