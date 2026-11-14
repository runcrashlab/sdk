// An agent that talks to the Crashlab API through @runcrashlab/sdk, exactly like a developer's own agent would.
//
// 1. Get an API key at https://app.runcrashlab.xyz and put it in .env as CRASHLAB_API_KEY=clk_...
// 2. npm run build && npm run example
//
// Options (environment variables):
//   SCENARIO=swap-deep | swap-thin | rh-usdg-weth | rh-usdg-weth-whale   (default swap-thin)
//   AGENT=careful | reckless             (default careful)
//   CRASHLAB_URL=https://api.runcrashlab.xyz (default; use http://127.0.0.1:8787 for a local API)
//   CRASHLAB_API_KEY=clk_...             (when the server stores runs in Supabase)

import { createClient, runAgent } from '@runcrashlab/sdk';

const scenario = process.env.SCENARIO ?? 'swap-thin';
const style = process.env.AGENT === 'reckless' ? 'reckless' : 'careful';
// CRASHLAB_API_KEY: your personal key (clk_...) when the server uses Supabase; CRASHLAB_DEV_KEY in local mode.
const client = createClient({ apiKey: process.env.CRASHLAB_API_KEY || process.env.CRASHLAB_DEV_KEY });

console.log(`\nCrashlab: ${style} agent, scenario ${scenario}, API ${client.baseUrl}\n`);

const report = await runAgent(client, { scenario, agentName: `${style}-agent` }, async (tools) => {
  const ctx = await tools.getContext();
  console.log(`Instruction: ${ctx.instruction}`);
  const pair = { tokenIn: ctx.tokenIn.address, tokenOut: ctx.tokenOut.address };

  const q = await tools.getQuote({ ...pair, amountIn: ctx.amountIn });
  console.log(`Quote: slippage ${q.slippageBps} bps (limit ${ctx.policy.maxSlippageBps})`);

  if (style === 'careful' && q.slippageBps > ctx.policy.maxSlippageBps) {
    console.log('Agent: over the limit, stopping.');
    await tools.finish({ outcome: 'stopped' });
    return;
  }

  const swap = await tools.requestSwap({
    quoteId: q.quoteId, ...pair, amountIn: ctx.amountIn,
    reason: style === 'reckless' ? 'Slippage is fine, the user wants this done now.' : undefined,
  });
  if (swap.status === 'executed') {
    console.log(`Swap executed: received ${swap.amountOut} (min ${swap.minAmountOut})`);
  } else {
    const failed = swap.checks.filter((c) => !c.passed).map((c) => `${c.label} (${c.detail})`);
    console.log(`Swap refused by policy: ${failed.join('; ')}`);
  }
  await tools.finish({ outcome: swap.status === 'executed' ? 'swapped' : 'refused' });
});

console.log(`\nVerdict: ${report.verdict.toUpperCase()}`);
console.log(report.summary);
console.log(`Balances before: ${JSON.stringify(report.balancesBefore)}`);
console.log(`Balances after:  ${JSON.stringify(report.balancesAfter)}\n`);
