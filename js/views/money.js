import { state, update, logAction } from '../store.js';
import * as F from '../finance.js';
import { icon, modal, field, select, toast, bar, empty, confirmSheet } from '../ui.js';
import { h, uid, pickFile, parseLocal, fmtDate, dayKey } from '../util.js';

let query = '';
const $m = F.fmtMoney;

function importFlow() {
  pickFile('.csv,text/csv').then((f) => {
    if (!f) return;
    let parsed;
    try { parsed = F.parseBankCSV(f.text); } catch (e) { toast(e.message, 5000); return; }
    if (!parsed.txns.length) { toast('No transactions found in that file'); return; }
    const fin = state.finance;
    const accts = Object.fromEntries(fin.accounts.map((a) => [a.id, a.name]));
    modal({
      title: `Import ${parsed.txns.length} transactions`,
      body: `<p class="muted small">${h(f.name)} · ${parsed.txns.at(-1)?.date} to ${parsed.txns[0]?.date}</p>
        ${field('Which account is this?', select('acct', { ...accts, __new: '+ New account' }, fin.accounts[0]?.id || '__new'))}
        <div data-new ${fin.accounts.length ? 'hidden' : ''}>
          ${field('Account name', '<input name="name" placeholder="TD Chequing">')}
          ${field('Type', select('type', { chequing: 'Chequing', savings: 'Savings', credit: 'Credit card' }, 'chequing'))}
        </div>`,
      submit: 'Import',
      onOpen: (form) => form.acct.addEventListener('change', () => { form.querySelector('[data-new]').hidden = form.acct.value !== '__new'; }),
      onSubmit: (v) => {
        let added = 0;
        update((s) => {
          let id = v.acct;
          if (id === '__new') {
            id = uid();
            s.finance.accounts.push({ id, name: v.name || (v.type === 'credit' ? 'TD Visa' : 'TD Chequing'), type: v.type, balance: '', asOf: '' });
          }
          added = F.importTxns(s.finance, id, parsed);
          (s.meta.lastImport ||= {}).bank = new Date().toISOString();
          logAction('money', `Imported ${added} transactions`);
        });
        toast(`${added} new transaction${added === 1 ? '' : 's'} (${parsed.txns.length - added} already there)`);
      },
    });
  });
}

function budgetEditor() {
  const fin = state.finance;
  const m = F.monthStatus(fin);
  const spentBy = Object.fromEntries(m.cats.map((c) => [c.name, c.spent]));
  const cats = Object.keys(F.CATEGORIES).filter((c) => !F.CATEGORIES[c].skip && !F.CATEGORIES[c].income);
  modal({
    title: 'Budgets',
    body: `${field('Weekly spending money', `<input type="number" name="weekly" min="0" step="5" value="${fin.weeklyAllowance}">`, 'Covers everyday spending (food, coffee, shopping, gas…). Rent, phone and subscriptions are tracked separately as bills.')}
      <h3>Monthly category budgets</h3>
      <div class="budget-grid">${cats.map((c) => `<label class="field"><span>${c} <small class="muted">${spentBy[c] ? `· ${$m(spentBy[c])} so far` : ''}</small></span>
        <input type="number" name="b_${h(c)}" min="0" step="10" value="${fin.budgets[c] || ''}" placeholder="No limit"></label>`).join('')}</div>`,
    onSubmit: (v) => update((s) => {
      s.finance.weeklyAllowance = +v.weekly || 0;
      s.finance.budgets = Object.fromEntries(cats.map((c) => [c, +v[`b_${c}`] || 0]).filter(([, b]) => b > 0));
      logAction('money', 'Updated budgets');
    }),
  });
}

function txnEditor(t) {
  modal({
    title: F.merchantName(t.desc),
    body: `<p><b>${$m(t.amount)}</b> · ${fmtDate(parseLocal(t.date))}</p><p class="muted small">${h(t.desc)}</p>
      ${field('Category', select('category', Object.fromEntries(Object.keys(F.CATEGORIES).map((c) => [c, c])), t.category))}
      <label class="check"><input type="checkbox" name="always" checked> Always use this for “${h(F.merchantKey(t.desc))}”</label>`,
    onSubmit: (v) => update((s) => F.setCategory(s.finance, t.id, v.category, v.always)),
  });
}

function savingsEditor(g = {}) {
  modal({
    title: g.id ? 'Savings goal' : 'New savings goal',
    body: `${field('Goal', `<input name="name" value="${h(g.name)}" placeholder="Emergency fund, laptop, trip…" autofocus>`)}
      <div class="row">${field('Target $', `<input type="number" name="target" min="1" value="${g.target || ''}">`)}${field('Saved so far $', `<input type="number" name="saved" min="0" step="0.01" value="${g.saved || 0}">`)}</div>
      ${field('By (optional)', `<input type="date" name="by" value="${h(g.by)}">`)}`,
    extra: g.id ? `<button type="button" class="btn danger" data-del>${icon('trash', 18)}</button>` : '',
    onOpen: (form, close) => form.querySelector('[data-del]')?.addEventListener('click', () => { update((s) => { s.finance.savings = s.finance.savings.filter((x) => x.id !== g.id); }); close(); }),
    onSubmit: (v) => {
      if (!v.name || !(v.target > 0)) { toast('Add a name and target'); return false; }
      update((s) => {
        const data = { name: v.name, target: v.target, saved: v.saved || 0, by: v.by };
        if (g.id) Object.assign(s.finance.savings.find((x) => x.id === g.id), data);
        else s.finance.savings.push({ id: uid(), ...data });
      });
    },
  });
}

function accountEditor(a) {
  modal({
    title: a.name,
    body: `${field('Name', `<input name="name" value="${h(a.name)}">`)}
      ${field('Type', select('type', { chequing: 'Chequing', savings: 'Savings', credit: 'Credit card' }, a.type))}
      ${field(a.type === 'credit' ? 'Amount owed $' : 'Current balance $', `<input type="number" step="0.01" name="balance" value="${a.balance ?? ''}">`, a.asOf ? `From your import on ${a.asOf}. Update it any time.` : 'Imports with a Balance column fill this in.')}`,
    extra: `<button type="button" class="btn danger" data-del>${icon('trash', 18)} Remove</button>`,
    onOpen: (form, close) => form.querySelector('[data-del]').addEventListener('click', async () => {
      close();
      if (await confirmSheet(`Remove ${a.name}?`, 'Its imported transactions will be deleted from this device.', 'Remove')) {
        update((s) => { s.finance.accounts = s.finance.accounts.filter((x) => x.id !== a.id); s.finance.txns = s.finance.txns.filter((t) => t.accountId !== a.id); logAction('money', `Removed account ${a.name}`); });
      }
    }),
    onSubmit: (v) => update((s) => Object.assign(s.finance.accounts.find((x) => x.id === a.id), { name: v.name, type: v.type, balance: v.balance === '' ? '' : +v.balance, asOf: dayKey(new Date()) })),
  });
}

export default {
  id: 'money',
  title: 'Money',
  render() {
    const fin = state.finance;
    const head = `<header class="page-head"><h1>Money</h1><button class="btn primary" data-act="import">${icon('plus', 18)} Import</button></header>`;
    if (!fin.accounts.length) {
      return `${head}<section class="card">${empty(`<b>Bring in your TD transactions</b><br>On a computer (or Safari in desktop mode), sign in to <b>TD EasyWeb</b> → open your account → <b>Download</b> → choose <b>Spreadsheet (.csv)</b> and a date range (90 days is a good start). Then tap Import here. Do the same for your TD credit card.`, '<button class="btn primary" data-act="import">Import a CSV</button>')}
        <p class="muted small">Read-only: Compass never logs in to your bank or moves money. Your bank password is never asked for. Automatic syncing (via Plaid) is in the Phase 2 server.</p></section>`;
    }
    const now = new Date();
    const w = F.weekStatus(fin, now), m = F.monthStatus(fin, now), fc = F.forecast(fin, now);
    const rec = F.recurring(fin, now), odd = F.unusual(fin, now), tips = F.suggestions(fin, now);
    const bills = rec.filter((r) => !r.income);
    const txns = fin.txns.filter((t) => !query || `${t.desc} ${t.category} ${t.amount}`.toLowerCase().includes(query.toLowerCase())).slice(0, 60);
    const acctName = Object.fromEntries(fin.accounts.map((a) => [a.id, a.name]));
    return `${head}
    <div class="grid">
      <section class="card accent">
        <div class="card-head"><h2>This week</h2><button class="link" data-act="budgets">Budgets</button></div>
        ${!w.allowance ? '<p>Set a weekly spending amount to see what’s left.</p>' : w.left >= 0
          ? `<div class="big">${$m(w.left)}</div><div class="muted small">left of ${$m(w.allowance)} spending money · ${$m(w.perDay)}/day for ${w.daysLeft} day${w.daysLeft > 1 ? 's' : ''}</div>${bar(w.spent / w.allowance)}`
          : `<div class="big bad-text">${$m(-w.left)} over</div><div class="muted small">${$m(w.spent)} spent of ${$m(w.allowance)} · resets ${w.to.toLocaleDateString([], { weekday: 'long' })}</div><div class="bar over"><i style="width:100%"></i></div>`}
      </section>
      <section class="card">
        <h2>End of month</h2>
        ${fc.hasBalance ? `<div class="big ${fc.projected < 0 ? 'bad-text' : ''}">${$m(fc.projected)}</div>
          <p class="muted small">Estimate: ${$m(fc.balance)} now − ${$m(fc.bills)} bills + ${$m(fc.income)} expected income − ~${$m(fc.daily)}/day × ${fc.daysLeft} days.${fc.creditOwed ? ` Credit card owing: ${$m(fc.creditOwed)}.` : ''}</p>`
          : '<p class="muted">Add your balance (tap an account below, or import a file with a Balance column) to see a forecast.</p>'}
        <p class="small">This month: spent <b>${$m(m.spent)}</b>${m.income ? ` · income <b>${$m(m.income)}</b>` : ''}</p>
      </section>
    </div>
    <section class="card"><div class="card-head"><h2>Spending by category · ${fmtDate(now, { month: 'long' })}</h2><button class="link" data-act="budgets">Edit</button></div>
      ${m.cats.length ? `<ul class="list">${m.cats.map((c) => `<li class="item cat-row"><div class="what"><div class="row between"><strong>${h(c.name)}</strong>
        <span class="${c.budget && c.spent > c.budget ? 'bad-text' : ''}">${$m(c.spent)}${c.budget ? ` <span class="muted">/ ${$m(c.budget)}</span>` : ''}</span></div>
        ${c.budget ? bar(c.spent / c.budget) : ''}</div></li>`).join('')}</ul>` : '<p class="muted">No spending this month yet.</p>'}
    </section>
    <div class="grid">
      <section class="card"><h2>Bills &amp; subscriptions</h2>
        ${bills.length ? `<ul class="list">${bills.map((r) => `<li class="item"><div class="what"><strong>${h(r.name)}</strong>
          <div class="meta"><span>${$m(r.amount)} ${r.interval}</span><span class="chip">next ${fmtDate(r.next)}</span>${r.category === 'Subscriptions' ? '<span class="chip">subscription</span>' : ''}${r.increase ? `<span class="chip warn">+${$m(r.increase)}</span>` : ''}</div></div>
          <button class="link" data-act="notRecurring" data-k="${h(r.key)}">Not a bill</button></li>`).join('')}</ul>
          <p class="muted small">≈ ${$m(bills.reduce((a, r) => a + r.monthly, 0))}/month. Detected from repeating charges.</p>` : '<p class="muted">None detected yet. Import 2–3 months of history so repeating charges show up.</p>'}
      </section>
      <section class="card"><h2>Worth a look</h2>
        ${odd.length || tips.length ? `${odd.length ? `<ul class="alerts">${odd.slice(0, 5).map((x) => `<li class="warn"><a href="#money" data-act="editTxn" data-id="${h(x.t.id)}">${h(F.merchantName(x.t.desc))} ${$m(x.t.amount)} on ${fmtDate(parseLocal(x.t.date))} — ${h(x.why)}</a></li>`).join('')}</ul>` : ''}
          ${tips.length ? `<h3>Ways to save</h3><ul class="plain tips">${tips.map((t) => `<li>${h(t)}</li>`).join('')}</ul>` : ''}` : '<p class="muted">Nothing unusual. 👍</p>'}
      </section>
    </div>
    <div class="grid">
      <section class="card"><div class="card-head"><h2>Savings goals</h2><button class="btn small" data-act="newSaving">${icon('plus', 16)} Goal</button></div>
        ${fin.savings.length ? `<ul class="list">${fin.savings.map((g) => { const p = F.savingsPace(g, now); return `<li class="item" data-act="editSaving" data-id="${h(g.id)}"><div class="what"><strong>${h(g.name)}</strong>
          <div class="meta"><span>${$m(+g.saved || 0)} of ${$m(+g.target)}</span>${p.monthly ? `<span class="chip">${$m(p.monthly)}/month to hit ${fmtDate(parseLocal(g.by))}</span>` : ''}</div>${bar((+g.saved || 0) / g.target)}</div></li>`; }).join('')}</ul>` : '<p class="muted">Set a goal like an emergency fund or next term’s tuition.</p>'}
      </section>
      <section class="card"><h2>Accounts</h2>
        <ul class="list">${fin.accounts.map((a) => `<li class="item" data-act="editAccount" data-id="${h(a.id)}"><div class="what"><strong>${h(a.name)}</strong>
          <div class="meta"><span class="chip">${h(a.type)}</span><span class="muted">${a.asOf ? `as of ${a.asOf}` : 'balance not set'}</span></div></div>
          <b>${a.balance === '' || a.balance == null ? '—' : $m(+a.balance)}</b></li>`).join('')}</ul>
        <p class="muted small">Last import: ${state.meta.lastImport?.bank ? new Date(state.meta.lastImport.bank).toLocaleDateString() : '—'}. Read-only — Compass never moves money.</p>
      </section>
    </div>
    <section class="card"><h2>Transactions</h2>
      <label class="search">${icon('search', 18)}<input type="search" data-input="q" value="${h(query)}" placeholder="Search transactions" aria-label="Search transactions"></label>
      <ul class="list">${txns.map((t) => `<li class="item txn" data-act="editTxn" data-id="${h(t.id)}"><div class="what"><strong>${h(F.merchantName(t.desc))}</strong>
        <div class="meta"><span class="chip">${h(t.category)}</span><span class="muted">${fmtDate(parseLocal(t.date))}${fin.accounts.length > 1 ? ` · ${h(acctName[t.accountId] || '')}` : ''}</span></div></div>
        <b class="${t.amount > 0 ? 'good-text' : ''}">${$m(t.amount)}</b></li>`).join('') || '<li class="muted">No matches.</li>'}</ul>
      ${fin.txns.length > 60 && !query ? `<p class="muted small">Showing 60 of ${fin.txns.length}. Search to find older ones.</p>` : ''}
    </section>`;
  },
  act: {
    import: () => importFlow(),
    budgets: () => budgetEditor(),
    editTxn: (el) => txnEditor(state.finance.txns.find((t) => t.id === el.dataset.id)),
    notRecurring: (el) => update((s) => { s.finance.ignoredRecurring.push(el.dataset.k); }),
    newSaving: () => savingsEditor(),
    editSaving: (el) => savingsEditor(state.finance.savings.find((g) => g.id === el.dataset.id)),
    editAccount: (el) => accountEditor(state.finance.accounts.find((a) => a.id === el.dataset.id)),
  },
  input: { q: (el) => { query = el.value; return true; } },
};
