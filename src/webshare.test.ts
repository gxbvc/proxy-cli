import { test } from "node:test";
import assert from "node:assert/strict";

process.env.WEBSHARE_RESIDENTIAL_USER = "abcdefgh";
process.env.WEBSHARE_RESIDENTIAL_PASS = "secretpass";

const { buildWebshareResidential } = await import("./webshare.js");

test("residential defaults to the US rotating username on the gateway", () => {
  const p = buildWebshareResidential();
  assert.equal(p.username, "abcdefgh-us-rotate");
  assert.equal(p.server, "http://p.webshare.io:80");
  assert.equal(p.url, "http://abcdefgh-us-rotate:secretpass@p.webshare.io:80");
  assert.equal(p.zone, "webshare-residential");
});

test("residential country is lowercased into the username", () => {
  assert.equal(buildWebshareResidential({ country: "GB" }).username, "abcdefgh-gb-rotate");
});
