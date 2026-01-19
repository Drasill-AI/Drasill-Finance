/**
 * Represents a file or directory in the file tree
 */
export interface TreeNode {
  /** Unique identifier (full path) */
  id: string;
  /** Display name */
  name: string;
  /** Full path on disk */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Child nodes (only populated for expanded directories) */
  children?: TreeNode[];
  /** Whether the directory is expanded in the UI */
  isExpanded?: boolean;
  /** File extension (for files only) */
  extension?: string;
  /** Source of the file (local filesystem or cloud) */
  source?: 'local' | 'onedrive';
  /** OneDrive item ID (for cloud files) */
  oneDriveId?: string;
}

/**
 * Represents an open tab in the editor
 */
export interface Tab {
  /** Unique identifier (file path or schematic ID) */
  id: string;
  /** Display name */
  name: string;
  /** Full file path (for file tabs) */
  path: string;
  /** File type for determining viewer */
  type: 'text' | 'markdown' | 'pdf' | 'word' | 'schematic' | 'unknown';
  /** Whether the tab has unsaved changes */
  isDirty?: boolean;
  /** Scroll position to restore */
  scrollPosition?: {
    scrollTop: number;
    scrollLeft: number;
  };
  /** Monaco view state for restoring cursor/selection */
  viewState?: unknown;
  /** Schematic data (only for schematic tabs) */
  schematicData?: SchematicData;
  /** Source of the file (local filesystem or cloud) */
  source?: 'local' | 'onedrive';
  /** OneDrive item ID (for cloud files) */
  oneDriveId?: string;
  /** Initial page number (for PDF files opened from citations) */
  initialPage?: number;
}

/**
 * File stat information
 */
export interface FileStat {
  path: string;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

/**
 * Directory entry from readDir
 */
export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  extension?: string;
}

/**
 * Result of a file read operation
 */
export interface FileReadResult {
  path: string;
  content: string;
  encoding: string;
}

/**
 * Persisted app state
 */
export interface PersistedState {
  workspacePath: string | null;
  openTabs: Array<{
    id: string;
    name: string;
    path: string;
    type: 'text' | 'markdown' | 'pdf' | 'word' | 'schematic' | 'unknown';
  }>;
  activeTabId: string | null;
  sidebarWidth?: number;
  rightPanelWidth?: number;
  /** Source of the workspace (local or cloud) */
  workspaceSource?: 'local' | 'onedrive';
  /** OneDrive folder ID (for cloud workspaces) */
  oneDriveFolderId?: string;
}

/**
 * IPC channel names
 */
export const IPC_CHANNELS = {
  SELECT_WORKSPACE: 'select-workspace',
  READ_DIR: 'read-dir',
  READ_FILE: 'read-file',
  READ_FILE_BINARY: 'read-file-binary',
  READ_WORD_FILE: 'read-word-file',
  READ_WORD_FILE_BUFFER: 'read-word-file-buffer',
  STAT: 'stat',
  // Chat
  CHAT_SEND_MESSAGE: 'chat-send-message',
  CHAT_STREAM_START: 'chat-stream-start',
  CHAT_STREAM_CHUNK: 'chat-stream-chunk',
  CHAT_STREAM_END: 'chat-stream-end',
  CHAT_STREAM_ERROR: 'chat-stream-error',
  CHAT_SET_API_KEY: 'chat-set-api-key',
  CHAT_GET_API_KEY: 'chat-get-api-key',
  CHAT_CANCEL: 'chat-cancel',
  CHAT_TOOL_EXECUTED: 'chat-tool-executed',
  // RAG
  RAG_INDEX_WORKSPACE: 'rag-index-workspace',
  RAG_INDEX_ONEDRIVE: 'rag-index-onedrive',
  RAG_INDEX_PROGRESS: 'rag-index-progress',
  RAG_INDEX_COMPLETE: 'rag-index-complete',
  RAG_SEARCH: 'rag-search',
  RAG_GET_STATUS: 'rag-get-status',
  RAG_LOAD_CACHE: 'rag-load-cache',
  RAG_CLEAR: 'rag-clear',
  // PDF Extraction (IPC between main and renderer)
  PDF_EXTRACT_TEXT_REQUEST: 'pdf-extract-text-request',
  PDF_EXTRACT_TEXT_RESPONSE: 'pdf-extract-text-response',
  PDF_EXTRACTOR_READY: 'pdf-extractor-ready',
  // State persistence
  STATE_SAVE: 'state-save',
  STATE_LOAD: 'state-load',
  // Deal Management
  DEAL_GET_ALL: 'deal-get-all',
  DEAL_GET: 'deal-get',
  DEAL_ADD: 'deal-add',
  DEAL_UPDATE: 'deal-update',
  DEAL_DELETE: 'deal-delete',
  DEAL_IMPORT_CSV: 'deal-import-csv',
  DEAL_DETECT_FROM_PATH: 'deal-detect-from-path',
  // Deal Activities
  ACTIVITY_ADD: 'activity-add',
  ACTIVITY_GET: 'activity-get',
  ACTIVITY_GET_BY_DEAL: 'activity-get-by-deal',
  ACTIVITY_UPDATE: 'activity-update',
  ACTIVITY_DELETE: 'activity-delete',
  // Pipeline Analytics
  PIPELINE_GET: 'pipeline-get',
  // Database
  DB_INIT: 'db-init',
  // File Operations
  ADD_FILES: 'add-files',
  DELETE_FILE: 'delete-file',
  DELETE_FOLDER: 'delete-folder',
  CLOSE_WORKSPACE: 'close-workspace',
  // Schematics
  SCHEMATIC_PROCESS_TOOL_CALL: 'schematic-process-tool-call',
  SCHEMATIC_GET_IMAGE: 'schematic-get-image',
  // OneDrive Integration
  ONEDRIVE_AUTH_START: 'onedrive-auth-start',
  ONEDRIVE_AUTH_STATUS: 'onedrive-auth-status',
  ONEDRIVE_LOGOUT: 'onedrive-logout',
  ONEDRIVE_LIST_FOLDER: 'onedrive-list-folder',
  ONEDRIVE_READ_FILE: 'onedrive-read-file',
  ONEDRIVE_DOWNLOAD_FILE: 'onedrive-download-file',
  ONEDRIVE_GET_FOLDER_INFO: 'onedrive-get-folder-info',
} as const;

/**
 * RAG source citation
 */
export interface RAGSource {
  fileName: string;
  filePath: string;
  section: string;
  pageNumber?: number;
  /** Source type (local or onedrive) */
  source?: 'local' | 'onedrive';
  /** OneDrive item ID for cloud files */
  oneDriveId?: string;
}

/**
 * Chat message interface
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  ragSources?: RAGSource[];
}

/**
 * File context for chat
 */
export interface FileContext {
  fileName: string;
  filePath: string;
  fileType: string;
  content: string;
}

/**
 * Chat request payload
 */
export interface ChatRequest {
  message: string;
  context?: FileContext;
  history: ChatMessage[];
}

/**
 * Chat streaming chunk
 */
export interface ChatStreamChunk {
  id: string;
  delta: string;
  done: boolean;
}

/**
 * Ignored directories and files for the file explorer
 */
export const IGNORED_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '__pycache__',
  '.DS_Store',
  'Thumbs.db',
];

/**
 * File extensions considered as text/code files
 */
export const TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.less',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.rs',
  '.go',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.graphql',
  '.env',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.prettierrc',
  '.eslintrc',
  '.csv',
  '.log',
  '.rtf',
];

/**
 * Document file extensions (shown but with special viewers)
 */
export const DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
];

/**
 * Binary file extensions to skip
 */
export const BINARY_EXTENSIONS = [
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.7z',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.svg',
  '.webp',
  '.mp3',
  '.mp4',
  '.wav',
  '.avi',
  '.mov',
  '.wmv',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
];

/**
 * Determine file type from extension
 */
export function getFileType(path: string): Tab['type'] {
  const ext = path.toLowerCase().split('.').pop();
  if (!ext) return 'text';
  
  if (ext === 'pdf') return 'pdf';
  if (ext === 'doc' || ext === 'docx') return 'word';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (TEXT_EXTENSIONS.some((e) => e.endsWith(ext))) return 'text';
  if (BINARY_EXTENSIONS.some((e) => e.endsWith(ext))) return 'unknown';
  
  return 'text';
}

/**
 * Check if a file/directory should be ignored
 */
export function shouldIgnore(name: string): boolean {
  return IGNORED_PATTERNS.includes(name);
}

/**
 * Get file extension from path
 */
export function getExtension(path: string): string {
  const parts = path.split('.');
  return parts.length > 1 ? `.${parts.pop()}` : '';
}

/**
 * Debounce utility
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// ==========================================
// Deal & Activity Types (Lending Deal Management)
// ==========================================

/**
 * Deal stages - fixed workflow
 */
export type DealStage = 'lead' | 'application' | 'underwriting' | 'approved' | 'funded' | 'closed' | 'declined';

/**
 * Deal priority levels
 */
export type DealPriority = 'low' | 'medium' | 'high';

/**
 * Deal record for lending/underwriting
 */
export interface Deal {
  id?: string;
  dealNumber: string;
  borrowerName: string;
  borrowerContact?: string | null;
  loanAmount: number;
  interestRate?: number | null;
  termMonths?: number | null;
  collateralDescription?: string | null;
  stage: DealStage;
  priority?: DealPriority;
  assignedTo?: string | null;
  documentPath?: string | null;
  notes?: string | null;
  expectedCloseDate?: string | null;
  actualCloseDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Deal activity types
 */
export type DealActivityType = 'note' | 'call' | 'email' | 'document' | 'stage_change' | 'meeting';

/**
 * Deal activity record
 */
export interface DealActivity {
  id?: string;
  dealId: string;
  type: DealActivityType;
  description: string;
  performedBy?: string | null;
  performedAt: string;
  metadata?: string | null; // JSON for flexible data
  createdAt?: string;
}

/**
 * Pipeline analytics data
 */
export interface PipelineAnalytics {
  totalDeals: number;
  totalPipelineValue: number;
  averageDealSize: number;
  byStage: Record<DealStage, { count: number; totalValue: number }>;
}

/**
 * Activity form data
 */
export interface ActivityFormData {
  dealId: string;
  type: DealActivityType;
  description: string;
  performedBy?: string | null;
  performedAt: string;
}

/**
 * Bottom panel state for persistence
 */
export interface BottomPanelState {
  isOpen: boolean;
  height: number;
  activeTab: 'activities' | 'pipeline';
}

// ==========================================
// Schematic Visualizer Types
// ==========================================

/**
 * OpenAI tool call for schematic retrieval
 */
export interface SchematicToolCall {
  component_name: string;
  machine_model?: string;
  additional_context?: string;
}

/**
 * Response from Java schematic handler
 */
export interface SchematicToolResponse {
  status: 'success' | 'error';
  message?: string;
  image_path?: string;
  manual_context?: string;
  component_id?: string;
  component_name?: string;
  machine_model?: string;
}

/**
 * Schematic data stored in tab
 */
export interface SchematicData {
  componentId: string;
  componentName: string;
  machineModel?: string;
  imagePath: string;
  manualContext: string;
  timestamp: number;
}

/**
 * Request to process OpenAI tool call
 */
export interface ProcessSchematicRequest {
  toolCall: SchematicToolCall;
  conversationId?: string;
}

// ==========================================
// OneDrive Integration Types
// ==========================================

/**
 * OneDrive item (file or folder)
 */
export interface OneDriveItem {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  mimeType?: string;
  webUrl?: string;
  downloadUrl?: string;
  lastModified?: string;
}

/**
 * OneDrive authentication status
 */
export interface OneDriveAuthStatus {
  isAuthenticated: boolean;
  userEmail?: string;
  userName?: string;
}
