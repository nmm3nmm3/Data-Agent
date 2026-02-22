/**
 * OpenAI function/tool definitions. The model only invokes these; it does not perform calculations.
 * Data source (first_purchase, upsell, fleet) is set by the user via the UI and passed in context.
 */
import { getMRRpV, DATA_SOURCES } from '../queries/mrrpv.js';
import { resolveProductArea } from '../queries/column-glossary.js';

export const MRRPV_TOOL = {
  type: 'function',
  function: {
    name: 'get_mrrpv',
    description:
      'Get Monthly Recurring Revenue per Vehicle (MRRpV) from Databricks. Returns data for the specified time period. Use this when the user asks about MRRpV, revenue per vehicle, or fleet MRR metrics. Do not compute any metrics yourself; only call this tool. The data source (first purchases, upsell, or fleet) is chosen by the user in the app and is applied automatically. When the user asks for MRRpV for deals that *included* a product (e.g. "deals that included AI Multicam"), use include_product so the result is restricted to rows where that product has license count > 0.',
    parameters: {
      type: 'object',
      properties: {
        time_window: {
          type: 'string',
          description:
            'Optional. Exact quarter or period the user asked for, e.g. "FY26 Q2" or "FY27 Q1". Use the literal they said so only that quarter is returned. If the user did not specify a period, omit this to get MRRpV across all data in the source.',
        },
        group_by: {
          type: 'string',
          enum: ['industry', 'segment', 'geo'],
          description: 'Optional. Omit when the user does not specify how to group—then return the overall MRRpV for the period (one total row). Use "industry" only when they explicitly ask by industry; "segment" when they ask by business segment; "geo" when they ask by region/geography. Do not ask the user to specify grouping; if they do not specify, omit this parameter.',
        },
        include_product: {
          type: 'string',
          description:
            'Optional. When the user asks for MRRpV for deals that *included* a product (e.g. "deals that included AI Multicam"), set this to the product key so only rows with that product license count > 0 are included. Examples: "aim4" (AI Multicam), "vg" (Telematics), "cm" (Camera/Safety), "vgcm" (Safety + Telematics), "st" (Smart trailers), "cw" (Worker safety), "ct" (Connected Training), "cnav" (Commercial navigation), "moby" (360 visibility), "cam", "qual", "cc", "flapps". Use the key that matches the product they named.',
        },
        include_account_count: {
          type: 'boolean',
          description:
            'Optional. Set to true when the user asks for deal count, account count, or number of unique accounts/deals. Adds an account_count column (distinct accounts).',
        },
        include_avg_deal_size: {
          type: 'boolean',
          description:
            'Optional. Set to true when the user asks for average deal size, average account size, or ACV per account. Adds an avg_deal_size column (ACV per distinct account).',
        },
        region: {
          type: 'string',
          description: 'Optional filter by region (geo), e.g. "US", "EMEA".',
        },
        segment: {
          type: 'string',
          description: 'Optional filter by segment.',
        },
      },
    },
  },
};

const TOOLS = [MRRPV_TOOL];

/**
 * Execute a tool by name with the given args. Returns result for the model.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {{ dataSource?: string }} context - dataSource from UI: 'fleet' | 'first_purchase' | 'upsell'
 */
export async function executeTool(name, args, context = {}) {
  if (name === 'get_mrrpv') {
    const timeWindow = args?.time_window != null ? String(args.time_window) : undefined;
    const groupBy = args?.group_by != null ? String(args.group_by) : undefined;
    let includeProduct = args?.include_product != null ? String(args.include_product).trim() : undefined;
    if (includeProduct) {
      const resolved = resolveProductArea(includeProduct);
      if (resolved) includeProduct = resolved;
    }
    const dataSource = context.dataSource && DATA_SOURCES.includes(String(context.dataSource).toLowerCase())
      ? String(context.dataSource).toLowerCase()
      : 'fleet';
    const filters = {};
    if (args?.region) filters.region = String(args.region);
    if (args?.segment) filters.segment = String(args.segment);
    const includeAccountCount = args?.include_account_count === true;
    const includeAvgDealSize = args?.include_avg_deal_size === true;
    const result = await getMRRpV({ dataSource, timeWindow, groupBy, filters, includeProduct, includeAccountCount, includeAvgDealSize });
    return {
      success: true,
      data: result.data,
      columns: result.columns,
      rowCount: result.rows?.length ?? 0,
      overall: result.overall,
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

export function getTools() {
  return TOOLS;
}
