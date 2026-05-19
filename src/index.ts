/**
 * @crawlertoll/x402 — x402 settlement-rail adapter for CrawlerToll.
 *
 *   import {
 *     defineQuote,
 *     buildX402_402,
 *     parsePaymentHeader,
 *     verifyPaymentFromHeaders,
 *     USDC_CONTRACTS,
 *   } from "@crawlertoll/x402";
 *
 *   // 1. Build the 402 response for an unpaid request.
 *   const quote = defineQuote({
 *     payTo: "0xYourWallet",
 *     amountAtomic: "5000",                    // $0.005 USDC
 *     resource: "https://example.com/api/articles",
 *     description: "Article access",
 *   });
 *   const built = buildX402_402({ accepts: [quote] });
 *   // → return `built.body` with `built.headers` at status 402.
 *
 *   // 2. On a paid request, verify the X-PAYMENT header via a
 *   //    facilitator (Coinbase CDP, Cloudflare, or self-hosted).
 *   const result = await verifyPaymentFromHeaders(req.headers, {
 *     facilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402/verify",
 *     facilitatorApiKey: process.env.CDP_KEY,
 *     resource: "https://example.com/api/articles",
 *     expectedNetwork: "base",
 *   });
 *   if (result.valid) {
 *     // serve the protected response
 *   }
 *
 * Targets the x402 v2 wire format (December 2025) and the Linux
 * Foundation x402 standard (Apr 2026). Bundled scheme: "exact" on EVM
 * networks (Base, Polygon, Arbitrum, Optimism, Ethereum). v0.2 adds
 * "upTo" + Solana.
 *
 * License: Apache-2.0. The x402 spec itself is open.
 */

// ─── Quote + 402 response ──────────────────────────────────────────

export {
  defineQuote,
  defineQuotePerNetwork,
  buildX402_402,
} from "./quote.js";

// ─── Header parse + encode ─────────────────────────────────────────

export {
  parsePaymentHeader,
  encodePaymentHeader,
  type ParseResult as ParsePaymentHeaderResult,
  type ParseError as ParsePaymentHeaderError,
} from "./header.js";

// ─── Verify via facilitator ────────────────────────────────────────

export {
  verifyPaymentFromHeaders,
  verifyPayment,
  type VerifyFromHeadersOptions,
} from "./verify.js";

// ─── Types + constants ─────────────────────────────────────────────

export {
  USDC_CONTRACTS,
  type X402Scheme,
  type X402Network,
  type X402PaymentRequirement,
  type X402PaymentRequiredBody,
  type X402PaymentHeader,
  type X402ExactPayload,
  type DefineQuoteOptions,
  type BuildX402_402Options,
  type Built402Response,
  type VerifyOptions,
  type VerifyResult,
} from "./types.js";
