import { useEffect, useState } from 'react';
import { SchematicData } from '@drasill/shared';
import styles from './SchematicViewer.module.css';

interface SchematicViewerProps {
  schematicData: SchematicData;
}

export function SchematicViewer({ schematicData }: SchematicViewerProps) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(100);

  useEffect(() => {
    loadImage();
  }, [schematicData.imagePath]);

  const loadImage = async () => {
    if (!schematicData.imagePath) {
      setError('No image path provided');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Get image as base64 data URL
      const dataUrl = await window.electronAPI.getSchematicImage(schematicData.imagePath);
      setImageDataUrl(dataUrl);
    } catch (err) {
      console.error('Error loading schematic image:', err);
      setError(err instanceof Error ? err.message : 'Failed to load image');
    } finally {
      setIsLoading(false);
    }
  };

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 10, 200));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 10, 50));
  };

  const handleResetZoom = () => {
    setZoomLevel(100);
  };

  const handleDownload = () => {
    if (!imageDataUrl) return;

    const link = document.createElement('a');
    link.href = imageDataUrl;
    link.download = `${schematicData.componentName.replace(/\s+/g, '_')}_schematic.png`;
    link.click();
  };

  return (
    <div className={styles.schematicViewer}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <h2 className={styles.componentName}>
            <span className={styles.icon}>🔧</span>
            {schematicData.componentName}
          </h2>
          {schematicData.machineModel && (
            <span className={styles.machineModel}>
              Model: {schematicData.machineModel}
            </span>
          )}
          <span className={styles.componentId}>
            ID: {schematicData.componentId}
          </span>
        </div>
        <div className={styles.toolbar}>
          <button 
            className={styles.toolbarButton} 
            onClick={handleZoomOut}
            title="Zoom Out"
          >
            −
          </button>
          <span className={styles.zoomLevel}>{zoomLevel}%</span>
          <button 
            className={styles.toolbarButton} 
            onClick={handleZoomIn}
            title="Zoom In"
          >
            +
          </button>
          <button 
            className={styles.toolbarButton} 
            onClick={handleResetZoom}
            title="Reset Zoom"
          >
            ⟲
          </button>
          <button 
            className={styles.toolbarButton} 
            onClick={handleDownload}
            disabled={!imageDataUrl}
            title="Download Image"
          >
            ⬇
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {/* Image Panel */}
        <div className={styles.imagePanel}>
          {isLoading && (
            <div className={styles.loading}>
              <div className={styles.spinner}></div>
              <p>Loading schematic...</p>
            </div>
          )}

          {error && (
            <div className={styles.error}>
              <span className={styles.errorIcon}>⚠️</span>
              <p>{error}</p>
              <button 
                className={styles.retryButton}
                onClick={loadImage}
              >
                Retry
              </button>
            </div>
          )}

          {imageDataUrl && !isLoading && !error && (
            <div className={styles.imageContainer}>
              <img
                src={imageDataUrl}
                alt={schematicData.componentName}
                className={styles.schematicImage}
                style={{ 
                  transform: `scale(${zoomLevel / 100})`,
                  transformOrigin: 'top left'
                }}
              />
            </div>
          )}
        </div>

        {/* Context Panel */}
        <div className={styles.contextPanel}>
          <h3 className={styles.contextTitle}>
            📋 Service Instructions
          </h3>
          <div className={styles.contextContent}>
            <pre className={styles.manualText}>
              {schematicData.manualContext || 'No service instructions available.'}
            </pre>
          </div>

          <div className={styles.metadata}>
            <h4 className={styles.metadataTitle}>Metadata</h4>
            <dl className={styles.metadataList}>
              <dt>Component:</dt>
              <dd>{schematicData.componentName}</dd>
              
              {schematicData.machineModel && (
                <>
                  <dt>Machine Model:</dt>
                  <dd>{schematicData.machineModel}</dd>
                </>
              )}
              
              <dt>Component ID:</dt>
              <dd>{schematicData.componentId}</dd>
              
              <dt>Retrieved:</dt>
              <dd>{new Date(schematicData.timestamp).toLocaleString()}</dd>
              
              <dt>Image Path:</dt>
              <dd className={styles.pathText}>{schematicData.imagePath}</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
