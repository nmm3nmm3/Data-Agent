# Deploying Data-Agent as a Databricks App

This app is configured to run on Databricks Apps: it uses `DATABRICKS_APP_PORT` (set by the platform) or `PORT` for local runs.

## 1. Install dependencies

From the **project root** (directory containing `package.json`, `backend/`, `frontend/`):

```bash
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

## 2. Build the frontend

The backend serves the built frontend from `frontend/dist`. Build it once before running or before deploying:

```bash
npm run build
```

## 3. Environment variables

The app expects these in the environment (no `.env` file in production; use the Databricks app’s environment or `app.yaml` with `valueFrom: secret` for secrets):

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes (for chat) | OpenAI API key for the agent |
| `DATABRICKS_HOST` | Yes | Workspace URL (e.g. `https://your-workspace.cloud.databricks.com`) |
| `DATABRICKS_TOKEN` | Yes | Databricks token for SQL warehouse |
| `DATABRICKS_WAREHOUSE_HTTP_PATH` | Yes | Full path (e.g. `/sql/1.0/warehouses/<id>`) |
| `DATABRICKS_APP_PORT` | Set by platform | Port the app must listen on (Databricks sets this) |
| `PORT` | Optional | Fallback port for local runs (default 3000) |

See `.env.example` for a full list. In Databricks, bind secrets via the app’s environment or `app.yaml` (e.g. `valueFrom: secret`).

## 4. Run

- **Local:** From project root: `npm run start`. Backend listens on `PORT` (default 3000) and serves API + static frontend from `frontend/dist`.
- **Databricks:** Use the project’s `app.yaml` (command: `npm run start`). Ensure the app’s environment includes the variables above; the platform sets `DATABRICKS_APP_PORT`.

## 5. Health check

After the app is running, call:

```bash
curl -s http://<host>:<port>/health
```

Expected: `{"ok":true,"databricksConfigured":true}` when Databricks env vars are set.
