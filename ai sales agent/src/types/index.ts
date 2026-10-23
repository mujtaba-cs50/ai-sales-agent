export type LeadStatus = 'Hot' | 'Warm' | 'New' | 'Closed';

export interface ChatMessage {
  id: string;
  sender: 'agent' | 'customer';
  text: string;
  timestamp: string;
  isVoice?: boolean;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  product: string;
  status: LeadStatus;
  note: string;
  city?: string;
  address?: string;
  timestamp: string;
  value?: string;
  estimatedKw?: number;
  conversationHistory?: ChatMessage[];
  capturedBy?: string;
}

export type ProductCategory =
  | 'Residential'
  | 'Commercial'
  | 'Backup'
  | 'Solar Panels'
  | 'Inverters'
  | 'Batteries';

export interface SolarProduct {
  id: string;
  name: string;
  category: ProductCategory;
  brand?: string;
  badge?: string;
  badgeType?: 'amber' | 'primary' | 'neutral';
  icon: string;
  description: string;
  bestFor: string;
  priceRange: string;
  priceNumeric: number;
  specs: {
    inverter?: string;
    panels?: string;
    dailyUnits?: string;
    batterySupport?: string;
    netMetering?: boolean;
    applianceLoad?: string;
    warranty?: string;
    efficiency?: string;
    capacity?: string;
  };
}

export interface LeadStats {
  totalLeads: number;
  newLeads: number;
  hotLeads: number;
  warmLeads: number;
  closedLeads: number;
  followUps: number;
  estimatedPipelineValue: string;
}
