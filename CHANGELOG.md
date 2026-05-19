# Changelog

All notable changes to `@crawlertoll/x402` are documented here. The package follows [Semantic Versioning](https://semver.org/) and tracks the `@crawlertoll/core` major version.

## [0.1.0] — 2026-05-19

Initial public release. The first settlement-rail adapter for CrawlerToll. Targets x402 v2 (Dec 2025) under the Linux Foundation x402 standard (Apr 2026).

### Added

- **`defineQuote(opts)`** — build an x402 v2 `PaymentRequirement` for the `"exact"` scheme on EVM networks. Validates `payTo` (0x-prefixed 40-hex), `amountAtomic` (unsigned decimal string), `resource` (http(s) URL). Sensible defaults for `network` (base), `asset` (USDC), `maxTimeoutSeconds` (60), `mimeType` (application/json), `extra` (USDC v2 EIP-712 domain).
- **`defineQuotePerNetwork(opts, networks)`** — convenience: one PaymentRequirement per network, USDC contract picked automatically per chain.
- **`buildX402_402(opts)`** — emit the full 402 response: x402-v2 body shape plus Cloudflare-shape `Crawler-Price` / `Crawler-Price-Rail` / `Link` / `Retry-After` headers via `@crawlertoll/core`'s `build402()`.
- **`parsePaymentHeader(headers)`** — decode an incoming `X-PAYMENT` base64-JSON header to a typed `X402PaymentHeader`. Reads from `Headers`, Node-style header objects, or pre-lowercased records. Rejects non-base64, non-JSON, wrong `x402Version`, unsupported `scheme`, malformed `payload` structure.
- **`encodePaymentHeader(payment)`** — round-trip companion (mostly for tests + buyer-side SDKs).
- **`verifyPayment(payment, opts)`** — call a facilitator URL (Coinbase CDP, Cloudflare, or self-hosted) to verify + settle. Pluggable `fetchImpl` for tests / retries / proxies. Bearer-token auth supported.
- **`verifyPaymentFromHeaders(headers, opts)`** — one-call combo: extract X-PAYMENT, decode, validate envelope, hit facilitator. Optional `expectedNetwork` sanity check.
- **`USDC_CONTRACTS`** — frozen map of canonical USDC contract addresses for Base, Base Sepolia, Ethereum, Polygon, Arbitrum, Optimism.
- Full TypeScript types — `X402PaymentRequirement`, `X402PaymentHeader`, `X402ExactPayload`, `VerifyResult`, `VerifyOptions`, etc.

### Conformance

- 28/28 vitest tests across three suites (quote / header / verify).
- Facilitator HTTP plumbing covered with a fake `fetch` — no live network in tests.
- Decision-result shape mirrors `@crawlertoll/core`'s `VerifyResult` style: tagged-union, never throws on validation outcomes.

### Scope notes

- **`"exact"` scheme only** — `"upTo"` ships in v0.2.
- **6 EVM networks** — Solana ships in v0.2.
- **No bundled web3 libs** — signature verification + settlement are the facilitator's job. This adapter is the publisher-side HTTP gate, ~10 KB tarball.

### License

Apache-2.0 (this package). The x402 spec is openly governed under Linux Foundation.
