// 三環條件與量比預估一致性：與 App TargetRingsTest／VolEstimateTest 相同案例驗證網頁版 ringsEval()、volRatio()。
// 執行：node web/test/rings_cases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'app.js'), 'utf8');
const grab = (name) => { const i = src.indexOf('\nfunction ' + name + '('); if (i < 0) throw new Error('找不到 ' + name); const j = src.indexOf('\n}\n', i); return src.slice(i, j + 3); };
const fns = new Function('fmtPrice', ['ringsEval', 'volTwShare', 'volEstimate', 'volRatio'].map(grab).join('\n') + '\nreturn { ringsEval, volTwShare, volRatio };')((v) => String(v));
const { ringsEval, volTwShare, volRatio } = fns;
let fail = 0; const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const ok = (name, c) => { if (!c) { fail++; console.log('✗ ' + name); } else console.log('✓ ' + name); };
const base = { price: 42, wMa20: 40, wMa60: 38, wSupport: 41, wAtr: 2, wStop: 35.68, dSupport: 41.25, dAtr: 1.5, dStop: 41, dMa20: 42.5, target: 46, bullReversal: true };
let s = ringsEval(base, 0);
ok('波段 3/3', s.level === 3 && near(s.zoneLo, 41.25) && near(s.zoneHi, 42.75) && s.overlap && near(s.stop, 41) && near(s.rr, 4) && JSON.stringify(s.batches) === '[[42.75,100]]');
s = ringsEval(base, 1);
ok('存股週 K 停損三批', near(s.stop, 35.68) && s.level === 2 && JSON.stringify(s.batches) === '[[42.75,40],[42,30],[41.25,30]]');
s = ringsEval({ ...base, price: 40.9 }, 0); ok('破停損 0/3', s.broken && s.level === 0);
s = ringsEval({ ...base, wMa20: 37 }, 0); ok('週趨勢向下 0/3', !s.outer && s.level === 0);
ok('無止跌 1/3', ringsEval({ ...base, bullReversal: false }, 0).level === 1 && ringsEval({ ...base, bullReversal: false, noNewLow: true }, 0).level === 3);
s = ringsEval({ ...base, dSupport: 44, dAtr: 1, dStop: 43.5 }, 0); ok('無交集改用日支撐帶', !s.overlap && near(s.zoneLo, 44) && near(s.zoneHi, 45));
const avg = 10000;
ok('台股累積量曲線', volTwShare(0) === 0 && near(volTwShare(265), 0.88) && volTwShare(270) === 1 && volTwShare(30) > 30 / 270);
const raw = 3000 / volTwShare(5) / avg;
ok('開盤平滑', near(volRatio(500, avg, false, 0), 1) && near(volRatio(3000, avg, false, 5), raw / 3 + 2 / 3));
ok('盤中同步調 1 倍', near(volRatio(avg * volTwShare(135), avg, false, 135), 1));
ok('盤後用實際量', near(volRatio(18000, avg, false, null), 1.8) && volRatio(null, avg, false, null) === null && volRatio(100, 0, false, 10) === null);
if (fail) { console.log(fail + ' 項不一致'); process.exit(1); }
console.log('全部一致');
