import { useState, useCallback, useRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useAppStore } from '../store';
import { PdfViewer } from './PdfViewer';
import { WordViewer } from './WordViewer';
import { SchematicViewer } from './SchematicViewer';
import { extractPdfText } from '../utils/pdfExtractor';
import styles from './EditorPane.module.css';
import logoImage from '../assets/logo.png';

interface EditorPaneProps {
  paneId?: 'primary' | 'secondary';
}

export function EditorPane({ paneId = 'primary' }: EditorPaneProps) {
  const { 
    tabs, 
    activeTabId, 
    secondaryTabs,
    secondaryActiveTabId,
    fileContents, 
    loadingFiles,
    saveTabViewState,
    getTabViewState,
    setActivePaneId,
    sendMessage,
    deals,
  } = useAppStore();

  // Use appropriate tabs based on paneId
  const paneTabs = paneId === 'secondary' ? secondaryTabs : tabs;
  const paneActiveTabId = paneId === 'secondary' ? secondaryActiveTabId : activeTabId;

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const previousTabId = useRef<string | null>(null);

  const activeTab = paneTabs.find((t) => t.id === paneActiveTabId);
  // For secondary pane, look up content by the actual file path (without the 'secondary-' prefix)
  const contentKey = paneId === 'secondary' && paneActiveTabId 
    ? paneActiveTabId.replace('secondary-', '') 
    : paneActiveTabId;
  const content = contentKey ? fileContents.get(contentKey) : undefined;
  const isLoading = contentKey ? loadingFiles.has(contentKey) : false;

  // 1) isImported = true → already in DB, show "Analyze"
  // 2) detectedDeal set but not imported → show "Import & Analyze" (all PDFs in folder)
  const [bankStatementDealId, setBankStatementDealId] = useState<string | null>(null);
  const [isImported, setIsImported] = useState(false);
  const [detectedDealName, setDetectedDealName] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [siblingPdfs, setSiblingPdfs] = useState<Array<{ path: string; name: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    setBankStatementDealId(null);
    setIsImported(false);
    setDetectedDealName(null);
    setSiblingPdfs([]);

    if (activeTab?.type === 'pdf' && activeTab.path) {
      // First check: is this file already imported?
      window.electronAPI.checkIsBankStatement(activeTab.path).then(async (dealId) => {
        if (cancelled) return;
        if (dealId) {
          // Already imported — show Analyze button
          setBankStatementDealId(dealId);
          setIsImported(true);
          const deal = deals.find((d) => d.id === dealId);
          setDetectedDealName(deal?.borrowerName || null);
        } else {
          // Not imported — try to detect deal from folder structure
          try {
            const detected = await window.electronAPI.detectDealFromPath(activeTab.path!);
            if (!cancelled && detected) {
              setBankStatementDealId(detected.id!);
              setIsImported(false);
              setDetectedDealName(detected.borrowerName);

              // Find all sibling PDFs in same folder for batch import
              const folderPath = activeTab.path!.replace(/[\\/][^\\/]+$/, '');
              const entries = await window.electronAPI.readDir(folderPath);
              const pdfs = entries
                .filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.pdf'))
                .map((e) => ({ path: `${folderPath}${folderPath.includes('/') ? '/' : '\\'}${e.name}`, name: e.name }));
              if (!cancelled) setSiblingPdfs(pdfs);
            }
          } catch { /* ignore */ }
        }
      }).catch(() => { /* ignore */ });
    }

    return () => { cancelled = true; };
  }, [activeTab?.id, activeTab?.type, activeTab?.path, deals]);

  const handleAnalyzeBankStatements = useCallback(() => {
    if (!bankStatementDealId) return;
    const name = detectedDealName || 'this deal';
    sendMessage(`I'd like to analyze the bank statements for ${name}. Please show me what data is available and walk me through the setup.`);
  }, [bankStatementDealId, detectedDealName, sendMessage]);

  const handleImportAndAnalyze = useCallback(async () => {
    if (!bankStatementDealId || isImporting) return;
    const pdfsToImport = siblingPdfs.length > 0 ? siblingPdfs : (activeTab?.path ? [{ path: activeTab.path, name: activeTab.name }] : []);
    if (pdfsToImport.length === 0) return;

    setIsImporting(true);
    try {
      // Extract text from all PDFs
      setImportProgress(`Extracting text from ${pdfsToImport.length} PDF(s)…`);
      const filesWithText: Array<{ filePath: string; fileName: string; extractedText: string }> = [];

      for (let i = 0; i < pdfsToImport.length; i++) {
        setImportProgress(`Extracting text (${i + 1}/${pdfsToImport.length}): ${pdfsToImport[i].name}`);
        try {
          const binary = await window.electronAPI.readFileBinary(pdfsToImport[i].path);
          const text = await extractPdfText(binary.data);
          filesWithText.push({ filePath: pdfsToImport[i].path, fileName: pdfsToImport[i].name, extractedText: text });
        } catch (err) {
          console.warn(`[EditorPane] Skipping ${pdfsToImport[i].name}: ${err}`);
        }
      }

      if (filesWithText.length === 0) {
        throw new Error('Could not extract text from any PDFs');
      }

      // Batch parse + import
      setImportProgress(`Parsing & importing ${filesWithText.length} statement(s)…`);
      const result = await window.electronAPI.bankBatchParseAndImport(bankStatementDealId, filesWithText);

      setImportProgress(`Done: ${result.totalImported} imported, ${result.totalFailed} failed`);

      // Switch to Analyze mode
      setIsImported(true);
      const name = detectedDealName || 'this deal';
      sendMessage(`I just imported ${result.totalImported} bank statement(s) for ${name}. Please show me what data is available and walk me through setting up the analysis.`);
    } catch (err) {
      console.error('[EditorPane] Import & Analyze failed:', err);
      setImportProgress('Import failed — check console for details');
    } finally {
      setIsImporting(false);
    }
  }, [bankStatementDealId, siblingPdfs, activeTab?.path, activeTab?.name, isImporting, detectedDealName, sendMessage]);

  // Save view state when switching tabs
  useEffect(() => {
    if (previousTabId.current && previousTabId.current !== paneActiveTabId && editorRef.current) {
      const viewState = editorRef.current.saveViewState();
      if (viewState) {
        saveTabViewState(previousTabId.current, viewState);
      }
    }
    previousTabId.current = paneActiveTabId;
  }, [paneActiveTabId, saveTabViewState]);

  // Restore view state when tab changes
  useEffect(() => {
    if (editorRef.current && paneActiveTabId) {
      const viewState = getTabViewState(paneActiveTabId) as editor.ICodeEditorViewState | undefined;
      if (viewState) {
        editorRef.current.restoreViewState(viewState);
      }
    }
  }, [paneActiveTabId, getTabViewState, content]);

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    
    // Restore view state if available
    if (paneActiveTabId) {
      const viewState = getTabViewState(paneActiveTabId) as editor.ICodeEditorViewState | undefined;
      if (viewState) {
        editor.restoreViewState(viewState);
      }
    }
  }, [paneActiveTabId, getTabViewState]);

  // Handle click to set active pane
  const handlePaneClick = () => {
    setActivePaneId(paneId);
  };

  // Empty state
  if (!activeTab) {
    return (
      <div className={styles.empty} onClick={handlePaneClick}>
        <div className={styles.emptyContent}>
          {paneId === 'primary' ? (
            <>
              <img src={logoImage} alt="Drasill" className={styles.logo} />
              <h2>Drasill Finance</h2>
              <p>Deal Management & Documentation</p>
              <div className={styles.shortcuts}>
                <p><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> Open Folder</p>
                <p><kbd>Ctrl</kbd>+<kbd>P</kbd> Command Palette</p>
                <p><kbd>Ctrl</kbd>+<kbd>W</kbd> Close Tab</p>
              </div>
            </>
          ) : (
            <>
              <p className={styles.secondaryEmptyText}>Right-click a source citation to open here</p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={styles.loading} onClick={handlePaneClick}>
        <div className={styles.spinner} />
        <p>Loading file...</p>
      </div>
    );
  }

  // PDF viewer
  if (activeTab.type === 'pdf') {
    return (
      <div onClick={handlePaneClick} style={{ height: '100%' }}>
        <PdfViewer 
          fileName={activeTab.name} 
          path={activeTab.path} 
          source={activeTab.source}
          oneDriveId={activeTab.oneDriveId}
          initialPage={activeTab.initialPage}
          onAnalyzeBankStatements={isImported && bankStatementDealId ? handleAnalyzeBankStatements : undefined}
          onImportAndAnalyze={!isImported && bankStatementDealId ? handleImportAndAnalyze : undefined}
          isImporting={isImporting}
          importProgress={importProgress}
          pdfCount={siblingPdfs.length}
        />
      </div>
    );
  }

  // Word viewer
  if (activeTab.type === 'word') {
    return (
      <div onClick={handlePaneClick} style={{ height: '100%' }}>
        <WordViewer 
          fileName={activeTab.name} 
          path={activeTab.path}
          source={activeTab.source}
          oneDriveId={activeTab.oneDriveId}
        />
      </div>
    );
  }

  // Schematic viewer
  if (activeTab.type === 'schematic' && activeTab.schematicData) {
    return (
      <div onClick={handlePaneClick} style={{ height: '100%' }}>
        <SchematicViewer schematicData={activeTab.schematicData} />
      </div>
    );
  }

  // Monaco editor for text/markdown
  return (
    <div className={styles.editorWrapper} onClick={handlePaneClick}>
      <Editor
        key={paneActiveTabId} // Force remount on tab change for clean state
        height="100%"
        defaultLanguage={getLanguage(activeTab.name)}
        value={content || ''}
        theme="vs-dark"
        onMount={handleEditorMount}
        options={{
          readOnly: true,
          minimap: { enabled: paneId === 'primary' },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: activeTab.type === 'markdown' ? 'on' : 'off',
          automaticLayout: true,
          padding: { top: 16, bottom: 16 },
        }}
      />
    </div>
  );
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    py: 'python',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    rs: 'rust',
    go: 'go',
    sql: 'sql',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'shell',
    bash: 'shell',
    ps1: 'powershell',
    txt: 'plaintext',
  };
  
  return languageMap[ext || ''] || 'plaintext';
}
