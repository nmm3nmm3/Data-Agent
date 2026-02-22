/**
 * Databricks SQL Statement Execution API client (REST).
 * Uses env: DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_HTTP_PATH.
 * DATABRICKS_WAREHOUSE_HTTP_PATH is e.g. /sql/1.0/warehouses/fff02fce217ddc9b — we extract warehouse id for the API.
 * Reads env at request time so .env is always applied after server start.
 */

function getConfig() {
  const base = (process.env.DATABRICKS_HOST || '').replace(/\/$/, '').trim();
  const token = (process.env.DATABRICKS_TOKEN || '').trim();
  let httpPath = (process.env.DATABRICKS_WAREHOUSE_HTTP_PATH || '').trim();
  // Strip any leading hostname if they pasted a full URL
  const pathOnly = httpPath.replace(/^https?:\/\/[^/]+/, '');
  // Warehouse ID: after /warehouses/ (alphanumeric, hyphens, underscores)
  const match = pathOnly.match(/\/warehouses\/([a-zA-Z0-9_-]+)/);
  let warehouseId = match ? match[1] : null;
  if (!warehouseId && httpPath && /^[a-zA-Z0-9_-]+$/.test(httpPath)) {
    warehouseId = httpPath; // path is just the id
  }
  return { base, token, warehouseId };
}

/**
 * Execute a SQL statement and return the full result (all rows).
 * @param {string} statement - SQL statement
 * @param {number} timeoutMs - Max wait for completion (default 60000)
 * @returns {Promise<{ columns: Array<{name:string}>, rows: Array<Array<unknown>> }>}
 */
export async function runSql(statement, timeoutMs = 60000) {
  const { base, token, warehouseId } = getConfig();
  if (!base || !token || !warehouseId) {
    throw new Error(
      'Databricks config missing: set DATABRICKS_HOST, DATABRICKS_TOKEN, and DATABRICKS_WAREHOUSE_HTTP_PATH'
    );
  }
  if (warehouseId === 'sql' || warehouseId.length < 10) {
    throw new Error(
      'DATABRICKS_WAREHOUSE_HTTP_PATH must be the full path from your SQL warehouse (e.g. /sql/1.0/warehouses/abc123def456). Get it from Databricks: SQL Warehouses → your warehouse → Connection details → HTTP path. Do not use just "sql".'
    );
  }
  const url = `${base}/api/2.0/sql/statements`;
  const start = Date.now();
  // API: duration string "Ns", 5–50 seconds or "0s" for async
  const rawSeconds = Math.floor(timeoutMs / 1000);
  const waitSeconds = rawSeconds <= 0 ? 0 : Math.min(50, Math.max(5, rawSeconds));
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      warehouse_id: warehouseId,
      statement,
      // API expects duration string e.g. "30s" (5–50s or "0s" for async)
      wait_timeout: waitSeconds === 0 ? '0s' : `${waitSeconds}s`,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Databricks API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const status = data.status?.state;
  if (status === 'FAILED') {
    throw new Error(data.status?.error?.message || 'Statement failed');
  }
  if (status !== 'SUCCEEDED' && status !== 'CLOSED') {
    // Poll until done (simple polling for now)
    const statementId = data.statement_id;
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1000));
      const getRes = await fetch(`${url}/${statementId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!getRes.ok) throw new Error(`Databricks get statement error ${getRes.status}`);
      const getData = await getRes.json();
      const s = getData.status?.state;
      if (s === 'FAILED') {
        throw new Error(getData.status?.error?.message || 'Statement failed');
      }
      if (s === 'SUCCEEDED' || s === 'CLOSED') {
        return parseResult(getData.result);
      }
    }
    throw new Error('Statement execution timed out');
  }
  return parseResult(data.result);
}

function parseResult(result) {
  if (!result) return { columns: [], rows: [] };
  // API may put schema in manifest.schema.columns or schema.columns
  const rawColumns = result.manifest?.schema?.columns || result.schema?.columns || [];
  const columns = Array.isArray(rawColumns)
    ? rawColumns.map((c) => ({ name: c.name || c.column_name || String(c) }))
    : [];
  let rows = [];
  const chunks = result.data_array || [];
  for (const chunk of chunks) {
    rows.push(...chunk);
  }
  // If API returned a flat array of cell values, reshape into row arrays
  const colCount = columns.length;
  if (
    colCount > 0 &&
    rows.length > 0 &&
    !Array.isArray(rows[0]) &&
    rows.length % colCount === 0
  ) {
    const reshaped = [];
    for (let i = 0; i < rows.length; i += colCount) {
      reshaped.push(rows.slice(i, i + colCount));
    }
    rows = reshaped;
  }
  return { columns, rows };
}

export function isConfigured() {
  const { base, token, warehouseId } = getConfig();
  return !!(base && token && warehouseId);
}
