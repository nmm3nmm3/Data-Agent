# Data-Agent handoff

## Plan reference

**Canonical plan:** `.cursor/plans/data-agent_mrrpv_app_68c63d27.plan.md` (in your home `.cursor/plans/` or workspace).  
Full staged plan: Data-Agent app that queries Databricks business tables, uses OpenAI to interpret user intent and invoke query functions (no AI calculations), admin console, usage tracking; local first, then Databricks App. First use case: **MRRpV** (Monthly Recurring Revenue per Vehicle).

---

## Current state (Stages 1–7 + enhancements)

All stages through 7 are implemented. The app runs locally; Databricks and OpenAI work when `.env` is set correctly.

**Three data sources:** User selects via toggle (order: **First purchases**, **Upsell**, **Fleet overall**; default **First purchases**). Tables: `businessdbs.epofinance_prod.mrrpv_first_purchase`, `mrrpv_upsell`, `mrrpv_fleet`. Per-source config in `backend/src/queries/mrrpv.js` → **SOURCE_CONFIG** (table, timeCol, arrCol/acvCol, accountIdCol, groupBySqlColumn, annual). **First-purchase** MRRpV is **not** divided by 12 (already monthly); fleet and upsell use annual/12.

**Query layer (`mrrpv.js`):** `getMRRpV({ dataSource, timeWindow?, groupBy?, filters, includeProduct?, includeAccountCount?, includeAvgDealSize? })`. **time_window** optional (omit = all data). **group_by** optional (omit = overall MRRpV). **include_product**: filter to rows where product license count > 0 (e.g. aim4 for AI Multicam); see **PRODUCT_COUNT_COLUMNS**. **includeAccountCount** / **includeAvgDealSize** add columns `account_count` (COUNT DISTINCT account_id) and `avg_deal_size` (ACV per account). Result includes **overall** summary object (fleet_mrrpv, vehicle_count, acv, account_count?, avg_deal_size?) for the assistant and UI.

**Agent behavior:** `backend/src/agent/loop.js` prepends **MRRPV_RULES**: never ask for grouping; omit group_by for overall; omit time_window for all data; always state overall in reply; set include_account_count / include_avg_deal_size when user asks for deal count or average deal size.

**Schema / plain-English mapping:** `docs/mrrpv-schema-mapping.md` — data sources, grouping columns, value columns, **term definitions** (ACV, Count, ARR, MRRpV; product names e.g. CM=Safety, ST=Smart trailers, CW=Worker safety, CT=Connected Training, CC=Camera Connector), **product column table** (Telematics→VG, AI Multicam→aim4, etc.), and “deals that included [product]” (license count > 0). **Backend mirror:** `backend/src/queries/column-glossary.js` (PLAIN_ENGLISH_TO_PREFIX, resolveProductArea, METRIC_TERMS).

**Entry point:** `backend/src/run.js` (loads `.env` from Data-Agent root). **Databricks:** `backend/src/databricks/client.js` — wait_timeout as duration string; flat result arrays reshaped by column count. **OpenAI:** `OPENAI_API_KEY` in root `.env`; SSL issues → `NODE_TLS_REJECT_UNAUTHORIZED=0` for local dev (README).

**Frontend:** Data source toggle; chat; result table with ACV, optional account_count/avg_deal_size; **Overall** row when multiple grouped rows; **Overall** summary line above table from `lastResult.overall`. formatCell: fleet_mrrpv/acv/avg_deal_size as $; vehicle_count/account_count locale.

**Env:** DATABRICKS_WAREHOUSE_HTTP_PATH = full path; token and host same workspace; restart after .env changes.

---

## Stage 1 work completed (reference)

### 1.1 Project scaffold

- **Root:** `package.json` (scripts: `dev`, `dev:backend`, `dev:frontend`, `build`, `start`, `validate:mrrpv-spec`), `type: "module"`, `.env.example`, `.gitignore`.
- **Backend:** `backend/package.json` (express, cors, dotenv; openai not required at startup), `backend/src/index.js` — Express server, `/health`, serves `frontend/dist` when built; port from `DATABRICKS_APP_PORT || PORT || 3000`. Punycode deprecation warning suppressed. **OpenAI client is lazy-initialized** so the server starts without `OPENAI_API_KEY`; key only required when a chat request is made.
- **Frontend:** `frontend/` — Vite + React; `frontend/src/App.jsx` minimal UI with health check; Vite proxy for `/api` and `/health` to backend (port 3000).
- **.gitignore:** `P&P Financial Metrics/` (and variants), `node_modules/`, `.env`, `dist/`, `data/*.db`, etc. **Do not commit the P&P Financial Metrics folder.**

### 1.2 MRRpV spec and validation

- **Spec:** `docs/MRRpV-spec.md` — Definition (business terms), Source (tables: `businessdbs.epofinance_prod.mrrpv_fleet`), Denominator (vehicle definition), Validation note, Changelog.
- **Validation script:** `scripts/validate-mrrpv-spec.js` — Checks that the spec file exists and contains the three required sections. Run from repo root: `npm run validate:mrrpv-spec` (expected: `OK: MRRpV spec exists and has Definition, Source, Denominator.`).

### 1.3 Running and testing Stage 1

- **Directory for all npm commands:** Data-Agent **project root** (folder containing `package.json`, `backend/`, `frontend/`).
- **Start server:** `npm run start` (one terminal; server keeps running).
- **Health check:** In a **second terminal**, `curl -s http://localhost:3000/health` → expect `{"ok":true}`.
- **Dev (backend + frontend):** `npm run dev` → backend on 3000, frontend on 5173; open http://localhost:5173.
- **README** includes a “Testing Stage 1 (foundation)” section with step-by-step instructions and the note about using a second terminal for `curl`/other commands.

---

## Key paths

| Purpose           | Path |
|-------------------|------|
| Server entry      | `backend/src/run.js` (loads .env then imports index.js) |
| Backend app       | `backend/src/index.js` |
| Databricks client | `backend/src/databricks/client.js` |
| MRRpV query       | `backend/src/queries/mrrpv.js` (SOURCE_CONFIG, PRODUCT_COUNT_COLUMNS, overall) |
| Column glossary   | `backend/src/queries/column-glossary.js` (plain-English → prefix, resolveProductArea) |
| Query API         | `backend/src/routes/query.js` (POST/GET /api/query/mrrpv; dataSource, includeProduct, includeAccountCount, includeAvgDealSize) |
| Agent + chat      | `backend/src/agent/loop.js` (MRRPV_RULES prepended), `backend/src/agent/tools.js`, `backend/src/routes/chat.js` |
| Admin             | `backend/src/routes/admin.js`, `backend/src/storage/config.js`, `backend/src/storage/usage.js` |
| Frontend          | `frontend/src/App.jsx` (data source toggle, chat, table + Overall row/summary) |
| Schema mapping    | `docs/mrrpv-schema-mapping.md` |
| MRRpV spec        | `docs/MRRpV-spec.md` |
| Env check         | `scripts/check-env.js` (node scripts/check-env.js from Data-Agent root) |
| Plan              | `.cursor/plans/data-agent_mrrpv_app_68c63d27.plan.md` |

---

## Open items / constraints

- **Industry column:** If "by industry" fails, update the per-source `groupBySqlColumn.industry` in `SOURCE_CONFIG` in `backend/src/queries/mrrpv.js` (fleet has no industry; first_purchase and upsell do).
- **Constraints:** Calculations in Databricks only; do not commit **P&P Financial Metrics**; work in **Data-Agent** folder only.

---
**Legacy (Stages 2–7 done):** Stage 1 is complete. The next work is **Stage 2** (Databricks connectivity and MRRpV query layer), then Stages 3–7 per the plan. Use the plan file above as the single source of truth for scope and exit criteria.

**What to do:**

1. **Open the plan**  
   Read `.cursor/plans/data-agent_mrrpv_app_68c63d27.plan.md` (full path may be `~/.cursor/plans/` or workspace `.cursor/plans/`). Do not edit the plan file unless the user asks.

2. **Implement Stage 2**  
   - **2.1** Databricks SQL client in the backend (REST Statement Execution API or official SDK). Env: `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_WAREHOUSE_HTTP_PATH` (e.g. from Tableau: `samsara-biztech-us-west-2.cloud.databricks.com`, `/sql/1.0/warehouses/...`).  
   - **2.2** MRRpV query function: `getMRRpV({ timeWindow, groupBy?, filters? })` that builds SQL per `docs/MRRpV-spec.md` (table `businessdbs.epofinance_prod.mrrpv_fleet`; columns include `close_quarter`, `fiscal_quarter_start`, `segment`, `geo`, `fleet_mrrpv`, `vehicle_count`, `fleet_arr` — see Tableau workbook in `P&P Financial Metrics` if needed; that folder is gitignored). Execute via Databricks client; return structured data (e.g. columns + rows).  
   - **2.3** Expose `POST /api/query/mrrpv` and/or `GET /api/query/mrrpv` with the same parameters and response shape.

   **Exit criteria (Stage 2):** A direct API call (e.g. `curl` or UI) with a time window returns MRRpV data consistent with the spec.

3. **Then Stages 3–7**  
   Follow the plan in order: Stage 3 (OpenAI agent + tools + `/api/chat`), Stage 4 (frontend result display and refinement), Stage 5 (admin console: config, usage, dashboard), Stage 6 (logging and guardrails), Stage 7 (README/local run and “Future: Databricks App” notes).

**Constraints:**  
- All calculations stay in Databricks; the model only invokes tools.  
- Do not commit or push the **P&P Financial Metrics** folder; it must remain in `.gitignore`.  
- Work only in the **Data-Agent** folder (repo root = Data-Agent).

---

## Copy-paste handoff message for next agent

**When context is almost full:** Paste the contents of `HANDOFF_MESSAGE.txt` (in Data-Agent root) into a new chat so the next agent can continue. That file has the same message as the block below, in plain text.

You can paste the following into a new chat so the next agent has full context (or use HANDOFF_MESSAGE.txt):

```
I'm continuing work on the Data-Agent app. Full handoff is in Data-Agent/HANDOFF.md — read that file first.

**Summary:** Data-Agent is an AI-assisted MRRpV app. Three data sources (first_purchase, upsell, fleet); toggle order First purchases, Upsell, Fleet overall; default First purchases. First-purchase MRRpV not divided by 12. getMRRpV: time_window optional (omit = all data), group_by optional (omit = overall), include_product (deals with product license count > 0), includeAccountCount/includeAvgDealSize for account_count and avg_deal_size; result includes overall summary. Agent: MRRPV_RULES prepended (never ask for grouping; always state overall). Schema mapping: docs/mrrpv-schema-mapping.md; glossary: backend/src/queries/column-glossary.js. Run: npm run dev from Data-Agent root; .env in root; SSL: NODE_TLS_REJECT_UNAUTHORIZED=0 for local. See HANDOFF.md for paths and open items.
```
