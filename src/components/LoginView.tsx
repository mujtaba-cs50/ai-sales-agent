import React, { useState } from 'react';
import { login, UserSession } from '../services/crmStorage';

interface LoginViewProps {
  notice?: string | null;
  onSuccess: (user: UserSession) => void;
  onNavigateToSignup: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  notice,
  onSuccess,
  onNavigateToSignup,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.success && res.user) {
      setPassword('');
      onSuccess(res.user);
    } else {
      setError(res.error || 'Login failed. Please try again.');
    }
  };

  return (
    <main className="auth-page">
      <div className="container auth-grid">
        <section className="form-card">
          <h1>Login</h1>
          <p>Access the business owner dashboard.</p>
          {notice && (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                background: '#fff8e8',
                border: '1px solid #f7e0a8',
                borderRadius: '12px',
                color: '#835808',
                fontSize: '0.85rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>🔒</span>
              <span>{notice}</span>
            </div>
          )}
          {error && (
            <div
              role="alert"
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                background: '#fdecec',
                border: '1px solid #f5b5b5',
                borderRadius: '12px',
                color: '#9b1c1c',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}
          <form data-login-form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                className="input"
                id="email"
                type="email"
                placeholder="owner@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                className="input"
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Signing in…' : 'Continue to Dashboard'}
              </button>
              <a
                className="btn btn-soft"
                href="signup.html"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateToSignup();
                }}
              >
                Create New Account
              </a>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
};
