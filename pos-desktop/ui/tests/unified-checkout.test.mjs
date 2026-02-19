import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSalePaymentsForSettlement,
  saleIdempotencyKeyForCompany,
} from "../src/lib/unified-checkout.js";

test("buildSalePaymentsForSettlement keeps credit as zero immediate payment", () => {
  const payments = buildSalePaymentsForSettlement({
    paymentMethod: "credit",
    totalUsd: 123.45,
    totalLbp: 11000000,
    settlementCurrency: "USD",
  });
  assert.deepEqual(payments, [{ method: "credit", amount_usd: 0, amount_lbp: 0 }]);
});

test("buildSalePaymentsForSettlement uses only USD amount on USD settlement", () => {
  const payments = buildSalePaymentsForSettlement({
    paymentMethod: "cash",
    totalUsd: 50,
    totalLbp: 4500000,
    settlementCurrency: "USD",
  });
  assert.deepEqual(payments, [{ method: "cash", amount_usd: 50, amount_lbp: 0 }]);
});

test("buildSalePaymentsForSettlement uses only LBP amount on LBP settlement", () => {
  const payments = buildSalePaymentsForSettlement({
    paymentMethod: "card",
    totalUsd: 50,
    totalLbp: 4500000,
    settlementCurrency: "LBP",
  });
  assert.deepEqual(payments, [{ method: "card", amount_usd: 0, amount_lbp: 4500000 }]);
});

test("saleIdempotencyKeyForCompany is stable per company regardless checkout branch", () => {
  const intent = "intent-123";
  const splitKey = saleIdempotencyKeyForCompany(intent, "official");
  const singleKey = saleIdempotencyKeyForCompany(intent, "official");
  assert.equal(splitKey, "intent-123:sale:official");
  assert.equal(singleKey, splitKey);
});

test("saleIdempotencyKeyForCompany normalizes unknown company keys to official", () => {
  assert.equal(saleIdempotencyKeyForCompany("intent-123", "anything"), "intent-123:sale:official");
  assert.equal(saleIdempotencyKeyForCompany("intent-123", "unofficial"), "intent-123:sale:unofficial");
});
