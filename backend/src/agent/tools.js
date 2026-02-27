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
      'Get MRRpV from Databricks. Call for every MRRpV question. Supports one quarter or multiple: pass time_window as one value ("FY26 Q4") or comma-separated ("FY25 Q3,FY26 Q3,FY27 Q3") to get a table with a row per (group, quarter). For "last three Q3s" or "by industry for the last three Q3s" pass time_window "FY25 Q3,FY26 Q3,FY27 Q3" and group_by "industry"—you will get one row per industry per quarter. For overall/total, omit group_by. When the user is refining the current view (e.g. remove EMEA, exclude MM, remove CML), pass ALL existing row filters from the current view plus any new one—multiple filter types can be used in the same call. Never change group_by when the user only asks to exclude or include rows (e.g. "exclude MM accounts"): keep the same group_by so the table stays industry, geo_segment, or overall. Data source is set by the user in the app.',
    parameters: {
      type: 'object',
      properties: {
        time_window: {
          type: 'string',
          description:
            'Optional. One quarter (e.g. "FY26 Q4") OR comma-separated quarters for multi-quarter views. Accept "year" and "FY" as equivalent: "FY26" or "fiscal year 26" or "year 26" → "FY26 Q1,FY26 Q2,FY26 Q3,FY26 Q4". "From [quarter] onwards" / "since [quarter]" → all quarters from that start through the most recent. "Between [quarter] and [quarter]" or "[quarter] - [quarter]" → all quarters in that inclusive range (e.g. "between FY25 Q1 and FY25 Q4" → "FY25 Q1,FY25 Q2,FY25 Q3,FY25 Q4"). Use FYnn Qn format; Q1–Q4 = fiscal quarters. Omit only if they did not specify a period. When refining the current view (e.g. user only asked to exclude MM or remove EMEA), you MUST pass the same time_window as the current view — omitting it returns ALL quarters (e.g. from FY18), which is wrong.',
        },
        group_by: {
          type: 'string',
          enum: ['industry', 'segment', 'geo', 'geo_segment'],
          description:
            'Optional. Do NOT set for overall/total MRRpV—leave unset and you get one total row. Set when the user asks for breakdown by industry, by segment, by region/geo, or by geo and segment together (geo_segment). When the user is on a preset view and only asks to exclude/include rows (e.g. "exclude MM"), you MUST pass the same group_by as the current view (e.g. "industry" for industry view, "geo_segment" for geo-segment view)—do not switch to a different group_by.',
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
        include_acv: {
          type: 'boolean',
          description:
            'Optional. Set to false when the user asks to remove, hide, or drop the ACV columns. Set to true when they ask to show ACV again. Default true. Preserve from current view when making other changes.',
        },
        region: {
          type: 'string',
          description: 'Optional filter by a single region (geo), e.g. "US". Use regions or exclude_regions for multiple.',
        },
        regions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Include only these geos (e.g. ["US","CA","MX","US-SLED"] for NA only). Overrides region.',
        },
        exclude_regions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Exclude these geos. Use table values (see schema mapping for plain-English, e.g. EMEA, public sector). To include or restore previously excluded geos, omit those values from exclude_regions (or omit the param if the list would be empty).',
        },
        segments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Include only these segments (e.g. ["MM","ENT - COR"]). Use exact values as in the table.',
        },
        exclude_segments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Exclude these segments. Use exact table values (e.g. CML, MM, ENT - COR). To include or restore previously excluded segments, omit those values from exclude_segments (or omit the param if the list would be empty).',
        },
        industries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Include only these industries. Use exact values as in the table.',
        },
        exclude_industries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Exclude these industries. Use exact table values. To include or restore previously excluded industries, omit those values from exclude_industries (or omit the param if the list would be empty).',
        },
        segment: {
          type: 'string',
          description: 'Optional filter by a single segment (use segments or exclude_segments for multiple).',
        },
        industry: {
          type: 'string',
          description: 'Optional filter by a single industry (use industries or exclude_industries for multiple).',
        },
      },
      required: [],
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
    if (Array.isArray(args?.regions) && args.regions.length > 0) {
      filters.regions = args.regions.map((g) => String(g).trim()).filter(Boolean);
    } else if (Array.isArray(args?.exclude_regions) && args.exclude_regions.length > 0) {
      filters.excludeRegions = args.exclude_regions.map((g) => String(g).trim()).filter(Boolean);
    } else if (args?.region) {
      filters.region = String(args.region);
    }
    if (Array.isArray(args?.segments) && args.segments.length > 0) {
      filters.segments = args.segments.map((s) => String(s).trim()).filter(Boolean);
    } else if (Array.isArray(args?.exclude_segments) && args.exclude_segments.length > 0) {
      filters.excludeSegments = args.exclude_segments.map((s) => String(s).trim()).filter(Boolean);
    } else if (args?.segment) {
      filters.segment = String(args.segment);
    }
    if (Array.isArray(args?.industries) && args.industries.length > 0) {
      filters.industries = args.industries.map((i) => String(i).trim()).filter(Boolean);
    } else if (Array.isArray(args?.exclude_industries) && args.exclude_industries.length > 0) {
      filters.excludeIndustries = args.exclude_industries.map((i) => String(i).trim()).filter(Boolean);
    } else if (args?.industry) {
      filters.industry = String(args.industry);
    }
    const includeAccountCount = args?.include_account_count === true;
    const includeAvgDealSize = args?.include_avg_deal_size === true;
    const includeAcv = args?.include_acv !== false;
    const result = await getMRRpV({ dataSource, timeWindow, groupBy, filters, includeProduct, includeAccountCount, includeAvgDealSize, includeAcv });
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
