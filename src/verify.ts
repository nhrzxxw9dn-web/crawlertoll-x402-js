/**
 * Verify an x402 payment via a facilitator.
 *
 * The facilitator is the entity that (a) validates the EIP-712
 * signature on the agent's authorization, (b) submits the transaction
 * on-chain, and (c) returns success + the transaction reference.
 *
 * Three production facilitators in market as of mid-2026:
 *
 *   - **Coinbase CDP**:  https://api.cdp.coinbase.com/platform/v2/x402/verify
 *                        https://api.cdp.coinbase.com/platform/v2/x402/settle
 *   - **Cloudflare**:    bundled with Workers; see Cloudflare's x402 guide
 *   - **Self-hosted**:   any service that implements the x402 facilitator HTTP API
 *
 * This adapter doesn't bundle web3 libraries (no viem, no ethers). It
 * does the HTTP plumbing and trusts the facilitator's verdict. That's
 * the right boundary: signature verification + on-chain settlement are
 * the facilitator's job; CrawlerToll's job is to be the publisher-side
 * HTTP gate.
 */

import { parsePaymentHeader } from "./header.js";
import type {
  VerifyOptions,
  VerifyResult,
  X402PaymentHeader,
} from "./types.js";

export interface VerifyFromHeadersOptions extends VerifyOptions {
  /** Expected network — used as a sanity check before hitting the facilitator. */
  expectedNetwork?: string;
}

/**
 * High-level: take a request's headers, look up X-PAYMENT, decode +
 * validate the envelope, then call the facilitator to verify the
 * cryptographic + on-chain steps. Returns a structured result.
 *
 * On `valid: true`, the agent's payment has been verified AND settled
 * on-chain. The publisher can serve the protected response.
 */
export async function verifyPaymentFromHeaders(
  headers:
    | Headers
    | Record<string, string | string[] | undefined>
    | Record<string, string>,
  options: VerifyFromHeadersOptions,
): Promise<VerifyResult> {
  const parsed = parsePaymentHeader(headers);
  if (!parsed.ok) {
    return parsed.reason === "no-header"
      ? { valid: false, reason: "no-header", detail: parsed.detail }
      : { valid: false, reason: "malformed", detail: parsed.detail };
  }

  if (options.expectedNetwork && parsed.payment.network !== options.expectedNetwork) {
    return {
      valid: false,
      reason: "wrong-network",
      detail: `expected ${options.expectedNetwork}, got ${parsed.payment.network}`,
    };
  }

  return verifyPayment(parsed.payment, options);
}

/**
 * Lower-level: given a parsed payment, call the facilitator.
 */
export async function verifyPayment(
  payment: X402PaymentHeader,
  options: VerifyOptions,
): Promise<VerifyResult> {
  if (!options.facilitatorUrl) {
    return {
      valid: false,
      reason: "facilitator-error",
      detail: "facilitatorUrl is required",
    };
  }
  if (payment.scheme !== "exact") {
    return {
      valid: false,
      reason: "wrong-scheme",
      detail: `scheme "${payment.scheme}" not supported in v0.1 (only "exact")`,
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    return {
      valid: false,
      reason: "facilitator-error",
      detail: "no fetch implementation available; pass options.fetchImpl",
    };
  }

  const reqHeaders: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (options.facilitatorApiKey) {
    reqHeaders["authorization"] = `Bearer ${options.facilitatorApiKey}`;
  }

  const body = JSON.stringify({
    x402Version: 1,
    payment,
    resource: options.resource,
  });

  let res: Response;
  try {
    res = await fetchImpl(options.facilitatorUrl, {
      method: "POST",
      headers: reqHeaders,
      body,
    });
  } catch (err) {
    return {
      valid: false,
      reason: "facilitator-error",
      detail: `facilitator fetch failed: ${(err as Error).message}`,
    };
  }

  if (!res.ok) {
    let detail = `facilitator returned HTTP ${res.status}`;
    try {
      const text = await res.text();
      if (text) detail += `: ${text.slice(0, 300)}`;
    } catch {
      /* swallow */
    }
    return {
      valid: false,
      reason: res.status === 402 || res.status === 400 ? "facilitator-rejected" : "facilitator-error",
      detail,
    };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    return {
      valid: false,
      reason: "facilitator-error",
      detail: `facilitator response is not JSON: ${(err as Error).message}`,
    };
  }

  if (!isObject(parsed)) {
    return {
      valid: false,
      reason: "facilitator-error",
      detail: "facilitator response is not a JSON object",
    };
  }

  // The canonical successful facilitator response shape:
  //   { valid: true, transactionId?: string, settlement?: {...} }
  //
  // We accept any object with `valid === true` as a success.
  if (parsed["valid"] !== true) {
    const reason = parsed["reason"];
    return {
      valid: false,
      reason: "facilitator-rejected",
      detail:
        typeof reason === "string"
          ? `facilitator rejected: ${reason}`
          : `facilitator rejected: ${JSON.stringify(parsed).slice(0, 300)}`,
    };
  }

  return {
    valid: true,
    ...(typeof parsed["transactionId"] === "string"
      ? { transactionId: parsed["transactionId"] as string }
      : {}),
    ...(isObject(parsed["settlement"])
      ? { settlement: parsed["settlement"] as Record<string, unknown> }
      : {}),
  };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
