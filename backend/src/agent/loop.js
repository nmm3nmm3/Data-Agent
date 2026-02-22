/**
 * Agent loop: user message -> OpenAI with tools -> execute tool -> return reply + result.
 * Model only invokes tools; it does not perform calculations.
 */
import OpenAI from 'openai';
import { getTools, executeTool } from './tools.js';
import { loadConfig } from '../storage/config.js';

const OPENAI_TIMEOUT_MS = 60000;

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error('OPENAI_API_KEY is missing or empty. Set it in Data-Agent/.env (project root, not backend/.env).');
  }
  const customFetch = async (url, options = {}) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), OPENAI_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: c.signal });
      clearTimeout(t);
      return res;
    } catch (e) {
      clearTimeout(t);
      const msg = e.message || String(e);
      const code = e.code ?? e.cause?.code;
      throw new Error(msg + (code ? ` (${code})` : ''), { cause: e });
    }
  };
  return new OpenAI({ apiKey: key, fetch: customFetch });
}

/**
 * Run one agent turn: messages + optional system prompt override and context (e.g. dataSource from UI).
 * @param {{ messages: Array<{role:string, content:string}>, systemPrompt?: string, dataSource?: string }}
 * @returns {{ reply: string, toolCalls: Array<{name:string, args:object}>, lastResult: object | null }}
 */
const MRRPV_RULES =
  'For get_mrrpv: Never ask the user to specify a grouping (industry, segment, or geography). If they do not specify how to group, call the tool and omit group_by—you will get overall MRRpV (one row). If they do not specify a time period, omit time_window to get MRRpV across all data. Always call the tool; do not refuse or ask for more parameters. When the tool returns an "overall" object, always state the overall MRRpV (and vehicle count, ACV, account count, or avg deal size if present) in your reply before or after any breakdown. When the user asks for deal count, account count, or number of accounts/deals, set include_account_count to true. When they ask for average deal size or average account size, set include_avg_deal_size to true.\n\n';

export async function runAgent({ messages, systemPrompt: systemPromptOverride, dataSource } = {}) {
  const config = loadConfig();
  const basePrompt = systemPromptOverride ?? config.systemPrompt ?? '';
  const systemPrompt = MRRPV_RULES + basePrompt;
  const tools = getTools();
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const modelId = config.modelId || 'gpt-4o-mini';
  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: modelId,
    messages: apiMessages,
    tools,
    tool_choice: 'auto',
    temperature: config.temperature ?? 0.2,
    max_tokens: config.maxTokens ?? 1024,
  });

  const choice = response.choices?.[0];
  const message = choice?.message;
  const toolCalls = message?.tool_calls || [];
  const lastResult = { toolCalls: [], result: null };

  if (toolCalls.length === 0) {
    return {
      reply: message?.content || 'No response.',
      toolCalls: [],
      lastResult: null,
    };
  }

  let toolResults = [];
  for (const tc of toolCalls) {
    const name = tc.function?.name;
    let args = {};
    try {
      if (tc.function?.arguments) args = JSON.parse(tc.function.arguments);
    } catch (_) {}
    lastResult.toolCalls.push({ name, args });
    try {
      const result = await executeTool(name, args, { dataSource });
      if (name === 'get_mrrpv' && !lastResult.result) lastResult.result = result;
      toolResults.push({
        tool_call_id: tc.id,
        role: 'tool',
        content: JSON.stringify(result),
      });
    } catch (err) {
      toolResults.push({
        tool_call_id: tc.id,
        role: 'tool',
        content: JSON.stringify({ success: false, error: err.message }),
      });
    }
  }

  // Second call: send tool results back to get final reply
  const followUpMessages = [
    ...apiMessages.slice(1),
    message,
    ...toolResults,
  ];
  const followUp = await getOpenAI().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: systemPrompt }, ...followUpMessages],
    temperature: config.temperature ?? 0.2,
    max_tokens: config.maxTokens ?? 1024,
  });
  const finalMessage = followUp.choices?.[0]?.message;
  const reply = finalMessage?.content || 'Done.';

  return {
    reply,
    toolCalls: lastResult.toolCalls,
    lastResult: lastResult.result,
  };
}
