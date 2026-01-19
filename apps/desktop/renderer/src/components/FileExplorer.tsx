import { useState } from 'react';
import { useAppStore } from '../store';
import { TreeItem } from './TreeItem';
import { OneDrivePicker } from './OneDrivePicker';
import styles from './FileExplorer.module.css';

export function FileExplorer() {
  const { 
    workspacePath, 
    tree, 
    workspaceSource,
    openWorkspace, 
    closeWorkspace, 
    refreshTree, 
    showToast,
    oneDriveStatus,
    loginOneDrive,
    setOneDrivePickerOpen,
    isOneDrivePickerOpen,
  } = useAppStore();
  const [isAdding, setIsAdding] = useState(false);

  const handleAddFiles = async () => {
    if (!workspacePath || isAdding) return;
    
    setIsAdding(true);
    try {
      const result = await window.electronAPI.addFiles(workspacePath);
      if (result.added > 0) {
        showToast('success', `Added ${result.added} file${result.added > 1 ? 's' : ''} to workspace`);
        await refreshTree();
      } else if (result.cancelled) {
        // User cancelled, no toast needed
      } else {
        showToast('info', 'No files were added');
      }
    } catch (error) {
      showToast('error', `Failed to add files: ${error}`);
    } finally {
      setIsAdding(false);
    }
  };

  const handleOpenOneDrive = async () => {
    if (!oneDriveStatus.isAuthenticated) {
      await loginOneDrive();
      // Check status again after login
      const status = await window.electronAPI.getOneDriveAuthStatus();
      if (status.isAuthenticated) {
        setOneDrivePickerOpen(true);
      }
    } else {
      setOneDrivePickerOpen(true);
    }
  };

  const workspaceName = workspacePath?.split(/[\\/]/).pop() || 'Workspace';

  return (
    <div className={styles.explorer}>
      <div className={styles.header}>
        <span className={styles.title}>EXPLORER</span>
        {workspacePath && (
          <button 
            className={styles.closeWorkspaceButton}
            onClick={closeWorkspace}
            title="Close Workspace"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      
      {workspacePath && (
        <div className={styles.workspaceHeader}>
          <span className={styles.workspaceName}>
            {workspaceSource === 'onedrive' && (
              <span className={styles.cloudIcon} title="OneDrive">☁️ </span>
            )}
            {workspaceName}
          </span>
        </div>
      )}
      
      <div className={styles.content}>
        {!workspacePath ? (
          <div className={styles.empty}>
            <p>No folder opened</p>
            <button className={styles.openButton} onClick={openWorkspace}>
              Open Local Folder
            </button>
            <button className={styles.oneDriveButton} onClick={handleOpenOneDrive}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M12.5 3c-2.9 0-5.4 1.9-6.3 4.5C3.4 8 1.5 10.1 1.5 12.5c0 2.8 2.3 5 5 5h10c2.8 0 5-2.3 5-5 0-2.5-1.8-4.5-4.2-4.9-.8-2.7-3.3-4.6-6.3-4.6h1.5z"/>
              </svg>
              {oneDriveStatus.isAuthenticated ? 'Open from OneDrive' : 'Connect OneDrive'}
            </button>
            {oneDriveStatus.isAuthenticated && (
              <p className={styles.connectedAs}>
                Connected as {oneDriveStatus.userName || oneDriveStatus.userEmail}
              </p>
            )}
            <p className={styles.hint}>
              Or use File → Open Workspace Folder
            </p>
          </div>
        ) : (
          <div className={styles.tree}>
            {tree.map((node) => (
              <TreeItem key={node.id} node={node} depth={0} />
            ))}
          </div>
        )}
      </div>

      {workspacePath && workspaceSource === 'local' && (
        <div className={styles.footer}>
          <button 
            className={styles.addButton} 
            onClick={handleAddFiles}
            disabled={isAdding}
            title="Add PDF, Markdown, or Text files"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {isAdding ? 'Adding...' : 'Add Files'}
          </button>
        </div>
      )}

      {isOneDrivePickerOpen && <OneDrivePicker />}
    </div>
  );
}
