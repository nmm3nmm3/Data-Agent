# Data-Agent

AI-assisted business metrics app. Users ask for metrics in plain language; the app uses OpenAI to interpret intent and invoke the correct query functions against Databricks. **All calculations run in Databricks** — the model does not perform math, only routes to tools.

Initial use case: **Monthly Recurring Revenue per Vehicle (MRRpV)**. The app queries `businessdbs.epofinance_prod.mrrpv_fleet` (and supports grouping by segment/geo and filters).

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
- “Show me MRRpV by segment for FY27 Q1”
- “MRRpV for US only”

Refine in follow-ups: “Narrow to enterprise segment” or “By geo instead.”

## MRRpV spec

The single source of truth for the MRRpV metric is **`docs/MRRpV-spec.md`**. It defines the formula, source table, and denominator. Validate the spec with:

```bash
npm run validate:mrrpv-spec
```

## Admin

- Open **Admin** (link in the app) or go to `#admin` to view/edit model behavior (system prompt, model id, temperature, max tokens) and view usage (recent requests, top tools, error rate).
- If you set `ADMIN_SECRET` in `.env`, include it in the Admin page when prompted (or send header `X-Admin-Secret`).

## Troubleshooting

**Chat fails with "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" or SSL certificate error**  
Node cannot verify OpenAI’s TLS certificate. This often happens on corporate networks (proxy/firewall doing SSL inspection). Your API key is fine; `curl` may work because it uses a different cert store.

- **Local dev only (insecure):** Run with certificate verification disabled:
  ```bash
  NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev
  ```
  Do not use this in production.

- **Better (use your org’s CA bundle):** Export your corporate/intermediate CA cert(s) to a `.pem` file, then:
  ```bash
  export NODE_EXTRA_CA_CERTS=/path/to/your-ca-bundle.pem
  npm run dev
  ```
  Your IT or security team can provide the right CA bundle.

## Repo and GitHub

The **P&P Financial Metrics** folder (Tableau workbooks) must **never** be committed or pushed to GitHub. It is listed in `.gitignore`. Keep that folder local only.

## Future: Databricks App

This app is designed to be packaged later as a **Databricks App**:

- The server already reads **port** from `process.env.DATABRICKS_APP_PORT || process.env.PORT`.
- **Secrets** (OpenAI API key, Databricks token) are read from env only — no secrets in repo. In Databricks you would store them in a secret scope and attach to the app via `app.yaml` (e.g. `valueFrom: secret`).
- Bundle layout: one Node server that serves the API and static frontend (`frontend/dist`), plus `app.yaml` with `command: ['npm', 'run', 'start']` and env entries for port and secrets. See existing Databricks App plans in `.cursor/plans/` for the same pattern.

No implementation is done in this repo for deployment; the above ensures the codebase is ready for a later packaging step.
