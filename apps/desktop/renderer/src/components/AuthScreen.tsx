import { useState } from 'react';
import styles from './AuthScreen.module.css';
import logo from '../assets/logo.png';

interface AuthScreenProps {
  onAuthSuccess: (user: any) => void;
}

export function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await window.electronAPI.authSignIn(email, password);
      if (result.success) {
        onAuthSuccess(result.user);
      } else {
        setError(result.error || 'Sign in failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = () => {
    window.open('https://drasillai.com/signup', '_blank');
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <img src={logo} alt="Drasill Finance" className={styles.logoImage} />
          <p>AI-Powered Deal Intelligence</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <h2>Welcome Back</h2>

          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.button} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className={styles.toggle}>
          <p>
            Don't have an account?{' '}
            <button onClick={handleCreateAccount}>Sign up at drasillai.com</button>
          </p>
        </div>
      </div>
    </div>
  );
}
