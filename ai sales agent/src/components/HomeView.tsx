import React from 'react';

interface HomeViewProps {
  onNavigate: (tab: string) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  return (
    <main id="main">
      <section className="page-hero">
        <div className="container hero-grid">
          <div>
            <h1 className="h1">
              AI Powered <span className="accent">Sales Agent </span>.
            </h1>
            <p className="lead">
              Our AI Sales Agent helps customers to ask questions by voice, understand solar panel packages easily.
            </p>
            <div className="hero-actions">
              <a
                className="btn btn-primary"
                href="assistant.html"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('assistant');
                }}
              >
                Try Voice Assistant
              </a>
            </div>
            <div className="stat-strip" aria-label="Product highlights"></div>
          </div>
          <div className="home-visual" aria-label="AI voice assistant preview">
            <div className="voice-orb-card">
              <div className="card-top">
                <div className="ai-profile"></div>
                <span className="status-dot">Online</span>
              </div>
              <div
                className="orb-area"
                onClick={() => onNavigate('assistant')}
                style={{ cursor: 'pointer' }}
                title="Tap to try Voice Assistant"
              >
                <div className="orb" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M19 11a7 7 0 0 1-14 0M12 18v3M8.5 21h7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <span className="mini-panel one">10kW solar panel</span>
                <span className="mini-panel two">5kW solar panel</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
