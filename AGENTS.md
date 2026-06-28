# proxy-cli

Thin wrapper over Bright Data proxies (residential rotating + Web Unlocker) so cad's
county-recorder scrapers never hardcode proxy config. Centralizes creds, zone selection,
country, session rotation, and retry/backoff.

Why: the deed-IMAGE endpoints on the free county portals are **per-IP throttled**
(publicsearch.us Neumo WAF ~1 req/60s → 429; tccsearch.org image viewer per-IP quota).
The whole cluster shares one NAT IP (70.123.104.69), so one IP bottlenecks everything.
Rotating residential IPs defeat the throttle. Data stays free public records; we pay only
for IP rotation.

## Commands

```bash
proxy-cli url   [--zone residential] [--country us] [--session rand|<id>] [--json]   # print a ready-to-use proxy URL
proxy-cli fetch <url> [--zone residential|unlocker] [--render] [--country us] [--session rand] [--retries N]  # one-shot fetch -> body
proxy-cli zones                                                                       # list active Bright Data zones
proxy-cli check [--country us] [--n 3]                                                # auth + tiny residential fetch; prints egress IP(s), proves rotation
```

All commands take `--pretty`. Output is the standard envelope: `{"ok":true,"data":...}` / `{"ok":false,"error":...,"code":...}`.

## Notes

- `url`: residential only. Returns the superproxy URL with embedded creds; `--json` returns
  `{server, username, password}` for Playwright's `proxy={...}`. No `--session` = pure rotating
  (new IP per TCP connection); `--session rand` = sticky token (same IP for ~minutes);
  `--session foo` = a fixed sticky token you control.
- `fetch --zone residential`: HTTP(S) through the superproxy via a CONNECT tunnel; rotates IP on
  every retry (returns `status`, `session`, `body`).
- `fetch --zone unlocker`: POSTs `api.brightdata.com/request` with the unlocker zone; `--render`
  JS-renders. For sites where a raw residential GET still gets bot-blocked.
- `check` proves rotation: back-to-back fetches of `lumtest.com/myip.json`, each a fresh session,
  printing distinct egress IPs.

## Env

Requires `.env` (this dir). The API key is auto-reused from `~/tools/brightdata-cli/.env`.

```
BRIGHTDATA_API_KEY            # reused from brightdata-cli
BRIGHTDATA_CUSTOMER_ID        # hl_5387bb99 (the brd-customer-<id> segment)
BRIGHTDATA_RESIDENTIAL_ZONE   # residential zone NAME
BRIGHTDATA_RESIDENTIAL_PASS   # residential zone password
BRIGHTDATA_UNLOCKER_ZONE      # web unlocker zone NAME
```

See `.env.example`. Create zones at https://brightdata.com/cp/zones.

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
url = JSON.parse(`proxy-cli url`)["data"]["url"]   # http://brd-customer-...:pass@brd.superproxy.io:33335
ENV["https_proxy"] = url
# open-uri / Net::HTTP now egress through a rotating residential IP
```

## Build

```bash
npm install && npm run build && npm link
npm test     # builds first, then node --test
```
