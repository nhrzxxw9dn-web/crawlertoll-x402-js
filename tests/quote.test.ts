/**
 * Quote builder + 402 response tests.
 */

import { describe, expect, it } from "vitest";

import {
  USDC_CONTRACTS,
  buildX402_402,
  defineQuote,
  defineQuotePerNetwork,
} from "../src/index.js";

const PAY_TO = "0x1234567890abcdef1234567890abcdef12345678";

describe("defineQuote", () => {
  it("produces a v2 PaymentRequirement with sensible defaults", () => {
    const q = defineQuote({
      payTo: PAY_TO,
      amountAtomic: "5000",
      resource: "https://example.com/api/articles",
    });
    expect(q.scheme).toBe("exact");
    expect(q.network).toBe("base");
    expect(q.maxAmountRequired).toBe("5000");
    expect(q.payTo).toBe(PAY_TO);
    expect(q.resource).toBe("https://example.com/api/articles");
    expect(q.asset).toBe(USDC_CONTRACTS.base);
    expect(q.maxTimeoutSeconds).toBe(60);
    expect(q.mimeType).toBe("application/json");
    expect(q.extra).toEqual({ name: "USDC", version: "2" });
  });

  it("respects caller-supplied network + asset", () => {
    const q = defineQuote({
      payTo: PAY_TO,
      amountAtomic: "100",
      resource: "https://example.com/a",
      network: "polygon",
    });
    expect(q.network).toBe("polygon");
    expect(q.asset).toBe(USDC_CONTRACTS.polygon);
  });

  it("rejects malformed payTo", () => {
    expect(() =>
      defineQuote({
        payTo: "not-an-address",
        amountAtomic: "100",
        resource: "https://example.com/a",
      }),
    ).toThrow(/payTo must be/);
  });

  it("rejects non-decimal amountAtomic", () => {
    expect(() =>
      defineQuote({
        payTo: PAY_TO,
        amountAtomic: "5.0",
        resource: "https://example.com/a",
      }),
    ).toThrow(/amountAtomic must be/);
  });

  it("rejects non-http resource", () => {
    expect(() =>
      defineQuote({
        payTo: PAY_TO,
        amountAtomic: "100",
        resource: "ftp://example.com/a",
      }),
    ).toThrow(/resource must be/);
  });
});

describe("defineQuotePerNetwork", () => {
  it("emits one PaymentRequirement per network", () => {
    const quotes = defineQuotePerNetwork(
      {
        payTo: PAY_TO,
        amountAtomic: "5000",
        resource: "https://example.com/a",
      },
      ["base", "polygon", "arbitrum"],
    );
    expect(quotes).toHaveLength(3);
    expect(quotes[0]!.network).toBe("base");
    expect(quotes[1]!.network).toBe("polygon");
    expect(quotes[2]!.network).toBe("arbitrum");
    // Each picks the right USDC contract automatically.
    expect(quotes[0]!.asset).toBe(USDC_CONTRACTS.base);
    expect(quotes[1]!.asset).toBe(USDC_CONTRACTS.polygon);
    expect(quotes[2]!.asset).toBe(USDC_CONTRACTS.arbitrum);
  });
});

describe("buildX402_402", () => {
  it("returns 402 with x402-v2 body shape", () => {
    const built = buildX402_402({
      accepts: [
        defineQuote({
          payTo: PAY_TO,
          amountAtomic: "5000",
          resource: "https://example.com/a",
        }),
      ],
    });
    expect(built.status).toBe(402);
    const body = JSON.parse(built.body);
    expect(body.x402Version).toBe(1);
    expect(body.error).toBe("payment_required");
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0].scheme).toBe("exact");
  });

  it("emits Cloudflare-shape Crawler-Price headers via core", () => {
    const built = buildX402_402({
      accepts: [
        defineQuote({
          payTo: PAY_TO,
          amountAtomic: "5000",
          resource: "https://example.com/a",
        }),
      ],
      contextLicenseUrl: "https://example.com/.well-known/context-license.json",
      termsUrl: "https://example.com/ai-terms",
    });
    expect(built.headers["crawler-price"]).toBe("5000 micros USDC");
    expect(built.headers["crawler-price-rail"]).toBe("x402");
    expect(built.headers["link"]).toContain('rel="describedby"');
    expect(built.headers["link"]).toContain('rel="terms-of-service"');
  });

  it("rejects empty accepts[]", () => {
    expect(() => buildX402_402({ accepts: [] })).toThrow(
      /at least one PaymentRequirement/,
    );
  });
});
