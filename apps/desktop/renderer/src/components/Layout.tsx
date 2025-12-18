import { useState, useCallback, useRef } from 'react';
import { FileExplorer } from './FileExplorer';
import { TabBar } from './TabBar';
import { EditorPane } from './EditorPane';
import { RightPanel } from './RightPanel';
import styles from './Layout.module.css';

export function Layout() {
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const layoutRef = useRef<HTMLDivElement>(null);

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

      {/* Center - Editor Area */}
      <main className={styles.main}>
        <TabBar />
        <div className={styles.editorContainer}>
          <EditorPane />
        </div>
      </main>

      {/* Right Resize Handle */}
      <div 
        className={styles.resizeHandle} 
        onMouseDown={handleRightDragStart}
      />

      {/* Right Panel - Assistant Chat */}
      <aside className={styles.rightPanel} style={{ width: rightPanelWidth }}>
        <RightPanel />
      </aside>
    </div>
  );
}
