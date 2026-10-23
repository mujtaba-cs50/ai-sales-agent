import React, { useState } from 'react';
import { register, UserSession } from '../services/crmStorage';

interface SignupViewProps {
  onSuccess: (user: UserSession) => void;
  onNavigateToLogin: () => void;
}

export const SignupView: React.FC<SignupViewProps> = ({ onSuccess, onNavigateToLogin }) => {
  const [business, setBusiness] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    const res = await register(business, email, password);
    setLoading(false);
    if (res.success && res.user) {
      setPassword('');
      onSuccess(res.user);
    } else {
      setError(res.error || 'Could not create the account. Please try again.');
    }
  };

  return (
    <main className="auth-page">
      <div className="container auth-grid">
        <section className="form-card">
          <h1>Create account</h1>
          <p>Set up the business owner profile.</p>
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
          <form data-signup-form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="business">Business name</label>
              <input
                className="input"
                id="business"
                type="text"
                placeholder="Bright Solar Solutions"
                value={business}
                onChange={(e) => setBusiness(e.target.value)}
                required
              />
            </div>
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
                autoComplete="new-password"
                minLength={8}
                required
              />
              <small style={{ color: '#5b6b71', fontSize: '0.78rem' }}>
                At least 8 characters, with a letter and a number.
              </small>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Creating account…' : 'Create Account'}
              </button>
              <a
                className="btn btn-soft"
                href="login.html"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateToLogin();
                }}
              >
                Already Have an Account
              </a>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
};
