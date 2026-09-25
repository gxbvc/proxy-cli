import { randomBytes } from "crypto";
import { getCustomerId, getResidentialZone, getResidentialPass } from "./config.js";

// Bright Data residential superproxy host/port. The same host serves all zones; the
// zone + options are encoded into the username. Port 44445 is the current SSL port
// (22225/33335 were retired with the old root CA).
export const SUPERPROXY_HOST = "brd.superproxy.io";
export const SUPERPROXY_PORT = 44445;

export type Zone = "residential" | "unlocker" | "webshare";

export interface ProxyParts {
  /** http://host:port — what Playwright wants for `proxy.server`. */
  server: string;
  /** brd-customer-<id>-zone-<zone>[-country-..][-session-..] */
  username: string;
  /** zone password */
  password: string;
  /** Full embedded-credentials URL for curl/open-uri/https_proxy. */
  url: string;
  /** The session token actually used (empty string = pure rotating, no token). */
  session: string;
  zone: string;
}

/** A short random sticky-session token (Bright Data allows up to ~ alphanumerics). */
export function randomSession(): string {
  return randomBytes(6).toString("hex");
}

export interface BuildOpts {
  /** "rand" → fresh random sticky session; any other string → that exact session token; undefined → pure rotating (new IP per request). */
  session?: string;
  /** Two-letter country code (e.g. "us"). */
  country?: string;
}

/**
 * Build a residential superproxy URL.
 *
 * username = brd-customer-<id>-zone-<zone>[-country-<cc>][-session-<token>]
 *   - no session    → rotating: each TCP connection gets a fresh exit IP
 *   - session token → sticky: the same exit IP for the life of that token (~minutes)
 */
export function buildResidential(opts: BuildOpts = {}): ProxyParts {
  const customer = getCustomerId();
  const zone = getResidentialZone();
  const password = getResidentialPass();

  let session = "";
  if (opts.session === "rand") session = randomSession();
  else if (opts.session) session = opts.session;

  const segments = [`brd-customer-${customer}`, `zone-${zone}`];
  if (opts.country) segments.push(`country-${opts.country.toLowerCase()}`);
  if (session) segments.push(`session-${session}`);
  const username = segments.join("-");

  const server = `http://${SUPERPROXY_HOST}:${SUPERPROXY_PORT}`;
  const url = `http://${encodeURIComponent(username)}:${encodeURIComponent(
    password
  )}@${SUPERPROXY_HOST}:${SUPERPROXY_PORT}`;

  return { server, username, password, url, session, zone };
}
