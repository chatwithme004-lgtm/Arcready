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
    patch: "// Don't derive outcomes from block.prevrandao on Arc (always 0).\n// Use a VRF / oracle, or commit-reveal:\nmapping(address => bytes32) public commits;\nfunction commit(bytes32 h) external { commits[msg.sender] = h; }\nfunction reveal(bytes32 secret) external {\n    require(keccak256(abi.encode(secret, msg.sender)) == commits[msg.sender], \"bad reveal\");\n    // mix secret with a value fixed after the commit, e.g. a future blockhash\n}",
  },
  {
    id: 'ARC-002',
    severity: 'medium',
    title: 'selfdestruct moves the contract\'s USDC and can revert',
    pattern: /\bselfdestruct\s*\(/g,
    fix: 'The contract\'s USDC is its native balance and goes to the beneficiary. Reverts for self, zero address, blocklisted or already-destructed beneficiaries.',
    doc: EVM + '#selfdestruct',
    patch: "// Move funds explicitly instead of relying on selfdestruct:\n(bool ok, ) = payable(recipient).call{value: address(this).balance}(\"\");\nrequire(ok, \"transfer failed\");",
  },
  {
    id: 'ARC-006',
    severity: 'high',
    title: 'Mixes msg.value (18 decimals) with USDC balanceOf (6 decimals)',
    // Only an external token call (usdc.balanceOf(...)), not a contract's own ERC-20/721 balanceOf.
    test: (code) => /\bmsg\s*\.\s*value\b/.test(code) && /\.\s*balanceOf\s*\(/.test(code),
    pattern: /\bmsg\s*\.\s*value\b/g,
    fix: 'Native USDC uses 18 decimals and the ERC-20 view uses 6. Raw values differ by 10^12. Convert before comparing or adding.',
    doc: DOC,
    patch: "// msg.value is 18-decimal native USDC; balanceOf is the 6-decimal ERC-20 view.\nuint256 amount6 = msg.value / 1e12; // compare in the same unit",
  },
  {
    id: 'ARC-007',
    severity: 'high',
    title: 'Compares or combines address.balance with ERC-20 balanceOf',
    test: (code) => /\.\s*balance\b/.test(code) && /\.\s*balanceOf\s*\(/.test(code),
    pattern: /\baddress\s*\(\s*this\s*\)\s*\.\s*balance\b|\b\w+\s*\.\s*balance\b(?!\s*Of)/g,
    fix: 'On Arc these are one balance in two units (18 vs 6 decimals). Never add them, and remember balanceOf truncates below 0.000001 USDC.',
    doc: DOC,
    patch: "// Same balance, two units. Use one view only:\nuint256 held = usdc.balanceOf(address(this)); // 6 decimals\n// or address(this).balance / 1e12 \u2014 never add the two",
  },
  {
    id: 'ARC-008',
    severity: 'medium',
    title: 'WETH-style wrap/unwrap code',
    pattern: /\bIWETH\w*\b|\bWETH\w*\s*\.\s*(deposit|withdraw)\s*\(|\bWUSDC\b/g,
    fix: 'Arc has no wrapped native token. Use the ERC-20 USDC at 0x3600000000000000000000000000000000000000 directly and drop deposit()/withdraw().',
    doc: DOC,
    patch: "IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);\n// use USDC.transfer / transferFrom directly; no deposit()/withdraw() wrapping",
  },
  {
    id: 'ARC-009',
    severity: 'high',
    title: 'Native-asset sentinel 0xEeee… may be aliased to USDC',
    pattern: /0x[eE]{40}/g,
    fix: 'Don\'t map the EIP-7528 native sentinel to Arc\'s ERC-20 USDC address. It conflates native and ERC-20 transfer paths.',
    doc: DOC,
    patch: "address constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;\naddress constant USDC = 0x3600000000000000000000000000000000000000;\n// keep them as two separate code paths; never map NATIVE to USDC",
  },
  {
    id: 'ARC-010',
    severity: 'medium',
    title: 'Native value sent to an address that could be zero',
    pattern: /payable\s*\(\s*address\s*\(\s*0\s*\)\s*\)\s*\.\s*(transfer|send|call)\b/g,
    fix: 'A value-bearing transfer to 0x0 reverts on Arc ("Zero address not allowed") and still costs gas. Validate recipients.',
    doc: EVM + '#value-transfer-rules',
    patch: "require(to != address(0), \"zero address\");\n(bool ok, ) = payable(to).call{value: amount}(\"\");\nrequire(ok, \"transfer failed\");",
  },
  {
    id: 'ARC-011',
    severity: 'medium',
    title: 'Native transfer result not checked',
    pattern: /\.\s*send\s*\(/g,
    fix: 'Native USDC sends can revert even with enough balance (blocklist, zero address, burn). Handle failure explicitly.',
    doc: EVM + '#value-transfer-rules',
    patch: "(bool ok, ) = payable(to).call{value: amount}(\"\");\nrequire(ok, \"transfer failed\"); // can revert on Arc even with enough balance",
  },
  {
    id: 'ARC-012',
    severity: 'medium',
    title: 'Assumes USDC has 18 decimals',
    pattern: /\bUSDC\w*[^;\n]{0,60}\b1e18\b|\b1e18\b[^;\n]{0,60}\bUSDC\w*/g,
    fix: 'The USDC ERC-20 interface uses 6 decimals. Only raw native (msg.value / address.balance) amounts are 18 decimals.',
    doc: DOC,
    patch: "uint256 constant USDC_UNIT = 1e6; // ERC-20 USDC has 6 decimals on Arc",
  },
  {
    id: 'ARC-005',
    severity: 'medium',
    title: 'Uses the EIP-4788 beacon-roots contract, which is not deployed on Arc',
    pattern: /0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02/gi,
    fix: 'Reads return empty on Arc. Don\'t rely on beacon roots.',
    doc: EVM,
    patch: "// Remove the EIP-4788 beacon-roots dependency; it returns empty on Arc.",
  },
  {
    id: 'ARC-003',
    severity: 'low',
    title: 'Blob opcodes are inert on Arc',
    pattern: /\bblobhash\s*\(|\bblock\s*\.\s*blobbasefee\b/g,
    fix: 'Arc rejects blob transactions. BLOBHASH returns 0 and BLOBBASEFEE returns 1.',
    doc: EVM,
    patch: "// Remove blob-dependent logic; Arc has no blob transactions.",
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
  const seen = new Set();
  for (const rule of SOURCE_RULES) {
    if (rule.test && !rule.test(code)) continue;
    for (const m of code.matchAll(rule.pattern)) {
      const line = code.slice(0, m.index).split('\n').length;
      if (seen.has(rule.id + ':' + line)) continue;
      seen.add(rule.id + ':' + line);
      findings.push({
        id: rule.id,
        severity: rule.severity,
        title: rule.title,
        fix: rule.fix,
        doc: rule.doc,
        patch: rule.patch,
        line,
        evidence: lines[line - 1].trim().slice(0, 140),
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}
