// Bytecode rule texts, shared by the Node checker and the web page. Flag bits match
// contracts/ArcReadyOracle.sol.

export const BYTECODE_RULES = {
  PREVRANDAO: {
    bit: 1,
    id: 'ARC-001',
    severity: 'high',
    title: 'Uses on-chain randomness (PREVRANDAO), which is always 0 on Arc',
    fix: 'Any lottery, raffle, shuffle or random pick built on block.prevrandao / block.difficulty is predictable. Use a VRF or oracle.',
    doc: 'https://docs.arc.io/arc/references/evm-differences',
  },
  SELFDESTRUCT: {
    bit: 2,
    id: 'ARC-002',
    severity: 'medium',
    title: 'Contains SELFDESTRUCT, which moves the contract\'s USDC and can revert on Arc',
    fix: 'On Arc a contract\'s USDC is its native balance, so self-destruct sends it to the beneficiary. It reverts if the beneficiary is the contract itself, the zero address, a blocklisted or already-destructed account.',
    doc: 'https://docs.arc.io/arc/references/evm-differences#selfdestruct',
  },
  BLOBHASH: {
    bit: 4,
    id: 'ARC-003',
    severity: 'low',
    title: 'Reads BLOBHASH, which always returns 0 on Arc',
    fix: 'Arc does not support blob transactions (EIP-4844). Remove blob-dependent logic.',
    doc: 'https://docs.arc.io/arc/references/evm-differences',
  },
  BLOBBASEFEE: {
    bit: 8,
    id: 'ARC-004',
    severity: 'low',
    title: 'Reads BLOBBASEFEE, which always returns 1 on Arc',
    fix: 'Arc does not support blob transactions (EIP-4844). Remove blob-fee logic.',
    doc: 'https://docs.arc.io/arc/references/evm-differences',
  },
  BEACON_ROOTS: {
    bit: 16,
    id: 'ARC-005',
    severity: 'medium',
    title: 'References the EIP-4788 beacon-roots contract, which is not deployed on Arc',
    fix: 'Reads return empty. Don\'t use beacon roots as an oracle or randomness source.',
    doc: 'https://docs.arc.io/arc/references/evm-differences',
  },
};
