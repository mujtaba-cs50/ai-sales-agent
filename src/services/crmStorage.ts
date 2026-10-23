import { Lead, LeadStatus } from '../types';
import { authFetch, getUser, onAuthChange } from './authClient';

// ----------------- AUTH (server-backed: see authClient.ts) -----------------
export type { UserSession } from './authClient';
export { login, register, logout } from './authClient';
export const getCurrentUser = getUser;

// ----------------- LEADS MANAGEMENT (server-backed, login required to read) -----------------
// Visitors of the public website can only SEND leads (POST /api/leads). Reading, updating and
// deleting leads requires a logged-in account; the list is kept in memory, never in localStorage.

let leadsCache: Lead[] = [];
const leadListeners = new Set<(leads: Lead[]) => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

const emitLeads = () => leadListeners.forEach((cb) => cb(leadsCache));

export function getLeads(): Lead[] {
  return leadsCache;
}

export async function refreshLeads(): Promise<void> {
  if (!getUser()) {
    leadsCache = [];
    emitLeads();
    return;
  }
  try {
    const res = await authFetch('/api/leads');
    if (res.ok) {
      const data = await res.json();
      leadsCache = Array.isArray(data.leads) ? data.leads : [];
      emitLeads();
    }
  } catch {
    /* offline: keep the last list */
  }
}

onAuthChange((u) => {
  if (u) void refreshLeads();
  else {
    leadsCache = [];
    emitLeads();
  }
});

export function saveLead(lead: Partial<Lead>): Lead {
  const newLead: Lead = {
    id: lead.id || `lead-${Date.now()}`,
    name: (lead.name || '').trim() || 'Valued Customer',
    phone: (lead.phone || '').trim(),
    email: lead.email || 'customer@solar-lead.com',
    product: lead.product || '5kW Hybrid System',
    status: (lead.status as LeadStatus) || 'New',
    note: lead.note || 'Inquiry captured via platform.',
    city: lead.city || 'Pakistan',
    address: lead.address || '',
    timestamp: lead.timestamp || 'Just now',
    value: lead.value || 'PKR 1.35M',
    estimatedKw: lead.estimatedKw || 5,
  };

  // Public capture endpoint: works for anonymous visitors; the server de-duplicates by phone number.
  fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newLead),
  })
    .then(() => {
      if (getUser()) void refreshLeads();
    })
    .catch(() => {});

  return newLead;
}

/**
 * Intelligent Lead Extraction from Voice / Text conversation
 * Extracts Name, Pakistani Phone Number, City, System Size, and Notes
 */
export function extractLeadFromConversation(
  currentText: string,
  history?: { sender: string; text: string }[],
  productContext?: string | null
): Lead | null {
  const combinedHistory = (history || [])
    .filter((h) => h.sender === 'customer')
    .map((h) => h.text)
    .join(' ');
  const fullText = `${combinedHistory} ${currentText}`.trim();

  // 1. Phone number detection (Pakistan formats)
  const phoneRegex = /(?:(?:\+92|0092|92)?[-.\s]?(?:3\d{2})[-.\s]?\d{7}|\b0\d{10}\b|\b03\d{9}\b)/;
  const phoneMatch = fullText.match(phoneRegex);

  if (!phoneMatch) {
    return null; // A valid sales lead must have a contact number
  }

  const phone = phoneMatch[0].trim();

  // 2. Name detection (English & Roman Urdu)
  let name = 'Valued Customer';
  const namePatterns = [
    /(?:my\s+name\s+is|mera\s+naam\s+(?:hai\s+)?|mera\s+name\s+(?:hai\s+)?|name[:\s]+|i\s+am|i'm|this\s+is|call\s+me)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i,
    /([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(?:here|speaking)\b/i,
  ];

  for (const pattern of namePatterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      const candidate = match[1]
        .replace(/\s+(?:from|living|in|at|and|contact|number|phone|cell|mobile|solar|want|need)\b.*$/i, '')
        .trim();
      if (candidate.length >= 2 && !/^(solar|system|inverter|panel|hybrid|price|quote|survey|please|hello|yes|want)$/i.test(candidate)) {
        name = candidate;
        break;
      }
    }
  }

  // 3. City detection in Pakistan
  const cities = [
    'Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan',
    'Peshawar', 'Gujranwala', 'Sialkot', 'Quetta', 'Hyderabad', 'Bahawalpur',
    'Sargodha', 'Sukkur', 'Abbottabad', 'Gujrat', 'Wah Cantt'
  ];

  let city = 'Pakistan';
  for (const c of cities) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(fullText)) {
      city = c;
      break;
    }
  }

  // 4. Product System sizing detection
  const lowerText = fullText.toLowerCase();
  let product = productContext || '5kW Hybrid System';
  let estimatedKw = 5;
  let value = 'PKR 1.2M - 1.45M';

  if (lowerText.includes('3kw') || lowerText.includes('3 kw')) {
    product = '3kW Home Solar';
    estimatedKw = 3;
    value = 'PKR 750k - 900k';
  } else if (lowerText.includes('5kw') || lowerText.includes('5 kw')) {
    product = '5kW Hybrid System';
    estimatedKw = 5;
    value = 'PKR 1.2M - 1.45M';
  } else if (lowerText.includes('7kw') || lowerText.includes('7 kw')) {
    product = '7kW Premium Home';
    estimatedKw = 7;
    value = 'PKR 1.7M - 2.0M';
  } else if (lowerText.includes('10kw') || lowerText.includes('10 kw')) {
    product = '10kW Business Solar';
    estimatedKw = 10;
    value = 'PKR 2.4M - 2.8M';
  } else if (lowerText.includes('20kw') || lowerText.includes('20 kw')) {
    product = '20kW Commercial System';
    estimatedKw = 20;
    value = 'PKR 4.6M - 5.2M';
  } else if (lowerText.includes('battery') || lowerText.includes('backup')) {
    product = 'Battery and Inverter';
    estimatedKw = 3;
    value = 'PKR 350k - 600k';
  }

  return {
    id: `lead-voice-${Date.now()}`,
    name,
    phone,
    email: 'customer@solar-lead.com',
    product,
    status: 'Hot',
    note: `Captured via Voice Assistant: "${currentText}"`,
    city,
    address: city !== 'Pakistan' ? `${city} Area` : '',
    timestamp: 'Just now',
    value,
    estimatedKw,
  };
}

export function updateLeadStatus(leadId: string, newStatus: LeadStatus): Lead[] {
  leadsCache = leadsCache.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l)); // optimistic
  emitLeads();
  authFetch(`/api/leads/${encodeURIComponent(leadId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus }),
  })
    .then((r) => {
      if (!r.ok) void refreshLeads(); // roll back to the server's truth
    })
    .catch(() => void refreshLeads());
  return leadsCache;
}

export function deleteLead(leadId: string): Lead[] {
  leadsCache = leadsCache.filter((l) => l.id !== leadId); // optimistic
  emitLeads();
  authFetch(`/api/leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' })
    .then((r) => {
      if (!r.ok) void refreshLeads(); // e.g. 403 for non-admins: the lead comes back
    })
    .catch(() => void refreshLeads());
  return leadsCache;
}

export function subscribeToLeads(callback: (leads: Lead[]) => void): () => void {
  leadListeners.add(callback);
  callback(leadsCache);
  if (getUser()) void refreshLeads();

  if (!pollTimer && typeof window !== 'undefined') {
    // keep the dashboard fresh while the tab is visible (new leads arrive from the voice assistant)
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && getUser()) void refreshLeads();
    }, 20000);
  }
  return () => {
    leadListeners.delete(callback);
    if (!leadListeners.size && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

/** Prevent spreadsheet formula injection (=, +, -, @) when a lead field is opened in Excel. */
const csvCell = (v: unknown): string => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export function exportLeadsToCsv(): void {
  const leads = getLeads();
  if (!leads.length) return;

  const headers = ['ID', 'Customer Name', 'Phone', 'Email', 'City', 'Address', 'Product', 'Status', 'Estimated KW', 'Value', 'Date/Time', 'Notes'];
  const rows = leads.map((l) =>
    [l.id, l.name, l.phone, l.email, l.city, l.address, l.product, l.status, l.estimatedKw, l.value, l.timestamp, l.note].map(csvCell)
  );

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Solar_CRM_Leads_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
