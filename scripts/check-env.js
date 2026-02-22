#!/usr/bin/env node
/**
 * Check that .env in project root has the three Databricks vars set.
 * Run from Data-Agent directory: node scripts/check-env.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const envPath = path.join(projectRoot, '.env');

// Parse .env without dotenv dependency (simple KEY=VALUE lines)
const env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

const HOST = env.DATABRICKS_HOST || '';
const TOKEN = env.DATABRICKS_TOKEN || '';
const PATH_VAR = env.DATABRICKS_WAREHOUSE_HTTP_PATH || '';

console.log('Checking .env at:', envPath);
console.log('  DATABRICKS_HOST set:', !!HOST);
console.log('  DATABRICKS_TOKEN set:', !!TOKEN);
console.log('  DATABRICKS_WAREHOUSE_HTTP_PATH set:', !!PATH_VAR);

if (HOST && TOKEN && PATH_VAR) {
  console.log('\nAll three are set. If the server still reports databricksConfigured: false, restart it (Ctrl+C then npm run start).');
} else {
  console.log('\nAdd the missing vars to .env in the Data-Agent directory, then restart the server.');
}
