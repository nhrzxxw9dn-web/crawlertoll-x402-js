/**
 * X-PAYMENT header parse + encode tests.
 */

import { describe, expect, it } from "vitest";

import {
  encodePaymentHeader,
  parsePaymentHeader,
} from "../src/index.js";
import type { X402PaymentHeader } from "../src/index.js";

const SAMPLE_PAYMENT: X402PaymentHeader = {
  x402Version: 1,
  scheme: "exact",
  network: "base",
  payload: {
    signature: "0xdeadbeefcafe1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234",
    authorization: {
      from: "0xAGENT00000000000000000000000000000000000",
      to: "0xPUBLISHER000000000000000000000000000000",
      value: "5000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: "0xabcd",
    },
  },
};

describe("parsePaymentHeader + encodePaymentHeader roundtrip", () => {
  it("encodes then decodes to the same value", () => {
    const encoded = encodePaymentHeader(SAMPLE_PAYMENT);
    const result = parsePaymentHeader({ "x-payment": encoded });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment).toEqual(SAMPLE_PAYMENT);
  });

  it("reads from a native Headers object", () => {
    const encoded = encodePaymentHeader(SAMPLE_PAYMENT);
    const h = new Headers();
    h.set("x-payment", encoded);
    const result = parsePaymentHeader(h);
    expect(result.ok).toBe(true);
  });

  it("returns no-header when X-PAYMENT is absent", () => {
    const result = parsePaymentHeader({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-header");
  });

  it("rejects non-base64 garbage", () => {
    const result = parsePaymentHeader({ "x-payment": "!!!not-base64!!!" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed");
  });

  it("rejects base64 of non-JSON", () => {
    const result = parsePaymentHeader({
      "x-payment": Buffer.from("not json").toString("base64"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed");
  });

  it("rejects wrong x402Version", () => {
    const bad = { ...SAMPLE_PAYMENT, x402Version: 999 as unknown as 1 };
    const result = parsePaymentHeader({
      "x-payment": Buffer.from(JSON.stringify(bad)).toString("base64"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed");
    expect(result.detail).toContain("Unsupported x402Version");
  });

  it("rejects unsupported scheme", () => {
    const bad = {
      ...SAMPLE_PAYMENT,
      scheme: "upTo" as unknown as "exact",
    };
    const result = parsePaymentHeader({
      "x-payment": Buffer.from(JSON.stringify(bad)).toString("base64"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed");
  });

  it("rejects missing payload structure", () => {
    const bad = {
      x402Version: 1,
      scheme: "exact",
      network: "base",
      payload: { signature: "0xabc" /* authorization missing */ },
    };
    const result = parsePaymentHeader({
      "x-payment": Buffer.from(JSON.stringify(bad)).toString("base64"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed");
  });
});
