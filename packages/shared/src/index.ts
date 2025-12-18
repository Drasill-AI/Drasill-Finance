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
}

/**
 * Represents an open tab in the editor
 */
export interface Tab {
  /** Unique identifier (file path) */
  id: string;
  /** Display name */
  name: string;
  /** Full file path */
  path: string;
  /** File type for determining viewer */
  type: 'text' | 'markdown' | 'pdf' | 'word' | 'unknown';
  /** Whether the tab has unsaved changes */
  isDirty?: boolean;
  /** Scroll position to restore */
  scrollPosition?: {
    scrollTop: number;
    scrollLeft: number;
  };
  /** Monaco view state for restoring cursor/selection */
  viewState?: unknown;
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
    type: 'text' | 'markdown' | 'pdf' | 'word' | 'unknown';
  }>;
  activeTabId: string | null;
  sidebarWidth?: number;
  rightPanelWidth?: number;
}

/**
 * IPC channel names
 */
export const IPC_CHANNELS = {
  SELECT_WORKSPACE: 'select-workspace',
  READ_DIR: 'read-dir',
  READ_FILE: 'read-file',
  STAT: 'stat',
  // Chat
  CHAT_SEND_MESSAGE: 'chat-send-message',
  CHAT_STREAM_CHUNK: 'chat-stream-chunk',
  CHAT_STREAM_END: 'chat-stream-end',
  CHAT_STREAM_ERROR: 'chat-stream-error',
  CHAT_SET_API_KEY: 'chat-set-api-key',
  CHAT_GET_API_KEY: 'chat-get-api-key',
  CHAT_CANCEL: 'chat-cancel',
  // RAG
  RAG_INDEX_WORKSPACE: 'rag-index-workspace',
  RAG_INDEX_PROGRESS: 'rag-index-progress',
  RAG_INDEX_COMPLETE: 'rag-index-complete',
  RAG_SEARCH: 'rag-search',
  RAG_GET_STATUS: 'rag-get-status',
  RAG_CLEAR: 'rag-clear',
  // State persistence
  STATE_SAVE: 'state-save',
  STATE_LOAD: 'state-load',
} as const;

/**
 * Chat message interface
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
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
