import { useState, useCallback, useRef, useEffect } from 'react';
import { FileExplorer } from './FileExplorer';
import { TabBar } from './TabBar';
import { EditorPane } from './EditorPane';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import { BottomPanel } from './BottomPanel';
import { DealModal } from './DealModal';
import { ActivityModal } from './ActivityModal';
import { useAppStore } from '../store';
import styles from './Layout.module.css';

export function Layout() {
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const layoutRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const { 
    bottomPanelState, 
    setBottomPanelHeight, 
    toggleBottomPanel,
    activeTabId,
    tabs,
    detectDealFromFile,
    closeActiveTab,
    setActiveTab,
    toggleCommandPalette,
  } = useAppStore();

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      // Ctrl/Cmd + W - Close active tab
      if (modKey && e.key === 'w') {
        e.preventDefault();
        closeActiveTab();
        return;
      }

      // Ctrl/Cmd + J - Toggle bottom panel
      if (modKey && e.key === 'j') {
        e.preventDefault();
        toggleBottomPanel();
        return;
      }

      // Ctrl/Cmd + P - Command palette
      if (modKey && e.key === 'p') {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Ctrl/Cmd + / - Focus chat input
      if (modKey && e.key === '/') {
        e.preventDefault();
        // Find chat input by data attribute and focus it
        const chatInput = document.querySelector('[data-chat-input]') as HTMLTextAreaElement;
        if (chatInput) {
          chatInput.focus();
        }
        return;
      }

      // Ctrl/Cmd + Tab or Ctrl/Cmd + Shift + Tab - Navigate tabs
      if (modKey && e.key === 'Tab') {
        e.preventDefault();
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        if (tabs.length > 1) {
          let newIndex: number;
          if (e.shiftKey) {
            // Previous tab
            newIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
          } else {
            // Next tab
            newIndex = currentIndex >= tabs.length - 1 ? 0 : currentIndex + 1;
          }
          setActiveTab(tabs[newIndex].id);
        }
        return;
      }

      // Ctrl/Cmd + 1-9 - Switch to tab by number
      if (modKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const tabIndex = parseInt(e.key) - 1;
        if (tabIndex < tabs.length) {
          setActiveTab(tabs[tabIndex].id);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, tabs, closeActiveTab, setActiveTab, toggleBottomPanel, toggleCommandPalette]);

  // Detect deal when active tab changes
  useEffect(() => {
    if (activeTabId) {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab) {
        detectDealFromFile(activeTab.path);
      }
    }
  }, [activeTabId, tabs, detectDealFromFile]);

  const handleLeftDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(150, Math.min(500, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  const handleRightDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const newWidth = Math.max(200, Math.min(600, startWidth + delta));
      setRightPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [rightPanelWidth]);

  return (
    <div className={styles.layout} ref={layoutRef}>
      {/* Left Sidebar - File Explorer */}
      <aside className={styles.sidebar} style={{ width: sidebarWidth }}>
        <FileExplorer />
      </aside>

      {/* Left Resize Handle */}
      <div 
        className={styles.resizeHandle} 
        onMouseDown={handleLeftDragStart}
      />

      {/* Center - Main Content Area */}
      <div className={styles.centerArea}>
        {/* Top Bar - Equipment Selection */}
        <TopBar />
        
        {/* Editor Section */}
        <main className={styles.main}>
          <TabBar />
          <div className={styles.editorContainer}>
            <EditorPane />
          </div>
        </main>

        {/* Bottom Panel - Logs & Analytics */}
        <BottomPanel 
          height={bottomPanelState.height}
          onHeightChange={setBottomPanelHeight}
          isOpen={bottomPanelState.isOpen}
          onToggle={toggleBottomPanel}
        />
      </div>

      {/* Right Resize Handle */}
      <div 
        className={styles.resizeHandle} 
        onMouseDown={handleRightDragStart}
      />

      {/* Right Panel - Assistant Chat */}
      <aside className={styles.rightPanel} style={{ width: rightPanelWidth }}>
        <RightPanel />
      </aside>

      {/* Modals */}
      <DealModal />
      <ActivityModal />
    </div>
  );
}
