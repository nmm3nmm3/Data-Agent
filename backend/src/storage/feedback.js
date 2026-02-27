/**
 * User feedback on agent responses: thumbs up/down + optional comment.
 * Stored in data/feedback.json as { items: [ { id, createdAt, feedback, userPrompt, agentResponse, comment? } ] }.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const FEEDBACK_PATH = path.join(DATA_DIR, 'feedback.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readItems() {
  ensureDataDir();
  if (!fs.existsSync(FEEDBACK_PATH)) return [];
  try {
    const raw = fs.readFileSync(FEEDBACK_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.items) ? data.items : [];
  } catch (_) {
    return [];
  }
}

function writeItems(items) {
  ensureDataDir();
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify({ items }, null, 2), 'utf8');
}

/**
 * Add a feedback entry. Returns the new item's id.
 * @param {{ feedback: 'up'|'down', userPrompt: string, agentResponse: string }} payload
 * @returns {{ id: string }}
 */
export function addFeedback(payload) {
  const items = readItems();
  const id = `fb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const entry = {
    id,
    createdAt: new Date().toISOString(),
    feedback: payload.feedback === 'down' ? 'down' : 'up',
    userPrompt: String(payload.userPrompt ?? '').slice(0, 10000),
    agentResponse: String(payload.agentResponse ?? '').slice(0, 50000),
  };
  items.push(entry);
  writeItems(items);
  return { id };
}

/**
 * Add an optional comment to an existing feedback entry.
 * @param {string} id - Feedback entry id
 * @param {string} comment - User's additional comment
 * @returns {{ ok: boolean }}
 */
export function addCommentToFeedback(id, comment) {
  if (!id || typeof comment !== 'string') return { ok: false };
  const items = readItems();
  const entry = items.find((e) => e.id === id);
  if (!entry) return { ok: false };
  entry.comment = String(comment).trim().slice(0, 5000);
  entry.commentAt = new Date().toISOString();
  writeItems(items);
  return { ok: true };
}

/**
 * Get all feedback entries (newest first) for admin review.
 * @returns {{ items: Array<{ id, createdAt, feedback, userPrompt, agentResponse, comment?, commentAt? }> }}
 */
export function getAllFeedback() {
  const items = readItems();
  const sorted = [...items].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { items: sorted };
}
