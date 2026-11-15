import React, { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import {
  Wallet,
  ArrowUpCircle,
  PiggyBank,
  ShoppingBag,
  PlusCircle,
  Home,
  LogOut,
  Calendar,
  Trash2,
  Lock,
  User,
  CheckCircle2,
  X,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  Receipt,
  FileDown,
  Filter,
  BarChart3,
  Quote,
  Sparkles,
  FileSpreadsheet
} from 'lucide-react';
import {
  type Transaction, type DataDoc, type GitConfig, type Profile,
  SESSION_KEY, emptyDoc, sanitizeTransactions, mergeDocs, sameDoc, parseCSV,
  loadLocalDoc, saveLocalDoc, loadConfig, saveConfig, loadProfile, saveProfile, wipeDevice,
  hashPin, verifyRepo, syncDoc, describeError, buildSetupLink, readSetupLink,
} from './store';

// Use local calendar dates (toISOString() uses UTC and can show yesterday in India).
const currentDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const currentMonthString = () => currentDateString().slice(0, 7);

const MONEY_QUOTES = [
  "A budget is telling your money where to go instead of wondering where it went. — Dave Ramsey",
  "Do not save what is left after spending, but spend what is left after saving. — Warren Buffett",
  "Beware of little expenses; a small leak will sink a great ship. — Benjamin Franklin",
  "Financial freedom is available to those who learn about it and work for it. — Robert Kiyosaki",
  "It's not your salary that makes you rich, it's your spending habits. — Charles A. Jaffe"
];

function formatPDFAmount(value: number): string {
  return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 });
}

function formatINR(value: number): string {
  return '₹' + Number(value || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

function formatMonthReadable(monthKey: string): string {
  try {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
    return date.toLocaleString('en', { month: 'long', year: 'numeric' });
  } catch {
    return monthKey;
  }
}


export default function App() {
  // Local copy of the ledger (also cached in localStorage) and its sync with the private GitHub repo
  const docRef = useRef<DataDoc | null>(null);
  if (docRef.current === null) docRef.current = loadLocalDoc();
  const syncingRef = useRef(false);
  const pendingRef = useRef(false);

  const [profile, setProfile] = useState<Profile | null>(() => loadProfile());
  const [config, setConfig] = useState<GitConfig | null>(() => loadConfig());
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => !!loadProfile() && !!loadConfig() && sessionStorage.getItem(SESSION_KEY) === '1');
  const [adminName, setAdminName] = useState<string>(() => loadProfile()?.name || '');
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState<string>('');
  const [lastSynced, setLastSynced] = useState<string>('');

  // Form states for the lock / setup screen
  const [loginNameInput, setLoginNameInput] = useState<string>('');
  const [loginPinInput, setLoginPinInput] = useState<string>('');
  const [confirmPinInput, setConfirmPinInput] = useState<string>('');
  const [fromLink] = useState<boolean>(() => !!readSetupLink());
  const [setupOwner, setSetupOwner] = useState<string>(() => readSetupLink()?.owner || '');
  const [setupRepo, setSetupRepo] = useState<string>(() => readSetupLink()?.repo || 'moneymate-data');
  const [setupToken, setSetupToken] = useState<string>(() => readSetupLink()?.token || '');
  const [setupBusy, setSetupBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>('');
  const [authSuccess, setAuthSuccess] = useState<string>('');

  // App Navigation
  const [activePage, setActivePage] = useState<'home' | 'entry' | 'income' | 'savings' | 'expenses' | 'loan'>('home');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthString());

  // Entry Page option tab: 'income' | 'savings' | 'expenses'
  const [entryType, setEntryType] = useState<'income' | 'savings' | 'expenses' | 'loan'>('expenses');

  // Data
  const [transactions, setTransactions] = useState<Transaction[]>(() => docRef.current!.transactions);

  // Entry forms
  const [incomeForm, setIncomeForm] = useState({ amount: '', category: '', date: currentDateString(), note: '' });
  const [savingsForm, setSavingsForm] = useState({ amount: '', category: '', date: currentDateString(), note: '' });
  const [expenseForm, setExpenseForm] = useState({ amount: '', category: '', date: currentDateString(), note: '' });
  const [loanForm, setLoanForm] = useState({ action: 'taken' as 'taken' | 'repaid', amount: '', category: '', date: currentDateString(), note: '' });

  // Filtering for History Pages
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState<string>('all');
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Confirm delete modal
  const [deleteModalId, setDeleteModalId] = useState<string | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => (prev?.message === message ? null : prev));
    }, 3200);
  };

  // Save a new ledger on this device, then sync it to GitHub in the background.
  const applyDoc = (doc: DataDoc) => {
    saveLocalDoc(doc);
    docRef.current = doc;
    setTransactions(doc.transactions);
  };

  const runSync = async (manual = false) => {
    const cfg = loadConfig();
    if (!cfg) return;
    if (syncingRef.current) { pendingRef.current = true; return; }
    syncingRef.current = true;
    setSyncState('syncing');
    try {
      const synced = await syncDoc(cfg, docRef.current!);
      // Merge again in case something was added while the network call was running.
      const latest = mergeDocs(docRef.current!, synced);
      if (!sameDoc(latest, docRef.current!)) applyDoc(latest);
      if (!sameDoc(latest, synced)) pendingRef.current = true;
      setSyncState('ok');
      setSyncMessage('');
      setLastSynced(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
      if (manual) showToast('Synced with GitHub.', 'success');
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncState('error');
      setSyncMessage(describeError(error));
      if (manual) showToast(describeError(error), 'error');
    } finally {
      syncingRef.current = false;
      if (pendingRef.current) { pendingRef.current = false; void runSync(); }
    }
  };

  // Sync when the app opens, every 30 seconds while visible, and when the tab/phone comes back online.
  useEffect(() => {
    if (!isLoggedIn) return;
    void runSync();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void runSync(); }, 30000);
    const onWake = () => { void runSync(); };
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [isLoggedIn]);

  // Remove the setup details from the address bar as soon as the page has read them.
  useEffect(() => {
    if (window.location.hash.includes('setup=')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const handleShareSetup = async () => {
    const cfg = loadConfig();
    if (!cfg) return;
    if (!window.confirm('This setup link contains your GitHub token. Send it only to family members you trust, in a private message, and delete the message afterwards. Continue?')) return;
    const link = buildSetupLink(cfg);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'MoneyMate setup', text: 'Open this link on your phone to connect MoneyMate:', url: link });
        return;
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(link);
      showToast('Setup link copied. Paste it into a private message.', 'success');
    } catch {
      window.prompt('Copy this setup link:', link);
    }
  };

  const resetDeviceState = () => {
    wipeDevice();
    docRef.current = emptyDoc();
    setTransactions([]);
    setProfile(null);
    setConfig(null);
    setAdminName('');
    setIsLoggedIn(false);
    setSyncState('idle');
    setLoginPinInput('');
    setConfirmPinInput('');
    setSetupToken('');
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    const pin = loginPinInput;
    if (!/^\d{4,8}$/.test(pin)) {
      setAuthError('PIN must be 4 to 8 digits.');
      return;
    }

    // Unlock an already set-up device
    if (profile && config) {
      if ((await hashPin(pin)) !== profile.pinHash) {
        setAuthError('Incorrect PIN. Please try again.');
        return;
      }
      sessionStorage.setItem(SESSION_KEY, '1');
      setAdminName(profile.name);
      setIsLoggedIn(true);
      setLoginPinInput('');
      showToast(`Welcome back, ${profile.name}!`);
      return;
    }

    // First-time setup of this device
    const name = loginNameInput.trim();
    const owner = setupOwner.trim();
    const repo = setupRepo.trim();
    const token = setupToken.trim();
    if (!name) { setAuthError('Please enter your family name.'); return; }
    if (!owner || !repo || !token) { setAuthError('Enter the GitHub username, data repository name and token.'); return; }
    if (pin !== confirmPinInput) { setAuthError('PIN confirmation does not match.'); return; }

    setSetupBusy(true);
    try {
      const cfg: GitConfig = { owner, repo, token, path: 'data.json' };
      const info = await verifyRepo(cfg);
      if (!info.isPrivate) {
        setAuthError('This repository is public. Your money records would be visible to everyone. Make the data repository Private and try again.');
        return;
      }
      // Pull what is already in GitHub and merge it with anything saved earlier on this device.
      const synced = await syncDoc(cfg, docRef.current!);
      saveConfig(cfg);
      const created: Profile = { name, pinHash: await hashPin(pin) };
      saveProfile(created);
      applyDoc(synced);
      sessionStorage.setItem(SESSION_KEY, '1');
      setConfig(cfg);
      setProfile(created);
      setAdminName(name);
      setSyncState('ok');
      setLastSynced(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
      setIsLoggedIn(true);
      setLoginPinInput('');
      setConfirmPinInput('');
      setSetupToken('');
      showToast(`Connected! ${synced.transactions.length} records loaded.`);
    } catch (error) {
      console.error('Setup failed:', error);
      setAuthError(describeError(error));
    } finally {
      setSetupBusy(false);
    }
  };

  const handleForgotPin = () => {
    if (!window.confirm('This removes the PIN, the GitHub token and the local copy from THIS device only. Your records stay safe in GitHub. Changes not yet synced from this device would be lost. Continue?')) return;
    resetDeviceState();
    setAuthError('');
    setAuthSuccess('This device was reset. Set it up again with your GitHub details and a new PIN.');
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect this device? Your records stay safe in GitHub. The token, PIN and local copy are removed from this device.')) return;
    const cfg = loadConfig();
    if (cfg) {
      try {
        await syncDoc(cfg, docRef.current!);
      } catch {
        if (!window.confirm('Your latest changes could not be synced. They will be lost if you disconnect now. Disconnect anyway?')) return;
      }
    }
    resetDeviceState();
    setAuthSuccess('This device was disconnected.');
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setIsLoggedIn(false);
    setLoginPinInput('');
    setAuthError('');
    setAuthSuccess('');
    showToast('Locked successfully', 'info');
  };

  const saveTransactionsToStorage = async (updated: Transaction[]) => {
    try {
      const prev = docRef.current!;
      const keep = new Set(updated.map(t => t.id));
      const deleted = { ...prev.deleted };
      const now = new Date().toISOString();
      prev.transactions.forEach(t => { if (!keep.has(t.id)) deleted[t.id] = now; });
      applyDoc({ version: 2, transactions: updated, deleted });
    } catch (error) {
      console.error('Could not save MoneyMate data:', error);
      showToast('Could not save data in this browser (storage may be full or blocked). Your changes were not applied.', 'error');
      throw error;
    }
    void runSync();
  };

  const handleExportBackup = () => {
    const payload = { app: 'MoneyMate', version: 1, exportedAt: new Date().toISOString(), transactions };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `MoneyMate_Backup_${currentDateString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('JSON backup downloaded successfully.', 'success');
  };

  const handleImportBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      let list: any[];
      if (/\.csv$/i.test(file.name)) {
        list = parseCSV(text);
      } else {
        const parsed = JSON.parse(text);
        list = Array.isArray(parsed) ? parsed : parsed.transactions;
      }
      if (!Array.isArray(list)) throw new Error('This file does not contain a MoneyMate transactions list.');
      // A record that was deleted earlier gets a fresh id so the delete does not cancel the import.
      const imported = sanitizeTransactions(list).map(t =>
        Object.prototype.hasOwnProperty.call(docRef.current!.deleted, t.id) ? { ...t, id: crypto.randomUUID() } : t);
      if (!imported.length) throw new Error('No valid transactions were found in this file.');
      // Merge by id: matching records are updated, new ones are added.
      const merged = new Map<string, Transaction>();
      transactions.forEach((t: Transaction) => merged.set(t.id, t));
      imported.forEach((t: Transaction) => merged.set(t.id, t));
      const updated: Transaction[] = Array.from(merged.values()).sort((a: Transaction, b: Transaction) => b.date.localeCompare(a.date));
      await saveTransactionsToStorage(updated);
      showToast(`${imported.length} records imported successfully.`, 'success');
    } catch (error: any) {
      console.error('Backup import failed:', error);
      showToast(error?.message || 'Could not import this file.', 'error');
    }
  };

  const handleAddTransaction = (
    type: 'income' | 'savings' | 'expenses' | 'loan',
    amountStr: string,
    category: string,
    date: string,
    note: string,
    resetForm: () => void
  ) => {
    const amount = parseFloat(amountStr);
    const savedLoanAction = loanForm.action;
    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount greater than 0.', 'error');
      return;
    }
    if (!category.trim()) {
      showToast('Please specify a category or source.', 'error');
      return;
    }
    if (!date) {
      showToast('Please pick a date.', 'error');
      return;
    }
    if (type === 'loan' && savedLoanAction === 'repaid' && amount > outstandingLoan) {
      showToast(`Repayment cannot exceed outstanding loan (${formatINR(outstandingLoan)}).`, 'error');
      return;
    }

    const newTx: Transaction = {
      id: crypto.randomUUID(),
      type,
      amount,
      category: category.trim(),
      date,
      note: note.trim(),
      ...(type === 'loan' ? { loanAction: savedLoanAction } : {}),
    };

    const typeTitle = type === 'income' ? 'Income' : type === 'savings' ? 'Savings' : type === 'loan' ? (savedLoanAction === 'repaid' ? 'Loan repayment' : 'Loan') : 'Expense';
    const updated = [newTx, ...transactions];
    void saveTransactionsToStorage(updated).then(() => {
      resetForm();
      showToast(`${typeTitle} of ${formatINR(amount)} added successfully!`);
      setActivePage('home');
    }).catch(() => {});
    return;
  };

  const confirmDelete = (id: string) => {
    const updated = transactions.filter(t => t.id !== id);
    void saveTransactionsToStorage(updated).then(() => { setDeleteModalId(null); showToast('Transaction deleted successfully.', 'info'); }).catch(() => {});
  };

  // Calculations for current selected month
  const monthTransactions = transactions.filter(t => t.date.startsWith(selectedMonth));
  const totalIncome = monthTransactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalSavings = monthTransactions
    .filter(t => t.type === 'savings')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = monthTransactions
    .filter(t => t.type === 'expenses')
    .reduce((sum, t) => sum + t.amount, 0);

  const balance = totalIncome - totalExpenses - totalSavings;
  const totalLoanTaken = monthTransactions.filter(t => t.type === 'loan' && t.loanAction !== 'repaid').reduce((sum, t) => sum + t.amount, 0);
  const totalLoanRepaid = monthTransactions.filter(t => t.type === 'loan' && t.loanAction === 'repaid').reduce((sum, t) => sum + t.amount, 0);
  const overallLoanTaken = transactions.filter(t => t.type === 'loan' && t.loanAction !== 'repaid').reduce((sum, t) => sum + t.amount, 0);
  const overallLoanRepaid = transactions.filter(t => t.type === 'loan' && t.loanAction === 'repaid').reduce((sum, t) => sum + t.amount, 0);
  const outstandingLoan = Math.max(0, overallLoanTaken - overallLoanRepaid);

  // Category aggregation for selected month
  const getCategoryBreakdown = (type: 'income' | 'savings' | 'expenses') => {
    const txs = monthTransactions.filter(t => t.type === type);
    const categoryMap: { [cat: string]: number } = {};
    txs.forEach(t => {
      const cat = t.category || 'Uncategorized';
      categoryMap[cat] = (categoryMap[cat] || 0) + t.amount;
    });

    const totalAmount = Object.values(categoryMap).reduce((sum, v) => sum + v, 0);

    const sorted = Object.entries(categoryMap)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalAmount > 0 ? (amount / totalAmount) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return { items: sorted, totalAmount };
  };

  // 6-month chart calculation for Home view
  const getChartData = () => {
    const months = [];
    const baseDate = new Date(selectedMonth + '-01T12:00:00');

    for (let i = 5; i >= 0; i--) {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const expenseSum = transactions
        .filter(t => t.type === 'expenses' && t.date.startsWith(key))
        .reduce((sum, t) => sum + t.amount, 0);

      months.push({
        key,
        label: d.toLocaleString('en', { month: 'short' }),
        value: expenseSum,
      });
    }

    const max = Math.max(1, ...months.map(m => m.value));
    return { months, max };
  };

  const chartData = getChartData();

  // Helper for type symbols & badges
  const getBadgeMeta = (type: Transaction['type']) => {
    switch (type) {
      case 'income':
        return {
          icon: '💵',
          sign: '+',
          colorClass: 'text-[#119b70]',
          bgClass: 'bg-[#e0f8ec]',
          borderClass: 'border-[#16a779]',
        };
      case 'savings':
        return {
          icon: '🐷',
          sign: '-',
          colorClass: 'text-[#d98218]',
          bgClass: 'bg-[#fff5e5]',
          borderClass: 'border-[#e49b30]',
        };
      case 'expenses':
        return {
          icon: '🛍️',
          sign: '-',
          colorClass: 'text-[#df6174]',
          bgClass: 'bg-[#ffe8e9]',
          borderClass: 'border-[#df6877]',
        };
      case 'loan':
        return { icon: '🤝', sign: '', colorClass: 'text-[#6753b5]', bgClass: 'bg-[#eeeaff]', borderClass: 'border-[#8b7bd1]' };
    }
  };

  // Generate & Download Pristine PDF
  const handleDownloadPDF = () => {
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const readableMonth = formatMonthReadable(selectedMonth);
      const randomQuote = MONEY_QUOTES[Math.floor(Math.random() * MONEY_QUOTES.length)];
      const pageMargin = 14;
      let y = 16;

      // 1. TOP MONEY QUOTE (Stylized Banner)
      doc.setFillColor(234, 246, 255); // light sky
      doc.roundedRect(pageMargin, y, 182, 14, 2, 2, 'F');
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(22, 75, 112);
      // Center quote text
      const quoteText = `"${randomQuote}"`;
      const splitQuote = doc.splitTextToSize(quoteText, 174);
      doc.text(splitQuote, 105, y + 8, { align: 'center' });

      y += 20;

      // 2. DOCUMENT HEADER
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(19, 135, 203); // MoneyMate blue
      doc.text('MoneyMate - Monthly Financial Statement', pageMargin, y);

      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120, 140, 155);
      doc.text(`Report Period: ${readableMonth}  |  Generated on: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, pageMargin, y);

      // User / Account Holder Details block
      y += 7;
      doc.setFillColor(248, 252, 255);
      doc.setDrawColor(214, 233, 246);
      doc.roundedRect(pageMargin, y, 182, 12, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(22, 75, 112);
      doc.text(`Account Holder: ${adminName || 'Admin'}`, pageMargin + 4, y + 8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(80, 110, 130);
      doc.text(`Family Account`, 140, y + 8);

      y += 18;

      // 3. TOP OVERALL FINANCIAL SUMMARY CARDS
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(22, 75, 112);
      doc.text('Monthly Overview Summary', pageMargin, y);

      y += 4;
      const cardW = 43;
      const cardH = 20;
      const gap = 3.3;

      // Card 1: Salary / Income
      doc.setFillColor(224, 248, 236); // green tint
      doc.setDrawColor(22, 167, 121);
      doc.roundedRect(pageMargin, y, cardW, cardH, 2, 2, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(17, 155, 112);
      doc.text('Overall Salary / Income', pageMargin + 3, y + 6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(17, 155, 112);
      doc.text(formatPDFAmount(totalIncome), pageMargin + 3, y + 14);

      // Card 2: Overall Savings
      const c2x = pageMargin + cardW + gap;
      doc.setFillColor(255, 245, 229); // orange tint
      doc.setDrawColor(228, 155, 48);
      doc.roundedRect(c2x, y, cardW, cardH, 2, 2, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(217, 130, 24);
      doc.text('Overall Monthly Savings', c2x + 3, y + 6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(217, 130, 24);
      doc.text(formatPDFAmount(totalSavings), c2x + 3, y + 14);

      // Card 3: Overall Expenses
      const c3x = c2x + cardW + gap;
      doc.setFillColor(255, 232, 233); // red tint
      doc.setDrawColor(223, 104, 119);
      doc.roundedRect(c3x, y, cardW, cardH, 2, 2, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(223, 97, 116);
      doc.text('Overall Monthly Expenses', c3x + 3, y + 6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(223, 97, 116);
      doc.text(formatPDFAmount(totalExpenses), c3x + 3, y + 14);

      // Card 4: Net Balance
      const c4x = c3x + cardW + gap;
      doc.setFillColor(225, 242, 255); // blue tint
      doc.setDrawColor(19, 137, 208);
      doc.roundedRect(c4x, y, cardW, cardH, 2, 2, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(19, 137, 208);
      doc.text('Net Available Balance', c4x + 3, y + 6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(balance >= 0 ? 17 : 200, balance >= 0 ? 155 : 40, balance >= 0 ? 112 : 40);
      doc.text(formatPDFAmount(balance), c4x + 3, y + 14);

      y += cardH + 10;

      // Helper function to draw table
      const drawCategoryTable = (
        title: string,
        categoryColHeader: string,
        data: { category: string; amount: number; percentage: number }[],
        themeColorRGB: [number, number, number],
        totalValue: number
      ) => {
        // Section title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(...themeColorRGB);
        doc.text(title, pageMargin, y);
        y += 4;

        // Table Header
        const tableW = 182;
        doc.setFillColor(...themeColorRGB);
        doc.rect(pageMargin, y, tableW, 6.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        doc.text('#', pageMargin + 3, y + 4.5);
        doc.text(categoryColHeader, pageMargin + 14, y + 4.5);
        doc.text('% Share', pageMargin + 115, y + 4.5, { align: 'right' });
        doc.text('Total Amount (INR)', pageMargin + tableW - 4, y + 4.5, { align: 'right' });
        y += 6.5;

        // Table Rows
        if (data.length === 0) {
          doc.setFillColor(252, 252, 252);
          doc.rect(pageMargin, y, tableW, 7, 'F');
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8);
          doc.setTextColor(150, 160, 170);
          doc.text('No entries recorded for this category in this month.', pageMargin + 6, y + 4.8);
          y += 7;
        } else {
          data.forEach((row, idx) => {
            const isAlt = idx % 2 === 1;
            doc.setFillColor(isAlt ? 248 : 255, isAlt ? 251 : 255, isAlt ? 254 : 255);
            doc.rect(pageMargin, y, tableW, 6.2, 'F');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(36, 74, 101);

            doc.text(String(idx + 1), pageMargin + 3, y + 4.5);
            doc.text(row.category, pageMargin + 14, y + 4.5);
            doc.text(`${row.percentage.toFixed(1)}%`, pageMargin + 115, y + 4.5, { align: 'right' });
            doc.setFont('helvetica', 'bold');
            doc.text(formatPDFAmount(row.amount), pageMargin + tableW - 4, y + 4.5, { align: 'right' });
            y += 6.2;
          });
        }

        // Table Footer / Subtotal
        doc.setFillColor(240, 245, 250);
        doc.rect(pageMargin, y, tableW, 6.5, 'F');
        doc.setDrawColor(210, 225, 238);
        doc.line(pageMargin, y, pageMargin + tableW, y);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...themeColorRGB);
        doc.text('Total', pageMargin + 14, y + 4.5);
        doc.text(formatPDFAmount(totalValue), pageMargin + tableW - 4, y + 4.5, { align: 'right' });
        y += 10;
      };

      // 4. CATEGORY-WISE EXPENSES TABLE
      const expenseBreakdown = getCategoryBreakdown('expenses');
      drawCategoryTable(
        '1. Expense Summary (Category-Wise Spending)',
        'Expense Category',
        expenseBreakdown.items,
        [223, 97, 116], // Red theme
        totalExpenses
      );

      // 5. CATEGORY-WISE SALARY & INCOME TABLE
      const incomeBreakdown = getCategoryBreakdown('income');
      drawCategoryTable(
        '2. Salary & Income Summary (Source-Wise)',
        'Income Source / Category',
        incomeBreakdown.items,
        [17, 155, 112], // Green theme
        totalIncome
      );

      // 6. CATEGORY-WISE SAVINGS TABLE
      const savingsBreakdown = getCategoryBreakdown('savings');
      drawCategoryTable(
        '3. Savings Summary (Purpose / Goal-Wise)',
        'Savings Purpose / Goal',
        savingsBreakdown.items,
        [217, 130, 24], // Orange theme
        totalSavings
      );

      // Loan summary with category-wise totals and outstanding balance
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(103, 83, 181);
      doc.text('4. Loan Summary (Category-Wise)', pageMargin, y);
      y += 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(45, 65, 85);
      y += 2;

      // Group all-time loan transactions by the category entered by the user
      const loanCategoryMap = new Map<string, { taken: number; repaid: number }>();
      transactions
        .filter(t => t.type === 'loan')
        .forEach(t => {
          const category = (t.category || 'Uncategorized Loan').trim() || 'Uncategorized Loan';
          const current = loanCategoryMap.get(category) || { taken: 0, repaid: 0 };
          if (t.loanAction === 'repaid') current.repaid += t.amount;
          else current.taken += t.amount;
          loanCategoryMap.set(category, current);
        });
      const loanCategoryRows = Array.from(loanCategoryMap.entries())
        .map(([category, values]) => ({
          category,
          taken: values.taken,
          repaid: values.repaid,
          outstanding: Math.max(0, values.taken - values.repaid),
        }))
        .sort((a, b) => b.outstanding - a.outstanding);

      // Category-wise table header
      const loanTableW = 182;
      const ensureLoanTableSpace = () => {
        if (y > 245) { doc.addPage(); y = 20; }
      };
      ensureLoanTableSpace();
      doc.setFillColor(103, 83, 181);
      doc.rect(pageMargin, y, loanTableW, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);
      doc.text('Loan Category', pageMargin + 3, y + 4.8);
      doc.text('Total Taken', pageMargin + 91, y + 4.8, { align: 'right' });
      doc.text('Total Repaid', pageMargin + 137, y + 4.8, { align: 'right' });
      doc.text('Outstanding', pageMargin + loanTableW - 3, y + 4.8, { align: 'right' });
      y += 7;

      if (loanCategoryRows.length === 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(140, 145, 155);
        doc.text('No loan entries recorded.', pageMargin + 3, y + 5);
        y += 8;
      } else {
        loanCategoryRows.forEach((row, idx) => {
          ensureLoanTableSpace();
          if (y === 20) {
            doc.setFillColor(103, 83, 181);
            doc.rect(pageMargin, y, loanTableW, 7, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(255, 255, 255);
            doc.text('Loan Category', pageMargin + 3, y + 4.8);
            doc.text('Total Taken', pageMargin + 91, y + 4.8, { align: 'right' });
            doc.text('Total Repaid', pageMargin + 137, y + 4.8, { align: 'right' });
            doc.text('Outstanding', pageMargin + loanTableW - 3, y + 4.8, { align: 'right' });
            y += 7;
          }
          doc.setFillColor(idx % 2 ? 248 : 255, idx % 2 ? 250 : 255, idx % 2 ? 253 : 255);
          doc.rect(pageMargin, y, loanTableW, 6.5, 'F');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(36, 74, 101);
          doc.text(doc.splitTextToSize(row.category, 68)[0], pageMargin + 3, y + 4.5);
          doc.text(formatPDFAmount(row.taken), pageMargin + 91, y + 4.5, { align: 'right' });
          doc.text(formatPDFAmount(row.repaid), pageMargin + 137, y + 4.5, { align: 'right' });
          doc.setFont('helvetica', 'bold');
          doc.text(formatPDFAmount(row.outstanding), pageMargin + loanTableW - 3, y + 4.5, { align: 'right' });
          y += 6.5;
        });
      }
      y += 4;

      // Check if we need page break or have enough room for notes & verification
      if (y > 230) {
        doc.addPage();
        y = 20;
      }

      // 7. USER NOTES & REFLECTIONS SECTION (Written remarks by user)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(22, 75, 112);
      doc.text('User Notes & Monthly Financial Reflections', pageMargin, y);
      y += 4;

      doc.setFillColor(252, 253, 255);
      doc.setDrawColor(215, 230, 242);
      doc.roundedRect(pageMargin, y, 182, 22, 2, 2, 'FD');

      // Subtle writing guidelines
      doc.setDrawColor(230, 240, 248);
      doc.line(pageMargin + 4, y + 8, pageMargin + 178, y + 8);
      doc.line(pageMargin + 4, y + 14, pageMargin + 178, y + 14);
      doc.line(pageMargin + 4, y + 20, pageMargin + 178, y + 20);

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(170, 185, 198);
      doc.text('(Use this section for offline notes, budgets, or personal remarks)', pageMargin + 5, y + 5);

      y += 28;

      // 8. FINAL REPORT VERIFICATION (User written sign-off)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(22, 75, 112);
      doc.text('Report Verification & Sign-off', pageMargin, y);
      y += 4;

      doc.setFillColor(248, 252, 255);
      doc.setDrawColor(214, 233, 246);
      doc.roundedRect(pageMargin, y, 182, 22, 2, 2, 'FD');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(50, 75, 95);
      doc.text(`Account Holder:  ${adminName || 'Admin'}`, pageMargin + 5, y + 7);
      doc.text(`Date Verified:   ____________________`, pageMargin + 5, y + 15);

      doc.text(`Verification Status:  Self-Verified Statement`, 110, y + 7);
      doc.text(`Signature:  ________________________`, 110, y + 15);

      // Footer
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(160, 175, 188);
      doc.text(`MoneyMate — Your Money, Your Control  |  Private & Confidential`, 105, 290, { align: 'center' });

      // Save PDF directly offline (no popup, no about:blank)
      const cleanFileName = `MoneyMate_Report_${selectedMonth}_${(adminName || 'Admin').replace(/\s+/g, '_')}.pdf`;
      doc.save(cleanFileName);
      showToast(`Monthly PDF report downloaded as ${cleanFileName}!`, 'success');
    } catch (err) {
      console.error('PDF generation error:', err);
      showToast('Could not generate PDF. Please try again.', 'error');
    }
  };

  // Lock screen (new device: connect GitHub + create a PIN; later visits: enter the PIN)
  if (!isLoggedIn) {
    const isSetup = !profile || !config;
    const inputCls = "w-full pl-10 pr-3.5 py-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none text-[#244a65] placeholder:text-gray-400 focus:border-[#168ed5] focus:ring-2 focus:ring-[#168ed5]/20 transition-all";
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#127dc0] via-[#359edc] to-[#65c3f6] relative overflow-hidden font-sans">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-blue-300/20 rounded-full blur-2xl pointer-events-none" />

        <div className="bg-white/95 backdrop-blur-md w-full max-w-[420px] p-8 sm:p-9 rounded-[28px] text-center shadow-[0_20px_50px_rgba(21,93,145,0.25)] border border-white/60 relative z-10 transition-all">
          <div className="w-[74px] h-[74px] mx-auto mb-3.5 rounded-[22px] bg-gradient-to-tr from-[#168ed5] to-[#83d4ff] flex items-center justify-center text-4xl shadow-[0_8px_20px_rgba(128,202,255,0.6)] text-white select-none">
            💰
          </div>

          <h1 className="text-3xl font-extrabold text-[#1685c5] tracking-tight">MoneyMate</h1>
          <p className="text-xs text-[#849bad] font-medium mt-1.5 mb-6">
            {isSetup ? 'Set up this device: connect your private GitHub data repository' : `Welcome back, ${profile?.name}`}
          </p>

          {authError && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs rounded-xl flex items-center gap-2 border border-red-200 text-left">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{authError}</span>
            </div>
          )}

          {authSuccess && (
            <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 text-xs rounded-xl flex items-center gap-2 border border-emerald-200 text-left">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{authSuccess}</span>
            </div>
          )}

          {isSetup && fromLink && (
            <div className="mb-4 p-3 bg-sky-50 text-[#1685c5] text-xs rounded-xl flex items-center gap-2 border border-sky-200 text-left">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Connection details were filled in from your setup link. Just add a family name and a PIN, then tap Connect &amp; Start.</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4 text-left">
            {isSetup && (
              <>
                <div>
                  <label className="block text-xs font-bold text-[#244a65] mb-1.5">Family / Display Name</label>
                  <div className="relative">
                    <input type="text" autoComplete="off" value={loginNameInput} onChange={e => setLoginNameInput(e.target.value)} placeholder="e.g. Our Family" required className={inputCls} />
                    <User className="w-4 h-4 text-[#849bad] absolute left-3.5 top-3.5 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#244a65] mb-1.5">GitHub username (owner of the data repo)</label>
                  <input type="text" autoComplete="off" autoCapitalize="none" value={setupOwner} onChange={e => setSetupOwner(e.target.value)} placeholder="e.g. marikaniaathi01" required className={inputCls.replace('pl-10', 'pl-3.5')} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#244a65] mb-1.5">Private data repository name</label>
                  <input type="text" autoComplete="off" autoCapitalize="none" value={setupRepo} onChange={e => setSetupRepo(e.target.value)} placeholder="moneymate-data" required className={inputCls.replace('pl-10', 'pl-3.5')} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#244a65] mb-1.5">GitHub access token</label>
                  <input type="password" autoComplete="off" autoCapitalize="none" value={setupToken} onChange={e => setSetupToken(e.target.value)} placeholder="github_pat_..." required className={inputCls.replace('pl-10', 'pl-3.5') + ' font-mono'} />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-bold text-[#244a65] mb-1.5">{isSetup ? 'Create PIN for this device (4-8 digits)' : 'PIN'}</label>
              <div className="relative">
                <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={loginPinInput} onChange={e => setLoginPinInput(e.target.value.replace(/\D/g, ''))} placeholder="Enter PIN" required className={inputCls + ' tracking-widest font-mono'} />
                <Lock className="w-4 h-4 text-[#849bad] absolute left-3.5 top-3.5 pointer-events-none" />
              </div>
            </div>

            {isSetup && (
              <div>
                <label className="block text-xs font-bold text-[#244a65] mb-1.5">Confirm PIN</label>
                <div className="relative">
                  <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={confirmPinInput} onChange={e => setConfirmPinInput(e.target.value.replace(/\D/g, ''))} placeholder="Enter PIN again" required className={inputCls + ' tracking-widest font-mono'} />
                  <Lock className="w-4 h-4 text-[#849bad] absolute left-3.5 top-3.5 pointer-events-none" />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={setupBusy}
              className="w-full py-3.5 px-4 mt-2 bg-gradient-to-r from-[#1389d0] to-[#62c4fa] hover:from-[#117fbf] hover:to-[#55b9ee] disabled:opacity-60 text-white font-bold text-sm rounded-xl shadow-[0_6px_16px_rgba(165,218,250,0.8)] active:translate-y-0.5 transition-all cursor-pointer"
            >
              {setupBusy ? 'Connecting…' : isSetup ? 'Connect & Start' : 'Unlock MoneyMate'}
            </button>
          </form>

          {!isSetup && (
            <button type="button" onClick={handleForgotPin} className="mt-4 text-xs text-[#168ed5] font-semibold hover:underline cursor-pointer">
              Forgot PIN?
            </button>
          )}

          <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-[#849bad] text-left leading-relaxed">
            <span className="flex items-center gap-1.5 font-semibold mb-2"><Lock className="w-3.5 h-3.5 text-emerald-500" /> Shared through your private GitHub repo</span>
            Records are saved in a private GitHub repository so every device shows the same data. The token and PIN stay on this device only.
          </div>
        </div>
      </div>
    );
  }

  // Filtered transactions for the history screens
  const renderHistoryList = (type: 'income' | 'savings' | 'expenses' | 'loan') => {
    let list = monthTransactions.filter(t => t.type === type);

    if (historyCategoryFilter !== 'all') {
      list = list.filter(t => t.category.toLowerCase() === historyCategoryFilter.toLowerCase());
    }

    if (historySearchQuery.trim()) {
      const q = historySearchQuery.toLowerCase();
      list = list.filter(t => t.category.toLowerCase().includes(q) || t.note.toLowerCase().includes(q));
    }

    list.sort((a, b) => b.date.localeCompare(a.date));

    const totalOfType = list.reduce((sum, t) => sum + t.amount, 0);
    const meta = getBadgeMeta(type);
    const availableCategories = Array.from(new Set(monthTransactions.filter(t => t.type === type).map(t => t.category)));

    return (
      <div className="space-y-4">
        {/* Month Summary Card with Download PDF trigger */}
        <div className={`p-5 rounded-2xl bg-white border border-[#e5f2fa] shadow-[0_6px_20px_rgba(71,141,181,0.08)] flex flex-wrap items-center justify-between gap-4 relative overflow-hidden`}>
          <div className="relative z-10">
            <span className="text-xs uppercase tracking-wider text-[#8199aa] font-semibold">
              Selected Month {type.charAt(0).toUpperCase() + type.slice(1)}
            </span>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-[#164b70] mt-1">
              {formatINR(totalOfType)}
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              {list.length} {list.length === 1 ? 'transaction' : 'transactions'} found for {formatMonthReadable(selectedMonth)}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleDownloadPDF}
              className="py-2.5 px-3.5 bg-gradient-to-r from-[#168ed5] to-[#4bb9f8] hover:brightness-105 text-white text-xs font-bold rounded-xl shadow-sm flex items-center gap-1.5 cursor-pointer"
              title="Download Full Monthly PDF"
            >
              <FileDown className="w-4 h-4" />
              <span>Download Report</span>
            </button>
            <div className={`w-12 h-12 rounded-2xl ${meta.bgClass} flex items-center justify-center text-2xl shadow-inner`}>
              {meta.icon}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-3.5 rounded-xl border border-[#e8f2f8] shadow-sm flex flex-wrap gap-2.5 items-center justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder={`Search in ${type}...`}
              value={historySearchQuery}
              onChange={e => setHistorySearchQuery(e.target.value)}
              className="w-full text-xs py-2 px-3 border border-[#d9eaf4] rounded-lg bg-[#f8fcff] outline-none text-[#164b70] focus:border-[#168ed5]"
            />
            {historySearchQuery && (
              <button
                onClick={() => setHistorySearchQuery('')}
                className="text-xs text-gray-400 hover:text-gray-600 px-1 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={historyCategoryFilter}
              onChange={e => setHistoryCategoryFilter(e.target.value)}
              className="text-xs py-2 px-3 border border-[#d9eaf4] rounded-lg bg-white text-[#164b70] outline-none focus:border-[#168ed5]"
            >
              <option value="all">All Categories</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>

        {/* List */}
        <div className="bg-white rounded-2xl border border-[#e8f2f8] shadow-[0_6px_20px_rgba(71,141,181,0.08)] p-4 sm:p-5">
          {list.length === 0 ? (
            <div className="text-center py-12 text-[#9aafbd]">
              <div className="text-3xl mb-2">{meta.icon}</div>
              <p className="text-sm font-medium">No {type} transactions found for this selection.</p>
              <button
                onClick={() => {
                  setEntryType(type);
                  setActivePage('entry');
                }}
                className="mt-3 text-xs text-[#168ed5] font-bold hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" /> Add new entry now
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[#edf2f6]">
              {list.map(tx => (
                <div key={tx.id} className="py-3 sm:py-3.5 flex items-center justify-between gap-3 group">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-10 h-10 rounded-xl ${meta.bgClass} flex items-center justify-center text-lg shrink-0`}>
                      {meta.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#164b70] truncate">
                        {tx.category}
                      </p>
                      <p className="text-xs text-[#8ba0af] truncate">
                        {tx.date} {tx.note ? ` • ${tx.note}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold whitespace-nowrap ${meta.colorClass}`}>
                      {meta.sign}{formatINR(tx.amount)}
                    </span>
                    <button
                      onClick={() => setDeleteModalId(tx.id)}
                      className="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center text-xs transition-colors cursor-pointer"
                      title="Delete transaction"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#edf7ff] text-[#244a65] font-sans pb-24 select-none sm:select-auto">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 py-2.5 px-4 rounded-xl shadow-lg flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-top-2 duration-200 ${
            toast.type === 'error'
              ? 'bg-red-600 text-white shadow-red-500/20'
              : toast.type === 'info'
              ? 'bg-[#164b70] text-white shadow-[#164b70]/20'
              : 'bg-emerald-600 text-white shadow-emerald-500/20'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalId && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 text-center animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 mx-auto flex items-center justify-center mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-[#164b70]">Delete Transaction?</h4>
            <p className="text-xs text-[#8199aa] mt-1 mb-5">
              This action cannot be undone. Are you sure you want to remove this record?
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setDeleteModalId(null)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDelete(deleteModalId)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-xs font-semibold text-white shadow-md shadow-red-500/20 cursor-pointer"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP INSPIRING QUOTE BANNER */}
      <div className="bg-gradient-to-r from-[#0d6fa8] via-[#168ed5] to-[#51bcf8] text-white text-[11px] py-1.5 px-4 text-center font-medium shadow-xs flex items-center justify-center gap-2">
        <Sparkles className="w-3.5 h-3.5 shrink-0 opacity-80" />
        <span className="truncate max-w-[850px]">{MONEY_QUOTES[0]}</span>
      </div>

      {/* APP HEADER */}
      <header className="bg-gradient-to-r from-[#1387cb] to-[#67c5f7] text-white py-3.5 px-4 sm:px-8 flex justify-between items-center shadow-[0_5px_18px_rgba(116,189,230,0.3)] sticky top-0 z-30">
        <div>
          <div className="text-xl sm:text-2xl font-extrabold flex items-center gap-1.5 tracking-tight">
            <span>💰</span> MoneyMate
          </div>
          <small className="block text-[11px] opacity-90 font-medium">Your Money, Your Control</small>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Quick PDF export in header */}
          <button
            onClick={handleDownloadPDF}
            className="py-1.5 px-3 rounded-xl border border-white/50 bg-white/20 hover:bg-white/30 text-white flex items-center gap-1.5 text-xs font-bold transition shadow-xs cursor-pointer"
            title="Download Monthly PDF Statement"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export PDF</span>
          </button>


          <button onClick={handleExportBackup} className="py-1.5 px-3 rounded-xl border border-white/50 bg-white/20 hover:bg-white/30 text-white text-xs font-bold" title="Download JSON backup">JSON Backup</button>
          <button onClick={() => document.getElementById('backup-file-input')?.click()} className="py-1.5 px-3 rounded-xl border border-white/50 bg-white/20 hover:bg-white/30 text-white text-xs font-bold" title="Import JSON backup">Import</button>
          <input id="backup-file-input" type="file" accept=".json,application/json" className="hidden" onChange={handleImportBackup} />

          <button
            onClick={() => setActivePage('home')}
            className={`p-2 sm:px-3 sm:py-1.5 rounded-xl border border-white/40 bg-white/15 hover:bg-white/25 text-white flex items-center gap-1.5 text-xs font-medium transition cursor-pointer ${
              activePage === 'home' ? 'ring-2 ring-white/60 bg-white/30' : ''
            }`}
            title="Home"
          >
            <Home className="w-4 h-4" />
          </button>

          <button
            onClick={handleLogout}
            className="p-2 sm:px-3 sm:py-1.5 rounded-xl border border-white/40 bg-white/15 hover:bg-white/25 text-white flex items-center gap-1.5 text-xs font-medium transition cursor-pointer"
            title="Lock"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* SYNC STATUS */}
      <div className="bg-white/80 border-b border-[#d7e9f5] text-[11px] text-[#587a92] px-4 sm:px-8 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={syncState === 'error' ? 'font-bold text-red-600' : 'font-bold text-[#168ed5]'}>
          {syncState === 'syncing' ? '⏳ Syncing…' : syncState === 'error' ? '⚠ Not synced' : syncState === 'ok' ? '✅ Synced' : '☁ GitHub storage'}
        </span>
        {config && <span className="opacity-70">{config.owner}/{config.repo}</span>}
        {syncState === 'ok' && lastSynced && <span className="opacity-70">at {lastSynced}</span>}
        {syncState === 'error' && syncMessage && <span className="text-red-600">{syncMessage}</span>}
        <button onClick={() => { void runSync(true); }} className="font-semibold text-[#168ed5] hover:underline cursor-pointer">Sync now</button>
        <button onClick={() => { void handleShareSetup(); }} className="font-semibold text-[#168ed5] hover:underline cursor-pointer">Share setup link</button>
        <button onClick={() => { void handleDisconnect(); }} className="font-semibold text-[#df6174] hover:underline cursor-pointer">Disconnect this device</button>
      </div>

      {/* MAIN CONTAINER */}
      <main className="max-w-[1080px] mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* HOME PAGE */}
        {activePage === 'home' && (
          <div className="space-y-6">
            {/* Welcome, Month Selector & PDF Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white/70 backdrop-blur-xs p-4 sm:p-5 rounded-2xl border border-white/80 shadow-xs">
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-[#164b70]">
                  Hello, {adminName || 'Admin'}! 👋
                </h2>
                <p className="text-xs text-[#8199aa] font-medium mt-0.5">
                  Here is your financial tracker overview for {formatMonthReadable(selectedMonth)}.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-[#d7e9f5] shadow-xs">
                  <Calendar className="w-4 h-4 text-[#168ed5]" />
                  <label htmlFor="monthPicker" className="text-xs font-semibold text-gray-500">Month:</label>
                  <input
                    id="monthPicker"
                    type="month"
                    value={selectedMonth}
                    onChange={e => setSelectedMonth(e.target.value)}
                    className="text-xs font-bold text-[#164b70] bg-transparent outline-none cursor-pointer"
                  />
                </div>

                <button
                  onClick={handleDownloadPDF}
                  className="py-2 px-3.5 bg-gradient-to-r from-[#119c70] to-[#34c798] hover:brightness-105 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-500/20 flex items-center gap-1.5 cursor-pointer active:translate-y-0.5 transition"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Download Monthly PDF</span>
                </button>
              </div>
            </div>

            {/* MONTHLY SUMMARY CARDS */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#164b70]">
                  Overall Monthly Summary ({formatMonthReadable(selectedMonth)})
                </h3>
                <span className="text-xs text-gray-400 font-medium">Click any card to inspect history</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
                {/* Expenses Card */}
                <div
                  onClick={() => setActivePage('expenses')}
                  className="p-5 rounded-2xl bg-white border border-[#e5f2fa] relative overflow-hidden shadow-[0_8px_20px_rgba(71,141,181,0.08)] hover:-translate-y-1 transition-all cursor-pointer group"
                >
                  <div className="absolute -top-7 -right-7 w-20 h-20 rounded-full bg-[#ffe8e9] pointer-events-none transition-transform group-hover:scale-110" />
                  <div className="w-10 h-10 rounded-xl bg-[#ffe8e9] flex items-center justify-center text-xl mb-3">
                    🛍️
                  </div>
                  <p className="text-xs text-[#8199aa] font-medium">Monthly Overall Expenses</p>
                  <h3 className="text-xl sm:text-2xl font-extrabold text-[#164b70] mt-1 break-words">
                    {formatINR(totalExpenses)}
                  </h3>
                  <small className="block mt-2 text-[11px] text-[#df6877] font-semibold flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" /> Money spent this month
                  </small>
                </div>

                {/* Savings Card */}
                <div
                  onClick={() => setActivePage('savings')}
                  className="p-5 rounded-2xl bg-white border border-[#e5f2fa] relative overflow-hidden shadow-[0_8px_20px_rgba(71,141,181,0.08)] hover:-translate-y-1 transition-all cursor-pointer group"
                >
                  <div className="absolute -top-7 -right-7 w-20 h-20 rounded-full bg-[#fff2db] pointer-events-none transition-transform group-hover:scale-110" />
                  <div className="w-10 h-10 rounded-xl bg-[#fff2db] flex items-center justify-center text-xl mb-3">
                    🐷
                  </div>
                  <p className="text-xs text-[#8199aa] font-medium">Monthly Overall Savings</p>
                  <h3 className="text-xl sm:text-2xl font-extrabold text-[#164b70] mt-1 break-words">
                    {formatINR(totalSavings)}
                  </h3>
                  <small className="block mt-2 text-[11px] text-[#e49b30] font-semibold flex items-center gap-1">
                    <PiggyBank className="w-3 h-3" /> Money saved this month
                  </small>
                </div>

                {/* Income Balance Card */}
                <div
                  onClick={() => setActivePage('income')}
                  className="p-5 rounded-2xl bg-white border border-[#e5f2fa] relative overflow-hidden shadow-[0_8px_20px_rgba(71,141,181,0.08)] hover:-translate-y-1 transition-all cursor-pointer group"
                >
                  <div className="absolute -top-7 -right-7 w-20 h-20 rounded-full bg-[#e1f2ff] pointer-events-none transition-transform group-hover:scale-110" />
                  <div className="w-10 h-10 rounded-xl bg-[#e1f2ff] flex items-center justify-center text-xl mb-3">
                    💵
                  </div>
                  <p className="text-xs text-[#8199aa] font-medium">Income Balance</p>
                  <h3 className={`text-xl sm:text-2xl font-extrabold mt-1 break-words ${balance >= 0 ? 'text-[#119b70]' : 'text-red-600'}`}>
                    {formatINR(balance)}
                  </h3>
                  <small className="block mt-2 text-[11px] text-[#8ba0af] font-medium flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-[#119b70]" /> Salary/Income ({formatINR(totalIncome)}) − exp − sav
                  </small>
                </div>
              </div>
              <div onClick={() => setActivePage('loan')} className="mt-4 p-5 rounded-2xl bg-white border border-[#e7e1ff] shadow-[0_8px_20px_rgba(71,141,181,0.08)] cursor-pointer hover:-translate-y-0.5 transition-all">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-xs font-semibold text-[#7d70b4]">Overall Outstanding Loan</p><h3 className="text-2xl font-extrabold text-[#6753b5] mt-1">{formatINR(outstandingLoan)}</h3><p className="text-[11px] text-[#8b82b8] mt-1">All-time loan balance after repayments</p></div>
                  <div className="text-right"><p className="text-xs text-[#8199aa]">Loan taken this month</p><strong className="text-[#6753b5]">{formatINR(totalLoanTaken)}</strong><p className="text-xs text-[#8199aa] mt-2">Closed / repaid this month</p><strong className="text-emerald-600">{formatINR(totalLoanRepaid)}</strong></div>
                </div>
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#164b70] mb-3">
                Quick Actions
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <button
                  onClick={() => {
                    setEntryType('expenses');
                    setActivePage('entry');
                  }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-[#178bcf] to-[#64c7fa] hover:brightness-105 active:translate-y-1 text-white shadow-[0_7px_0_rgba(0,0,0,0.08),0_10px_18px_rgba(40,106,153,0.18)] flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <span className="text-2xl">➕</span>
                  <strong className="text-xs font-bold">New Entry</strong>
                  <span className="text-[10px] opacity-80">Choose type</span>
                </button>

                <button
                  onClick={() => setActivePage('income')}
                  className="p-4 rounded-2xl bg-gradient-to-br from-[#119c70] to-[#50d2a2] hover:brightness-105 active:translate-y-1 text-white shadow-[0_7px_0_rgba(0,0,0,0.08),0_10px_18px_rgba(40,106,153,0.18)] flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <span className="text-2xl">💵</span>
                  <strong className="text-xs font-bold">Income</strong>
                  <span className="text-[10px] opacity-80">{formatINR(totalIncome)}</span>
                </button>

                <button
                  onClick={() => setActivePage('savings')}
                  className="p-4 rounded-2xl bg-gradient-to-br from-[#e99827] to-[#ffc46c] hover:brightness-105 active:translate-y-1 text-white shadow-[0_7px_0_rgba(0,0,0,0.08),0_10px_18px_rgba(40,106,153,0.18)] flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <span className="text-2xl">🐷</span>
                  <strong className="text-xs font-bold">Savings</strong>
                  <span className="text-[10px] opacity-80">{formatINR(totalSavings)}</span>
                </button>

                <button
                  onClick={() => setActivePage('expenses')}
                  className="p-4 rounded-2xl bg-gradient-to-br from-[#df6174] to-[#f59aaa] hover:brightness-105 active:translate-y-1 text-white shadow-[0_7px_0_rgba(0,0,0,0.08),0_10px_18px_rgba(40,106,153,0.18)] flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <span className="text-2xl">🛍️</span>
                  <strong className="text-xs font-bold">Expenses</strong>
                  <span className="text-[10px] opacity-80">{formatINR(totalExpenses)}</span>
                </button>
                <button onClick={() => { setEntryType('loan'); setActivePage('entry'); }} className="p-4 rounded-2xl bg-gradient-to-br from-[#6753b5] to-[#9a8ce0] text-white shadow-md flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer">
                  <span className="text-2xl">🤝</span><strong className="text-xs font-bold">Loan</strong><span className="text-[10px] opacity-80">{formatINR(outstandingLoan)}</span>
                </button>
              </div>
            </div>

            {/* CATEGORY-WISE EXPENSE PREVIEW (Highlights for quick understanding) */}
            <div className="bg-white p-5 sm:p-6 rounded-2xl border border-[#e8f2f8] shadow-[0_6px_20px_rgba(71,141,181,0.08)]">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h4 className="text-sm font-bold text-[#164b70] flex items-center gap-1.5">
                    <ShoppingBag className="w-4 h-4 text-[#df6877]" />
                    Monthly Expense by Category
                  </h4>
                  <p className="text-xs text-[#8ba0af]">
                    Shows exactly which category you spent money on in {formatMonthReadable(selectedMonth)}
                  </p>
                </div>
                <button
                  onClick={handleDownloadPDF}
                  className="text-xs font-bold text-[#168ed5] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" /> PDF Statement
                </button>
              </div>

              {getCategoryBreakdown('expenses').items.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs">
                  No expenses added yet for {formatMonthReadable(selectedMonth)}.
                </div>
              ) : (
                <div className="space-y-3">
                  {getCategoryBreakdown('expenses').items.map(cat => (
                    <div key={cat.category} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-[#164b70]">{cat.category}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[#8199aa]">{cat.percentage.toFixed(1)}%</span>
                          <span className="font-bold text-[#df6174]">{formatINR(cat.amount)}</span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full bg-[#f0f5fa] overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#e66b79] to-[#f49caa] rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(5, cat.percentage))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* MONTHLY SPENDING CHART */}
            <div className="bg-white p-5 sm:p-6 rounded-2xl border border-[#e8f2f8] shadow-[0_6px_20px_rgba(71,141,181,0.08)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-sm font-bold text-[#164b70] flex items-center gap-1.5">
                    <BarChart3 className="w-4 h-4 text-[#168bd1]" />
                    Expense History (6-Month Trend)
                  </h4>
                  <p className="text-xs text-[#8ba0af]">Interactive view of monthly expense history</p>
                </div>
                <span className="text-[11px] font-semibold text-[#168ed5] bg-[#eaf6ff] px-2.5 py-1 rounded-full">
                  6-Month Trend
                </span>
              </div>

              <div className="h-44 flex items-end gap-2 sm:gap-4 pt-4 border-b border-[#f1f6fa] pb-2">
                {chartData.months.map(m => {
                  const barHeight = m.value > 0 ? Math.max(12, (m.value / chartData.max) * 110) : 4;
                  const isCurrent = m.key === selectedMonth;

                  return (
                    <div key={m.key} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
                      <span className="text-[10px] font-bold text-[#63839a] truncate max-w-full">
                        {m.value > 0 ? '₹' + Math.round(m.value) : '₹0'}
                      </span>
                      <div
                        style={{ height: `${barHeight}px` }}
                        title={`${m.label}: ${formatINR(m.value)}`}
                        className={`w-full max-w-[36px] rounded-t-lg transition-all duration-300 ${
                          isCurrent
                            ? 'bg-gradient-to-t from-[#168bd1] to-[#66c5fa] shadow-[0_0_12px_rgba(102,197,250,0.5)]'
                            : 'bg-gradient-to-t from-[#8cbfe1] to-[#b7daf2] opacity-80 hover:opacity-100'
                        }`}
                      />
                      <small className={`text-[11px] font-medium ${isCurrent ? 'text-[#168bd1] font-bold' : 'text-[#879cac]'}`}>
                        {m.label}
                      </small>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-4 text-xs text-[#8196a5] mt-3 pt-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#168bd1] inline-block" />
                  Monthly Spending
                </span>
                <span className="text-[11px] text-gray-400">
                  Peak: {formatINR(chartData.max)}
                </span>
              </div>
            </div>

            {/* RECENT TRANSACTIONS */}
            <div className="bg-white p-5 sm:p-6 rounded-2xl border border-[#e8f2f8] shadow-[0_6px_20px_rgba(71,141,181,0.08)]">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-[#164b70] flex items-center gap-1.5">
                  <Receipt className="w-4 h-4 text-[#168bd1]" />
                  Recent Transactions ({formatMonthReadable(selectedMonth)})
                </h4>
                <button
                  onClick={() => {
                    setEntryType('expenses');
                    setActivePage('entry');
                  }}
                  className="text-xs font-bold text-[#168ed5] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> Add
                </button>
              </div>

              {monthTransactions.length === 0 ? (
                <div className="text-center py-8 text-[#9aafbd] text-xs">
                  No transactions recorded for {formatMonthReadable(selectedMonth)} yet.
                </div>
              ) : (
                <div className="divide-y divide-[#edf2f6]">
                  {monthTransactions
                    .slice()
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .slice(0, 5)
                    .map(tx => {
                      const meta = getBadgeMeta(tx.type);
                      return (
                        <div key={tx.id} className="py-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-xl ${meta.bgClass} flex items-center justify-center text-lg shrink-0`}>
                              {meta.icon}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[#164b70] truncate">
                                {tx.category}
                              </p>
                              <p className="text-xs text-[#8ba0af] truncate">
                                {tx.date} {tx.note ? ` • ${tx.note}` : ''}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className={`text-sm font-bold whitespace-nowrap ${meta.colorClass}`}>
                              {meta.sign}{formatINR(tx.amount)}
                            </span>
                            <button
                              onClick={() => setDeleteModalId(tx.id)}
                              className="w-7 h-7 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center text-xs transition cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ENTRY PAGE: SPLIT ONE BY ONE (USER CORRECTION) */}
        {activePage === 'entry' && (
          <div className="space-y-6 max-w-xl mx-auto">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-[#164b70]">➕ New Entry</h2>
                <p className="text-xs text-[#8299aa] font-medium mt-0.5">
                  Choose the entry type below to record your transaction.
                </p>
              </div>
              <button
                onClick={() => setActivePage('home')}
                className="text-xs font-bold text-[#168ed5] hover:underline cursor-pointer"
              >
                ← Back to Dashboard
              </button>
            </div>

            {/* OPTION SELECTOR: ONE-BY-ONE TOGGLE */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 bg-white rounded-2xl border border-[#d9eaf4] shadow-xs">
              <button
                type="button"
                onClick={() => setEntryType('income')}
                className={`py-3 px-2 rounded-xl text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  entryType === 'income'
                    ? 'bg-gradient-to-r from-[#119c70] to-[#36c295] text-white shadow-md shadow-emerald-500/20'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>💵</span>
                <span>Salary / Income</span>
              </button>

              <button
                type="button"
                onClick={() => setEntryType('savings')}
                className={`py-3 px-2 rounded-xl text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  entryType === 'savings'
                    ? 'bg-gradient-to-r from-[#e49b30] to-[#f4b659] text-white shadow-md shadow-amber-500/20'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>🐷</span>
                <span>Savings</span>
              </button>

              <button
                type="button"
                onClick={() => setEntryType('expenses')}
                className={`py-3 px-2 rounded-xl text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  entryType === 'expenses'
                    ? 'bg-gradient-to-r from-[#df6877] to-[#f294a2] text-white shadow-md shadow-rose-500/20'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>🛍️</span>
                <span>Expense</span>
              </button>
              <button type="button" onClick={() => setEntryType('loan')} className={`py-3 px-2 rounded-xl text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-1.5 transition-all cursor-pointer ${entryType === 'loan' ? 'bg-gradient-to-r from-[#6753b5] to-[#9a8ce0] text-white shadow-md' : 'text-gray-600 hover:bg-gray-50'}`}><span>🤝</span><span>Loan</span></button>
            </div>

            {/* ONLY ONE FORM SHOWN AT A TIME BASED ON SELECTION */}
            <div className="transition-all duration-200">
              {/* 1. INCOME / SALARY FORM */}
              {entryType === 'income' && (
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    handleAddTransaction(
                      'income',
                      incomeForm.amount,
                      incomeForm.category,
                      incomeForm.date,
                      incomeForm.note,
                      () => setIncomeForm({ amount: '', category: '', date: currentDateString(), note: '' })
                    );
                  }}
                  className="bg-white p-6 sm:p-7 rounded-2xl border-t-4 border-[#16a779] border-x border-b border-[#e5f2fa] shadow-[0_8px_25px_rgba(71,141,181,0.09)] space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 className="text-base font-bold text-[#16a779] flex items-center gap-2">
                      <span className="text-2xl">💵</span> Salary & Income Entry
                    </h3>
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                      Increases Balance
                    </span>
                  </div>

                  <div className="space-y-4 text-xs text-[#244a65]">
                    <div>
                      <label className="block font-bold mb-1.5">Amount (₹) *</label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        placeholder="e.g. 60000"
                        value={incomeForm.amount}
                        onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#16a779] focus:ring-2 focus:ring-[#16a779]/20"
                      />
                    </div>

                    <div>
                      <label className="block font-bold mb-1.5">Income Source / Category *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Monthly Salary, Freelance, Dividend, Bonus"
                        value={incomeForm.category}
                        onChange={e => setIncomeForm({ ...incomeForm, category: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#16a779] focus:ring-2 focus:ring-[#16a779]/20"
                      />
                    </div>

                    <div>
                      <label className="block font-bold mb-1.5">Received Date *</label>
                      <input
                        type="date"
                        required
                        value={incomeForm.date}
                        onChange={e => setIncomeForm({ ...incomeForm, date: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#16a779] focus:ring-2 focus:ring-[#16a779]/20"
                      />
                    </div>

                    <div>
                      <label className="block font-bold mb-1.5">Notes / Description (Optional)</label>
                      <input
                        type="text"
                        placeholder="Bank account, company name, reference number..."
                        value={incomeForm.note}
                        onChange={e => setIncomeForm({ ...incomeForm, note: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#16a779] focus:ring-2 focus:ring-[#16a779]/20"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full mt-4 py-3.5 px-4 bg-gradient-to-r from-[#119c70] to-[#50d2a2] hover:brightness-105 text-white font-bold text-sm rounded-xl shadow-md shadow-emerald-500/20 active:translate-y-0.5 transition cursor-pointer"
                  >
                    Save Salary / Income
                  </button>
                </form>
              )}

              {/* 2. SAVINGS FORM */}
              {entryType === 'savings' && (
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    handleAddTransaction(
                      'savings',
                      savingsForm.amount,
                      savingsForm.category,
                      savingsForm.date,
                      savingsForm.note,
                      () => setSavingsForm({ amount: '', category: '', date: currentDateString(), note: '' })
                    );
                  }}
                  className="bg-white p-6 sm:p-7 rounded-2xl border-t-4 border-[#e49b30] border-x border-b border-[#e5f2fa] shadow-[0_8px_25px_rgba(71,141,181,0.09)] space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 className="text-base font-bold text-[#e49b30] flex items-center gap-2">
                      <span className="text-2xl">🐷</span> Savings Entry
                    </h3>
                    <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
                      Wealth Building
                    </span>
                  </div>

                  <div className="space-y-4 text-xs text-[#244a65]">
                    <div>
                      <label className="block font-bold mb-1.5">Amount (₹) *</label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        placeholder="e.g. 15000"
                        value={savingsForm.amount}
                        onChange={e => setSavingsForm({ ...savingsForm, amount: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#e49b30] focus:ring-2 focus:ring-[#e49b30]/20"
                      />
                    </div>

                    <div>
                      <label className="block font-bold mb-1.5">Savings Purpose / Goal *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Emergency Fund, Fixed Deposit, Gold, Retirement, Mutual Fund"
                        value={savingsForm.category}
                        onChange={e => setSavingsForm({ ...savingsForm, category: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#e49b30] focus:ring-2 focus:ring-[#e49b30]/20"
                      />
                    </div>

                    <div>
                      <label className="block font-bold mb-1.5">Date Saved *</label>
                      <input
                        type="date"
                        required
                        value={savingsForm.date}
                        onChange={e => setSavingsForm({ ...savingsForm, date: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#e49b30] focus:ring-2 focus:ring-[#e49b30]/20"
                      />
                    </div>

                    <div>
                      <label className="block font-bold mb-1.5">Notes (Optional)</label>
                      <input
                        type="text"
                        placeholder="Target bank account, maturity details, remarks..."
                        value={savingsForm.note}
                        onChange={e => setSavingsForm({ ...savingsForm, note: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#e49b30] focus:ring-2 focus:ring-[#e49b30]/20"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full mt-4 py-3.5 px-4 bg-gradient-to-r from-[#e99827] to-[#ffc46c] hover:brightness-105 text-white font-bold text-sm rounded-xl shadow-md shadow-amber-500/20 active:translate-y-0.5 transition cursor-pointer"
                  >
                    Save Savings
                  </button>
                </form>
              )}

              {/* 3. EXPENSE FORM */}
              {entryType === 'expenses' && (
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    handleAddTransaction(
                      'expenses',
                      expenseForm.amount,
                      expenseForm.category,
                      expenseForm.date,
                      expenseForm.note,
                      () => setExpenseForm({ amount: '', category: '', date: currentDateString(), note: '' })
                    );
                  }}
                  className="bg-white p-6 sm:p-7 rounded-2xl border-t-4 border-[#df6877] border-x border-b border-[#e5f2fa] shadow-[0_8px_25px_rgba(71,141,181,0.09)] space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 className="text-base font-bold text-[#df6877] flex items-center gap-2">
                      <span className="text-2xl">🛍️</span> Expense Entry
                    </h3>
                    <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full">
                      Track Outflow
                    </span>
                  </div>

                  <div className="space-y-4 text-xs text-[#244a65]">
                    <div>
                      <label className="block font-bold mb-1.5">Amount (₹) *</label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        placeholder="e.g. 1850"
                        value={expenseForm.amount}
                        onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#df6877] focus:ring-2 focus:ring-[#df6877]/20"
                      />
                    </div>

                    <div>
                      <label className="block font-bold mb-1.5">Expense Category *</label>
                      <select
                        required
                        value={expenseForm.category}
                        onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#df6877] focus:ring-2 focus:ring-[#df6877]/20 cursor-pointer"
                      >
                        <option value="">Select category</option>
                        <option value="Food & Dining">Food & Dining</option>
                        <option value="Groceries">Groceries & Supermarket</option>
                        <option value="Travel & Fuel">Travel & Fuel</option>
                        <option value="Shopping & Clothes">Shopping & Clothes</option>
                        <option value="Bills & Utilities">Bills & Utilities (Electricity, Water, WiFi)</option>
                        <option value="Housing & Rent">Housing & Rent</option>
                        <option value="Education">Education & Books</option>
                        <option value="Health & Medicine">Health & Medicine</option>
                        <option value="Entertainment">Entertainment & Movies</option>
                        <option value="Personal Care">Personal Care</option>
                        <option value="Other">Other Expenses</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-bold mb-1.5">Date of Expense *</label>
                      <input
                        type="date"
                        required
                        value={expenseForm.date}
                        onChange={e => setExpenseForm({ ...expenseForm, date: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#df6877] focus:ring-2 focus:ring-[#df6877]/20"
                      />
                    </div>

                    <div>
                      <label className="block font-bold mb-1.5">Notes / Purpose (Optional)</label>
                      <input
                        type="text"
                        placeholder="Vendor name, bill number, or specific item..."
                        value={expenseForm.note}
                        onChange={e => setExpenseForm({ ...expenseForm, note: e.target.value })}
                        className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#df6877] focus:ring-2 focus:ring-[#df6877]/20"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full mt-4 py-3.5 px-4 bg-gradient-to-r from-[#df6174] to-[#f59aaa] hover:brightness-105 text-white font-bold text-sm rounded-xl shadow-md shadow-rose-500/20 active:translate-y-0.5 transition cursor-pointer"
                  >
                    Save Expense
                  </button>
                </form>
              )}

              {entryType === 'loan' && (
                <form onSubmit={e => { e.preventDefault(); handleAddTransaction('loan', loanForm.amount, loanForm.category || 'Personal Loan', loanForm.date, loanForm.note, () => setLoanForm({ action: 'taken', amount: '', category: '', date: currentDateString(), note: '' })); }} className="bg-white p-6 sm:p-7 rounded-2xl border-t-4 border-[#8b7bd1] border-x border-b border-[#e5f2fa] shadow-[0_8px_25px_rgba(71,141,181,0.09)] space-y-4">
                  <div className="border-b border-gray-100 pb-3"><h3 className="text-base font-bold text-[#6753b5] flex items-center gap-2"><span className="text-2xl">🤝</span> Loan Entry</h3><p className="text-xs text-gray-500 mt-1">Record a new loan or a repayment made towards an existing loan.</p></div>
                  <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setLoanForm({ ...loanForm, action: 'taken' })} className={`p-3 rounded-xl text-xs font-bold ${loanForm.action === 'taken' ? 'bg-[#6753b5] text-white' : 'bg-gray-100 text-gray-600'}`}>New Loan / Borrowed</button><button type="button" onClick={() => setLoanForm({ ...loanForm, action: 'repaid' })} className={`p-3 rounded-xl text-xs font-bold ${loanForm.action === 'repaid' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Loan Repayment</button></div>
                  <div><label className="block text-xs font-bold text-[#244a65] mb-1.5">{loanForm.action === 'taken' ? 'Loan Amount (₹) *' : 'Repayment Amount (₹) *'}</label><input type="number" min="0.01" step="0.01" required value={loanForm.amount} onChange={e => setLoanForm({ ...loanForm, amount: e.target.value })} placeholder="Enter amount" className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#8b7bd1]" /></div>
                  <div><label className="block text-xs font-bold text-[#244a65] mb-1.5">Lender / Loan Name *</label><input required value={loanForm.category} onChange={e => setLoanForm({ ...loanForm, category: e.target.value })} placeholder="e.g. Bank, Friend, Personal loan" className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none focus:border-[#8b7bd1]" /></div>
                  <div><label className="block text-xs font-bold text-[#244a65] mb-1.5">Date *</label><input type="date" required value={loanForm.date} onChange={e => setLoanForm({ ...loanForm, date: e.target.value })} className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none" /></div>
                  <div><label className="block text-xs font-bold text-[#244a65] mb-1.5">Notes (Optional)</label><input value={loanForm.note} onChange={e => setLoanForm({ ...loanForm, note: e.target.value })} placeholder="Reference or repayment details" className="w-full p-3 text-sm bg-[#f8fcff] border border-[#d6e9f6] rounded-xl outline-none" /></div>
                  <button type="submit" className="w-full py-3.5 px-4 bg-gradient-to-r from-[#6753b5] to-[#9a8ce0] text-white font-bold text-sm rounded-xl shadow-md">{loanForm.action === 'taken' ? 'Save Loan' : 'Save Repayment'}</button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* INCOME PAGE */}
        {activePage === 'income' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-[#164b70]">💵 Income History</h2>
                <p className="text-xs text-[#8299aa] font-medium mt-0.5">
                  Track and review all your earnings, salaries, and receipts.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPDF}
                  className="py-2 px-3.5 rounded-xl border border-[#d6e9f6] bg-white text-[#168ed5] hover:bg-[#f8fcff] text-xs font-bold shadow-xs flex items-center gap-1 cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" /> Statement PDF
                </button>
                <button
                  onClick={() => {
                    setEntryType('income');
                    setActivePage('entry');
                  }}
                  className="py-2 px-3.5 rounded-xl bg-[#119c70] text-white text-xs font-bold shadow-sm flex items-center gap-1 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> Add Income
                </button>
              </div>
            </div>
            {renderHistoryList('income')}
          </div>
        )}

        {/* SAVINGS PAGE */}
        {activePage === 'savings' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-[#164b70]">🐷 Savings History</h2>
                <p className="text-xs text-[#8299aa] font-medium mt-0.5">
                  Track your monthly savings and wealth building goals.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPDF}
                  className="py-2 px-3.5 rounded-xl border border-[#d6e9f6] bg-white text-[#168ed5] hover:bg-[#f8fcff] text-xs font-bold shadow-xs flex items-center gap-1 cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" /> Statement PDF
                </button>
                <button
                  onClick={() => {
                    setEntryType('savings');
                    setActivePage('entry');
                  }}
                  className="py-2 px-3.5 rounded-xl bg-[#e49b30] text-white text-xs font-bold shadow-sm flex items-center gap-1 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> Add Savings
                </button>
              </div>
            </div>
            {renderHistoryList('savings')}
          </div>
        )}

        {/* EXPENSES PAGE */}
        {activePage === 'expenses' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-[#164b70]">🛍️ Expense History</h2>
                <p className="text-xs text-[#8299aa] font-medium mt-0.5">
                  Analyze every rupee spent category-wise in {formatMonthReadable(selectedMonth)}.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPDF}
                  className="py-2 px-3.5 rounded-xl border border-[#d6e9f6] bg-white text-[#168ed5] hover:bg-[#f8fcff] text-xs font-bold shadow-xs flex items-center gap-1 cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" /> Statement PDF
                </button>
                <button
                  onClick={() => {
                    setEntryType('expenses');
                    setActivePage('entry');
                  }}
                  className="py-2 px-3.5 rounded-xl bg-[#df6174] text-white text-xs font-bold shadow-sm flex items-center gap-1 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> Add Expense
                </button>
              </div>
            </div>
            {renderHistoryList('expenses')}
          </div>
        )}

        {activePage === 'loan' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl sm:text-2xl font-extrabold text-[#6753b5]">🤝 Loan Management</h2><p className="text-xs text-[#8299aa] mt-1">Track loans taken and repayments.</p></div><button onClick={() => { setEntryType('loan'); setActivePage('entry'); }} className="px-4 py-2 rounded-xl bg-[#6753b5] text-white text-xs font-bold">+ Add Loan Entry</button></div>
            <div className="grid sm:grid-cols-3 gap-3"><div className="bg-white p-5 rounded-2xl border border-[#e7e1ff]"><p className="text-xs text-gray-500">Total Loans Taken (All Time)</p><strong className="block text-xl text-[#6753b5] mt-2">{formatINR(overallLoanTaken)}</strong></div><div className="bg-white p-5 rounded-2xl border border-emerald-100"><p className="text-xs text-gray-500">Repaid This Month</p><strong className="block text-xl text-emerald-600 mt-2">{formatINR(totalLoanRepaid)}</strong></div><div className="bg-white p-5 rounded-2xl border border-rose-100"><p className="text-xs text-gray-500">Outstanding Loan</p><strong className="block text-xl text-rose-600 mt-2">{formatINR(outstandingLoan)}</strong></div></div>

            <div className="bg-white p-5 rounded-2xl border border-[#e7e1ff]"><h3 className="font-bold text-[#6753b5] mb-3">Loan Entries</h3>{monthTransactions.filter(t=>t.type==='loan').length === 0 ? <p className="text-xs text-gray-400">No loan entries for this month.</p> : <div className="space-y-2">{monthTransactions.filter(t=>t.type==='loan').sort((a,b)=>b.date.localeCompare(a.date)).map(t=><div key={t.id} className="flex flex-wrap justify-between gap-2 border-b border-gray-100 py-2 text-sm"><div><strong>{t.category}</strong><p className="text-xs text-gray-400">{t.date} · {t.loanAction === 'repaid' ? 'Repayment' : 'Loan taken'} {t.note ? `· ${t.note}` : ''}</p></div><strong className={t.loanAction==='repaid'?'text-emerald-600':'text-[#6753b5]'}>{formatINR(t.amount)}</strong><button onClick={()=>setDeleteModalId(t.id)} className="text-rose-500 text-xs">Delete</button></div>)}</div>}</div>
            <button onClick={handleDownloadPDF} className="px-4 py-2 rounded-xl bg-[#168ed5] text-white text-xs font-bold"><FileDown className="inline w-4 h-4 mr-1"/> Download PDF Statement</button>
          </div>
        )}
      </main>

      {/* BOTTOM NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-[#e2eef6] shadow-[0_-5px_20px_rgba(53,107,138,0.1)] px-2 py-2 sm:py-2.5 z-40">
        <div className="max-w-[600px] mx-auto flex justify-around items-center">
          <button
            onClick={() => setActivePage('home')}
            className={`flex flex-col items-center gap-1 text-[11px] font-semibold py-1 px-3 rounded-xl transition cursor-pointer ${
              activePage === 'home' ? 'text-[#168bd1]' : 'text-[#91a7b7] hover:text-[#164b70]'
            }`}
          >
            <span className="text-xl">🏠</span>
            <span>Home</span>
          </button>

          <button
            onClick={() => {
              setActivePage('entry');
            }}
            className={`flex flex-col items-center gap-1 text-[11px] font-semibold py-1 px-3 rounded-xl transition cursor-pointer ${
              activePage === 'entry' ? 'text-[#168bd1]' : 'text-[#91a7b7] hover:text-[#164b70]'
            }`}
          >
            <span className="text-xl">➕</span>
            <span>Entry</span>
          </button>

          <button
            onClick={() => {
              setActivePage('income');
              setHistoryCategoryFilter('all');
              setHistorySearchQuery('');
            }}
            className={`flex flex-col items-center gap-1 text-[11px] font-semibold py-1 px-3 rounded-xl transition cursor-pointer ${
              activePage === 'income' ? 'text-[#168bd1]' : 'text-[#91a7b7] hover:text-[#164b70]'
            }`}
          >
            <span className="text-xl">💵</span>
            <span>Income</span>
          </button>

          <button
            onClick={() => {
              setActivePage('savings');
              setHistoryCategoryFilter('all');
              setHistorySearchQuery('');
            }}
            className={`flex flex-col items-center gap-1 text-[11px] font-semibold py-1 px-3 rounded-xl transition cursor-pointer ${
              activePage === 'savings' ? 'text-[#168bd1]' : 'text-[#91a7b7] hover:text-[#164b70]'
            }`}
          >
            <span className="text-xl">🐷</span>
            <span>Savings</span>
          </button>

          <button
            onClick={() => {
              setActivePage('expenses');
              setHistoryCategoryFilter('all');
              setHistorySearchQuery('');
            }}
            className={`flex flex-col items-center gap-1 text-[11px] font-semibold py-1 px-3 rounded-xl transition cursor-pointer ${
              activePage === 'expenses' ? 'text-[#168bd1]' : 'text-[#91a7b7] hover:text-[#164b70]'
            }`}
          >
            <span className="text-xl">🛍️</span>
            <span>Expenses</span>
          </button>
          <button onClick={() => setActivePage('loan')} className={`flex flex-col items-center gap-1 text-[11px] font-semibold py-1 px-3 rounded-xl transition cursor-pointer ${activePage === 'loan' ? 'text-[#6753b5]' : 'text-[#91a7b7] hover:text-[#164b70]'}`}><span className="text-xl">🤝</span><span>Loan</span></button>
        </div>
      </nav>
    </div>
  );
}
