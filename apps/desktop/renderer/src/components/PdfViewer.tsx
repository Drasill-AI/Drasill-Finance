import styles from './PdfViewer.module.css';

interface PdfViewerProps {
  fileName: string;
  path: string;
}

export function PdfViewer({ fileName, path }: PdfViewerProps) {
  return (
    <div className={styles.container}>
      <div className={styles.placeholder}>
        <span className={styles.icon}>📕</span>
        <h2>PDF Preview Coming Soon</h2>
        <p className={styles.fileName}>{fileName}</p>
        <p className={styles.path}>{path}</p>
        <div className={styles.info}>
          <p>PDF rendering will be implemented in a future update.</p>
          <p>For now, you can open this file with your system's default PDF viewer.</p>
        </div>
      </div>
    </div>
  );
}
