// Builds web/report.json (aggregate numbers only, no addresses) from data/crawl.json.
import fs from 'node:fs';
const s = JSON.parse(fs.readFileSync('data/crawl.json'));
const all = Object.values(s.addrs);
const contracts = all.filter((a) => a.kind === 'contract');
const byRule = {};
for (const c of contracts) for (const id of c.findings || []) byRule[id] = (byRule[id] || 0) + 1;
const blocks = s.blocks.map((b) => b[0]);
const report = {
  from: '16 Sep 2026',
  to: '25 Sep 2026',
  samples: s.done,
  firstBlock: Math.min(...blocks),
  lastBlock: Math.max(...blocks),
  contracts: contracts.length,
  flagged: contracts.filter((c) => (c.findings || []).length).length,
  delegated: all.filter((a) => a.kind === 'eip7702').length,
  byRule,
};
fs.writeFileSync('web/report.json', JSON.stringify(report, null, 2));
console.log(report);
