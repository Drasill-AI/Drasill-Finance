import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import Store from 'electron-store';
import { 
  IPC_CHANNELS, 
  DirEntry, 
  FileStat, 
  FileReadResult, 
  shouldIgnore, 
  getExtension, 
  BINARY_EXTENSIONS, 
  ChatRequest, 
  PersistedState,
  SchematicToolCall,
  SchematicToolResponse,
  Deal,
  DealActivity,
  OneDriveItem,
  OneDriveAuthStatus,
} from '@drasill/shared';
import { sendChatMessage, setApiKey, getApiKey, hasApiKey, cancelStream } from './chat';
import { indexWorkspace, indexOneDriveWorkspace, searchRAG, getIndexingStatus, clearVectorStore, resetOpenAI, tryLoadCachedVectorStore, setPdfExtractionReady } from './rag';
import { processSchematicToolCall, getSchematicImage } from './schematic';
import {
  startOneDriveAuth,
  getOneDriveAuthStatus,
  logoutOneDrive,
  listOneDriveFolder,
  readOneDriveFile,
  downloadOneDriveFile,
  getOneDriveFolderInfo,
} from './onedrive';
import {
  getDatabase,
  createDeal,
  updateDeal,
  deleteDeal,
  getDeal,
  getAllDeals,
  createDealActivity,
  updateDealActivity,
  deleteDealActivity,
  getActivitiesForDeal,
  getAllActivities,
  calculatePipelineAnalytics,
} from './database';

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
  // PDF Extractor Ready signal from renderer
  ipcMain.on(IPC_CHANNELS.PDF_EXTRACTOR_READY, () => {
    console.log('[IPC] PDF extractor ready signal received from renderer');
    setPdfExtractionReady(true);
  });

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

  // Read file as binary (Base64) for PDFs and other binary files
  ipcMain.handle(IPC_CHANNELS.READ_FILE_BINARY, async (_event, filePath: string): Promise<{ path: string; data: string }> => {
    try {
      const stats = await fs.stat(filePath);
      
      // 20MB limit for binary files
      const MAX_BINARY_SIZE = 20 * 1024 * 1024;
      if (stats.size > MAX_BINARY_SIZE) {
        throw new Error(`File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_BINARY_SIZE / 1024 / 1024}MB limit`);
      }

      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString('base64');
      
      return {
        path: filePath,
        data: base64,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to read binary file: ${filePath}`);
    }
  });

  // Read Word document and extract text
  ipcMain.handle(IPC_CHANNELS.READ_WORD_FILE, async (_event, filePath: string): Promise<{ path: string; content: string }> => {
    try {
      const mammoth = await import('mammoth');
      const buffer = await fs.readFile(filePath);
      const result = await mammoth.extractRawText({ buffer });
      
      return {
        path: filePath,
        content: result.value,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to read Word file: ${filePath}`);
    }
  });

  // Read Word document from base64 buffer and extract text
  ipcMain.handle(IPC_CHANNELS.READ_WORD_FILE_BUFFER, async (_event, base64Data: string): Promise<{ content: string }> => {
    try {
      const mammoth = await import('mammoth');
      const buffer = Buffer.from(base64Data, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      
      return {
        content: result.value,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to read Word file from buffer');
    }
  });

  // Add files to workspace (copy selected files)
  ipcMain.handle(IPC_CHANNELS.ADD_FILES, async (_event, workspacePath: string): Promise<{ added: number; cancelled: boolean }> => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Add Files to Workspace',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'md', 'txt', 'markdown', 'doc', 'docx', 'xls', 'xlsx'] },
          { name: 'PDF Files', extensions: ['pdf'] },
          { name: 'Word Files', extensions: ['doc', 'docx'] },
          { name: 'Excel Files', extensions: ['xls', 'xlsx'] },
          { name: 'Text Files', extensions: ['txt', 'md', 'markdown'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { added: 0, cancelled: true };
      }

      let addedCount = 0;
      const fsSync = await import('fs');
      
      for (const sourcePath of result.filePaths) {
        const fileName = path.basename(sourcePath);
        const destPath = path.join(workspacePath, fileName);
        
        // Check if file already exists
        try {
          await fs.access(destPath);
          // File exists, skip with a unique name
          const ext = path.extname(fileName);
          const baseName = path.basename(fileName, ext);
          const timestamp = Date.now();
          const newDestPath = path.join(workspacePath, `${baseName}_${timestamp}${ext}`);
          fsSync.copyFileSync(sourcePath, newDestPath);
          addedCount++;
        } catch {
          // File doesn't exist, copy normally
          fsSync.copyFileSync(sourcePath, destPath);
          addedCount++;
        }
      }

      return { added: addedCount, cancelled: false };
    } catch (error) {
      console.error('Failed to add files:', error);
      throw new Error(`Failed to add files: ${error}`);
    }
  });

  // Delete file
  ipcMain.handle(IPC_CHANNELS.DELETE_FILE, async (_event, filePath: string): Promise<{ success: boolean }> => {
    try {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'Delete File',
        message: `Are you sure you want to delete this file?`,
        detail: filePath,
        buttons: ['Cancel', 'Delete'],
        defaultId: 0,
        cancelId: 0,
      });

      if (result.response === 1) {
        await fs.unlink(filePath);
        return { success: true };
      }
      return { success: false };
    } catch (error) {
      console.error('Failed to delete file:', error);
      throw new Error(`Failed to delete file: ${error}`);
    }
  });

  // Delete folder
  ipcMain.handle(IPC_CHANNELS.DELETE_FOLDER, async (_event, folderPath: string): Promise<{ success: boolean }> => {
    try {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'Delete Folder',
        message: `Are you sure you want to delete this folder and all its contents?`,
        detail: folderPath,
        buttons: ['Cancel', 'Delete'],
        defaultId: 0,
        cancelId: 0,
      });

      if (result.response === 1) {
        await fs.rm(folderPath, { recursive: true, force: true });
        return { success: true };
      }
      return { success: false };
    } catch (error) {
      console.error('Failed to delete folder:', error);
      throw new Error(`Failed to delete folder: ${error}`);
    }
  });

  // Close workspace
  ipcMain.handle(IPC_CHANNELS.CLOSE_WORKSPACE, async (): Promise<{ success: boolean }> => {
    return { success: true };
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
      await setApiKey(apiKey);
      resetOpenAI(); // Reset OpenAI client in RAG module too
      return true;
    } catch (error) {
      return false;
    }
  });

  // Chat: Get API key (masked)
  ipcMain.handle(IPC_CHANNELS.CHAT_GET_API_KEY, async (): Promise<{ hasKey: boolean; maskedKey: string | null }> => {
    return {
      hasKey: await hasApiKey(),
      maskedKey: await getApiKey(),
    };
  });

  // Chat: Cancel stream
  ipcMain.handle(IPC_CHANNELS.CHAT_CANCEL, async (): Promise<void> => {
    cancelStream();
  });

  // RAG: Index workspace
  ipcMain.handle(IPC_CHANNELS.RAG_INDEX_WORKSPACE, async (event, workspacePath: string, forceReindex = false): Promise<{ success: boolean; chunksIndexed: number; error?: string }> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      return await indexWorkspace(workspacePath, window, forceReindex);
    }
    return { success: false, chunksIndexed: 0, error: 'No window found' };
  });

  // RAG: Index OneDrive workspace
  ipcMain.handle(IPC_CHANNELS.RAG_INDEX_ONEDRIVE, async (event, folderId: string, folderPath: string, forceReindex = false): Promise<{ success: boolean; chunksIndexed: number; error?: string }> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      return await indexOneDriveWorkspace(folderId, folderPath, window, forceReindex);
    }
    return { success: false, chunksIndexed: 0, error: 'No window found' };
  });

  // RAG: Search
  ipcMain.handle(IPC_CHANNELS.RAG_SEARCH, async (_event, query: string): Promise<{ chunks: Array<{ content: string; fileName: string; filePath: string; score: number }> }> => {
    return await searchRAG(query);
  });

  // RAG: Get status
  ipcMain.handle(IPC_CHANNELS.RAG_GET_STATUS, async (): Promise<{ isIndexing: boolean; chunksCount: number; lastUpdated: number | null; workspacePath: string | null }> => {
    return getIndexingStatus();
  });

  // RAG: Try to load cached embeddings for a workspace
  ipcMain.handle(IPC_CHANNELS.RAG_LOAD_CACHE, async (_event, workspacePath: string): Promise<boolean> => {
    return await tryLoadCachedVectorStore(workspacePath);
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

  // ==========================================
  // Deal Management
  // ==========================================

  // Initialize database
  ipcMain.handle(IPC_CHANNELS.DB_INIT, async (): Promise<{ success: boolean; error?: string }> => {
    try {
      getDatabase(); // Initialize by getting the database instance
      return { success: true };
    } catch (error) {
      console.error('Database init error:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get all deals
  ipcMain.handle(IPC_CHANNELS.DEAL_GET_ALL, async (): Promise<Deal[]> => {
    return getAllDeals();
  });

  // Get single deal
  ipcMain.handle(IPC_CHANNELS.DEAL_GET, async (_event, id: string): Promise<Deal | null> => {
    return getDeal(id);
  });

  // Add deal
  ipcMain.handle(IPC_CHANNELS.DEAL_ADD, async (_event, deal: Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Deal> => {
    return createDeal(deal);
  });

  // Import deals from CSV
  ipcMain.handle(IPC_CHANNELS.DEAL_IMPORT_CSV, async (): Promise<{ imported: number; errors: string[] }> => {
    const result = await dialog.showOpenDialog({
      title: 'Import Deals from CSV',
      properties: ['openFile'],
      filters: [
        { name: 'CSV Files', extensions: ['csv'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { imported: 0, errors: [] };
    }

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    
    if (lines.length < 2) {
      return { imported: 0, errors: ['CSV file is empty or has no data rows'] };
    }

    // Parse header row
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[\s_-]+/g, ''));
    
    // Map common header variations to our fields
    const headerMap: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (['borrowername', 'borrower', 'name', 'company', 'client'].includes(h)) headerMap['borrowerName'] = String(i);
      else if (['borrowercontact', 'contact', 'email', 'phone'].includes(h)) headerMap['borrowerContact'] = String(i);
      else if (['loanamount', 'loan', 'amount', 'principal', 'value'].includes(h)) headerMap['loanAmount'] = String(i);
      else if (['interestrate', 'rate', 'interest', 'apr'].includes(h)) headerMap['interestRate'] = String(i);
      else if (['termmonths', 'term', 'months', 'duration'].includes(h)) headerMap['termMonths'] = String(i);
      else if (['collateral', 'collateraldescription', 'security'].includes(h)) headerMap['collateralDescription'] = String(i);
      else if (['stage', 'status'].includes(h)) headerMap['stage'] = String(i);
      else if (['priority'].includes(h)) headerMap['priority'] = String(i);
      else if (['assignedto', 'assigned', 'owner', 'lender'].includes(h)) headerMap['assignedTo'] = String(i);
      else if (['notes', 'comments', 'description'].includes(h)) headerMap['notes'] = String(i);
      else if (['expectedclosedate', 'closedate', 'duedate', 'expectedclose'].includes(h)) headerMap['expectedCloseDate'] = String(i);
    });

    if (!headerMap['borrowerName'] && !headerMap['loanAmount']) {
      return { imported: 0, errors: ['CSV must have at least a "Borrower Name" or "Loan Amount" column'] };
    }

    const errors: string[] = [];
    let imported = 0;

    // Process data rows
    for (let i = 1; i < lines.length; i++) {
      try {
        // Parse CSV line (handle quoted fields with commas)
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        for (const char of lines[i]) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());

        const getValue = (field: string): string => {
          const idx = headerMap[field];
          return idx !== undefined ? (values[parseInt(idx)] || '') : '';
        };

        const borrowerName = getValue('borrowerName');
        const loanAmountStr = getValue('loanAmount').replace(/[$,]/g, '');
        const loanAmount = parseFloat(loanAmountStr) || 0;

        if (!borrowerName && !loanAmount) {
          errors.push(`Row ${i + 1}: Missing borrower name and loan amount`);
          continue;
        }

        // Validate and map stage
        let stage = getValue('stage').toLowerCase();
        const validStages = ['lead', 'application', 'underwriting', 'approved', 'funded', 'closed', 'declined'];
        if (!validStages.includes(stage)) stage = 'lead';

        // Validate and map priority
        let priority = getValue('priority').toLowerCase();
        const validPriorities = ['low', 'medium', 'high'];
        if (!validPriorities.includes(priority)) priority = 'medium';

        createDeal({
          borrowerName: borrowerName || 'Unknown',
          borrowerContact: getValue('borrowerContact') || null,
          loanAmount,
          interestRate: parseFloat(getValue('interestRate')) || null,
          termMonths: parseInt(getValue('termMonths')) || null,
          collateralDescription: getValue('collateralDescription') || null,
          stage: stage as any,
          priority: priority as any,
          assignedTo: getValue('assignedTo') || null,
          notes: getValue('notes') || null,
          expectedCloseDate: getValue('expectedCloseDate') || null,
        });
        imported++;
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return { imported, errors };
  });

  // Update deal
  ipcMain.handle(IPC_CHANNELS.DEAL_UPDATE, async (_event, id: string, deal: Partial<Deal>): Promise<Deal | null> => {
    return updateDeal(id, deal);
  });

  // Delete deal
  ipcMain.handle(IPC_CHANNELS.DEAL_DELETE, async (_event, id: string): Promise<boolean> => {
    return deleteDeal(id);
  });

  // Detect deal from file path - match deal by borrower name patterns in path
  ipcMain.handle(IPC_CHANNELS.DEAL_DETECT_FROM_PATH, async (_event, filePath: string): Promise<Deal | null> => {
    const allDeals = getAllDeals();
    const pathLower = filePath.toLowerCase();
    
    // Try to find deal where borrower name appears in the file path
    for (const deal of allDeals) {
      const borrowerLower = deal.borrowerName.toLowerCase();
      
      // Check if borrower name (or parts of it) appear in path
      if (pathLower.includes(borrowerLower)) {
        return deal;
      }
      
      // Try matching first word of borrower name
      const firstWord = borrowerLower.split(/\s+/)[0];
      if (firstWord.length > 3 && pathLower.includes(firstWord)) {
        return deal;
      }
      
      // Also check document path match if stored
      if (deal.documentPath && filePath.startsWith(deal.documentPath)) {
        return deal;
      }
    }
    
    return null;
  });

  // ==========================================
  // Deal Activities
  // ==========================================

  // Add deal activity
  ipcMain.handle(IPC_CHANNELS.ACTIVITY_ADD, async (_event, activity: Omit<DealActivity, 'id' | 'createdAt'>): Promise<DealActivity> => {
    return createDealActivity(activity);
  });

  // Get deal activities
  ipcMain.handle(IPC_CHANNELS.ACTIVITY_GET, async (_event, dealId?: string, _limit?: number): Promise<DealActivity[]> => {
    if (dealId) {
      return getActivitiesForDeal(dealId);
    }
    return getAllActivities();
  });

  // Update deal activity
  ipcMain.handle(IPC_CHANNELS.ACTIVITY_UPDATE, async (_event, id: string, data: Partial<Omit<DealActivity, 'id' | 'createdAt'>>): Promise<DealActivity | null> => {
    return updateDealActivity(id, data);
  });

  // Delete deal activity
  ipcMain.handle(IPC_CHANNELS.ACTIVITY_DELETE, async (_event, id: string): Promise<boolean> => {
    return deleteDealActivity(id);
  });

  // ==========================================
  // Pipeline Analytics
  // ==========================================

  // Get pipeline analytics
  ipcMain.handle(IPC_CHANNELS.PIPELINE_GET, async (): Promise<ReturnType<typeof calculatePipelineAnalytics>> => {
    return calculatePipelineAnalytics();
  });

  // ==========================================
  // Schematics
  // ==========================================

  // Process schematic tool call from OpenAI
  ipcMain.handle(
    IPC_CHANNELS.SCHEMATIC_PROCESS_TOOL_CALL,
    async (_event, toolCall: SchematicToolCall): Promise<SchematicToolResponse> => {
      try {
        console.log('[IPC] Processing schematic tool call:', toolCall);
        const response = await processSchematicToolCall(toolCall);
        console.log('[IPC] Schematic tool call response:', response);
        return response;
      } catch (error) {
        console.error('[IPC] Error processing schematic tool call:', error);
        return {
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Get schematic image as base64 data URL
  ipcMain.handle(
    IPC_CHANNELS.SCHEMATIC_GET_IMAGE,
    async (_event, imagePath: string): Promise<string> => {
      try {
        console.log('[IPC] Getting schematic image:', imagePath);
        const dataUrl = await getSchematicImage(imagePath);
        return dataUrl;
      } catch (error) {
        console.error('[IPC] Error getting schematic image:', error);
        throw error;
      }
    }
  );

  // ==========================================
  // OneDrive Integration
  // ==========================================

  // Start OneDrive OAuth flow
  ipcMain.handle(IPC_CHANNELS.ONEDRIVE_AUTH_START, async (): Promise<{ success: boolean; error?: string }> => {
    try {
      console.log('[IPC] Starting OneDrive authentication...');
      const result = await startOneDriveAuth();
      console.log('[IPC] OneDrive auth result:', result.success);
      return result;
    } catch (error) {
      console.error('[IPC] OneDrive auth error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get OneDrive authentication status
  ipcMain.handle(IPC_CHANNELS.ONEDRIVE_AUTH_STATUS, async (): Promise<OneDriveAuthStatus> => {
    try {
      return await getOneDriveAuthStatus();
    } catch (error) {
      console.error('[IPC] OneDrive status error:', error);
      return { isAuthenticated: false };
    }
  });

  // Logout from OneDrive
  ipcMain.handle(IPC_CHANNELS.ONEDRIVE_LOGOUT, async (): Promise<boolean> => {
    try {
      console.log('[IPC] Logging out from OneDrive...');
      return await logoutOneDrive();
    } catch (error) {
      console.error('[IPC] OneDrive logout error:', error);
      return false;
    }
  });

  // List OneDrive folder contents
  ipcMain.handle(IPC_CHANNELS.ONEDRIVE_LIST_FOLDER, async (_event, folderId?: string): Promise<OneDriveItem[]> => {
    try {
      console.log('[IPC] Listing OneDrive folder:', folderId || 'root');
      return await listOneDriveFolder(folderId);
    } catch (error) {
      console.error('[IPC] OneDrive list folder error:', error);
      throw error;
    }
  });

  // Read OneDrive file content
  ipcMain.handle(IPC_CHANNELS.ONEDRIVE_READ_FILE, async (_event, itemId: string): Promise<{ content: string; mimeType: string }> => {
    try {
      console.log('[IPC] Reading OneDrive file:', itemId);
      return await readOneDriveFile(itemId);
    } catch (error) {
      console.error('[IPC] OneDrive read file error:', error);
      throw error;
    }
  });

  // Download OneDrive file to local path
  ipcMain.handle(IPC_CHANNELS.ONEDRIVE_DOWNLOAD_FILE, async (_event, itemId: string, localPath: string): Promise<{ success: boolean }> => {
    try {
      console.log('[IPC] Downloading OneDrive file:', itemId, 'to', localPath);
      return await downloadOneDriveFile(itemId, localPath);
    } catch (error) {
      console.error('[IPC] OneDrive download error:', error);
      throw error;
    }
  });

  // Get OneDrive folder info
  ipcMain.handle(IPC_CHANNELS.ONEDRIVE_GET_FOLDER_INFO, async (_event, folderId: string): Promise<{ id: string; name: string; path: string }> => {
    try {
      console.log('[IPC] Getting OneDrive folder info:', folderId);
      return await getOneDriveFolderInfo(folderId);
    } catch (error) {
      console.error('[IPC] OneDrive folder info error:', error);
      throw error;
    }
  });
}
