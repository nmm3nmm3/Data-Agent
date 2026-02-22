/**
 * MRRpV query: supports three data sources (fleet, first_purchase, upsell) per docs/mrrpv-schema-mapping.md.
 * Each source has its own table and column mapping (plain-English group_by → SQL column).
 */

import { runSql } from '../databricks/client.js';

const CATALOG = 'businessdbs';
const SCHEMA = 'epofinance_prod';

/**
 * Per-source config: table, time column, revenue/ARR column, vehicle count column, and
 * plain-English → SQL column mapping for group_by. Keys (industry, segment, geo) are stable for API/agent.
 * Value column is reported as "fleet_mrrpv" in the response for consistent frontend display.
 */
const SOURCE_CONFIG = {
  fleet: {
    table: 'mrrpv_fleet',
    timeCol: 'close_quarter',
    arrCol: 'fleet_arr',
    countCol: 'vehicle_count',
    annual: true,
    acvCol: 'fleet_arr',
    accountIdCol: 'account_id',
    groupBySqlColumn: { segment: 'segment', geo: 'geo' },
    allowedGroupBy: ['segment', 'geo'],
  },
  first_purchase: {
    table: 'mrrpv_first_purchase',
    timeCol: 'close_quarter',
    arrCol: null,
    valueCol: 'mrrpv',
    countCol: 'vehicle_count',
    annual: false,
    acvCol: 'fleet_acv',
    accountIdCol: 'account_id',
    groupBySqlColumn: { industry: 'industry', segment: 'segment', geo: 'geo' },
    allowedGroupBy: ['industry', 'segment', 'geo'],
  },
  upsell: {
    table: 'mrrpv_upsell',
    timeCol: 'close_quarter',
    arrCol: 'upsell_fleet_arr',
    countCol: 'upsell_vehicle_count',
    annual: true,
    acvCol: 'upsell_fleet_arr',
    accountIdCol: 'account_id',
    groupBySqlColumn: { industry: 'industry', segment: 'segment', geo: 'geo' },
    allowedGroupBy: ['industry', 'segment', 'geo'],
  },
};

const DATA_SOURCES = Object.keys(SOURCE_CONFIG);

function getSourceConfig(dataSource) {
  const key = dataSource && String(dataSource).toLowerCase();
  if (!key || !SOURCE_CONFIG[key]) {
    throw new Error(`Invalid dataSource: ${dataSource}. Allowed: ${DATA_SOURCES.join(', ')}`);
  }
  return SOURCE_CONFIG[key];
}

/**
 * Per-source product prefix → license/count column name. Used for "deals that included [product]"
 * (filter: count column > 0). Keys are product prefixes from column-glossary (aim4, vg, cm, etc.).
 */
const PRODUCT_COUNT_COLUMNS = {
  first_purchase: {
    aim4: 'aim4_count', vg: 'vg_count', cm: 'cm_count', st: 'st_count', cw: 'cw_count', ct: 'ct_count',
    cnav: 'cnav_count', fa: 'fa_count', rp: 'rp_count', qual: 'qual_count', cam: 'cam_count',
    moby: 'moby_count', sat: 'sat_count', ahd1: 'ahd1_count', cm_s: 'cm_s_count', cm_d: 'cm_d_count',
  },
  upsell: {
    vg: 'vg_upsell_qty', cm: 'cm_upsell_qty',
  },
  fleet: {
    vg: 'total_vg', cm: 'total_cm', st: 'total_st', cw: 'total_cw', ct: 'total_ct',
    cnav: 'total_cn', rp: 'total_rp', aim4: 'total_am',
  },
};

/**
 * Map common time_window phrases to a SQL-safe value for close_quarter.
 * Caller can pass a literal like "FY27 Q1" which we use as-is (escaped).
 */
function resolveTimeWindow(timeWindow) {
  if (!timeWindow || typeof timeWindow !== 'string') return null;
  const t = timeWindow.trim();
  if (!t) return null;
  return t.replace(/'/g, "''");
}

/**
 * Build and run MRRpV query for the given data source.
 * @param {{ dataSource?: string, timeWindow?: string, groupBy?: string | null, filters?: object, includeProduct?: string, includeAccountCount?: boolean, includeAvgDealSize?: boolean }} params
 *   includeProduct: product prefix to restrict to deals with that product's license count > 0.
 *   includeAccountCount: add account_count (distinct account_id) column.
 *   includeAvgDealSize: add avg_deal_size (ACV per account) column.
 * @returns {Promise<{ columns, rows, data, overall?: { fleet_mrrpv, vehicle_count, acv?, account_count?, avg_deal_size? } }>}
 */
export async function getMRRpV(params = {}) {
  const { dataSource: rawSource, timeWindow, groupBy, filters = {}, includeProduct, includeAccountCount, includeAvgDealSize } = params;
  const dataSource = rawSource && String(rawSource).toLowerCase() || 'fleet';
  const config = getSourceConfig(dataSource);
  const period = resolveTimeWindow(timeWindow);

  const productCountCol = includeProduct && PRODUCT_COUNT_COLUMNS[dataSource]?.[String(includeProduct).toLowerCase()];
  if (includeProduct && !productCountCol) {
    const allowed = Object.keys(PRODUCT_COUNT_COLUMNS[dataSource] || {}).join(', ');
    throw new Error(`Product "${includeProduct}" is not supported for ${dataSource} (include filter). Allowed: ${allowed || 'none'}`);
  }

  const allowedGroupBy = new Set([...config.allowedGroupBy, null, undefined]);
  if (groupBy !== undefined && groupBy !== null && !allowedGroupBy.has(groupBy)) {
    throw new Error(`Invalid groupBy: ${groupBy}. Allowed for ${dataSource}: ${config.allowedGroupBy.join(', ')}`);
  }
  if (timeWindow !== undefined && timeWindow !== null && typeof timeWindow === 'string' && timeWindow.length > 100) {
    throw new Error('timeWindow too long');
  }
  if (filters?.region !== undefined && String(filters.region).length > 100) {
    throw new Error('region filter too long');
  }
  if (filters?.segment !== undefined && String(filters.segment).length > 100) {
    throw new Error('segment filter too long');
  }

  const sqlCol = groupBy ? (config.groupBySqlColumn[groupBy] ?? groupBy) : null;
  if (groupBy && !sqlCol) {
    throw new Error(`Unknown groupBy: ${groupBy}. Allowed: ${config.allowedGroupBy.join(', ')}`);
  }

  const fullTable = `${CATALOG}.${SCHEMA}.${config.table}`;
  const timeCol = config.timeCol;

  let mrrpvExpr;
  let countExpr;
  if (config.valueCol) {
    // First purchase: per-row mrrpv and vehicle_count; weighted average for MRRpV (optionally annual → monthly)
    const v = config.valueCol;
    const c = config.countCol;
    const numer = config.annual ? `SUM((${v} / 12) * ${c})` : `SUM(${v} * ${c})`;
    mrrpvExpr = `ROUND(${numer} / NULLIF(SUM(${c}), 0), 2)`;
    countExpr = `SUM(${c}) AS vehicle_count`;
  } else {
    const sumArr = `SUM(${config.arrCol})`;
    const sumCount = `NULLIF(SUM(${config.countCol}), 0)`;
    mrrpvExpr = config.annual
      ? `ROUND((${sumArr} / ${sumCount}) / 12, 2)`
      : `ROUND(${sumArr} / ${sumCount}, 2)`;
    countExpr = `SUM(${config.countCol}) AS vehicle_count`;
  }

  const acvExpr = config.acvCol ? `SUM(${config.acvCol}) AS acv` : null;
  const accountIdCol = config.accountIdCol || 'account_id';
  const accountCountExpr = (includeAccountCount || includeAvgDealSize) ? `COUNT(DISTINCT ${accountIdCol}) AS account_count` : null;
  const avgDealSizeExpr = includeAvgDealSize && config.acvCol
    ? `ROUND(SUM(${config.acvCol}) / NULLIF(COUNT(DISTINCT ${accountIdCol}), 0), 2) AS avg_deal_size`
    : null;
  const extraCols = [...(accountCountExpr ? [accountCountExpr] : []), ...(avgDealSizeExpr ? [avgDealSizeExpr] : [])];
  const selectCols = groupBy
    ? [
        `${sqlCol} AS ${groupBy}`,
        `${mrrpvExpr} AS fleet_mrrpv`,
        countExpr,
        ...(acvExpr ? [acvExpr] : []),
        ...extraCols,
        timeCol,
      ]
    : [
        `${mrrpvExpr} AS fleet_mrrpv`,
        countExpr,
        ...(acvExpr ? [acvExpr] : []),
        ...extraCols,
        timeCol,
      ];

  const groupByClause = groupBy ? ` GROUP BY ${sqlCol}, ${timeCol}` : '';

  const where = [];
  if (period) {
    where.push(`${timeCol} = '${period}'`);
  }
  if (filters.region) {
    where.push(`(geo = '${String(filters.region).replace(/'/g, "''")}')`);
  }
  if (filters.segment) {
    where.push(`(segment = '${String(filters.segment).replace(/'/g, "''")}')`);
  }
  if (productCountCol) {
    where.push(`(${productCountCol} > 0)`);
  }
  const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const orderCols = groupBy ? `${sqlCol}, ${timeCol}` : timeCol;
  const sql = `SELECT ${selectCols.join(', ')} FROM ${fullTable}${whereClause}${groupByClause} ORDER BY ${orderCols} LIMIT 5000`;

  const expectedColNames = groupBy
    ? [groupBy, 'fleet_mrrpv', 'vehicle_count', ...(acvExpr ? ['acv'] : []), ...(accountCountExpr ? ['account_count'] : []), ...(avgDealSizeExpr ? ['avg_deal_size'] : []), timeCol]
    : ['fleet_mrrpv', 'vehicle_count', ...(acvExpr ? ['acv'] : []), ...(accountCountExpr ? ['account_count'] : []), ...(avgDealSizeExpr ? ['avg_deal_size'] : []), timeCol];

  const { columns: rawColumns, rows: rawRows } = await runSql(sql);

  const columns =
    rawColumns.length > 0
      ? rawColumns
      : expectedColNames.map((name) => ({ name }));

  const colCount = columns.length;
  const rows =
    colCount > 0 &&
    rawRows.length > 0 &&
    !Array.isArray(rawRows[0]) &&
    rawRows.length % colCount === 0
      ? (() => {
          const out = [];
          for (let i = 0; i < rawRows.length; i += colCount) {
            out.push(rawRows.slice(i, i + colCount));
          }
          return out;
        })()
      : rawRows;

  const data = rows.map((row) => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col.name] = row[i];
    });
    return obj;
  });

  let overall = null;
  if (data.length > 1) {
    const totalCount = data.reduce((s, r) => s + (Number(r.vehicle_count) || 0), 0);
    const totalAcv = data.some((r) => r.acv != null) ? data.reduce((s, r) => s + (Number(r.acv) || 0), 0) : null;
    const sumMrrpvWeighted = data.reduce((s, r) => s + (Number(r.fleet_mrrpv) || 0) * (Number(r.vehicle_count) || 0), 0);
    const weightedMrrpv = totalCount > 0 ? Math.round((sumMrrpvWeighted / totalCount) * 100) / 100 : null;
    overall = { fleet_mrrpv: weightedMrrpv, vehicle_count: totalCount };
    if (totalAcv != null) overall.acv = totalAcv;
    if (data.some((r) => r.account_count != null)) {
      overall.account_count = data.reduce((s, r) => s + (Number(r.account_count) || 0), 0);
    }
    if (data.some((r) => r.avg_deal_size != null) && overall.account_count > 0 && totalAcv != null) {
      overall.avg_deal_size = Math.round((totalAcv / overall.account_count) * 100) / 100;
    }
  } else if (data.length === 1) {
    overall = {
      fleet_mrrpv: data[0].fleet_mrrpv != null ? Number(data[0].fleet_mrrpv) : null,
      vehicle_count: data[0].vehicle_count != null ? Number(data[0].vehicle_count) : null,
    };
    if (data[0].acv != null) overall.acv = Number(data[0].acv);
    if (data[0].account_count != null) overall.account_count = Number(data[0].account_count);
    if (data[0].avg_deal_size != null) overall.avg_deal_size = Number(data[0].avg_deal_size);
  }

  return { columns, rows, data, overall };
}

export { DATA_SOURCES, SOURCE_CONFIG, getSourceConfig };
