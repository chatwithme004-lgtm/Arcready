// Bytecode checks for contracts that are already deployed. Walks the opcode stream properly
// (skipping PUSH data) so a 0x44 byte inside a constant is not mistaken for PREVRANDAO.
// Rules come from docs.arc.io "EVM differences" and "Port a contract to Arc".

import { BYTECODE_RULES } from './rules.js';

const BEACON_ROOTS = '000f3df6d732807ef1319fb7b8bb8522d0beac02'; // EIP-4788, omitted on Arc
// Compilers drop the leading zero byte and push it with PUSH19.
const BEACON_ROOTS_19 = BEACON_ROOTS.slice(2);

const OPCODES = {
  0x44: 'PREVRANDAO',
  0x49: 'BLOBHASH',
  0x4a: 'BLOBBASEFEE',
  0xff: 'SELFDESTRUCT',
};


// After STOP / JUMP / RETURN / REVERT / INVALID / SELFDESTRUCT, execution can only resume at a
// JUMPDEST. Bytes in between are data (older compilers put revert strings there), so skip them.
const HALTS = new Set([0x00, 0x56, 0xf3, 0xfd, 0xfe, 0xff]);
const JUMPDEST = 0x5b;

/** Returns { opcodes: Set<string>, beaconRoots: boolean, size: number } for hex bytecode. */
export function walk(code) {
  const hex = code.startsWith('0x') ? code.slice(2) : code;
  const bytes = Buffer.from(hex, 'hex');
  const found = new Set();
  let beaconRoots = false;
  let live = true;
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i];
    if (!live) {
      if (op === JUMPDEST) live = true;
      continue;
    }
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      const pushed = bytes.subarray(i + 1, i + 1 + n).toString('hex');
      if ((n === 20 && pushed === BEACON_ROOTS) || (n === 19 && pushed === BEACON_ROOTS_19)) beaconRoots = true;
      i += n;
      continue;
    }
    if (OPCODES[op]) found.add(OPCODES[op]);
    if (HALTS.has(op)) live = false;
  }
  return { opcodes: found, beaconRoots, size: bytes.length };
}

/** Findings for one deployed contract's runtime bytecode. */
export function checkBytecode(code) {
  if (!code || code === '0x') return { size: 0, findings: [] };
  const { opcodes, beaconRoots, size } = walk(stripMetadata(code));
  const findings = [...opcodes].map((name) => ({ ...BYTECODE_RULES[name], evidence: `opcode ${name}` }));
  if (beaconRoots) findings.push({ ...BYTECODE_RULES.BEACON_ROOTS, evidence: `address 0x${BEACON_ROOTS}` });
  return { size, findings };
}

// Solidity appends CBOR metadata (last 2 bytes = its length). Its bytes are data, not code,
// and can contain 0x44/0xff, so cut it off before walking.
function stripMetadata(code) {
  const hex = code.startsWith('0x') ? code.slice(2) : code;
  if (hex.length < 4) return hex;
  const len = parseInt(hex.slice(-4), 16);
  const cut = hex.length - (len + 2) * 2;
  const head = hex.slice(cut, cut + 2);
  if (len > 0 && len < 200 && cut > 0 && (head === 'a1' || head === 'a2')) return hex.slice(0, cut);
  return hex;
}
