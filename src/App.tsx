import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { HomeView } from './components/HomeView';
import { VoiceAssistantView } from './components/VoiceAssistantView';
import { ProductsView } from './components/ProductsView';
import { DashboardView } from './components/DashboardView';
import { LoginView } from './components/LoginView';
import { SignupView } from './components/SignupView';
import { Lead } from './types';
import { logout, subscribeToLeads, saveLead, UserSession } from './services/crmStorage';
import { restoreSession, onAuthChange, onSessionExpired } from './services/authClient';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [user, setUser] = useState<UserSession | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Restore the login from the httpOnly refresh cookie and follow session changes (renewals, expiry).
  useEffect(() => {
    let alive = true;
    restoreSession().then((u) => {
      if (alive && u) setUser(u);
    });
    const offChange = onAuthChange((u) => setUser(u));
    const offExpired = onSessionExpired(() => {
      setAuthNotice('Your session has expired. Please log in again.');
      setCurrentTab((tab) => (tab === 'dashboard' ? 'login' : tab));
    });
    return () => {
      alive = false;
      offChange();
      offExpired();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToLeads((updatedLeads) => {
      setLeads(updatedLeads);
    });
    return () => unsubscribe();
  }, []);

  const handleLeadCaptured = (newLead: Lead) => {
    saveLead(newLead);
  };

  const handleAuthSuccess = (userData: UserSession) => {
    setUser(userData);
    setAuthNotice(null);
    setCurrentTab('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = () => {
    void logout();
    setUser(null);
    setAuthNotice(null);
    setCurrentTab('login');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigate = (tab: string) => {
    if (tab === 'dashboard' && !user) {
      setAuthNotice('Please log in or create an account to access the sales dashboard.');
      setCurrentTab('login');
    } else {
      if (tab === 'login') {
        setAuthNotice(null);
      }
      setCurrentTab(tab);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTalkToAgentAboutProduct = (productName?: string) => {
    if (productName) {
      setSelectedProduct(productName);
    }
    handleNavigate('assistant');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f6fbfb] text-[#15242a]">
      {/* Site Header */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={handleNavigate}
        user={user}
        onLogout={handleLogout}
      />

      {/* Main Page Content */}
      <div className="flex-1">
        {currentTab === 'home' && <HomeView onNavigate={handleNavigate} />}

        {currentTab === 'assistant' && (
          <VoiceAssistantView
            onLeadCaptured={handleLeadCaptured}
            initialProductContext={selectedProduct}
            onClearProductContext={() => setSelectedProduct(null)}
          />
        )}

        {currentTab === 'products' && (
          <ProductsView onTalkToAgent={handleTalkToAgentAboutProduct} />
        )}

        {currentTab === 'dashboard' &&
          (user ? (
            <DashboardView
              leads={leads}
              onNavigateToAssistant={() => handleNavigate('assistant')}
              onLogout={handleLogout}
            />
          ) : (
            <LoginView
              notice={authNotice || 'Please log in to access the sales dashboard.'}
              onSuccess={handleAuthSuccess}
              onNavigateToSignup={() => handleNavigate('signup')}
            />
          ))}

        {currentTab === 'login' && (
          <LoginView
            notice={authNotice}
            onSuccess={handleAuthSuccess}
            onNavigateToSignup={() => handleNavigate('signup')}
          />
        )}

        {currentTab === 'signup' && (
          <SignupView
            onSuccess={handleAuthSuccess}
            onNavigateToLogin={() => handleNavigate('login')}
          />
        )}
      </div>

      {/* Site Footer */}
      <Footer currentTab={currentTab} onNavigate={handleNavigate} />
    </div>
  );
}
