/**
 * x402 v2 types — the wire format used by Coinbase's CDP facilitator,
 * Cloudflare's x402 integration, and the Linux Foundation x402 standard.
 *
 * The x402 spec is at <https://www.x402.org/x402-whitepaper.pdf> and the
 * Coinbase CDP docs at <https://docs.cdp.coinbase.com/x402/welcome>.
 *
 * v0.1 of this adapter targets the `"exact"` scheme on EVM networks
 * (Base mainnet + Base Sepolia), which is the production rail as of
 * Q2 2026. The `"upTo"` scheme (max-cap micropayments) and Solana
 * network ship in v0.2.
 */

/** Supported x402 schemes. */
export type X402Scheme = "exact";

/** Supported EVM networks. */
export type X402Network =
  | "base"
  | "base-sepolia"
  | "ethereum"
  | "polygon"
  | "arbitrum"
  | "optimism";

/**
 * A single payment requirement the publisher accepts. The 402 response
 * carries an `accepts[]` array — the agent picks one and signs the
 * matching authorization.
 */
export interface X402PaymentRequirement {
  /** Always `"exact"` in v0.1. */
  scheme: X402Scheme;
  /** EVM network the publisher accepts payment on. */
  network: X402Network;
  /** Atomic-unit amount the publisher requires (string for big-int safety). USDC has 6 decimals: $0.005 = "5000". */
  maxAmountRequired: string;
  /** The protected resource URL — included in the signed authorization. */
  resource: string;
  /** Human-readable description; surfaced to end-users by agent UIs. */
  description: string;
  /** Content-type the agent should expect on success. */
  mimeType: string;
  /** Publisher's receiving wallet (EVM address). */
  payTo: string;
  /** Maximum seconds the signed authorization is valid for. Default 60. */
  maxTimeoutSeconds: number;
  /** Asset contract address (e.g. USDC on Base = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`). */
  asset: string;
  /** EIP-712 domain extra — usually `{ name: "USDC", version: "2" }`. */
  extra?: Record<string, unknown>;
  /** Optional JSON Schema describing the response body shape. */
  outputSchema?: unknown;
}

/** The 402 response body for an x402 publisher. */
export interface X402PaymentRequiredBody {
  /** Protocol version. v2 spec uses `1` as the integer version field. */
  x402Version: 1;
  /** Human-readable error key. */
  error: "payment_required";
  /** Array of accepted payment requirements; agent picks one. */
  accepts: X402PaymentRequirement[];
}

/** The X-PAYMENT header payload, base64-decoded. */
export interface X402PaymentHeader {
  x402Version: 1;
  scheme: X402Scheme;
  network: X402Network;
  /** Scheme-specific payload — for `"exact"`, the EIP-712 signature + authorization. */
  payload: X402ExactPayload;
}

export interface X402ExactPayload {
  /** EIP-712 signature over the authorization, hex-encoded. */
  signature: string;
  /** The EIP-3009 / EIP-712 authorization the agent signed. */
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

// ─── Builder inputs ────────────────────────────────────────────────

export interface DefineQuoteOptions {
  /** Publisher wallet that receives payment. */
  payTo: string;
  /** Price in atomic units. For USDC ($0.005), pass `"5000"`. */
  amountAtomic: string;
  /** Asset contract address. Defaults to USDC on Base. */
  asset?: string;
  /** Network. Default `"base"`. */
  network?: X402Network;
  /** The protected URL. Required — bound into the signature. */
  resource: string;
  /** Human-readable description for agent UIs. */
  description?: string;
  /** Response content-type on success. Default `"application/json"`. */
  mimeType?: string;
  /** Authorization TTL in seconds. Default 60. */
  maxTimeoutSeconds?: number;
  /** Override extra fields. Default `{ name: "USDC", version: "2" }`. */
  extra?: Record<string, unknown>;
  /** Optional JSON Schema for the response. */
  outputSchema?: unknown;
}

export interface BuildX402_402Options {
  /** Required: the accepted payment requirements. Built via defineQuote(). */
  accepts: X402PaymentRequirement[];
  /** Optional URL for context-license.json, added as Link rel="describedby". */
  contextLicenseUrl?: string;
  /** Optional terms URL, added as Link rel="terms-of-service". */
  termsUrl?: string;
}

export interface Built402Response {
  status: 402;
  headers: Record<string, string>;
  body: string;
}

// ─── Verify ─────────────────────────────────────────────────────────

export interface VerifyOptions {
  /** Facilitator URL (Coinbase CDP, Cloudflare, or self-hosted). */
  facilitatorUrl: string;
  /** Bearer token for the facilitator, if required. */
  facilitatorApiKey?: string;
  /** The resource the payment was for — bound into the verification. */
  resource: string;
  /** Override fetch implementation (testing / proxies / retries). */
  fetchImpl?: typeof fetch;
}

export type VerifyResult =
  | {
      valid: true;
      /** Facilitator's transaction reference. */
      transactionId?: string;
      /** Facilitator's settlement payload. */
      settlement?: Record<string, unknown>;
    }
  | {
      valid: false;
      reason:
        | "no-header"
        | "malformed"
        | "facilitator-error"
        | "facilitator-rejected"
        | "expired"
        | "wrong-resource"
        | "wrong-scheme"
        | "wrong-network";
      detail: string;
    };

// ─── Constants ──────────────────────────────────────────────────────

/** Canonical USDC contract addresses by network. */
export const USDC_CONTRACTS: Readonly<Record<X402Network, string>> = Object.freeze({
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
});
