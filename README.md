#Prerequisites
Before running the scripts, ensure your system has the following installed and actively running:

Node.js (v16.x or v18.x recommended)

Redis Server (Running locally on default port 6379)

Hyperledger Fabric Test Network (v2.4+)

The Fabric network must be actively running with a channel named mychannel.

The chaincode named policy_cc must be deployed

# Install dependencies
npm install @grpc/grpc-js @hyperledger/fabric-gateway redis merkletreejs crypto

#How to Run and Test
Running the Security Audit Benchmark

This script simulates 4 distinct attack vectors (Data Modification, Deletion, Fake Insertion, and Replay Attacks) across 4 different system architectures.

Run the following command in your terminal:

Bash
node audit_benchmark.js
(Note: Replace audit_benchmark.js with the actual name of your file).
