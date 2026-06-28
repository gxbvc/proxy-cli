import http from "http";
import https from "https";
import { connect as tlsConnect } from "tls";
import { URL } from "url";
import { buildResidential, type BuildOpts, type ProxyParts } from "./proxy.js";

export interface FetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** The proxy session token used (so a caller can prove IP rotation per request). */
  session: string;
}

/**
 * Fetch a URL through the residential superproxy via an HTTP CONNECT tunnel.
 *
 * We open a CONNECT to brd.superproxy.io, then (for https targets) do a TLS handshake
 * to the origin over that tunnel and send a raw GET. This keeps the dependency surface
 * to Node built-ins (no proxy-agent package) and works for both http and https targets.
 */
function fetchOnce(target: string, proxy: ProxyParts, timeoutMs: number): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const proxyUrl = new URL(proxy.server);
    const auth = "Basic " + Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");
    const isHttps = u.protocol === "https:";
    const originPort = u.port ? Number(u.port) : isHttps ? 443 : 80;

    const connectReq = http.request({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port),
      method: "CONNECT",
      path: `${u.hostname}:${originPort}`,
      headers: { "Proxy-Authorization": auth, Host: `${u.hostname}:${originPort}` },
      timeout: timeoutMs,
    });

    connectReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT failed: HTTP ${res.statusCode}`));
        return;
      }

      const onResponse = (response: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        response.on("data", (c) => chunks.push(c));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
            session: proxy.session,
          })
        );
      };

      const headers = {
        Host: u.hostname,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        Connection: "close",
      };

      // Run the origin request over the CONNECT tunnel. For https we wrap the tunnel
      // socket in TLS via createConnection; for http we hand the raw socket back.
      const originReq = isHttps
        ? https.request(
            {
              host: u.hostname,
              port: originPort,
              method: "GET",
              path: u.pathname + u.search,
              headers,
              timeout: timeoutMs,
              createConnection: () => tlsConnect({ socket, servername: u.hostname }),
            },
            onResponse
          )
        : http.request(
            {
              host: u.hostname,
              port: originPort,
              method: "GET",
              path: u.pathname + u.search,
              headers,
              timeout: timeoutMs,
              createConnection: () => socket,
            },
            onResponse
          );

      originReq.on("error", reject);
      originReq.on("timeout", () => originReq.destroy(new Error("origin request timeout")));
      originReq.end();
    });

    connectReq.on("error", reject);
    connectReq.on("timeout", () => connectReq.destroy(new Error("proxy CONNECT timeout")));
    connectReq.end();
  });
}

export interface ResidentialFetchOpts extends BuildOpts {
  timeoutMs?: number;
  retries?: number;
}

/**
 * Fetch through residential with retry/backoff. On each retry (or always, if
 * session==="rand") a fresh sticky session token is minted, so a retry rotates to a
 * NEW exit IP — exactly what defeats per-IP throttles. 429/403/5xx are retried.
 */
export async function residentialFetch(
  target: string,
  opts: ResidentialFetchOpts = {}
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const retries = opts.retries ?? 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Rotate IP per attempt: if caller asked for rotation (or didn't pin a session),
    // mint a fresh sticky token each try so the retry lands on a different IP.
    const sessionOpt =
      opts.session && opts.session !== "rand" ? opts.session : "rand";
    const proxy = buildResidential({ ...opts, session: sessionOpt });
    try {
      const res = await fetchOnce(target, proxy, timeoutMs);
      if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt < retries) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("residential fetch failed");
}
