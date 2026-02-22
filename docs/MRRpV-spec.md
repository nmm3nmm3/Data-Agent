# MRRpV (Monthly Recurring Revenue per Vehicle) — Spec

This document is the single source of truth for the MRRpV metric. All backend query logic and validation must align with this spec.

---

## Definition (business terms)

**MRRpV** = Monthly Recurring Revenue attributable to vehicles in a given period, divided by the number of vehicles in that period.

- **Numerator:** MRR (monthly recurring revenue) that is attributed to vehicles in the chosen time window (e.g. calendar month or fiscal quarter).
- **Denominator:** Vehicle count — the number of vehicles used for that same period (e.g. active vehicles, or vehicles with at least one billing event in the period). Exact definition depends on business rules (see below).

---

## Source (tables and columns)

The app supports **three data sources**, selected by the user in the UI:

| Source (UI) | Table | Grouping (plain-English → column) |
|-------------|-------|-----------------------------------|
| **Fleet overall** | `businessdbs.epofinance_prod.mrrpv_fleet` | segment → `segment`, geo → `geo` (no industry) |
| **First purchases** | `businessdbs.epofinance_prod.mrrpv_first_purchase` | industry → `industry`, segment → `segment`, geo → `geo` |
| **Upsell** | `businessdbs.epofinance_prod.mrrpv_upsell` | industry → `industry`, segment → `segment`, geo → `geo` |

- **Schema mapping:** See `docs/mrrpv-schema-mapping.md` for the full plain-English ↔ column table and value columns per source. The query layer in `backend/src/queries/mrrpv.js` uses `SOURCE_CONFIG` and per-source `groupBySqlColumn` so grouping aligns with each table’s actual columns.
- **Filters:** Optional filters by region, segment, or other dimensions as exposed in the API.
- **Time window:** Specified by the user or default (e.g. FY27 Q1). All tables use `close_quarter` for the time filter.

---

## Denominator (vehicle definition)

- **Vehicle** is defined per business rules in the source table `mrrpv_fleet`. Typically: vehicles that are in scope for MRR in the selected period (e.g. active, billed).
- If the spec is updated with an exact definition (e.g. “active vehicles with at least one subscription day in the period”), document it here and ensure the query uses that definition.

---

## Validation

- Run `npm run validate:mrrpv-spec` to check that this spec document exists and has the required sections (Definition, Source, Denominator).
- For regression: when the spec or SQL changes, run the validation script and optionally compare a sample query result to a known snapshot or Tableau export.

---

## Changelog

| Date       | Change |
| ---------- | ------ |
| (initial)  | Spec created; primary source `businessdbs.epofinance_dev.fleet_mrrpv`. |
| 2026-02-20 | Switched source to `businessdbs.epofinance_prod.mrrpv_fleet` (prod schema; table name mrrpv_fleet in prod). |
| 2026-02-20 | Source table holds annual figures; query divides by 12 so reported MRRpV is monthly. |
| 2026-02-20 | Three data sources: fleet, first_purchase, upsell. User selects in UI; grouping per source in docs/mrrpv-schema-mapping.md and backend SOURCE_CONFIG. |
