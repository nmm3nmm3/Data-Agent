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
    groupBySqlColumn: { industry: 'industry', segment: 'segment', geo: 'geo', geo_segment: 'geo,segment' },
    allowedGroupBy: ['industry', 'segment', 'geo', 'geo_segment'],
  },
  upsell: {
    table: 'mrrpv_upsell',
    timeCol: 'close_quarter',
    arrCol: 'upsell_fleet_arr',
    countCol: 'upsell_vehicle_count',
    annual: true,
    acvCol: 'upsell_fleet_arr',
    accountIdCol: 'account_id',
    groupBySqlColumn: { industry: 'industry', segment: 'segment', geo: 'geo', geo_segment: 'geo,segment' },
    allowedGroupBy: ['industry', 'segment', 'geo', 'geo_segment'],
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
 * Parse time_window into one or more SQL-safe close_quarter values.
 * Accepts a single quarter ("FY26 Q4") or comma-separated quarters ("FY25 Q3,FY26 Q3,FY27 Q3").
 * Returns null if empty; otherwise array of escaped strings for use in WHERE timeCol IN (...).
 */
function resolveTimeWindows(timeWindow) {
  if (!timeWindow || typeof timeWindow !== 'string') return null;
  const parts = timeWindow.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((p) => p.replace(/'/g, "''"));
}

/**
 * Build and run MRRpV query for the given data source.
 * @param {{ dataSource?: string, timeWindow?: string, groupBy?: string | null, filters?: object, includeProduct?: string, includeAccountCount?: boolean, includeAvgDealSize?: boolean, includeAcv?: boolean }} params
 *   timeWindow: one quarter ("FY26 Q4") or comma-separated quarters ("FY25 Q3,FY26 Q3,FY27 Q3") for multi-quarter views.
 *   includeProduct: product prefix to restrict to deals with that product's license count > 0.
 *   includeAccountCount: add account_count (distinct account_id) column.
 *   includeAvgDealSize: add avg_deal_size (ACV per account) column.
 *   includeAcv: if false, omit ACV column from the result (default true).
 * @returns {Promise<{ columns, rows, data, overall?: { fleet_mrrpv, vehicle_count, acv?, account_count?, avg_deal_size? } }>}
 */
export async function getMRRpV(params = {}) {
  const { dataSource: rawSource, timeWindow, groupBy, filters = {}, includeProduct, includeAccountCount, includeAvgDealSize, includeAcv = true } = params;
  const dataSource = rawSource && String(rawSource).toLowerCase() || 'fleet';
  const config = getSourceConfig(dataSource);
  const periods = resolveTimeWindows(timeWindow);

  const productCountCol = includeProduct && PRODUCT_COUNT_COLUMNS[dataSource]?.[String(includeProduct).toLowerCase()];
  if (includeProduct && !productCountCol) {
    const allowed = Object.keys(PRODUCT_COUNT_COLUMNS[dataSource] || {}).join(', ');
    throw new Error(`Product "${includeProduct}" is not supported for ${dataSource} (include filter). Allowed: ${allowed || 'none'}`);
  }

  const allowedGroupBy = new Set([...config.allowedGroupBy, null, undefined]);
  if (groupBy !== undefined && groupBy !== null && !allowedGroupBy.has(groupBy)) {
    throw new Error(`Invalid groupBy: ${groupBy}. Allowed for ${dataSource}: ${config.allowedGroupBy.join(', ')}`);
  }
  if (timeWindow !== undefined && timeWindow !== null && typeof timeWindow === 'string' && timeWindow.length > 400) {
    throw new Error('timeWindow too long');
  }
  if (filters?.region !== undefined && String(filters.region).length > 100) {
    throw new Error('region filter too long');
  }
  if (filters?.segment !== undefined && String(filters.segment).length > 100) {
    throw new Error('segment filter too long');
  }
  const regionsList = Array.isArray(filters.regions) ? filters.regions.filter((g) => g != null && String(g).length <= 100) : [];
  const excludeRegionsList = Array.isArray(filters.excludeRegions) ? filters.excludeRegions.filter((g) => g != null && String(g).length <= 100) : [];
  const segmentsList = Array.isArray(filters.segments) ? filters.segments.filter((s) => s != null && String(s).length <= 100) : [];
  const excludeSegmentsList = Array.isArray(filters.excludeSegments) ? filters.excludeSegments.filter((s) => s != null && String(s).length <= 100) : [];
  const industriesList = Array.isArray(filters.industries) ? filters.industries.filter((i) => i != null && String(i).length <= 100) : [];
  const excludeIndustriesList = Array.isArray(filters.excludeIndustries) ? filters.excludeIndustries.filter((i) => i != null && String(i).length <= 100) : [];
  if (regionsList.length > 50) throw new Error('regions filter too long');
  if (excludeRegionsList.length > 50) throw new Error('excludeRegions filter too long');
  if (segmentsList.length > 50) throw new Error('segments filter too long');
  if (excludeSegmentsList.length > 50) throw new Error('excludeSegments filter too long');
  if (industriesList.length > 50) throw new Error('industries filter too long');
  if (excludeIndustriesList.length > 50) throw new Error('excludeIndustries filter too long');

  const sqlCol = groupBy ? (config.groupBySqlColumn[groupBy] ?? groupBy) : null;
  if (groupBy && !sqlCol) {
    throw new Error(`Unknown groupBy: ${groupBy}. Allowed: ${config.allowedGroupBy.join(', ')}`);
  }
  const isGeoSegment = groupBy === 'geo_segment';
  const groupBySqlCols = isGeoSegment ? ['geo', 'segment'] : (sqlCol ? [sqlCol] : []);

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

  const acvExpr = includeAcv !== false && config.acvCol ? `SUM(${config.acvCol}) AS acv` : null;
  const accountIdCol = config.accountIdCol || 'account_id';
  const accountCountExpr = (includeAccountCount || includeAvgDealSize) ? `COUNT(DISTINCT ${accountIdCol}) AS account_count` : null;
  const avgDealSizeExpr = includeAvgDealSize && config.acvCol
    ? `ROUND(SUM(${config.acvCol}) / NULLIF(COUNT(DISTINCT ${accountIdCol}), 0), 2) AS avg_deal_size`
    : null;
  const extraCols = [...(accountCountExpr ? [accountCountExpr] : []), ...(avgDealSizeExpr ? [avgDealSizeExpr] : [])];
  const where = [];
  if (periods && periods.length > 0) {
    if (periods.length === 1) {
      where.push(`${timeCol} = '${periods[0]}'`);
    } else {
      where.push(`${timeCol} IN (${periods.map((p) => `'${p}'`).join(', ')})`);
    }
  }
  if (regionsList.length > 0) {
    const escaped = regionsList.map((g) => `'${String(g).replace(/'/g, "''")}'`);
    where.push(`(geo IN (${escaped.join(', ')}))`);
  } else if (excludeRegionsList.length > 0) {
    const escaped = excludeRegionsList.map((g) => `'${String(g).replace(/'/g, "''")}'`);
    where.push(`(geo NOT IN (${escaped.join(', ')}))`);
  } else if (filters.region) {
    where.push(`(geo = '${String(filters.region).replace(/'/g, "''")}')`);
  }
  if (segmentsList.length > 0) {
    const escaped = segmentsList.map((s) => `'${String(s).replace(/'/g, "''")}'`);
    where.push(`(segment IN (${escaped.join(', ')}))`);
  } else if (excludeSegmentsList.length > 0) {
    const escaped = excludeSegmentsList.map((s) => `'${String(s).replace(/'/g, "''")}'`);
    where.push(`(segment NOT IN (${escaped.join(', ')}))`);
  } else if (filters.segment) {
    where.push(`(segment = '${String(filters.segment).replace(/'/g, "''")}')`);
  }
  if (config.allowedGroupBy.includes('industry')) {
    if (industriesList.length > 0) {
      const escaped = industriesList.map((i) => `'${String(i).replace(/'/g, "''")}'`);
      where.push(`(industry IN (${escaped.join(', ')}))`);
    } else if (excludeIndustriesList.length > 0) {
      const escaped = excludeIndustriesList.map((i) => `'${String(i).replace(/'/g, "''")}'`);
      where.push(`(industry NOT IN (${escaped.join(', ')}))`);
    } else if (filters.industry) {
      where.push(`(industry = '${String(filters.industry).replace(/'/g, "''")}')`);
    }
  }
  if (productCountCol) {
    where.push(`(${productCountCol} > 0)`);
  }
  const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  // Overall (no group_by): Databricks rejects GROUP BY (). Use GROUP BY timeCol when filtered (one row per quarter), else GROUP BY 1 with a constant.
  const overallOneRow = !groupBy;
  const overallUseTimeGroup = overallOneRow && periods != null && periods.length > 0;
  const overallUseConstantGroup = overallOneRow && !overallUseTimeGroup;

  const selectCols = groupBy
    ? (isGeoSegment
        ? [
            'geo',
            'segment',
            `${mrrpvExpr} AS fleet_mrrpv`,
            countExpr,
            ...(acvExpr ? [acvExpr] : []),
            ...extraCols,
            timeCol,
          ]
        : [
            `${sqlCol} AS ${groupBy}`,
            `${mrrpvExpr} AS fleet_mrrpv`,
            countExpr,
            ...(acvExpr ? [acvExpr] : []),
            ...extraCols,
            timeCol,
          ])
    : overallUseTimeGroup
      ? [
          timeCol,
          `${mrrpvExpr} AS fleet_mrrpv`,
          countExpr,
          ...(acvExpr ? [acvExpr] : []),
          ...extraCols,
        ]
      : [
          `1 AS _grp`,
          `${mrrpvExpr} AS fleet_mrrpv`,
          countExpr,
          ...(acvExpr ? [acvExpr] : []),
          ...extraCols,
          `MAX(${timeCol}) AS ${timeCol}`,
        ];

  const groupByClause = groupBy
    ? (isGeoSegment ? ` GROUP BY geo, segment, ${timeCol}` : ` GROUP BY ${sqlCol}, ${timeCol}`)
    : overallUseTimeGroup
      ? ` GROUP BY ${timeCol}`
      : overallUseConstantGroup
        ? ' GROUP BY 1'
        : '';

  const orderCols = groupBy ? (isGeoSegment ? `geo, segment, ${timeCol}` : `${sqlCol}, ${timeCol}`) : overallUseTimeGroup ? timeCol : timeCol;
  const sql = `SELECT ${selectCols.join(', ')} FROM ${fullTable}${whereClause}${groupByClause} ORDER BY ${orderCols} LIMIT 5000`;

  const expectedColNames = groupBy
    ? (isGeoSegment ? ['geo', 'segment', 'fleet_mrrpv', 'vehicle_count', ...(acvExpr ? ['acv'] : []), ...(accountCountExpr ? ['account_count'] : []), ...(avgDealSizeExpr ? ['avg_deal_size'] : []), timeCol] : [groupBy, 'fleet_mrrpv', 'vehicle_count', ...(acvExpr ? ['acv'] : []), ...(accountCountExpr ? ['account_count'] : []), ...(avgDealSizeExpr ? ['avg_deal_size'] : []), timeCol])
    : overallUseTimeGroup
      ? [timeCol, 'fleet_mrrpv', 'vehicle_count', ...(acvExpr ? ['acv'] : []), ...(accountCountExpr ? ['account_count'] : []), ...(avgDealSizeExpr ? ['avg_deal_size'] : [])]
      : ['fleet_mrrpv', 'vehicle_count', ...(acvExpr ? ['acv'] : []), ...(accountCountExpr ? ['account_count'] : []), ...(avgDealSizeExpr ? ['avg_deal_size'] : []), timeCol];

  const { columns: rawColumns, rows: rawRows } = await runSql(sql);

  const rawColNames = rawColumns.length > 0 ? rawColumns.map((c) => c.name) : (overallUseConstantGroup ? ['_grp', ...expectedColNames] : expectedColNames);
  const rawColCount = rawColNames.length;

  let columns =
    rawColumns.length > 0
      ? rawColumns
      : rawColNames.map((name) => ({ name }));

  if (overallUseConstantGroup && columns.some((c) => c.name === '_grp')) {
    columns = columns.filter((c) => c.name !== '_grp');
  }

  const rows =
    rawColCount > 0 &&
    rawRows.length > 0 &&
    !Array.isArray(rawRows[0]) &&
    rawRows.length % rawColCount === 0
      ? (() => {
          const out = [];
          for (let i = 0; i < rawRows.length; i += rawColCount) {
            out.push(rawRows.slice(i, i + rawColCount));
          }
          return out;
        })()
      : rawRows;

  const data = rows.map((row) => {
    const obj = {};
    columns.forEach((col) => {
      const idx = rawColNames.indexOf(col.name);
      if (idx >= 0) obj[col.name] = Array.isArray(row) ? row[idx] : row[col.name];
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
