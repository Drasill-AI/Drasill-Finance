import OpenAI from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { BrowserWindow, ipcMain, app } from 'electron';
import { IPC_CHANNELS, TEXT_EXTENSIONS, DOCUMENT_EXTENSIONS, IGNORED_PATTERNS } from '@drasill/shared';
import * as keychain from './keychain';
import { getDealsForDocument, getDealDocuments, getRelevanceThresholds } from './database';
import { incrementUsage } from './usage';

// For Word doc parsing
import mammoth from 'mammoth';

// For Excel parsing
import * as XLSX from 'xlsx';

// PDF extraction request tracking
interface PdfExtractionRequest {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}
const pendingPdfExtractions = new Map<string, PdfExtractionRequest>();
let pdfExtractionReady = false;

interface DocumentChunk {
  id: string;
  filePath: string;
  fileName: string;
  content: string;
  embedding: number[];
  chunkIndex: number;
  totalChunks: number;
  pageNumber?: number; // For PDFs, the page where this chunk came from
  source?: 'local' | 'onedrive'; // Source type
  oneDriveId?: string; // OneDrive item ID for cloud files
  lastModified?: number; // File modification timestamp for incremental indexing
  parentId?: string; // ID of parent chunk for hierarchical retrieval
  sectionHeading?: string; // Section heading this chunk belongs to
  chunkType?: 'parent' | 'child'; // Whether this is a parent or child chunk
  contentHash?: string; // MD5 hash of content for dedup
}

interface FileMetadata {
  filePath: string;
  fileId: string; // filePath for local, oneDriveId for cloud
  lastModified: number;
  chunkCount: number;
  contentHash: string; // MD5 hash of file content for incremental indexing
}

interface VectorStore {
  workspacePath: string;
  chunks: DocumentChunk[];
  lastUpdated: number;
  fileMetadata: Record<string, FileMetadata>; // Track file modification times
}

let vectorStore: VectorStore | null = null;
let isIndexing = false;
let openai: OpenAI | null = null;

// Hierarchical chunk sizes
const PARENT_CHUNK_SIZE = 3000; // Characters per parent chunk (larger context window)
const CHILD_CHUNK_SIZE = 500; // Characters per child chunk (precise retrieval)
const CHUNK_OVERLAP = 100; // Overlap between child chunks
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max per file (PDFs can be large)
const VECTOR_STORE_VERSION = 5; // Bumped for hierarchical chunking + incremental indexing

// Hybrid search constants
const BM25_K1 = 1.5; // Term frequency saturation parameter
const BM25_B = 0.75; // Length normalization parameter
const VECTOR_WEIGHT = 0.7; // Weight for vector similarity in hybrid search
const BM25_WEIGHT = 0.3; // Weight for BM25 in hybrid search
const MIN_RELEVANCE_THRESHOLD = 0.25; // Minimum score to include in results

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
      fileMetadata: parsed.fileMetadata || {},
    };
    
    console.log(`[RAG] Loaded vector store from cache (${vectorStore.chunks.length} chunks, ${Object.keys(vectorStore.fileMetadata).length} files tracked, last updated: ${new Date(vectorStore.lastUpdated).toLocaleString()})`);
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
 * Split text into sentences using simple heuristics
 */
function splitIntoSentences(text: string): string[] {
  const abbreviations = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|viz|al|fig|vol|no|pp|ch|sec)\./gi;
  let processedText = text.replace(abbreviations, (match) => match.replace('.', '<<<DOT>>>'));
  const parts = processedText.split(/(?<=[.!?])\s+/);
  const sentences: string[] = [];
  for (const part of parts) {
    const sentence = part.replace(/<<<DOT>>>/g, '.').trim();
    if (sentence) sentences.push(sentence);
  }
  return sentences;
}

/**
 * Detect section headings in text (Markdown, document-style headings)
 */
function detectSections(text: string): Array<{ heading: string; content: string }> {
  const sections: Array<{ heading: string; content: string }> = [];
  
  // Split by various heading patterns:
  // Markdown: # Heading, ## Heading, ### Heading
  // Document: ALL CAPS lines, lines ending with colon, underlined headings
  const headingPattern = /^(#{1,4}\s+.+|[A-Z][A-Z\s]{4,}[A-Z]|.+\n[=\-]{3,}|[A-Z].{0,60}:)\s*$/gm;
  
  let match;
  
  const matches: Array<{ heading: string; index: number }> = [];
  while ((match = headingPattern.exec(text)) !== null) {
    matches.push({ heading: match[1].replace(/^#+\s+/, '').trim(), index: match.index });
  }
  
  if (matches.length === 0) {
    // No headings found, return entire text as one section
    return [{ heading: '', content: text }];
  }
  
  for (let i = 0; i < matches.length; i++) {
    // Content before first heading
    if (i === 0 && matches[0].index > 0) {
      const preamble = text.slice(0, matches[0].index).trim();
      if (preamble.length > 30) {
        sections.push({ heading: '', content: preamble });
      }
    }
    
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const content = text.slice(start, end).trim();
    
    if (content.length > 20) {
      sections.push({ heading: matches[i].heading, content });
    }
  }
  
  if (sections.length === 0) {
    return [{ heading: '', content: text }];
  }
  
  return sections;
}

/**
 * Create child chunks from text with overlap
 * Respects sentence boundaries when possible
 */
function createChildChunks(text: string, maxSize = CHILD_CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    const trimmedPara = paragraph.trim();
    
    if (trimmedPara.length > maxSize) {
      // Flush current chunk
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      // Split large paragraph into sentences
      const sentences = splitIntoSentences(trimmedPara);
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length + 1 > maxSize) {
          if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
            // Overlap: keep last portion
            currentChunk = currentChunk.slice(-overlap);
          }
        }
        currentChunk += (currentChunk && !currentChunk.endsWith(' ') ? ' ' : '') + sentence;
      }
    } else {
      const separator = currentChunk ? '\n\n' : '';
      if (currentChunk.length + separator.length + trimmedPara.length > maxSize) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = currentChunk.slice(-overlap) + '\n\n' + trimmedPara;
        } else {
          currentChunk = trimmedPara;
        }
      } else {
        currentChunk += separator + trimmedPara;
      }
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.filter(c => c.length > 20);
}

/**
 * Hierarchical chunking: creates parent chunks (large context) and child chunks (precise retrieval)
 * Child chunks point back to their parent for context expansion during retrieval
 */
function chunkTextHierarchical(
  text: string, 
  filePath: string, 
  _fileName?: string,
  options?: { pageNumber?: number; source?: 'local' | 'onedrive'; oneDriveId?: string }
): Array<{ content: string; chunkType: 'parent' | 'child'; parentId?: string; sectionHeading?: string; pageNumber?: number }> {
  const results: Array<{ content: string; chunkType: 'parent' | 'child'; parentId?: string; sectionHeading?: string; pageNumber?: number }> = [];
  
  // Detect sections
  const sections = detectSections(text);
  
  let parentIndex = 0;
  
  for (const section of sections) {
    const sectionText = section.content;
    
    // Create parent chunks from section text
    // If section is small enough, it becomes one parent chunk
    if (sectionText.length <= PARENT_CHUNK_SIZE) {
      const parentId = `${filePath}-parent-${parentIndex}`;
      parentIndex++;
      
      // Add parent chunk
      results.push({
        content: sectionText,
        chunkType: 'parent',
        sectionHeading: section.heading,
        pageNumber: options?.pageNumber,
      });
      
      // Create child chunks from this parent
      const childTexts = createChildChunks(sectionText);
      for (const childText of childTexts) {
        results.push({
          content: childText,
          chunkType: 'child',
          parentId,
          sectionHeading: section.heading,
          pageNumber: options?.pageNumber,
        });
      }
    } else {
      // Section too large — split into multiple parent chunks
      const parentTexts = createChildChunks(sectionText, PARENT_CHUNK_SIZE, 200);
      
      for (const parentText of parentTexts) {
        const parentId = `${filePath}-parent-${parentIndex}`;
        parentIndex++;
        
        results.push({
          content: parentText,
          chunkType: 'parent',
          sectionHeading: section.heading,
          pageNumber: options?.pageNumber,
        });
        
        // Create child chunks from this parent
        const childTexts = createChildChunks(parentText);
        for (const childText of childTexts) {
          results.push({
            content: childText,
            chunkType: 'child',
            parentId,
            sectionHeading: section.heading,
            pageNumber: options?.pageNumber,
          });
        }
      }
    }
  }
  
  return results;
}

/**
 * Semantic chunking - kept as wrapper for backwards compatibility
 * Now uses child-chunk-sized pieces
 */
function chunkTextSemantic(text: string, maxSize = CHILD_CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  return createChildChunks(text, maxSize, overlap);
}

/**
 * Split text into overlapping chunks (legacy - kept for backwards compatibility)
 */
function chunkText(text: string, chunkSize = CHILD_CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  return chunkTextSemantic(text, chunkSize, overlap);
}

/**
 * Split PDF text into chunks while tracking page numbers
 * PDF text from extractor contains "--- Page X ---" markers
 * Uses hierarchical chunking within each page
 */
function chunkPdfText(text: string, chunkSize = CHILD_CHUNK_SIZE, overlap = CHUNK_OVERLAP): Array<{ text: string; pageNumber: number }> {
  const chunks: Array<{ text: string; pageNumber: number }> = [];
  
  // Split by page markers
  const pageRegex = /--- Page (\d+) ---/g;
  const pages: Array<{ pageNumber: number; text: string; startIndex: number }> = [];
  
  let lastIndex = 0;
  let match;
  let lastPageNumber = 1;
  
  while ((match = pageRegex.exec(text)) !== null) {
    if (match.index > lastIndex && pages.length > 0) {
      // Add text before this marker to previous page
      pages[pages.length - 1].text += text.slice(lastIndex, match.index);
    }
    lastPageNumber = parseInt(match[1], 10);
    pages.push({
      pageNumber: lastPageNumber,
      text: '',
      startIndex: match.index + match[0].length,
    });
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (pages.length > 0) {
    pages[pages.length - 1].text = text.slice(lastIndex);
  } else {
    // No page markers found, treat as single page
    pages.push({ pageNumber: 1, text, startIndex: 0 });
  }
  
  // Now chunk each page's text using semantic chunking while preserving page numbers
  for (const page of pages) {
    const pageText = page.text.trim();
    if (!pageText) continue;
    
    // Use semantic chunking for each page
    const pageChunks = chunkTextSemantic(pageText, chunkSize, overlap);
    for (const chunkText of pageChunks) {
      chunks.push({
        text: chunkText,
        pageNumber: page.pageNumber,
      });
    }
  }
  
  return chunks;
}

/**
 * Extract text from PDF file via IPC to renderer process
 * (pdfjs-dist requires DOM APIs only available in renderer)
 */
async function extractPdfText(filePath: string, window: BrowserWindow | null): Promise<string> {
  console.log(`[RAG] extractPdfText called. Ready: ${pdfExtractionReady}, Window: ${!!window}`);
  
  // If renderer isn't ready or no window, return placeholder
  if (!window || !pdfExtractionReady) {
    console.log(`[RAG] PDF extraction not ready (ready=${pdfExtractionReady}, window=${!!window}), skipping: ${path.basename(filePath)}`);
    return `[PDF Document: ${path.basename(filePath)}]\nPDF will be indexed when the app is fully loaded.`;
  }

  return new Promise((resolve, reject) => {
    const requestId = `${filePath}-${Date.now()}`;
    
    // Set timeout for extraction (30 seconds for large PDFs)
    const timeout = setTimeout(() => {
      pendingPdfExtractions.delete(requestId);
      console.warn(`[RAG] PDF extraction timed out: ${path.basename(filePath)}`);
      resolve(`[PDF Document: ${path.basename(filePath)}]\nPDF extraction timed out.`);
    }, 30000);
    
    pendingPdfExtractions.set(requestId, { resolve, reject, timeout });
    
    // Request extraction from renderer
    console.log(`[RAG] Requesting PDF extraction: ${path.basename(filePath)}`);
    window.webContents.send(IPC_CHANNELS.PDF_EXTRACT_TEXT_REQUEST, {
      requestId,
      filePath,
    });
  });
}

/**
 * Handle PDF extraction response from renderer
 */
function setupPdfExtractionHandler(): void {
  ipcMain.on(IPC_CHANNELS.PDF_EXTRACT_TEXT_RESPONSE, (_event, data: { requestId: string; text: string; error?: string }) => {
    const pending = pendingPdfExtractions.get(data.requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingPdfExtractions.delete(data.requestId);
      
      if (data.error) {
        console.error(`[RAG] PDF extraction error: ${data.error}`);
        pending.resolve(`[PDF Document]\nFailed to extract text: ${data.error}`);
      } else {
        console.log(`[RAG] PDF extracted successfully: ${data.text.length} chars`);
        pending.resolve(data.text);
      }
    }
  });
}

/**
 * Mark PDF extraction as ready (called when renderer signals it's ready)
 */
export function setPdfExtractionReady(ready: boolean): void {
  pdfExtractionReady = ready;
  console.log(`[RAG] PDF extraction ready: ${ready}`);
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
 * Extract text from Excel file (.xlsx, .xls)
 * Converts each sheet into structured text with column headers preserved
 * Table-aware: keeps rows together to avoid splitting mid-record
 */
function extractExcelText(filePath: string): string {
  try {
    const workbook = XLSX.readFile(filePath, { type: 'file' });
    const parts: string[] = [];
    
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      
      // Convert to array of arrays for structured output
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      if (!data || data.length === 0) continue;
      
      parts.push(`## Sheet: ${sheetName}`);
      
      // First row as headers
      const headers = data[0]?.map((h: any) => String(h ?? '').trim()) || [];
      
      if (headers.length > 0 && headers.some(h => h.length > 0)) {
        parts.push(`Columns: ${headers.join(' | ')}`);
        parts.push('');
        
        // Data rows - format as "Header: Value" pairs for better semantic search
        for (let rowIdx = 1; rowIdx < data.length; rowIdx++) {
          const row = data[rowIdx];
          if (!row || row.every((cell: any) => cell === null || cell === undefined || String(cell).trim() === '')) continue;
          
          const rowParts: string[] = [];
          for (let colIdx = 0; colIdx < Math.max(headers.length, row.length); colIdx++) {
            const header = headers[colIdx] || `Col${colIdx + 1}`;
            const value = row[colIdx];
            if (value !== null && value !== undefined && String(value).trim() !== '') {
              rowParts.push(`${header}: ${String(value).trim()}`);
            }
          }
          
          if (rowParts.length > 0) {
            parts.push(`Row ${rowIdx}: ${rowParts.join(', ')}`);
          }
        }
      } else {
        // No headers — just dump as text
        for (const row of data) {
          if (row && row.some((cell: any) => cell !== null && cell !== undefined)) {
            parts.push(row.map((cell: any) => String(cell ?? '')).join('\t'));
          }
        }
      }
      
      parts.push(''); // Blank line between sheets
    }
    
    return parts.join('\n');
  } catch (error) {
    console.error(`Failed to extract Excel text from ${filePath}:`, error);
    return '';
  }
}

/**
 * Extract text from a file based on its type
 */
async function extractFileText(filePath: string, window: BrowserWindow | null): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      console.log(`Skipping large file: ${filePath}`);
      return '';
    }
    
    if (ext === '.pdf') {
      return await extractPdfText(filePath, window);
    }
    
    if (ext === '.doc' || ext === '.docx') {
      return await extractWordText(filePath);
    }
    
    if (ext === '.xlsx' || ext === '.xls') {
      return extractExcelText(filePath);
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
 * Get embeddings for multiple texts in a single API call (batch processing)
 * OpenAI supports up to 2048 inputs per request
 */
const EMBEDDING_BATCH_SIZE = 100; // Process 100 chunks per API call

async function getBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const client = await getOpenAI();
  if (!client) {
    throw new Error('OpenAI API key not configured');
  }
  
  // Truncate each text to 8000 chars
  const truncatedTexts = texts.map(t => t.slice(0, 8000));
  
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: truncatedTexts,
  });
  
  // Sort by index to ensure correct order
  const sorted = response.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => d.embedding);
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
 * Tokenize text for BM25 scoring
 * Simple word tokenization with lowercasing and stopword removal
 */
function tokenize(text: string): string[] {
  const stopwords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'of', 'at', 'by', 'for',
    'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off',
    'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    's', 't', 'just', 'don', 'now', 'it', 'its', 'this', 'that', 'these', 'those',
  ]);
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 1 && !stopwords.has(word));
}

/**
 * Calculate BM25 score for a document against a query
 * BM25 is a ranking function used in information retrieval
 */
function calculateBM25(
  queryTokens: string[],
  docTokens: string[],
  avgDocLength: number,
  docFrequencies: Map<string, number>,
  totalDocs: number
): number {
  const docLength = docTokens.length;
  const termFrequencies = new Map<string, number>();
  
  // Count term frequencies in document
  for (const token of docTokens) {
    termFrequencies.set(token, (termFrequencies.get(token) || 0) + 1);
  }
  
  let score = 0;
  
  for (const queryTerm of queryTokens) {
    const tf = termFrequencies.get(queryTerm) || 0;
    if (tf === 0) continue;
    
    const df = docFrequencies.get(queryTerm) || 0;
    // IDF with smoothing
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    
    // BM25 term score
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgDocLength));
    
    score += idf * (numerator / denominator);
  }
  
  return score;
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
 * Compute MD5 hash of file content for incremental indexing
 */
async function computeFileHash(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return '';
  }
}

/**
 * Index a workspace for RAG with incremental indexing and hierarchical chunking
 * @param workspacePath - Path to the workspace to index
 * @param window - BrowserWindow to send progress updates to
 * @param forceReindex - If true, ignore cached embeddings and re-index everything
 */
export async function indexWorkspace(workspacePath: string, window: BrowserWindow, forceReindex = false): Promise<{ success: boolean; chunksIndexed: number; error?: string; fromCache?: boolean }> {
  console.log(`[RAG] indexWorkspace called. PDF extraction ready: ${pdfExtractionReady}, forceReindex: ${forceReindex}`);
  
  if (isIndexing) {
    return { success: false, chunksIndexed: 0, error: 'Indexing already in progress' };
  }
  
  // Try to load from cache first (unless force re-index)
  let existingStore: VectorStore | null = null;
  if (!forceReindex) {
    const loaded = await loadVectorStore(workspacePath);
    if (loaded && vectorStore && vectorStore.chunks.length > 0) {
      existingStore = vectorStore;
      console.log(`[RAG] Loaded existing vector store with ${vectorStore.chunks.length} chunks for incremental update`);
    } else if (loaded && vectorStore && vectorStore.chunks.length === 0) {
      console.log(`[RAG] Cached vector store has 0 chunks, will re-index`);
      vectorStore = null;
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
    
    // --- Incremental indexing: determine which files changed ---
    const currentFileSet = new Set(files);
    const existingMetadata = existingStore?.fileMetadata || {};
    
    const filesToReindex: string[] = [];
    const unchangedFiles: string[] = [];
    
    console.log(`[RAG] Scanning ${files.length} files for changes...`);
    sendProgress(window, 0, files.length, 'Scanning for changes...');
    
    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const fileName = path.basename(filePath);
      
      sendProgress(window, i + 1, files.length, `Scanning: ${fileName}`);
      
      const existingMeta = existingMetadata[filePath];
      if (existingMeta && !forceReindex) {
        // Check if file content changed using hash
        const currentHash = await computeFileHash(filePath);
        if (currentHash && existingMeta.contentHash && currentHash === existingMeta.contentHash) {
          unchangedFiles.push(filePath);
          continue;
        }
      }
      
      filesToReindex.push(filePath);
    }
    
    // Detect deleted files
    const deletedFiles = Object.keys(existingMetadata).filter(f => !currentFileSet.has(f));
    
    console.log(`[RAG] Incremental: ${unchangedFiles.length} unchanged, ${filesToReindex.length} to (re)index, ${deletedFiles.length} deleted`);
    
    // If nothing changed, return cached store
    if (filesToReindex.length === 0 && deletedFiles.length === 0 && existingStore) {
      console.log(`[RAG] No changes detected, using cached vector store`);
      window.webContents.send(IPC_CHANNELS.RAG_INDEX_COMPLETE, {
        chunksIndexed: existingStore.chunks.length,
        filesIndexed: new Set(existingStore.chunks.map(c => c.filePath)).size,
        fromCache: true,
      });
      isIndexing = false;
      return { success: true, chunksIndexed: existingStore.chunks.length, fromCache: true };
    }
    
    // Keep chunks from unchanged files
    let retainedChunks: DocumentChunk[] = [];
    const retainedMetadata: Record<string, FileMetadata> = {};
    
    if (existingStore) {
      const unchangedSet = new Set(unchangedFiles);
      retainedChunks = existingStore.chunks.filter(c => unchangedSet.has(c.filePath));
      for (const filePath of unchangedFiles) {
        if (existingMetadata[filePath]) {
          retainedMetadata[filePath] = existingMetadata[filePath];
        }
      }
      console.log(`[RAG] Retained ${retainedChunks.length} chunks from ${unchangedFiles.length} unchanged files`);
    }
    
    // Phase 1: Extract text and create hierarchical chunks for changed files
    interface PendingChunk {
      id: string;
      filePath: string;
      fileName: string;
      content: string;
      chunkIndex: number;
      totalChunks: number;
      pageNumber?: number;
      chunkType?: 'parent' | 'child';
      parentId?: string;
      sectionHeading?: string;
      contentHash?: string;
    }
    const pendingChunks: PendingChunk[] = [];
    
    console.log(`[RAG] Phase 1: Extracting text from ${filesToReindex.length} changed files...`);
    
    for (let i = 0; i < filesToReindex.length; i++) {
      const filePath = filesToReindex[i];
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      
      sendProgress(window, i + 1, filesToReindex.length, `Extracting: ${fileName}`);
      
      // Extract text
      const text = await extractFileText(filePath, window);
      if (!text || text.trim().length < 50) continue;
      
      // Skip PDFs with placeholder content (extraction wasn't ready)
      if (ext === '.pdf' && (text.includes('PDF will be indexed when the app is fully loaded') || 
                             text.includes('PDF extraction timed out') ||
                             text.includes('Failed to extract text'))) {
        console.log(`[RAG] Skipping PDF with placeholder content: ${fileName}`);
        continue;
      }
      
      // Use hierarchical chunking for all file types
      const hierarchicalChunks = chunkTextHierarchical(text, filePath, fileName);
      
      for (let j = 0; j < hierarchicalChunks.length; j++) {
        const hc = hierarchicalChunks[j];
        pendingChunks.push({
          id: `${filePath}-${j}`,
          filePath,
          fileName,
          content: hc.content,
          chunkIndex: j,
          totalChunks: hierarchicalChunks.length,
          pageNumber: hc.pageNumber,
          chunkType: hc.chunkType,
          parentId: hc.parentId,
          sectionHeading: hc.sectionHeading,
          contentHash: crypto.createHash('md5').update(hc.content).digest('hex'),
        });
      }
    }
    
    // Phase 2: Batch embed new chunks
    console.log(`[RAG] Phase 2: Embedding ${pendingChunks.length} chunks in batches of ${EMBEDDING_BATCH_SIZE}...`);
    
    const newChunks: DocumentChunk[] = [];
    const totalBatches = Math.ceil(pendingChunks.length / EMBEDDING_BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * EMBEDDING_BATCH_SIZE;
      const end = Math.min(start + EMBEDDING_BATCH_SIZE, pendingChunks.length);
      const batch = pendingChunks.slice(start, end);
      
      sendProgress(window, batchIndex + 1, totalBatches, `Embedding batch ${batchIndex + 1}/${totalBatches}`);
      
      try {
        const texts = batch.map(c => c.content);
        const embeddings = await getBatchEmbeddings(texts);
        
        for (let i = 0; i < batch.length; i++) {
          newChunks.push({
            ...batch[i],
            embedding: embeddings[i],
          });
        }
        
        // Small delay between batches to avoid rate limits
        if (batchIndex < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(`[RAG] Failed to embed batch ${batchIndex + 1}:`, error);
      }
    }
    
    // Merge retained + new chunks
    const allChunks = [...retainedChunks, ...newChunks];
    
    // Build file metadata for incremental indexing (with content hashes)
    const fileMetadata: Record<string, FileMetadata> = { ...retainedMetadata };
    for (const filePath of filesToReindex) {
      try {
        const stats = await fs.stat(filePath);
        const contentHash = await computeFileHash(filePath);
        const fileChunks = newChunks.filter(c => c.filePath === filePath);
        if (fileChunks.length > 0) {
          fileMetadata[filePath] = {
            filePath,
            fileId: filePath,
            lastModified: stats.mtimeMs,
            chunkCount: fileChunks.length,
            contentHash,
          };
        }
      } catch {}
    }
    
    // Store the vector store
    vectorStore = {
      workspacePath,
      chunks: allChunks,
      lastUpdated: Date.now(),
      fileMetadata,
    };
    
    // Save to disk for persistence across sessions
    await saveVectorStore();
    
    isIndexing = false;
    
    // Track documents indexed for usage
    for (let i = 0; i < filesToReindex.length; i++) {
      incrementUsage('documents_indexed');
    }
    
    // Send completion
    window.webContents.send(IPC_CHANNELS.RAG_INDEX_COMPLETE, {
      chunksIndexed: allChunks.length,
      filesIndexed: files.length,
    });
    
    return { success: true, chunksIndexed: allChunks.length };
  } catch (error) {
    isIndexing = false;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, chunksIndexed: 0, error: errorMessage };
  }
}

/**
 * Index OneDrive workspace for RAG
 * Similar to indexWorkspace but reads from OneDrive instead of local filesystem
 * @param forceReindex - If true, ignore cached embeddings and re-index everything
 */
export async function indexOneDriveWorkspace(
  folderId: string,
  folderPath: string,
  window: BrowserWindow,
  forceReindex = false
): Promise<{ success: boolean; chunksIndexed: number; error?: string; fromCache?: boolean }> {
  // Import OneDrive functions
  const { listOneDriveFilesRecursive, readOneDriveFile } = await import('./onedrive');
  
  console.log(`[RAG] indexOneDriveWorkspace called for folder: ${folderPath}, forceReindex: ${forceReindex}`);
  
  if (isIndexing) {
    return { success: false, chunksIndexed: 0, error: 'Indexing already in progress' };
  }
  
  // Use folder path as workspace identifier for caching
  const workspaceIdentifier = `onedrive:${folderId}`;
  
  // Try to load from cache first (unless force re-index)
  if (!forceReindex) {
    const loaded = await loadVectorStore(workspaceIdentifier);
    if (loaded && vectorStore && vectorStore.chunks.length > 0) {
      console.log(`[RAG] Using cached OneDrive vector store with ${vectorStore.chunks.length} chunks`);
      window.webContents.send(IPC_CHANNELS.RAG_INDEX_COMPLETE, {
        chunksIndexed: vectorStore.chunks.length,
        filesIndexed: new Set(vectorStore.chunks.map(c => c.filePath)).size,
        fromCache: true,
      });
      return { success: true, chunksIndexed: vectorStore.chunks.length, fromCache: true };
    }
  } else {
    console.log(`[RAG] Force re-index requested, ignoring cache`);
  }
  
  const client = await getOpenAI();
  if (!client) {
    return { success: false, chunksIndexed: 0, error: 'OpenAI API key not configured' };
  }
  
  isIndexing = true;
  
  try {
    // File extensions to index
    const indexableExtensions = [...TEXT_EXTENSIONS, ...DOCUMENT_EXTENSIONS];
    
    // Find all indexable files in OneDrive
    sendProgress(window, 0, 1, 'Scanning OneDrive folder...');
    const files = await listOneDriveFilesRecursive(folderId, indexableExtensions);
    
    if (files.length === 0) {
      isIndexing = false;
      window.webContents.send(IPC_CHANNELS.RAG_INDEX_COMPLETE, {
        chunksIndexed: 0,
        filesIndexed: 0,
      });
      return { success: true, chunksIndexed: 0 };
    }
    
    console.log(`[RAG] Found ${files.length} files to index from OneDrive`);
    
    // Phase 1: Extract text and create chunks
    interface PendingChunk {
      id: string;
      filePath: string;
      fileName: string;
      content: string;
      chunkIndex: number;
      totalChunks: number;
      pageNumber?: number;
      source?: 'local' | 'onedrive';
      oneDriveId?: string;
    }
    const pendingChunks: PendingChunk[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = path.extname(file.name).toLowerCase();
      
      sendProgress(window, i + 1, files.length, `Extracting: ${file.name}`);
      
      try {
        // Read file content from OneDrive
        console.log(`[RAG] Reading OneDrive file: ${file.name} (${file.id})`);
        const { content, mimeType } = await readOneDriveFile(file.id);
        console.log(`[RAG] Read ${content.length} chars, mimeType: ${mimeType}`);
        
        let text = '';
        
        // Handle different file types
        if (mimeType.startsWith('text/') || mimeType === 'application/json') {
          text = content;
        } else if (ext === '.pdf') {
          // PDF content is base64 encoded - need to extract text
          // For now, we'll extract from renderer process
          console.log(`[RAG] Extracting text from PDF: ${file.name}`);
          const pdfText = await extractPdfFromBase64(content, window, file.name);
          console.log(`[RAG] Extracted ${pdfText.length} chars from PDF`);
          text = pdfText;
        } else if (ext === '.doc' || ext === '.docx') {
          // Word documents - download to temp file and extract
          const tempPath = path.join(app.getPath('temp'), `drasill-${Date.now()}-${file.name}`);
          const { downloadOneDriveFile } = await import('./onedrive');
          await downloadOneDriveFile(file.id, tempPath);
          text = await extractWordText(tempPath);
          // Clean up temp file
          try {
            await fs.unlink(tempPath);
          } catch {}
        }
        
        if (!text || text.trim().length < 50) continue;
        
        // Chunk the text - include source and oneDriveId for navigation
        if (ext === '.pdf') {
          const pdfChunks = chunkPdfText(text);
          for (let j = 0; j < pdfChunks.length; j++) {
            pendingChunks.push({
              id: `${file.id}-${j}`,
              filePath: file.path,
              fileName: file.name,
              content: pdfChunks[j].text,
              chunkIndex: j,
              totalChunks: pdfChunks.length,
              pageNumber: pdfChunks[j].pageNumber,
              source: 'onedrive',
              oneDriveId: file.id,
            });
          }
        } else {
          const textChunks = chunkText(text);
          for (let j = 0; j < textChunks.length; j++) {
            pendingChunks.push({
              id: `${file.id}-${j}`,
              filePath: file.path,
              fileName: file.name,
              content: textChunks[j],
              chunkIndex: j,
              totalChunks: textChunks.length,
              source: 'onedrive',
              oneDriveId: file.id,
            });
          }
        }
      } catch (error) {
        console.error(`[RAG] Failed to process OneDrive file ${file.name}:`, error);
      }
    }
    
    // Phase 2: Batch embed all chunks
    console.log(`[RAG] Phase 2: Embedding ${pendingChunks.length} OneDrive chunks...`);
    
    if (pendingChunks.length === 0) {
      isIndexing = false;
      console.log(`[RAG] No chunks to embed - text extraction may have failed`);
      window.webContents.send(IPC_CHANNELS.RAG_INDEX_COMPLETE, {
        chunksIndexed: 0,
        filesIndexed: files.length,
      });
      return { success: true, chunksIndexed: 0 };
    }
    
    const chunks: DocumentChunk[] = [];
    const totalBatches = Math.ceil(pendingChunks.length / EMBEDDING_BATCH_SIZE);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * EMBEDDING_BATCH_SIZE;
      const end = Math.min(start + EMBEDDING_BATCH_SIZE, pendingChunks.length);
      const batch = pendingChunks.slice(start, end);
      
      sendProgress(window, batchIndex + 1, totalBatches, `Embedding batch ${batchIndex + 1}/${totalBatches}`);
      
      try {
        const texts = batch.map(c => c.content);
        const embeddings = await getBatchEmbeddings(texts);
        
        for (let i = 0; i < batch.length; i++) {
          chunks.push({
            ...batch[i],
            embedding: embeddings[i],
          });
        }
        
        if (batchIndex < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(`[RAG] Failed to embed OneDrive batch ${batchIndex + 1}:`, error);
      }
    }
    
    // Build file metadata for incremental indexing
    const fileMetadata: Record<string, FileMetadata> = {};
    for (const file of files) {
      const fileChunks = chunks.filter(c => c.oneDriveId === file.id);
      if (fileChunks.length > 0) {
        fileMetadata[file.id] = {
          filePath: file.path,
          fileId: file.id,
          lastModified: file.lastModified ? new Date(file.lastModified).getTime() : Date.now(),
          chunkCount: fileChunks.length,
          contentHash: '', // OneDrive files don't have local content hash
        };
      }
    }
    
    // Store the vector store
    vectorStore = {
      workspacePath: workspaceIdentifier,
      chunks,
      lastUpdated: Date.now(),
      fileMetadata,
    };
    
    // Save to disk
    await saveVectorStore();
    
    isIndexing = false;
    
    // Track documents indexed for usage
    for (let i = 0; i < files.length; i++) {
      incrementUsage('documents_indexed');
    }
    
    window.webContents.send(IPC_CHANNELS.RAG_INDEX_COMPLETE, {
      chunksIndexed: chunks.length,
      filesIndexed: files.length,
    });
    
    return { success: true, chunksIndexed: chunks.length };
  } catch (error) {
    isIndexing = false;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[RAG] OneDrive indexing failed:', error);
    return { success: false, chunksIndexed: 0, error: errorMessage };
  }
}

/**
 * Extract text from base64-encoded PDF via renderer process
 */
async function extractPdfFromBase64(base64Data: string, window: BrowserWindow, fileName: string): Promise<string> {
  if (!pdfExtractionReady) {
    console.log(`[RAG] PDF extraction not ready, skipping: ${fileName}`);
    return '';
  }
  
  return new Promise((resolve) => {
    const requestId = `base64-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const timeout = setTimeout(() => {
      pendingPdfExtractions.delete(requestId);
      console.warn(`[RAG] PDF extraction timed out: ${fileName}`);
      resolve('');
    }, 30000);
    
    pendingPdfExtractions.set(requestId, { 
      resolve: (text: string) => resolve(text), 
      reject: () => resolve(''),
      timeout 
    });
    
    window.webContents.send(IPC_CHANNELS.PDF_EXTRACT_TEXT_REQUEST, {
      requestId,
      base64Data,
      fileName,
    });
  });
}

/**
 * Get Cohere API key from keychain
 */
async function getCohereApiKey(): Promise<string | null> {
  try {
    const keytar = await import('keytar');
    return await keytar.default.getPassword('DrasillCloud', 'cohere-api-key');
  } catch {
    return null;
  }
}

/**
 * Set Cohere API key in keychain
 */
export async function setCohereApiKey(apiKey: string): Promise<boolean> {
  try {
    const keytar = await import('keytar');
    await keytar.default.setPassword('DrasillCloud', 'cohere-api-key', apiKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Cohere API key (masked for display)
 */
export async function getCohereApiKeyMasked(): Promise<string | null> {
  const key = await getCohereApiKey();
  if (!key) return null;
  return key.slice(0, 8) + '...' + key.slice(-4);
}

/**
 * Delete Cohere API key
 */
export async function deleteCohereApiKey(): Promise<boolean> {
  try {
    const keytar = await import('keytar');
    return await keytar.default.deletePassword('DrasillCloud', 'cohere-api-key');
  } catch {
    return false;
  }
}

/**
 * HyDE (Hypothetical Document Embedding) - generate a hypothetical answer
 * to the query, then embed that answer for better retrieval
 */
async function hydeQueryExpansion(query: string): Promise<number[]> {
  try {
    const { proxyChatRequest, getSession } = await import('./supabase');
    const session = await getSession();
    
    if (!session) {
      // Fallback to direct query embedding
      return await getEmbedding(query);
    }
    
    // Generate hypothetical answer
    const response = await proxyChatRequest(
      [
        { role: 'system', content: 'You are a financial document expert. Given a question, write a short passage (2-3 sentences) that would appear in a document that answers this question. Do not say "here is" or refer to the question. Write as if you are the document itself.' },
        { role: 'user', content: query },
      ],
      {
        model: 'gpt-4o-mini',
        max_tokens: 150,
        temperature: 0.3,
      }
    );
    
    if (response.success && response.content) {
      console.log(`[RAG] HyDE generated: "${response.content.slice(0, 100)}..."`);
      // Embed the hypothetical document + original query combined
      const hydeText = `${query}\n\n${response.content}`;
      return await getEmbedding(hydeText);
    }
  } catch (error) {
    console.error('[RAG] HyDE expansion failed, using direct query:', error);
  }
  
  // Fallback to direct query embedding
  return await getEmbedding(query);
}

/**
 * Rerank results using Cohere API for higher precision
 * Falls back gracefully if no API key or on error
 */
async function cohereRerank<T extends { content: string; score: number }>(
  query: string, 
  chunks: T[],
  topN: number
): Promise<T[]> {
  const cohereKey = await getCohereApiKey();
  if (!cohereKey) {
    console.log('[RAG] No Cohere API key, skipping reranking');
    return chunks.slice(0, topN);
  }
  
  try {
    const { CohereClient } = await import('cohere-ai');
    const cohere = new CohereClient({ token: cohereKey });
    
    const documents = chunks.map(c => c.content);
    
    const reranked = await cohere.rerank({
      model: 'rerank-english-v3.0',
      query,
      documents,
      topN: Math.min(topN, chunks.length),
    });
    
    console.log(`[RAG] Cohere reranked ${chunks.length} → ${reranked.results.length} results`);
    
    return reranked.results.map(r => ({
      ...chunks[r.index],
      score: Math.max(chunks[r.index].score, r.relevanceScore), // Keep higher score to avoid threshold filtering
      cohereScore: r.relevanceScore, // Preserve Cohere score for debugging
    }));
  } catch (error) {
    console.error('[RAG] Cohere reranking failed, using original scores:', error);
    return chunks.slice(0, topN);
  }
}

/**
 * Expand child chunks to their parent chunks for richer context
 * Carries over the score from the child that triggered the expansion
 */
function expandToParentChunks(
  selectedChunks: Array<DocumentChunk & { score: number }>,
  allChunks: DocumentChunk[]
): Array<DocumentChunk & { score: number }> {
  const result: Array<DocumentChunk & { score: number }> = [];
  const usedParentIds = new Set<string>();
  
  for (const chunk of selectedChunks) {
    if (chunk.chunkType === 'child' && chunk.parentId) {
      // Find the parent chunk
      if (!usedParentIds.has(chunk.parentId)) {
        const parent = allChunks.find(c => c.id === chunk.parentId && c.chunkType === 'parent');
        if (parent) {
          result.push({ ...parent, score: chunk.score });
          usedParentIds.add(chunk.parentId);
          continue;
        }
      } else {
        // Already included this parent, skip duplicate
        continue;
      }
    }
    // Non-child chunks or orphaned children: include as-is
    result.push(chunk);
  }
  
  return result;
}

/**
 * Search the vector store using HyDE + hybrid search (BM25 + vector) + Cohere reranking
 * With parent chunk expansion for richer context
 * @param query - The search query
 * @param topK - Maximum number of results to return
 * @param dealId - Optional deal ID to prioritize documents associated with this deal
 */
export async function searchRAG(query: string, topK = 5, dealId?: string): Promise<{ chunks: Array<{ content: string; fileName: string; filePath: string; score: number; chunkIndex: number; totalChunks: number; pageNumber?: number; source?: 'local' | 'onedrive'; oneDriveId?: string; fromOtherDeal?: boolean; dealIds?: string[]; sectionHeading?: string }> }> {
  if (!vectorStore || vectorStore.chunks.length === 0) {
    return { chunks: [] };
  }
  
  try {
    // HyDE: Generate hypothetical answer embedding for better retrieval
    console.log(`[RAG] Using HyDE query expansion...`);
    const queryEmbedding = await hydeQueryExpansion(query);
    const queryTokens = tokenize(query);
    
    // Get deal's associated document paths for filtering
    let dealDocPaths: Set<string> | null = null;
    if (dealId) {
      const dealDocs = getDealDocuments(dealId);
      dealDocPaths = new Set(dealDocs.map(d => d.filePath));
      console.log(`[RAG] Deal-scoped search: ${dealDocPaths.size} associated document paths for deal ${dealId}`);
    }
    
    // Search only child chunks (more precise) for initial retrieval
    const searchableChunks = vectorStore.chunks.filter(c => c.chunkType !== 'parent');
    
    // Pre-compute document frequencies for BM25
    const docFrequencies = new Map<string, number>();
    const allDocTokens: string[][] = [];
    let totalLength = 0;
    
    for (const chunk of searchableChunks) {
      const tokens = tokenize(chunk.content);
      allDocTokens.push(tokens);
      totalLength += tokens.length;
      
      const uniqueTerms = new Set(tokens);
      for (const term of uniqueTerms) {
        docFrequencies.set(term, (docFrequencies.get(term) || 0) + 1);
      }
    }
    
    const avgDocLength = searchableChunks.length > 0 ? totalLength / searchableChunks.length : 1;
    const totalDocs = searchableChunks.length;
    
    // Calculate hybrid scores
    const scored = searchableChunks.map((chunk, index) => {
      const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
      
      const bm25Score = calculateBM25(
        queryTokens,
        allDocTokens[index],
        avgDocLength,
        docFrequencies,
        totalDocs
      );
      
      const normalizedBM25 = Math.min(bm25Score / 10, 1);
      const hybridScore = (VECTOR_WEIGHT * vectorScore) + (BM25_WEIGHT * normalizedBM25);
      
      const chunkDealIds = getDealsForDocument(chunk.filePath);
      const fromOtherDeal = dealId ? !chunkDealIds.includes(dealId) && !isPathUnderDealFolder(chunk.filePath, dealDocPaths) : false;
      
      return {
        ...chunk,
        score: hybridScore,
        vectorScore,
        bm25Score: normalizedBM25,
        fromOtherDeal,
        dealIds: chunkDealIds,
      };
    });
    
    // Sort by score first
    scored.sort((a, b) => {
      if (dealId) {
        if (!a.fromOtherDeal && b.fromOtherDeal) return -1;
        if (a.fromOtherDeal && !b.fromOtherDeal) return 1;
      }
      return b.score - a.score;
    });
    
    // Take top candidates for reranking (wider pool than final topK)
    const rerankPool = scored.filter(c => c.score >= MIN_RELEVANCE_THRESHOLD).slice(0, Math.max(topK * 4, 20));
    
    // Cohere reranking for precision
    let reranked: typeof scored;
    if (rerankPool.length > 0) {
      reranked = await cohereRerank(query, rerankPool, topK);
    } else {
      reranked = [];
    }
    
    // Expand child chunks to parent chunks for richer context
    const expanded = expandToParentChunks(reranked, vectorStore.chunks);
    
    // Apply deal-scoping
    let topChunks: typeof expanded;
    if (dealId) {
      const currentDealChunks = expanded.filter(c => {
        const chunkDealIds = getDealsForDocument(c.filePath);
        return chunkDealIds.includes(dealId) || isPathUnderDealFolder(c.filePath, dealDocPaths);
      });
      const otherDealChunks = expanded.filter(c => {
        const chunkDealIds = getDealsForDocument(c.filePath);
        return !chunkDealIds.includes(dealId) && !isPathUnderDealFolder(c.filePath, dealDocPaths);
      });
      
      if (currentDealChunks.length >= topK) {
        topChunks = currentDealChunks.slice(0, topK);
      } else {
        const needed = topK - currentDealChunks.length;
        topChunks = [...currentDealChunks, ...otherDealChunks.slice(0, needed)];
      }
    } else {
      topChunks = expanded.slice(0, Math.max(topK, 3));
    }
    
    console.log(`[RAG] Search complete: ${rerankPool.length} candidates → ${reranked.length} reranked → ${topChunks.length} returned${dealId ? ` (deal-scoped)` : ''}`);
    
    return {
      chunks: topChunks.map(c => ({
        content: c.content,
        fileName: c.fileName,
        filePath: c.filePath,
        score: c.score,
        chunkIndex: c.chunkIndex,
        totalChunks: c.totalChunks,
        pageNumber: c.pageNumber,
        source: c.source,
        oneDriveId: c.oneDriveId,
        fromOtherDeal: !!(dealId && getDealsForDocument(c.filePath).length > 0 && !getDealsForDocument(c.filePath).includes(dealId)),
        dealIds: getDealsForDocument(c.filePath),
        sectionHeading: c.sectionHeading,
      })),
    };
  } catch (error) {
    console.error('RAG search failed:', error);
    return { chunks: [] };
  }
}

/**
 * Helper to check if a file path is under any deal folder path
 */
function isPathUnderDealFolder(filePath: string, dealDocPaths: Set<string> | null): boolean {
  if (!dealDocPaths || dealDocPaths.size === 0) return false;
  
  const normalizedPath = filePath.toLowerCase().replace(/\\/g, '/');
  for (const docPath of dealDocPaths) {
    const normalizedDocPath = docPath.toLowerCase().replace(/\\/g, '/');
    if (normalizedPath.startsWith(normalizedDocPath) || normalizedPath.includes(normalizedDocPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Get RAG context for a chat query
 * Returns context with structured source citations including relevance scores
 * @param query - The search query
 * @param dealId - Optional deal ID to prioritize documents associated with this deal
 */
export async function getRAGContext(query: string, dealId?: string): Promise<{ context: string; sources: Array<{ fileName: string; filePath: string; section: string; pageNumber?: number; source?: 'local' | 'onedrive'; oneDriveId?: string; relevanceScore?: number; fromOtherDeal?: boolean; dealId?: string }> }> {
  const { displayThreshold } = getRelevanceThresholds();
  const results = await searchRAG(query, 5, dealId);
  
  if (results.chunks.length === 0) {
    return { context: '', sources: [] };
  }
  
  // Filter by display threshold
  const filteredChunks = results.chunks.filter(c => c.score >= displayThreshold);
  
  if (filteredChunks.length === 0) {
    console.log(`[RAG] All chunks below display threshold (${displayThreshold})`);
    return { context: '', sources: [] };
  }
  
  // Build context string with source attribution
  // Use a numbered reference format that the AI can cite
  const sources: Array<{ fileName: string; filePath: string; section: string; pageNumber?: number; source?: 'local' | 'onedrive'; oneDriveId?: string; relevanceScore?: number; fromOtherDeal?: boolean; dealId?: string }> = [];
  const contextParts = filteredChunks.map((chunk, index) => {
    // Build section label with heading context
    let sectionLabel: string;
    if (chunk.pageNumber) {
      sectionLabel = `Page ${chunk.pageNumber}`;
    } else if (chunk.sectionHeading) {
      sectionLabel = chunk.sectionHeading;
    } else if (chunk.totalChunks > 1) {
      sectionLabel = `Section ${chunk.chunkIndex + 1}/${chunk.totalChunks}`;
    } else {
      sectionLabel = 'Full Document';
    }
    
    // Add label for sources from other deals
    const otherDealLabel = chunk.fromOtherDeal ? ' [FROM OTHER DEAL]' : '';
    
    sources.push({
      fileName: chunk.fileName,
      filePath: chunk.filePath,
      section: sectionLabel,
      pageNumber: chunk.pageNumber,
      source: chunk.source,
      oneDriveId: chunk.oneDriveId,
      relevanceScore: chunk.score,
      fromOtherDeal: chunk.fromOtherDeal,
      dealId: chunk.dealIds?.[0],
    });
    
    return `[${index + 1}] ${chunk.fileName} (${sectionLabel})${otherDealLabel}\n${chunk.content}`;
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
 * Returns true only if cache exists AND has content
 */
export async function tryLoadCachedVectorStore(workspacePath: string): Promise<boolean> {
  if (vectorStore && vectorStore.workspacePath === workspacePath && vectorStore.chunks.length > 0) {
    // Already loaded with content
    return true;
  }
  const loaded = await loadVectorStore(workspacePath);
  // Return true only if loaded and has actual chunks
  return loaded && vectorStore !== null && vectorStore.chunks.length > 0;
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

/**
 * Initialize RAG system (setup IPC handlers)
 */
export function initRAG(): void {
  setupPdfExtractionHandler();
  console.log('[RAG] Initialized PDF extraction IPC handler');
}
