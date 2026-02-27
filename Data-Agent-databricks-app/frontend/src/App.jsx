import React, { useState, useRef, useEffect } from 'react';

const API = '/api';

function formatCell(colName, value) {
  if (value == null) return '—';
  if (colName === 'fleet_mrrpv') {
    const n = Number(value);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(value);
  }
  if (colName === 'acv') {
    const n = Number(value);
    return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(value);
  }
  if (colName === 'account_count') {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : String(value);
  }
  if (colName === 'avg_deal_size') {
    const n = Number(value);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(value);
  }
  if (colName === 'vehicle_count') {
    const n = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n.toLocaleString() : String(value);
  }
  return String(value);
}

/** Format ACV for pivot table: always $X.XXXM (e.g. $0.800M, $1.500M) */
function formatAcvPivot(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `$${(n / 1e6).toFixed(3)}M`;
}

const TIME_METRIC_ROWS = [
  { key: 'account_count', label: 'First Purchase Accounts', format: (v) => (v != null && Number.isFinite(Number(v)) ? Number(v).toLocaleString() : '—') },
  { key: 'vehicle_count', label: 'First Purchase Vehicles', format: (v) => (v != null && Number.isFinite(Number(v)) ? Number(v).toLocaleString() : '—') },
  { key: 'acv', label: 'First Purchase ACV', format: formatAcvPivot },
  { key: 'fleet_mrrpv', label: 'First Purchase MRRpV', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—') },
  { key: 'avg_deal_size', label: 'Avg deal size', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—') },
];

/** Bridge view: metric rows in display order with format and boldGrandTotal. */
const BRIDGE_METRIC_ROWS = [
  { key: 'vehicle_count', label: 'First Purchase Vehicles', format: (v) => (v != null && Number.isFinite(Number(v)) ? Number(v).toLocaleString() : '—'), boldGrandTotal: true },
  { key: 'acv', label: 'First Purchase ACV', format: formatAcvPivot, boldGrandTotal: true },
  { key: 'fleet_mrrpv', label: 'First Purchase MRRpV', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: true },
  { key: 'vg_asp', label: 'VG ASP', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: false },
  { key: 'cm_asp', label: 'CM ASP', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: false },
  { key: 'vg_attach_pct', label: 'VG Attach', format: (v) => (v != null && Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : '—'), boldGrandTotal: false },
  { key: 'cm_attach_pct', label: 'CM Attach', format: (v) => (v != null && Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : '—'), boldGrandTotal: false },
  { key: 'vg_core_contribution', label: 'VG Core Contribution', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: true },
  { key: 'cm_core_contribution', label: 'CM Core Contribution', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: true },
  { key: 'vgcm_core_contribution', label: 'VG/CM Core Contribution', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: true },
  { key: 'vgcm_addon_contribution', label: 'VG/CM Add-on Contribution', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: true },
  { key: 'st_contribution', label: 'Smart Trailers Contribution', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: true },
  { key: 'flapps_contribution', label: 'All Fleet Apps Contribution', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: true },
  { key: 'cc_contribution', label: 'Camera Connector Contribution', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: true },
  { key: 'other_contribution', label: 'All Other Contribution', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: true },
  { key: 'subsidy_contribution', label: 'Subsidy Contribution', format: (v) => (v != null && Number.isFinite(Number(v)) ? (Number(v) < 0 ? `(${Math.abs(Number(v)).toFixed(2)})` : `$${Number(v).toFixed(2)}`) : '—'), boldGrandTotal: true },
  { key: 'mrrpv_bottom', label: 'MRRpV', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—'), boldGrandTotal: true, dataKey: 'fleet_mrrpv' },
];

/**
 * Build pivot view when data has close_quarter and one row per period (no group by dimension).
 * Returns { usePivot: boolean, timeColumns: string[], metricRows: { label, key, valuesByQuarter: {}, grandTotal } } or { usePivot: false }.
 */
function buildTimePivot(cols, dataRows) {
  const timeCol = cols.find((c) => c.name === 'close_quarter');
  const hasGroup = cols.some((c) => ['industry', 'segment', 'geo'].includes(c.name));
  if (!timeCol || hasGroup || !dataRows?.length) return { usePivot: false };

  const quarters = [...new Set(dataRows.map((r) => r.close_quarter).filter(Boolean))].sort();
  if (quarters.length === 0) return { usePivot: false };

  const valueKeys = TIME_METRIC_ROWS.filter((m) => cols.some((c) => c.name === m.key)).map((m) => m.key);
  if (valueKeys.length === 0) return { usePivot: false };

  const byQuarter = {};
  quarters.forEach((q) => {
    byQuarter[q] = dataRows.find((r) => r.close_quarter === q) || {};
  });

  const metricRows = valueKeys.map((key) => {
    const spec = TIME_METRIC_ROWS.find((m) => m.key === key);
    const label = spec?.label || key;
    const format = spec?.format || String;
    const valuesByQuarter = {};
    let grandTotalRaw = null;
    quarters.forEach((q) => {
      const v = byQuarter[q][key];
      valuesByQuarter[q] = v;
      if (key === 'fleet_mrrpv') {
        // weighted avg later
      } else if (key === 'avg_deal_size') {
        // computed from ACV / account_count at end
      } else {
        const n = Number(v);
        if (Number.isFinite(n)) grandTotalRaw = (grandTotalRaw ?? 0) + n;
      }
    });

    if (key === 'fleet_mrrpv') {
      const totalVehicles = quarters.reduce((s, q) => s + (Number(byQuarter[q].vehicle_count) || 0), 0);
      const sumWeighted = quarters.reduce((s, q) => s + (Number(byQuarter[q].fleet_mrrpv) || 0) * (Number(byQuarter[q].vehicle_count) || 0), 0);
      grandTotalRaw = totalVehicles > 0 ? Math.round((sumWeighted / totalVehicles) * 100) / 100 : null;
    } else if (key === 'avg_deal_size') {
      const totalAcv = quarters.reduce((s, q) => s + (Number(byQuarter[q].acv) || 0), 0);
      const totalAccounts = quarters.reduce((s, q) => s + (Number(byQuarter[q].account_count) || 0), 0);
      grandTotalRaw = totalAccounts > 0 ? Math.round((totalAcv / totalAccounts) * 100) / 100 : null;
    }

    return { label, key, valuesByQuarter, grandTotal: grandTotalRaw };
  });

  return { usePivot: true, timeColumns: quarters, metricRows };
}

/**
 * Build bridge pivot from bridge API response (one row per quarter + grandTotals).
 * Returns { usePivot: true, timeColumns, metricRows } with boldGrandTotal per row.
 */
function buildBridgePivot(dataRows, grandTotals = {}) {
  if (!dataRows?.length) return { usePivot: false };
  const quarters = [...new Set(dataRows.map((r) => r.close_quarter).filter(Boolean))].sort();
  if (quarters.length === 0) return { usePivot: false };
  const byQuarter = {};
  quarters.forEach((q) => {
    byQuarter[q] = dataRows.find((r) => r.close_quarter === q) || {};
  });
  const metricRows = BRIDGE_METRIC_ROWS.map((spec) => {
    const key = spec.dataKey ?? spec.key;
    const valuesByQuarter = {};
    quarters.forEach((q) => {
      valuesByQuarter[q] = byQuarter[q][key];
    });
    const grandTotal = grandTotals[key] ?? grandTotals[spec.key];
    return {
      key: spec.key,
      label: spec.label,
      valuesByQuarter,
      grandTotal,
      boldGrandTotal: spec.boldGrandTotal !== false,
      format: spec.format,
    };
  });
  return { usePivot: true, timeColumns: quarters, metricRows };
}

/** Map raw geo to super-geo: NA (US, CA, MX, US-SLED, US - SLED) or EMEA (UK, DACH, FR, BNL). Others pass through. */
const GEO_TO_SUPER = {
  US: 'NA', CA: 'NA', MX: 'NA', 'US-SLED': 'NA', 'US - SLED': 'NA',
  UK: 'EMEA', DACH: 'EMEA', FR: 'EMEA', BNL: 'EMEA',
};
function geoToSuperGeo(geo) {
  if (geo == null) return geo;
  const g = String(geo).trim().toUpperCase();
  return GEO_TO_SUPER[g] ?? GEO_TO_SUPER[geo] ?? geo;
}

/** Geo values that map to US-SLED (data may use either form). */
function isUSSLEDGeo(geo) {
  if (geo == null) return false;
  const g = String(geo).trim();
  return g === 'US-SLED' || g === 'US - SLED';
}

/** Canonical order for segment rows within each geo (NA/EMEA): regular segments first, then US-SLED breakouts. */
const SEGMENT_ORDER = ['CML', 'MM', 'ENT - COR', 'ENT - SEL', 'ENT - STR'];
/** US-SLED breakout rows in display order (after all regular segments). */
const GEO_SEGMENT_BREAKOUTS_ORDER = [
  { segment: 'MM', label: 'US-SLED - MM' },
  { segment: 'ENT - SEL', label: 'US-SLED - ENT - SEL' },
];

/** Metric column groups for grouped+time table: MRRpV, ACV, Vehicles, Accounts — each with quarter sub-columns only (totals in rows) */
const GROUPED_METRIC_SPECS = [
  { key: 'fleet_mrrpv', label: 'First Purchase MRRpV', format: (v) => (v != null && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—') },
  { key: 'acv', label: 'First Purchase ACV', format: formatAcvPivot },
  { key: 'vehicle_count', label: 'First Purchase Vehicles', format: (v) => (v != null && Number.isFinite(Number(v)) ? Number(v).toLocaleString() : '—') },
  { key: 'account_count', label: 'First Purchase Accounts', format: (v) => (v != null && Number.isFinite(Number(v)) ? Number(v).toLocaleString() : '—') },
];

/** For geo-segment and industry presets, only MRRpV and ACV are shown by default; vehicles and deal count can be toggled on. */
const DEFAULT_GROUPED_VISIBLE_KEYS = ['fleet_mrrpv', 'acv'];

/**
 * Build grouped + time pivot when data has (geo+segment OR industry) and close_quarter.
 * options: { includeVehicleCount?: boolean, includeAccountCount?: boolean } — when false/omitted, those column groups are hidden (user can ask to see them).
 */
function buildGroupedTimePivot(cols, dataRows, options = {}) {
  const timeCol = cols.find((c) => c.name === 'close_quarter');
  const hasGeo = cols.some((c) => c.name === 'geo');
  const hasSegment = cols.some((c) => c.name === 'segment');
  const hasIndustry = cols.some((c) => c.name === 'industry');
  const isGeoSegment = hasGeo && hasSegment;
  const isIndustry = hasIndustry && !isGeoSegment;
  if (!timeCol || (!isGeoSegment && !isIndustry) || !dataRows?.length) return { useGroupedPivot: false };

  const quarters = [...new Set(dataRows.map((r) => r.close_quarter).filter(Boolean))].sort();
  if (quarters.length === 0) return { useGroupedPivot: false };

  const visibleKeys = [...DEFAULT_GROUPED_VISIBLE_KEYS];
  if (options.includeVehicleCount) visibleKeys.push('vehicle_count');
  if (options.includeAccountCount) visibleKeys.push('account_count');
  const metricSpecs = GROUPED_METRIC_SPECS.filter(
    (m) => cols.some((c) => c.name === m.key) && visibleKeys.includes(m.key)
  );

  // For geo_segment, enrich rows with super_geo (NA/EMEA) and use that for grouping
  const rowsForGrouping = isGeoSegment
    ? dataRows.map((r) => ({ ...r, super_geo: geoToSuperGeo(r.geo) }))
    : dataRows;

  function aggQuarter(rows, metric) {
    if (metric === 'fleet_mrrpv') {
      const totalV = rows.reduce((s, r) => s + (Number(r.vehicle_count) || 0), 0);
      const sumW = rows.reduce((s, r) => s + (Number(r.fleet_mrrpv) || 0) * (Number(r.vehicle_count) || 0), 0);
      return totalV > 0 ? Math.round((sumW / totalV) * 100) / 100 : null;
    }
    if (metric === 'acv' || metric === 'vehicle_count' || metric === 'account_count') {
      return rows.reduce((s, r) => s + (Number(r[metric]) || 0), 0);
    }
    return null;
  }

  let rowGroups = [];
  let geoBlocks = null; // for geo-segment: [{ geo: 'NA', rows: [rowGroup,...] }, ...]; NA/EMEA are merged cells, not own rows
  if (isGeoSegment) {
    const superGeos = [...new Set(rowsForGrouping.map((r) => r.super_geo).filter(Boolean))].sort();
    geoBlocks = superGeos.map((superGeo) => {
      const segRows = rowsForGrouping.filter((r) => r.super_geo === superGeo);
      const segmentsInData = new Set(segRows.map((r) => r.segment).filter(Boolean));
      const blockRows = [];
      SEGMENT_ORDER.forEach((segment) => {
        if (segmentsInData.has(segment)) {
          blockRows.push({ type: 'segment', super_geo: superGeo, segment });
        }
      });
      GEO_SEGMENT_BREAKOUTS_ORDER.forEach((breakout) => {
        if (segRows.some((r) => isUSSLEDGeo(r.geo) && r.segment === breakout.segment)) {
          blockRows.push({ type: 'geo_segment', super_geo: superGeo, geo: 'US-SLED', segment: breakout.segment, label: breakout.label });
        }
      });
      blockRows.push({ type: 'total', label: 'Total', super_geo: superGeo });
      return { geo: superGeo, rows: blockRows };
    });
    rowGroups = geoBlocks.flatMap((b) => b.rows);
    rowGroups.push({ type: 'grand', label: 'Grand Total' });
  } else {
    const industries = [...new Set(dataRows.map((r) => r.industry).filter(Boolean))].sort();
    industries.forEach((industry) => {
      rowGroups.push({ type: 'industry', industry });
    });
    rowGroups.push({ type: 'grand', label: 'Grand Total' });
  }

  function getValue(rowGroup, metric, quarter) {
    let rows;
    if (rowGroup.type === 'segment') {
      rows = rowsForGrouping.filter(
        (r) =>
          r.super_geo === rowGroup.super_geo &&
          r.segment === rowGroup.segment &&
          r.close_quarter === quarter &&
          !(isUSSLEDGeo(r.geo) && (rowGroup.segment === 'MM' || rowGroup.segment === 'ENT - SEL'))
      );
    } else if (rowGroup.type === 'geo_segment') {
      rows = rowsForGrouping.filter(
        (r) =>
          r.super_geo === rowGroup.super_geo &&
          isUSSLEDGeo(r.geo) &&
          r.segment === rowGroup.segment &&
          r.close_quarter === quarter
      );
    } else if (rowGroup.type === 'total') {
      rows = rowsForGrouping.filter((r) => r.super_geo === rowGroup.super_geo && r.close_quarter === quarter);
    } else if (rowGroup.type === 'industry') {
      rows = dataRows.filter((r) => r.industry === rowGroup.industry && r.close_quarter === quarter);
    } else if (rowGroup.type === 'grand') {
      rows = rowsForGrouping.filter((r) => r.close_quarter === quarter);
    } else {
      return null; // geo header row has no values
    }
    if (rows.length === 0) return null;
    return aggQuarter(rows, metric);
  }

  /** Weighted average MRRpV across all quarters for this row (sum(mrrpv*vehicles)/sum(vehicles)). */
  function getWeightedAvgMrrpv(rowGroup) {
    let sumWeighted = 0;
    let sumVehicles = 0;
    quarters.forEach((q) => {
      const mrrpv = getValue(rowGroup, 'fleet_mrrpv', q);
      const vehicles = getValue(rowGroup, 'vehicle_count', q);
      const v = Number(vehicles) || 0;
      const m = Number(mrrpv) || 0;
      sumWeighted += m * v;
      sumVehicles += v;
    });
    return sumVehicles > 0 ? Math.round((sumWeighted / sumVehicles) * 100) / 100 : null;
  }

  return { useGroupedPivot: true, timeColumns: quarters, metricSpecs, rowGroups, geoBlocks, getValue, getWeightedAvgMrrpv, isGeoSegment };
}

function SimpleBarChart({ data, columns, excludeOverall }) {
  const rows = excludeOverall && data?.length > 1 ? data.slice(0, -1) : data;
  const valueCol = columns?.find((c) => c.name === 'fleet_mrrpv' || c.name === 'vehicle_count') || columns?.[1];
  const labelCol = columns?.find((c) => c.name === 'industry' || c.name === 'segment' || c.name === 'geo' || c.name === 'close_quarter') || columns?.[0];
  if (!valueCol || !labelCol || !rows?.length) return null;
  const maxVal = Math.max(...rows.map((r) => Number(r[valueCol.name]) || 0), 1);
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {rows.slice(0, 20).map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ width: 120, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {row[labelCol.name] != null ? String(row[labelCol.name]) : '—'}
            </span>
            <div
              style={{
                flex: 1,
                height: 24,
                background: '#27272a',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${(100 * (Number(row[valueCol.name]) || 0)) / maxVal}%`,
                  height: '100%',
                  background: '#3b82f6',
                  borderRadius: 4,
                }}
              />
            </div>
            <span style={{ fontSize: '0.875rem', width: 80, textAlign: 'right' }}>
              {formatCell(valueCol.name, row[valueCol.name])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminPage() {
  const [config, setConfig] = useState(null);
  const [usage, setUsage] = useState(null);
  const [feedbackList, setFeedbackList] = useState(null);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState(null);

  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    if (secret) h['X-Admin-Secret'] = secret;
    return h;
  };

  useEffect(() => {
    fetch(`${API}/admin/config`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Forbidden or error'))))
      .then(setConfig)
      .catch(() => setConfig(null));
    fetch(`${API}/admin/usage`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Forbidden or error'))))
      .then(setUsage)
      .catch(() => setUsage(null));
    fetch(`${API}/admin/feedback`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Forbidden or error'))))
      .then(setFeedbackList)
      .catch(() => setFeedbackList(null));
  }, [secret]);

  const handleSaveConfig = (e) => {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    fetch(`${API}/admin/config`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({
        systemPrompt: config.systemPrompt,
        modelId: config.modelId,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setConfig)
      .catch(() => setError('Save failed'))
      .finally(() => setSaving(false));
  };

  if (config === null && !secret) {
    return (
      <div style={{ padding: '2rem', maxWidth: 600 }}>
        <h2>Admin</h2>
        <p style={{ color: '#a1a1aa' }}>Optional: enter admin secret if configured.</p>
        <input
          type="password"
          placeholder="Admin secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          style={{ padding: '0.5rem', marginRight: '0.5rem', width: 200 }}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 800 }}>
      <h2 style={{ marginBottom: '1rem' }}>Admin</h2>
      <p style={{ marginBottom: '1rem' }}>
        <a href="#" style={{ color: '#3b82f6' }}>Back to app</a>
      </p>
      {error && <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</p>}
      {config && (
        <form onSubmit={handleSaveConfig} style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Model behavior</h3>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>System prompt</label>
          <textarea
            value={config.systemPrompt || ''}
            onChange={(e) => setConfig((c) => ({ ...c, systemPrompt: e.target.value }))}
            rows={6}
            style={{ width: '100%', padding: '0.5rem', marginBottom: '0.75rem', fontFamily: 'inherit', fontSize: '0.875rem' }}
          />
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem' }}>Model ID</label>
          <input
            type="text"
            value={config.modelId || ''}
            onChange={(e) => setConfig((c) => ({ ...c, modelId: e.target.value }))}
            style={{ width: 200, padding: '0.5rem', marginBottom: '0.75rem', display: 'block' }}
          />
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem' }}>Temperature</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={config.temperature ?? 0.2}
            onChange={(e) => setConfig((c) => ({ ...c, temperature: Number(e.target.value) }))}
            style={{ width: 80, padding: '0.5rem', marginBottom: '0.75rem', display: 'block' }}
          />
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem' }}>Max tokens</label>
          <input
            type="number"
            value={config.maxTokens ?? 1024}
            onChange={(e) => setConfig((c) => ({ ...c, maxTokens: Number(e.target.value) }))}
            style={{ width: 80, padding: '0.5rem', marginBottom: '0.75rem', display: 'block' }}
          />
          <button type="submit" disabled={saving} style={{ padding: '0.5rem 1rem', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : 'Save config'}
          </button>
        </form>
      )}
      {usage && (
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Usage</h3>
          <p style={{ fontSize: '0.875rem', color: '#a1a1aa', marginBottom: '0.5rem' }}>
            Total requests: {usage.stats?.totalRequests ?? 0} · Errors: {usage.stats?.errorCount ?? 0} (rate: {usage.stats?.errorRate ?? 0})
          </p>
          <p style={{ fontSize: '0.875rem', color: '#a1a1aa', marginBottom: '0.5rem' }}>
            Top tools: {(usage.stats?.topTools || []).map((t) => `${t.name}: ${t.count}`).join(', ')}
          </p>
          <h4 style={{ fontSize: '0.875rem', marginTop: '1rem' }}>Recent requests</h4>
          <div style={{ overflowX: 'auto', maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.25rem' }}>Time</th>
                  <th style={{ textAlign: 'left', padding: '0.25rem' }}>Message</th>
                  <th style={{ textAlign: 'left', padding: '0.25rem' }}>Tools</th>
                  <th style={{ textAlign: 'left', padding: '0.25rem' }}>Latency</th>
                  <th style={{ textAlign: 'left', padding: '0.25rem' }}>OK</th>
                </tr>
              </thead>
              <tbody>
                {(usage.recent || []).map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: '0.25rem' }}>{r.ts}</td>
                    <td style={{ padding: '0.25rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.message}</td>
                    <td style={{ padding: '0.25rem' }}>{(r.toolCalls || []).map((t) => t.name).join(', ')}</td>
                    <td style={{ padding: '0.25rem' }}>{r.latencyMs}ms</td>
                    <td style={{ padding: '0.25rem' }}>{r.success ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {feedbackList && (
        <div>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>User feedback</h3>
          <p style={{ fontSize: '0.875rem', color: '#a1a1aa', marginBottom: '0.5rem' }}>
            Thumbs up/down and optional comments on agent responses. Newest first.
          </p>
          <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #3f3f46' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #3f3f46' }}>Feedback</th>
                  <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #3f3f46' }}>User prompt</th>
                  <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #3f3f46' }}>Agent response</th>
                  <th style={{ textAlign: 'left', padding: '0.35rem', borderBottom: '1px solid #3f3f46' }}>Comment</th>
                </tr>
              </thead>
              <tbody>
                {(feedbackList.items || []).map((item) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #27272a' }}>
                    <td style={{ padding: '0.35rem', whiteSpace: 'nowrap' }}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</td>
                    <td style={{ padding: '0.35rem' }}>{item.feedback === 'down' ? '👎 Down' : '👍 Up'}</td>
                    <td style={{ padding: '0.35rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.userPrompt}>{item.userPrompt || '—'}</td>
                    <td style={{ padding: '0.35rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.agentResponse}>{item.agentResponse || '—'}</td>
                    <td style={{ padding: '0.35rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.comment}>{item.comment || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(feedbackList.items || []).length === 0 && (
            <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.5rem' }}>No feedback yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

const DATA_SOURCE_OPTIONS = [
  { id: 'first_purchase', label: 'First purchases' },
  { id: 'upsell', label: 'Upsell' },
  { id: 'fleet', label: 'Fleet overall' },
];

export default function App() {
  const [health, setHealth] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [lastToolError, setLastToolError] = useState(null);
  const [querySummary, setQuerySummary] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [dataSource, setDataSource] = useState('first_purchase');
  const [views, setViews] = useState([]);
  const [viewsLoadError, setViewsLoadError] = useState(null);
  const [selectedViewId, setSelectedViewId] = useState('');
  const [viewLoading, setViewLoading] = useState(false);
  const [showVehiclesInGrouped, setShowVehiclesInGrouped] = useState(false);
  const [showDealCountInGrouped, setShowDealCountInGrouped] = useState(false);
  const [feedbackByIndex, setFeedbackByIndex] = useState({});
  const [feedbackComment, setFeedbackComment] = useState({});
  const bottomRef = useRef(null);
  const isAdmin = typeof window !== 'undefined' && window.location.hash === '#admin';

  useEffect(() => {
    fetch(`${API.replace('/api', '')}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  function loadViews() {
    setViewsLoadError(null);
    fetch(`${API}/views`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((list) => {
        setViews(Array.isArray(list) ? list : []);
        setViewsLoadError(null);
      })
      .catch((err) => {
        setViews([]);
        const msg = err.message || 'Could not load preset views';
        setViewsLoadError(msg === 'Failed to fetch' ? 'Backend not reachable—run npm run dev from project root' : msg);
      });
  }

  useEffect(() => {
    loadViews();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function runPresetView(viewId) {
    const view = views.find((v) => v.id === viewId);
    if (!view) return;
    setViewLoading(true);
    setLastToolError(null);
    try {
      const p = view.defaultParams || {};
      const body = {
        dataSource: p.dataSource ?? dataSource,
        timeWindow: p.timeWindow,
        groupBy: p.groupBy,
        filters: p.filters || {},
        includeProduct: p.includeProduct,
        includeAccountCount: p.includeAccountCount ?? true,
        includeAvgDealSize: p.includeAvgDealSize ?? false,
        viewType: p.viewType,
        presetId: view.id,
        ...(p.viewType === 'asp' && { products: p.products || ['cm', 'vg', 'aim4'] }),
      };
      const res = await fetch(`${API}/query/mrrpv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLastResult(null);
        setLastToolError(result.error || `Request failed (${res.status})`);
        setQuerySummary(null);
        return;
      }
      setLastResult({
        data: result.data,
        columns: result.columns,
        rowCount: result.rows?.length ?? result.data?.length ?? 0,
        overall: result.overall,
        viewType: result.viewType,
        grandTotals: result.grandTotals,
      });
      setQuerySummary({
        tool: 'get_mrrpv',
        dataSource: body.dataSource,
        time_window: body.timeWindow,
        group_by: body.groupBy,
        include_product: body.includeProduct,
        viewType: result.viewType,
        products: result.viewType === 'asp' ? (body.products || ['cm', 'vg', 'aim4']) : undefined,
        region: body.filters?.region,
        segment: body.filters?.segment,
      });
    } catch (err) {
      setLastResult(null);
      setLastToolError(err.message || 'Request failed');
      setQuerySummary(null);
    } finally {
      setViewLoading(false);
    }
  }

  async function sendChatMessage(userMessage) {
    if (!userMessage?.trim() || loading) return;
    const text = userMessage.trim();
    setMessage('');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setLoading(true);
    setLastResult(null);
    setLastToolError(null);
    try {
      const view = selectedViewId ? views.find((v) => v.id === selectedViewId) : null;
      const currentView =
        view || querySummary
          ? {
              presetId: selectedViewId || undefined,
              label: view?.label || (querySummary?.group_by ? `MRRpV by ${querySummary.group_by}` : 'MRRpV'),
              time_window: querySummary?.time_window,
              group_by: querySummary?.group_by,
              region: querySummary?.region,
              segment: querySummary?.segment,
              regions: querySummary?.regions,
              exclude_regions: querySummary?.exclude_regions,
              segments: querySummary?.segments,
              exclude_segments: querySummary?.exclude_segments,
              industries: querySummary?.industries,
              exclude_industries: querySummary?.exclude_industries,
              include_product: querySummary?.include_product,
              products: querySummary?.products,
              include_acv: querySummary?.include_acv,
            }
          : undefined;
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId || undefined,
          dataSource: dataSource || 'fleet',
          currentView: currentView || undefined,
        }),
      });
      let data;
      try {
        data = await res.json();
      } catch (_) {
        throw new Error(res.ok ? 'Invalid response from server' : `Request failed (${res.status})`);
      }
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setConversationId(data.conversationId);
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
      if (data.lastResult) setLastResult(data.lastResult);
      setLastToolError(data.lastToolError ?? null);
      setQuerySummary(data.querySummary || null);
    } catch (err) {
      const msg = err.message || 'Request failed';
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim() || loading) return;
    await sendChatMessage(message.trim());
  }

  async function restoreUnfilteredView() {
    if (!selectedViewId || loading) return;
    setLoading(true);
    setLastToolError(null);
    try {
      const res = await fetch(`${API}/views/run-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId: selectedViewId, dataSource: dataSource || 'first_purchase' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLastResult(null);
        setLastToolError(data.error || `Request failed (${res.status})`);
        setQuerySummary(null);
        return;
      }
      setLastResult({
        data: data.data,
        columns: data.columns,
        rowCount: data.rowCount,
        overall: data.overall,
        viewType: data.viewType,
        grandTotals: data.grandTotals,
      });
      setQuerySummary(data.querySummary || null);
      setMessages((m) => [...m, { role: 'assistant', content: 'Unfiltered view restored.' }]);
    } catch (err) {
      setLastResult(null);
      setLastToolError(err.message || 'Request failed');
      setQuerySummary(null);
    } finally {
      setLoading(false);
    }
  }

  const hasActiveFilters =
    querySummary &&
    ((querySummary.exclude_regions?.length ?? 0) > 0 ||
      (querySummary.exclude_segments?.length ?? 0) > 0 ||
      (querySummary.exclude_industries?.length ?? 0) > 0 ||
      (querySummary.regions?.length ?? 0) > 0 ||
      (querySummary.segments?.length ?? 0) > 0 ||
      (querySummary.industries?.length ?? 0) > 0);

  if (isAdmin) return <AdminPage />;

  return (
    <div style={{ padding: '2rem', paddingBottom: '60vh', maxWidth: 800, margin: '0 auto', minHeight: '100vh' }}>
      <h1 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Data-Agent</h1>
      <p style={{ color: '#a1a1aa', marginBottom: '0.5rem' }}>
        <a href="#admin" style={{ color: '#71717a', fontSize: '0.875rem' }}>Admin</a>
      </p>
      <p style={{ color: '#a1a1aa', marginBottom: '1.5rem' }}>
        Ask for MRRpV or other metrics in plain language. Example: &ldquo;What was MRRpV by region last quarter?&rdquo;
      </p>
      {health && (
        <p style={{ color: health.ok ? '#22c55e' : '#ef4444', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Backend: {health.ok ? 'Connected' : 'Disconnected'}
        </p>
      )}

      <div style={{ marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.875rem', color: '#a1a1aa', marginRight: '0.75rem' }}>Views:</span>
        <select
          value={selectedViewId}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedViewId(id);
            if (id) runPresetView(id);
          }}
          disabled={viewLoading}
          style={{
            padding: '0.5rem 0.75rem',
            fontSize: '0.875rem',
            background: '#18181b',
            border: '1px solid #27272a',
            borderRadius: 6,
            color: '#e4e4e7',
            minWidth: 260,
            marginRight: '0.5rem',
          }}
        >
          <option value="">Select a preset view…</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        {viewLoading && <span style={{ fontSize: '0.875rem', color: '#71717a' }}>Loading…</span>}
        {viewsLoadError && (
          <span style={{ fontSize: '0.75rem', color: '#f59e0b', marginLeft: '0.5rem' }}>
            Preset views didn’t load
            {viewsLoadError !== 'Could not load preset views' && ` (${viewsLoadError})`}
            {' · '}
            <button
              type="button"
              onClick={loadViews}
              style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit', padding: 0 }}
            >
              Retry
            </button>
          </span>
        )}
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.875rem', color: '#a1a1aa', marginRight: '0.75rem' }}>Data source:</span>
        <div style={{ display: 'inline-flex', gap: 0, background: '#18181b', border: '1px solid #27272a', borderRadius: 6, padding: 2 }}>
          {DATA_SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setDataSource(opt.id)}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                background: dataSource === opt.id ? '#3b82f6' : 'transparent',
                color: dataSource === opt.id ? '#fff' : '#a1a1aa',
                fontWeight: dataSource === opt.id ? 600 : 400,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          background: '#18181b',
          borderRadius: 6,
          border: '1px solid #27272a',
          padding: '0.35rem 0.5rem',
          marginBottom: '0.5rem',
          minHeight: 52,
          maxHeight: 100,
          overflowY: 'auto',
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: '#71717a', fontSize: '0.7rem', margin: 0 }}>
            Send a message to get started.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: '0.2rem',
              padding: '0.15rem 0',
              borderBottom: i < messages.length - 1 ? '1px solid #27272a' : 'none',
            }}
          >
            <span style={{ color: '#71717a', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase' }}>
              {m.role === 'user' ? 'You' : 'Assistant'}
            </span>
            <p style={{ margin: '0.1rem 0 0', whiteSpace: 'pre-wrap', fontSize: '0.7rem', lineHeight: 1.25 }}>{m.content}</p>
            {m.role === 'assistant' && (() => {
              const userPrompt = i > 0 && messages[i - 1]?.role === 'user' ? messages[i - 1].content : '';
              const fb = feedbackByIndex[i];
              if (fb?.commentSubmitted) {
                return (
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.7rem', color: '#22c55e' }}>Thanks! Your comment was submitted.</p>
                );
              }
              if (fb?.id) {
                return (
                  <div style={{ marginTop: '0.35rem' }}>
                    <p style={{ fontSize: '0.7rem', color: '#22c55e', marginBottom: '0.25rem' }}>Thanks for your feedback! Would you like to add a comment?</p>
                    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        value={feedbackComment[i] ?? ''}
                        onChange={(e) => setFeedbackComment((c) => ({ ...c, [i]: e.target.value }))}
                        placeholder="Optional comment for review..."
                        maxLength={2000}
                        style={{
                          flex: 1,
                          minWidth: 180,
                          padding: '0.35rem 0.5rem',
                          fontSize: '0.75rem',
                          background: '#27272a',
                          border: '1px solid #3f3f46',
                          borderRadius: 4,
                          color: '#e4e4e7',
                        }}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const comment = (feedbackComment[i] ?? '').trim();
                          if (!fb?.id) return;
                          try {
                            const res = await fetch(`${API}/feedback/${fb.id}/comment`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ comment }),
                            });
                            if (res.ok) {
                              setFeedbackByIndex((prev) => ({ ...prev, [i]: { ...prev[i], commentSubmitted: true } }));
                              setFeedbackComment((c) => ({ ...c, [i]: '' }));
                            }
                          } catch (_) {}
                        }}
                        style={{
                          padding: '0.35rem 0.6rem',
                          fontSize: '0.75rem',
                          background: '#3b82f6',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        Submit comment
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div style={{ marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.65rem', color: '#71717a' }}>Was this helpful?</span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(`${API}/feedback`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ feedback: 'up', userPrompt, agentResponse: m.content }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (data.id) setFeedbackByIndex((prev) => ({ ...prev, [i]: { id: data.id, feedback: 'up' } }));
                      } catch (_) {}
                    }}
                    title="Yes, helpful"
                    style={{
                      padding: '0.2rem 0.35rem',
                      background: 'transparent',
                      border: '1px solid #3f3f46',
                      borderRadius: 4,
                      color: '#a1a1aa',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(`${API}/feedback`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ feedback: 'down', userPrompt, agentResponse: m.content }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (data.id) setFeedbackByIndex((prev) => ({ ...prev, [i]: { id: data.id, feedback: 'down' } }));
                      } catch (_) {}
                    }}
                    title="No, not helpful"
                    style={{
                      padding: '0.2rem 0.35rem',
                      background: 'transparent',
                      border: '1px solid #3f3f46',
                      borderRadius: 4,
                      color: '#a1a1aa',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    👎
                  </button>
                </div>
              );
            })()}
          </div>
        ))}
        {loading && (
          <p style={{ color: '#71717a', fontSize: '0.875rem' }}>Thinking...</p>
        )}
        <div ref={bottomRef} />
      </div>

      {querySummary && (
        <p style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '0.5rem' }}>
          This query used: {querySummary.tool}
          {querySummary.dataSource ? `, source: ${querySummary.dataSource}` : ''}
          {querySummary.time_window ? `, time: ${querySummary.time_window}` : ''}
          {querySummary.group_by ? `, by ${querySummary.group_by}` : ''}
          {querySummary.include_product?.length ? `, included product(s): ${Array.isArray(querySummary.include_product) ? querySummary.include_product.join(', ') : querySummary.include_product}` : ''}
          {querySummary.region ? `, region: ${querySummary.region}` : ''}
          {querySummary.regions?.length ? `, regions: ${querySummary.regions.join(', ')}` : ''}
          {querySummary.exclude_regions?.length ? `, exclude regions: ${querySummary.exclude_regions.join(', ')}` : ''}
          {querySummary.segment ? `, segment: ${querySummary.segment}` : ''}
          {querySummary.segments?.length ? `, segments: ${querySummary.segments.join(', ')}` : ''}
          {querySummary.exclude_segments?.length ? `, exclude segments: ${querySummary.exclude_segments.join(', ')}` : ''}
          {querySummary.industries?.length ? `, industries: ${querySummary.industries.join(', ')}` : ''}
          {querySummary.exclude_industries?.length ? `, exclude industries: ${querySummary.exclude_industries.join(', ')}` : ''}
          {querySummary.include_acv === false ? ', ACV columns hidden' : ''}
        </p>
      )}
      {querySummary && lastToolError && (
        <p style={{ fontSize: '0.875rem', color: '#f59e0b', marginBottom: '0.5rem', padding: '0.5rem', background: 'rgba(245, 158, 11, 0.1)', borderRadius: 6 }}>
          Query failed: {lastToolError}
        </p>
      )}
      {lastResult && lastResult.data?.length === 0 && !lastToolError && (
        <p style={{ fontSize: '0.875rem', color: '#71717a', marginBottom: '0.5rem' }}>No rows for that period or filters.</p>
      )}
      {lastResult && lastResult.data?.length > 0 && (() => {
        const cols = lastResult.columns || [];
        const dataRows = lastResult.data;
        const hasGroupCol = cols.some((c) => ['industry', 'segment', 'geo'].includes(c.name));
        const hasAcv = cols.some((c) => c.name === 'acv');
        const hasMultipleRows = dataRows.length > 1;
        let displayData = dataRows;
        if (hasMultipleRows && hasGroupCol) {
          const totalCount = dataRows.reduce((s, r) => s + (Number(r.vehicle_count) || 0), 0);
          const totalAcv = hasAcv ? dataRows.reduce((s, r) => s + (Number(r.acv) || 0), 0) : null;
          const sumMrrpvWeighted = dataRows.reduce((s, r) => s + (Number(r.fleet_mrrpv) || 0) * (Number(r.vehicle_count) || 0), 0);
          const weightedMrrpv = totalCount > 0 ? sumMrrpvWeighted / totalCount : null;
          const overallRow = { [cols[0].name]: 'Overall', fleet_mrrpv: weightedMrrpv != null ? Math.round(weightedMrrpv * 100) / 100 : null, vehicle_count: totalCount };
          if (hasAcv) overallRow.acv = totalAcv;
          const hasAccountCount = cols.some((c) => c.name === 'account_count');
          const hasAvgDealSize = cols.some((c) => c.name === 'avg_deal_size');
          if (hasAccountCount) overallRow.account_count = dataRows.reduce((s, r) => s + (Number(r.account_count) || 0), 0);
          if (hasAvgDealSize && hasAcv && overallRow.account_count > 0) overallRow.avg_deal_size = Math.round((totalAcv / overallRow.account_count) * 100) / 100;
          if (cols.some((c) => c.name === 'close_quarter')) overallRow.close_quarter = dataRows[0]?.close_quarter ?? '';
          displayData = [...dataRows, overallRow];
        }
        const groupedPivot = buildGroupedTimePivot(cols, dataRows, {
          includeVehicleCount: showVehiclesInGrouped,
          includeAccountCount: showDealCountInGrouped,
        });
        const pivot = buildTimePivot(cols, dataRows);
        const bridgePivot = lastResult.viewType === 'bridge' ? buildBridgePivot(lastResult.data, lastResult.grandTotals) : null;
        const maxDisplay = 100;
        const tableRows = displayData.slice(0, maxDisplay);
        const o = lastResult.overall;
        const specFor = (key) => TIME_METRIC_ROWS.find((m) => m.key === key);
        return (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: '0.875rem', color: '#a1a1aa', margin: 0 }}>Result</h3>
              <button
                type="button"
                onClick={() => restoreUnfilteredView()}
                disabled={loading || !selectedViewId}
                title={hasActiveFilters ? 'Clear all filters and show full table' : 'Re-run current view with no row filters'}
                style={{
                  fontSize: '0.75rem',
                  padding: '0.35rem 0.6rem',
                  background: '#27272a',
                  border: '1px solid #3f3f46',
                  borderRadius: 6,
                  color: '#a1a1aa',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Restore unfiltered view
              </button>
            </div>
            {o && !pivot.usePivot && !groupedPivot.useGroupedPivot && !bridgePivot?.usePivot && (
              <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem', color: '#e4e4e7' }}>
                <strong>Overall:</strong>
                {o.fleet_mrrpv != null && ` $${Number(o.fleet_mrrpv).toFixed(2)} MRRpV`}
                {o.vehicle_count != null && ` · ${Number(o.vehicle_count).toLocaleString()} vehicles`}
                {o.acv != null && ` · $${Number(o.acv).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ACV`}
                {o.account_count != null && ` · ${Number(o.account_count).toLocaleString()} accounts`}
                {o.avg_deal_size != null && ` · $${Number(o.avg_deal_size).toFixed(2)} avg deal size`}
              </p>
            )}
            {cols.length >= 2 && cols.length <= 5 && !pivot.usePivot && !groupedPivot.useGroupedPivot && lastResult.viewType !== 'asp' ? (
              <SimpleBarChart data={displayData} columns={cols} excludeOverall={hasMultipleRows && hasGroupCol} />
            ) : null}
            {lastResult.viewType === 'asp' && cols.some((c) => c.name === 'row_label') ? (
              (() => {
                const quarterCols = cols.filter((c) => c.name !== 'row_label');
                const borderThin = '1px solid #27272a';
                const borderThick = '2px solid #3f3f46';
                const productBlocks = [];
                let i = 0;
                while (i < displayData.length) {
                  const row = displayData[i];
                  const label = row.row_label || '';
                  const aspMatch = label.match(/^(.+?)\s+ASP$/);
                  const acvMatch = label.match(/^(.+?)\s+ACV$/);
                  const productName = aspMatch ? aspMatch[1] : acvMatch ? acvMatch[1] : label;
                  const metrics = [];
                  while (i < displayData.length) {
                    const r = displayData[i];
                    const l = r.row_label || '';
                    const p = l.endsWith(' ASP') ? l.slice(0, -4) : l.endsWith(' ACV') ? l.slice(0, -4) : null;
                    if (p !== productName && metrics.length > 0) break;
                    if (l.endsWith(' ASP')) metrics.push({ type: 'ASP', row: r });
                    else if (l.endsWith(' ACV')) metrics.push({ type: 'ACV', row: r });
                    else metrics.push({ type: l || 'Metric', row: r });
                    i++;
                  }
                  productBlocks.push({ productName, metrics });
                }
                return (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div style={{ overflowX: 'auto', border: '1px solid #27272a', borderRadius: 6 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46', minWidth: '8.5rem' }}>Product</th>
                            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46', minWidth: '4rem' }}>Metric</th>
                            {quarterCols.map((c) => (
                              <th key={c.name} style={{ textAlign: 'right', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46', minWidth: '4.5rem', whiteSpace: 'nowrap' }}>
                                {c.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {productBlocks.map((block, blockIdx) => {
                            const rowSpan = block.metrics.length;
                            const borderAfter = blockIdx < productBlocks.length - 1 ? borderThick : undefined;
                            return block.metrics.map((m, metricIdx) => (
                              <tr key={`${block.productName}-${m.type}`} style={{ borderBottom: metricIdx < block.metrics.length - 1 ? borderThin : (borderAfter || borderThin) }}>
                                {metricIdx === 0 && (
                                  <td
                                    rowSpan={rowSpan}
                                    style={{
                                      padding: '0.5rem 0.75rem',
                                      fontWeight: 500,
                                      verticalAlign: 'middle',
                                      borderBottom: borderAfter || borderThin,
                                      borderRight: borderThin,
                                    }}
                                  >
                                    {block.productName}
                                  </td>
                                )}
                                <td style={{ padding: '0.5rem 0.75rem', borderBottom: metricIdx < block.metrics.length - 1 ? borderThin : (borderAfter || borderThin), borderRight: borderThin }}>
                                  {m.type}
                                </td>
                                {quarterCols.map((c) => {
                                  const v = m.row[c.name];
                                  const isASP = m.type === 'ASP';
                                  let fmt = '—';
                                  if (v != null && Number.isFinite(Number(v))) {
                                    fmt = isASP ? `$${Number(v).toFixed(2)}` : formatAcvPivot(Number(v));
                                  }
                                  return (
                                    <td key={c.name} style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#3b82f6', borderBottom: metricIdx < block.metrics.length - 1 ? borderThin : (borderAfter || borderThin) }}>
                                      {fmt}
                                    </td>
                                  );
                                })}
                              </tr>
                            ));
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()
            ) : bridgePivot?.usePivot ? (
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ overflowX: 'auto', border: '1px solid #27272a', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46' }} />
                        {bridgePivot.timeColumns.map((q) => (
                          <th key={q} style={{ textAlign: 'right', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46', minWidth: '4.5rem', whiteSpace: 'nowrap' }}>
                            {q}
                          </th>
                        ))}
                        <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46' }}>
                          Grand Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {bridgePivot.metricRows.map((row) => {
                        const fmt = row.format || String;
                        return (
                          <tr key={row.key} style={{ borderBottom: '1px solid #27272a' }}>
                            <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{row.label}</td>
                            {bridgePivot.timeColumns.map((q) => (
                              <td key={q} style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#3b82f6' }}>
                                {fmt(row.valuesByQuarter[q])}
                              </td>
                            ))}
                            <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#3b82f6', fontWeight: row.boldGrandTotal ? 600 : undefined }}>
                              {fmt(row.grandTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : groupedPivot.useGroupedPivot ? (
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', fontSize: '0.8125rem', color: '#a1a1aa' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showVehiclesInGrouped}
                      onChange={(e) => setShowVehiclesInGrouped(e.target.checked)}
                    />
                    Show Vehicles
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showDealCountInGrouped}
                      onChange={(e) => setShowDealCountInGrouped(e.target.checked)}
                    />
                    Show Deal count
                  </label>
                </div>
                <div style={{ overflowX: 'auto', border: '1px solid #27272a', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr>
                      {groupedPivot.isGeoSegment && (
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46' }}>Geo</th>
                      )}
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46', minWidth: groupedPivot.isGeoSegment ? '8.5rem' : undefined }}>
                        {groupedPivot.isGeoSegment ? 'Segment' : 'Industry'}
                      </th>
                      {groupedPivot.metricSpecs.map((spec, specIdx) => (
                        <th
                          key={spec.key}
                          colSpan={groupedPivot.timeColumns.length}
                          style={{
                            textAlign: 'center',
                            padding: '0.5rem 0.75rem',
                            background: '#27272a',
                            borderBottom: '1px solid #3f3f46',
                            borderRight: '2px solid #3f3f46',
                          }}
                        >
                          {spec.label}
                        </th>
                      ))}
                      <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46' }}>
                        Avg MRRpV
                      </th>
                    </tr>
                    <tr>
                      {groupedPivot.isGeoSegment && <th style={{ padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46' }} />}
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46', minWidth: groupedPivot.isGeoSegment ? '8.5rem' : undefined }} />
                      {groupedPivot.metricSpecs.map((spec) => (
                        <React.Fragment key={spec.key}>
                          {groupedPivot.timeColumns.map((q, qi) => (
                            <th
                              key={q}
                              style={{
                                textAlign: 'right',
                                padding: '0.5rem 0.75rem',
                                background: '#27272a',
                                borderBottom: '1px solid #3f3f46',
                                borderRight: qi === groupedPivot.timeColumns.length - 1 ? '2px solid #3f3f46' : undefined,
                                minWidth: '4.5rem',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {q}
                            </th>
                          ))}
                        </React.Fragment>
                      ))}
                      <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {groupedPivot.isGeoSegment && groupedPivot.geoBlocks ? (
                      (() => {
                        const borderThick = '2px solid #3f3f46';
                        const borderThin = '1px solid #27272a';
                        const totalBg = 'rgba(59, 130, 246, 0.08)';
                        const bodyRows = [];
                        groupedPivot.geoBlocks.forEach((block, blockIdx) => {
                          block.rows.forEach((rowGroup, rowIdx) => {
                            const segmentLabel = rowGroup.type === 'segment' ? rowGroup.segment : rowGroup.type === 'geo_segment' ? rowGroup.label : 'Total';
                            const isTotal = rowGroup.type === 'total';
                            const isFirstInBlock = rowIdx === 0;
                            const borderBefore = isFirstInBlock && blockIdx > 0 ? borderThick : undefined;
                            const borderAfter = isTotal ? borderThick : borderThin;
                            bodyRows.push({
                              rowGroup,
                              segmentLabel,
                              blockGeo: block.geo,
                              isFirstInBlock,
                              blockRowCount: block.rows.length,
                              isGrandTotal: false,
                              borderBefore,
                              borderAfter,
                              isTotal,
                            });
                          });
                        });
                        bodyRows.push({
                          rowGroup: groupedPivot.rowGroups[groupedPivot.rowGroups.length - 1],
                          segmentLabel: 'Grand Total',
                          blockGeo: null,
                          isFirstInBlock: false,
                          blockRowCount: 1,
                          isGrandTotal: true,
                          borderBefore: borderThick,
                          borderAfter: borderThick,
                          isTotal: true,
                        });
                        return bodyRows.map((br, ri) => (
                          <tr
                            key={ri}
                            style={{
                              fontWeight: br.isTotal ? 600 : undefined,
                              background: br.isTotal ? totalBg : undefined,
                              borderTop: br.borderBefore,
                              borderBottom: br.borderAfter,
                            }}
                          >
                            {br.isFirstInBlock ? (
                              <td
                                rowSpan={br.blockRowCount}
                                style={{
                                  padding: '0.5rem 0.75rem',
                                  borderBottom: br.borderAfter,
                                  borderTop: br.borderBefore,
                                  borderRight: borderThin,
                                  fontWeight: 600,
                                  verticalAlign: 'top',
                                }}
                              >
                                {br.blockGeo}
                              </td>
                            ) : br.isGrandTotal ? (
                              <td style={{ padding: '0.5rem 0.75rem', borderBottom: br.borderAfter, borderTop: br.borderBefore, borderRight: borderThin }} />
                            ) : null}
                            <td style={{ padding: '0.5rem 0.75rem', borderBottom: br.borderAfter || borderThin, borderTop: br.borderBefore, borderRight: borderThin, minWidth: '8.5rem', wordBreak: 'break-word' }}>
                              {br.segmentLabel}
                            </td>
                            {groupedPivot.metricSpecs.map((spec) => (
                              <React.Fragment key={spec.key}>
                                {groupedPivot.timeColumns.map((q, qi) => {
                                  const v = groupedPivot.getValue(br.rowGroup, spec.key, q);
                                  const isLastInGroup = qi === groupedPivot.timeColumns.length - 1;
                                  return (
                                    <td
                                      key={q}
                                      style={{
                                        textAlign: 'right',
                                        padding: '0.5rem 0.75rem',
                                        borderBottom: br.borderAfter || borderThin,
                                        borderTop: br.borderBefore,
                                        borderRight: isLastInGroup ? '2px solid #3f3f46' : borderThin,
                                        color: '#3b82f6',
                                      }}
                                    >
                                      {spec.format(v)}
                                    </td>
                                  );
                                })}
                              </React.Fragment>
                            ))}
                            <td
                              style={{
                                textAlign: 'right',
                                padding: '0.5rem 0.75rem',
                                borderBottom: br.borderAfter || borderThin,
                                borderTop: br.borderBefore,
                                borderRight: borderThin,
                                color: '#3b82f6',
                                fontWeight: br.isTotal ? 600 : undefined,
                              }}
                            >
                              {groupedPivot.getWeightedAvgMrrpv(br.rowGroup) != null
                                ? `$${Number(groupedPivot.getWeightedAvgMrrpv(br.rowGroup)).toFixed(2)}`
                                : '—'}
                            </td>
                          </tr>
                        ));
                      })()
                    ) : (
                      groupedPivot.rowGroups.map((rowGroup, ri) => {
                        const isTotal = rowGroup.type === 'total' || rowGroup.type === 'grand';
                        const segmentLabel = rowGroup.type === 'segment' ? rowGroup.segment : rowGroup.type === 'industry' ? rowGroup.industry : rowGroup.label;
                        const borderAfter = rowGroup.type === 'total' ? '2px solid #3f3f46' : undefined;
                        const borderBefore = rowGroup.type === 'grand' ? '2px solid #3f3f46' : undefined;
                        const borderGroup = '2px solid #3f3f46';
                        return (
                          <tr
                            key={ri}
                            style={{
                              fontWeight: isTotal ? 600 : undefined,
                              background: isTotal ? 'rgba(59, 130, 246, 0.08)' : undefined,
                              borderTop: borderBefore,
                              borderBottom: borderAfter,
                            }}
                          >
                            <td style={{ padding: '0.5rem 0.75rem', borderBottom: borderAfter || '1px solid #27272a', borderTop: borderBefore }}>
                              {segmentLabel}
                            </td>
                            {groupedPivot.metricSpecs.map((spec) => (
                              <React.Fragment key={spec.key}>
                                {groupedPivot.timeColumns.map((q, qi) => {
                                  const v = groupedPivot.getValue(rowGroup, spec.key, q);
                                  const isLastInGroup = qi === groupedPivot.timeColumns.length - 1;
                                  return (
                                    <td
                                      key={q}
                                      style={{
                                        textAlign: 'right',
                                        padding: '0.5rem 0.75rem',
                                        borderBottom: borderAfter || '1px solid #27272a',
                                        borderTop: borderBefore,
                                        borderRight: isLastInGroup ? borderGroup : undefined,
                                        color: '#3b82f6',
                                      }}
                                    >
                                      {spec.format(v)}
                                    </td>
                                  );
                                })}
                              </React.Fragment>
                            ))}
                            <td
                              style={{
                                textAlign: 'right',
                                padding: '0.5rem 0.75rem',
                                borderBottom: borderAfter || '1px solid #27272a',
                                borderTop: borderBefore,
                                color: '#3b82f6',
                                fontWeight: isTotal ? 600 : undefined,
                              }}
                            >
                              {groupedPivot.getWeightedAvgMrrpv(rowGroup) != null
                                ? `$${Number(groupedPivot.getWeightedAvgMrrpv(rowGroup)).toFixed(2)}`
                                : '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            ) : pivot.usePivot ? (
              <div style={{ overflowX: 'auto', border: '1px solid #27272a', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46' }} />
                      {pivot.timeColumns.map((q) => (
                        <th key={q} style={{ textAlign: 'right', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46', minWidth: '4.5rem', whiteSpace: 'nowrap' }}>
                          {q}
                        </th>
                      ))}
                      <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', background: '#27272a', borderBottom: '1px solid #3f3f46' }}>
                        Grand Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pivot.metricRows.map((row) => {
                      const spec = specFor(row.key);
                      const fmt = spec?.format || String;
                      return (
                        <tr key={row.key} style={{ borderBottom: '1px solid #27272a' }}>
                          <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{row.label}</td>
                          {pivot.timeColumns.map((q) => (
                            <td key={q} style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#3b82f6' }}>
                              {fmt(row.valuesByQuarter[q])}
                            </td>
                          ))}
                          <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 600, color: '#3b82f6' }}>
                            {fmt(row.grandTotal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid #27272a', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr>
                      {cols.map((col) => (
                        <th
                          key={col.name}
                          style={{
                            textAlign: 'left',
                            padding: '0.5rem 0.75rem',
                            background: '#27272a',
                            borderBottom: '1px solid #3f3f46',
                          }}
                        >
                          {col.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, i) => (
                      <tr key={i} style={row[cols[0]?.name] === 'Overall' ? { fontWeight: 600, background: 'rgba(59, 130, 246, 0.08)' } : undefined}>
                        {cols.map((col) => (
                          <td
                            key={col.name}
                            style={{
                              padding: '0.5rem 0.75rem',
                              borderBottom: '1px solid #27272a',
                            }}
                          >
                            {formatCell(col.name, row[col.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(lastResult.rowCount > maxDisplay || displayData.length > maxDisplay) && !pivot.usePivot && !bridgePivot?.usePivot && (
              <p style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '0.25rem' }}>
                Showing first {maxDisplay} of {Math.max(lastResult.rowCount ?? 0, displayData.length)} rows.
              </p>
            )}
          </div>
        );
      })()}

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask about MRRpV, e.g. by region or segment..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '0.75rem 1rem',
            background: '#18181b',
            border: '1px solid #27272a',
            borderRadius: 6,
            color: '#e4e4e7',
            fontSize: '1rem',
          }}
        />
        <button
          type="submit"
          disabled={loading || !message.trim()}
          style={{
            padding: '0.75rem 1.25rem',
            background: loading ? '#3f3f46' : '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
