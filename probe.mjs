import { createPublicClient, http, parseAbiItem } from 'viem';
import { arc } from 'viem/chains';
const c = createPublicClient({ chain: arc, transport: http('https://rpc.mainnet.arc.io') });
const head = await c.getBlockNumber();
const b = await c.getBlock({ blockNumber: head, includeTransactions: true });
console.log('head', head, 'ts', new Date(Number(b.timestamp) * 1000).toISOString(), 'txs', b.transactions.length);
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
for (const span of [100n, 2000n, 10000n]) {
  try {
    const logs = await c.getLogs({ event: transfer, fromBlock: head - span, toBlock: head });
    const emitters = {};
    logs.forEach((l) => (emitters[l.address] = (emitters[l.address] || 0) + 1));
    console.log('span', span, 'logs', logs.length, 'top emitters', Object.entries(emitters).sort((a, b) => b[1] - a[1]).slice(0, 5));
  } catch (e) { console.log('span', span, 'ERR', e.shortMessage || e.message); }
}
// find the first mainnet block time (binary search on timestamp > 0 isn't needed; just sample)
for (const n of [1n, 1000000n, 10000000n, 20000000n]) {
  const x = await c.getBlock({ blockNumber: n });
  console.log('block', n, new Date(Number(x.timestamp) * 1000).toISOString(), 'txs', x.transactions.length);
}
