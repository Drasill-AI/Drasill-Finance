import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { CommandPalette } from './components/CommandPalette';
import { Toast } from './components/Toast';
import { useAppStore } from './store';

function App() {
  const { 
    openWorkspace, 
    closeActiveTab, 
    toggleCommandPalette,
    isCommandPaletteOpen 
  } = useAppStore();

  useEffect(() => {
    // Listen for menu events from main process
    const unsubscribeOpenWorkspace = window.electronAPI.onMenuOpenWorkspace(() => {
      openWorkspace();
    });

    const unsubscribeCloseTab = window.electronAPI.onMenuCloseTab(() => {
      closeActiveTab();
    });

    const unsubscribeCommandPalette = window.electronAPI.onMenuCommandPalette(() => {
      toggleCommandPalette();
    });

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      
      if (isMod && e.key === 'p') {
        e.preventDefault();
        toggleCommandPalette();
      }
      
      if (isMod && e.key === 'w') {
        e.preventDefault();
        closeActiveTab();
      }

      if (e.key === 'Escape' && isCommandPaletteOpen) {
        toggleCommandPalette();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unsubscribeOpenWorkspace();
      unsubscribeCloseTab();
      unsubscribeCommandPalette();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openWorkspace, closeActiveTab, toggleCommandPalette, isCommandPaletteOpen]);

  return (
    <>
      <Layout />
      <CommandPalette />
      <Toast />
    </>
  );
}

export default App;
