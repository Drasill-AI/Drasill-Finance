import { TreeNode } from '@drasill/shared';
import { useAppStore } from '../store';
import styles from './TreeItem.module.css';

interface TreeItemProps {
  node: TreeNode;
  depth: number;
}

export function TreeItem({ node, depth }: TreeItemProps) {
  const { toggleDirectory, openFile, activeTabId } = useAppStore();

  const handleClick = () => {
    if (node.isDirectory) {
      toggleDirectory(node);
    } else {
      openFile(node.path, node.name);
    }
  };

  const isActive = activeTabId === node.path;
  const paddingLeft = 8 + depth * 16;

  return (
    <>
      <div
        className={`${styles.item} ${isActive ? styles.active : ''}`}
        style={{ paddingLeft }}
        onClick={handleClick}
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
