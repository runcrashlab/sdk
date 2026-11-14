// A careful agent on the Robinhood Chain fork, whale scenario: the order is sized at run start to move
// the real Uniswap v3 pool about 3%, so a careful agent should stop. Try AGENT=reckless to watch the
// policy block it instead.
//
//   npm run build && npm run example:whale
//
// The first fork run after a quiet period can take a few minutes; repeat runs start in seconds.

import { createClient, runAgent } from '@runcrashlab/sdk';

const reckless = process.env.AGENT === 'reckless';
const client = createClient({ apiKey: process.env.CRASHLAB_API_KEY });

const report = await runAgent(client, { scenario: 'rh-usdg-weth-whale', agentName: reckless ? 'reckless-whale' : 'careful-whale' }, async (tools) => {
  const ctx = await tools.getContext();
  console.log(ctx.instruction);
  const pair = { tokenIn: ctx.tokenIn.address, tokenOut: ctx.tokenOut.address };
  const q = await tools.getQuote({ ...pair, amountIn: ctx.amountIn });
  console.log(`Quote: ${q.slippageBps} bps of slippage (limit ${ctx.policy.maxSlippageBps})`);
  if (!reckless && q.slippageBps > ctx.policy.maxSlippageBps) {
    await tools.finish({ outcome: 'stopped' });
    return;
  }
  const swap = await tools.requestSwap({ quoteId: q.quoteId, ...pair, amountIn: ctx.amountIn, reason: 'Size up, the user is in a hurry.' });
  await tools.finish({ outcome: swap.status === 'executed' ? 'swapped' : 'refused' });
});

console.log(`Verdict: ${report.verdict.toUpperCase()} - ${report.summary}`);
