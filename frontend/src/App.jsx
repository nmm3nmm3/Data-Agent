import { useState, useRef, useEffect } from 'react';

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
        <div>
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
  const [querySummary, setQuerySummary] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [dataSource, setDataSource] = useState('first_purchase');
  const bottomRef = useRef(null);
  const isAdmin = typeof window !== 'undefined' && window.location.hash === '#admin';

  useEffect(() => {
    fetch(`${API.replace('/api', '')}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim() || loading) return;
    const userMessage = message.trim();
    setMessage('');
    setMessages((m) => [...m, { role: 'user', content: userMessage }]);
    setLoading(true);
    setLastResult(null);
    try {
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversationId: conversationId || undefined,
          dataSource: dataSource || 'fleet',
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
      setQuerySummary(data.querySummary || null);
    } catch (err) {
      const msg = err.message || 'Request failed';
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }

  if (isAdmin) return <AdminPage />;

  return (
    <div style={{ padding: '2rem', maxWidth: 800, margin: '0 auto', minHeight: '100vh' }}>
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
          borderRadius: 8,
          border: '1px solid #27272a',
          padding: '1rem',
          marginBottom: '1rem',
          minHeight: 200,
          maxHeight: 400,
          overflowY: 'auto',
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: '#71717a', fontSize: '0.875rem' }}>
            Send a message to get started.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: '0.75rem',
              padding: '0.5rem 0',
              borderBottom: i < messages.length - 1 ? '1px solid #27272a' : 'none',
            }}
          >
            <span style={{ color: '#71717a', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
              {m.role === 'user' ? 'You' : 'Assistant'}
            </span>
            <p style={{ margin: '0.25rem 0 0', whiteSpace: 'pre-wrap' }}>{m.content}</p>
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
          {querySummary.include_product ? `, included product: ${querySummary.include_product}` : ''}
          {querySummary.region ? `, region: ${querySummary.region}` : ''}
          {querySummary.segment ? `, segment: ${querySummary.segment}` : ''}
        </p>
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
        const maxDisplay = 100;
        const tableRows = displayData.slice(0, maxDisplay);
        const o = lastResult.overall;
        return (
          <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.875rem', color: '#a1a1aa', marginBottom: '0.5rem' }}>Result</h3>
            {o && (
              <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem', color: '#e4e4e7' }}>
                <strong>Overall:</strong>
                {o.fleet_mrrpv != null && ` $${Number(o.fleet_mrrpv).toFixed(2)} MRRpV`}
                {o.vehicle_count != null && ` · ${Number(o.vehicle_count).toLocaleString()} vehicles`}
                {o.acv != null && ` · $${Number(o.acv).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ACV`}
                {o.account_count != null && ` · ${Number(o.account_count).toLocaleString()} accounts`}
                {o.avg_deal_size != null && ` · $${Number(o.avg_deal_size).toFixed(2)} avg deal size`}
              </p>
            )}
            {cols.length >= 2 && cols.length <= 5 ? (
              <SimpleBarChart data={displayData} columns={cols} excludeOverall={hasMultipleRows && hasGroupCol} />
            ) : null}
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
            {(lastResult.rowCount > maxDisplay || displayData.length > maxDisplay) && (
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
