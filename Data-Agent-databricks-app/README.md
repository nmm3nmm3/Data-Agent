# Data-Agent

AI-assisted business metrics app. Users ask for metrics in plain language; the app uses OpenAI to interpret intent and invoke query functions against Databricks. **All calculations run in Databricks** — the model only routes to tools.

**Use case: MRRpV (Monthly Recurring Revenue per Vehicle).** Three data sources (First purchases, Upsell, Fleet overall). **Preset views** (First Purchase overall by quarter, by Industry, by Geo-Segment, **MRRpV Bridge**, **ASP Investigation**) with a Views dropdown; select a preset to run it, or use chat to ask for metrics or **modify the current view** (e.g. "remove EMEA", "only include MM accounts", "add Maintenance"). The agent receives **current view context** (preset + params) and re-runs the query with the requested filters. **Restore unfiltered** runs the preset with default params and no filters via POST /api/views/run-default (no LLM). Each assistant reply has **thumbs up/down** feedback; optional comment is stored for **Admin → User feedback**. Tables support time-as-columns pivots, geo/segment merged cells (NA vs EMEA), bridge contribution table, and ASP-by-product (Product column + Metric column + quarter columns). See **HANDOFF.md** for full state and paths.

---

## Testing Stage 1 (foundation)

Stage 1 delivers the project scaffold, MRRpV spec, and a locally runnable app. You can verify it **without** setting OpenAI or Databricks credentials.

**Directory:** Run all of the following commands from the **Data-Agent project root** (the folder that contains `package.json`, `backend/`, and `frontend/`). For example:
```bash
cd /path/to/Data-Agent
```

### 1. Validate the MRRpV spec

```bash
npm run validate:mrrpv-spec
```

**Expected:** `OK: MRRpV spec exists and has Definition, Source, Denominator.`  
**If it fails:** Ensure `docs/MRRpV-spec.md` exists and contains the three required section headers (see the script output for the exact names).

### 2. Confirm scaffold and install

From the **Data-Agent** directory:

```bash
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

You end back in **Data-Agent**. **Expected:** No errors. You should have `node_modules` at root, in `backend/`, and in `frontend/`.

### 3. Run the app and check health

From the **Data-Agent** directory:

**Option A — Backend only (no .env required for health):**

In one terminal, start the server (it will keep running and won’t give the prompt back):

```bash
npm run start
```

In a **second terminal** (new tab or window), from the **Data-Agent** directory, run:

```bash
curl -s http://localhost:3000/health
```

**Expected:** `{"ok":true}`. The first terminal will only show the server log (`Data-Agent backend listening on http://localhost:3000`); it stays occupied by the server, so always run `curl` and other commands in the second terminal.

**Option B — Backend + frontend dev servers:**

```bash
npm run dev
```

Open **http://localhost:5173** in a browser.

**Expected:** The Data-Agent page loads; the “Backend: Connected” (green) or “Disconnected” (red) line reflects whether the backend at port 3000 is reachable. For Stage 1 you only need to confirm the UI loads and, if the backend is running, that it shows “Connected.”

### 4. Confirm P&P Financial Metrics is ignored

From the **Data-Agent** directory (or any directory inside the repo):

```bash
git status
```

**Expected:** The `P&P Financial Metrics` folder (if present) does **not** appear as an untracked or modified path. If it was ever committed, remove it from the index with `git rm -r --cached "P&P Financial Metrics"` and ensure `.gitignore` contains `P&P Financial Metrics/`.

**Stage 1 exit criteria:** (1) `npm run validate:mrrpv-spec` passes, (2) the app starts and `/health` returns `{"ok":true}`, (3) the minimal UI loads at http://localhost:5173 (with `npm run dev`) or http://localhost:3000 (with `npm run build && npm run start`).

---

## Testing Stage 2 (Databricks + MRRpV API)

Stage 2 adds the Databricks client and MRRpV query API. You need a valid `.env` with `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, and `DATABRICKS_WAREHOUSE_HTTP_PATH`.

From the **Data-Agent** directory, with the server running in another terminal (`npm run start`):

**GET (query params):**
```bash
curl -s "http://localhost:3000/api/query/mrrpv?timeWindow=FY27%20Q1&groupBy=geo"
```

**POST (JSON body):**
```bash
curl -s -X POST http://localhost:3000/api/query/mrrpv \
  -H "Content-Type: application/json" \
  -d '{"timeWindow":"FY27 Q1","groupBy":"segment","filters":{"region":"US"}}'
```

**Expected:** JSON with `columns`, `rows`, and `data` (array of objects). If Databricks config is missing you get a 500 with a clear error; if the query fails (e.g. invalid table or permissions) the error message is in the response.

**"Databricks config missing" error:** Ensure `.env` in the **Data-Agent** directory has all three set (no quotes needed, no spaces around `=`):

- `DATABRICKS_HOST=https://samsara-biztech-us-west-2.cloud.databricks.com`
- `DATABRICKS_TOKEN=<your-token>`
- `DATABRICKS_WAREHOUSE_HTTP_PATH=/sql/1.0/warehouses/<your-warehouse-id>`

Then **restart the server** (stop with Ctrl+C in the terminal where it’s running, then `npm run start` again). The server loads `.env` only at startup.

---

For chat and Databricks queries you must set secrets (see below). For Stage 1 testing, the steps above are enough.

1. **Copy env and set secrets**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set:
   - `OPENAI_API_KEY` — required for the agent
   - `DATABRICKS_HOST` — e.g. `https://samsara-biztech-us-west-2.cloud.databricks.com`
   - `DATABRICKS_TOKEN` — your Databricks personal access token
   - `DATABRICKS_WAREHOUSE_HTTP_PATH` — e.g. `/sql/1.0/warehouses/<your-warehouse-id>`

2. **Install and run**
   ```bash
   npm install
   cd backend && npm install && cd ..
   cd frontend && npm install && cd ..
   npm run dev
   ```
   This starts the backend on port 3000 and the frontend dev server on 5173. Open **http://localhost:5173** and use the chat to ask for MRRpV.

   To run backend only (and serve the built frontend):
   ```bash
   npm run build
   npm run start
   ```
   Then open http://localhost:3000 (port is `PORT` or `DATABRICKS_APP_PORT` if set).

## Example prompts

- “What was MRRpV by region last quarter?”
- “Show me MRRpV by industry for FY27 Q1”
- Select **First Purchase MRRpV by Geo-Segment** in the Views dropdown, then in chat: "remove the rows for EMEA" or "remove the row for CML"
- "MRRpV last 2 Qs, AIM4 vs not AIM4" (agent runs two get_mrrpv calls and compares)
- "What were the ASPs for Safety, Telematics, and AIM4 in FY26?" (ASP Investigation); then "only include MM accounts" or "add Maintenance"
- Select **MRRpV Bridge** for contribution breakdown; filter with "only US accounts"

Refine in follow-ups: “Remove passenger transit” (industry view), “Only show NA”, “Only include MM accounts” (on ASP view), or “Narrow to enterprise segment.”

## Handoff for next agent

- **Read HANDOFF.md first** for current state, key paths, and how to continue.
- Paste **HANDOFF_MESSAGE.txt** (Data-Agent root) into a new chat to give the next agent full context.

## MRRpV spec

The single source of truth for the MRRpV metric is **`docs/MRRpV-spec.md`**. It defines the formula, source table, and denominator. Validate the spec with:

```bash
npm run validate:mrrpv-spec
```

## Admin

- Open **Admin** (link in the app) or go to `#admin` to view/edit model behavior (system prompt, model id, temperature, max tokens), view usage (recent requests, top tools, error rate), and **User feedback** (thumbs up/down and optional comments on agent responses).
- If you set `ADMIN_SECRET` in `.env`, include it in the Admin page when prompted (or send header `X-Admin-Secret`).

## Troubleshooting

**Chat fails with "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" or SSL certificate error**  
Node cannot verify OpenAI’s TLS certificate. This often happens on corporate networks (proxy/firewall doing SSL inspection). Your API key is fine; `curl` may work because it uses a different cert store.

- **Local dev only (insecure):** Run with certificate verification disabled:
  ```bash
  npm run dev:insecure
  ```
  Or: `NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev`. Do not use this in production.

- **Better (use your org’s CA bundle):** Export your corporate/intermediate CA cert(s) to a `.pem` file, then:
  ```bash
  export NODE_EXTRA_CA_CERTS=/path/to/your-ca-bundle.pem
  npm run dev
  ```
  Your IT or security team can provide the right CA bundle.

## Repo and GitHub

The **P&P Financial Metrics** folder (Tableau workbooks) must **never** be committed or pushed to GitHub. It is listed in `.gitignore`. Keep that folder local only.

## Handoff for next agent

- **Read HANDOFF.md first** for current state, key paths, and how to continue.
- Copy the contents of **HANDOFF_MESSAGE.txt** (in Data-Agent root) into a new chat to give the next agent full context.
- Implementation state: preset views (including Bridge and ASP Investigation), GET /api/views, POST /api/views/run-default (restore unfiltered), user feedback (thumbs + comment), Admin feedback list, geo-segment/industry/bridge/ASP table layouts, current-view context, and row/segment/geo filters are in place. See HANDOFF.md for details.

## Preset views and table layout

- **Views dropdown:** Lists presets from GET /api/views (registry: `backend/src/views/first-purchase-views.js`). Presets: **First Purchase MRRpV** (overall by quarter), **by Industry**, **by Geo-Segment**, **MRRpV Bridge**, **ASP Investigation**. Default time window for all: last 4 quarters (e.g. FY26 Q2–FY27 Q1).
- **Table layout:** Overall-by-quarter uses time as columns and metrics as rows (with Grand Total). Geo-segment and industry use **grouped pivot**: metric groups (MRRpV, ACV; optionally Vehicles/Deal count via toggles) with quarter sub-columns, borders between metric groups, **Avg MRRpV** (weighted) on the right. Geo-segment: NA/EMEA as **merged cells** (rowSpan), segment rows beneath; geo mapping: US, CA, MX, US-SLED, US - SLED → NA; UK, DACH, FR, BNL → EMEA. **MRRpV Bridge:** one row per metric (vehicles, ACV, MRRpV, VG/CM ASP, attach rates, contributions), quarters as columns, Grand Total column. **ASP Investigation:** Product column (merged cells per product), Metric column (ASP / ACV), quarter columns; ACV formatted as $X.XXXM.
- **Restore unfiltered:** Each preset table has a "Restore unfiltered view" button; it calls POST /api/views/run-default with the selected preset and displays the default unfiltered table without using the LLM.
- **Modifying the view via chat:** Frontend sends **currentView** (preset label + time_window, group_by, products, regions, segments, etc.) with each message. Agent re-runs the same view with overrides when the user asks to filter (exclude_regions, segments for "only MM accounts", regions for "only US", include_product for "deals with safety and telematics"; adding a product on ASP view merges with current products). Include/restore: remove values from exclude_* lists; omit param if empty.

**Agent and prompt design:** When adding or changing agent rules or tool descriptions, craft **broadly applicable** rules that cover whole classes of behavior (e.g. "when the user asks to include or restore previously excluded rows, remove those values from the corresponding exclude_* list") rather than narrow, use-case-specific rules (e.g. a rule that only handles "public sector"). General rules scale; one-off rules multiply and become hard to maintain. See HANDOFF.md for the same principle.

## Future: Databricks App

This app is designed to be packaged later as a **Databricks App**:

- The server already reads **port** from `process.env.DATABRICKS_APP_PORT || process.env.PORT`.
- **Secrets** (OpenAI API key, Databricks token) are read from env only — no secrets in repo. In Databricks you would store them in a secret scope and attach to the app via `app.yaml` (e.g. `valueFrom: secret`).
- Bundle layout: one Node server that serves the API and static frontend (`frontend/dist`), plus `app.yaml` with `command: ['npm', 'run', 'start']` and env entries for port and secrets. See existing Databricks App plans in `.cursor/plans/` for the same pattern.

No implementation is done in this repo for deployment; the above ensures the codebase is ready for a later packaging step.
