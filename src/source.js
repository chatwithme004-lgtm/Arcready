// Source-level checks for Solidity before it is deployed to Arc. Each rule maps to a step in
// docs.arc.io "Port a contract to Arc". Comments and strings are blanked first so matches
// only hit real code.

const DOC = 'https://docs.arc.io/arc/tutorials/porting-contracts-to-arc';
const EVM = 'https://docs.arc.io/arc/references/evm-differences';

export const SOURCE_RULES = [
  {
    id: 'ARC-001',
    severity: 'high',
    title: 'On-chain randomness is always 0 on Arc',
    pattern: /\bblock\s*\.\s*(prevrandao|difficulty)\b/g,
    fix: 'block.prevrandao / block.difficulty return 0. Anything random (lottery, mint order, shuffle) becomes predictable. Use a VRF or oracle.',
    doc: EVM,
  },
  {
    id: 'ARC-002',
    severity: 'medium',
    title: 'selfdestruct moves the contract\'s USDC and can revert',
    pattern: /\bselfdestruct\s*\(/g,
    fix: 'The contract\'s USDC is its native balance and goes to the beneficiary. Reverts for self, zero address, blocklisted or already-destructed beneficiaries.',
    doc: EVM + '#selfdestruct',
  },
  {
    id: 'ARC-006',
    severity: 'high',
    title: 'Mixes msg.value (18 decimals) with USDC balanceOf (6 decimals)',
    test: (code) => /\bmsg\s*\.\s*value\b/.test(code) && /\bbalanceOf\s*\(/.test(code),
    pattern: /\bmsg\s*\.\s*value\b/g,
    fix: 'Native USDC uses 18 decimals and the ERC-20 view uses 6. Raw values differ by 10^12. Convert before comparing or adding.',
    doc: DOC,
  },
  {
    id: 'ARC-007',
    severity: 'high',
    title: 'Compares or combines address.balance with ERC-20 balanceOf',
    test: (code) => /\.\s*balance\b/.test(code) && /\bbalanceOf\s*\(/.test(code),
    pattern: /\baddress\s*\(\s*this\s*\)\s*\.\s*balance\b|\b\w+\s*\.\s*balance\b(?!\s*Of)/g,
    fix: 'On Arc these are one balance in two units (18 vs 6 decimals). Never add them, and remember balanceOf truncates below 0.000001 USDC.',
    doc: DOC,
  },
  {
    id: 'ARC-008',
    severity: 'medium',
    title: 'WETH-style wrap/unwrap code',
    pattern: /\bIWETH\w*\b|\bWETH\w*\s*\.\s*(deposit|withdraw)\s*\(|\bWUSDC\b/g,
    fix: 'Arc has no wrapped native token. Use the ERC-20 USDC at 0x3600000000000000000000000000000000000000 directly and drop deposit()/withdraw().',
    doc: DOC,
  },
  {
    id: 'ARC-009',
    severity: 'high',
    title: 'Native-asset sentinel 0xEeee… may be aliased to USDC',
    pattern: /0x[eE]{40}/g,
    fix: 'Don\'t map the EIP-7528 native sentinel to Arc\'s ERC-20 USDC address. It conflates native and ERC-20 transfer paths.',
    doc: DOC,
  },
  {
    id: 'ARC-010',
    severity: 'medium',
    title: 'Native value sent to an address that could be zero',
    pattern: /payable\s*\(\s*address\s*\(\s*0\s*\)\s*\)\s*\.\s*(transfer|send|call)\b/g,
    fix: 'A value-bearing transfer to 0x0 reverts on Arc ("Zero address not allowed") and still costs gas. Validate recipients.',
    doc: EVM + '#value-transfer-rules',
  },
  {
    id: 'ARC-011',
    severity: 'medium',
    title: 'Native transfer result not checked',
    pattern: /\.\s*send\s*\(/g,
    fix: 'Native USDC sends can revert even with enough balance (blocklist, zero address, burn). Handle failure explicitly.',
    doc: EVM + '#value-transfer-rules',
  },
  {
    id: 'ARC-012',
    severity: 'medium',
    title: 'Assumes USDC has 18 decimals',
    pattern: /\bUSDC\w*[^;\n]{0,60}\b1e18\b|\b1e18\b[^;\n]{0,60}\bUSDC\w*/g,
    fix: 'The USDC ERC-20 interface uses 6 decimals. Only raw native (msg.value / address.balance) amounts are 18 decimals.',
    doc: DOC,
  },
  {
    id: 'ARC-005',
    severity: 'medium',
    title: 'Uses the EIP-4788 beacon-roots contract, which is not deployed on Arc',
    pattern: /0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02/gi,
    fix: 'Reads return empty on Arc. Don\'t rely on beacon roots.',
    doc: EVM,
  },
  {
    id: 'ARC-003',
    severity: 'low',
    title: 'Blob opcodes are inert on Arc',
    pattern: /\bblobhash\s*\(|\bblock\s*\.\s*blobbasefee\b/g,
    fix: 'Arc rejects blob transactions. BLOBHASH returns 0 and BLOBBASEFEE returns 1.',
    doc: EVM,
  },
];

/** Replaces comments and string literals with spaces, keeping line numbers intact. */
export function blank(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
}

/** Findings for one Solidity source file. */
export function checkSource(src) {
  const code = blank(src);
  const lines = src.split('\n');
  const findings = [];
  for (const rule of SOURCE_RULES) {
    if (rule.test && !rule.test(code)) continue;
    for (const m of code.matchAll(rule.pattern)) {
      const line = code.slice(0, m.index).split('\n').length;
      findings.push({
        id: rule.id,
        severity: rule.severity,
        title: rule.title,
        fix: rule.fix,
        doc: rule.doc,
        line,
        evidence: lines[line - 1].trim().slice(0, 140),
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}
