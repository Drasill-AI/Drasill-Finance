import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import Store from 'electron-store';
import { IPC_CHANNELS, DirEntry, FileStat, FileReadResult, shouldIgnore, getExtension, BINARY_EXTENSIONS, ChatRequest, PersistedState } from '@drasill/shared';
import { sendChatMessage, setApiKey, getApiKey, hasApiKey, cancelStream } from './chat';
import { indexWorkspace, searchRAG, getIndexingStatus, clearVectorStore, resetOpenAI } from './rag';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit for reading files

// State persistence store
const stateStore = new Store<{ appState: PersistedState }>({
  name: 'app-state',
  defaults: {
    appState: {
      workspacePath: null,
      openTabs: [],
      activeTabId: null,
    }
  }
});

export function setupIpcHandlers(): void {
  // Select workspace folder
  ipcMain.handle(IPC_CHANNELS.SELECT_WORKSPACE, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Workspace Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Read directory contents
  ipcMain.handle(IPC_CHANNELS.READ_DIR, async (_event, dirPath: string): Promise<DirEntry[]> => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      const results: DirEntry[] = [];
      
      for (const entry of entries) {
        // Skip ignored files/directories
        if (shouldIgnore(entry.name)) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const isDirectory = entry.isDirectory();
        const extension = isDirectory ? undefined : getExtension(entry.name);

        // Skip binary files
        if (!isDirectory && extension && BINARY_EXTENSIONS.includes(extension.toLowerCase())) {
          continue;
        }

        results.push({
          name: entry.name,
          path: fullPath,
          isDirectory,
          isFile: entry.isFile(),
          extension,
        });
      }

      // Sort: directories first, then files, alphabetically
      results.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      return results;
    } catch (error) {
      console.error('Error reading directory:', error);
      throw new Error(`Failed to read directory: ${dirPath}`);
    }
  });

  // Read file contents
  ipcMain.handle(IPC_CHANNELS.READ_FILE, async (_event, filePath: string): Promise<FileReadResult> => {
    try {
      // Check file size first
      const stats = await fs.stat(filePath);
      
      if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
      }

      const content = await fs.readFile(filePath, 'utf-8');
      
      return {
        path: filePath,
        content,
        encoding: 'utf-8',
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to read file: ${filePath}`);
    }
  });

  // Get file/directory stats
  ipcMain.handle(IPC_CHANNELS.STAT, async (_event, targetPath: string): Promise<FileStat> => {
    try {
      const stats = await fs.stat(targetPath);
      
      return {
        path: targetPath,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        mtime: stats.mtimeMs,
      };
    } catch (error) {
      throw new Error(`Failed to stat: ${targetPath}`);
    }
  });

  // Chat: Send message with streaming
  ipcMain.handle(IPC_CHANNELS.CHAT_SEND_MESSAGE, async (event, request: ChatRequest): Promise<void> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      await sendChatMessage(window, request);
    }
  });

  // Chat: Set API key
  ipcMain.handle(IPC_CHANNELS.CHAT_SET_API_KEY, async (_event, apiKey: string): Promise<boolean> => {
    try {
      setApiKey(apiKey);
      resetOpenAI(); // Reset OpenAI client in RAG module too
      return true;
    } catch (error) {
      return false;
    }
  });

  // Chat: Get API key (masked)
  ipcMain.handle(IPC_CHANNELS.CHAT_GET_API_KEY, async (): Promise<{ hasKey: boolean; maskedKey: string | null }> => {
    return {
      hasKey: hasApiKey(),
      maskedKey: getApiKey(),
    };
  });

  // Chat: Cancel stream
  ipcMain.handle(IPC_CHANNELS.CHAT_CANCEL, async (): Promise<void> => {
    cancelStream();
  });

  // RAG: Index workspace
  ipcMain.handle(IPC_CHANNELS.RAG_INDEX_WORKSPACE, async (event, workspacePath: string): Promise<{ success: boolean; chunksIndexed: number; error?: string }> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      return await indexWorkspace(workspacePath, window);
    }
    return { success: false, chunksIndexed: 0, error: 'No window found' };
  });

  // RAG: Search
  ipcMain.handle(IPC_CHANNELS.RAG_SEARCH, async (_event, query: string): Promise<{ chunks: Array<{ content: string; fileName: string; filePath: string; score: number }> }> => {
    return await searchRAG(query);
  });

  // RAG: Get status
  ipcMain.handle(IPC_CHANNELS.RAG_GET_STATUS, async (): Promise<{ isIndexing: boolean; chunksCount: number }> => {
    return getIndexingStatus();
  });

  // RAG: Clear
  ipcMain.handle(IPC_CHANNELS.RAG_CLEAR, async (): Promise<void> => {
    clearVectorStore();
  });

  // State: Save persisted state
  ipcMain.handle(IPC_CHANNELS.STATE_SAVE, async (_event, state: PersistedState): Promise<void> => {
    stateStore.set('appState', state);
  });

  // State: Load persisted state
  ipcMain.handle(IPC_CHANNELS.STATE_LOAD, async (): Promise<PersistedState> => {
    return stateStore.get('appState');
  });
}
