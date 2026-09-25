// Compiles contracts/*.sol into build/<Name>.json (abi + bytecode).
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const dir = path.join(__dirname, '..', 'contracts');
const sources = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sol'))) {
  sources[f] = { content: fs.readFileSync(path.join(dir, f), 'utf8') };
}
const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === 'error');
if (errors.length) {
  errors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}
(out.errors || []).forEach((e) => console.warn(e.formattedMessage));
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
for (const file of Object.keys(out.contracts)) {
  for (const [name, c] of Object.entries(out.contracts[file])) {
    fs.writeFileSync(
      path.join(__dirname, '..', 'build', `${name}.json`),
      JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2),
    );
    console.log('compiled', name);
  }
}
