import React, { useState } from 'react';

interface ProductItem {
  id: string;
  name: string;
  category: 'Residential' | 'Commercial' | 'Backup';
  badge?: string;
  badgeType?: 'amber' | '';
  icon: string;
  description: string;
  bestFor: string;
  price: string;
}

const PRODUCTS: ProductItem[] = [
  {
    id: '3kw-home',
    name: '3kW Home Solar',
    category: 'Residential',
    badge: 'Entry',
    badgeType: 'amber',
    icon: '☀️',
    description: 'Designed for smaller homes with essential daytime usage and basic appliances.',
    bestFor: 'Small homes',
    price: 'PKR 750k - 900k',
  },
  {
    id: '5kw-hybrid',
    name: '5kW Hybrid System',
    category: 'Residential',
    badge: 'Popular',
    badgeType: 'amber',
    icon: '⚡',
    description: 'A balanced package for medium homes that need strong daily savings and backup support.',
    bestFor: 'Medium homes',
    price: 'PKR 1.2M - 1.45M',
  },
  {
    id: '7kw-premium',
    name: '7kW Premium Home',
    category: 'Residential',
    icon: '🏠',
    description: 'For larger homes with higher electricity usage and multiple heavy appliances.',
    bestFor: 'Large homes',
    price: 'PKR 1.7M - 2.0M',
  },
  {
    id: '10kw-business',
    name: '10kW Business Solar',
    category: 'Commercial',
    icon: '🏢',
    description: 'A professional package for shops, offices, and small commercial spaces.',
    bestFor: 'Offices',
    price: 'PKR 2.4M - 2.8M',
  },
  {
    id: '20kw-commercial',
    name: '20kW Commercial System',
    category: 'Commercial',
    badge: 'Scale',
    badgeType: 'amber',
    icon: '🏭',
    description: 'For businesses that want larger savings, higher capacity, and a custom installation plan.',
    bestFor: 'Warehouses',
    price: 'PKR 4.6M - 5.2M',
  },
  {
    id: 'battery-inverter',
    name: 'Battery and Inverter',
    category: 'Backup',
    badge: 'Backup',
    icon: '🔋',
    description: 'Backup-focused solution for night usage and power outage protection.',
    bestFor: 'Backup power',
    price: 'PKR 350k - 600k',
  },
];

interface ProductsViewProps {
  onTalkToAgent: (productName?: string) => void;
}

export const ProductsView: React.FC<ProductsViewProps> = ({ onTalkToAgent }) => {
  const [filterType, setFilterType] = useState('All');

  const filtered = PRODUCTS.filter((p) => {
    return filterType === 'All' || p.category === filterType;
  });

  return (
    <main id="main">
      <section className="section-tight">
        <div className="container products-layout">
          <aside className="filter-panel">
            <h2>Filter packages</h2>
            <div className="field">
              <label htmlFor="productFilter">Package type</label>
              <select
                className="select"
                id="productFilter"
                data-product-filter
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="All">All</option>
                <option value="Residential">Residential</option>
                <option value="Commercial">Commercial</option>
                <option value="Backup">Backup</option>
              </select>
            </div>
          </aside>

          <div className="product-grid">
            {filtered.map((prod) => (
              <article
                key={prod.id}
                className="product-card"
                data-product-card={prod.category}
              >
                <div className="product-icon">{prod.icon}</div>
                <div className="badges">
                  <span className="badge">{prod.category}</span>
                  {prod.badge && (
                    <span className={`badge ${prod.badgeType === 'amber' ? 'amber' : ''}`}>
                      {prod.badge}
                    </span>
                  )}
                </div>
                <h3>{prod.name}</h3>
                <p>{prod.description}</p>
                <div className="product-meta">
                  <div className="meta-row">
                    <span>Best for</span>
                    <strong>{prod.bestFor}</strong>
                  </div>
                  <div className="meta-row">
                    <span>Price</span>
                    <strong>{prod.price}</strong>
                  </div>
                </div>
                <a
                  className="btn btn-soft"
                  href="assistant.html"
                  onClick={(e) => {
                    e.preventDefault();
                    onTalkToAgent(prod.name);
                  }}
                >
                  Talk to Agent
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
