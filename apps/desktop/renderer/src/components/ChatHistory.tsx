import React, { useEffect } from 'react';
import { useAppStore } from '../store';
import styles from './ChatHistory.module.css';

interface ChatHistoryProps {
  onClose: () => void;
}

/**
 * Format date for display - groups by Today, Yesterday, This Week, etc.
 */
function formatDateGroup(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'This Week';
  if (diffDays < 30) return 'This Month';
  return 'Older';
}

/**
 * Format time for display
 */
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
}

export const ChatHistory: React.FC<ChatHistoryProps> = ({ onClose }) => {
  const { 
    chatSessions, 
    loadChatSessions, 
    loadSession, 
    deleteSession,
    currentSessionId,
  } = useAppStore();

  useEffect(() => {
    loadChatSessions();
  }, [loadChatSessions]);

  // Group sessions by date
  const groupedSessions = chatSessions.reduce((groups, session) => {
    const group = formatDateGroup(session.updatedAt);
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(session);
    return groups;
  }, {} as Record<string, typeof chatSessions>);

  const groupOrder = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];

  const handleSessionClick = (sessionId: string) => {
    loadSession(sessionId);
    onClose();
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirm('Delete this chat?')) {
      deleteSession(sessionId);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>💬 Chat History</h3>
        <button className={styles.closeButton} onClick={onClose}>
          ✕
        </button>
      </div>
      
      <div className={styles.content}>
        {chatSessions.length === 0 ? (
          <div className={styles.empty}>
            <p>No chat history yet</p>
            <p className={styles.hint}>Start a conversation to see it here</p>
          </div>
        ) : (
          groupOrder.map(group => {
            const sessions = groupedSessions[group];
            if (!sessions || sessions.length === 0) return null;
            
            return (
              <div key={group} className={styles.group}>
                <div className={styles.groupHeader}>{group}</div>
                {sessions.map(session => (
                  <div 
                    key={session.id}
                    className={`${styles.sessionItem} ${session.id === currentSessionId ? styles.active : ''}`}
                    onClick={() => handleSessionClick(session.id)}
                  >
                    <div className={styles.sessionMain}>
                      <div className={styles.sessionIcon}>
                        {session.dealName ? '📄' : '💬'}
                      </div>
                      <div className={styles.sessionInfo}>
                        <div className={styles.sessionTitle}>
                          {session.title || session.firstMessage || 'New Chat'}
                        </div>
                        {session.dealName && (
                          <div className={styles.sessionDeal}>
                            Deal: {session.dealName}
                          </div>
                        )}
                        {session.sources && session.sources.length > 0 && (
                          <div className={styles.sessionSources}>
                            📚 {session.sources.length} source{session.sources.length !== 1 ? 's' : ''}
                          </div>
                        )}
                        {session.firstMessage && session.title !== session.firstMessage && (
                          <div className={styles.sessionPreview}>
                            {session.firstMessage.slice(0, 60)}
                            {session.firstMessage.length > 60 ? '...' : ''}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={styles.sessionMeta}>
                      <span className={styles.sessionTime}>
                        {formatTime(session.updatedAt)}
                      </span>
                      <span className={styles.sessionCount}>
                        {session.messageCount} msg{session.messageCount !== 1 ? 's' : ''}
                      </span>
                      <button 
                        className={styles.deleteButton}
                        onClick={(e) => handleDelete(e, session.id)}
                        title="Delete chat"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
