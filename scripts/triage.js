// Groups flagged contracts by identical code, pulls their function selectors and looks the
// selectors up in the public openchain signature database, so each unique contract can be
// sorted into "randomness really matters here" vs "harmless". Output: data/triage.json.
import fs from 'node:fs';
import { createPublicClient, http, keccak256 } from 'viem';
import { arc } from 'viem/chains';

const client = createPublicClient({ chain: arc, transport: http('https://rpc.mainnet.arc.io', { retryCount: 5, retryDelay: 1500 }) });
const s = JSON.parse(fs.readFileSync('data/crawl.json'));
const RULE = process.env.RULE || 'ARC-001';
const flagged = Object.entries(s.addrs).filter(([, x]) => (x.findings || []).includes(RULE));
console.log(`${flagged.length} contracts flagged ${RULE}`);

// Selectors from the dispatcher: PUSH4 <sel> followed (after optional DUP/opcodes) by EQ.
function selectors(code) {
  const b = Buffer.from(code.slice(2), 'hex');
  const out = new Set();
  for (let i = 0; i < b.length; i++) {
    const op = b[i];
    if (op === 0x63 && i + 5 < b.length && (b[i + 5] === 0x14 || b[i + 6] === 0x14)) out.add('0x' + b.subarray(i + 1, i + 5).toString('hex'));
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  return [...out];
}

const groups = {};
for (const [addr, x] of flagged) {
  const code = await client.getCode({ address: addr });
  const h = keccak256(code);
  (groups[h] ||= { addrs: [], hits: 0, size: code.length / 2 - 1, selectors: selectors(code) }).addrs.push(addr);
  groups[h].hits += x.hits;
}
const uniq = Object.values(groups).sort((a, b) => b.hits - a.hits);
console.log(`${uniq.length} unique codes`);

const allSel = [...new Set(uniq.flatMap((g) => g.selectors))];
const names = {};
for (let i = 0; i < allSel.length; i += 50) {
  const q = allSel.slice(i, i + 50).join(',');
  const r = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${q}&filter=true`).then((r) => r.json()).catch(() => null);
  for (const [sel, arr] of Object.entries(r?.result?.function || {})) if (arr?.length) names[sel] = arr[0].name;
  await new Promise((r) => setTimeout(r, 300));
}
for (const g of uniq) g.functions = g.selectors.map((x) => names[x] || x);
fs.writeFileSync('data/triage.json', JSON.stringify(uniq, null, 2));
console.log(`named ${Object.keys(names).length}/${allSel.length} selectors`);
