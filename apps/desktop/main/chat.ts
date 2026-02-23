import { BrowserWindow } from 'electron';
import { ChatRequest, IPC_CHANNELS, FileContext } from '@drasill/shared';
import { getRAGContext, getIndexingStatus } from './rag';
import { CHAT_TOOLS, executeTool, buildDealContext, ChatToolContext } from './chatTools';
import { proxyChatRequest, getSession } from './supabase';
import { incrementUsage } from './usage';
import { getActiveProfileWithInheritance } from './database';

/** Human-friendly labels for each chat tool, shown in the thinking UI */
const TOOL_LABELS: Record<string, string> = {
  get_deals: '📋 Looking up deals…',
  find_deal_by_name: '🔍 Searching deals…',
  get_deal_details: '📄 Fetching deal details…',
  add_deal_activity: '📝 Logging activity…',
  update_deal_stage: '🔄 Updating deal stage…',
  update_deal: '✏️ Updating deal…',
  create_deal: '➕ Creating deal…',
  delete_deal: '🗑️ Deleting deal…',
  update_activity: '✏️ Updating activity…',
  delete_activity: '🗑️ Removing activity…',
  get_pipeline_analytics: '📊 Analyzing pipeline…',
  get_deal_activities: '📋 Fetching activities…',
  retrieve_schematic: '🔧 Looking up schematic…',
  draft_email: '✉️ Drafting email…',
  export_deal_pdf: '📄 Exporting PDF…',
  search_deal_files: '📂 Searching files…',
  manage_memos: '📝 Managing memos…',
  get_hubspot_deals: '🔗 Fetching HubSpot deals…',
  get_hubspot_deal_details: '🔗 Fetching HubSpot deal…',
  get_hubspot_pipeline_summary: '🔗 Analyzing HubSpot pipeline…',
  get_hubspot_contacts: '🔗 Fetching contacts…',
  get_hubspot_companies: '🔗 Fetching companies…',
  get_balance_summary: '📊 Analyzing balances…',
  get_cashflow_by_period: '📊 Analyzing cashflow…',
  detect_seasonality: '📊 Detecting seasonality…',
  query_transactions: '🔍 Searching transactions…',
  get_underwriting_summary: '📊 Running underwriting analysis…',
  get_bank_statement_overview: '📊 Reviewing bank statement data…',
  export_underwriting_report: '📄 Exporting underwriting report…',
};

let abortController: AbortController | null = null;

/**
 * Check if user is authenticated (replaces API key check)
 */
export async function hasApiKey(): Promise<boolean> {
  const session = await getSession();
  return session !== null;
}

/**
 * Get masked API key info (for display - now shows auth status)
 */
export async function getApiKey(): Promise<string | null> {
  const session = await getSession();
  return session ? 'Using Drasill Cloud API' : null;
}

/**
 * Set API key - no longer needed with proxy, but kept for compatibility
 */
export async function setApiKey(_apiKey: string): Promise<boolean> {
  // No longer needed - using cloud proxy
  return true;
}

/**
 * RAG source citation info
 */
interface RAGSource {
  fileName: string;
  filePath: string;
  section: string;
  pageNumber?: number;
  source?: 'local' | 'onedrive';
  oneDriveId?: string;
  relevanceScore?: number;
  fromOtherDeal?: boolean;
  dealId?: string;
}

/**
 * Rough token estimation (~4 chars per token for English text)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a token budget
 */
function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[... truncated to fit context window ...]';
}

// Token budget allocation for system prompt sections
const TOTAL_SYSTEM_BUDGET = 12000; // ~12K tokens for entire system prompt
const KNOWLEDGE_PROFILE_BUDGET = 2000; // Knowledge profile guidelines
const DEAL_PIPELINE_BUDGET = 1500; // Deal pipeline context
const RAG_CONTEXT_BUDGET = 6000; // RAG retrieved chunks (highest priority)
const FILE_CONTEXT_BUDGET = 2000; // Current file context

/**
 * Build the system prompt with dynamic token budgeting
 * Allocates tokens across sections by priority, truncating low-priority sections first
 * Returns both the prompt and any RAG sources for citation
 * @param context - Current file context if any
 * @param userQuery - The user's query for RAG search
 * @param currentDealId - Optional deal ID for deal-scoped search
 */
async function buildSystemPrompt(context?: FileContext, userQuery?: string, currentDealId?: string): Promise<{ prompt: string; ragSources: RAGSource[] }> {
  let systemPrompt = `You are an AI assistant for Drasill - a lending deal flow management and underwriting system.

Your capabilities:
- Analyze loan documents and underwriting materials
- Summarize deal information and documentation
- Answer questions about deals, borrowers, and lending terms
- Help find specific information in indexed documents
- Manage deals through the pipeline via function calls (add activities, update stages)
- Provide pipeline analytics and deal tracking
- Analyze bank statements: balance summaries, cashflow trends, seasonality detection, and transaction search

When users want to add activities or update deal stages, use the available tools. For stage changes, always ask for confirmation first by calling the tool with confirmed=false.

FINANCIAL DATA FORMATTING:
When returning financial analysis results (balance summaries, cashflow data, seasonality patterns, transactions), format the data as markdown tables for clarity. Use the | column | format with alignment separators.
- Currency values should include $ signs and commas (e.g., $12,345.67)
- Include a brief narrative summary below the table highlighting key findings
- When source bank statement files are provided in tool results, cite them using [[1]], [[2]] format
- Flag notably low or high values in your narrative

UNDERWRITING SUMMARY FORMAT:
When the get_underwriting_summary tool returns data, format it as a professional underwriting report with these sections:

**Report Header:**
- Title: "Bank Statement Analysis — [Borrower Name]"
- Analysis Period: [start] to [end]
- Source Statements: List each as [[1]] File Name (period), [[2]] File Name (period), etc.

**Sections (use markdown tables with monthly columns):**
1. Monthly Deposits — dollar amounts per month, Average row, Minimum row
2. Average Daily Balance — per month, Average row, Minimum row
3. Monthly # of Deposits — counts per month, Average row
4. Negative Balance Days — days per month where balance < $0, Total row
5. NSF/Returned Items — counts per month, Total row
6. Overdraft Transactions — counts per month, Total row
7. MCA Positions — table: Company | Current Payment | Frequency | Status
   - "Number of Positions: N" (note if auto-detected or user-overridden)

**Summary Findings:** Brief narrative highlighting key strengths and red flags.

BANK STATEMENT ANALYSIS WORKFLOW:
When a user asks to "analyze bank statements" or clicks the Analyze button:
1. FIRST call get_bank_statement_overview to see what data is available
2. Present the overview to the user:
   - List each bank account (institution, account type, last 4 digits)
   - List each statement period with file names
   - Show the full available date range
3. Ask qualifying questions:
   - "I found [N] bank statements covering [date range]. Would you like me to analyze all [N] months, or a specific date range?"
   - If multiple accounts: "I see [N] accounts at [banks]. Should I include all accounts or focus on a specific one?"
   - If MCA patterns were previously detected, mention them
4. Wait for user confirmation, THEN call get_underwriting_summary with their preferences
5. Format the result as the professional report described above
6. After presenting the analysis, offer: "Would you like me to export this as a PDF report?" If the user says yes, call export_underwriting_report.

Do NOT skip the qualification step — always present the overview first so the user can confirm scope.

Be concise, accurate, and helpful. When referencing information from provided context, cite specific sources or file names using [[1]], [[2]] format. Summarize actions you take.`;

  let remainingBudget = TOTAL_SYSTEM_BUDGET - estimateTokens(systemPrompt);

  // Add active knowledge profile context (soft guardrails) - medium priority
  const { profile: activeProfile, fullGuidelines } = getActiveProfileWithInheritance();
  if (activeProfile && fullGuidelines) {
    let profileSection = `\n\n--- KNOWLEDGE PROFILE: ${activeProfile.name.toUpperCase()} ---
The following contextual guidelines apply to this conversation. These are suggestions to help ensure consistency and accuracy, not strict rules:

${fullGuidelines}`;
    
    if (activeProfile.terminology) {
      profileSection += `\n\nKey Terminology:\n${activeProfile.terminology}`;
    }
    
    if (activeProfile.complianceChecks) {
      profileSection += `\n\nCompliance Considerations (soft reminders, not blocking requirements):\n${activeProfile.complianceChecks}`;
    }
    
    profileSection += `\n--- END KNOWLEDGE PROFILE ---`;
    
    // Truncate to budget
    const profileBudget = Math.min(KNOWLEDGE_PROFILE_BUDGET, Math.floor(remainingBudget * 0.2));
    profileSection = truncateToTokenBudget(profileSection, profileBudget);
    systemPrompt += profileSection;
    remainingBudget -= estimateTokens(profileSection);
  }

  // Add deal pipeline context - medium priority
  const dealContext = buildDealContext(currentDealId);
  const dealBudget = Math.min(DEAL_PIPELINE_BUDGET, Math.floor(remainingBudget * 0.15));
  const truncatedDealContext = truncateToTokenBudget(dealContext, dealBudget);
  const dealSection = `\n\n--- DEAL PIPELINE ---\n${truncatedDealContext}\n--- END DEAL PIPELINE ---`;
  systemPrompt += dealSection;
  remainingBudget -= estimateTokens(dealSection);

  // Add RAG context if available - HIGHEST priority (gets largest budget)
  const ragStatus = getIndexingStatus();
  let ragSources: RAGSource[] = [];
  
  if (ragStatus.chunksCount > 0 && userQuery) {
    try {
      const ragResult = await getRAGContext(userQuery, currentDealId);
      if (ragResult.context) {
        ragSources = ragResult.sources;
        
        const hasOtherDealSources = ragSources.some(s => s.fromOtherDeal);
        const otherDealNote = hasOtherDealSources 
          ? '\n\nNote: Some sources marked [FROM OTHER DEAL] are from deals other than the current focus.'
          : '';
        
        // RAG gets the lion's share of remaining budget
        const ragBudget = Math.min(RAG_CONTEXT_BUDGET, Math.floor(remainingBudget * 0.7));
        const truncatedRagContext = truncateToTokenBudget(ragResult.context, ragBudget);
        
        const ragSection = `\n\n--- KNOWLEDGE BASE CONTEXT ---
The following numbered sources were retrieved from the user's indexed documentation:

${truncatedRagContext}
--- END KNOWLEDGE BASE CONTEXT ---

IMPORTANT: When referencing information from the knowledge base, cite using the format [[1]], [[2]], etc. corresponding to the source numbers above. Always cite your sources when providing information from the documentation.${otherDealNote}`;
        
        systemPrompt += ragSection;
        remainingBudget -= estimateTokens(ragSection);
      }
    } catch (error) {
      console.error('Failed to get RAG context:', error);
    }
  }

  // Add current file context - lower priority (uses whatever budget remains)
  if (context) {
    const fileBudget = Math.min(FILE_CONTEXT_BUDGET, remainingBudget - 100); // Keep small reserve
    const truncatedContent = truncateToTokenBudget(context.content, Math.max(fileBudget - 50, 500));

    const fileSection = `\n\n--- CURRENT FILE CONTEXT ---
File: ${context.fileName}
Path: ${context.filePath}
Type: ${context.fileType}

Content:
${truncatedContent}
--- END FILE CONTEXT ---

The user is viewing this file. Answer questions with reference to this content when relevant.`;
    
    systemPrompt += fileSection;
  }

  console.log(`[Chat] System prompt built: ~${estimateTokens(systemPrompt)} tokens, ${ragSources.length} RAG sources`);

  return { prompt: systemPrompt, ragSources };
}

/**
 * Cancel ongoing stream
 */
export function cancelStream(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}

/**
 * Send a chat message with streaming response and tool support
 */
export async function sendChatMessage(
  window: BrowserWindow,
  request: ChatRequest
): Promise<void> {
  // Check if authenticated
  const session = await getSession();
  if (!session) {
    window.webContents.send(IPC_CHANNELS.CHAT_STREAM_ERROR, {
      error: 'Not authenticated. Please sign in to use chat.',
    });
    return;
  }

  // Create abort controller for cancellation
  abortController = new AbortController();

  const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  try {
    // Build system prompt with RAG context (pass dealId for deal-scoped search)
    const { prompt: systemPrompt, ragSources } = await buildSystemPrompt(request.context, request.message, request.dealId);
    
    // Send RAG sources to frontend if available (for citation linking)
    if (ragSources.length > 0) {
      console.log('[Chat] Sending RAG sources to frontend:', JSON.stringify(ragSources, null, 2));
      window.webContents.send(IPC_CHANNELS.CHAT_STREAM_START, {
        messageId,
        ragSources,
      });
    }
    
    // Aggregate RAG sources from conversation history for activity creation
    const allRagSources: RAGSource[] = [...ragSources];
    for (const msg of request.history) {
      if (msg.ragSources && msg.ragSources.length > 0) {
        allRagSources.push(...msg.ragSources.map(s => ({
          fileName: s.fileName,
          filePath: s.filePath,
          section: s.section || '',
          pageNumber: s.pageNumber,
          source: s.source,
          oneDriveId: s.oneDriveId,
          relevanceScore: s.relevanceScore,
          fromOtherDeal: s.fromOtherDeal,
          dealId: s.dealId,
        })));
      }
    }
    
    // Build messages array
    const messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }> = [
      { role: 'system', content: systemPrompt },
      ...request.history.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: request.message },
    ];

    // Convert CHAT_TOOLS to the format expected by the API
    const tools = CHAT_TOOLS.map(tool => ({
      type: 'function' as const,
      function: tool.function,
    }));

    // Build tool context with cumulative RAG sources for activity creation
    const toolContext: ChatToolContext = {
      ragSources: allRagSources,
    };
    
    // Handle tool calls iteratively (max 5 iterations to prevent infinite loops)
    let iterations = 0;
    let continueLoop = true;
    
    while (continueLoop && iterations < 5) {
      iterations++;
      
      // Call via proxy
      const response = await proxyChatRequest(
        messages,
        {
          model: 'gpt-4o-mini',
          tools,
          tool_choice: 'auto',
          max_tokens: 2048,
          temperature: 0.7,
        },
        undefined, // No streaming callback for tool calls
        abortController.signal
      );

      if (!response.success) {
        throw new Error(response.error || 'Chat request failed');
      }

      // Check if we have tool calls to process
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Add assistant message with tool calls to conversation
        messages.push({
          role: 'assistant',
          content: response.content || null,
          tool_calls: response.tool_calls,
        });
        
        // Execute each tool call
        for (const toolCall of response.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            console.error('Failed to parse tool arguments:', e);
          }
          
          // Emit tool progress: started
          const toolLabel = TOOL_LABELS[toolCall.function.name] || `⚙️ Running ${toolCall.function.name}…`;
          window.webContents.send(IPC_CHANNELS.CHAT_TOOL_PROGRESS, {
            toolName: toolCall.function.name,
            status: 'started',
            label: toolLabel,
          });
          
          const result = await executeTool(toolCall.function.name, args, toolContext);
          
          // Emit tool progress: completed
          window.webContents.send(IPC_CHANNELS.CHAT_TOOL_PROGRESS, {
            toolName: toolCall.function.name,
            status: 'completed',
            label: toolLabel,
          });
          
          // Notify renderer if action was taken
          if (result.actionTaken) {
            window.webContents.send('chat-tool-executed', {
              action: result.actionTaken,
              data: result.data,
            });
          }
          
          // Add tool result to messages
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
      } else {
        // No tool calls - we have the final response
        continueLoop = false;
        
        // Stream the final text response
        if (response.content) {
          const content = response.content;
          const chunkSize = 20;
          for (let i = 0; i < content.length; i += chunkSize) {
            window.webContents.send(IPC_CHANNELS.CHAT_STREAM_CHUNK, {
              id: messageId,
              delta: content.slice(i, i + chunkSize),
              done: false,
            });
            // Small delay for smooth streaming effect
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      }
    }

    // Track AI message usage
    incrementUsage('ai_messages');

    // Signal stream complete
    window.webContents.send(IPC_CHANNELS.CHAT_STREAM_END, {
      id: messageId,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError' || (error as Error).message === 'Request cancelled') {
      // Stream was cancelled
      window.webContents.send(IPC_CHANNELS.CHAT_STREAM_END, {
        id: messageId,
        cancelled: true,
      });
    } else {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      window.webContents.send(IPC_CHANNELS.CHAT_STREAM_ERROR, {
        id: messageId,
        error: errorMessage,
      });
    }
  } finally {
    abortController = null;
  }
}
