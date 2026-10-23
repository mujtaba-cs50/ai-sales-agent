/**
 * Persistence for users, refresh tokens and leads (all methods are async).
 */
import fs from 'node:fs';
import path from 'node:path';
import { AUTH } from '../config.js';
import { redis, redisConfig, redisPipeline } from '../redis.js';

export type Role = 'admin' | 'staff';

export interface User {
  id: string;
  name: string;
  email: string; // lower-case
  passwordHash: string;
  role: Role;
  createdAt: string;
  lastLoginAt?: string;
  disabled?: boolean;
}

export interface RefreshRecord {
  hash: string; // sha256 of the opaque token (the raw token is never stored)
  userId: string;
  familyId: string;
  expiresAt: number;
  usedAt?: number;
  revoked?: boolean;
}

export interface LeadRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  product: string;
  status: 'Hot' | 'Warm' | 'New' | 'Closed';
  note: string;
  city?: string;
  address?: string;
  timestamp: string;
  value?: string;
  estimatedKw?: number;
  createdAt?: string;
}

export interface Store {
  countUsers(): Promise<number>;
  findUserByEmail(email: string): Promise<User | undefined>;
  findUserById(id: string): Promise<User | undefined>;
  createUser(u: User): Promise<boolean>;
  updateUser(id: string, patch: Partial<User>): Promise<void>;
  claimFirstAdmin(): Promise<boolean>;
  saveRefresh(r: RefreshRecord): Promise<void>;
  findRefresh(hash: string): Promise<RefreshRecord | undefined>;
  markRefreshUsed(hash: string): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
  revokeUser(userId: string): Promise<void>;
  listLeads(): Promise<LeadRecord[]>;
  findLeadByPhoneDigits(digits: string): Promise<LeadRecord | undefined>;
  findLead(id: string): Promise<LeadRecord | undefined>;
  upsertLead(l: LeadRecord): Promise<void>;
  removeLead(id: string): Promise<boolean>;
}

export class StorageNotConfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageNotConfigured';
  }
}

const digitsOf = (s: string) => s.replace(/\D/g, '');
const ttlSec = (expiresAt: number) => Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));

/* --------------------------------- JSON file / memory --------------------------------- */

interface Data { users: User[]; refresh: RefreshRecord[]; leads: LeadRecord[]; adminClaimed?: boolean }

export class JsonStore implements Store {
  private data: Data = { users: [], refresh: [], leads: [] };
  private chain: Promise<void> = Promise.resolve();

  constructor(private file: string | null) {
    if (file) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.data = { users: parsed.users || [], refresh: parsed.refresh || [], leads: parsed.leads || [], adminClaimed: !!parsed.adminClaimed };
      } catch (e: any) {
        if (e?.code !== 'ENOENT') console.error('[store] could not read', file, e?.message);
      }
    }
    this.purge();
  }

  private purge() {
    const now = Date.now();
    this.data.refresh = this.data.refresh.filter((r) => r.expiresAt > now && !r.revoked);
  }

  private persist(): Promise<void> {
    if (!this.file) return Promise.resolve();
    const file = this.file;
    this.chain = this.chain.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(this.data), { mode: 0o600 });
        await fs.promises.rename(tmp, file);
      } catch (e: any) {
        // Vercel read-only filesystem ignore error gracefully
      }
    });
    return this.chain;
  }

  async countUsers() { return this.data.users.length; }
  async findUserByEmail(email: string) { return this.data.users.find((u) => u.email === email); }
  async findUserById(id: string) { return this.data.users.find((u) => u.id === id); }
  async createUser(u: User) {
    if (this.data.users.some((x) => x.email === u.email)) return false;
    this.data.users.push(u);
    await this.persist();
    return true;
  }
  async updateUser(id: string, patch: Partial<User>) {
    const u = this.data.users.find((x) => x.id === id);
    if (u) Object.assign(u, patch);
    await this.persist();
  }
  async claimFirstAdmin() {
    if (this.data.adminClaimed) return false;
    this.data.adminClaimed = true;
    await this.persist();
    return true;
  }
  async saveRefresh(r: RefreshRecord) { this.purge(); this.data.refresh.push(r); await this.persist(); }
  async findRefresh(hash: string) { return this.data.refresh.find((r) => r.hash === hash); }
  async markRefreshUsed(hash: string) {
    const r = this.data.refresh.find((x) => x.hash === hash);
    if (r) r.usedAt = Date.now();
    await this.persist();
  }
  async revokeFamily(familyId: string) {
    this.data.refresh = this.data.refresh.filter((r) => r.familyId !== familyId);
    await this.persist();
  }
  async revokeUser(userId: string) {
    this.data.refresh = this.data.refresh.filter((r) => r.userId !== userId);
    await this.persist();
  }
  async listLeads() { return this.data.leads; }
  async findLeadByPhoneDigits(d: string) { return this.data.leads.find((l) => digitsOf(l.phone) === d); }
  async findLead(id: string) { return this.data.leads.find((l) => l.id === id); }
  async upsertLead(l: LeadRecord) {
    const i = this.data.leads.findIndex((x) => x.id === l.id);
    if (i >= 0) this.data.leads[i] = l;
    else this.data.leads.unshift(l);
    if (this.data.leads.length > 5000) this.data.leads.length = 5000;
    await this.persist();
  }
  async removeLead(id: string) {
    const n = this.data.leads.length;
    this.data.leads = this.data.leads.filter((l) => l.id !== id);
    await this.persist();
    return this.data.leads.length < n;
  }
}

/* ------------------------------------------- factory ------------------------------------------- */

let singleton: Store | null = null;
export function getStore(): Store {
  if (singleton) return singleton;
  if (redisConfig()) {
    singleton = new RedisStore();
  } else {
    // Vercel par bhi in-memory fallback use karega taaki error na aaye
    singleton = new JsonStore(process.env.VERCEL ? null : path.resolve(AUTH.dataDir(), 'store.json'));
  }
  return singleton;
}
export function resetStoreForTests() { singleton = null; }
