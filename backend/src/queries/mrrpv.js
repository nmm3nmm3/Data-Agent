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

/**
 * Bridge query: one row per quarter with VG/CM ASP, attach rates, and contribution components of First Purchase MRRpV.
 * Only supports first_purchase. Returns { columns, data, viewType: 'bridge' }.
 */
export async function getBridgeMRRpV(params = {}) {
  const { timeWindow, filters = {} } = params;
  const config = getSourceConfig('first_purchase');
  const periods = resolveTimeWindows(timeWindow);
  if (!periods || periods.length === 0) {
    throw new Error('Bridge view requires timeWindow (e.g. FY26 Q2,FY26 Q3,FY26 Q4,FY27 Q1)');
  }
  const regionsList = Array.isArray(filters.regions) ? filters.regions.filter((g) => g != null && String(g).length <= 100) : [];
  const excludeRegionsList = Array.isArray(filters.excludeRegions) ? filters.excludeRegions.filter((g) => g != null && String(g).length <= 100) : [];
  const segmentsList = Array.isArray(filters.segments) ? filters.segments.filter((s) => s != null && String(s).length <= 100) : [];
  const excludeSegmentsList = Array.isArray(filters.excludeSegments) ? filters.excludeSegments.filter((s) => s != null && String(s).length <= 100) : [];
  const industriesList = Array.isArray(filters.industries) ? filters.industries.filter((i) => i != null && String(i).length <= 100) : [];
  const excludeIndustriesList = Array.isArray(filters.excludeIndustries) ? filters.excludeIndustries.filter((i) => i != null && String(i).length <= 100) : [];
  const where = [];
  where.push(`${config.timeCol} IN (${periods.map((p) => `'${p}'`).join(', ')})`);
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
  if (industriesList.length > 0) {
    const escaped = industriesList.map((i) => `'${String(i).replace(/'/g, "''")}'`);
    where.push(`(industry IN (${escaped.join(', ')}))`);
  } else if (excludeIndustriesList.length > 0) {
    const escaped = excludeIndustriesList.map((i) => `'${String(i).replace(/'/g, "''")}'`);
    where.push(`(industry NOT IN (${escaped.join(', ')}))`);
  } else if (filters.industry) {
    where.push(`(industry = '${String(filters.industry).replace(/'/g, "''")}')`);
  }
  const whereClause = ` WHERE ${where.join(' AND ')}`;
  const fullTable = `${CATALOG}.${SCHEMA}.${config.table}`;
  const timeCol = config.timeCol;
  const v = config.valueCol;
  const c = config.countCol;
  const mrrpvExpr = `ROUND(SUM(${v} * ${c}) / NULLIF(SUM(${c}), 0), 2)`;
  const sql = `SELECT ${timeCol},
    SUM(${c}) AS vehicle_count,
    SUM(${config.acvCol}) AS acv,
    ${mrrpvExpr} AS fleet_mrrpv,
    SUM(vg_core_acv) AS vg_core_acv,
    SUM(vg_count) AS vg_count,
    SUM(cm_core_acv) AS cm_core_acv,
    SUM(cm_count) AS cm_count,
    SUM(vgcm_core_acv) AS vgcm_core_acv,
    SUM(vgcm_addon_acv) AS vgcm_addon_acv,
    SUM(st_acv) AS st_acv,
    SUM(flapps_acv) AS flapps_acv,
    SUM(cc_acv) AS cc_acv,
    SUM(other_acv) AS other_acv,
    SUM(subsidy_acv) AS subsidy_acv
  FROM ${fullTable}${whereClause}
  GROUP BY ${timeCol}
  ORDER BY ${timeCol}
  LIMIT 100`;

  const { columns: rawColumns, rows: rawRows } = await runSql(sql);
  const rawColNames = rawColumns?.length > 0 ? rawColumns.map((col) => col.name) : ['close_quarter', 'vehicle_count', 'acv', 'fleet_mrrpv', 'vg_core_acv', 'vg_count', 'cm_core_acv', 'cm_count', 'vgcm_core_acv', 'vgcm_addon_acv', 'st_acv', 'flapps_acv', 'cc_acv', 'other_acv', 'subsidy_acv'];
  const rawColCount = rawColNames.length;
  let rows = rawRows;
  if (rawRows?.length > 0 && Array.isArray(rawRows[0])) {
    rows = rawRows;
  } else if (rawRows?.length > 0 && !Array.isArray(rawRows[0]) && rawRows.length % rawColCount === 0) {
    rows = [];
    for (let i = 0; i < rawRows.length; i += rawColCount) {
      rows.push(rawRows.slice(i, i + rawColCount));
    }
  }
  const idx = (name) => rawColNames.indexOf(name);
  const totals = {
    vehicle_count: 0,
    acv: 0,
    mrrpvWeighted: 0,
    vg_core_acv: 0,
    vg_count: 0,
    cm_core_acv: 0,
    cm_count: 0,
    vgcm_core_acv: 0,
    vgcm_addon_acv: 0,
    st_acv: 0,
    flapps_acv: 0,
    cc_acv: 0,
    other_acv: 0,
    subsidy_acv: 0,
  };
  const data = (rows || []).map((row) => {
    const get = (name) => {
      const i = idx(name);
      if (i < 0) return null;
      const val = Array.isArray(row) ? row[i] : row[name];
      return val != null && val !== '' ? Number(val) : null;
    };
    const close_quarter = Array.isArray(row) ? row[idx('close_quarter')] : row?.close_quarter;
    const vehicle_count = get('vehicle_count');
    const acv = get('acv');
    const fleet_mrrpv = get('fleet_mrrpv');
    const vg_core_acv = get('vg_core_acv');
    const vg_count = get('vg_count');
    const cm_core_acv = get('cm_core_acv');
    const cm_count = get('cm_count');
    const vgcm_core_acv = get('vgcm_core_acv');
    const vgcm_addon_acv = get('vgcm_addon_acv');
    const st_acv = get('st_acv');
    const flapps_acv = get('flapps_acv');
    const cc_acv = get('cc_acv');
    const other_acv = get('other_acv');
    const subsidy_acv = get('subsidy_acv');
    totals.vehicle_count += vehicle_count != null ? Number(vehicle_count) : 0;
    totals.acv += acv != null ? Number(acv) : 0;
    totals.mrrpvWeighted += (fleet_mrrpv != null && vehicle_count != null) ? Number(fleet_mrrpv) * Number(vehicle_count) : 0;
    totals.vg_core_acv += vg_core_acv != null ? Number(vg_core_acv) : 0;
    totals.vg_count += vg_count != null ? Number(vg_count) : 0;
    totals.cm_core_acv += cm_core_acv != null ? Number(cm_core_acv) : 0;
    totals.cm_count += cm_count != null ? Number(cm_count) : 0;
    totals.vgcm_core_acv += vgcm_core_acv != null ? Number(vgcm_core_acv) : 0;
    totals.vgcm_addon_acv += vgcm_addon_acv != null ? Number(vgcm_addon_acv) : 0;
    totals.st_acv += st_acv != null ? Number(st_acv) : 0;
    totals.flapps_acv += flapps_acv != null ? Number(flapps_acv) : 0;
    totals.cc_acv += cc_acv != null ? Number(cc_acv) : 0;
    totals.other_acv += other_acv != null ? Number(other_acv) : 0;
    totals.subsidy_acv += subsidy_acv != null ? Number(subsidy_acv) : 0;
    const vc = vehicle_count && Number(vehicle_count) > 0 ? Number(vehicle_count) : null;
    const monthlyPerVehicle = (acvVal) => (acvVal != null && vc ? (Number(acvVal) / 12) / vc : null);
    const vg_asp = vg_count > 0 && vg_core_acv != null ? Math.round((vg_core_acv / vg_count / 12) * 100) / 100 : null;
    const cm_asp = cm_count > 0 && cm_core_acv != null ? Math.round((cm_core_acv / cm_count / 12) * 100) / 100 : null;
    const vg_attach_pct = vc > 0 && vg_count != null ? Math.round((100 * vg_count) / vc * 10) / 10 : null;
    const cm_attach_pct = vc > 0 && cm_count != null ? Math.round((100 * cm_count) / vc * 10) / 10 : null;
    return {
      close_quarter,
      vehicle_count: vehicle_count != null ? Math.round(vehicle_count) : null,
      acv,
      fleet_mrrpv,
      vg_asp,
      cm_asp,
      vg_attach_pct,
      cm_attach_pct,
      vg_core_contribution: monthlyPerVehicle(vg_core_acv) != null ? Math.round(monthlyPerVehicle(vg_core_acv) * 100) / 100 : null,
      cm_core_contribution: monthlyPerVehicle(cm_core_acv) != null ? Math.round(monthlyPerVehicle(cm_core_acv) * 100) / 100 : null,
      vgcm_core_contribution: monthlyPerVehicle(vgcm_core_acv) != null ? Math.round(monthlyPerVehicle(vgcm_core_acv) * 100) / 100 : null,
      vgcm_addon_contribution: monthlyPerVehicle(vgcm_addon_acv) != null ? Math.round(monthlyPerVehicle(vgcm_addon_acv) * 100) / 100 : null,
      st_contribution: monthlyPerVehicle(st_acv) != null ? Math.round(monthlyPerVehicle(st_acv) * 100) / 100 : null,
      flapps_contribution: monthlyPerVehicle(flapps_acv) != null ? Math.round(monthlyPerVehicle(flapps_acv) * 100) / 100 : null,
      cc_contribution: monthlyPerVehicle(cc_acv) != null ? Math.round(monthlyPerVehicle(cc_acv) * 100) / 100 : null,
      other_contribution: monthlyPerVehicle(other_acv) != null ? Math.round(monthlyPerVehicle(other_acv) * 100) / 100 : null,
      subsidy_contribution: monthlyPerVehicle(subsidy_acv) != null ? Math.round(monthlyPerVehicle(subsidy_acv) * 100) / 100 : null,
    };
  });

  const vcTotal = totals.vehicle_count > 0 ? totals.vehicle_count : null;
  const grandTotals = {
    vehicle_count: vcTotal != null ? Math.round(vcTotal) : null,
    acv: totals.acv > 0 ? totals.acv : null,
    fleet_mrrpv: vcTotal > 0 ? Math.round((totals.mrrpvWeighted / vcTotal) * 100) / 100 : null,
    vg_asp: totals.vg_count > 0 ? Math.round((totals.vg_core_acv / totals.vg_count / 12) * 100) / 100 : null,
    cm_asp: totals.cm_count > 0 ? Math.round((totals.cm_core_acv / totals.cm_count / 12) * 100) / 100 : null,
    vg_attach_pct: vcTotal > 0 ? Math.round((100 * totals.vg_count) / vcTotal * 10) / 10 : null,
    cm_attach_pct: vcTotal > 0 ? Math.round((100 * totals.cm_count) / vcTotal * 10) / 10 : null,
    vg_core_contribution: vcTotal > 0 ? Math.round((totals.vg_core_acv / 12 / vcTotal) * 100) / 100 : null,
    cm_core_contribution: vcTotal > 0 ? Math.round((totals.cm_core_acv / 12 / vcTotal) * 100) / 100 : null,
    vgcm_core_contribution: vcTotal > 0 ? Math.round((totals.vgcm_core_acv / 12 / vcTotal) * 100) / 100 : null,
    vgcm_addon_contribution: vcTotal > 0 ? Math.round((totals.vgcm_addon_acv / 12 / vcTotal) * 100) / 100 : null,
    st_contribution: vcTotal > 0 ? Math.round((totals.st_acv / 12 / vcTotal) * 100) / 100 : null,
    flapps_contribution: vcTotal > 0 ? Math.round((totals.flapps_acv / 12 / vcTotal) * 100) / 100 : null,
    cc_contribution: vcTotal > 0 ? Math.round((totals.cc_acv / 12 / vcTotal) * 100) / 100 : null,
    other_contribution: vcTotal > 0 ? Math.round((totals.other_acv / 12 / vcTotal) * 100) / 100 : null,
    subsidy_contribution: vcTotal > 0 ? Math.round((totals.subsidy_acv / 12 / vcTotal) * 100) / 100 : null,
  };
  const columns = [
    { name: 'close_quarter' },
    { name: 'vehicle_count' },
    { name: 'acv' },
    { name: 'fleet_mrrpv' },
    { name: 'vg_asp' },
    { name: 'cm_asp' },
    { name: 'vg_attach_pct' },
    { name: 'cm_attach_pct' },
    { name: 'vg_core_contribution' },
    { name: 'cm_core_contribution' },
    { name: 'vgcm_core_contribution' },
    { name: 'vgcm_addon_contribution' },
    { name: 'st_contribution' },
    { name: 'flapps_contribution' },
    { name: 'cc_contribution' },
    { name: 'other_contribution' },
    { name: 'subsidy_contribution' },
  ];
  return { columns, rows: data, data, viewType: 'bridge', grandTotals };
}

export { DATA_SOURCES, SOURCE_CONFIG, getSourceConfig };
