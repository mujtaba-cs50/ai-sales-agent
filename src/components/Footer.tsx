import React from 'react';

interface FooterProps {
  currentTab?: string;
  onNavigate: (tab: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ currentTab = 'home', onNavigate }) => {
  if (currentTab !== 'home') {
    return (
      <footer className="site-footer">
        <div className="container footer-bottom">
          <span>&copy; 2026 AI Sales Agent.</span>
        </div>
      </footer>
    );
  }

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <div className="footer-brand">
            <span className="brand-mark">
              <img src="assets/logo-icon.png" alt="AI Sales Agent logo" />
            </span>
            <strong>AI Sales Agent</strong>
          </div>
        </div>
        <div>
          <h3>Pages</h3>
          <div className="footer-links">
            <a
              href="assistant.html"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('assistant');
              }}
            >
              Voice Assistant
            </a>
            <a
              href="products.html"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('products');
              }}
            >
              Products
            </a>
            <a
              href="dashboard.html"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('dashboard');
              }}
            >
              Dashboard
            </a>
          </div>
        </div>
        <div>
          <h3>Account</h3>
          <div className="footer-links">
            <a
              href="login.html"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('login');
              }}
            >
              Login
            </a>
            <a
              href="signup.html"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('signup');
              }}
            >
              Sign Up
            </a>
          </div>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>&copy; 2026 AI Sales Agent.</span>
      </div>
    </footer>
  );
};
