import { test } from "node:test";
import assert from "node:assert/strict";

// Set creds before importing the module (config reads env at module load is fine; proxy reads lazily).
process.env.BRIGHTDATA_CUSTOMER_ID = "hl_test123";
process.env.BRIGHTDATA_RESIDENTIAL_ZONE = "residential";
process.env.BRIGHTDATA_RESIDENTIAL_PASS = "secretpass";

const { buildResidential, SUPERPROXY_HOST, SUPERPROXY_PORT } = await import("./proxy.js");

test("rotating (no session) username has no session segment", () => {
  const p = buildResidential();
  assert.equal(p.username, "brd-customer-hl_test123-zone-residential");
  assert.equal(p.session, "");
  assert.equal(p.server, `http://${SUPERPROXY_HOST}:${SUPERPROXY_PORT}`);
});

test("rand session adds a hex token", () => {
  const p = buildResidential({ session: "rand" });
  assert.match(p.username, /-session-[0-9a-f]{12}$/);
  assert.equal(p.session.length, 12);
});

test("fixed session + country are encoded in order", () => {
  const p = buildResidential({ session: "sticky1", country: "US" });
  assert.equal(
    p.username,
    "brd-customer-hl_test123-zone-residential-country-us-session-sticky1"
  );
});

test("url embeds credentials against the superproxy", () => {
  const p = buildResidential({ session: "sticky1" });
  assert.equal(
    p.url,
    "http://brd-customer-hl_test123-zone-residential-session-sticky1:secretpass@brd.superproxy.io:44445"
  );
});
