// Where the oracle lives. Mainnet address is filled in after deployment.
export const NETWORKS = {
  arc: { id: 5042, name: 'Arc', rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io', oracle: null },
  local: { id: 31337, name: 'Local test chain', rpc: 'http://127.0.0.1:8545', explorer: null, oracle: '0x5fbdb2315678afecb367f032d93f642f64180aa3' },
};
export const ACTIVE = new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'arc';
