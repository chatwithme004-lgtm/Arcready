// Re-runs the bytecode checks on every contract that was flagged, after a rule change.
// The rule fixes only remove false alarms, so unflagged contracts don't need a recheck.
import fs from 'node:fs';
import { createPublicClient, http } from 'viem';
import { arc } from 'viem/chains';
import { checkBytecode } from '../src/bytecode.js';

const client = createPublicClient({ chain: arc, transport: http('https://rpc.mainnet.arc.io', { retryCount: 5, retryDelay: 1500 }) });
const s = JSON.parse(fs.readFileSync('data/crawl.json'));
const flagged = Object.entries(s.addrs).filter(([, x]) => (x.findings || []).length);
let cleared = 0;
for (const [addr, x] of flagged) {
  const before = x.findings.join(',');
  x.findings = checkBytecode((await client.getCode({ address: addr })) || '0x').findings.map((f) => f.id);
  if (x.findings.join(',') !== before) cleared++;
  await new Promise((r) => setTimeout(r, 40));
}
fs.writeFileSync('data/crawl.json', JSON.stringify(s));
console.log(`rechecked ${flagged.length}, changed ${cleared}`);
