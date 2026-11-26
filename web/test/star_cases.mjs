// 雙極星團雷達一致性：與 App StarRankTest 相同案例驗證網頁版 starStep 等純函數。
// 執行：node web/test/star_cases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'app.js'), 'utf8');
const grab = (name) => { const i = src.indexOf('\nfunction ' + name + '('); if (i < 0) throw new Error('找不到 ' + name); const j = src.indexOf('\n}\n', i); return src.slice(i, j + 3); };
const names = ['starRuleDef', 'starSane', 'starKScore', 'starComp', 'starRingsOf', 'starFinal', 'starStopOf', 'starBreached', 'starQualifies', 'starStep', 'starBoard', 'starRsi', 'starBearRings'];
const STAR_STOPS = [['KLINE'], ['VWAP'], ['FIXED']];
const L = new Function('STAR_NEW', 'STAR_STOPS', names.map(grab).join('\n') + '\nreturn {' + names.join(',') + '};')(1e9, STAR_STOPS);
const NEW = 1e9;
const rule = { maxN: 8, minScore: 75, exitScore: 68, rings: 2, requireK: true, wC: 0.4, wR: 0.3, wK: 0.3, stop: 'KLINE', pct: 2.5 };
const x = (sym, comp, o = {}) => ({ symbol: sym, name: sym, price: o.price ?? 100, chgPct: 0, composite: comp, kLevel: o.k ?? 1, bullRings: o.bull ?? 3, bearRings: o.bear ?? 0, longStop: 'ls' in o ? o.ls : 95, shortStop: 'ss' in o ? o.ss : 105 });
let fail = 0;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const t = (name, fn) => { const bad = []; try { fn((c, msg) => { if (!c) bad.push(msg); }); } catch (e) { bad.push(e.message); } if (bad.length) { fail++; console.log('✗ ' + name + '：' + bad.join('；')); } else console.log('✓ ' + name); };
const syms = (l) => l.map((n) => n.symbol).join(',');

t('入選需全部條件', (ok) => { const r = L.starStep(rule, [x('A', 80), x('B', 74), x('C', 80, { k: 0 }), x('D', 80, { bull: 1 })], {}, 0); ok(syms(r.bull) === 'A', syms(r.bull)); ok(r.bull[0].rankDelta === NEW, 'NEW'); });
t('空方鏡像', (ok) => { const r = L.starStep(rule, [x('S', 20, { k: -2, bull: 0, bear: 2 })], {}, 0); ok(syms(r.bear) === 'S', syms(r.bear)); ok(near(r.bear[0].composite, 80), r.bear[0].composite); });
t('遲滯緩衝帶', (ok) => {
  const r1 = L.starStep(rule, [x('A', 80)], {}, 0);
  const r2 = L.starStep(rule, [x('A', 70, { k: 0, bull: 1 })], r1.members, 1); ok(syms(r2.bull) === 'A', '70 分應保留'); ok(r2.bull[0].rankDelta === 0, 'delta 0');
  const r3 = L.starStep(rule, [x('A', 67)], r2.members, 2); ok(!r3.bull.length, '67 分應剔除'); ok(r3.ejects.length === 1 && r3.ejects[0].forced === false, '自然剔除');
});
t('跌破停損強制彈出與冷卻', (ok) => {
  const r1 = L.starStep(rule, [x('A', 90)], {}, 0);
  const r2 = L.starStep(rule, [x('A', 90, { price: 94.9 })], r1.members, 1); ok(!r2.bull.length, '應移出'); ok(r2.ejects.length === 1 && r2.ejects[0].forced === true, 'forced');
  const r3 = L.starStep(rule, [x('A', 90)], r2.members, 2, { A: 10 }); ok(!r3.bull.length, '冷卻期內不入選');
});
t('空方防守價在上方', (ok) => {
  const r1 = L.starStep(rule, [x('S', 10, { k: -1, bull: 0, bear: 3 })], {}, 0);
  const r2 = L.starStep(rule, [x('S', 10, { k: -1, bull: 0, bear: 3, price: 105 })], r1.members, 1); ok(r2.ejects.length === 1 && r2.ejects[0].side === 'bear', JSON.stringify(r2.ejects));
});
t('固定 % 以入選價為準', (ok) => {
  const fr = { ...rule, stop: 'FIXED', pct: 2.5 };
  const r1 = L.starStep(fr, [x('A', 90, { price: 100 })], {}, 0); ok(near(r1.bull[0].stop, 97.5), r1.bull[0].stop); ok(near(r1.bull[0].slBuffer, 2.5), r1.bull[0].slBuffer);
  const r2 = L.starStep(fr, [x('A', 90, { price: 110 })], r1.members, 1); ok(near(r2.bull[0].stop, 97.5), r2.bull[0].stop);
});
t('權重排行與名次變化', (ok) => {
  const r1 = L.starStep(rule, [x('A', 80, { k: 1, bull: 2 }), x('B', 90, { k: 2, bull: 3 })], {}, 0); ok(syms(r1.bull) === 'B,A', syms(r1.bull)); ok(near(r1.bull[0].final, 96, 1e-3), r1.bull[0].final);
  const r2 = L.starStep(rule, [x('A', 99, { k: 2, bull: 3 }), x('B', 80, { k: 1, bull: 2 })], r1.members, 1); ok(syms(r2.bull) === 'A,B', syms(r2.bull)); ok(r2.bull[0].rankDelta === 1 && r2.bull[1].rankDelta === -1, 'delta');
});
t('顯示上限只影響顯示', (ok) => { const r = L.starStep({ ...rule, maxN: 5 }, Array.from({ length: 12 }, (_, i) => x('S' + (i + 1), 77 + i)), {}, 0); ok(r.bull.length === 5, r.bull.length); ok(Object.keys(r.members).length === 12, Object.keys(r.members).length); });
t('資料暫缺保留成員', (ok) => { const r1 = L.starStep(rule, [x('A', 80)], {}, 0); const r2 = L.starStep(rule, [], r1.members, 1); ok('A' in r2.members, '保留'); ok(!r2.ejects.length, '不彈出'); });
t('RSI 與空方三環', (ok) => { ok(near(L.starRsi(Array.from({ length: 31 }, (_, i) => 100 + i)), 100), 'rsi'); ok(L.starBearRings(90, 95, 100, -1, -1) === 3, 'bear 3'); ok(L.starBearRings(110, 105, 100, 1, 1) === 0, 'bear 0'); });
t('預設規則與 App 相同', (ok) => { const d = L.starRuleDef('ETF'); ok(d.minScore === 70 && d.exitScore === 63 && d.pct === 1.5, JSON.stringify(d)); const s = L.starSane({ ...rule, minScore: 99, exitScore: 99, maxN: 40 }); ok(s.minScore === 95 && s.exitScore === 94 && s.maxN === 15, JSON.stringify(s)); });
t('盤後排行', (ok) => {
  const r = L.starBoard(rule, [x('A', 60, { k: 0, bull: 1 }), x('B', 80), x('C', 70, { k: -1 }), x('S', 30, { k: -1, bull: 0, bear: 2 }), x('N', 52)]);
  ok(syms(r.bull) === 'B,A', syms(r.bull)); ok(r.bull[0].met === true && r.bull[1].met === false, 'met'); ok(syms(r.bear) === 'S', syms(r.bear)); ok(r.bull[0].rankDelta === 0, 'delta 0');
});

if (fail) { console.log(`網頁版星團：${fail} 個案例失敗`); process.exit(1); }
console.log('網頁版星團：全部案例通過');
