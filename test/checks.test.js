import { test } from 'node:test';
import assert from 'node:assert/strict';
import solc from 'solc';
import { checkSource, blank } from '../src/source.js';
import { checkBytecode, walk } from '../src/bytecode.js';

const LOTTERY = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IERC20 { function balanceOf(address) external view returns (uint256); }
contract Lottery {
    IERC20 usdc;
    address[] players;
    // block.prevrandao in a comment must not count
    function enter() external payable { require(msg.value == 1e18); players.push(msg.sender); }
    function pot() external view returns (uint256) { return address(this).balance + usdc.balanceOf(address(this)); }
    function draw() external { address w = players[block.prevrandao % players.length]; payable(w).transfer(address(this).balance); }
    function kill() external { selfdestruct(payable(msg.sender)); }
}`;

const CLEAN = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Counter { uint256 public n; function inc() external { n++; } }`;

function runtime(src, name) {
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'a.sol': { content: src } },
    settings: { evmVersion: 'cancun', outputSelection: { '*': { '*': ['evm.deployedBytecode.object'] } } },
  })));
  return '0x' + out.contracts['a.sol'][name].evm.deployedBytecode.object;
}

test('source: finds the Arc problems in a lottery', () => {
  const ids = checkSource(LOTTERY).map((f) => f.id);
  assert.ok(ids.includes('ARC-001'), 'prevrandao');
  assert.ok(ids.includes('ARC-002'), 'selfdestruct');
  assert.ok(ids.includes('ARC-006'), 'msg.value + balanceOf');
  assert.ok(ids.includes('ARC-007'), 'address.balance + balanceOf');
  assert.equal(ids.filter((i) => i === 'ARC-001').length, 1, 'comment mention ignored');
});

test('source: clean contract has no findings', () => {
  assert.deepEqual(checkSource(CLEAN), []);
});

test('source: blanking keeps line numbers', () => {
  const s = 'a // x\n/* y\nz */ b';
  assert.equal(blank(s).split('\n').length, 3);
});

test('bytecode: finds PREVRANDAO and SELFDESTRUCT in compiled lottery', () => {
  const ids = checkBytecode(runtime(LOTTERY, 'Lottery')).findings.map((f) => f.id);
  assert.ok(ids.includes('ARC-001'));
  assert.ok(ids.includes('ARC-002'));
});

test('bytecode: compiled clean contract has no findings', () => {
  assert.deepEqual(checkBytecode(runtime(CLEAN, 'Counter')).findings, []);
});

test('bytecode: 0x44 inside PUSH data is not an opcode', () => {
  assert.equal(walk('0x6044').opcodes.size, 0); // PUSH1 0x44
  assert.ok(walk('0x44').opcodes.has('PREVRANDAO'));
});
