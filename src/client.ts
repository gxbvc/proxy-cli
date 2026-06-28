import { getApiKey } from "./config.js";

const BASE_URL = "https://api.brightdata.com";

/** Authenticated call to the Bright Data management API (zones, status, unlocker). */
export async function bd<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const key = getApiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    let body: string;
    try {
      body = await res.text();
    } catch {
      body = res.statusText;
    }
    const error = new Error(`HTTP ${res.status}: ${body}`) as Error & {
      status: number;
      body: string;
    };
    error.status = res.status;
    error.body = body;
    throw error;
  }

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export interface ZoneInfo {
  name: string;
  type?: string;
  status?: string;
  [key: string]: unknown;
}

/** List the account's active zones (name + type/status). */
export async function listZones(): Promise<ZoneInfo[]> {
  // /zone/get_active_zones returns [{name, type}, ...]
  const data = await bd<ZoneInfo[]>("/zone/get_active_zones");
  return Array.isArray(data) ? data : [];
}

export interface UnlockerOpts {
  /** JS-render the page (Unlocker browser render). */
  render?: boolean;
  /** Two-letter country code. */
  country?: string;
  /** "raw" = body as-is (default), "json" = Bright Data's structured wrapper. */
  format?: "raw" | "json";
}

/**
 * Fetch a URL through the Web Unlocker zone (POST api.brightdata.com/request).
 * Returns the raw response text (HTML/PDF-as-text/etc).
 */
export async function unlockerFetch(
  zone: string,
  url: string,
  opts: UnlockerOpts = {}
): Promise<string> {
  const body: Record<string, unknown> = {
    zone,
    url,
    format: opts.format ?? "raw",
  };
  if (opts.render) body.data_format = "html"; // triggers JS render path
  if (opts.country) body.country = opts.country.toLowerCase();

  return bd<string>("/request", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
