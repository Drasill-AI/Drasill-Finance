import { useAppStore } from '../store';
import styles from './Toast.module.css';

export function Toast() {
  const { toasts, dismissToast } = useAppStore();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${styles[toast.type]}`}
        >
          <span className={styles.icon}>
            {toast.type === 'error' && '❌'}
            {toast.type === 'success' && '✅'}
            {toast.type === 'info' && 'ℹ️'}
          </span>
          <span className={styles.message}>{toast.message}</span>
          <button
            className={styles.close}
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
