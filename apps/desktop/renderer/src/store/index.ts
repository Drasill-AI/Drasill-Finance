import { create } from 'zustand';
import { Tab, TreeNode, getFileType, ChatMessage, FileContext, PersistedState, Deal, DealActivity, BottomPanelState, SchematicToolCall, SchematicData, OneDriveAuthStatus, OneDriveItem } from '@drasill/shared';

interface ToastMessage {
  id: string;
  type: 'error' | 'success' | 'info';
  message: string;
}

interface AppState {
  // Workspace
  workspacePath: string | null;
  tree: TreeNode[];
  isLoadingTree: boolean;

  // Chat
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  chatError: string | null;
  hasApiKey: boolean;

  // RAG
  isIndexing: boolean;
  indexingProgress: { current: number; total: number; fileName: string; percentage: number } | null;
  ragChunksCount: number;

  // Tabs
  tabs: Tab[];
  activeTabId: string | null;
  
  // File content cache
  fileContents: Map<string, string>;
  loadingFiles: Set<string>;

  // UI state
  isCommandPaletteOpen: boolean;
  toasts: ToastMessage[];

  // Tab view states (for Monaco)
  tabViewStates: Map<string, unknown>;

  // Deals & Activities
  deals: Deal[];
  selectedDealId: string | null;
  detectedDeal: Deal | null;
  isActivityModalOpen: boolean;
  isDealModalOpen: boolean;
  activitiesRefreshTrigger: number;
  editingActivity: DealActivity | null;

  // Bottom Panel
  bottomPanelState: BottomPanelState;

  // OneDrive
  oneDriveStatus: OneDriveAuthStatus;
  workspaceSource: 'local' | 'onedrive';
  oneDriveFolderId: string | null;
  isOneDrivePickerOpen: boolean;

  // Actions
  openWorkspace: () => Promise<void>;
  closeWorkspace: () => Promise<void>;
  setWorkspacePath: (path: string | null) => void;
  loadDirectory: (path: string) => Promise<TreeNode[]>;
  toggleDirectory: (node: TreeNode) => Promise<void>;
  refreshTree: () => Promise<void>;
  deleteFile: (filePath: string) => Promise<boolean>;
  deleteFolder: (folderPath: string) => Promise<boolean>;
  createFile: (parentPath: string, fileName: string) => Promise<boolean>;
  createFolder: (parentPath: string, folderName: string) => Promise<boolean>;
  renameItem: (oldPath: string, newName: string) => Promise<boolean>;
  
  openFile: (path: string, name: string) => Promise<void>;
  closeTab: (tabId: string) => void;
  closeActiveTab: () => void;
  setActiveTab: (tabId: string) => void;
  saveTabViewState: (tabId: string, viewState: unknown) => void;
  getTabViewState: (tabId: string) => unknown | undefined;

  toggleCommandPalette: () => void;
  
  showToast: (type: ToastMessage['type'], message: string) => void;
  dismissToast: (id: string) => void;

  // Chat actions
  checkApiKey: () => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  sendMessage: (content: string, fileContext?: FileContext) => Promise<void>;
  clearChat: () => void;
  cancelChat: () => void;

  // RAG actions
  indexWorkspace: (forceReindex?: boolean) => Promise<void>;
  checkRagStatus: () => Promise<void>;
  loadRagCache: (workspacePath: string) => Promise<boolean>;
  clearRagIndex: () => Promise<void>;

  // State persistence
  savePersistedState: () => Promise<void>;
  loadPersistedState: () => Promise<void>;
  restoreWorkspace: (path: string) => Promise<void>;

  // Deal actions
  loadDeals: () => Promise<void>;
  setSelectedDeal: (id: string | null) => void;
  detectDealFromFile: (path: string) => Promise<void>;
  setActivityModalOpen: (open: boolean) => void;
  setDealModalOpen: (open: boolean) => void;
  setEditingActivity: (activity: DealActivity | null) => void;
  refreshActivities: () => void;

  // Bottom panel actions
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelHeight: (height: number) => void;
  toggleBottomPanel: () => void;

  // Schematic actions
  openSchematicTab: (toolCall: SchematicToolCall) => Promise<void>;

  // OneDrive actions
  checkOneDriveStatus: () => Promise<void>;
  loginOneDrive: () => Promise<void>;
  logoutOneDrive: () => Promise<void>;
  openOneDriveWorkspace: (folderId: string, folderName: string, folderPath: string) => Promise<void>;
  loadOneDriveDirectory: (folderId?: string) => Promise<TreeNode[]>;
  toggleOneDriveDirectory: (node: TreeNode) => Promise<void>;
  openOneDriveFile: (node: TreeNode, initialPage?: number) => Promise<void>;
  setOneDrivePickerOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  workspacePath: null,
  tree: [],
  isLoadingTree: false,
  tabs: [],
  activeTabId: null,
  fileContents: new Map(),
  loadingFiles: new Set(),
  isCommandPaletteOpen: false,
  toasts: [],
  tabViewStates: new Map(),
  
  // Chat state
  chatMessages: [],
  isChatLoading: false,
  chatError: null,
  hasApiKey: false,

  // RAG state
  isIndexing: false,
  indexingProgress: null,
  ragChunksCount: 0,

  // Deals & Activities state
  deals: [],
  selectedDealId: null,
  detectedDeal: null,
  isActivityModalOpen: false,
  isDealModalOpen: false,
  activitiesRefreshTrigger: 0,
  editingActivity: null,

  // Bottom panel state
  bottomPanelState: {
    isOpen: false,
    height: 200,
    activeTab: 'activities',
  },

  // OneDrive state
  oneDriveStatus: { isAuthenticated: false },
  workspaceSource: 'local',
  oneDriveFolderId: null,
  isOneDrivePickerOpen: false,

  // Actions
  openWorkspace: async () => {
    try {
      const path = await window.electronAPI.selectWorkspace();
      if (path) {
        set({ workspacePath: path, tree: [], tabs: [], activeTabId: null, fileContents: new Map() });
        const children = await get().loadDirectory(path);
        set({
          tree: [{
            id: path,
            name: path.split(/[\\/]/).pop() || path,
            path: path,
            isDirectory: true,
            isExpanded: true,
            children,
          }],
        });
        // Persist state
        get().savePersistedState();
      }
    } catch (error) {
      get().showToast('error', `Failed to open workspace: ${error}`);
    }
  },

  closeWorkspace: async () => {
    try {
      await window.electronAPI.closeWorkspace();
      set({ 
        workspacePath: null, 
        tree: [], 
        tabs: [], 
        activeTabId: null, 
        fileContents: new Map(),
        selectedDealId: null,
        detectedDeal: null,
      });
      get().savePersistedState();
      get().showToast('info', 'Workspace closed');
    } catch (error) {
      get().showToast('error', `Failed to close workspace: ${error}`);
    }
  },

  setWorkspacePath: (path) => {
    set({ workspacePath: path });
  },

  loadDirectory: async (path: string): Promise<TreeNode[]> => {
    try {
      const entries = await window.electronAPI.readDir(path);
      return entries.map((entry) => ({
        id: entry.path,
        name: entry.name,
        path: entry.path,
        isDirectory: entry.isDirectory,
        extension: entry.extension,
        isExpanded: false,
        children: entry.isDirectory ? undefined : undefined,
      }));
    } catch (error) {
      get().showToast('error', `Failed to read directory: ${error}`);
      return [];
    }
  },

  refreshTree: async () => {
    const { workspacePath, loadDirectory } = get();
    if (!workspacePath) return;
    
    try {
      const children = await loadDirectory(workspacePath);
      set({
        tree: [{
          id: workspacePath,
          name: workspacePath.split(/[\\/]/).pop() || workspacePath,
          path: workspacePath,
          isDirectory: true,
          isExpanded: true,
          children,
        }],
      });
    } catch (error) {
      get().showToast('error', `Failed to refresh tree: ${error}`);
    }
  },

  deleteFile: async (filePath: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.deleteFile(filePath);
      if (result.success) {
        // Close any open tabs for this file
        const { tabs, activeTabId } = get();
        const tabToClose = tabs.find(t => t.path === filePath);
        if (tabToClose) {
          get().closeTab(tabToClose.id);
        }
        await get().refreshTree();
        get().showToast('success', 'File deleted');
      }
      return result.success;
    } catch (error) {
      get().showToast('error', `Failed to delete file: ${error}`);
      return false;
    }
  },

  deleteFolder: async (folderPath: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.deleteFolder(folderPath);
      if (result.success) {
        // Close any open tabs for files in this folder
        const { tabs } = get();
        const tabsToClose = tabs.filter(t => t.path.startsWith(folderPath));
        tabsToClose.forEach(tab => get().closeTab(tab.id));
        await get().refreshTree();
        get().showToast('success', 'Folder deleted');
      }
      return result.success;
    } catch (error) {
      get().showToast('error', `Failed to delete folder: ${error}`);
      return false;
    }
  },

  createFile: async (parentPath: string, fileName: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.createFile(parentPath, fileName);
      if (result.success) {
        await get().refreshTree();
        // Open the newly created file
        if (result.filePath) {
          get().openFile(result.filePath, fileName);
        }
        get().showToast('success', 'File created');
      }
      return result.success;
    } catch (error) {
      get().showToast('error', `Failed to create file: ${error}`);
      return false;
    }
  },

  createFolder: async (parentPath: string, folderName: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.createFolder(parentPath, folderName);
      if (result.success) {
        await get().refreshTree();
        get().showToast('success', 'Folder created');
      }
      return result.success;
    } catch (error) {
      get().showToast('error', `Failed to create folder: ${error}`);
      return false;
    }
  },

  renameItem: async (oldPath: string, newName: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.renameFile(oldPath, newName);
      if (result.success) {
        // Update any open tabs with the old path
        const { tabs } = get();
        const affectedTab = tabs.find(t => t.path === oldPath || t.path.startsWith(oldPath + '/') || t.path.startsWith(oldPath + '\\'));
        if (affectedTab && result.newPath) {
          // Update tab path
          set((state) => ({
            tabs: state.tabs.map(t => {
              if (t.path === oldPath) {
                return { ...t, path: result.newPath!, name: newName };
              }
              // Handle files inside a renamed folder
              if (t.path.startsWith(oldPath + '/') || t.path.startsWith(oldPath + '\\')) {
                const newTabPath = result.newPath + t.path.slice(oldPath.length);
                return { ...t, path: newTabPath };
              }
              return t;
            }),
          }));
        }
        await get().refreshTree();
        get().showToast('success', 'Renamed successfully');
      }
      return result.success;
    } catch (error) {
      get().showToast('error', `Failed to rename: ${error}`);
      return false;
    }
  },

  toggleDirectory: async (node: TreeNode) => {
    const updateNode = (nodes: TreeNode[], targetId: string, updater: (n: TreeNode) => TreeNode): TreeNode[] => {
      return nodes.map((n) => {
        if (n.id === targetId) {
          return updater(n);
        }
        if (n.children) {
          return { ...n, children: updateNode(n.children, targetId, updater) };
        }
        return n;
      });
    };

    if (node.isExpanded) {
      // Collapse
      set((state) => ({
        tree: updateNode(state.tree, node.id, (n) => ({ ...n, isExpanded: false })),
      }));
    } else {
      // Expand and load children
      const children = await get().loadDirectory(node.path);
      set((state) => ({
        tree: updateNode(state.tree, node.id, (n) => ({
          ...n,
          isExpanded: true,
          children,
        })),
      }));
    }
  },

  openFile: async (path: string, name: string) => {
    const { tabs, loadingFiles } = get();

    // Check if already open
    const existingTab = tabs.find((t) => t.path === path);
    if (existingTab) {
      set({ activeTabId: existingTab.id });
      return;
    }

    const fileType = getFileType(path);

    // For PDF, just create a tab without loading content (PDF viewer handles it)
    if (fileType === 'pdf') {
      const newTab: Tab = {
        id: path,
        name,
        path,
        type: 'pdf',
      };
      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }));
      // Persist state
      get().savePersistedState();
      return;
    }

    // For Word files, just create a tab without loading content (Word viewer handles it)
    if (fileType === 'word') {
      const newTab: Tab = {
        id: path,
        name,
        path,
        type: 'word',
      };
      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }));
      // Persist state
      get().savePersistedState();
      return;
    }

    // Skip if already loading
    if (loadingFiles.has(path)) return;

    // Load file content
    set((state) => ({
      loadingFiles: new Set(state.loadingFiles).add(path),
    }));

    try {
      const result = await window.electronAPI.readFile(path);
      
      const newTab: Tab = {
        id: path,
        name,
        path,
        type: fileType,
      };

      const newContents = new Map(get().fileContents);
      newContents.set(path, result.content);

      const newLoading = new Set(get().loadingFiles);
      newLoading.delete(path);

      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        fileContents: newContents,
        loadingFiles: newLoading,
      }));
      // Persist state
      get().savePersistedState();
    } catch (error) {
      const newLoading = new Set(get().loadingFiles);
      newLoading.delete(path);
      set({ loadingFiles: newLoading });
      get().showToast('error', `Failed to open file: ${error}`);
    }
  },

  closeTab: (tabId: string) => {
    set((state) => {
      const tabIndex = state.tabs.findIndex((t) => t.id === tabId);
      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      
      // Clean up file content
      const newContents = new Map(state.fileContents);
      newContents.delete(tabId);

      // Clean up view state
      const newViewStates = new Map(state.tabViewStates);
      newViewStates.delete(tabId);

      // Determine new active tab
      let newActiveTabId = state.activeTabId;
      if (state.activeTabId === tabId) {
        if (newTabs.length === 0) {
          newActiveTabId = null;
        } else if (tabIndex >= newTabs.length) {
          newActiveTabId = newTabs[newTabs.length - 1].id;
        } else {
          newActiveTabId = newTabs[tabIndex].id;
        }
      }

      return {
        tabs: newTabs,
        activeTabId: newActiveTabId,
        fileContents: newContents,
        tabViewStates: newViewStates,
      };
    });
    // Persist state after closing tab
    get().savePersistedState();
  },

  closeActiveTab: () => {
    const { activeTabId, closeTab } = get();
    if (activeTabId) {
      closeTab(activeTabId);
    }
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId });
    // Persist active tab change
    get().savePersistedState();
  },

  saveTabViewState: (tabId: string, viewState: unknown) => {
    set((state) => {
      const newViewStates = new Map(state.tabViewStates);
      newViewStates.set(tabId, viewState);
      return { tabViewStates: newViewStates };
    });
  },

  getTabViewState: (tabId: string) => {
    return get().tabViewStates.get(tabId);
  },

  toggleCommandPalette: () => {
    set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen }));
  },

  showToast: (type, message) => {
    const id = Math.random().toString(36).slice(2);
    set((state) => ({
      toasts: [...state.toasts, { id, type, message }],
    }));

    // Auto dismiss after 5 seconds
    setTimeout(() => {
      get().dismissToast(id);
    }, 5000);
  },

  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  // Chat actions
  checkApiKey: async () => {
    try {
      const result = await window.electronAPI.getApiKey();
      set({ hasApiKey: result.hasKey });
    } catch {
      set({ hasApiKey: false });
    }
  },

  setApiKey: async (key: string) => {
    try {
      await window.electronAPI.setApiKey(key);
      set({ hasApiKey: true, chatError: null });
    } catch (error) {
      set({ chatError: 'Failed to save API key' });
    }
  },

  sendMessage: async (content: string, fileContext?: FileContext) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    set((state) => ({
      chatMessages: [...state.chatMessages, userMessage],
      isChatLoading: true,
      chatError: null,
    }));

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    set((state) => ({
      chatMessages: [...state.chatMessages, assistantMessage],
    }));

    // Set up stream listeners
    // Listen for stream start to capture RAG sources
    const removeStartListener = window.electronAPI.onChatStreamStart((data) => {
      if (data.ragSources && data.ragSources.length > 0) {
        set((state) => {
          const messages = [...state.chatMessages];
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            messages[messages.length - 1] = {
              ...lastMsg,
              ragSources: data.ragSources,
            };
          }
          return { chatMessages: messages };
        });
      }
    });

    const removeChunkListener = window.electronAPI.onChatStreamChunk((chunk) => {
      set((state) => {
        const messages = [...state.chatMessages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          messages[messages.length - 1] = {
            ...lastMsg,
            content: lastMsg.content + chunk.delta,
          };
        }
        return { chatMessages: messages };
      });
    });

    const removeEndListener = window.electronAPI.onChatStreamEnd(() => {
      set({ isChatLoading: false });
      removeStartListener();
      removeChunkListener();
      removeEndListener();
      removeErrorListener();
    });

    const removeErrorListener = window.electronAPI.onChatStreamError((data) => {
      set((state) => {
        // Remove the empty assistant message on error
        const messages = state.chatMessages.filter(m => m.id !== assistantMessage.id);
        return { 
          chatMessages: messages, 
          isChatLoading: false, 
          chatError: data.error 
        };
      });
      removeStartListener();
      removeChunkListener();
      removeEndListener();
      removeErrorListener();
    });

    // Send the message
    try {
      const history = get().chatMessages.filter(m => m.id !== assistantMessage.id);
      await window.electronAPI.sendChatMessage({
        message: content,
        context: fileContext,
        history,
      });
    } catch (error) {
      set({ isChatLoading: false, chatError: 'Failed to send message' });
      removeChunkListener();
      removeEndListener();
      removeErrorListener();
    }
  },

  clearChat: () => {
    set({ chatMessages: [], chatError: null });
  },

  cancelChat: () => {
    window.electronAPI.cancelChat();
    set({ isChatLoading: false });
  },

  // RAG actions
  indexWorkspace: async (forceReindex = false) => {
    const { workspacePath, hasApiKey, workspaceSource, oneDriveFolderId } = get();
    console.log('[Store] indexWorkspace called:', { workspacePath, hasApiKey, workspaceSource, oneDriveFolderId, forceReindex });
    
    if (!workspacePath) {
      get().showToast('error', 'No workspace open');
      return;
    }
    if (!hasApiKey) {
      get().showToast('error', 'Please configure your API key first');
      return;
    }

    set({ isIndexing: true, indexingProgress: null });

    // Set up progress listener
    const removeProgressListener = window.electronAPI.onRagIndexProgress((data) => {
      console.log('[Store] RAG progress:', data);
      set({ indexingProgress: data });
    });

    const removeCompleteListener = window.electronAPI.onRagIndexComplete((data) => {
      console.log('[Store] RAG complete:', data);
      set({ 
        isIndexing: false, 
        indexingProgress: null, 
        ragChunksCount: data.chunksIndexed 
      });
      get().showToast('success', `Indexed ${data.filesIndexed} files (${data.chunksIndexed} chunks)`);
      removeProgressListener();
      removeCompleteListener();
    });

    try {
      let result;
      
      // Use appropriate indexer based on workspace source
      if (workspaceSource === 'onedrive' && oneDriveFolderId) {
        console.log('[Store] Calling indexOneDriveWorkspace');
        result = await window.electronAPI.indexOneDriveWorkspace(oneDriveFolderId, workspacePath, forceReindex);
      } else {
        console.log('[Store] Calling indexWorkspace (local)');
        result = await window.electronAPI.indexWorkspace(workspacePath, forceReindex);
      }
      
      console.log('[Store] Index result:', result);
      
      if (!result.success) {
        set({ isIndexing: false, indexingProgress: null });
        get().showToast('error', result.error || 'Indexing failed');
        removeProgressListener();
        removeCompleteListener();
      }
    } catch (error) {
      console.error('[Store] Index error:', error);
      set({ isIndexing: false, indexingProgress: null });
      get().showToast('error', 'Failed to index workspace');
      removeProgressListener();
      removeCompleteListener();
    }
  },

  checkRagStatus: async () => {
    try {
      const status = await window.electronAPI.getRagStatus();
      set({ 
        isIndexing: status.isIndexing, 
        ragChunksCount: status.chunksCount,
      });
    } catch {
      // Ignore errors
    }
  },

  // Try to load cached RAG embeddings for a workspace
  loadRagCache: async (workspacePath: string) => {
    try {
      const loaded = await window.electronAPI.loadRagCache(workspacePath);
      if (loaded) {
        const status = await window.electronAPI.getRagStatus();
        set({ ragChunksCount: status.chunksCount });
        if (status.lastUpdated) {
          const date = new Date(status.lastUpdated).toLocaleString();
          console.log(`[Store] Loaded RAG cache: ${status.chunksCount} chunks (indexed: ${date})`);
        }
        return true;
      }
    } catch {
      // Ignore errors
    }
    return false;
  },

  clearRagIndex: async () => {
    try {
      await window.electronAPI.clearRagIndex();
      set({ ragChunksCount: 0 });
      get().showToast('info', 'Knowledge base cleared');
    } catch {
      get().showToast('error', 'Failed to clear knowledge base');
    }
  },

  // State persistence
  savePersistedState: async () => {
    const { workspacePath, tabs, activeTabId, workspaceSource, oneDriveFolderId } = get();
    const state: PersistedState = {
      workspacePath,
      openTabs: tabs.map(t => ({
        id: t.id,
        name: t.name,
        path: t.path,
        type: t.type,
      })),
      activeTabId,
      workspaceSource,
      oneDriveFolderId: oneDriveFolderId || undefined,
    };
    try {
      await window.electronAPI.saveState(state);
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  },

  loadPersistedState: async () => {
    try {
      const state = await window.electronAPI.loadState();
      if (state?.workspacePath) {
        // Check if this was an OneDrive workspace
        if (state.workspaceSource === 'onedrive' && state.oneDriveFolderId) {
          // Restore OneDrive workspace
          await get().restoreOneDriveWorkspace(state.oneDriveFolderId, state.workspacePath);
        } else {
          // Restore local workspace
          await get().restoreWorkspace(state.workspacePath);
        }
        
        // Restore tabs
        if (state.openTabs && state.openTabs.length > 0) {
          for (const tab of state.openTabs) {
            await get().openFile(tab.path, tab.name);
          }
          // Set active tab
          if (state.activeTabId) {
            set({ activeTabId: state.activeTabId });
          }
        }
      }
    } catch (error) {
      console.error('Failed to load persisted state:', error);
    }
  },

  restoreOneDriveWorkspace: async (folderId: string, folderPath: string) => {
    try {
      // Check if still authenticated
      const authStatus = await window.electronAPI.getOneDriveAuthStatus();
      if (!authStatus.isAuthenticated) {
        console.log('[Store] OneDrive not authenticated, skipping workspace restore');
        return;
      }

      set({ 
        workspacePath: folderPath,
        workspaceSource: 'onedrive',
        oneDriveFolderId: folderId,
        tree: [],
        tabs: [],
        activeTabId: null,
        fileContents: new Map(),
      });
      
      const children = await get().loadOneDriveDirectory(folderId);
      const folderName = folderPath.split(/[\/]/).pop() || 'OneDrive';
      set({
        tree: [{
          id: folderId,
          name: folderName,
          path: folderPath,
          isDirectory: true,
          isExpanded: true,
          children,
          source: 'onedrive',
          oneDriveId: folderId,
        }],
      });
      
      // Try to load cached RAG embeddings for the workspace
      const loaded = await get().loadRagCache(folderPath);
      if (loaded) {
        console.log('[Store] Successfully loaded cached RAG embeddings for OneDrive workspace');
      }
    } catch (error) {
      console.error('[Store] Failed to restore OneDrive workspace:', error);
      // Clear state on error
      set({ workspacePath: null, workspaceSource: 'local', oneDriveFolderId: null });
    }
  },

  restoreWorkspace: async (workspacePath: string) => {
    try {
      set({ workspacePath, tree: [], tabs: [], activeTabId: null, fileContents: new Map() });
      const children = await get().loadDirectory(workspacePath);
      set({
        tree: [{
          id: workspacePath,
          name: workspacePath.split(/[\\/]/).pop() || workspacePath,
          path: workspacePath,
          isDirectory: true,
          isExpanded: true,
          children,
        }],
      });
      
      // Try to load cached RAG embeddings for the workspace
      const loaded = await get().loadRagCache(workspacePath);
      if (loaded) {
        console.log('[Store] Successfully loaded cached RAG embeddings');
      }
    } catch (error) {
      get().showToast('error', `Failed to restore workspace: ${error}`);
    }
  },

  // Deal actions
  loadDeals: async () => {
    try {
      const dealsList = await window.electronAPI.getAllDeals();
      set({ deals: dealsList });
    } catch (error) {
      get().showToast('error', 'Failed to load deals');
    }
  },

  setSelectedDeal: (id: string | null) => {
    set({ selectedDealId: id });
  },

  detectDealFromFile: async (path: string) => {
    try {
      const detected = await window.electronAPI.detectDealFromPath(path);
      set({ detectedDeal: detected });
      // Auto-select if no deal currently selected
      if (detected && !get().selectedDealId) {
        set({ selectedDealId: detected.id ?? null });
      }
    } catch {
      // Silently fail - detection is optional
    }
  },

  setActivityModalOpen: (open: boolean) => {
    set({ isActivityModalOpen: open });
  },

  setEditingActivity: (activity: DealActivity | null) => {
    set({ editingActivity: activity });
  },

  setDealModalOpen: (open: boolean) => {
    set({ isDealModalOpen: open });
  },

  refreshActivities: () => {
    set((state) => ({ activitiesRefreshTrigger: state.activitiesRefreshTrigger + 1 }));
  },

  // Bottom panel actions
  setBottomPanelOpen: (open: boolean) => {
    set((state) => ({
      bottomPanelState: { ...state.bottomPanelState, isOpen: open },
    }));
    get().savePersistedState();
  },

  setBottomPanelHeight: (height: number) => {
    set((state) => ({
      bottomPanelState: { ...state.bottomPanelState, height },
    }));
    get().savePersistedState();
  },

  toggleBottomPanel: () => {
    set((state) => ({
      bottomPanelState: { ...state.bottomPanelState, isOpen: !state.bottomPanelState.isOpen },
    }));
    get().savePersistedState();
  },

  // Schematic actions
  openSchematicTab: async (toolCall: SchematicToolCall) => {
    try {
      console.log('[Store] Opening schematic tab for:', toolCall);
      
      // Process the tool call via IPC
      const response = await window.electronAPI.processSchematicToolCall(toolCall);
      
      if (response.status === 'error') {
        throw new Error(response.message || 'Failed to retrieve schematic');
      }

      // Create schematic data
      const schematicData: SchematicData = {
        componentId: response.component_id || `schematic-${Date.now()}`,
        componentName: response.component_name || toolCall.component_name,
        machineModel: response.machine_model || toolCall.machine_model,
        imagePath: response.image_path || '',
        manualContext: response.manual_context || '',
        timestamp: Date.now(),
      };

      // Check if tab already exists
      const existingTab = get().tabs.find((t) => 
        t.type === 'schematic' && 
        t.schematicData?.componentId === schematicData.componentId
      );

      if (existingTab) {
        set({ activeTabId: existingTab.id });
        return;
      }

      // Create new schematic tab
      const tabId = `schematic-${schematicData.componentId}`;
      const newTab: Tab = {
        id: tabId,
        name: `🔧 ${schematicData.componentName}`,
        path: schematicData.imagePath,
        type: 'schematic',
        schematicData,
      };

      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }));

      get().showToast('success', `Opened schematic for ${schematicData.componentName}`);
      get().savePersistedState();
    } catch (error) {
      console.error('[Store] Error opening schematic tab:', error);
      get().showToast('error', `Failed to open schematic: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  // OneDrive actions
  checkOneDriveStatus: async () => {
    try {
      const status = await window.electronAPI.getOneDriveAuthStatus();
      set({ oneDriveStatus: status });
    } catch (error) {
      console.error('[Store] Failed to check OneDrive status:', error);
    }
  },

  loginOneDrive: async () => {
    try {
      get().showToast('info', 'Opening Microsoft login...');
      const result = await window.electronAPI.startOneDriveAuth();
      if (result.success) {
        const status = await window.electronAPI.getOneDriveAuthStatus();
        set({ oneDriveStatus: status });
        get().showToast('success', `Connected to OneDrive as ${status.userName || status.userEmail}`);
      } else {
        get().showToast('error', result.error || 'OneDrive login failed');
      }
    } catch (error) {
      console.error('[Store] OneDrive login error:', error);
      get().showToast('error', 'Failed to connect to OneDrive');
    }
  },

  logoutOneDrive: async () => {
    try {
      await window.electronAPI.logoutOneDrive();
      set({ oneDriveStatus: { isAuthenticated: false } });
      get().showToast('info', 'Disconnected from OneDrive');
    } catch (error) {
      console.error('[Store] OneDrive logout error:', error);
    }
  },

  openOneDriveWorkspace: async (folderId: string, folderName: string, folderPath: string) => {
    try {
      set({ 
        workspacePath: folderPath || folderName,
        workspaceSource: 'onedrive',
        oneDriveFolderId: folderId,
        tree: [],
        tabs: [],
        activeTabId: null,
        fileContents: new Map(),
        isOneDrivePickerOpen: false,
      });
      
      const children = await get().loadOneDriveDirectory(folderId);
      set({
        tree: [{
          id: folderId,
          name: folderName || 'OneDrive',
          path: folderPath || folderName,
          isDirectory: true,
          isExpanded: true,
          children,
          source: 'onedrive',
          oneDriveId: folderId,
        }],
      });
      
      get().savePersistedState();
      get().showToast('success', `Opened OneDrive folder: ${folderName}`);
    } catch (error) {
      console.error('[Store] Failed to open OneDrive workspace:', error);
      get().showToast('error', 'Failed to open OneDrive folder');
    }
  },

  loadOneDriveDirectory: async (folderId?: string): Promise<TreeNode[]> => {
    try {
      const items = await window.electronAPI.listOneDriveFolder(folderId);
      return items.map((item) => ({
        id: item.id,
        name: item.name,
        path: item.path,
        isDirectory: item.isDirectory,
        extension: item.isDirectory ? undefined : item.name.split('.').pop(),
        isExpanded: false,
        source: 'onedrive' as const,
        oneDriveId: item.id,
      }));
    } catch (error) {
      console.error('[Store] Failed to load OneDrive directory:', error);
      get().showToast('error', 'Failed to load OneDrive folder contents');
      return [];
    }
  },

  toggleOneDriveDirectory: async (node: TreeNode) => {
    if (!node.isDirectory || node.source !== 'onedrive') return;

    const updateNode = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map((n) => {
        if (n.id === node.id) {
          return { ...n, isExpanded: !n.isExpanded };
        }
        if (n.children) {
          return { ...n, children: updateNode(n.children) };
        }
        return n;
      });
    };

    // If expanding and no children loaded yet
    if (!node.isExpanded && (!node.children || node.children.length === 0)) {
      try {
        const children = await get().loadOneDriveDirectory(node.oneDriveId);
        const updateWithChildren = (nodes: TreeNode[]): TreeNode[] => {
          return nodes.map((n) => {
            if (n.id === node.id) {
              return { ...n, isExpanded: true, children };
            }
            if (n.children) {
              return { ...n, children: updateWithChildren(n.children) };
            }
            return n;
          });
        };
        set({ tree: updateWithChildren(get().tree) });
      } catch (error) {
        get().showToast('error', 'Failed to load folder contents');
      }
    } else {
      set({ tree: updateNode(get().tree) });
    }
  },

  openOneDriveFile: async (node: TreeNode, initialPage?: number) => {
    console.log('[Store] openOneDriveFile called with:', node, 'initialPage:', initialPage);
    
    if (node.isDirectory || node.source !== 'onedrive' || !node.oneDriveId) {
      console.log('[Store] openOneDriveFile early return - isDirectory:', node.isDirectory, 'source:', node.source, 'oneDriveId:', node.oneDriveId);
      return;
    }

    try {
      // Check if tab already exists
      const existingTab = get().tabs.find((t) => t.id === node.id);
      if (existingTab) {
        console.log('[Store] Tab already exists, activating:', existingTab.id);
        // Update initialPage if navigating from citation
        if (initialPage) {
          const updatedTabs = get().tabs.map(t => 
            t.id === existingTab.id ? { ...t, initialPage } : t
          );
          set({ activeTabId: existingTab.id, tabs: updatedTabs });
        } else {
          set({ activeTabId: existingTab.id });
        }
        return;
      }

      // Determine file type
      const ext = node.extension?.toLowerCase() || '';
      let type: 'text' | 'markdown' | 'pdf' | 'word' | 'unknown' = 'unknown';
      if (['.md', '.markdown'].includes(`.${ext}`)) type = 'markdown';
      else if (['.txt', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.yml', '.yaml'].includes(`.${ext}`)) type = 'text';
      else if (ext === 'pdf') type = 'pdf';
      else if (['doc', 'docx'].includes(ext)) type = 'word';
      
      console.log('[Store] Opening OneDrive file, type:', type, 'ext:', ext);

      // Read file content from OneDrive
      const { content, mimeType } = await window.electronAPI.readOneDriveFile(node.oneDriveId);
      console.log('[Store] Read file content, mimeType:', mimeType, 'length:', content.length);
      
      // Store content
      const fileContents = new Map(get().fileContents);
      fileContents.set(node.id, content);

      // Create tab
      const newTab: Tab = {
        id: node.id,
        name: node.name,
        path: node.path,
        type,
        source: 'onedrive',
        oneDriveId: node.oneDriveId,
        initialPage,
      };

      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        fileContents,
      }));

      get().savePersistedState();
    } catch (error) {
      console.error('[Store] Failed to open OneDrive file:', error);
      get().showToast('error', 'Failed to open file from OneDrive');
    }
  },

  setOneDrivePickerOpen: (open: boolean) => {
    set({ isOneDrivePickerOpen: open });
  },
}));

// Initialize on store creation
console.log('[Store] Initializing store...');
console.log('[Store] window.electronAPI:', typeof window.electronAPI);

try {
  useAppStore.getState().checkApiKey();
  useAppStore.getState().checkRagStatus();
  useAppStore.getState().checkOneDriveStatus();
  useAppStore.getState().loadPersistedState();

  // Initialize database and load deals
  if (window.electronAPI) {
    window.electronAPI.initDatabase().then(() => {
      useAppStore.getState().loadDeals();
    }).catch(err => {
      console.error('[Store] initDatabase error:', err);
    });

    // Listen for chat tool executions to refresh data
    window.electronAPI.onChatToolExecuted((data) => {
      console.log('Chat tool executed:', data.action);
      
      if (data.action === 'deal_activity_created' || data.action === 'deal_stage_updated') {
        useAppStore.getState().refreshActivities();
      }
      
      if (data.action === 'deal_created' || data.action === 'deal_updated') {
        useAppStore.getState().loadDeals();
      }
    });
  } else {
    console.error('[Store] window.electronAPI is not defined!');
  }
} catch (err) {
  console.error('[Store] Initialization error:', err);
}

console.log('[Store] Store initialization complete');
