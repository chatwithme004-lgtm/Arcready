#!/usr/bin/env node
// arcready <files or folders...>   check Solidity source
// arcready 0x…                     check a deployed contract on Arc (bytecode + verified source)
// Options: --json   machine-readable output
//          --fail-on=high|medium|low   exit 1 when a finding at or above this level exists (default high)
import fs from 'node:fs';
import path from 'node:path';
import { checkSource } from '../src/source.js';
import { checkBytecode } from '../src/bytecode.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const failOn = (args.find((a) => a.startsWith('--fail-on=')) || '--fail-on=high').split('=')[1];
const targets = args.filter((a) => !a.startsWith('--'));
const RANK = { low: 1, medium: 2, high: 3 };
const RPC = process.env.ARC_RPC || 'https://rpc.mainnet.arc.io';
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042);
const SKIP = /(^|\/)(node_modules|lib|out|cache|artifacts|\.git)(\/|$)/;

if (!targets.length || args.includes('--help')) {
  console.log('usage: arcready <file.sol | folder | 0xaddress> [--json] [--fail-on=high|medium|low]');
  process.exit(targets.length ? 0 : 2);
}

function solFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return p.endsWith('.sol') ? [p] : [];
  return fs.readdirSync(p).flatMap((f) => {
    const full = path.join(p, f);
    return SKIP.test(full) ? [] : solFiles(full);
  });
}

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.result;
}

async function checkAddress(addr) {
  const code = await rpc('eth_getCode', [addr, 'latest']);
  const results = [{ target: addr, kind: 'bytecode', findings: checkBytecode(code).findings, size: (code.length - 2) / 2 }];
  const r = await fetch(`https://sourcify.dev/server/v2/contract/${CHAIN_ID}/${addr}?fields=sources`).catch(() => null);
  if (r?.ok) {
    const { sources } = await r.json();
    for (const [p, f] of Object.entries(sources || {})) {
      if (/node_modules|@openzeppelin|forge-std|\/lib\//.test(p)) continue;
      results.push({ target: `${addr} (verified) ${p}`, kind: 'source', findings: checkSource(f.content) });
    }
  }
  return results;
}

const results = [];
for (const t of targets) {
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) results.push(...(await checkAddress(t)));
  else for (const f of solFiles(t)) results.push({ target: f, kind: 'source', findings: checkSource(fs.readFileSync(f, 'utf8')) });
}

const all = results.flatMap((r) => r.findings);
const worst = Math.max(0, ...all.map((f) => RANK[f.severity]));

if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const color = process.stdout.isTTY ? { high: '\x1b[31m', medium: '\x1b[33m', low: '\x1b[36m', dim: '\x1b[2m', off: '\x1b[0m' } : { high: '', medium: '', low: '', dim: '', off: '' };
  for (const r of results) {
    if (r.kind === 'bytecode' && r.size === 0) { console.log(`${r.target}: no contract deployed`); continue; }
    console.log(`\n${r.target}${r.findings.length ? '' : '  ✓ no Arc differences found'}`);
    for (const f of r.findings) {
      console.log(`  ${color[f.severity]}${f.severity.padEnd(6)}${color.off} ${f.id}  ${f.title}${f.line ? `  (line ${f.line})` : ''}`);
      console.log(`         ${color.dim}${f.fix}${color.off}`);
    }
  }
  const files = results.length;
  console.log(`\n${all.length} finding${all.length === 1 ? '' : 's'} in ${files} target${files === 1 ? '' : 's'}. Rules: docs.arc.io/arc/tutorials/porting-contracts-to-arc`);
}

process.exit(worst >= RANK[failOn] ? 1 : 0);
