// @runcrashlab/sdk (MIT)
//
// The agent runs on your machine. This SDK only sends the tool calls your agent makes
// (context, quote, swap request, finish) to the Crashlab API, using a token scoped to one run.
// It never asks for, stores, or sends private keys, seed phrases, or your agent's code.
//
// No dependencies: uses the global fetch available in Node 20+, Deno, Bun and browsers.

export interface TokenInfo {
  symbol: string;
  address: string;
  decimals: number;
}

export interface RunContext {
  runId: string;
  scenario: string;
  instruction: string;
  wallet: string;
  router: string;
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  /** Amount the scenario asks for, in base units of tokenIn. */
  amountIn: string;
  policy: { version: string; maxSlippageBps: number; spendCap: string; deadlineSeconds: number; quoteTtlSeconds: number };
}

export interface Quote {
  quoteId: string;
  amountIn: string;
  amountOut: string;
  midAmountOut: string;
  slippageBps: number;
  /** Whether this quote is within the run's slippage limit. Advisory: the server still checks every request. */
  policy: { maxSlippageBps: number; eligible: boolean };
}

export interface CheckResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface SwapResult {
  status: 'executed' | 'refused';
  amountOut: string | null;
  minAmountOut: string | null;
  checks: CheckResult[];
  reason: string | null;
}

export type Verdict = 'passed' | 'stopped' | 'blocked' | 'failed';

export interface RunReport {
  runId: string;
  scenario: string;
  agentName: string;
  policy: RunContext['policy'];
  verdict: Verdict;
  summary: string;
  agentOutcome: string | null;
  balancesBefore: Record<string, string>;
  balancesAfter: Record<string, string>;
  events: unknown[];
  startedAt: number;
  finishedAt: number | null;
}

export interface PolicyOverrides {
  maxSlippageBps?: number;
  /** Base units of the input token, as a string. */
  spendCap?: string;
  deadlineSeconds?: number;
  quoteTtlSeconds?: number;
}

export interface CreateRunOptions {
  scenario: string;
  agentName?: string;
  policy?: PolicyOverrides;
}

export class CrashlabError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CrashlabError';
    this.status = status;
    this.code = code;
  }
}

export interface ClientOptions {
  /** Base URL of the Crashlab API. Defaults to the CRASHLAB_URL environment variable, then https://api.runcrashlab.xyz. */
  baseUrl?: string;
  /** API key, if the server requires one to create runs. */
  apiKey?: string;
  /** Custom fetch (tests, proxies). Defaults to the global fetch. */
  fetch?: typeof fetch;
}

type Fetch = typeof fetch;

async function call<T>(f: Fetch, url: string, init: { method: string; token?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await f(url, { method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new CrashlabError(res.status, e?.code ?? 'http_error', e?.message ?? `Request failed with status ${res.status}`);
  }
  return data as T;
}

/** The tools an agent can use inside one run. */
export interface RunTools {
  readonly runId: string;
  getContext(): Promise<RunContext>;
  getBalances(): Promise<Record<string, string>>;
  getQuote(input: { tokenIn: string; tokenOut: string; amountIn: string | bigint }): Promise<Quote>;
  /** Ask for a swap. The server's policy engine decides; `reason` is recorded but never changes the decision. */
  requestSwap(input: {
    quoteId: string; tokenIn: string; tokenOut: string; amountIn: string | bigint;
    recipient?: string; router?: string; reason?: string;
  }): Promise<SwapResult>;
  finish(input: { outcome: string }): Promise<RunReport>;
}

export interface RunHandle extends RunTools {
  /** Context returned when the run was created (same as getContext()). */
  readonly context: RunContext;
  /** URL of the live trace (Server-Sent Events). Contains the run token: do not share it. */
  readonly eventsUrl: string;
  abort(message?: string): Promise<RunReport>;
  report(): Promise<RunReport>;
  /** Creates a read-only link to the finished report. Safe to share: it contains no run token. */
  share(): Promise<{ shareToken: string; url: string }>;
}

export interface CrashlabClient {
  readonly baseUrl: string;
  createRun(options: CreateRunOptions): Promise<RunHandle>;
  /** Fetches a shared report by its share token. */
  getSharedReport(shareToken: string): Promise<RunReport>;
}

export function createCrashlabClient(options: ClientOptions = {}): CrashlabClient {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const baseUrl = (options.baseUrl ?? env?.CRASHLAB_URL ?? 'https://api.runcrashlab.xyz').replace(/\/+$/, '');
  const f: Fetch = options.fetch ?? fetch;

  async function createRun(opts: CreateRunOptions): Promise<RunHandle> {
    const created = await call<{ runId: string; token: string; context: RunContext }>(f, `${baseUrl}/v1/runs`, {
      method: 'POST', token: options.apiKey, body: opts,
    });
    const { runId, token } = created;
    const at = (path: string) => `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/${path}`;
    const amount = (v: string | bigint) => (typeof v === 'bigint' ? v.toString() : v);

    return {
      runId,
      context: created.context,
      eventsUrl: `${at('events')}?token=${encodeURIComponent(token)}`,
      getContext: () => call(f, at('context'), { method: 'GET', token }),
      getBalances: () => call(f, at('balances'), { method: 'GET', token }),
      getQuote: (i) => call(f, at('quote'), { method: 'POST', token, body: { ...i, amountIn: amount(i.amountIn) } }),
      requestSwap: (i) => call(f, at('swap'), { method: 'POST', token, body: { ...i, amountIn: amount(i.amountIn) } }),
      finish: (i) => call(f, at('finish'), { method: 'POST', token, body: i }),
      abort: (message) => call(f, at('abort'), { method: 'POST', token, body: { message } }),
      report: () => call(f, at('report'), { method: 'GET', token }),
      share: async () => {
        const s = await call<{ shareToken: string; path: string }>(f, at('share'), { method: 'POST', token });
        return { shareToken: s.shareToken, url: `${baseUrl}${s.path}` };
      },
    };
  }

  return {
    baseUrl,
    createRun,
    getSharedReport: (shareToken) => call(f, `${baseUrl}/v1/share/${encodeURIComponent(shareToken)}`, { method: 'GET' }),
  };
}

/**
 * Creates a run, hands your agent its tools, and always returns the final report.
 * If the agent throws or returns without calling finish(), the run is aborted and reported as failed.
 */
export async function runAgent(
  client: CrashlabClient,
  options: CreateRunOptions,
  agent: (tools: RunTools) => Promise<void> | void,
): Promise<RunReport> {
  const run = await client.createRun(options);
  let finishedReport: RunReport | null = null;
  const tools: RunTools = {
    runId: run.runId,
    getContext: () => run.getContext(),
    getBalances: () => run.getBalances(),
    getQuote: (i) => run.getQuote(i),
    requestSwap: (i) => run.requestSwap(i),
    finish: async (i) => { finishedReport = await run.finish(i); return finishedReport; },
  };
  try {
    await agent(tools);
  } catch (err) {
    if (finishedReport) return finishedReport;
    return run.abort(`agent threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  return finishedReport ?? run.abort('agent returned without calling finish');
}

/** Short alias, matching the examples on the Crashlab website. */
export const createClient = createCrashlabClient;
