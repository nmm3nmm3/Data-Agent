# Data-Agent handoff

## Plan reference

**Canonical plans:**  
- **Staged app plan:** `.cursor/plans/data-agent_mrrpv_app_68c63d27.plan.md` — Data-Agent app (Databricks + OpenAI, admin, usage; MRRpV use case).  
- **Preset views plan:** `.cursor/plans/first-purchase_preset_views_713314d5.plan.md` — Presets as **modifiable templates**: agent uses them as starting points, applies overrides (time range, product filter, group_by, region), and can run **comparisons** (e.g. "MRRpV last 2 Qs, AIM4 vs not AIM4" via two get_mrrpv calls). Implement view registry with overridable params, GET /api/views, frontend Views dropdown, and agent preset+overrides+comparison behavior.

---

## Target hosting: Databricks App

**This application will ultimately be hosted as a Databricks App.** All work and changes (config, env, build, deployment, URLs, auth, etc.) should be done with that target in mind. Prefer patterns and choices that work both locally and when running inside Databricks (e.g. `DATABRICKS_APP_PORT` is already used; avoid hardcoded localhost where the app might be served from Databricks).

---

## Current state (Stages 1–7 + enhancements)

All stages through 7 are implemented. The app runs locally; Databricks and OpenAI work when `.env` is set correctly.

**Three data sources:** User selects via toggle (order: **First purchases**, **Upsell**, **Fleet overall**; default **First purchases**). Tables: `businessdbs.epofinance_prod.mrrpv_first_purchase`, `mrrpv_upsell`, `mrrpv_fleet`. Per-source config in `backend/src/queries/mrrpv.js` → **SOURCE_CONFIG** (table, timeCol, arrCol/acvCol, accountIdCol, groupBySqlColumn, annual). **First-purchase** MRRpV is **not** divided by 12 (already monthly); fleet and upsell use annual/12.

**Query layer (`mrrpv.js`):** `getMRRpV({ dataSource, timeWindow?, groupBy?, filters, includeProduct?, includeAccountCount?, includeAvgDealSize? })`. **time_window** optional: one quarter ("FY26 Q4") or **comma-separated quarters** ("FY25 Q3,FY26 Q3,FY27 Q3") for multi-quarter views (e.g. "MRRpV by industry for the last three Q3s"); omit = all data. **group_by** optional (omit = overall). **include_product**, **includeAccountCount** / **includeAvgDealSize** as before. Result includes **overall** summary when applicable; multi-quarter returns one row per (group, quarter).

**Agent behavior:** `backend/src/agent/loop.js` prepends **MRRPV_RULES**: never ask for grouping; omit group_by for overall; omit time_window for all data; always state overall in reply; set include_account_count / include_avg_deal_size when user asks for deal count or average deal size.

**Schema / plain-English mapping:** `docs/mrrpv-schema-mapping.md` — data sources, grouping columns, value columns, **term definitions** (ACV, Count, ARR, MRRpV; product names e.g. CM=Safety, ST=Smart trailers, CW=Worker safety, CT=Connected Training, CC=Camera Connector), **product column table** (Telematics→VG, AI Multicam→aim4, etc.), and “deals that included [product]” (license count > 0). **Backend mirror:** `backend/src/queries/column-glossary.js` (PLAIN_ENGLISH_TO_PREFIX, resolveProductArea, METRIC_TERMS).

**Entry point:** `backend/src/run.js` (loads `.env` from Data-Agent root). **Databricks:** `backend/src/databricks/client.js` — wait_timeout as duration string; flat result arrays reshaped by column count. **OpenAI:** `OPENAI_API_KEY` in root `.env`; SSL issues → `NODE_TLS_REJECT_UNAUTHORIZED=0` for local dev (README).

**Frontend:** Data source toggle; **Views dropdown** (presets from /api/views; error + Retry); chat with **currentView** sent (preset label + querySummary); result table: **time-as-columns** pivot (overall) or **grouped pivot** (geo-segment, industry) with NA/EMEA merged cells, metric-group borders, Avg MRRpV column, toggles "Show Vehicles" / "Show Deal count"; ACV as $X.XXXM; **Overall** row/summary when applicable; **SimpleBarChart** (up to 20 rows); refinement via conversationId; **transparency** "This query used" including regions, exclude_regions, segments, exclude_segments, industries, exclude_industries when present. formatCell: $ and locale for counts.

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
| Query API         | `backend/src/routes/query.js` (POST/GET /api/query/mrrpv; dataSource, filters: regions, excludeRegions, segments, excludeSegments, industries, excludeIndustries) |
| Views API         | `backend/src/routes/views.js` (GET /api/views), `backend/src/views/first-purchase-views.js` |
| Agent + chat      | `backend/src/agent/loop.js` (MRRPV_RULES, buildCurrentViewPrompt), `backend/src/agent/tools.js` (get_mrrpv: regions, exclude_regions, segments, exclude_segments, industries, exclude_industries), `backend/src/routes/chat.js` (accepts currentView, passes to runAgent) |
| Admin             | `backend/src/routes/admin.js`, `backend/src/storage/config.js`, `backend/src/storage/usage.js` |
| Frontend          | `frontend/src/App.jsx` (data source toggle, chat, table + Overall row/summary) |
| Schema mapping    | `docs/mrrpv-schema-mapping.md` |
| MRRpV spec        | `docs/MRRpV-spec.md` |
| Env check         | `scripts/check-env.js` (node scripts/check-env.js from Data-Agent root) |
| Plan (staged app) | `.cursor/plans/data-agent_mrrpv_app_68c63d27.plan.md` |
| Plan (preset views) | `.cursor/plans/first-purchase_preset_views_713314d5.plan.md` |

---

## Preset views and current-view context (implemented)

- **View registry:** `backend/src/views/first-purchase-views.js` — `getViews()` returns presets: **First Purchase MRRpV** (overall by quarter), **by Industry**, **by Geo-Segment**. Default time window: last 4 quarters (overridable).
- **GET /api/views:** `backend/src/routes/views.js`; mounted in `backend/src/index.js`. Frontend fetches on load; dropdown shows preset labels; on select, runs query with preset params. Error state + Retry if fetch fails.
- **Table layout:**  
  - **Overall-by-quarter:** Time as columns, metrics as rows, Grand Total row.  
  - **Geo-segment / Industry (grouped pivot):** Metric groups (MRRpV, ACV; optionally Vehicles, Deal count via toggles) with quarter sub-columns; 2px borders between metric groups; **Avg MRRpV** (vehicle-weighted) column on the right. Geo-segment: **NA/EMEA** as merged cells (no separate geo row); segment rows under each geo; borders around NA/EMEA blocks. Totals only in rows (no Total column).  
  - **Geo mapping:** US, CA, MX, US-SLED, US - SLED → NA; UK, DACH, FR, BNL → EMEA (raw geo from backend `groupBy: 'geo_segment'`).
- **Backend filters:** `backend/src/queries/mrrpv.js` — `filters`: `regions`, `excludeRegions`, `segments`, `excludeSegments`, `industries`, `excludeIndustries` (industry only for first_purchase/upsell). Used for row add/drop (e.g. "remove EMEA", "remove CML").
- **Current view context:** Frontend sends **currentView** with each chat message: `{ label, time_window, group_by, querySummary }` (querySummary includes regions, exclude_regions, segments, exclude_segments, industries, exclude_industries). `backend/src/routes/chat.js` passes `currentView` to `runAgent`. Agent (`backend/src/agent/loop.js`) gets **buildCurrentViewPrompt(currentView)** in system prompt; instructed to re-run the same preset with overrides when user asks to remove or show only rows, or to include/restore previously excluded rows (remove values from exclude_* list; omit param if empty). Use exact dimension values and schema mapping for plain-English.
- **Agent tools:** `backend/src/agent/tools.js` — get_mrrpv params include `regions`, `exclude_regions`, `segments`, `exclude_segments`, `industries`, `exclude_industries`. Preset list and overridable params in prompt. For comparisons (e.g. "AIM4 vs not AIM4") agent runs two get_mrrpv calls.
- **Display:** "This query used" shows the new filter fields when present.

---

## Agent and prompt design (critical)

**Craft broadly applicable rules, not narrow use-case rules.** When adding or changing agent prompts, tool descriptions, or current-view instructions, write rules that cover whole classes of behavior (e.g. "when the user asks to include or restore previously excluded rows, remove those values from the corresponding exclude_regions / exclude_segments / exclude_industries; if a list would be empty, omit that parameter") rather than rules that only solve a single reported case (e.g. "when the user says 'restore public sector', omit US-SLED from exclude_regions"). General rules scale and stay maintainable; one-off rules multiply and create inconsistency. Use the schema mapping (`docs/mrrpv-schema-mapping.md`) for plain-English → table values (EMEA, public sector, segments, etc.) so the agent can interpret any "remove X" / "include X again" in a consistent way.

---

## Open items / constraints

- **Industry column:** If "by industry" fails, update the per-source `groupBySqlColumn.industry` in `SOURCE_CONFIG` in `backend/src/queries/mrrpv.js` (fleet has no industry; first_purchase and upsell do).
- **Constraints:** Calculations in Databricks only; do not commit **P&P Financial Metrics**; work in **Data-Agent** folder only. **Target hosting is Databricks App** — keep config and code compatible with that.

---

## How to continue work

Stages 1–7 are **already implemented**. Use the plan as the single source of truth for scope and exit criteria.

1. **Read the plan**  
   `.cursor/plans/data-agent_mrrpv_app_68c63d27.plan.md` (path may be `~/.cursor/plans/` or workspace `.cursor/plans/`). Do not edit the plan unless the user asks.

2. **Current continuation options**  
   - **Preset views:** Phase 1 is implemented (registry, GET /api/views, Views dropdown, geo-segment/industry pivots, currentView, row add/drop filters). Further work per `.cursor/plans/first-purchase_preset_views_713314d5.plan.md` if needed.  
   - **Testing:** Ask → see result → refine ("remove EMEA", "remove CML") → see updated result; edge cases (empty, single row, many rows; chart 20, table 100).  
   - **Open items:** e.g. industry column in SOURCE_CONFIG if “by industry” fails.  
   - **Databricks App:** New work should assume hosting as a **Databricks App** (env, URLs, auth, build).

3. **Constraints**  
   - All calculations stay in Databricks; the model only invokes tools.  
   - Do not commit the **P&P Financial Metrics** folder; it must remain in `.gitignore`.  
   - Work only in the **Data-Agent** folder (repo root = Data-Agent).

---

## Copy-paste handoff message for next agent

**When context is almost full:** Paste the contents of `HANDOFF_MESSAGE.txt` (in Data-Agent root) into a new chat so the next agent can continue. That file has the same message as the block below, in plain text.

You can paste the following into a new chat so the next agent has full context (or use HANDOFF_MESSAGE.txt):

```
I'm continuing work on the Data-Agent app. Full handoff is in Data-Agent/HANDOFF.md — read that file first.

**Summary:** Data-Agent is an AI-assisted MRRpV app; target hosting is Databricks App. Three data sources (first_purchase, upsell, fleet); default First purchases. Preset views: First Purchase MRRpV (overall), by Industry, by Geo-Segment; Views dropdown from GET /api/views (registry: backend/src/views/first-purchase-views.js); default 4 quarters. Table: time-as-columns for overall; grouped pivot for geo-segment/industry with NA/EMEA merged cells, metric borders, Avg MRRpV column, optional Vehicles/Deal count toggles. Backend filters: regions, excludeRegions, segments, excludeSegments, industries, excludeIndustries (mrrpv.js). Frontend sends currentView (preset + querySummary) with chat; agent gets buildCurrentViewPrompt and re-runs with exclude_regions/exclude_segments/exclude_industries (or include arrays) when user says "remove EMEA", "remove CML", etc. Agent tools: get_mrrpv with those filter params; comparisons = two get_mrrpv calls. Run: npm run dev from Data-Agent root; .env in root. See HANDOFF.md for paths and "How to continue work."
```
