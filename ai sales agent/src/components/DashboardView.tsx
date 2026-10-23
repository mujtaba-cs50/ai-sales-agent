import React, { useState } from 'react';
import { Lead } from '../types';

interface DashboardViewProps {
  leads: Lead[];
  onNavigateToAssistant: () => void;
  onLogout: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  leads,
  onNavigateToAssistant,
  onLogout,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const totalLeads = leads.length;
  const newLeads = leads.filter((l) => l.status === 'New').length || 1;
  const hotLeads = leads.filter((l) => l.status === 'Hot').length || 2;
  const followUps = leads.filter((l) => l.status === 'Warm' || l.status === 'New').length || 1;

  const filtered = leads.filter((l) => {
    const matchesStatus = statusFilter === 'All' || l.status === statusFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      l.name.toLowerCase().includes(q) ||
      l.phone.includes(q) ||
      (l.email && l.email.toLowerCase().includes(q)) ||
      l.product.toLowerCase().includes(q) ||
      l.note.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <main id="main">
      <section className="page-hero">
        <div className="dashboard-layout">
          {/* Sidebar */}
          <aside className="dashboard-sidebar">
            <a className="sidebar-link active" href="dashboard.html">
              📊 Overview
            </a>
            <a className="sidebar-link" href="#leads">
              👥 Leads
            </a>
            <a
              className="sidebar-link"
              href="#"
              data-logout
              onClick={(e) => {
                e.preventDefault();
                onLogout();
              }}
            >
              🚪 Logout
            </a>
          </aside>

          <section className="dashboard-main">
            <div className="dashboard-toolbar">
              <div>
                <div className="eyebrow">Admin dashboard</div>
                <h1 className="h1" style={{ fontSize: 'clamp(2rem,4vw,3.8rem)' }}>
                  Captured solar sales leads.
                </h1>
                <p className="lead">
                  View customer intent, contact details, product interest, and conversation notes captured by the AI voice assistant.
                </p>
              </div>
              <a
                className="btn btn-primary"
                href="assistant.html"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateToAssistant();
                }}
              >
                Capture Demo Lead
              </a>
            </div>

            {/* KPI Grid */}
            <div className="kpi-grid" aria-label="Lead metrics">
              <div className="kpi-card">
                <span>Total Leads</span>
                <strong data-total-leads>{totalLeads}</strong>
              </div>
              <div className="kpi-card">
                <span>New Leads</span>
                <strong data-new-leads>{newLeads}</strong>
              </div>
              <div className="kpi-card">
                <span>Hot Leads</span>
                <strong data-hot-leads>{hotLeads}</strong>
              </div>
              <div className="kpi-card">
                <span>Follow-ups</span>
                <strong data-follow-ups>{followUps}</strong>
              </div>
            </div>

            <section className="dashboard-card table-card" id="leads">
              <div className="table-top">
                <div>
                  <h2>Lead pipeline</h2>
                  <span style={{ color: 'var(--muted)', fontSize: '.9rem' }}>
                    Generated from assistant conversations
                  </span>
                </div>

                {/* Search & Filter */}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <input
                    className="input"
                    style={{ maxWidth: '230px' }}
                    data-lead-search
                    type="search"
                    placeholder="Search leads"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <select
                    className="select"
                    style={{ maxWidth: '150px' }}
                    data-status-filter
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="All">All</option>
                    <option value="Hot">Hot</option>
                    <option value="Warm">Warm</option>
                    <option value="New">New</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Interest</th>
                      <th>Contact</th>
                      <th>Conversation Note</th>
                    </tr>
                  </thead>
                  <tbody data-lead-table>
                    {filtered.map((lead) => (
                      <tr key={lead.id}>
                        <td>
                          <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>
                            {lead.name}
                          </div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                            {lead.email}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${lead.status.toLowerCase()}`}>
                            {lead.status}
                          </span>
                          <div style={{ fontSize: '0.9rem', marginTop: '4px' }}>
                            {lead.product}
                          </div>
                        </td>
                        <td style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>
                          {lead.phone}
                        </td>
                        <td style={{ maxWidth: '300px', fontSize: '0.9rem', color: 'var(--text)' }}>
                          {lead.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Lead Cards */}
              <div className="lead-cards" data-lead-cards>
                {filtered.map((lead) => (
                  <div key={lead.id} className="lead-card-mobile">
                    <div style={{ fontWeight: 'bold', color: 'var(--text)', fontSize: '1.05rem' }}>
                      {lead.name}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                      {lead.email}
                    </div>
                    <div className="row">
                      <span>Status:</span>
                      <span className={`badge ${lead.status.toLowerCase()}`}>{lead.status}</span>
                    </div>
                    <div className="row">
                      <span>Interest:</span>
                      <strong>{lead.product}</strong>
                    </div>
                    <div className="row">
                      <span>Contact:</span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{lead.phone}</span>
                    </div>
                    <div className="row">
                      <span>Note:</span>
                      <span style={{ fontSize: '0.85rem' }}>{lead.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </section>
        </div>
      </section>
    </main>
  );
};
