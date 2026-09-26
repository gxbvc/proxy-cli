# proxy-cli

Proxy wrapper for cad's county-recorder scrapers so they never hardcode proxy config.
Two backends: **Webshare datacenter (default)** and Bright Data (residential + Web Unlocker).
Centralizes creds, zone selection, IP rotation, and retry/backoff.

Why: the deed-IMAGE endpoints on the free county portals are **per-IP throttled**
(publicsearch.us Neumo WAF ~1 req/60s → 429; tccsearch.org image viewer per-IP quota).
The whole cluster shares one NAT IP (70.123.104.69), so one IP bottlenecks everything.
Rotating proxy IPs defeat the throttle. Data stays free public records; we pay only for
IP rotation.

**Webshare vs Bright Data (Plan 32 P32):** Bright Data now KYC/robots.txt-blocks
publicsearch.us (402 on both zones). Webshare does NOT enforce robots.txt/KYC and a
Webshare datacenter US IP returns 200 + real content, so the recorder scrape defaults to
the `webshare` zone. The datacenter plan is a FIXED POOL of `<ip:port>` endpoints behind
one user/pass (no rotating superproxy) — so "rotation" = picking a different endpoint per
request. The live pool is fetched from the Webshare API (`proxy/list`) and cached ~5 min,
and a fresh random US endpoint is chosen per `url`/`fetch`/retry call.

## Commands

```bash
proxy-cli url   [--zone webshare] [--json]                                            # print a ready-to-use proxy URL (random US datacenter IP)
proxy-cli url   --zone webshare-residential [--country us] [--json]                    # Webshare rotating residential gateway URL (use for YouTube)
proxy-cli url   --zone residential [--country us] [--session rand|<id>] [--json]      # Bright Data superproxy URL
proxy-cli fetch <url> [--zone webshare|webshare-residential|residential|unlocker] [--render] [--retries N] # one-shot fetch -> body
proxy-cli zones                                                                       # list active Bright Data zones
proxy-cli check [--zone webshare|webshare-residential] [--n 3]                        # auth + tiny fetches; prints egress IP(s), proves rotation
```

All commands take `--pretty`. Output is the standard envelope: `{"ok":true,"data":...}` / `{"ok":false,"error":...,"code":...}`.

## Notes

- `url --zone webshare` (default): picks a random valid US endpoint from the live Webshare pool
  and returns `http://user:pass@ip:port`. `--json` returns `{server, username, password, city}`
  for Playwright's `proxy={...}`. Each call is a fresh random IP (per-session rotation). The
  returned `session` is the chosen `ip:port`.
- `url --zone webshare-residential`: one gateway URL (`<user>-us-rotate@p.webshare.io:80`). Each new
  connection gets a fresh residential IP. Use this for YouTube: Bright Data blocks YouTube on both
  zones (`policy_20050`, KYC), and YouTube bot-checks most Webshare datacenter IPs. Pay per GB on
  a separate Webshare account (christian@gxb.vc), so do not use it for bulk traffic that
  datacenter handles.
- `url --zone residential`: Bright Data superproxy URL with embedded creds. No `--session` = pure
  rotating (new IP per TCP connection); `--session rand` = sticky token (same IP for ~minutes);
  `--session foo` = a fixed sticky token you control.
- `fetch --zone webshare` (default): HTTP(S) through a random datacenter endpoint via a CONNECT
  tunnel; each retry picks a NEW endpoint (returns `status`, `session=ip:port`, `body`).
- `fetch --zone residential`: same CONNECT tunnel through the Bright Data superproxy.
- `fetch --zone unlocker`: POSTs `api.brightdata.com/request` with the unlocker zone; `--render`
  JS-renders. For sites where a raw residential GET still gets bot-blocked.
- `check --zone webshare` (default): lists the US pool, then back-to-back fetches of
  `api.ipify.org`, each on a fresh endpoint, printing distinct egress IPs (`rotated:true`).

## Env

Requires `.env` (this dir). The API key is auto-reused from `~/tools/brightdata-cli/.env`.

```
# Webshare datacenter (default zone)
WEBSHARE_API_TOKEN            # dashboard.webshare.io/userapi/keys (lists the live IP pool)
WEBSHARE_PROXY_USER           # proxy username (Proxy > Settings)
WEBSHARE_PROXY_PASS           # proxy password

# Webshare rotating residential (separate account: christian@gxb.vc)
WEBSHARE_RESIDENTIAL_USER     # base proxy username, without -us-rotate
WEBSHARE_RESIDENTIAL_PASS     # proxy password
WEBSHARE_RESIDENTIAL_API_TOKEN # API key for that account (usage and plan checks)

# Bright Data (residential + unlocker)
BRIGHTDATA_API_KEY            # reused from brightdata-cli
BRIGHTDATA_CUSTOMER_ID        # hl_5387bb99 (the brd-customer-<id> segment)
BRIGHTDATA_RESIDENTIAL_ZONE   # residential zone NAME
BRIGHTDATA_RESIDENTIAL_PASS   # residential zone password
BRIGHTDATA_UNLOCKER_ZONE      # web unlocker zone NAME
```

See `.env.example`. Webshare: https://dashboard.webshare.io. Bright Data zones: https://brightdata.com/cp/zones.

## Wire into Playwright (Python, cluster/cad_browser.py)

```python
import json, subprocess
def _proxy():
    out = subprocess.run(["proxy-cli", "url", "--json", "--country", "us", "--session", "rand"],
                         capture_output=True, text=True, check=True).stdout
    d = json.loads(out)["data"]
    return {"server": d["server"], "username": d["username"], "password": d["password"]}

b = p.chromium.launch(headless=True, args=LAUNCH_ARGS, proxy=_proxy())   # rotate per launch
```

## Wire into Ruby (open-uri / Net::HTTP)

```ruby
require "json"
url = JSON.parse(`proxy-cli url`)["data"]["url"]   # http://brd-customer-...:pass@brd.superproxy.io:44445
ENV["https_proxy"] = url
# open-uri / Net::HTTP now egress through a rotating residential IP
```

## Build

```bash
npm install && npm run build && npm link
npm test     # builds first, then node --test
```
