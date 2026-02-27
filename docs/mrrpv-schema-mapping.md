# MRRpV schema mapping (plain-English ↔ table columns)

This document maps **data source** → **table** and **plain-English grouping intent** → **actual column names** so the app builds correct SQL and the agent uses consistent terms. Source schemas: `first_purchase_schema.csv`, `upsell_schema.csv`, `fleet_schema.csv` in the project root.

---

## Data sources and tables

| Data source (UI) | Catalog.Schema.Table | Description |
|------------------|----------------------|-------------|
| **First purchases** | `businessdbs.epofinance_prod.mrrpv_first_purchase` | New vehicle first-purchase MRRpV (deals closed in period). |
| **Upsell** | `businessdbs.epofinance_prod.mrrpv_upsell` | Upsell MRRpV (existing fleet adds in period). |
| **Fleet overall** | `businessdbs.epofinance_prod.mrrpv_fleet` | Fleet-wide MRRpV (all vehicles in period). |

If your table names differ (e.g. `first_purchase_mrrpv`), update `backend/src/queries/mrrpv.js` → `SOURCE_CONFIG`.

---

## Grouping: plain-English → table column (by source)

Use these when the user says “by industry”, “by segment”, “by region/geo”. The **key** is the stable API/agent term; the **value** is the column name in that table.

| Plain-English (API/agent) | First purchase column | Upsell column | Fleet column |
|---------------------------|------------------------|---------------|--------------|
| **industry** | `industry` | `industry` | *(not in fleet table; use first_purchase or upsell for by-industry)* |
| **segment** | `segment` | `segment` | `segment` |
| **geo** | `geo` | `geo` | `geo` |

- **First purchase & upsell:** group by industry, segment, or geo.
- **Fleet:** group by segment or geo only (fleet table has no industry column).

---

## Dimension values: plain-English ↔ table values (segment & geo)

When the user says a segment or geo in plain English (e.g. "Mid-Market", "United States"), map to the **exact value** stored in the table for filters and display. **All mappings in this section (segment, geo, and super-regions) are case-insensitive** — e.g. "mid market", "Mid Market", and "MM" all map to segment `MM`; "north america" or "North America" map to NA.

Use these when interpreting "exclude MM", "remove EMEA", "NA only", filters, or row labels. The **Table value** is what appears in the `segment` or `geo` column (or the UI super-region label); the **User may say** column lists accepted plain-English terms that map to it.

### Segment (table column: `segment`)

| Table value | User may say (any capitalization) |
|-------------|-----------------------------------|
| **MM** | Mid-Market, Mid Market |
| **ENT - COR** | Cor, Core |
| **ENT - SEL** | Select |
| **ENT - STR** | Strategic |

### Geo (table column: `geo`)

| Table value | User may say (any capitalization) |
|-------------|-----------------------------------|
| **US** | USA, United States, America |
| **CA** | Canada |
| **MX** | Mexico |
| **UK** | United Kingdom, UKI |
| **FR** | France |
| **DACH** | Germany |
| **BNL** | BeNeLux, Belgium, Netherlands, Luxembourg |
| **US - SLED** | Public Sector, Government |

### Super-regions (NA / EMEA)

The UI groups geos into super-regions.

| Super-region (UI label) | User may say (any capitalization) |
|-------------------------|-----------------------------------|
| **NA** | North America |
| **EMEA** | Europe, Europe Middle East & Africa |

**Note:** Geo → super-region: US, CA, MX, US-SLED, US - SLED → NA; UK, DACH, FR, BNL → EMEA. Use the table geo values when calling the API (e.g. `exclude_regions: ["UK","DACH","FR","BNL"]` for EMEA).

---

## Time / quarters

- **time_window (API):** Optional. Can be a **single quarter** (e.g. `"FY26 Q4"`) or **comma-separated quarters** for multi-quarter views (e.g. `"FY25 Q3,FY26 Q3,FY27 Q3"`). Use the latter when the user asks for "last three Q3s", "MRRpV by industry for the last three Q3s", or similar—one call returns rows for each (group, quarter). Format: `FYnn Qn` (e.g. FY26 Q2, FY27 Q1).

---

## Value columns (MRRpV and vehicle count) by source

| Data source | Time column | Value (revenue) column | Vehicle count column | Notes |
|-------------|-------------|------------------------|----------------------|--------|
| First purchase | `close_quarter` | `mrrpv` | `vehicle_count` | First purchase MRRpV is already monthly; do not divide by 12. ACV column: `fleet_acv`. |
| Upsell | `close_quarter` | `upsell_fleet_arr` | `upsell_vehicle_count` | MRRpV = (upsell_fleet_arr / 12) / upsell_vehicle_count (annual → monthly). |
| Fleet | `close_quarter` | `fleet_arr` | `vehicle_count` | MRRpV = (fleet_arr / 12) / vehicle_count; table also has `fleet_mrrpv`. ACV column in API: `fleet_arr` (reported as acv). |

The query layer uses these to build `SELECT`/`GROUP BY` and to normalize the result to a common shape (e.g. `fleet_mrrpv`, `vehicle_count`) for the frontend.

---

## Term definitions (metrics and product names)

Use these when the user or the app refers to metrics or product areas. **Metrics** describe what a column measures; **product names** map to column prefixes.

### Metrics (column meaning)

| Term | Meaning |
|------|--------|
| **ACV** | Annual Contract Value (revenue in first-purchase/upsell tables: `*_acv`). |
| **Count** | Licenses (volume columns: `*_count`, `*_qty`, `total_*`). |
| **ARR** | Annual Recurring Revenue (revenue in fleet tables: `*_arr`). |
| **MRRpV** | Monthly Recurring Revenue per Vehicle. |

### Product / feature names (what users say → column prefix)

| User says… | Column prefix | Meaning |
|------------|---------------|--------|
| **CM** / **Safety** | cm | **CM = Safety.** Camera/safety product. |
| **ST** / **Smart trailers** / **STCE** / **Trailers** | st | Smart trailers, STCE, trailers. (Safety does not relate to ST.) |
| **CW** / **Worker safety** / **Worker application** / **Worker safety app** | cw | Worker safety, worker application. (CW does not relate to driver coaching.) |
| **CT** / **Connected Training** / **Training** | ct | Connected Training, training. |
| **Moby** | moby | 360 visibility. |
| **CM_D** / **dual facing camera** / **dual camera** | cm_d | Dual facing camera (e.g. `cm_d_count`). |
| **CM_S** / **single facing camera** / **single camera** | cm_s | Single facing camera (e.g. `cm_s_count`). |
| **C-Nav** | cnav | Commercial navigation. |
| **FLAPPS** | flapps | Fleet Applications, Fleet Software, Software. |
| **CC** | cc | Camera Connector, Camera Connector Portfolio, AI Multicam, HD Camera Connector. |
| **CAM** | cam | Connected Asset Maintenance, Maintenance. |
| **Qual** | qual | Qualifications, Connected Qualifications. |
| **SAT** | sat | Satellite. |
| **AHD1** | ahd1 | HD Camera Connector. |

---

## Product / feature columns: plain-English → column prefix (or names)

When a user asks about a **product area** (e.g. “Telematics”, “Safety + Telematics”, “AI Multicam”), they are asking for metrics tied to specific columns. Use this table to map **what the user says** → **column prefix or column names** so the app (or agent) can build the right query or filter.

**How to use:**  
- **Column prefix:** e.g. `VG` means any column whose name starts with or contains `vg_` (or `total_vg` in fleet). The backend or agent should select/sum columns matching that prefix when the user asks for that product.  
- **Exact columns:** Some rows list exact column names per table when the shape differs (e.g. first purchase uses `*_acv` / `*_count`, fleet uses `*_arr` / `total_*`).  
- **Which tables:** “First purchase”, “Upsell”, “Fleet” indicate which of the three MRRpV sources have columns for this term.

| Plain-English (user says…) | Column prefix / pattern | First purchase columns (examples) | Upsell columns (examples) | Fleet columns (examples) | Notes |
|----------------------------|------------------------|-----------------------------------|---------------------------|--------------------------|--------|
| **Telematics** | VG | `vg_core_acv`, `vg_count` | `vg_upsell_acv`, `vg_upsell_qty` | `vg_core_arr`, `total_vg` | Columns with **VG** in the name (telematics). |
| **Safety + Telematics** / **VGCM** | vgcm | `vgcm_acv`, `vgcm_core_acv`, `vgcm_addon_acv` | `vgcm_addon_upsell_acv` | `vgcm_arr`, `vgcm_core_arr` | Combined safety and telematics deals. |
| **AI Multicam** | aim4 | `aim4_acv`, `aim4_count` | — | `total_am` (if AM = aim4) | **aim4** = AI Multicam. |
| **Camera** / **CM** / **Safety** | cm | `cm_core_acv`, `cm_count`, `cm_s_count`, `cm_d_count` | `cm_upsell_acv`, `cm_upsell_qty` | `cm_core_arr`, `total_cm` | **CM = Safety.** Camera / safety product area. |
| **Smart trailers** / **STCE** / **Trailers** / **ST** | st | `st_acv`, `st_count` | `st_upsell_acv` | `st_arr`, `total_st` | **ST = Smart trailers, STCE, trailers.** Not safety (safety = CM). |
| **Worker safety** / **Worker application** / **Worker safety app** / **CW** | cw | `cw_acv`, `cw_count` | — | `total_cw` | Worker safety, worker application. Not driver coaching. |
| **Connected Training** / **Training** / **CT** | ct | `ct_acv`, `ct_count` | — | `total_ct` | Connected Training, training. |
| **C-Nav** / **Commercial navigation** | cnav | `cnav_acv`, `cnav_count` | — | `total_cn` | Commercial navigation. |
| **FLAPPS** / **Fleet Applications** / **Fleet Software** / **Software** | flapps | `flapps_acv` | `flapps_upsell_acv` | — | Fleet Applications, Fleet Software, Software. |
| **CC** / **Camera Connector** / **Camera Connector Portfolio** / **HD Camera Connector** | cc | `cc_acv` | `cc_upsell_acv` | — | Camera Connector, Camera Connector Portfolio, AI Multicam, HD Camera Connector. |
| **Moby** / **360 visibility** | moby | `moby_acv`, `moby_count` | — | — | 360 visibility. |
| **Dual facing camera** / **Dual camera** / **CM_D** | cm_d | `cm_d_count`, (cm_d-related acv if present) | — | — | Dual facing camera. |
| **Single facing camera** / **Single camera** / **CM_S** | cm_s | `cm_s_count`, (cm_s-related acv if present) | — | — | Single facing camera. |
| **CAM** / **Connected Asset Maintenance** / **Maintenance** | cam | `cam_acv`, `cam_count` | — | — | Connected Asset Maintenance, Maintenance. |
| **Qual** / **Qualifications** / **Connected Qualifications** | qual | `qual_acv`, `qual_count` | — | — | Qualifications, Connected Qualifications. |
| **RP** | rp | `rp_acv`, `rp_count` | — | `total_rp` | |
| **SAT** / **Satellite** | sat | `sat_acv`, `sat_count` | — | — | Satellite. |
| **AHD1** / **HD Camera Connector** | ahd1 | `ahd1_acv`, `ahd1_count` | — | — | HD Camera Connector. |
| **FA** | fa | `fa_acv`, `fa_count` | — | — | |
| **Subsidy** | subsidy | `subsidy_acv` | `subsidy_acv` | `subsidy_arr` | |
| **Other** | other | `other_acv` | — | `other_arr` | |

**Clarifications:** VG is not video gateway. Safety = CM (camera/safety); ST = smart trailers / STCE / trailers, not safety. CW = worker safety / worker application, not driver coaching. CT = Connected Training / training.

**“Deals that included [product]”:** When the user asks for MRRpV for deals that *included* a product (e.g. “deals that included AI Multicam”), the app filters to rows where that product’s **license count > 0** (e.g. `aim4_count > 0` for first_purchase). The `get_mrrpv` tool accepts an optional `include_product` (product prefix, e.g. `aim4`); the query layer adds `WHERE {product_count_column} > 0`. Supported product count columns per source are in `backend/src/queries/mrrpv.js` → `PRODUCT_COUNT_COLUMNS`.

**Conventions:**  
- **First purchase:** revenue in `*_acv`, volume in `*_count`.  
- **Upsell:** revenue in `*_upsell_acv` or `*_acv`, volume in `*_upsell_qty`.  
- **Fleet:** revenue in `*_arr`, volume in `total_*` (e.g. `total_vg`, `total_cm`).

**Extending:** Add new rows when you add product areas or columns. Keep the **plain-English** column as the single place for “what users say”; the backend can use this doc or the exported `columnGlossary` in `backend/src/queries/column-glossary.js` for prompts or future query parameters (e.g. “show Telematics MRRpV” → filter/aggregate VG columns).

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-26 | Added Dimension values: plain-English ↔ table values for segment (MM=Mid-Market, ENT - COR=Core, ENT - SEL=Select, ENT - STR=Strategic) and geo (US=USA/United States/America, CA=Canada, MX=Mexico, UK=United Kingdom/UKI, FR=France, DACH=Germany, BNL=BeNeLux/Belgium/Netherlands/Luxembourg, US - SLED=Public Sector/Government). All rules ignore capitalization. |
| 2026-02-26 | Added super-region plain-English: NA = North America; EMEA = Europe, Europe Middle East & Africa (case-insensitive). |
| 2026-02-20 | Added mapping for first purchase, upsell, and fleet; plain-English ↔ column table; value columns per source. |
| 2026-02-20 | Added Product / feature columns section: plain-English (Telematics, VGCM, AI Multicam, etc.) → column prefix and example columns per table. Backend mirror: `backend/src/queries/column-glossary.js`. |
| 2026-02-20 | Added Term definitions: metrics (ACV, Count/Licenses, ARR, MRRpV) and product names (Moby=360 visibility, CM_D/CM_S=dual/single camera, C-Nav=commercial navigation, FLAPPS=Fleet Applications/Software, CC=Camera Connector/Portfolio, CAM=Maintenance, Qual=Qualifications, SAT=Satellite, AHD1=HD Camera Connector). CC overwritten from Compliance to Camera Connector. Glossary updated; METRIC_TERMS added. |
| 2026-02-20 | VG: removed video gateway. CM = Safety; Safety = CM. ST = Smart trailers, STCE, trailers (Safety does not relate to ST). CW = Worker safety, worker application (not driver coaching). CT = Connected Training, training. Glossary and doc aligned. |
