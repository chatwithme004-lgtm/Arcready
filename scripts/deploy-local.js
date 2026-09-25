// Deploys the oracle + two sample contracts to the local hardhat chain for the web preview.
import fs from 'node:fs';
import { createWalletClient, http, publicActions } from 'viem';
import { hardhat } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import solc from 'solc';

// Hardhat's first default dev key: public, local test ETH only.
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const w = createWalletClient({ account, chain: hardhat, transport: http() }).extend(publicActions);
const deploy = async ({ abi, bytecode }) => (await w.waitForTransactionReceipt({ hash: await w.deployContract({ abi, bytecode }) })).contractAddress;
const compile = (name, body) => {
  const c = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'a.sol': { content: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n${body}` } }, settings: { evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }))).contracts['a.sol'][name];
  return { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
};
const oracle = await deploy(JSON.parse(fs.readFileSync('build/ArcReadyOracle.json')));
const lottery = await deploy(compile('Lottery', 'contract Lottery { address[] p; function draw() external { payable(p[block.prevrandao % p.length]).transfer(1); } function enter() external { p.push(msg.sender); } }'));
const counter = await deploy(compile('Counter', 'contract Counter { uint256 public n; function inc() external { n++; } }'));
const cfg = fs.readFileSync('web/config.js', 'utf8').replace(/(local: \{[^}]*oracle: )[^ }]+/, `$1'${oracle}'`);
fs.writeFileSync('web/config.js', cfg);
console.log({ oracle, lottery, counter });
