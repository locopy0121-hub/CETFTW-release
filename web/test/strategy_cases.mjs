// 策略回測一致性：用 App 單元測試同一份案例（app/src/test/resources/strategy_cases.txt）驗證網頁版 stratRun()。
// 執行：node web/test/strategy_cases.mjs（CI 在建置前執行）；加 --gen 依網頁版結果印出 expect 列（新增案例時用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'app.js'), 'utf8');
const grab = (name) => { const i = src.indexOf('\nfunction ' + name + '('); if (i < 0) throw new Error('找不到 ' + name); const j = src.indexOf('\n}\n', i); const k = src.indexOf('\n', i + 1);
  return j > 0 && (src.indexOf('\nfunction ', i + 1) > j || src.indexOf('\nfunction ', i + 1) < 0) ? src.slice(i, j + 3) : src.slice(i, src.indexOf('\nfunction ', i + 1)); };
const run = new Function(['stratSma', 'stratRsi', 'stratKd', 'stratDays', 'stratRun'].map(grab).join('\n') + '\nreturn stratRun;')();
export function bars(cs, start) {
  const d0 = Date.parse(start.replace(/\//g, '-') + 'T00:00:00Z');
  return cs.map((c, i) => { const o = i ? cs[i - 1] : c; const d = new Date(d0 + i * 86400000);
    return { d: d.getUTCFullYear() + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0'), o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c }; });
}
const cases = []; let cur = null;
for (const raw of fs.readFileSync(path.join(here, '..', '..', 'app', 'src', 'test', 'resources', 'strategy_cases.txt'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const p = l.split(/\s+/);
  if (p[0] === 'case') cases.push(cur = { name: l.slice(5).trim(), c: [], start: '2025/01/01', entry: [], exit: [], sl: 0, tp: 0, hold: 0, buy: 0, sell: 0, expect: [] });
  else if (p[0] === 'closes') cur.c.push(...p.slice(1).map(Number));
  else if (p[0] === 'start') cur.start = p[1];
  else if (p[0] === 'entry' || p[0] === 'exit') cur[p[0]].push([p[1], +(p[2] || 0), +(p[3] || 0)]);
  else if (p[0] === 'rule') p.slice(1).forEach((kv) => { const [k, v] = kv.split('='); cur[k] = +v; });
  else if (p[0] === 'expect') cur.expect.push(...p.slice(1));
}
let fail = 0; const near = (a, b, e = 1e-6) => a != null && Math.abs(a - b) <= e;
for (const c of cases) {
  const r = run(bars(c.c, c.start), { entry: c.entry, exit: c.exit, sl: c.sl, tp: c.tp, hold: c.hold }, c.buy, c.sell);
  if (process.argv.includes('--gen')) { console.log(c.name + '\nexpect trades=' + r.trades.length + ' total=' + r.total.toFixed(6) + ' bh=' + r.bh.toFixed(6) + ' mdd=' + r.mdd.toFixed(6) + ' exposure=' + r.exposure.toFixed(6) + (r.win != null ? ' win=' + r.win.toFixed(6) : '') + ' reasons=' + (r.trades.map((t) => t.why).join(',') || '-') + ' first=' + (r.trades[0] ? r.trades[0].ed + '>' + r.trades[0].xd : '-')); continue; }
  const bad = [];
  for (const e of c.expect) {
    const [k, v] = e.split('=');
    if (k === 'trades' && r.trades.length !== +v) bad.push(`交易數 ${r.trades.length} ≠ ${v}`);
    if (k === 'total' && !near(r.total, +v)) bad.push(`報酬 ${r.total} ≠ ${v}`);
    if (k === 'bh' && !near(r.bh, +v)) bad.push(`買進持有 ${r.bh} ≠ ${v}`);
    if (k === 'mdd' && !near(r.mdd, +v)) bad.push(`回撤 ${r.mdd} ≠ ${v}`);
    if (k === 'exposure' && !near(r.exposure, +v)) bad.push(`持有比例 ${r.exposure} ≠ ${v}`);
    if (k === 'win' && !near(r.win, +v)) bad.push(`勝率 ${r.win} ≠ ${v}`);
    if (k === 'reasons' && (r.trades.map((t) => t.why).join(',') || '-') !== v) bad.push(`出場原因 ${r.trades.map((t) => t.why).join(',')} ≠ ${v}`);
    if (k === 'first' && (r.trades[0] ? r.trades[0].ed + '>' + r.trades[0].xd : '-') !== v) bad.push(`第一筆 ≠ ${v}`);
  }
  console.log((bad.length ? '✗ ' : '✓ ') + c.name + (bad.length ? '：' + bad.join('；') : ''));
  if (bad.length) fail++;
}
if (!process.argv.includes('--gen')) { if (cases.length < 4) { console.log('案例太少'); fail++; } console.log(fail ? `網頁版策略回測：${fail} 個案例不符` : `網頁版策略回測：${cases.length} 個案例全部通過`); process.exit(fail ? 1 : 0); }
