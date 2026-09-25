// Deploys the oracle on a local chain and checks it agrees with the JS checker.
// Needs `npx hardhat node --config hardhat.config.cjs` running on 127.0.0.1:8545.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import { createTestClient, createWalletClient, createPublicClient, http, publicActions } from 'viem';
import { hardhat } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { checkBytecode } from '../src/bytecode.js';

// Hardhat's first default dev key: public, holds only local test ETH.
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const wallet = createWalletClient({ account, chain: hardhat, transport: http() }).extend(publicActions);
const oracleArt = JSON.parse(fs.readFileSync(new URL('../build/ArcReadyOracle.json', import.meta.url)));

const SAMPLES = {
  Lottery: `contract Lottery { address[] p; function draw() external { payable(p[block.prevrandao % p.length]).transfer(1); } function kill() external { selfdestruct(payable(msg.sender)); } function enter() external { p.push(msg.sender); } }`,
  Counter: `contract Counter { uint256 public n; function inc() external { n++; } }`,
  Beacon: `contract Beacon { function root() external view returns (bool ok) { (ok,) = address(0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02).staticcall(abi.encode(block.timestamp)); } }`,
  Blob: `contract Blob { function h() external view returns (bytes32) { return blobhash(0); } function f() external view returns (uint256) { return block.blobbasefee; } }`,
  Tricky: `contract Tricky { uint256 public x = 0x4444ffff44; }`,
};

function compile(name, body) {
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'a.sol': { content: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n${body}` } },
    settings: { evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  })));
  const c = out.contracts['a.sol'][name];
  return { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
}

async function deploy({ abi, bytecode }) {
  const hash = await wallet.deployContract({ abi, bytecode });
  return (await wallet.waitForTransactionReceipt({ hash })).contractAddress;
}

const oracle = await deploy(oracleArt);
const read = (fn, args) => wallet.readContract({ address: oracle, abi: oracleArt.abi, functionName: fn, args });
const BIT = { 'ARC-001': 1n, 'ARC-002': 2n, 'ARC-003': 4n, 'ARC-004': 8n, 'ARC-005': 16n };

for (const [name, body] of Object.entries(SAMPLES)) {
  test(`oracle agrees with JS checker: ${name}`, async () => {
    const addr = await deploy(compile(name, body));
    const [ready, flags] = await read('scan', [addr]);
    const js = checkBytecode(await wallet.getCode({ address: addr })).findings.map((f) => BIT[f.id]);
    const jsFlags = js.reduce((a, b) => a | b, 0n);
    assert.equal(flags, jsFlags, `${name}: oracle ${flags} vs js ${jsFlags}`);
    assert.equal(ready, jsFlags === 0n);
  });
}

test('expected results per sample', async () => {
  const flagsOf = async (name) => (await read('scan', [await deploy(compile(name, SAMPLES[name]))]))[1];
  assert.equal(await flagsOf('Lottery'), 3n); // PREVRANDAO | SELFDESTRUCT
  assert.equal(await flagsOf('Counter'), 0n);
  assert.equal(await flagsOf('Beacon'), 16n);
  assert.equal(await flagsOf('Blob'), 12n);
  assert.equal(await flagsOf('Tricky'), 0n); // 0x44/0xff only inside PUSH data
});

test('no code and EOA return NO_CODE', async () => {
  const [ready, flags] = await read('scan', ['0x000000000000000000000000000000000000dEaD']);
  assert.equal(ready, false);
  assert.equal(flags, 64n);
});

test('attest stores result tied to code hash', async () => {
  const addr = await deploy(compile('Lottery', SAMPLES.Lottery));
  const hash = await wallet.writeContract({ address: oracle, abi: oracleArt.abi, functionName: 'attest', args: [addr] });
  const r = await wallet.waitForTransactionReceipt({ hash });
  assert.equal(r.status, 'success');
  const [attested, ready, current, flags] = await read('status', [addr]);
  assert.deepEqual([attested, ready, current, flags], [true, false, true, 3n]);
  console.log('attest gas used:', r.gasUsed);
});
