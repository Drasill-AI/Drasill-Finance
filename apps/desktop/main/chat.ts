import OpenAI from 'openai';
import Store from 'electron-store';
import { BrowserWindow } from 'electron';
import { ChatRequest, IPC_CHANNELS, FileContext } from '@drasill/shared';
import { getRAGContext, getIndexingStatus } from './rag';

// Encrypted store for API key
const store = new Store({
  name: 'drasill-config',
  encryptionKey: 'drasill-cloud-secure-key-2024',
});

const API_KEY_STORE_KEY = 'openai-api-key';

let openai: OpenAI | null = null;
let abortController: AbortController | null = null;

/**
 * Initialize OpenAI client with stored API key
 */
function initializeOpenAI(): boolean {
  const apiKey = store.get(API_KEY_STORE_KEY) as string | undefined;
  if (apiKey) {
    openai = new OpenAI({ apiKey });
    return true;
  }
  return false;
}

/**
 * Set the OpenAI API key
 */
export function setApiKey(apiKey: string): void {
  store.set(API_KEY_STORE_KEY, apiKey);
  openai = new OpenAI({ apiKey });
}

/**
 * Get the OpenAI API key (masked)
 */
export function getApiKey(): string | null {
  const apiKey = store.get(API_KEY_STORE_KEY) as string | undefined;
  if (!apiKey) return null;
  // Return masked version
  return apiKey.slice(0, 7) + '...' + apiKey.slice(-4);
}

/**
 * Check if API key is configured
 */
export function hasApiKey(): boolean {
  return !!store.get(API_KEY_STORE_KEY);
}

/**
 * Build the system prompt with optional file context and RAG context
 */
async function buildSystemPrompt(context?: FileContext, userQuery?: string): Promise<string> {
  let systemPrompt = `You are Drasill Assistant, an AI helper for equipment documentation. You help users understand technical documentation, manuals, specifications, and other equipment-related files.

Your capabilities:
- Explain technical concepts in documentation
- Summarize long documents
- Answer questions about equipment specifications
- Help find specific information in documents
- Provide context and clarification

Be concise, accurate, and helpful. When referencing information from provided context, cite specific sources or file names.`;

  // Add RAG context if available
  const ragStatus = getIndexingStatus();
  if (ragStatus.chunksCount > 0 && userQuery) {
    try {
      const ragContext = await getRAGContext(userQuery);
      if (ragContext) {
        systemPrompt += `\n\n--- KNOWLEDGE BASE CONTEXT ---
The following information was retrieved from the user's indexed documentation:

${ragContext}
--- END KNOWLEDGE BASE CONTEXT ---

Use this context to answer the user's question. Cite the source file when referencing information.`;
      }
    } catch (error) {
      console.error('Failed to get RAG context:', error);
    }
  }

  if (context) {
    const contentPreview = context.content.length > 6000 
      ? context.content.slice(0, 6000) + '\n\n[... content truncated ...]'
      : context.content;

    systemPrompt += `\n\n--- CURRENT FILE CONTEXT ---
File: ${context.fileName}
Path: ${context.filePath}
Type: ${context.fileType}

Content:
${contentPreview}
--- END FILE CONTEXT ---

The user is viewing this file. Answer questions with reference to this content when relevant.`;
  }

  return systemPrompt;
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
 * Send a chat message with streaming response
 */
export async function sendChatMessage(
  window: BrowserWindow,
  request: ChatRequest
): Promise<void> {
  // Initialize if needed
  if (!openai && !initializeOpenAI()) {
    window.webContents.send(IPC_CHANNELS.CHAT_STREAM_ERROR, {
      error: 'OpenAI API key not configured. Please set your API key in settings.',
    });
    return;
  }

  // Create abort controller for cancellation
  abortController = new AbortController();

  const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  try {
    // Build system prompt with RAG context
    const systemPrompt = await buildSystemPrompt(request.context, request.message);
    
    // Build messages array
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...request.history.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: request.message },
    ];

    // Create streaming completion
    const stream = await openai!.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        messages,
        stream: true,
        max_tokens: 2048,
        temperature: 0.7,
      },
      { signal: abortController.signal }
    );

    // Stream chunks to renderer
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        window.webContents.send(IPC_CHANNELS.CHAT_STREAM_CHUNK, {
          id: messageId,
          delta,
          done: false,
        });
      }
    }

    // Signal stream complete
    window.webContents.send(IPC_CHANNELS.CHAT_STREAM_END, {
      id: messageId,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
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
