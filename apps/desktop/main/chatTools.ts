/**
 * Chat Tools - OpenAI Function Calling for Deal & Activity Management
 * Enables natural language interaction with the deal database
 */
import OpenAI from 'openai';
import type { Deal, DealActivity, DealStage, SchematicToolCall } from '@drasill/shared';
import {
  getAllDeals,
  getDeal,
  createDeal,
  updateDeal,
  deleteDeal,
  createDealActivity,
  getAllActivities,
  getActivitiesForDeal,
  getDealActivity,
  updateDealActivity,
  deleteDealActivity,
  calculatePipelineAnalytics,
  addActivitySource,
  getRelevanceThresholds,
  getDealDocuments,
  getAllDocumentTemplates,
  getMemosByDeal,
  getBankAccountsByDeal,
  getStatementsByDeal,
  getMonthlyBalanceSummary,
  getCashflowByPeriod,
  detectSeasonality,
  searchTransactions,
  getTransactionsByDealAndDateRange,
} from './database';
import { processSchematicToolCall } from './schematic';
import { createAndOpenEmailDraft, generateEmailBody, type EmailDraft } from './outlook';
import { createOneDriveSharingLinks } from './onedrive';
import {
  getHubSpotAuthStatus,
  getHubSpotDeals,
  getHubSpotDeal,
  searchHubSpotDeals,
  getHubSpotContacts,
  getHubSpotCompanies,
  getHubSpotDealsSummary,
  getHubSpotPipelines,
} from './hubspot';

// ============ Tool Definitions ============

export const CHAT_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_deals',
      description: 'Get a list of all deals in the pipeline. Use this to see what deals are available before taking actions.',
      parameters: {
        type: 'object',
        properties: {
          stage_filter: {
            type: 'string',
            enum: ['all', 'lead', 'application', 'underwriting', 'approved', 'funded', 'closed', 'declined'],
            description: 'Optional filter by deal stage. Default is "all".',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_deal_by_name',
      description: 'Search for a deal by borrower name using fuzzy matching. Use this when the user refers to a deal by a partial or informal name.',
      parameters: {
        type: 'object',
        properties: {
          search_term: {
            type: 'string',
            description: 'The borrower name or partial identifier to search for.',
          },
        },
        required: ['search_term'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_deal_details',
      description: 'Get detailed information about a specific deal including its stage, loan amount, and recent activity.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The unique ID of the deal.',
          },
        },
        required: ['deal_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_deal_activity',
      description: 'Add a new activity entry for a deal. Use this when the user wants to record a call, meeting, note, email, or document. IMPORTANT: When creating activities from conversation context, set use_chat_sources=true to automatically attach any documents referenced in the chat as citations.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The ID of the deal this activity is for.',
          },
          type: {
            type: 'string',
            enum: ['note', 'call', 'email', 'document', 'meeting'],
            description: 'The type of activity.',
          },
          description: {
            type: 'string',
            description: 'Description of the activity, observations, or notes. Should summarize the relevant conversation context.',
          },
          performed_by: {
            type: 'string',
            description: 'Name of the person who performed the activity (optional).',
          },
          performed_at: {
            type: 'string',
            description: 'ISO timestamp when activity occurred. Defaults to now if not provided.',
          },
          use_chat_sources: {
            type: 'boolean',
            description: 'If true, automatically attach any documents referenced in the current chat conversation as citations/sources for this activity. Default true when creating from chat context.',
          },
        },
        required: ['deal_id', 'type', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_deal_stage',
      description: 'Update the stage of a deal in the pipeline. IMPORTANT: This requires user confirmation before executing.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The ID of the deal to update.',
          },
          new_stage: {
            type: 'string',
            enum: ['lead', 'application', 'underwriting', 'approved', 'funded', 'closed', 'declined'],
            description: 'The new stage for the deal.',
          },
          reason: {
            type: 'string',
            description: 'Reason for the stage change.',
          },
          confirmed: {
            type: 'boolean',
            description: 'Whether the user has confirmed this action. Must be true to execute.',
          },
        },
        required: ['deal_id', 'new_stage', 'confirmed'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pipeline_analytics',
      description: 'Get pipeline analytics including days in stage, activity counts, and deal values.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The ID of a specific deal. If not provided, returns analytics for all deals.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_deal_activities',
      description: 'Get activity history, optionally filtered by deal.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'Optional deal ID to filter activities. If not provided, returns all activities.',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of activities to return. Default is 20.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'retrieve_schematic',
      description: 'Retrieve a schematic diagram and service documentation for a machine component. Use this when the user asks about parts, components, maintenance procedures, or service information for equipment.',
      parameters: {
        type: 'object',
        properties: {
          component_name: {
            type: 'string',
            description: 'The name of the component or part to look up (e.g., "hydraulic pump", "motor assembly", "control valve").',
          },
          machine_model: {
            type: 'string',
            description: 'The machine model or equipment identifier (optional).',
          },
          additional_context: {
            type: 'string',
            description: 'Any additional context about what the user is looking for (e.g., "replacement procedure", "wiring diagram").',
          },
        },
        required: ['component_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_email',
      description: 'Draft an email with a summary of research and findings from the current conversation. Use this when the user wants to send an email summarizing the discussion, analysis, or recommendations. The email will be created as a draft in Outlook with sources/citations from documents referenced in the chat.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'Optional deal ID to associate this email with. Used to fetch deal details for context.',
          },
          to: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of recipient email addresses.',
          },
          subject: {
            type: 'string',
            description: 'Email subject line.',
          },
          summary: {
            type: 'string',
            description: 'The main content/summary to include in the email body. Should be well-formatted and professional.',
          },
          recipient_name: {
            type: 'string',
            description: 'Optional name of the recipient for personalized greeting.',
          },
          include_sources: {
            type: 'boolean',
            description: 'Whether to include document citations/sources at the end of the email. Default is true.',
          },
        },
        required: ['to', 'subject', 'summary'],
      },
    },
  },
  // HubSpot CRM Tools
  {
    type: 'function',
    function: {
      name: 'get_hubspot_deals',
      description: 'Get deals from HubSpot CRM. Use this to see deals tracked in HubSpot. Returns deal name, amount, stage, and other properties.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of deals to return. Default is 20.',
          },
          search_query: {
            type: 'string',
            description: 'Optional text to search for in deal names.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hubspot_deal_details',
      description: 'Get detailed information about a specific HubSpot deal, including associated contacts and companies.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The HubSpot deal ID.',
          },
        },
        required: ['deal_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hubspot_pipeline_summary',
      description: 'Get a summary of the HubSpot deal pipeline including total deals, total value, and breakdown by stage. Use this for pipeline analytics and reporting.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hubspot_contacts',
      description: 'Get contacts from HubSpot CRM. Returns contact names, emails, companies, and job titles.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of contacts to return. Default is 20.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hubspot_companies',
      description: 'Get companies from HubSpot CRM. Returns company names, domains, industries, and other properties.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of companies to return. Default is 20.',
          },
        },
        required: [],
      },
    },
  },
  // Financial Analysis Tools
  {
    type: 'function',
    function: {
      name: 'get_balance_summary',
      description: 'Get monthly balance summary (min, max, average balance) for a deal\'s bank accounts over a date range. Use this when the user asks about account balances, lowest/highest balances, or average balances over time. Results include source bank statement references for citation.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal ID to get balance data for.',
          },
          start_date: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format. Defaults to 2 years ago if not provided.',
          },
          end_date: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format. Defaults to today if not provided.',
          },
        },
        required: ['deal_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_cashflow_by_period',
      description: 'Get inflows, outflows, and net cashflow grouped by month or quarter for a deal. Use this to analyze cashflow trends, compare periods, and identify patterns. Results include source bank statement references.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal ID to get cashflow data for.',
          },
          start_date: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format. Defaults to 2 years ago.',
          },
          end_date: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format. Defaults to today.',
          },
          period_type: {
            type: 'string',
            enum: ['month', 'quarter'],
            description: 'Group results by month or quarter. Default is month.',
          },
        },
        required: ['deal_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detect_seasonality',
      description: 'Analyze bank statement data to detect seasonal patterns in cashflow. Compares same months across multiple years to identify which months consistently have lower or higher cashflow. Requires at least 12 months of transaction data for meaningful results. Returns month-by-month analysis with deviation percentages.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal ID to analyze.',
          },
          start_date: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format. Defaults to 2 years ago.',
          },
          end_date: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format. Defaults to today.',
          },
        },
        required: ['deal_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_transactions',
      description: 'Search and filter bank transactions for a deal by keyword, date range, or amount. Use this when the user asks about specific transactions, payments, deposits, or wants to find particular charges.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal ID to search transactions for.',
          },
          keyword: {
            type: 'string',
            description: 'Search keyword to match in transaction descriptions.',
          },
          start_date: {
            type: 'string',
            description: 'Start date filter in YYYY-MM-DD format.',
          },
          end_date: {
            type: 'string',
            description: 'End date filter in YYYY-MM-DD format.',
          },
          limit: {
            type: 'number',
            description: 'Maximum transactions to return. Default is 50.',
          },
        },
        required: ['deal_id'],
      },
    },
  },

  // ======== New Platform Tools ========

  // Create Deal
  {
    type: 'function',
    function: {
      name: 'create_deal',
      description: 'Create a new deal in the pipeline. Use this when the user asks to add or create a new deal.',
      parameters: {
        type: 'object',
        properties: {
          borrower_name: {
            type: 'string',
            description: 'The borrower / applicant name for the deal.',
          },
          loan_amount: {
            type: 'number',
            description: 'Requested loan amount in dollars.',
          },
          stage: {
            type: 'string',
            enum: ['lead', 'application', 'underwriting', 'approved', 'funded', 'closed', 'declined'],
            description: 'Initial pipeline stage. Default is "lead".',
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Deal priority. Default is "medium".',
          },
          borrower_contact: {
            type: 'string',
            description: 'Contact info for the borrower (email, phone, etc.).',
          },
          interest_rate: {
            type: 'number',
            description: 'Interest rate as a percentage (e.g. 7.5).',
          },
          term_months: {
            type: 'number',
            description: 'Loan term in months.',
          },
          collateral_description: {
            type: 'string',
            description: 'Description of collateral securing the loan.',
          },
          notes: {
            type: 'string',
            description: 'Additional notes for the deal.',
          },
        },
        required: ['borrower_name'],
      },
    },
  },

  // Update Deal (general fields)
  {
    type: 'function',
    function: {
      name: 'update_deal',
      description: 'Update any fields on an existing deal. Use this instead of update_deal_stage when changing non-stage fields or multiple fields at once.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal ID to update. Use find_deal_by_name first if you only have the name.',
          },
          borrower_name: { type: 'string', description: 'New borrower name.' },
          borrower_contact: { type: 'string', description: 'New borrower contact info.' },
          loan_amount: { type: 'number', description: 'New loan amount.' },
          interest_rate: { type: 'number', description: 'New interest rate.' },
          term_months: { type: 'number', description: 'New term in months.' },
          collateral_description: { type: 'string', description: 'New collateral description.' },
          stage: {
            type: 'string',
            enum: ['lead', 'application', 'underwriting', 'approved', 'funded', 'closed', 'declined'],
            description: 'New pipeline stage.',
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'New priority.',
          },
          assigned_to: { type: 'string', description: 'Person assigned to the deal.' },
          notes: { type: 'string', description: 'Updated notes.' },
          expected_close_date: { type: 'string', description: 'Expected close date in YYYY-MM-DD format.' },
        },
        required: ['deal_id'],
      },
    },
  },

  // Delete Deal (requires confirmation)
  {
    type: 'function',
    function: {
      name: 'delete_deal',
      description: 'Delete a deal from the pipeline. This is destructive and will ask the user to confirm before executing.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal ID to delete.',
          },
          confirmed: {
            type: 'boolean',
            description: 'Whether the user has confirmed the deletion. Must be true to proceed.',
          },
        },
        required: ['deal_id'],
      },
    },
  },

  // Update Activity
  {
    type: 'function',
    function: {
      name: 'update_activity',
      description: 'Update an existing deal activity (note, call, email, etc.).',
      parameters: {
        type: 'object',
        properties: {
          activity_id: {
            type: 'string',
            description: 'The activity ID to update.',
          },
          type: {
            type: 'string',
            enum: ['note', 'call', 'email', 'meeting', 'document', 'status_change', 'ai_analysis'],
            description: 'New activity type.',
          },
          description: {
            type: 'string',
            description: 'New activity description.',
          },
          performed_by: {
            type: 'string',
            description: 'Who performed the activity.',
          },
        },
        required: ['activity_id'],
      },
    },
  },

  // Delete Activity (requires confirmation)
  {
    type: 'function',
    function: {
      name: 'delete_activity',
      description: 'Delete a deal activity. This is destructive and will ask the user to confirm before executing.',
      parameters: {
        type: 'object',
        properties: {
          activity_id: {
            type: 'string',
            description: 'The activity ID to delete.',
          },
          confirmed: {
            type: 'boolean',
            description: 'Whether the user has confirmed the deletion. Must be true to proceed.',
          },
        },
        required: ['activity_id'],
      },
    },
  },

  // Export Deal PDF
  {
    type: 'function',
    function: {
      name: 'export_deal_pdf',
      description: 'Export a deal report to PDF. Triggers the PDF export dialog for the specified deal.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal ID to export.',
          },
        },
        required: ['deal_id'],
      },
    },
  },

  // Search / List Files for a deal
  {
    type: 'function',
    function: {
      name: 'search_deal_files',
      description: 'List documents associated with a deal. Use this when the user asks about files, documents, or attachments for a deal.',
      parameters: {
        type: 'object',
        properties: {
          deal_id: {
            type: 'string',
            description: 'The deal ID to list files for.',
          },
        },
        required: ['deal_id'],
      },
    },
  },

  // Generate / List Memo Templates
  {
    type: 'function',
    function: {
      name: 'manage_memos',
      description: 'List available memo templates, list existing memos for a deal, or get details about a specific template. Use "list_templates" to show available templates, "list_memos" to show generated memos for a deal.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list_templates', 'list_memos'],
            description: 'The action to perform.',
          },
          deal_id: {
            type: 'string',
            description: 'The deal ID (required for list_memos).',
          },
        },
        required: ['action'],
      },
    },
  },
];

// ============ Fuzzy Matching ============

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score (0-1) between two strings
 */
function similarityScore(a: string, b: string): number {
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

/**
 * Find deal by fuzzy name matching
 */
function findDealByName(searchTerm: string): { deal: Deal; score: number }[] {
  const allDeals = getAllDeals();
  const results: { deal: Deal; score: number }[] = [];
  const searchLower = searchTerm.toLowerCase();

  for (const deal of allDeals) {
    // Check various fields for matches
    const fields = [
      deal.borrowerName,
      deal.dealNumber,
      deal.assignedTo || '',
      deal.collateralDescription || '',
    ];

    let bestScore = 0;

    for (const field of fields) {
      // Exact substring match
      if (field.toLowerCase().includes(searchLower)) {
        bestScore = Math.max(bestScore, 0.9);
      }

      // Word-level matching
      const fieldWords = field.toLowerCase().split(/\s+/);
      const searchWords = searchLower.split(/\s+/);

      for (const searchWord of searchWords) {
        for (const fieldWord of fieldWords) {
          if (fieldWord.includes(searchWord) || searchWord.includes(fieldWord)) {
            bestScore = Math.max(bestScore, 0.8);
          }
          // Fuzzy match
          const score = similarityScore(searchWord, fieldWord);
          if (score > 0.6) {
            bestScore = Math.max(bestScore, score * 0.85);
          }
        }
      }
    }

    if (bestScore > 0.5) {
      results.push({ deal, score: bestScore });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

// ============ Tool Executor ============

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
  requiresConfirmation?: boolean;
  actionTaken?: string; // Description of action for UI refresh
}

/**
 * Chat context passed to tool execution
 * Contains sources referenced during the conversation
 */
export interface ChatToolContext {
  ragSources: Array<{
    fileName: string;
    filePath: string;
    section?: string;
    pageNumber?: number;
    source?: 'local' | 'onedrive';
    oneDriveId?: string;
    relevanceScore?: number;
    fromOtherDeal?: boolean;
    dealId?: string;
  }>;
}

/**
 * Execute a tool call and return the result
 */
export async function executeTool(
  toolName: string, 
  args: Record<string, unknown>,
  context?: ChatToolContext
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'get_deals':
        return executeGetDeals(args.stage_filter as string | undefined);

      case 'find_deal_by_name':
        return executeFindDealByName(args.search_term as string);

      case 'get_deal_details':
        return executeGetDealDetails(args.deal_id as string);

      case 'add_deal_activity':
        return executeAddDealActivity(args, context);

      case 'update_deal_stage':
        return executeUpdateDealStage(args);

      case 'get_pipeline_analytics':
        return executeGetPipelineAnalytics(args.deal_id as string | undefined);

      case 'get_deal_activities':
        return executeGetDealActivities(args);

      case 'retrieve_schematic':
        return executeRetrieveSchematic(args);

      case 'draft_email':
        return executeDraftEmail(args, context);

      // HubSpot CRM Tools
      case 'get_hubspot_deals':
        return executeGetHubSpotDeals(args);

      case 'get_hubspot_deal_details':
        return executeGetHubSpotDealDetails(args.deal_id as string);

      case 'get_hubspot_pipeline_summary':
        return executeGetHubSpotPipelineSummary();

      case 'get_hubspot_contacts':
        return executeGetHubSpotContacts(args);

      case 'get_hubspot_companies':
        return executeGetHubSpotCompanies(args);

      // Financial Analysis Tools
      case 'get_balance_summary':
        return executeGetBalanceSummary(args);

      case 'get_cashflow_by_period':
        return executeGetCashflowByPeriod(args);

      case 'detect_seasonality':
        return executeDetectSeasonality(args);

      case 'query_transactions':
        return executeQueryTransactions(args);

      // New platform tools
      case 'create_deal':
        return executeCreateDeal(args);

      case 'update_deal':
        return executeUpdateDealFull(args);

      case 'delete_deal':
        return executeDeleteDeal(args);

      case 'update_activity':
        return executeUpdateActivity(args);

      case 'delete_activity':
        return executeDeleteActivity(args);

      case 'export_deal_pdf':
        return executeExportDealPdf(args);

      case 'search_deal_files':
        return executeSearchDealFiles(args);

      case 'manage_memos':
        return executeManageMemos(args);

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

// ============ Tool Implementations ============

function executeGetDeals(stageFilter?: string): ToolResult {
  const allDeals = getAllDeals();

  let filtered = allDeals;
  if (stageFilter && stageFilter !== 'all') {
    filtered = allDeals.filter(deal => deal.stage === stageFilter);
  }

  const summary = filtered.map(deal => ({
    id: deal.id,
    dealNumber: deal.dealNumber,
    borrowerName: deal.borrowerName,
    loanAmount: deal.loanAmount,
    stage: deal.stage,
    priority: deal.priority,
  }));

  return {
    success: true,
    data: summary,
    message: `Found ${filtered.length} deals${stageFilter && stageFilter !== 'all' ? ` in "${stageFilter}" stage` : ''}.`,
  };
}

function executeFindDealByName(searchTerm: string): ToolResult {
  const results = findDealByName(searchTerm);

  if (results.length === 0) {
    return {
      success: true,
      data: [],
      message: `No deals found matching "${searchTerm}".`,
    };
  }

  const matches = results.slice(0, 5).map(r => ({
    id: r.deal.id,
    dealNumber: r.deal.dealNumber,
    borrowerName: r.deal.borrowerName,
    loanAmount: r.deal.loanAmount,
    stage: r.deal.stage,
    confidence: Math.round(r.score * 100),
  }));

  return {
    success: true,
    data: matches,
    message: `Found ${results.length} deals matching "${searchTerm}". Top match: ${results[0].deal.borrowerName} (${Math.round(results[0].score * 100)}% confidence).`,
  };
}

function executeGetDealDetails(dealId: string): ToolResult {
  const deal = getDeal(dealId);

  if (!deal) {
    return { success: false, error: `Deal with ID "${dealId}" not found.` };
  }

  // Get recent activities
  const activities = getActivitiesForDeal(dealId).slice(0, 5);

  // Calculate basic analytics
  const daysSinceCreated = deal.createdAt 
    ? Math.floor((Date.now() - new Date(deal.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  
  const allActivities = getActivitiesForDeal(dealId);
  const lastActivity = allActivities[0];
  const daysSinceLastActivity = lastActivity?.performedAt
    ? Math.floor((Date.now() - new Date(lastActivity.performedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    success: true,
    data: {
      deal,
      recentActivities: activities.map((activity: DealActivity) => ({
        id: activity.id,
        type: activity.type,
        date: activity.performedAt,
        description: activity.description,
        performedBy: activity.performedBy,
      })),
      analytics: {
        daysSinceCreated,
        daysSinceLastActivity,
        totalActivities: allActivities.length,
      },
    },
    message: `${deal.borrowerName} - $${deal.loanAmount.toLocaleString()} loan is currently in "${deal.stage}" stage. ${activities.length > 0 ? `Last activity: ${activities[0].type} on ${new Date(activities[0].performedAt).toLocaleDateString()}.` : 'No activity recorded yet.'}`,
  };
}

function executeAddDealActivity(args: Record<string, unknown>, context?: ChatToolContext): ToolResult {
  const dealId = args.deal_id as string;
  const deal = getDeal(dealId);

  if (!deal) {
    return { success: false, error: `Deal with ID "${dealId}" not found.` };
  }

  const useChatSources = args.use_chat_sources !== false; // Default to true

  const activityData = {
    dealId,
    type: args.type as DealActivity['type'],
    description: args.description as string,
    performedBy: (args.performed_by as string) || null,
    performedAt: (args.performed_at as string) || new Date().toISOString(),
    metadata: null,
  };

  const activity = createDealActivity(activityData);

  // Attach sources from chat context if requested
  // Filter to high-relevance sources only (>= activity threshold) and exclude sources from other deals
  let sourcesAdded = 0;
  if (useChatSources && context?.ragSources && context.ragSources.length > 0 && activity.id) {
    const { activityThreshold } = getRelevanceThresholds();
    
    // Filter and sort by relevance score
    const highRelevanceSources = context.ragSources
      .filter(s => {
        // Include if no score (backwards compat) or above threshold
        const hasGoodScore = s.relevanceScore === undefined || s.relevanceScore >= activityThreshold;
        // Exclude sources from other deals
        const isCurrentDeal = !s.fromOtherDeal;
        return hasGoodScore && isCurrentDeal;
      })
      .sort((a, b) => (b.relevanceScore ?? 1) - (a.relevanceScore ?? 1));
    
    // De-duplicate sources by file path
    const seenPaths = new Set<string>();
    for (const ragSource of highRelevanceSources) {
      if (!seenPaths.has(ragSource.filePath)) {
        seenPaths.add(ragSource.filePath);
        try {
          addActivitySource(activity.id, {
            fileName: ragSource.fileName,
            filePath: ragSource.filePath,
            section: ragSource.section,
            pageNumber: ragSource.pageNumber,
            source: ragSource.source,
            oneDriveId: ragSource.oneDriveId,
          });
          sourcesAdded++;
        } catch (err) {
          console.error('[ChatTools] Failed to add activity source:', err);
        }
      }
    }
    
    const skippedCount = context.ragSources.length - highRelevanceSources.length;
    if (skippedCount > 0) {
      console.log(`[ChatTools] Skipped ${skippedCount} low-relevance or other-deal sources for activity`);
    }
  }

  const sourceMsg = sourcesAdded > 0 
    ? ` Attached ${sourcesAdded} document citation${sourcesAdded > 1 ? 's' : ''} from the conversation.` 
    : '';

  return {
    success: true,
    data: { ...activity, sourcesAdded },
    message: `✅ Added ${activityData.type} activity for ${deal.borrowerName}'s deal.${sourceMsg}`,
    actionTaken: 'activity_created',
  };
}

function executeUpdateDealStage(args: Record<string, unknown>): ToolResult {
  const dealId = args.deal_id as string;
  const newStage = args.new_stage as DealStage;
  const confirmed = args.confirmed as boolean;
  const reason = args.reason as string | undefined;

  const deal = getDeal(dealId);

  if (!deal) {
    return { success: false, error: `Deal with ID "${dealId}" not found.` };
  }

  // If not confirmed, ask for confirmation
  if (!confirmed) {
    return {
      success: false,
      requiresConfirmation: true,
      message: `⚠️ Please confirm: Move ${deal.borrowerName}'s deal from "${deal.stage}" to "${newStage}"${reason ? ` (Reason: ${reason})` : ''}? Reply with "yes" or "confirm" to proceed.`,
      data: {
        pendingAction: 'update_deal_stage',
        deal_id: dealId,
        current_stage: deal.stage,
        new_stage: newStage,
        reason,
      },
    };
  }

  // Execute the update
  const updated = updateDeal(dealId, { stage: newStage });

  if (!updated) {
    return { success: false, error: 'Failed to update deal stage.' };
  }

  return {
    success: true,
    data: updated,
    message: `✅ Moved ${deal.borrowerName}'s deal from "${deal.stage}" to "${newStage}".`,
    actionTaken: 'deal_stage_updated',
  };
}

function executeGetPipelineAnalytics(dealId?: string): ToolResult {
  if (dealId) {
    const deal = getDeal(dealId);
    if (!deal) {
      return { success: false, error: `Deal with ID "${dealId}" not found.` };
    }

    const activities = getActivitiesForDeal(dealId);
    const daysSinceCreated = deal.createdAt 
      ? Math.floor((Date.now() - new Date(deal.createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return {
      success: true,
      data: {
        deal,
        daysSinceCreated,
        totalActivities: activities.length,
      },
      message: `Analytics for ${deal.borrowerName}: ${daysSinceCreated} days in pipeline, ${activities.length} total activities, currently in "${deal.stage}" stage.`,
    };
  }

  // Get analytics for all deals
  const analytics = calculatePipelineAnalytics();

  const stageMessages = Object.entries(analytics.byStage)
    .filter(([_, data]) => data.count > 0)
    .map(([stage, data]) => `${stage}: ${data.count} ($${data.totalValue.toLocaleString()})`)
    .join(', ');

  return {
    success: true,
    data: analytics,
    message: `Pipeline has ${analytics.totalDeals} deals totaling $${analytics.totalPipelineValue.toLocaleString()}. ${stageMessages || 'No deals in pipeline.'}`,
  };
}

function executeGetDealActivities(args: Record<string, unknown>): ToolResult {
  const dealId = args.deal_id as string | undefined;
  const limit = (args.limit as number) || 20;

  let activities: DealActivity[];
  let contextMessage: string;

  if (dealId) {
    const deal = getDeal(dealId);
    if (!deal) {
      return { success: false, error: `Deal with ID "${dealId}" not found.` };
    }
    activities = getActivitiesForDeal(dealId).slice(0, limit);
    contextMessage = `for ${deal.borrowerName}'s deal`;
  } else {
    activities = getAllActivities().slice(0, limit);
    contextMessage = 'across all deals';
  }

  const summary = activities.map(activity => ({
    id: activity.id,
    dealId: activity.dealId,
    type: activity.type,
    date: activity.performedAt,
    description: activity.description,
    performedBy: activity.performedBy,
  }));

  return {
    success: true,
    data: summary,
    message: `Found ${activities.length} activities ${contextMessage}.`,
  };
}

async function executeRetrieveSchematic(args: Record<string, unknown>): Promise<ToolResult> {
  const componentName = args.component_name as string;
  const machineModel = args.machine_model as string | undefined;
  const additionalContext = args.additional_context as string | undefined;

  if (!componentName) {
    return { success: false, error: 'Component name is required.' };
  }

  const toolCall: SchematicToolCall = {
    component_name: componentName,
    machine_model: machineModel,
    additional_context: additionalContext,
  };

  const response = await processSchematicToolCall(toolCall);

  if (response.status === 'error') {
    return {
      success: false,
      error: response.message || 'Failed to retrieve schematic.',
    };
  }

  return {
    success: true,
    data: {
      componentId: response.component_id,
      componentName: response.component_name || componentName,
      machineModel: response.machine_model || machineModel,
      imagePath: response.image_path,
      manualContext: response.manual_context,
    },
    message: `Retrieved schematic for ${response.component_name || componentName}${response.machine_model ? ` (${response.machine_model})` : ''}.`,
    actionTaken: 'schematic_retrieved',
  };
}

async function executeDraftEmail(args: Record<string, unknown>, context?: ChatToolContext): Promise<ToolResult> {
  const to = args.to as string[];
  const subject = args.subject as string;
  const summary = args.summary as string;
  const recipientName = args.recipient_name as string | undefined;
  const includeSources = args.include_sources !== false; // Default to true
  const dealId = args.deal_id as string | undefined;

  if (!to || to.length === 0) {
    return { success: false, error: 'At least one recipient email address is required.' };
  }

  if (!subject) {
    return { success: false, error: 'Email subject is required.' };
  }

  if (!summary) {
    return { success: false, error: 'Email summary/body content is required.' };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = to.filter(email => !emailRegex.test(email));
  if (invalidEmails.length > 0) {
    return { success: false, error: `Invalid email address(es): ${invalidEmails.join(', ')}` };
  }

  // Get deal context if provided
  let dealContext = '';
  if (dealId) {
    const deal = getDeal(dealId);
    if (deal) {
      dealContext = `\n\nDeal Reference: ${deal.borrowerName} - ${deal.dealNumber}`;
    }
  }

  // Build sources from chat context
  const sources = includeSources && context?.ragSources ? context.ragSources : [];

  // Create OneDrive sharing links for sources that have oneDriveId
  const oneDriveSourceIds = sources
    .filter(s => (s as { oneDriveId?: string }).oneDriveId)
    .map(s => (s as { oneDriveId: string }).oneDriveId);
  
  let sharingLinks = new Map<string, string>();
  if (oneDriveSourceIds.length > 0) {
    console.log('[ChatTools] Creating sharing links for', oneDriveSourceIds.length, 'OneDrive sources');
    sharingLinks = await createOneDriveSharingLinks(oneDriveSourceIds);
    console.log('[ChatTools] Created', sharingLinks.size, 'sharing links');
  }

  // Build sources with sharing links
  const sourcesWithLinks = sources.map(s => {
    const oneDriveId = (s as { oneDriveId?: string }).oneDriveId;
    return {
      fileName: s.fileName,
      filePath: s.filePath,
      section: s.section,
      shareLink: oneDriveId ? sharingLinks.get(oneDriveId) : undefined,
    };
  });

  // Generate email body with summary and sources (including sharing links)
  const emailBody = generateEmailBody(
    summary + dealContext,
    sourcesWithLinks,
    true,
    recipientName
  );

  // Create the draft in Outlook AND open compose window
  const draft: EmailDraft = {
    to,
    subject,
    body: emailBody,
    bodyType: 'text',
  };

  const result = await createAndOpenEmailDraft(draft);

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'Failed to create email draft.',
    };
  }

  // Log email activity if we have a deal - use current timestamp for proper ordering
  if (dealId) {
    try {
      const now = new Date().toISOString();
      const activityData = {
        dealId,
        type: 'email' as const,
        description: `Email drafted to ${to.join(', ')}: "${subject}"`,
        performedBy: null,
        performedAt: now,
        metadata: JSON.stringify({
          draftId: result.data?.id,
          recipients: to,
          subject,
          action: 'drafted',
        }),
      };
      const activity = createDealActivity(activityData);
      console.log('[ChatTools] Email activity logged:', activity.id);
    } catch (err) {
      console.error('[ChatTools] Failed to log email activity:', err);
    }
  }

  const sourcesMsg = sources.length > 0 
    ? ` Included ${sources.length} document citation${sources.length > 1 ? 's' : ''}.` 
    : '';

  return {
    success: true,
    data: {
      draftId: result.data?.id,
      webLink: result.data?.webLink,
      to,
      subject,
      sourcesIncluded: sources.length,
    },
    message: `✅ Email compose window opened for ${to.join(', ')}.${sourcesMsg} Review and send from the Outlook window.`,
    actionTaken: 'email_drafted',
  };
}

// ============ Context Builder ============

/**
 * Build deal context for the system prompt
 * @param currentDealId - Optional ID of the currently focused deal
 */
export function buildDealContext(currentDealId?: string): string {
  const deals = getAllDeals();

  if (deals.length === 0) {
    return 'No deals have been added to the pipeline yet.';
  }

  // Find the current deal if specified
  const currentDeal = currentDealId ? deals.find(d => d.id === currentDealId) : null;
  
  // Build current deal focus section if applicable
  let currentDealSection = '';
  if (currentDeal) {
    currentDealSection = `\n--- CURRENT DEAL FOCUS ---\nYou are currently focused on: ${currentDeal.borrowerName} (${currentDeal.dealNumber})\nStage: ${currentDeal.stage} | Amount: $${currentDeal.loanAmount.toLocaleString()}${currentDeal.priority === 'high' ? ' | ⚠️ HIGH PRIORITY' : ''}\nWhen answering questions, prioritize information related to this deal.\n--- END CURRENT DEAL FOCUS ---\n`;
  }

  const dealList = deals.map(deal => {
    const isCurrent = deal.id === currentDealId;
    const marker = isCurrent ? '▶ ' : '- ';
    return `${marker}${deal.borrowerName} [${deal.dealNumber}] - $${deal.loanAmount.toLocaleString()} - Stage: ${deal.stage}${deal.priority === 'high' ? ' ⚠️ HIGH PRIORITY' : ''}${isCurrent ? ' (CURRENT)' : ''}`;
  }).join('\n');

  // Get recent activities across all deals
  const recentActivities = getAllActivities().slice(0, 5);
  const recentActivitiesText = recentActivities.length > 0
    ? '\n\nRecent activity:\n' + recentActivities.map(activity => {
        const deal = getDeal(activity.dealId);
        return `- ${new Date(activity.performedAt).toLocaleDateString()}: ${activity.type} for ${deal?.borrowerName || 'Unknown'} - ${activity.description}`;
      }).join('\n')
    : '';

  return `${currentDealSection}Deal Pipeline (${deals.length} deals):\n${dealList}${recentActivitiesText}`;
}

// ============ HubSpot Tool Implementations ============

async function executeGetHubSpotDeals(args: Record<string, unknown>): Promise<ToolResult> {
  // Check if connected
  const status = await getHubSpotAuthStatus();
  if (!status.connected) {
    return {
      success: false,
      error: 'Not connected to HubSpot. Please connect HubSpot in Settings first.',
    };
  }

  const limit = (args.limit as number) || 20;
  const searchQuery = args.search_query as string | undefined;

  try {
    let dealsResponse;

    if (searchQuery) {
      // Use search API if query provided
      dealsResponse = await searchHubSpotDeals({
        query: searchQuery,
        limit,
      });
    } else {
      // Otherwise get all deals
      dealsResponse = await getHubSpotDeals({ limit });
    }

    const deals = dealsResponse.results.map(deal => ({
      id: deal.id,
      name: deal.properties.dealname || 'Unnamed Deal',
      amount: deal.properties.amount ? `$${parseFloat(deal.properties.amount).toLocaleString()}` : 'N/A',
      stage: deal.properties.dealstage || 'Unknown',
      pipeline: deal.properties.pipeline || 'Default',
      closeDate: deal.properties.closedate || 'N/A',
      createdAt: deal.properties.createdate 
        ? new Date(deal.properties.createdate).toLocaleDateString() 
        : 'N/A',
    }));

    return {
      success: true,
      data: deals,
      message: `Found ${deals.length} HubSpot deal${deals.length !== 1 ? 's' : ''}.`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get HubSpot deals',
    };
  }
}

async function executeGetHubSpotDealDetails(dealId: string): Promise<ToolResult> {
  if (!dealId) {
    return { success: false, error: 'Deal ID is required' };
  }

  const status = await getHubSpotAuthStatus();
  if (!status.connected) {
    return {
      success: false,
      error: 'Not connected to HubSpot. Please connect HubSpot in Settings first.',
    };
  }

  try {
    const deal = await getHubSpotDeal(dealId);

    const dealDetails = {
      id: deal.id,
      name: deal.properties.dealname || 'Unnamed Deal',
      amount: deal.properties.amount ? `$${parseFloat(deal.properties.amount).toLocaleString()}` : 'N/A',
      stage: deal.properties.dealstage || 'Unknown',
      pipeline: deal.properties.pipeline || 'Default',
      closeDate: deal.properties.closedate || 'N/A',
      createdAt: deal.properties.createdate 
        ? new Date(deal.properties.createdate).toLocaleDateString() 
        : 'N/A',
      lastModified: deal.properties.hs_lastmodifieddate 
        ? new Date(deal.properties.hs_lastmodifieddate).toLocaleDateString() 
        : 'N/A',
      description: deal.properties.description || 'No description',
      ownerId: deal.properties.hubspot_owner_id || 'Unassigned',
      associatedContacts: deal.associations?.contacts?.results?.length || 0,
      associatedCompanies: deal.associations?.companies?.results?.length || 0,
    };

    return {
      success: true,
      data: dealDetails,
      message: `Retrieved details for "${dealDetails.name}".`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get HubSpot deal details',
    };
  }
}

async function executeGetHubSpotPipelineSummary(): Promise<ToolResult> {
  const status = await getHubSpotAuthStatus();
  if (!status.connected) {
    return {
      success: false,
      error: 'Not connected to HubSpot. Please connect HubSpot in Settings first.',
    };
  }

  try {
    // Get both summary and pipeline definitions for stage names
    const [summary, pipelinesResponse] = await Promise.all([
      getHubSpotDealsSummary(),
      getHubSpotPipelines(),
    ]);

    // Build stage name lookup
    const stageNames: Record<string, string> = {};
    for (const pipeline of pipelinesResponse.results) {
      for (const stage of pipeline.stages) {
        stageNames[stage.id] = stage.label;
      }
    }

    // Format stage breakdown with names
    const stageBreakdown = Object.entries(summary.dealsByStage).map(([stageId, data]) => ({
      stage: stageNames[stageId] || stageId,
      count: data.count,
      value: `$${data.value.toLocaleString()}`,
    }));

    const pipelineSummary = {
      totalDeals: summary.totalDeals,
      totalValue: `$${summary.totalValue.toLocaleString()}`,
      stageBreakdown,
      recentDeals: summary.recentDeals.slice(0, 5).map(deal => ({
        id: deal.id,
        name: deal.properties.dealname || 'Unnamed',
        amount: deal.properties.amount ? `$${parseFloat(deal.properties.amount).toLocaleString()}` : 'N/A',
        stage: stageNames[deal.properties.dealstage || ''] || deal.properties.dealstage || 'Unknown',
      })),
    };

    return {
      success: true,
      data: pipelineSummary,
      message: `HubSpot Pipeline: ${summary.totalDeals} deals totaling $${summary.totalValue.toLocaleString()}.`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get HubSpot pipeline summary',
    };
  }
}

async function executeGetHubSpotContacts(args: Record<string, unknown>): Promise<ToolResult> {
  const status = await getHubSpotAuthStatus();
  if (!status.connected) {
    return {
      success: false,
      error: 'Not connected to HubSpot. Please connect HubSpot in Settings first.',
    };
  }

  const limit = (args.limit as number) || 20;

  try {
    const contactsResponse = await getHubSpotContacts({ limit });

    const contacts = contactsResponse.results.map(contact => ({
      id: contact.id,
      name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim() || 'Unknown',
      email: contact.properties.email || 'N/A',
      phone: contact.properties.phone || 'N/A',
      company: contact.properties.company || 'N/A',
      jobTitle: contact.properties.jobtitle || 'N/A',
    }));

    return {
      success: true,
      data: contacts,
      message: `Found ${contacts.length} HubSpot contact${contacts.length !== 1 ? 's' : ''}.`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get HubSpot contacts',
    };
  }
}

async function executeGetHubSpotCompanies(args: Record<string, unknown>): Promise<ToolResult> {
  const status = await getHubSpotAuthStatus();
  if (!status.connected) {
    return {
      success: false,
      error: 'Not connected to HubSpot. Please connect HubSpot in Settings first.',
    };
  }

  const limit = (args.limit as number) || 20;

  try {
    const companiesResponse = await getHubSpotCompanies({ limit });

    const companies = companiesResponse.results.map(company => ({
      id: company.id,
      name: company.properties.name || 'Unknown',
      domain: company.properties.domain || 'N/A',
      industry: company.properties.industry || 'N/A',
      city: company.properties.city || 'N/A',
      state: company.properties.state || '',
      country: company.properties.country || 'N/A',
      employees: company.properties.numberofemployees || 'N/A',
      revenue: company.properties.annualrevenue 
        ? `$${parseFloat(company.properties.annualrevenue).toLocaleString()}` 
        : 'N/A',
    }));

    return {
      success: true,
      data: companies,
      message: `Found ${companies.length} HubSpot compan${companies.length !== 1 ? 'ies' : 'y'}.`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get HubSpot companies',
    };
  }
}

// ============ Financial Analysis Tool Implementations ============

function getDefaultDateRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  const twoYearsAgo = new Date(now);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const startDate = twoYearsAgo.toISOString().slice(0, 10);
  return { startDate, endDate };
}

function getSourceInfo(dealId: string): { sourceFiles: string[]; statementCount: number } {
  const statements = getStatementsByDeal(dealId);
  return {
    sourceFiles: [...new Set(statements.map(s => s.fileName))],
    statementCount: statements.length,
  };
}

function executeGetBalanceSummary(args: Record<string, unknown>): ToolResult {
  const dealId = args.deal_id as string;
  const deal = getDeal(dealId);
  if (!deal) {
    return { success: false, error: `Deal with ID "${dealId}" not found.` };
  }

  const defaults = getDefaultDateRange();
  const startDate = (args.start_date as string) || defaults.startDate;
  const endDate = (args.end_date as string) || defaults.endDate;

  const accounts = getBankAccountsByDeal(dealId);
  if (accounts.length === 0) {
    return {
      success: false,
      error: `No bank statements have been imported for ${deal.borrowerName}. Import bank statements first using the Bank Statement Import feature.`,
    };
  }

  const summary = getMonthlyBalanceSummary(dealId, startDate, endDate);
  if (summary.length === 0) {
    return {
      success: false,
      error: `No transaction data found in the date range ${startDate} to ${endDate}.`,
    };
  }

  // Calculate overall statistics
  const allMinBalances = summary.map(m => m.minBalance);
  const allAvgBalances = summary.map(m => m.avgBalance);
  const overallAvgMin = allMinBalances.reduce((a, b) => a + b, 0) / allMinBalances.length;
  const lowestMinBalance = Math.min(...allMinBalances);
  const lowestMinMonth = summary.find(m => m.minBalance === lowestMinBalance);
  const overallAvgBalance = allAvgBalances.reduce((a, b) => a + b, 0) / allAvgBalances.length;

  const sourceInfo = getSourceInfo(dealId);

  return {
    success: true,
    data: {
      dealName: deal.borrowerName,
      dateRange: { startDate, endDate },
      monthlyData: summary.map(m => ({
        month: m.month,
        avgBalance: Math.round(m.avgBalance * 100) / 100,
        minBalance: Math.round(m.minBalance * 100) / 100,
        maxBalance: Math.round(m.maxBalance * 100) / 100,
        totalDeposits: Math.round(m.totalDeposits * 100) / 100,
        totalWithdrawals: Math.round(m.totalWithdrawals * 100) / 100,
        transactionCount: m.transactionCount,
      })),
      overallStats: {
        averageMinBalance: Math.round(overallAvgMin * 100) / 100,
        lowestBalance: Math.round(lowestMinBalance * 100) / 100,
        lowestBalanceMonth: lowestMinMonth?.month || 'N/A',
        averageBalance: Math.round(overallAvgBalance * 100) / 100,
        monthsAnalyzed: summary.length,
      },
      sourceFiles: sourceInfo.sourceFiles,
      statementCount: sourceInfo.statementCount,
    },
    message: `Balance summary for ${deal.borrowerName} (${startDate} to ${endDate}): Average balance $${Math.round(overallAvgBalance).toLocaleString()}, Average lowest monthly balance $${Math.round(overallAvgMin).toLocaleString()}, Lowest recorded balance $${Math.round(lowestMinBalance).toLocaleString()} in ${lowestMinMonth?.month || 'N/A'}. Based on ${sourceInfo.statementCount} bank statements.`,
  };
}

function executeGetCashflowByPeriod(args: Record<string, unknown>): ToolResult {
  const dealId = args.deal_id as string;
  const deal = getDeal(dealId);
  if (!deal) {
    return { success: false, error: `Deal with ID "${dealId}" not found.` };
  }

  const defaults = getDefaultDateRange();
  const startDate = (args.start_date as string) || defaults.startDate;
  const endDate = (args.end_date as string) || defaults.endDate;
  const periodType = (args.period_type as 'month' | 'quarter') || 'month';

  const accounts = getBankAccountsByDeal(dealId);
  if (accounts.length === 0) {
    return {
      success: false,
      error: `No bank statements have been imported for ${deal.borrowerName}. Import bank statements first.`,
    };
  }

  const cashflow = getCashflowByPeriod(dealId, startDate, endDate, periodType);
  if (cashflow.length === 0) {
    return {
      success: false,
      error: `No transaction data found in the date range ${startDate} to ${endDate}.`,
    };
  }

  const totalInflows = cashflow.reduce((s, c) => s + c.inflows, 0);
  const totalOutflows = cashflow.reduce((s, c) => s + c.outflows, 0);
  const avgNetCashflow = cashflow.reduce((s, c) => s + c.netCashflow, 0) / cashflow.length;

  const sourceInfo = getSourceInfo(dealId);

  return {
    success: true,
    data: {
      dealName: deal.borrowerName,
      dateRange: { startDate, endDate },
      periodType,
      periods: cashflow.map(c => ({
        period: c.period,
        inflows: Math.round(c.inflows * 100) / 100,
        outflows: Math.round(c.outflows * 100) / 100,
        netCashflow: Math.round(c.netCashflow * 100) / 100,
        transactionCount: c.transactionCount,
      })),
      totals: {
        totalInflows: Math.round(totalInflows * 100) / 100,
        totalOutflows: Math.round(totalOutflows * 100) / 100,
        avgNetCashflowPerPeriod: Math.round(avgNetCashflow * 100) / 100,
        periodsAnalyzed: cashflow.length,
      },
      sourceFiles: sourceInfo.sourceFiles,
      statementCount: sourceInfo.statementCount,
    },
    message: `Cashflow analysis for ${deal.borrowerName} by ${periodType} (${startDate} to ${endDate}): Total inflows $${Math.round(totalInflows).toLocaleString()}, Total outflows $${Math.round(totalOutflows).toLocaleString()}, Avg net cashflow per ${periodType} $${Math.round(avgNetCashflow).toLocaleString()}. Based on ${sourceInfo.statementCount} bank statements.`,
  };
}

function executeDetectSeasonality(args: Record<string, unknown>): ToolResult {
  const dealId = args.deal_id as string;
  const deal = getDeal(dealId);
  if (!deal) {
    return { success: false, error: `Deal with ID "${dealId}" not found.` };
  }

  const defaults = getDefaultDateRange();
  const startDate = (args.start_date as string) || defaults.startDate;
  const endDate = (args.end_date as string) || defaults.endDate;

  const accounts = getBankAccountsByDeal(dealId);
  if (accounts.length === 0) {
    return {
      success: false,
      error: `No bank statements have been imported for ${deal.borrowerName}. Import bank statements first.`,
    };
  }

  const result = detectSeasonality(dealId, startDate, endDate);

  if (result.monthlyPattern.length === 0) {
    return {
      success: false,
      error: `No transaction data found for seasonality analysis in the date range ${startDate} to ${endDate}.`,
    };
  }

  const sourceInfo = getSourceInfo(dealId);

  return {
    success: true,
    data: {
      dealName: deal.borrowerName,
      dateRange: { startDate, endDate },
      seasonalityStrength: result.seasonalityStrength,
      overallAvgMonthlyNet: result.overallAvgMonthlyNet,
      monthlyPattern: result.monthlyPattern,
      lowMonths: result.lowMonths,
      highMonths: result.highMonths,
      sourceFiles: sourceInfo.sourceFiles,
      statementCount: sourceInfo.statementCount,
    },
    message: `Seasonality analysis for ${deal.borrowerName}: ${result.seasonalityStrength} seasonality detected. ${result.lowMonths.length > 0 ? `Low cashflow months: ${result.lowMonths.join(', ')}.` : 'No consistently low months.'} ${result.highMonths.length > 0 ? `High cashflow months: ${result.highMonths.join(', ')}.` : ''} Based on ${result.sourceInfo.statementCount} bank statements.`,
  };
}

function executeQueryTransactions(args: Record<string, unknown>): ToolResult {
  const dealId = args.deal_id as string;
  const deal = getDeal(dealId);
  if (!deal) {
    return { success: false, error: `Deal with ID "${dealId}" not found.` };
  }

  const keyword = args.keyword as string | undefined;
  const startDate = args.start_date as string | undefined;
  const endDate = args.end_date as string | undefined;
  const limit = (args.limit as number) || 50;

  const accounts = getBankAccountsByDeal(dealId);
  if (accounts.length === 0) {
    return {
      success: false,
      error: `No bank statements have been imported for ${deal.borrowerName}. Import bank statements first.`,
    };
  }

  let transactions;
  if (keyword) {
    transactions = searchTransactions(dealId, keyword, limit);
  } else if (startDate && endDate) {
    transactions = getTransactionsByDealAndDateRange(dealId, startDate, endDate).slice(0, limit);
  } else {
    // Default to last 3 months
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    transactions = getTransactionsByDealAndDateRange(
      dealId,
      threeMonthsAgo.toISOString().slice(0, 10),
      now.toISOString().slice(0, 10)
    ).slice(0, limit);
  }

  const totalDebits = transactions.reduce((s, t) => s + t.debit, 0);
  const totalCredits = transactions.reduce((s, t) => s + t.credit, 0);
  const sourceInfo = getSourceInfo(dealId);

  return {
    success: true,
    data: {
      dealName: deal.borrowerName,
      transactions: transactions.map(t => ({
        date: t.transactionDate,
        description: t.description,
        debit: t.debit > 0 ? Math.round(t.debit * 100) / 100 : null,
        credit: t.credit > 0 ? Math.round(t.credit * 100) / 100 : null,
        balance: t.runningBalance != null ? Math.round(t.runningBalance * 100) / 100 : null,
        category: t.category,
      })),
      summary: {
        count: transactions.length,
        totalDebits: Math.round(totalDebits * 100) / 100,
        totalCredits: Math.round(totalCredits * 100) / 100,
        searchKeyword: keyword || null,
        dateRange: startDate && endDate ? `${startDate} to ${endDate}` : null,
      },
      sourceFiles: sourceInfo.sourceFiles,
      statementCount: sourceInfo.statementCount,
    },
    message: `Found ${transactions.length} transactions for ${deal.borrowerName}${keyword ? ` matching "${keyword}"` : ''}. Total debits: $${Math.round(totalDebits).toLocaleString()}, Total credits: $${Math.round(totalCredits).toLocaleString()}. Based on ${sourceInfo.statementCount} bank statements.`,
  };
}

// ============ New Platform Tool Implementations ============

function executeCreateDeal(args: Record<string, unknown>): ToolResult {
  const borrowerName = args.borrower_name as string;
  if (!borrowerName) {
    return { success: false, error: 'Borrower name is required to create a deal.' };
  }

  const deal = createDeal({
    borrowerName,
    loanAmount: args.loan_amount as number | undefined,
    stage: (args.stage as any) || 'lead',
    priority: (args.priority as any) || 'medium',
    borrowerContact: args.borrower_contact as string | undefined,
    interestRate: args.interest_rate as number | undefined,
    termMonths: args.term_months as number | undefined,
    collateralDescription: args.collateral_description as string | undefined,
    notes: args.notes as string | undefined,
  });

  return {
    success: true,
    data: {
      id: deal.id,
      dealNumber: deal.dealNumber,
      borrowerName: deal.borrowerName,
      loanAmount: deal.loanAmount,
      stage: deal.stage,
      priority: deal.priority,
    },
    message: `Created deal ${deal.dealNumber} for ${deal.borrowerName} (${deal.stage} stage, $${(deal.loanAmount || 0).toLocaleString()}).`,
    actionTaken: 'deal_created',
  };
}

function executeUpdateDealFull(args: Record<string, unknown>): ToolResult {
  const dealId = args.deal_id as string;
  if (!dealId) {
    return { success: false, error: 'Deal ID is required.' };
  }

  const existing = getDeal(dealId);
  if (!existing) {
    return { success: false, error: `Deal ${dealId} not found.` };
  }

  const updates: Record<string, unknown> = {};
  if (args.borrower_name !== undefined) updates.borrowerName = args.borrower_name;
  if (args.borrower_contact !== undefined) updates.borrowerContact = args.borrower_contact;
  if (args.loan_amount !== undefined) updates.loanAmount = args.loan_amount;
  if (args.interest_rate !== undefined) updates.interestRate = args.interest_rate;
  if (args.term_months !== undefined) updates.termMonths = args.term_months;
  if (args.collateral_description !== undefined) updates.collateralDescription = args.collateral_description;
  if (args.stage !== undefined) updates.stage = args.stage;
  if (args.priority !== undefined) updates.priority = args.priority;
  if (args.assigned_to !== undefined) updates.assignedTo = args.assigned_to;
  if (args.notes !== undefined) updates.notes = args.notes;
  if (args.expected_close_date !== undefined) updates.expectedCloseDate = args.expected_close_date;

  const changed = Object.keys(updates);
  if (changed.length === 0) {
    return { success: false, error: 'No fields provided to update.' };
  }

  const updated = updateDeal(dealId, updates as any);
  if (!updated) {
    return { success: false, error: 'Failed to update deal.' };
  }

  return {
    success: true,
    data: {
      id: updated.id,
      dealNumber: updated.dealNumber,
      borrowerName: updated.borrowerName,
      loanAmount: updated.loanAmount,
      stage: updated.stage,
      priority: updated.priority,
      fieldsUpdated: changed,
    },
    message: `Updated ${changed.join(', ')} on deal ${updated.dealNumber} (${updated.borrowerName}).`,
    actionTaken: 'deal_updated',
  };
}

function executeDeleteDeal(args: Record<string, unknown>): ToolResult {
  const dealId = args.deal_id as string;
  const confirmed = args.confirmed === true;

  if (!dealId) {
    return { success: false, error: 'Deal ID is required.' };
  }

  const deal = getDeal(dealId);
  if (!deal) {
    return { success: false, error: `Deal ${dealId} not found.` };
  }

  if (!confirmed) {
    return {
      success: true,
      requiresConfirmation: true,
      data: {
        id: deal.id,
        dealNumber: deal.dealNumber,
        borrowerName: deal.borrowerName,
        loanAmount: deal.loanAmount,
        stage: deal.stage,
      },
      message: `⚠️ Are you sure you want to delete deal ${deal.dealNumber} (${deal.borrowerName}, $${(deal.loanAmount || 0).toLocaleString()})? This action cannot be undone. Please confirm to proceed.`,
    };
  }

  const deleted = deleteDeal(dealId);
  if (!deleted) {
    return { success: false, error: 'Failed to delete the deal.' };
  }

  return {
    success: true,
    data: { dealNumber: deal.dealNumber, borrowerName: deal.borrowerName },
    message: `Deleted deal ${deal.dealNumber} (${deal.borrowerName}).`,
    actionTaken: 'deal_deleted',
  };
}

function executeUpdateActivity(args: Record<string, unknown>): ToolResult {
  const activityId = args.activity_id as string;
  if (!activityId) {
    return { success: false, error: 'Activity ID is required.' };
  }

  const existing = getDealActivity(activityId);
  if (!existing) {
    return { success: false, error: `Activity ${activityId} not found.` };
  }

  const updates: Record<string, unknown> = {};
  if (args.type !== undefined) updates.type = args.type;
  if (args.description !== undefined) updates.description = args.description;
  if (args.performed_by !== undefined) updates.performedBy = args.performed_by;

  const changed = Object.keys(updates);
  if (changed.length === 0) {
    return { success: false, error: 'No fields provided to update.' };
  }

  const updated = updateDealActivity(activityId, updates as any);
  if (!updated) {
    return { success: false, error: 'Failed to update activity.' };
  }

  return {
    success: true,
    data: {
      id: updated.id,
      dealId: updated.dealId,
      type: updated.type,
      description: updated.description,
      fieldsUpdated: changed,
    },
    message: `Updated activity: ${updated.type} — ${updated.description?.slice(0, 80) || '(no description)'}`,
    actionTaken: 'activity_updated',
  };
}

function executeDeleteActivity(args: Record<string, unknown>): ToolResult {
  const activityId = args.activity_id as string;
  const confirmed = args.confirmed === true;

  if (!activityId) {
    return { success: false, error: 'Activity ID is required.' };
  }

  const existing = getDealActivity(activityId);
  if (!existing) {
    return { success: false, error: `Activity ${activityId} not found.` };
  }

  if (!confirmed) {
    return {
      success: true,
      requiresConfirmation: true,
      data: {
        id: existing.id,
        type: existing.type,
        description: existing.description?.slice(0, 120),
        dealId: existing.dealId,
      },
      message: `⚠️ Are you sure you want to delete this ${existing.type} activity? "${existing.description?.slice(0, 80) || '(no description)'}" — This cannot be undone. Please confirm to proceed.`,
    };
  }

  const deleted = deleteDealActivity(activityId);
  if (!deleted) {
    return { success: false, error: 'Failed to delete activity.' };
  }

  return {
    success: true,
    data: { type: existing.type, description: existing.description?.slice(0, 80) },
    message: `Deleted ${existing.type} activity.`,
    actionTaken: 'activity_deleted',
  };
}

function executeExportDealPdf(args: Record<string, unknown>): ToolResult {
  const dealId = args.deal_id as string;
  if (!dealId) {
    return { success: false, error: 'Deal ID is required.' };
  }

  const deal = getDeal(dealId);
  if (!deal) {
    return { success: false, error: `Deal ${dealId} not found.` };
  }

  // The actual PDF generation requires BrowserWindow — we signal the renderer to trigger it
  return {
    success: true,
    data: { dealId: deal.id, dealNumber: deal.dealNumber, borrowerName: deal.borrowerName },
    message: `Opening PDF export for deal ${deal.dealNumber} (${deal.borrowerName})…`,
    actionTaken: 'export_deal_pdf',
  };
}

function executeSearchDealFiles(args: Record<string, unknown>): ToolResult {
  const dealId = args.deal_id as string;
  if (!dealId) {
    return { success: false, error: 'Deal ID is required.' };
  }

  const deal = getDeal(dealId);
  if (!deal) {
    return { success: false, error: `Deal ${dealId} not found.` };
  }

  const docs = getDealDocuments(dealId);
  if (docs.length === 0) {
    return {
      success: true,
      data: { dealName: deal.borrowerName, documents: [] },
      message: `No documents are associated with ${deal.borrowerName}. Try indexing a folder first.`,
    };
  }

  return {
    success: true,
    data: {
      dealName: deal.borrowerName,
      documentCount: docs.length,
      documents: docs.map(d => ({
        id: d.id,
        fileName: d.fileName,
        filePath: d.filePath,
        autoDetected: d.autoDetected,
        addedAt: d.createdAt,
      })),
    },
    message: `Found ${docs.length} document(s) associated with ${deal.borrowerName}.`,
  };
}

function executeManageMemos(args: Record<string, unknown>): ToolResult {
  const action = args.action as string;
  const dealId = args.deal_id as string | undefined;

  if (action === 'list_templates') {
    const templates = getAllDocumentTemplates();
    if (templates.length === 0) {
      return {
        success: true,
        data: { templates: [] },
        message: 'No memo templates have been created yet. Create a template in the Templates section first.',
      };
    }

    return {
      success: true,
      data: {
        templates: templates.map(t => ({
          id: t.id,
          name: t.name,
          type: t.templateType,
          isActive: t.isActive,
          requiredSections: t.requiredSections,
        })),
      },
      message: `Found ${templates.length} template(s): ${templates.map(t => t.name).join(', ')}.`,
    };
  }

  if (action === 'list_memos') {
    if (!dealId) {
      return { success: false, error: 'deal_id is required for list_memos action.' };
    }

    const deal = getDeal(dealId);
    if (!deal) {
      return { success: false, error: `Deal ${dealId} not found.` };
    }

    const memos = getMemosByDeal(dealId);
    if (memos.length === 0) {
      return {
        success: true,
        data: { dealName: deal.borrowerName, memos: [] },
        message: `No memos have been generated for ${deal.borrowerName}. Use a template to generate one.`,
      };
    }

    return {
      success: true,
      data: {
        dealName: deal.borrowerName,
        memos: memos.map(m => ({
          id: m.id,
          templateName: m.templateName,
          status: m.status,
          version: m.version,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        })),
      },
      message: `Found ${memos.length} memo(s) for ${deal.borrowerName}: ${memos.map(m => `${m.templateName} (v${m.version}, ${m.status})`).join(', ')}.`,
    };
  }

  return { success: false, error: `Unknown action: ${action}. Use "list_templates" or "list_memos".` };
}
