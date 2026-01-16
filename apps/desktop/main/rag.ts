import OpenAI from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BrowserWindow, app } from 'electron';
import { IPC_CHANNELS, TEXT_EXTENSIONS, DOCUMENT_EXTENSIONS, IGNORED_PATTERNS } from '@drasill/shared';
import * as keychain from './keychain';

// For Word doc parsing
import mammoth from 'mammoth';

interface DocumentChunk {
  id: string;
  filePath: string;
  fileName: string;
  content: string;
  embedding: number[];
  chunkIndex: number;
  totalChunks: number;
}

interface VectorStore {
  workspacePath: string;
  chunks: DocumentChunk[];
  lastUpdated: number;
}

let vectorStore: VectorStore | null = null;
let isIndexing = false;
let openai: OpenAI | null = null;

const CHUNK_SIZE = 1000; // Characters per chunk
const CHUNK_OVERLAP = 200; // Overlap between chunks
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max per file (PDFs can be large)
const VECTOR_STORE_VERSION = 1; // Increment when format changes

/**
 * Get the path to the vector store cache file for a workspace
 */
function getVectorStorePath(workspacePath: string): string {
  const userDataPath = app.getPath('userData');
  // Create a safe filename from the workspace path
  const safeWorkspaceName = workspacePath
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .slice(-100); // Limit length
  return path.join(userDataPath, 'vector-cache', `${safeWorkspaceName}.json`);
}

/**
 * Save vector store to disk for persistence across sessions
 */
async function saveVectorStore(): Promise<void> {
  if (!vectorStore) return;
  
  try {
    const cachePath = getVectorStorePath(vectorStore.workspacePath);
    const cacheDir = path.dirname(cachePath);
    
    // Ensure cache directory exists
    await fs.mkdir(cacheDir, { recursive: true });
    
    // Save with version info for future compatibility
    const data = {
      version: VECTOR_STORE_VERSION,
      ...vectorStore,
    };
    
    await fs.writeFile(cachePath, JSON.stringify(data), 'utf-8');
    console.log(`[RAG] Vector store saved to ${cachePath} (${vectorStore.chunks.length} chunks)`);
  } catch (error) {
    console.error('[RAG] Failed to save vector store:', error);
  }
}

/**
 * Load vector store from disk if available
 */
async function loadVectorStore(workspacePath: string): Promise<boolean> {
  try {
    const cachePath = getVectorStorePath(workspacePath);
    
    const data = await fs.readFile(cachePath, 'utf-8');
    const parsed = JSON.parse(data);
    
    // Check version compatibility
    if (parsed.version !== VECTOR_STORE_VERSION) {
      console.log('[RAG] Vector store version mismatch, re-indexing required');
      return false;
    }
    
    // Verify workspace path matches
    if (parsed.workspacePath !== workspacePath) {
      console.log('[RAG] Vector store workspace mismatch, re-indexing required');
      return false;
    }
    
    vectorStore = {
      workspacePath: parsed.workspacePath,
      chunks: parsed.chunks,
      lastUpdated: parsed.lastUpdated,
    };
    
    console.log(`[RAG] Loaded vector store from cache (${vectorStore.chunks.length} chunks, last updated: ${new Date(vectorStore.lastUpdated).toLocaleString()})`);
    return true;
  } catch (error) {
    // File doesn't exist or is corrupted - that's fine, we'll re-index
    return false;
  }
}

/**
 * Initialize OpenAI client (async for keychain access)
 */
async function getOpenAI(): Promise<OpenAI | null> {
  if (!openai) {
    const apiKey = await keychain.getApiKey();
    if (apiKey) {
      openai = new OpenAI({ apiKey });
    }
  }
  return openai;
}

/**
 * Split text into overlapping chunks
 */
function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
    
    if (start >= text.length) break;
  }
  
  return chunks;
}

/**
 * Extract text from PDF file
 * Note: PDF parsing in Electron main process can be tricky
 * For now, we'll return a placeholder and the file path
 */
async function extractPdfText(filePath: string): Promise<string> {
  try {
    // Since pdf-parse has issues in Electron main process,
    // we'll just note it's a PDF and encourage opening it
    return `[PDF Document: ${path.basename(filePath)}]\nThis is a PDF file. Content indexing for PDFs is currently being improved.`;
  } catch (error) {
    console.error(`Failed to extract PDF text from ${filePath}:`, error);
    return '';
  }
}

/**
 * Extract text from Word document
 */
async function extractWordText(filePath: string): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  } catch (error) {
    console.error(`Failed to extract Word text from ${filePath}:`, error);
    return '';
  }
}

/**
 * Extract text from a file based on its type
 */
async function extractFileText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      console.log(`Skipping large file: ${filePath}`);
      return '';
    }
    
    if (ext === '.pdf') {
      return await extractPdfText(filePath);
    }
    
    if (ext === '.doc' || ext === '.docx') {
      return await extractWordText(filePath);
    }
    
    // Text files (including .md)
    if (TEXT_EXTENSIONS.includes(ext) || ext === '.md' || ext === '.markdown') {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    }
    
    return '';
  } catch (error) {
    console.error(`Failed to read file ${filePath}:`, error);
    return '';
  }
}

/**
 * Get embedding for text using OpenAI
 */
async function getEmbedding(text: string): Promise<number[]> {
  const client = await getOpenAI();
  if (!client) {
    throw new Error('OpenAI API key not configured');
  }
  
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000), // Limit input size
  });
  
  return response.data[0].embedding;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Recursively find all indexable files in a directory
 */
async function findFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (IGNORED_PATTERNS.includes(entry.name)) continue;
      
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await findFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (TEXT_EXTENSIONS.includes(ext) || DOCUMENT_EXTENSIONS.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`Failed to read directory ${dirPath}:`, error);
  }
  
  return files;
}

/**
 * Send indexing progress to renderer
 */
function sendProgress(window: BrowserWindow, current: number, total: number, fileName: string) {
  window.webContents.send(IPC_CHANNELS.RAG_INDEX_PROGRESS, {
    current,
    total,
    fileName,
    percentage: Math.round((current / total) * 100),
  });
}

/**
 * Index a workspace for RAG
 * @param workspacePath - Path to the workspace to index
 * @param window - BrowserWindow to send progress updates to
 * @param forceReindex - If true, ignore cached embeddings and re-index everything
 */
export async function indexWorkspace(workspacePath: string, window: BrowserWindow, forceReindex = false): Promise<{ success: boolean; chunksIndexed: number; error?: string; fromCache?: boolean }> {
  console.log(`[RAG] indexWorkspace called. forceReindex: ${forceReindex}`);
  
  if (isIndexing) {
    return { success: false, chunksIndexed: 0, error: 'Indexing already in progress' };
  }
  
  // Try to load from cache first (unless force re-index)
  if (!forceReindex) {
    const loaded = await loadVectorStore(workspacePath);
    if (loaded && vectorStore) {
      console.log(`[RAG] Using cached vector store with ${vectorStore.chunks.length} chunks`);
      window.webContents.send(IPC_CHANNELS.RAG_INDEX_COMPLETE, {
        chunksIndexed: vectorStore.chunks.length,
        filesIndexed: new Set(vectorStore.chunks.map(c => c.filePath)).size,
        fromCache: true,
      });
      return { success: true, chunksIndexed: vectorStore.chunks.length, fromCache: true };
    }
  }
  
  const client = await getOpenAI();
  if (!client) {
    return { success: false, chunksIndexed: 0, error: 'OpenAI API key not configured' };
  }
  
  isIndexing = true;
  
  try {
    // Find all indexable files
    const files = await findFiles(workspacePath);
    
    if (files.length === 0) {
      isIndexing = false;
      return { success: true, chunksIndexed: 0 };
    }
    
    const chunks: DocumentChunk[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const fileName = path.basename(filePath);
      
      sendProgress(window, i + 1, files.length, fileName);
      
      // Extract text
      const text = await extractFileText(filePath);
      if (!text || text.trim().length < 50) continue;
      
      // Chunk the text
      const textChunks = chunkText(text);
      
      // Get embeddings for each chunk
      for (let j = 0; j < textChunks.length; j++) {
        try {
          const embedding = await getEmbedding(textChunks[j]);
          
          chunks.push({
            id: `${filePath}-${j}`,
            filePath,
            fileName,
            content: textChunks[j],
            embedding,
            chunkIndex: j,
            totalChunks: textChunks.length,
          });
          
          // Rate limiting - small delay between embeddings
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          console.error(`Failed to get embedding for chunk ${j} of ${fileName}:`, error);
        }
      }
    }
    
    // Store the vector store
    vectorStore = {
      workspacePath,
      chunks,
      lastUpdated: Date.now(),
    };
    
    // Save to disk for persistence across sessions
    await saveVectorStore();
    
    isIndexing = false;
    
    // Send completion
    window.webContents.send(IPC_CHANNELS.RAG_INDEX_COMPLETE, {
      chunksIndexed: chunks.length,
      filesIndexed: files.length,
    });
    
    return { success: true, chunksIndexed: chunks.length };
  } catch (error) {
    isIndexing = false;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, chunksIndexed: 0, error: errorMessage };
  }
}

/**
 * Search the vector store for relevant chunks
 */
export async function searchRAG(query: string, topK = 5): Promise<{ chunks: Array<{ content: string; fileName: string; filePath: string; score: number; chunkIndex: number; totalChunks: number }> }> {
  if (!vectorStore || vectorStore.chunks.length === 0) {
    return { chunks: [] };
  }
  
  try {
    const queryEmbedding = await getEmbedding(query);
    
    // Calculate similarity for all chunks
    const scored = vectorStore.chunks.map(chunk => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));
    
    // Sort by similarity and take top K
    scored.sort((a, b) => b.score - a.score);
    const topChunks = scored.slice(0, topK);
    
    return {
      chunks: topChunks.map(c => ({
        content: c.content,
        fileName: c.fileName,
        filePath: c.filePath,
        score: c.score,
        chunkIndex: c.chunkIndex,
        totalChunks: c.totalChunks,
      })),
    };
  } catch (error) {
    console.error('RAG search failed:', error);
    return { chunks: [] };
  }
}

/**
 * Get RAG context for a chat query
 * Returns context with structured source citations
 */
export async function getRAGContext(query: string): Promise<{ context: string; sources: Array<{ fileName: string; filePath: string; section: string }> }> {
  const results = await searchRAG(query, 5);
  
  if (results.chunks.length === 0) {
    return { context: '', sources: [] };
  }
  
  // Build context string with source attribution
  // Use a numbered reference format that the AI can cite
  const sources: Array<{ fileName: string; filePath: string; section: string }> = [];
  const contextParts = results.chunks.map((chunk, index) => {
    const sectionLabel = chunk.totalChunks > 1 
      ? `Section ${chunk.chunkIndex + 1}/${chunk.totalChunks}`
      : 'Full Document';
    
    sources.push({
      fileName: chunk.fileName,
      filePath: chunk.filePath,
      section: sectionLabel,
    });
    
    return `[${index + 1}] ${chunk.fileName} (${sectionLabel})\n${chunk.content}`;
  });
  
  return {
    context: contextParts.join('\n\n---\n\n'),
    sources,
  };
}

/**
 * Check if workspace is indexed
 */
export function isWorkspaceIndexed(workspacePath: string): boolean {
  return vectorStore !== null && vectorStore.workspacePath === workspacePath;
}

/**
 * Get indexing status
 */
export function getIndexingStatus(): { isIndexing: boolean; chunksCount: number; lastUpdated: number | null; workspacePath: string | null } {
  return {
    isIndexing,
    chunksCount: vectorStore?.chunks.length || 0,
    lastUpdated: vectorStore?.lastUpdated || null,
    workspacePath: vectorStore?.workspacePath || null,
  };
}

/**
 * Try to load cached vector store for a workspace (call on app startup)
 */
export async function tryLoadCachedVectorStore(workspacePath: string): Promise<boolean> {
  if (vectorStore && vectorStore.workspacePath === workspacePath) {
    // Already loaded
    return true;
  }
  return await loadVectorStore(workspacePath);
}

/**
 * Clear the vector store (memory only - cache file remains)
 */
export function clearVectorStore(): void {
  vectorStore = null;
}

/**
 * Reset OpenAI client (for when API key changes)
 */
export function resetOpenAI(): void {
  openai = null;
}
