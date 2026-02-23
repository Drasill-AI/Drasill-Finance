import { useState } from 'react';
import { Button, Callout, Card, FormGroup, InputGroup, H2 } from '@blueprintjs/core';
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
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const result = await window.electronAPI.authResetPassword(email);
      if (result.success) {
        setResetSent(true);
      } else {
        setError(result.error || 'Failed to send reset email');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = () => {
    window.open('https://drasillai.com', '_blank');
  };

  const handleBackToSignIn = () => {
    setShowForgotPassword(false);
    setResetSent(false);
    setError(null);
  };

  // Forgot Password View
  if (showForgotPassword) {
    return (
      <div className={`bp5-dark ${styles.container}`}>
        <Card className={styles.card} elevation={3}>
          <div className={styles.logo}>
            <img src={logo} alt="Drasill Finance" className={styles.logoImage} />
            <p className="bp5-text-muted">AI-Powered Deal Intelligence</p>
          </div>

          {resetSent ? (
            <div className={styles.form}>
              <H2 className={styles.heading}>Check Your Email</H2>
              <Callout intent="success" icon="tick-circle" className={styles.callout}>
                <p>We've sent a password reset link to <strong>{email}</strong></p>
                <p className="bp5-text-muted">Check your inbox and follow the instructions to reset your password.</p>
              </Callout>
              <Button
                intent="primary"
                fill
                large
                text="Back to Sign In"
                onClick={handleBackToSignIn}
              />
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className={styles.form}>
              <H2 className={styles.heading}>Reset Password</H2>
              <p className={`bp5-text-muted ${styles.formSubtext}`}>
                Enter your email and we'll send you a link to reset your password.
              </p>

              <FormGroup label="Email" labelFor="reset-email">
                <InputGroup
                  id="reset-email"
                  type="email"
                  leftIcon="envelope"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  large
                  fill
                  required
                />
              </FormGroup>

              {error && (
                <Callout intent="danger" icon="error" className={styles.callout}>
                  {error}
                </Callout>
              )}

              <Button
                type="submit"
                intent="primary"
                fill
                large
                loading={loading}
                text={loading ? 'Sending…' : 'Send Reset Link'}
              />

              <Button
                minimal
                fill
                icon="arrow-left"
                text="Back to Sign In"
                onClick={handleBackToSignIn}
                className={styles.backLink}
              />
            </form>
          )}
        </Card>
      </div>
    );
  }

  // Sign In View
  return (
    <div className={`bp5-dark ${styles.container}`}>
      <Card className={styles.card} elevation={3}>
        <div className={styles.logo}>
          <img src={logo} alt="Drasill Finance" className={styles.logoImage} />
          <p className="bp5-text-muted">AI-Powered Deal Intelligence</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <H2 className={styles.heading}>Welcome Back</H2>

          <FormGroup label="Email" labelFor="email">
            <InputGroup
              id="email"
              type="email"
              leftIcon="envelope"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              large
              fill
              required
            />
          </FormGroup>

          <FormGroup label="Password" labelFor="password">
            <InputGroup
              id="password"
              type="password"
              leftIcon="lock"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              large
              fill
              required
            />
          </FormGroup>

          <Button
            minimal
            small
            intent="primary"
            text="Forgot password?"
            onClick={() => setShowForgotPassword(true)}
            className={styles.forgotPassword}
          />

          {error && (
            <Callout intent="danger" icon="error" className={styles.callout}>
              {error}
            </Callout>
          )}

          <Button
            type="submit"
            intent="primary"
            fill
            large
            loading={loading}
            text={loading ? 'Signing in…' : 'Sign In'}
          />
        </form>

        <div className={styles.toggle}>
          <p className="bp5-text-muted">
            Don't have an account?{' '}
            <Button
              minimal
              small
              intent="primary"
              text="Sign up at drasillai.com"
              onClick={handleCreateAccount}
            />
          </p>
        </div>
      </Card>
    </div>
  );
}
