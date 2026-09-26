import {
  getWebshareToken,
  getWebshareUser,
  getWebsharePass,
  getWebshareResidentialUser,
  getWebshareResidentialPass,
} from "./config.js";

// Webshare datacenter plan. Unlike Bright Data (one superproxy host + a zone-encoded
// username), Webshare hands you a fixed pool of <ip:port> endpoints behind ONE
// user/pass. There is no rotating superproxy on the datacenter plan, so "rotation" =
// pick a DIFFERENT endpoint IP per request. We fetch the live endpoint list from the
// Webshare API (so a re-provisioned IP is picked up automatically) and cache it briefly.
//
// publicsearch.us does NOT KYC/robots-block Webshare (it does on Bright Data), and a
// Webshare datacenter US exit returns 200 + real content — this is why P32 migrated the
// recorder scrape here. This is INFRA (paid IPs to read FREE public records), never paid
// data: the FREE-DATA rule is preserved.

const LIST_URL = "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page_size=100";
const CACHE_TTL_MS = 5 * 60_000; // ~5 min, per the plan brief

export interface WebshareProxy {
  proxy_address: string;
  port: number;
  country_code: string;
  valid: boolean;
  city_name?: string;
  [key: string]: unknown;
}

interface ListResponse {
  count: number;
  results: WebshareProxy[];
}

let _cache: { at: number; proxies: WebshareProxy[] } | null = null;

/** Fetch the account's live datacenter endpoint list (cached ~5 min). */
export async function listWebshareProxies(opts: { force?: boolean } = {}): Promise<WebshareProxy[]> {
  if (!opts.force && _cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.proxies;
  }
  const token = getWebshareToken();
  const res = await fetch(LIST_URL, { headers: { Authorization: `Token ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    const e = new Error(`Webshare list HTTP ${res.status}: ${body}`) as Error & { status: number };
    e.status = res.status;
    throw e;
  }
  const data = (await res.json()) as ListResponse;
  const proxies = Array.isArray(data.results) ? data.results : [];
  _cache = { at: Date.now(), proxies };
  return proxies;
}

/** Valid US endpoints only (the scrape targets are US county recorders). */
export async function usWebshareProxies(opts: { force?: boolean } = {}): Promise<WebshareProxy[]> {
  const all = await listWebshareProxies(opts);
  return all.filter((p) => p.valid && p.country_code === "US");
}

export interface WebshareParts {
  /** http://host:port — what Playwright wants for `proxy.server`. */
  server: string;
  username: string;
  password: string;
  /** Full embedded-credentials URL for curl/open-uri/https_proxy. */
  url: string;
  /** The endpoint ip:port chosen (stands in for the "session" — proves rotation). */
  session: string;
  zone: "webshare" | "webshare-residential";
  city?: string;
}

// Webshare rotating residential. One gateway host; the country and rotation mode are
// encoded into the username (<user>-<cc>-rotate), and every new connection gets a
// fresh residential exit IP. YouTube bot-checks most datacenter IPs but accepts these.
export const WEBSHARE_RESIDENTIAL_HOST = "p.webshare.io";
export const WEBSHARE_RESIDENTIAL_PORT = 80;

export function buildWebshareResidential(opts: { country?: string } = {}): WebshareParts {
  const cc = (opts.country ?? "us").toLowerCase();
  const user = `${getWebshareResidentialUser()}-${cc}-rotate`;
  const pass = getWebshareResidentialPass();
  const hostport = `${WEBSHARE_RESIDENTIAL_HOST}:${WEBSHARE_RESIDENTIAL_PORT}`;
  return {
    server: `http://${hostport}`,
    username: user,
    password: pass,
    url: `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hostport}`,
    session: "",
    zone: "webshare-residential",
  };
}

/**
 * Pick a RANDOM live US endpoint and build a ready-to-use proxy URL. A fresh random
 * pick per call gives per-session IP rotation across the datacenter pool.
 */
export async function buildWebshare(opts: { force?: boolean } = {}): Promise<WebshareParts> {
  const us = await usWebshareProxies(opts);
  if (us.length === 0) {
    const e = new Error(
      "No valid US Webshare endpoints returned by the API. Check the plan's IPs in the dashboard."
    ) as Error & { code: string };
    e.code = "NO_WEBSHARE_US_IPS";
    throw e;
  }
  const pick = us[Math.floor(Math.random() * us.length)];
  const user = getWebshareUser();
  const pass = getWebsharePass();
  const hostport = `${pick.proxy_address}:${pick.port}`;
  return {
    server: `http://${hostport}`,
    username: user,
    password: pass,
    url: `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hostport}`,
    session: hostport,
    zone: "webshare",
    city: pick.city_name,
  };
}
