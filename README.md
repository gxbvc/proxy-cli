# proxy-cli

A thin wrapper over [Bright Data](https://brightdata.com) proxies — residential rotating
and Web Unlocker — that makes proxied requests easy for cad's scrapers (Python Playwright
on the Mac Studio cluster + Ruby open-uri). It centralizes Bright Data creds, zone
selection, country, session rotation, and retry/backoff so **no scraper hardcodes proxy
config**.

## Why this exists

cad scrapes FREE county-recorder portals for deed-of-trust debt data. The **deed-image**
endpoints are per-IP throttled on every portal:

- `publicsearch.us` — fronted by a shared Neumo WAF across all county subdomains,
  ~1 request / 60 s per IP, then returns an empty/429 throttle page.
- `tccsearch.org` — its image viewer enforces a per-IP quota.

The whole Mac Studio cluster shares one NAT egress IP (`70.123.104.69`), so that single IP
bottlenecks every county at once. **Rotating residential IPs defeat the per-IP throttle.**
The records themselves remain free public data — we pay Bright Data only for IP rotation.

## Prerequisites

- Node 20+
- A Bright Data account with at least a **Residential** proxy zone (and optionally a
  **Web Unlocker** zone). The Bright Data API key is reused from
  `~/tools/brightdata-cli/.env`.

## Setup

```bash
cd ~/tools/proxy-cli
npm install
npm run build
npm link            # global `proxy-cli`
cp .env.example .env   # then fill in the zone name + password (API key/customer id prefilled)
```

### Credentials (`.env`)

| Var | What | Where |
|---|---|---|
| `BRIGHTDATA_API_KEY` | management-API key | reused from `~/tools/brightdata-cli/.env` automatically |
| `BRIGHTDATA_CUSTOMER_ID` | `brd-customer-<id>` segment (`hl_5387bb99`) | dashboard URL / a zone's "Access parameters" |
| `BRIGHTDATA_RESIDENTIAL_ZONE` | residential zone **name** | https://brightdata.com/cp/zones |
| `BRIGHTDATA_RESIDENTIAL_PASS` | residential zone **password** | the zone's "Access parameters" tab |
| `BRIGHTDATA_UNLOCKER_ZONE` | Web Unlocker zone **name** | https://brightdata.com/cp/zones |

`.env` (this dir) is loaded first; the brightdata-cli `.env` fills any gaps (the API key).

## Commands

### `proxy-cli url`

Print a ready-to-use **residential** proxy URL.

```bash
proxy-cli url                                 # pure rotating: new IP per connection
proxy-cli url --country us --session rand      # sticky US session (same IP ~minutes)
proxy-cli url --json                            # {server, username, password} for Playwright
```

The URL is the documented superproxy shape:
`http://brd-customer-<id>-zone-<zone>[-country-us][-session-<token>]:<pass>@brd.superproxy.io:33335`.

### `proxy-cli fetch <url>`

One-shot fetch returning the body. For curl/open-uri/shell callers.

```bash
proxy-cli fetch "https://dallas.tx.publicsearch.us/"                       # residential (rotating + retry/backoff)
proxy-cli fetch "https://dallas.tx.publicsearch.us/" --session rand        # explicit fresh session
proxy-cli fetch "https://example.com/hard" --zone unlocker --render        # Web Unlocker, JS-rendered
```

Residential returns `{status, session, bytes, body}`; each retry rotates to a new IP.
Unlocker POSTs `api.brightdata.com/request` with the unlocker zone.

### `proxy-cli zones`

List the account's active zones (so you can see what's configured).

```bash
proxy-cli zones --pretty
```

### `proxy-cli check`

Auth + a tiny residential test fetch against `lumtest.com/myip.json`, printing the egress
IP for several back-to-back rotating sessions. `rotated: true` proves IP rotation works.

```bash
proxy-cli check --country us --n 3 --pretty
```

## Wire into Playwright (cluster/cad_browser.py)

`cad_browser.py` launches chromium in `_launch()`. Pass a rotating residential proxy:

```python
import json, subprocess

def _proxy():
    out = subprocess.run(
        ["proxy-cli", "url", "--json", "--country", "us", "--session", "rand"],
        capture_output=True, text=True, check=True,
    ).stdout
    d = json.loads(out)["data"]
    return {"server": d["server"], "username": d["username"], "password": d["password"]}

# inside _launch(p, cmd):
b = p.chromium.launch(headless=True, args=LAUNCH_ARGS, proxy=_proxy())
```

A fresh `--session rand` per `_launch` gives each portal session its own residential exit
IP, so the publicsearch Neumo WAF never sees a burst from one IP.

## Wire into Ruby (open-uri / Net::HTTP)

```ruby
require "json"
proxy_url = JSON.parse(`proxy-cli url`)["data"]["url"]
ENV["https_proxy"] = proxy_url   # open-uri & Net::HTTP egress through a rotating residential IP
URI.open("https://dallas.tx.publicsearch.us/").read
```

(For per-request stickiness, regenerate `proxy-cli url --session rand` between requests.)

## How it works

- **URL/Playwright path** — pure local string-building of the superproxy username
  (`src/proxy.ts`). No network call needed; works offline once creds are set.
- **Residential `fetch`** — opens an HTTP `CONNECT` tunnel to `brd.superproxy.io`, then does
  a TLS handshake to the origin over the tunnel and a raw GET (Node built-ins only). Retries
  on 429/403/5xx, minting a fresh sticky session each attempt so the retry lands on a new IP
  (`src/fetch.ts`).
- **Unlocker `fetch` / `zones` / `check`** — Bright Data management API with
  `Authorization: Bearer <key>` (`src/client.ts`).

## Pricing (rough)

- **Residential proxies** — pay-as-you-go ~**$8.40/GB** (lower on committed plans). Portal
  HTML pages are tens of KB; a deed page PNG is ~100–300 KB — so on the order of a few
  hundredths of a cent per page-image. Image fetches dominate the bytes.
- **Web Unlocker** — billed per successful request, roughly **$1.50–$3 / 1,000 requests**
  depending on plan. Reserve it for pages a raw residential GET can't get past.

Confirm exact rates on your plan at https://brightdata.com/cp/zones.

## Tests

```bash
npm test    # builds, then node --test on dist/*.test.js (URL construction)
```
