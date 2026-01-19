import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { 
  IPC_CHANNELS, 
  DirEntry, 
  FileStat, 
  FileReadResult, 
  ChatRequest, 
  ChatStreamChunk, 
  PersistedState,
  Deal,
  DealActivity,
  PipelineAnalytics,
  SchematicToolCall,
  SchematicToolResponse,
  OneDriveItem,
  OneDriveAuthStatus,
} from '@drasill/shared';

/**
 * API exposed to the renderer process via contextBridge
 */
const api = {
  /**
   * Select a workspace folder via system dialog
   */
  selectWorkspace: (): Promise<string | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SELECT_WORKSPACE);
  },

  /**
   * Read directory contents
   */
  readDir: (path: string): Promise<DirEntry[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.READ_DIR, path);
  },

  /**
   * Read file contents
   */
  readFile: (path: string): Promise<FileReadResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.READ_FILE, path);
  },

  /**
   * Read file as binary (Base64) for PDFs and other binary files
   */
  readFileBinary: (path: string): Promise<{ path: string; data: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.READ_FILE_BINARY, path);
  },

  /**
   * Read Word document and extract text
   */
  readWordFile: (path: string): Promise<{ path: string; content: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.READ_WORD_FILE, path);
  },

  /**
   * Read Word document from base64 buffer and extract text
   */
  readWordFileBuffer: (base64Data: string): Promise<{ content: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.READ_WORD_FILE_BUFFER, base64Data);
  },

  /**
   * Get file/directory stats
   */
  stat: (path: string): Promise<FileStat> => {
    return ipcRenderer.invoke(IPC_CHANNELS.STAT, path);
  },

  /**
   * Add files to workspace (copy selected files)
   */
  addFiles: (workspacePath: string): Promise<{ added: number; cancelled: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ADD_FILES, workspacePath);
  },

  /**
   * Delete a file
   */
  deleteFile: (filePath: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DELETE_FILE, filePath);
  },

  /**
   * Delete a folder and all its contents
   */
  deleteFolder: (folderPath: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DELETE_FOLDER, folderPath);
  },

  /**
   * Close the current workspace
   */
  closeWorkspace: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CLOSE_WORKSPACE);
  },

  /**
   * Subscribe to menu events from main process
   */
  onMenuOpenWorkspace: (callback: () => void): (() => void) => {
    const handler = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on('menu:open-workspace', handler);
    return () => ipcRenderer.removeListener('menu:open-workspace', handler);
  },

  onMenuCloseTab: (callback: () => void): (() => void) => {
    const handler = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on('menu:close-tab', handler);
    return () => ipcRenderer.removeListener('menu:close-tab', handler);
  },

  onMenuCommandPalette: (callback: () => void): (() => void) => {
    const handler = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on('menu:command-palette', handler);
    return () => ipcRenderer.removeListener('menu:command-palette', handler);
  },

  // Chat API
  /**
   * Send a chat message (initiates streaming response)
   */
  sendChatMessage: (request: ChatRequest): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND_MESSAGE, request);
  },

  /**
   * Subscribe to chat stream start (includes RAG sources)
   */
  onChatStreamStart: (callback: (data: { messageId: string; ragSources: Array<{ fileName: string; filePath: string; section: string; source?: 'local' | 'onedrive'; oneDriveId?: string }> }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: { messageId: string; ragSources: Array<{ fileName: string; filePath: string; section: string; source?: 'local' | 'onedrive'; oneDriveId?: string }> }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM_START, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM_START, handler);
  },

  /**
   * Subscribe to chat stream chunks
   */
  onChatStreamChunk: (callback: (chunk: ChatStreamChunk) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, chunk: ChatStreamChunk) => callback(chunk);
    ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM_CHUNK, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM_CHUNK, handler);
  },

  /**
   * Subscribe to chat stream end
   */
  onChatStreamEnd: (callback: (data: { id: string; cancelled?: boolean }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: { id: string; cancelled?: boolean }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM_END, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM_END, handler);
  },

  /**
   * Subscribe to chat stream errors
   */
  onChatStreamError: (callback: (data: { id?: string; error: string }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: { id?: string; error: string }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM_ERROR, handler);
  },

  /**
   * Set OpenAI API key
   */
  setApiKey: (apiKey: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHAT_SET_API_KEY, apiKey);
  },

  /**
   * Get API key info
   */
  getApiKey: (): Promise<{ hasKey: boolean; maskedKey: string | null }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHAT_GET_API_KEY);
  },

  /**
   * Cancel ongoing chat stream
   */
  cancelChat: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHAT_CANCEL);
  },

  /**
   * Subscribe to chat tool execution events
   */
  onChatToolExecuted: (callback: (data: { action: string; data: unknown }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: { action: string; data: unknown }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.CHAT_TOOL_EXECUTED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_TOOL_EXECUTED, handler);
  },

  // RAG API
  /**
   * Index workspace for RAG
   * @param forceReindex - If true, re-index even if cache exists
   */
  indexWorkspace: (workspacePath: string, forceReindex = false): Promise<{ success: boolean; chunksIndexed: number; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.RAG_INDEX_WORKSPACE, workspacePath, forceReindex);
  },

  /**
   * Index OneDrive workspace for RAG
   * @param forceReindex - If true, re-index even if cache exists
   */
  indexOneDriveWorkspace: (folderId: string, folderPath: string, forceReindex = false): Promise<{ success: boolean; chunksIndexed: number; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.RAG_INDEX_ONEDRIVE, folderId, folderPath, forceReindex);
  },

  /**
   * Subscribe to RAG indexing progress
   */
  onRagIndexProgress: (callback: (data: { current: number; total: number; fileName: string; percentage: number }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: { current: number; total: number; fileName: string; percentage: number }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.RAG_INDEX_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.RAG_INDEX_PROGRESS, handler);
  },

  /**
   * Subscribe to RAG indexing complete
   */
  onRagIndexComplete: (callback: (data: { chunksIndexed: number; filesIndexed: number }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: { chunksIndexed: number; filesIndexed: number }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.RAG_INDEX_COMPLETE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.RAG_INDEX_COMPLETE, handler);
  },

  /**
   * Get RAG status
   */
  getRagStatus: (): Promise<{ isIndexing: boolean; chunksCount: number; lastUpdated: number | null; workspacePath: string | null }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.RAG_GET_STATUS);
  },

  /**
   * Try to load cached RAG embeddings for a workspace
   */
  loadRagCache: (workspacePath: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.RAG_LOAD_CACHE, workspacePath);
  },

  /**
   * Clear RAG index
   */
  clearRagIndex: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.RAG_CLEAR);
  },

  // State persistence
  /**
   * Save app state for persistence
   */
  saveState: (state: PersistedState): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.STATE_SAVE, state);
  },

  /**
   * Load persisted app state
   */
  loadState: (): Promise<PersistedState> => {
    return ipcRenderer.invoke(IPC_CHANNELS.STATE_LOAD);
  },

  // ==========================================
  // Database & Deal API
  // ==========================================

  /**
   * Initialize the database
   */
  initDatabase: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DB_INIT);
  },

  /**
   * Get all deals
   */
  getAllDeals: (): Promise<Deal[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DEAL_GET_ALL);
  },

  /**
   * Get single deal by ID
   */
  getDeal: (id: string): Promise<Deal | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DEAL_GET, id);
  },

  /**
   * Add new deal
   */
  addDeal: (deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Deal> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DEAL_ADD, deal);
  },

  /**
   * Import deals from CSV file
   */
  importDealsFromCSV: (): Promise<{ imported: number; errors: string[] }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DEAL_IMPORT_CSV);
  },

  /**
   * Update deal
   */
  updateDeal: (id: string, deal: Partial<Deal>): Promise<Deal | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DEAL_UPDATE, id, deal);
  },

  /**
   * Delete deal
   */
  deleteDeal: (id: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DEAL_DELETE, id);
  },

  /**
   * Detect deal from file path (auto-detect from folder structure)
   */
  detectDealFromPath: (filePath: string): Promise<Deal | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DEAL_DETECT_FROM_PATH, filePath);
  },

  // ==========================================
  // Deal Activities API
  // ==========================================

  /**
   * Add deal activity
   */
  addDealActivity: (activity: Omit<DealActivity, 'id' | 'createdAt'>): Promise<DealActivity> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ACTIVITY_ADD, activity);
  },

  /**
   * Get deal activities
   */
  getDealActivities: (dealId?: string, limit?: number): Promise<DealActivity[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ACTIVITY_GET, dealId, limit);
  },

  /**
   * Update deal activity
   */
  updateDealActivity: (id: string, data: Partial<Omit<DealActivity, 'id' | 'createdAt'>>): Promise<DealActivity | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ACTIVITY_UPDATE, id, data);
  },

  /**
   * Delete deal activity
   */
  deleteDealActivity: (id: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ACTIVITY_DELETE, id);
  },

  // ==========================================
  // Pipeline Analytics API
  // ==========================================

  /**
   * Get pipeline analytics
   */
  getPipelineAnalytics: (): Promise<PipelineAnalytics> => {
    return ipcRenderer.invoke(IPC_CHANNELS.PIPELINE_GET);
  },

  // ==========================================
  // Schematics API
  // ==========================================

  /**
   * Process schematic tool call from OpenAI
   */
  processSchematicToolCall: (toolCall: SchematicToolCall): Promise<SchematicToolResponse> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SCHEMATIC_PROCESS_TOOL_CALL, toolCall);
  },

  /**
   * Get schematic image as base64 data URL
   */
  getSchematicImage: (imagePath: string): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SCHEMATIC_GET_IMAGE, imagePath);
  },

  // ==========================================
  // PDF Extraction API (for RAG)
  // ==========================================

  /**
   * Signal that the PDF extractor is ready
   */
  signalPdfExtractorReady: (): void => {
    ipcRenderer.send(IPC_CHANNELS.PDF_EXTRACTOR_READY);
  },

  /**
   * Listen for PDF extraction requests from main process
   */
  onPdfExtractRequest: (callback: (data: { requestId: string; filePath?: string; base64Data?: string; fileName?: string }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: { requestId: string; filePath?: string; base64Data?: string; fileName?: string }) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.PDF_EXTRACT_TEXT_REQUEST, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PDF_EXTRACT_TEXT_REQUEST, handler);
  },

  /**
   * Send PDF extraction result back to main process
   */
  sendPdfExtractResult: (data: { requestId: string; text: string; error?: string }): void => {
    ipcRenderer.send(IPC_CHANNELS.PDF_EXTRACT_TEXT_RESPONSE, data);
  },

  // ==========================================
  // OneDrive API
  // ==========================================

  /**
   * Start OneDrive OAuth authentication
   */
  startOneDriveAuth: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ONEDRIVE_AUTH_START);
  },

  /**
   * Get OneDrive authentication status
   */
  getOneDriveAuthStatus: (): Promise<OneDriveAuthStatus> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ONEDRIVE_AUTH_STATUS);
  },

  /**
   * Logout from OneDrive
   */
  logoutOneDrive: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ONEDRIVE_LOGOUT);
  },

  /**
   * List OneDrive folder contents
   */
  listOneDriveFolder: (folderId?: string): Promise<OneDriveItem[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ONEDRIVE_LIST_FOLDER, folderId);
  },

  /**
   * Read OneDrive file content
   */
  readOneDriveFile: (itemId: string): Promise<{ content: string; mimeType: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ONEDRIVE_READ_FILE, itemId);
  },

  /**
   * Download OneDrive file to local path
   */
  downloadOneDriveFile: (itemId: string, localPath: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ONEDRIVE_DOWNLOAD_FILE, itemId, localPath);
  },

  /**
   * Get OneDrive folder info by ID
   */
  getOneDriveFolderInfo: (folderId: string): Promise<{ id: string; name: string; path: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ONEDRIVE_GET_FOLDER_INFO, folderId);
  },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld('electronAPI', api);

// Type declaration for the API
export type ElectronAPI = typeof api;
