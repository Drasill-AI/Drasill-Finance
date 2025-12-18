import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store';
import styles from './CommandPalette.module.css';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

export function CommandPalette() {
  const { 
    isCommandPaletteOpen, 
    toggleCommandPalette,
    openWorkspace,
    closeActiveTab,
    tabs,
    setActiveTab,
  } = useAppStore();

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = [
    {
      id: 'open-folder',
      label: 'Open Folder...',
      shortcut: 'Ctrl+Shift+O',
      action: () => {
        toggleCommandPalette();
        openWorkspace();
      },
    },
    {
      id: 'close-tab',
      label: 'Close Current Tab',
      shortcut: 'Ctrl+W',
      action: () => {
        toggleCommandPalette();
        closeActiveTab();
      },
    },
    ...tabs.map((tab) => ({
      id: `goto-${tab.id}`,
      label: `Go to: ${tab.name}`,
      action: () => {
        toggleCommandPalette();
        setActiveTab(tab.id);
      },
    })),
  ];

  const filteredCommands = query
    ? commands.filter((cmd) =>
        cmd.label.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isCommandPaletteOpen]);

  if (!isCommandPaletteOpen) {
    return null;
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      toggleCommandPalette();
    } else if (e.key === 'Enter' && filteredCommands.length > 0) {
      filteredCommands[0].action();
    }
  };

  return (
    <div className={styles.overlay} onClick={toggleCommandPalette}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder="Type a command..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        
        <div className={styles.list}>
          {filteredCommands.length === 0 ? (
            <div className={styles.empty}>No commands found</div>
          ) : (
            filteredCommands.map((cmd) => (
              <button
                key={cmd.id}
                className={styles.item}
                onClick={cmd.action}
              >
                <span className={styles.label}>{cmd.label}</span>
                {cmd.shortcut && (
                  <span className={styles.shortcut}>{cmd.shortcut}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
