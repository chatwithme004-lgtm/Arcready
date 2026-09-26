# ArcReady

**Try it: [chatwithme004-lgtm.github.io/Arcready](https://chatwithme004-lgtm.github.io/Arcready/)**

**Will your contract behave correctly on Arc?** ArcReady checks Solidity source and deployed
bytecode against the ways Arc differs from Ethereum, and records the result on-chain.

Arc runs standard EVM code, but USDC is its native gas token and a few things quietly behave
differently. Nothing crashes. The contract just does the wrong thing:

- `block.prevrandao` is always `0`, so any "random" draw is predictable.
- Native USDC has 18 decimals while the ERC-20 view has 6. Mixing them is off by 10¹².
- A value transfer to `address(0)`, to a blocklisted or already-destructed account reverts even with enough balance, and still costs gas.
- `SELFDESTRUCT` moves the contract's USDC, because on Arc that balance is native.

Circle documents these in a manual checklist ([Port a contract to Arc](https://docs.arc.io/arc/tutorials/porting-contracts-to-arc),
[EVM differences](https://docs.arc.io/arc/references/evm-differences)). ArcReady automates it.

## What it does

| | |
|---|---|
| **Source check** | Paste Solidity and get every Arc-specific issue with the line, why it breaks, and the fix. Runs entirely in the browser. |
| **Live contract check** | Enter any address on Arc. The **ArcReadyOracle** contract reads the deployed bytecode on-chain and flags opcodes that behave differently on Arc. |
| **On-chain record** | `attest(address)` stores the result on Arc tied to the code hash, so wallets and apps can look it up and see if the code has changed since. |
| **Composable** | Any contract can call `scan(address)` for free before integrating with another contract. |
| **State of Arc** | A scan of the contracts actually in use on Arc mainnet since launch. |

## What we found on Arc mainnet

We sampled 2,500 evenly spaced blocks between 16 and 25 Sep 2026 and scanned every contract
active in them: **9,572 contracts**.

- **52** contain an opcode that behaves differently on Arc. **36** read `PREVRANDAO` (always `0`).
- Grouped by identical code, that is **25 distinct contracts**: Uniswap v4 hooks, token launchers,
  NFT mints, a Multicall3 getter (harmless) and games.
- **One live jackpot game derives its prize rolls from `block.prevrandao`.** On Arc that value is
  `0`, so the remaining inputs are known in advance and winning cells can be computed before
  playing. The owner is being notified privately; the address is not published here.

Flags are not automatically bugs. A contract can read `PREVRANDAO` without depending on it.
That is why the finding above was confirmed by reading the verified source.

## How the bytecode check works

The walker steps through opcodes properly: it skips `PUSH` data, strips Solidity's CBOR
metadata, and after a halting opcode (`STOP`, `JUMP`, `RETURN`, `REVERT`, `INVALID`,
`SELFDESTRUCT`) it ignores bytes until the next `JUMPDEST`. That last rule matters: older
compilers store revert strings after the code, and the letter `D` is the `PREVRANDAO` opcode.
Without it, every Uniswap V2 pair on Arc is a false alarm. The same logic runs in JavaScript
(`src/bytecode.js`) and in Solidity (`contracts/ArcReadyOracle.sol`), and the tests check that
they agree on the same bytecode.

| Flag | Bit | Arc behaviour |
|---|---|---|
| `PREVRANDAO` | 1 | Always `0` |
| `SELFDESTRUCT` | 2 | Moves the contract's USDC; reverts for self, zero, blocklisted or destructed beneficiaries |
| `BLOBHASH` | 4 | Always `0` (no blob transactions) |
| `BLOBBASEFEE` | 8 | Always `1` |
| `BEACON_ROOTS` | 16 | EIP-4788 contract not deployed |
| `DELEGATED_EOA` | 32 | EIP-7702 delegation, not a contract |
| `NO_CODE` | 64 | Nothing deployed |

Source checks add what bytecode can't show: `msg.value` (18 decimals) mixed with `balanceOf`
(6 decimals), `address.balance` combined with `balanceOf`, WETH-style wrap/unwrap, the
`0xEeee…` native sentinel aliased to USDC, unchecked `.send`, value sent to `address(0)`, and
USDC treated as 18 decimals.

## Use it

**In the browser:** the web app (`web/`). Paste source, or enter a contract address on Arc.

**In a terminal:**

```sh
npx github:chatwithme004-lgtm/Arcready contracts/        # check a folder of .sol files
npx github:chatwithme004-lgtm/Arcready 0xYourContract    # check a deployed contract on Arc
```

Exit code 1 when a finding at or above `--fail-on` (default `high`) exists. `--json` for machine output.
If the contract is verified on [Sourcify](https://sourcify.dev), the full source checklist runs as well.

**In CI**, on every push:

```yaml
- uses: actions/checkout@v4
- uses: chatwithme004-lgtm/Arcready@main
  with:
    path: contracts
```

**From another contract:**

```solidity
(bool ready, uint256 flags, ) = IArcReadyOracle(ORACLE).scan(target);
require(ready, "target behaves differently on Arc");
```

## Develop

```sh
npm install
node scripts/compile.cjs        # build/ArcReadyOracle.json
npm test                        # checker tests, incl. real Arc bytecode fixtures
npx hardhat node --config hardhat.config.cjs &
node --test test/oracle.test.js # oracle vs JS checker on a local chain
```

The web app is static (`web/`): serve the folder and open it. Add `?net=local` to use a local chain.

## Layout

```
contracts/ArcReadyOracle.sol   on-chain checker + attestations
bin/arcready.js                command-line checker
action.yml                     GitHub Action
examples/                      a contract with Arc issues and a clean one
src/bytecode.js                bytecode walker (Node)
src/source.js                  Solidity source rules
src/rules.js                   rule texts shared with the web app
web/                           the app
scripts/crawl.js               mainnet sampler; scripts/report.js builds web/report.json
test/                          node:test suites and real-bytecode fixtures
```

## Not an audit

A clean result means none of the known Arc differences were found. It says nothing about other
bugs.

## License

MIT
