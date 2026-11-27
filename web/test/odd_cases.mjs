// 零股價差排行一致性：與 App OddLotTest 相同案例驗證網頁版 oddRank。
// 執行：node web/test/odd_cases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'app.js'), 'utf8');
const grab = (name) => { const i = src.indexOf('\nfunction ' + name + '('); if (i < 0) throw new Error('找不到 ' + name); const j = src.indexOf('\n}\n', i); return src.slice(i, j + 3); };
const names = ['twTick', 'oddRank'];
const L = new Function(names.map(grab).join('\n') + '\nreturn {' + names.join(',') + '};')();
let fail = 0;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const t = (name, fn) => { const bad = []; try { fn((c, msg) => { if (!c) bad.push(msg); }); } catch (e) { bad.push(e.message); } if (bad.length) { fail++; console.log('✗ ' + name + '：' + bad.join('；')); } else console.log('✓ ' + name); };
const r = (s, board, odd, vol = 100) => ({ s, name: s, board, odd, oddVol: vol });
const syms = (l) => l.map((x) => x.s).join(',');

t('溢價與折價分欄', (ok) => { const o = L.oddRank([r('A', 60.2, 61.3), r('B', 100, 99), r('C', 50, 50)], 3); ok(syms(o.up) === 'A', syms(o.up)); ok(syms(o.dn) === 'B', syms(o.dn)); ok(near(o.up[0].pct, 1.1 / 60.2 * 100), o.up[0].pct); ok(o.up[0].ticks === 11, o.up[0].ticks); });
t('依幅度排序取前 3', (ok) => { const o = L.oddRank([r('A', 100, 101), r('B', 100, 103), r('C', 100, 102), r('D', 100, 104), r('E', 100, 96), r('F', 100, 98)], 3); ok(syms(o.up) === 'D,B,C', syms(o.up)); ok(syms(o.dn) === 'E,F', syms(o.dn)); });
t('零股未成交或缺價略過', (ok) => { const o = L.oddRank([r('A', 100, 101, 0), r('B', null, 101), r('C', 100, null), r('D', 100, 102)], 3); ok(syms(o.up) === 'D', syms(o.up)); });
t('ETF 升降單位', (ok) => { const o = L.oddRank([r('0050', 45, 45.05)], 3); ok(o.up[0].ticks === 5, o.up[0].ticks); });

if (fail) { console.log(`網頁版零股排行：${fail} 個案例失敗`); process.exit(1); }
console.log('網頁版零股排行：全部案例通過');
