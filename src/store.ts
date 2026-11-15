// Data layer: local cache (localStorage) + sync with a private GitHub repository (data.json).

export interface Transaction {
  id: string;
  type: 'income' | 'savings' | 'expenses' | 'loan';
  loanAction?: 'taken' | 'repaid';
  amount: number;
  category: string;
  date: string;
  note: string;
}

// The whole ledger. `deleted` holds the ids of removed records so a delete on one device
// is not undone by another device that still has the old copy.
export interface DataDoc {
  version: 2;
  transactions: Transaction[];
  deleted: Record<string, string>;
}

export interface GitConfig {
  owner: string;
  repo: string;
  token: string;
  path: string;
}

export interface Profile {
  name: string;
  pinHash: string;
}

const DATA_KEY = 'moneymate_data_v2';
const LEGACY_KEY = 'moneymate_transactions';
const CONFIG_KEY = 'moneymate_github';
const PROFILE_KEY = 'moneymate_profile';
export const SESSION_KEY = 'moneymate_unlocked';

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

export const emptyDoc = (): DataDoc => ({ version: 2, transactions: [], deleted: {} });

// ---------- validation / merge ----------

// Accepts MoneyMate backups, the older local format, and rows exported from Supabase (loan_action).
export function sanitizeTransactions(list: any[]): Transaction[] {
  const byId = new Map<string, Transaction>();
  for (const t of list) {
    if (!t || !['income', 'savings', 'expenses', 'loan'].includes(t.type)) continue;
    const amount = Number(t.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (typeof t.category !== 'string' || !t.category.trim()) continue;
    const date = String(t.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const id = typeof t.id === 'string' && t.id ? t.id : crypto.randomUUID();
    const action = t.loanAction ?? t.loan_action;
    byId.set(id, {
      id,
      type: t.type,
      ...(t.type === 'loan' ? { loanAction: action === 'repaid' ? 'repaid' : 'taken' } : {}),
      amount,
      category: t.category.trim(),
      date,
      note: String(t.note || ''),
    } as Transaction);
  }
  return Array.from(byId.values());
}

export function normalizeDoc(raw: any): DataDoc {
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.transactions) ? raw.transactions : [];
  const deleted: Record<string, string> = {};
  if (raw && !Array.isArray(raw) && raw.deleted && typeof raw.deleted === 'object') {
    for (const [id, when] of Object.entries(raw.deleted)) deleted[id] = typeof when === 'string' ? when : '';
  }
  const transactions = sanitizeTransactions(list).filter(t => !hasOwn(deleted, t.id));
  return { version: 2, transactions, deleted };
}

// Union of both ledgers minus anything deleted on either side. Records on `a` keep their order first.
export function mergeDocs(a: DataDoc, b: DataDoc): DataDoc {
  const deleted: Record<string, string> = { ...a.deleted, ...b.deleted };
  const byId = new Map<string, Transaction>();
  for (const t of [...a.transactions, ...b.transactions]) {
    if (!hasOwn(deleted, t.id) && !byId.has(t.id)) byId.set(t.id, t);
  }
  const transactions = Array.from(byId.values()).sort((x, y) => y.date.localeCompare(x.date));
  return { version: 2, transactions, deleted };
}

export function sameDoc(a: DataDoc, b: DataDoc): boolean {
  if (a.transactions.length !== b.transactions.length) return false;
  const ids = new Set(a.transactions.map(t => t.id));
  if (!b.transactions.every(t => ids.has(t.id))) return false;
  const ka = Object.keys(a.deleted);
  const kb = Object.keys(b.deleted);
  return ka.length === kb.length && ka.every(k => hasOwn(b.deleted, k));
}

// ---------- minimal CSV parser (for Supabase CSV exports) ----------

export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

// ---------- local storage (this device) ----------

export function loadLocalDoc(): DataDoc {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) return normalizeDoc(JSON.parse(raw));
  } catch { /* fall through */ }
  try {
    // Records saved by the earlier browser-only version of MoneyMate on this device.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return normalizeDoc(JSON.parse(legacy));
  } catch { /* fall through */ }
  return emptyDoc();
}

export function saveLocalDoc(doc: DataDoc): void {
  localStorage.setItem(DATA_KEY, JSON.stringify(doc));
  localStorage.removeItem(LEGACY_KEY);
}

export function loadConfig(): GitConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && c.owner && c.repo && c.token && c.path ? c : null;
  } catch {
    return null;
  }
}
export const saveConfig = (cfg: GitConfig) => localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p.name === 'string' && typeof p.pinHash === 'string' ? p : null;
  } catch {
    return null;
  }
}
export const saveProfile = (p: Profile) => localStorage.setItem(PROFILE_KEY, JSON.stringify(p));

export function wipeDevice(): void {
  [DATA_KEY, LEGACY_KEY, CONFIG_KEY, PROFILE_KEY].forEach(k => localStorage.removeItem(k));
  sessionStorage.removeItem(SESSION_KEY);
}

// Hash the PIN so it is not stored as plain text. It is a screen lock, not bank-grade security.
export async function hashPin(pin: string): Promise<string> {
  const text = 'moneymate:' + pin;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return btoa(text);
  }
}

// ---------- GitHub API ----------

export class GitError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

async function gh(cfg: GitConfig, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch('https://api.github.com' + path, {
    cache: 'no-store',
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      ...((init.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).message || message; } catch { /* ignore */ }
    throw new GitError(res.status, message);
  }
  return res.json();
}

const repoPath = (cfg: GitConfig) => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

export async function verifyRepo(cfg: GitConfig): Promise<{ isPrivate: boolean }> {
  const json = await gh(cfg, repoPath(cfg));
  return { isPrivate: json.private === true };
}

async function pullRemote(cfg: GitConfig): Promise<{ doc: DataDoc | null; sha: string | null }> {
  try {
    const json = await gh(cfg, `${repoPath(cfg)}/contents/${cfg.path}`);
    if (typeof json.content !== 'string' || !json.content) throw new Error('The data file in GitHub is empty or too large to read.');
    return { doc: normalizeDoc(JSON.parse(b64decode(json.content))), sha: json.sha as string };
  } catch (e) {
    if (e instanceof GitError && e.status === 404) return { doc: null, sha: null };
    throw e;
  }
}

async function pushRemote(cfg: GitConfig, doc: DataDoc, sha: string | null): Promise<void> {
  const text = JSON.stringify({ app: 'MoneyMate', updatedAt: new Date().toISOString(), ...doc }, null, 2);
  const body = {
    message: `MoneyMate update ${new Date().toISOString()}`,
    content: b64encode(text),
    ...(sha ? { sha } : {}),
  };
  await gh(cfg, `${repoPath(cfg)}/contents/${cfg.path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Pull the shared file, merge it with this device's data and push only if something changed.
export async function syncDoc(cfg: GitConfig, local: DataDoc): Promise<DataDoc> {
  for (let attempt = 0; ; attempt++) {
    const remote = await pullRemote(cfg);
    const merged = remote.doc ? mergeDocs(local, remote.doc) : local;
    if (remote.doc && sameDoc(merged, remote.doc)) return merged;
    try {
      await pushRemote(cfg, merged, remote.sha);
      return merged;
    } catch (e) {
      // Someone else saved at the same moment: pull again, merge again, retry.
      const conflict = e instanceof GitError && (e.status === 409 || e.status === 422);
      if (!conflict || attempt >= 3) throw e;
    }
  }
}

export function describeError(e: unknown): string {
  if (e instanceof GitError) {
    if (e.status === 401) return 'GitHub rejected the token (invalid or expired). Create a new token and reconnect this device.';
    if (e.status === 403) return 'GitHub denied access. The token needs "Contents: Read and write" on the data repository (or the GitHub limit was reached; try again later).';
    if (e.status === 404) return 'Data repository not found, or the token cannot access it. Check the username, repository name and token.';
    return `GitHub error ${e.status}: ${e.message}`;
  }
  if (e instanceof TypeError) return 'No internet connection. Changes are saved on this device and will sync when you are online.';
  return e instanceof Error ? e.message : 'Something went wrong.';
}
