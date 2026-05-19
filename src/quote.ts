/**
 * Build x402 v2 PaymentRequirements objects + the 402 response body
 * that carries them.
 *
 * Pairs with `@crawlertoll/core`'s `build402()` — this module emits the
 * x402-specific JSON body shape; the core's headers (Crawler-Price /
 * Link / Retry-After) layer cleanly on top.
 */

import { build402 as coreBuild402 } from "@crawlertoll/core";

import {
  USDC_CONTRACTS,
  type BuildX402_402Options,
  type Built402Response,
  type DefineQuoteOptions,
  type X402PaymentRequiredBody,
  type X402PaymentRequirement,
} from "./types.js";

const DEFAULT_NETWORK = "base" as const;
const DEFAULT_MAX_TIMEOUT = 60;

/**
 * Build a single x402 PaymentRequirement. Compose multiple requirements
 * (e.g. one per accepted network) into a single 402 response with
 * `buildX402_402({ accepts: [req1, req2] })`.
 *
 * Throws on validation failures (missing payTo, malformed amount, etc.)
 * rather than returning a tagged error — these are bugs at design time,
 * not runtime conditions.
 */
export function defineQuote(opts: DefineQuoteOptions): X402PaymentRequirement {
  if (!opts.payTo || !/^0x[a-fA-F0-9]{40}$/.test(opts.payTo)) {
    throw new Error(
      `defineQuote: payTo must be a 0x-prefixed 40-hex-char EVM address; got "${opts.payTo}"`,
    );
  }
  if (!opts.amountAtomic || !/^[0-9]+$/.test(opts.amountAtomic)) {
    throw new Error(
      `defineQuote: amountAtomic must be a decimal string of unsigned atomic units; got "${opts.amountAtomic}"`,
    );
  }
  if (!opts.resource || !/^https?:\/\//.test(opts.resource)) {
    throw new Error(
      `defineQuote: resource must be an http(s) URL; got "${opts.resource}"`,
    );
  }

  const network = opts.network ?? DEFAULT_NETWORK;
  const asset = opts.asset ?? USDC_CONTRACTS[network];
  if (!asset) {
    throw new Error(
      `defineQuote: no USDC contract known for network "${network}"; pass options.asset explicitly`,
    );
  }

  return {
    scheme: "exact",
    network,
    maxAmountRequired: opts.amountAtomic,
    resource: opts.resource,
    description: opts.description ?? "AI crawler access",
    mimeType: opts.mimeType ?? "application/json",
    payTo: opts.payTo,
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT,
    asset,
    extra: opts.extra ?? { name: "USDC", version: "2" },
    ...(opts.outputSchema !== undefined ? { outputSchema: opts.outputSchema } : {}),
  };
}

/**
 * Convenience: build a quote per accepted network. Useful when you want
 * to surface "pay on Base OR Polygon OR Arbitrum" — agents pick whichever
 * network their wallet is funded on.
 */
export function defineQuotePerNetwork(
  base: Omit<DefineQuoteOptions, "network">,
  networks: ReadonlyArray<NonNullable<DefineQuoteOptions["network"]>>,
): X402PaymentRequirement[] {
  return networks.map((network) => defineQuote({ ...base, network }));
}

/**
 * Build the full 402 response — x402-flavoured body + Cloudflare-shape
 * crawler-price headers via `@crawlertoll/core`'s `build402()`.
 *
 * The body shape is the canonical x402 v2 form:
 *   { x402Version: 1, error: "payment_required", accepts: [...] }
 *
 * Headers stacked on top:
 *   crawler-price-rail: x402
 *   crawler-price: <amount> micros <currency>
 *   link: <pay-url>; rel="payment"; type="x402", ...
 *   retry-after: 60
 */
export function buildX402_402(opts: BuildX402_402Options): Built402Response {
  if (!Array.isArray(opts.accepts) || opts.accepts.length === 0) {
    throw new Error(
      "buildX402_402: at least one PaymentRequirement is required in accepts[]",
    );
  }

  const body: X402PaymentRequiredBody = {
    x402Version: 1,
    error: "payment_required",
    accepts: opts.accepts,
  };

  // Use the first requirement as the canonical price for the
  // crawler-price header.
  const first = opts.accepts[0]!;
  const microsApprox = atomicToMicros(first.maxAmountRequired);

  const core = coreBuild402({
    offer: {
      rail: "x402",
      priceMicros: microsApprox,
      currency: "USDC",
      paymentUrl: first.resource,
      publisher: undefined,
      endpoint: undefined,
    },
    ...(opts.contextLicenseUrl
      ? { contextLicenseUrl: opts.contextLicenseUrl }
      : {}),
    ...(opts.termsUrl ? { termsUrl: opts.termsUrl } : {}),
  });

  return {
    status: 402,
    headers: core.headers,
    body: JSON.stringify(body, null, 2),
  };
}

/**
 * Approximate atomic units (USDC has 6 decimals) → micros (CrawlerToll's
 * cross-rail price unit, also 6 decimals). For USDC the conversion is
 * identity. Surfaced as a function so other 6-decimal stablecoins
 * (USDT, PYUSD) just work.
 */
function atomicToMicros(amountAtomic: string): number {
  const n = Number(amountAtomic);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  // Cap at JS-safe integer to avoid silent precision loss in the header.
  return Math.min(n, Number.MAX_SAFE_INTEGER);
}
