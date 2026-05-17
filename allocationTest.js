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
const STEPS = [100, 500, 1000, 2500];
const BATCH_SIZE = 100; 

// Fabric Config
const mspId = 'Org1MSP';
const cryptoPath = path.resolve(os.homedir(), 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com');
const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const certPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts', 'cert.pem');
const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';

// 📄 POLICY MATRIX: ครบทุกระดับความลับ (Classification Levels)
const policyMatrix = [
    { level: 0, label: 'L0', role: 'Absolute Top', cap: 'read, write, exec, override' },
    { level: 1, label: 'L1', role: 'Top Secret', cap: 'read, write, exec' },
    { level: 2, label: 'L2', role: 'Secret', cap: 'read, write' },
    { level: 3, label: 'L3', role: 'Confidential', cap: 'read, exec' },
    { level: 4, label: 'L4', role: 'Restricted', cap: 'read' },
    { level: 5, label: 'L5', role: 'Public', cap: 'view-only' }
];

const ACTIONS = ['read', 'write', 'exec', 'override'];
const COMPARTMENTS = ['finance', 'hr', 'research', 'public'];
const RESOURCE_CONFIG = {
    vmCount: Number(process.env.MLVM_VM_COUNT || 20),
    baseCapacity: Number(process.env.MLVM_VM_CAPACITY || 300),
    riskThreshold: Number(process.env.MLVM_RISK_THRESHOLD || 0.5),
    trustThreshold: Number(process.env.MLVM_TRUST_THRESHOLD || 0.5),
    scaleUpThreshold: Number(process.env.MLVM_SCALE_UP_THRESHOLD || 0.75),
    scaleStep: Number(process.env.MLVM_SCALE_STEP || 0.25),
    maxCapacityMultiplier: Number(process.env.MLVM_MAX_CAPACITY_MULTIPLIER || 2),
    scoreWeights: { load: 0.35, queue: 0.20, risk: 0.30, trust: 0.15 },
    trustWeights: { history: 0.40, behavior: 0.35, load: 0.25 },
    riskWeights: { colocation: 0.40, mixing: 0.35, anomaly: 0.25 }
};

// 🛡️ USER POOL: generated from the policy levels instead of fixed per-request allocation.
const userPool = policyMatrix.map(policy => ({
    id: `user_${policy.label}`,
    clearance: policy.level,
    attrs: getCapabilitiesByPolicy(policy).map(normalizeAction),
    compartments: getAllowedCompartments(policy.level)
}));

function getCapabilitiesByPolicy(policy) {
    return policy.cap.split(',').map(cap => cap.trim());
}

function getAllowedCompartments(level) {
    return Array.from({ length: COMPARTMENTS.length }, (_, index) =>
        COMPARTMENTS[(2 * level + 2 * index) % COMPARTMENTS.length]
    ).filter((compartment, index, list) => list.indexOf(compartment) === index);
}

function normalizeAction(capability) {
    return capability === 'view-only' ? 'read' : capability;
}

function selectAction(taskId, user, policy) {
    const usableActions = getCapabilitiesByPolicy(policy)
        .map(normalizeAction)
        .filter(action => user.attrs.includes(action));
    return usableActions[taskId % Math.max(usableActions.length, 1)] || 'read';
}

function createPolicyRecord(taskId) {
    const base = policyMatrix[taskId % policyMatrix.length];
    const capabilities = getCapabilitiesByPolicy(base);
    return {
        ...base,
        compartment: COMPARTMENTS[(taskId + base.level) % COMPARTMENTS.length],
        attrs: capabilities.map(normalizeAction)
    };
}

function createVmPool() {
    return Array.from({ length: RESOURCE_CONFIG.vmCount }, (_, index) => {
        const level = index % policyMatrix.length;
        const compartment = COMPARTMENTS[(2 * level + 2 * Math.floor(index / policyMatrix.length)) % COMPARTMENTS.length];
        const load = normalizedMetric(index, 17, 0.10, 0.45);
        const queue = normalizedMetric(index, 29, 0.02, 0.25);
        const history = normalizedMetric(index, 31, 0.70, 0.99);
        const behavior = normalizedMetric(index, 43, 0.70, 0.99);
        const colocation = normalizedMetric(index, 11, 0.03, 0.35);
        const mixing = normalizedMetric(index, 13, 0.02, 0.30);
        const anomaly = normalizedMetric(index, 19, 0.01, 0.20);
        const trust = computeTrust(history, behavior, load);
        const risk = computeRisk(colocation, mixing, anomaly);

        return {
            id: `vm-${String(index + 1).padStart(2, '0')}`,
            level,
            compartment,
            total_resources: RESOURCE_CONFIG.baseCapacity,
            base_resources: RESOURCE_CONFIG.baseCapacity,
            used_resources: Math.round(load * RESOURCE_CONFIG.baseCapacity),
            allocated_tasks: 0,
            cpu: 1 - load,
            mem: normalizedMetric(index, 23, 0.55, 0.95),
            load,
            queue,
            history,
            behavior,
            colocation,
            mixing,
            anomaly,
            trust,
            risk,
            load_history: [load],
            scale_events: 0
        };
    });
}

function normalizedMetric(seed, multiplier, min, max) {
    const ratio = ((seed * multiplier) % 100) / 100;
    return Number((min + ratio * (max - min)).toFixed(4));
}

function computeTrust(history, behavior, load) {
    const w = RESOURCE_CONFIG.trustWeights;
    return Number((w.history * history + w.behavior * behavior + w.load * (1 - load)).toFixed(4));
}

function computeRisk(colocation, mixing, anomaly) {
    const w = RESOURCE_CONFIG.riskWeights;
    return Number((w.colocation * colocation + w.mixing * mixing + w.anomaly * anomaly).toFixed(4));
}

function estimateTaskProfile(taskId, policy, action) {
    const actionWeight = ACTIONS.indexOf(action) + 1;
    const sensitivityWeight = policy.level + 1;
    const variability = 1 + (crypto.createHash('sha256').update(`${taskId}:${policy.label}:${action}`).digest()[0] % 5);
    const requestedResources = Math.max(1, Math.ceil((actionWeight * sensitivityWeight + variability) / 2));
    const difficulty = requestedResources >= 10 ? 'hard' : requestedResources >= 5 ? 'medium' : 'easy';

    return {
        action,
        difficulty,
        requested_resources: requestedResources,
        requested_cpu: Number(Math.min(0.95, requestedResources / RESOURCE_CONFIG.baseCapacity).toFixed(4)),
        requested_mem: Number(Math.min(0.95, requestedResources / (RESOURCE_CONFIG.baseCapacity * 0.8)).toFixed(4))
    };
}

function blpCheck(userLevel, objectLevel, action) {
    if (action === 'read' || action === 'exec') return userLevel <= objectLevel;
    if (action === 'write') return userLevel >= objectLevel;
    if (action === 'override') return userLevel === 0;
    return false;
}

function hasRequiredAttributes(user, policy, action) {
    return user.attrs.includes(action) && policy.attrs.includes(action);
}

function isPlacementAdmissible(user, vm, policy) {
    const highSensitivity = Math.min(user.clearance, policy.level) <= 1;
    const unsafeCoLocation = vm.colocation > 0.30 || vm.mixing > 0.25 || vm.anomaly > 0.18;
    return !highSensitivity || !unsafeCoLocation;
}

function getAccessReason(user, vm, policy, taskProfile) {
    if (!blpCheck(user.clearance, policy.level, taskProfile.action)) return 'BLP_DENIED';
    if (vm.level !== policy.level) return 'VM_POLICY_LEVEL_MISMATCH';
    if (!user.compartments.includes(policy.compartment)) return 'USER_COMPARTMENT_DENIED';
    if (vm.compartment !== policy.compartment) return 'VM_COMPARTMENT_MISMATCH';
    if (!hasRequiredAttributes(user, policy, taskProfile.action)) return 'ATTRIBUTE_POLICY_DENIED';
    if (vm.risk > RESOURCE_CONFIG.riskThreshold) return 'RISK_THRESHOLD_DENIED';
    if (vm.trust < RESOURCE_CONFIG.trustThreshold) return 'TRUST_THRESHOLD_DENIED';
    if (!isPlacementAdmissible(user, vm, policy)) return 'PLACEMENT_DENIED';
    if ((vm.total_resources - vm.used_resources) < taskProfile.requested_resources) return 'NO_VM_CAPACITY';
    if (vm.cpu < taskProfile.requested_cpu) return 'NO_CPU_CAPACITY';
    if (vm.mem < taskProfile.requested_mem) return 'NO_MEMORY_CAPACITY';
    return 'GRANTED';
}

function scoreVM(vm) {
    const w = RESOURCE_CONFIG.scoreWeights;
    return Number((w.load * vm.load + w.queue * vm.queue + w.risk * vm.risk - w.trust * vm.trust).toFixed(6));
}

function ema(values, period = 5) {
    const window = values.slice(-period);
    if (!window.length) return 0;

    const alpha = 2 / (window.length + 1);
    return window.reduce((result, value, index) =>
        index === 0 ? value : alpha * value + (1 - alpha) * result
    , window[0]);
}

function canScaleInPlace(vm) {
    return vm.total_resources < vm.base_resources * RESOURCE_CONFIG.maxCapacityMultiplier;
}

function applyPredictiveInPlaceScaling(vm, taskProfile) {
    const predictedLoad = ema(vm.load_history);
    const projectedLoad = (vm.used_resources + taskProfile.requested_resources) / vm.total_resources;
    const needsCapacity = (vm.total_resources - vm.used_resources) < taskProfile.requested_resources;
    const needsCpu = vm.cpu < taskProfile.requested_cpu;
    const needsMemory = vm.mem < taskProfile.requested_mem;
    const shouldScale = predictedLoad > RESOURCE_CONFIG.scaleUpThreshold
        || projectedLoad > RESOURCE_CONFIG.scaleUpThreshold
        || needsCapacity
        || needsCpu
        || needsMemory;

    if (!shouldScale || !canScaleInPlace(vm)) {
        return false;
    }

    const maxResources = vm.base_resources * RESOURCE_CONFIG.maxCapacityMultiplier;
    const addedResources = Math.max(
        taskProfile.requested_resources,
        Math.ceil(vm.base_resources * RESOURCE_CONFIG.scaleStep)
    );
    const nextTotal = Math.min(maxResources, vm.total_resources + addedResources);

    if (nextTotal === vm.total_resources) {
        return false;
    }

    vm.total_resources = nextTotal;
    vm.cpu = Number(Math.min(1, vm.cpu + RESOURCE_CONFIG.scaleStep).toFixed(4));
    vm.mem = Number(Math.min(1, vm.mem + RESOURCE_CONFIG.scaleStep).toFixed(4));
    vm.load = Number((vm.used_resources / vm.total_resources).toFixed(4));
    vm.load_history.push(vm.load);
    vm.trust = computeTrust(vm.history, vm.behavior, vm.load);
    vm.scale_events++;

    return true;
}

function allocateVm(vmPool, user, policy, taskProfile) {
    let candidateEvaluations = vmPool.map(vm => ({
        vm,
        reason: getAccessReason(user, vm, policy, taskProfile)
    }));
    const scalableCandidates = candidateEvaluations.filter(entry =>
        ['NO_VM_CAPACITY', 'NO_CPU_CAPACITY', 'NO_MEMORY_CAPACITY'].includes(entry.reason)
    );
    const scaled = scalableCandidates.some(entry => applyPredictiveInPlaceScaling(entry.vm, taskProfile));

    if (scaled) {
        candidateEvaluations = vmPool.map(vm => ({
            vm,
            reason: getAccessReason(user, vm, policy, taskProfile)
        }));
    }

    const eligibleVMs = candidateEvaluations
        .filter(entry => entry.reason === 'GRANTED')
        .map(entry => ({ ...entry.vm, score: scoreVM(entry.vm) }))
        .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));

    const selected = eligibleVMs[0] || null;
    if (!selected) {
        const firstBlockingReason = candidateEvaluations.find(entry =>
            !['VM_POLICY_LEVEL_MISMATCH', 'VM_COMPARTMENT_MISMATCH'].includes(entry.reason)
        )?.reason || 'NO_ELIGIBLE_VM';
        return { vm: null, reason: firstBlockingReason, eligible_count: 0, score: '' };
    }

    const vm = vmPool.find(item => item.id === selected.id);
    vm.used_resources += taskProfile.requested_resources;
    vm.allocated_tasks++;
    vm.load = Number((vm.used_resources / vm.total_resources).toFixed(4));
    vm.cpu = Number(Math.max(0, vm.cpu - taskProfile.requested_cpu).toFixed(4));
    vm.mem = Number(Math.max(0, vm.mem - taskProfile.requested_mem).toFixed(4));
    vm.queue = Number(Math.min(1, vm.queue + taskProfile.requested_resources / vm.total_resources).toFixed(4));
    vm.load_history.push(vm.load);
    vm.trust = computeTrust(vm.history, vm.behavior, vm.load);
    vm.risk = computeRisk(vm.colocation, vm.mixing, vm.anomaly);

    return {
        vm,
        reason: 'GRANTED',
        eligible_count: eligibleVMs.length,
        score: selected.score,
        scaled
    };
}

function createUserAllocationSummary() {
    return userPool.reduce((summary, user) => {
        summary[user.id] = {
            user_id: user.id,
            clearance: `L${user.clearance}`,
            total_requests: 0,
            allocated_tasks: 0,
            allocated_resources: 0,
            denied_requests: 0,
            hard_tasks: 0,
            medium_tasks: 0,
            easy_tasks: 0,
            assigned_vms: new Set(),
            allowed_policy_levels: new Set()
        };
        return summary;
    }, {});
}

function createTaskAllocationRecord(taskId, user, policy, taskProfile, decision, reason, allocation) {
    const vm = allocation.vm;
    const allocatedResources = vm ? taskProfile.requested_resources : 0;

    return {
        task_id: taskId,
        user_id: user.id,
        user_clearance: `L${user.clearance}`,
        policy_level: policy.label,
        policy_compartment: policy.compartment,
        action: taskProfile.action,
        task_difficulty: taskProfile.difficulty,
        requested_resources: taskProfile.requested_resources,
        decision,
        reason,
        vm_id: vm ? vm.id : 'none',
        vm_level: vm ? `L${vm.level}` : 'none',
        vm_compartment: vm ? vm.compartment : 'none',
        eligible_vm_count: allocation.eligible_count,
        allocation_score: allocation.score,
        in_place_scaled: allocation.scaled ? 'yes' : 'no',
        resource_allocated: allocatedResources,
        vm_remaining_resources_after: vm ? vm.total_resources - vm.used_resources : 0,
        alloc_status_key: `alloc_status_${taskId}`
    };
}

function recordUserAllocation(summary, user, policy, taskProfile, vm) {
    const row = summary[user.id];
    row.total_requests++;
    row[`${taskProfile.difficulty}_tasks`]++;

    if (vm) {
        row.allocated_tasks++;
        row.allocated_resources += taskProfile.requested_resources;
        row.assigned_vms.add(vm.id);
        row.allowed_policy_levels.add(policy.label);
    } else {
        row.denied_requests++;
    }
}

function formatUserAllocationRows(summary) {
    return Object.values(summary).map(row => ({
        ...row,
        resource_per_request: row.total_requests
            ? (row.allocated_resources / row.total_requests).toFixed(2)
            : '0.00',
        assigned_vms: Array.from(row.assigned_vms).sort().join('|') || 'none',
        allowed_policy_levels: Array.from(row.allowed_policy_levels).sort().join('|') || 'none'
    }));
}

function formatVmAllocationRows(vmPool) {
    return vmPool.map(vm => ({
        vm_id: vm.id,
        vm_level: `L${vm.level}`,
        compartment: vm.compartment,
        total_resources: vm.total_resources,
        used_resources: vm.used_resources,
        remaining_resources: vm.total_resources - vm.used_resources,
        allocated_tasks: vm.allocated_tasks,
        scale_events: vm.scale_events,
        cpu: vm.cpu,
        mem: vm.mem,
        load: vm.load,
        queue: vm.queue,
        risk: vm.risk,
        trust: vm.trust,
        utilization_rate: ((vm.used_resources / vm.total_resources) * 100).toFixed(2)
    }));
}

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
        const p = createPolicyRecord(i);
        const pStr = JSON.stringify(p);
        const hash = crypto.createHash('sha256').update(pStr).digest('hex');
        await redisClient.set(`policy_${i}`, JSON.stringify({ policy: pStr, hash: hash }));
    }

    const finalReport = [];
    const vmPool = createVmPool();
    const proposedUserAllocation = createUserAllocationSummary();
    const proposedTaskAllocation = [];

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
            const user = userPool[i % userPool.length];
            const action = selectAction(i, user, policy);
            const taskProfile = estimateTaskProfile(i, policy, action);
            const allocation = allocateVm(vmPool, user, policy, taskProfile);
            const decision = allocation.vm ? 'ALLOWED' : 'DENIED';

            recordUserAllocation(proposedUserAllocation, user, policy, taskProfile, allocation.vm);
            proposedTaskAllocation.push(createTaskAllocationRecord(i, user, policy, taskProfile, decision, allocation.reason, allocation));
            
            // MLAC DECISION: อนุมัติการจัดสรรตามกฎระดับชั้น
            if (allocation.vm) {
                await redisClient.set(`alloc_status_${i}`, `ALLOWED_FOR_${user.id}_ON_${allocation.vm.id}_${taskProfile.requested_resources}_RESOURCES`);
            } else {
                await redisClient.set(`alloc_status_${i}`, `DENIED_FOR_${user.id}_${allocation.reason}`);
            }
        })));

        const header = "Scenario,Target_Step_Load,Throughput_RPS,Avg_Latency_ms,P99_Latency_ms,Error_Rate_%\n";
        const rows = finalReport.map(r => 
            `${r.scenario},${r.step_load},${r.throughput},${r.avg_latency},${r.p99_latency},${r.error_rate}`
        ).join('\n');

        await fs.writeFile('full_allocation_p99_report.csv', header + rows, 'utf8');

        const userAllocationRows = formatUserAllocationRows(proposedUserAllocation);
        const allocationHeader = "User_ID,Clearance,Total_Requests,Allocated_Tasks,Allocated_Resources,Denied_Requests,Hard_Tasks,Medium_Tasks,Easy_Tasks,Resource_Per_Request,Assigned_VMs,Allowed_Policy_Levels\n";
        const allocationRows = userAllocationRows.map(r =>
            `${r.user_id},${r.clearance},${r.total_requests},${r.allocated_tasks},${r.allocated_resources},${r.denied_requests},${r.hard_tasks},${r.medium_tasks},${r.easy_tasks},${r.resource_per_request},${r.assigned_vms},${r.allowed_policy_levels}`
        ).join('\n');

        await fs.writeFile('proposed_user_allocation_report.csv', allocationHeader + allocationRows, 'utf8');

        const taskAllocationHeader = "Task_ID,User_ID,User_Clearance,Policy_Level,Policy_Compartment,Action,Task_Difficulty,Requested_Resources,Decision,Reason,VM_ID,VM_Level,VM_Compartment,Eligible_VM_Count,Allocation_Score,In_Place_Scaled,Resource_Allocated,VM_Remaining_Resources_After,Alloc_Status_Key\n";
        const taskAllocationRows = proposedTaskAllocation
            .sort((a, b) => a.task_id - b.task_id)
            .map(r =>
                `${r.task_id},${r.user_id},${r.user_clearance},${r.policy_level},${r.policy_compartment},${r.action},${r.task_difficulty},${r.requested_resources},${r.decision},${r.reason},${r.vm_id},${r.vm_level},${r.vm_compartment},${r.eligible_vm_count},${r.allocation_score},${r.in_place_scaled},${r.resource_allocated},${r.vm_remaining_resources_after},${r.alloc_status_key}`
            ).join('\n');

        await fs.writeFile('proposed_task_allocation_report.csv', taskAllocationHeader + taskAllocationRows, 'utf8');

        const vmAllocationRows = formatVmAllocationRows(vmPool);
        const vmAllocationHeader = "VM_ID,VM_Level,Compartment,Total_Resources,Used_Resources,Remaining_Resources,Allocated_Tasks,Scale_Events,CPU_Available,Memory_Available,Load,Queue,Risk,Trust,Utilization_Rate_%\n";
        const vmAllocationCsvRows = vmAllocationRows.map(r =>
            `${r.vm_id},${r.vm_level},${r.compartment},${r.total_resources},${r.used_resources},${r.remaining_resources},${r.allocated_tasks},${r.scale_events},${r.cpu},${r.mem},${r.load},${r.queue},${r.risk},${r.trust},${r.utilization_rate}`
        ).join('\n');

        await fs.writeFile('proposed_vm_allocation_report.csv', vmAllocationHeader + vmAllocationCsvRows, 'utf8');

        console.log('\n📊 Proposed MLVM per-user resource allocation:');
        console.table(userAllocationRows.map(r => ({
            User: r.user_id,
            Clearance: r.clearance,
            Requests: r.total_requests,
            Tasks: r.allocated_tasks,
            Resources: r.allocated_resources,
            Denied: r.denied_requests,
            Avg_Resource_Per_Request: r.resource_per_request,
            VMs: r.assigned_vms,
            Policy_Levels: r.allowed_policy_levels
        })));
        console.log(`\n🎉 Test Complete! Results for all levels (L0-L5) saved.`);

    } finally {
        await redisClient.disconnect();
        gateway.close();
        client.close();
    }
}

main().catch(console.error);
