import { Command } from "commander";
import { ok, err } from "./output.js";
import { buildResidential, type Zone } from "./proxy.js";
import { listZones, unlockerFetch } from "./client.js";
import { residentialFetch, webshareFetch, webshareResidentialFetch } from "./fetch.js";
import { buildWebshare, buildWebshareResidential, usWebshareProxies } from "./webshare.js";
import { getUnlockerZone, ZONES_URL } from "./config.js";

const program = new Command();

program
  .name("proxy-cli")
  .description(
    "Proxy wrapper for cad's scrapers: Webshare datacenter (default, rotates US IPs from the live pool) + Bright Data residential/Web Unlocker"
  )
  .version("1.0.0")
  .option("--pretty", "pretty-print JSON output");

const pretty = () => program.opts().pretty as boolean | undefined;

function fail(e: unknown, fallbackCode: string): never {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string })?.code ?? fallbackCode;
  return err(msg, code);
}

// ── url ────────────────────────────────────────────────────────────────────
program
  .command("url")
  .description("print a ready-to-use proxy URL (webshare datacenter by default; picks a fresh random US IP per call)")
  .option("--zone <zone>", "webshare (default) | webshare-residential | residential | unlocker", "webshare")
  .option("--country <cc>", "residential zones only: two-letter country code, e.g. us")
  .option("--session <id>", 'residential only: "rand" for a fresh sticky session, or a fixed token; omit for pure rotating')
  .option("--json", "emit {server, username, password} for Playwright proxy={...}")
  .action(async (opts) => {
    try {
      if (opts.zone === "unlocker") {
        // Unlocker is API-based, not a superproxy URL. Surface that clearly.
        return err(
          "The unlocker zone is used via `proxy-cli fetch --zone unlocker` (POST api.brightdata.com/request), not a proxy URL. Use --zone webshare or --zone residential for a proxy URL.",
          "NO_PROXY_URL_FOR_UNLOCKER"
        );
      }
      if (opts.zone === "webshare") {
        // Pick a fresh random US datacenter endpoint from the live Webshare pool.
        const p = await buildWebshare();
        if (opts.json) {
          ok({ server: p.server, username: p.username, password: p.password, session: p.session, zone: p.zone, city: p.city }, { pretty: pretty() });
        } else {
          ok({ url: p.url, session: p.session, zone: p.zone, city: p.city }, { pretty: pretty() });
        }
        return;
      }
      if (opts.zone === "webshare-residential") {
        // One rotating gateway URL: every new connection gets a fresh residential IP.
        const p = buildWebshareResidential({ country: opts.country });
        if (opts.json) {
          ok({ server: p.server, username: p.username, password: p.password, zone: p.zone }, { pretty: pretty() });
        } else {
          ok({ url: p.url, zone: p.zone }, { pretty: pretty() });
        }
        return;
      }
      const p = buildResidential({ session: opts.session, country: opts.country });
      if (opts.json) {
        ok({ server: p.server, username: p.username, password: p.password, session: p.session, zone: p.zone }, { pretty: pretty() });
      } else {
        ok({ url: p.url, session: p.session, zone: p.zone }, { pretty: pretty() });
      }
    } catch (e) {
      fail(e, "URL_FAILED");
    }
  });

// ── fetch ────────────────────────────────────────────────────────────────────
program
  .command("fetch")
  .description("one-shot fetch of a URL through the proxy, returning the body")
  .argument("<url>", "target URL")
  .option("--zone <zone>", "webshare (default) | webshare-residential | residential | unlocker", "webshare")
  .option("--render", "unlocker only: JS-render the page")
  .option("--country <cc>", "residential zones only: two-letter country code, e.g. us")
  .option("--session <id>", "residential only: sticky session token (or 'rand')")
  .option("--timeout <ms>", "request timeout in ms", "60000")
  .option("--retries <n>", "retry count (rotates IP each retry)", "3")
  .action(async (url: string, opts) => {
    const zone = opts.zone as Zone;
    try {
      if (zone === "unlocker") {
        const z = getUnlockerZone();
        const body = await unlockerFetch(z, url, { render: !!opts.render, country: opts.country });
        ok({ zone: "unlocker", url, bytes: Buffer.byteLength(body), body }, { pretty: pretty() });
      } else if (zone === "webshare") {
        const res = await webshareFetch(url, {
          timeoutMs: Number(opts.timeout),
          retries: Number(opts.retries),
        });
        ok(
          {
            zone: "webshare",
            url,
            status: res.status,
            session: res.session, // the ip:port endpoint used
            bytes: res.body.length,
            body: res.body.toString("utf8"),
          },
          { pretty: pretty() }
        );
      } else if (zone === "webshare-residential") {
        const res = await webshareResidentialFetch(url, {
          country: opts.country,
          timeoutMs: Number(opts.timeout),
          retries: Number(opts.retries),
        });
        ok(
          {
            zone: "webshare-residential",
            url,
            status: res.status,
            bytes: res.body.length,
            body: res.body.toString("utf8"),
          },
          { pretty: pretty() }
        );
      } else {
        const res = await residentialFetch(url, {
          session: opts.session,
          country: opts.country,
          timeoutMs: Number(opts.timeout),
          retries: Number(opts.retries),
        });
        ok(
          {
            zone: "residential",
            url,
            status: res.status,
            session: res.session,
            bytes: res.body.length,
            body: res.body.toString("utf8"),
          },
          { pretty: pretty() }
        );
      }
    } catch (e) {
      fail(e, "FETCH_FAILED");
    }
  });

// ── zones ────────────────────────────────────────────────────────────────────
program
  .command("zones")
  .description("list the account's active Bright Data zones (discover residential/unlocker)")
  .action(async () => {
    try {
      const zones = await listZones();
      const residential = zones.filter((z) => /res/i.test(z.type ?? ""));
      const unlocker = zones.filter((z) => /unblock|unlock/i.test(z.type ?? ""));
      ok(
        {
          count: zones.length,
          zones,
          residential: residential.map((z) => z.name),
          unlocker: unlocker.map((z) => z.name),
        },
        { pretty: pretty() }
      );
    } catch (e) {
      fail(e, "ZONES_FAILED");
    }
  });

// ── check ────────────────────────────────────────────────────────────────────
program
  .command("check")
  .description("auth + tiny test fetches, printing the egress IP (proves rotation). Default zone: webshare")
  .option("--zone <zone>", "webshare (default) | webshare-residential | residential", "webshare")
  .option("--country <cc>", "residential zones only: two-letter country code, e.g. us")
  .option("--n <n>", "number of back-to-back rotating fetches", "3")
  .action(async (opts) => {
    const n = Math.max(1, Number(opts.n));
    try {
      if (opts.zone === "webshare-residential") {
        const ips: string[] = [];
        let fetchErr: string | undefined;
        for (let i = 0; i < n; i++) {
          try {
            const res = await webshareResidentialFetch("https://api.ipify.org?format=json", {
              country: opts.country,
              timeoutMs: 30_000,
              retries: 2,
            });
            ips.push(JSON.parse(res.body.toString("utf8")).ip ?? "?");
          } catch (e) {
            fetchErr = e instanceof Error ? e.message : String(e);
            break;
          }
        }
        return ok(
          {
            zone: "webshare-residential",
            egress_ips: ips,
            rotated: new Set(ips).size > 1,
            ...(fetchErr ? { fetch_error: fetchErr } : {}),
          },
          { pretty: pretty() }
        );
      }
      if (opts.zone === "webshare") {
        // Auth + pool check via the Webshare API, then tiny fetches each on a fresh IP.
        const pool = await usWebshareProxies();
        const ips: { session: string; ip: string }[] = [];
        let fetchErr: string | undefined;
        for (let i = 0; i < n; i++) {
          try {
            const res = await webshareFetch("https://api.ipify.org?format=json", {
              timeoutMs: 30_000,
              retries: 2,
            });
            const j = JSON.parse(res.body.toString("utf8"));
            ips.push({ session: res.session, ip: j.ip ?? "?" });
          } catch (e) {
            fetchErr = e instanceof Error ? e.message : String(e);
            break;
          }
        }
        return ok(
          {
            zone: "webshare",
            authed: true,
            us_pool_size: pool.length,
            us_pool: pool.map((p) => `${p.proxy_address}:${p.port}`),
            egress_ips: ips,
            rotated: new Set(ips.map((x) => x.ip)).size > 1,
            ...(fetchErr ? { fetch_error: fetchErr } : {}),
          },
          { pretty: pretty() }
        );
      }

      // residential path
      // 1) auth check via management API
      const zones = await listZones();
      const hasResidential = zones.some((z) => /res/i.test(z.type ?? ""));

      // 2) tiny test fetches through residential, each a fresh rotating session
      const ips: { session: string; ip: string }[] = [];
      let fetchErr: string | undefined;
      if (hasResidential) {
        for (let i = 0; i < n; i++) {
          try {
            // api.ipify.org returns {"ip":"x.x.x.x"} for the egress IP; lumtest's
            // myip.json dropped its top-level `ip` key (now only geo/asn), which made
            // every IP read back as "?" and `rotated` always false. ipify keeps it.
            const res = await residentialFetch("https://api.ipify.org?format=json", {
              session: "rand",
              country: opts.country,
              timeoutMs: 30_000,
              retries: 2,
            });
            const j = JSON.parse(res.body.toString("utf8"));
            ips.push({ session: res.session, ip: j.ip ?? "?" });
          } catch (e) {
            fetchErr = e instanceof Error ? e.message : String(e);
            break;
          }
        }
      }

      ok(
        {
          zone: "residential",
          authed: true,
          active_zones: zones.length,
          residential_zone_present: hasResidential,
          egress_ips: ips,
          rotated: new Set(ips.map((x) => x.ip)).size > 1,
          ...(fetchErr ? { fetch_error: fetchErr } : {}),
          ...(hasResidential ? {} : { note: `No residential zone on the account. Create one at ${ZONES_URL}.` }),
        },
        { pretty: pretty() }
      );
    } catch (e) {
      fail(e, "CHECK_FAILED");
    }
  });

program.parseAsync(process.argv);
