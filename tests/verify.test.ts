/**
 * verifyPayment tests — uses a fake fetch implementation that returns
 * canned facilitator responses, so we cover the HTTP plumbing without
 * a real network call.
 */

import { describe, expect, it } from "vitest";

import {
  encodePaymentHeader,
  verifyPayment,
  verifyPaymentFromHeaders,
} from "../src/index.js";
import type { X402PaymentHeader } from "../src/index.js";

const PAYMENT: X402PaymentHeader = {
  x402Version: 1,
  scheme: "exact",
  network: "base",
  payload: {
    signature: "0xdeadbeef",
    authorization: {
      from: "0xAGENT",
      to: "0xPUBLISHER",
      value: "5000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: "0x1",
    },
  },
};

function fakeFetch(
  status: number,
  body: unknown,
  capturedReq?: { body?: string },
): typeof fetch {
  return (async (url, init) => {
    if (capturedReq && typeof init?.body === "string") {
      capturedReq.body = init.body;
    }
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("verifyPayment — facilitator HTTP plumbing", () => {
  it("returns valid:true when facilitator returns { valid: true, transactionId }", async () => {
    const r = await verifyPayment(PAYMENT, {
      facilitatorUrl: "https://fac.example/verify",
      resource: "https://example.com/a",
      fetchImpl: fakeFetch(200, { valid: true, transactionId: "0xtxn1" }),
    });
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.transactionId).toBe("0xtxn1");
  });

  it("propagates the settlement object when present", async () => {
    const r = await verifyPayment(PAYMENT, {
      facilitatorUrl: "https://fac.example/verify",
      resource: "https://example.com/a",
      fetchImpl: fakeFetch(200, {
        valid: true,
        transactionId: "0xtxn2",
        settlement: { blockNumber: 12345, chainId: 8453 },
      }),
    });
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.settlement).toEqual({ blockNumber: 12345, chainId: 8453 });
  });

  it("returns facilitator-rejected when facilitator returns { valid: false }", async () => {
    const r = await verifyPayment(PAYMENT, {
      facilitatorUrl: "https://fac.example/verify",
      resource: "https://example.com/a",
      fetchImpl: fakeFetch(200, { valid: false, reason: "insufficient_funds" }),
    });
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.reason).toBe("facilitator-rejected");
    expect(r.detail).toContain("insufficient_funds");
  });

  it("returns facilitator-rejected on HTTP 400/402 from facilitator", async () => {
    const r = await verifyPayment(PAYMENT, {
      facilitatorUrl: "https://fac.example/verify",
      resource: "https://example.com/a",
      fetchImpl: fakeFetch(402, { error: "expired_authorization" }),
    });
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.reason).toBe("facilitator-rejected");
  });

  it("returns facilitator-error on HTTP 5xx from facilitator", async () => {
    const r = await verifyPayment(PAYMENT, {
      facilitatorUrl: "https://fac.example/verify",
      resource: "https://example.com/a",
      fetchImpl: fakeFetch(500, "internal error"),
    });
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.reason).toBe("facilitator-error");
    expect(r.detail).toContain("HTTP 500");
  });

  it("sends bearer token when facilitatorApiKey is provided", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchImpl: typeof fetch = (async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ valid: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    await verifyPayment(PAYMENT, {
      facilitatorUrl: "https://fac.example/verify",
      resource: "https://example.com/a",
      facilitatorApiKey: "secret-key-123",
      fetchImpl,
    });
    expect(capturedHeaders?.["authorization"]).toBe("Bearer secret-key-123");
  });

  it("sends resource in the facilitator request body", async () => {
    const captured: { body?: string } = {};
    await verifyPayment(PAYMENT, {
      facilitatorUrl: "https://fac.example/verify",
      resource: "https://example.com/a/protected",
      fetchImpl: fakeFetch(200, { valid: true }, captured),
    });
    expect(captured.body).toBeDefined();
    const sentBody = JSON.parse(captured.body!) as { resource: string; x402Version: number };
    expect(sentBody.resource).toBe("https://example.com/a/protected");
    expect(sentBody.x402Version).toBe(1);
  });

  it("rejects schemes other than 'exact'", async () => {
    const bad = { ...PAYMENT, scheme: "upTo" as unknown as "exact" };
    const r = await verifyPayment(bad, {
      facilitatorUrl: "https://fac.example/verify",
      resource: "https://example.com/a",
      fetchImpl: fakeFetch(200, { valid: true }),
    });
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.reason).toBe("wrong-scheme");
  });
});

describe("verifyPaymentFromHeaders — end-to-end via header", () => {
  it("decodes the X-PAYMENT header and calls the facilitator", async () => {
    const encoded = encodePaymentHeader(PAYMENT);
    const r = await verifyPaymentFromHeaders(
      { "x-payment": encoded },
      {
        facilitatorUrl: "https://fac.example/verify",
        resource: "https://example.com/a",
        fetchImpl: fakeFetch(200, { valid: true, transactionId: "0xtxn3" }),
      },
    );
    expect(r.valid).toBe(true);
  });

  it("returns no-header when X-PAYMENT is absent", async () => {
    const r = await verifyPaymentFromHeaders(
      {},
      {
        facilitatorUrl: "https://fac.example/verify",
        resource: "https://example.com/a",
        fetchImpl: fakeFetch(200, { valid: true }),
      },
    );
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.reason).toBe("no-header");
  });

  it("returns wrong-network when expectedNetwork mismatches", async () => {
    const encoded = encodePaymentHeader(PAYMENT); // network: "base"
    const r = await verifyPaymentFromHeaders(
      { "x-payment": encoded },
      {
        facilitatorUrl: "https://fac.example/verify",
        resource: "https://example.com/a",
        expectedNetwork: "polygon",
        fetchImpl: fakeFetch(200, { valid: true }),
      },
    );
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.reason).toBe("wrong-network");
  });
});
