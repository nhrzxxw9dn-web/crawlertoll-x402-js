# @crawlertoll/x402

x402 settlement-rail adapter for CrawlerToll. Build x402 v2 payment quotes for the 402 response body, parse incoming `X-PAYMENT` headers, and verify payments via a facilitator (Coinbase CDP, Cloudflare, or self-hosted).

- **License**: Apache-2.0
- **Node**: 20+ (Bun, Deno, Cloudflare Workers also supported)
- **Core**: [`@crawlertoll/core`](https://www.npmjs.com/package/@crawlertoll/core)
- **Targets**: x402 v2 (Dec 2025) / Linux Foundation x402 standard (Apr 2026)

[![npm](https://img.shields.io/npm/v/%40crawlertoll%2Fx402.svg)](https://www.npmjs.com/package/@crawlertoll/x402)
[![license](https://img.shields.io/npm/l/%40crawlertoll%2Fx402.svg)](./LICENSE)

---

## What it does

The x402 standard ([x402.org](https://www.x402.org/), under Linux Foundation governance as of April 2026, backed by Coinbase + Cloudflare + Stripe + AWS + Google + Microsoft + Visa + Mastercard) defines an HTTP-402-native payment protocol. Bots that hit a paywalled endpoint get a 402 with a structured payment offer, sign an EIP-712 authorization with their wallet, retry with an `X-PAYMENT` header, and the publisher verifies + settles via a facilitator.

This adapter handles the publisher-side wire format:

| Function | What it does |
|---|---|
| `defineQuote(opts)` | Build a single x402 v2 PaymentRequirement (the JSON the agent needs to sign) |
| `defineQuotePerNetwork(opts, networks)` | Convenience: emit one requirement per accepted network |
| `buildX402_402(opts)` | Build the full 402 response (x402-shape body + Cloudflare-shape `Crawler-Price` headers via `@crawlertoll/core`) |
| `parsePaymentHeader(headers)` | Decode + validate an incoming `X-PAYMENT` header |
| `encodePaymentHeader(payment)` | Encode an `X402PaymentHeader` back to its base64 JSON form (mostly for tests / buyer SDKs) |
| `verifyPayment(payment, opts)` | Call a facilitator URL to verify + settle a payment |
| `verifyPaymentFromHeaders(headers, opts)` | One-call combo: extract header → decode → verify |

What this adapter **doesn't** do:

- **On-chain signature verification.** That's the facilitator's job. Bundling viem/ethers would add 100+ KB and duplicate work the facilitator already does cryptographically.
- **Wallet management on the buyer side.** This is the publisher-side adapter. Buyer-side wallets ship in separate Coinbase SDK / Cloudflare `withX402Client` packages.

---

## Install

```bash
npm install @crawlertoll/x402 @crawlertoll/core
```

---

## Sixty seconds

```ts
import {
  defineQuote,
  buildX402_402,
  verifyPaymentFromHeaders,
} from "@crawlertoll/x402";

// 1. Build the 402 response for an unpaid request.
const quote = defineQuote({
  payTo: process.env.PUBLISHER_WALLET!,    // "0x..."
  amountAtomic: "5000",                     // $0.005 USDC (6 decimals)
  resource: "https://example.com/api/articles",
  description: "Article access — 24h cache window",
});

const built = buildX402_402({
  accepts: [quote],
  contextLicenseUrl: "https://example.com/.well-known/context-license.json",
  termsUrl: "https://example.com/ai-terms",
});

// In your route handler when the agent hasn't paid yet:
return new Response(built.body, { status: built.status, headers: built.headers });

// 2. On the retry with X-PAYMENT, verify via facilitator:
const result = await verifyPaymentFromHeaders(req.headers, {
  facilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402/verify",
  facilitatorApiKey: process.env.CDP_KEY,
  resource: "https://example.com/api/articles",
  expectedNetwork: "base",
});

if (result.valid) {
  // serve the protected content
  return new Response(JSON.stringify({ articles: [...] }), { status: 200 });
}
```

---

## Multi-network quotes

For sites that accept payment on more than one chain — agents pick whichever network their wallet is funded on:

```ts
import { defineQuotePerNetwork, buildX402_402 } from "@crawlertoll/x402";

const quotes = defineQuotePerNetwork(
  {
    payTo: "0x...",
    amountAtomic: "5000",
    resource: "https://example.com/api/articles",
    description: "Article access",
  },
  ["base", "polygon", "arbitrum", "optimism"],
);

const built = buildX402_402({ accepts: quotes });
```

The adapter picks the canonical USDC contract address per network automatically (see `USDC_CONTRACTS` export). For other stablecoins (USDT, PYUSD), pass `asset` and `extra` explicitly to `defineQuote()`.

---

## Wiring into framework adapters

### Express

```ts
import express from "express";
import { crawlertoll } from "@crawlertoll/express";
import { buildX402_402, defineQuote, verifyPaymentFromHeaders } from "@crawlertoll/x402";

const app = express();

const QUOTE = defineQuote({
  payTo: process.env.PUBLISHER_WALLET!,
  amountAtomic: "5000",
  resource: "https://example.com/api/articles",
});

app.use(crawlertoll({
  // Use our own 402 builder instead of the default — keeps the x402-v2 body shape.
  decisionOverride: async (req) => {
    if (req.headers["x-payment"]) {
      const verdict = await verifyPaymentFromHeaders(req.headers, {
        facilitatorUrl: process.env.X402_FACILITATOR_URL!,
        facilitatorApiKey: process.env.X402_FACILITATOR_KEY,
        resource: "https://example.com" + req.path,
        expectedNetwork: "base",
      });
      if (verdict.valid) {
        return /* a manual allow decision */ null; // fall through to handler
      }
    }
    return null; // run normal decision tree
  },
  offer: { rail: "x402", priceMicros: 5000, currency: "USD" },
  buildOptions: {
    // Custom 402 body via @crawlertoll/x402 instead of the default core builder.
    // (Wire this via your route handler if your adapter doesn't expose body overrides.)
  },
}));
```

### Cloudflare Workers (Hono)

```ts
import { Hono } from "hono";
import { defineQuote, buildX402_402, verifyPaymentFromHeaders } from "@crawlertoll/x402";

const app = new Hono();

app.use("*", async (c, next) => {
  if (c.req.header("x-payment")) {
    const r = await verifyPaymentFromHeaders(c.req.raw.headers, {
      facilitatorUrl: c.env.X402_FACILITATOR_URL,
      facilitatorApiKey: c.env.X402_FACILITATOR_KEY,
      resource: c.req.url,
      expectedNetwork: "base",
    });
    if (r.valid) {
      await next();
      return;
    }
  }
  const built = buildX402_402({
    accepts: [defineQuote({
      payTo: c.env.PUBLISHER_WALLET,
      amountAtomic: "5000",
      resource: c.req.url,
    })],
  });
  return new Response(built.body, { status: built.status, headers: built.headers });
});

app.get("/api/articles", (c) => c.json({ articles: [...] }));
```

---

## Facilitator choices

x402 v2 is rail-agnostic on the facilitator. Three production-ready options:

| Facilitator | URL | Auth | Notes |
|---|---|---|---|
| **Coinbase CDP** | `https://api.cdp.coinbase.com/platform/v2/x402/verify` | Bearer API key | Original implementation. Free tier available; settles to USDC. |
| **Cloudflare** | Bundled with Workers' `withX402Client` | Cloudflare account | First-party for Cloudflare-hosted publishers. |
| **Self-hosted** | Any URL implementing the x402 facilitator API | Up to you | Open spec — run your own settlement service. |

The adapter is verifier-agnostic — point `facilitatorUrl` at any compliant implementation.

---

## Networks + assets

```ts
import { USDC_CONTRACTS } from "@crawlertoll/x402";

USDC_CONTRACTS.base            // "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
USDC_CONTRACTS["base-sepolia"] // "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
USDC_CONTRACTS.ethereum        // "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
USDC_CONTRACTS.polygon         // "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
USDC_CONTRACTS.arbitrum        // "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
USDC_CONTRACTS.optimism        // "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"
```

For other assets, pass `asset` + `extra` to `defineQuote()`.

---

## Conformance

28 vitest tests cover:

- **Quote builder** (9): defaults, multi-network, validation rejects (bad payTo, non-decimal amount, non-http resource), `buildX402_402` shape + headers, empty-accepts rejection
- **Header parse/encode** (8): round-trip, native Headers + plain-object input, no-header, non-base64 garbage, base64 of non-JSON, wrong version, wrong scheme, missing payload structure
- **Verify via fake facilitator** (11): success + transactionId + settlement, facilitator-rejected (`valid: false`), HTTP 400/402/500 mapping, bearer-token forwarding, resource forwarding, unsupported scheme, end-to-end via headers, wrong-network detection

Run them:

```bash
git clone https://github.com/nhrzxxw9dn-web/crawlertoll-x402-js
cd crawlertoll-x402-js
npm install
npm test
```

---

## v0.1 scope notes

- **Scheme**: `"exact"` only. The `"upTo"` micropayment scheme ships in v0.2.
- **Networks**: 6 EVM chains (Base, Base Sepolia, Ethereum, Polygon, Arbitrum, Optimism). Solana support ships in v0.2.
- **No on-chain crypto** is bundled — the adapter trusts the facilitator's verdict. This is the right boundary: signature verification + settlement are facilitator responsibilities; this adapter is the publisher-side HTTP gate.
- **No buyer-side wallet** code. Buyer wallets ship in Coinbase's SDK and Cloudflare's `withX402Client`. CrawlerToll's buyer SDK (`@crawlertoll/client`) will add x402 wallet integration in a future release.

---

## Companion packages

| Package | Role |
|---|---|
| [`@crawlertoll/core`](https://www.npmjs.com/package/@crawlertoll/core) | Bot detection + RSL 1.0 + HTTP 402 + Web Bot Auth |
| [`@crawlertoll/express`](https://www.npmjs.com/package/@crawlertoll/express) | Express middleware |
| [`@crawlertoll/fastify`](https://www.npmjs.com/package/@crawlertoll/fastify) | Fastify plugin |
| [`@crawlertoll/hono`](https://www.npmjs.com/package/@crawlertoll/hono) | Hono middleware (CF Workers, Bun, Deno, Vercel Edge) |
| [`@crawlertoll/next`](https://www.npmjs.com/package/@crawlertoll/next) | Next.js middleware |
| **`@crawlertoll/x402`** (this package) | x402 settlement |

---

## Resources

- **x402 Foundation** (Linux Foundation): <https://x402.org/>
- **x402 whitepaper**: <https://www.x402.org/x402-whitepaper.pdf>
- **Coinbase CDP x402 docs**: <https://docs.cdp.coinbase.com/x402/welcome>
- **Cloudflare x402 integration**: <https://blog.cloudflare.com/x402/>
- **CrawlerToll marketplace**: <https://crawlertoll.com>

---

## License

[Apache-2.0](./LICENSE). The x402 standard itself is open under LF governance.
