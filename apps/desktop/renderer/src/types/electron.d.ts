import type { DirEntry, FileStat, FileReadResult, ChatRequest, ChatStreamChunk } from '@drasill/shared';

interface ElectronAPI {
  selectWorkspace: () => Promise<string | null>;
  readDir: (path: string) => Promise<DirEntry[]>;
  readFile: (path: string) => Promise<FileReadResult>;
  stat: (path: string) => Promise<FileStat>;
  onMenuOpenWorkspace: (callback: () => void) => () => void;
  onMenuCloseTab: (callback: () => void) => () => void;
  onMenuCommandPalette: (callback: () => void) => () => void;
  // Chat API
  sendChatMessage: (request: ChatRequest) => Promise<void>;
  onChatStreamChunk: (callback: (chunk: ChatStreamChunk) => void) => () => void;
  onChatStreamEnd: (callback: (data: { id: string; cancelled?: boolean }) => void) => () => void;
  onChatStreamError: (callback: (data: { id?: string; error: string }) => void) => () => void;
  setApiKey: (apiKey: string) => Promise<boolean>;
  getApiKey: () => Promise<{ hasKey: boolean; maskedKey: string | null }>;
  cancelChat: () => Promise<void>;
  // RAG API
  indexWorkspace: (workspacePath: string) => Promise<{ success: boolean; chunksIndexed: number; error?: string }>;
  onRagIndexProgress: (callback: (data: { current: number; total: number; fileName: string; percentage: number }) => void) => () => void;
  onRagIndexComplete: (callback: (data: { chunksIndexed: number; filesIndexed: number }) => void) => () => void;
  getRagStatus: () => Promise<{ isIndexing: boolean; chunksCount: number }>;
  clearRagIndex: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
