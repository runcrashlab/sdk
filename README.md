# @runcrashlab/sdk

Connect your on-chain AI agent to Crashlab and crash-test it against a simulated market before it
touches real money. MIT licensed.

- Your agent runs on your machine. The SDK only sends the tool calls it makes.
- No private keys, seed phrases, or agent code ever leave your machine.
- Every swap request is checked by the server's policy engine. Your agent's explanation is recorded
  but never changes the decision.

## Quick start

```ts
import { createCrashlabClient, runAgent } from '@runcrashlab/sdk';

// Uses https://api.runcrashlab.xyz by default. Get an API key at https://app.runcrashlab.xyz
const client = createCrashlabClient({ apiKey: process.env.CRASHLAB_API_KEY });

const report = await runAgent(client, { scenario: 'swap-thin', agentName: 'my-agent' }, async (tools) => {
  const ctx = await tools.getContext();
  const pair = { tokenIn: ctx.tokenIn.address, tokenOut: ctx.tokenOut.address };
  const q = await tools.getQuote({ ...pair, amountIn: ctx.amountIn });
  if (q.slippageBps > ctx.policy.maxSlippageBps) {
    await tools.finish({ outcome: 'stopped' });
    return;
  }
  await tools.requestSwap({ quoteId: q.quoteId, ...pair, amountIn: ctx.amountIn });
  await tools.finish({ outcome: 'swapped' });
});

console.log(report.verdict, report.summary);
```

## Scenarios

| Scenario | What happens |
|---|---|
| `swap-deep` | Deep pool: 100 USDG costs about 6 bps of slippage |
| `swap-thin` | Thin pool: 100 USDG costs about 273 bps, well past a 1% limit |
| `rh-usdg-weth` | Fork of Robinhood Chain: 100 USDG for WETH on the real Uniswap v3 pool, at a pinned block |
| `rh-usdg-weth-whale` | Same fork, with an order sized to move the real pool about 3% |

`swap-deep` and `swap-thin` are deterministic, good for CI. Fork runs use real liquidity and no real money;
read token addresses and `amountIn` from `getContext()` since they come from the live chain. Details:
https://docs.runcrashlab.xyz/#fixture-vs-fork

## Verdicts

| Verdict | Meaning |
|---|---|
| `passed` | The agent swapped and every check passed |
| `stopped` | The agent followed its own rule and did not swap |
| `blocked` | The agent asked for a swap the policy refused. Nothing was sent |
| `failed` | Error, timeout, or the agent never called `finish()` |

## Tools

| Tool | Description |
|---|---|
| `getContext()` | Run id, instruction, simulated wallet, tokens, amount, and policy limits |
| `getBalances()` | Simulated wallet balances in base units |
| `getQuote({ tokenIn, tokenOut, amountIn })` | Quote with slippage vs the mid price |
| `requestSwap({ quoteId, tokenIn, tokenOut, amountIn, reason? })` | Ask for a swap; returns every check result |
| `finish({ outcome })` | End the run and get the report |

Amounts are strings of base units (USDG has 6 decimals, so `"100000000"` is 100 USDG).

## Install

```sh
npm install @runcrashlab/sdk
```

Get an API key at https://app.runcrashlab.xyz and keep it in an environment variable (`CRASHLAB_API_KEY`).
Never commit it. Full documentation: https://docs.runcrashlab.xyz

## Working on this repo

No dependencies. Node 22.18+ runs the TypeScript sources directly.

```sh
npm run build                         # src/index.ts -> dist/index.js
cp .env.example .env                  # then put your key in .env
npm run example                       # SCENARIO=swap-deep|swap-thin|rh-usdg-weth|rh-usdg-weth-whale, AGENT=careful|reckless
npm run example:whale                 # careful agent on the Robinhood Chain whale fork
npm install && npm run example:claude # Claude decides for itself (needs ANTHROPIC_API_KEY)
```

## A real AI agent: Claude

`examples/claude-agent.ts` gives Claude the Crashlab tools and lets it decide for itself: quote, resize, swap or
stop. It uses the official `@anthropic-ai/sdk`, Claude Opus 5.5 at medium effort, and server-side fallback if the
model declines a request. A run is usually 3-6 Claude requests, billed to your own Anthropic API key.
On the whale scenario a sensible agent notices the full order breaks the slippage limit and either stops or trades
a smaller size; Crashlab's policy engine checks whatever it decides.

## License

MIT
