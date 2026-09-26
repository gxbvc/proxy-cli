import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load this tool's own .env first, then fall back to brightdata-cli's .env so the
// BRIGHTDATA_API_KEY is shared without copy/paste. proxy-cli .env wins (loaded first;
// dotenv does not override already-set keys).
config({ path: join(__dirname, "../.env") });
const bdEnv = join(__dirname, "../../brightdata-cli/.env");
if (existsSync(bdEnv)) config({ path: bdEnv });

const ZONES_URL = "https://brightdata.com/cp/zones";

/** Throw a clear, actionable error when a required credential is missing. */
function require_(name: string, hint: string): string {
  const v = process.env[name];
  if (!v) {
    const e = new Error(
      `${name} is not set. ${hint} Copy .env.example to .env and fill it in (the API key is reused from ~/tools/brightdata-cli/.env automatically).`
    ) as Error & { code: string };
    e.code = "MISSING_CONFIG";
    throw e;
  }
  return v;
}

export function getApiKey(): string {
  return require_(
    "BRIGHTDATA_API_KEY",
    "Reuse the key from ~/tools/brightdata-cli/.env."
  );
}

export function getCustomerId(): string {
  return require_(
    "BRIGHTDATA_CUSTOMER_ID",
    `Find your customer id in the dashboard URL or a zone's "Access parameters" tab at ${ZONES_URL}.`
  );
}

export function getResidentialZone(): string {
  return require_(
    "BRIGHTDATA_RESIDENTIAL_ZONE",
    `Create a Residential proxy zone at ${ZONES_URL} and put its NAME here.`
  );
}

export function getResidentialPass(): string {
  return require_(
    "BRIGHTDATA_RESIDENTIAL_PASS",
    `Copy the residential zone's password from its "Access parameters" tab at ${ZONES_URL}.`
  );
}

export function getUnlockerZone(): string {
  return require_(
    "BRIGHTDATA_UNLOCKER_ZONE",
    `Create a Web Unlocker zone at ${ZONES_URL} and put its NAME here.`
  );
}

// ── Webshare (datacenter plan) ────────────────────────────────────────────────
const WEBSHARE_DASH = "https://dashboard.webshare.io";

export function getWebshareToken(): string {
  return require_(
    "WEBSHARE_API_TOKEN",
    `Copy your Webshare API token from ${WEBSHARE_DASH}/userapi/keys.`
  );
}

export function getWebshareUser(): string {
  return require_(
    "WEBSHARE_PROXY_USER",
    `Copy the proxy username from the Webshare "Proxy > Settings" page (${WEBSHARE_DASH}).`
  );
}

export function getWebsharePass(): string {
  return require_(
    "WEBSHARE_PROXY_PASS",
    `Copy the proxy password from the Webshare "Proxy > Settings" page (${WEBSHARE_DASH}).`
  );
}

// ── Webshare (rotating residential plan) ──────────────────────────────────────
// Same Webshare account as the datacenter plan, but the residential plan has its own
// proxy user/pass. Dashboard > Residential > Proxy settings.

export function getWebshareResidentialUser(): string {
  return require_(
    "WEBSHARE_RESIDENTIAL_USER",
    `Copy the base residential proxy username (without -us-rotate) from ${WEBSHARE_DASH}.`
  );
}

export function getWebshareResidentialPass(): string {
  return require_(
    "WEBSHARE_RESIDENTIAL_PASS",
    `Copy the residential proxy password from ${WEBSHARE_DASH}.`
  );
}

export { ZONES_URL, WEBSHARE_DASH };
