# Data-Agent handoff

## Plan reference

**Canonical plans:**  
- **Staged app plan:** `.cursor/plans/data-agent_mrrpv_app_68c63d27.plan.md` — Data-Agent app (Databricks + OpenAI, admin, usage; MRRpV use case).  
- **Preset views plan:** `.cursor/plans/first-purchase_preset_views_713314d5.plan.md` — Presets as **modifiable templates**: agent uses them as starting points, applies overrides (time range, product filter, group_by, region), and can run **comparisons** (e.g. "MRRpV last 2 Qs, AIM4 vs not AIM4" via two get_mrrpv calls). Implement view registry with overridable params, GET /api/views, frontend Views dropdown, and agent preset+overrides+comparison behavior.  
- **MRRpV Bridge plan:** `docs/plans/show-trend-line-chart.plan.md` (trend chart); bridge preset per `.cursor/plans/vg_cm_bridge_preset_view_127fb100.plan.md` — VG/CM ASP to First Purchase MRRpV Bridge (overall by quarter with ASP, attach, contributions); bridge query in `mrrpv.js`, preset in `first-purchase-views.js`, frontend bridge table + bold Grand Total.

---

## Target hosting: Databricks App

**This application will ultimately be hosted as a Databricks App.** All work and changes (config, env, build, deployment, URLs, auth, etc.) should be done with that target in mind. Prefer patterns and choices that work both locally and when running inside Databricks (e.g. `DATABRICKS_APP_PORT` is already used; avoid hardcoded localhost where the app might be served from Databricks).

---

## Current state (Stages 1–7 + enhancements)

All stages through 7 are implemented. The app runs locally; Databricks and OpenAI work when `.env` is set correctly.

**Three data sources:** User selects via toggle (order: **First purchases**, **Upsell**, **Fleet overall**; default **First purchases**). Tables: `businessdbs.epofinance_prod.mrrpv_first_purchase`, `mrrpv_upsell`, `mrrpv_fleet`. Per-source config in `backend/src/queries/mrrpv.js` → **SOURCE_CONFIG** (table, timeCol, arrCol/acvCol, accountIdCol, groupBySqlColumn, annual). **First-purchase** MRRpV is **not** divided by 12 (already monthly); fleet and upsell use annual/12.

**Query layer (`mrrpv.js`):** `getMRRpV({ dataSource, timeWindow?, groupBy?, filters, includeProduct?, includeAccountCount?, includeAvgDealSize? })`. **time_window** optional: one quarter or comma-separated quarters; omit = all data. **group_by** optional (omit = overall). **include_product** can be array (AND of products, e.g. ["cm","vg"] for safety and telematics). **getBridgeMRRpV** for bridge preset (ASP, attach, contributions by quarter). **getASPInvestigation({ timeWindow, products, filters })** for ASP view: ASP and ACV by product (Safety, Telematics, AIM4, Maintenance/cam, etc.) with time as columns; supports segments, regions, industries. Result includes **overall** when applicable.

**Agent behavior:** `backend/src/agent/loop.js` prepends **buildDimensionResolutionRule()** and **MRRPV_RULES**: resolve "remove X" / "include X again" to exact table values; **never switch view type or preset when user only asks to filter**. For **bridge** pass view_type "bridge", preset_id "first-purchase-bridge" with filters. For **ASP Investigation** pass view_type "asp", preset_id "asp-investigation" with time_window, **products** (e.g. ["cm","vg","aim4"]), and filters (regions, segments for "only MM accounts"). When user **adds a product** to current filter (e.g. "also AIM4"), **merge** with current include_product/products (union); do not replace. **include/restore** = remove values from exclude_*; omit param if empty. **view-lock.js**: on ASP view, preserve currentView.regions when applying segment filter; when user says "only include MM accounts" / "only mid-market", set args.segments = ["MM"] if agent omitted it.

**Schema / plain-English mapping:** `docs/mrrpv-schema-mapping.md` — data sources, grouping columns, value columns, **Dimension values** (Segment: MM, ENT - COR, ENT - SEL, ENT - STR, **US - SLED-MM**, **US - SLED-ENT - SEL**; Geo: US - SLED, US-SLED, UK, DACH, FR, BNL; super-regions NA/EMEA), **term definitions** (ACV, Count, ARR, MRRpV; product names e.g. CM=Safety, ST=Smart trailers, CW=Worker safety, CT=Connected Training, CC=Camera Connector), **product column table** (Telematics→VG, AI Multicam→aim4, etc.). Agent must resolve plain-English to these exact table values before setting exclude_regions / exclude_segments / exclude_industries; "deals that included [product]" = license count > 0. “deals that included [product]” (license count > 0). **Backend mirror:** `backend/src/queries/column-glossary.js` (PLAIN_ENGLISH_TO_PREFIX, resolveProductArea, METRIC_TERMS).

**Entry point:** `backend/src/run.js` (loads `.env` from Data-Agent root). **Databricks:** `backend/src/databricks/client.js` — wait_timeout as duration string; flat result arrays reshaped by column count. **OpenAI:** `OPENAI_API_KEY` in root `.env`; SSL issues → `NODE_TLS_REJECT_UNAUTHORIZED=0` for local dev (README).

**Frontend:** Data source toggle; **Views dropdown** (presets from /api/views: overall, industry, geo-segment, **MRRpV Bridge**, **ASP Investigation**); chat with **currentView** (presetId, time_window, group_by, **products**, regions, segments, include_product, etc.). Result table: **time-as-columns** (overall), **grouped pivot** (geo-segment, industry) with NA/EMEA merged cells, **bridge** table (contributions by quarter, Grand Total), **ASP** table (Product column with merged cells, Metric column ASP/ACV, quarter columns; ACV as $X.XXXM). **Restore unfiltered** button calls POST /api/views/run-default (presetId, dataSource), no LLM; shows default table. **Feedback:** thumbs up/down on each assistant message; on click, thank user and ask for optional comment; POST /api/feedback then POST /api/feedback/:id/comment. **Transparency** "This query used" shows tool, time_window, group_by, include_product (array), products (ASP), regions, segments, etc. Preset run sends viewType, presetId, and for ASP **products**; querySummary and currentView include products for ASP.

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
| MRRpV query       | `backend/src/queries/mrrpv.js` (getMRRpV, getBridgeMRRpV, getASPInvestigation; SOURCE_CONFIG, PRODUCT_COUNT_COLUMNS, ASP_PRODUCT_COLUMNS) |
| Column glossary   | `backend/src/queries/column-glossary.js` (plain-English → prefix, resolveProductArea) |
| Query API         | `backend/src/routes/query.js` (POST/GET /api/query/mrrpv; dataSource, filters: regions, excludeRegions, segments, excludeSegments, industries, excludeIndustries) |
| Views API         | `backend/src/routes/views.js` (GET /api/views, POST /api/views/run-default), `backend/src/views/first-purchase-views.js` |
| Feedback API      | `backend/src/routes/feedback.js` (POST /api/feedback, POST /api/feedback/:id/comment), `backend/src/storage/feedback.js` |
| Agent + chat      | `backend/src/agent/loop.js` (MRRPV_RULES, buildCurrentViewPrompt, ASP/bridge prompts), `backend/src/agent/tools.js` (get_mrrpv: view_type, products, regions, segments, etc.), `backend/src/agent/view-lock.js` (preset lock, ASP segments/regions safeguard), `backend/src/agent/include-restore.js` (exclude_* corrections, product filter merge), `backend/src/routes/chat.js` (currentView, querySummary with products) |
| Admin             | `backend/src/routes/admin.js` (config, usage, **GET /api/admin/feedback**), `backend/src/storage/config.js`, `backend/src/storage/usage.js`, `backend/src/storage/feedback.js` |
| Frontend          | `frontend/src/App.jsx` (data source toggle, chat, table + Overall row/summary) |
| Schema mapping    | `docs/mrrpv-schema-mapping.md` |
| MRRpV spec        | `docs/MRRpV-spec.md` |
| Env check         | `scripts/check-env.js` (node scripts/check-env.js from Data-Agent root) |
| Plan (staged app) | `.cursor/plans/data-agent_mrrpv_app_68c63d27.plan.md` |
| Plan (preset views) | `.cursor/plans/first-purchase_preset_views_713314d5.plan.md` |

---

## Preset views and current-view context (implemented)

- **View registry:** `backend/src/views/first-purchase-views.js` — `getViews()` returns five presets: **First Purchase MRRpV** (overall by quarter), **by Industry**, **by Geo-Segment**, **MRRpV Bridge**, **ASP Investigation**. Default time window for all: last 4 quarters (e.g. FY26 Q2–FY27 Q1). **Bridge** has viewType 'bridge', no group_by. **ASP Investigation** has viewType 'asp', default products ['cm','vg','aim4']; overridable timeWindow, products, filters (segment/geo/industry).
- **GET /api/views**, **POST /api/views/run-default:** Run-default runs the selected preset with default params and no filters (restore unfiltered); returns data + querySummary. Frontend "Restore unfiltered view" calls it without LLM.
- **Table layout:**  
  - **Overall-by-quarter:** Time as columns, metrics as rows, Grand Total row.  
  - **Geo-segment / Industry (grouped pivot):** Metric groups (MRRpV, ACV; optionally Vehicles, Deal count) with quarter sub-columns; **Avg MRRpV** (weighted) on the right; NA/EMEA merged cells.  
  - **MRRpV Bridge:** One row per metric (vehicles, ACV, MRRpV, VG/CM ASP, attach, contributions), quarters as columns, Grand Total column.  
  - **ASP Investigation:** Product column (merged cell per product), Metric column (ASP / ACV), quarter columns; ACV as $X.XXXM.  
  - **Geo mapping:** US, CA, MX, US-SLED → NA; UK, DACH, FR, BNL → EMEA.
- **Backend filters:** `mrrpv.js` — filters (regions, excludeRegions, segments, excludeSegments, industries, excludeIndustries) for getMRRpV, getBridgeMRRpV, getASPInvestigation. ASP view applies segment filter for "only MM accounts" (segments: ["MM"]).
- **Current view context:** Frontend sends **currentView** with presetId, time_window, group_by, **products** (ASP), **regions**, segments, include_product, exclude_*, etc. Agent gets **buildCurrentViewPrompt(currentView)**; for ASP view prompt includes current products and instruction that "only include MM accounts" → segments: ["MM"]. **view-lock.js** preserves preset_id, time_window, products (ASP); when user says "only MM accounts" on ASP, injects segments: ["MM"] and preserves currentView.regions. **include-restore.js** applies product filter merge when user "adds" a product (union with current include_product).
- **Agent tools:** get_mrrpv accepts view_type ('bridge'|'asp'), preset_id, **products** (array for ASP), regions, segments, exclude_*, include_product (array for multi-product AND). For ASP, pass segments for "only MM" / "only mid-market"; combine with regions for e.g. US MM only.
- **User feedback:** POST /api/feedback (feedback: up|down, userPrompt, agentResponse) and POST /api/feedback/:id/comment. Stored in `backend/data/feedback.json`. Admin: GET /api/admin/feedback lists all feedback for review.
- **Display:** "This query used" shows tool, time_window, group_by, include_product (array), products (ASP), regions, segments, etc.

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

**Summary:** Data-Agent is an AI-assisted MRRpV app; target hosting is Databricks App. Three data sources (first_purchase, upsell, fleet); default First purchases. Preset views: First Purchase MRRpV (overall), by Industry, by Geo-Segment, **MRRpV Bridge**, **ASP Investigation** (registry: backend/src/views/first-purchase-views.js); default 4 quarters for all. Tables: time-as-columns (overall), grouped pivot (geo-segment/industry), bridge contribution table, ASP table (Product + Metric + quarters). **Restore unfiltered:** POST /api/views/run-default (no LLM). **User feedback:** thumbs up/down + optional comment; POST /api/feedback, POST /api/feedback/:id/comment; Admin has GET /api/admin/feedback. Backend filters: regions, segments, exclude_*, industries (mrrpv.js, bridge, ASP). Frontend sends currentView (presetId, time_window, group_by, products, regions, segments, include_product) with chat. Agent: buildCurrentViewPrompt; never switch view when user only filters; for ASP pass segments: ["MM"] for "only MM accounts", preserve regions; when user adds product merge with current include_product/products (include-restore.js applyProductFilterMerge). view-lock.js: on ASP inject segments ["MM"] when user says "only MM accounts", preserve currentView.regions. Run: npm run dev from Data-Agent root; .env in root. See HANDOFF.md for paths and "How to continue work."
```
