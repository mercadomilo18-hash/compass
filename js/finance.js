// Read-only money tracking: bank CSV import (TD format first), categories, budgets,
// recurring bills/subscriptions, unusual spending and an end-of-month forecast.
// Compass never moves money; it only reads what you import or connect read-only.

import { parseCSV, pad, dayKey, parseLocal, startOfDay, startOfWeek, addDays } from './util.js';

export const CATEGORIES = {
  Income: { income: true }, Transfers: { skip: true },
  Rent: { fixed: true }, 'Phone & Internet': { fixed: true }, Subscriptions: { fixed: true }, Insurance: { fixed: true },
  Groceries: {}, Dining: {}, Transport: {}, Shopping: {}, Entertainment: {}, Education: {}, Health: {}, Giving: {}, Fees: {}, Other: {},
};

const DEFAULT_RULES = [
  ['Income', /payroll|pay\s?dep|direct dep|salary|osap|gst|canada fed|cra\b|refund/],
  ['Transfers', /\btfr\b|transfer|payment - thank|payment received|pymt|e-tfr|etfr|interac e|to savings|from savings|visa payment|mc payment|credit card payment/],
  ['Rent', /\brent\b|landlord|property mgmt/],
  ['Phone & Internet', /rogers|bell canada|\bbell\b|fido|koodo|virgin plus|virgin mobile|freedom mob|telus|public mobile|chatr|lucky mobile|cogeco|start\.ca|teksavvy/],
  ['Subscriptions', /netflix|spotify|disney|apple\.com\/bill|itunes|google \*|youtube|prime video|amazon prime|amzn prime|crave|paramount|xbox|playstation|nintendo|audible|patreon|chatgpt|openai|anthropic|adobe|microsoft\*|dropbox|icloud|duolingo|gym|goodlife|planet fitness|fit4less/],
  ['Insurance', /insurance|intact|desjardins|belair|td insur|sonnet/],
  ['Groceries', /no frills|nofrills|food basics|fortinos|metro\b|sobeys|freshco|loblaw|zehrs|costco|farm boy|walmart supercenter|real canadian|superstore|giant tiger|longo|t&t|fresh market|bulk barn/],
  ['Dining', /tim hortons|tims\b|mcdonald|starbucks|subway|a&w|a & w|uber\s?eats|doordash|skip the dishes|skipthedishes|pizza|wendy|harvey|popeyes|chipotle|kfc|burger|mary brown|osmow|barburrito|second cup|coffee|cafe|restaurant|sushi|shawarma|pho|domino|pita pit|dairy queen|taco bell|freshii|mucho|chick-fil|five guys|boston pizza|east side mario|kelseys|montana/],
  ['Transport', /hsr\b|presto|go transit|uber(?!\s?eats)|lyft|esso|petro|shell|pioneer|ultramar|circle k|husky|canadian tire gas|gas bar|parking|impark|greenp|honk|via rail|flixbus/],
  ['Education', /mohawk|campus store|bookstore|pearson|mcgraw|cengage|chegg|quizlet|course hero/],
  ['Health', /shoppers drug|rexall|pharma|pharmacy|dental|dentist|clinic|optical|physio|guardian|ida\b/],
  ['Giving', /church|tithe|tithely|donat|charity|canadahelps|offering/],
  ['Entertainment', /cineplex|landmark cinema|steam|ticketmaster|eventbrite|bowling|arcade|apple\.com(?!\/bill)/],
  ['Shopping', /amazon|amzn|walmart|dollarama|winners|marshalls|best buy|shein|temu|ikea|canadian tire|h&m|zara|old navy|sport chek|indigo|staples|home depot|lowe|simons|ardene|aritzia|lululemon|nike|apple store|the source/],
  ['Fees', /\bfee\b|service charge|monthly fee|interest charge|overdraft|nsf|annual fee|atm fee/],
];

export function categorize(fin, desc, amount) {
  const d = desc.toLowerCase();
  const rule = fin.rules.find((r) => d.includes(r.match));
  if (rule) return rule.category;
  const hit = DEFAULT_RULES.find(([, re]) => re.test(d));
  if (hit) return hit[0];
  return amount > 0 ? 'Income' : 'Other';
}

// "TIM HORTONS #1234 HAMILTON" -> "tim hortons hamilton"
export const merchantKey = (desc) => desc.toLowerCase().replace(/[#*]\s*\w*\d\w*/g, ' ').replace(/\d+/g, ' ').replace(/[^a-z&.' ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
export const merchantName = (desc) => desc.replace(/\*+\s*\w*/g, ' ').replace(/#\s*\w+/g, ' ').replace(/\b[a-z]*\d{3,}\w*\b/gi, ' ')
  .replace(/\s{2,}/g, ' ').trim().replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()) || desc;

function toDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // TD: MM/DD/YYYY
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return null;
}
const money = (s) => { const v = parseFloat(String(s || '').replace(/[$,\s]/g, '')); return isNaN(v) ? 0 : v; };

// Parses TD EasyWeb CSV (no header: Date, Description, Debit, Credit, Balance) or a generic CSV with headers.
export function parseBankCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { txns: [], balance: null };
  let map;
  if (toDate(rows[0][0])) {
    map = { date: 0, desc: 1, debit: 2, credit: 3, balance: 4 };
  } else {
    const head = rows.shift().map((x) => x.trim().toLowerCase());
    const col = (...n) => head.findIndex((x) => n.some((k) => x.includes(k)));
    map = { date: col('date'), desc: col('description', 'merchant', 'payee', 'details', 'name'), amount: col('amount'), debit: col('debit', 'withdraw'), credit: col('credit', 'deposit'), balance: col('balance') };
    if (map.date < 0 || map.desc < 0) throw new Error('Couldn’t find Date and Description columns');
  }
  const seen = {};
  const txns = [];
  let balance = null, balanceDate = '';
  for (const r of rows) {
    const date = toDate(r[map.date]);
    if (!date) continue;
    const desc = (r[map.desc] || '').trim();
    const amount = map.amount >= 0 && r[map.amount]?.trim() ? money(r[map.amount]) : money(r[map.credit]) - money(r[map.debit]);
    const base = `${date}|${desc}|${amount.toFixed(2)}`;
    seen[base] = (seen[base] || 0) + 1;
    txns.push({ date, desc, amount: Math.round(amount * 100) / 100, key: `${base}|${seen[base]}` });
    if (map.balance >= 0 && r[map.balance]?.trim() && date >= balanceDate) { balance = money(r[map.balance]); balanceDate = date; }
  }
  return { txns, balance, balanceDate };
}

// Merge by stable key so overlapping imports never duplicate.
export function importTxns(fin, accountId, parsed) {
  const have = new Set(fin.txns.map((t) => t.uid));
  let added = 0;
  for (const t of parsed.txns) {
    const uid = `${accountId}|${t.key}`;
    if (have.has(uid)) continue;
    fin.txns.push({ id: crypto.randomUUID?.() || uid, uid, accountId, date: t.date, desc: t.desc, amount: t.amount, category: categorize(fin, t.desc, t.amount) });
    added++;
  }
  const acct = fin.accounts.find((a) => a.id === accountId);
  if (acct && parsed.balance != null && (!acct.asOf || parsed.balanceDate >= acct.asOf)) { acct.balance = parsed.balance; acct.asOf = parsed.balanceDate; }
  fin.txns.sort((a, b) => b.date.localeCompare(a.date));
  return added;
}

export function setCategory(fin, txnId, category, always) {
  const t = fin.txns.find((x) => x.id === txnId);
  if (!t) return;
  t.category = category;
  if (always) {
    const match = merchantKey(t.desc);
    fin.rules = fin.rules.filter((r) => r.match !== match);
    fin.rules.unshift({ match, category });
    fin.txns.forEach((x) => { if (merchantKey(x.desc) === match) x.category = category; });
  }
}

const isSpend = (t) => t.amount < 0 && !CATEGORIES[t.category]?.skip && !CATEGORIES[t.category]?.income;
const isDiscretionary = (t) => isSpend(t) && !CATEGORIES[t.category]?.fixed;
const inRange = (t, from, to) => { const d = parseLocal(t.date); return d >= from && d < to; };
const sum = (list) => list.reduce((a, t) => a + Math.abs(t.amount), 0);
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function weekStatus(fin, now = new Date()) {
  const from = startOfWeek(now), to = addDays(from, 7);
  const spent = sum(fin.txns.filter((t) => isDiscretionary(t) && inRange(t, from, to)));
  const allowance = +fin.weeklyAllowance || 0;
  const daysLeft = Math.max(1, Math.round((to - startOfDay(now)) / 86400000));
  return { spent, allowance, left: allowance - spent, perDay: (allowance - spent) / daysLeft, daysLeft, from, to };
}

export function monthStatus(fin, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const month = fin.txns.filter((t) => inRange(t, from, to));
  const byCat = {};
  month.filter(isSpend).forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + Math.abs(t.amount); });
  const cats = Object.keys({ ...byCat, ...fin.budgets }).filter((c) => byCat[c] || +fin.budgets[c])
    .map((c) => ({ name: c, spent: byCat[c] || 0, budget: +fin.budgets[c] || 0 }))
    .sort((a, b) => b.spent - a.spent);
  return {
    from, to, cats,
    spent: sum(month.filter(isSpend)),
    income: month.filter((t) => t.amount > 0 && CATEGORIES[t.category]?.income).reduce((a, t) => a + t.amount, 0),
  };
}

// Everyday categories repeat by habit, not by bill; don't treat them as bills.
const NOT_BILLS = new Set(['Groceries', 'Dining', 'Transport', 'Shopping', 'Entertainment', 'Other']);

const INTERVALS = [[7, 'weekly', 5, 9], [14, 'every 2 weeks', 12, 17], [30.4, 'monthly', 26, 35], [91, 'quarterly', 80, 100], [365, 'yearly', 340, 390]];

// Finds repeating charges/deposits from transaction history.
export function recurring(fin, now = new Date()) {
  const since = addDays(now, -400);
  const groups = {};
  for (const t of fin.txns) {
    if (CATEGORIES[t.category]?.skip || parseLocal(t.date) < since) continue;
    if (t.amount < 0 && NOT_BILLS.has(t.category)) continue;
    const k = `${t.amount < 0 ? '-' : '+'}${merchantKey(t.desc)}`;
    (groups[k] ||= []).push(t);
  }
  const out = [];
  for (const [k, list] of Object.entries(groups)) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = list.slice(1).map((t, i) => (parseLocal(t.date) - parseLocal(list[i].date)) / 86400000);
    const gap = median(gaps);
    const iv = INTERVALS.find(([, , lo, hi]) => gap >= lo && gap <= hi);
    if (!iv) continue;
    const consistent = gaps.filter((g) => g >= iv[2] && g <= iv[3]).length >= Math.max(1, gaps.length * 0.6);
    const amts = list.map((t) => Math.abs(t.amount));
    const med = median(amts);
    const similar = amts.slice(-3).every((a) => Math.abs(a - med) <= Math.max(2, med * 0.25));
    if (!consistent || !similar) continue;
    const last = list.at(-1), prev = list.at(-2);
    const lastAmt = Math.abs(last.amount), prevAmt = Math.abs(prev.amount);
    let next = parseLocal(last.date);
    while (next < startOfDay(now)) next = addDays(next, Math.round(iv[0]));
    // Stale if we've missed two cycles: probably cancelled.
    const stale = (now - parseLocal(last.date)) / 86400000 > iv[0] * 2 + 5;
    if (stale) continue;
    out.push({
      key: k, name: merchantName(last.desc), category: last.category, income: last.amount > 0,
      interval: iv[1], days: iv[0], amount: lastAmt, prevAmount: prevAmt,
      increase: lastAmt - prevAmt >= 0.5 && lastAmt > prevAmt * 1.02 ? lastAmt - prevAmt : 0,
      next, count: list.length, monthly: (lastAmt * 30.4) / iv[0],
    });
  }
  return out.filter((r) => !fin.ignoredRecurring.includes(r.key)).sort((a, b) => a.next - b.next);
}

export function unusual(fin, now = new Date()) {
  const recent = fin.txns.filter((t) => isSpend(t) && parseLocal(t.date) >= addDays(now, -30));
  const hist = fin.txns.filter((t) => isSpend(t) && parseLocal(t.date) >= addDays(now, -150));
  const out = [];
  for (const t of recent) {
    const peers = hist.filter((x) => x.category === t.category && x.id !== t.id).map((x) => Math.abs(x.amount));
    const amt = Math.abs(t.amount);
    if (peers.length >= 4 && amt > Math.max(40, median(peers) * 3)) out.push({ t, why: `${(amt / median(peers)).toFixed(1)}× your usual ${t.category.toLowerCase()} purchase` });
    else if (amt >= 150 && !hist.some((x) => x.id !== t.id && merchantKey(x.desc) === merchantKey(t.desc))) out.push({ t, why: 'Large first-time purchase here' });
  }
  return out;
}

export function forecast(fin, now = new Date()) {
  const spendable = fin.accounts.filter((a) => a.type !== 'credit');
  const credit = fin.accounts.filter((a) => a.type === 'credit');
  const balance = spendable.reduce((a, x) => a + (+x.balance || 0), 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const rec = recurring(fin, now);
  let bills = 0, income = 0;
  for (const r of rec) {
    for (let d = r.next; d < end; d = addDays(d, Math.round(r.days))) { if (r.income) income += r.amount; else bills += r.amount; }
  }
  const last30 = sum(fin.txns.filter((t) => isDiscretionary(t) && parseLocal(t.date) >= addDays(now, -30)));
  const daysLeft = Math.max(0, Math.round((end - startOfDay(now)) / 86400000));
  const daily = last30 / 30;
  return {
    balance, bills, income, daily, daysLeft,
    creditOwed: credit.reduce((a, x) => a + (+x.balance || 0), 0),
    projected: balance - bills + income - daily * daysLeft,
    hasBalance: spendable.some((a) => a.balance !== '' && a.balance != null),
  };
}

const STREAMING = /netflix|disney|crave|prime video|amazon prime|apple tv|paramount|youtube premium|spotify|apple music/i;

export function suggestions(fin, now = new Date()) {
  const out = [];
  const rec = recurring(fin, now).filter((r) => !r.income);
  const subs = rec.filter((r) => r.category === 'Subscriptions');
  if (subs.length) out.push(`Subscriptions cost about $${subs.reduce((a, r) => a + r.monthly, 0).toFixed(0)}/month (${subs.map((r) => r.name).join(', ')}). Cancel any you haven’t used in the last month.`);
  const streams = subs.filter((r) => STREAMING.test(r.name));
  if (streams.length >= 2) out.push(`You pay for ${streams.length} streaming services. Rotating one at a time could save ~$${(streams.slice(1).reduce((a, r) => a + r.monthly, 0)).toFixed(0)}/month.`);
  rec.filter((r) => r.increase).forEach((r) => out.push(`${r.name} went up by $${r.increase.toFixed(2)} (now $${r.amount.toFixed(2)} ${r.interval}).`));
  const m = monthStatus(fin, now);
  const dining = fin.txns.filter((t) => t.category === 'Dining' && t.amount < 0 && parseLocal(t.date) >= m.from);
  if (dining.length >= 8) out.push(`${dining.length} dining/coffee purchases this month ($${sum(dining).toFixed(0)}). Packing lunch a few days a week adds up.`);
  const fees = fin.txns.filter((t) => t.category === 'Fees' && t.amount < 0 && parseLocal(t.date) >= addDays(now, -90));
  if (fees.length) out.push(`$${sum(fees).toFixed(2)} in bank fees/interest over 90 days. Ask TD about a no-fee student account, or pay the card in full.`);
  m.cats.filter((c) => c.budget && c.spent > c.budget).forEach((c) => out.push(`Over the ${c.name} budget by $${(c.spent - c.budget).toFixed(0)} this month.`));
  return out;
}

export function alerts(fin, now = new Date()) {
  const out = [];
  if (!fin.txns.length) return out;
  const w = weekStatus(fin, now);
  if (w.allowance && w.spent > w.allowance) out.push({ level: 'bad', text: `Over this week’s spending money by $${(w.spent - w.allowance).toFixed(0)}`, go: 'money' });
  else if (w.allowance && w.spent >= w.allowance * 0.8) out.push({ level: 'warn', text: `$${w.left.toFixed(0)} left to spend this week (${Math.round((w.spent / w.allowance) * 100)}% used)`, go: 'money' });
  monthStatus(fin, now).cats.filter((c) => c.budget && c.spent >= c.budget * 0.8).forEach((c) => out.push({
    level: c.spent > c.budget ? 'bad' : 'warn', text: `${c.name}: $${c.spent.toFixed(0)} of $${c.budget} this month`, go: 'money',
  }));
  recurring(fin, now).filter((r) => !r.income && (r.next - startOfDay(now)) / 86400000 <= 3)
    .forEach((r) => out.push({ level: 'info', text: `${r.name} ~$${r.amount.toFixed(2)} due ${dayKey(r.next) === dayKey(now) ? 'today' : r.next.toLocaleDateString([], { weekday: 'short' })}`, go: 'money' }));
  recurring(fin, now).filter((r) => r.increase).forEach((r) => out.push({ level: 'warn', text: `Price increase: ${r.name} +$${r.increase.toFixed(2)}`, go: 'money' }));
  return out;
}

export const savingsPace = (g, now = new Date()) => {
  const by = parseLocal(g.by);
  const left = Math.max(0, (+g.target || 0) - (+g.saved || 0));
  if (!by || by <= now) return { left, monthly: null };
  const months = Math.max(1, (by.getFullYear() - now.getFullYear()) * 12 + by.getMonth() - now.getMonth());
  return { left, monthly: left / months };
};

export const fmtMoney = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
