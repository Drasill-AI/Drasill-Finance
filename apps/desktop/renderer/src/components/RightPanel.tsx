import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../store';
import { FileContext } from '@drasill/shared';
import styles from './RightPanel.module.css';
import lonnieIcon from '../assets/lonnie.png';

export function RightPanel() {
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const {
    chatMessages,
    isChatLoading,
    chatError,
    hasApiKey,
    sendMessage,
    clearChat,
    cancelChat,
    setApiKey,
    activeTabId,
    tabs,
    fileContents,
    workspacePath,
    isIndexing,
    indexingProgress,
    ragChunksCount,
    indexWorkspace,
    clearRagIndex,
  } = useAppStore();

  // Get current file context
  const activeTab = tabs.find(t => t.id === activeTabId);
  const fileContent = activeTab ? fileContents.get(activeTab.path) : undefined;
  const fileContext: FileContext | undefined = activeTab && fileContent ? {
    filePath: activeTab.path,
    fileName: activeTab.name,
    fileType: activeTab.type,
    content: fileContent.slice(0, 8000), // Limit context size
  } : undefined;

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isChatLoading) return;
    sendMessage(input.trim(), fileContext);
    setInput('');
  }, [input, isChatLoading, sendMessage, fileContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      setApiKey(apiKeyInput.trim());
      setApiKeyInput('');
      setShowSettings(false);
    }
  };

  // Settings modal
  if (showSettings) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>API SETTINGS</span>
          <button 
            className={styles.closeButton}
            onClick={() => setShowSettings(false)}
          >
            ✕
          </button>
        </div>
        <div className={styles.settingsContent}>
          <div className={styles.settingsForm}>
            <label className={styles.label}>OpenAI API Key</label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="sk-..."
              className={styles.input}
            />
            <p className={styles.hint}>
              Your API key is encrypted and stored locally on your device.
            </p>
            <button 
              className={styles.saveButton}
              onClick={handleSaveApiKey}
              disabled={!apiKeyInput.trim()}
            >
              Save API Key
            </button>
            {hasApiKey && (
              <p className={styles.success}>✓ API key is configured</p>
            )}

            {/* RAG Settings */}
            <div className={styles.divider} />
            <label className={styles.label}>Knowledge Base</label>
            {ragChunksCount > 0 ? (
              <>
                <p className={styles.ragStatus}>
                  📚 {ragChunksCount} chunks indexed
                </p>
                <div className={styles.ragButtons}>
                  <button 
                    className={styles.reindexButton}
                    onClick={() => { indexWorkspace(); setShowSettings(false); }}
                    disabled={isIndexing || !hasApiKey}
                  >
                    Re-index
                  </button>
                  <button 
                    className={styles.clearRagButton}
                    onClick={clearRagIndex}
                    disabled={isIndexing}
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className={styles.hint}>
                  Index your workspace to enable AI-powered document search.
                </p>
                <button 
                  className={styles.indexButton}
                  onClick={() => { indexWorkspace(); setShowSettings(false); }}
                  disabled={isIndexing || !hasApiKey || !workspacePath}
                >
                  {!workspacePath ? 'Open a workspace first' : 'Index Workspace'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>TROUBLESHOOTING LONNIE</span>
        <div className={styles.headerActions}>
          {ragChunksCount > 0 && (
            <span className={styles.ragBadge} title={`${ragChunksCount} chunks indexed`}>
              📚
            </span>
          )}
          <button 
            className={styles.settingsButton}
            onClick={() => setShowSettings(true)}
            title="API Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Indexing progress */}
      {isIndexing && indexingProgress && (
        <div className={styles.indexingBar}>
          <div className={styles.indexingText}>
            Indexing: {indexingProgress.fileName} ({indexingProgress.percentage}%)
          </div>
          <div className={styles.progressBar}>
            <div 
              className={styles.progressFill} 
              style={{ width: `${indexingProgress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* File context indicator */}
      {fileContext && (
        <div className={styles.contextBar}>
          <span className={styles.contextIcon}>📄</span>
          <span className={styles.contextFile}>{fileContext.fileName}</span>
          <span className={styles.contextLabel}>Context</span>
        </div>
      )}
      
      <div className={styles.content}>
        {chatMessages.length === 0 ? (
          <div className={styles.placeholder}>
            <img src={lonnieIcon} alt="Lonnie" className={styles.lonnieIcon} />
            <h3>Troubleshooting Lonnie</h3>
            <p>Ask questions about your documents</p>
            {!hasApiKey && (
              <button 
                className={styles.configureButton}
                onClick={() => setShowSettings(true)}
              >
                Configure API Key
              </button>
            )}
            {hasApiKey && ragChunksCount === 0 && workspacePath && (
              <button 
                className={styles.indexButton}
                onClick={indexWorkspace}
                disabled={isIndexing}
              >
                {isIndexing ? 'Indexing...' : 'Index Workspace for AI'}
              </button>
            )}
            {hasApiKey && ragChunksCount > 0 && (
              <p className={styles.ragHint}>
                📚 {ragChunksCount} chunks indexed - Ready to answer questions!
              </p>
            )}
            {hasApiKey && fileContext && (
              <p className={styles.contextHint}>
                Currently viewing: {fileContext.fileName}
              </p>
            )}
          </div>
        ) : (
          <div className={styles.messages}>
            {chatMessages.map((msg) => (
              <div 
                key={msg.id} 
                className={`${styles.message} ${styles[msg.role]}`}
              >
                <div className={styles.messageHeader}>
                  {msg.role === 'user' ? '👤 You' : <><img src={lonnieIcon} alt="Lonnie" className={styles.lonnieAvatar} /> Lonnie</>}
                </div>
                <div className={styles.messageContent}>
                  {msg.content || (isChatLoading && msg.role === 'assistant' ? (
                    <span className={styles.typing}>Thinking...</span>
                  ) : null)}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {chatError && (
        <div className={styles.errorBar}>
          {chatError}
        </div>
      )}

      {chatMessages.length > 0 && (
        <div className={styles.actionBar}>
          <button 
            className={styles.clearButton}
            onClick={clearChat}
            disabled={isChatLoading}
          >
            Clear Chat
          </button>
          {isChatLoading && (
            <button 
              className={styles.cancelButton}
              onClick={cancelChat}
            >
              Stop
            </button>
          )}
        </div>
      )}
      
      <div className={styles.inputArea}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={hasApiKey ? "Ask a question..." : "Configure API key first..."}
          className={styles.input}
          disabled={!hasApiKey || isChatLoading}
          rows={1}
        />
        <button 
          className={styles.sendButton} 
          onClick={handleSend}
          disabled={!hasApiKey || !input.trim() || isChatLoading}
        >
          {isChatLoading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
