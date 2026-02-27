/**
 * Entry point: load .env from project root before any other app code runs.
 * This avoids ESM import hoisting so process.env is set before routes (and Databricks client) load.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '../..');
const envPath = path.join(projectRoot, '.env');
const loaded = dotenv.config({ path: envPath });

const host = process.env.DATABRICKS_HOST?.trim();
const token = process.env.DATABRICKS_TOKEN?.trim();
const pathVar = process.env.DATABRICKS_WAREHOUSE_HTTP_PATH?.trim();
const openaiKey = process.env.OPENAI_API_KEY?.trim();
console.log('[run.js] .env path:', envPath);
console.log('[run.js] .env loaded:', !loaded.error);
console.log('[run.js] OPENAI_API_KEY set:', !!openaiKey);
console.log('[run.js] DATABRICKS_HOST set:', !!host);
console.log('[run.js] DATABRICKS_TOKEN set:', !!token);
console.log('[run.js] DATABRICKS_WAREHOUSE_HTTP_PATH set:', !!pathVar);

await import('./index.js');
