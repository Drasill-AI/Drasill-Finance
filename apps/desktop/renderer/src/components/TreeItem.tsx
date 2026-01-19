import { useState, useRef, useEffect } from 'react';
import { TreeNode } from '@drasill/shared';
import { useAppStore } from '../store';
import styles from './TreeItem.module.css';

interface TreeItemProps {
  node: TreeNode;
  depth: number;
}

export function TreeItem({ node, depth }: TreeItemProps) {
  const { 
    toggleDirectory, 
    openFile, 
    activeTabId, 
    deleteFile, 
    deleteFolder, 
    workspacePath,
    toggleOneDriveDirectory,
    openOneDriveFile,
  } = useAppStore();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu]);

  const handleClick = () => {
    // Handle OneDrive items
    if (node.source === 'onedrive') {
      if (node.isDirectory) {
        toggleOneDriveDirectory(node);
      } else {
        openOneDriveFile(node);
      }
      return;
    }
    
    // Handle local items
    if (node.isDirectory) {
      toggleDirectory(node);
    } else {
      openFile(node.path, node.name);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Don't allow deleting the root workspace folder or OneDrive files (read-only for now)
    if (node.path === workspacePath || node.source === 'onedrive') return;
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleDelete = async () => {
    setContextMenu(null);
    if (node.isDirectory) {
      await deleteFolder(node.path);
    } else {
      await deleteFile(node.path);
    }
  };

  const isActive = activeTabId === node.id || activeTabId === node.path;
  const paddingLeft = 8 + depth * 16;
  const isRootWorkspace = node.path === workspacePath || node.id === node.path;

  return (
    <>
      <div
        className={`${styles.item} ${isActive ? styles.active : ''}`}
        style={{ paddingLeft }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        role="treeitem"
        aria-expanded={node.isDirectory ? node.isExpanded : undefined}
      >
        {node.isDirectory ? (
          <span className={`${styles.chevron} ${node.isExpanded ? styles.expanded : ''}`}>
            ▶
          </span>
        ) : (
          <span className={styles.spacer} />
        )}
        
        <span className={styles.icon}>
          {node.isDirectory ? (node.isExpanded ? '📂' : '📁') : getFileIcon(node.extension)}
        </span>
        
        <span className={styles.name}>{node.name}</span>
      </div>

      {contextMenu && !isRootWorkspace && node.source !== 'onedrive' && (
        <div 
          ref={menuRef}
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className={styles.contextMenuItem} onClick={handleDelete}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Delete {node.isDirectory ? 'Folder' : 'File'}
          </button>
        </div>
      )}

      {node.isDirectory && node.isExpanded && node.children && (
        <div className={styles.children}>
          {node.children.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </>
  );
}

function getFileIcon(extension?: string): string {
  if (!extension) return '📄';
  
  const ext = extension.toLowerCase();
  
  const icons: Record<string, string> = {
    '.ts': '🔷',
    '.tsx': '⚛️',
    '.js': '🟨',
    '.jsx': '⚛️',
    '.json': '📋',
    '.md': '📝',
    '.markdown': '📝',
    '.html': '🌐',
    '.css': '🎨',
    '.scss': '🎨',
    '.py': '🐍',
    '.pdf': '📕',
    '.txt': '📄',
    '.yaml': '⚙️',
    '.yml': '⚙️',
    '.xml': '📰',
    '.sql': '🗃️',
  };
  
  return icons[ext] || '📄';
}
