/**
 * Parse the `X-PAYMENT` header an agent sends to settle a 402.
 *
 * Per the x402 v2 spec, the header value is base64-encoded JSON of the
 * shape `{ x402Version, scheme, network, payload }`. This module decodes
 * + validates the outer envelope and returns the typed payload. Actual
 * signature verification happens facilitator-side via `verifyPayment()`.
 */

import type { X402PaymentHeader } from "./types.js";

export interface ParseResult {
  ok: true;
  payment: X402PaymentHeader;
}

export interface ParseError {
  ok: false;
  reason: "no-header" | "malformed";
  detail: string;
}

/**
 * Extract + decode an X-PAYMENT header from a generic headers object.
 *
 * Accepts the same shapes the buyer/server SDKs use:
 *   - A native `Headers` instance (Fetch / Cloudflare Workers / Hono)
 *   - A Node http.IncomingMessage.headers shape (`Record<string, string|string[]>`)
 *   - A pre-lowercased `Record<string, string>` (what `@crawlertoll/core`'s decide() expects)
 */
export function parsePaymentHeader(
  headers:
    | Headers
    | Record<string, string | string[] | undefined>
    | Record<string, string>,
): ParseResult | ParseError {
  const raw = readHeader(headers, "x-payment");
  if (!raw) {
    return {
      ok: false,
      reason: "no-header",
      detail: "X-PAYMENT header not present on request",
    };
  }

  let json: string;
  try {
    json = base64DecodeToString(raw);
  } catch (err) {
    return {
      ok: false,
      reason: "malformed",
      detail: `X-PAYMENT is not valid base64: ${(err as Error).message}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      reason: "malformed",
      detail: `X-PAYMENT body is not valid JSON: ${(err as Error).message}`,
    };
  }

  if (!isObject(parsed)) {
    return {
      ok: false,
      reason: "malformed",
      detail: "X-PAYMENT body is not a JSON object",
    };
  }

  const ver = parsed["x402Version"];
  if (ver !== 1) {
    return {
      ok: false,
      reason: "malformed",
      detail: `Unsupported x402Version: ${String(ver)} (expected 1)`,
    };
  }

  const scheme = parsed["scheme"];
  if (scheme !== "exact") {
    return {
      ok: false,
      reason: "malformed",
      detail: `Unsupported scheme: ${String(scheme)} (this adapter supports "exact" only in v0.1)`,
    };
  }

  const network = parsed["network"];
  if (typeof network !== "string") {
    return {
      ok: false,
      reason: "malformed",
      detail: "network must be a string",
    };
  }

  const payload = parsed["payload"];
  if (!isObject(payload)) {
    return {
      ok: false,
      reason: "malformed",
      detail: "payload must be an object",
    };
  }
  const sig = payload["signature"];
  const auth = payload["authorization"];
  if (typeof sig !== "string" || !isObject(auth)) {
    return {
      ok: false,
      reason: "malformed",
      detail: "payload must include signature (string) + authorization (object)",
    };
  }

  return {
    ok: true,
    payment: parsed as unknown as X402PaymentHeader,
  };
}

/**
 * Encode an `X402PaymentHeader` back to its on-the-wire form. Mostly
 * useful for tests and for buyer-side libraries that need to construct
 * the header.
 */
export function encodePaymentHeader(payment: X402PaymentHeader): string {
  return base64EncodeFromString(JSON.stringify(payment));
}

// ─── helpers ───────────────────────────────────────────────────────

function readHeader(
  headers:
    | Headers
    | Record<string, string | string[] | undefined>
    | Record<string, string>,
  name: string,
): string | null {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? null;
  }
  const obj = headers as Record<string, string | string[] | undefined>;
  const v = obj[name] ?? obj[name.toLowerCase()];
  if (v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function base64DecodeToString(b64: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(b64, "base64").toString("utf-8");
  }
  // Browser / Worker fallback: atob + UTF-8 decode.
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function base64EncodeFromString(text: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf-8").toString("base64");
  }
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
