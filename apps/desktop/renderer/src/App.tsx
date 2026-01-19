import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { CommandPalette } from './components/CommandPalette';
import { Toast } from './components/Toast';
import { useAppStore } from './store';
import { setupPdfExtractionListener } from './utils/pdfExtractor';

function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      console.log('App useEffect running...');
      setReady(true);
    } catch (err) {
      console.error('Error in App:', err);
      setError(String(err));
    }
  }, []);

  // Show loading state until ready
  if (error) {
    return (
      <div style={{ 
        width: '100vw', 
        height: '100vh', 
        background: '#1E1E1E', 
        color: 'red',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '16px',
        fontFamily: 'monospace'
      }}>
        Error: {error}
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={{ 
        width: '100vw', 
        height: '100vh', 
        background: '#1E1E1E', 
        color: '#4C8DFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '18px',
        fontFamily: 'monospace'
      }}>
        Loading Drasill Cloud...
      </div>
    );
  }

  return <AppContent />;
}

function AppContent() {
  const { 
    openWorkspace, 
    closeActiveTab, 
    toggleCommandPalette,
    isCommandPaletteOpen 
  } = useAppStore();

  // Setup PDF extraction listener for RAG indexing
  useEffect(() => {
    const unsubscribePdfExtractor = setupPdfExtractionListener();
    return () => {
      unsubscribePdfExtractor();
    };
  }, []);

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

  console.log('App rendering...');

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1E1E1E' }}>
      <Layout />
      <CommandPalette />
      <Toast />
    </div>
  );
}

export default App;
