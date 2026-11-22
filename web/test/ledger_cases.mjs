// 帳務一致性：用 App 單元測試同一份案例（app/src/test/resources/ledger_cases.txt）驗證網頁版 ledger()。
// 執行：node web/test/ledger_cases.mjs（CI 在建置前執行）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'app.js'), 'utf8');
const grab = (name) => { const i = src.indexOf('\nfunction ' + name + '('); if (i < 0) throw new Error('找不到 ' + name); const j = src.indexOf('\n}\n', i); return src.slice(i, j + 3); };
// 固定「今天」為 2026/11/22，年度 2026
const RealDate = Date; const NOW = RealDate.UTC(2026, 10, 22, 4);
class FixedDate extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
const D = { isEtf: (s) => /^00/.test(s), trades: () => [], base: () => ({}), cashFlows: () => [] };
const ledger = new Function('Date', 'D', ['tpeNow', 'ymd', 'isUs', 'gross', 'ledger'].map(grab).join('\n') + '\nreturn ledger;')(FixedDate, D);

const cases = []; let cur = null;
for (const raw of fs.readFileSync(path.join(here, '..', '..', 'app', 'src', 'test', 'resources', 'ledger_cases.txt'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const p = l.split(/\s+/);
  if (p[0] === 'case') cases.push(cur = { name: l.slice(5).trim(), base: { cash: 0, realized: 0, year: 2026, divTw: 0, divUs: 0 }, trades: [], expect: [] });
  else if (p[0] === 'base') p.slice(1).forEach((kv) => { const [k, v] = kv.split('='); cur.base[k] = +v; });
  else if (p[0] === 't') { const kv = Object.fromEntries(p.slice(6).map((x) => x.split('=')));
    cur.trades.push({ t: p[1], s: p[2], d: p[3], n: +p[4], p: +p[5], x: kv.x ? +kv.x : 1, fee: +(kv.fee || 0), tax: +(kv.tax || 0), id: +kv.id, o: kv.o || '', ...(kv.mg ? { mg: +kv.mg } : {}), ...(kv.mi ? { mi: +kv.mi } : {}) }); }
  else if (p[0] === 'expect') cur.expect.push(...p.slice(1));
}
let fail = 0; const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;
for (const c of cases) {
  const r = ledger(c.trades, { base: c.base }); const bad = [];
  if (c.expect.includes('err')) { if (!r.err) bad.push('應回報錯誤'); }
  else if (r.err) bad.push('錯誤：' + r.err);
  else for (const e of c.expect) {
    const [k, v] = e.split('=');
    if (k === 'cash' && !near(r.cash, +v)) bad.push(`現金 ${r.cash} ≠ ${v}`);
    if (k === 'realized' && !near(r.realized, +v)) bad.push(`已實現 ${r.realized} ≠ ${v}`);
    if (k === 'mgInt' && !near(r.mgInt, +v)) bad.push(`融資利息 ${r.mgInt} ≠ ${v}`);
    if (k.startsWith('debt.') && !near((r.debt || {})[k.slice(5)] || 0, +v)) bad.push(`融資 ${(r.debt || {})[k.slice(5)]} ≠ ${v}`);
    if (k.startsWith('hold.')) { const h = r.holdings.find((x) => x.symbol === k.slice(5)); const [n, a] = v.split('@').map(Number);
      if (!h) bad.push('沒有持股 ' + k.slice(5)); else { if (!near(h.shares, n, 1e-6)) bad.push(`股數 ${h.shares} ≠ ${n}`); if (!near(h.avgCost, a, 1e-6)) bad.push(`均價 ${h.avgCost} ≠ ${a}`); } }
    if (k.startsWith('none.') && r.holdings.some((x) => x.symbol === k.slice(5))) bad.push('應無持股 ' + k.slice(5));
  }
  console.log((bad.length ? '✗ ' : '✓ ') + c.name + (bad.length ? '：' + bad.join('；') : ''));
  if (bad.length) fail++;
}
if (cases.length < 5) { console.log('案例太少'); fail++; }
console.log(fail ? `網頁版帳務：${fail} 個案例不符` : `網頁版帳務：${cases.length} 個案例全部通過`);
process.exit(fail ? 1 : 0);
