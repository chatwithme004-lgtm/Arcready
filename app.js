import { createPublicClient, createWalletClient, custom, http, isAddress, getAddress } from 'https://esm.sh/viem@2.56.9';
import { checkSource } from './source.js';
import { BYTECODE_RULES } from './rules.js';
import { NETWORKS, ACTIVE } from './config.js';

const net = NETWORKS[ACTIVE];
const chain = {
  id: net.id,
  name: net.name,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [net.rpc] } },
};
const client = createPublicClient({ chain, transport: http(net.rpc) });

const ORACLE_ABI = [
  { type: 'function', name: 'scan', stateMutability: 'view', inputs: [{ name: 'target', type: 'address' }], outputs: [{ name: 'ready', type: 'bool' }, { name: 'flags', type: 'uint256' }, { name: 'size', type: 'uint256' }] },
  { type: 'function', name: 'status', stateMutability: 'view', inputs: [{ name: 'target', type: 'address' }], outputs: [{ name: 'attested', type: 'bool' }, { name: 'ready', type: 'bool' }, { name: 'current', type: 'bool' }, { name: 'flags', type: 'uint256' }] },
  { type: 'function', name: 'attest', stateMutability: 'nonpayable', inputs: [{ name: 'target', type: 'address' }], outputs: [{ name: 'flags', type: 'uint256' }] },
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Tabs
document.querySelectorAll('[role=tab]').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('[role=tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
    for (const t of ['source', 'address', 'report']) $('tab-' + t).hidden = t !== b.dataset.tab;
    if (b.dataset.tab === 'report') loadReport();
  }),
);

function renderFindings(findings, where) {
  if (!findings.length) {
    return `<div class="verdict ok">No Arc differences found. ${where}</div>`;
  }
  const high = findings.some((f) => f.severity === 'high');
  const head = `<div class="verdict ${high ? 'bad' : 'warn'}">${findings.length} thing${findings.length > 1 ? 's' : ''} to fix before relying on this on Arc</div>`;
  return head + findings.map((f) => `
    <div class="finding">
      <h3><span class="sev ${f.severity}">${f.severity}</span>${esc(f.title)}</h3>
      ${f.line ? `<code>line ${f.line}: ${esc(f.evidence)}</code>` : f.evidence ? `<code>${esc(f.evidence)}</code>` : ''}
      <p>${esc(f.fix)} <a href="${f.doc}" target="_blank" rel="noopener">Circle docs</a></p>
      ${f.patch ? `<details><summary>Suggested fix</summary><pre>${esc(f.patch)}</pre></details>` : ''}
    </div>`).join('');
}

// Source tab
const EXAMPLE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 { function balanceOf(address) external view returns (uint256); }

contract Raffle {
    IERC20 public usdc;
    address[] public players;

    function enter() external payable {
        require(msg.value == 1e18, "1 USDC to enter");
        players.push(msg.sender);
    }

    function pot() public view returns (uint256) {
        return address(this).balance + usdc.balanceOf(address(this));
    }

    function draw() external {
        address winner = players[block.prevrandao % players.length];
        payable(winner).transfer(pot());
    }
}`;
$('example').onclick = () => { $('src').value = EXAMPLE; $('run-source').click(); };
$('run-source').onclick = () => {
  const src = $('src').value.trim();
  if (!src) { $('out-source').innerHTML = '<p class="hint">Paste some Solidity first.</p>'; return; }
  $('out-source').innerHTML = renderFindings(checkSource(src), 'This covers the checks in Circle\'s porting guide.');
};

// Address tab
$('net').textContent = net.oracle ? `Oracle on ${net.name}` : `Oracle not deployed on ${net.name} yet`;
let lastAddr = null;
$('run-address').onclick = async () => {
  const raw = $('addr').value.trim();
  const out = $('out-address');
  $('attest').hidden = true;
  if (!isAddress(raw)) { out.innerHTML = '<p class="hint">Enter a valid 0x address.</p>'; return; }
  if (!net.oracle) { out.innerHTML = '<p class="hint">The oracle is not deployed on this network yet.</p>'; return; }
  const addr = getAddress(raw);
  out.innerHTML = '<p class="hint">Checking on-chain…</p>';
  try {
    const [[ready, flags, size], [attested, , current]] = await Promise.all([
      client.readContract({ address: net.oracle, abi: ORACLE_ABI, functionName: 'scan', args: [addr] }),
      client.readContract({ address: net.oracle, abi: ORACLE_ABI, functionName: 'status', args: [addr] }),
    ]);
    if (flags === 64n) { out.innerHTML = '<div class="verdict warn">No contract at this address on Arc.</div>'; return; }
    if (flags === 32n) { out.innerHTML = '<div class="verdict warn">This is a wallet with an EIP-7702 delegation, not a contract.</div>'; return; }
    const findings = Object.values(BYTECODE_RULES).filter((r) => (flags & BigInt(r.bit)) !== 0n);
    const note = attested
      ? current ? 'A result for this code is already recorded on Arc.' : 'A result was recorded, but the code has changed since.'
      : 'Not recorded on Arc yet.';
    out.innerHTML = renderFindings(findings, '') + `<p class="hint">${Number(size).toLocaleString()} bytes of code checked by the oracle contract. ${note}</p><div id="out-sourcify"><p class="hint">Looking for verified source on Sourcify…</p></div>`;
    lastAddr = addr;
    $('attest').hidden = !window.ethereum;
    sourcify(addr);
  } catch (e) {
    out.innerHTML = `<p class="hint">Couldn't reach ${esc(net.name)}: ${esc(e.shortMessage || e.message)}</p>`;
  }
};

// Verified source from Sourcify (it indexes Arc) lets us run the full source checklist too.
async function sourcify(addr) {
  const box = $('out-sourcify');
  try {
    const r = await fetch(`https://sourcify.dev/server/v2/contract/${net.id}/${addr}?fields=sources,compilation`);
    if (!r.ok) { box.innerHTML = '<p class="hint">No verified source on Sourcify, so bytecode checks only. Paste the source in the first tab for the full checklist.</p>'; return; }
    const d = await r.json();
    const own = Object.entries(d.sources || {}).filter(([p]) => !/node_modules|@openzeppelin|forge-std|\/lib\//.test(p));
    const findings = own.flatMap(([path, f]) => checkSource(f.content).map((x) => ({ ...x, evidence: `${path.split('/').pop()}:${x.line}  ${x.evidence}`, line: null })));
    box.innerHTML = `<h3 style="margin:20px 0 0;font-size:16px">Verified source: ${esc(d.compilation?.name || 'contract')} (${own.length} file${own.length === 1 ? '' : 's'})</h3>` + renderFindings(findings, 'The full source checklist passed.');
  } catch {
    box.innerHTML = '<p class="hint">Couldn\'t reach Sourcify.</p>';
  }
}

$('attest').onclick = async () => {
  const out = $('out-address');
  try {
    const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
    const [account] = await wallet.requestAddresses();
    await wallet.switchChain({ id: chain.id }).catch(() => wallet.addChain({ chain }));
    const hash = await wallet.writeContract({ account, address: net.oracle, abi: ORACLE_ABI, functionName: 'attest', args: [lastAddr] });
    out.insertAdjacentHTML('beforeend', `<p class="hint">Recorded. Transaction ${net.explorer ? `<a href="${net.explorer}/tx/${hash}" target="_blank" rel="noopener">${hash.slice(0, 10)}…</a>` : esc(hash)}</p>`);
    $('attest').hidden = true;
  } catch (e) {
    out.insertAdjacentHTML('beforeend', `<p class="hint">Not recorded: ${esc(e.shortMessage || e.message)}</p>`);
  }
};

// Report tab
let reportLoaded = false;
async function loadReport() {
  if (reportLoaded) return;
  const out = $('out-report');
  try {
    const r = await (await fetch('report.json')).json();
    reportLoaded = true;
    const pct = (n) => (r.contracts ? ((100 * n) / r.contracts).toFixed(1) : '0') + '%';
    out.innerHTML = `
      <p class="hint">Snapshot of Arc mainnet from ${esc(r.from)} to ${esc(r.to)}: ${r.samples.toLocaleString()} evenly spaced blocks, every contract active in them scanned.</p>
      <div class="stats">
        <div class="stat"><b>${r.contracts.toLocaleString()}</b><span>active contracts scanned</span></div>
        <div class="stat"><b>${r.flagged.toLocaleString()}</b><span>use something that behaves differently on Arc (${pct(r.flagged)})</span></div>
        <div class="stat"><b>${r.byRule['ARC-001'] || 0}</b><span>read randomness (PREVRANDAO) that is always 0 on Arc</span></div>
        <div class="stat"><b>${r.delegated.toLocaleString()}</b><span>wallets using EIP-7702 delegation</span></div>
      </div>
      <table><thead><tr><th>Check</th><th>Contracts</th></tr></thead><tbody>
        ${Object.values(BYTECODE_RULES).map((x) => `<tr><td>${esc(x.title)}</td><td>${r.byRule[x.id] || 0}</td></tr>`).join('')}
      </tbody></table>
      <p class="hint">Addresses of affected contracts are not published here. Owners are being contacted privately first.</p>`;
  } catch {
    out.innerHTML = '<p class="hint">Report not generated yet.</p>';
  }
}
