import assert from "node:assert/strict";
import test from "node:test";

import {
  cartCompaniesSet,
  primaryCompanyFromCart,
  effectiveInvoiceCompany,
  pickCompanyForAmbiguousMatch,
  itemExistsInCompanyCatalog,
  findMissingCompanyItems,
} from "../src/lib/unified-sale-flow.js";

test("cartCompaniesSet keeps only valid company keys", () => {
  const set = cartCompaniesSet([
    { companyKey: "official" },
    { companyKey: "unofficial" },
    { companyKey: "official" },
    { companyKey: "" },
    {},
    null,
  ]);
  assert.deepEqual(Array.from(set.values()).sort(), ["official", "unofficial"]);
});

test("primaryCompanyFromCart returns single company or null", () => {
  assert.equal(primaryCompanyFromCart([{ companyKey: "official" }, { companyKey: "official" }]), "official");
  assert.equal(primaryCompanyFromCart([{ companyKey: "official" }, { companyKey: "unofficial" }]), null);
  assert.equal(primaryCompanyFromCart([]), null);
});

test("effectiveInvoiceCompany respects forced mode", () => {
  assert.equal(
    effectiveInvoiceCompany({ invoiceCompanyMode: "official", originCompanyKey: "unofficial", cart: [] }),
    "official",
  );
  assert.equal(
    effectiveInvoiceCompany({ invoiceCompanyMode: "unofficial", originCompanyKey: "official", cart: [] }),
    "unofficial",
  );
});

test("effectiveInvoiceCompany auto follows single-company cart", () => {
  const cart = [{ companyKey: "unofficial" }, { companyKey: "unofficial" }];
  assert.equal(effectiveInvoiceCompany({ invoiceCompanyMode: "auto", originCompanyKey: "official", cart }), "unofficial");
});

test("effectiveInvoiceCompany auto falls back to origin for mixed or empty cart", () => {
  assert.equal(
    effectiveInvoiceCompany({
      invoiceCompanyMode: "auto",
      originCompanyKey: "official",
      cart: [{ companyKey: "official" }, { companyKey: "unofficial" }],
    }),
    "official",
  );
  assert.equal(
    effectiveInvoiceCompany({ invoiceCompanyMode: "auto", originCompanyKey: "unofficial", cart: [] }),
    "unofficial",
  );
});

test("pickCompanyForAmbiguousMatch uses preferred when available", () => {
  const cart = [{ companyKey: "unofficial" }];
  const picked = pickCompanyForAmbiguousMatch({
    invoiceCompanyMode: "auto",
    originCompanyKey: "official",
    cart,
    availableCompanies: ["official", "unofficial"],
  });
  assert.equal(picked, "unofficial");
});

test("pickCompanyForAmbiguousMatch falls back to available company", () => {
  const picked = pickCompanyForAmbiguousMatch({
    invoiceCompanyMode: "official",
    originCompanyKey: "official",
    cart: [],
    availableCompanies: ["unofficial"],
  });
  assert.equal(picked, "unofficial");
});

test("itemExistsInCompanyCatalog resolves correct index by company key", () => {
  const itemsByIdOrigin = new Map([
    ["off-1", { id: "off-1" }],
    ["shared", { id: "shared" }],
  ]);
  const itemsByIdOther = new Map([
    ["un-1", { id: "un-1" }],
    ["shared", { id: "shared" }],
  ]);

  assert.equal(
    itemExistsInCompanyCatalog({
      companyKey: "official",
      itemId: "off-1",
      otherCompanyKey: "unofficial",
      itemsByIdOrigin,
      itemsByIdOther,
    }),
    true,
  );

  assert.equal(
    itemExistsInCompanyCatalog({
      companyKey: "unofficial",
      itemId: "off-1",
      otherCompanyKey: "unofficial",
      itemsByIdOrigin,
      itemsByIdOther,
    }),
    false,
  );

  assert.equal(
    itemExistsInCompanyCatalog({
      companyKey: "unofficial",
      itemId: "un-1",
      otherCompanyKey: "unofficial",
      itemsByIdOrigin,
      itemsByIdOther,
    }),
    true,
  );
});

test("findMissingCompanyItems returns unique missing ids", () => {
  const itemsByIdOrigin = new Map([["a", { id: "a" }]]);
  const itemsByIdOther = new Map([["b", { id: "b" }]]);

  const missing = findMissingCompanyItems({
    companyKey: "official",
    lines: [{ id: "a" }, { id: "x" }, { id: "x" }, { id: "y" }, { id: "" }, {}],
    otherCompanyKey: "unofficial",
    itemsByIdOrigin,
    itemsByIdOther,
  });

  assert.deepEqual(missing, ["x", "y"]);
});

test("findMissingCompanyItems works when origin is unofficial", () => {
  const itemsByIdOrigin = new Map([["un-only", { id: "un-only" }]]);
  const itemsByIdOther = new Map([["off-only", { id: "off-only" }]]);

  const missing = findMissingCompanyItems({
    companyKey: "official",
    lines: [{ id: "off-only" }, { id: "missing" }],
    otherCompanyKey: "official",
    itemsByIdOrigin,
    itemsByIdOther,
  });

  assert.deepEqual(missing, ["missing"]);
});
