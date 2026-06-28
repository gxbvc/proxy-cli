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

export { ZONES_URL };
