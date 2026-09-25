// Samples Arc mainnet since public launch to find the contracts people actually use, then scans
// their bytecode. Each sample = one block: its transaction targets, its deployments and the
// contracts that emitted events. Read-only, throttled, resumable via data/crawl.json.
import fs from 'node:fs';
import { createPublicClient, http } from 'viem';
import { arc } from 'viem/chains';
import { checkBytecode } from '../src/bytecode.js';

const RPC = process.env.ARC_RPC || 'https://rpc.mainnet.arc.io';
const STATE = new URL('../data/crawl.json', import.meta.url);
const LAUNCH = Date.parse('2026-09-16T00:00:00Z') / 1000;
const SAMPLES = Number(process.env.SAMPLES || 2500);
const SYSTEM = new Set(['0xfffffffffffffffffffffffffffffffffffffffe', '0x3600000000000000000000000000000000000000']);

const client = createPublicClient({ chain: arc, transport: http(RPC, { retryCount: 5, retryDelay: 1500 }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function blockAt(ts) {
  let lo = 1n, hi = await client.getBlockNumber();
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (Number((await client.getBlock({ blockNumber: mid })).timestamp) < ts) lo = mid + 1n; else hi = mid;
  }
  return lo;
}

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : null;
const s = state || { start: String(await blockAt(LAUNCH)), head: String(await client.getBlockNumber()), done: 0, blocks: [], addrs: {} };
const save = () => fs.writeFileSync(STATE, JSON.stringify(s));
const start = BigInt(s.start), head = BigInt(s.head);
const step = (head - start) / BigInt(SAMPLES);
console.log(`sampling ${SAMPLES} blocks in ${start}..${head} (every ${step}), resuming at ${s.done}`);

const seen = (a, how, block) => {
  a = a.toLowerCase();
  if (SYSTEM.has(a)) return;
  const x = (s.addrs[a] ||= { hits: 0, how: {}, first: block });
  x.hits++;
  x.how[how] = (x.how[how] || 0) + 1;
};

for (; s.done < SAMPLES; s.done++) {
  const n = start + step * BigInt(s.done);
  const b = await client.getBlock({ blockNumber: n, includeTransactions: true });
  for (const tx of b.transactions) {
    if (tx.to) seen(tx.to, 'tx', Number(n));
    else {
      // Old receipts can be pruned on the public RPC; count the miss instead of stopping.
      const r = await client.getTransactionReceipt({ hash: tx.hash }).catch(() => null);
      if (r?.contractAddress) seen(r.contractAddress, 'deploy', Number(n));
      else if (!r) s.missingReceipts = (s.missingReceipts || 0) + 1;
    }
  }
  const logs = await client.getLogs({ fromBlock: n, toBlock: n });
  for (const l of logs) seen(l.address, 'event', Number(n));
  s.blocks.push([Number(n), b.transactions.length, logs.length]);
  if (s.done % 100 === 0) { save(); console.log(`sample ${s.done}/${SAMPLES}, addresses ${Object.keys(s.addrs).length}`); }
  await sleep(60);
}
save();

const todo = Object.entries(s.addrs).filter(([, x]) => x.kind === undefined);
console.log(`classifying + scanning ${todo.length} addresses`);
let i = 0;
for (const [addr, x] of todo) {
  const code = (await client.getCode({ address: addr })) || '0x';
  if (code === '0x') x.kind = 'eoa';
  else if (code.startsWith('0xef0100')) { x.kind = 'eip7702'; x.delegate = '0x' + code.slice(8, 48); }
  else {
    x.kind = 'contract';
    const r = checkBytecode(code);
    x.size = r.size;
    x.findings = r.findings.map((f) => f.id);
  }
  if (++i % 200 === 0) { save(); console.log(`scanned ${i}/${todo.length}`); }
  await sleep(40);
}
save();
console.log('done');
