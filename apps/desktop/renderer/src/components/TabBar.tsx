import { useAppStore } from '../store';
import styles from './TabBar.module.css';

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useAppStore();

  if (tabs.length === 0) {
    return null;
  }

  const handleClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  return (
    <div className={styles.tabBar}>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`${styles.tab} ${activeTabId === tab.id ? styles.active : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.path}
          >
            <span className={styles.icon}>{getTabIcon(tab.type)}</span>
            <span className={styles.name}>{tab.name}</span>
            <button
              className={styles.closeButton}
              onClick={(e) => handleClose(e, tab.id)}
              aria-label="Close tab"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function getTabIcon(type: string): string {
  switch (type) {
    case 'markdown':
      return '📝';
    case 'pdf':
      return '📕';
    default:
      return '📄';
  }
}
