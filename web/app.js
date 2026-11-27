// 台美股資產 網頁版（與手機 App 共用帳號、會員等級與資料）
// 架構：單一模組；資料經由發佈站 /api/m（會員伺服器）同步，行情經 /api/q 代理。
'use strict';

// ───────── 共用工具 ─────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEV = /[?&]dev\b/.test(location.search);
const MOCK = /[?&]mock\b/.test(location.search) && /^(localhost|127\.)/.test(location.hostname);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k, d) { try { const v = localStorage.getItem('cetf_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cetf_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('cetf_' + k); } catch (e) {} },
};

function fmt(v, d = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPx(v) { if (v == null || isNaN(v) || v === 0) return '—'; const a = Math.abs(v); return fmt(v, a >= 1000 ? 0 : a >= 100 ? 1 : 2); }
function fmtPrice(v) { if (v == null || isNaN(v) || v === 0) return '—'; return fmt(v, 2); }
function fmtInt(v) { return v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US'); }
function fmtSigned(v, d = 0) { if (v == null || isNaN(v)) return '—'; return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d); }
function fmtPct(v, d = 2) { if (v == null || isNaN(v) || !isFinite(v)) return '—'; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%'; }
function arrow(v) { return v > 0 ? '▲' : v < 0 ? '▼' : ''; }
function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
function fmtVol(v) { if (!v) return '—'; if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 億'; if (v >= 1e4) return (v / 1e4).toFixed(1) + ' 萬'; return fmtInt(v); }
function tpeNow() { return new Date(Date.now() + (8 * 60 + new Date().getTimezoneOffset()) * 60000); }
function ymd(d = tpeNow()) { return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0'); }
function hm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
/** 與 App 相同的日數（2024-01-01 起算） */
function dayNum(d = tpeNow()) { return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2024, 0, 1)) / 86400000); }
function dayDate(n) { const d = new Date(Date.UTC(2024, 0, 1) + n * 86400000); return d.getUTCFullYear() + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0'); }
function twOpen() { const d = tpeNow(); const m = d.getHours() * 60 + d.getMinutes(); return d.getDay() >= 1 && d.getDay() <= 5 && m >= 535 && m <= 815; }
function isUs(sym) { return !/^\d/.test(sym) && sym !== 't00' && sym !== 'o00'; }
function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ───────── 伺服器 ─────────
async function api(a, payload = {}) {
  const r = await fetch('/api/m', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a, payload: JSON.stringify(payload) }) });
  const j = await r.json().catch(() => ({ ok: false, err: '伺服器回應格式錯誤' }));
  if (!j.ok) { const e = new Error(j.err || '伺服器錯誤'); e.data = j; throw e; }
  return j;
}
/** 經發佈站代理取得外部行情（ttl 秒） */
async function px(url, ttl = 15, type = 'json') {
  const r = await fetch('/api/q?t=' + ttl + '&u=' + encodeURIComponent(url));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return type === 'json' ? r.json() : r.text();
}
const kvCache = {};
async function kv(k) {
  if (kvCache[k] && Date.now() - kvCache[k].at < 600000) return kvCache[k].v;
  try { const r = await fetch('/api/kv?k=' + encodeURIComponent(k)); const v = r.ok ? await r.json() : null; kvCache[k] = { at: Date.now(), v }; return v; }
  catch (e) { return null; }
}

// ───────── 會員：政策、授權碼（與 App 相同的簽章驗證） ─────────
const FEATURES = [
  ['KLINE', 'K 線分析與進場評估'], ['AI', 'AI 個股體檢'], ['ALERTS', '提醒與進場鈴聲'], ['WALL', '行情牆與熱度圖'],
  ['DIVTAX', '股息與稅務'], ['ANALYSIS', '投資分析工具'], ['REPORT', '報告'], ['MARKET', '市場與排行'], ['CHAT', '群聊'],
  ['BACKUP', '備份與設定檔'], ['MONITOR', '盤中持股監控'], ['WIDGET', '桌面小工具'], ['CHART', '進階圖表'], ['NEWS', '新聞'],
  ['STYLE', '外觀自訂'], ['STOCKPRO', '個股進階資料'],
];
const F = Object.fromEntries(FEATURES.map(([k], i) => [k, 1 << i]));
const ALL = 0xFFFF;
const TRIAL_COLOR = 0xFF22C55E, LOCK_COLOR = 0xFF9CA3AF;
function argb(c) { c = Number(c) >>> 0; return '#' + (c & 0xFFFFFF).toString(16).padStart(6, '0'); }

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function unb32(s0) {
  const s = s0.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').split('').filter((c) => B32.includes(c));
  const out = []; let buf = 0, bits = 0;
  for (const ch of s) { buf = ((buf << 5) | B32.indexOf(ch)) & 0xFFFFFF; bits += 5; if (bits >= 8) { out.push((buf >> (bits - 8)) & 0xFF); bits -= 8; } }
  return new Uint8Array(out);
}
function b64bytes(b64) { const s = atob(b64.trim()); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
function derToRaw(der) {
  let i = 2; if (der[1] & 0x80) i += der[1] & 0x7F;
  const read = () => { i++; const len = der[i++]; let v = der.slice(i, i + len); i += len; while (v.length > 32 && v[0] === 0) v = v.slice(1); const o = new Uint8Array(32); o.set(v, 32 - v.length); return o; };
  const r = read(), s = read(); const o = new Uint8Array(64); o.set(r, 0); o.set(s, 32); return o;
}
let PUB = null;
async function pubKey(b64) {
  if (!b64) return null;
  try { return await crypto.subtle.importKey('spki', b64bytes(b64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); } catch (e) { return null; }
}
async function ecVerify(key, sigRaw, data) {
  try { return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigRaw, data); } catch (e) { return false; }
}
function payloadLen(b) {
  if (b[0] === 1) return 15;
  if (b[0] === 2) return b[15] <= 12 ? 16 + b[15] : -1;
  if (b[0] === 3) return b[17] <= 12 ? 18 + b[17] : -1;
  return -1;
}
async function verifyCode(text) {
  if (!PUB || !text) return null;
  const m = String(text).match(/CETF-[0-9A-Za-z]{5}(?:-[0-9A-Za-z]{1,5})+/);
  const raw = (m ? m[0] : String(text).trim()).replace(/^CETF-/i, '');
  const b = unb32(raw); const n = payloadLen(b);
  if (n < 0 || b.length < n + 64) return null;
  const p = b.slice(0, n), sig = b.slice(n, n + 64);
  if (!(await ecVerify(PUB, sig, p))) return null;
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const v = p[0];
  const no = v === 2 ? String.fromCharCode(...p.slice(16, n)) : v === 3 ? String.fromCharCode(...p.slice(18, n)) : '';
  return {
    id: dv.getUint32(1), issued: dv.getUint16(5), expiry: dv.getUint16(7), features: dv.getUint16(9), device: dv.getUint32(11),
    tier: v === 3 ? p[15] : 0, rel: v === 3 && (p[16] & 1) === 1, no, idText: dv.getUint32(1).toString(16).toUpperCase().padStart(8, '0'),
  };
}
// 訂閱方案與活動折扣（與 App Pricing 相同算法；政策沒有設定時用預設價格）
const PLANS_DEFAULT = [{ name: '1 個月', months: 1, price: 199, tier: 0 }, { name: '3 個月', months: 3, price: 499, tier: 0 }, { name: '6 個月', months: 6, price: 799, tier: 0 }, { name: '1 年', months: 12, price: 1099, tier: 0 }];
function discActive(p, today = ymd()) { return p.disc >= 1 && p.disc <= 90 && (!p.discUntil || today.replace(/-/g, '/') <= String(p.discUntil).trim().replace(/-/g, '/')); }
function planPrice(p, x, today = ymd()) { return discActive(p, today) ? Math.round(x.price * (100 - p.disc) / 100) : x.price; }
function offText(pct) { const r = 100 - pct; return r % 10 === 0 ? r / 10 + ' 折' : r + ' 折'; }
/** 公開顯示的等級（不公開的等級只有目前就是該等級的人看得到；權限不受影響） */
function publicTiers(p, curId = -1) { return (p.tiers || []).filter((t) => !t.hidden || t.id === curId); }
const DEFAULT_POLICY = { trialDays: 7, trialFeatures: ALL, freeFeatures: 0, revoked: [], notice: '', tiers: [], trialName: 'USER', grace: 3, remind: 7, actWin: 30, gClient: '', loginMode: 0, plans: PLANS_DEFAULT, disc: 0, discUntil: '', discLabel: '' };
async function loadPolicy(cfg) {
  PUB = await pubKey(cfg.pubkey);
  if (!cfg.policy) return { ...DEFAULT_POLICY };
  try {
    const o = JSON.parse(cfg.policy); const body = o.policy;
    if (PUB) {
      const ok = await ecVerify(PUB, derToRaw(b64bytes(o.sig)), new TextEncoder().encode(body));
      if (!ok) return { ...DEFAULT_POLICY, bad: true };
    }
    const p = JSON.parse(body);
    return { ...DEFAULT_POLICY, ...p, tiers: (p.tiers || []).map((t) => ({ name: t.n, features: t.f, id: t.id || 0, days: t.d == null ? 30 : t.d, color: t.c || 0xFF3B82F6, desc: t.ds || '',
      hidden: t.h != null ? !!t.h : (/^admin$/i.test(t.n || '') || /管理員/.test(t.ds || '')) })),
      plans: Array.isArray(p.plans) && p.plans.length ? p.plans.filter((x) => x.m > 0 && x.p > 0).map((x) => ({ name: x.n, months: x.m, price: x.p, tier: x.t || 0 })) : PLANS_DEFAULT,
      disc: Math.max(0, Math.min(90, p.disc || 0)), discUntil: p.discUntil || '', discLabel: p.discLabel || '', payOn: p.pay !== false, comp: !!p.comp };
  } catch (e) { return { ...DEFAULT_POLICY }; }
}

// ───────── 狀態 ─────────
const S = {
  cfg: null, policy: { ...DEFAULT_POLICY },
  session: store.get('session', ''), me: null, code: null, codeText: '',
  keys: {}, rev: store.get('rev', 0), dirty: false, syncing: false, syncMsg: '', lastSync: 0,
  q: {}, dir: null, route: '', timers: [],
  pref: store.get('pref', { layout: 'wall', group: 'all', holdSort: 'mv', sub: 'KD', range: '6M' }),
};
const savePref = () => store.set('pref', S.pref);

/** 舊版（10 項功能）授權碼 → 新功能表（與 App 的 upgradeV1 相同） */
const V2_DAY = 1051; // 2026-11-17
function upgradeV1(m) {
  if ((m & 0x3FF) === 0x3FF) return ALL;
  let r = (m & 0x3FF) | F.WIDGET | F.NEWS | F.STYLE;
  if (m & F.ALERTS) r |= F.MONITOR;
  if (m & F.KLINE) r |= F.CHART | F.STOCKPRO;
  return r;
}
function codeFeatures(c) { return c.issued < V2_DAY && c.tier === 0 ? upgradeV1(c.features) : c.features; }
function member() {
  const p = S.policy, today = dayNum();
  if (!PUB) return { status: 'OPEN', features: ALL, name: '全開放', desc: '授權系統未啟用', color: TRIAL_COLOR };
  const c = S.code;
  const tierOf = (c) => { const f = codeFeatures(c); return p.tiers.find((t) => t.id && t.id === c.tier) || (c.tier === 0 ? p.tiers.find((t) => t.features === f && (t.days <= 0) === (c.expiry === 0xFFFF)) || p.tiers.find((t) => t.features === f) : null); };
  if (c && !(p.revoked || []).includes(c.idText)) {
    const perm = c.expiry === 0xFFFF;
    // 啟用起算：網頁無法得知手機的啟用日，保守以簽發日起算
    const exp = perm ? null : c.rel ? c.issued + c.expiry : c.expiry;
    if (perm || today <= exp + (p.grace || 0)) {
      const t = tierOf(c);
      const grace = !perm && today > exp;
      return { status: grace ? 'GRACE' : 'MEMBER', features: t ? t.features : codeFeatures(c), name: t ? t.name : '會員', desc: (t && t.desc) || '會員',
        color: t ? t.color : 0xFF3B82F6, exp, left: perm ? null : exp - today, grace, tierId: t && t.id, perm };
    }
  }
  // 試運作（收費關閉）：沒有授權碼的人不限天數，一律使用試用等級功能
  if (p.payOn === false) return { status: 'TRIAL', features: p.trialFeatures, name: p.trialName || 'USER', desc: '試運作會員', color: TRIAL_COLOR, left: null, freeRun: true };
  const start = Number((S.me && S.me.trialStart) || 0) || today;
  const trialLeft = Math.max(0, start + p.trialDays - today);
  if (trialLeft > 0) return { status: 'TRIAL', features: p.trialFeatures, name: p.trialName || 'USER', desc: '試用會員', color: TRIAL_COLOR, left: trialLeft };
  return { status: c ? 'EXPIRED' : 'FREE', features: p.freeFeatures, name: '已到期', desc: c ? '會員已到期' : '試用已結束', color: LOCK_COLOR, locked: true };
}
const can = (f) => (member().features & F[f]) !== 0;
function stateLine(m = member()) {
  switch (m.status) {
    case 'OPEN': return '全部功能開放';
    case 'MEMBER': return m.perm ? '永久有效' : '到期 ' + dayDate(m.exp) + '（剩 ' + m.left + ' 天）';
    case 'GRACE': return '已於 ' + dayDate(m.exp) + ' 到期，寬限期剩 ' + Math.max(0, m.left + (S.policy.grace || 0)) + ' 天，請盡快續約';
    case 'TRIAL': return m.freeRun ? '試運作期間免費使用，不限天數' : '試用剩 ' + m.left + ' 天（共 ' + S.policy.trialDays + ' 天）';
    case 'FREE': return '試用期已結束，進階功能已鎖定';
    default: return '會員已到期，進階功能已鎖定';
  }
}
function badge(m = member()) { const c = argb(m.color); return `<span class="badge" style="color:${c};border-color:${c};background:${c}22">${esc(m.name)}</span>`; }
function lockCard(f, title) {
  const m = member(); const need = publicTiers(S.policy).filter((t) => t.features & F[f]);
  return `<div class="card locked"><div class="ic">🔒</div><h2 style="justify-content:center">${esc(title || FEATURES.find((x) => x[0] === f)[1])}</h2>
    <div class="text2">${m.locked ? stateLine(m) + '，開通會員即可使用。' : '你的 ' + esc(m.name) + ' 方案未包含此功能。'}</div>
    ${need.length ? `<div class="row" style="justify-content:center;margin-top:10px">可使用的等級 ${need.map((t) => `<span class="badge" style="color:${argb(t.color)};border-color:${argb(t.color)}">${esc(t.name)}</span>`).join(' ')}</div>` : ''}
    <div style="margin-top:14px"><a class="btn primary" href="#/member">查看會員方案</a></div></div>`;
}

// ───────── 資料（與 App 相同的格式：偏好鍵 → {t, v}） ─────────
function kget(k, d) { const e = S.keys[k]; if (!e) return d; return e.v; }
function kjson(k, d) { const v = kget(k, null); if (v == null || v === '') return d; try { return JSON.parse(v); } catch (e) { return d; } }
function kset(k, v, t) { const old = S.keys[k]; S.keys[k] = { t: t || (old && old.t) || (typeof v === 'string' ? 's' : 'f'), v }; }
function ksetJson(k, v) { kset(k, JSON.stringify(v), 's'); }
function knum(k, d = 0) { const v = Number(kget(k, d)); return isNaN(v) ? d : v; }

const D = {
  quotes() { return kjson('quotes', []); },
  groups() { return kjson('groups', []); },
  starred() { return String(kget('starred', '') || '').split(',').filter(Boolean); },
  trades() { return kjson('trades', []); },
  accounts() { return kjson('accounts', []); },
  cashFlows() { return kjson('cashFlows', []); },
  base() { return { cash: knum('baseCash'), year: knum('baseYear', new Date().getFullYear()), realized: knum('baseRealized'), divTw: knum('baseDivTw'), divUs: knum('baseDivUs') }; },
  name(sym) { const q = D.quotes().find((x) => x.s === sym); return (q && q.n) || (S.dir && S.dir[sym] && S.dir[sym][0]) || (S.q[sym] && S.q[sym].name) || sym; },
  isEtf(sym) { const q = D.quotes().find((x) => x.s === sym); return (q && q.etf) || /^00/.test(sym); },
  otc(sym) { return !!(S.dir && S.dir[sym] && S.dir[sym][1] === 'o'); },
};

// ───────── 帳本（與 App 的 Ledger 相同規則） ─────────
function gross(sym, n, p) { return isUs(sym) ? n * p : Math.floor(Math.round(n * p * 1e6) / 1e6); }
/** 台股股利：股數 × 每股股利，元以下四捨五入（股務代理發放方式，與 App TwRules.dividendGross 相同；例 330 × 0.138 = 45.54 → 46） */
function divGross(n, p) { return n > 0 && p > 0 ? Math.round(Math.round(n * p * 1e6) / 1e6) : 0; }
/** 交易金額：台股股利用四捨五入，其餘同 gross */
function tGross(t) { return t.t === 'DIVIDEND' && !isUs(t.s) ? divGross(t.n, t.p) : gross(t.s, t.n, t.p); }
/** 二代健保補充保費：應稅股利單次 ≥ 2 萬 × 2.11%，元以下四捨五入，上限 1,000 萬計 */
function divNhi(taxable) { return taxable >= 20000 ? Math.round(Math.min(taxable, 1e7) * 0.0211) : 0; }
/** 台股股利預設跨行匯費（手機同步的 divFee 優先，其次網頁設定，預設 10 元） */
function divFee() { const k = knum('divFee', NaN); if (!isNaN(k)) return Math.max(0, k); const v = S.pref.divFee; return v == null || v === '' ? 10 : Math.max(0, +v || 0); }
/** 銀行名稱比對（與 App bankKey 相同） */
function bankKey(b) { return String(b || '').trim().replace(/\s/g, '').replace('商業銀行', '').replace('銀行', '').replace('商銀', '').replace('中華郵政', '郵局').replace(/臺/g, '台'); }
/** 此股股利的銀行開票處理費／郵資／匯費：個股設定 → 同行（撥款銀行＝入帳銀行）免收 → 帳戶設定 → 預設（與 App divFeeFor 相同） */
function divFeeFor(sym) {
  const over = kjson('divFeeSym', {})[sym]; if (over != null && over !== '') return [Math.max(0, +over || 0), '個股設定'];
  const accs = D.accounts().filter((a) => a.m !== 'US'); const buys = D.trades().filter((t) => t.s === sym && t.t === 'BUY').sort((a, b) => String(b.d).localeCompare(String(a.d)));
  const acc = accs.find((a) => buys.length && Number(a.id) === Number(buys[0].acc)) || accs[0];
  // 撥款銀行：手動指定 → 手機 App 從股息紀錄學到的同行／跨行（同步鍵 cache_divLearn）→ ETF 保管銀行（cache_divCust）
  const learnt = kjson('cache_divLearn', {})[sym] || ''; const cust = String(kjson('cache_divCust', {})[sym] || '').split('|')[0];
  const pay = kjson('divPayBank', {})[sym] || (learnt ? (learnt.startsWith('≠') ? '' : learnt) : cust); const recv = (acc && acc.dbk) || '';
  if (pay && recv && bankKey(pay) === bankKey(recv)) return [0, '同行免匯費（' + recv + '）'];
  if (acc) return [acc.dvf != null ? Math.max(0, +acc.dvf || 0) : divFee(), acc.n + (recv ? '：入帳 ' + recv : '')];
  return [divFee(), '預設'];
}
function twFee(amount, discount = 1, min = 20) { if (amount <= 0) return 0; return Math.max(min, Math.floor(amount * 0.001425 * discount)); }
function twTaxRate(sym) { return D.isEtf(sym) ? 0.001 : 0.003; }
function ledger(trades = D.trades(), opt = {}) {
  const base = opt.base || D.base(); const year = new Date().getFullYear(); const y = String(year);
  const hs = new Map(); let cash = base.cash;
  let realized = base.year === year ? base.realized : 0, divTw = base.year === year ? base.divTw : 0, divUs = base.year === year ? base.divUs : 0;
  const realizedById = {}, dividendById = {};
  const debt = {}, lots = {}; let mgInt = 0; // 融資：代號 → 餘額、批次（與 App Ledger 相同）
  const shorts = {}; // 放空（融券、當沖先賣）：代號 → { n 股數, net 淨價款, dep 保證金, col 擔保價款, d 首次日期 }
  const today = ymd();
  const sorted = trades.filter((t) => t.o !== 'legacy').slice().sort((a, b) => (a.d + '#' + String(a.id).padStart(10, '0')).localeCompare(b.d + '#' + String(b.id).padStart(10, '0')));
  for (const t of sorted) {
    const us = isUs(t.s); const fx = us ? (t.x || 1) : 1; const thisYear = String(t.d).startsWith(y);
    const ex = hs.get(t.s); const g = gross(t.s, t.n, t.p);
    if (t.sh && !us && (t.t === 'SELL' || t.t === 'BUY')) {
      const sp = shorts[t.s];
      if (t.t === 'SELL') {
        const net = g - (t.fee || 0) - (t.tax || 0) - (t.mi || 0); const dep = Math.max(0, t.mg || 0);
        if (dep > 0) cash -= dep; else cash += net;
        shorts[t.s] = { symbol: t.s, n: (sp ? sp.n : 0) + t.n, net: (sp ? sp.net : 0) + net, dep: (sp ? sp.dep : 0) + dep, col: (sp ? sp.col : 0) + (dep > 0 ? net : 0), d: sp ? sp.d : t.d };
      } else {
        if (!sp || sp.n <= 1e-9) return { err: t.d + ' 回補 ' + t.s + ' 時沒有放空部位' };
        if (t.n > sp.n + 1e-9) return { err: t.d + ' 回補 ' + t.s + ' ' + t.n + ' 股，超過放空的 ' + sp.n + ' 股' };
        const k = Math.min(1, t.n / sp.n); const cost = g + (t.fee || 0); const mi = t.mi || 0;
        const r = sp.net * k - cost + mi; realizedById[t.id] = r; if (thisYear) realized += r;
        cash += (sp.dep + sp.col) * k - cost + mi;
        if (1 - k <= 1e-9) delete shorts[t.s]; else shorts[t.s] = { ...sp, n: sp.n - t.n, net: sp.net * (1 - k), dep: sp.dep * (1 - k), col: sp.col * (1 - k) };
      }
      continue;
    }
    if (t.t === 'BUY') {
      const add = g + (t.fee || 0); const oldN = ex ? ex.shares : 0; const oldCost = oldN * (ex ? ex.avgCost : 0); const newN = oldN + t.n;
      if (newN <= 0) continue;
      const newFx = us ? ((oldCost + add) > 0 ? (oldCost * (ex ? ex.avgFx : fx) + add * fx) / (oldCost + add) : fx) : 1;
      hs.set(t.s, { symbol: t.s, shares: newN, avgCost: (oldCost + add) / newN, avgFx: newFx });
      const loan = !us && t.mg > 0 ? Math.min(t.mg, g) : 0;
      if (loan > 0) { debt[t.s] = (debt[t.s] || 0) + loan; (lots[t.s] = lots[t.s] || []).push({ d: t.d, a: loan, n: t.n }); }
      if (t.o !== 'opening') cash -= add * fx - loan;
    } else if (t.t === 'SELL') {
      if (!ex) return { err: t.d + ' 賣出 ' + t.s + ' 時沒有持股' };
      if (t.n > ex.shares + 1e-9) return { err: t.d + ' 賣出 ' + t.s + ' ' + t.n + ' 股，超過當時持有的 ' + ex.shares + ' 股' };
      const proceeds = g - (t.fee || 0) - (t.tax || 0);
      const owed = debt[t.s] || 0; const mi = t.mi || 0;
      const repay = owed <= 0 ? 0 : t.mg > 0 ? Math.min(t.mg, owed) : owed * Math.min(1, t.n / ex.shares);
      const r = proceeds * fx - t.n * ex.avgCost * (us ? ex.avgFx : 1) - mi;
      realizedById[t.id] = r; if (thisYear) { realized += r; mgInt += mi; } cash += proceeds * fx - repay - mi;
      if (repay > 0) { const rest = owed - repay; if (rest <= 0.5) { delete debt[t.s]; delete lots[t.s]; } else { debt[t.s] = rest; let need = repay; const l = lots[t.s] || [];
        while (need > 1e-6 && l.length) { const f = l[0]; if (f.a <= need) { need -= f.a; l.shift(); } else { const k = (f.a - need) / f.a; l[0] = { ...f, a: f.a - need, n: f.n * k }; need = 0; } } } }
      const left = ex.shares - t.n; if (left <= 1e-9) { hs.delete(t.s); delete debt[t.s]; delete lots[t.s]; } else hs.set(t.s, { ...ex, shares: left });
    } else if (t.t === 'DIVIDEND') {
      if (String(t.d).replace(/-/g, '/') > today) continue; // 發放日未到
      const gd = us ? g : divGross(t.n, t.p); // 台股股利元以下四捨五入
      const net = us ? gd * (1 - 0.3) * fx : gd - (t.fee || 0);
      dividendById[t.id] = net; if (thisYear) { if (us) divUs += gd; else divTw += gd - (t.fee || 0); } cash += net;
    } else if (t.t === 'SPLIT') {
      if (!ex && !shorts[t.s]) return { err: t.d + ' ' + t.s + ' 拆股時沒有持股' };
      const ratio = t.p; if (ratio <= 0) return { err: t.d + ' ' + t.s + ' 拆股比例需大於 0' };
      if (ex) hs.set(t.s, { ...ex, shares: ex.shares * ratio, avgCost: ex.avgCost / ratio }); (lots[t.s] || []).forEach((l) => { l.n *= ratio; });
      if (shorts[t.s]) shorts[t.s].n *= ratio;
    }
  }
  const flows = opt.base ? 0 : D.cashFlows().reduce((a, f) => a + (Number(f.a) || 0), 0);
  Object.keys(debt).forEach((k) => { if (debt[k] <= 0.5) { delete debt[k]; delete lots[k]; } });
  return { holdings: Array.from(hs.values()), cash: cash + flows, realized, divTw, divUs, realizedById, dividendById, debt, lots, mgInt, shorts: Object.values(shorts).filter((x) => x.n > 1e-9) };
}
function holdings() {
  const t = D.trades();
  if (t.length) { const r = ledger(t); if (!r.err) return r.holdings; }
  return kjson('holdings', []).map((h) => ({ symbol: h.s, shares: h.n, avgCost: h.c, avgFx: h.f || 1 }));
}
function usdTwd() { const q = S.q['TWD=X']; return (q && q.price) || knum('usdTwd', 32) || 32; }
/** 持股彙總：市值、成本、損益、今日損益（台幣） */
function portfolio() {
  const hs = holdings(); const fx = usdTwd();
  const rows = hs.map((h) => {
    const q = S.q[h.symbol] || {}; const us = isUs(h.symbol); const f = us ? fx : 1;
    const price = q.price || h.avgCost; const mv = h.shares * price * f; const cost = h.shares * h.avgCost * (us ? (h.avgFx || fx) : 1);
    const day = q.price && q.prev ? (q.price - q.prev) * h.shares * f : 0;
    return { ...h, us, name: D.name(h.symbol), price, prev: q.prev, chg: q.price && q.prev ? q.price - q.prev : 0, pct: q.price && q.prev ? (q.price / q.prev - 1) * 100 : 0,
      mv, cost, pl: mv - cost, plPct: cost > 0 ? (mv / cost - 1) * 100 : 0, day, vol: q.vol, lu: q.lu, ld: q.ld };
  });
  const mv = rows.reduce((a, r) => a + r.mv, 0); rows.forEach((r) => { r.weight = mv > 0 ? r.mv / mv * 100 : 0; });
  const lg = D.trades().length ? ledger() : null;
  const cash = lg && !lg.err ? lg.cash : knum('cash');
  const margin = lg && !lg.err ? Object.values(lg.debt || {}).reduce((a, v) => a + v, 0) : 0;
  // 放空部位淨值＝保證金＋擔保價款−股數×現價（計入總資產）；debt＝融資−放空淨值，總資產一律 mv＋cash−debt
  const shorts = (lg && !lg.err ? lg.shorts || [] : []).map((x) => { const px = (S.q[x.symbol] || {}).price || (x.n > 0 ? x.net / x.n : 0);
    return { ...x, name: D.name(x.symbol), avg: x.n > 0 ? x.net / x.n : 0, px, eq: x.dep + x.col - x.n * px, un: x.net - x.n * px, ratio: x.dep > 0 && px > 0 ? (x.dep + x.col) / (x.n * px) * 100 : null, call: x.dep > 0 ? (x.dep + x.col) / (x.n * 1.3) : null }; });
  const shortEq = shorts.reduce((a, x) => a + x.eq, 0);
  const debt = margin - shortEq;
  return { rows, mv, cost: rows.reduce((a, r) => a + r.cost, 0), pl: rows.reduce((a, r) => a + r.pl, 0), day: rows.reduce((a, r) => a + r.day, 0), cash, debt, margin, shorts, shortEq, mgDebt: lg && !lg.err ? lg.debt || {} : {}, mgLots: lg && !lg.err ? lg.lots || {} : {}, mgInt: lg && !lg.err ? lg.mgInt || 0 : 0,
    realized: lg && !lg.err ? lg.realized : knum('realized'), divTw: lg && !lg.err ? lg.divTw : knum('divTw'), divUs: lg && !lg.err ? lg.divUs : knum('divUs') };
}

// ───────── 同步 ─────────
// 端對端加密：同步密碼以瀏覽器不可匯出的金鑰加密存在本機（與 AI 金鑰相同），上傳前以匯出檔格式（kind＝sync）加密
S.e2ee = !!store.get('e2ee', false); S.sealed = !!store.get('sealed', false);
async function e2eePass() { const e = store.get('e2k', ''); if (!e) return '';
  try { const [iv, ct] = e.split('.').map(b64bytes); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aiCk(), ct)); } catch (x) { return ''; } }
async function e2eeSet(pass) {
  if (!pass) { store.set('e2k', ''); S.e2ee = false; S.sealed = false; store.set('e2ee', false); store.set('sealed', false); return; }
  const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aiCk(), new TextEncoder().encode(pass));
  store.set('e2k', b64of(iv) + '.' + b64of(new Uint8Array(ct))); S.e2ee = true; store.set('e2ee', true);
}
async function sealSync(json) { const p = await e2eePass(); if (!p) { if (S.sealed) throw new Error('雲端資料已端對端加密：請先在「會員」頁輸入同步密碼，才能上傳'); return json; } return expEncrypt(json, p, 'sync'); }
async function openSync(data) {
  if (!expIsEnc(data)) { S.sealed = false; store.set('sealed', false); return data; }
  S.sealed = true; store.set('sealed', true); const p = await e2eePass();
  if (!p) throw new Error('雲端資料已端對端加密：請在「會員」頁輸入同步密碼');
  const t = await expDecrypt(data, p); if (t == null) throw new Error('同步密碼不正確，無法解密雲端資料'); return t;
}
async function e2eeModal() {
  let pass = '';
  const v = await dialog('端對端加密同步', `<div class="text2 small">設定「同步密碼」後，同步資料會先在這個瀏覽器以 AES-256 加密再上傳；每台手機、每個瀏覽器都要輸入同一組密碼才能同步。</div>
    <div class="notice err small" style="margin:8px 0">忘記同步密碼將無法讀取雲端資料（各裝置本機資料不受影響，可關閉加密後重新上傳）。</div>
    <div class="field"><label>同步密碼（至少 8 個字）</label><input id="e2a" type="password" autocomplete="new-password"></div><div class="field"><label>再輸入一次</label><input id="e2b" type="password" autocomplete="new-password"></div><div id="merr" class="small up"></div>`,
    S.e2ee ? [['off', '關閉加密', 'danger'], ['', '取消'], ['ok', '儲存並同步', 'primary']] : [['', '取消'], ['ok', '儲存並同步', 'primary']], (root) => () => {
      const a = $('#e2a', root).value, b = $('#e2b', root).value; if (a.length < 8) return '同步密碼至少 8 個字'; if (a !== b) return '兩次輸入不一致'; pass = a; return null; });
  if (v === 'off') { await e2eeSet(''); if (!phoneMaster()) { S.dirty = true; store.set('dirty', true); } toast('已關閉端對端加密（其他裝置也請關閉）'); route(); return; }
  if (v !== 'ok' || !pass) return;
  // 雲端已是密文：先確認密碼解得開（避免用錯誤密碼加密後覆蓋雲端）；要更換密碼請先關閉加密再重新設定
  try { const r = await api('dataGet', { session: S.session }); if (r && r.data && expIsEnc(r.data) && (await expDecrypt(r.data, pass)) == null) {
    await dialog('同步密碼不正確', '<div class="text2">這組密碼無法解開雲端資料，請輸入其他裝置設定的同步密碼。<br>若要更換同步密碼，請先在主要裝置「關閉加密」再重新設定。</div>', [['', '知道了', 'primary']]); return; } }
  catch (e) { toast('無法確認雲端資料：' + e.message); return; }
  await e2eeSet(pass); if (!phoneMaster()) { S.dirty = true; store.set('dirty', true); }
  await syncNow(); toast(phoneMaster() ? '已儲存同步密碼（手機為主：請在手機也開啟端對端加密）' : '已開啟端對端加密並上傳'); route();
}
// 資料格式版本（與 App DataFormat 相同）：1 基本、2 含融資 mg／mi、3 含放空 sh；讀到比本版新的格式就不套用
const DATA_FMT_MAX = 3;
function dataFmt(json) { const t = String(json || ''); return /"sh"\s*:/.test(t) ? 3 : /"m[gi]"\s*:/.test(t) ? 2 : 1; }
function snapshot() { const k = S.keys || {}; const fmt = Math.max(dataFmt((k.trades || {}).v), dataFmt((k['sim:trades'] || {}).v));
  return JSON.stringify({ app: 'CETFTW', format: fmt, fmtMax: DATA_FMT_MAX, ...(S.cloudDir ? { dir: S.cloudDir } : {}), keys: S.keys }); }
/** 交易變更後，連帶更新持股與現金（與 App 一致） */
function recalc() {
  const r = ledger(); if (r.err) return r.err;
  ksetJson('holdings', r.holdings.map((h) => ({ s: h.symbol, n: h.shares, c: h.avgCost, f: h.avgFx })));
  return null;
}
let pushTimer = null;
/** 同步方向（由手機設定，記在雲端資料 dir）：p2w＝手機為主（網頁不上傳）、w2p＝網頁為主、''＝舊版雙向 */
S.cloudDir = store.get('cdir', '');
function phoneMaster() { return S.cloudDir === 'p2w'; }
/** 同步方式：預設手動（按「同步」才上傳／下載，不跳提醒）；設定或會員頁可改為自動 */
function autoSync() { return S.pref.syncAuto === true; }
function changed() {
  if (phoneMaster()) { store.set('keys', S.keys); return; }
  S.dirty = true; store.set('keys', S.keys); store.set('dirty', true);
  if (autoSync()) { clearTimeout(pushTimer); pushTimer = setTimeout(() => push(), 1500); }
  renderSync();
}
/** 手動同步：先上傳本機變更（網頁為主時），再下載雲端最新資料 */
async function syncNow() {
  if (!S.session || S.syncing) return;
  try { await push(); const r = await pull(); S.syncMsg = r === 'applied' ? '已下載最新資料' : S.syncMsg; if (r === 'applied' && cur) route(); else renderSync(); }
  catch (e) { S.syncMsg = '同步失敗：' + e.message; renderSync(); }
}
async function push(force = false) {
  if (!S.session || S.syncing) return;
  if (phoneMaster()) { S.dirty = false; store.set('dirty', false); return; }
  S.syncing = true; renderSync();
  try {
    const r = await api('dataPut', { session: S.session, baseRev: S.rev, data: await sealSync(snapshot()), src: '網頁', force });
    if (r.kicked) return kicked();
    if (r.conflict) { S.syncing = false; return conflict(); }
    S.rev = r.rev; S.dirty = false; store.set('rev', S.rev); store.set('dirty', false); S.syncMsg = '已上傳'; S.lastSync = Date.now();
  } catch (e) { S.syncMsg = '上傳失敗：' + e.message; }
  finally { S.syncing = false; renderSync(); }
}
async function pull(force = false) {
  if (!S.session) return;
  const r = await api('dataGet', force ? { session: S.session } : { session: S.session, since: S.rev });
  if (r.kicked) return kicked();
  if (r.same) { S.lastSync = Date.now(); S.syncMsg = '已是最新'; renderSync(); return; }
  if (!r.rev || !r.data) {
    // 雲端沒有資料（只用網頁、尚未綁定手機）：網頁為主，本機有資料就上傳
    S.rev = 0; store.set('rev', 0);
    if (S.cloudDir !== 'w2p') { S.cloudDir = 'w2p'; store.set('cdir', 'w2p'); }
    if (Object.keys(S.keys).length) { S.dirty = true; store.set('dirty', true); push(); }
    return 'empty';
  }
  let txt; try { txt = await openSync(r.data); } catch (e) { S.syncMsg = e.message; renderSync(); if (S.route === 'member') route(); return 'locked'; }
  const o = JSON.parse(txt);
  if ((o.format || 1) > DATA_FMT_MAX) { S.syncMsg = '雲端資料含較新版本的記帳欄位，請重新整理網頁（Ctrl＋F5）取得最新版再同步'; renderSync(); return 'locked'; }
  // 沒有方向（舊資料）且尚未綁定手機：視為網頁為主
  const dir = o.dir || (S.me && S.me.phone === false ? 'w2p' : '');
  if (dir !== S.cloudDir) { S.cloudDir = dir; store.set('cdir', S.cloudDir); }
  if (S.dirty && !force && !phoneMaster()) return conflict(r);
  S.keys = o.keys || {}; S.rev = r.rev; S.dirty = false; store.set('keys', S.keys); store.set('rev', S.rev); store.set('dirty', false);
  S.syncMsg = '已下載（' + (r.src || '手機') + ' ' + (r.at || '') + '）'; S.lastSync = Date.now(); S.syncAt = r.at || '';
  return 'applied';
}
async function conflict(remote) {
  const r = remote || await api('dataGet', { session: S.session });
  const pick = await dialog('同步：選擇要保留的資料', `<div class="text2">雲端（${esc(r.src || '手機')}，${esc(r.at || '較新')}）與這個網頁都有尚未同步的變更。</div>
    <ul class="text2 small"><li>使用雲端：以雲端資料取代網頁上的變更</li><li>保留網頁：以網頁資料覆蓋雲端</li></ul>`, [['web', '保留網頁'], ['cloud', '使用雲端', 'primary']]);
  if (pick === 'cloud') { S.dirty = false; await pull(true); route(); }
  else if (pick === 'web') await push(true);
}
function kicked() {
  logout('你的帳號已在其他瀏覽器登入，這裡已自動登出');
}
function renderSync() {
  const txt = (phoneMaster() ? '📱 手機為主 · ' : S.cloudDir === 'w2p' ? '💻 網頁為主 · ' : '') + (S.syncing ? '同步中…' : S.dirty ? '有變更未上傳 · 點此同步' : (S.syncMsg || '已同步') + (S.lastSync ? ' · ' + hm(S.lastSync) : '') + (autoSync() ? '' : ' · 點此同步'));
  $$('.syncst').forEach((el) => { el.textContent = txt; el.title = '點一下立即同步'; el.style.cursor = 'pointer'; el.onclick = () => syncNow(); });
}

// ───────── 行情 ─────────
const MIS = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=';
const YC = 'https://query1.finance.yahoo.com/v8/finance/chart/';
function ysym(sym) { return isUs(sym) ? sym : sym + (D.otc(sym) ? '.TWO' : '.TW'); }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
/** 台股即時（證交所 MIS，上市＋上櫃一次查） */
async function fetchTw(syms) {
  const out = {};
  if (compOn()) return out;   // 合規模式：盤中即時改由使用者自己的富果金鑰串流
  const chunks = []; for (let i = 0; i < syms.length; i += 30) chunks.push(syms.slice(i, i + 30));
  await Promise.all(chunks.map(async (c) => {
    const ch = c.map((s) => (s === 't00' ? 'tse_t00.tw' : s === 'o00' ? 'otc_o00.tw' : 'tse_' + s + '.tw|otc_' + s + '.tw')).join('|');
    try {
      const j = await px(MIS + encodeURIComponent(ch), 5);
      (j.msgArray || []).forEach((a) => {
        const prev = num(a.y); let z = num(a.z);
        if (z == null) z = num((a.b || '').split('_')[0]) ?? num((a.a || '').split('_')[0]);
        const vol = num(a.v);
        out[a.c] = { price: z || prev, prev, open: num(a.o), high: num(a.h), low: num(a.l), vol: vol != null ? vol * (a.c === 't00' || a.c === 'o00' ? 1e6 : 1) : null,
          volLots: vol, time: Number(a.tlong) || Date.now(), name: a.n, up: num(a.u), down: num(a.w), otc: a.ex === 'otc' };
        const sp = (x) => String(x || '').split('_').filter(Boolean).map(Number);
        out[a.c].book = { b: sp(a.b), g: sp(a.g), a: sp(a.a), f: sp(a.f) };
        const q = out[a.c]; q.lu = !!(q.up && z && Math.abs(z - q.up) < 1e-6); q.ld = !!(q.down && z && Math.abs(z - q.down) < 1e-6);
      });
    } catch (e) {}
  }));
  return out;
}
/** 富果 Fugle 串流（選填）：瀏覽器直接連 wss://api.fugle.tw，金鑰只在這個瀏覽器加密保存、不經過本站伺服器、不同步 */
const FG_URL = 'wss://api.fugle.tw/marketdata/v1.0/stock/streaming';
const FG = { ws: null, authed: false, status: '', subs: new Set(), rej: new Set(), queue: [], awaiting: null, awaitingAt: 0, limit: false, at: {}, msgs: 0, retry: 0, authFail: '', connAt: 0, timer: 0 };
function fgWanted() { return (S.pref.twSrc === 'fugle' || compOn()) && aiHas('fugle'); }
/** 商業合規模式（管理員政策）：轉送站不代抓證交所盤中即時、Yahoo 非公開 API、鉅亨、MoneyDJ */
function compOn() { return !!(S.policy && S.policy.comp); }
function fgFresh(sym) { return FG.authed && Date.now() - (FG.at[sym] || 0) < 20000; }
function fgStop(msg) { const w = FG.ws; FG.ws = null; FG.authed = false; FG.subs.clear(); FG.rej.clear(); FG.queue = []; FG.awaiting = null; FG.limit = false; if (w) try { w.close(1000, 'bye'); } catch (e) {} if (msg != null) FG.status = msg; }
function fgSend(o) { try { FG.ws && FG.ws.readyState === 1 && FG.ws.send(JSON.stringify(o)); } catch (e) {} }
function fgPump() {
  if (!FG.authed) return;
  if (FG.awaiting && Date.now() - FG.awaitingAt > 10000) { FG.subs.add(FG.awaiting); FG.awaiting = null; }
  if (FG.awaiting) return;
  if (FG.limit) { FG.queue.forEach((s) => FG.rej.add(s)); FG.queue = []; return; }
  const s = FG.queue.shift(); if (!s) return;
  FG.awaiting = s; FG.awaitingAt = Date.now(); fgSend({ event: 'subscribe', data: { channel: 'aggregates', symbol: s } });
}
function fgPriority(syms) {
  const f = (location.hash.match(/^#\/s\/([^/?]+)/) || [])[1]; const held = new Set(holdings().map((h) => h.symbol));
  const rank = (s) => (s === decodeURIComponent(f || '') ? 0 : held.has(s) ? 1 : 2);
  return syms.slice().sort((a, b) => rank(a) - rank(b));
}
let fgRT = 0;
function fgApply(d) {
  const sym = d.symbol; if (!sym) return; const n = (v) => (v == null || isNaN(+v) ? null : +v);
  const prev = n(d.referencePrice) ?? n(d.previousClose); const price = n(d.lastPrice) ?? n(d.closePrice); if (prev == null || price == null) return;
  const t = d.total || {}; const q = S.q[sym] = { ...(S.q[sym] || {}) };
  const tm = Number(d.lastUpdated) || Date.now();
  Object.assign(q, { price, prev, open: n(d.openPrice) ?? q.open, high: n(d.highPrice) ?? q.high, low: n(d.lowPrice) ?? q.low, time: tm > 1e14 ? Math.floor(tm / 1000) : tm, src: 'fugle' });
  if (t.tradeVolume != null) { q.vol = +t.tradeVolume; q.volLots = +t.tradeVolume; }
  if (d.name) q.name = q.name || d.name;
  const lv = (a) => (Array.isArray(a) ? a : []); const bids = lv(d.bids), asks = lv(d.asks);
  if (bids.length || asks.length) q.book = { b: bids.map((x) => +x.price), g: bids.map((x) => +x.size), a: asks.map((x) => +x.price), f: asks.map((x) => +x.size) };
  q.lu = !!(q.up && Math.abs(price - q.up) < 1e-6); q.ld = !!(q.down && Math.abs(price - q.down) < 1e-6);
  FG.at[sym] = Date.now(); FG.status = '富果串流同步中（' + Object.keys(FG.at).filter((k) => Date.now() - FG.at[k] < 600000).length + ' 檔）';
  // 推播很密時合併成每 3 秒重畫一次
  if (!fgRT) fgRT = setTimeout(() => { fgRT = 0; softFill(); }, 3000);
}
function fgMsg(o) {
  FG.msgs++;
  const ev = o.event;
  if (ev === 'authenticated') { FG.authed = true; FG.authFail = ''; FG.retry = 0; FG.connAt = Date.now(); FG.status = '富果串流已連線'; fgPump(); return; }
  if (ev === 'subscribed') { const sym = (o.data && o.data.symbol) || FG.awaiting; if (sym) FG.subs.add(sym); if (!o.data || sym === FG.awaiting || !o.data.symbol) FG.awaiting = null; fgPump(); return; }
  if (ev === 'error') {
    const msg = String((o.data && o.data.message) || '錯誤');
    if (/auth|credential|unauthor/i.test(msg)) { FG.authFail = FG.key || 'x'; fgStop('富果金鑰驗證失敗，改用證交所即時'); return; }
    const limit = /limit|exceed|maximum|上限|超過/i.test(msg); if (FG.awaiting) FG.rej.add(FG.awaiting); FG.awaiting = null; if (limit) FG.limit = true;
    FG.status = '富果：' + msg + (limit ? '（已優先訂閱正在看的個股與持股，其餘用證交所即時）' : ''); fgPump(); return;
  }
  if (ev === 'data' && o.channel === 'aggregates' && o.data) fgApply(o.data);
}
function fgConnect(key) {
  FG.key = key; FG.status = '富果串流連線中…';
  let w; try { w = new WebSocket(FG_URL); } catch (e) { FG.status = '無法建立富果連線：' + e.message; return; }
  FG.ws = w;
  w.onopen = () => w.send(JSON.stringify({ event: 'auth', data: { apikey: key } }));
  w.onmessage = (e) => { try { fgMsg(JSON.parse(e.data)); } catch (x) {} };
  w.onclose = () => { if (FG.ws !== w) return; FG.ws = null; FG.authed = false; FG.subs.clear(); FG.queue = []; FG.awaiting = null; FG.limit = false;
    if (FG.authFail) return; FG.status = '富果串流中斷，' + Math.min(60, 2 << Math.min(FG.retry, 5)) + ' 秒後重連（期間用證交所即時）';
    clearTimeout(FG.timer); FG.timer = setTimeout(() => { if (!FG.ws) tick(); }, Math.min(60000, 2000 << Math.min(FG.retry++, 5))); };
}
/** 每次更新行情時呼叫：盤中且選用富果時維持連線並補訂閱（正在看的個股 → 持股 → 其他） */
async function fgSync(syms) {
  const on = fgWanted() && twOpen() && (!document.hidden || S.pref.bgRefresh === '1');
  if (!on) { if (FG.ws) fgStop(fgWanted() ? '非交易時間，富果串流已暫停' : ''); else if (!fgWanted()) FG.status = ''; else if (!FG.authFail) FG.status = '非交易時間，盤中自動連線富果串流'; return; }
  const tw = fgPriority(Array.from(new Set(syms.filter((x) => x && !isUs(x) && x !== 't00' && x !== 'o00'))));
  if (!FG.ws) { const key = await aiKeyGet('fugle'); if (!key) return; if (key === FG.authFail) { FG.status = '富果金鑰驗證失敗，請到「設定 › 即時行情」更新金鑰'; return; } fgConnect(key); return; }
  if (!FG.authed) return;
  tw.forEach((x) => { if (!FG.subs.has(x) && !FG.rej.has(x) && !FG.queue.includes(x) && FG.awaiting !== x) FG.queue.push(x); }); fgPump();
}
/** 測試富果金鑰：連線並驗證後立即關閉 */
function fgTest(key) {
  return new Promise((res) => {
    let w; const done = (ok, msg) => { try { w && w.close(); } catch (e) {} res([ok, msg]); };
    const to = setTimeout(() => done(false, '逾時：無法連上富果（請確認網路或防火牆）'), 9000);
    try { w = new WebSocket(FG_URL); } catch (e) { clearTimeout(to); return done(false, e.message); }
    w.onopen = () => w.send(JSON.stringify({ event: 'auth', data: { apikey: key } }));
    w.onmessage = (e) => { let o = {}; try { o = JSON.parse(e.data); } catch (x) {} if (o.event === 'authenticated') { clearTimeout(to); done(true, '連線成功：金鑰驗證通過，盤中可用富果串流'); } else if (o.event === 'error') { clearTimeout(to); done(false, '驗證失敗：' + ((o.data && o.data.message) || '金鑰無效')); } };
    w.onerror = () => { clearTimeout(to); done(false, '連線失敗：瀏覽器無法連上富果串流'); };
  });
}
function fgStats() {
  if (!fgWanted()) return '證交所 MIS 即時（約每 ' + (S.pref.refresh || 10) + ' 秒）';
  return (FG.status || '富果串流（盤中自動連線）') + (FG.authed ? ' · 訂閱 ' + FG.subs.size + ' 檔' + (FG.rej.size ? '（' + FG.rej.size + ' 檔超出上限，改用證交所）' : '') + ' · 已收 ' + FG.msgs + ' 則' : '');
}
// ───────── Alpaca 美股（選填，使用者自己的金鑰）：IEX 逐筆串流、快照、全市場歷史 K ─────────
// 金鑰以瀏覽器加密保存；串流與查詢由瀏覽器直連 Alpaca，瀏覽器擋跨網域查詢時才經本站轉送（只轉送、不保存、不快取）。
// 免費方案：即時只有 IEX 一家交易所；全市場（SIP）歷史須為 15 分鐘前；同一組金鑰同時只能一條串流。資料不可再散布。
const AP_WS = 'wss://stream.data.alpaca.markets/v2/iex';
const AP = { ws: null, authed: false, status: '', subs: new Set(), want: [], at: {}, msgs: 0, retry: 0, authFail: '', dupUntil: 0, timer: 0, direct: null, prev: {}, cc: {} };
const AP_RE = /^[A-Za-z][A-Za-z.\-]{0,9}$/;
function apHas() { return aiHas('alpacaId') && aiHas('alpacaSec'); }
function apOk(sym) { return apHas() && !!sym && isUs(sym) && AP_RE.test(sym); }
async function apKeys() { const [id, sec] = await Promise.all([aiKeyGet('alpacaId'), aiKeyGet('alpacaSec')]); return id && sec ? { id, sec } : null; }
const apA = (s) => String(s).toUpperCase().replace(/-/g, '.');
const apY = (s) => String(s).replace(/\./g, '-');
function nyDate(ms) { return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
function nyHm(ms) { return new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour12: false }).slice(0, 5); }
/** 美股正常交易時段（美東 09:25–16:05，週一至週五；休市日串流只是沒有成交） */
function usOpen() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const m = +p.hour * 60 + +p.minute; return p.weekday !== 'Sat' && p.weekday !== 'Sun' && m >= 565 && m <= 965;
}
async function apGet(path, k) {
  k = k || await apKeys(); if (!k) throw new Error('未設定 Alpaca 金鑰');
  const fail = async (r) => { const j = await r.json().catch(() => ({})); return Object.assign(new Error(j.message || j.err || ('HTTP ' + r.status)), { http: r.status }); };
  if (AP.direct !== false) {
    try {
      const r = await fetch('https://data.alpaca.markets' + path, { headers: { 'APCA-API-KEY-ID': k.id, 'APCA-API-SECRET-KEY': k.sec } });
      AP.direct = true; if (!r.ok) throw await fail(r); return await r.json();
    } catch (e) { if (e.http || AP.direct === true) throw e; AP.direct = false; }
  }
  const r = await fetch('/api/ap?p=' + encodeURIComponent(path), { headers: { 'x-ap-id': k.id, 'x-ap-sec': k.sec } });
  if (!r.ok) throw await fail(r); return r.json();
}
/** 前一交易日全市場收盤（SIP 日 K），每檔一小時快取 */
async function apPrev(syms) {
  const now = Date.now(); const need = syms.filter((s) => !(AP.prev[s] && now - AP.prev[s].at < 3600000));
  if (need.length) {
    const st = new Date(now - 10 * 864e5).toISOString().slice(0, 10); const end = new Date(now - 16 * 60000).toISOString(); const today = nyDate(now);
    const j = await apGet(`/v2/stocks/bars?symbols=${encodeURIComponent(need.map(apA).join(','))}&timeframe=1Day&start=${st}&end=${encodeURIComponent(end)}&feed=sip&adjustment=split&limit=10000`);
    Object.entries(j.bars || {}).forEach(([k, arr]) => { const p = (arr || []).filter((b) => nyDate(Date.parse(b.t)) < today).pop(); if (p) AP.prev[apY(k)] = { c: p.c, at: now }; });
  }
  return Object.fromEntries(syms.filter((s) => AP.prev[s]).map((s) => [s, AP.prev[s].c]));
}
/** 批次快照：IEX 最新成交＋全市場昨收（漲跌以官方收盤計算；高低量為 IEX 當日 K） */
async function apQuotes(syms) {
  syms = Array.from(new Set(syms.filter(apOk))); if (!syms.length) return {};
  const [j, prev] = await Promise.all([apGet('/v2/stocks/snapshots?symbols=' + encodeURIComponent(syms.map(apA).join(',')) + '&feed=iex'), apPrev(syms).catch(() => ({}))]);
  const out = {};
  Object.entries(j || {}).forEach(([k, s]) => {
    if (!s) return; const sym = apY(k); const lt = s.latestTrade || {}, db = s.dailyBar || {}, pb = s.prevDailyBar || {};
    const price = lt.p || db.c; if (!price) return;
    out[sym] = { price, prev: prev[sym] || pb.c || price, open: db.o, high: db.h, low: db.l, vol: db.v, time: Date.parse(lt.t || db.t) || Date.now(), src: 'alpaca' };
  });
  return out;
}
/** 走勢／K 線換成 Yahoo 格式：1d（IEX 5 分 K）、5d（IEX 15 分 K）、1mo～2y（全市場日 K）、5 年以上（全市場週 K） */
async function apChart(sym, range, interval) {
  if (!apOk(sym)) return null;
  const ck = sym + '|' + range + '|' + interval; const c0 = AP.cc[ck]; const life = range === '1d' ? 60000 : range === '5d' ? 300000 : 1800000;
  if (c0 && Date.now() - c0.at < life) return c0.v;
  const now = Date.now(); const d = (n) => new Date(now - n * 864e5).toISOString().slice(0, 10);
  let tf, st, feed = 'sip';
  if (range === '1d') { tf = '5Min'; st = d(4); feed = 'iex'; }
  else if (range === '5d') { tf = '15Min'; st = d(9); feed = 'iex'; }
  else if (interval === '1wk' || interval === '1mo' || /^(5y|10y|max)$/.test(range)) { tf = '1Week'; st = d(range === '5y' ? 1830 : 3660); }
  else { const m = { '1mo': 35, '3mo': 100, '6mo': 190, ytd: 370, '1y': 370, '2y': 740 }[range]; if (!m) return null; tf = '1Day'; st = d(m); }
  try {
    let bars = [], tok = '', pg = 0;
    do {
      const j = await apGet(`/v2/stocks/bars?symbols=${encodeURIComponent(apA(sym))}&timeframe=${tf}&start=${st}${feed === 'sip' ? '&end=' + encodeURIComponent(new Date(now - 16 * 60000).toISOString()) : ''}&feed=${feed}&adjustment=split&limit=10000&sort=asc${tok ? '&page_token=' + encodeURIComponent(tok) : ''}`);
      bars = bars.concat((j.bars || {})[apA(sym)] || []); tok = j.next_page_token || '';
    } while (tok && ++pg < 10);
    if (range === '1d') { const last = bars.length ? nyDate(Date.parse(bars[bars.length - 1].t)) : ''; bars = bars.filter((b) => { const t = Date.parse(b.t); const hm = nyHm(t); return nyDate(t) === last && hm >= '09:30' && hm < '16:00'; }); }
    if (bars.length < 2) return null;
    const prev = range === '1d' || range === '5d' ? (await apPrev([sym]).catch(() => ({})))[sym] : null;
    const snap = range === '1d' ? (await apQuotes([sym]).catch(() => ({})))[sym] : null; const last = bars[bars.length - 1];
    const meta = { symbol: sym, regularMarketPrice: snap ? snap.price : last.c, chartPreviousClose: prev || bars[0].o, previousClose: prev || undefined,
      regularMarketDayHigh: snap ? snap.high : last.h, regularMarketDayLow: snap ? snap.low : last.l, regularMarketVolume: snap ? snap.vol : last.v,
      regularMarketTime: Math.floor((snap ? snap.time : Date.parse(last.t)) / 1000), instrumentType: 'EQUITY', dataSource: 'alpaca' };
    const v = { meta, timestamp: bars.map((b) => Math.floor(Date.parse(b.t) / 1000)),
      indicators: { quote: [{ open: bars.map((b) => b.o), high: bars.map((b) => b.h), low: bars.map((b) => b.l), close: bars.map((b) => b.c), volume: bars.map((b) => b.v) }] } };
    AP.cc[ck] = { at: Date.now(), v }; return v;
  } catch (e) { return null; }
}
/** 合規模式（或 Yahoo 失敗）時的美股報價：一次快照全部，再補當日走勢小圖 */
async function apUs(us) {
  const q = await apQuotes(us).catch(() => ({}));
  return Promise.all(us.map(async (s) => {
    if (!q[s]) return [s, null];
    const r = await apChart(s, '1d', '5m'); const cl = r ? r.indicators.quote[0].close.filter((v) => v != null) : null;
    return [s, { ...q[s], ...(cl && cl.length ? { spark: cl } : {}) }];
  }));
}
function apWanted() { return apHas() && S.pref.apStream !== '0'; }
function apFresh(sym) { return AP.authed && Date.now() - (AP.at[sym] || 0) < 30000; }
function apStop(msg) { const w = AP.ws; AP.ws = null; AP.authed = false; AP.subs = new Set(); if (w) try { w.close(1000, 'bye'); } catch (e) {} if (msg != null) AP.status = msg; }
function apSubs(syms) {
  const want = new Set(syms.slice(0, 30).map(apA));
  const add = [...want].filter((s) => !AP.subs.has(s)); const drop = [...AP.subs].filter((s) => !want.has(s));
  const send = (o) => { try { AP.ws && AP.ws.readyState === 1 && AP.ws.send(JSON.stringify(o)); } catch (e) {} };
  if (drop.length) send({ action: 'unsubscribe', trades: drop }); if (add.length) send({ action: 'subscribe', trades: add });
  AP.subs = want;
}
let apRT = 0;
function apMsg(o) {
  AP.msgs++;
  if (o.T === 'success' && o.msg === 'authenticated') { AP.authed = true; AP.retry = 0; AP.authFail = ''; AP.status = 'Alpaca IEX 串流已連線'; apSubs(AP.want); return; }
  if (o.T === 'error') {
    const c = +o.code;
    if (c === 401 || c === 402 || c === 403) { AP.authFail = AP.key || 'x'; apStop('Alpaca 金鑰驗證失敗，改用輪詢'); return; }
    if (c === 406) { AP.dupUntil = Date.now() + 60000; apStop('Alpaca：同一組金鑰已有其他串流（例如手機 App 開著），1 分鐘後重試，期間改用輪詢'); return; }
    AP.status = 'Alpaca：' + (o.msg || c) + (c === 405 ? '（免費方案最多 30 檔，已優先訂閱正在看的個股與持股）' : ''); return;
  }
  if (o.T === 't' && o.S && +o.p > 0) {
    const sym = apY(o.S); const q = S.q[sym]; if (!q || !q.prev) return; const t = Date.parse(o.t) || Date.now();
    if (q.src === 'alpaca' && q.time && t < q.time) return;
    S.q[sym] = { ...q, price: +o.p, time: t, src: 'alpaca' }; AP.at[sym] = Date.now();
    AP.status = 'Alpaca IEX 逐筆串流同步中（' + AP.subs.size + ' 檔）';
    if (!apRT) apRT = setTimeout(() => { apRT = 0; softFill(); }, 2000);
  }
}
function apConnect(k) {
  AP.key = k.id; AP.status = 'Alpaca 串流連線中…';
  let w; try { w = new WebSocket(AP_WS); } catch (e) { AP.status = '無法建立 Alpaca 連線：' + e.message; return; }
  AP.ws = w;
  w.onopen = () => w.send(JSON.stringify({ action: 'auth', key: k.id, secret: k.sec }));
  w.onmessage = (e) => { let a = []; try { a = JSON.parse(e.data); } catch (x) {} (Array.isArray(a) ? a : [a]).forEach(apMsg); };
  w.onclose = () => {
    if (AP.ws !== w) return; AP.ws = null; AP.authed = false; AP.subs = new Set();
    if (AP.authFail || Date.now() < AP.dupUntil) return;
    const dl = Math.min(60000, 2000 << Math.min(AP.retry++, 5)); AP.status = 'Alpaca 串流中斷，' + Math.round(dl / 1000) + ' 秒後重連（期間用輪詢）';
    clearTimeout(AP.timer); AP.timer = setTimeout(() => { if (!AP.ws) tick(); }, dl);
  };
}
/** 每次更新行情時呼叫：美股盤中且有 Alpaca 金鑰時維持串流（正在看的個股 → 持股 → 其他，最多 30 檔） */
async function apSync(syms) {
  const on = apWanted() && usOpen() && (!document.hidden || S.pref.bgRefresh === '1');
  if (!on) { if (AP.ws) apStop(apWanted() ? '非美股交易時間，Alpaca 串流已暫停' : ''); else if (!apWanted()) AP.status = ''; return; }
  AP.want = fgPriority(Array.from(new Set(syms.filter(apOk))));
  if (!AP.ws) {
    if (Date.now() < AP.dupUntil) return; const k = await apKeys(); if (!k) return;
    if (k.id === AP.authFail) { AP.status = 'Alpaca 金鑰驗證失敗，請到「設定 › 即時行情」更新金鑰'; return; }
    apConnect(k); return;
  }
  if (AP.authed) apSubs(AP.want);
}
/** 測試 Alpaca 金鑰：查 AAPL 最新成交 */
async function apTest(k) {
  try { const j = await apGet('/v2/stocks/AAPL/trades/latest?feed=iex', k); return [true, '連線成功：AAPL 最新成交 ' + fmt(j.trade && j.trade.p, 2) + '（IEX）' + (AP.direct === false ? '・經本站轉送' : '')]; }
  catch (e) { return [false, '驗證失敗：' + (e.http === 401 || e.http === 403 ? '金鑰無效或沒有權限' : e.message)]; }
}
function apStats() {
  if (!apHas()) return '';
  return '美股 Alpaca：' + (AP.status || (usOpen() ? '串流準備中' : '非交易時間，盤中自動連線')) + (AP.authed ? ' · 訂閱 ' + AP.subs.size + ' 檔 · 已收 ' + AP.msgs + ' 則' : '');
}
/** Yahoo 走勢（美股報價、台股與美股的當日走勢小圖） */
async function fetchYahoo(sym, range = '1d', interval = '5m', ttl = 30, prePost = false) {
  // 美股有 Alpaca 金鑰：合規模式優先用 Alpaca；一般模式在 Yahoo 失敗時備援
  const ap = apOk(sym);
  if (ap && compOn()) { const a = await apChart(sym, range, interval); if (a) return a; }
  try {
    const j = await px(YC + encodeURIComponent(sym) + '?range=' + range + '&interval=' + interval + '&includePrePost=' + (prePost ? 'true' : 'false'), ttl);
    const r = (j.chart && j.chart.result && j.chart.result[0]) || null; if (r) return r;
  } catch (e) {}
  return ap && !compOn() ? apChart(sym, range, interval) : null;
}
async function fetchUs(sym) {
  // 含盤前盤後的分時：盤中價看 meta，盤前（04:00–09:30 美東）／盤後（16:00–20:00）取該時段最後一筆成交
  const r = await fetchYahoo(sym, '1d', '5m', 30, true); if (!r || !r.meta) return null;
  const m = r.meta; const prev = m.chartPreviousClose || m.previousClose;
  const ts = r.timestamp || []; const cl = (r.indicators && r.indicators.quote && r.indicators.quote[0].close) || [];
  const tp = m.currentTradingPeriod || {}; const reg = tp.regular || {}; const pre = tp.pre || {}; const post = tp.post || {};
  const inReg = (t) => !reg.start || (t >= reg.start && t < reg.end);
  const closes = ts.map((t, i) => (inReg(t) ? cl[i] : null)).filter((v) => v != null);
  const lastIn = (a, b) => { for (let i = ts.length - 1; i >= 0; i--) if (ts[i] >= a && ts[i] < b && cl[i] != null) return [cl[i], ts[i] * 1000]; return null; };
  const now = Date.now() / 1000; let ext = null;
  if (pre.start && now >= pre.start && now < (reg.start || pre.end)) { const x = lastIn(pre.start, pre.end); if (x) ext = { label: '盤前', price: x[0], time: x[1] }; }
  else if (post.start && now >= post.start) { const x = lastIn(post.start, post.end); if (x) ext = { label: '盤後', price: x[0], time: x[1] }; }
  if (ext && m.regularMarketPrice) ext.pct = (ext.price / m.regularMarketPrice - 1) * 100;
  let prev2 = prev;
  if (ext && ext.label === '盤前' && prev && Math.abs(prev - m.regularMarketPrice) < 1e-9) {
    // 盤前 Yahoo 的昨收常等於最近收盤：改取日 K 前一根收盤，最近一次正常交易的漲跌才正確
    try { const d = await fetchYahoo(sym, '5d', '1d', 1800); const today = nyDate(Date.now());
      const cs = ((d && d.timestamp) || []).map((t, i) => [nyDate(t * 1000), ((d.indicators.quote[0] || {}).close || [])[i]]).filter((x) => x[1] != null && x[0] < today);
      if (cs.length >= 2 && Math.abs(cs[cs.length - 1][1] - m.regularMarketPrice) / m.regularMarketPrice < 0.002) prev2 = cs[cs.length - 2][1]; } catch (e) {}
  }
  return { price: m.regularMarketPrice, prev: prev2, high: m.regularMarketDayHigh, low: m.regularMarketDayLow, vol: m.regularMarketVolume, time: (m.regularMarketTime || 0) * 1000,
    name: m.shortName || m.longName, spark: closes.length ? closes : cl.filter((v) => v != null), h52: m.fiftyTwoWeekHigh, l52: m.fiftyTwoWeekLow, type: m.instrumentType, ext };
}
/** 盤前／盤後價格小標（美股） */
function extHtml(q, big) {
  const e = q && q.ext; if (!e || !e.price) return '';
  const d = q.price ? e.price - q.price : 0;
  return `<div class="num" style="margin-top:${big ? 8 : 2}px;font-size:${big ? 18 : 12}px"><span class="tag" style="background:#E8B04B;color:#222">${e.label}</span> <b>${fmt(e.price, 2)}</b> <span class="${cls(e.pct || 0)}">${arrow(e.pct || 0)}${big && d ? ' ' + fmt(Math.abs(d), 2) : ''} ${fmtPct(e.pct || 0)}</span> <span class="muted">${hm(e.time)}</span>${big ? '<div class="small muted" style="font-size:12px">' + e.label + '漲跌以最近一次正常交易收盤 ' + fmt(q.price, 2) + ' 計</div>' : ''}</div>`;
}
/** 表格／清單用的盤前盤後小字（美股） */
function extMini(q) {
  const e = q && q.ext; if (!e || !e.price) return '';
  return `<div class="small num" style="white-space:nowrap"><span style="color:#E8B04B;font-weight:700">${e.label}</span> ${fmt(e.price, 2)} <span class="${cls(e.pct || 0)}">${fmtPct(e.pct || 0)}</span></div>`;
}
// ───────── 美股時段（美東 04:00 盤前、09:30 開盤、16:00 收盤、20:00 盤後結束；休市 US_HOLIDAY、提早收盤 US_HALF） ─────────
const US_HALF = { 2026: ['11/27', '12/24'], 2027: ['11/26'] };
function nyNow(ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, md: p.month + '/' + p.day, wd: p.weekday, m: +p.hour * 60 + +p.minute };
}
function usPhase(ms = Date.now()) {
  const n = nyNow(ms); const hol = (US_HOLIDAY[n.y] || []).find(([d]) => d === n.md); const half = (US_HALF[n.y] || []).includes(n.md);
  const close = half ? 780 : 960, postEnd = half ? 1020 : 1200;
  const k = n.wd === 'Sat' || n.wd === 'Sun' || hol ? 'OFF' : n.m >= 240 && n.m < 570 ? 'PRE' : n.m >= 570 && n.m < close ? 'REG' : n.m >= close && n.m < postEnd ? 'POST' : 'NIGHT';
  return { k, half, hol: hol ? hol[1] : '', m: n.m, close, postEnd, label: { PRE: '盤前交易中', REG: '盤中', POST: '盤後交易中', NIGHT: '已收盤', OFF: hol ? '休市（' + hol[1] + '）' : '週末休市' }[k] };
}
/** 美東分鐘數 → 台灣時間（依目前夏令／冬令時差） */
function usTw(nyMin) {
  const d = tpeNow(); const diff = Math.round((((d.getHours() * 60 + d.getMinutes()) - nyNow().m + 1440) % 1440) / 60) * 60;
  const t = (nyMin + diff) % 1440; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
function durTxt(min) { return min >= 60 ? Math.floor(min / 60) + ' 小時' + (min % 60 ? ' ' + (min % 60) + ' 分' : '') : min + ' 分鐘'; }
/** 美股時段標籤＋倒數（個股頁、美股市場頁） */
function usSessLine() {
  const p = usPhase(); const pre = p.k === 'PRE' || p.k === 'POST';
  const nxt = p.k === 'PRE' ? '距開盤 ' + durTxt(570 - p.m) + '（台灣 ' + usTw(570) + '）' : p.k === 'REG' ? '距收盤 ' + durTxt(p.close - p.m) + '（台灣 ' + usTw(p.close) + '）'
    : p.k === 'POST' ? '盤後交易至台灣 ' + usTw(p.postEnd) : p.k === 'NIGHT' ? '下一段盤前：台灣 ' + usTw(240) : '';
  return `<span class="tag" style="background:${p.k === 'REG' ? 'var(--primary)' : pre ? '#E8B04B' : 'var(--grid)'};color:${p.k === 'REG' ? '#fff' : '#222'}">美股${p.label}</span>${nxt ? ' <span class="small muted">' + nxt + '</span>' : ''}${p.half ? ' <span class="small muted">今日提早收盤</span>' : ''}`;
}
function usSchedTxt() { const p = usPhase(); return '台灣時間：盤前 ' + usTw(240) + '・開盤 ' + usTw(570) + '・收盤 ' + usTw(p.close) + '・盤後至 ' + usTw(p.postEnd) + (p.half ? '（今日提早收盤）' : ''); }
async function sparkTw(sym) {
  const r = await fetchYahoo(ysym(sym), '1d', '5m', 120); if (!r) return;
  const closes = ((r.indicators && r.indicators.quote && r.indicators.quote[0].close) || []).filter((v) => v != null);
  if (S.q[sym]) S.q[sym].spark = closes;
}
async function refreshQuotes(syms) {
  syms = Array.from(new Set(syms.filter(Boolean)));
  const tw = syms.filter((s) => !isUs(s)); const usIv = (S.pref.usRefresh || 0) * 1000; S.usAt = S.usAt || {};
  const us = syms.filter((s) => isUs(s) && (!usIv || !(S.q[s] && S.q[s].price) || Date.now() - (S.usAt[s] || 0) >= usIv - 500)); us.forEach((s) => { S.usAt[s] = Date.now(); });
  const apFirst = apHas() && compOn(); // 合規模式：美股改用 Alpaca 快照（一次一個請求）
  const [twq, usq] = await Promise.all([tw.length ? fetchTw(tw) : {}, apFirst ? apUs(us.filter(apOk)) : Promise.all(us.map(async (s) => [s, await fetchUs(s)]))]);
  // Yahoo 抓不到的美股：有 Alpaca 金鑰時補上
  if (!apFirst && apHas()) { const miss = usq.filter(([s, v]) => !v && apOk(s)).map(([s]) => s); if (miss.length) { const m = Object.fromEntries(await apUs(miss)); usq.forEach((x) => { if (!x[1] && m[x[0]]) x[1] = m[x[0]]; }); } }
  Object.entries(twq).forEach(([k, v]) => {
    if (fgFresh(k)) { const o = S.q[k] || {}; S.q[k] = { ...o, name: o.name || v.name, up: v.up, down: v.down, otc: v.otc, book: o.book || v.book }; return; } // 富果串流較新，只補漲跌停價等欄位
    S.q[k] = { ...(S.q[k] || {}), ...v, src: 'twse' }; });
  usq.forEach(([s, v]) => {
    if (!v) return; const o = S.q[s] || {};
    // Alpaca 串流的逐筆成交較新：保留串流價格，只更新昨收、高低、盤前盤後等欄位
    S.q[s] = apFresh(s) && o.src === 'alpaca' && (o.time || 0) >= (v.time || 0) ? { ...o, ...v, price: o.price, time: o.time, src: 'alpaca' } : { ...o, ...v };
  });
  // 連線狀態：要查的都沒拿到 → 顯示提示
  const got = Object.keys(twq).length + usq.filter(([, v]) => v).length;
  netState(syms.length === 0 || got > 0 || !navigator.onLine ? (navigator.onLine ? 'ok' : 'off') : 'fail');
}
function netState(st) {
  let el = $('#net');
  if (st === 'ok') { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'net'; el.className = 'netbar'; document.body.appendChild(el); }
  el.textContent = st === 'off' ? '⚠ 目前離線，顯示的是上次的資料' : compOn() && (!aiHas('fugle') || !apHas()) ? '⚠ 商業合規模式：即時報價請到「設定 › 即時行情」填入自己的金鑰（台股：富果；美股：Alpaca）' : '⚠ 暫時無法取得行情，稍後自動重試';
}
window.addEventListener('online', () => { netState('ok'); tick(); });
window.addEventListener('offline', () => netState('off'));
async function loadDir() { if (!S.dir) S.dir = (await kv('sx:dir')) || {}; return S.dir; }
const INDEXES = [
  { k: 't00', n: '加權指數' }, { k: 'o00', n: '櫃買指數' }, { k: '^DJI', n: '道瓊' }, { k: '^IXIC', n: '那斯達克' },
  { k: '^GSPC', n: 'S&P 500' }, { k: '^SOX', n: '費城半導體' }, { k: 'TWD=X', n: '美元／台幣' },
];
async function refreshIndexes() {
  const tw = await fetchTw(['t00', 'o00']);
  Object.entries(tw).forEach(([k, v]) => { S.q[k] = v; });
  await Promise.all(INDEXES.filter((x) => isUs(x.k)).map(async (x) => { const v = await fetchUs(x.k); if (v) S.q[x.k] = v; }));
}
// 漲跌停（Yahoo 排行，逐頁讀到不再是漲停／跌停）
const LIMIT = { up: [], down: [], at: 0, loading: false };
async function refreshLimits(force = false) {
  if (compOn()) return;   // 合規模式：Yahoo 排行為非公開 API，停用
  if (LIMIT.loading || (!force && Date.now() - LIMIT.at < (twOpen() ? 60000 : 600000))) return;
  LIMIT.loading = true;
  const pull = async (ex, up) => {
    const out = []; const flag = up ? 'limitUp' : 'limitDown';
    for (let off = 0; off < 500; off += 50) {
      const u = 'https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.rank;exchange=' + ex + ';limit=50;offset=' + off + ';period=1D;sortBy=' + (up ? '-changePercent' : 'changePercent');
      let j; try { j = await px(u, 60); } catch (e) { break; }
      const list = j.list || []; let stop = false;
      for (const o of list) {
        if (!o[flag]) { stop = true; continue; }
        const n = (v) => parseFloat(String(v == null ? '' : v).replace(/[,%+]/g, '')) || 0;
        out.push({ code: String(o.symbol).split('.')[0], name: o.name, market: ex === 'TAI' ? '上市' : '上櫃', price: n(o.price), change: n(o.change), pct: n(o.changePercent), vol: n(o.volume) });
      }
      if (stop || list.length < 50) break;
    }
    return out;
  };
  try {
    const [a, b, c, d] = await Promise.all([pull('TAI', true), pull('TWO', true), pull('TAI', false), pull('TWO', false)]);
    LIMIT.up = a.concat(b).sort((x, y) => y.vol - x.vol); LIMIT.down = c.concat(d).sort((x, y) => y.vol - x.vol); LIMIT.at = Date.now();
  } finally { LIMIT.loading = false; }
}

// ───────── 小圖 ─────────
function sparkSvg(data, color, w = 200, h = 30) {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data), max = Math.max(...data), r = max - min || 1;
  const pts = data.map((v, i) => (i / (data.length - 1) * w).toFixed(1) + ',' + (h - 2 - (v - min) / r * (h - 4)).toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="sk" width="100%" height="${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ───────── 技術指標（與 App 的 StockMetrics 相同定義） ─────────
function sma(a, n) { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function ema(a, n) { const o = []; const k = 2 / (n + 1); let e = null; for (let i = 0; i < a.length; i++) { e = e == null ? a[i] : a[i] * k + e * (1 - k); o.push(e); } return o; }
function rsiArr(c, n = 14) {
  const o = new Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    if (i <= n) { g += Math.max(d, 0); l += Math.max(-d, 0); if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return o;
}
function kdArr(h, l, c, n = 9) {
  const K = [], Dd = []; let k = 50, d = 50;
  for (let i = 0; i < c.length; i++) {
    if (i < n - 1) { K.push(null); Dd.push(null); continue; }
    let hh = -Infinity, ll = Infinity; for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, h[j]); ll = Math.min(ll, l[j]); }
    const rsv = hh === ll ? 50 : (c[i] - ll) / (hh - ll) * 100;
    k = k * 2 / 3 + rsv / 3; d = d * 2 / 3 + k / 3; K.push(k); Dd.push(d);
  }
  return [K, Dd];
}
function macdArr(c) { const e12 = ema(c, 12), e26 = ema(c, 26); const dif = c.map((_, i) => e12[i] - e26[i]); const dea = ema(dif, 9); return [dif, dea, dif.map((v, i) => (v - dea[i]) * 2)]; }

// ───────── K 線圖（Canvas） ─────────
/** 圖表縮放與平移：滑鼠滾輪縮放（以游標位置為中心）、拖曳平移、雙擊還原；觸控雙指縮放、單指拖曳 */
function chartZoom(cv, wrap, n, def, geo, redraw) {
  const z = wrap._z; const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const minN = Math.min(n, 10);
  const apply = (count, anchorFrac) => {
    const from = n - z.count - z.off; const anchor = from + anchorFrac * z.count;
    const nc = clamp(Math.round(count), minN, n); z.count = nc; z.off = clamp(Math.round(n - (anchor - anchorFrac * nc) - nc), 0, n - nc); redraw();
  };
  wrap._zoom = (f) => { if (f === 0) { z.count = def; z.off = 0; redraw(); } else apply(z.count * f, 1); };
  const frac = (clientX) => { const r = cv.getBoundingClientRect(); return clamp((clientX - r.left - geo.padL) / geo.w, 0, 1); };
  cv.onwheel = (e) => { e.preventDefault(); apply(z.count * (e.deltaY > 0 ? 1.15 : 1 / 1.15), frac(e.clientX)); };
  cv.ondblclick = () => { z.count = def; z.off = 0; redraw(); };
  cv.onmousedown = (e) => {
    if (e.button !== 0) return; const x0 = e.clientX, off0 = z.off; let moved = false; cv.style.cursor = 'grabbing';
    const mv = (ev) => { const d = Math.round((ev.clientX - x0) / (geo.w / z.count)); if (d) moved = true; const nv = clamp(off0 + d, 0, n - z.count); if (nv !== z.off) { z.off = nv; redraw(); } };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); cv.style.cursor = ''; };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  let t0 = null;
  cv.ontouchstart = (e) => { if (e.touches.length === 2) { t0 = { d: Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1, c: z.count, f: frac((e.touches[0].clientX + e.touches[1].clientX) / 2) }; } else if (e.touches.length === 1) t0 = { x: e.touches[0].clientX, off: z.off }; };
  cv.ontouchmove = (e) => {
    if (!t0) return;
    if (e.touches.length === 2 && t0.d) { e.preventDefault(); const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1; apply(t0.c * t0.d / d, t0.f); }
    else if (e.touches.length === 1 && t0.x != null) { const dd = Math.round((e.touches[0].clientX - t0.x) / (geo.w / z.count)); if (Math.abs(e.touches[0].clientX - t0.x) > 8) e.preventDefault(); const nv = clamp(t0.off + dd, 0, n - z.count); if (nv !== z.off) { z.off = nv; redraw(); } }
  };
  cv.ontouchend = () => { t0 = null; };
}
/** 畫布解析度：裝置像素比 × 雙指放大倍率（最多 4 倍），放大後重畫才不會模糊 */
function pxRatio() { const z = (window.visualViewport && window.visualViewport.scale) || 1; return Math.min(4, (window.devicePixelRatio || 1) * Math.max(1, z)); }
// 雙指放大／縮小停止後，以新的倍率重畫圖表（交易計畫、操作計畫、K 線等畫布）
if (window.visualViewport) { let lz = window.visualViewport.scale || 1, zt = 0;
  window.visualViewport.addEventListener('resize', () => { const z = window.visualViewport.scale || 1; if (Math.abs(z - lz) < 0.15) return; clearTimeout(zt); zt = setTimeout(() => { lz = window.visualViewport.scale || 1; document.querySelectorAll('.chart-wrap').forEach((w) => { if (w._redraw) try { w._redraw(); } catch (e) {} }); }, 250); }); }
/** 十字線：疊一層透明畫布，移動時只重畫這一層（不重繪主圖）；S.pref.xh＝false 關閉 */
function xhair(wrap, cv, H) {
  let o = wrap.querySelector('canvas.xh');
  if (!o) { o = document.createElement('canvas'); o.className = 'xh'; cv.after(o); }
  const dpr = pxRatio(); const W = wrap.clientWidth;
  o.width = W * dpr; o.height = H * dpr; o.style.height = H + 'px';
  const g = o.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const clear = () => g.clearRect(0, 0, W, H);
  return { clear, draw(px, py, yLabel, xLabel, padR, bottom) {
    clear(); if (S.pref.xh === false) return;
    const fg = css('--card') || '#fff', bg = css('--text') || '#333';
    g.strokeStyle = css('--muted'); g.lineWidth = 1; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(Math.round(px) + 0.5, 0); g.lineTo(Math.round(px) + 0.5, bottom); g.stroke();
    if (yLabel != null && py >= 0 && py <= bottom) { g.beginPath(); g.moveTo(0, Math.round(py) + 0.5); g.lineTo(W - padR, Math.round(py) + 0.5); g.stroke(); }
    g.setLineDash([]); g.font = '11px sans-serif'; g.textBaseline = 'middle';
    if (yLabel != null && py >= 0 && py <= bottom) { g.fillStyle = bg; g.fillRect(W - padR + 1, py - 8, padR - 2, 16); g.fillStyle = fg; g.fillText(String(yLabel), W - padR + 3, py); }
    if (xLabel) { const tw = g.measureText(xLabel).width + 10; const lx = Math.max(0, Math.min(W - padR - tw, px - tw / 2)); g.fillStyle = bg; g.fillRect(lx, H - 15, tw, 15); g.fillStyle = fg; g.fillText(xLabel, lx + 5, H - 7.5); }
  } };
}
function zoomState(wrap, key, def, n) {
  if (wrap._key !== key || !wrap._z) { wrap._key = key; wrap._z = { count: def, off: 0 }; }
  const z = wrap._z; z.count = Math.max(Math.min(n, 10), Math.min(n, z.count)); z.off = Math.max(0, Math.min(n - z.count, z.off)); return z;
}
function drawChart(wrap, bars, opt) {
  wrap._redraw = () => drawChart(wrap, bars, opt);
  const cv = wrap.querySelector('canvas'); const tip = wrap.querySelector('.chart-tip');
  const W = wrap.clientWidth; const subOn = !!opt.sub; const H = opt.H || (subOn ? 460 : 360);
  const dpr = pxRatio(); cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const UP = css('--up'), DN = css('--down'), GRID = css('--grid'), TXT = css('--muted');
  const padR = 56, padL = 6, top = 8;
  const mainH = subOn ? H - 210 : H - 100, volTop = top + mainH + 8, volH = 60, subTop = volTop + volH + 10, subH = subOn ? H - subTop - 18 : 0;
  const c = bars.map((b) => b.c);
  const MAS = opt.intraday ? [] : (opt.mas && opt.mas.length ? opt.mas : [5, 20, 60]).slice(0, 4); const ty = opt.type || 'candle'; const MAC = ['#f59e0b', '#a855f7', '#38bdf8', '#ec4899'];
  const ma = { 20: sma(c, 20) }; MAS.forEach((p) => { ma[p] = sma(c, p); });
  const n = bars.length; const def = Math.min(n, opt.count || n); const z = zoomState(wrap, opt.key || 'k' + n, def, n);
  const from = Math.max(0, n - z.count - z.off); const vis = bars.slice(from, n - z.off);
  const OV = opt.overlay || null; const fut = OV ? 6 : 0;
  const cw = (W - padL - padR) / Math.max(vis.length + fut, 1);
  let hi = -Infinity, lo = Infinity, vmax = 0;
  vis.forEach((b, i) => { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); vmax = Math.max(vmax, b.v || 0);
    MAS.forEach((p) => { const v = ma[p][from + i]; if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } }); });
  if (opt.avg && opt.avg > lo * 0.8 && opt.avg < hi * 1.25) { hi = Math.max(hi, opt.avg); lo = Math.min(lo, opt.avg); }
  if (opt.base) { hi = Math.max(hi, opt.base); lo = Math.min(lo, opt.base); }
  (opt.levels || []).forEach((l) => { hi = Math.max(hi, l.v); lo = Math.min(lo, l.v); });
  if (OV) OV.prices.forEach((v) => { if (v > 0 && isFinite(v)) { hi = Math.max(hi, v); lo = Math.min(lo, v); } });
  const pad = (hi - lo) * (opt.overlay ? 0.1 : 0.06) || 1; hi += pad; lo -= pad;
  const y = (v) => top + (hi - v) / (hi - lo) * mainH;
  const x = (i) => padL + i * cw + cw / 2;
  g.clearRect(0, 0, W, H); g.font = '11px sans-serif'; g.textBaseline = 'middle';
  // 格線
  g.strokeStyle = GRID; g.lineWidth = 1; g.fillStyle = TXT;
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; const yy = y(v); g.beginPath(); g.moveTo(padL, yy); g.lineTo(W - padR, yy); g.stroke(); g.fillText(fmtPx(v), W - padR + 4, yy); }
  // 交易計畫：獲利區／風險區（畫在 K 棒底下）
  const ox = (k) => x(k - from); const clipMain = () => { g.save(); g.beginPath(); g.rect(0, 0, W - padR, top + mainH + 4); g.clip(); };
  if (OV) { clipMain(); drawOverlayZones(g, OV, ox, y, cw, W - padR); g.restore(); }
  // K 棒
  if (opt.base) { g.strokeStyle = TXT; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(padL, y(opt.base)); g.lineTo(W - padR, y(opt.base)); g.stroke(); g.setLineDash([]); }
  vis.forEach((b, i) => {
    const prevC = from + i > 0 ? bars[from + i - 1].c : b.o; const up = b.c > b.o || (b.c === b.o && b.c >= prevC); g.strokeStyle = g.fillStyle = up ? UP : DN;
    const bw = Math.max(1, cw * 0.65);
    if (ty === 'candle') {
      g.beginPath(); g.moveTo(x(i), y(b.h)); g.lineTo(x(i), y(b.l)); g.stroke();
      const y1 = y(Math.max(b.o, b.c)), y2 = y(Math.min(b.o, b.c)); g.fillRect(x(i) - bw / 2, y1, bw, Math.max(1, y2 - y1));
    } else if (ty === 'ohlc') {
      // 美國線：高低直線＋左側開盤、右側收盤
      const tk = Math.max(2, cw * 0.35); g.lineWidth = Math.max(1, Math.min(2, cw / 5)); g.beginPath(); g.moveTo(x(i), y(b.h)); g.lineTo(x(i), y(b.l)); g.moveTo(x(i) - tk, y(b.o)); g.lineTo(x(i), y(b.o)); g.moveTo(x(i), y(b.c)); g.lineTo(x(i) + tk, y(b.c)); g.stroke(); g.lineWidth = 1;
    }
    // 成交量
    const vh = vmax ? (b.v || 0) / vmax * volH : 0; g.globalAlpha = 0.55; g.fillRect(x(i) - bw / 2, volTop + volH - vh, bw, vh); g.globalAlpha = 1;
  });
  if (ty === 'line' || ty === 'area') {
    const last = vis[vis.length - 1], first = vis[0]; const col = opt.base ? (last.c >= opt.base ? UP : DN) : last.c >= first.c ? UP : DN;
    g.beginPath(); vis.forEach((b, i) => (i ? g.lineTo(x(i), y(b.c)) : g.moveTo(x(i), y(b.c)))); g.strokeStyle = col; g.lineWidth = 1.8; g.stroke(); g.lineWidth = 1;
    if (ty === 'area') { g.lineTo(x(vis.length - 1), top + mainH); g.lineTo(x(0), top + mainH); g.closePath(); const gr = g.createLinearGradient(0, top, 0, top + mainH); gr.addColorStop(0, col + '55'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fill(); }
  }
  // 均線
  if (opt.boll) {
    const sd = c.map((_, i) => { if (i < 19) return null; const m = ma[20][i]; let v = 0; for (let j = i - 19; j <= i; j++) v += (c[j] - m) ** 2; return Math.sqrt(v / 20); });
    const up = c.map((_, i) => (sd[i] == null ? null : ma[20][i] + 2 * sd[i])), dn = c.map((_, i) => (sd[i] == null ? null : ma[20][i] - 2 * sd[i]));
    g.fillStyle = 'rgba(168,85,247,.07)'; g.beginPath(); let st = false;
    vis.forEach((_, i) => { const v = up[from + i]; if (v == null) return; if (!st) { g.moveTo(x(i), y(v)); st = true; } else g.lineTo(x(i), y(v)); });
    for (let i = vis.length - 1; i >= 0; i--) { const v = dn[from + i]; if (v != null) g.lineTo(x(i), y(v)); } g.closePath(); g.fill();
    [up, dn].forEach((arr) => { g.strokeStyle = 'rgba(168,85,247,.55)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); let s2 = false;
      vis.forEach((_, i) => { const v = arr[from + i]; if (v == null) return; if (!s2) { g.moveTo(x(i), y(v)); s2 = true; } else g.lineTo(x(i), y(v)); }); g.stroke(); g.setLineDash([]); });
  }
  MAS.map((p, k) => [p, MAC[k]]).forEach(([p, col]) => {
    g.strokeStyle = col; g.lineWidth = 1.3; g.beginPath(); let st = false;
    vis.forEach((_, i) => { const v = ma[p][from + i]; if (v == null) return; if (!st) { g.moveTo(x(i), y(v)); st = true; } else g.lineTo(x(i), y(v)); });
    g.stroke();
  });
  // 交易計畫：進場／停損／目標線、型態線段與標記、右側價位標籤
  if (OV) { clipMain(); drawOverlayLines(g, OV, ox, y, cw, W - padR, css('--text'), TXT); g.restore();
    const used = []; [['目標', OV.target, PLAN_C.target], ['進場', OV.entry, css('--text2') || '#888'], ['停損', OV.stop, PLAN_C.risk]].sort((a, b) => y(a[1]) - y(b[1])).forEach(([t, v, col]) => {
      let yy = Math.min(top + mainH - 8, Math.max(top + 8, y(v))); while (used.some((u) => Math.abs(u - yy) < 15)) yy += 15; used.push(yy);
      g.fillStyle = col; g.fillRect(W - padR + 1, yy - 8, padR - 2, 16); g.fillStyle = '#fff'; g.font = '10px sans-serif'; g.fillText(t + fmtPx(v), W - padR + 3, yy); g.font = '11px sans-serif'; }); }
  g.fillStyle = TXT; g.fillText('量', W - padR + 4, volTop + 8);
  // 持股均價線
  if (opt.avg) { const yy = y(opt.avg); if (yy > top && yy < top + mainH) { g.strokeStyle = '#10b981'; g.setLineDash([6, 4]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(padL, yy); g.lineTo(W - padR, yy); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#10b981'; g.fillRect(W - padR + 1, yy - 8, padR - 2, 16); g.fillStyle = '#fff'; g.fillText('均 ' + fmtPx(opt.avg), W - padR + 3, yy); } }
  if (opt.levels) drawLevels(g, opt.levels, y, padL, W, padR, top, mainH);
  // K 棒型態標記
  const marks = {};
  if (opt.pats) { const ab = avgBodyOf(bars, n); let lastI = -9, lastDir = 0; vis.forEach((b, i) => { const ps = patAt(bars, from + i, ab); if (!ps.length) return; marks[i] = ps;
    const bull = ps.some((x) => PAT_BOTTOM.includes(x)), bear = ps.some((x) => PAT_TOP.includes(x)); if (!bull && !bear) return;
    const dir = bull ? 1 : -1; if (dir === lastDir && i - lastI <= 3) { lastI = i; return; } lastI = i; lastDir = dir;
    g.fillStyle = bull ? UP : DN; g.font = '10px sans-serif'; g.textAlign = 'center'; g.fillText(bull ? '▲' : '▼', x(i), bull ? Math.min(top + mainH - 4, y(b.l) + 9) : Math.max(top + 4, y(b.h) - 9)); g.textAlign = 'start'; g.font = '11px sans-serif'; }); }
  // 副圖
  let sub = null;
  if (subOn) {
    const hh = bars.map((b) => b.h), ll = bars.map((b) => b.l);
    if (opt.sub === 'KD') { const [K, Dd] = kdArr(hh, ll, c); sub = { lines: [[K, '#f59e0b', 'K'], [Dd, '#38bdf8', 'D']], min: 0, max: 100, guides: [20, 80] }; }
    else if (opt.sub === 'RSI') { sub = { lines: [[rsiArr(c), '#f59e0b', 'RSI14']], min: 0, max: 100, guides: [30, 70] }; }
    else { const [dif, dea, hist] = macdArr(c); const vals = vis.map((_, i) => [dif[from + i], dea[from + i], hist[from + i]]).flat().filter((v) => v != null);
      const m = Math.max(...vals.map(Math.abs), 0.01); sub = { lines: [[dif, '#f59e0b', 'DIF'], [dea, '#38bdf8', 'DEA']], hist, min: -m, max: m, guides: [0] }; }
    const sy = (v) => subTop + (sub.max - v) / (sub.max - sub.min) * subH;
    g.strokeStyle = GRID; sub.guides.forEach((v) => { g.beginPath(); g.moveTo(padL, sy(v)); g.lineTo(W - padR, sy(v)); g.stroke(); g.fillStyle = TXT; g.fillText(String(v), W - padR + 4, sy(v)); });
    if (sub.hist) vis.forEach((_, i) => { const v = sub.hist[from + i]; if (v == null) return; g.fillStyle = v >= 0 ? UP : DN; const bw = Math.max(1, cw * 0.5); g.fillRect(x(i) - bw / 2, Math.min(sy(0), sy(v)), bw, Math.abs(sy(v) - sy(0))); });
    sub.lines.forEach(([arr, col]) => { g.strokeStyle = col; g.lineWidth = 1.3; g.beginPath(); let st = false;
      vis.forEach((_, i) => { const v = arr[from + i]; if (v == null) return; if (!st) { g.moveTo(x(i), sy(v)); st = true; } else g.lineTo(x(i), sy(v)); }); g.stroke(); });
  }
  // 日期
  g.fillStyle = TXT; const step = Math.max(1, Math.floor(vis.length / 6));
  for (let i = 0; i < vis.length; i += step) g.fillText(opt.intraday ? vis[i].d : vis[i].d.slice(opt.weekly ? 2 : 5), x(i) - 14, H - 7);
  // 十字線提示
  const info = (i) => {
    const b = vis[i]; const k = from + i; const prev = k > 0 ? bars[k - 1].c : b.o; const ch = b.c - prev;
    let s = `${b.d}　開 ${fmtPx(b.o)} 高 ${fmtPx(b.h)} 低 ${fmtPx(b.l)} 收 <b class="${cls(ch)}">${fmtPx(b.c)} ${fmtPct(ch / prev * 100)}</b>　量 ${fmtVol(b.v)}`;
    s += '<br>' + MAS.map((p, j) => `<span style="color:${MAC[j]}">MA${p} ${fmtPx(ma[p][k])}</span>`).join('　');
    if (marks[i]) s += `<br><b style="color:#f59e0b">型態：${marks[i].join('、')}</b>`;
    if (sub) s += '<br>' + sub.lines.map(([arr, col, nm]) => `<span style="color:${col}">${nm} ${arr[k] == null ? '—' : arr[k].toFixed(2)}</span>`).join('　');
    return s;
  };
  tip.innerHTML = info(vis.length - 1);
  const xh = xhair(wrap, cv, H);
  const move = (e) => { const r = cv.getBoundingClientRect(); const my = e.clientY - r.top; const i = Math.min(vis.length - 1, Math.max(0, Math.floor((e.clientX - r.left - padL) / cw))); tip.innerHTML = info(i);
    let yl = null;
    if (my >= top && my <= top + mainH) yl = fmtPx(hi - (my - top) / mainH * (hi - lo));
    else if (my >= volTop && my <= volTop + volH) yl = fmtVol(vmax * (volTop + volH - my) / volH);
    else if (sub && my >= subTop && my <= subTop + subH) yl = (sub.max - (my - subTop) / subH * (sub.max - sub.min)).toFixed(2);
    xh.draw(x(i), my, yl, vis[i].d, padR, H - 16); };
  cv.onmousemove = move; cv.onclick = move;
  cv.onmouseleave = () => { tip.innerHTML = info(vis.length - 1); xh.clear(); };
  chartZoom(cv, wrap, n, def, { padL, w: W - padL - padR }, () => drawChart(wrap, bars, opt));
  const zi = wrap.parentElement && wrap.parentElement.querySelector('.zinfo'); if (zi) zi.textContent = z.count !== def || z.off ? `顯示 ${vis.length} 根（${vis[0].d} ～ ${vis[vis.length - 1].d}）` : '';
}
/** 當日走勢（分時線＋昨收基準＋成交量） */
/** 三關價（與「進階分析」同公式：前一交易日高低）；回傳畫在圖上的參考線 */
function keyLevelsOf(b, sym) {
  if (!b || b.length < 2) return null; const us = isUs(sym); const etf = D.isEtf(sym);
  const snap = (v) => { if (us) return Math.round(v * 100) / 100; const t = twTick(v, etf); return Math.round(Math.round(v / t) * t * 100) / 100; };
  const base = b[b.length - 1].d === ymd() ? b[b.length - 2] : b[b.length - 1]; const r = base.h - base.l; if (!(r >= 0)) return null;
  return { d: base.d, lv: [{ v: snap(base.l + r * 1.382), label: '上關', col: css('--up') }, { v: snap((base.h + base.l) / 2), label: '中關', col: '#E8B04B' }, { v: snap(base.h - r * 1.382), label: '下關', col: css('--down') }] };
}
/** 參考價位虛線＋右欄標籤（三關價）；used 為已占用的標籤位置，避免重疊 */
function drawLevels(g, lv, y, padL, W, padR, top, mainH, used = []) {
  (lv || []).forEach((l) => { const yy = y(l.v); if (!(yy >= top && yy <= top + mainH)) return;
    g.strokeStyle = l.col; g.globalAlpha = 0.85; g.setLineDash([5, 4]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(padL, yy); g.lineTo(W - padR, yy); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; g.lineWidth = 1;
    let ty = Math.min(top + mainH - 8, Math.max(top + 8, yy)); let k = 0; while (used.some((u) => Math.abs(u - ty) < 15) && k++ < 8) ty += 15; used.push(ty);
    g.fillStyle = l.col; g.fillRect(W - padR + 1, ty - 8, padR - 2, 16); g.fillStyle = '#fff'; g.font = '10px sans-serif'; g.textBaseline = 'middle'; g.fillText(l.label.slice(0, 1) + ' ' + fmtPx(l.v), W - padR + 3, ty); g.font = '11px sans-serif'; });
}
function drawLine(wrap, pts, prev, us, ctype, opt = {}) {
  const cv = wrap.querySelector('canvas'); const tip = wrap.querySelector('.chart-tip');
  const W = wrap.clientWidth, H = 320, dpr = pxRatio(); cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H); g.font = '11px sans-serif'; g.textBaseline = 'middle';
  const padR = 56, padL = 6, top = 10, mainH = 220, volTop = 245, volH = 50;
  if (!pts.length) return;
  const vals = pts.map((p) => p[1]).concat(prev ? [prev] : [], (opt.levels || []).map((l) => l.v));
  let hi = Math.max(...vals), lo = Math.min(...vals); const pad = (hi - lo) * 0.08 || hi * 0.01; hi += pad; lo -= pad;
  // 台股整天 270 分鐘；美股 390 分鐘
  const span = opt.span || (us ? 390 * 60000 : 270 * 60000); const t0 = opt.t0 || pts[0][0];
  const x = (t) => padL + Math.min(1, (t - t0) / span) * (W - padL - padR); const y = (v) => top + (hi - v) / (hi - lo) * mainH;
  const UP = css('--up'), DN = css('--down'); const last = pts[pts.length - 1][1]; const col = prev && last < prev ? DN : UP;
  g.strokeStyle = css('--grid'); g.fillStyle = css('--muted');
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; g.beginPath(); g.moveTo(padL, y(v)); g.lineTo(W - padR, y(v)); g.stroke(); g.fillText(fmtPx(v), W - padR + 4, y(v)); }
  (opt.bands || []).forEach(([a, b, lb]) => { const xa = x(a), xb = x(b); g.globalAlpha = 0.13; g.fillStyle = '#E8B04B'; g.fillRect(xa, top, xb - xa, mainH); g.globalAlpha = 1; g.fillStyle = css('--muted'); g.fillText(lb, xa + 4, top + mainH - 8); });
  if (prev) { g.setLineDash([4, 4]); g.strokeStyle = css('--muted'); g.beginPath(); g.moveTo(padL, y(prev)); g.lineTo(W - padR, y(prev)); g.stroke(); g.setLineDash([]); }
  if (opt.levels) drawLevels(g, opt.levels, y, padL, W, padR, top, mainH);
  const grad = g.createLinearGradient(0, top, 0, top + mainH); grad.addColorStop(0, col + '55'); grad.addColorStop(1, col + '00');
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(x(p[0]), y(p[1])) : g.moveTo(x(p[0]), y(p[1])))); g.strokeStyle = col; g.lineWidth = 1.6; g.stroke();
  if (ctype !== 'line') { g.lineTo(x(pts[pts.length - 1][0]), top + mainH); g.lineTo(x(t0), top + mainH); g.closePath(); g.fillStyle = grad; g.fill(); }
  const vmax = Math.max(1, ...pts.map((p) => p[2] || 0)); const bw = Math.max(1, (W - padL - padR) / (span / 60000) * 0.7);
  pts.forEach((p, i) => { const pv = i ? pts[i - 1][1] : prev || p[1]; g.fillStyle = p[1] >= pv ? UP : DN; g.globalAlpha = .55; const h = (p[2] || 0) / vmax * volH; g.fillRect(x(p[0]) - bw / 2, volTop + volH - h, bw, h); });
  g.globalAlpha = 1; g.fillStyle = css('--muted');
  [0, 0.25, 0.5, 0.75, 1].forEach((f) => { const t = t0 + span * f; const d0 = new Date(t + 8 * 3600000); g.fillText((f === 0 ? String(d0.getUTCMonth() + 1) + '/' + d0.getUTCDate() + ' ' : '') + hm(t), Math.min(W - padR - 30, padL + f * (W - padL - padR) - (f === 0 ? 0 : 14)), H - 8); });
  const md = (t) => { const d = new Date(t + 8 * 3600000); return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0'); };
  const info = (p) => `${md(p[0])} ${hm(p[0])}　<b class="${cls(prev ? p[1] - prev : 0)}">${fmt(p[1], 2)} ${prev ? fmtPct((p[1] / prev - 1) * 100) : ''}</b>　量 ${fmtVol(us ? p[2] : (p[2] || 0) / 1000)}${us ? '' : ' 張'}${prev ? '　' + (opt.baseLabel || '昨收') + ' ' + fmt(prev, 2) : ''}${opt.lab ? opt.lab(p[0]) : ''}`;
  tip.innerHTML = info(pts[pts.length - 1]);
  const xh = xhair(wrap, cv, H);
  const move = (e) => { const r = cv.getBoundingClientRect(); const my = e.clientY - r.top; const t = t0 + (e.clientX - r.left - padL) / (W - padL - padR) * span; let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; tip.innerHTML = info(best);
    const yl = my >= top && my <= top + mainH ? fmtPx(hi - (my - top) / mainH * (hi - lo)) + (prev ? '' : '') : null;
    xh.draw(x(best[0]), my, yl, md(best[0]) + ' ' + hm(best[0]), padR, H - 16); };
  cv.onmousemove = move; cv.onclick = move;
  cv.onmouseleave = () => { tip.innerHTML = info(pts[pts.length - 1]); xh.clear(); };
}
/** 通用折線圖：labels 為日期字串；series = [{ v: [], color, name, fill }] */
function drawSeries(wrap, labels, series, opt = {}) {
  if (wrap) wrap._redraw = () => drawSeries(wrap, labels, series, opt);
  const cv = wrap.querySelector('canvas'); const tip = wrap.querySelector('.chart-tip');
  const W = wrap.clientWidth, H = opt.h || 240, dpr = pxRatio(); cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H); g.font = '11px sans-serif'; g.textBaseline = 'middle';
  if (!opt._full) { const N = labels.length; if (N >= 2) { const z = zoomState(wrap, opt.key || 's' + N + labels[0], N, N); if (z.count < N || z.off) { const a = N - z.count - z.off, b = N - z.off;
      return drawSeries(wrap, labels.slice(a, b), series.map((s) => ({ ...s, v: s.v.slice(a, b) })), { ...opt, _full: true, _N: N, _orig: [labels, series] }); } } }
  const padR = 64, padL = 6, top = 10, mh = H - 34; const n = labels.length; if (n < 2) { tip.innerHTML = '資料不足'; return; }
  const all = series.flatMap((s) => s.v.filter((x) => x != null)); let hi = Math.max(...all), lo = Math.min(...all); const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1; hi += pad; lo -= pad;
  const x = (i) => padL + i / (n - 1) * (W - padL - padR); const y = (v) => top + (hi - v) / (hi - lo) * mh; const f = opt.fmt || fmtInt;
  g.strokeStyle = css('--grid'); g.fillStyle = css('--muted');
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; g.beginPath(); g.moveTo(padL, y(v)); g.lineTo(W - padR, y(v)); g.stroke(); g.fillText(f(v), W - padR + 4, y(v)); }
  if (opt.zero && lo < 0 && hi > 0) { g.strokeStyle = css('--muted'); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(padL, y(0)); g.lineTo(W - padR, y(0)); g.stroke(); g.setLineDash([]); }
  series.forEach((s) => {
    g.beginPath(); let st = false; s.v.forEach((v, i) => { if (v == null) return; if (!st) { g.moveTo(x(i), y(v)); st = true; } else g.lineTo(x(i), y(v)); });
    g.strokeStyle = s.color; g.lineWidth = 1.8; g.stroke();
    if (s.fill) { g.lineTo(x(n - 1), top + mh); g.lineTo(x(0), top + mh); g.closePath(); const gr = g.createLinearGradient(0, top, 0, top + mh); gr.addColorStop(0, s.color + '44'); gr.addColorStop(1, s.color + '00'); g.fillStyle = gr; g.fill(); }
  });
  g.fillStyle = css('--muted'); const step = Math.max(1, Math.floor(n / 6)); for (let i = 0; i < n; i += step) g.fillText(String(labels[i]).slice(2), Math.max(0, x(i) - 22), H - 8);
  const info = (i) => esc(labels[i]) + '　' + series.map((s) => `<span style="color:${s.color}">${esc(s.name || '')} ${s.v[i] == null ? '—' : f(s.v[i])}</span>`).join('　') + (opt.extra ? opt.extra(i) : '');
  tip.innerHTML = info(n - 1);
  const xh = xhair(wrap, cv, H);
  const move = (e) => { const r = cv.getBoundingClientRect(); const my = e.clientY - r.top; const i = Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left - padL) / (W - padL - padR) * (n - 1)))); tip.innerHTML = info(i);
    xh.draw(x(i), my, my >= top && my <= top + mh ? f(hi - (my - top) / mh * (hi - lo)) : null, String(labels[i]), padR, H - 16); };
  cv.onmousemove = move; cv.onclick = move;
  cv.onmouseleave = () => { tip.innerHTML = info(n - 1); xh.clear(); };
  const [L0, S0] = opt._orig || [labels, series]; const N0 = opt._N || n;
  if (N0 >= 10) chartZoom(cv, wrap, N0, N0, { padL, w: W - padL - padR }, () => drawSeries(wrap, L0, S0, { ...opt, _full: false, _N: 0, _orig: null }));
}
async function loadBars(sym, range, interval = '1d') {
  const r = await fetchYahoo(ysym(sym), range, interval, 600);
  if (!r || !r.timestamp) return [];
  const q = r.indicators.quote[0]; const out = [];
  r.timestamp.forEach((t, i) => {
    if (q.close[i] == null || q.open[i] == null) return;
    const d = new Date((t + 8 * 3600) * 1000);
    out.push({ d: d.getUTCFullYear() + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0'),
      o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: isUs(sym) ? q.volume[i] : (q.volume[i] || 0) / 1000 });
  });
  return out;
}

// ───────── 網頁版本（發布時由 .github/public/sync.sh 填入：正式版號、commit、時間）─────────
const WEB_VER = /*WEBVER*/{"v":"v1.1.444","sha":"8adfc5a","at":"2026-11-28 02:18"};
function webVerText(short) {
  const v = WEB_VER; if (!v) return short ? '開發版' : '開發版（未經正式發布）';
  const tag = v.v ? (/^v/i.test(v.v) ? v.v : 'v' + v.v) : '最新原始碼';
  return short ? tag + (v.sha ? ' · ' + v.sha : '') : tag + (v.sha ? '（' + v.sha + '）' : '') + (v.at ? ' · ' + v.at : '');
}
function webVerHtml() { return `<div class="webver" data-webver title="點一下檢查是否有新版網頁">網頁版 <b>${esc(webVerText(true))}</b></div>`; }
/** 檢查伺服器上的網頁版本是否比目前執行的新（瀏覽器沿用舊檔時提示重新整理） */
async function webVerCheck(silent) {
  try { const j = await (await fetch('/web/version.json?t=' + Date.now(), { cache: 'no-store' })).json();
    const cur = WEB_VER || {}; const newer = j && j.sha && j.sha !== cur.sha;
    if (newer) { if ((await dialog('有新版網頁', `目前：${esc(webVerText())}<br>最新：${esc((j.v || '最新原始碼') + '（' + j.sha + '）' + (j.at ? ' · ' + j.at : ''))}<br><br>重新整理即可套用。`, [['', '稍後'], ['ok', '重新整理', 'primary']])) === 'ok') location.reload(); }
    else if (!silent) toast('已是最新網頁版：' + webVerText(true));
    return j;
  } catch (e) { if (!silent) toast(WEB_VER ? '目前網頁版：' + webVerText(true) : '開發版（沒有版本資訊）'); return null; }
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-webver]')) webVerCheck(false); });
function rtStatusText() {
  const tw = twOpen() ? '台股盤中：' + fgStats() : '台股非交易時間（每分鐘更新收盤資料）' + (fgWanted() ? '；盤中自動連線富果串流' : '');
  const us = (apHas() ? apStats() + '\n美股報價補充：' + (compOn() ? 'Alpaca 快照（商業合規模式）' : 'Yahoo Finance') + '，' : '美股：Yahoo Finance，') + (S.pref.usRefresh ? '每 ' + (S.pref.usRefresh >= 60 ? S.pref.usRefresh / 60 + ' 分鐘' : S.pref.usRefresh + ' 秒') : '與台股同步更新');
  return tw + '\n' + us + (S.lastTick ? '\n最近更新：' + hm(S.lastTick) + (document.hidden && S.pref.bgRefresh !== '1' ? '（背景暫停中）' : '') : '');
}
// ───────── 版面 ─────────
const NAV = [['', '總覽', '🏠'], ['watch', '行情', '📈'], ['hold', '持股', '💼'], ['trades', '交易', '🧾'], ['div', '股息', '💰'], ['analysis', '分析', '📊'], ['compare', '比較', '⚖️'], ['screener', '選股器', '🔎'], ['calendar', '行事曆', '📅'], ['sim', '模擬交易', '🎮'], ['strategy', '策略回測', '🧪'], ['tools', '工具', '🧮'],
  ['alerts', '提醒', '🔔'], ['market', '市場', '🌐'], ['news', '新聞', '📰'], ['cash', '現金與帳戶', '🏦'], ['tax', '年度報稅', '🧾'], ['member', '會員', '👤'], ['settings', '設定', '⚙️']];
const BOTTOM = ['', 'watch', 'hold', 'market', 'more'];
// 功能分類（側欄、更多頁）：依使用情境分四群
const NAV_GROUPS = [['資產', ['', 'hold', 'trades', 'div', 'cash', 'tax']], ['行情與研究', ['watch', 'market', 'screener', 'news', 'calendar', 'compare']],
  ['分析與工具', ['analysis', 'alerts', 'sim', 'strategy', 'tools']], ['帳號', ['member', 'settings']]];
const NAV_DESC = { strategy: '自訂均線、RSI、KD、突破進出場條件，回測勝率與報酬', tax: '年度已實現、股利所得、合併／分開計稅試算、海外所得最低稅負', '': '資產總覽、今日損益、指數與漲跌停', hold: '持股明細、成本、報酬與占比', trades: '交易紀錄、篩選、匯入匯出', div: '股息日曆、歷年股息、預估年股息', cash: '現金流紀錄與證券帳戶',
  watch: '自選行情、行情牆、熱度圖', market: '大盤、類股、排行、美股與 ETF', news: '財經新聞與關鍵字搜尋', calendar: '除權息、股利發放、總經事件', compare: '多檔走勢與報酬相關係數', screener: '全市場條件選股：殖利率、本益比、營收、法人',
  analysis: '每年報酬、近 12 個月與投資組合分析', alerts: '到價與事件提醒', sim: '模擬持股與下單練習', tools: '交易成本、漲跌停價、定期定額複利試算',
  member: '會員方案、帳號同步、LINE 綁定', settings: '外觀、版面、即時行情、資料' };
const navItem = (r) => NAV.find((x) => x[0] === r);
function navFold() { try { return new Set(JSON.parse(localStorage.getItem('cetf_navfold') || '[]')); } catch (e) { return new Set(); } }
const PARENT = { ix: 'market', crash: 'market', s: 'none', limits: 'market', rank: 'market', index: 'market', us: 'market', etf: 'market', report: 'market', diag: 'settings', more: 'more' };
/** 下載手機 App（Android）：連到發佈站下載頁，顯示 App 圖示與最新版本 */
function dlAppHtml(big) {
  return `<a class="dlapp${big ? ' big' : ''}" href="/" target="_blank" rel="noopener" title="下載 Android App（與網頁同一帳號同步）"><img src="/web/app-icon.png" alt="台美股資產 App" width="${big ? 52 : 38}" height="${big ? 52 : 38}">
    <div class="l"><b>下載手機 App</b><div class="small muted dlv">Android · 與網頁同步</div></div><span class="muted">›</span></a>`;
}
/** LINE 官方帳號：加入好友按鈕與 QR Code（ID 來自會員政策 lineOa） */
function lineOaId() { const id = String((S.policy && S.policy.lineOa) || '').trim(); return id ? (id.startsWith('@') ? id : '@' + id) : ''; }
function lineJoinHtml(big) {
  const id = lineOaId(); if (!id) return '';
  return `<a class="dlapp line${big ? ' big' : ''}" href="javascript:void 0" data-linejoin title="加入台美股資產 LINE 官方帳號"><span class="lineic" style="width:${big ? 52 : 38}px;height:${big ? 52 : 38}px">LINE</span>
    <div class="l"><b>加入 LINE 好友</b><div class="small muted">${esc(id)}${big ? ' · 開通、續約、盤後報告' : ''}</div></div><span class="muted">›</span></a>`;
}
function lineModal() {
  const id = lineOaId(); if (!id) return; const raw = id.slice(1); const url = 'https://line.me/R/ti/p/' + encodeURIComponent(id);
  dialog('加入台美股資產 LINE 官方帳號', `<div style="text-align:center"><img src="https://qr-official.line.me/sid/L/${encodeURIComponent(raw)}.png" alt="LINE QR Code" width="200" height="200" style="border-radius:12px;background:#fff;padding:8px" onerror="this.outerHTML='<div class=&quot;small muted&quot;>QR Code 載入失敗，請用下方按鈕加入</div>'">
    <div class="num" style="font-size:18px;margin-top:8px">${esc(id)}</div><div class="small text2" style="margin-top:6px">用手機 LINE 掃描 QR Code，或在 LINE 搜尋 ID 加入好友。<br>可詢問開通／續約、接收每日盤後報告、下載 App。</div>
    <a class="btn primary" href="${url}" target="_blank" rel="noopener" style="margin-top:12px;display:inline-block;background:#06C755;border-color:#06C755">在 LINE 開啟並加入</a></div>`, [['', '關閉']]);
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-linejoin]')) { e.preventDefault(); lineModal(); } });
async function dlAppVer() {
  try { const j = await (await fetch('/api/latest', { cache: 'no-store' })).json(); if (j && j.tag) $$('.dlv').forEach((el) => { el.textContent = 'Android ' + j.tag + (j.size ? ' · ' + (j.size / 1048576).toFixed(0) + ' MB' : ''); }); } catch (e) {}
}
function shell() {
  const fold = navFold();
  const navHtml = NAV_GROUPS.map(([g, rs], gi) => `<div class="nav-g${fold.has(gi) ? ' fold' : ''}" data-ng="${gi}"><span>${g}</span><i>▾</i></div><div class="nav-gl" data-ngl="${gi}">${rs.map((r) => { const [, n, ic] = navItem(r);
    return `<a href="#/${r}" data-r="${r}" title="${esc(n + '：' + (NAV_DESC[r] || ''))}"><span class="ic">${ic}</span><span>${n}</span></a>`; }).join('')}</div>`).join('');
  const botHtml = BOTTOM.map((r) => { const it = NAV.find((x) => x[0] === r) || ['more', '更多', '☰']; return `<a href="#/${r}" data-r="${r}"><span class="ic">${it[2]}</span><span>${it[1]}</span></a>`; }).join('');
  $('#app').innerHTML = `<div class="shell">
    <aside class="side"><div class="brand"><div class="logo">台</div>台美股資產</div>
      <div class="search gsearch"><input id="gs" placeholder="搜尋個股（按 / ）" autocomplete="off"><div class="res hide"></div></div>
      <nav class="nav">${navHtml}</nav>
      <div class="foot">${dlAppHtml()}<div id="mb"></div><div class="small syncst" style="margin-top:6px"></div>${webVerHtml()}</div></aside>
    <main class="main" id="view"></main>
    <nav class="bottom">${botHtml}</nav></div>`;
  bindSearch($('#gs'), (sym) => { location.hash = '#/s/' + sym; });
  // 側欄分類可收合（記住狀態）；收合時仍顯示目前所在的頁面
  $$('[data-ng]').forEach((h) => h.onclick = () => { const f = navFold(); const gi = +h.dataset.ng; if (f.has(gi)) f.delete(gi); else f.add(gi); try { localStorage.setItem('cetf_navfold', JSON.stringify([...f])); } catch (e) {} h.classList.toggle('fold', f.has(gi)); });
}
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { const g = $('#gs'); if (g && g.offsetParent) { e.preventDefault(); g.focus(); } else { e.preventDefault(); location.hash = '#/more'; } }
});
function markNav(r) { $$('.nav [data-r], .bottom [data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === r)); const m = member(); $('#mb').innerHTML = badge(m) + ' <span class="small muted">' + esc(stateLine(m)) + '</span>'; }
function head(title, right = '') { return `<div class="top"><h1>${esc(title)}</h1>${right}</div>`; }

// 指數列＋漲跌停列（總覽、行情、持股共用）
function tickerHtml() {
  return '<div class="ticker">' + INDEXES.map((x) => {
    const q = S.q[x.k] || {}; const ch = q.price && q.prev ? q.price - q.prev : 0;
    return `<div class="tk" data-go="#/ix/${encodeURIComponent(IX_FROM[x.k] || x.k)}"><div class="n">${x.n}</div><div class="p num ${cls(ch)}">${q.price ? fmt(q.price, x.k === 'TWD=X' ? 3 : 2) : '—'}</div>
      <div class="c num ${cls(ch)}">${q.price ? arrow(ch) + fmt(Math.abs(ch), 2) + ' ' + fmtPct(ch / q.prev * 100) : ''}</div></div>`;
  }).join('') + '</div>' +
  `<div class="limitbar" data-go="#/limits"><span class="muted">今日</span><span class="tag up" style="border-color:currentColor">漲停</span><b class="num up">${LIMIT.at ? LIMIT.up.length : '…'}</b>家
    <span class="tag down" style="border-color:currentColor">跌停</span><b class="num down">${LIMIT.at ? LIMIT.down.length : '…'}</b>家
    <span class="sp"></span><span class="small muted">${LIMIT.at ? hm(LIMIT.at) : ''}</span><a class="small">明細 ›</a></div>`;
}

// ───────── 總覽 ─────────
const VIEWS = {};
// 總覽卡片：鍵、名稱、預設寬度（2＝整列）
// ───────── 零股價差排行（盤中零股 vs 整股；使用者自己的富果金鑰；與 App OddLot 相同） ─────────
// 分「個股」「ETF」兩頁（`odd_tab`），各自選股池 20 檔：自選／持股（≤10）＋（ETF 頁加常見 ETF）＋前一日成交值前段；只查目前這一頁；每 30 秒以富果 REST（type=oddlot）查零股，瀏覽器擋跨網域時改用富果串流零股頻道。
const ODD = { el: null, loop: 0, tab: '', pools: {}, pool: [], names: {}, q: {}, at: 0, done: 0, busy: false, err: '', slow: false, direct: null, ws: null, wsSyms: '' };
const ODD_N = 20, ODD_TOP = 3, ODD_CORE = ['0050', '0056', '00878'];
/** 零股排行設定（`S.pref.odd`；App 對應 `OddLot.Cfg`） */
const ODD_DEF = { top: 3, poolN: 20, mineOnly: false, tag: true, mine: true, mineMax: 10, core: true, extra: '', minVol: 1, minPct: 0, sort: 'pct', iv: 30, sub: true, arrow: true, keep: true, hlOn: true, hl: 1.5 };
function oddCfg() { const c = { ...ODD_DEF, ...(S.pref.odd || {}) }; const cl = (v, a, b, d) => (isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
  return { ...c, top: cl(c.top, 1, 10, 3), poolN: cl(c.poolN, 5, 40, 20), mineMax: cl(c.mineMax, 0, 20, 10), minVol: cl(c.minVol, 1, 100000, 1), minPct: cl(c.minPct, 0, 5, 0), iv: cl(c.iv, 15, 300, 30), hl: cl(c.hl, 0.1, 10, 1.5), sort: c.sort === 'ticks' ? 'ticks' : 'pct', extra: String(c.extra || '') }; }
/** 純函數：依零股相對整股的價差排行，溢價（零股＞整股）與折價各取前 n；零股成交量 < minVol（預設 1 股）或價差 < minPct% 的略過；ticks＝差幾個升降單位；sort 'pct' 依幅度、'ticks' 依檔數 */
function oddRank(rows, n, o = {}) {
  const minVol = o.minVol ?? 1, minPct = o.minPct ?? 0, byT = o.sort === 'ticks';
  const ok = rows.filter((r) => r.board > 0 && r.odd > 0 && (r.oddVol || 0) >= minVol && Math.abs(r.odd - r.board) > 1e-9)
    .map((r) => { const d = r.odd - r.board; return { ...r, pct: d / r.board * 100, ticks: Math.max(1, Math.round(Math.abs(d) / twTick(r.board, /^00/.test(r.s)))) }; })
    .filter((r) => Math.abs(r.pct) >= minPct - 1e-9);
  const cmp = (a, b) => (byT ? b.ticks - a.ticks || Math.abs(b.pct) - Math.abs(a.pct) : Math.abs(b.pct) - Math.abs(a.pct) || b.ticks - a.ticks);
  return { up: ok.filter((r) => r.pct > 0).sort(cmp).slice(0, n), dn: ok.filter((r) => r.pct < 0).sort(cmp).slice(0, n) };
}
const oddEtf = (x) => /^00/.test(x);
function oddTab() { if (!ODD.tab) { const t = store.get('odd_tab', 'stk'); ODD.tab = t === 'etf' ? 'etf' : 'stk'; } return ODD.tab; }
async function oddPool() {
  const tab = oddTab(), etf = tab === 'etf', P = ODD.pools[tab], c = oddCfg(), sig = [c.poolN, c.mineOnly, c.mine, c.mineMax, c.core, c.extra].join('|');
  if (P && P.list.length && P.sig === sig && Date.now() - P.at < 1800000) return (ODD.pool = P.list);
  const tw = (x) => x && !isUs(x) && /^\d{4}[0-9A-Z]{0,2}$/.test(x) && oddEtf(x) === etf;
  const out = new Set(c.extra.toUpperCase().split(/[\s,，、]+/).filter(tw));
  const my = holdings().map((h) => h.symbol).concat(D.quotes().map((q) => q.s)).filter(tw);
  if (c.mineOnly) { const list = Array.from(new Set([...out, ...my])).slice(0, 40); ODD.pools[tab] = { list, at: Date.now(), sig }; return (ODD.pool = list); }
  if (c.mine) my.slice(0, c.mineMax).forEach((x) => out.add(x));
  if (etf) {
    if (c.core) ODD_CORE.forEach((x) => out.add(x));
    try { const rows = (await loadEtfMarket()).rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value); rows.forEach((r) => { ODD.names[r.code] = r.name; }); for (const r of rows) { if (out.size >= c.poolN) break; out.add(r.code); } } catch (e) {}
  } else {
    try { const rows = (await scrUniverse()).rows.filter((r) => r.val != null).sort((a, b) => b.val - a.val); rows.forEach((r) => { ODD.names[r.s] = r.n; }); for (const r of rows) { if (out.size >= c.poolN) break; out.add(r.s); } } catch (e) {}
  }
  const list = Array.from(out).slice(0, c.poolN); ODD.pools[tab] = { list, at: Date.now(), sig }; return (ODD.pool = list);
}
function oddApply(d) {
  if (!d || !d.symbol) return; const n = (v) => (v == null || isNaN(+v) ? null : +v); const lt = d.lastTrade || {};
  const p = n(d.lastPrice) ?? n(lt.price) ?? n(d.closePrice); const t = n(lt.time) ?? n(d.lastUpdated);
  ODD.q[d.symbol] = { odd: p, vol: d.total ? n(d.total.tradeVolume) : null, at: t ? (t > 1e14 ? t / 1000 : t) : Date.now() };
  if (d.name) ODD.names[d.symbol] = ODD.names[d.symbol] || d.name;
}
async function oddFetch(syms) {
  const key = await aiKeyGet('fugle'); if (!key) { ODD.err = 'nokey'; return; }
  if (ODD.direct !== false) {
    const res = []; for (let i = 0; i < syms.length; i += 5) res.push(...await Promise.all(syms.slice(i, i + 5).map(async (x) => {
      try { const r = await fetch('https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/' + encodeURIComponent(x) + '?type=oddlot', { headers: { 'X-API-KEY': key } }); ODD.direct = true;
        if (r.status === 429) return 'rate'; if (r.status === 401 || r.status === 403) return 'auth'; if (!r.ok) return 'http'; oddApply(await r.json()); return ''; }
      catch (e) { return ODD.direct === true ? 'net' : 'cors'; } })));
    if (res.length && res.every((x) => x === 'cors')) ODD.direct = false;
    else { ODD.slow = res.includes('rate'); ODD.err = res.includes('auth') ? 'auth' : ODD.slow ? 'rate' : res.every((x) => x) ? 'net' : ''; return; }
  }
  oddWs(key, syms);
}
/** 備援：另開一條富果串流只訂閱這 20 檔的盤中零股（不動主行情串流的訂閱） */
function oddWs(key, syms) {
  const want = syms.join(','); if (ODD.ws && ODD.wsSyms === want) return; oddStop();
  let w; try { w = new WebSocket(FG_URL); } catch (e) { ODD.err = 'ws'; return; } ODD.ws = w; ODD.wsSyms = want; ODD.err = '';
  w.onopen = () => w.send(JSON.stringify({ event: 'auth', data: { apikey: key } }));
  w.onmessage = (e) => { let o; try { o = JSON.parse(e.data); } catch (x) { return; }
    if (o.event === 'authenticated') w.send(JSON.stringify({ event: 'subscribe', data: { channel: 'aggregates', symbols: syms, intradayOddLot: true } }));
    else if (o.event === 'error') { ODD.err = 'ws:' + String((o.data && o.data.message) || ''); oddRender(); }
    else if (o.event === 'data' && o.data) oddApply(o.data); };
  w.onclose = () => { if (ODD.ws === w) { ODD.ws = null; ODD.wsSyms = ''; } };
}
function oddStop() { const w = ODD.ws; ODD.ws = null; ODD.wsSyms = ''; if (w) try { w.close(1000, 'bye'); } catch (e) {} }
function oddRows() { return ODD.pool.map((x) => { const o = ODD.q[x] || {}; const q = S.q[x] || {}; return { s: x, name: q.name || ODD.names[x] || '', board: q.price, odd: o.odd, oddVol: o.vol, oddAt: o.at }; }); }
async function oddTick() {
  if (!ODD.el || !ODD.el.isConnected) { clearInterval(ODD.loop); ODD.loop = 0; oddStop(); return; }
  if (document.hidden || ODD.busy) return;
  if (!twOpen()) { oddStop(); oddRender(); return; }
  if (!aiHas('fugle')) { ODD.err = 'nokey'; oddRender(); return; }
  const now = Date.now(), iv = oddCfg().iv * 1000; if (now - ODD.at < (ODD.slow ? Math.max(90000, iv) : iv) - 1000) { oddRender(); return; }
  ODD.busy = true; ODD.at = now;
  try { const pool = await oddPool(); if (pool.length) { await refreshQuotes(pool).catch(() => {}); await oddFetch(pool); } ODD.done = Date.now(); } catch (e) { ODD.err = e.message || 'err'; } finally { ODD.busy = false; }
  oddRender();
}
/** 卡片 HTML（卡片與設定預覽共用）：r＝{up,dn}；o＝{tab,st,msg,n,gear} */
function oddCardHtml(r, c, o) {
  const line = (x, i, up) => { const hot = c.hlOn && Math.abs(x.pct) >= c.hl; return `<div class="it" data-go="#/s/${esc(x.s)}"${hot ? ` style="background:color-mix(in srgb, var(--${up ? 'up' : 'down'}) 10%, transparent);border-radius:8px"` : ''}><div class="l"><div class="t1">No.${i + 1}（<span class="num">${esc(x.s)}</span>）${esc(x.name || '')}${c.tag && o.mine && o.mine[x.s] ? ` <span class="tag" style="color:var(--primary)">${o.mine[x.s]}</span>` : ''}</div>${c.sub ? `<div class="t2 small muted num">零股 ${fmtPrice(x.odd)}／整股 ${fmtPrice(x.board)} · 差 ${x.ticks} 檔</div>` : ''}</div><div class="r"><div class="num ${up ? 'up' : 'down'}" style="font-weight:${hot ? 800 : 700};white-space:nowrap">${Math.abs(x.pct).toFixed(2)}%${c.arrow ? (up ? ' ⬆️' : ' ⬇️') : ''}</div></div></div>`; };
  const sec = (title, list, up) => `<div class="small" style="margin:8px 0 2px;font-weight:600"><span class="${up ? 'up' : 'down'}">${title}</span></div><div class="list">${list && list.length ? list.map((x, i) => line(x, i, up)).join('') : '<div class="muted small" style="padding:6px 0">（無）</div>'}</div>`;
  return `<div class="card"><h2>零股價差排行<span class="r" style="display:inline-flex;gap:6px;align-items:center"><span class="seg" id="oddTab"><button data-ot="stk" class="${o.tab === 'stk' ? 'on' : ''}">個股</button><button data-ot="etf" class="${o.tab === 'etf' ? 'on' : ''}">ETF</button></span>${o.gear ? '<button class="btn sm" data-oddg title="零股排行設定">⚙</button>' : ''}</span></h2>
    <div class="small muted" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:0">${esc(o.st)} · ${o.tab === 'etf' ? 'ETF' : '個股'} ${o.n} 檔</span><label class="small" style="display:inline-flex;gap:4px;align-items:center;white-space:nowrap"><input type="checkbox" data-oddm style="width:auto;flex:none;margin:0" ${c.mineOnly ? 'checked' : ''}>只看自選／持股</label></div>${c.mineOnly && !o.n ? '<div class="small muted" style="margin:4px 0">這一頁沒有你的自選或持股。</div>' : ''}${o.msg ? `<div class="notice" style="margin:6px 0">${esc(o.msg)}</div>` : ''}
    ${sec('零股溢價（零股＞整股）', r && r.up, true)}${sec('零股折價（零股＜整股）', r && r.dn, false)}
    <div class="small muted" style="margin-top:6px">比較同一時間零股與整股的最近成交價；差幾檔＝依升降單位換算。僅呈現兩個市場的價格差異，不代表任何買賣建議。</div></div>`;
}
function oddRender() {
  const el = ODD.el; if (!el || !el.isConnected) return;
  const tm = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  const c = oddCfg(), tab = oddTab(), lk = 'odd_last_' + tab; ODD.pool = (ODD.pools[tab] || {}).list || [];
  const live = twOpen(); let r = null, at = ODD.done;
  if (ODD.pool.some((x) => ODD.q[x])) { r = oddRank(oddRows(), c.top, c); if (live && (r.up.length || r.dn.length)) store.set(lk, { at, up: r.up, dn: r.dn }); }
  if (c.keep && (!r || (!live && !r.up.length && !r.dn.length))) { const L = store.get(lk, null); if (L) { r = { up: L.up.slice(0, c.top), dn: L.dn.slice(0, c.top) }; at = L.at; } }
  const msg = ODD.err === 'nokey' ? '需要富果金鑰：到「設定 › 即時行情」填入（金鑰只存在這個瀏覽器）。' : ODD.err === 'auth' ? '富果金鑰驗證失敗，請到「設定 › 即時行情」更新。' : ODD.err === 'rate' ? '富果查詢次數達方案上限，已放慢為每 ' + Math.max(90, c.iv) + ' 秒更新。'
    : ODD.err === 'net' ? '暫時連不上富果，稍後自動重試。' : /^ws/.test(ODD.err) ? '富果串流：' + ODD.err.slice(3) : ODD.err === 'ws' ? '無法建立富果串流連線。' : ODD.err ? ODD.err : '';
  const st = live ? (ODD.done ? '盤中 · ' + tm(ODD.done) + ' 更新 · 每 ' + (ODD.slow ? Math.max(90, c.iv) : c.iv) + ' 秒' + (ODD.direct === false ? '（串流）' : '') : '盤中 · 載入中…') : at && c.keep ? '盤後 · 顯示 ' + tm(at) + ' 最後一次盤中結果' : '盤中 09:00–13:30 自動更新';
  const mine = {}; D.quotes().forEach((q) => { mine[q.s] = '自選'; }); holdings().forEach((h) => { if (!h.short) mine[h.symbol] = '持股'; });
  el.innerHTML = oddCardHtml(r, c, { tab, st, msg, n: ODD.pools[tab] ? ODD.pool.length : c.poolN, gear: true, mine });
  const mo = $('[data-oddm]', el); if (mo) mo.onchange = () => { S.pref.odd = { ...(S.pref.odd || {}), mineOnly: mo.checked }; savePref(); ODD.at = 0; ODD.done = 0; oddRender(); oddTick(); };
  $$('.it[data-go]', el).forEach((x) => x.onclick = () => { location.hash = x.dataset.go; });
  $$('#oddTab button', el).forEach((b) => b.onclick = () => { const t = b.dataset.ot; if (t === ODD.tab) return; ODD.tab = t; store.set('odd_tab', t); ODD.at = 0; ODD.done = 0; ODD.err = ''; oddRender(); oddTick(); });
  const g = $('[data-oddg]', el); if (g) g.onclick = async (e) => { e.stopPropagation(); if (await oddSettings()) { ODD.pools = {}; ODD.at = 0; oddRender(); oddTick(); } };
}
/** 零股排行設定：頂端即時預覽（示範資料套用目前門檻與外觀）＋「排行與選股池」「更新與顯示」兩頁；儲存才套用 */
async function oddSettings() {
  const C = oddCfg(); let tab = 0, dt = oddTab(); const OPEN = new Set(['rank', 'pool', 'upd', 'look']);
  const DEMO = { stk: [['2330', '台積電', 1085, 1095, 820], ['6112', '仁大', 60.2, 61.3, 1500], ['2317', '鴻海', 212.5, 213, 3200], ['2454', '聯發科', 1360, 1355, 90], ['2603', '長榮', 188, 186.5, 2400], ['3231', '緯創', 118, 117.5, 600], ['2882', '國泰金', 66.3, 66.4, 5000], ['1101', '台泥', 30.1, 29.95, 40]],
    etf: [['0050', '元大台灣50', 196.5, 196.8, 9000], ['00878', '國泰永續高股息', 21.3, 21.36, 52000], ['0056', '元大高股息', 36.1, 36.05, 30000], ['00919', '群益台灣精選高息', 22.4, 22.31, 18000], ['00929', '復華台灣科技優息', 18.2, 18.23, 26000], ['006208', '富邦台50', 113.2, 113, 700], ['00940', '元大台灣價值高息', 9.6, 9.58, 40000], ['00713', '元大台灣高息低波', 52.1, 52.3, 5]] };
  const RS = { rank: ['top', 'sort', 'tag'], filt: ['minVol', 'minPct'], pool: ['mineOnly', 'poolN', 'mine', 'mineMax', 'core', 'extra'], upd: ['iv', 'keep'], look: ['sub', 'arrow'], hl: ['hlOn', 'hl'] };
  const qpm = () => Math.round(C.poolN * 60 / C.iv);
  const form = () => { if (tab === 0) return fxSec(OPEN, 'rank', '排行', '每欄前 ' + C.top + ' 名・' + (C.sort === 'ticks' ? '依檔數' : '依幅度'), fxRg(C, 'top', '每欄顯示名次', 1, 10, 1, ' 名') + `<div class="small" style="margin-top:4px">排序依據</div>${fxSg(C, 'sort', [['pct', '價差幅度（%）'], ['ticks', '差幾檔（升降單位）']])}<div>${fxCk(C, 'tag', '標示「持股」「自選」')}</div>`, C)
      + fxSec(OPEN, 'filt', '過濾雜訊', '零股成交 ≥ ' + C.minVol + ' 股・價差 ≥ ' + C.minPct + '%', fxRg(C, 'minVol', '零股今日最少成交（股）', 1, 2000, 1, ' 股') + fxRg(C, 'minPct', '最小價差（低於不列入）', 0, 2, 0.05, '%') + '<div class="small muted">零股量太少時一筆成交就會拉開價差，可提高門檻排除。</div>', C)
      + fxSec(OPEN, 'pool', '選股池', C.mineOnly ? '只看自選／持股' : '每頁 ' + C.poolN + ' 檔', `<div>${fxCk(C, 'mineOnly', '只看自選／持股（含自訂代號，最多 40 檔，不用成交值補位）', 1)}</div>` + (C.mineOnly ? '' : fxRg(C, 'poolN', '每頁檔數', 5, 40, 5, ' 檔')) + (C.mineOnly ? '' : `<div>${fxCk(C, 'mine', '自選／持股優先', 1)}</div>`) + (C.mine && !C.mineOnly ? fxRg(C, 'mineMax', '自選／持股最多', 0, 20, 1, ' 檔') : '') + (C.mineOnly ? '' : `<div>${fxCk(C, 'core', 'ETF 頁固定加入 0050、0056、00878')}</div>`)
        + `<div class="field" style="margin:6px 0"><label class="small">自訂加入代號（逗號或空白分隔，個股與 ETF 自動分頁）</label><input id="oddEx" value="${esc(C.extra)}" placeholder="例：2330, 00919"></div><div class="small muted">其餘名額依前一日成交值由高到低補滿；選股池 30 分鐘更新一次。</div>`, C)
      + '<div style="text-align:right;margin-top:4px"><button type="button" class="btn sm" data-rall>全部回預設</button></div>';
    return fxSec(OPEN, 'upd', '更新頻率', '每 ' + C.iv + ' 秒', fxSg(C, 'iv', [[15, '15 秒'], [30, '30 秒'], [60, '60 秒'], [90, '90 秒'], [180, '3 分']]) + `<div class="small muted">目前設定約每分鐘 ${qpm()} 次富果查詢（只查正在看的那一頁）；超過方案上限會自動放慢。</div><div>${fxCk(C, 'keep', '收盤後保留當天最後一次盤中結果')}</div>`, C)
      + fxSec(OPEN, 'look', '列表內容', (C.sub ? '含價格' : '精簡') + (C.arrow ? '・箭頭' : ''), `<div>${fxCk(C, 'sub', '顯示零股／整股價格與差幾檔')}${fxCk(C, 'arrow', '顯示 ⬆️⬇️ 箭頭')}</div>`, C)
      + fxSec(OPEN, 'hl', '大價差標示', '≥ ' + C.hl + '%', fxRg(C, 'hl', '價差達此幅度加底色', 0.2, 5, 0.1, '%'), C, 'hlOn')
      + '<div style="text-align:right;margin-top:4px"><button type="button" class="btn sm" data-rall>全部回預設</button></div>'; };
  const ok = await dialog('零股排行設定', `<div style="position:sticky;top:-18px;z-index:3;background:var(--card);padding:2px 0 4px"><div id="odPv" style="max-height:34vh;overflow:auto"></div>
    <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:4px"><span class="small muted" style="align-self:center;margin-right:auto">預覽為示範資料</span><button type="button" class="btn sm" id="odPt">切換個股／ETF</button></div></div>
    <span class="seg" style="margin-top:6px"><button type="button" data-tb="0" class="on">排行與選股池</button><button type="button" data-tb="1">更新與顯示</button></span><div id="odF"></div>`, [['', '取消'], ['ok', '儲存', 'primary']], (root) => {
    const F = $('#odF', root);
    const pv = () => { const rows = DEMO[dt].map(([s, name, board, odd, oddVol]) => ({ s, name, board, odd, oddVol })); $('#odPv', root).innerHTML = '<div style="pointer-events:none">' + oddCardHtml(oddRank(rows, C.top, C), C, { tab: dt, st: '盤中 · 示範 · 每 ' + C.iv + ' 秒', msg: '', n: C.poolN, mine: { 6112: '持股', 2317: '自選', '00878': '持股', '0056': '自選' } }) + '</div>'; };
    const redraw = () => { F.innerHTML = form(); fxBind(F, () => C, OPEN, RS, ODD_DEF, redraw, pv);
      $$('[data-rall]', F).forEach((x) => x.onclick = () => { (tab === 0 ? [...RS.rank, ...RS.filt, ...RS.pool] : [...RS.upd, ...RS.look, ...RS.hl]).forEach((k) => { C[k] = ODD_DEF[k]; }); redraw(); });
      const ex = $('#oddEx', F); if (ex) ex.oninput = () => { C.extra = ex.value; }; pv(); };
    $$('[data-tb]', root).forEach((b) => b.onclick = () => { tab = +b.dataset.tb; $$('[data-tb]', root).forEach((x) => x.classList.toggle('on', x === b)); redraw(); });
    $('#odPt', root).onclick = () => { dt = dt === 'stk' ? 'etf' : 'stk'; pv(); };
    redraw();
  });
  if (ok !== 'ok') return false;
  S.pref.odd = { ...C }; savePref(); toast('已儲存零股排行設定'); return true;
}
function oddMount() {
  const host = $('#ovOdd'); if (!host) return;
  ODD.el = host; oddRender();
  if (!ODD.loop) { ODD.loop = setInterval(oddTick, 10000); oddTick(); }
}
// ───────── 即時 K 棒動畫（個股頁「即時 K 棒」卡；10 款樣式，設定 `S.pref.kfx`；App 端列入待送交清單） ─────────
// 當日 5 分 K（Yahoo）為底，盤中以 S.q 最新報價逐筆更新最後一根；只有最後一根與事件會動；分頁隱藏或卡片不在畫面時停止。
const KFX_STY = [
  { k: 'clean', n: '流暢經典', d: 'K 棒平滑成長、漲跌閃光、現價線與滾動數字', P: { bg: '#ffffff', grid: '#eef0f4', txt: '#6b7280', up: '#e5484d', dn: '#1f9d55' } },
  { k: 'neon', n: '霓虹 HUD', d: '發光 K 棒、呼吸光暈、掃描線、HUD 價格框', P: { bg: '#060a13', grid: '#122039', txt: '#6f86b0', up: '#ff4d6d', dn: '#22e39a' } },
  { k: 'part', n: '粒子能量', d: '成交化成光點匯入、大單爆開、內外盤分色量柱', P: { bg: '#0a0f1f', grid: '#18213a', txt: '#7d8db0', up: '#ff5a6a', dn: '#2fe0a0' } },
  { k: 'ripple', n: '脈衝漣漪', d: '每筆成交漣漪、穿過關鍵價時整條線亮起並沿線擴散', P: { bg: '#fbfbfd', grid: '#eceef3', txt: '#6b7280', up: '#e5484d', dn: '#1f9d55', lvl: '#2563eb' } },
  { k: 'heat', n: '熱力殘影', d: 'K 棒殘影、當日價量分布、現價熱帶', P: { bg: '#110c0a', grid: '#2a1f19', txt: '#a08a7a', up: '#ff5b4f', dn: '#35d08a' } },
  { k: 'wire', n: '極簡線框', d: '紙白細線、上漲空心、每跳一次描線重描外框', P: { bg: '#fafaf7', grid: '#ececE6', txt: '#77776f', up: '#d0342c', dn: '#178a4c', acc: '#111111' } },
  { k: 'crt', n: '復古終端', d: '綠色磷光像素、打字機報價、掃描線（單色，漲跌以亮度與 ▲▼ 區分）', P: { bg: '#021a0c', grid: '#0b3a1e', txt: '#2fae62', up: '#57ff9a', dn: '#1f8f4f' } },
  { k: 'ink', n: '水墨', d: '宣紙筆觸 K 棒、墨滴暈染、大單朱紅印章', P: { bg: '#f2eadb', grid: '#e2d6c0', txt: '#8a7a62', up: '#b8322a', dn: '#2e6b55' } },
  { k: 'iso', n: '立體方柱', d: '3D 方柱、頂面亮光、升降動畫', P: { bg: '#0f1622', grid: '#1c2636', txt: '#7e8ca3', up: '#ff5d5d', dn: '#2fd38a' } },
  { k: 'glass', n: '玻璃質感', d: '流動光斑、玻璃 K 棒、液面晃動、大單氣泡', P: { bg: '#eef2f8', grid: 'rgba(90,110,150,.12)', txt: '#66728a', up: '#e5484d', dn: '#1f9d55' } },
];
const KFX_DARK = new Set(['neon', 'part', 'heat', 'crt', 'iso']);
const KFX_DEF = { sty: 'clean', pick: true, ev: true, lvl: true, bigX: 5, N: 30, spd: 1, still: false };
function kfxCfg() { const c = { ...KFX_DEF, ...(S.pref.kfx || {}) }; const cl = (v, a, b, d) => (isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
  return { ...c, sty: KFX_STY.some((s) => s.k === c.sty) ? c.sty : 'clean', bigX: cl(c.bigX, 2, 20, 5), N: cl(c.N, 16, 60, 30), spd: cl(c.spd, 0.5, 2, 1) }; }
const kfxSty = (k) => KFX_STY.find((s) => s.k === k) || KFX_STY[0];
const KFX = { list: new Set(), raf: 0, lt: 0 };
const kfxRgba = (hex, a) => { if (hex[0] !== '#') return hex; const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const kfxEase = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const kfxFmt = (v) => (v == null || !isFinite(v) ? '—' : v.toFixed(v >= 1000 ? 1 : 2));
/** 建立一張即時 K 棒狀態；cs＝[{o,h,l,c,v,vi,vo,t}]（t 為該根起始毫秒），o＝{ sym, levels:[{v,label}], pb（價量分布刻度）, demo } */
function kfxNew(cv, cs, o) {
  const b = cs[cs.length - 1];
  const st = { cv, ctx: cv.getContext('2d'), cs, o, cfg: kfxCfg(), disp: { c: b.c, h: b.h, l: b.l, v: b.v }, shift: 0, ymin: 0, ymax: 0, fl: [], rp: [], pt: [], gh: [], prof: {}, dv: [],
    dir: b.c >= b.o ? 1 : -1, tag: { cur: kfxFmt(b.c), prev: '', t0: 0 }, lt: -1e9, msg: '', msgT: -1e9, lvT: -1e9, lvHit: null, vis: true, dirty: true, pp: null, seed: 7 };
  st.sty = kfxSty(st.cfg.sty);
  cs.slice(-60).forEach((x) => { const n = Math.max(1, Math.round((x.h - x.l) / o.pb) + 1), v = (x.v || 0) / n; for (let i = 0; i < n; i++) { const k = Math.round((x.l + i * o.pb) / o.pb); st.prof[k] = (st.prof[k] || 0) + v; } });
  return st;
}
/** 一筆新成交：p 價格、dv 新增量、bt 所屬 K 棒起始時間（換根時新增一根） */
function kfxTick(st, p, dv, now, bt, forceBig) {
  const cs = st.cs; let b = cs[cs.length - 1];
  if (bt && b.t && bt > b.t) { cs.push({ o: p, h: p, l: p, c: p, v: 0, vi: 0, vo: 0, t: bt }); if (cs.length > 240) cs.shift(); b = cs[cs.length - 1]; st.disp = { c: p, h: p, l: p, v: 0 }; st.shift = 1; st.gh = []; }
  const old = b.c; b.c = p; b.h = Math.max(b.h, p); b.l = Math.min(b.l, p);
  const dir = p > old ? 1 : p < old ? -1 : st.dir; st.dir = dir; dv = Math.max(0, dv || 0);
  b.v = (b.v || 0) + dv; if (dir > 0) b.vo = (b.vo || 0) + dv; else b.vi = (b.vi || 0) + dv;
  const nz = st.dv.filter((x) => x > 0), avg = nz.length ? nz.reduce((a, x) => a + x, 0) / nz.length : 0;
  const big = forceBig || (dv > 0 && nz.length >= 8 && dv >= avg * st.cfg.bigX); if (dv > 0) { st.dv.push(dv); if (st.dv.length > 60) st.dv.shift(); }
  const pk = Math.round(p / st.o.pb); st.prof[pk] = (st.prof[pk] || 0) + Math.max(dv, 1);
  st.fl.push({ t: now, dir }); st.rp.push({ t: now, p, dir, big }); if (st.rp.length > 40) st.rp.shift();
  st.gh.push({ o: b.o, h: b.h, l: b.l, c: p }); if (st.gh.length > 9) st.gh.shift();
  const rnd = () => (st.seed = st.seed * 16807 % 2147483647) / 2147483647;
  for (let k = 0, n = big ? 30 : 4; k < n; k++) st.pt.push({ t: now, dir, big, a: rnd() * Math.PI * 2, sp: 0.4 + rnd() * 0.8, ox: rnd(), oy: rnd(), life: 700 + rnd() * 500 });
  if (st.pt.length > 400) st.pt.splice(0, st.pt.length - 400);
  if (big && st.cfg.ev) { st.msg = (dir > 0 ? '外盤大單 ' : '內盤大單 ') + fmtInt(dv) + (isUs(st.o.sym || '') ? ' 股' : ' 張'); st.msgT = now; st.bigT = now; }
  (st.o.levels || []).forEach((L) => { if (old < L.v && p >= L.v) { st.lvT = now; st.lvHit = L.v; if (st.cfg.ev) { st.msg = '突破' + L.label + ' ' + kfxFmt(L.v); st.msgT = now; } } else if (old > L.v && p <= L.v) { st.lvT = now; st.lvHit = L.v; if (st.cfg.ev) { st.msg = '跌破' + L.label + ' ' + kfxFmt(L.v); st.msgT = now; } } });
  const tg = kfxFmt(p); if (tg !== st.tag.cur) st.tag = { cur: tg, prev: st.tag.cur, t0: now };
  st.lt = now; st.dirty = true;
}
function kfxPaper(st, W, H) { if (st.pp && st.pp.width === W && st.pp.height === H) return st.pp; const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  let s = 99; const r = () => (s = s * 16807 % 2147483647) / 2147483647; g.fillStyle = '#f2eadb'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H / 40; i++) { g.fillStyle = `rgba(120,95,60,${r() * 0.06})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1); }
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(150,120,80,${0.04 + r() * 0.05})`; g.beginPath(); const x = r() * W, y = r() * H; g.moveTo(x, y); g.quadraticCurveTo(x + r() * 40, y + r() * 10, x + 20 + r() * 60, y + r() * 6); g.stroke(); }
  return (st.pp = cv); }
function kfxPrism(c, x, y1, y2, bw, col, topA, al) { const dx = bw * 0.5, dy = bw * 0.36, h = Math.max(1.5, y2 - y1);
  c.fillStyle = kfxRgba(col, al); c.fillRect(x - bw / 2, y1, bw, h);
  c.fillStyle = kfxRgba(col, 0.55 * al); c.beginPath(); c.moveTo(x + bw / 2, y1); c.lineTo(x + bw / 2 + dx, y1 - dy); c.lineTo(x + bw / 2 + dx, y1 - dy + h); c.lineTo(x + bw / 2, y1 + h); c.closePath(); c.fill();
  c.fillStyle = `rgba(255,255,255,${topA})`; c.beginPath(); c.moveTo(x - bw / 2, y1); c.lineTo(x - bw / 2 + dx, y1 - dy); c.lineTo(x + bw / 2 + dx, y1 - dy); c.lineTo(x + bw / 2, y1); c.closePath(); c.fill();
  c.fillStyle = kfxRgba(col, 0.9); c.globalAlpha = 0.5 * al; c.fill(); c.globalAlpha = 1; }
/** 樣式是否有持續性動畫（不只在有成交時動） */
const kfxCont = (k) => k === 'neon' || k === 'crt' || k === 'glass' || k === 'iso';
function kfxDraw(st, now, dt) {
  const cv = st.cv, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return; const dpr = Math.min(2, pxRatio());
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = st.ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); const P = st.sty.P, k = st.sty.k, cs = st.cs, sp = st.cfg.spd;
  const rm = 64, top = 26, ph = H * 0.62, vt = top + ph + 10, vh = H - vt - 18;
  const N = Math.min(st.cfg.N, Math.max(12, Math.floor((W - rm) / 7))), cw = (W - rm - 6) / N;
  const b = cs[cs.length - 1], D = st.disp, a = 1 - Math.exp(-dt * sp / 90);
  D.c += (b.c - D.c) * a; D.h += (b.h - D.h) * a; D.l += (b.l - D.l) * a; D.v += ((b.v || 0) - D.v) * a;
  D.h = Math.max(D.h, D.c, b.o); D.l = Math.min(D.l, D.c, b.o);
  st.shift = Math.max(0, st.shift - dt * sp / 450);
  const vis = cs.slice(-N - 1);
  const lvs = st.cfg.lvl ? (st.o.levels || []) : [];
  let lo = Math.min(...vis.map((x) => x.l)), hi = Math.max(...vis.map((x) => x.h));
  lvs.forEach((L) => { if (L.v > lo - (hi - lo) * 0.6 && L.v < hi + (hi - lo) * 0.6) { lo = Math.min(lo, L.v); hi = Math.max(hi, L.v); } });
  const pad = (hi - lo) * 0.08 || Math.max(0.01, hi * 0.002);
  if (!st.ymax) { st.ymin = lo - pad; st.ymax = hi + pad; } st.ymin += (lo - pad - st.ymin) * a * 0.6; st.ymax += (hi + pad - st.ymax) * a * 0.6;
  const Y = (v) => top + (st.ymax - v) / (st.ymax - st.ymin) * ph;
  const vmax = Math.max(...vis.map((x) => x.v || 0), D.v, 1e-9);
  const X = (kk) => 4 + (N - 1 - kk + st.shift) * cw + cw / 2;
  if (k === 'ink') c.drawImage(kfxPaper(st, W, H), 0, 0, W, H);
  else if (k === 'iso') { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#162032'); g.addColorStop(1, '#0a0f18'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  else { c.fillStyle = P.bg; c.fillRect(0, 0, W, H); }
  if (k === 'glass') { const t = now / 9000; [[0.25 + 0.15 * Math.sin(t), 0.3 + 0.2 * Math.cos(t * 1.3), 'rgba(255,150,190,.38)'], [0.7 + 0.12 * Math.cos(t * 0.8), 0.55 + 0.2 * Math.sin(t * 1.1), 'rgba(120,170,255,.38)'], [0.45 + 0.2 * Math.sin(t * 0.6 + 2), 0.85, 'rgba(110,230,190,.3)']].forEach(([fx, fy, col]) => { const x = fx * W, y = fy * H, R = Math.max(W, H) * 0.45; const g = c.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); }); }
  // 格線與價格刻度
  c.font = '500 11px ui-monospace,Menlo,monospace'; c.textBaseline = 'middle'; c.textAlign = 'left';
  const raw = (st.ymax - st.ymin) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw || 1))), stepP = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || raw;
  for (let p = Math.ceil(st.ymin / stepP) * stepP; p < st.ymax; p += stepP) { const y = Y(p); if (y < top - 4 || y > top + ph + 4) continue; c.strokeStyle = P.grid; c.lineWidth = 1; c.beginPath(); c.moveTo(0, y); c.lineTo(W - rm, y); c.stroke(); c.fillStyle = P.txt; c.fillText(kfxFmt(p), W - rm + 8, y); }
  c.strokeStyle = P.grid; c.beginPath(); c.moveTo(0, vt - 4); c.lineTo(W - rm, vt - 4); c.stroke();
  // 時間刻度
  c.fillStyle = P.txt; c.font = '500 10px ui-monospace,Menlo,monospace'; c.textBaseline = 'bottom';
  for (let i = 0; i < vis.length; i++) { const kk = vis.length - 1 - i; if (kk % 6 || !vis[i].t) continue; const x = X(kk); if (x < 14 || x > W - rm - 14) continue; c.textAlign = 'center'; c.fillText(hm(vis[i].t), x, H - 2); }
  c.textAlign = 'left'; c.textBaseline = 'middle';
  c.save(); c.beginPath(); c.rect(0, 0, W - rm, H - 14); c.clip();
  if (k === 'neon') { const sy = top + ((now * sp / 2600) % 1) * (ph + 40) - 20; const g = c.createLinearGradient(0, sy - 30, 0, sy + 4); g.addColorStop(0, 'rgba(80,140,255,0)'); g.addColorStop(1, 'rgba(80,140,255,.16)'); c.fillStyle = g; c.fillRect(0, sy - 30, W - rm, 34); }
  if (k === 'heat') { const ks = Object.keys(st.prof); const pm = Math.max(1, ...ks.map((x) => st.prof[x])); const bh = Math.max(2, Math.abs(Y(0) - Y(st.o.pb)) - 1);
    ks.forEach((x) => { const v = st.prof[x] / pm, y = Y(+x * st.o.pb); if (y < top - 4 || y > top + ph + 4) return; const L = 70 * v; const g = c.createLinearGradient(W - rm - L, 0, W - rm, 0); g.addColorStop(0, 'rgba(255,120,40,0)'); g.addColorStop(1, `rgba(255,${150 + 90 * v | 0},60,${0.25 + 0.55 * v})`); c.fillStyle = g; c.fillRect(W - rm - L, y - bh / 2, L, bh); });
    const y = Y(D.c), g = c.createLinearGradient(0, y - 14, 0, y + 14); g.addColorStop(0, 'rgba(255,110,40,0)'); g.addColorStop(0.5, 'rgba(255,110,40,.14)'); g.addColorStop(1, 'rgba(255,110,40,0)'); c.fillStyle = g; c.fillRect(0, y - 14, W - rm, 28); }
  // 關鍵價（三關）
  if (lvs.length) { const age = now - st.lvT, hot = age < 1400 / sp, lc = P.lvl || (KFX_DARK.has(k) ? '#8fb3ff' : '#2563eb');
    lvs.forEach((L) => { const y = Y(L.v); if (y < top - 2 || y > top + ph + 2) return; const strong = hot && st.lvHit === L.v && k === 'ripple';
      c.setLineDash(strong ? [] : [6, 5]); c.strokeStyle = strong ? lc : kfxRgba(lc, k === 'ripple' ? 0.55 : 0.35); c.lineWidth = strong ? 1 + 3 * (1 - age * sp / 1400) : 1; c.beginPath(); c.moveTo(0, y); c.lineTo(W - rm, y); c.stroke(); c.setLineDash([]);
      c.fillStyle = kfxRgba(lc, 0.85); c.font = '500 11px system-ui,sans-serif'; c.textBaseline = 'bottom'; c.fillText(L.label + ' ' + kfxFmt(L.v), 6, y - 3); c.textBaseline = 'middle'; });
    if (k === 'ripple' && hot && st.lvHit != null) { const y = Y(st.lvHit), x0 = X(0), e = kfxEase(age * sp / 1400); for (const s of [-1, 1]) { c.fillStyle = kfxRgba(lc, 1 - e); c.beginPath(); c.arc(x0 + s * e * W * 0.7, y, 4 + 3 * (1 - e), 0, 7); c.fill(); }
      c.strokeStyle = kfxRgba(lc, 0.7 * (1 - e)); c.lineWidth = 2; c.beginPath(); c.arc(x0, y, 8 + 40 * e, 0, 7); c.stroke(); } }
  if (k === 'clean') { st.fl = st.fl.filter((f) => now - f.t < 450 / sp); const f = st.fl[st.fl.length - 1]; if (f) { c.fillStyle = kfxRgba(f.dir > 0 ? P.up : P.dn, 0.22 * (1 - (now - f.t) * sp / 450)); c.fillRect(X(0) - cw / 2, top - 6, cw, ph + 12); } }
  if (k === 'heat') st.gh.forEach((g, i) => { const n = st.gh.length, al = 0.08 + 0.22 * (i / n), off = (n - i) * 2.2; const x = X(0) - off, col = g.c >= g.o ? P.up : P.dn; c.strokeStyle = kfxRgba(col, al); c.lineWidth = 1; const y1 = Y(Math.max(g.o, g.c)), y2 = Y(Math.min(g.o, g.c)); c.strokeRect(x - cw * 0.34, y1, cw * 0.68, Math.max(1, y2 - y1)); });
  // K 棒與量柱
  const rr = (xx, yy, ww, hh, r) => { c.beginPath(); if (c.roundRect) c.roundRect(xx, yy, ww, hh, Math.max(0, Math.min(r, ww / 2, hh / 2))); else c.rect(xx, yy, ww, hh); };
  for (let i = 0; i < vis.length; i++) {
    const kk = vis.length - 1 - i, x = X(kk); if (x < -cw || x > W - rm + cw) continue; const bar = vis[i], last = kk === 0;
    const o = bar.o, cl = last ? D.c : bar.c, h = last ? D.h : bar.h, l = last ? D.l : bar.l, up = cl >= o, col = up ? P.up : P.dn;
    const bw = Math.max(2, cw * 0.66), y1 = Y(Math.max(o, cl)), y2 = Y(Math.min(o, cl));
    const vv = last ? D.v : (bar.v || 0), vhh = vv / vmax * vh, bh = Math.max(1.2, y2 - y1);
    if (k === 'neon') { c.fillStyle = kfxRgba(col, last ? 0 : 0.13); c.fillRect(x - bw / 2 - 2, y1 - 2, bw + 4, bh + 4);
      if (last) { const br = 0.55 + 0.45 * Math.sin(now * sp / 420); const R = cw * 2.2 + 8 * br, gy = (y1 + y2) / 2; const g = c.createRadialGradient(x, gy, 1, x, gy, R); g.addColorStop(0, kfxRgba(col, 0.45 * br + 0.15)); g.addColorStop(1, kfxRgba(col, 0)); c.fillStyle = g; c.fillRect(x - R, gy - R, R * 2, R * 2); } }
    if (k === 'wire') { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x, Y(h)); c.lineTo(x, y1); c.moveTo(x, y1 + bh); c.lineTo(x, Y(l)); c.stroke();
      if (up) { c.lineWidth = 1.2; c.strokeRect(x - bw / 2 + 0.6, y1 + 0.6, bw - 1.2, Math.max(1, bh - 1.2)); } else { c.fillStyle = col; c.fillRect(x - bw / 2, y1, bw, bh); }
      if (last) { const e = kfxEase((now - st.lt) * sp / 340), L = 2 * (bw + bh) * e; c.strokeStyle = P.acc; c.lineWidth = 2; c.beginPath(); const x0 = x - bw / 2, pts = [[x0, y1], [x0 + bw, y1], [x0 + bw, y1 + bh], [x0, y1 + bh], [x0, y1]]; let rem = L; c.moveTo(x0, y1);
        for (let j = 1; j < pts.length && rem > 0; j++) { const [ax, ay] = pts[j - 1], [bx, by] = pts[j], sl = Math.hypot(bx - ax, by - ay) || 1, t = Math.min(1, rem / sl); c.lineTo(ax + (bx - ax) * t, ay + (by - ay) * t); rem -= sl; } c.stroke(); }
      c.fillStyle = kfxRgba(col, 0.28); c.fillRect(x - 0.6, vt + vh - vhh, 1.2, vhh); c.fillRect(x - bw / 2, vt + vh - 1, bw, 1); continue; }
    if (k === 'crt') { const sn = (v) => Math.round(v / 3) * 3, fl = last ? 0.75 + 0.25 * Math.sin(now / 37) * Math.sin(now / 91) : 1;
      c.fillStyle = kfxRgba(col, 0.9 * fl); c.fillRect(sn(x) - 1, sn(Y(h)), 2, sn(Y(l)) - sn(Y(h)));
      if (up) c.fillRect(sn(x - bw / 2), sn(y1), sn(bw), Math.max(3, sn(bh))); else { c.strokeStyle = kfxRgba(col, 0.9 * fl); c.lineWidth = 2; c.strokeRect(sn(x - bw / 2) + 1, sn(y1) + 1, sn(bw) - 2, Math.max(2, sn(bh) - 2)); }
      for (let yy = vt + vh - 3; yy > vt + vh - vhh; yy -= 4) c.fillRect(sn(x - bw / 2), yy, sn(bw), 3); continue; }
    if (k === 'ink') { const sd = (j) => Math.sin((bar.t || i) * 0.0001 + i * 12.9898 + j * 78.233) * 0.5; c.strokeStyle = kfxRgba(col, 0.75); c.lineWidth = 1.3; c.lineCap = 'round'; c.beginPath(); c.moveTo(x + sd(1), Y(h)); c.quadraticCurveTo(x + sd(2) * 2, (Y(h) + Y(l)) / 2, x + sd(3), Y(l)); c.stroke();
      for (let j = 0; j < 3; j++) { c.fillStyle = kfxRgba(col, 0.32 + 0.1 * j); rr(x - bw / 2 + sd(j + 4) * 2, y1 + sd(j + 7) * 2, bw - j, bh, 4); c.fill(); }
      c.fillStyle = kfxRgba(col, 0.16); c.fillRect(x - bw / 2, vt + vh - vhh, bw, vhh); c.lineCap = 'butt'; continue; }
    if (k === 'iso') { c.strokeStyle = kfxRgba(col, 0.8); c.lineWidth = 1; c.beginPath(); c.moveTo(x, Y(h)); c.lineTo(x, Y(l)); c.stroke();
      kfxPrism(c, x, y1, y1 + bh, bw * 0.86, col, last ? 0.35 + 0.25 * Math.sin(now * sp / 300) : 0.18, 1); kfxPrism(c, x, vt + vh - vhh, vt + vh, bw * 0.86, col, 0.08, 0.5); continue; }
    if (k === 'glass') { c.strokeStyle = kfxRgba(col, 0.55); c.lineWidth = 1.2; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, Y(h)); c.lineTo(x, y1); c.moveTo(x, y1 + bh); c.lineTo(x, Y(l)); c.stroke(); c.lineCap = 'butt';
      const gh = Math.max(last ? 16 : 4, bh); rr(x - bw / 2, y1, bw, gh, bw / 2); c.fillStyle = 'rgba(255,255,255,.35)'; c.fill(); c.fillStyle = kfxRgba(col, last ? 0.12 : 0.3); c.fill(); c.strokeStyle = kfxRgba(col, 0.75); c.lineWidth = 1; c.stroke();
      if (last) { c.save(); rr(x - bw / 2, y1, bw, gh, bw / 2); c.clip(); const amp = 3.5 * Math.exp(-(now - st.lt) * sp / 520), lv = y1 + gh * 0.18; c.fillStyle = kfxRgba(col, 0.62); c.beginPath(); c.moveTo(x - bw / 2 - 2, y1 + gh + 2);
        for (let xx = -bw / 2 - 2; xx <= bw / 2 + 2; xx += 2) c.lineTo(x + xx, lv + Math.sin(xx * 0.5 + now * sp / 90) * amp); c.lineTo(x + bw / 2 + 2, y1 + gh + 2); c.closePath(); c.fill();
        st.pt.forEach((p) => { if (!p.big) return; const e = (now - p.t) / p.life; if (e >= 1) return; c.strokeStyle = `rgba(255,255,255,${0.9 * (1 - e)})`; c.lineWidth = 1; c.beginPath(); c.arc(x - bw / 2 + 3 + p.ox * (bw - 6), y1 + gh - e * (gh + 20) * p.sp, 1.2 + p.oy * 2, 0, 7); c.stroke(); }); c.restore(); }
      c.fillStyle = 'rgba(255,255,255,.6)'; c.fillRect(x - bw / 2 + 2, y1 + 2, Math.max(1, bw * 0.16), Math.max(0, gh - 4));
      rr(x - bw / 2, vt + vh - vhh, bw, Math.max(3, vhh), 3); c.fillStyle = kfxRgba(col, 0.22); c.fill(); c.strokeStyle = kfxRgba(col, 0.5); c.stroke(); continue; }
    c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x, Y(h)); c.lineTo(x, Y(l)); c.stroke();
    c.fillStyle = col; c.fillRect(x - bw / 2, y1, bw, bh);
    if (k === 'part') { const tot = Math.max(1e-9, (bar.vi || 0) + (bar.vo || 0)), hi2 = vhh * (bar.vo || 0) / tot; c.fillStyle = kfxRgba(P.dn, 0.75); c.fillRect(x - bw / 2, vt + vh - vhh, bw, vhh - hi2); c.fillStyle = kfxRgba(P.up, 0.85); c.fillRect(x - bw / 2, vt + vh - vhh, bw, hi2); }
    else { c.fillStyle = kfxRgba(col, last ? 0.8 : 0.45); c.fillRect(x - bw / 2, vt + vh - vhh, bw, vhh); }
  }
  // 漣漪／墨滴／印章／粒子
  if (k === 'ripple') { st.rp = st.rp.filter((p) => now - p.t < (p.big ? 1100 : 700) / sp); st.rp.forEach((p) => { const e = kfxEase((now - p.t) * sp / (p.big ? 1100 : 700)); c.strokeStyle = kfxRgba(p.dir > 0 ? P.up : P.dn, 0.6 * (1 - e)); c.lineWidth = p.big ? 2.5 : 1.5; c.beginPath(); c.arc(X(0), Y(p.p), 4 + (p.big ? 46 : 20) * e, 0, 7); c.stroke(); }); }
  if (k === 'ink') { st.rp = st.rp.filter((p) => now - p.t < 1600 / sp); st.rp.forEach((p) => { const e = kfxEase((now - p.t) * sp / 1600), R = 3 + (p.big ? 30 : 13) * e, y = Y(p.p), x = X(0); const g = c.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, `rgba(30,25,20,${0.22 * (1 - e)})`); g.addColorStop(1, 'rgba(30,25,20,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, R, 0, 7); c.fill(); });
    const sa = now - (st.bigT || -1e9); if (sa < 1800) { const sc = 1 + 0.5 * (1 - kfxEase(sa / 220)), al = sa < 1400 ? 0.9 : 0.9 * (1 - (sa - 1400) / 400); c.save(); c.translate(W - rm - 46, top + 30); c.rotate(-0.14); c.scale(sc, sc); c.globalAlpha = al; c.fillStyle = '#c0392b'; c.fillRect(-22, -22, 44, 44); c.strokeStyle = '#f2eadb'; c.lineWidth = 2; c.strokeRect(-18, -18, 36, 36); c.fillStyle = '#f7efe0'; c.font = '900 15px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('大單', 0, 1); c.restore(); } }
  st.pt = st.pt.filter((p) => now - p.t < p.life / sp);
  if (k === 'part') { const tx = X(0), ty = Y(D.c); c.globalCompositeOperation = 'lighter';
    st.pt.forEach((p) => { const e = (now - p.t) * sp / p.life, col = p.dir > 0 ? P.up : P.dn; let x, y;
      if (p.big) { const R = 10 + 90 * kfxEase(e) * p.sp; x = tx + Math.cos(p.a) * R; y = ty + Math.sin(p.a) * R; }
      else { const sx = W - rm - 10 - p.ox * 60, sy = vt + vh * p.oy, ee = kfxEase(e); x = sx + (tx - sx) * ee + Math.sin(e * 6 + p.a) * 6 * (1 - ee); y = sy + (ty - sy) * ee; }
      c.fillStyle = kfxRgba(col, 0.9 * (1 - e) + 0.1); c.beginPath(); c.arc(x, y, p.big ? 2.2 : 1.8, 0, 7); c.fill(); }); c.globalCompositeOperation = 'source-over'; }
  // 現價線
  const py = Y(D.c), pc = st.dir > 0 ? P.up : P.dn;
  c.setLineDash(k === 'neon' || k === 'crt' ? [2, 4] : k === 'wire' ? [] : [5, 4]); c.strokeStyle = k === 'wire' ? 'rgba(17,17,17,.5)' : kfxRgba(pc, 0.75); c.lineWidth = k === 'wire' ? 0.6 : 1; c.beginPath(); c.moveTo(0, py); c.lineTo(W - rm, py); c.stroke(); c.setLineDash([]);
  // 事件字幕
  const ma = now - st.msgT; if (ma < 1800 && st.msg && !(k === 'ink' && /大單/.test(st.msg)) && k !== 'crt') { const al = ma < 1400 ? 1 : 1 - (ma - 1400) / 400, dk = KFX_DARK.has(k); c.font = '700 13px system-ui,sans-serif'; c.textBaseline = 'top'; const tw = c.measureText(st.msg).width + 16;
    c.fillStyle = dk ? `rgba(255,255,255,${0.1 * al})` : `rgba(17,24,39,${0.07 * al})`; c.fillRect(8, 4, tw, 20); c.fillStyle = dk ? `rgba(240,244,255,${al})` : `rgba(17,24,39,${al})`; c.fillText(st.msg, 16, 7); c.textBaseline = 'middle'; }
  if (k === 'crt') { const s = `> ${st.tag.cur} ${st.dir > 0 ? '▲' : '▼'}`, nn = Math.min(s.length, Math.floor((now - st.lt) / 28)); c.font = '700 12px ui-monospace,Menlo,monospace'; c.fillStyle = P.up; c.textBaseline = 'top'; c.fillText(s.slice(0, Math.max(1, nn)) + ((now / 400 | 0) % 2 ? '█' : ' '), 8, 6); c.textBaseline = 'middle'; }
  c.restore();
  if (k === 'crt') { c.fillStyle = 'rgba(0,0,0,.22)'; for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1); const g = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  // 右側價格標籤（滾動數字）
  const th = 20, ty0 = Math.min(H - th, Math.max(0, py - th / 2)), hud = k === 'neon' || k === 'crt';
  if (hud) { c.strokeStyle = pc; c.lineWidth = 1.2; c.fillStyle = kfxRgba(pc, 0.14); c.fillRect(W - rm + 3, ty0, rm - 6, th); c.beginPath(); c.moveTo(W - rm + 3, ty0 + 5); c.lineTo(W - rm + 3, ty0); c.lineTo(W - rm + 9, ty0); c.moveTo(W - 9, ty0 + th); c.lineTo(W - 3, ty0 + th); c.lineTo(W - 3, ty0 + th - 5); c.stroke(); }
  else { c.fillStyle = pc; c.beginPath(); c.moveTo(W - rm, py); c.lineTo(W - rm + 6, ty0); c.lineTo(W - 2, ty0); c.lineTo(W - 2, ty0 + th); c.lineTo(W - rm + 6, ty0 + th); c.closePath(); c.fill(); }
  c.save(); c.beginPath(); c.rect(W - rm + 4, ty0, rm - 6, th); c.clip(); c.font = '700 12px ui-monospace,Menlo,monospace'; c.fillStyle = hud ? pc : '#fff'; c.textAlign = 'left';
  const e = k !== 'part' && k !== 'heat' ? kfxEase((now - st.tag.t0) * sp / 260) : 1, cx = W - rm + 9, cy = ty0 + th / 2;
  if (e < 1 && st.tag.prev) { const s = st.dir > 0 ? 1 : -1; c.globalAlpha = 1 - e; c.fillText(st.tag.prev, cx, cy - s * th * e); c.globalAlpha = e; c.fillText(st.tag.cur, cx, cy + s * th * (1 - e)); c.globalAlpha = 1; } else c.fillText(st.tag.cur, cx, cy);
  c.restore();
  st.dirty = false;
}
/** 共用動畫迴圈：只畫看得到、且正在動（近 2.5 秒有成交、或樣式有持續動畫且盤中）的卡片 */
function kfxRun() {
  if (KFX.raf) return;
  const loop = (now) => {
    const dt = Math.min(100, now - (KFX.lt || now)); KFX.lt = now; let any = false;
    KFX.list.forEach((st) => {
      if (!st.cv.isConnected) { KFX.list.delete(st); if (st.iv) clearInterval(st.iv); if (st.io) st.io.disconnect(); return; }
      if (st.feed) st.feed(now);
      if (document.hidden || !st.vis) return;
      const moving = !st.cfg.still && (now - st.lt < 2500 || st.shift > 0 || (kfxCont(st.sty.k) && st.live));
      if (moving || st.dirty) kfxDraw(st, now, moving ? dt : 1000);
      any = true;
    });
    KFX.raf = KFX.list.size ? requestAnimationFrame(loop) : 0; if (!any && !KFX.list.size) KFX.lt = 0;
  };
  KFX.raf = requestAnimationFrame(loop);
}
const kfxLive = (sym) => (isUs(sym) ? ['PRE', 'REG', 'POST'].includes(usPhase().k) : twOpen());
/** 個股頁「即時 K 棒」卡 */
async function kfxMount(host, sym) {
  if (!host) return; const cfg = kfxCfg(), sty = kfxSty(cfg.sty);
  const pick = cfg.pick ? `<div class="seg" id="kfxPick" style="flex-wrap:nowrap;overflow-x:auto;max-width:100%;scrollbar-width:none;margin:2px 0 8px">${KFX_STY.map((s) => `<button data-kx="${s.k}" class="${s.k === sty.k ? 'on' : ''}" style="white-space:nowrap;flex:none">${s.n}</button>`).join('')}</div>` : '';
  host.innerHTML = `<div class="card"><h2>即時 K 棒<span class="r" style="display:inline-flex;gap:6px;align-items:center"><span class="small muted">5 分 K · ${esc(sty.n)}</span><button class="btn sm" id="kfxG" title="即時 K 棒設定">⚙</button></span></h2>${pick}
    <div style="position:relative;height:300px;border-radius:10px;overflow:hidden"><canvas style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas></div>
    <div class="row between small muted" style="margin-top:4px"><span id="kfxS">載入當日 5 分 K…</span></div>
    <div class="small muted" style="margin-top:4px">動畫只呈現價格與成交量的變化，不代表任何買賣建議。</div></div>`;
  $('#kfxG', host).onclick = async () => { if (await kfxSettings()) kfxMount(host, sym); };
  $$('[data-kx]', host).forEach((b) => b.onclick = () => { S.pref.kfx = { ...(S.pref.kfx || {}), sty: b.dataset.kx }; savePref(); kfxMount(host, sym); });
  const cur = $('#kfxPick .on', host); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  const us = isUs(sym), r = await fetchYahoo(ysym(sym), '5d', '5m', 30);
  if (!host.isConnected) return; const msg = $('#kfxS', host);
  if (!r || !r.timestamp) { msg.textContent = '無法取得當日 5 分 K'; return; }
  const q0 = r.indicators.quote[0], day = (t) => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10);
  const lastDay = day(r.timestamp[r.timestamp.length - 1]);
  let cs = r.timestamp.map((t, i) => (q0.close[i] == null || q0.open[i] == null || day(t) !== lastDay ? null : { t: t * 1000, o: q0.open[i], h: q0.high[i], l: q0.low[i], c: q0.close[i], v: us ? q0.volume[i] || 0 : (q0.volume[i] || 0) / 1000 })).filter(Boolean);
  if (!cs.length) { msg.textContent = '沒有當日 5 分 K 資料'; return; }
  cs.forEach((x) => { if (x.c >= x.o) { x.vo = x.v; x.vi = 0; } else { x.vi = x.v; x.vo = 0; } });
  const lastC = cs[cs.length - 1].c, pb = us ? Math.max(0.01, lastC * 0.001) : twTick(lastC, D.isEtf(sym));
  let levels = [];
  if (cfg.lvl) { try { const dk = sym + '2y'; const daily = barCache[dk] || (barCache[dk] = await loadBars(sym, '2y')); const kl = keyLevelsOf(daily, sym); if (kl) levels = kl.lv.map((x) => ({ v: x.v, label: x.label })); } catch (e) {} }
  if (!host.isConnected) return;
  const cv = $('canvas', host), st = kfxNew(cv, cs, { sym, levels, pb });
  const q = S.q[sym] || {}; st.lastP = q.price; st.lastV = us ? q.vol : q.volLots;
  st.io = new IntersectionObserver((en) => { st.vis = en[0].isIntersecting; if (st.vis) st.dirty = true; }); st.io.observe(cv);
  const status = () => { const live = st.live = kfxLive(sym); msg.textContent = live ? '盤中即時 · 最後一筆 ' + (st.lt > 0 ? new Date(Date.now() - (performance.now() - st.lt)).toLocaleTimeString('zh-TW', { hour12: false }) : '等待成交') : '非交易時段 · 顯示 ' + lastDay.replace(/-/g, '/') + ' 的 5 分 K'; };
  st.feed = () => { const q = S.q[sym]; if (!q || !(q.price > 0) || !st.live) return; const v = us ? q.vol : q.volLots;
    if (q.price === st.lastP && v === st.lastV) return; const dv = st.lastV != null && v != null ? v - st.lastV : 0; st.lastP = q.price; st.lastV = v;
    const nowMs = Date.now(); kfxTick(st, q.price, dv, performance.now(), Math.floor(nowMs / 300000) * 300000); status(); };
  status(); st.iv = setInterval(() => { status(); if (st.live && !(us ? false : fgFresh(sym)) && Date.now() - ((S.q[sym] || {}).time || 0) > 8000) refreshQuotes([sym]).catch(() => {}); }, 10000);
  KFX.list.add(st); kfxRun();
}
/** 示範資料（設定頁預覽用） */
function kfxDemo(seed) {
  let s = seed; const r = () => (s = s * 16807 % 2147483647) / 2147483647; const T = 0.05, qz = (v) => Math.round(v / T) * T;
  const cs = []; let p = 52.3; const t0 = Date.now() - 30 * 300000;
  for (let i = 0; i < 30; i++) { const o = p; let h = o, l = o, c = o, vi = 0, vo = 0; for (let k = 0; k < 12; k++) { const d = qz((r() - 0.5 + 0.08 * Math.sin(i / 5)) * 0.32); c = qz(c + d); h = Math.max(h, c); l = Math.min(l, c); const v = 20 + r() * 60; if (d >= 0) vo += v; else vi += v; }
    cs.push({ o, h, l, c, vi, vo, v: vi + vo, t: t0 + i * 300000 }); p = c; }
  return { cs, r, T, qz };
}
/** 即時 K 棒設定：頂端即時預覽（示範報價，可模擬大單／突破）＋樣式卡＋細項；儲存才套用 */
async function kfxSettings() {
  const C = kfxCfg(); const OPEN = new Set(['sty', 'ev']); let st = null, acc = 0, n = 0;
  const RS = { sty: ['sty', 'pick'], ev: ['ev', 'bigX'], lvl: ['lvl'], view: ['N', 'spd', 'still'] };
  const form = () => fxSec(OPEN, 'sty', '樣式', kfxSty(C.sty).n, `<div class="grid g2" style="gap:6px">${KFX_STY.map((s) => `<button type="button" class="btn${s.k === C.sty ? ' primary' : ''}" data-sg="sty" data-v2="${s.k}" style="text-align:left;height:auto;padding:8px 10px;white-space:normal"><b>${s.n}</b><div class="small" style="opacity:.8;font-weight:400">${s.d}</div></button>`).join('')}</div>` + `<div>${fxCk(C, 'pick', '卡片上方顯示樣式切換列')}</div>`, C)
    + fxSec(OPEN, 'ev', '事件提示', C.ev ? '大單＝平均量 ' + C.bigX + ' 倍' : '關閉', fxRg(C, 'bigX', '大單門檻（單筆量 ≥ 近期平均的幾倍）', 2, 20, 1, ' 倍') + '<div class="small muted">事件提示會在圖上短暫顯示「外盤大單／內盤大單」與「突破／跌破三關價」。</div>', C, 'ev')
    + fxSec(OPEN, 'lvl', '三關價線', C.lvl ? '顯示' : '不顯示', '<div class="small muted">依前一交易日高低點計算上關、中關、下關；價格穿過時觸發事件（脈衝漣漪款有亮線與擴散）。</div>', C, 'lvl')
    + fxSec(OPEN, 'view', '顯示與速度', C.N + ' 根・' + C.spd + '×', fxRg(C, 'N', '顯示根數', 16, 60, 2, ' 根') + fxRg(C, 'spd', '動畫速度', 0.5, 2, 0.1, '×') + `<div>${fxCk(C, 'still', '靜態模式（不播放動畫，只更新數字，最省電）')}</div>`, C)
    + '<div style="text-align:right;margin-top:4px"><button type="button" class="btn sm" data-rall>全部回預設</button></div>';
  const ok = await dialog('即時 K 棒設定', `<div style="position:sticky;top:-18px;z-index:3;background:var(--card);padding:2px 0 4px"><div style="position:relative;height:220px;border-radius:10px;overflow:hidden"><canvas id="kxPv" style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas></div>
    <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px"><span class="small muted" style="align-self:center;margin-right:auto">預覽為示範資料</span><button type="button" class="btn sm" id="kxB">模擬大單</button><button type="button" class="btn sm" id="kxK">模擬突破</button></div></div><div id="kxF"></div>`, [['', '取消'], ['ok', '儲存', 'primary']], (root) => {
    const F = $('#kxF', root), dm = kfxDemo(4321); let bias = 0;
    st = kfxNew($('#kxPv', root), dm.cs, { sym: '', levels: [{ v: dm.qz(dm.cs[dm.cs.length - 1].c + 0.25), label: '上關' }], pb: dm.T }); st.cfg = C; st.live = true;
    st.feed = (now) => { if (!document.body.contains(root)) { KFX.list.delete(st); return; } st.cfg = C; if (st.sty.k !== C.sty) { st.sty = kfxSty(C.sty); st.pp = null; st.dirty = true; }
      acc += 16; if (acc < 500 / 1) return; acc = 0; const b = st.cs[st.cs.length - 1]; let d = (dm.r() - 0.5) * 2.2; if (bias > 0) { d = Math.abs(d) + 0.8; bias--; }
      const np = dm.qz(b.c + (dm.r() < 0.3 ? 0 : Math.round(d)) * dm.T); const big = st._big; st._big = false; const v = (12 + dm.r() * 40) * (big ? 9 : 1);
      if (++n >= 16) { n = 0; } kfxTick(st, np, v, now, n === 0 ? b.t + 300000 : b.t, big);
      const L = st.o.levels[0]; if (L.v - np > 0.8 || L.v <= np - 0.4) L.v = dm.qz(np + 0.3); };
    const redraw = () => { F.innerHTML = form(); fxBind(F, () => C, OPEN, RS, KFX_DEF, redraw, () => { st.dirty = true; });
      $$('[data-rall]', F).forEach((x) => x.onclick = () => { Object.assign(C, KFX_DEF); redraw(); }); st.dirty = true; };
    $('#kxB', root).onclick = () => { st._big = true; };
    $('#kxK', root).onclick = () => { const b = st.cs[st.cs.length - 1]; st.o.levels[0].v = dm.qz(b.c + 0.2); bias = 10; };
    redraw(); KFX.list.add(st); kfxRun();
  });
  if (st) KFX.list.delete(st);
  if (ok !== 'ok') return false;
  S.pref.kfx = { ...C }; savePref(); toast('已儲存即時 K 棒設定'); return true;
}
const OV_CARDS = [['tiles', '資產摘要', 2], ['trend', '資產走勢', 1], ['focus', '今日焦點', 1], ['alloc', '資產配置', 1], ['events', '近期行事', 1], ['movers', '持股今日漲跌', 1],
  ['watch', '自選行情牆', 2], ['divs', '持股除權息', 2], ['cal', '損益日曆', 2], ['mkt', '大盤摘要', 1], ['news', '持股新聞', 1], ['star', '雙極星團雷達（多空排行）', 2], ['odd', '零股價差排行', 1]];
const OV_DEFAULT_HIDDEN = ['watch', 'mkt', 'news'];
function ovLayout() {
  const order = (S.pref.ovOrder || []).filter((k) => OV_CARDS.some((c) => c[0] === k));
  if (order.length && !order.includes('star')) order.splice(Math.min(2, order.length), 0, 'star'); // 新卡片：與 App 相同放第三張
  OV_CARDS.forEach(([k]) => { if (!order.includes(k)) order.push(k); });
  const hidden = new Set(S.pref.ovHidden || OV_DEFAULT_HIDDEN); const width = S.pref.ovWidth || {};
  return order.map((k) => { const c = OV_CARDS.find((x) => x[0] === k); return { k, n: c[1], w: width[k] || c[2], on: !hidden.has(k) }; });
}
VIEWS[''] = {
  title: '總覽',
  render() { return head('總覽', `<span class="small muted syncst"></span><a class="btn sm" href="#/settings" title="調整總覽卡片">⚙ 版面</a>`) + (S.pref.ovTicker === false ? '' : '<div id="tk"></div>') + '<div id="dyn"></div>'; },
  async fill() {
    if ($('#tk')) $('#tk').innerHTML = tickerHtml();
    const P = portfolio(); const fx = usdTwd(); const m = member();
    const total = P.mv + P.cash - P.debt; const div = P.divTw + P.divUs * fx;
    const has = D.trades().length || D.quotes().length || holdings().length;
    let top = '';
    if (!has) top += `<div class="notice" style="margin-bottom:12px">網頁還沒有資料。請在手機 App「會員與授權 › 會員帳號」開啟「手機⇄網頁資料同步」，或直接在「行情」「交易」頁新增。</div>`;
    if (m.status === 'GRACE' || m.locked || (m.status === 'MEMBER' && m.left != null && m.left <= S.policy.remind) || (m.status === 'TRIAL' && !m.freeRun && m.left <= 2))
      top += `<div class="notice ${m.locked || m.status === 'GRACE' ? 'err' : ''}" style="margin-bottom:12px">${badge(m)} ${esc(stateLine(m))}　<a href="#/member">${m.status === 'TRIAL' || m.status === 'FREE' ? '升級' : '續約'} ›</a></div>`;
    const nav = kjson('nav', {}), mvc = kjson('mvCost', {});
    const days = Object.keys(nav).sort();
    const rg = S.pref.navR || '3M'; const cut = { '1M': 31, '3M': 92, '1Y': 366, ALL: 1e6 }[rg];
    const from = (() => { const d = tpeNow(); d.setDate(d.getDate() - cut); return d.toISOString().slice(0, 10); })();
    const ds = days.filter((d) => rg === 'ALL' || d >= from);
    const plans = (await kv('sx:plans')) || {};
    const C = {};
    C.tiles = () => `<div class="grid g3">
      <div class="tile"><div class="k">總資產（台幣）</div><div class="v num">${fmtInt(total)}</div><div class="s muted">市值 ${fmtInt(P.mv)} ＋ 現金 ${fmtInt(P.cash)}${P.margin > 0 ? ' − 融資 ' + fmtInt(P.margin) : ''}${P.shorts.length ? ' ＋ 放空 ' + fmtInt(P.shortEq) : ''}</div></div>
      <div class="tile"><div class="k">今日損益</div><div class="v num ${cls(P.day)}">${fmtSigned(P.day)}</div><div class="s num ${cls(P.day)}">${fmtPct(P.mv - P.day > 0 ? P.day / (P.mv - P.day) * 100 : 0)}</div></div>
      <div class="tile"><div class="k">未實現損益</div><div class="v num ${cls(P.pl)}">${fmtSigned(P.pl)}</div><div class="s num ${cls(P.pl)}">${fmtPct(P.cost > 0 ? P.pl / P.cost * 100 : 0)}</div></div>
      <div class="tile"><div class="k">今年已實現</div><div class="v num ${cls(P.realized)}">${fmtSigned(P.realized)}</div></div>
      <div class="tile"><div class="k">今年股息</div><div class="v num">${fmtInt(div)}</div></div>
      <div class="tile"><div class="k">持股檔數</div><div class="v num">${P.rows.length}</div><div class="s muted">美元匯率 ${fmt(fx, 3)}</div></div></div>`;
    C.trend = () => `<div class="card"><h2>資產走勢<span class="r"><span class="seg" id="navR">${['1M', '3M', '1Y', 'ALL'].map((k) => `<button data-nr="${k}" class="${rg === k ? 'on' : ''}">${k === 'ALL' ? '全部' : k.replace('M', ' 月').replace('Y', ' 年')}</button>`).join('')}</span></span></h2>
      ${ds.length >= 2 ? `<div class="chart-wrap" id="navC"><canvas></canvas><div class="chart-tip"></div></div>
        <div class="small muted">${esc(ds[0])} 起 <span class="num ${cls(nav[ds[ds.length - 1]] - nav[ds[0]])}">${fmtSigned(nav[ds[ds.length - 1]] - nav[ds[0]])}（${fmtPct((nav[ds[ds.length - 1]] / nav[ds[0]] - 1) * 100)}）</span>，含入出金</div>`
        : '<div class="muted small" style="padding:30px 0;text-align:center">尚無資產紀錄。手機 App 每天會自動記錄總資產，同步後即可在這裡看到走勢。</div>'}</div>`;
    C.focus = () => {
      const focus = [];
      P.rows.filter((r) => r.lu || r.ld).forEach((r) => focus.push([r.lu ? '🔥' : '🧊', `${r.name} ${r.lu ? '漲停' : '跌停'}`, '#/s/' + r.symbol, r.lu ? 'up' : 'down']));
      P.rows.filter((r) => !r.lu && !r.ld && Math.abs(r.pct) >= 3).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 4).forEach((r) => focus.push([r.pct > 0 ? '📈' : '📉', `${r.name} ${fmtPct(r.pct)}，今日 ${fmtSigned(r.day)}`, '#/s/' + r.symbol, cls(r.pct)]));
      const in7 = (() => { const d = tpeNow(); d.setDate(d.getDate() + 7); return ymd(d); })();
      P.rows.forEach((r) => { const p = plans[r.symbol]; if (p && p.ex >= ymd() && p.ex <= in7) focus.push(['💰', `${r.name} ${p.ex.slice(5)} 除息${p.cash ? '，預估 ' + fmtInt(p.cash * r.shares) + ' 元' : ''}`, '#/div', '']); });
      kjson('alertsV2', []).filter((a) => a.on !== false && a.s && (a.t === 'PRICE_ABOVE' || a.t === 'PRICE_BELOW')).forEach((a) => { const q = S.q[a.s]; if (!q || !q.price) return; const gap = (a.v / q.price - 1) * 100;
        if (Math.abs(gap) <= 2) focus.push(['🔔', `${D.name(a.s)} 距提醒價 ${fmt(a.v, 2)} 僅 ${Math.abs(gap).toFixed(1)}%`, '#/alerts', '']); });
      return `<div class="card"><h2>今日焦點</h2>${focus.length ? `<div class="list">${focus.slice(0, 8).map(([ic, t, go, c]) => `<div class="it" data-go="${go}"><span style="font-size:18px">${ic}</span><div class="l"><div class="t1 ${c}" style="white-space:normal">${esc(t)}</div></div><span class="muted">›</span></div>`).join('')}</div>` : '<div class="muted small" style="padding:20px 0;text-align:center">持股今天沒有特別的變化。</div>'}</div>`;
    };
    C.alloc = () => {
      if (!can('ANALYSIS')) return lockCard('ANALYSIS', '資產配置（投資分析工具）');
      const COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#22c55e', '#ef4444', '#14b8a6', '#ec4899', '#64748b', '#eab308'];
      const tops = P.rows.slice().sort((a, b) => b.mv - a.mv); const main = tops.slice(0, 8); const rest = tops.slice(8).reduce((a, r) => a + r.weight, 0);
      const segs = main.map((r, i) => [r.name, r.weight, COLORS[i]]).concat(rest > 0 ? [['其他', rest, COLORS[8]]] : []);
      const twMv = P.rows.filter((r) => !r.us).reduce((a, r) => a + r.mv, 0);
      return `<div class="card"><h2>資產配置<a class="r" href="#/analysis">分析 ›</a></h2><div class="bar">${segs.map(([, w, c]) => `<div style="width:${w}%;background:${c}"></div>`).join('')}</div>
        <div class="legend">${segs.map(([n, w, c]) => `<span><i style="background:${c}"></i>${esc(n)} ${w.toFixed(1)}%</span>`).join('')}</div>
        <div class="row small" style="margin-top:12px"><span>台股 ${P.mv ? (twMv / P.mv * 100).toFixed(1) : 0}%</span><span>美股 ${P.mv ? ((P.mv - twMv) / P.mv * 100).toFixed(1) : 0}%</span><span class="sp"></span><span class="muted">現金占總資產 ${total ? (P.cash / total * 100).toFixed(1) : 0}%</span></div></div>`;
    };
    C.movers = () => { const mv = P.rows.slice().sort((a, b) => b.pct - a.pct);
      return `<div class="card"><h2>持股今日漲跌<a class="r" href="#/hold">全部 ›</a></h2><div class="list">${mv.length ? mv.slice(0, 8).map((r) => `<div class="it" data-go="#/s/${r.symbol}">
        <div class="l"><div class="t1">${esc(r.name)} <span class="muted small num">${r.symbol}</span></div><div class="t2">市值 ${fmtInt(r.mv)} · 今日 <span class="${cls(r.day)}">${fmtSigned(r.day)}</span></div></div>
        <div class="r"><div class="num ${cls(r.chg)}">${fmtPrice(r.price)}</div><div class="num small ${cls(r.chg)}">${fmtPct(r.pct)}</div></div></div>`).join('') : '<div class="empty">尚無持股</div>'}</div></div>`; };
    C.watch = () => { const syms = D.quotes().map((q) => q.s).slice(0, 12);
      return `<div class="card"><h2>自選行情<a class="r" href="#/watch">全部 ›</a></h2>${syms.length ? (can('WALL') ? `<div class="wall">${syms.map((x) => wallTile(x, false)).join('')}</div>` : heatHtml(syms)) : '<div class="muted small">尚無自選。</div>'}</div>`; };
    C.divs = () => {
      if (!can('DIVTAX')) return lockCard('DIVTAX', '持股除權息（股息與稅務）');
      const today = ymd(); const list = P.rows.map((r) => [r, plans[r.symbol]]).filter(([, p]) => p && p.ex >= today).sort((a, b) => a[1].ex.localeCompare(b[1].ex));
      return `<div class="card"><h2>持股除權息<a class="r" href="#/div">股息 ›</a></h2>${list.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>個股</th><th>除息日</th><th>最後買進</th><th>發放日</th><th>現金股利</th><th>預估入帳</th></tr></thead><tbody>${list.map(([r, p]) =>
        `<tr class="click" data-go="#/s/${r.symbol}"><td class="nm">${esc(r.name)} <span class="muted small">${r.symbol}</span></td><td>${p.ex}</td><td>${p.lb || '—'}</td><td>${p.pay || '—'}</td><td class="num">${p.cash ? fmt(p.cash, 4) : '—'}</td><td class="num">${p.cash ? fmtInt(p.cash * r.shares) : '—'}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="muted small">近期沒有持股除權息。</div>'}</div>`;
    };
    C.cal = () => {
      const ph = kjson('pnlHist', {}); if (!Object.keys(ph).length) return '';
      if (!can('ANALYSIS')) return lockCard('ANALYSIS', '損益日曆（投資分析工具）');
      const mon = S.pref.calM || tpeNow().toISOString().slice(0, 7); const [yy, mm] = mon.split('-').map(Number);
      const first = new Date(Date.UTC(yy, mm - 1, 1)); const nd = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); const lead = first.getUTCDay();
      const vals = Array.from({ length: nd }, (_, i) => ph[mon + '-' + String(i + 1).padStart(2, '0')]); const mx = Math.max(1, ...vals.filter((v) => v != null).map(Math.abs));
      const sum = vals.reduce((a, v) => a + (v || 0), 0);
      return `<div class="card"><h2>損益日曆<span class="r row"><button class="btn sm" data-cm="-1">‹</button><b>${yy} 年 ${mm} 月</b><button class="btn sm" data-cm="1">›</button><span class="num ${cls(sum)}">${fmtSigned(sum)}</span></span></h2>
        <div class="cal">${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<div class="w">${w}</div>`).join('')}${'<div></div>'.repeat(lead)}${vals.map((v, i) => `<div class="d" style="background:${v ? `color-mix(in srgb, ${css(v > 0 ? '--up' : '--down')} ${Math.round(12 + Math.abs(v) / mx * 60)}%, var(--card2))` : 'var(--card2)'}"><div class="dn">${i + 1}</div><div class="num">${v != null ? fmtSigned(v) : ''}</div></div>`).join('')}</div></div>`;
    };
    C.mkt = () => '<div class="card" id="ovMkt"><h2>大盤摘要<a class="r" href="#/market">市場 ›</a></h2><div class="muted small">載入中…</div></div>';
    C.news = () => '<div class="card" id="ovNews"><h2>持股新聞</h2><div class="muted small">載入中…</div></div>';
    C.star = () => (can('KLINE') ? '<div id="ovStar"></div>' : lockCard('KLINE', '雙極星團雷達'));
    C.odd = () => '<div id="ovOdd"></div>';
    C.events = () => '<div class="card" id="ovEv"><h2>近期行事<a class="r" href="#/calendar">行事曆 ›</a></h2><div class="muted small">載入中…</div></div>';
    const cards = ovLayout().filter((c) => c.on).map((c) => { const html = C[c.k](); return html ? `<div class="${c.w === 2 ? 'span2' : ''}">${html}</div>` : ''; }).join('');
    $('#dyn').innerHTML = top + `<div class="dash">${cards}</div>`; renderSync(); starMount(); oddMount();
    $$('[data-nr]').forEach((b) => b.onclick = () => { S.pref.navR = b.dataset.nr; savePref(); this.fill(); });
    $$('[data-cm]').forEach((b) => b.onclick = () => { const [y0, m0] = (S.pref.calM || tpeNow().toISOString().slice(0, 7)).split('-').map(Number); const d = new Date(Date.UTC(y0, m0 - 1 + Number(b.dataset.cm), 1)); S.pref.calM = d.toISOString().slice(0, 7); savePref(); this.fill(); });
    if ($('#navC')) {
      const cost = ds.map((d) => (mvc[d] ? mvc[d][1] : null));
      drawSeries($('#navC'), ds, [{ v: ds.map((d) => nav[d]), color: '#3b82f6', name: '總資產', fill: true }].concat(cost.some((v) => v != null) ? [{ v: cost, color: '#f59e0b', name: '投入成本' }] : []), { h: 220 });
    }
    if ($('#ovMkt')) kv('sx:mkt').then((mk) => { const el = $('#ovMkt'); if (!el) return; el.innerHTML = '<h2>大盤摘要<a class="r" href="#/market">市場 ›</a></h2>' + (mk ? `<div class="grid g2">
      <div><div class="small muted">加權指數（${esc(mk.d)}）</div><div class="num big ${cls(mk.ixc)}">${fmt(mk.ix, 2)}</div><div class="num small ${cls(mk.ixc)}">${fmtSigned(mk.ixc, 2)}（${fmtPct(mk.ixp)}）</div></div>
      <div><div class="small muted">漲／跌／平</div><div class="num big"><span class="up">${mk.u}</span>／<span class="down">${mk.dn}</span>／${mk.f}</div><div class="small muted">成交 ${fmt(mk.tv, 0)} 億${mk.inst ? `　外資 <span class="${cls(mk.fy)}">${fmtSigned(mk.fy, 1)}</span> 億` : ''}</div></div></div>` : '<div class="muted small">尚無盤後摘要。</div>'); });
    if ($('#ovEv')) upcomingEvents(14).then((l) => { const el = $('#ovEv'); if (!el) return; el.innerHTML = '<h2>近期行事<a class="r" href="#/calendar">行事曆 ›</a></h2>' + (l.length ? `<div class="list">${l.slice(0, 8).map(([d, t, go, amt]) => `<div class="it" data-go="${go}"><span class="tag">${d.slice(5)}</span><div class="l"><div class="t1" style="white-space:normal">${esc(t)}</div></div>${amt ? `<span class="num small">${fmtInt(amt)}</span>` : ''}</div>`).join('')}</div>` : '<div class="small muted">未來兩週沒有持股相關事件。</div>'); });
    if ($('#ovNews') && !this._newsBusy) { this._newsBusy = true; this.ovNews().finally(() => { this._newsBusy = false; }); }
  },
  async ovNews() {
    const el0 = $('#ovNews'); if (!el0) return;
    if (!can('NEWS')) { el0.innerHTML = lockCard('NEWS'); return; }
    if (!this._news || Date.now() - this._newsAt > 900000) {
      const syms = holdings().slice().sort((a, b) => b.shares * b.avgCost - a.shares * a.avgCost).slice(0, 4).map((h) => h.symbol);
      const all = [];
      await Promise.all(syms.map(async (s) => { try { const url = isUs(s) ? 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=' + encodeURIComponent(s) + '&region=US&lang=en-US' : 'https://tw.stock.yahoo.com/rss?s=' + encodeURIComponent(s);
        const xml = new DOMParser().parseFromString(await px(url, 900, 'text'), 'text/xml');
        $$('item', xml).slice(0, 4).forEach((it) => all.push({ s, t: (it.querySelector('title') || {}).textContent || '', l: (it.querySelector('link') || {}).textContent || '', d: Date.parse((it.querySelector('pubDate') || {}).textContent || '') || 0 })); } catch (e) {} }));
      this._news = all.sort((a, b) => b.d - a.d).slice(0, 8); this._newsAt = Date.now();
    }
    const el = $('#ovNews'); if (!el) return;
    el.innerHTML = '<h2>持股新聞</h2>' + (this._news.length ? `<div class="list">${this._news.map((n) => `<a class="it" href="${esc(n.l)}" target="_blank" rel="noopener" style="color:inherit"><span class="tag">${esc(D.name(n.s))}</span><div class="l"><div class="t1" style="white-space:normal">${esc(n.t)}</div><div class="t2">${n.d ? new Date(n.d).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div></div></a>`).join('')}</div>` : '<div class="muted small">目前沒有新聞。</div>');
  },
  syms() { const s = holdings().map((h) => h.symbol); if (ovLayout().some((c) => c.k === 'watch' && c.on)) s.push(...D.quotes().map((q) => q.s).slice(0, 12)); return s; },
};

// ───────── 自選行情 ─────────
function watchSyms(group) {
  const qs = D.quotes(); const st = new Set(D.starred());
  if (group === 'tw') return qs.filter((q) => !isUs(q.s)).map((q) => q.s);
  if (group === 'us') return qs.filter((q) => isUs(q.s)).map((q) => q.s);
  if (group === 'etf') return qs.filter((q) => q.etf || /^00/.test(q.s)).map((q) => q.s);
  if (group === 'star') return qs.filter((q) => st.has(q.s)).map((q) => q.s);
  const g = D.groups().find((x) => String(x.id) === String(group)); if (g) return (g.s || []).filter((s) => qs.some((q) => q.s === s));
  return qs.map((q) => q.s);
}
function wallTile(sym, removable) {
  const wh = new Set(S.pref.wallHide || []);
  const q = S.q[sym] || {}; const us = isUs(sym); const ch = q.price && q.prev ? q.price - q.prev : 0; const pc = q.prev ? ch / q.prev * 100 : 0;
  const h = holdings().find((x) => x.symbol === sym); const fx = us ? usdTwd() : 1;
  const c = cls(ch);
  const hold = h ? (() => { const mv = h.shares * (q.price || h.avgCost) * fx; const cost = h.shares * h.avgCost * (us ? (h.avgFx || fx) : 1); const pl = mv - cost;
    return `<div class="ex">${fmt(h.shares, 0)} 股 · 均 ${fmtPrice(h.avgCost, us)}</div><div class="ex r ${cls(pl)}">${fmtSigned(pl)}</div>`; })() : '';
  return `<div class="wt ${ch > 0 ? 'upb' : ch < 0 ? 'downb' : ''} ${q.lu ? 'lu' : q.ld ? 'ld' : ''}" data-go="#/s/${sym}">
    <div class="hd"><span class="nm">${esc(D.name(sym))}</span>${wh.has('mkt') ? '' : `<span class="mkt ${us ? 'us' : ''}">${us ? 'US' : 'TW'}</span>`}<span class="cd">${sym}</span></div>
    <div class="bd"><div class="px num ${c}">${fmtPrice(q.price, us)}${q.lu ? ' <span class="tag up" style="font-size:11px">漲停</span>' : q.ld ? ' <span class="tag down" style="font-size:11px">跌停</span>' : ''}</div>${us ? extHtml(q) : ''}
      <div class="ch num ${c}">${arrow(ch)} ${q.price ? fmt(Math.abs(ch), 2) : ''}</div><div class="pc num ${c}">${q.price ? fmtPct(pc) : ''}</div>
      ${wh.has('spark') ? '' : sparkSvg(q.spark, css(ch >= 0 ? '--up' : '--down'))}
      ${wh.has('vol') ? '' : `<div class="ex">量 ${q.volLots != null ? fmtInt(q.volLots) + ' 張' : fmtVol(q.vol)}</div><div class="ex r">${q.high ? '高 ' + fmtPrice(q.high) + ' 低 ' + fmtPrice(q.low) : ''}</div>`}${wh.has('hold') ? '' : hold}</div>
    ${removable ? `<button class="btn sm x" data-rm="${sym}" title="移除">✕</button>` : ''}</div>`;
}
VIEWS.watch = {
  title: '自選行情',
  render() {
    const groups = [['all', '全部'], ['tw', '台股'], ['us', '美股'], ['etf', 'ETF'], ['star', '最愛']].concat(D.groups().map((g) => [String(g.id), g.n]));
    if (!groups.some((g) => g[0] === S.pref.group)) S.pref.group = 'all';
    return head('自選行情', `<div class="search" style="width:min(320px,100%)"><input id="add" placeholder="新增：代號或名稱（2330、台積電、AAPL）" autocomplete="off"><div class="res hide"></div></div>`) +
      '<div id="tk"></div>' +
      `<div class="row wrap" style="margin-bottom:12px"><div class="chips" style="flex:1">${groups.map(([k, n]) => `<button class="chip ${S.pref.group === k ? 'on' : ''}" data-g="${k}">${esc(n)}</button>`).join('')}</div>
      <select id="wsort" style="width:auto" title="排序">${[['', '自訂順序（可拖曳）'], ['pct', '漲幅大到小'], ['-pct', '跌幅大到小'], ['vol', '成交量'], ['code', '代號']].map(([k, n]) => `<option value="${k}" ${(S.pref.wsort || '') === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn sm" id="gmb">群組</button>
      <div class="seg"><button data-l="wall" class="${S.pref.layout === 'wall' ? 'on' : ''}">行情牆</button><button data-l="list" class="${S.pref.layout === 'list' ? 'on' : ''}">清單</button><button data-l="heat" class="${S.pref.layout === 'heat' ? 'on' : ''}">熱度圖</button></div></div><div id="dyn"></div>`;
  },
  bind() {
    $$('[data-g]').forEach((b) => b.onclick = () => { S.pref.group = b.dataset.g; savePref(); route(); });
    $$('[data-l]').forEach((b) => b.onclick = () => { S.pref.layout = b.dataset.l; savePref(); route(); });
    bindSearch($('#add'), (sym, name) => addWatch(sym, name));
    $('#gmb').onclick = () => groupManager();
    $('#wsort').onchange = (e) => { S.pref.wsort = e.target.value; savePref(); this.fill(); };
  },
  fill() {
    $('#tk').innerHTML = tickerHtml();
    let syms = watchSyms(S.pref.group); const ws = S.pref.wsort || '';
    if (ws) { const pc = (s) => { const q = S.q[s] || {}; return q.price && q.prev ? (q.price / q.prev - 1) * 100 : null; }; const amt = (s) => { const q = S.q[s] || {}; return (q.vol || 0) * (q.price || 0) * (isUs(s) ? usdTwd() : 1); };
      const cmp = { pct: (a, b) => (pc(b) ?? -1e9) - (pc(a) ?? -1e9), '-pct': (a, b) => (pc(a) ?? 1e9) - (pc(b) ?? 1e9), vol: (a, b) => amt(b) - amt(a), code: (a, b) => a.localeCompare(b) }[ws];
      if (cmp) syms = syms.slice().sort(cmp); }
    let h = '';
    if (!syms.length) h = '<div class="card empty">這個分類還沒有自選股，用右上角搜尋新增。</div>';
    else if (S.pref.layout === 'wall' && can('WALL')) h = `<div class="wall">${syms.map((s) => wallTile(s, true)).join('')}</div>`;
    else if (S.pref.layout === 'heat' && can('WALL')) h = heatHtml(syms);
    else {
      if (S.pref.layout !== 'list') h += `<div class="notice" style="margin-bottom:10px">🔒 行情牆與熱度圖為會員功能（${esc(FEATURES[3][1])}），已改用清單顯示。<a href="#/member">查看方案 ›</a></div>`;
      h += `<div class="card list m-only" style="padding:4px 12px">${syms.map((s) => { const q = S.q[s] || {}; const ch = q.price && q.prev ? q.price - q.prev : 0;
        return `<div class="it" data-go="#/s/${s}"><div class="l"><div class="t1">${esc(D.name(s))} <span class="muted small num">${s}</span>${q.lu ? ' <span class="tag up">漲停</span>' : q.ld ? ' <span class="tag down">跌停</span>' : ''}</div><div class="t2">量 ${q.volLots != null ? fmtInt(q.volLots) + ' 張' : fmtVol(q.vol)}</div></div>
          <div class="r"><div class="num ${cls(ch)}">${fmtPrice(q.price)}</div><div class="num small ${cls(ch)}">${q.prev ? arrow(ch) + fmt(Math.abs(ch), 2) + ' ' + fmtPct(ch / q.prev * 100) : '—'}</div>${isUs(s) ? extMini(q) : ''}</div></div>`; }).join('')}</div>`;
      h += `<div class="card scroll-x d-only" style="padding:6px 8px"><table class="tbl"><thead><tr><th>個股</th><th>成交</th><th>漲跌</th><th>漲跌幅</th><th>成交量</th><th>最高</th><th>最低</th><th></th></tr></thead><tbody>${syms.map((s) => {
        const q = S.q[s] || {}; const us = isUs(s); const ch = q.price && q.prev ? q.price - q.prev : 0;
        return `<tr class="click" data-go="#/s/${s}"><td class="nm">${esc(D.name(s))} <span class="muted small num">${s}</span>${q.lu ? ' <span class="tag up">漲停</span>' : q.ld ? ' <span class="tag down">跌停</span>' : ''}</td>
          <td class="num ${cls(ch)}">${fmtPrice(q.price, us)}${us ? extMini(q) : ''}</td><td class="num ${cls(ch)}">${q.price ? arrow(ch) + fmt(Math.abs(ch), 2) : '—'}</td><td class="num ${cls(ch)}">${q.prev ? fmtPct(ch / q.prev * 100) : '—'}</td>
          <td class="num">${q.volLots != null ? fmtInt(q.volLots) + ' 張' : fmtVol(q.vol)}</td><td class="num">${fmtPrice(q.high, us)}</td><td class="num">${fmtPrice(q.low, us)}</td>
          <td><button class="btn sm" data-rm="${s}" title="移除">✕</button></td></tr>`;
      }).join('')}</tbody></table></div>`;
    }
    $('#dyn').innerHTML = h;
    $$('[data-rm]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); removeWatch(b.dataset.rm); });
    bindDrag($('#dyn'), S.pref.group, () => this.fill());
    if (S.pref.layout === 'wall') syms.filter((s) => !isUs(s) && !(S.q[s] && S.q[s].spark)).slice(0, 40).forEach((s) => sparkTw(s).then(() => { const el = $(`.wt[data-go="#/s/${s}"]`); if (el && S.route === 'watch') { el.outerHTML = wallTile(s, true); bindDrag($('#dyn'), S.pref.group, () => this.fill()); } }));
  },
  syms() { return watchSyms(S.pref.group); },
};
/** 熱度圖：依漲跌幅上色；weights 有值時依權重決定大小（持股） */
function heatHtml(syms, weights) {
  const UP = css('--up'), DN = css('--down');
  return `<div class="heat">${syms.map((s) => {
    const q = S.q[s] || {}; const pc = q.price && q.prev ? (q.price / q.prev - 1) * 100 : 0;
    const a = Math.min(1, Math.abs(pc) / 7) * 0.85 + (pc ? 0.15 : 0);
    const bg = pc === 0 ? 'var(--card2)' : `color-mix(in srgb, ${pc > 0 ? UP : DN} ${Math.round(a * 100)}%, var(--card))`;
    const w = weights ? Math.max(110, Math.sqrt(weights[s] || 0) * 70) : 0;
    return `<div class="ht" data-go="#/s/${s}" style="background:${bg};${w ? `flex:${(weights[s] || 0.5).toFixed(2)} 1 ${w}px;min-height:${Math.min(160, 60 + w / 4)}px` : ''}">
      <div class="n">${esc(D.name(s))}</div><div class="c num">${s}</div><div class="p num">${q.price ? fmtPct(pc) : '—'}</div><div class="c num">${fmtPrice(q.price)}</div></div>`;
  }).join('')}</div>`;
}
async function groupManager() {
  const html = () => `<div class="list">${D.groups().map((g) => `<div class="it" style="cursor:default"><div class="l"><div class="t1">${esc(g.n)}</div><div class="t2">${(g.s || []).length} 檔</div></div>
    <button class="btn sm" data-rn="${g.id}">改名</button><button class="btn sm danger" data-del="${g.id}">刪除</button></div>`).join('') || '<div class="empty">還沒有群組</div>'}</div>
    <div class="row" style="margin-top:12px"><input id="gn" placeholder="新群組名稱"><button class="btn primary" id="gadd">新增</button></div>`;
  await dialog('管理自選群組', '<div id="gm">' + html() + '</div>', [['', '完成']], (root) => {
    const refresh = () => { $('#gm', root).innerHTML = html(); wire(); };
    const wire = () => {
      $('#gadd', root).onclick = () => { const n = $('#gn', root).value.trim(); if (!n) return; const gs = D.groups(); gs.push({ id: Math.max(0, ...gs.map((g) => +g.id || 0)) + 1, n, s: [] }); ksetJson('groups', gs); changed(); refresh(); };
      $$('[data-rn]', root).forEach((b) => b.onclick = () => { const n = prompt('新名稱', D.groups().find((g) => String(g.id) === b.dataset.rn).n); if (!n) return; ksetJson('groups', D.groups().map((g) => String(g.id) === b.dataset.rn ? { ...g, n: n.trim() } : g)); changed(); refresh(); });
      $$('[data-del]', root).forEach((b) => b.onclick = () => { if (!confirm('刪除這個群組？（自選股不會被刪除）')) return; ksetJson('groups', D.groups().filter((g) => String(g.id) !== b.dataset.del)); changed(); refresh(); });
    };
    wire();
  });
  route();
}
function toggleStar(sym) {
  const st = D.starred(); const on = st.includes(sym);
  kset('starred', (on ? st.filter((x) => x !== sym) : st.concat([sym])).join(','), 's'); changed(); return !on;
}
function setGroup(sym, gid, on) {
  ksetJson('groups', D.groups().map((g) => String(g.id) !== String(gid) ? g : { ...g, s: on ? Array.from(new Set((g.s || []).concat([sym]))) : (g.s || []).filter((x) => x !== sym) }));
  if (on && !D.quotes().some((q) => q.s === sym)) { const qs = D.quotes(); qs.push({ s: sym, n: D.name(sym), m: isUs(sym) ? 'US' : 'TW', etf: /^00/.test(sym) }); ksetJson('quotes', qs); }
  changed();
}
/** 自選拖曳排序：全部／台股／美股／ETF 改整體順序，自訂群組改群組內順序（與手機同步） */
function moveWatch(src, dst, group) {
  if (!src || !dst || src === dst) return;
  const g = D.groups().find((x) => String(x.id) === String(group));
  if (g) { const arr = (g.s || []).filter((x) => x !== src); const i = arr.indexOf(dst); arr.splice(i < 0 ? arr.length : i, 0, src); ksetJson('groups', D.groups().map((x) => (x === g || String(x.id) === String(g.id) ? { ...x, s: arr } : x))); }
  else { const qs = D.quotes(); const it = qs.find((q) => q.s === src); if (!it) return; const rest = qs.filter((q) => q.s !== src); const i = rest.findIndex((q) => q.s === dst); rest.splice(i < 0 ? rest.length : i, 0, it); ksetJson('quotes', rest); }
  changed();
}
function bindDrag(root, group, after) {
  if (!root || (S.pref.wsort || '') || group === 'star') return;
  let src = null;
  $$('.wt[data-go], tr[data-go], .it[data-go]', root).forEach((el) => {
    const sym = decodeURIComponent(el.dataset.go.replace('#/s/', '')); el.draggable = true; el.dataset.sym = sym;
    el.ondragstart = (e) => { src = sym; S.dragging = true; el.style.opacity = '0.4'; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sym); } catch (x) {} };
    el.ondragend = () => { S.dragging = false; el.style.opacity = ''; $$('.drop-hint', root).forEach((x) => x.classList.remove('drop-hint')); };
    el.ondragover = (e) => { if (!src) return; e.preventDefault(); $$('.drop-hint', root).forEach((x) => x !== el && x.classList.remove('drop-hint')); el.classList.add('drop-hint'); };
    el.ondrop = (e) => { e.preventDefault(); S.dragging = false; const s0 = src; src = null; moveWatch(s0, sym, group); after(); };
  });
}
function addWatch(sym, name) {
  const qs = D.quotes();
  if (qs.some((q) => q.s === sym)) { toast(sym + ' 已在自選'); return; }
  qs.push({ s: sym, n: name || D.name(sym), m: isUs(sym) ? 'US' : 'TW', etf: /^00/.test(sym) });
  ksetJson('quotes', qs); changed(); toast('已加入自選：' + (name || sym)); route();
}
async function removeWatch(sym) {
  if ((await dialog('移除自選', '確定從自選移除 ' + esc(D.name(sym)) + '（' + sym + '）？', [['', '取消'], ['ok', '移除', 'primary']])) !== 'ok') return;
  ksetJson('quotes', D.quotes().filter((q) => q.s !== sym));
  ksetJson('groups', D.groups().map((g) => ({ ...g, s: (g.s || []).filter((x) => x !== sym) })));
  changed(); route();
}
/** 代號搜尋（台股目錄＋美股代號） */
function bindSearch(input, onPick) {
  const box = input.nextElementSibling; let items = [], sel = 0;
  const show = () => { box.classList.toggle('hide', !items.length); box.innerHTML = items.map(([c, n, t], i) => `<div class="${i === sel ? 'sel' : ''}" data-i="${i}"><b class="num">${c}</b><span>${esc(n)}</span><span class="muted small" style="margin-left:auto">${t}</span></div>`).join('');
    $$('[data-i]', box).forEach((d) => d.onmousedown = (e) => { e.preventDefault(); pick(+d.dataset.i); }); };
  const pick = (i) => { const it = items[i]; if (!it) return; input.value = ''; items = []; show(); onPick(it[0], it[1]); };
  input.oninput = async () => {
    const t = input.value.trim(); sel = 0;
    if (!t) { items = []; return show(); }
    const dir = await loadDir(); const up = t.toUpperCase(); const out = [];
    for (const [c, a] of Object.entries(dir)) { if (c.startsWith(up) || (a[0] && a[0].includes(t))) out.push([c, a[0], a[1] === 'o' ? '上櫃' : '上市']); if (out.length >= 12) break; }
    if (/^[A-Z][A-Z.\-]{0,6}$/.test(up) && !out.some((x) => x[0] === up)) out.push([up, '美股 ' + up, '美股']);
    items = out; show();
    if (/^[A-Za-z][A-Za-z .&\-]{1,30}$/.test(t)) { const ys0 = await yahooSearch(t); if (ys0 && ys0.length && input.value.trim() === t) { const have = new Set(ys0.map((y) => y[0])); items = items.filter((x) => !(x[2] === '美股' && x[1] === '美股 ' + x[0])).filter((x) => !have.has(x[0])).concat(ys0).slice(0, 14); show(); } }
  };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); show(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); show(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(sel); e.preventDefault(); }
    else if (e.key === 'Escape') { items = []; show(); }
  };
  input.onblur = () => setTimeout(() => { items = []; show(); }, 150);
}

// ───────── 持股 ─────────
const HOLD_COLS = [['name', '個股'], ['shares', '股數'], ['avgCost', '均價'], ['price', '現價'], ['pct', '今日漲跌'], ['day', '今日損益'], ['vol', '成交量'], ['cost', '成本'], ['mv', '市值'], ['pl', '未實現損益'], ['plPct', '報酬率'], ['weight', '占比']];
const HOLD_DEFAULT_HIDE = ['vol', 'cost'];
VIEWS.hold = {
  title: '持股',
  render() {
    return head('持股', `<button class="btn" id="prt">列印報表</button><button class="btn" id="audit">資產核對</button><button class="btn" data-go="#/trades">交易紀錄</button><button class="btn primary" id="addT">＋ 新增交易</button>`) + '<div id="tk"></div>' +
      `<div class="row wrap" style="margin-bottom:12px"><div class="seg"><button data-hv="table" class="${(S.pref.holdView || 'table') === 'table' ? 'on' : ''}">表格</button><button data-hv="wall" class="${S.pref.holdView === 'wall' ? 'on' : ''}">行情牆</button><button data-hv="heat" class="${S.pref.holdView === 'heat' ? 'on' : ''}">熱度圖</button></div></div><div id="dyn"></div>`;
  },
  bind() {
    $('#addT').onclick = () => tradeModal();
    $('#audit').onclick = () => assetAudit();
    $('#prt').onclick = () => printReport();
    $$('[data-hv]').forEach((b) => b.onclick = () => { S.pref.holdView = b.dataset.hv; savePref(); route(); });
  },
  fill() {
    $('#tk').innerHTML = tickerHtml();
    const P = portfolio(); const key = S.pref.holdSort || 'mv'; const dir = S.pref.holdDir || -1;
    const rows = P.rows.slice().sort((a, b) => (key === 'name' ? a.symbol.localeCompare(b.symbol) : (a[key] || 0) - (b[key] || 0)) * dir);
    let h = `<div class="grid g4" style="margin-bottom:12px">
      <div class="tile"><div class="k">市值</div><div class="v num">${fmtInt(P.mv)}</div></div>
      <div class="tile"><div class="k">今日損益</div><div class="v num ${cls(P.day)}">${fmtSigned(P.day)}</div></div>
      <div class="tile"><div class="k">未實現損益</div><div class="v num ${cls(P.pl)}">${fmtSigned(P.pl)}</div><div class="s num ${cls(P.pl)}">${fmtPct(P.cost ? P.pl / P.cost * 100 : 0)}</div></div>
      <div class="tile"><div class="k">現金</div><div class="v num">${fmtInt(P.cash)}</div>${P.margin > 0 ? `<div class="s muted">融資 ${fmtInt(P.margin)}</div>` : ''}</div></div>`;
    const ex = rows.filter((r) => isUs(r.symbol) && (S.q[r.symbol] || {}).ext && S.q[r.symbol].ext.price && r.price);
    if (ex.length) { const lb = S.q[ex[0].symbol].ext.label; const fx = usdTwd(); const dv = ex.reduce((a, r) => a + (S.q[r.symbol].ext.price - r.price) * r.shares * fx, 0);
      const base = ex.reduce((a, r) => a + r.price * r.shares * fx, 0);
      h += `<div class="card" style="margin-bottom:12px;border-left:4px solid #E8B04B"><div class="row between wrap" style="align-items:center;gap:8px"><div><b>美股${lb}試算</b> <span class="small muted">${ex.length} 檔有${lb}成交，依${lb}價試算市值變動（台幣）</span></div>
        <div class="num ${cls(dv)}" style="font-size:20px;font-weight:800">${fmtSigned(dv)} <span class="small">${base ? fmtPct(dv / base * 100) : ''}</span></div></div><div style="margin-top:4px">${usSessLine()}</div>
        <div class="small text2" style="margin-top:6px">${ex.slice().sort((a, b) => Math.abs(S.q[b.symbol].ext.pct || 0) - Math.abs(S.q[a.symbol].ext.pct || 0)).slice(0, 6).map((r) => esc(r.name) + ' <span class="num ' + cls(S.q[r.symbol].ext.pct) + '">' + fmtPct(S.q[r.symbol].ext.pct) + '</span>').join('　')}</div>
        <div class="small muted" style="margin-top:4px">試算僅供參考，正式開盤後以盤中成交為準。</div></div>`; }
    if (P.margin > 0) h += `<div style="margin-bottom:12px">${marginCardHtml(P)}</div>`;
    if (P.shorts.length) h += `<div style="margin-bottom:12px">${shortCardHtml(P)}</div>`;
    if (!rows.length) h += '<div class="card empty">尚無持股。按「新增交易」記錄買進，或在手機開啟同步。</div>';
    else if (S.pref.holdView === 'wall' && can('WALL')) h += `<div class="wall">${rows.map((r) => wallTile(r.symbol, false)).join('')}</div>`;
    else if (S.pref.holdView === 'heat' && can('WALL')) h += heatHtml(rows.map((r) => r.symbol), Object.fromEntries(rows.map((r) => [r.symbol, r.weight])));
    else {
      if (S.pref.holdView === 'wall' || S.pref.holdView === 'heat') h += `<div class="notice" style="margin-bottom:10px">🔒 行情牆為會員功能，已改用表格顯示。<a href="#/member">查看方案 ›</a></div>`;
      const hide = new Set(S.pref.holdHide || HOLD_DEFAULT_HIDE); const cols = HOLD_COLS.filter(([k]) => k === 'name' || !hide.has(k));
      const cell = (k, r) => ({ name: `<td class="nm">${esc(r.name)} <span class="muted small num">${r.symbol}</span>${r.lu ? ' <span class="tag up">漲停</span>' : r.ld ? ' <span class="tag down">跌停</span>' : ''}</td>`,
        shares: `<td class="num">${fmt(r.shares, r.shares % 1 ? 2 : 0)}</td>`, avgCost: `<td class="num">${fmtPrice(r.avgCost)}</td>`, price: `<td class="num ${cls(r.chg)}">${fmtPrice(r.price)}${isUs(r.symbol) ? extMini(S.q[r.symbol]) : ''}</td>`,
        pct: `<td class="num ${cls(r.chg)}">${fmtPct(r.pct)}</td>`, day: `<td class="num ${cls(r.day)}">${fmtSigned(r.day)}</td>`, mv: `<td class="num">${fmtInt(r.mv)}</td>`,
        pl: `<td class="num ${cls(r.pl)}">${fmtSigned(r.pl)}</td>`, plPct: `<td class="num ${cls(r.pl)}">${fmtPct(r.plPct)}</td>`, weight: `<td class="num">${r.weight.toFixed(1)}%</td>`,
        cost: `<td class="num">${fmtInt(r.cost)}</td>`, vol: `<td class="num">${r.vol ? fmtVol(r.vol) : '—'}</td>` })[k];
      const foot = { name: `<td>合計 ${rows.length} 檔</td>`, day: `<td class="num ${cls(P.day)}">${fmtSigned(P.day)}</td>`, mv: `<td class="num">${fmtInt(P.mv)}</td>`, cost: `<td class="num">${fmtInt(P.cost)}</td>`,
        pl: `<td class="num ${cls(P.pl)}">${fmtSigned(P.pl)}</td>`, plPct: `<td class="num ${cls(P.pl)}">${fmtPct(P.cost ? P.pl / P.cost * 100 : 0)}</td>`, weight: '<td>100%</td>' };
      h += `<div class="card scroll-x d-only" style="padding:6px 8px"><table class="tbl"><thead><tr>${cols.map(([k, n]) => `<th data-sort="${k}">${n}${key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr class="click" data-go="#/s/${r.symbol}">${cols.map(([k]) => cell(k, r)).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr>${cols.map(([k]) => foot[k] || '<td></td>').join('')}</tr></tfoot></table></div>
        <div class="small muted d-only" style="margin-top:6px">金額為台幣；美股以即時匯率換算。</div>`;
      // 手機：卡片清單
      h += `<div class="card list m-only" style="padding:4px 12px">${rows.map((r) => `<div class="it" data-go="#/s/${r.symbol}"><div class="l"><div class="t1">${esc(r.name)} <span class="muted small num">${r.symbol}</span></div>
        <div class="t2">${fmt(r.shares, r.shares % 1 ? 2 : 0)} 股 · 均 ${fmtPrice(r.avgCost)} · 市值 ${fmtInt(r.mv)}</div><div class="t2">今日 <span class="${cls(r.day)}">${fmtSigned(r.day)}</span> · 占比 ${r.weight.toFixed(1)}%</div></div>
        <div class="r"><div class="num ${cls(r.chg)}">${fmtPrice(r.price)} <span class="small">${fmtPct(r.pct)}</span></div>${isUs(r.symbol) ? extMini(S.q[r.symbol]) : ''}<div class="num ${cls(r.pl)}">${fmtSigned(r.pl)}</div><div class="num small ${cls(r.pl)}">${fmtPct(r.plPct)}</div></div></div>`).join('')}</div>`;
    }
    $('#dyn').innerHTML = h;
    $$('[data-sort]').forEach((th) => th.onclick = () => { const k = th.dataset.sort; if (S.pref.holdSort === k) S.pref.holdDir = -(S.pref.holdDir || -1); else { S.pref.holdSort = k; S.pref.holdDir = k === 'name' ? 1 : -1; } savePref(); this.fill(); });
  },
  syms() { return holdings().map((h) => h.symbol); },
};

// ───────── 交易紀錄 ─────────
const TYPE_N = { BUY: '買進', SELL: '賣出', DIVIDEND: '股息', SPLIT: '拆股' };
VIEWS.trades = {
  title: '交易紀錄',
  render() {
    const years = Array.from(new Set(D.trades().map((t) => String(t.d).slice(0, 4)))).sort().reverse();
    return head('交易紀錄', `<button class="btn" id="expF">匯出篩選結果</button><label class="btn" style="cursor:pointer">匯入 CSV<input type="file" id="imp" accept=".csv,.aes,text/csv" hidden></label><button class="btn primary" id="addT">＋ 新增交易</button>`) +
      `<div class="row wrap" style="margin-bottom:12px"><input id="tq" placeholder="篩選代號或名稱" style="max-width:220px" value="${esc(S.pref.tq || '')}">
      <select id="tt" style="max-width:130px"><option value="">全部類別</option>${Object.entries(TYPE_N).map(([k, n]) => `<option value="${k}" ${S.pref.tt === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select id="ty" style="max-width:120px"><option value="">全部年度</option>${years.map((y) => `<option ${S.pref.ty === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div><div id="dyn"></div>`;
  },
  bind() {
    $('#addT').onclick = () => tradeModal();
    $('#imp').onchange = async (e) => { const file = e.target.files[0]; e.target.value = ''; if (!file) return; if (!can('BACKUP')) return toast('匯入為會員功能（備份與設定檔）'); const t = await expOpen(await file.text()); if (t != null) importTrades(t.replace(/^\ufeff/, '')); };
    const f = () => { S.pref.tq = $('#tq').value.trim(); S.pref.tt = $('#tt').value; S.pref.ty = $('#ty').value; savePref(); this.fill(); };
    $('#tq').oninput = f; $('#tt').onchange = f; $('#ty').onchange = f;
    $('#expF').onclick = () => { if (!can('BACKUP')) return toast('匯出為會員功能（備份與設定檔）'); this._exp = true; this.fill(); };
  },
  fill() {
    const lg = ledger(); const q = (S.pref.tq || '').toUpperCase();
    const list = D.trades().filter((t) => t.o !== 'legacy')
      .filter((t) => !q || t.s.includes(q) || D.name(t.s).toUpperCase().includes(q))
      .filter((t) => !S.pref.tt || t.t === S.pref.tt).filter((t) => !S.pref.ty || String(t.d).startsWith(S.pref.ty))
      .sort((a, b) => (b.d + '#' + String(b.id).padStart(10, '0')).localeCompare(a.d + '#' + String(a.id).padStart(10, '0')));
    let h = lg.err ? `<div class="notice err" style="margin-bottom:10px">帳本計算錯誤：${esc(lg.err)}</div>` : '';
    if (list.length) { const tw = (t) => (isUs(t.s) ? (t.x || usdTwd()) : 1); const buy = list.filter((t) => t.t === 'BUY'), sell = list.filter((t) => t.t === 'SELL');
      const amt = (l) => l.reduce((a, t) => a + tGross(t) * tw(t), 0); const fee = list.reduce((a, t) => a + (t.fee || 0) * tw(t), 0), tax = list.reduce((a, t) => a + (t.tax || 0) * tw(t), 0);
      const rz = lg.realizedById ? list.reduce((a, t) => a + (lg.realizedById[t.id] || 0), 0) : 0; const dv = lg.dividendById ? list.reduce((a, t) => a + (lg.dividendById[t.id] || 0), 0) : 0;
      h += `<div class="grid g4" style="margin-bottom:12px"><div class="tile"><div class="k">筆數</div><div class="v num">${list.length}</div><div class="s muted">買 ${buy.length}・賣 ${sell.length}</div></div>
        <div class="tile"><div class="k">買進／賣出金額（台幣）</div><div class="v num" style="font-size:16px"><span class="up">${fmtInt(amt(buy))}</span>／<span class="down">${fmtInt(amt(sell))}</span></div></div>
        <div class="tile"><div class="k">手續費＋交易稅</div><div class="v num">${fmtInt(fee + tax)}</div><div class="s muted">手續費 ${fmtInt(fee)}・稅 ${fmtInt(tax)}</div></div>
        <div class="tile"><div class="k">已實現損益＋股息</div><div class="v num ${cls(rz + dv)}">${fmtSigned(rz + dv)}</div><div class="s muted">損益 ${fmtSigned(rz)}・股息 ${fmtInt(dv)}</div></div></div>`; }
    if (list.length) h += `<div class="card list m-only" style="padding:4px 12px">${list.slice(0, 300).map((t) => { const us = isUs(t.s); const r = lg.realizedById ? lg.realizedById[t.id] : null;
      return `<div class="it" data-ed="${t.id}"><div class="l"><div class="t1"><span class="tag ${t.t === 'BUY' ? 'up' : t.t === 'SELL' ? 'down' : ''}">${t.o === 'opening' ? '期初' : TYPE_N[t.t]}</span>${t.sh ? ` <span class="tag">${t.t === 'SELL' ? (t.mg > 0 ? '融券賣' : '當沖賣') : '回補'}</span>` : t.mg > 0 && t.t === 'BUY' ? ' <span class="tag">融資</span>' : ''} ${esc(D.name(t.s))} <span class="muted small num">${t.s}</span></div>
        <div class="t2">${esc(t.d)} · ${t.t === 'SPLIT' ? '1 → ' + t.p : fmt(t.n, t.n % 1 ? 2 : 0) + ' 股 @ ' + fmtPrice(t.p)}${t.note ? ' · ' + esc(t.note) : ''}</div></div>
        <div class="r"><div class="num">${t.t === 'SPLIT' ? '' : fmt(tGross(t), us ? 2 : 0)}</div>${r != null ? `<div class="num small ${cls(r)}">${fmtSigned(r)}</div>` : ''}</div></div>`; }).join('')}</div>`;
    h += list.length ? `<div class="card scroll-x d-only" style="padding:6px 8px"><table class="tbl"><thead><tr><th>日期</th><th>類別</th><th>個股</th><th>股數</th><th>價格</th><th>金額</th><th>手續費</th><th>交易稅</th><th>損益／實收</th><th>備註</th><th></th></tr></thead><tbody>${list.slice(0, 500).map((t) => {
      const us = isUs(t.s); const g = tGross(t); const r = lg.realizedById ? lg.realizedById[t.id] : null; const dv = lg.dividendById ? lg.dividendById[t.id] : null;
      const tc = t.t === 'BUY' ? 'up' : t.t === 'SELL' ? 'down' : '';
      return `<tr><td class="num">${esc(t.d)}</td><td><span class="tag ${tc}">${t.o === 'opening' ? '期初' : TYPE_N[t.t]}</span>${t.sh ? ` <span class="tag">${t.t === 'SELL' ? (t.mg > 0 ? '融券賣' : '當沖賣') : '回補'}</span>` : t.mg > 0 && t.t === 'BUY' ? ' <span class="tag">融資</span>' : ''}</td>
        <td class="nm click" data-go="#/s/${t.s}" style="cursor:pointer">${esc(D.name(t.s))} <span class="muted small num">${t.s}</span></td>
        <td class="num">${t.t === 'SPLIT' ? '—' : fmt(t.n, t.n % 1 ? 2 : 0)}</td><td class="num">${t.t === 'SPLIT' ? '1 → ' + t.p : fmtPrice(t.p, us)}</td>
        <td class="num">${t.t === 'SPLIT' ? '—' : fmt(g, us ? 2 : 0)}</td><td class="num">${t.fee ? fmt(t.fee, us ? 2 : 0) : '—'}</td><td class="num">${t.tax ? fmt(t.tax, us ? 2 : 0) : '—'}</td>
        <td class="num ${cls(r || 0)}">${r != null ? fmtSigned(r) : dv != null ? fmtInt(dv) : '—'}</td><td class="small text2" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(t.note || '')}</td>
        <td><button class="btn sm" data-ed="${t.id}">編輯</button></td></tr>`;
    }).join('')}</tbody></table></div>${list.length > 500 ? '<div class="small muted">只顯示最近 500 筆，請用篩選縮小範圍。</div>' : ''}` : '<div class="card empty">沒有符合的交易紀錄。</div>';
    $('#dyn').innerHTML = h;
    $$('[data-ed]').forEach((b) => b.onclick = () => tradeModal(D.trades().find((t) => String(t.id) === b.dataset.ed)));
    if (this._exp) { this._exp = false; const head0 = ['日期', '類別', '代號', '名稱', '股數', '價格', '匯率', '手續費', '交易稅', '備註'];
      download('交易紀錄-篩選-' + ymd().replace(/\//g, '') + '.csv', '\ufeff' + [head0].concat(list.map((t) => [t.d, TYPE_N[t.t], t.s, D.name(t.s), t.n, t.p, t.x || 1, t.fee || 0, t.tax || 0, t.note || ''])).map((r) => r.map(csvCell).join(',')).join('\n')); }
  },
  syms() { return []; },
};
/** 新增／編輯交易（自動試算手續費與交易稅） */

// ───────── 融資（與 App MarginBook 相同算法） ─────────
const mgRatio = () => Number(S.pref.mgRatio) || 60;
const mgRate = () => Number(S.pref.mgRate) || 6.45;
const mgLoan = (amount) => Math.floor(amount * mgRatio() / 100 / 1000) * 1000;
function mgInterest(lots, repay, sellDate, rate = mgRate()) {
  const end = Date.parse(String(sellDate).replace(/\//g, '-')) || Date.now(); let need = repay, sum = 0;
  for (const l of lots || []) { if (need <= 1e-6) break; const part = Math.min(l.a, need); need -= part; const days = Math.max(0, Math.round((end - Date.parse(String(l.d).replace(/\//g, '-'))) / 86400000)); sum += part * rate / 100 * days / 365; }
  return Math.floor(sum);
}
/** 交易視窗的融資試算：買進→融資金額；賣出→償還與利息 */
const shDepPct = () => Number(S.pref.shDep) || 90;
const shFeePct = () => S.pref.shFee != null && !isNaN(+S.pref.shFee) ? +S.pref.shFee : 0.08;
/** 放空試算（與 App 交易編輯相同）：on＝null 時自動（買進且此股有放空、沒有持股才預設勾選） */
function shCalc(t0, type, s, n, p, on, margin, dText, iText) {
  const out = { show: false, on: false, margin, mg: 0, mi: 0, note: '', open: null };
  if (!s || isUs(s) || !(type === 'BUY' || type === 'SELL')) return out;
  const r = ledger(D.trades().filter((x) => !t0 || x.id !== t0.id)); const open = r.err ? null : (r.shorts || []).find((x) => x.symbol === s) || null; out.open = open;
  const held = r.err ? false : r.holdings.some((h) => h.symbol === s);
  out.show = type === 'SELL' || !!open || !!(t0 && t0.sh);
  out.on = out.show && (on == null ? (t0 ? !!t0.sh : type === 'BUY' && !!open && !held) : on);
  if (!out.on) return out;
  const g = n > 0 && p > 0 ? gross(s, n, p) : 0;
  if (type === 'SELL') {
    if (margin) {
      out.mg = dText !== '' ? Math.max(0, +dText || 0) : Math.ceil(g * shDepPct() / 100 / 100) * 100;
      const est = g > 0 ? Math.max(1, Math.floor(g * shFeePct() / 100)) : 0; out.mi = iText !== '' ? Math.max(0, +iText || 0) : est;
      out.note = g ? `融券：現金扣保證金 ${fmtInt(out.mg)}；賣出價款扣手續費、證交稅與借券費 ${fmtInt(out.mi)}（估 ${fmtInt(est)}）後由券商留置，回補時取回。` : '';
    } else out.note = '當沖先賣：不繳保證金，價款直接入帳，證交稅 0.15%；必須在同一天新增「買進」並勾選「回補放空部位」。';
    return out;
  }
  out.mi = iText !== '' ? Math.max(0, +iText || 0) : 0;
  if (open && g > 0) { const k = Math.min(1, n / open.n); const cost = g + Math.max(20, Math.floor(g * 0.001425)); const rr = open.net * k - cost + out.mi;
    out.note = `回補：取回保證金與擔保價款 ${fmtInt((open.dep + open.col) * k)}，預估已實現 ${fmtSigned(rr)}（手續費以實際為準）。`; }
  return out;
}
function mgCalc(t0, type, s, n, p, d, on, vText, iText) {
  const out = { show: false, mg: 0, mi: 0, owed: 0, note: '' };
  if (!s || isUs(s) || !(type === 'BUY' || type === 'SELL')) return out;
  out.show = true; const g = n > 0 && p > 0 ? gross(s, n, p) : 0;
  if (type === 'BUY') {
    if (!on) return out;
    out.mg = Math.max(0, Math.min(g, vText !== '' ? +vText || 0 : mgLoan(g)));
    out.note = g ? `融資 ${fmtInt(out.mg)}，自備款 ${fmtInt(g - out.mg)}（＋手續費）；現金只扣自備款，融資記為負債。年利率 ${mgRate()}%。` : '';
    return out;
  }
  const r = ledger(D.trades().filter((x) => !t0 || x.id !== t0.id)); if (r.err) return out;
  out.owed = (r.debt || {})[s] || 0; if (!(out.owed > 0)) { out.show = false; return out; }
  const held = (r.holdings.find((h) => h.symbol === s) || {}).shares || 0;
  const auto = held > 0 ? out.owed * Math.min(1, n / held) : 0;
  const repay = vText !== '' ? Math.min(out.owed, +vText || 0) : auto;
  out.mg = vText !== '' ? repay : 0;
  const est = mgInterest((r.lots || {})[s], repay, d);
  out.mi = iText !== '' ? +iText || 0 : est;
  out.note = `此股融資餘額 ${fmtInt(out.owed)}；本次償還 ${fmtInt(repay)}、利息 ${fmtInt(out.mi)}（估 ${fmtInt(est)}）；入帳＝賣出淨額 − 償還 − 利息。`;
  return out;
}
/** 融資部位卡：整戶維持率、各股維持率、追繳價 */
/** 放空部位卡（融券、當沖先賣），與 App ShortPositionsCard 相同 */
function shortCardHtml(P) {
  const xs = P.shorts || []; if (!xs.length) return ''; const today = ymd();
  const un = xs.reduce((a, x) => a + x.un, 0); const c = (r) => r == null ? '' : r < 130 ? 'up' : r < 140 ? 'mg-warn' : '';
  const stale = xs.filter((x) => x.dep <= 0 && x.d < today);
  return `<div class="card" style="grid-column:1/-1"><h2>放空部位<span class="r small muted">融券、當沖先賣</span></h2>
    <div class="grid g3"><div class="tile"><div class="k">未實現損益</div><div class="v num ${un > 0 ? 'up' : un < 0 ? 'down' : ''}">${fmtSigned(un)}</div></div><div class="tile"><div class="k">部位淨值</div><div class="v num">${fmtInt(P.shortEq)}</div></div><div class="tile"><div class="k">保證金</div><div class="v num">${fmtInt(xs.reduce((a, x) => a + x.dep, 0))}</div></div></div>
    ${stale.length ? `<div class="notice err" style="margin-top:8px">${stale.map((x) => esc(x.symbol)).join('、')} 為當沖先賣但沒有買回紀錄：當沖須當日買回，請補記買回交易（或改為融券）</div>` : ''}
    <div class="scroll-x" style="margin-top:8px"><table class="tbl"><thead><tr><th style="text-align:left">股票</th><th>類型</th><th>股數</th><th>放空均價</th><th>現價</th><th>未實現</th><th>維持率</th><th>追繳價</th></tr></thead><tbody>
    ${xs.map((x) => `<tr class="click" data-go="#/s/${encodeURIComponent(x.symbol)}"><td class="nm" style="text-align:left">${esc(x.name)} <span class="muted small num">${esc(x.symbol)}</span></td><td>${x.dep > 0 ? '融券' : '當沖'}</td><td class="num">${fmtInt(x.n)}</td><td class="num">${fmtPx(x.avg)}</td><td class="num">${fmtPx(x.px)}</td><td class="num ${x.un > 0 ? 'up' : x.un < 0 ? 'down' : ''}">${fmtSigned(x.un)}</td><td class="num ${c(x.ratio)}">${x.ratio == null ? '—' : x.ratio.toFixed(1) + '%'}</td><td class="num">${x.call == null ? '—' : fmtPx(x.call)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="small muted" style="margin-top:6px">放空均價已扣手續費、交易稅與借券費；股價上漲為虧損。融券維持率＝（保證金＋擔保價款）÷ 現價市值，低於 130% 追繳。回補時新增「買進」並勾選「回補放空」。</div></div>`;
}
function marginCardHtml(P) {
  const syms = Object.keys(P.mgDebt || {}); if (!syms.length) return '';
  const rows = syms.map((s) => { const d = P.mgDebt[s]; const lots = (P.mgLots || {})[s] || []; const row = P.rows.find((r) => r.symbol === s) || {};
    const sh = lots.reduce((a, l) => a + l.n, 0) || row.shares || 0; const px = (S.q[s] || {}).price || row.avgCost || 0; const v = sh * px;
    return { s, d, sh, v, ratio: d > 0 ? v / d * 100 : null, call: sh > 0 ? d * 1.3 / sh : null, acc: mgInterest(lots, d, ymd()) }; }).sort((a, b) => (a.ratio ?? 1e9) - (b.ratio ?? 1e9));
  const td = rows.reduce((a, r) => a + r.d, 0), tv = rows.reduce((a, r) => a + r.v, 0); const tr = td > 0 ? tv / td * 100 : null;
  const c = (r) => r == null ? '' : r < 130 ? 'up' : r < 140 ? 'mg-warn' : '';
  return `<div class="card" style="grid-column:1/-1"><h2>融資部位<span class="r small muted">追繳門檻 130%</span></h2>
    <div class="grid g3"><div class="tile"><div class="k">整戶維持率</div><div class="v num ${c(tr)}">${tr == null ? '—' : tr.toFixed(1) + '%'}</div></div><div class="tile"><div class="k">融資餘額</div><div class="v num">${fmtInt(td)}</div></div><div class="tile"><div class="k">累計利息（估）</div><div class="v num">${fmtInt(rows.reduce((a, r) => a + r.acc, 0))}</div></div></div>
    ${tr != null && tr < 140 ? `<div class="notice err" style="margin-top:8px">${tr < 130 ? '已低於追繳門檻，券商會要求補繳差額，否則可能被斷頭' : '接近追繳門檻，留意股價下跌風險'}</div>` : ''}
    <div class="scroll-x" style="margin-top:8px"><table class="tbl"><thead><tr><th style="text-align:left">股票</th><th>融資股數</th><th>融資餘額</th><th>市值</th><th>維持率</th><th>追繳價</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="click" data-go="#/s/${encodeURIComponent(r.s)}"><td class="nm" style="text-align:left">${esc(D.name(r.s))} <span class="muted small num">${esc(r.s)}</span></td><td class="num">${fmtInt(r.sh)}</td><td class="num">${fmtInt(r.d)}</td><td class="num">${fmtInt(r.v)}</td><td class="num ${c(r.ratio)}"><b>${r.ratio == null ? '—' : r.ratio.toFixed(1) + '%'}</b></td><td class="num">${r.call ? fmtPrice(r.call) : '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="small muted" style="margin-top:6px">維持率＝融資股票市值 ÷ 融資金額；追繳價＝維持率剛好 130% 的股價。利息以年利率 ${mgRate()}% 估算（可在 設定 › 帳本 調整）；今年已付利息 ${fmtInt(P.mgInt || 0)} 元。</div></div>`;
}
async function tradeModal(t0, preset = {}) {
  const t = t0 ? { ...t0 } : { t: preset.t || 'BUY', s: preset.s || '', d: ymd(), n: '', p: preset.p || '', x: 1, fee: '', tax: '', note: '', acc: 0 };
  const accs = D.accounts();
  const html = `<div class="seg" id="mt">${Object.entries(TYPE_N).map(([k, n]) => `<button data-t="${k}" class="${t.t === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="field search"><label>代號</label><input id="ms" value="${esc(t.s)}" placeholder="2330、台積電、AAPL" autocomplete="off"><div class="res hide"></div><div id="mn" class="small muted" style="margin-top:3px"></div></div>
    <div class="grid g2"><div class="field"><label>日期</label><input id="md" type="date" value="${String(t.d).replace(/\//g, '-')}"></div>
      <div class="field"><label id="lnl">股數</label><input id="mn2" type="number" step="any" value="${t.n}"></div></div>
    <div class="grid g2"><div class="field"><label id="lpl">價格</label><input id="mp" type="number" step="any" value="${t.p}"></div>
      <div class="field" id="fxf"><label>匯率（美元→台幣）</label><input id="mx" type="number" step="any" value="${t.x || usdTwd().toFixed(3)}"></div></div>
    <div class="grid g2"><div class="field"><label>手續費</label><input id="mf" type="number" step="any" value="${t.fee}"></div>
      <div class="field"><label>交易稅</label><input id="mtx" type="number" step="any" value="${t.tax}"></div></div>
    ${accs.length ? `<div class="field"><label>帳戶</label><select id="ma"><option value="0">未指定</option>${accs.map((a) => `<option value="${a.id}" ${Number(t.acc) === a.id ? 'selected' : ''}>${esc(a.n)}</option>`).join('')}</select></div>` : ''}
    <div id="mgw" style="display:none"><label class="row" style="gap:6px;margin:4px 0 8px" id="mgcw"><input type="checkbox" id="mgc" style="width:auto" ${t.mg > 0 ? 'checked' : ''}> <span>融資買進（成數 <span id="mgr"></span>%）</span></label>
      <div class="grid g2" id="mgf"><div class="field"><label id="mgl1">融資金額</label><input id="mgv" type="number" step="any" value="${t.mg > 0 ? t.mg : ''}" placeholder="空白＝自動"></div>
        <div class="field" id="mgif"><label>融資利息</label><input id="mgi" type="number" step="any" value="${t.mi > 0 ? t.mi : ''}" placeholder="空白＝估算"></div></div><div id="mgs" class="small muted"></div></div>
    <div id="shw" style="display:none"><label class="row" style="gap:6px;margin:4px 0 8px"><input type="checkbox" id="shc" style="width:auto" ${t.sh ? 'checked' : ''}> <span id="shl">放空</span></label>
      <div id="shf"><div class="field" id="shmf"><label>放空方式</label><select id="shm"><option value="1" ${!t0 || !t0.sh || t0.mg > 0 ? 'selected' : ''}>融券（繳保證金）</option><option value="0" ${t0 && t0.sh && !(t0.mg > 0) && t0.t === 'SELL' ? 'selected' : ''}>當沖先賣（當日買回）</option></select></div>
        <div class="grid g2"><div class="field" id="shdf"><label>保證金</label><input id="shd" type="number" step="any" value="${t.sh && t.t === 'SELL' && t.mg > 0 ? t.mg : ''}" placeholder="空白＝成交 × 90%"></div>
        <div class="field"><label id="shil">借券費</label><input id="shi" type="number" step="any" value="${t.sh && t.mi > 0 ? t.mi : ''}" placeholder="空白＝估算"></div></div></div><div id="shs" class="small muted"></div></div>
    <div class="field"><label>備註</label><input id="mnote" value="${esc(t.note || '')}"></div><div id="merr" class="small up" style="margin-top:8px"></div>`;
  const acts = t0 ? [['del', '刪除', 'danger'], ['', '取消'], ['ok', '儲存', 'primary']] : [['', '取消'], ['ok', '新增', 'primary']];
  const res = await dialog(t0 ? '編輯交易' : '新增交易', html, acts, (root, close) => {
    let type = t.t, feeEdited = !!t0, taxEdited = !!t0, shTouched = !!t0;
    const upd = () => {
      const s = $('#ms', root).value.trim().toUpperCase(); const us = isUs(s);
      $('#fxf', root).style.display = us ? '' : 'none';
      $('#mn', root).textContent = s ? D.name(s) + (S.q[s] && S.q[s].price ? '　現價 ' + fmtPrice(S.q[s].price, us) : '') : '';
      $('#lnl', root).textContent = type === 'SPLIT' ? '（不需填）' : type === 'DIVIDEND' ? '持有股數' : '股數';
      $('#lpl', root).textContent = type === 'SPLIT' ? '拆股比例（1 股變幾股）' : type === 'DIVIDEND' ? '每股股利' : '價格';
      const n = +$('#mn2', root).value, p = +$('#mp', root).value;
      if (!us && s && n > 0 && p > 0 && (type === 'BUY' || type === 'SELL')) {
        const acc = accs.find((a) => a.id === Number(($('#ma', root) || {}).value)); const g = gross(s, n, p);
        if (!feeEdited) $('#mf', root).value = twFee(g, acc ? acc.d : 1, acc ? acc.min : 20);
        if (!taxEdited) $('#mtx', root).value = type === 'SELL' ? Math.floor(g * twTaxRate(s)) : 0;
      }
      if (type === 'DIVIDEND' && !taxEdited) $('#mtx', root).value = 0;
      // 台股股利：費用＝二代健保（應稅部分 ≥ 2 萬）＋匯費／處理費；金額為股數 × 每股股利四捨五入
      if (type === 'DIVIDEND' && !us && s && n > 0 && p > 0 && !feeEdited) { const dg = divGross(n, p); $('#mf', root).value = Math.min(dg, divNhi(dg * taxRatioOf(s)) + divFeeFor(s)[0]); }
      // 放空（台股）：賣出＝融券賣出／當沖先賣；買進＝回補
      const sh = shCalc(t0, type, s, n, p, shTouched ? $('#shc', root).checked : null, $('#shm', root).value === '1', $('#shd', root).value, $('#shi', root).value);
      $('#shw', root).style.display = sh.show ? '' : 'none'; $('#shc', root).checked = sh.on; $('#shf', root).style.display = sh.on ? '' : 'none';
      $('#shl', root).textContent = type === 'SELL' ? '放空（融券賣出／先賣後買當沖）' : '回補放空部位' + (sh.open ? `（放空 ${fmtInt(sh.open.n)} 股）` : '');
      $('#shmf', root).style.display = type === 'SELL' ? '' : 'none'; $('#shdf', root).style.display = type === 'SELL' && sh.margin ? '' : 'none';
      $('#shil', root).textContent = type === 'SELL' ? '借券費' : '融券利息收入（選填）'; $('#shi', root).parentElement.style.display = type === 'SELL' && !sh.margin ? 'none' : '';
      $('#shs', root).textContent = sh.note; t._sh = sh;
      if (sh.on && type === 'SELL' && !sh.margin && !taxEdited && !D.isEtf(s) && n > 0 && p > 0) $('#mtx', root).value = Math.floor(gross(s, n, p) * 0.0015);
      // 融資（台股）
      const mg = mgCalc(t0, type, s, n, p, $('#md', root).value, $('#mgc', root).checked, $('#mgv', root).value, $('#mgi', root).value);
      $('#mgw', root).style.display = mg.show ? '' : 'none'; $('#mgcw', root).style.display = type === 'BUY' ? '' : 'none';
      $('#mgf', root).style.display = (type === 'BUY' && $('#mgc', root).checked) || (type === 'SELL' && mg.owed > 0) ? '' : 'none';
      $('#mgif', root).style.display = type === 'SELL' ? '' : 'none'; $('#mgr', root).textContent = mgRatio();
      $('#mgl1', root).textContent = type === 'SELL' ? '償還融資（空白＝依比例）' : '融資金額（空白＝成交 × 成數）';
      $('#mgs', root).textContent = mg.note; t._mg = mg;
      if (sh.on) $('#mgw', root).style.display = 'none';
    };
    $('#shc', root).onchange = () => { shTouched = true; upd(); }; ['#shm', '#shd', '#shi'].forEach((id) => { $(id, root).oninput = upd; $(id, root).onchange = upd; });
    ['#mgc', '#mgv', '#mgi'].forEach((id) => { $(id, root).oninput = upd; $(id, root).onchange = upd; });
    $$('[data-t]', root).forEach((b) => b.onclick = () => { type = b.dataset.t; $$('[data-t]', root).forEach((x) => x.classList.toggle('on', x === b)); upd(); });
    ['#mn2', '#mp', '#md'].forEach((id) => $(id, root).oninput = upd);
    $('#mf', root).oninput = () => { feeEdited = true; }; $('#mtx', root).oninput = () => { taxEdited = true; };
    if ($('#ma', root)) $('#ma', root).onchange = () => { feeEdited = false; upd(); };
    $('#ms', root).addEventListener('input', upd);
    bindSearch($('#ms', root), (sym) => { $('#ms', root).value = sym; upd(); if (!$('#mp', root).value && S.q[sym]) $('#mp', root).value = S.q[sym].price || ''; refreshQuotes([sym]).then(upd); });
    upd();
    return () => {
      const s = $('#ms', root).value.trim().toUpperCase(); const n = +$('#mn2', root).value; const p = +$('#mp', root).value;
      if (!s) return '請輸入代號';
      if (type !== 'SPLIT' && !(n > 0)) return '請輸入股數';
      if (!(p > 0)) return type === 'SPLIT' ? '請輸入拆股比例' : '請輸入價格';
      const nt = { ...(t0 || {}), t: type, s, d: $('#md', root).value.replace(/-/g, '/'), n: type === 'SPLIT' ? 0 : n, p, x: isUs(s) ? (+$('#mx', root).value || usdTwd()) : 1,
        fee: +$('#mf', root).value || 0, tax: +$('#mtx', root).value || 0, note: $('#mnote', root).value.trim(), acc: Number(($('#ma', root) || {}).value || 0),
        id: t0 ? t0.id : Math.max(0, ...D.trades().map((x) => Number(x.id) || 0)) + 1, o: t0 ? (t0.o || '') : '', att: t0 ? (t0.att || []) : [], tags: t0 ? (t0.tags || []) : [] };
      delete nt.mg; delete nt.mi; delete nt.sh; const mg = t._mg || {}; const sh = t._sh || {};
      if (sh.on) { nt.sh = 1; if (sh.mg > 0) nt.mg = sh.mg; if (sh.mi > 0) nt.mi = sh.mi; }
      else { if (mg.mg > 0) nt.mg = mg.mg; if (mg.mi > 0) nt.mi = mg.mi; }
      const list = D.trades().filter((x) => !t0 || x.id !== t0.id).concat([nt]);
      const r = ledger(list); if (r.err) return r.err;
      t._new = list; return null;
    };
  });
  if (res === 'ok' && t._new) {
    ksetJson('trades', t._new); recalc();
    const sym = t._new[t._new.length - 1].s;
    if (!D.quotes().some((q) => q.s === sym)) { const qs = D.quotes(); qs.push({ s: sym, n: D.name(sym), m: isUs(sym) ? 'US' : 'TW', etf: /^00/.test(sym) }); ksetJson('quotes', qs); }
    changed(); toast(t0 ? '已更新交易' : '已新增交易'); route();
  } else if (res === 'del') {
    const list = D.trades().filter((x) => x.id !== t0.id); const r = ledger(list);
    if (r.err) { toast('無法刪除：' + r.err, 4000); return; }
    ksetJson('trades', list); recalc(); changed(); toast('已刪除交易'); route();
  }
}

/** 匯入交易 CSV（App 匯出格式與常見券商對帳單欄位；日期支援民國年） */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',' || c === '\t' || c === ';') { row.push(cur.trim()); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur.trim()); cur = ''; if (row.some((x) => x)) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur.trim()); if (row.some((x) => x)) rows.push(row);
  return rows;
}
async function importTrades(text) {
  const rows = parseCsv(text.replace(/^\ufeff/, '')); if (rows.length < 2) return toast('CSV 沒有資料');
  const hd = rows[0].map((h) => h.toLowerCase());
  const col = (...names) => hd.findIndex((h) => names.some((n) => h.includes(n)));
  const ci = { d: col('日期', 'date'), t: col('類別', '買賣', '交易類別', 'type', 'side'), s: col('代號', '股票代號', 'symbol', 'code'), n: col('股數', '數量', 'shares', 'qty'),
    p: col('價格', '成交價', '單價', 'price'), fee: col('手續費', 'fee'), tax: col('交易稅', '證交稅', 'tax'), x: col('匯率', 'fx'), note: col('備註', 'note') };
  if (ci.d < 0 || ci.s < 0 || ci.n < 0 || ci.p < 0) return toast('找不到必要欄位（日期、代號、股數、價格）', 4000);
  const date = (v) => { const m = String(v).match(/(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/); if (!m) return null; let y = +m[1]; if (y < 1911) y += 1911; return y + '/' + m[2].padStart(2, '0') + '/' + m[3].padStart(2, '0'); };
  const type = (v) => { v = String(v); return /賣|sell/i.test(v) ? 'SELL' : /股息|股利|配息|div/i.test(v) ? 'DIVIDEND' : /拆|split/i.test(v) ? 'SPLIT' : 'BUY'; };
  const num = (v) => parseFloat(String(v || '').replace(/[,$\s]/g, '')) || 0;
  let id = Math.max(0, ...D.trades().map((t) => Number(t.id) || 0)); const out = []; const bad = [];
  rows.slice(1).forEach((r, i) => {
    const d = date(r[ci.d]); const s = String(r[ci.s] || '').toUpperCase().replace(/\.TWO?$/, '').trim(); const n = Math.abs(num(r[ci.n])); const p = num(r[ci.p]);
    if (!d || !s || !(p > 0) || (!(n > 0) && type(r[ci.t]) !== 'SPLIT')) { bad.push(i + 2); return; }
    out.push({ t: ci.t >= 0 ? type(r[ci.t]) : 'BUY', s, d, n, p, x: ci.x >= 0 ? num(r[ci.x]) || 1 : 1, fee: ci.fee >= 0 ? num(r[ci.fee]) : 0, tax: ci.tax >= 0 ? num(r[ci.tax]) : 0,
      id: ++id, o: /期初/.test(String(r[ci.t] || '')) ? 'opening' : '', note: ci.note >= 0 ? r[ci.note] || '' : '', acc: 0, att: [], tags: [] });
  });
  if (!out.length) return toast('沒有可匯入的資料', 3500);
  // 匯入方式（與 App 相同）：覆蓋（預設，以檔案為準：檔案期間內同代號、同類別的既有交易先刪除）、只補新的、全部取代
  const MODES = [['ow', '覆蓋（建議）', '以匯入檔為準：檔案涵蓋的期間內，同代號、同類別的既有交易先刪除，再匯入檔案內容；期間外與其他代號不受影響'],
    ['add', '只補新的', '保留現有交易，只新增檔案裡沒有的'], ['all', '全部取代', '刪除全部交易紀錄（含期初），改成檔案內容']];
  const from = out.reduce((m, t) => (t.d < m ? t.d : m), out[0].d), to = out.reduce((m, t) => (t.d > m ? t.d : m), out[0].d);
  const types = {}; out.forEach((t) => { (types[t.s] = types[t.s] || new Set()).add(t.t); });
  const r4 = (v) => Math.round(Number(v) * 10000) / 10000;
  const key = (t) => [t.t, t.s, String(t.d).replace(/-/g, '/'), r4(t.n), r4(t.p), t.acc || 0].join('|');
  const planOf = (m) => {
    const cur = D.trades();
    if (m === 'all') return { keep: cur.filter((t) => t.o === 'legacy'), add: out };
    if (m === 'add') { const have = {}; cur.filter((t) => t.o !== 'legacy').forEach((t) => { const k = key(t); have[k] = (have[k] || 0) + 1; });
      return { keep: cur, add: out.filter((t) => { const k = key(t); if (have[k] > 0) { have[k]--; return false; } return true; }) }; }
    const rm = (t) => !t.o && String(t.d).replace(/-/g, '/') >= from && String(t.d).replace(/-/g, '/') <= to && types[t.s] && types[t.s].has(t.t);
    return { keep: cur.filter((t) => !rm(t)), add: out };
  };
  let mode = 'ow';
  const sum = () => { const pl = planOf(mode); const rmN = D.trades().length - pl.keep.length; const lg = ledger(pl.keep.concat(pl.add));
    return `<div class="small ${mode === 'all' ? 'up' : 'text2'}" style="margin-top:6px">${rmN ? `將刪除現有 ${rmN} 筆、` : ''}匯入 ${pl.add.length} 筆${mode === 'add' && pl.add.length < out.length ? `（${out.length - pl.add.length} 筆已存在，略過）` : ''}</div>${lg.err ? `<div class="notice err" style="margin-top:8px">${esc(lg.err)}</div>` : ''}`; };
  const ok = await dialog('匯入交易', `<div>讀到 <b>${out.length}</b> 筆（${esc(from)}～${esc(to)}）${bad.length ? `，${bad.length} 列格式不符（第 ${bad.slice(0, 8).join('、')}${bad.length > 8 ? '…' : ''} 列）` : ''}。</div>
    <div class="small muted" style="margin-top:6px">${out.slice(0, 5).map((t) => esc(t.d + ' ' + TYPE_N[t.t] + ' ' + t.s + ' ' + t.n + ' 股 @ ' + t.p)).join('<br>')}${out.length > 5 ? '<br>…' : ''}</div>
    <div class="small text2" style="margin-top:10px"><b>匯入方式</b></div>
    ${MODES.map(([k, n, dsc]) => `<label class="row small" style="gap:6px;margin-top:6px;cursor:pointer;align-items:flex-start"><input type="radio" name="imm" value="${k}" style="width:auto;margin-top:3px" ${k === mode ? 'checked' : ''}><span><b>${n}</b><br><span class="muted">${dsc}</span></span></label>`).join('')}
    <div id="imsum">${sum()}</div>`, [['', '取消'], ['ok', '匯入', 'primary']],
    (box) => { $$('[name="imm"]', box).forEach((el) => el.onchange = () => { mode = el.value; $('#imsum', box).innerHTML = sum(); });
      return () => { const pl = planOf(mode); const lg = ledger(pl.keep.concat(pl.add)); return lg.err ? lg.err : !pl.add.length && pl.keep.length === D.trades().length ? '這些交易都已經存在，沒有需要匯入的' : null; }; });
  if (ok !== 'ok') return;
  const pl = planOf(mode); const rmN = D.trades().length - pl.keep.length;
  ksetJson('trades', pl.keep.concat(pl.add)); recalc();
  const qs = D.quotes(); pl.add.forEach((t) => { if (!qs.some((q) => q.s === t.s)) qs.push({ s: t.s, n: D.name(t.s), m: isUs(t.s) ? 'US' : 'TW', etf: /^00/.test(t.s) }); }); ksetJson('quotes', qs);
  changed(); toast('已匯入 ' + pl.add.length + ' 筆交易' + (rmN ? '（覆蓋 ' + rmN + ' 筆）' : ''), 4000); route();
}

// ───────── 對話框 ─────────
/** buttons: [[值, 文字, 樣式]]；setup(root, close) 可回傳驗證函式（回傳錯誤訊息則不關閉） */
// ───────── 投資風險告知書：首次使用確認；確認後只在會員中心顯示（聲明更新時 RISK_VER 加 1，會請使用者重新確認） ─────────
const RISK_VER = 1;
const RISK_POINTS = ['進場評估、綜合結論、模型試算比例、選股、回測、AI 體檢與組合診斷，都是程式依指標計算的結果，未考量你的個人財務狀況與風險承受度。', '資料可能延遲或有誤，歷史績效不代表未來表現；融資融券與槓桿商品可能放大虧損。', '本服務不是證券投資顧問，不提供個別化建議；所有投資決定由你自行判斷並承擔結果。'];
const RISK_TEXT = '本服務僅提供資產管理與分析成果，不構成投資建議；投資有風險，請依自身財務狀況與風險承受度自行判斷，並自負盈虧。';
/** 會員中心的「投資風險告知書」卡：確認日期、重點與全文連結（其他頁面不放） */
function riskCardHtml() { const at = store.get('riskAckAt', 0); return `<div class="card"><h2>投資風險告知書</h2>${at ? `<div class="small" style="color:var(--primary);margin-bottom:6px">✓ 已於 ${new Date(at).toLocaleDateString('zh-TW')} 閱讀並確認</div>` : ''}<div class="notice" style="line-height:1.7">${RISK_TEXT}</div><ul class="small text2" style="padding-left:18px;margin:10px 0 6px;line-height:1.7">${RISK_POINTS.map((x) => '<li>' + x + '</li>').join('')}</ul><a href="/web/risk.html" target="_blank" rel="noopener" class="small">閱讀告知書全文 ›</a></div>`; }
async function riskAck() {
  if ((store.get('riskAck', 0) || 0) >= RISK_VER || $('.modal-bg')) return;
  const html = `<div class="notice" style="line-height:1.7">${RISK_TEXT}</div>
    <ul class="small text2" style="padding-left:18px;margin:10px 0;line-height:1.7">${RISK_POINTS.map((x) => '<li>' + x + '</li>').join('')}</ul>
    <label class="row small" style="gap:6px;cursor:pointer;justify-content:flex-start"><input type="checkbox" id="rkOk" style="width:auto"> 我已閱讀並了解<a href="/web/risk.html" target="_blank" rel="noopener">投資風險告知書</a>，願自行承擔投資風險</label><div id="merr" class="small up"></div>`;
  const v = await dialog('使用前請先閱讀：投資風險告知書', html, [['ok', '我了解並同意', 'primary']], (b) => () => ($('#rkOk', b).checked ? null : '請先勾選確認'));
  if (v === 'ok') { store.set('riskAck', RISK_VER); store.set('riskAckAt', Date.now()); } else setTimeout(riskAck, 400);
}
function dialog(title, html, buttons, setup) {
  return new Promise((resolve) => {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><div class="mb">${html}</div><div class="acts">${buttons.map(([v, t, c]) => `<button class="btn ${c || ''}" data-v="${v}">${esc(t)}</button>`).join('')}</div></div>`;
    document.body.appendChild(bg);
    const close = (v) => { bg.remove(); resolve(v); };
    const validate = setup ? setup($('.mb', bg), close) : null;
    $$('[data-v]', bg).forEach((b) => b.onclick = () => {
      const v = b.dataset.v;
      if (v === 'ok' && validate) { const err = validate(); if (err) { const e = $('#merr', bg); if (e) e.textContent = err; else toast(err); return; } }
      close(v);
    });
    bg.onclick = (e) => { if (e.target === bg) close(''); };
    const esc2 = (e) => { if (e.key === 'Escape' && document.body.contains(bg) && !$('.search .res:not(.hide)', bg)) { document.removeEventListener('keydown', esc2); close(''); } };
    document.addEventListener('keydown', esc2);
    setTimeout(() => { const f = $('input:not([type=checkbox]),select', bg); if (f && !f.value) f.focus(); }, 30);
  });
}

// ───────── 個股 ─────────
/** 圖表區間：[抓取範圍, 顯示根數（0＝全部）, K 棒週期]；5 年以內日 K，更長改週 K；C＝自訂（S.pref.rcDays 天） */
const RANGES = { '1D': ['1d', 0], '1M': ['6mo', 22], '3M': ['6mo', 66], '6M': ['1y', 132], '1Y': ['2y', 250], '2Y': ['5y', 500], '5Y': ['10y', 1250], '10Y': ['max', 522, '1wk'], 'MAX': ['max', 0, '1wk'] };
const RANGE_N = { '1D': '當日', '1M': '1 個月', '3M': '3 個月', '6M': '6 個月', '1Y': '1 年', '2Y': '2 年', '5Y': '5 年', '10Y': '10 年', 'MAX': '最大' };
function rangeOf(k) {
  if (k === 'C') { const d = S.pref.rcDays || 365; return d <= 1800 ? [d <= 700 ? '5y' : '10y', Math.max(5, Math.round(d * 250 / 365)), '1d'] : ['max', Math.round(d / 7), '1wk']; }
  return RANGES[k] || RANGES['6M'];
}
function rcLabel(d) { return d % 365 === 0 ? d / 365 + ' 年' : d % 30 === 0 ? d / 30 + ' 個月' : d + ' 天'; }
const CTYPES = [['candle', 'K線'], ['line', '走勢'], ['area', '面積'], ['ohlc', '美國線']];
/** 個股頁置頂：返回／名稱／按鈕列、標籤、行情卡整組 sticky（#shd）；捲動後加 .stuck，手機版收起標籤與明細格 */
function sqmInject() {
  if (document.getElementById('sqmCss')) return; const el = document.createElement('style'); el.id = 'sqmCss';
  el.textContent = `.shd{position:sticky;top:0;z-index:40;background:var(--bg);margin:0 -6px;padding:0 6px;transition:box-shadow .18s}
.shd.stuck{padding-top:8px;padding-bottom:8px;box-shadow:0 10px 14px -12px #0007}.shd.stuck .top{margin-bottom:8px}
@media (max-width:560px){.shd.stuck #stags,.shd.stuck #sq .grid{display:none}.shd.stuck .top{flex-wrap:nowrap;margin-bottom:6px}.shd.stuck .top>:not(:first-child):not(h1){display:none}.shd.stuck .top h1{font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.shd.stuck #sq .row{flex-wrap:nowrap;align-items:center}.shd.stuck #sq .row>div:first-child{display:flex;align-items:baseline;gap:10px}.shd.stuck #sq .row>div:first-child>div{margin-top:0 !important}.shd.stuck #sq .card{padding:8px 12px}.shd.stuck #sq .num[style*="font-size:40px"]{font-size:26px !important}}`;
  document.head.appendChild(el);
}
const barCache = {};
VIEWS.s = {
  title: '個股',
  render(sym) {
    if (this.sym !== sym) this._tab = null; this.sym = sym; const us = isUs(sym);
    const inW = D.quotes().some((q) => q.s === sym);
    return `<div id="shdS" style="height:1px;margin-bottom:-1px"></div><div class="shd" id="shd"><div class="top"><a class="btn sm" href="javascript:history.back()">‹ 返回</a><h1>${esc(D.name(sym))} <span class="muted num" style="font-size:16px">${sym}</span> <span class="mkt ${us ? 'us' : ''}">${us ? 'US' : D.otc(sym) ? '上櫃' : 'TW'}</span></h1>
      <button class="btn" id="wbtn">${inW ? '✓ 已在自選' : '＋ 加入自選'}</button><button class="btn" id="star" title="最愛">${D.starred().includes(sym) ? '★' : '☆'}</button>
      ${D.groups().length ? `<select id="grp" style="width:auto"><option value="">加入群組…</option>${D.groups().map((g) => `<option value="${g.id}">${(g.s || []).includes(sym) ? '✓ ' : ''}${esc(g.n)}</option>`).join('')}</select>` : ''}
      <button class="btn" id="sell">賣出</button><button class="btn primary" id="buy">買進</button></div>
      <div id="stags" class="row wrap" style="gap:6px;margin:-4px 0 10px"></div>
      <div id="sq"></div></div>
      ${(S.pref.stabL || {}).pos === 'top' ? stabBar(this) : ''}
      <div class="card" style="margin-top:12px"><div class="row wrap" style="margin-bottom:8px"><div class="seg" id="rg" style="flex-wrap:nowrap;overflow-x:auto;max-width:100%;scrollbar-width:none">${Object.keys(RANGES).map((k) => `<button data-r="${k}" class="${S.pref.range === k ? 'on' : ''}" style="white-space:nowrap;flex:none;padding:6px 10px">${RANGE_N[k]}</button>`).join('')}<button data-r="C" class="${S.pref.range === 'C' ? 'on' : ''}" title="自訂區間" style="white-space:nowrap;flex:none;padding:6px 10px">${S.pref.rcDays ? '自訂 ' + rcLabel(S.pref.rcDays) : '自訂…'}</button></div>
        <div class="seg" id="ctp">${CTYPES.map(([k, n]) => `<button data-ct="${k}" class="${(S.pref.ctype || 'candle') === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        <span class="sp"></span><button class="btn sm ${S.pref.boll ? 'primary' : ''}" id="boll">布林通道</button><a class="btn sm" href="#/compare/${sym}">比較</a><span class="seg" id="kopt"><button id="kpat" class="${S.pref.kpat !== false ? 'on' : ''}" title="在 K 線上標示型態">型態</button><button id="kavg" class="${S.pref.kavg !== false ? 'on' : ''}" title="顯示我的持股均價線">均價</button><button id="kxh" class="${S.pref.xh !== false ? 'on' : ''}" title="顯示十字線（價格與日期）">十字</button><button id="kma" title="設定均線週期">均線</button><button id="kfs" title="全螢幕">⛶</button><button id="kpng" title="下載圖表圖片">⤓</button></span><span class="seg" id="zm" title="滑鼠滾輪縮放、拖曳平移、雙擊還原"><button data-z="0.7">＋</button><button data-z="1.4">－</button><button data-z="0">還原</button></span>
        <div class="seg" id="sb">${['KD', 'RSI', 'MACD'].map((k) => `<button data-s="${k}" class="${S.pref.sub === k ? 'on' : ''}">${k}</button>`).join('')}</div></div>
        <div class="chart-wrap"><canvas></canvas><div class="chart-tip"></div></div><div class="row between small muted" style="margin-top:4px"><span id="cmsg"></span><span class="zinfo"></span><span class="d-only">滾輪縮放 · 拖曳平移 · 雙擊還原</span></div></div>
      <div id="kfxC" style="margin-top:12px"></div>
      ${(S.pref.stabL || {}).pos === 'top' ? '' : stabBar(this)}
      <div id="si" class="grid g2 stack" style="margin-top:12px"></div>`;
  },
  bind() {
    const sym = this.sym;
    $('#wbtn').onclick = () => { if (D.quotes().some((q) => q.s === sym)) removeWatch(sym); else addWatch(sym, D.name(sym)); };
    $('#buy').onclick = () => tradeModal(null, { t: 'BUY', s: sym, p: (S.q[sym] || {}).price || '' });
    $('#star').onclick = () => { $('#star').textContent = toggleStar(sym) ? '★' : '☆'; };
    if ($('#grp')) $('#grp').onchange = () => { const g = D.groups().find((x) => String(x.id) === $('#grp').value); if (!g) return; const on = !(g.s || []).includes(sym); setGroup(sym, g.id, on); toast((on ? '已加入「' : '已移出「') + g.n + '」'); route(); };
    $('#sell').onclick = () => tradeModal(null, { t: 'SELL', s: sym, p: (S.q[sym] || {}).price || '' });
    { const rg = $('#rg'), on = $('#rg button.on'); if (rg && on && rg.scrollWidth > rg.clientWidth) rg.scrollLeft = Math.max(0, on.offsetLeft - rg.offsetLeft - (rg.clientWidth - on.offsetWidth) / 2); }
    $$('[data-r]', $('#rg')).forEach((b) => b.onclick = async () => {
      if (b.dataset.r === 'C' && (!S.pref.rcDays || S.pref.range === 'C')) {
        let box = null; const v = await dialog('自訂圖表區間', `<div class="grid g2"><div class="field"><label>數量</label><input id="rcN" type="number" min="1" value="${S.pref.rcDays ? (S.pref.rcDays % 365 === 0 ? S.pref.rcDays / 365 : S.pref.rcDays % 30 === 0 ? S.pref.rcDays / 30 : S.pref.rcDays) : 3}"></div>
          <div class="field"><label>單位</label><select id="rcU"><option value="1">天</option><option value="30">個月</option><option value="365" selected>年</option></select></div></div><div class="small muted">5 年內為日 K，更長的區間改用週 K；最長 30 年。</div><div id="derr" class="small down"></div>`,
          [['', '取消'], ['ok', '套用', 'primary']], (bx) => { box = bx; return () => { const d = (+$('#rcN', bx).value || 0) * +$('#rcU', bx).value; return d < 5 || d > 30 * 365 ? '請輸入 5 天到 30 年之間' : null; }; });
        if (v !== 'ok') return; S.pref.rcDays = (+$('#rcN', box).value || 0) * +$('#rcU', box).value; b.textContent = '自訂 ' + rcLabel(S.pref.rcDays);
      }
      S.pref.range = b.dataset.r; savePref(); $$('[data-r]', $('#rg')).forEach((x) => x.classList.toggle('on', x === b)); this.chart(); });
    $$('[data-ct]', $('#ctp')).forEach((b) => b.onclick = () => { S.pref.ctype = b.dataset.ct; savePref(); $$('[data-ct]', $('#ctp')).forEach((x) => x.classList.toggle('on', x === b)); this.chart(); });
    $$('[data-s]', $('#sb')).forEach((b) => b.onclick = () => { S.pref.sub = b.dataset.s; savePref(); $$('[data-s]', $('#sb')).forEach((x) => x.classList.toggle('on', x === b)); this.chart(); });
    $('#boll').onclick = () => { if (!can('CHART')) return toast('布林通道為會員功能（進階圖表）'); S.pref.boll = !S.pref.boll; savePref(); $('#boll').classList.toggle('primary', S.pref.boll); this.chart(); };
    $$('[data-z]', $('#zm')).forEach((b) => b.onclick = () => { const w = $('.chart-wrap'); if (w._zoom) w._zoom(+b.dataset.z); });
    $('#kpat').onclick = () => { S.pref.kpat = S.pref.kpat === false; savePref(); $('#kpat').classList.toggle('on', S.pref.kpat !== false); this.chart(); };
    $('#kxh').onclick = () => { S.pref.xh = S.pref.xh === false; savePref(); $('#kxh').classList.toggle('on', S.pref.xh !== false); toast(S.pref.xh !== false ? '已開啟十字線（所有圖表）' : '已關閉十字線'); };
    $('#kavg').onclick = () => { S.pref.kavg = S.pref.kavg === false; savePref(); $('#kavg').classList.toggle('on', S.pref.kavg !== false); this.chart(); };
    $('#kma').onclick = async () => { const cur = (S.pref.mas || [5, 20, 60]).join(', '); let mb = null;
      const v = await dialog('均線設定', `<div class="field"><label>均線週期（最多 4 條，用逗號分隔）</label><input id="maIn" value="${cur}"></div><div class="row wrap" style="gap:6px">${[['5, 20, 60', '短中長（預設）'], ['5, 10, 20, 60', '台股常用'], ['20, 60, 120, 240', '月季半年年線'], ['10, 50, 200', '美股常用']].map(([x, n]) => `<button class="btn sm" data-maq="${x}">${n}</button>`).join('')}</div>`, [['', '取消'], ['ok', '套用', 'primary']], (box) => { mb = box; $$('[data-maq]', box).forEach((b) => b.onclick = () => { $('#maIn', box).value = b.dataset.maq; }); });
      if (v !== 'ok' || !mb) return; const arr = Array.from(new Set($('#maIn', mb).value.split(/[,，\s]+/).map((x) => parseInt(x, 10)).filter((x) => x >= 2 && x <= 400))).slice(0, 4);
      if (!arr.length) return toast('請輸入 2～400 之間的天數'); S.pref.mas = arr; savePref(); this.chart(); };
    $('#kfs').onclick = () => { const card = $('.chart-wrap').closest('.card'); if (document.fullscreenElement) document.exitFullscreen(); else if (card.requestFullscreen) card.requestFullscreen().catch(() => toast('瀏覽器不支援全螢幕')); };
    $('#kpng').onclick = () => { const cv = $('.chart-wrap canvas'); const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; const g = c2.getContext('2d'); g.fillStyle = css('--card') || '#fff'; g.fillRect(0, 0, c2.width, c2.height); g.drawImage(cv, 0, 0);
      const a = document.createElement('a'); a.href = c2.toDataURL('image/png'); a.download = sym + '-' + ymd().replace(/\//g, '') + '.png'; a.click(); };
    this._fs = () => setTimeout(() => this.chart(), 60); document.addEventListener('fullscreenchange', this._fs);
    $$('[data-st]').forEach((b) => b.onclick = () => { this._tab = b.dataset.st; S.pref.stab = b.dataset.st; savePref(); $$('[data-st]').forEach((x) => x.classList.toggle('on', x === b)); this.info(); });
    $('#stabE').onclick = () => stabEditor();
    sqmInject(); if (this._io) this._io.disconnect();
    this._io = new IntersectionObserver(([en]) => { const m = $('#shd'); if (m) m.classList.toggle('stuck', !en.isIntersecting && en.boundingClientRect.top < 0); });
    if ($('#shdS')) this._io.observe($('#shdS'));
    this.chart(); this.info(); this.tags(); kfxMount($('#kfxC'), sym);
    this._rs = () => this.chart(); window.addEventListener('resize', this._rs);
  },
  leave() { if (this._io) { this._io.disconnect(); this._io = null; } window.removeEventListener('resize', this._rs); document.removeEventListener('fullscreenchange', this._fs); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); },
  async chart() {
    const sym = this.sym; const [range, count, iv] = rangeOf(S.pref.range); const ctype = S.pref.ctype || 'candle';
    $('#sb').style.visibility = range === '1d' ? 'hidden' : '';
    if (range === '1d') {
      $('#cmsg').textContent = '載入當日走勢…';
      const bars5 = ctype === 'candle' || ctype === 'ohlc'; const us = isUs(sym) && !/^\^|=|-USD$/.test(sym); const ext = us && S.pref.usExt !== false;
      const r = await fetchYahoo(ysym(sym), '1d', bars5 ? '5m' : '1m', 30, ext);
      if (S.route !== 's' || this.sym !== sym) return;
      if (!r || !r.timestamp) { $('#cmsg').textContent = '無法取得當日走勢'; return; }
      const q0 = r.indicators.quote[0]; const tp = r.meta.currentTradingPeriod || {}; const reg = tp.regular || {}, pre = tp.pre || {}, post = tp.post || {};
      const hasReg = !reg.start || r.timestamp.some((t, i) => t >= reg.start && t < reg.end && q0.close[i] != null);
      // 盤前（今天還沒有正常交易）：基準改為最近一次收盤，走勢與漲跌都以它計
      const preOnly = ext && !hasReg && r.meta.regularMarketPrice > 0;
      const prev = preOnly ? r.meta.regularMarketPrice : (r.meta.chartPreviousClose || r.meta.previousClose);
      const dd = new Date((r.timestamp[0] + 8 * 3600) * 1000); const wk = '日一二三四五六'[dd.getUTCDay()];
      const seg = (t) => (reg.start && t < reg.start ? '盤前' : reg.end && t >= reg.end ? '盤後' : '');
      $('#cmsg').innerHTML = esc('交易日 ' + dd.getUTCFullYear() + '/' + String(dd.getUTCMonth() + 1).padStart(2, '0') + '/' + String(dd.getUTCDate()).padStart(2, '0') + '（週' + wk + '）' + (bars5 ? '・5 分 K' : '') + (ext ? '・美東 04:00–20:00' + (preOnly ? '・基準為最近收盤' : '') : ''))
        + (us ? ` <button class="btn sm" id="usExtT" style="margin-left:6px">${ext ? '含盤前盤後 ✓' : '只看盤中'}</button>` : '');
      if ($('#usExtT')) $('#usExtT').onclick = () => { S.pref.usExt = !ext; savePref(); this.chart(); };
      // 三關價線（與 App 當日走勢的「三關」開關相同；進階圖表會員）
      let levels = null; const klOn = S.pref.keyLv !== false;
      if (can('CHART') && !/^\^|=|-USD$/.test(sym)) {
        $('#cmsg').insertAdjacentHTML('beforeend', ` <button class="btn sm" id="klT" style="margin-left:6px">${klOn ? '三關 ✓' : '三關'}</button>`);
        $('#klT').onclick = () => { S.pref.keyLv = !klOn; savePref(); this.chart(); };
        if (klOn) { const dk = sym + '2y'; const daily = barCache[dk] || (barCache[dk] = await loadBars(sym, '2y')); if (S.route !== 's' || this.sym !== sym) return;
          const kl = keyLevelsOf(daily, sym); if (kl) levels = kl.lv; }
      }
      if (bars5) {
        const bs = r.timestamp.map((t, i) => (q0.close[i] == null || q0.open[i] == null ? null : { d: hm(t * 1000), t: t * 1000, o: q0.open[i], h: q0.high[i], l: q0.low[i], c: q0.close[i], v: isUs(sym) ? q0.volume[i] : (q0.volume[i] || 0) / 1000 })).filter(Boolean);
        drawChart($('.chart-wrap'), bs, { key: sym + '1d5' + (ext ? 'x' : ''), count: 0, mas: [], type: ctype, intraday: true, base: prev, levels });
        return;
      }
      const pts = r.timestamp.map((t, i) => [t * 1000, q0.close[i], q0.volume[i]]).filter((p) => p[1] != null);
      const full = ext && pre.start && post.end && r.timestamp[0] >= pre.start - 60;
      drawLine($('.chart-wrap'), pts, prev, isUs(sym), ctype, full ? { t0: pre.start * 1000, span: (post.end - pre.start) * 1000, bands: [[pre.start * 1000, reg.start * 1000, '盤前'], [reg.end * 1000, post.end * 1000, '盤後']],
        baseLabel: preOnly ? '收盤' : '昨收', lab: (t) => (seg(t / 1000) ? '　<span style="color:#E8B04B">' + seg(t / 1000) + '</span>' : ''), levels } : { levels });
      return;
    }
    const key = sym + range + (iv || ''); $('#cmsg').textContent = barCache[key] ? '' : '載入 K 線…';
    const bars = barCache[key] || (barCache[key] = await loadBars(sym, range, iv));
    if (S.route !== 's' || this.sym !== sym) return;
    if (!bars.length) { $('#cmsg').textContent = '無法取得 K 線資料'; return; }
    // 盤中：以即時價補上今日 K 棒
    const q = S.q[sym]; const today = ymd(); const all = bars.slice();
    if (q && q.price && !isUs(sym) && twOpen()) {
      const last = all[all.length - 1];
      const cur = { d: today, o: q.open || q.price, h: Math.max(q.high || q.price, q.price), l: Math.min(q.low || q.price, q.price), c: q.price, v: q.volLots || 0 };
      if (last.d === today) all[all.length - 1] = cur; else all.push(cur);
    }
    $('#cmsg').innerHTML = can('CHART') ? '' : '🔒 KD／RSI／MACD 副圖為會員功能（進階圖表）。<a href="#/member">查看方案 ›</a>';
    const hh = holdings().find((x) => x.symbol === sym); const fsEl = document.fullscreenElement;
    drawChart($('.chart-wrap'), all, { key: sym + range + (iv || '') + count, count: count || all.length, type: ctype, weekly: iv === '1wk', sub: can('CHART') ? S.pref.sub : null, boll: can('CHART') && S.pref.boll, mas: S.pref.mas, pats: S.pref.kpat !== false && can('KLINE'), avg: S.pref.kavg !== false && hh ? hh.avgCost : null, H: fsEl && fsEl.contains($('.chart-wrap')) ? Math.max(400, window.innerHeight - 150) : null });
    if (iv === '1wk') $('#cmsg').textContent = '週 K（' + all[0].d + ' 起）'; else if (S.pref.range === 'C') $('#cmsg').textContent = '自訂區間：近 ' + rcLabel(S.pref.rcDays || 365);
    if (iv !== '1wk') { this.bars = all; this.signals(); this.pro(); }
  },
  fill() {
    const sym = this.sym; const q = S.q[sym] || {}; const us = isUs(sym); const ch = q.price && q.prev ? q.price - q.prev : 0;
    if ($('#book')) this.book();
    $('#sq').innerHTML = `<div class="card"><div class="row wrap" style="align-items:flex-end;gap:18px">
      <div><div class="num ${cls(ch)}" style="font-size:40px;font-weight:800;line-height:1">${fmtPrice(q.price, us)}</div>
        <div class="num ${cls(ch)}" style="font-size:16px;margin-top:4px">${q.price ? arrow(ch) + ' ' + fmt(Math.abs(ch), 2) + '　' + fmtPct(ch / q.prev * 100) : '—'}
        ${q.lu ? '<span class="tag up">漲停</span>' : q.ld ? '<span class="tag down">跌停</span>' : ''}</div>${us ? extHtml(q, true) : ''}${us && !/^\^|=|-USD$/.test(sym) ? '<div style="margin-top:6px">' + usSessLine() + '</div>' : ''}</div>
      <div class="grid g4" style="flex:1;min-width:280px;gap:8px">
        ${[['開盤', fmtPrice(q.open, us)], ['最高', fmtPrice(q.high, us)], ['最低', fmtPrice(q.low, us)], ['昨收', fmtPrice(q.prev, us)],
           ['成交量', q.volLots != null ? fmtInt(q.volLots) + ' 張' : fmtVol(q.vol)], ['漲停', fmtPrice(q.up, us)], ['跌停', fmtPrice(q.down, us)], ['更新', q.time ? hm(q.time) : '—']]
          .map(([k, v]) => `<div><div class="small muted">${k}</div><div class="num">${v}</div></div>`).join('')}</div></div></div>`;
  },
  signals() {
    const el = $('#sig'); if (!el || !this.bars) return;
    if (!can('KLINE')) { el.innerHTML = lockCard('KLINE'); return; }
    const b = this.bars; const c = b.map((x) => x.c); const n = c.length - 1;
    const m5 = sma(c, 5)[n], m20 = sma(c, 20)[n], m60 = sma(c, 60)[n]; const r = rsiArr(c)[n]; const [K, Dd] = kdArr(b.map((x) => x.h), b.map((x) => x.l), c);
    const v5 = sma(b.map((x) => x.v || 0), 5)[n - 1]; const volRatio = v5 ? (b[n].v || 0) / v5 : null;
    const items = [];
    if (m5 && m20 && m60) items.push(m5 > m20 && m20 > m60 ? ['多頭排列', 'up', '均線 5＞20＞60，趨勢向上'] : m5 < m20 && m20 < m60 ? ['空頭排列', 'down', '均線 5＜20＜60，趨勢向下'] : ['均線糾結', 'flat', '短中長均線交錯，方向未明']);
    if (m20) { const bias = (c[n] / m20 - 1) * 100; items.push([`月線乖離 ${fmtPct(bias)}`, bias > 8 ? 'up' : bias < -8 ? 'down' : 'flat', bias > 8 ? '離月線偏遠，留意拉回' : bias < -8 ? '跌離月線偏遠，留意反彈' : '價格貼近月線']); }
    if (r != null) items.push([`RSI ${r.toFixed(1)}`, r >= 70 ? 'up' : r <= 30 ? 'down' : 'flat', r >= 70 ? '超買區' : r <= 30 ? '超賣區' : '中性']);
    if (K[n] != null && K[n - 1] != null) { const gold = K[n - 1] <= Dd[n - 1] && K[n] > Dd[n], dead = K[n - 1] >= Dd[n - 1] && K[n] < Dd[n];
      items.push([`KD ${K[n].toFixed(0)}／${Dd[n].toFixed(0)}`, gold ? 'up' : dead ? 'down' : 'flat', gold ? '黃金交叉' : dead ? '死亡交叉' : K[n] > 80 ? '高檔鈍化區' : K[n] < 20 ? '低檔區' : '無交叉']); }
    if (volRatio != null) items.push([`量比 ${volRatio.toFixed(2)}`, volRatio >= 1.5 ? 'up' : volRatio <= 0.6 ? 'down' : 'flat', volRatio >= 1.5 ? '明顯放量' : volRatio <= 0.6 ? '量縮' : '量能平穩']);
    const score = items.reduce((a, [, c]) => a + (c === 'up' ? 1 : c === 'down' ? -1 : 0), 0);
    el.innerHTML = `<div class="card"><h2>K 線體檢<span class="r tag ${score > 0 ? 'up' : score < 0 ? 'down' : ''}">${score >= 2 ? '偏多' : score <= -2 ? '偏空' : '中性'}</span></h2>
      <div class="list">${items.map(([t, c, d]) => `<div class="it" style="cursor:default"><div class="l"><div class="t1 ${c}">${t}</div><div class="t2">${d}</div></div></div>`).join('')}</div>
      <div class="small muted" style="margin-top:6px">依日 K 線即時計算，僅為分析成果，不構成投資建議；投資有風險，請自行評估並自負盈虧。</div></div>`;
  },
  async info() {
    const t = this.tab(); if (t !== 'ov') return this['t_' + t]();
    const sym = this.sym; const us = isUs(sym);
    // 我的持股與交易
    const h = holdings().find((x) => x.symbol === sym); const q = S.q[sym] || {}; const fx = us ? usdTwd() : 1;
    const ts = D.trades().filter((t) => t.s === sym).sort((a, b) => b.d.localeCompare(a.d));
    let html = `<div class="card"><h2>我的持股</h2>${h ? (() => { const mv = h.shares * (q.price || h.avgCost) * fx; const cost = h.shares * h.avgCost * (us ? (h.avgFx || fx) : 1);
      return `<div class="grid g2"><div><div class="small muted">股數</div><div class="num big">${fmt(h.shares, h.shares % 1 ? 2 : 0)}</div></div><div><div class="small muted">均價</div><div class="num big">${fmtPrice(h.avgCost, us)}</div></div>
        <div><div class="small muted">市值（台幣）</div><div class="num">${fmtInt(mv)}</div></div><div><div class="small muted">未實現損益</div><div class="num ${cls(mv - cost)}">${fmtSigned(mv - cost)}（${fmtPct(cost ? (mv / cost - 1) * 100 : 0)}）</div></div></div>`; })() : '<div class="muted small">尚未持有。</div>'}
      ${ts.length ? `<div class="list" style="margin-top:8px">${ts.slice(0, 8).map((t) => `<div class="it" data-edt="${t.id}"><div class="l"><div class="t1"><span class="tag ${t.t === 'BUY' ? 'up' : t.t === 'SELL' ? 'down' : ''}">${TYPE_N[t.t]}</span> ${esc(t.d)}</div><div class="t2">${t.t === 'SPLIT' ? '1 → ' + t.p : fmt(t.n, 0) + ' 股 @ ' + fmtPrice(t.p, us)}</div></div></div>`).join('')}</div>` : ''}</div>`;
    html = '<div id="adv" style="grid-column:1/-1"></div>' + html;
    html += '<div id="book"></div><div id="sig"></div><div id="kst" class="stack-v" style="grid-column:1/-1;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))"></div><div id="aib"></div><div id="pro" class="stack-v" style="grid-column:1/-1;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))"></div>';
    const note = (kjson('notes', {})[sym] || {}).x || '';
    html += `<div class="card"><h2>我的筆記<span class="r small muted" id="nst"></span></h2><textarea id="note" rows="4" placeholder="記下買進理由、停損停利、觀察重點…（與手機同步）">${esc(note)}</textarea>
      <div class="row" style="margin-top:8px"><span class="small muted">目標占比</span><input id="tgt" type="number" step="0.1" min="0" style="width:90px" value="${kjson('targets', {})[sym] || ''}"><span class="small muted">%（再平衡用）</span>
      <span class="sp"></span><button class="btn sm" id="alrt">＋ 價格提醒</button></div></div>`;
    html += '<div id="fmsnap" style="grid-column:1/-1"></div><div id="peers"></div>';
    $('#si').innerHTML = html;
    fmSnap($('#fmsnap'), sym, () => this.sym === sym && this.tab() === 'ov' && !!$('#fmsnap'));
    $('#note').onchange = () => { const o = kjson('notes', {}); const v = $('#note').value.trim(); if (v) o[sym] = { x: v, t: Date.now() }; else delete o[sym]; ksetJson('notes', o); changed(); $('#nst').textContent = '已儲存'; };
    $('#tgt').onchange = () => { const o = kjson('targets', {}); const v = parseFloat($('#tgt').value); if (v > 0) o[sym] = v; else delete o[sym]; ksetJson('targets', o); changed(); toast('已更新目標占比'); };
    $('#alrt').onclick = () => can('ALERTS') ? alertModal(sym) : toast('提醒為會員功能');
    $$('[data-edt]').forEach((d) => d.onclick = () => tradeModal(D.trades().find((t) => String(t.id) === d.dataset.edt)));
    this.signals(); this.pro(); aiPanel($('#aib'), sym); this.book(); this.stats(); this.peers(); advCard($('#adv'), sym);
  },
  /** 進階分析：三關價、價格位階、分價量、月份季節性（個股進階資料） */
  async pro() {
    const el = $('#pro'); if (!el) return;
    if (!can('STOCKPRO')) { el.innerHTML = lockCard('STOCKPRO', '三關價、價格位階、分價量、月份漲跌（個股進階資料）'); return; }
    // 一律用近兩年日 K 計算（不受圖表區間影響：當日、1 個月、週 K 時資料不足或不是日 K，位階會算不出來）
    const sym = this.sym; const us = isUs(sym); const etf = D.isEtf(sym); const today = ymd();
    const dk = sym + '2y'; const daily = barCache[dk] || (barCache[dk] = await loadBars(sym, '2y'));
    if (S.route !== 's' || this.sym !== sym || !$('#pro')) return;
    const b = (daily || []).slice();
    { const q = S.q[sym]; if (b.length && q && q.price && !us && twOpen()) { const last = b[b.length - 1]; const cur = { d: today, o: q.open || q.price, h: Math.max(q.high || q.price, q.price), l: Math.min(q.low || q.price, q.price), c: q.price, v: q.volLots || 0 }; if (last.d === today) b[b.length - 1] = cur; else b.push(cur); } }
    if (b.length < 30) { el.innerHTML = '<div class="card"><h2>進階分析</h2><div class="small muted">日 K 資料不足（上市未滿 30 個交易日），暫無三關價、位階與分價量。</div></div>'; return; }
    if (this._proKey === sym + b.length + b[b.length - 1].c && $('#proBand')) return;   // 同一份資料不重畫（切換圖表區間時）
    this._proKey = sym + b.length + b[b.length - 1].c;
    const snap = (v) => { if (us) return Math.round(v * 100) / 100; const t = twTick(v, etf); return Math.round(Math.round(v / t) * t * 100) / 100; };
    const base = b[b.length - 1].d === today && b.length > 1 ? b[b.length - 2] : b[b.length - 1];
    const r = base.h - base.l; const kp = [['上關', snap(base.l + r * 1.382)], ['中關', snap((base.h + base.l) / 2)], ['下關', snap(base.h - r * 1.382)]];
    const price = (S.q[sym] || {}).price || b[b.length - 1].c;
    // 分價量：近 60 日依收盤分 12 區
    const pv = b.slice(-60); const lo = Math.min(...pv.map((x) => x.l)), hi = Math.max(...pv.map((x) => x.h)); const bins = Array(12).fill(0); const bw = (hi - lo) / 12 || 1;
    pv.forEach((x) => { const i = Math.min(11, Math.floor(((x.h + x.l + x.c) / 3 - lo) / bw)); bins[i] += x.v || 0; }); const bmax = Math.max(...bins, 1); const poc = bins.indexOf(bmax);
    el.innerHTML = `<div class="card"><h2>三關價<span class="r small muted">依 ${esc(base.d)} 高 ${fmtPx(base.h)}／低 ${fmtPx(base.l)}</span></h2><div class="grid g3">${kp.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v num ${price >= v ? 'up' : 'down'}">${fmtPrice(v)}</div><div class="s muted">${price >= v ? '現價在上方' : '現價在下方'}</div></div>`).join('')}</div>
        <div class="small muted" style="margin-top:6px">上關＝L＋(H−L)×1.382、中關＝(H＋L)÷2、下關＝H−(H−L)×1.382；未調整除權息。</div></div>
      <div class="card" id="proBand"></div>
      <div class="card"><h2>分價量（近 60 日）</h2><div class="vp">${bins.map((v, i) => i).reverse().map((i) => { const p0 = lo + bw * i, p1 = p0 + bw; const here = price >= p0 && price < p1;
        return `<div class="row"><span class="num small" style="width:110px">${fmtPx(p0)}–${fmtPx(p1)}</span><div class="sp"><div style="height:12px;width:${(bins[i] / bmax * 100).toFixed(1)}%;background:${i === poc ? 'var(--warn)' : here ? 'var(--primary)' : '#475569'};border-radius:3px"></div></div><span class="small muted" style="width:70px;text-align:right">${fmtVol(bins[i])}</span></div>`; }).join('')}</div>
        <div class="small muted" style="margin-top:6px">橘色為成交最密集的價區（籌碼支撐／壓力），藍色為目前價格所在區間。</div></div>
      <div class="card" id="season"><h2>月份漲跌</h2><div class="muted small">載入中…</div></div>`;
    { const bd = bandInfo(b, price); const ss = bandSeries(b); const pb = $('#proBand');
      if (bd && ss && pb) { pb.innerHTML = bandCardHtml('價格位階（近一年）', bd, price, fmtPx, 'proBz'); requestAnimationFrame(() => drawBandZ($('#proBz'), ss, price, bd)); }
      else if (pb) pb.innerHTML = '<h2>價格位階（近一年）</h2><div class="small muted">需要至少 60 個交易日的日 K 才能計算位階（目前 ' + b.length + ' 日）。</div>'; }
    const k = 'mx' + sym; const m = barCache[k] || (barCache[k] = await fetchYahoo(ysym(sym), 'max', '1mo', 86400));
    if (S.route !== 's' || this.sym !== sym || !$('#season')) return;
    if (!m || !m.timestamp) { $('#season').innerHTML = '<h2>月份漲跌</h2><div class="muted small">無資料</div>'; return; }
    const c = m.indicators.quote[0].close; const pairs = m.timestamp.map((t, i) => [new Date((t + 8 * 3600) * 1000), c[i]]).filter((x) => x[1] != null);
    const draw = () => { const el = $('#season'); if (!el) return; el.innerHTML = seasonHtml(pairs); seasonBind(el, draw); }; draw();
  },
  async news() {
    const sym = this.sym; const el = $('#news'); if (!el) return;
    if (!can('NEWS')) { el.outerHTML = lockCard('NEWS'); return; }
    const url = isUs(sym) ? 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=' + encodeURIComponent(sym) + '&region=US&lang=en-US'
      : 'https://tw.stock.yahoo.com/rss?s=' + encodeURIComponent(sym);
    let items = [];
    try {
      const xml = new DOMParser().parseFromString(await px(url, 900, 'text'), 'text/xml');
      items = $$('item', xml).slice(0, 10).map((it) => ({ t: (it.querySelector('title') || {}).textContent || '', l: (it.querySelector('link') || {}).textContent || '', d: (it.querySelector('pubDate') || {}).textContent || '' }));
    } catch (e) {}
    if (S.route !== 's' || this.sym !== sym || !$('#news')) return;
    $('#news').innerHTML = `<h2>新聞</h2>${items.length ? `<div class="list">${items.map((n) => `<a class="it" href="${esc(n.l)}" target="_blank" rel="noopener" style="color:inherit"><div class="l"><div class="t1" style="white-space:normal">${esc(n.t)}</div><div class="t2">${n.d ? esc(new Date(n.d).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : ''}</div></div></a>`).join('')}</div>` : '<div class="muted small">目前沒有新聞。</div>'}`;
  },
  syms() { return [this.sym]; },
};

// ───────── 模擬交易（與手機 App 的模擬持股同步） ─────────
const SIMB = { cash: 0, year: new Date().getFullYear(), realized: 0, divTw: 0, divUs: 0 };
function simTrades() { return kjson('sim:trades', []).map((t) => ({ t: t.t, s: t.s, d: t.d, n: t.q, p: t.p, x: t.fx || 1, fee: t.fee || 0, tax: t.tax || 0, id: t.id, o: t.o || '', note: t.n || '' })); }
function simSave(list) { kset('sim:trades', JSON.stringify(list.map((t) => ({ t: t.t, s: t.s, d: t.d, q: t.n, p: t.p, fx: t.x || 1, fee: t.fee || 0, tax: t.tax || 0, id: t.id, o: t.o || '', n: t.note || '' }))), 's'); changed(); }
// ───────── AI 模擬交易（唯讀：手機 App 執行，經雲端同步鍵 ai:sim 帶來精簡帳本） ─────────
const AI_RULE = { COMBINED: '綜合評估', RINGS: '三環 3/3', KBAR: 'K 線訊號' };
const AI_GRP = { TW: '台股', ETF: '台股 ETF', US: '美股' };
function aiSim() { return kjson('ai:sim', null); }
function aiPx(ai, s) { const q = S.q[s]; return (q && q.price) || (ai.px && ai.px[s]) || null; }
function aiName(ai, s) { const n = D.name(s); return n && n !== s ? n : (ai.nm && ai.nm[s]) || ''; }
function aiGrpOf(b) { return b.g || (b.m === 'US' ? 'US' : b.e ? 'ETF' : 'TW'); }
function aiEq(ai, b) { return (b.c || 0) + (b.p || []).reduce((a, p) => a + (aiPx(ai, p.s) || p.a) * p.q * (p.sd || 1), 0); }
// ───────── 網頁 AI 模擬交易（瀏覽器自己跑一份：與手機 App AiSim 同規則；帳本只存在這台瀏覽器，不上傳、不與手機帳本合併） ─────────
const AIW_DEF = { on: false, bt: 1000000, be: 1000000, bu: 30000, sd: 0, mp: 5, pp: 15, ap: 7, ma: 2, iv: 3, ru: ['COMBINED', 'RINGS', 'KBAR'], tw: true, et: true, us: true, pm: 0, n: 15 };
const AIW = { busy: '', last: {}, loop: 0 };
function aiwCfg() {
  const c = { ...AIW_DEF, ...store.get('aiw_cfg', {}) };
  c.ru = (Array.isArray(c.ru) ? c.ru : []).filter((r) => AI_RULE[r]);
  const num = (k, lo, hi) => { const v = +c[k]; c[k] = isFinite(v) ? Math.max(lo, Math.min(hi, v)) : AIW_DEF[k]; };
  num('bt', 10000, 1e9); num('be', 10000, 1e9); num('bu', 1000, 1e8); num('sd', 0, 2); num('mp', 1, 20); num('pp', 1, 100); num('ap', 0, 100); num('ma', 0, 10); num('iv', 1, 60); num('pm', 0, 2); num('n', 3, 36);
  return c;
}
function aiwBooks() { const v = store.get('aiw_books', []); return Array.isArray(v) ? v : []; }
function aiwBudget(c, g) { return g === 'US' ? c.bu : g === 'ETF' ? c.be : c.bt; }
function aiwGrpOn(c, g) { return g === 'US' ? c.us : g === 'ETF' ? c.et : c.tw; }
function aiwEnsure(c, bs = aiwBooks()) {
  bs = bs.slice();
  Object.keys(AI_GRP).forEach((g) => c.ru.forEach((r) => { if (!bs.some((b) => b.r === r && aiGrpOf(b) === g)) { const bud = aiwBudget(c, g); bs.push({ r, m: g === 'US' ? 'US' : 'TW', g, e: g === 'ETF', b: bud, c: bud, p: [], x: [], d: {}, cd: {} }); } }));
  return bs;
}
/** 盤中時段：台股 09:00–13:30、美股 09:30–16:00（美東），週一至週五；休市日以報價時間判斷 */
function aiwSess(g) {
  if (g !== 'US') { const d = tpeNow(); const m = d.getHours() * 60 + d.getMinutes(); return d.getDay() >= 1 && d.getDay() <= 5 && m >= 540 && m <= 810; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const m = +p.hour * 60 + +p.minute; return p.weekday !== 'Sat' && p.weekday !== 'Sun' && m >= 570 && m <= 960;
}
function aiwDay(g) { return g === 'US' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) : ymd().replace(/\//g, '-'); }
// 費用模型（與 App AppCosts 相同概念）：台股手續費依第一個台股帳戶折扣、證交稅、融券費 0.08%；美股不計手續費
function aiwGross(m, n, p) { return m === 'TW' ? Math.floor(Math.round(n * p * 1e6) / 1e6) : Math.round(n * p * 100) / 100; }
function aiwFee(m, g) { if (m !== 'TW') return 0; const a = D.accounts().find((x) => x.m !== 'US'); return twFee(g, a && a.d ? a.d : 1, a && a.min != null ? a.min : 20); }
function aiwTax(m, s, g) { return m === 'TW' ? Math.floor(g * twTaxRate(s)) : 0; }
function aiwBorrow(m, g) { return m === 'TW' ? Math.floor(g * 0.0008) : 0; }
/** 開倉或加碼（與 App AiSim.open 相同） */
function aiwOpen(b, s, side, price, amount, stop, target, why, day, now) {
  const sh = price > 0 ? Math.floor(amount / price + 1e-9) : 0; if (sh <= 0) return null;
  const g = aiwGross(b.m, sh, price); const fee = aiwFee(b.m, g); const ex = b.p.find((p) => p.s === s);
  const merge = (val) => ex ? { ...ex, q: ex.q + sh, a: (ex.a * ex.q + price * sh) / (ex.q + sh), bs: ex.bs + val, ad: (ex.ad || 0) + 1, ld: day }
    : { s, sd: side, q: sh, a: price, bs: val, st: stop, tg: target, od: day, oa: now, ad: 0, ld: day, w: why };
  if (side > 0) { const cost = g + fee; if (cost > b.c) return null; return { ...b, c: b.c - cost, p: b.p.filter((p) => p.s !== s).concat(merge(cost)) }; }
  const net = g - fee - aiwTax(b.m, s, g) - aiwBorrow(b.m, g); if (g > b.c) return null;
  return { ...b, c: b.c + net, p: b.p.filter((p) => p.s !== s).concat(merge(net)) };
}
/** 全部平倉（與 App AiSim.close 相同） */
function aiwClose(b, s, price, exit, day) {
  const p = b.p.find((x) => x.s === s); if (!p) return b;
  const g = aiwGross(b.m, p.q, price); const fee = aiwFee(b.m, g);
  let dc, pl; if (p.sd > 0) { const net = g - fee - aiwTax(b.m, s, g); dc = net; pl = net - p.bs; } else { const cost = g + fee; dc = -cost; pl = p.bs - cost; }
  const base = p.sd > 0 ? p.bs : aiwGross(b.m, p.q, p.a); const dy = Math.max(0, Math.round((Date.parse(day) - Date.parse(p.od)) / 864e5)) || 0;
  const x = { s, sd: p.sd, q: p.q, a: p.a, cl: price, pl, pp: base > 0 ? pl / base * 100 : 0, od: p.od, cd: day, dy, w: p.w, e: exit };
  return { ...b, c: b.c + dc, p: b.p.filter((y) => y.s !== s), x: (b.x || []).concat(x).slice(-500), cd: { ...(b.cd || {}), [s]: day } };
}
/** 依規則決定動作（與 App AiSim.decide 相同）：{ k: open／add／close, sd, st, tg, note } */
function aiwDecide(rule, s, held, c, today, cooled) {
  const p = s.price; const f = fmtPrice;
  if (held) {
    const L = held.sd > 0;
    if (L && p <= held.st) return { k: 'close', note: '跌破停損 ' + f(held.st) };
    if (L && p >= held.tg) return { k: 'close', note: '到達目標 ' + f(held.tg) };
    if (!L && p >= held.st) return { k: 'close', note: '突破停損 ' + f(held.st) };
    if (!L && p <= held.tg) return { k: 'close', note: '到達目標 ' + f(held.tg) };
    if (rule === 'COMBINED') { if (L && s.dec === 'NOT') return { k: 'close', note: '評估轉為條件未符合' }; if (!L && (s.al || 0) >= 1) return { k: 'close', note: '評估轉為偏多' }; }
    if (rule === 'RINGS' && s.rg && s.rg.level === 0) return { k: 'close', note: '三環回到 0/3' };
    if (rule === 'KBAR') { if (L && (s.kl || 0) <= -1) return { k: 'close', note: 'K 線訊號轉弱' }; if (!L && (s.kl || 0) >= 1) return { k: 'close', note: 'K 線訊號轉強' }; }
    if ((held.ad || 0) >= c.ma || held.ld === today || c.ap <= 0) return null;
    const ok = rule === 'COMBINED' ? L && (((s.rg && s.rg.level) || 0) >= 3 || (s.lmax != null && p <= s.lmax && p < held.a))
      : rule === 'RINGS' ? L && s.rg && s.rg.level >= 3 && p <= (s.rg.zoneLo + s.rg.zoneHi) / 2
      : L ? (s.kl || 0) >= 2 && p < held.a : (s.kl || 0) <= -2 && p > held.a;
    return ok ? { k: 'add', note: '加碼' } : null;
  }
  if (cooled) return null;
  const wl = c.sd !== 1, ws = c.sd !== 0;
  if (rule === 'COMBINED') {
    if (wl && s.dec === 'MET' && s.ls != null && s.lt != null) return { k: 'open', sd: 1, st: s.ls, tg: s.lt, note: '條件符合' };
    const rr = s.ss != null && s.st != null && s.ss > p && s.st < p ? (p - s.st) / (s.ss - p) : 0;
    if (ws && (s.al || 0) <= -1 && s.ss != null && s.st != null && rr >= 1.5) return { k: 'open', sd: -1, st: s.ss, tg: s.st, note: '評估轉弱（做空）' };
  } else if (rule === 'RINGS') {
    if (wl && s.rg && s.rg.level >= 3) return { k: 'open', sd: 1, st: s.rg.stop, tg: s.rg.target, note: '三環 3/3' };
  } else if (rule === 'KBAR') {
    if (wl && (s.kl || 0) >= 2 && s.ls != null && s.lt != null && s.ls < p && s.lt > p) return { k: 'open', sd: 1, st: s.ls, tg: s.lt, note: '訊號偏多' };
    if (ws && (s.kl || 0) <= -2 && s.ss != null && s.st != null && s.ss > p && s.st < p) return { k: 'open', sd: -1, st: s.ss, tg: s.st, note: '訊號轉弱（做空）' };
  }
  return null;
}
/** 一檔的訊號快照（綜合進場評估、日 K、三環；與 App AiSim.signal 相同來源） */
async function aiwSig(sym, needAdv) {
  const b = await liveBars(sym, '2y'); if (b.length < 60) return null;
  const d = klineAnalyze(b); if (!d) return null;
  const price = (S.q[sym] || {}).price; if (!(price > 0)) return null;
  const a = needAdv ? await entryAdviceCached(sym, 600000) : null;
  let rg = null; try { const wk = klineAnalyze(weeklyBars(await liveBars(sym, '5y'))); if (wk) rg = ringsEval(ringsInput(price, d, wk), 0); } catch (e) {}
  const lp = (a && a.plan) || d.longPlan; const sp = d.shortPlan;
  const dec = a ? tdSummary(a.level, a.ratio, price, lp ? lp.stop : null, lp ? lp.tp1 : null, lp ? lp.e0 : null, lp ? lp.e1 : null).state : null;
  return { price, dec, ls: lp ? lp.stop : null, lt: lp ? lp.tp1 : null, lmax: lp && lp.e0 != null && lp.e1 != null ? Math.max(lp.e0, lp.e1) : null,
    ss: sp ? sp.stop : null, st: sp ? sp.tp1 : null, kl: d.entry ? d.entry.level : 0, al: a ? a.level : null, rg };
}
/** 選股：模擬持倉優先，再加自動選股（與星團相同來源）／自選清單，最多 topN 檔 */
async function aiwPool(g, c, bs) {
  const fits = (s) => g === 'US' ? isUs(s) : !isUs(s) && (g === 'ETF') === /^00/.test(s);
  const held = new Set(bs.filter((b) => aiGrpOf(b) === g).flatMap((b) => b.p.map((p) => p.s)));
  const out = new Set();
  if (c.pm !== 1) try { (await starPool(g)).forEach((s) => out.add(s)); } catch (e) {}
  if (c.pm !== 0) D.quotes().map((q) => q.s).forEach((s) => out.add(s));
  const rest = Array.from(out).filter((s) => fits(s) && !held.has(s)).slice(0, c.n);
  return Array.from(held).concat(rest);
}
function aiwStat(b, px) {
  const x = b.x || []; const win = x.length ? x.filter((v) => v.pl > 0).length / x.length : null;
  const gw = x.filter((v) => v.pl > 0).reduce((a, v) => a + v.pl, 0), gl = -x.filter((v) => v.pl < 0).reduce((a, v) => a + v.pl, 0);
  let peak = b.b, mdd = 0; Object.keys(b.d || {}).sort().forEach((k) => { const v = b.d[k]; if (v > peak) peak = v; if (peak > 0) mdd = Math.max(mdd, (peak - v) / peak * 100); });
  const by = {}; x.forEach((v) => { (by[v.w] = by[v.w] || []).push(v); });
  const rs = Object.entries(by).sort((a, c) => c[1].length - a[1].length).slice(0, 6).map(([w, l]) => ({ w, n: l.length, win: l.filter((v) => v.pl > 0).length / l.length, avg: l.reduce((a, v) => a + v.pp, 0) / l.length }));
  return { n: x.length, win, pf: gl > 0 ? gw / gl : null, real: x.reduce((a, v) => a + v.pl, 0), mdd, eq: aiEq({ px }, b), rs };
}
/** 給 aiSimHtml 用的檢視資料（與手機雲端帳本 ai:sim 同格式） */
function aiwView() {
  const c = aiwCfg(); const px = store.get('aiw_px', {}); const nm = store.get('aiw_nm', {});
  const books = aiwEnsure(c).filter((b) => c.ru.includes(b.r)).map((b) => ({ ...b, st: aiwStat(b, px) }));
  return { at: store.get('aiw_run', 0), msg: store.get('aiw_msg', ''), cfg: { on: c.on, sd: c.sd, tw: c.tw, et: c.et, us: c.us, ru: c.ru }, px, nm, books };
}
/** 執行一輪（未開啟、非盤中、間隔未到的分組略過；force 只略過間隔） */
async function aiwTick(force) {
  const c = aiwCfg(); if ((!c.on && !force) || AIW.busy) return -1;
  const grps = Object.keys(AI_GRP).filter((g) => aiwGrpOn(c, g) && aiwSess(g) && (force || Date.now() - (AIW.last[g] || 0) >= c.iv * 60000 - 5000));
  if (!grps.length) return -1;
  let acts = 0; const px = store.get('aiw_px', {}); const nm = store.get('aiw_nm', {});
  try {
    let bs = aiwEnsure(c);
    for (const g of grps) {
      AIW.last[g] = Date.now(); AIW.busy = AI_GRP[g]; aiwStatus();
      const day = aiwDay(g); const syms = await aiwPool(g, c, bs);
      await refreshQuotes(syms).catch(() => {});
      const needAdv = c.ru.includes('COMBINED');
      for (const s of syms) {
        const q = S.q[s]; if (!q || !(q.price > 0)) continue;
        if (q.time && Date.now() - q.time > 30 * 60000) continue; // 報價不是近 30 分鐘（休市或停牌）就略過
        const sig = await aiwSig(s, needAdv).catch(() => null); if (!sig) continue;
        const now = Date.now();
        bs = bs.map((b) => {
          if (aiGrpOf(b) !== g || !c.ru.includes(b.r)) return b;
          const held = b.p.find((p) => p.s === s);
          const act = aiwDecide(b.r, sig, held, c, day, (b.cd || {})[s] === day); if (!act) return b;
          const nb = act.k === 'close' ? aiwClose(b, s, q.price, act.note, day)
            : act.k === 'add' ? aiwOpen(b, s, held.sd, q.price, b.b * c.ap / 100, held.st, held.tg, held.w, day, now)
            : b.p.length >= c.mp ? null : aiwOpen(b, s, act.sd, q.price, b.b * c.pp / 100, act.st, act.tg, act.note, day, now);
          if (nb && nb !== b) { acts++; if (q.name) nm[s] = q.name; }
          return nb || b;
        });
      }
      const live = new Set(bs.flatMap((b) => b.p.map((p) => p.s)));
      live.forEach((s) => { const q = S.q[s]; if (q && q.price > 0) px[s] = q.price; if (q && q.name) nm[s] = q.name; });
      Object.keys(px).forEach((s) => { if (!live.has(s)) delete px[s]; });
      bs = bs.map((b) => { if (aiGrpOf(b) !== g) return b;
        const d = { ...(b.d || {}), [day]: aiEq({ px }, b) }; const ks = Object.keys(d).sort(); ks.slice(0, Math.max(0, ks.length - 400)).forEach((k) => delete d[k]);
        const cd = {}; Object.entries(b.cd || {}).forEach(([k, v]) => { if (v === day) cd[k] = v; });
        return { ...b, d, cd }; });
    }
    const keepNm = new Set(bs.flatMap((b) => b.p.map((p) => p.s).concat((b.x || []).slice(-50).map((x) => x.s)))); Object.keys(nm).forEach((s) => { if (!keepNm.has(s)) delete nm[s]; });
    store.set('aiw_books', bs); store.set('aiw_px', px); store.set('aiw_nm', nm);
    store.set('aiw_run', Date.now()); store.set('aiw_msg', '模擬執行 ' + acts + ' 筆（' + grps.map((g) => AI_GRP[g]).join('、') + '）');
  } finally { AIW.busy = ''; aiwStatus(); }
  if ($('#aiwBox')) VIEWS.sim.fill();
  return acts;
}
function aiwStatus() {
  const el = $('#aiwSt'); if (!el) return;
  const at = store.get('aiw_run', 0);
  el.textContent = AIW.busy ? '執行中：' + AIW.busy + '…' : (at ? '上次執行 ' + new Date(at).toLocaleDateString('zh-TW') + ' ' + hm(at) + '・' + store.get('aiw_msg', '') : '尚未執行');
}
/** 分頁開著且看得見時，每 30 秒檢查一次是否到了執行間隔 */
function aiwStart() {
  if (AIW.loop) return;
  AIW.loop = setInterval(() => { if (document.hidden) return; aiwTick(false).catch(() => {}); }, 30000);
  setTimeout(() => aiwTick(false).catch(() => {}), 8000);
}
try { if (aiwCfg().on) aiwStart(); } catch (e) {}
function aiSimHtml() {
  const web = S.pref.aiSrc === 'web';
  const src = `<div class="row wrap" style="margin-bottom:12px;align-items:center"><div class="seg" id="aiS"><button data-asrc="phone" class="${web ? '' : 'on'}">手機帳本</button><button data-asrc="web" class="${web ? 'on' : ''}">網頁帳本</button></div><span class="small muted">兩本帳各自獨立，不會合併</span></div>`;
  if (web) {
    const ai = aiwView();
    return src + `<div id="aiwBox"><div class="notice" style="margin-bottom:12px">網頁帳本由這個瀏覽器在分頁開著時，於盤中依與手機相同的規則自動執行（獨立虛擬帳本，只存在這台瀏覽器、不上傳雲端、不與手機帳本合併，不計入真實資產）。<span id="aiwSt"></span>。損益為依規則試算的模擬結果，不是買賣指令。</div>${aiwPanel()}${aiBooksHtml(ai, '網頁')}</div>`;
  }
  const ai = aiSim();
  if (!ai || !Array.isArray(ai.books)) return src + `<div class="card"><h2>AI 模擬交易</h2><div class="text2">還沒有收到手機的 AI 模擬帳本。</div>
    <ul class="text2 small"><li>AI 模擬交易在手機 App 盤中自動執行（持股 › AI 模擬交易）。</li><li>手機登入同一帳號，「帳號與同步」設為<b>手機為主</b>並開啟自動同步後，網頁就會顯示三組帳本（台股、台股 ETF、美股）。</li><li>也可以切到「網頁帳本」，讓這個瀏覽器自己跑一份。</li></ul></div>`;
  return src + `<div class="notice" style="margin-bottom:12px">AI 模擬交易由手機 App 在盤中依規則自動執行，這裡是唯讀檢視（獨立虛擬帳本，不計入真實資產）。手機更新 ${ai.at ? esc(new Date(ai.at).toLocaleDateString('zh-TW') + ' ' + hm(ai.at)) : '—'}${ai.cfg && !ai.cfg.on ? ' · 手機目前已暫停自動執行' : ''}。損益為依規則試算的模擬結果，不是買賣指令。</div>` + aiBooksHtml(ai, '手機');
}
/** 網頁帳本的設定卡（只存在這台瀏覽器） */
function aiwPanel() {
  const c = aiwCfg(); const sess = Object.keys(AI_GRP).filter((g) => aiwGrpOn(c, g) && aiwSess(g)).map((g) => AI_GRP[g]);
  const n = (id, label, v, step, unit) => `<div class="field"><label>${label}${unit ? '<span class="muted">（' + unit + '）</span>' : ''}</label><input id="aw_${id}" type="number" step="${step}" value="${v}"></div>`;
  const ck = (attr, k, label, on) => `<label style="display:inline-flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap"><input type="checkbox" style="width:auto;margin:0" ${attr}="${k}" ${on ? 'checked' : ''}>${label}</label>`;
  return `<div class="card" style="margin-bottom:12px"><h2>網頁帳本設定<span class="r"><label style="display:inline-flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap"><input type="checkbox" id="aiwOn" style="width:auto;margin:0" ${c.on ? 'checked' : ''}><b>${c.on ? '自動執行中' : '已暫停'}</b></label></span></h2>
    <div class="small text2">${c.on ? (sess.length ? '目前盤中：' + sess.join('、') + '，每 ' + c.iv + ' 分鐘執行一次（分頁需開著）' : '目前非盤中，開盤後分頁開著就會自動執行') : '打開右上開關後，盤中且分頁開著時自動執行'}</div>
    <details style="margin-top:8px"${c.on ? '' : ' open'}><summary class="small" style="cursor:pointer;font-weight:700">規則與參數</summary>
    <div class="row wrap" style="gap:14px;margin-top:8px"><span class="small muted">分組</span>${ck('data-awg', 'tw', '台股', c.tw)}${ck('data-awg', 'et', '台股 ETF', c.et)}${ck('data-awg', 'us', '美股', c.us)}</div>
    <div class="row wrap" style="gap:14px;margin-top:6px"><span class="small muted">規則</span>${Object.keys(AI_RULE).map((r) => ck('data-awr', r, AI_RULE[r], c.ru.includes(r))).join('')}</div>
    <div class="grid g3" style="margin-top:8px;gap:8px">
      <div class="field"><label>方向</label><select id="aw_sd">${['只做多', '只做空', '雙向'].map((t, i) => `<option value="${i}" ${c.sd === i ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>選股來源</label><select id="aw_pm">${['自動選股', '自選清單', '自動＋自選'].map((t, i) => `<option value="${i}" ${c.pm === i ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      ${n('n', '每組掃描檔數', c.n, 1)}${n('bt', '台股本金', c.bt, 10000, '元')}${n('be', '台股 ETF 本金', c.be, 10000, '元')}${n('bu', '美股本金', c.bu, 1000, '美元')}
      ${n('mp', '最多持倉檔數', c.mp, 1)}${n('pp', '每檔首次投入', c.pp, 1, '% 本金')}${n('ap', '每次加碼', c.ap, 1, '% 本金')}${n('ma', '最多加碼次數', c.ma, 1)}${n('iv', '執行間隔', c.iv, 1, '分鐘')}</div>
    <div class="small muted" style="margin-top:4px">本金變更在「重設帳本」後才套用到新帳本；規則說明：${Object.keys(AI_RULE).map((r) => esc(AI_RULE[r])).join('、')}，與手機 App 相同。</div>
    <div class="row wrap" style="gap:8px;margin-top:8px"><button class="btn primary" id="aiwSave">儲存設定</button><button class="btn" id="aiwRun">立即執行一次</button><button class="btn danger" id="aiwReset">重設網頁帳本</button></div></details></div>`;
}
/** 帳本內容（手機與網頁共用：分組、規則並排、持倉、條件統計、已平倉） */
function aiBooksHtml(ai, who) {
  const grps = Object.keys(AI_GRP); const g = grps.includes(S.pref.aiGrp) ? S.pref.aiGrp : 'TW';
  const bs = ai.books.filter((b) => aiGrpOf(b) === g && AI_RULE[b.r]);
  const rules = bs.map((b) => b.r); const r = rules.includes(S.pref.aiRule) ? S.pref.aiRule : rules[0];
  const b = bs.find((x) => x.r === r); const us = g === 'US'; const cur = us ? '美元' : '元';
  const on = ai.cfg && ai.cfg[{ TW: 'tw', ETF: 'et', US: 'us' }[g]] !== false;
  let h = `<div class="row wrap" style="margin-bottom:12px"><div class="seg" id="aiG">${grps.map((k) => `<button data-ag="${k}" class="${g === k ? 'on' : ''}">${AI_GRP[k]}</button>`).join('')}</div>${on ? '' : '<span class="small muted">此分組在' + who + '已關閉</span>'}</div>`;
  h += `<div class="card scroll-x" style="margin-bottom:12px"><h2>規則並排比較<span class="r small muted">${cur}</span></h2><table class="tbl"><thead><tr><th>規則</th><th>權益</th><th>報酬率</th><th>已實現</th><th>勝率</th><th>獲利因子</th><th>最大回撤</th><th>平倉筆數</th><th>持倉</th></tr></thead><tbody>${bs.map((x) => {
    const eq = aiEq(ai, x), ret = x.b ? (eq - x.b) / x.b * 100 : 0, st = x.st || {};
    return `<tr class="click" data-ar="${x.r}"><td class="nm">${r === x.r ? '▸ ' : ''}${esc(AI_RULE[x.r])}</td><td class="num">${fmtInt(eq)}</td><td class="num ${cls(ret)}">${fmtPct(ret)}</td><td class="num ${cls(st.real)}">${fmtSigned(st.real)}</td>
      <td class="num">${st.win == null ? '—' : fmt(st.win * 100, 0) + '%'}</td><td class="num">${st.pf == null ? (st.n ? '∞' : '—') : fmt(st.pf, 2)}</td><td class="num">${st.mdd == null ? '—' : fmt(st.mdd, 1) + '%'}</td><td class="num">${st.n || 0}</td><td class="num">${(x.p || []).length}</td></tr>`; }).join('')}</tbody></table></div>`;
  if (!b) return h + '<div class="empty">此分組沒有帳本' + (who === '網頁' ? '（請在設定勾選規則）' : '') + '。</div>';
  const pos = (b.p || []).slice().sort((a, c) => (c.oa || 0) - (a.oa || 0));
  h += `<div class="card scroll-x" style="margin-bottom:12px"><h2>${esc(AI_RULE[b.r])}・模擬持倉（${pos.length}）</h2>${pos.length ? `<table class="tbl"><thead><tr><th>個股</th><th>方向</th><th>股數</th><th>均價</th><th>現價</th><th>停損</th><th>目標</th><th>損益</th><th>報酬率</th><th>觸發條件</th></tr></thead><tbody>${pos.map((p) => {
    const now = aiPx(ai, p.s) || p.a, sd = p.sd || 1, un = (now - p.a) * p.q * sd, pct = p.a ? (now - p.a) / p.a * 100 * sd : 0;
    return `<tr class="click" data-go="#/s/${esc(p.s)}"><td class="nm">${esc(aiName(ai, p.s))} <span class="muted small num">${esc(p.s)}</span></td><td>${sd > 0 ? '多' : '空'}</td><td class="num">${fmt(p.q, p.q % 1 ? 2 : 0)}</td><td class="num">${fmtPrice(p.a)}</td><td class="num">${fmtPrice(now)}</td>
      <td class="num">${fmtPrice(p.st)}</td><td class="num">${fmtPrice(p.tg)}</td><td class="num ${cls(un)}">${fmtSigned(un)}</td><td class="num ${cls(pct)}">${fmtPct(pct)}</td><td class="small">${esc(p.w || '')}${p.ad ? '・加碼 ' + p.ad + ' 次' : ''}</td></tr>`; }).join('')}</tbody></table>` : '<div class="muted small">目前沒有模擬持倉。</div>'}</div>`;
  const rs = (b.st && b.st.rs) || [];
  if (rs.length) h += `<div class="card scroll-x" style="margin-bottom:12px"><h2>依觸發條件統計</h2><table class="tbl"><thead><tr><th>條件</th><th>筆數</th><th>勝率</th><th>平均報酬</th></tr></thead><tbody>${rs.map((x) => `<tr><td>${esc(x.w)}</td><td class="num">${x.n}</td><td class="num">${fmt((x.win || 0) * 100, 0)}%</td><td class="num ${cls(x.avg)}">${fmtPct(x.avg)}</td></tr>`).join('')}</tbody></table></div>`;
  const xs = (b.x || []).slice(-50).reverse();
  h += `<div class="card"><h2>已平倉（最近 ${xs.length} 筆）</h2>${xs.length ? `<div class="list">${xs.map((x) => `<div class="it click" data-go="#/s/${esc(x.s)}"><span class="tag ${(x.sd || 1) > 0 ? 'up' : 'down'}">${(x.sd || 1) > 0 ? '多' : '空'}</span>
    <div class="l"><div class="t1">${esc(aiName(ai, x.s))} <span class="muted small num">${esc(x.s)}</span> <span class="muted small">${esc(String(x.od || '').slice(5).replace('-', '/'))} → ${esc(String(x.cd || '').slice(5).replace('-', '/'))}</span></div>
    <div class="t2">${fmtPrice(x.a)} → ${fmtPrice(x.cl)}・${esc(x.w || '')}／${esc(x.e || '')}</div></div><div class="r num ${cls(x.pl)}">${fmtSigned(x.pl)}<div class="small">${fmtPct(x.pp)}</div></div></div>`).join('')}</div>` : '<div class="muted small">尚無平倉紀錄。</div>'}</div>`;
  return h;
}
function aiSimBind() {
  $$('[data-asrc]').forEach((x) => x.onclick = () => { S.pref.aiSrc = x.dataset.asrc; savePref(); VIEWS.sim.fill(); });
  $$('[data-ag]').forEach((x) => x.onclick = () => { S.pref.aiGrp = x.dataset.ag; savePref(); VIEWS.sim.fill(); });
  $$('[data-ar]').forEach((x) => x.onclick = () => { S.pref.aiRule = x.dataset.ar; savePref(); VIEWS.sim.fill(); });
  if (!$('#aiwBox')) return;
  aiwStatus();
  const read = () => { const c = aiwCfg(); ['bt', 'be', 'bu', 'mp', 'pp', 'ap', 'ma', 'iv', 'n', 'sd', 'pm'].forEach((k) => { const el = $('#aw_' + k); if (el && el.value !== '') c[k] = +el.value; });
    $$('[data-awg]').forEach((x) => { c[x.dataset.awg] = x.checked; }); c.ru = $$('[data-awr]').filter((x) => x.checked).map((x) => x.dataset.awr); return c; };
  $('#aiwOn').onchange = (e) => { const c = aiwCfg(); c.on = e.target.checked; store.set('aiw_cfg', c); if (c.on) aiwStart(); toast(c.on ? '網頁帳本已開啟自動執行（盤中、分頁開著時）' : '網頁帳本已暫停'); VIEWS.sim.fill(); };
  $('#aiwSave').onclick = () => { const c = read(); c.on = aiwCfg().on; store.set('aiw_cfg', c); toast('已儲存網頁帳本設定'); VIEWS.sim.fill(); };
  $('#aiwRun').onclick = async () => { const c = read(); c.on = aiwCfg().on; store.set('aiw_cfg', c);
    if (!Object.keys(AI_GRP).some((g) => aiwGrpOn(aiwCfg(), g) && aiwSess(g))) return toast('目前非盤中，沒有可執行的分組', 3000);
    if (AIW.busy) return toast('正在執行中…');
    const n = await aiwTick(true).catch(() => -1); toast(n >= 0 ? '模擬執行 ' + n + ' 筆' : '這次沒有執行'); };
  $('#aiwReset').onclick = async () => { if ((await dialog('重設網頁帳本', '清除網頁帳本的模擬持倉、平倉紀錄與權益，並以目前設定的本金重新開始？（手機帳本不受影響）', [['', '取消'], ['ok', '重設', 'primary']])) !== 'ok') return;
    ['aiw_books', 'aiw_px', 'aiw_nm', 'aiw_run', 'aiw_msg'].forEach((k) => store.del(k)); AIW.last = {}; toast('已重設網頁帳本'); VIEWS.sim.fill(); };
}
VIEWS.sim = {
  title: '模擬交易',
  render() { const ai = S.pref.simTab === 'ai';
    return head('模擬交易', `<span class="seg" id="simT"><button data-st="man" class="${ai ? '' : 'on'}">手動模擬</button><button data-st="ai" class="${ai ? 'on' : ''}">AI 模擬交易</button></span>` + (ai ? '' : `<button class="btn" id="sSell">模擬賣出</button><button class="btn primary" id="sBuy">＋ 模擬買進</button>`)) + '<div id="dyn"></div>'; },
  bind() { $$('[data-st]').forEach((b) => b.onclick = () => { S.pref.simTab = b.dataset.st; savePref(); route(); });
    if ($('#sBuy')) { $('#sBuy').onclick = () => simModal('BUY'); $('#sSell').onclick = () => simModal('SELL'); } },
  fill() {
    if (S.pref.simTab === 'ai') { $('#dyn').innerHTML = aiSimHtml(); aiSimBind(); return; }
    const ts = simTrades(); const lg = ledger(ts, { base: SIMB }); const fx = usdTwd();
    if (lg.err) { $('#dyn').innerHTML = `<div class="notice err">${esc(lg.err)}</div>`; return; }
    const rows = lg.holdings.map((h) => { const q = S.q[h.symbol] || {}; const us = isUs(h.symbol); const f = us ? fx : 1; const price = q.price || h.avgCost;
      const mv = h.shares * price * f, cost = h.shares * h.avgCost * (us ? (h.avgFx || fx) : 1); return { ...h, us, price, q, mv, cost, pl: mv - cost, day: q.price && q.prev ? (q.price - q.prev) * h.shares * f : 0 }; });
    const mv = rows.reduce((a, r) => a + r.mv, 0), cost = rows.reduce((a, r) => a + r.cost, 0), pl = mv - cost, day = rows.reduce((a, r) => a + r.day, 0);
    const realized = Object.values(lg.realizedById).reduce((a, v) => a + v, 0), divs = Object.values(lg.dividendById).reduce((a, v) => a + v, 0);
    const invested = ts.filter((t) => t.t === 'BUY' && t.o !== 'AUTO').reduce((a, t) => a + (tGross(t) + t.fee) * (isUs(t.s) ? t.x : 1), 0);
    const total = pl + realized + divs;
    let h = `<div class="notice" style="margin-bottom:12px">模擬持股不計入真實資產；與手機 App「模擬交易」同步，手機會自動補上除權息與拆股紀錄。</div>
      <div class="card" style="margin-bottom:12px"><div class="small muted">總報酬（含已實現與股息）</div><div class="num ${cls(total)}" style="font-size:34px;font-weight:800">${fmtSigned(total)} <span style="font-size:18px">${invested ? fmtPct(total / invested * 100) : ''}</span></div>
      <div class="grid g4" style="margin-top:10px"><div class="tile"><div class="k">市值</div><div class="v num">${fmtInt(mv)}</div></div><div class="tile"><div class="k">未實現</div><div class="v num ${cls(pl)}">${fmtSigned(pl)}</div></div>
      <div class="tile"><div class="k">今日</div><div class="v num ${cls(day)}">${fmtSigned(day)}</div></div><div class="tile"><div class="k">已實現＋股息</div><div class="v num ${cls(realized + divs)}">${fmtSigned(realized + divs)}</div></div></div></div>`;
    h += `<div class="card scroll-x" style="margin-bottom:12px"><h2>模擬持股</h2>${rows.length ? `<table class="tbl"><thead><tr><th>個股</th><th>股數</th><th>均價</th><th>現價</th><th>今日</th><th>市值</th><th>損益</th><th>報酬率</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr class="click" data-go="#/s/${r.symbol}">
      <td class="nm">${esc(D.name(r.symbol))} <span class="muted small num">${r.symbol}</span></td><td class="num">${fmt(r.shares, r.shares % 1 ? 2 : 0)}</td><td class="num">${fmtPrice(r.avgCost)}</td><td class="num ${cls(r.q.price - r.q.prev)}">${fmtPrice(r.price)}</td>
      <td class="num ${cls(r.day)}">${fmtSigned(r.day)}</td><td class="num">${fmtInt(r.mv)}</td><td class="num ${cls(r.pl)}">${fmtSigned(r.pl)}</td><td class="num ${cls(r.pl)}">${fmtPct(r.cost ? r.pl / r.cost * 100 : 0)}</td>
      <td><button class="btn sm" data-ss="${r.symbol}">賣出</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">尚無模擬持股，按「模擬買進」開始。</div>'}</div>`;
    h += `<div class="card"><h2>模擬交易紀錄</h2>${ts.length ? `<div class="list">${ts.slice().sort((a, b) => (b.d + b.id).localeCompare(a.d + a.id)).slice(0, 100).map((t) => `<div class="it" style="cursor:default"><span class="tag ${t.t === 'BUY' ? 'up' : t.t === 'SELL' ? 'down' : ''}">${t.o === 'AUTO' ? '自動' : ''}${TYPE_N[t.t]}</span>
      <div class="l"><div class="t1">${esc(D.name(t.s))} <span class="muted small num">${t.s}</span></div><div class="t2">${esc(t.d)} · ${t.t === 'SPLIT' ? '1 → ' + t.p : fmt(t.n, t.n % 1 ? 2 : 0) + ' 股 @ ' + fmtPrice(t.p)}</div></div>
      <div class="r num ${cls(lg.realizedById[t.id] || 0)}">${lg.realizedById[t.id] != null ? fmtSigned(lg.realizedById[t.id]) : lg.dividendById[t.id] != null ? fmtInt(lg.dividendById[t.id]) : ''}</div>
      ${t.o === 'AUTO' ? '' : `<button class="btn sm danger" data-sd="${t.id}">刪除</button>`}</div>`).join('')}</div>` : '<div class="muted small">尚無紀錄。</div>'}</div>`;
    $('#dyn').innerHTML = h;
    $$('[data-ss]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); simModal('SELL', b.dataset.ss); });
    $$('[data-sd]').forEach((b) => b.onclick = async () => { const list = simTrades().filter((t) => String(t.id) !== b.dataset.sd); const r = ledger(list, { base: SIMB }); if (r.err) return toast('無法刪除：' + r.err, 3500);
      if ((await dialog('刪除模擬交易', '確定刪除？', [['', '取消'], ['ok', '刪除', 'primary']])) !== 'ok') return; simSave(list); this.fill(); });
  },
  syms() { if (S.pref.simTab === 'ai') { const ai = S.pref.aiSrc === 'web' ? aiwView() : aiSim(); return ai && ai.books ? Array.from(new Set(ai.books.flatMap((b) => (b.p || []).map((p) => p.s)))) : []; } return Array.from(new Set(simTrades().map((t) => t.s))); },
};
async function simModal(side, sym0) {
  let made = null;
  const held = ledger(simTrades(), { base: SIMB }).holdings;
  const r = await dialog(side === 'BUY' ? '模擬買進' : '模擬賣出', `<div class="field search"><label>代號</label><input id="xs" value="${esc(sym0 || '')}" autocomplete="off" placeholder="2330、AAPL"><div class="res hide"></div><div id="xn" class="small muted" style="margin-top:3px"></div></div>
    <div class="grid g2"><div class="field"><label>股數</label><input id="xq" type="number" step="any" value="${sym0 && side === 'SELL' ? (held.find((h) => h.symbol === sym0) || {}).shares || '' : 1000}"></div><div class="field"><label>價格（預設即時價）</label><input id="xp" type="number" step="any"></div></div>
    <div id="xc" class="small text2" style="margin-top:8px"></div><div id="merr" class="small up"></div>`, [['', '取消'], ['ok', side === 'BUY' ? '買進' : '賣出', 'primary']], (root) => {
    const upd = () => { const s2 = $('#xs', root).value.trim().toUpperCase(); const q = S.q[s2]; const h = held.find((x) => x.symbol === s2);
      $('#xn', root).textContent = s2 ? D.name(s2) + (q && q.price ? '　即時 ' + fmtPrice(q.price) : '') + (h ? '　持有 ' + fmt(h.shares, 0) + ' 股' : '') : '';
      if (!$('#xp', root).value && q && q.price) $('#xp', root).value = q.price;
      const n = +$('#xq', root).value, p = +$('#xp', root).value;
      if (s2 && n > 0 && p > 0) { const g = gross(s2, n, p); const fee = isUs(s2) ? 0 : twFee(g); const tax = side === 'SELL' && !isUs(s2) ? Math.floor(g * twTaxRate(s2)) : 0;
        $('#xc', root).textContent = `金額 ${fmt(g, isUs(s2) ? 2 : 0)}　手續費 ${fee}　交易稅 ${tax}　${side === 'BUY' ? '共付' : '實收'} ${fmt(side === 'BUY' ? g + fee : g - fee - tax, isUs(s2) ? 2 : 0)}`; } };
    bindSearch($('#xs', root), (s2) => { $('#xs', root).value = s2; $('#xp', root).value = ''; refreshQuotes([s2]).then(upd); });
    ['#xq', '#xp'].forEach((id) => $(id, root).oninput = upd); if (sym0) refreshQuotes([sym0]).then(upd); upd();
    return () => {
      const s2 = $('#xs', root).value.trim().toUpperCase(); const n = +$('#xq', root).value, p = +$('#xp', root).value;
      if (!s2) return '請輸入代號'; if (!(n > 0)) return '請輸入股數'; if (!(p > 0)) return '請輸入價格';
      const g = gross(s2, n, p); const list = simTrades();
      const t = { t: side, s: s2, d: ymd(), n, p, x: isUs(s2) ? usdTwd() : 1, fee: isUs(s2) ? 0 : twFee(g), tax: side === 'SELL' && !isUs(s2) ? Math.floor(g * twTaxRate(s2)) : 0, id: Math.max(Date.now(), ...list.map((x) => (+x.id || 0) + 1)), o: '', note: '網頁' };
      const nl = list.concat([t]); const res = ledger(nl, { base: SIMB }); if (res.err) return res.err; made = nl; return null;
    };
  });
  if (r === 'ok' && made) { simSave(made); toast('已記錄模擬交易'); route(); }
}

// ───────── 工具 ─────────
function twTick(p, etf) { return etf ? (p < 50 ? 0.01 : 0.05) : p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5; }
function twLimits(ref, etf) {
  const r = (v) => Math.round(v * 100) / 100;
  let up = ref * 1.1, dn = ref * 0.9;
  const tu = twTick(up, etf); up = r(Math.floor(up / tu + 1e-9) * tu); const td = twTick(dn, etf); dn = r(Math.ceil(dn / td - 1e-9) * td);
  return [dn, up];
}
VIEWS.tools = {
  title: '工具',
  render() {
    const t = S.pref.tool || 'cost';
    return head('工具') + `<div class="chips" style="margin-bottom:12px">${[['cost', '成本與損益兩平'], ['limit', '漲跌停價'], ['dca', '定期定額試算'], ['drip', '複利試算'], ['plans', '定期定額計畫'], ['divsim', '配息試算'], ['combo', '配息組合'], ['fx', '匯率換算']].map(([k, n]) => `<button class="chip ${t === k ? 'on' : ''}" data-tl="${k}">${n}</button>`).join('')}</div><div id="tool"></div>`;
  },
  bind() { $$('[data-tl]').forEach((b) => b.onclick = () => { S.pref.tool = b.dataset.tl; savePref(); route(); }); this[S.pref.tool || 'cost'](); },
  cost() {
    const accs = D.accounts().filter((a) => a.m !== 'US');
    $('#tool').innerHTML = `<div class="grid g2 stack"><div class="card"><h2>台股交易成本試算</h2>
      <div class="grid g2"><div class="field"><label>買進價</label><input id="cb" type="number" step="any" value="100"></div><div class="field"><label>股數</label><input id="cn" type="number" value="1000"></div></div>
      <div class="grid g2"><div class="field"><label>手續費折扣（0.28＝2.8 折）</label><input id="cd" type="number" step="0.01" value="${accs[0] ? accs[0].d : 1}"></div><div class="field"><label>最低手續費</label><input id="cm" type="number" value="${accs[0] ? accs[0].min ?? 20 : 20}"></div></div>
      <div class="grid g2"><div class="field"><label>類型</label><select id="ce"><option value="0.003">股票（證交稅 0.3%）</option><option value="0.001">ETF（0.1%）</option><option value="0.0015">現股當沖（0.15%）</option><option value="0">債券 ETF（免稅）</option></select></div>
        <div class="field"><label>目標報酬率（%）</label><input id="ct" type="number" step="0.1" value="10"></div></div></div>
      <div class="card"><h2>試算結果</h2><div id="cres"></div></div></div>`;
    const calc = () => {
      const b = +$('#cb').value, n = +$('#cn').value, d = +$('#cd').value || 1, mn = +$('#cm').value || 0, tax = +$('#ce').value, tg = +$('#ct').value || 0;
      if (!(b > 0 && n > 0)) { $('#cres').innerHTML = '<div class="muted">請輸入價格與股數</div>'; return; }
      const g = Math.floor(b * n); const fb = twFee(g, d, mn); const cost = g + fb;
      const sellAt = (p) => { const gs = Math.floor(p * n); return gs - twFee(gs, d, mn) - Math.floor(gs * tax); };
      const tick = (p) => twTick(p, tax === 0.001 || tax === 0); const ceilTick = (p) => { const t = tick(p); return Math.round(Math.ceil(p / t - 1e-9) * t * 100) / 100; };
      let be = b; for (let i = 0; i < 2000 && sellAt(be) < cost; i++) be = ceilTick(be + tick(be) / 2);
      let tp = b; const want = cost * (1 + tg / 100); for (let i = 0; i < 20000 && sellAt(tp) < want; i++) tp = ceilTick(tp + tick(tp) / 2);
      const row = (k, v, c = '') => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--card2)"><span class="text2">${k}</span><b class="num ${c}">${v}</b></div>`;
      $('#cres').innerHTML = row('成交金額', fmtInt(g)) + row('買進手續費', fmtInt(fb)) + row('總成本', fmtInt(cost)) + row('每股成本', fmt(cost / n, 2)) +
        row('損益兩平賣價', fmt(be, 2), 'up') + row(`報酬 ${tg}% 賣價`, fmt(tp, 2), 'up') + row('以目前價格賣出淨收', fmtInt(sellAt(b))) + row('來回成本', fmtInt(cost - sellAt(b)) + '（' + ((cost - sellAt(b)) / g * 100).toFixed(3) + '%）');
    };
    $$('#tool input, #tool select').forEach((i) => i.oninput = calc); calc();
  },
  limit() {
    $('#tool').innerHTML = `<div class="card" style="max-width:560px"><h2>台股漲跌停價</h2><div class="grid g2"><div class="field"><label>參考價（昨收）</label><input id="lr" type="number" step="any" value="100"></div>
      <div class="field"><label>類型</label><select id="le"><option value="0">股票</option><option value="1">ETF</option></select></div></div><div id="lres" style="margin-top:12px"></div>
      <div class="small muted" style="margin-top:8px">依證交所升降單位：漲停價向下、跌停價向上取到合法價位。</div></div>`;
    const calc = () => { const r = +$('#lr').value; if (!(r > 0)) return; const [dn, up] = twLimits(r, $('#le').value === '1');
      $('#lres').innerHTML = `<div class="grid g2"><div class="tile"><div class="k">漲停</div><div class="v num up">${fmt(up, 2)}</div><div class="s num up">${fmtPct((up / r - 1) * 100)}</div></div><div class="tile"><div class="k">跌停</div><div class="v num down">${fmt(dn, 2)}</div><div class="s num down">${fmtPct((dn / r - 1) * 100)}</div></div></div>`; };
    $$('#tool input, #tool select').forEach((i) => i.oninput = calc); calc();
  },
  dca() {
    $('#tool').innerHTML = `<div class="card"><h2>定期定額／複利試算</h2><div class="grid g4">
      <div class="field"><label>初始金額</label><input id="di" type="number" value="0"></div><div class="field"><label>每月投入</label><input id="dm" type="number" value="10000"></div>
      <div class="field"><label>年化報酬（%）</label><input id="dr" type="number" step="0.1" value="7"></div><div class="field"><label>年數</label><input id="dy" type="number" value="20"></div></div>
      <div class="grid g3" id="dres" style="margin-top:12px"></div><div class="chart-wrap" id="dC" style="margin-top:10px"><canvas></canvas><div class="chart-tip"></div></div></div>`;
    const calc = () => {
      const i0 = +$('#di').value || 0, m = +$('#dm').value || 0, r = (+$('#dr').value || 0) / 100 / 12, y = Math.min(60, Math.max(1, +$('#dy').value || 1));
      const lab = [], val = [], inv = []; let v = i0, put = i0;
      for (let k = 0; k <= y * 12; k++) { if (k > 0) { v = v * (1 + r) + m; put += m; } if (k % 12 === 0) { lab.push('第 ' + k / 12 + ' 年'); val.push(Math.round(v)); inv.push(put); } }
      $('#dres').innerHTML = `<div class="tile"><div class="k">期末資產</div><div class="v num">${fmtInt(v)}</div></div><div class="tile"><div class="k">總投入</div><div class="v num">${fmtInt(put)}</div></div><div class="tile"><div class="k">累積報酬</div><div class="v num up">${fmtSigned(v - put)}</div><div class="s muted">${put ? ((v / put - 1) * 100).toFixed(1) : 0}%</div></div>`;
      drawSeries($('#dC'), lab, [{ v: val, color: '#3b82f6', name: '資產', fill: true }, { v: inv, color: '#f59e0b', name: '投入' }], { h: 240 });
    };
    $$('#tool input').forEach((i) => i.oninput = calc); calc();
  },
  /** 複利試算（與 App DripScreen 相同）：存股複利／目標反推，逐月複利、配息頻率、預扣稅、每年加碼、通膨；可從持股或單一個股帶入 */
  drip() {
    const P = S.pref.drip || {}; const v = (k, d) => (P[k] != null ? P[k] : d);
    const hs = holdings(); const groups = [['全部持股', hs], ['台股持股', hs.filter((h) => !isUs(h.symbol))], ['美股持股', hs.filter((h) => isUs(h.symbol))]].filter(([, l]) => l.length);
    $('#tool').innerHTML = `<div class="card"><h2>複利試算<span class="r"><span class="seg" id="dpM"><button data-m="0" class="${v('mode', 0) == 0 ? 'on' : ''}">存股複利</button><button data-m="1" class="${v('mode', 0) == 1 ? 'on' : ''}">目標反推</button></span></span></h2>
      ${hs.length || S.dripSym ? `<div class="small muted">從持股帶入（市值與近 12 個月殖利率）</div><div class="chips" style="margin:6px 0 10px">${groups.map(([n]) => `<button class="chip" data-dg="${n}">${n}</button>`).join('')}${hs.map((h) => `<button class="chip" data-dh="${h.symbol}">${h.symbol}</button>`).join('')}</div>` : ''}
      <div class="row wrap" style="gap:6px;margin-bottom:8px"><span class="small muted">或指定個股</span>${symPicker('dpS', '')}</div><div id="dpMsg" class="small" style="color:var(--primary);margin-bottom:8px"></div>
      <div class="grid g4">${[['init', '期初金額（元）', 1000000], ['monthly', '每月投入（元）', 10000], ['yield', '年殖利率 %', 4], ['growth', '股價年成長 %', 3], ['years', '年數', 20], ['step', '每年加碼 %', 0], ['infl', '通膨 %', 2], ['target', '目標金額', 10000000]].map(([k, n, d]) => `<div class="field ${k === 'target' ? 'dpT' : ''}"><label>${n}</label><input data-dp="${k}" type="number" step="any" value="${v(k, d)}"></div>`).join('')}</div>
      <div class="row wrap" style="gap:12px;margin-top:4px"><span class="small muted">配息頻率</span><span class="seg" id="dpF">${['月配', '季配', '半年', '年配'].map((n, i) => `<button data-f="${i}" class="${v('freq', 1) == i ? 'on' : ''}">${n}</button>`).join('')}</span>
        <label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" id="dpTax" style="width:auto" ${v('withTax', false) ? 'checked' : ''}> 扣除股息預扣稅 <span class="muted" id="dpTaxN"></span></label></div></div>
      <div id="dpGoal"></div><div id="dpRes" style="margin-top:12px"></div>`;
    let taxRate = v('taxRate', 0);
    const num = (k) => { const x = parseFloat(($(`[data-dp="${k}"]`).value || '').replace(/,/g, '')); return isNaN(x) ? 0 : x; };
    const sim = (i) => {
      const g = Math.pow(1 + i.growth / 100, 1 / 12) - 1; const per = Math.max(1, Math.min(12, i.per)); const every = 12 / per; const dPay = i.yld / 100 / per;
      let a = i.init, b = i.init, cash = 0, invested = i.init, divTotal = 0, m = i.monthly; const out = [{ year: 0, re: a, co: b, divY: 0, inv: invested, divT: 0, real: a }];
      for (let y = 1; y <= i.years; y++) { let divY = 0;
        for (let mo = 1; mo <= 12; mo++) { a = a * (1 + g) + m; b = b * (1 + g) + m; invested += m;
          if (mo % every === 0) { const dA = a * dPay * (1 - i.tax); a += dA; divY += dA; divTotal += dA; cash += b * dPay * (1 - i.tax); } }
        m *= 1 + i.step / 100; out.push({ year: y, re: a, co: b + cash, divY, inv: invested, divT: divTotal, real: a / Math.pow(1 + i.infl / 100, y) }); }
      return out;
    };
    const need = (target, i) => { if (sim({ ...i, monthly: 0 }).pop().re >= target) return 0; let lo = 0, hi = Math.max(target / Math.max(1, i.years * 12), 1);
      while (sim({ ...i, monthly: hi }).pop().re < target) { hi *= 2; if (hi > 1e12) return null; } for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (sim({ ...i, monthly: mid }).pop().re >= target) hi = mid; else lo = mid; } return hi; };
    const yrsTo = (target, i) => { const r = sim({ ...i, years: 50 }).find((x) => x.re >= target); return r ? r.year : null; };
    const calc = () => {
      const mode = +$('#dpM .on').dataset.m; const freq = +$('#dpF .on').dataset.f; const withTax = $('#dpTax').checked;
      $$('.dpT').forEach((e) => { e.style.display = mode === 1 ? '' : 'none'; });
      const i = { init: Math.max(0, num('init')), monthly: Math.max(0, num('monthly')), yld: Math.max(0, Math.min(50, num('yield'))), growth: Math.max(-50, Math.min(50, num('growth'))), years: Math.max(1, Math.min(50, Math.round(num('years')) || 20)),
        tax: withTax ? taxRate || 0.3 : 0, step: Math.max(0, Math.min(50, num('step'))), per: [12, 4, 2, 1][freq], infl: Math.max(0, Math.min(20, num('infl'))) };
      $('#dpTaxN').textContent = withTax ? '（以 ' + ((i.tax) * 100).toFixed(1) + '% 計）' : taxRate ? '' : '（台股多數不預扣，二代健保另計）';
      S.pref.drip = { mode, freq, withTax, taxRate, init: i.init, monthly: i.monthly, yield: i.yld, growth: i.growth, years: i.years, step: i.step, infl: i.infl, target: num('target') }; savePref();
      const rows = sim(i); const L = rows[rows.length - 1]; const target = num('target');
      const kvr = (k, x, c = '') => `<div class="row" style="padding:5px 0;border-bottom:1px solid var(--border)"><span class="sp small text2">${k}</span><span class="num ${c}">${x}</span></div>`;
      if (mode === 1) { const nd = target > 0 ? need(target, i) : null; const yr = target > 0 ? yrsTo(target, i) : null;
        $('#dpGoal').innerHTML = `<div class="card" style="margin-top:12px"><h2>目標 NT$${fmtInt(target)}</h2>${target <= 0 ? '<div class="small down">請輸入目標金額</div>' :
          kvr(i.years + ' 年內達標，每月需投入', nd != null ? 'NT$' + fmtInt(Math.ceil(nd)) : '無法達成', 'up') + (nd != null ? kvr('與目前每月投入相比', fmtSigned(nd - i.monthly), cls(i.monthly - nd)) : '') +
          kvr('以目前每月 NT$' + fmtInt(i.monthly) + '，達標需要', yr != null ? yr + ' 年' : '50 年內無法達成', yr != null && yr <= i.years ? 'up' : 'down') + kvr('目標折合今日購買力', 'NT$' + fmtInt(target / Math.pow(1 + i.infl / 100, i.years)))}</div>`; }
      else $('#dpGoal').innerHTML = '';
      const r = (1 + i.growth / 100) * (1 + i.yld / 100 * (1 - i.tax)) - 1; const sup = rows.find((x) => x.year > 0 && i.monthly > 0 && x.divY / 12 >= i.monthly);
      const step = Math.max(1, Math.floor(i.years / 10));
      $('#dpRes').innerHTML = `<div class="grid g2 stack"><div class="card"><h2>${i.years} 年後</h2><div class="grid g2"><div class="tile"><div class="k">股息再投入</div><div class="v num" style="color:var(--primary)">${fmtInt(L.re)}</div></div><div class="tile"><div class="k">股息領現（含累積現金）</div><div class="v num" style="color:#f59e0b">${fmtInt(L.co)}</div></div></div>
        ${kvr('累計投入本金', fmtInt(L.inv))}${kvr('複利報酬（資產 − 本金）', fmtSigned(L.re - L.inv) + '（' + (L.inv > 0 ? ((L.re / L.inv - 1) * 100).toFixed(1) : '0.0') + '%）', cls(L.re - L.inv))}
        ${kvr('再投入比領現多', fmtSigned(L.re - L.co), cls(L.re - L.co))}${kvr('累計領到股息（稅後）', fmtInt(L.divT))}${kvr('第 ' + i.years + ' 年股息', fmtInt(L.divY) + '（月均 ' + fmtInt(L.divY / 12) + '）')}${kvr('折合今日購買力（扣通膨）', fmtInt(L.real))}
        ${r > 0 ? kvr('資產翻倍約需（不計投入）', (Math.log(2) / Math.log(1 + r)).toFixed(1) + ' 年（年化 ' + (r * 100).toFixed(2) + '%）') : ''}${sup ? kvr('月均股息超過每月投入', '第 ' + sup.year + ' 年', 'up') : ''}
        <div class="chart-wrap" id="dpC" style="margin-top:10px"><canvas></canvas><div class="chart-tip"></div></div></div>
        <div class="card"><h2>逐年明細</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>年</th><th>本金</th><th>再投入資產</th><th>領現資產</th><th>年股息</th></tr></thead><tbody>
          ${rows.filter((x) => x.year > 0 && (x.year % step === 0 || x.year === i.years)).map((x) => `<tr><td>第 ${x.year} 年</td><td class="num muted">${fmtInt(x.inv)}</td><td class="num">${fmtInt(x.re)}</td><td class="num">${fmtInt(x.co)}</td><td class="num" style="color:#f59e0b">${fmtInt(x.divY)}</td></tr>`).join('')}</tbody></table></div>
          <div class="small muted" style="margin-top:6px">試算假設殖利率與成長率固定、不含手續費；實際結果會不同，僅供規劃參考。</div></div></div>`;
      drawSeries($('#dpC'), rows.map((x) => '第 ' + x.year + ' 年'), [{ v: rows.map((x) => Math.round(x.re)), color: '#3b82f6', name: '再投入', fill: true }, { v: rows.map((x) => Math.round(x.co)), color: '#f59e0b', name: '領現' }, { v: rows.map((x) => Math.round(x.inv)), color: '#94a3b8', name: '本金' }], { h: 220 });
    };
    /** 帶入一組持股：市值合計、市值加權殖利率；美股部位預設扣 30% 預扣稅 */
    const load = async (label, list) => {
      if (!list.length) return; const msg = $('#dpMsg'); msg.textContent = '載入 ' + label + ' 配息紀錄中…';
      const rows = list.map((h) => { const q = S.q[h.symbol] || {}; const mv = h.shares * (q.price || h.avgCost) * (isUs(h.symbol) ? usdTwd() : 1); return { s: h.symbol, mv }; });
      const total = rows.reduce((a, r) => a + r.mv, 0); const usShare = rows.filter((r) => isUs(r.s)).reduce((a, r) => a + r.mv, 0) / Math.max(1, total);
      taxRate = 0.3 * usShare; $('#dpTax').checked = usShare > 0.01; $('[data-dp="init"]').value = Math.round(total);
      let y = 0, miss = 0; const pers = [];
      for (const r of rows) { const l = await divHist(r.s).catch(() => []); const pj = divProject(l, r.s); const px0 = (S.q[r.s] || {}).price; if (pj.annual && px0) { y += pj.annual / px0 * 100 * r.mv; pers.push(pj.perYear); } else miss++; }
      if (y > 0) { const avg = y / total; $('[data-dp="yield"]').value = avg.toFixed(2); if (list.length === 1 && pers[0]) { const fi = { 12: 0, 4: 1, 2: 2, 1: 3 }[pers[0]]; if (fi != null) $$('#dpF button').forEach((b) => b.classList.toggle('on', +b.dataset.f === fi)); }
        msg.textContent = '已帶入 ' + label + '：市值 NT$' + fmtInt(total) + '，加權殖利率 ' + avg.toFixed(2) + '%' + (miss ? '（' + miss + ' 檔無配息，以 0 計）' : ''); }
      else msg.textContent = label + ' 近一年沒有配息紀錄';
      calc();
    };
    /** 指定個股（未持有）：帶入近 12 個月殖利率與配息頻率，期初金額不變 */
    const loadSym = async (sym) => {
      const msg = $('#dpMsg'); msg.textContent = '載入 ' + sym + ' 配息紀錄中…'; await ensureQuote(sym); const l = await divHist(sym).catch(() => []); const pj = divProject(l, sym); const px0 = (S.q[sym] || {}).price;
      if (!pj.annual || !px0) { msg.textContent = D.name(sym) + '（' + sym + '）近一年沒有配息或取不到股價'; return; }
      $('[data-dp="yield"]').value = (pj.annual / px0 * 100).toFixed(2); const fi = { 12: 0, 4: 1, 2: 2, 1: 3 }[pj.perYear]; if (fi != null) $$('#dpF button').forEach((b) => b.classList.toggle('on', +b.dataset.f === fi));
      if (isUs(sym)) { taxRate = 0.3; $('#dpTax').checked = true; } else { taxRate = 0; $('#dpTax').checked = false; }
      msg.textContent = '已帶入 ' + D.name(sym) + '（' + sym + '）：' + divFreq(l, sym)[0] + '、' + (pj.estimated ? '年化殖利率（推估）' : '近 12 個月殖利率') + ' ' + (pj.annual / px0 * 100).toFixed(2) + '%'; calc();
    };
    $$('#dpM button').forEach((b) => b.onclick = () => { $$('#dpM button').forEach((x) => x.classList.toggle('on', x === b)); calc(); });
    $$('#dpF button').forEach((b) => b.onclick = () => { $$('#dpF button').forEach((x) => x.classList.toggle('on', x === b)); calc(); });
    $('#dpTax').onchange = () => { if ($('#dpTax').checked && !taxRate) taxRate = 0.3; calc(); };
    $$('[data-dp]').forEach((e) => e.oninput = calc);
    $$('[data-dg]').forEach((b) => b.onclick = () => { $$('#tool .chip').forEach((x) => x.classList.toggle('on', x === b)); load(b.dataset.dg, groups.find(([n]) => n === b.dataset.dg)[1]); });
    $$('[data-dh]').forEach((b) => b.onclick = () => { $$('#tool .chip').forEach((x) => x.classList.toggle('on', x === b)); load(b.dataset.dh, hs.filter((h) => h.symbol === b.dataset.dh)); });
    bindSearch($('#dpS'), (sym) => { $('#dpS').value = sym; loadSym(sym); });
    calc();
    if (S.dripSym) { const s0 = S.dripSym; S.dripSym = null; const h = hs.find((x) => x.symbol === s0); if (h) load(s0, [h]); else loadSym(s0); }
  },
  divsim() { divSimTool(); },
  combo() { comboTool(); },
  fx() { fxTool(); },
  plans() {
    const list = kjson('dca', []);
    $('#tool').innerHTML = `<div class="card"><h2>定期定額計畫<span class="r"><button class="btn sm primary" id="addP">＋ 新增</button></span></h2>
      <div class="small muted" style="margin-bottom:8px">與手機 App 同步：扣款日當天手機會提醒並可一鍵記錄買進。</div>
      ${list.length ? `<table class="tbl"><thead><tr><th>個股</th><th>每月金額</th><th>扣款日</th><th>最近記錄</th><th>啟用</th><th></th></tr></thead><tbody>${list.map((p) => `<tr><td class="nm">${esc(D.name(p.s))} <span class="muted small num">${p.s}</span></td><td class="num">${fmtInt(p.a)}</td><td class="num">每月 ${p.d} 日</td><td>${esc(p.done || '—')}</td>
        <td><input type="checkbox" data-pon="${p.id}" ${p.on === false ? '' : 'checked'} style="width:auto"></td><td><button class="btn sm danger" data-pdel="${p.id}">刪除</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">尚無定期定額計畫。</div>'}</div>`;
    $$('[data-pon]').forEach((c) => c.onchange = () => { ksetJson('dca', kjson('dca', []).map((p) => String(p.id) === c.dataset.pon ? { ...p, on: c.checked } : p)); changed(); });
    $$('[data-pdel]').forEach((b) => b.onclick = () => { ksetJson('dca', kjson('dca', []).filter((p) => String(p.id) !== b.dataset.pdel)); changed(); this.plans(); });
    $('#addP').onclick = async () => {
      let made = null;
      const r = await dialog('新增定期定額', `<div class="field search"><label>代號</label><input id="ps" autocomplete="off" placeholder="0050"><div class="res hide"></div></div>
        <div class="grid g2"><div class="field"><label>每月金額</label><input id="pa" type="number" value="5000"></div><div class="field"><label>扣款日</label><input id="pd" type="number" min="1" max="28" value="6"></div></div><div id="merr" class="small up"></div>`,
      [['', '取消'], ['ok', '新增', 'primary']], (root) => { bindSearch($('#ps', root), (sym) => { $('#ps', root).value = sym; });
        return () => { const s2 = $('#ps', root).value.trim().toUpperCase(); const a = +$('#pa', root).value; const d = +$('#pd', root).value; if (!s2) return '請輸入代號'; if (!(a > 0)) return '請輸入金額'; if (!(d >= 1 && d <= 28)) return '扣款日 1～28';
          const l = kjson('dca', []); made = l.concat([{ id: Math.max(0, ...l.map((p) => +p.id || 0)) + 1, s: s2, a, d, acc: 0, on: true, done: '', ntf: '' }]); return null; }; });
      if (r === 'ok' && made) { ksetJson('dca', made); changed(); this.plans(); }
    };
  },
  fill() {}, syms() { return []; },
};

// ───────── 行事曆（除權息、新股、休市） ─────────
VIEWS.calendar = {
  title: '行事曆',
  render() {
    const f = S.pref.calF || 'mine';
    return head('行事曆') + `<div class="row wrap" style="margin-bottom:12px"><div class="chips">${[['mine', '持股與自選'], ['all', '全市場除息'], ['ipo', '新股'], ['macro', '總經與期貨'], ['off', '休市']].map(([k, n]) => `<button class="chip ${f === k ? 'on' : ''}" data-cf="${k}">${n}</button>`).join('')}</div>
      <span class="sp"></span><button class="btn sm" data-cm2="-1">‹</button><b id="cmon"></b><button class="btn sm" data-cm2="1">›</button></div><div id="dyn"></div>`;
  },
  bind() {
    $$('[data-cf]').forEach((b) => b.onclick = () => { S.pref.calF = b.dataset.cf; savePref(); route(); });
    $$('[data-cm2]').forEach((b) => b.onclick = () => { const [y0, m0] = (S.pref.calM2 || ymd().slice(0, 7).replace('/', '-')).split('-').map(Number); const d = new Date(Date.UTC(y0, m0 - 1 + Number(b.dataset.cm2), 1)); S.pref.calM2 = d.toISOString().slice(0, 7); savePref(); this.fill(); });
  },
  async fill() {
    if (!can('DIVTAX')) { $('#dyn').innerHTML = lockCard('DIVTAX', '除權息與新股行事曆（股息與稅務）'); return; }
    const [plans, ipo, cal] = await Promise.all([kv('sx:plans'), kv('sx:ipo'), kv('sx:cal')]);
    if (S.route !== 'calendar') return;
    const f = S.pref.calF || 'mine'; const mon = S.pref.calM2 || ymd().slice(0, 7).replace('/', '-'); const [yy, mm] = mon.split('-').map(Number); const pre = yy + '/' + String(mm).padStart(2, '0');
    $('#cmon').textContent = yy + ' 年 ' + mm + ' 月';
    const mine = new Set(holdings().map((h) => h.symbol).concat(D.quotes().map((q) => q.s))); const held = Object.fromEntries(holdings().map((h) => [h.symbol, h]));
    const ev = {}; const add = (d, e) => { if (!d || !String(d).startsWith(pre)) return; (ev[d] = ev[d] || []).push(e); };
    if (f === 'mine' || f === 'all') Object.entries(plans || {}).forEach(([c, p]) => { if (f === 'mine' && !mine.has(c)) return;
      add(p.ex, { k: 'ex', c, t: `${D.name(c)} 除息${p.cash ? ' ' + fmt(p.cash, 2) : ''}${p.stock ? ' 配股 ' + p.stock : ''}`, amt: held[c] && p.cash ? p.cash * held[c].shares : 0 });
      if (f === 'mine' && p.pay) add(p.pay, { k: 'pay', c, t: `${D.name(c)} 股利發放`, amt: held[c] && p.cash ? p.cash * held[c].shares : 0 }); });
    if (f === 'ipo' || f === 'mine') ((ipo && ipo.ipo) || []).forEach((x) => { if (f === 'mine' && !mine.has(x.c)) return;
      add(x.s, { k: 'ipo', c: x.c, t: `${x.n} 申購開始（承銷 ${x.p || '—'}）` }); add(x.e, { k: 'ipo', c: x.c, t: `${x.n} 申購截止` }); add(x.d, { k: 'ipo', c: x.c, t: `${x.n} 抽籤${x.r ? '（中籤率 ' + x.r + '%）' : ''}` }); add(x.l, { k: 'list', c: x.c, t: `${x.n} 上市掛牌` }); });
    if (f === 'ipo') ((ipo && ipo.list) || []).forEach((x) => add(x.d, { k: 'list', c: x.c, t: `${x.n} 上市掛牌` }));
    (cal || []).forEach((x) => add(x.d, { k: 'off', t: '休市：' + x.n }));
    if (f === 'mine' || f === 'macro' || f === 'off') macroEvents(yy, mm).forEach(([d, t]) => { if (f === 'off' && !t.startsWith('美股休市')) return; add(d, { k: t.startsWith('美股休市') ? 'off' : 'macro', t }); });
    const first = new Date(Date.UTC(yy, mm - 1, 1)); const nd = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); const lead = first.getUTCDay(); const today = ymd();
    const COL = { ex: 'var(--primary)', pay: '#22c55e', ipo: '#f59e0b', list: '#a855f7', off: '#9ca3af', macro: '#ec4899' };
    const days = Object.keys(ev).sort();
    $('#dyn').innerHTML = `<div class="card"><div class="cal cal2">${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<div class="w">${w}</div>`).join('')}${'<div></div>'.repeat(lead)}${Array.from({ length: nd }, (_, i) => {
      const d = pre + '/' + String(i + 1).padStart(2, '0'); const es = ev[d] || [];
      return `<div class="d ${d === today ? 'today' : ''}"><div class="dn">${i + 1}</div>${es.slice(0, 3).map((e) => `<div class="ev" style="border-left-color:${COL[e.k]};--c:${COL[e.k]}">${esc(e.t)}</div>`).join('')}${es.length > 3 ? `<div class="small muted">＋${es.length - 3}</div>` : ''}</div>`; }).join('')}</div>
      <div class="legend">${[['ex', '除息'], ['pay', '發放'], ['ipo', '申購／抽籤'], ['list', '上市'], ['macro', '總經／結算'], ['off', '休市']].map(([k, n]) => `<span><i style="background:${COL[k]}"></i>${n}</span>`).join('')}</div></div>
      <div class="card" style="margin-top:12px"><h2>本月明細</h2>${days.length ? `<div class="list">${days.map((d) => ev[d].map((e) => `<div class="it" ${e.c ? `data-go="#/s/${e.c}"` : 'style="cursor:default"'}><span class="tag" style="color:${COL[e.k]}">${d.slice(5)}</span><div class="l"><div class="t1" style="white-space:normal">${esc(e.t)}</div></div>${e.amt ? `<div class="r num">預估 ${fmtInt(e.amt)}</div>` : ''}</div>`).join('')).join('')}</div>` : '<div class="muted small">本月沒有事件。</div>'}
      <div class="small muted" style="margin-top:8px">資料由管理員版每日同步（證交所、櫃買中心公告）。</div></div>`;
  },
  syms() { return []; },
};

// ───────── 個股比較 ─────────
const CMP_COLORS = ['#3b82f6', '#f59e0b', '#a855f7', '#22c55e', '#ef4444'];

// ───────── 全市場選股器（與 App Screener 同資料源與條件） ─────────
const SCR_F = [['price', '股價', '元'], ['chg', '漲跌幅', '%'], ['lots', '成交量', '張'], ['val', '成交金額', '億'], ['pe', '本益比', '倍'], ['y', '殖利率', '%'], ['pb', '股價淨值比', '倍'],
  ['yoy', '月營收年增', '%'], ['ytd', '累計營收年增', '%'], ['fi', '外資買賣超', '張'], ['ti', '投信買賣超', '張'], ['ii', '三大法人合計', '張']];
const SCR_P = [['高殖利率低本益比', [['y', 5, null], ['pe', 0.01, 15], ['lots', 200, null]], 'y', 1], ['營收成長', [['yoy', 20, null], ['ytd', 10, null], ['lots', 200, null]], 'yoy', 1],
  ['投信買超', [['ti', 100, null]], 'ti', 1], ['外資大買', [['fi', 1000, null]], 'fi', 1], ['低股價淨值比', [['pb', 0.01, 1], ['lots', 100, null]], 'pb', 0], ['強勢量增', [['chg', 3, null], ['lots', 2000, null]], 'chg', 1]];
const scrCommon = (c) => /^[1-9]\d{3}$/.test(c);
const kf = (o, inc, exc = []) => { const k = Object.keys(o).find((x) => inc.every((i) => x.toLowerCase().includes(i.toLowerCase())) && !exc.some((e) => x.includes(e))); return k == null ? null : o[k]; };
const nn = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/[,%+\s]/g, '')); return isNaN(x) ? null : x; };
let SCR_U = null;
async function scrUniverse(force) {
  if (SCR_U && !force && Date.now() - SCR_U.at < 1800000) return SCR_U;
  const g = (u, t) => px(u, t).catch(() => null); const A = (x) => (Array.isArray(x) && x.length ? x : null);
  const [tw, bw, rv, op, ope, orv, oin] = await Promise.all([g('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', 1800), g('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL', 1800),
    g('https://openapi.twse.com.tw/v1/opendata/t187ap05_L', 21600), g('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', 1800), g('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis', 1800),
    g('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O', 21600), g('https://www.tpex.org.tw/openapi/v1/t187ap07_O', 3600)]).then((l) => l.map(A));
  // 證交所 T86：往回找最近一個有資料的交易日
  let t86 = null; for (let i = 0; i < 6 && !t86; i++) { const d = new Date(Date.now() + 8 * 3600000 - i * 86400000); if (d.getUTCDay() % 6 === 0) continue; if (i === 0 && d.getUTCHours() < 16) continue;
    const j = await g('https://www.twse.com.tw/rwd/zh/fund/T86?date=' + d.toISOString().slice(0, 10).replace(/-/g, '') + '&selectType=ALLBUT0999&response=json', 3600); if (j && j.stat === 'OK' && Array.isArray(j.data) && Array.isArray(j.fields)) t86 = j; }
  const V = {}, R = {}, I = {};
  (bw || []).forEach((o) => { V[String(o.Code || '').trim()] = [nn(o.PEratio), nn(o.DividendYield), nn(o.PBratio)]; });
  (ope || []).forEach((o) => { const c = String(o.SecuritiesCompanyCode || '').trim(); V[c] = [nn(o.PriceEarningRatio), nn(o.YieldRatio), nn(o.PriceBookRatio)]; });
  (rv || []).forEach((o) => { const c = String(kf(o, ['公司代號']) || '').trim(); R[c] = [nn(kf(o, ['去年同月增減'])), nn(kf(o, ['累計', '前期比較增減'])), kf(o, ['資料年月'])]; });
  (orv || []).forEach((o) => { const c = String(kf(o, ['公司代號']) || o.SecuritiesCompanyCode || '').trim(); if (c) R[c] = [nn(kf(o, ['去年同月增減']) || o.YoYRate), nn(kf(o, ['累計', '前期比較增減']) || o.CumulativeYoYRate), kf(o, ['資料年月'])]; });
  if (t86) { const f = t86.fields; const ix = (p) => f.findIndex(p); const ic = ix((x) => x.includes('代號')), iF = ix((x) => x.includes('外陸資買賣超') || (x.includes('外資') && x.includes('買賣超') && !x.includes('自營'))), iFd = ix((x) => x.includes('外資自營商買賣超')), iT = ix((x) => x.includes('投信買賣超')), iA = ix((x) => x.includes('三大法人買賣超'));
    t86.data.forEach((r) => { I[String(r[ic]).trim()] = [((nn(r[iF]) || 0) + (iFd >= 0 ? nn(r[iFd]) || 0 : 0)) / 1000, (nn(r[iT]) || 0) / 1000, (nn(r[iA]) || 0) / 1000]; }); }
  (oin || []).forEach((o) => { const c = String(o.SecuritiesCompanyCode || '').trim(); if (!c) return; const f = nn(o.ForeignInvestorsDifference ?? kf(o, ['Foreign', 'Difference'], ['Dealer'])), t = nn(o.InvestmentTrustDifference ?? kf(o, ['Trust', 'Difference'])), a = nn(o.TotalDifference ?? kf(o, ['Total', 'Difference'], ['Foreign', 'Dealer', 'Trust']));
    I[c] = [(f || 0) / 1000, (t || 0) / 1000, (a != null ? a : (f || 0) + (t || 0)) / 1000]; });
  const rows = []; let asOf = '';
  const add = (c, name, otc, close, chg, vol, val, date) => { c = String(c || '').trim(); if (!scrCommon(c) || !(close > 0)) return; const v = V[c] || [], r = R[c] || [], i = I[c] || [];
    rows.push({ s: c, n: String(name || '').trim(), otc, price: close, chg: chg != null && close - chg > 0 ? chg / (close - chg) * 100 : null, lots: vol != null ? vol / 1000 : null, val: val != null ? val / 1e8 : null,
      pe: v[0] > 0 ? v[0] : null, y: v[1], pb: v[2] > 0 ? v[2] : null, yoy: r[0], ytd: r[1], fi: i[0] ?? null, ti: i[1] ?? null, ii: i[2] ?? null }); if (date) asOf = date; };
  (tw || []).forEach((o) => add(o.Code, o.Name, false, nn(o.ClosingPrice), nn(o.Change), nn(o.TradeVolume), nn(o.TradeValue), o.Date));
  (op || []).forEach((o) => add(o.SecuritiesCompanyCode, o.CompanyName, true, nn(o.Close), nn(o.Change), nn(o.TradingShares), nn(o.TransactionAmount), o.Date));
  if (!rows.length) throw new Error('取不到全市場行情');
  SCR_U = { at: Date.now(), rows, asOf: asOf ? (String(asOf).length === 7 ? (+String(asOf).slice(0, 3) + 1911) + '/' + String(asOf).slice(3, 5) + '/' + String(asOf).slice(5) : asOf) : '', miss: [!bw && '本益比', !rv && '月營收', !t86 && '三大法人'].filter(Boolean) };
  return SCR_U;
}
VIEWS.screener = {
  title: '選股器',
  render() {
    if (!S.pref.scr) S.pref.scr = { c: SCR_P[0][1], s: SCR_P[0][2], d: SCR_P[0][3], p: SCR_P[0][0] };
    return head('選股器', '<button class="btn" id="scrR">重新整理</button>') + '<div id="dyn"><div class="card empty">讀取全市場資料中（上市＋上櫃約 1,800 檔）…</div></div>';
  },
  bind() { $('#scrR').onclick = () => { SCR_U = null; this.fill(); }; },
  syms() { return []; },
  async fill() {
    if (!can('STOCKPRO')) { $('#dyn').innerHTML = lockCard('STOCKPRO', '選股器'); return; }
    let U; try { U = await scrUniverse(); } catch (e) { $('#dyn').innerHTML = `<div class="card">${sapiErr(e)}</div>`; return; }
    if (S.route !== 'screener') return;
    const st = S.pref.scr; const mine = S.pref.scrMine || [];
    const fl = (k) => SCR_F.find((x) => x[0] === k) || SCR_F[0];
    const res = U.rows.filter((r) => st.c.every(([k, a, b]) => { const v = r[k]; return v != null && (a == null || v >= a) && (b == null || v <= b); }));
    const withV = res.filter((r) => r[st.s] != null).sort((a, b) => (st.d ? b[st.s] - a[st.s] : a[st.s] - b[st.s])); const out = withV.concat(res.filter((r) => r[st.s] == null));
    const signed = ['chg', 'yoy', 'ytd', 'fi', 'ti', 'ii'].includes(st.s);
    $('#dyn').innerHTML = `<div class="chips" style="flex-wrap:wrap;margin-bottom:10px">${SCR_P.concat(mine).map((p, i) => `<span class="chip ${st.p === p[0] ? 'on' : ''}" data-sp="${i}">${esc(p[0])}</span>`).join('')}</div>
      <div class="card"><h2>條件<span class="r"><select id="scrAdd" style="width:auto"><option value="">＋ 新增條件</option>${SCR_F.filter((f) => !st.c.some((c) => c[0] === f[0])).map((f) => `<option value="${f[0]}">${f[1]}（${f[2]}）</option>`).join('')}</select></span></h2>
        ${st.c.length ? st.c.map(([k, a, b], i) => `<div class="row" style="gap:8px;margin-top:6px"><span style="width:110px">${fl(k)[1]}</span><input type="number" step="any" data-cmin="${i}" placeholder="最小" value="${a ?? ''}" style="width:110px"><input type="number" step="any" data-cmax="${i}" placeholder="最大" value="${b ?? ''}" style="width:110px"><span class="muted small">${fl(k)[2]}</span><a href="javascript:void 0" data-cdel="${i}" class="muted">✕</a></div>`).join('') : '<div class="small muted">沒有條件：列出全部普通股。</div>'}
        <div class="row wrap" style="gap:8px;margin-top:10px"><span class="small muted">排序</span><select id="scrS" style="width:auto">${SCR_F.map((f) => `<option value="${f[0]}" ${f[0] === st.s ? 'selected' : ''}>${f[1]}</option>`).join('')}</select>
          <select id="scrD" style="width:auto"><option value="1" ${st.d ? 'selected' : ''}>由大到小</option><option value="0" ${st.d ? '' : 'selected'}>由小到大</option></select><span class="sp"></span>
          <button class="btn sm" id="scrSave">儲存條件</button>${mine.some((m) => m[0] === st.p) ? '<button class="btn sm" id="scrDel">刪除</button>' : ''}</div></div>
      <div class="small muted" style="margin:10px 0">符合 ${out.length} 檔${out.length > 100 ? '，顯示前 100 檔' : ''} · 資料日期 ${esc(U.asOf)}${U.miss.length ? '（' + U.miss.join('、') + '取不到）' : ''}</div>
      <div class="card scroll-x" style="padding:6px 8px"><table class="tbl"><thead><tr><th style="text-align:left">股票</th><th>股價</th><th>漲跌幅</th><th>成交量</th><th>本益比</th><th>殖利率</th><th>淨值比</th><th>營收年增</th><th>投信</th><th>外資</th></tr></thead><tbody>
      ${out.slice(0, 100).map((r) => `<tr class="click" data-go="#/s/${r.s}"><td class="nm" style="text-align:left">${esc(r.n)} <span class="muted small num">${r.s}${r.otc ? ' 櫃' : ''}</span></td><td class="num">${fmtPrice(r.price)}</td><td class="num ${cls(r.chg)}">${fmtPct(r.chg)}</td><td class="num">${r.lots != null ? fmtInt(r.lots) : '—'}</td>
        <td class="num">${r.pe != null ? fmt(r.pe, 1) : '—'}</td><td class="num">${r.y != null ? fmt(r.y, 2) + '%' : '—'}</td><td class="num">${r.pb != null ? fmt(r.pb, 2) : '—'}</td><td class="num ${cls(r.yoy)}">${fmtPct(r.yoy, 1)}</td><td class="num ${cls(r.ti)}">${r.ti != null ? fmtSigned(Math.round(r.ti)) : '—'}</td><td class="num ${cls(r.fi)}">${r.fi != null ? fmtSigned(Math.round(r.fi)) : '—'}</td></tr>`).join('')}</tbody></table></div>
      <div class="small muted" style="margin-top:6px">資料來源：證交所、櫃買中心每日開放資料（收盤後更新）。只列普通股，不含 ETF、權證與特別股。法人單位為張；選股結果僅為篩選成果，不構成投資建議；投資有風險，請自行評估並自負盈虧。</div>`;
    const save = () => { st.p = ''; savePref(); this.fill(); };
    $$('[data-sp]').forEach((x) => x.onclick = () => { const p = SCR_P.concat(mine)[+x.dataset.sp]; S.pref.scr = { c: JSON.parse(JSON.stringify(p[1])), s: p[2], d: p[3], p: p[0] }; savePref(); this.fill(); });
    $('#scrAdd').onchange = (e) => { if (e.target.value) { st.c.push([e.target.value, null, null]); save(); } };
    $$('[data-cmin]').forEach((x) => x.onchange = () => { st.c[+x.dataset.cmin][1] = x.value === '' ? null : +x.value; save(); });
    $$('[data-cmax]').forEach((x) => x.onchange = () => { st.c[+x.dataset.cmax][2] = x.value === '' ? null : +x.value; save(); });
    $$('[data-cdel]').forEach((x) => x.onclick = () => { st.c.splice(+x.dataset.cdel, 1); save(); });
    $('#scrS').onchange = (e) => { st.s = e.target.value; savePref(); this.fill(); }; $('#scrD').onchange = (e) => { st.d = +e.target.value; savePref(); this.fill(); };
    $('#scrSave').onclick = async () => { let n = ''; const ok = await dialog('儲存條件', `<div class="field"><label>名稱</label><input id="scrN" value="${esc(st.p || '我的條件')}" maxlength="12"></div><div id="merr" class="small up"></div>`, [['', '取消'], ['ok', '儲存', 'primary']], (root) => () => { n = $('#scrN', root).value.trim(); return !n ? '請輸入名稱' : SCR_P.some((p) => p[0] === n) ? '不可與預設條件同名' : null; }); if (ok !== 'ok') return; if (!n || SCR_P.some((p) => p[0] === n)) return; S.pref.scrMine = mine.filter((m) => m[0] !== n).concat([[n, JSON.parse(JSON.stringify(st.c)), st.s, st.d]]); st.p = n; savePref(); this.fill(); };
    if ($('#scrDel')) $('#scrDel').onclick = () => { S.pref.scrMine = mine.filter((m) => m[0] !== st.p); st.p = ''; savePref(); this.fill(); };
  },
};
VIEWS.compare = {
  title: '個股比較',
  render(arg) {
    if (!(S.pref.cmp || []).length) S.pref.cmp = holdings().slice(0, 3).map((h) => h.symbol);
    if (arg) { S.pref.cmp = [arg].concat(S.pref.cmp.filter((x) => x !== arg)).slice(0, 5); }
    savePref();
    const rg = S.pref.cmpR || '1Y';
    return head('個股比較') + `<div class="card"><div class="row wrap"><div class="chips" style="flex-wrap:wrap">${(S.pref.cmp || []).map((s, i) => `<span class="chip on" style="border-color:${CMP_COLORS[i]}"><span style="color:${CMP_COLORS[i]}">●</span> ${esc(D.name(s))} <span class="muted num">${s}</span> <a data-rmc="${s}" style="cursor:pointer;margin-left:4px">✕</a></span>`).join('')}</div>
      <div class="search" style="width:220px">${(S.pref.cmp || []).length < 5 ? '<input id="cadd" placeholder="＋ 加入比較（最多 5 檔）" autocomplete="off"><div class="res hide"></div>' : ''}</div>
      <span class="sp"></span><div class="seg">${['3M', '6M', '1Y', '2Y', '5Y'].map((k) => `<button data-cr="${k}" class="${rg === k ? 'on' : ''}">${k.replace('M', ' 個月').replace('Y', ' 年')}</button>`).join('')}</div></div>
      <div class="chart-wrap" id="cmpC" style="margin-top:10px"><canvas></canvas><div class="chart-tip"></div></div><div id="cmsg" class="small muted"></div></div><div id="dyn" style="margin-top:12px"></div>`;
  },
  bind() {
    $$('[data-rmc]').forEach((a) => a.onclick = () => { S.pref.cmp = S.pref.cmp.filter((x) => x !== a.dataset.rmc); savePref(); location.hash = '#/compare'; route(); });
    $$('[data-cr]').forEach((b) => b.onclick = () => { S.pref.cmpR = b.dataset.cr; savePref(); route(); });
    if ($('#cadd')) bindSearch($('#cadd'), (sym) => { if (!S.pref.cmp.includes(sym)) S.pref.cmp.push(sym); savePref(); route(); });
    this.load();
  },
  async load() {
    if (!can('ANALYSIS')) { $('#dyn').innerHTML = lockCard('ANALYSIS', '個股比較（投資分析工具）'); return; }
    const syms = S.pref.cmp || []; if (!syms.length) { $('#cmsg').textContent = '請加入要比較的個股'; return; }
    const rg = S.pref.cmpR || '1Y'; const yr = { '3M': '6mo', '6M': '1y', '1Y': '2y', '2Y': '5y', '5Y': '10y' }[rg]; const days = { '3M': 92, '6M': 183, '1Y': 366, '2Y': 731, '5Y': 1827 }[rg];
    $('#cmsg').textContent = '載入中…';
    const data = await Promise.all(syms.map(async (s) => { const k = s + yr; return barCache[k] || (barCache[k] = await loadBars(s, yr)); }));
    if (S.route !== 'compare') return;
    const since = (() => { const d = tpeNow(); d.setDate(d.getDate() - days); return ymd(d); })();
    const sets = data.map((b) => b.filter((x) => x.d >= since));
    const dates = Array.from(new Set(sets.flat().map((x) => x.d))).sort();
    const series = sets.map((b, i) => { const m = new Map(b.map((x) => [x.d, x.c])); const base = b.length ? b[0].c : null; let last = null;
      return { v: dates.map((d) => { if (m.has(d)) last = m.get(d); return last != null && base ? (last / base - 1) * 100 : null; }), color: CMP_COLORS[i], name: syms[i] }; });
    $('#cmsg').textContent = dates.length ? '區間報酬率（%，不含股息）' : '無法取得歷史資料';
    if (dates.length > 1) drawSeries($('#cmpC'), dates, series, { h: 300, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%', zero: true });
    const [val, divh] = await Promise.all([kv('sx:val'), kv('sx:divh')]);
    const yearAgo = (() => { const d = tpeNow(); d.setFullYear(d.getFullYear() - 1); return ymd(d); })();
    const rows = syms.map((s, i) => {
      const b = sets[i]; if (!b.length) return { s, i };
      const c = b.map((x) => x.c); const ret = (c[c.length - 1] / c[0] - 1) * 100;
      const rets = c.slice(1).map((v, k) => Math.log(v / c[k])); const mean = rets.reduce((a, v) => a + v, 0) / Math.max(1, rets.length);
      const vol = Math.sqrt(rets.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, rets.length - 1)) * Math.sqrt(250) * 100;
      let peak = c[0], mdd = 0; c.forEach((v) => { peak = Math.max(peak, v); mdd = Math.min(mdd, (v / peak - 1) * 100); });
      const dv = ((divh && divh[s]) || []).filter(([d]) => d >= yearAgo).reduce((a, [, x]) => a + x, 0); const pv = val && val[s];
      const yrs = Math.max(1 / 12, (Date.parse(b[b.length - 1].d) - Date.parse(b[0].d)) / 31557600000); const cagr = (Math.pow(c[c.length - 1] / c[0], 1 / yrs) - 1) * 100;
      const sharpe = vol ? (cagr - 1.5) / vol : null; const rmap = new Map(b.slice(1).map((x, k) => [x.d, rets[k]]));
      return { s, i, rmap, cagr, sharpe, last: c[c.length - 1], ret, hi: Math.max(...b.map((x) => x.h)), lo: Math.min(...b.map((x) => x.l)), vol, mdd, dy: dv && c.length ? dv / c[c.length - 1] * 100 : (pv && pv[1]), pe: pv && pv[0], pb: pv && pv[2] };
    });
    $('#dyn').innerHTML = `<div class="card scroll-x"><table class="tbl"><thead><tr><th>個股</th><th>收盤</th><th>區間報酬</th><th>區間高</th><th>區間低</th><th>年化報酬</th><th>年化波動</th><th>夏普值</th><th>最大回撤</th><th>殖利率</th><th>本益比</th><th>淨值比</th></tr></thead><tbody>${rows.map((r) => `<tr class="click" data-go="#/s/${r.s}">
      <td class="nm"><span style="color:${CMP_COLORS[r.i]}">●</span> ${esc(D.name(r.s))} <span class="muted small num">${r.s}</span></td>
      ${r.last == null ? '<td colspan="11" class="muted">無資料</td>' : `<td class="num">${fmtPrice(r.last)}</td><td class="num ${cls(r.ret)}">${fmtPct(r.ret)}</td><td class="num">${fmtPrice(r.hi)}</td><td class="num">${fmtPrice(r.lo)}</td>
      <td class="num ${cls(r.cagr)}">${fmtPct(r.cagr, 1)}</td><td class="num">${r.vol.toFixed(1)}%</td><td class="num">${r.sharpe == null ? '—' : r.sharpe.toFixed(2)}</td><td class="num down">${r.mdd.toFixed(1)}%</td><td class="num">${r.dy ? r.dy.toFixed(2) + '%' : '—'}</td><td class="num">${r.pe ? fmt(r.pe, 1) : '—'}</td><td class="num">${r.pb ? fmt(r.pb, 2) : '—'}</td>`}</tr>`).join('')}</tbody></table>
      <div class="small muted" style="margin-top:6px">年化波動以日報酬標準差 × √250 計算；最大回撤為區間內從高點的最大跌幅；殖利率以近 12 個月配息 ÷ 收盤（台股）；年化報酬以區間首尾收盤換算；夏普值＝（年化報酬 − 1.5%）÷ 年化波動。</div></div>`;
    const ok = rows.filter((r) => r.rmap);
    if (ok.length >= 2) {
      const corr = (a, b) => { const xs = [], ys = []; a.rmap.forEach((v, d) => { const w = b.rmap.get(d); if (w != null && isFinite(v) && isFinite(w)) { xs.push(v); ys.push(w); } }); if (xs.length < 10) return null;
        const mx = xs.reduce((s0, v) => s0 + v, 0) / xs.length, my = ys.reduce((s0, v) => s0 + v, 0) / ys.length; let sxy = 0, sxx = 0, syy = 0; xs.forEach((v, k) => { sxy += (v - mx) * (ys[k] - my); sxx += (v - mx) ** 2; syy += (ys[k] - my) ** 2; }); return sxy / Math.sqrt(sxx * syy); };
      const col = (v) => v == null ? 'transparent' : `color-mix(in srgb, ${v >= 0 ? '#3b82f6' : '#f59e0b'} ${Math.round(Math.abs(v) * 55)}%, transparent)`;
      $('#dyn').insertAdjacentHTML('beforeend', `<div class="card" style="margin-top:12px"><h2>報酬相關係數（日報酬）</h2><div class="scroll-x"><table class="tbl"><thead><tr><th></th>${ok.map((r) => `<th><span style="color:${CMP_COLORS[r.i]}">●</span> ${esc(r.s)}</th>`).join('')}</tr></thead><tbody>
        ${ok.map((a) => `<tr><td class="nm"><span style="color:${CMP_COLORS[a.i]}">●</span> ${esc(D.name(a.s))}</td>${ok.map((b) => { const v = a === b ? 1 : corr(a, b); return `<td class="num" style="background:${col(v)}">${v == null ? '—' : v.toFixed(2)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="small muted" style="margin-top:6px">1 代表走勢完全同步、0 代表無關、負值代表反向；相關係數低的標的放在一起較能分散風險。台美股交易日不同，只比對同一天都有收盤的日子。</div></div>`);
    }
    // 基本面比較（台股個股，FinMind）
    const tw = syms.map((s, i) => [s, i]).filter(([s]) => !isUs(s) && !etfLike(s));
    if (tw.length && can('STOCKPRO')) {
      $('#dyn').insertAdjacentHTML('beforeend', '<div class="card" id="fmCmp" style="margin-top:12px"><h2>基本面比較<span class="r small muted">台股個股 · FinMind</span></h2><div class="small muted">讀取中…</div></div>');
      const got = await Promise.all(tw.map(async ([s, i]) => { const [rv, inc, val, fh] = await Promise.allSettled([fmGet('TaiwanStockMonthRevenue', s, 1500), fmGet('TaiwanStockFinancialStatements', s, 1280), fmGet('TaiwanStockPER', s, 1830), fmGet('TaiwanStockShareholding', s, 200)]);
        const qs = inc.status === 'fulfilled' ? fmQuarters(inc.value) : []; const e4 = qs.slice(0, 4).map((q) => q.eps).filter((x) => x != null);
        const vs = val.status === 'fulfilled' ? val.value.slice().sort((a, b) => (a.date < b.date ? 1 : -1)) : []; const hs = fh.status === 'fulfilled' ? fh.value.filter((o) => o.ForeignInvestmentSharesRatio != null).sort((a, b) => (a.date < b.date ? 1 : -1)) : [];
        return { s, i, m: rv.status === 'fulfilled' ? fmMonthRev(rv.value)[0] : null, ttm: e4.length === 4 ? e4.reduce((a, b) => a + b, 0) : null, q0: qs[0], v0: vs[0], band: fmBand(vs.map((x) => +x.PER)), fh: hs[0] ? +hs[0].ForeignInvestmentSharesRatio : null }; }));
      const el = $('#fmCmp'); if (!el || S.route !== 'compare') return;
      const p1 = (v, d = 1) => v == null || isNaN(v) ? '—' : (+v).toFixed(d) + '%';
      const R = [['月營收年增', (r) => [fmtPct(r.m && r.m.yoy, 1), cls(r.m && r.m.yoy)]], ['累計營收年增', (r) => [fmtPct(r.m && r.m.ytdYoy, 1), cls(r.m && r.m.ytdYoy)]], ['近四季 EPS', (r) => [r.ttm != null ? fmt(r.ttm, 2) : '—', '']],
        ['毛利率（最近一季）', (r) => [p1(r.q0 && r.q0.gm), '']], ['營益率（最近一季）', (r) => [p1(r.q0 && r.q0.om), '']], ['本益比', (r) => [r.v0 && +r.v0.PER > 0 ? fmt(+r.v0.PER, 1) : '—', '']],
        ['本益比 5 年位階', (r) => [r.band ? r.band.pct.toFixed(0) + '%' : '—', r.band ? (r.band.pct <= 25 ? 'down' : r.band.pct >= 75 ? 'up' : '') : '']], ['股價淨值比', (r) => [r.v0 && +r.v0.PBR > 0 ? fmt(+r.v0.PBR, 2) : '—', '']],
        ['外資持股', (r) => [p1(r.fh), '']]];
      el.innerHTML = `<h2>基本面比較<span class="r small muted">台股個股 · FinMind</span></h2><div class="scroll-x"><table class="tbl"><thead><tr><th></th>${got.map((r) => `<th><span style="color:${CMP_COLORS[r.i]}">●</span> ${esc(D.name(r.s))}</th>`).join('')}</tr></thead><tbody>
        ${R.map(([n, f]) => `<tr><td class="muted">${n}</td>${got.map((r) => { const [t, c] = f(r); return `<td class="num ${c}">${t}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="small muted" style="margin-top:6px">本益比位階越低代表相對自身過去 5 年越便宜。ETF 與美股不列入。</div>`;
    }
  },
  fill() {}, syms() { return S.pref.cmp || []; },
};

// ───────── 市場 ─────────
function limitTable(list) {
  if (!list.length) return '<div class="empty">' + (LIMIT.at ? '目前沒有' : '讀取中…') + '</div>';
  return `<div class="scroll-x"><table class="tbl"><thead><tr><th>個股</th><th>市場</th><th>成交</th><th>漲跌</th><th>漲跌幅</th><th>成交量</th></tr></thead><tbody>${list.map((x) => {
    const mine = holdings().some((h) => h.symbol === x.code); const w = D.quotes().some((q) => q.s === x.code);
    return `<tr class="click" data-go="#/s/${x.code}"><td class="nm">${esc(x.name)} <span class="muted small num">${x.code}</span>${mine ? ' <span class="tag" style="color:var(--primary)">持股</span>' : w ? ' <span class="tag muted">自選</span>' : ''}</td>
      <td>${x.market}</td><td class="num ${cls(x.change)}">${fmtPrice(x.price)}</td><td class="num ${cls(x.change)}">${fmtSigned(x.change, 2)}</td><td class="num ${cls(x.change)}">${fmtPct(x.pct)}</td><td class="num">${fmtInt(x.vol)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
VIEWS.limits = {
  title: '今日漲跌停',
  render() { return head('今日漲跌停', `<button class="btn" id="lr">重新整理</button>`) + `<div class="chips" style="margin-bottom:12px"><button class="chip ${(S.pref.lt || 'up') === 'up' ? 'on' : ''}" data-lt="up">漲停</button><button class="chip ${S.pref.lt === 'down' ? 'on' : ''}" data-lt="down">跌停</button></div><div id="dyn"></div>`; },
  bind() { $$('[data-lt]').forEach((b) => b.onclick = () => { S.pref.lt = b.dataset.lt; savePref(); route(); }); $('#lr').onclick = async () => { await refreshLimits(true); this.fill(); }; refreshLimits().then(() => S.route === 'limits' && this.fill()); },
  fill() { const up = (S.pref.lt || 'up') === 'up'; $('#dyn').innerHTML = `<div class="card"><h2 class="${up ? 'up' : 'down'}">${up ? '漲停' : '跌停'} ${LIMIT.at ? (up ? LIMIT.up : LIMIT.down).length + ' 家' : ''}<span class="r muted">${LIMIT.at ? '更新於 ' + hm(LIMIT.at) + ' · 上市＋上櫃' : ''}</span></h2>${limitTable(up ? LIMIT.up : LIMIT.down)}</div>`; },
  syms() { return []; },
};
// 指數與匯率
const WORLD = [['^TWII', '台灣加權'], ['^TWOII', '櫃買指數'], ['^DJI', '道瓊'], ['^IXIC', '那斯達克'], ['^GSPC', 'S&P 500'], ['^SOX', '費城半導體'], ['^N225', '日經 225'], ['^HSI', '恆生'], ['^KS11', '韓國綜合'], ['000001.SS', '上證']];
const FXS = [['TWD=X', '美元'], ['JPYTWD=X', '日圓'], ['EURTWD=X', '歐元'], ['CNYTWD=X', '人民幣'], ['HKDTWD=X', '港幣'], ['GBPTWD=X', '英鎊'], ['AUDTWD=X', '澳幣']];
VIEWS.index = {
  title: '指數與匯率',
  render() { return head('指數與匯率', `<a class="btn" href="#/market">‹ 市場</a>`) + '<div id="dyn"><div class="card empty">讀取中…</div></div>'; },
  async fill() {
    if (!can('MARKET')) { $('#dyn').innerHTML = lockCard('MARKET'); return; }
    const all = WORLD.concat(FXS).map((x) => x[0]);
    await Promise.all(all.filter((k) => !S.q[k] || Date.now() - (S.q[k].at || 0) > 60000).map(async (k) => { const v = await fetchUs(k); if (v) S.q[k] = { ...v, at: Date.now() }; }));
    if (S.route !== 'index') return;
    const card = ([k, n], d) => { const q = S.q[k] || {}; const ch = q.price && q.prev ? q.price - q.prev : 0;
      return `<div class="wt" data-go="#/ix/${encodeURIComponent(k)}"><div class="hd"><span class="nm">${esc(n)}</span><span class="cd" style="font-size:11px">${esc(k)}</span></div><div class="bd">
        <div class="px num ${cls(ch)}" style="font-size:24px">${q.price ? fmt(q.price, d) : '—'}</div><div class="ch num ${cls(ch)}">${q.price ? arrow(ch) + ' ' + fmt(Math.abs(ch), d) : ''}</div><div class="pc num ${cls(ch)}">${q.prev ? fmtPct(ch / q.prev * 100) : ''}</div>
        ${sparkSvg(q.spark, css(ch >= 0 ? '--up' : '--down'))}</div></div>`; };
    let h = `<h2 style="font-size:16px">全球指數</h2><div class="wall">${WORLD.map((x) => card(x, 2)).join('')}</div>
      <h2 style="font-size:16px;margin-top:18px">匯率（兌台幣）</h2><div class="wall">${FXS.map((x) => card(x, x[0] === 'JPYTWD=X' ? 4 : 3)).join('')}</div>
      <div class="card" style="margin-top:14px" id="dd"><h2>加權指數回撤</h2><div class="muted small">載入中…</div></div>`;
    $('#dyn').innerHTML = h;
    const k = 'w^TWII'; const w = barCache[k] || (barCache[k] = await fetchYahoo('^TWII', '10y', '1wk', 3600));
    if (S.route !== 'index' || !$('#dd') || !w || !w.timestamp) return;
    const c = w.indicators.quote[0].close; let peak = 0, peakD = '', mdd = 0, mddD = ''; const ds = [];
    w.timestamp.forEach((t, i) => { const v = c[i]; if (v == null) return; const d = new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10); if (v > peak) { peak = v; peakD = d; } const dd = (v / peak - 1) * 100; ds.push([d, dd]); if (dd < mdd) { mdd = dd; mddD = d; } });
    const curDD = ds.length ? ds[ds.length - 1][1] : 0;
    $('#dd').innerHTML = `<h2>加權指數回撤（近 10 年，週線）</h2><div class="grid g3"><div class="tile"><div class="k">目前距最高點</div><div class="v num ${cls(curDD)}">${fmtPct(curDD)}</div><div class="s muted">最高 ${fmt(peak, 0)}（${peakD}）</div></div>
      <div class="tile"><div class="k">期間最大回撤</div><div class="v num down">${fmtPct(mdd)}</div><div class="s muted">${mddD}</div></div><div class="tile"><div class="k">回撤 ≥ 10% 的週數占比</div><div class="v num">${(ds.filter((x) => x[1] <= -10).length / Math.max(1, ds.length) * 100).toFixed(0)}%</div></div></div>
      <div class="chart-wrap" id="ddC" style="margin-top:10px"><canvas></canvas><div class="chart-tip"></div></div>`;
    drawSeries($('#ddC'), ds.map((x) => x[0]), [{ v: ds.map((x) => x[1]), color: '#ef4444', name: '回撤', fill: true }], { h: 200, fmt: (v) => v.toFixed(1) + '%' });
  },
  syms() { return []; },
};
// ───────── 指數詳情（台股加權、櫃買、美股與全球指數）：圖表、關鍵數據、技術面、波動、回撤、每年報酬、月份季節性、盤後摘要／VIX ─────────
const IX_TW = { '^TWII': 't00', '^TWOII': 'o00' };
/** 月份漲跌（季節性）：可選近 3／5／10／20 年、全部（最大）或自訂年數；pairs＝[[Date, 月收盤], …]（由舊到新） */
const SEASON_Y = [3, 5, 10, 20, 0];
function seasonYears() { const v = S.pref.seasonY; return v == null ? 10 : +v; }
function seasonHtml(pairs) {
  const total = Math.max(0, (pairs.length - 1) / 12); const yrs = seasonYears();
  const use = yrs > 0 ? pairs.slice(-(Math.round(yrs * 12) + 1)) : pairs;
  const st = Array.from({ length: 12 }, () => []);
  use.forEach(([d, v], i) => { if (!i || !use[i - 1][1] || v == null) return; st[d.getUTCMonth()].push((v / use[i - 1][1] - 1) * 100); });
  const from = use.length ? use[0][0].getUTCFullYear() : '';
  const span = yrs > 0 && yrs < total ? '近 ' + yrs + ' 年' : '全部 ' + from + ' 年起（' + total.toFixed(total >= 10 ? 0 : 1) + ' 年）';
  const avgs = st.map((a) => (a.length ? a.reduce((x, v) => x + v, 0) / a.length : null));
  const valid = avgs.map((v, i) => [v, i]).filter(([v]) => v != null); const best = valid.slice().sort((a, b) => b[0] - a[0])[0], worst = valid.slice().sort((a, b) => a[0] - b[0])[0];
  const btn = (y) => `<button data-sy="${y}" class="${yrs === y || (y === 0 && yrs <= 0) ? 'on' : ''}">${y ? y + ' 年' : '最大'}</button>`;
  const custom = !SEASON_Y.includes(yrs);
  return `<h2>月份漲跌（${esc(span)}）</h2>
    <div class="row wrap" style="gap:8px;margin-bottom:8px"><div class="seg">${SEASON_Y.map(btn).join('')}</div>
      <label class="row small" style="gap:4px">自訂 <input type="number" data-syc min="1" max="100" step="1" value="${custom ? yrs : ''}" placeholder="年" style="width:64px;padding:4px 6px"> 年</label>
      <span class="small muted">資料共 ${total.toFixed(total >= 10 ? 0 : 1)} 年</span></div>
    <div class="mcal">${st.map((arr, i) => { const avg = avgs[i] || 0; const win = arr.length ? arr.filter((v) => v > 0).length / arr.length * 100 : 0;
      return `<div class="mc" style="background:color-mix(in srgb, ${css(avg >= 0 ? '--up' : '--down')} ${Math.round(Math.min(60, Math.abs(avg) * 8) + 8)}%, var(--card2))"><div class="small">${i + 1} 月</div><div class="num">${arr.length ? fmtPct(avg, 1) : '—'}</div><div class="small muted">勝率 ${win.toFixed(0)}%</div><div class="small muted">${arr.length} 次</div></div>`; }).join('')}</div>
    <div class="small muted" style="margin-top:6px">${best ? `表現最好 ${best[1] + 1} 月（平均 ${fmtPct(best[0], 1)}）、最差 ${worst[1] + 1} 月（平均 ${fmtPct(worst[0], 1)}）。` : ''}各月份平均報酬與上漲機率（月 K 收盤），過去表現不代表未來。</div>`;
}
/** 綁定年數切換；redraw 重新畫這張卡 */
function seasonBind(el, redraw) {
  if (!el) return;
  $$('[data-sy]', el).forEach((b) => b.onclick = () => { S.pref.seasonY = +b.dataset.sy; savePref(); redraw(); });
  const c = $('[data-syc]', el); if (c) c.onchange = () => { const v = Math.round(+c.value); if (v >= 1 && v <= 100) { S.pref.seasonY = v; savePref(); redraw(); } };
}
const IX_FROM = { t00: '^TWII', o00: '^TWOII' };
function ixName(sym) { const w = WORLD.concat(FXS).find(([k]) => k === sym); return w ? w[1] : (INDEXES.find((x) => x.k === sym) || {}).n || sym; }
function ixQuote(sym) { return S.q[IX_TW[sym] || sym] || {}; }
VIEWS.ix = {
  title: '指數',
  render(sym) {
    this.sym = sym = IX_FROM[sym] || sym || '^TWII'; const tw = !!IX_TW[sym];
    return `<div class="top"><a class="btn sm" href="javascript:history.back()">‹ 返回</a><h1>${esc(ixName(sym))} <span class="muted num" style="font-size:16px">${esc(sym)}</span></h1>
      <div class="seg">${['^TWII', '^TWOII', '^GSPC', '^IXIC', '^DJI', '^SOX'].map((k) => `<a class="btn sm ${k === sym ? 'primary' : ''}" href="#/ix/${encodeURIComponent(k)}">${esc(ixName(k).replace('台灣', ''))}</a>`).join('')}</div></div>
      <div id="ixq"></div>
      <div class="card" style="margin-top:12px"><div class="row wrap" style="margin-bottom:8px;gap:8px"><div class="seg" id="rg" style="flex-wrap:wrap">${Object.keys(RANGES).map((k) => `<button data-r="${k}" class="${(S.pref.ixRange || '1Y') === k ? 'on' : ''}">${RANGE_N[k]}</button>`).join('')}</div>
        <div class="seg" id="ctp">${CTYPES.map(([k, n]) => `<button data-ct="${k}" class="${(S.pref.ixType || 'line') === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        <span class="sp"></span><div class="seg" id="sb">${['KD', 'RSI', 'MACD'].map((k) => `<button data-s="${k}" class="${S.pref.ixSub === k ? 'on' : ''}">${k}</button>`).join('')}</div></div>
        <div class="chart-wrap"><canvas></canvas><div class="chart-tip"></div></div><div class="row between small muted" style="margin-top:4px"><span id="cmsg"></span><span class="zinfo"></span><span class="d-only">滾輪縮放 · 拖曳平移 · 雙擊還原</span></div></div>
      <div id="ixs" class="grid g2 stack" style="margin-top:12px"></div>`;
  },
  bind() {
    $$('[data-r]', $('#rg')).forEach((b) => b.onclick = () => { S.pref.ixRange = b.dataset.r; savePref(); $$('[data-r]', $('#rg')).forEach((x) => x.classList.toggle('on', x === b)); this.chart(); });
    $$('[data-ct]', $('#ctp')).forEach((b) => b.onclick = () => { S.pref.ixType = b.dataset.ct; savePref(); $$('[data-ct]', $('#ctp')).forEach((x) => x.classList.toggle('on', x === b)); this.chart(); });
    $$('[data-s]', $('#sb')).forEach((b) => b.onclick = () => { S.pref.ixSub = S.pref.ixSub === b.dataset.s ? '' : b.dataset.s; savePref(); $$('[data-s]', $('#sb')).forEach((x) => x.classList.toggle('on', x.dataset.s === S.pref.ixSub)); this.chart(); });
    this.chart(); this.stats();
  },
  fill() {
    const sym = this.sym; const q = ixQuote(sym); const ch = q.price && q.prev ? q.price - q.prev : 0; const el = $('#ixq'); if (!el) return;
    const vol = q.vol ? (IX_TW[sym] ? fmt(q.vol / 1e8, 0) + ' 億' : fmtVol(q.vol)) : '—';
    el.innerHTML = `<div class="card"><div class="row wrap" style="align-items:flex-end;gap:18px">
      <div><div class="num ${cls(ch)}" style="font-size:40px;font-weight:800;line-height:1">${q.price ? fmt(q.price, 2) : '—'}</div>
        <div class="num ${cls(ch)}" style="font-size:16px;margin-top:4px">${q.price ? arrow(ch) + ' ' + fmt(Math.abs(ch), 2) + ' 點　' + fmtPct(ch / q.prev * 100) : '—'}</div></div>
      <div class="grid g4" style="flex:1;min-width:280px;gap:8px">${[['開盤', q.open], ['最高', q.high], ['最低', q.low], ['昨收', q.prev]].map(([k, v]) => `<div><div class="small muted">${k}</div><div class="num">${v ? fmt(v, 2) : '—'}</div></div>`).join('')}
        <div><div class="small muted">${IX_TW[sym] ? '成交金額' : '成交量'}</div><div class="num">${vol}</div></div><div><div class="small muted">振幅</div><div class="num">${q.high && q.low && q.prev ? ((q.high - q.low) / q.prev * 100).toFixed(2) + '%' : '—'}</div></div>
        <div><div class="small muted">52 週區間</div><div class="num small">${q.l52 ? fmt(q.l52, 0) + '～' + fmt(q.h52, 0) : (this.r52 || '—')}</div></div><div><div class="small muted">更新</div><div class="num">${q.time ? hm(q.time) : '—'}</div></div></div></div></div>`;
  },
  syms() { return IX_TW[this.sym] ? [] : [this.sym]; },
  async chart() {
    const sym = this.sym; const [range, count, iv] = rangeOf(S.pref.ixRange || '1Y'); const ctype = S.pref.ixType || 'line'; const wrap = $('.chart-wrap'); if (!wrap) return;
    $('#sb').style.visibility = range === '1d' ? 'hidden' : '';
    if (range === '1d') {
      const bars5 = ctype === 'candle' || ctype === 'ohlc'; $('#cmsg').textContent = '載入當日走勢…';
      const r = await fetchYahoo(sym, '1d', bars5 ? '5m' : '1m', 30); if (S.route !== 'ix' || this.sym !== sym) return;
      if (!r || !r.timestamp) { $('#cmsg').textContent = '無法取得當日走勢'; return; }
      const q0 = r.indicators.quote[0]; const prev = r.meta.chartPreviousClose || r.meta.previousClose; const dd = new Date((r.timestamp[0] + 8 * 3600) * 1000);
      $('#cmsg').textContent = '交易日 ' + dd.toISOString().slice(0, 10).replace(/-/g, '/') + '（週' + '日一二三四五六'[dd.getUTCDay()] + '）';
      if (bars5) { const bs = r.timestamp.map((t, i) => (q0.close[i] == null || q0.open[i] == null ? null : { d: hm(t * 1000), o: q0.open[i], h: q0.high[i], l: q0.low[i], c: q0.close[i], v: q0.volume[i] || 0 })).filter(Boolean);
        drawChart(wrap, bs, { key: sym + '1d5', count: 0, type: ctype, intraday: true, base: prev }); return; }
      drawLine(wrap, r.timestamp.map((t, i) => [t * 1000, q0.close[i], q0.volume[i]]).filter((p) => p[1] != null), prev, true, ctype); return;
    }
    const key = sym + range + (iv || ''); $('#cmsg').textContent = barCache[key] ? '' : '載入走勢…';
    const bars = barCache[key] || (barCache[key] = await loadBars(sym, range, iv)); if (S.route !== 'ix' || this.sym !== sym) return;
    if (!bars.length) { $('#cmsg').textContent = '無法取得走勢資料'; return; }
    const q = ixQuote(sym); const all = bars.slice(); const today = ymd();
    if (q.price && iv !== '1wk' && (IX_TW[sym] ? twOpen() : true)) { const last = all[all.length - 1]; const cur = { d: today, o: q.open || q.price, h: Math.max(q.high || q.price, q.price), l: Math.min(q.low || q.price, q.price), c: q.price, v: last.d === today ? last.v : 0 }; if (last.d === today) all[all.length - 1] = cur; else if (IX_TW[sym]) all.push(cur); }
    $('#cmsg').textContent = iv === '1wk' ? '週 K（' + all[0].d + ' 起）' : '';
    drawChart(wrap, all, { key: key + count, count: count || all.length, type: ctype, weekly: iv === '1wk', sub: can('CHART') ? S.pref.ixSub || null : null, mas: S.pref.mas, pats: ctype === 'candle' && S.pref.kpat !== false && can('KLINE') });
  },
  async stats() {
    const sym = this.sym; const tw = !!IX_TW[sym]; const el = $('#ixs'); if (!el) return;
    el.innerHTML = `<div class="card" id="ixKey" style="grid-column:1/-1"><h2>關鍵數據</h2><div class="small muted">計算中…</div></div>${tw ? '<div class="card" id="ixMkt"></div>' : '<div class="card" id="ixVix"></div>'}
      <div class="card" id="ixTech"></div><div class="card" id="ixVol"></div><div class="card" id="ixKa" style="grid-column:1/-1"></div><div class="card" id="ixDd"></div><div class="card" id="ixBand"></div>
      <div class="card" id="ixYr"></div><div class="card" id="ixSeason"></div>`;
    const [d2, wk, mo] = await Promise.all([loadBars(sym, '2y').catch(() => []), fetchYahoo(sym, 'max', '1wk', 3600), fetchYahoo(sym, 'max', '1mo', 86400)]);
    if (S.route !== 'ix' || this.sym !== sym) return;
    const q = ixQuote(sym); const b = d2.slice(); if (q.price && b.length) { const l = b[b.length - 1]; if (l.d === ymd()) l.c = q.price; else if (tw && twOpen()) b.push({ d: ymd(), o: q.open || q.price, h: q.high || q.price, l: q.low || q.price, c: q.price, v: 0 }); }
    const px0 = q.price || (b.length ? b[b.length - 1].c : 0);
    const W = wk && wk.timestamp ? wk.timestamp.map((t, i) => [new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10), wk.indicators.quote[0].close[i]]).filter((x) => x[1] != null) : [];
    const M = mo && mo.timestamp ? mo.timestamp.map((t, i) => [new Date((t + 8 * 3600) * 1000), mo.indicators.quote[0].close[i]]).filter((x) => x[1] != null) : [];
    // 關鍵數據：各期報酬、52 週位置、年化報酬
    const back = (days) => { const t = tpeNow(); t.setDate(t.getDate() - days); const ds = ymd(t); const x = b.filter((k) => k.d <= ds).pop(); return x ? (px0 / x.c - 1) * 100 : null; };
    const backW = (yrs) => { const t = new Date(); t.setFullYear(t.getFullYear() - yrs); const ds = t.toISOString().slice(0, 10); const x = W.filter((k) => k[0] <= ds).pop(); return x ? (px0 / x[1] - 1) * 100 : null; };
    const ytdBase = b.filter((k) => k.d < tpeNow().getFullYear() + '/01/01').pop(); const y1 = b.slice(-250);
    const h52 = y1.length ? Math.max(...y1.map((x) => x.h)) : null, l52 = y1.length ? Math.min(...y1.map((x) => x.l)) : null; this.r52 = h52 ? fmt(l52, 0) + '～' + fmt(h52, 0) : null;
    const r5 = backW(5); const cagr5 = r5 != null ? (Math.pow(1 + r5 / 100, 1 / 5) - 1) * 100 : null; const r10 = backW(10); const cagr10 = r10 != null ? (Math.pow(1 + r10 / 100, 1 / 10) - 1) * 100 : null;
    const ath = W.length ? Math.max(...W.map((x) => x[1]), px0) : null;
    const pc = (v) => (v == null ? '—' : `<span class="${cls(v)}">${fmtPct(v)}</span>`);
    $('#ixKey').innerHTML = `<h2>關鍵數據</h2><div class="grid g4" style="gap:10px">${[['今年以來', pc(ytdBase ? (px0 / ytdBase.c - 1) * 100 : null)], ['近 1 個月', pc(back(30))], ['近 3 個月', pc(back(91))], ['近 6 個月', pc(back(182))], ['近 1 年', pc(back(365))], ['近 3 年', pc(backW(3))], ['近 5 年', pc(r5)], ['近 10 年', pc(r10)],
      ['5 年年化', pc(cagr5)], ['10 年年化', pc(cagr10)], ['52 週高／低', h52 ? fmt(h52, 0) + '／' + fmt(l52, 0) : '—'], ['52 週位置', h52 > l52 ? ((px0 - l52) / (h52 - l52) * 100).toFixed(0) + '%' : '—'],
      ['距歷史高點', ath ? pc((px0 / ath - 1) * 100) : '—'], ['歷史高點', ath ? fmt(ath, 0) : '—'], ['距 52 週高', h52 ? pc((px0 / h52 - 1) * 100) : '—'], ['距 52 週低', l52 ? pc((px0 / l52 - 1) * 100) : '—']].map(([k, v]) => `<div><div class="small muted">${k}</div><div class="num">${v}</div></div>`).join('')}</div>`;
    this.fill();
    // 技術面：均線位置、乖離、RSI、KD、MACD
    if (b.length >= 60) {
      const c = b.map((x) => x.c), n = c.length - 1; const ma = (p) => sma(c, p)[n]; const m5 = ma(5), m20 = ma(20), m60 = ma(60), m120 = ma(120), m240 = ma(240);
      const r = rsiArr(c)[n]; const [K, Dd] = kdArr(b.map((x) => x.h), b.map((x) => x.l), c); const [dif, dea] = macdArr(c);
      const rows = [['月線 MA20', m20], ['季線 MA60', m60], ['半年線 MA120', m120], ['年線 MA240', m240]].filter(([, v]) => v).map(([k, v]) => [k, fmt(v, 0), (px0 >= v ? '站上' : '跌破') + ' ' + fmtPct((px0 / v - 1) * 100), px0 >= v ? 'up' : 'down']);
      const trend = m5 > m20 && m20 > m60 ? ['多頭排列', 'up'] : m5 < m20 && m20 < m60 ? ['空頭排列', 'down'] : ['均線糾結', ''];
      $('#ixTech').innerHTML = `<h2>技術面<span class="r tag ${trend[1]}">${trend[0]}</span></h2><div class="list">${rows.map(([k, v, t, cl]) => `<div class="it" style="cursor:default"><div class="l"><div class="t1">${k}</div><div class="t2 num">${v}</div></div><div class="num ${cl}">${t}</div></div>`).join('')}
        <div class="it" style="cursor:default"><div class="l"><div class="t1">RSI(14)</div></div><div class="num ${r >= 70 ? 'up' : r <= 30 ? 'down' : ''}">${r != null ? r.toFixed(1) + (r >= 70 ? ' 超買' : r <= 30 ? ' 超賣' : '') : '—'}</div></div>
        <div class="it" style="cursor:default"><div class="l"><div class="t1">KD(9)</div></div><div class="num">${K[n] != null ? K[n].toFixed(0) + '／' + Dd[n].toFixed(0) + (K[n - 1] <= Dd[n - 1] && K[n] > Dd[n] ? ' 黃金交叉' : K[n - 1] >= Dd[n - 1] && K[n] < Dd[n] ? ' 死亡交叉' : '') : '—'}</div></div>
        <div class="it" style="cursor:default"><div class="l"><div class="t1">MACD</div></div><div class="num ${dif[n] >= dea[n] ? 'up' : 'down'}">${dif[n] != null ? 'DIF ' + dif[n].toFixed(1) + '／DEA ' + dea[n].toFixed(1) : '—'}</div></div></div>`;
      const v = volaOf(b); const kr = klineAnalyze(b);
      if (v) { $('#ixVol').innerHTML = voCardHtml(v, null).replace('<h2>波動', '<h2>波動（日 K）'); drawSeries($('#voChart'), v.series.map((x) => x[0]), [{ v: v.series.map((x) => x[1]), color: '#f59e0b', name: '年化波動', fill: true }], { h: 180, fmt: (x) => x.toFixed(0) + '%', key: 'ixvo' + sym }); }
      if (kr) { $('#ixKa').innerHTML = kaCardHtml(kr, false, sym).replace(/<span class="seg" id="kaTf">[\s\S]*?<\/span><\/span><\/h2>/, '</h2>'); drawChart($('#kaChart'), b.slice(-120), { key: 'ixka' + sym, count: 60, pats: true, mas: [20, 60], H: 280 }); }
      const bd = bandInfo(b, px0); const bs = bandSeries(b); if (bd && bs) { $('#ixBand').innerHTML = bandCardHtml('一年價格位階', bd, px0, (x) => fmt(x, 0), 'ixBz'); drawBandZ($('#ixBz'), bs, px0, bd); }
    } else { $('#ixTech').innerHTML = '<h2>技術面</h2><div class="small muted">資料不足</div>'; }
    // 回撤（週線，全期間）
    if (W.length > 20) { let peak = 0, peakD = '', mdd = 0, mddD = ''; const ds = []; W.forEach(([d, v]) => { if (v > peak) { peak = v; peakD = d; } const x = (v / peak - 1) * 100; ds.push([d, x]); if (x < mdd) { mdd = x; mddD = d; } });
      const cur = ds[ds.length - 1][1]; const recent = ds.slice(-520);
      $('#ixDd').innerHTML = `<h2>回撤（週線）</h2><div class="grid g3"><div class="tile"><div class="k">目前距最高點</div><div class="v num ${cls(cur)}">${fmtPct(cur)}</div><div class="s muted">最高 ${fmt(peak, 0)}（${peakD}）</div></div>
        <div class="tile"><div class="k">歷史最大回撤</div><div class="v num down">${fmtPct(mdd)}</div><div class="s muted">${mddD}</div></div><div class="tile"><div class="k">近 10 年回撤 ≥ 10% 週數</div><div class="v num">${(recent.filter((x) => x[1] <= -10).length / Math.max(1, recent.length) * 100).toFixed(0)}%</div></div></div>
        <div class="chart-wrap" id="ixDdC" style="margin-top:10px"><canvas></canvas><div class="chart-tip"></div></div><div class="small muted" style="margin-top:4px">${tw ? '<a href="#/crash">歷次大跌與修復時間 ›</a>' : ''}</div>`;
      drawSeries($('#ixDdC'), recent.map((x) => x[0]), [{ v: recent.map((x) => x[1]), color: '#ef4444', name: '回撤', fill: true }], { h: 180, fmt: (x) => x.toFixed(1) + '%', key: 'ixdd' + sym }); }
    // 每年報酬（月線）
    if (M.length > 12) { const yr = {}; M.forEach(([d, v]) => { yr[d.getUTCFullYear()] = v; }); const ys = Object.keys(yr).map(Number).sort(); const rows = [];
      for (let i = 1; i < ys.length; i++) rows.push([ys[i], (yr[ys[i]] / yr[ys[i - 1]] - 1) * 100]); const last = rows.slice(-15).reverse(); const mx = Math.max(...last.map((x) => Math.abs(x[1])), 1);
      const up = rows.filter((x) => x[1] > 0).length;
      $('#ixYr').innerHTML = `<h2>每年報酬<span class="r small muted">上漲 ${up}／${rows.length} 年</span></h2>${last.map(([y, r]) => `<div class="row" style="gap:8px;height:24px"><span class="small num" style="width:42px">${y}${y === new Date().getFullYear() ? '*' : ''}</span><div class="sp" style="position:relative;height:10px"><div style="position:absolute;top:0;bottom:0;${r >= 0 ? 'left:50%' : 'right:50%'};width:${(Math.abs(r) / mx * 50).toFixed(1)}%;background:${css(r >= 0 ? '--up' : '--down')};border-radius:3px"></div></div><span class="num small ${cls(r)}" style="width:62px;text-align:right">${fmtPct(r, 1)}</span></div>`).join('')}<div class="small muted" style="margin-top:4px">＊今年為年初至今。價格指數不含股息。</div>`;
      // 月份季節性（可選年數，最大＝全部歷史）
      const drawS = () => { const el = $('#ixSeason'); if (!el) return; el.innerHTML = seasonHtml(M); seasonBind(el, drawS); }; drawS(); }
    // 台股：盤後摘要；美股：VIX
    if (tw) { const m = await kv('sx:mkt'); const el2 = $('#ixMkt'); if (!el2) return;
      el2.innerHTML = `<h2>盤後摘要<span class="r small muted">${esc((m && m.d) || '')}</span></h2>${m ? `<div class="grid g2" style="gap:10px"><div><div class="small muted">上漲／下跌／平盤</div><div class="num big"><span class="up">${m.u}</span>／<span class="down">${m.dn}</span>／${m.f}</div><div class="small">漲停 <span class="up">${m.lu}</span>　跌停 <span class="down">${m.ld}</span></div></div>
        <div><div class="small muted">成交值</div><div class="num big">${fmt(m.tv, 0)} 億</div><div class="small muted">上櫃 ${fmt(m.ov, 0)} 億</div></div>
        <div style="grid-column:1/-1"><div class="small muted">三大法人買賣超（億）</div><div class="num">${m.inst ? `外資 <span class="${cls(m.fy)}">${fmtSigned(m.fy, 1)}</span>　投信 <span class="${cls(m.ty)}">${fmtSigned(m.ty, 1)}</span>　自營 <span class="${cls(m.dy)}">${fmtSigned(m.dy, 1)}</span>` : '—'}</div></div></div>
        ${m.mood ? `<div class="small text2" style="margin-top:8px">市場情緒：${esc(m.mood)}</div>` : ''}` : '<div class="small muted">尚無盤後摘要（交易日收盤後更新）。</div>'}<a class="small" href="#/market">市場總覽 ›</a>`; }
    else { const v = await fetchUs('^VIX'); const el2 = $('#ixVix'); if (!el2) return; const x = v && v.price; const ch = v && v.prev ? v.price - v.prev : 0;
      el2.innerHTML = `<h2>恐慌指數 VIX</h2>${x ? `<div class="row" style="gap:12px;align-items:flex-end"><div class="num" style="font-size:32px;font-weight:800">${fmt(x, 2)}</div><div class="num ${cls(-ch)}">${arrow(ch)} ${fmt(Math.abs(ch), 2)}（${fmtPct(ch / v.prev * 100)}）</div></div>
        <div class="small text2" style="margin-top:6px">${x < 15 ? '低波動：市場情緒樂觀' : x < 20 ? '正常區間' : x < 30 ? '波動升高：市場偏緊張' : '高度恐慌：波動劇烈'}</div><div class="small muted" style="margin-top:4px">VIX 衡量 S&P 500 未來 30 天預期波動；20 以下為常態，30 以上為恐慌。</div>` : '<div class="small muted">取不到 VIX</div>'}`; }
  },
};

// 排行（Yahoo 奇摩股市）
const RANK_SORT = [['up', '漲幅', '-changePercent'], ['down', '跌幅', 'changePercent'], ['vol', '成交量', '-volume'], ['amt', '成交值', '-turnoverK']];
VIEWS.rank = {
  title: '排行',
  render() {
    const k = S.pref.rk || 'up', ex = S.pref.rex || 'TAI';
    return head('排行', `<a class="btn" href="#/market">‹ 市場</a>`) + `<div class="row wrap" style="margin-bottom:12px"><div class="chips">${RANK_SORT.map(([id, n]) => `<button class="chip ${k === id ? 'on' : ''}" data-rk="${id}">${n}</button>`).join('')}</div>
      <span class="sp"></span><div class="seg"><button data-ex="TAI" class="${ex === 'TAI' ? 'on' : ''}">上市</button><button data-ex="TWO" class="${ex === 'TWO' ? 'on' : ''}">上櫃</button></div></div><div id="dyn"><div class="card empty">讀取中…</div></div>`;
  },
  bind() {
    $$('[data-rk]').forEach((b) => b.onclick = () => { S.pref.rk = b.dataset.rk; savePref(); route(); });
    $$('[data-ex]').forEach((b) => b.onclick = () => { S.pref.rex = b.dataset.ex; savePref(); route(); });
  },
  async fill() {
    if (!can('MARKET')) { $('#dyn').innerHTML = lockCard('MARKET'); return; }
    const k = S.pref.rk || 'up', ex = S.pref.rex || 'TAI'; const sort = RANK_SORT.find((x) => x[0] === k)[2];
    let list = [];
    try {
      const j = await px('https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.rank;exchange=' + ex + ';limit=50;offset=0;period=1D;sortBy=' + sort, 60);
      const n = (v) => parseFloat(String(v == null ? '' : v).replace(/[,%+]/g, '')) || 0;
      list = (j.list || []).map((o) => ({ code: String(o.symbol).split('.')[0], name: o.name, market: ex === 'TAI' ? '上市' : '上櫃', price: n(o.price), change: n(o.change), pct: n(o.changePercent), vol: n(o.volume), lu: o.limitUp, ld: o.limitDown }));
    } catch (e) {}
    if (S.route !== 'rank') return;
    $('#dyn').innerHTML = `<div class="card">${list.length ? limitTable(list) : '<div class="empty">無法取得排行，請稍後再試。</div>'}<div class="small muted" style="margin-top:6px">資料來源：Yahoo 奇摩股市，約 1 分鐘更新。</div></div>`;
  },
  syms() { return []; },
};
VIEWS.market = {
  title: '市場',
  render() { return head('市場') + '<div id="tk"></div><div id="dyn"></div>'; },
  bind() { refreshLimits().then(() => S.route === 'market' && this.fill()); },
  async fill() {
    $('#tk').innerHTML = tickerHtml();
    if (!can('MARKET')) { $('#dyn').innerHTML = lockCard('MARKET'); return; }
    const m = await kv('sx:mkt'); if (S.route !== 'market') return;
    let h = '';
    if (m) {
      const mv = (l, title) => `<div class="card"><h2>${title}</h2><div class="list">${(l || []).map((x) => `<div class="it" data-go="#/s/${x.s}"><div class="l"><div class="t1">${esc(x.n)} <span class="muted small num">${x.s}</span></div><div class="t2">成交值 ${fmt(x.v, 1)} 億</div></div><div class="r"><div class="num ${cls(x.c)}">${fmtPrice(x.p)}</div><div class="num small ${cls(x.c)}">${fmtPct(x.c)}</div></div></div>`).join('')}</div></div>`;
      h += `<div class="card" style="margin-bottom:12px"><h2>盤後摘要<span class="r muted">${esc(m.d || '')}</span></h2><div class="grid g4">
        <div><div class="small muted">加權指數</div><div class="num big ${cls(m.ixc)}">${fmt(m.ix, 2)}</div><div class="num small ${cls(m.ixc)}">${fmtSigned(m.ixc, 2)}（${fmtPct(m.ixp)}）</div></div>
        <div><div class="small muted">上漲／下跌／平盤</div><div class="num big"><span class="up">${m.u}</span>／<span class="down">${m.dn}</span>／${m.f}</div><div class="small">漲停 <span class="up">${m.lu}</span>　跌停 <span class="down">${m.ld}</span></div></div>
        <div><div class="small muted">成交值（億）</div><div class="num big">${fmt(m.tv, 0)}</div><div class="small muted">上櫃 ${fmt(m.ov, 0)} 億</div></div>
        <div><div class="small muted">三大法人（億）</div><div class="num">${m.inst ? `外資 <span class="${cls(m.fy)}">${fmtSigned(m.fy, 1)}</span><br>投信 <span class="${cls(m.ty)}">${fmtSigned(m.ty, 1)}</span>　自營 <span class="${cls(m.dy)}">${fmtSigned(m.dy, 1)}</span>` : '—'}</div></div></div>
        ${m.mood ? `<div class="small text2" style="margin-top:8px">市場情緒：${esc(m.mood)}</div>` : ''}
        ${m.sec && m.sec.length ? `<div class="chips wrap" style="margin-top:10px;flex-wrap:wrap">${m.sec.slice(0, 16).map(([n, p]) => `<span class="chip"><span class="${cls(p)}">${esc(n)} ${fmtPct(p)}</span></span>`).join('')}</div>` : ''}</div>
        <div class="grid g3 stack">${mv(m.g, '強勢股')}${mv(m.l, '弱勢股')}${mv(m.a, '成交熱門')}</div>`;
    }
    h += `<div class="row wrap" style="margin-top:12px"><a class="btn primary" href="#/us">美股市場 ›</a><a class="btn primary" href="#/etf">ETF 市場 ›</a><a class="btn primary" href="#/index">全球指數與匯率 ›</a><a class="btn primary" href="#/crash">歷次大跌 ›</a>${can('REPORT') ? '<a class="btn primary" href="#/report">盤後報告 ›</a>' : ''}${RANK_SORT.map(([id, n]) => `<a class="btn" href="#/rank" data-rk2="${id}">${n}排行 ›</a>`).join('')}</div>`;
    h += `<div class="grid g2 stack" style="margin-top:12px"><div class="card"><h2 class="up">漲停 ${LIMIT.at ? LIMIT.up.length + ' 家' : ''}<a class="r" href="#/limits">全部 ›</a></h2>${limitTable(LIMIT.up.slice(0, 15))}</div>
      <div class="card"><h2 class="down">跌停 ${LIMIT.at ? LIMIT.down.length + ' 家' : ''}<a class="r" href="#/limits">全部 ›</a></h2>${limitTable(LIMIT.down.slice(0, 15))}</div></div>`;
    $('#dyn').innerHTML = h;
    $$('[data-rk2]').forEach((a) => a.onclick = () => { S.pref.rk = a.dataset.rk2; savePref(); });
  },
  syms() { return []; },
};

// ───────── 美股市場 ─────────
const US_SECT = [['XLK', '科技'], ['XLC', '通訊服務'], ['XLY', '非必需消費'], ['XLF', '金融'], ['XLV', '醫療保健'], ['XLI', '工業'],
  ['XLE', '能源'], ['XLB', '原物料'], ['XLP', '必需消費'], ['XLU', '公用事業'], ['XLRE', '房地產'], ['SMH', '半導體']];
const US_FUT = [['ES=F', 'S&P 期貨'], ['NQ=F', '那斯達克期貨'], ['YM=F', '道瓊期貨'], ['^VIX', 'VIX 恐慌指數'], ['^TNX', '美 10 年債殖利率'], ['DX-Y.NYB', '美元指數'],
  ['GC=F', '黃金'], ['CL=F', '原油'], ['BTC-USD', '比特幣'], ['ETH-USD', '以太幣'], ['^GDAXI', '德國 DAX'], ['^FTSE', '英國富時']];
const US_MEGA = [['AAPL', '蘋果'], ['MSFT', '微軟'], ['NVDA', '輝達'], ['GOOGL', 'Alphabet'], ['AMZN', '亞馬遜'], ['META', 'Meta'], ['TSLA', '特斯拉'],
  ['AVGO', '博通'], ['TSM', '台積電 ADR'], ['AMD', '超微'], ['NFLX', '網飛'], ['BRK-B', '波克夏']];
/** 批次取美股／期貨報價（60 秒內不重抓） */
async function usBatch(list) {
  await Promise.all(list.filter(([k]) => !S.q[k] || !S.q[k].price || Date.now() - (S.q[k].at || 0) > 60000).map(async ([k, n]) => {
    const v = await fetchUs(k); if (v) S.q[k] = { ...(S.q[k] || {}), ...v, name: S.q[k] && S.q[k].name && !/^[A-Z]/.test(S.q[k].name) ? S.q[k].name : n, at: Date.now() };
  }));
}
function qPct(k) { const q = S.q[k] || {}; return q.price && q.prev ? (q.price / q.prev - 1) * 100 : null; }
function quoteCard([k, n], d = 2) {
  const q = S.q[k] || {}; const ch = q.price && q.prev ? q.price - q.prev : 0;
  return `<div class="wt" data-go="#/s/${encodeURIComponent(k)}"><div class="hd"><span class="nm">${esc(n)}</span><span class="cd" style="font-size:11px">${esc(k)}</span></div><div class="bd">
    <div class="px num ${cls(ch)}" style="font-size:22px">${q.price ? fmt(q.price, d) : '—'}</div><div class="ch num ${cls(ch)}">${q.price ? arrow(ch) + ' ' + fmt(Math.abs(ch), d) : ''}</div><div class="pc num ${cls(ch)}">${q.prev ? fmtPct(ch / q.prev * 100) : ''}</div>
    ${sparkSvg(q.spark, css(ch >= 0 ? '--up' : '--down'))}</div></div>`;
}
function heatTiles(list) {
  const UP = css('--up'), DN = css('--down');
  return `<div class="heat">${list.map(([k, n]) => { const q = S.q[k] || {}; const pc = qPct(k) || 0; const a = Math.min(1, Math.abs(pc) / 3) * 0.85 + (pc ? 0.15 : 0);
    const bg = pc === 0 ? 'var(--card2)' : `color-mix(in srgb, ${pc > 0 ? UP : DN} ${Math.round(a * 100)}%, var(--card))`;
    return `<div class="ht" data-go="#/s/${encodeURIComponent(k)}" style="background:${bg}"><div class="n">${esc(n)}</div><div class="c num">${esc(k)}</div><div class="p num">${q.price ? fmtPct(pc) : '—'}</div><div class="c num">${q.price ? fmt(q.price, 2) : ''}</div></div>`; }).join('')}</div>`;
}
VIEWS.us = {
  title: '美股市場',
  render() { return head('美股市場', `<a class="btn" href="#/market">‹ 市場</a>`) + '<div id="dyn"><div class="card empty">讀取中…</div></div>'; },
  async fill() {
    if (!can('MARKET')) { $('#dyn').innerHTML = lockCard('MARKET'); return; }
    const idx = [['^DJI', '道瓊'], ['^IXIC', '那斯達克'], ['^GSPC', 'S&P 500'], ['^SOX', '費城半導體'], ['^RUT', '羅素 2000']];
    await usBatch(idx.concat(US_SECT, US_FUT, US_MEGA));
    if (S.route !== 'us') return;
    const sect = US_SECT.slice().sort((a, b) => (qPct(b[0]) ?? -99) - (qPct(a[0]) ?? -99));
    const breadth = US_MEGA.map(([k]) => qPct(k)).filter((v) => v != null); const ups = breadth.filter((v) => v > 0).length;
    const lead = sect[0], lag = sect[sect.length - 1];
    const meta = (S.q['^GSPC'] || {}).time;
    const ph = usPhase(); const extOn = ph.k !== 'REG';
    const exSyms = Array.from(new Set(US_MEGA.map(([k]) => k).concat(D.quotes().map((q) => q.s), holdings().map((h) => h.symbol)).filter((k) => isUs(k) && !/^\^|=|-USD$/.test(k))));
    const exRows = exSyms.filter((k) => (S.q[k] || {}).ext && S.q[k].ext.price).sort((a, b) => (S.q[b].ext.pct || 0) - (S.q[a].ext.pct || 0));
    const exLb = exRows.length ? S.q[exRows[0]].ext.label : (ph.k === 'PRE' ? '盤前' : '盤後');
    const exRow = (k) => { const q = S.q[k]; const e = q.ext; const n = (US_MEGA.find((x) => x[0] === k) || [])[1] || D.name(k);
      return `<tr class="click" data-go="#/s/${k}"><td class="nm">${esc(n)} <span class="muted small num">${k}</span>${holdings().some((h) => h.symbol === k) ? ' <span class="tag" style="color:var(--primary)">持股</span>' : ''}</td><td class="num">${fmtPrice(q.price)}</td><td class="num ${cls(e.pct)}">${fmt(e.price, 2)}</td><td class="num ${cls(e.pct)}">${fmtPct(e.pct)}</td><td class="num muted">${hm(e.time)}</td></tr>`; };
    const sess = `<div class="card" style="margin-bottom:12px"><div class="row between wrap" style="align-items:center;gap:8px"><div>${usSessLine()}</div><div class="small muted">${usSchedTxt()}</div></div>
      ${extOn ? `<div class="small text2" style="margin-top:8px">非正常交易時段：指數為最近收盤，盤前可參考下方指數期貨與個股${exLb}成交。</div><div class="wall" style="--wall-w:170px;margin-top:8px">${US_FUT.slice(0, 3).map((x) => quoteCard(x)).join('')}</div>` : ''}
      ${exRows.length ? `<h2 style="margin-top:12px">${exLb}漲跌排行<span class="r small muted">權值股、自選、持股 ${exRows.length} 檔</span></h2><div class="scroll-x"><table class="tbl"><thead><tr><th>個股</th><th>收盤</th><th>${exLb}價</th><th>${exLb}漲跌</th><th>時間</th></tr></thead><tbody>
        ${(exRows.length > 12 ? exRows.slice(0, 6).concat(exRows.slice(-6)) : exRows).map(exRow).join('')}</tbody></table></div>${exRows.length > 12 ? '<div class="small muted">列出漲幅前 6 與跌幅前 6</div>' : ''}` : extOn && ph.k !== 'OFF' ? '<div class="small muted" style="margin-top:8px">目前還沒有' + exLb + '成交資料（盤前 ' + usTw(240) + ' 起陸續出現）。</div>' : ''}</div>`;
    $('#dyn').innerHTML = sess + `<div class="wall" style="margin-bottom:12px">${idx.map((x) => quoteCard(x)).join('')}</div>
      <div class="card" style="margin-bottom:12px"><h2>類股表現（SPDR 類股 ETF）<span class="r small muted">${meta ? '更新 ' + new Date(meta).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span></h2>
        ${heatTiles(sect)}
        <div class="small text2" style="margin-top:8px">領漲：${esc(lead[1])} <span class="num ${cls(qPct(lead[0]))}">${fmtPct(qPct(lead[0]))}</span>　領跌：${esc(lag[1])} <span class="num ${cls(qPct(lag[0]))}">${fmtPct(qPct(lag[0]))}</span>　權值股 ${ups}／${breadth.length} 上漲</div></div>
      <div class="grid g2 stack"><div class="card"><h2>權值股</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>個股</th><th>價格</th><th>漲跌幅</th>${exRows.length ? '<th>' + exLb + '</th>' : ''}<th>成交量</th></tr></thead><tbody>
        ${US_MEGA.slice().sort((a, b) => (qPct(b[0]) ?? -99) - (qPct(a[0]) ?? -99)).map(([k, n]) => { const q = S.q[k] || {}; const p = qPct(k);
          return `<tr class="click" data-go="#/s/${k}"><td class="nm">${esc(n)} <span class="muted small num">${k}</span>${holdings().some((h) => h.symbol === k) ? ' <span class="tag" style="color:var(--primary)">持股</span>' : ''}</td><td class="num ${cls(p)}">${fmtPrice(q.price)}</td><td class="num ${cls(p)}">${fmtPct(p)}</td>${exRows.length ? `<td class="num ${cls((q.ext || {}).pct)}">${q.ext && q.ext.price ? fmtPct(q.ext.pct) : '—'}</td>` : ''}<td class="num">${fmtVol(q.vol)}</td></tr>`; }).join('')}</tbody></table></div></div>
        <div class="card"><h2>期貨、商品與加密貨幣</h2><div class="wall" style="--wall-w:170px">${US_FUT.map((x) => quoteCard(x, x[0] === '^TNX' ? 3 : 2)).join('')}</div></div></div>
      <div class="small muted" style="margin-top:8px">資料來源：Yahoo Finance（期貨與海外指數可能延遲）。點任一項可看 K 線。</div>`;
  },
  syms() { return []; },
};

// ───────── 台股 ETF 市場（證交所＋櫃買收盤，依 App 分類規則） ─────────
const ETF_CATS = ['市值型／其他', '高股息', '主題／產業', '海外', '債券', '主動式', '期貨／商品', '槓桿／反向'];
function etfCat(code, name) {
  const has = (l) => l.some((w) => name.toUpperCase().includes(w.toUpperCase()));
  if (/[LR]$/.test(code) || has(['正2', '反1'])) return '槓桿／反向';
  if (/B$/.test(code) || has(['債'])) return '債券';
  if (/A$/.test(code) || name.startsWith('主動')) return '主動式';
  if (/U$/.test(code) || has(['原油', '黃金', '期'])) return '期貨／商品';
  if (has(['高股息', '高息', '優息', '股利', '收益', '填息', '息'])) return '高股息';
  if (has(['美國', '美股', '那斯達克', 'NASDAQ', 'S&P', '標普', '費城', '日本', '日經', '中國', '印度', '越南', '全球', '歐洲', '韓國', '港'])) return '海外';
  if (has(['半導體', '科技', '電動車', 'AI', '5G', '網通', '電池', '生技', '醫療', '金融', 'ESG', '永續', '綠能', '車'])) return '主題／產業';
  return '市值型／其他';
}
const ETFM = { at: 0, rows: [], date: '', mkt: 0, loading: null };
function rocDate(s) { s = String(s || '').trim(); const m = s.match(/^(\d{2,3})(\d{2})(\d{2})$/); return m ? (1911 + +m[1]) + '/' + m[2] + '/' + m[3] : s; }
async function loadEtfMarket(force = false) {
  if (!force && ETFM.rows.length && Date.now() - ETFM.at < 300000) return ETFM;
  if (ETFM.loading) return ETFM.loading;
  ETFM.loading = (async () => {
    const n = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/[,+\s]/g, '')); return isNaN(x) ? null : x; };
    const [tse, otc] = await Promise.all([px('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', 600).catch(() => []), px('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', 600).catch(() => [])]);
    const rows = []; let mkt = 0; let date = '';
    const add = (code, name, close, chgRaw, value, shares, o, d) => {
      mkt += value || 0; if (!date && d) date = rocDate(d);
      if (!/^00/.test(code) || !close) return;
      const chg = /X/i.test(String(chgRaw)) ? null : n(chgRaw);
      let price = close, prev = chg == null ? null : close - chg;
      const live = S.q[code]; if (live && live.price && live.prev && live.time && Date.now() - live.time < 6 * 3600000) { price = live.price; prev = live.prev; }
      rows.push({ code, name, otc: o, price, pct: prev ? (price / prev - 1) * 100 : 0, value: (value || 0) / 1e8, lots: (shares || 0) / 1000, cat: etfCat(code, name) });
    };
    (Array.isArray(tse) ? tse : []).forEach((x) => add(String(x.Code || '').trim(), String(x.Name || '').trim(), n(x.ClosingPrice), x.Change, n(x.TradeValue), n(x.TradeVolume), false, x.Date));
    (Array.isArray(otc) ? otc : []).forEach((x) => add(String(x.SecuritiesCompanyCode || '').trim(), String(x.CompanyName || '').trim(), n(x.Close), x.Change, n(x.TransactionAmount), n(x.TradingShares), true, x.Date));
    if (rows.length) Object.assign(ETFM, { rows, mkt: mkt / 1e8, date, at: Date.now() });
    return ETFM;
  })().finally(() => { ETFM.loading = null; });
  return ETFM.loading;
}
function etfTable(list, showCat = true) {
  if (!list.length) return '<div class="empty">沒有符合的 ETF</div>';
  return `<div class="scroll-x"><table class="tbl"><thead><tr><th>ETF</th>${showCat ? '<th>類型</th>' : ''}<th>收盤</th><th>漲跌幅</th><th>成交值（億）</th><th>成交量（張）</th></tr></thead><tbody>${list.map((x) => {
    const mine = holdings().some((h) => h.symbol === x.code); const w = D.quotes().some((q) => q.s === x.code);
    return `<tr class="click" data-go="#/s/${x.code}"><td class="nm">${esc(x.name)} <span class="muted small num">${x.code}</span>${x.otc ? ' <span class="tag muted">櫃</span>' : ''}${mine ? ' <span class="tag" style="color:var(--primary)">持股</span>' : w ? ' <span class="tag muted">自選</span>' : ''}</td>
      ${showCat ? `<td class="small">${esc(x.cat)}</td>` : ''}<td class="num ${cls(x.pct)}">${fmtPrice(x.price)}</td><td class="num ${cls(x.pct)}">${fmtPct(x.pct)}</td><td class="num">${fmt(x.value, 2)}</td><td class="num">${fmtInt(x.lots)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
VIEWS.etf = {
  title: 'ETF 市場',
  render() {
    const c = S.pref.etfCat || '';
    return head('台股 ETF 市場', `<button class="btn" id="er">重新整理</button><a class="btn" href="#/market">‹ 市場</a>`) + `<div id="dyn"><div class="card empty">讀取證交所、櫃買中心收盤資料…</div></div>
      <div class="card" style="margin-top:12px"><div class="row wrap" style="margin-bottom:10px"><div class="chips" style="flex-wrap:wrap"><button class="chip ${c ? '' : 'on'}" data-ec="">全部</button>${ETF_CATS.map((k) => `<button class="chip ${c === k ? 'on' : ''}" data-ec="${k}">${k}</button>`).join('')}</div>
        <span class="sp"></span><input id="eq" placeholder="篩選代號或名稱" style="width:180px"><div class="seg">${[['value', '成交值'], ['up', '漲幅'], ['down', '跌幅']].map(([k, n]) => `<button data-es="${k}" class="${(S.pref.etfSort || 'value') === k ? 'on' : ''}">${n}</button>`).join('')}</div></div><div id="el"></div></div>`;
  },
  bind() {
    $$('[data-ec]').forEach((b) => b.onclick = () => { S.pref.etfCat = b.dataset.ec; savePref(); $$('[data-ec]').forEach((x) => x.classList.toggle('on', x === b)); this.list(); });
    $$('[data-es]').forEach((b) => b.onclick = () => { S.pref.etfSort = b.dataset.es; savePref(); $$('[data-es]').forEach((x) => x.classList.toggle('on', x === b)); this.list(); });
    $('#eq').oninput = () => this.list();
    $('#er').onclick = async () => { await loadEtfMarket(true); this.fill(); };
  },
  async fill() {
    if (!can('MARKET')) { $('#dyn').innerHTML = lockCard('MARKET'); return; }
    const m = await loadEtfMarket(); if (S.route !== 'etf') return;
    if (!m.rows.length) { $('#dyn').innerHTML = '<div class="card empty">取不到證交所／櫃買收盤資料，請稍後再試。</div>'; return; }
    const traded = m.rows.filter((x) => x.lots > 0); const up = traded.filter((x) => x.pct > 0.0001).length, dn = traded.filter((x) => x.pct < -0.0001).length;
    const val = traded.reduce((a, x) => a + x.value, 0);
    const cats = ETF_CATS.map((k) => { const l = traded.filter((x) => x.cat === k); return { k, n: l.length, avg: l.length ? l.reduce((a, x) => a + x.pct, 0) / l.length : 0, up: l.filter((x) => x.pct > 0.0001).length, dn: l.filter((x) => x.pct < -0.0001).length, v: l.reduce((a, x) => a + x.value, 0) }; })
      .filter((c) => c.n).sort((a, b) => b.v - a.v);
    const liquid = traded.filter((x) => x.lots >= 200);
    const mini = (t, l) => `<div class="card"><h2>${t}</h2><div class="list">${l.map((x) => `<div class="it" data-go="#/s/${x.code}"><div class="l"><div class="t1">${esc(x.name)} <span class="muted small num">${x.code}</span></div><div class="t2">${esc(x.cat)} · ${fmt(x.value, 2)} 億</div></div><div class="r"><div class="num ${cls(x.pct)}">${fmtPrice(x.price)}</div><div class="num small ${cls(x.pct)}">${fmtPct(x.pct)}</div></div></div>`).join('')}</div></div>`;
    $('#dyn').innerHTML = `<div class="grid g4" style="margin-bottom:12px">
        <div class="tile"><div class="k">資料日期</div><div class="v num">${esc(m.date || '—')}</div><div class="s muted">${traded.length} 檔有成交</div></div>
        <div class="tile"><div class="k">上漲／下跌／平盤</div><div class="v num"><span class="up">${up}</span>／<span class="down">${dn}</span>／${traded.length - up - dn}</div></div>
        <div class="tile"><div class="k">ETF 成交值</div><div class="v num">${fmt(val, 1)} 億</div><div class="s muted">占全市場 ${m.mkt ? (val / m.mkt * 100).toFixed(1) : '—'}%</div></div>
        <div class="tile"><div class="k">最熱門</div><div class="v" style="font-size:16px">${esc((traded.slice().sort((a, b) => b.value - a.value)[0] || {}).name || '—')}</div></div></div>
      <div class="card" style="margin-bottom:12px"><h2>各類型表現</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>類型</th><th>檔數</th><th>平均漲跌</th><th>漲／跌</th><th>成交值（億）</th><th style="width:30%">成交占比</th></tr></thead><tbody>
        ${cats.map((c) => `<tr class="click" data-ec2="${c.k}"><td class="nm">${esc(c.k)}</td><td class="num">${c.n}</td><td class="num ${cls(c.avg)}">${fmtPct(c.avg)}</td><td class="num"><span class="up">${c.up}</span>／<span class="down">${c.dn}</span></td><td class="num">${fmt(c.v, 1)}</td>
          <td><div style="height:8px;border-radius:4px;background:var(--primary);width:${val ? (c.v / val * 100).toFixed(1) : 0}%"></div></td></tr>`).join('')}</tbody></table></div></div>
      <div class="grid g3 stack">${mini('漲幅前 10', liquid.slice().sort((a, b) => b.pct - a.pct).slice(0, 10))}${mini('跌幅前 10', liquid.slice().sort((a, b) => a.pct - b.pct).slice(0, 10))}${mini('成交值前 10', traded.slice().sort((a, b) => b.value - a.value).slice(0, 10))}</div>
      <div class="small muted" style="margin-top:8px">資料：證交所、櫃買中心每日收盤（自選中的 ETF 用即時價）；漲跌幅排行只列成交 200 張以上。類型依代號字尾與名稱判斷，僅供參考。</div>`;
    $$('[data-ec2]').forEach((r) => r.onclick = () => { S.pref.etfCat = r.dataset.ec2; savePref(); $$('[data-ec]').forEach((x) => x.classList.toggle('on', x.dataset.ec === r.dataset.ec2)); this.list(); $('#el').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    this.list();
  },
  list() {
    const el = $('#el'); if (!el || !ETFM.rows.length) return;
    const c = S.pref.etfCat || ''; const q = ($('#eq').value || '').trim().toUpperCase(); const s = S.pref.etfSort || 'value';
    let l = ETFM.rows.filter((x) => x.lots > 0 && (!c || x.cat === c) && (!q || x.code.includes(q) || x.name.toUpperCase().includes(q)));
    l.sort(s === 'up' ? (a, b) => b.pct - a.pct : s === 'down' ? (a, b) => a.pct - b.pct : (a, b) => b.value - a.value);
    el.innerHTML = `<div class="small muted" style="margin-bottom:6px">${l.length} 檔${l.length > 150 ? '，顯示前 150 檔' : ''}</div>` + etfTable(l.slice(0, 150), !c);
  },
  syms() { return []; },
};

// ───────── 盤後報告（內嵌） ─────────
VIEWS.report = {
  title: '盤後報告',
  render() { return head('台股盤後報告', `<a class="btn" href="/report" target="_blank" rel="noopener">新視窗開啟</a><a class="btn" href="#/market">‹ 市場</a>`) + '<div id="dyn"><div class="card empty">讀取中…</div></div>'; },
  async fill() {
    if (!can('REPORT')) { $('#dyn').innerHTML = lockCard('REPORT'); return; }
    let m; let ok = false;
    try { const r = await fetch('/api/report'); if (r.ok && /json/.test(r.headers.get('content-type') || '')) { m = await r.json(); ok = true; } } catch (e) {}
    if (S.route !== 'report') return;
    if (!ok) { $('#dyn').innerHTML = '<div class="card" style="padding:0;overflow:hidden"><iframe src="/report" style="width:100%;height:80vh;border:0;background:#fff"></iframe></div>'; return; }
    if (!m) { $('#dyn').innerHTML = '<div class="card empty">今日報告尚未產生，交易日收盤後再來看看。</div>'; return; }
    $('#dyn').innerHTML = `<div class="grid g2 stack">${m.img ? `<div class="card" style="padding:6px"><img src="/report.jpg?d=${encodeURIComponent(m.date)}" alt="盤後報告" style="width:100%;border-radius:8px;display:block"></div>` : ''}
      <div class="card"><h2>${esc(m.date)}<span class="r"><button class="btn sm" id="rcp">複製文字</button></span></h2><pre style="white-space:pre-wrap;font-family:inherit;line-height:1.7;margin:0">${esc(m.text || '')}</pre></div></div>
      <div class="small muted" style="margin-top:8px">內容僅為分析成果，不構成投資建議；投資有風險，請自行評估並自負盈虧。</div>`;
    $('#rcp').onclick = () => { navigator.clipboard.writeText(m.text || '').then(() => toast('已複製')); };
  },
  syms() { return []; },
};

// ───────── AI 個股體檢（本地指標＋本地規則；有金鑰時交給 AI 解讀） ─────────
const AI_P = [
  ['agnes', 'Agnes AI', 'openai', 'https://apihub.agnes-ai.com/v1', ['agnes-2.5-flash', 'agnes-3.0-flash', 'agnes-2.5-pro-alpha'], 'https://agnes-ai.com'],
  ['claude', 'Claude（Anthropic）', 'anthropic', 'https://api.anthropic.com/v1', ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'], 'https://console.anthropic.com'],
  ['openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'], 'https://platform.openai.com'],
  ['gemini', 'Google Gemini', 'openai', 'https://generativelanguage.googleapis.com/v1beta/openai', ['gemini-2.5-flash', 'gemini-2.5-pro'], 'https://aistudio.google.com'],
  ['deepseek', 'DeepSeek', 'openai', 'https://api.deepseek.com/v1', ['deepseek-chat', 'deepseek-reasoner'], 'https://platform.deepseek.com'],
];
// 金鑰：以瀏覽器產生、不可匯出的 AES-GCM 金鑰（存於 IndexedDB）加密後才放進 localStorage；不上傳、不同步
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('cetf', 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('k').objectStore('k').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error || new Error('IndexedDB 讀取失敗')); }); }
async function idbPut(k, v) { const db = await idb(); return new Promise((res) => { const t = db.transaction('k', 'readwrite'); t.objectStore('k').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); }); }
/** 瀏覽器金鑰：只在確定不存在時才建立；讀取失敗不可另建新金鑰覆蓋（否則已儲存的 API 金鑰全部無法解密）。同一時間只建立一次 */
let AI_CK = null;
function aiCk() {
  if (!AI_CK) AI_CK = (async () => {
    let k = await idbGet('ai');
    if (k === undefined) { k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await idbPut('ai', k); const k2 = await idbGet('ai'); if (k2) k = k2; }
    if (!k) throw new Error('瀏覽器金鑰無法讀取');
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    return k;
  })().catch((e) => { AI_CK = null; throw e; });
  return AI_CK;
}
const b64of = (u8) => btoa(String.fromCharCode(...u8));
function aiHas(id) { return !!(store.get('aik', {})[id]); }
async function aiKeySet(id, val) {
  const all = store.get('aik', {});
  if (!val) delete all[id];
  else {
    let ck; try { ck = await aiCk(); } catch (e) { toast('無法儲存金鑰：瀏覽器的加密儲存區無法使用（' + e.message + '），請關閉無痕模式或允許網站資料後再試', 6000); return false; }
    const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, new TextEncoder().encode(val)); all[id] = b64of(iv) + '.' + b64of(new Uint8Array(ct)); }
  store.set('aik', all); if (S.me && S.me.no) store.set('aikNo', S.me.no);
}
async function aiKeyGet(id) {
  const e = store.get('aik', {})[id]; if (!e) return '';
  try { const [iv, ct] = e.split('.').map(b64bytes); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aiCk(), ct)); } catch (x) { return ''; }
}
function aiModel(p) { return ((S.pref.aiModel || {})[p[0]]) || p[4][0]; }
/** 管理員提供的 AI（轉送站代為呼叫，金鑰不經過瀏覽器）：自己的金鑰優先，最後才用 */
const AI_SHARED = ['shared', '管理員提供的 AI', 'proxy', '', ['（由管理員設定）'], ''];
function aiShared() { return !!(S.sk && S.sk.on && (S.sk.ai || []).length); }
/** 金鑰來源（AI、FinMind 各自）：auto＝自己的優先、沒有或失敗才用系統提供；system＝只用系統提供；own＝只用自己的（舊設定關閉「管理員提供」視為 own） */
function keySrc(k) { const v = (S.pref || {})[k]; return v === 'system' || v === 'own' ? v : k === 'aiSrc' && (S.pref.aiOff || []).includes('shared') ? 'own' : 'auto'; }
function aiChain() {
  const off = new Set(S.pref.aiOff || []); const src = keySrc('aiSrc'); const sys = aiShared();
  const own = src === 'system' && sys ? [] : AI_P.filter((p) => aiHas(p[0]) && !off.has(p[0]));
  return sys && src !== 'own' ? own.concat([AI_SHARED]) : own;
}
async function skLoad() { if (!S.session) return; try { const r = await api('skInfo', { session: S.session }); if (!r.kicked) S.sk = r; } catch (e) { S.sk = null; } }
let SKILL = null;
async function skillPrompt() { if (SKILL) return SKILL; const r = await fetch('/web/skill.json?v=' + Math.floor(Date.now() / 3600000)); SKILL = (await r.json()).prompt; return SKILL; }
async function aiCall(p, system, user, maxTokens = 1500, temp = 0) {
  if (p[2] === 'proxy') {
    const o = await api('aiProxy', { session: S.session, system, user, maxTokens, temp });
    if (S.sk && o.left != null) S.sk.aiLeft = o.left;
    if (!String(o.text || '').trim()) throw new Error('回應沒有內容');
    return { text: o.text, model: o.model || '管理員提供' };
  }
  const key = await aiKeyGet(p[0]); if (!key) throw new Error('未設定金鑰');
  const model = aiModel(p); let r;
  try {
    if (p[2] === 'anthropic') {
      r = await fetch(p[3] + '/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature: temp, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: user }] }) });
    } else {
      r = await fetch(p[3] + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, temperature: temp, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    }
  } catch (e) { throw new Error('瀏覽器無法直接連線 ' + p[1] + '（可能不支援網頁直連），請改用 Claude、OpenAI 或 Gemini'); }
  const txt = await r.text(); let o = {}; try { o = JSON.parse(txt); } catch (e) {}
  if (!r.ok) { const m = (o.error && (o.error.message || o.error)) || ''; throw new Error('HTTP ' + r.status + (m ? ' ' + String(m).slice(0, 160) : '') + (r.status === 401 ? '（金鑰錯誤）' : r.status === 429 ? '（額度或頻率限制）' : '')); }
  const text = p[2] === 'anthropic' ? (o.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('') : ((((o.choices || [])[0] || {}).message || {}).content || '');
  if (!text.trim()) throw new Error('回應沒有內容');
  return { text, model: p[1] + ' · ' + model };
}
// 指標（純函數，與 App StockMetrics 同規則）
function rsiW(c, n = 14) {
  if (c.length <= n) return null; let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  let ag = g / n, al = l / n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (n - 1) + Math.max(d, 0)) / n; al = (al * (n - 1) + Math.max(-d, 0)) / n; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
const PAT_BOTTOM = ['多頭吞噬（陽包陰）', '鎚子線', '蜻蜓十字（T 字）', '晨星', '紅三兵'];
const PAT_TOP = ['流星線', '空頭吞噬（陰包陽）', '墓碑十字（倒 T）', '暮星（夜星）'];
/** 最近 3 根 K 棒的單／雙／三根型態 */
/** 第 i 根 K 棒的單／雙／三根型態 */
function patAt(b, i, avgBody) {
  const out = []; if (i < 5) return out;
  const x = b[i], p = b[i - 1], pp = b[i - 2]; const body = Math.abs(x.c - x.o), rg = x.h - x.l || 1e-9;
  const up = x.h - Math.max(x.o, x.c), lo = Math.min(x.o, x.c) - x.l;
  const fell = p.c < b[i - 5].c, rose = p.c > b[i - 5].c;
  if (body > 0 && x.c > x.o && lo >= 2 * body && up <= body * 0.5 && fell) out.push('鎚子線');
  if (body > 0 && up >= 2 * body && lo <= body * 0.5 && rose) out.push('流星線');
  if (p.c < p.o && x.c > x.o && x.o <= p.c && x.c >= p.o && body > Math.abs(p.c - p.o)) out.push('多頭吞噬（陽包陰）');
  if (p.c > p.o && x.c < x.o && x.o >= p.c && x.c <= p.o && body > Math.abs(p.c - p.o)) out.push('空頭吞噬（陰包陽）');
  if (body <= rg * 0.1 && up <= rg * 0.1 && lo >= rg * 0.6 && fell) out.push('蜻蜓十字（T 字）');
  if (body <= rg * 0.1 && lo <= rg * 0.1 && up >= rg * 0.6 && rose) out.push('墓碑十字（倒 T）');
  const b2 = Math.abs(pp.c - pp.o), b1 = Math.abs(p.c - p.o);
  if (pp.c < pp.o && b2 >= avgBody && b1 <= b2 * 0.35 && x.c > x.o && x.c > (pp.o + pp.c) / 2) out.push('晨星');
  if (pp.c > pp.o && b2 >= avgBody && b1 <= b2 * 0.35 && x.c < x.o && x.c < (pp.o + pp.c) / 2) out.push('暮星（夜星）');
  if ([pp, p, x].every((k) => k.c > k.o) && p.c > pp.c && x.c > p.c && p.o >= pp.o && p.o <= pp.c && x.o >= p.o && x.o <= p.c) out.push('紅三兵');
  return out;
}
function avgBodyOf(b, end) { const w = b.slice(Math.max(0, end - 20), end); return w.reduce((a, x) => a + Math.abs(x.c - x.o), 0) / Math.max(1, w.length) || 1e-9; }
/** 最近 3 根 K 棒的型態 */
function candlePatterns(b) {
  const out = new Set(); const n = b.length; if (n < 8) return [];
  const ab = avgBodyOf(b, n);
  for (let i = Math.max(5, n - 3); i < n; i++) patAt(b, i, ab).forEach((x) => out.add(x));
  return Array.from(out);
}
/** 一年價格位階（近一年收盤線性迴歸 ±σ） */
function bandZone(b, price) {
  const cl = b.slice(-250).map((x) => x.c); const n = cl.length; if (n < 60) return null;
  const mx = (n - 1) / 2, my = cl.reduce((a, v) => a + v, 0) / n; let sxy = 0, sxx = 0; cl.forEach((v, i) => { sxy += (i - mx) * (v - my); sxx += (i - mx) ** 2; });
  const slope = sxy / sxx, a0 = my - slope * mx; const sigma = Math.sqrt(cl.reduce((acc, v, i) => acc + (v - (a0 + slope * i)) ** 2, 0) / n); const t = a0 + slope * (n - 1);
  const i = [-2, -1, 0, 1, 2].map((k) => t + k * sigma).findIndex((v) => price < v);
  return ['低檔', '偏低', '中低', '中高', '偏高', '高檔'][i < 0 ? 5 : i];
}
async function stockMetrics(sym) {
  const key = sym + '2y'; const bars0 = barCache[key] || (barCache[key] = await loadBars(sym, '2y'));
  if (!bars0 || bars0.length < 20) return null;
  const q = S.q[sym] || {}; const all = bars0.slice(); const today = ymd();
  if (q.price && !isUs(sym) && twOpen()) { const last = all[all.length - 1]; const cur = { d: today, o: q.open || q.price, h: Math.max(q.high || q.price, q.price), l: Math.min(q.low || q.price, q.price), c: q.price, v: q.volLots || 0 }; if (last.d === today) all[all.length - 1] = cur; else all.push(cur); }
  const cs = all.slice(-130); const c = cs.map((x) => x.c); const n = c.length - 1; const close = c[n];
  const ma = (k) => (c.length >= k ? c.slice(-k).reduce((a, v) => a + v, 0) / k : null);
  const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20), ma60 = ma(60);
  const [K, Dd] = kdArr(cs.map((x) => x.h), cs.map((x) => x.l), c);
  const prev5 = cs.slice(-6, -1).map((x) => x.v || 0); const avg5 = prev5.length === 5 ? prev5.reduce((a, v) => a + v, 0) / 5 : 0;
  const ratio = avg5 > 0 ? (cs[n].v || 0) / avg5 : null;
  const upDay = close >= c[n - 1];
  const pv = ratio == null ? '資料不足' : !upDay && ratio >= 2 ? '價跌爆量' : upDay && ratio >= 2 ? '價漲爆量' : upDay && ratio >= 1 ? '價漲量增' : upDay ? '價漲量縮' : ratio >= 1 ? '價跌量增' : '價跌量縮';
  const lowLast = cs[n].l;
  const nearMa = [['MA10', ma10], ['MA20', ma20], ['MA60', ma60]].find(([, m]) => m && (Math.abs(lowLast / m - 1) <= 0.02 || Math.abs(close / m - 1) <= 0.02));
  const us = isUs(sym); let pe = null, pb = null, yld = null;
  if (!us) { const val = await kv('sx:val'); const v = val && val[sym]; if (v) { pe = v[0] > 0 ? v[0] : null; yld = v[1] > 0 ? v[1] : null; pb = v[2] > 0 ? v[2] : null; } }
  const r2 = (v) => (v == null || isNaN(v) ? null : Math.round(v * 100) / 100);
  const last20 = cs.slice(-20);
  return {
    ticker: sym, name: D.name(sym), market: us ? 'US' : 'TW', isEtf: D.isEtf(sym), latestTradingDate: cs[n].d.replace(/\//g, '-'),
    close: r2(close), prevClose: r2(q.prev || c[n - 1]), changePct: r2((close / (q.prev || c[n - 1]) - 1) * 100),
    ma5: r2(ma5), ma10: r2(ma10), ma20: r2(ma20), ma60: r2(ma60), bias20Pct: r2(ma20 ? (close / ma20 - 1) * 100 : null), rsi14: r2(rsiW(c)), kdK: r2(K[n]), kdD: r2(Dd[n]),
    volumeRatioToMa5: r2(ratio), priceVolumeState: pv, isNewHigh20: close >= Math.max(...c.slice(-20)),
    candlestickPatterns: candlePatterns(cs), patternNearMa: nearMa ? nearMa[0] : null,
    foreignNet5Lots: null, trustNet5Lots: null, dealerNet5Lots: null, trustConsecutiveDays: null,
    pe: r2(pe), pb: r2(pb), yieldPct: r2(yld), priceBandZone: bandZone(all, close),
    support: r2(Math.min(...last20.map((x) => x.l))), resistance: r2(Math.max(...last20.map((x) => x.h))),
  };
}
/** 本地規則體檢（與 App StockMetrics.localReport 同規則） */
function localReport(m) {
  const c = m.close; const f = (v) => fmtPrice(v); const sg = (v, d = 1) => (v >= 0 ? '+' : '') + v.toFixed(d);
  const trend = m.ma20 != null && m.ma60 != null && c > m.ma20 && m.ma20 > m.ma60 ? '多頭趨勢' : m.ma20 != null && m.ma60 != null && c < m.ma20 && m.ma20 < m.ma60 ? '空頭趨勢' : '區間震盪／均線糾結';
  const rsi = m.rsi14, bias = m.bias20Pct;
  const pullback = trend === '多頭趨勢' && [m.ma10, m.ma20].some((x) => x && Math.abs(c / x - 1) <= 0.02) && rsi != null && rsi >= 40 && rsi <= 55 && m.priceVolumeState === '價跌量縮';
  const overheat = (bias != null && bias > 12) || (rsi != null && rsi > 75);
  const bottom = m.candlestickPatterns.filter((p) => PAT_BOTTOM.includes(p)); const topP = m.candlestickPatterns.filter((p) => PAT_TOP.includes(p));
  const bottomValid = bottom.length > 0 && m.patternNearMa != null;
  const distribution = (bias || 0) > 10 && topP.length > 0 && m.priceVolumeState === '價跌爆量';
  const divergence = m.isNewHigh20 && m.priceVolumeState === '價漲量縮';
  let insight = trend;
  if (m.ma20 != null) insight += `，收盤 ${f(c)} ${c >= m.ma20 ? '站上' : '跌破'} MA20（${f(m.ma20)}）`;
  if (bias != null) insight += `，20 日乖離 ${sg(bias)}%`;
  if (rsi != null) insight += `，RSI ${rsi.toFixed(0)}`;
  if (m.kdK != null && m.kdD != null) insight += `，KD ${m.kdK.toFixed(0)}／${m.kdD.toFixed(0)}`;
  insight += `。量價：${m.priceVolumeState}` + (m.volumeRatioToMa5 != null ? `（量比 ${m.volumeRatioToMa5.toFixed(1)} 倍）` : '') + '。';
  if (m.candlestickPatterns.length) insight += '近期 K 棒：' + m.candlestickPatterns.join('、') + '。';
  if (bottomValid) insight += `止跌型態出現在 ${m.patternNearMa} 附近，屬有效止跌攻擊訊號。`;
  if (pullback) insight += '多頭回檔至均線附近且量縮，屬回檔觀察買點。';
  if (divergence) insight += '股價創 20 日新高但價漲量縮，追價動能不足。';
  const chipStatus = m.market === 'US' ? '量能觀察' : '法人資料不足';
  const chipSummary = '量比 ' + (m.volumeRatioToMa5 != null ? m.volumeRatioToMa5.toFixed(1) + ' 倍' : '—') + '，' + m.priceVolumeState + (m.market === 'US' ? '（美股無三大法人資料，以量能判讀）。' : '（網頁版以量能判讀，法人近 5 日動向請見手機 App）。');
  const z = m.priceBandZone;
  const valuation = z == null && m.pe == null ? '資料不足' : z === '低檔' || (m.pe != null && m.pe < 10) ? '低估' : z === '便宜' || (m.pe != null && m.pe < 14) ? '合理偏低' : z === '偏高' || z === '高檔' || (m.pe != null && m.pe > 30) ? '偏高' : '合理';
  const peer = [m.pe != null && '本益比 ' + m.pe.toFixed(1), m.pb != null && '淨值比 ' + m.pb.toFixed(2), m.yieldPct != null && '殖利率 ' + m.yieldPct.toFixed(2) + '%' + (m.yieldPct >= 5 ? '（具下檔保護）' : ''), z && `一年價格位階「${z}」`].filter(Boolean).join('、') || '估值資料不足';
  const risks = [];
  if (overheat) risks.push('短線乖離過大（' + [bias != null && '乖離 ' + sg(bias) + '%', rsi != null && 'RSI ' + rsi.toFixed(0)].filter(Boolean).join('、') + '），切勿盲目追高');
  if (distribution) risks.push('高檔出現' + topP.join('、') + '且價跌爆量，留意主力調節');
  else if (topP.length && (bias || 0) > 5) risks.push('相對高檔出現' + topP.join('、') + '，留意轉弱');
  if (divergence) risks.push('創高量縮，量價背離');
  const signal = distribution ? '偏空警示' : trend === '空頭趨勢' ? '轉弱防守' : pullback || (trend === '多頭趨勢' && bottomValid) ? '多頭回檔' : trend === '多頭趨勢' ? '強勢多頭' : '區間震盪';
  let conf = 55; if (trend !== '區間震盪／均線糾結') conf += 10; if (bottomValid || pullback) conf += 8; if (overheat && signal === '強勢多頭') conf -= 10; if (divergence) conf -= 5;
  const verdict = { 強勢多頭: overheat ? '多頭但乖離過大，等拉回再布局' : '趨勢向上，沿均線偏多操作', 多頭回檔: '多頭回檔至均線，可分批觀察承接', 轉弱防守: '均線走空，保守防守為主', 偏空警示: '轉弱訊號明確，宜減碼避險' }[signal] || '均線糾結，等突破方向再動作';
  return { ticker: m.ticker, overall_signal: signal, confidence_score: Math.max(30, Math.min(90, conf)), one_line_verdict: verdict,
    technical_analysis: { trend, candlestick_insight: insight, key_support: m.support, key_resistance: m.resistance },
    chip_analysis: { institutional_status: chipStatus, summary: chipSummary },
    fundamental_valuation: { valuation_status: valuation, peer_comparison: peer + '。', risk_warning: risks.length ? risks.join('；') + '。' : '目前無重大異常訊號' }, _source: 'local' };
}
function parseReport(raw) { try { const t = raw.replace(/```json|```/g, '').trim(); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e) { return null; } }
const AI_CACHE_MAX = 40;
function aiCacheGet(k) { return (store.get('aic', {})[k]) || null; }
function aiCachePut(k, v) { const o = store.get('aic', {}); o[k] = v; const ks = Object.keys(o); if (ks.length > AI_CACHE_MAX) ks.sort((a, b) => (o[a]._at || 0) - (o[b]._at || 0)).slice(0, ks.length - AI_CACHE_MAX).forEach((x) => delete o[x]); store.set('aic', o); }
const SIG_CLS = { 強勢多頭: 'up', 多頭回檔: 'up', 區間震盪: '', 轉弱防守: 'down', 偏空警示: 'down' };
function reportHtml(r, m) {
  const t = r.technical_analysis || {}, ch = r.chip_analysis || {}, fv = r.fundamental_valuation || {}; const cf = Math.max(0, Math.min(100, +r.confidence_score || 0));
  const sec = (title, tag, body) => `<div style="margin-top:12px"><div class="row" style="gap:8px"><b>${title}</b>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}</div><div class="small text2" style="margin-top:4px;line-height:1.7">${esc(body || '')}</div></div>`;
  return `<div class="row wrap" style="gap:12px;align-items:center"><span class="tag ${SIG_CLS[r.overall_signal] || ''}" style="font-size:15px;padding:4px 10px">${esc(r.overall_signal || '—')}</span>
      <div style="flex:1;min-width:160px"><div class="small muted">信心分數 ${cf}</div><div style="height:6px;border-radius:3px;background:var(--card2);margin-top:4px"><div style="height:6px;border-radius:3px;width:${cf}%;background:var(--primary)"></div></div></div></div>
    <div style="font-size:16px;font-weight:700;margin-top:10px">${esc(r.one_line_verdict || '')}</div>
    <div class="grid g4" style="margin-top:10px;gap:8px">${[['支撐', t.key_support], ['壓力', t.key_resistance], ['RSI(14)', m.rsi14], ['20 日乖離', m.bias20Pct != null ? fmtPct(m.bias20Pct) : null]].map(([k, v]) => `<div><div class="small muted">${k}</div><div class="num">${v == null || v === 0 ? '—' : typeof v === 'number' ? fmtPrice(v) : v}</div></div>`).join('')}</div>
    ${sec('技術面', t.trend, t.candlestick_insight)}${sec('籌碼面', ch.institutional_status, ch.summary)}${sec('估值', fv.valuation_status, fv.peer_comparison)}
    <div class="notice" style="margin-top:12px">⚠ ${esc(fv.risk_warning || '目前無重大異常訊號')}</div>`;
}
async function aiPanel(el, sym, force = false, useAi = false) {
  if (!can('AI')) { el.innerHTML = lockCard('AI'); return; }
  el.innerHTML = '<div class="card"><h2>AI 個股體檢</h2><div class="muted small">計算指標中…</div></div>';
  const m = await stockMetrics(sym).catch(() => null);
  if (!el.isConnected) return;
  if (!m) { el.innerHTML = '<div class="card"><h2>AI 個股體檢</h2><div class="muted small">K 線資料不足，無法體檢。</div></div>'; return; }
  const ck = sym + '_' + m.latestTradingDate; let r = aiCacheGet(ck); let err = '';
  const chain = aiChain();
  if ((useAi || (r && r._source === 'ai')) && chain.length && (force || !r)) {
    r = null; el.querySelector('.muted').textContent = 'AI 解讀中…（' + chain[0][1] + '）';
    const sys = await skillPrompt().catch(() => '');
    for (const p of chain) {
      try { const o = await aiCall(p, sys, '以下是本地預計算的指標 JSON，請依規範輸出：\n' + JSON.stringify(m)); const rep = parseReport(o.text); if (!rep) throw new Error('回應不是有效 JSON'); r = { ...rep, _source: 'ai', _model: o.model, _at: Date.now() }; aiCachePut(ck, r); break; }
      catch (e) { err = p[1] + '：' + e.message; }
    }
  }
  if (!r || r._source !== 'ai') r = localReport(m);
  if (!el.isConnected) return;
  el.innerHTML = `<div class="card"><h2>AI 個股體檢<span class="r small muted">${r._source === 'ai' ? esc(r._model || '') + ' · ' + hm(r._at) : '本地規則'}　${esc(m.latestTradingDate)}</span></h2>
    ${err ? `<div class="notice" style="margin-bottom:10px">AI 解讀失敗，改用本地規則。${esc(err)}</div>` : ''}${reportHtml(r, m)}
    <div class="row wrap" style="margin-top:12px">${chain.length ? `<button class="btn sm primary" id="aiGo">${r._source === 'ai' ? '重新分析' : 'AI 解讀'}</button>` : `<a class="btn sm" href="#/settings">設定 AI 金鑰 ›</a>`}
      <button class="btn sm" id="aiJson">指標 JSON</button><span class="sp"></span><span class="small muted">數字皆由本地計算，AI 只負責解讀；非投資建議。</span></div>
    <pre id="aiPre" class="small hide" style="white-space:pre-wrap;margin-top:8px;max-height:260px;overflow:auto">${esc(JSON.stringify(m, null, 2))}</pre></div>`;
  if ($('#aiGo', el)) $('#aiGo', el).onclick = () => aiPanel(el, sym, true, true);
  $('#aiJson', el).onclick = () => $('#aiPre', el).classList.toggle('hide');
}
/** 金鑰來源選擇：自動／系統提供／自行建立 */
function keySrcHtml(k, sysOn, desc) {
  const v = keySrc(k);
  if (!sysOn) return `<div class="small muted" style="margin:4px 0 8px">金鑰來源：使用者自行建立（系統目前沒有提供）</div>`;
  return `<div class="field" style="margin:4px 0 8px"><label>金鑰來源</label><div class="seg">${[['auto', '自動'], ['system', '系統提供'], ['own', '自行建立']].map(([x, n]) => `<button data-ksrc="${k}" data-v="${x}" class="${v === x ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="small text2" style="margin-top:4px">${esc(desc[v])}</div></div>`;
}
function aiSettingsHtml() {
  const off = new Set(S.pref.aiOff || []);
  const sysDesc = aiShared() ? S.sk.ai.join('、') + '，今日剩 ' + S.sk.aiLeft + ' / ' + S.sk.aiLimit + ' 次' : '';
  return `<div class="card"><h2>AI 個股體檢</h2>
    ${keySrcHtml('aiSrc', aiShared(), { auto: '自己有金鑰時優先用自己的，沒有或失敗才用系統提供的 AI（' + sysDesc + '）。系統金鑰由管理員保管，不會傳到瀏覽器。', system: '只用系統提供的 AI（' + sysDesc + '），不使用下方自己的金鑰。', own: '只用下方自己設定的金鑰，不使用系統提供的 AI。' })}
    <div class="small muted" style="margin-bottom:8px">依序嘗試已啟用且有金鑰的服務（Agnes AI 優先）。金鑰只加密保存在這個瀏覽器，不會上傳或同步到手機；手機 App 的金鑰需在 App 內另外設定。</div>
    <div class="list">${AI_P.map((p) => `<div class="it" style="cursor:default;flex-wrap:wrap;gap:8px;padding:8px 2px">
      <input type="checkbox" data-aion="${p[0]}" ${off.has(p[0]) ? '' : 'checked'} style="width:auto"><div class="l" style="min-width:150px"><div class="t1">${esc(p[1])}</div><div class="t2">${aiHas(p[0]) ? '<span class="up">已儲存</span>' : '未設定'} · <a href="${p[5]}" target="_blank" rel="noopener">取得金鑰</a></div></div>
      <select data-aim="${p[0]}" style="width:auto">${p[4].map((m) => `<option ${aiModel(p) === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <input type="password" data-aik="${p[0]}" placeholder="${aiHas(p[0]) ? '已儲存（輸入新金鑰可取代）' : '貼上 API 金鑰'}" autocomplete="off" style="flex:1;min-width:160px">
      <button class="btn sm" data-aisave="${p[0]}">儲存</button>${aiHas(p[0]) ? `<button class="btn sm" data-aitest="${p[0]}">測試</button><button class="btn sm" data-aidel="${p[0]}">清除</button>` : ''}</div>`).join('')}
</div>
    <div class="small muted" style="margin-top:6px">網頁直連：Claude、OpenAI、Gemini 支援；Agnes、DeepSeek 若瀏覽器擋下會自動改用下一家。</div>
    <div class="row wrap" style="gap:8px;margin-top:10px"><button class="btn sm" id="akBak">備份金鑰（加密檔）</button><button class="btn sm" id="akRes">還原金鑰</button><input type="file" id="akFile" accept=".aes,.json,application/octet-stream" class="hide">
      <span class="small muted sp">金鑰只存在這個瀏覽器；網頁更新與自動登出都會保留。換電腦、換瀏覽器或清除瀏覽資料前，可先備份成以匯出密碼加密的檔案，之後一鍵還原（含富果、FinMind）。</span></div></div>`;
}
/** 金鑰備份：所有 API 金鑰（AI、富果、FinMind）以匯出密碼 AES-256 加密成檔案 */
async function aiKeysBackup() {
  const out = {}; for (const id of Object.keys(store.get('aik', {}))) { const v = await aiKeyGet(id); if (v) out[id] = v; }
  if (!Object.keys(out).length) return toast('沒有可備份的金鑰');
  const pwd = await expPassword(); if (!pwd) return;
  const enc = await expEncrypt(JSON.stringify({ app: 'CETFTW', type: 'apiKeys', at: ymd(), keys: out }), pwd, 'keys');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([enc], { type: 'application/octet-stream' })); a.download = 'CETFTW-API金鑰-' + ymd().replace(/\//g, '-') + '.aes'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('已備份 ' + Object.keys(out).length + ' 組金鑰（加密）');
}
async function aiKeysRestore(file) {
  const t = await expOpen(await file.text()); if (t == null) return;
  let o; try { o = JSON.parse(t); } catch (e) { return toast('檔案格式錯誤'); }
  if (o.type !== 'apiKeys' || !o.keys) return toast('這不是金鑰備份檔');
  let n = 0; for (const [id, v] of Object.entries(o.keys)) { if (typeof v === 'string' && v) { await aiKeySet(id, v); n++; } }
  Object.keys(FMC).forEach((k) => delete FMC[k]); toast('已還原 ' + n + ' 組金鑰'); route();
}
function keySrcBind() {
  $$('[data-ksrc]').forEach((b) => b.onclick = () => { S.pref[b.dataset.ksrc] = b.dataset.v; savePref(); Object.keys(FMC).forEach((k) => delete FMC[k]); toast('已改為「' + b.textContent + '」'); route(); });
}
function aiSettingsBind() {
  keySrcBind();
  if ($('#akBak')) { $('#akBak').onclick = () => aiKeysBackup().catch((e) => toast('備份失敗：' + e.message)); $('#akRes').onclick = () => $('#akFile').click();
    $('#akFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) aiKeysRestore(f).catch((x) => toast('還原失敗：' + x.message)); }; }
  // 已儲存但無法解密（瀏覽器資料被清除）：標示出來，請重新輸入或還原備份
  AI_P.forEach(async (p) => { if (!aiHas(p[0])) return; if (!(await aiKeyGet(p[0]))) { const el = $(`[data-aik="${p[0]}"]`); const row = el && el.closest('.it'); const t2 = row && $('.t2', row); if (t2) t2.innerHTML = '<span class="up">無法讀取，請重新輸入或還原備份</span>'; } });
  $$('[data-aion]').forEach((c) => c.onchange = () => { const o = new Set(S.pref.aiOff || []); if (c.checked) o.delete(c.dataset.aion); else o.add(c.dataset.aion); S.pref.aiOff = Array.from(o); savePref(); });
  $$('[data-aim]').forEach((s) => s.onchange = () => { S.pref.aiModel = { ...(S.pref.aiModel || {}), [s.dataset.aim]: s.value }; savePref(); });
  $$('[data-aisave]').forEach((b) => b.onclick = async () => { const id = b.dataset.aisave; const v = $(`[data-aik="${id}"]`).value.trim(); if (!v) return toast('請先貼上金鑰'); await aiKeySet(id, v); toast('已儲存'); route(); });
  $$('[data-aidel]').forEach((b) => b.onclick = async () => { await aiKeySet(b.dataset.aidel, ''); toast('已清除'); route(); });
  $$('[data-aitest]').forEach((b) => b.onclick = async () => { const p = AI_P.find((x) => x[0] === b.dataset.aitest); b.disabled = true; b.textContent = '測試中…';
    try { await aiCall(p, '只回答 OK', 'ping', 5); toast('連線成功（' + aiModel(p) + '）'); } catch (e) { toast(e.message, 5000); } b.disabled = false; b.textContent = '測試'; });
}

// ───────── 配息資料（台股：發佈站 sx:divh；美股或缺漏：Yahoo 除息事件） ─────────
const DIVH = {};
function tsYmd(t) { const d = new Date((t + 8 * 3600) * 1000); return d.getUTCFullYear() + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0'); }
async function divHist(sym) {
  if (DIVH[sym]) return DIVH[sym];
  let out = [];
  if (!isUs(sym)) { const dh = await kv('sx:divh'); out = ((dh && dh[sym]) || []).slice(); }
  if (!out.length) {
    try {
      const j = await px(YC + encodeURIComponent(ysym(sym)) + '?range=10y&interval=1mo&events=div', 86400);
      const ev = ((((j.chart || {}).result || [])[0] || {}).events || {}).dividends;
      out = ev ? Object.values(ev).map((d) => [tsYmd(d.date), d.amount]) : [];
    } catch (e) {}
  }
  out.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return (DIVH[sym] = out);
}
function yearAgoYmd(n = 1) { const d = tpeNow(); d.setFullYear(d.getFullYear() - n); return ymd(d); }
/** 配息方式：近 13 個月的配息次數 */
/** 配息方式（與 App EtfTags 相同）：名稱有寫明者為準；否則取近 4 次配息間隔的中位數（< 45 天月配、< 125 季配、< 250 半年配、其餘年配）。ex＝已公告的下次除息日 */
function divFreq(list, sym, ex) {
  const per = { 月配: 12, 季配: 4, 半年配: 2, 年配: 1 };
  const nm = sym ? D.name(sym) : '';
  const byName = /月配|月月|Monthly/i.test(nm) ? '月配' : /季配/.test(nm) ? '季配' : /半年配/.test(nm) ? '半年配' : /年配/.test(nm) ? '年配' : null;
  if (byName) return [byName, per[byName]];
  const day = (d) => Date.parse(String(d).replace(/\//g, '-') + 'T00:00:00+08:00');
  const ts = list.map(([d]) => day(d)).filter((x) => !isNaN(x));
  if (ex) { const e = day(ex); if (!isNaN(e) && !ts.some((t) => Math.abs(t - e) < 20 * 864e5)) ts.push(e); }
  ts.sort((a, b) => a - b);
  if (!ts.length) return ['無配息資料', 0];
  const now = Date.now();
  if (ts[ts.length - 1] < now - 765 * 864e5) return ['近一年未配息', 0];
  if (ts.length === 1) return now - ts[0] > 300 * 864e5 ? ['年配', 1] : ['已配息 1 次', 0];
  const gaps = []; for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 864e5);
  const g4 = gaps.slice(-4).sort((a, b) => a - b); const g = g4[Math.floor(g4.length / 2)];
  const f = g < 45 ? '月配' : g < 125 ? '季配' : g < 250 ? '半年配' : '年配';
  return [f, per[f]];
}
/**
 * 配息推估（與 App EtfTags.project 相同，處理新上市未滿一年與資料漏筆）：
 * 每次配息＝近期平均（月配近 3 次、季配近 2 次）；近一年筆數達每年次數用實際合計，否則每次 × 每年次數（estimated）；
 * 每月入帳不足時，依最近一次除息月份以固定間隔補齊。
 */
function divProject(list, sym) {
  const [, k] = divFreq(list, sym);
  const d = list.slice().sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  const since = (() => { const t = tpeNow(); t.setDate(t.getDate() - 370); return ymd(t); })();
  const yr = d.filter(([x]) => x >= since); const months = Array(12).fill(0); const mo = (x) => Number(String(x).slice(5, 7)) - 1; const sum = (l) => l.reduce((a, [, c]) => a + c, 0);
  if (!d.length) return { annual: 0, perPay: 0, count: 0, months, estimated: false, perYear: 0 };
  if (!k) { const src = yr.length ? yr : d.slice(0, 1); src.forEach(([x, c]) => { months[mo(x)] += c; }); return { annual: sum(src), perPay: d[0][1], count: yr.length, months, estimated: false, perYear: 0 }; }
  const n = k >= 12 ? 3 : k >= 4 ? 2 : 1; const recent = (yr.length ? yr : d).slice(0, n); const perPay = sum(recent) / recent.length;
  const complete = yr.length >= k; const annual = complete ? sum(yr.slice(0, k)) : perPay * k;
  if (complete && k < 12) yr.slice(0, k).forEach(([x, c]) => { months[mo(x)] += c; });
  else { const st = mo(d[0][0]), step = 12 / k; for (let i = 0; i < k; i++) months[(st + i * step) % 12] += perPay; }
  return { annual, perPay, count: k, months, estimated: !complete, perYear: k };
}
function divNetFactor(sym) { return isUs(sym) ? 0.7 * usdTwd() : 1; }

// 個股頁：配息統計
async function divStatsCard(el, sym) {
  if (!el) return;
  const list = await divHist(sym); if (!el.isConnected) return;
  if (!list.length) { el.innerHTML = ''; return; }
  const price = (S.q[sym] || {}).price || 0; const pj = divProject(list, sym); const [freq] = divFreq(list, sym); const last = list[list.length - 1];
  const byYear = {}; list.forEach(([d, c]) => { const y = String(d).slice(0, 4); byYear[y] = (byYear[y] || 0) + c; });
  const ys = Object.keys(byYear).sort(); const thisY = String(tpeNow().getFullYear());
  let streak = 0; for (let y = +thisY - 1; byYear[String(y)]; y--) streak++; if (byYear[thisY]) streak++;
  const mh = Array(12).fill(0); const since5 = yearAgoYmd(5); list.filter(([d]) => d >= since5).forEach(([d]) => { mh[Number(String(d).slice(5, 7)) - 1]++; });
  const mx = Math.max(...mh, 1); const us = isUs(sym);
  el.innerHTML = `<div class="card"><h2>配息統計<span class="r tag">${esc(freq)}</span></h2>
    <div class="grid g4" style="gap:8px">
      <div><div class="small muted">${pj.estimated ? '年化殖利率（推估）' : '近 12 月殖利率'}</div><div class="num big">${price && pj.annual ? (pj.annual / price * 100).toFixed(2) + '%' : '—'}</div></div>
      <div><div class="small muted">${pj.estimated ? '年化每股（推估）' : '近 12 月每股'}</div><div class="num big">${pj.annual ? fmt(pj.annual, us ? 3 : 4) : '—'}</div></div>
      <div><div class="small muted">上次配息</div><div class="num">${fmt(last[1], us ? 3 : 4)}</div><div class="small muted">${esc(last[0])}</div></div>
      <div><div class="small muted">連續配息</div><div class="num big">${streak} 年</div></div></div>
    <div style="margin-top:12px">${barsHtml(ys.slice(-10).map((y) => [y, byYear[y]]), 'var(--primary)')}</div>
    <div class="small muted" style="margin-top:10px">近 5 年除息月份</div>
    <div class="mcal" style="margin-top:4px">${mh.map((n, i) => `<div class="mc" style="background:color-mix(in srgb, var(--primary) ${n ? Math.round(10 + n / mx * 45) : 0}%, var(--card2))"><div class="small">${i + 1} 月</div><div class="num">${n ? n + ' 次' : '—'}</div></div>`).join('')}</div>
    <div class="small muted" style="margin-top:6px">${us ? '美股配息為每股美元、未扣 30% 預扣稅；' : ''}年度合計以除息日計，${byYear[thisY] ? '今年尚未結束。' : ''}資料：${us ? 'Yahoo Finance' : '證交所／櫃買公告'}。</div></div>`;
}

// ───────── 工具：配息試算、配息組合、匯率換算 ─────────
function symPicker(id, val) { return `<div class="search" style="position:relative"><input id="${id}" placeholder="代號或名稱" autocomplete="off" value="${esc(val || '')}"><div class="res hide"></div></div>`; }
async function ensureQuote(sym) { if (!S.q[sym] || !S.q[sym].price) await refreshQuotes([sym]); return (S.q[sym] || {}).price || 0; }
async function divSimTool() {
  const sym0 = S.pref.dsSym || (holdings().find((h) => D.isEtf(h.symbol)) || {}).symbol || '0056';
  $('#tool').innerHTML = `<div class="grid g2 stack"><div class="card"><h2>指定標的配息試算</h2>
      <div class="field"><label>標的</label>${symPicker('dsS', sym0)}</div>
      <div class="grid g2"><div class="field"><label>目標</label><select id="dsM"><option value="m">平均每月領</option><option value="p">每次配息領</option><option value="y">每年領</option></select></div>
        <div class="field"><label>金額（台幣）</label><input id="dsA" type="number" value="${S.pref.dsAmt || 10000}"></div></div>
      <div class="small muted">以近 12 個月實際配息計算，未含二代健保與股價漲跌；美股扣 30% 預扣稅並以目前匯率換算。</div></div>
    <div class="card"><h2>試算結果</h2><div id="dsR"><div class="muted">讀取配息資料…</div></div></div></div>`;
  let sym = sym0;
  const calc = async () => {
    const R = $('#dsR'); if (!R) return; R.innerHTML = '<div class="muted">讀取中…</div>';
    const [list, price] = await Promise.all([divHist(sym), ensureQuote(sym)]); if (!$('#dsR')) return;
    const pj = divProject(list, sym); const [freq, per] = divFreq(list, sym); const f = divNetFactor(sym);
    if (!pj.annual || !price) { R.innerHTML = `<div class="empty">${esc(D.name(sym))}（${sym}）近 12 個月沒有配息資料或取不到股價</div>`; return; }
    const amt = +$('#dsA').value || 0; const mode = $('#dsM').value; S.pref.dsAmt = amt; S.pref.dsSym = sym; savePref();
    const annualWant = mode === 'm' ? amt * 12 : mode === 'y' ? amt : amt * Math.max(1, pj.count);
    let shares = annualWant / (pj.annual * f); const us = isUs(sym);
    shares = us ? Math.ceil(shares) : Math.ceil(shares / 1000) * 1000;
    const cap = shares * price * (us ? usdTwd() : 1); const annual = shares * pj.annual * f;
    const h = holdings().find((x) => x.symbol === sym); const have = h ? h.shares : 0;
    const row = (k, v, c = '') => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--card2)"><span class="text2">${k}</span><b class="num ${c}">${v}</b></div>`;
    R.innerHTML = `<div class="row" style="gap:8px;margin-bottom:6px"><b>${esc(D.name(sym))}</b><span class="muted num">${sym}</span><span class="tag">${esc(freq)}</span></div>` +
      row(pj.estimated ? '年化每股配息（推估）' : '近 12 月每股配息', fmt(pj.annual, 4) + (us ? ' 美元' : ' 元')) + row(pj.estimated ? '年化殖利率（推估）' : '近 12 月殖利率', (pj.annual / price * 100).toFixed(2) + '%') + row('目前股價', fmtPrice(price)) +
      row('需要持有', us ? fmtInt(shares) + ' 股' : fmtInt(shares / 1000) + ' 張（' + fmtInt(shares) + ' 股）', 'up') + row('參考本金（台幣）', fmtInt(cap), 'up') +
      row('預估年領', fmtInt(annual)) + row('平均每月', fmtInt(annual / 12)) + (per ? row('每次約', fmtInt(annual / Math.max(1, pj.count))) : '') +
      row('目前持有', have ? fmtInt(have) + ' 股' : '—') + (have ? row('還差', shares > have ? fmtInt(shares - have) + ' 股（約 ' + fmtInt((shares - have) * price * (us ? usdTwd() : 1)) + ' 元）' : '已達成', shares > have ? '' : 'up') : '') +
      `<div class="small muted" style="margin-top:8px">各月預估（每${us ? '股美元' : '股'}）：${pj.months.map((v, i) => (v ? `${i + 1}月 ${fmt(v, 3)}` : '')).filter(Boolean).join('、')}</div>`;
  };
  bindSearch($('#dsS'), (s) => { sym = s; $('#dsS').value = s; calc(); });
  $('#dsA').oninput = calc; $('#dsM').onchange = calc; calc();
}
async function comboTool() {
  const def = () => { const P = portfolio(); const r = P.rows.filter((x) => x.mv > 0); return r.length ? r.map((x) => [x.symbol, Math.round(x.weight)]) : [['0056', 34], ['00878', 33], ['00919', 33]]; };
  let rows = S.pref.combo && S.pref.combo.length ? S.pref.combo : def();
  $('#tool').innerHTML = `<div class="card"><h2>配息組合試算<span class="r"><button class="btn sm" id="cbH">套用目前持股</button> <button class="btn sm" id="cbR">高股息範例</button></span></h2>
      <div class="row wrap" style="gap:12px"><div class="field" style="width:200px"><label>投入本金（台幣）</label><input id="cbC" type="number" value="${S.pref.comboCap || 1000000}"></div>
        <div class="field" style="flex:1;min-width:220px"><label>新增標的</label>${symPicker('cbS', '')}</div></div>
      <div id="cbL"></div></div><div id="cbO" style="margin-top:12px"></div>`;
  const save = () => { S.pref.combo = rows; S.pref.comboCap = +$('#cbC').value || 0; savePref(); };
  const draw = async () => {
    $('#cbL').innerHTML = `<div class="scroll-x"><table class="tbl"><thead><tr><th>標的</th><th style="width:110px">權重 %</th><th></th></tr></thead><tbody>${rows.map(([s, w], i) => `<tr><td class="nm">${esc(D.name(s))} <span class="muted small num">${s}</span></td>
      <td><input type="number" data-cw="${i}" value="${w}" style="width:90px"></td><td><button class="btn sm" data-cx="${i}">移除</button></td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-cw]').forEach((x) => x.onchange = () => { rows[+x.dataset.cw][1] = +x.value || 0; save(); draw(); });
    $$('[data-cx]').forEach((x) => x.onclick = () => { rows.splice(+x.dataset.cx, 1); save(); draw(); });
    $('#cbO').innerHTML = '<div class="card empty">計算中…</div>';
    const cap = +$('#cbC').value || 0; const tw = rows.reduce((a, [, w]) => a + w, 0) || 1;
    await refreshQuotes(rows.map(([s]) => s).concat(['TWD=X']));
    const res = await Promise.all(rows.map(async ([s, w]) => {
      const list = await divHist(s); const pj = divProject(list, s); const price = (S.q[s] || {}).price || 0; const us = isUs(s); const f = divNetFactor(s);
      const money = cap * w / tw; const shares = price ? (us ? money / usdTwd() / price : Math.floor(money / price)) : 0;
      return { s, w: w / tw * 100, price, shares, money, annual: shares * pj.annual * f, months: pj.months.map((v) => v * shares * f), freq: divFreq(list, s)[0] };
    }));
    if (!$('#cbO')) return;
    const total = res.reduce((a, r) => a + r.annual, 0); const months = Array.from({ length: 12 }, (_, i) => res.reduce((a, r) => a + r.months[i], 0));
    const filled = months.filter((v) => v > 0).length;
    $('#cbO').innerHTML = `<div class="grid g4" style="margin-bottom:12px"><div class="tile"><div class="k">預估年領</div><div class="v num up">${fmtInt(total)}</div></div>
        <div class="tile"><div class="k">平均每月</div><div class="v num">${fmtInt(total / 12)}</div></div><div class="tile"><div class="k">組合殖利率</div><div class="v num">${cap ? (total / cap * 100).toFixed(2) + '%' : '—'}</div></div>
        <div class="tile"><div class="k">有配息的月份</div><div class="v num">${filled}／12</div><div class="s muted">${filled >= 12 ? '月月領' : '空缺：' + months.map((v, i) => (v ? '' : i + 1 + '月')).filter(Boolean).join('、')}</div></div></div>
      <div class="grid g2 stack"><div class="card"><h2>每月預估入帳（以除息月計）</h2>${barsHtml(months.map((v, i) => [i + 1 + '月', v]), 'var(--primary)')}</div>
      <div class="card"><h2>明細</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>標的</th><th>配息</th><th>權重</th><th>股數</th><th>年領</th><th>殖利率</th></tr></thead><tbody>
        ${res.map((r) => `<tr class="click" data-go="#/s/${r.s}"><td class="nm">${esc(D.name(r.s))} <span class="muted small num">${r.s}</span></td><td class="small">${esc(r.freq)}</td><td class="num">${r.w.toFixed(1)}%</td><td class="num">${r.price ? fmtInt(r.shares) : '—'}</td><td class="num">${fmtInt(r.annual)}</td><td class="num">${r.money ? (r.annual / r.money * 100).toFixed(2) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div>
        <div class="small muted" style="margin-top:6px">依各標的近 12 個月實際配息與目前股價估算；未含二代健保，美股已扣 30% 預扣稅。過去配息不代表未來。</div></div></div>`;
  };
  bindSearch($('#cbS'), (s) => { if (!rows.some(([x]) => x === s)) rows.push([s, 10]); $('#cbS').value = ''; save(); draw(); });
  $('#cbC').onchange = () => { save(); draw(); };
  $('#cbH').onclick = () => { rows = def(); save(); draw(); };
  $('#cbR').onclick = () => { rows = [['0056', 25], ['00878', 25], ['00919', 25], ['00929', 25]]; save(); draw(); };
  draw();
}
const FX_LIST = [['TWD', '台幣', null], ['USD', '美元', 'TWD=X'], ['JPY', '日圓', 'JPYTWD=X'], ['EUR', '歐元', 'EURTWD=X'], ['CNY', '人民幣', 'CNYTWD=X'], ['HKD', '港幣', 'HKDTWD=X'], ['GBP', '英鎊', 'GBPTWD=X'], ['AUD', '澳幣', 'AUDTWD=X']];
async function fxTool() {
  const from = S.pref.fxFrom || 'USD';
  $('#tool').innerHTML = `<div class="card" style="max-width:640px"><h2>匯率換算</h2><div class="grid g2"><div class="field"><label>金額</label><input id="fxA" type="number" value="${S.pref.fxAmt || 1000}"></div>
    <div class="field"><label>幣別</label><select id="fxF">${FX_LIST.map(([c, n]) => `<option value="${c}" ${c === from ? 'selected' : ''}>${n}（${c}）</option>`).join('')}</select></div></div><div id="fxR" style="margin-top:8px"><div class="muted">讀取匯率…</div></div>
    <div class="small muted" style="margin-top:8px">即期參考匯率（Yahoo Finance），實際換匯請以銀行牌告為準。</div></div>`;
  await Promise.all(FX_LIST.filter(([, , k]) => k && (!S.q[k] || Date.now() - (S.q[k].at || 0) > 300000)).map(async ([, , k]) => { const v = await fetchUs(k); if (v) S.q[k] = { ...v, at: Date.now() }; }));
  const rate = (c) => { const x = FX_LIST.find((f) => f[0] === c); return x[2] ? (S.q[x[2]] || {}).price || 0 : 1; };
  const calc = () => { const R = $('#fxR'); if (!R) return; const a = +$('#fxA').value || 0; const f = $('#fxF').value; S.pref.fxAmt = a; S.pref.fxFrom = f; savePref(); const twd = a * rate(f);
    R.innerHTML = `<table class="tbl"><tbody>${FX_LIST.filter(([c]) => c !== f).map(([c, n]) => { const r = rate(c); return `<tr><td>${n}（${c}）</td><td class="num">${r ? fmt(twd / r, c === 'JPY' ? 0 : 2) : '—'}</td><td class="small muted num">${r && c !== 'TWD' ? '1 ' + c + ' = ' + fmt(r, c === 'JPY' ? 4 : 3) + ' TWD' : ''}</td></tr>`; }).join('')}</tbody></table>`; };
  $('#fxA').oninput = calc; $('#fxF').onchange = calc; calc();
}

// ───────── 新聞 ─────────
const NEWS_SRC = [
  ['news', 'Yahoo 最新', 'https://tw.stock.yahoo.com/rss?category=news'], ['tw-market', '台股動態', 'https://tw.stock.yahoo.com/rss?category=tw-market'],
  ['intl-markets', '國際財經', 'https://tw.stock.yahoo.com/rss?category=intl-markets'], ['research', '研究報導', 'https://tw.stock.yahoo.com/rss?category=research'],
  ['column', '專家專欄', 'https://tw.stock.yahoo.com/rss?category=column'], ['funds-news', '基金動態', 'https://tw.stock.yahoo.com/rss?category=funds-news'],
  ['cnyes', '鉅亨台股', 'cnyes:tw_stock'], ['cnyes-us', '鉅亨美股', 'cnyes:wd_stock'], ['bing', '新聞搜尋', 'kw:台股 財經'],
  ['cna', '中央社財經', 'https://feeds.feedburner.com/rsscna/finance'], ['ltn', '自由財經', 'https://news.ltn.com.tw/rss/business.xml'],
  ['udn', '經濟日報', 'https://money.udn.com/rssfeed/news/1001/5590?ch=money'], ['us', 'Yahoo Finance 美股', 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US'],
];
async function rssItems(url, n = 30) {
  const xml = new DOMParser().parseFromString(await px(url, 600, 'text'), 'text/xml');
  const items = $$('item', xml); if (!items.length && !xml.querySelector('channel')) throw new Error('不是 RSS');
  return items.slice(0, n).map((it) => {
    const g = (t) => ((it.querySelector(t) || {}).textContent || '').trim();
    const desc = g('description').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    let l = g('link'); const m = l.match(/[?&]url=([^&]+)/); if (/bing\.com\/news\/apiclick/.test(l) && m) l = decodeURIComponent(m[1]); // Bing 轉址改為原文網址
    const src = g('source') || ((it.getElementsByTagName('News:Source')[0] || {}).textContent || '').trim();
    return { t: g('title'), l, d: g('pubDate'), s: src, x: desc.slice(0, 140) };
  });
}
/** 鉅亨網新聞（JSON）：tw_stock 台股、wd_stock 美股／國際 */
async function cnyesItems(cat, n = 30) {
  const j = await px('https://api.cnyes.com/media/api/v1/newslist/category/' + cat + '?limit=' + n, 600);
  const l = (((j || {}).items || {}).data) || []; if (!Array.isArray(l)) throw new Error('鉅亨格式不符');
  return l.map((x) => ({ t: x.title || '', l: 'https://news.cnyes.com/news/id/' + x.newsId, d: x.publishAt ? new Date(x.publishAt * 1000).toUTCString() : '', s: '鉅亨網', x: String(x.summary || '').replace(/\s+/g, ' ').slice(0, 140) }));
}
/** 關鍵字新聞：Bing 新聞 RSS → Google 新聞（備援）；都讀不到時丟出錯誤 */
async function kwNews(q, n = 30) {
  const srcs = [['Bing', 'https://www.bing.com/news/search?q=' + encodeURIComponent(q) + '&format=rss&setlang=zh-hant&cc=TW&mkt=zh-TW'],
    ['Google', 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant']];
  let err = null;
  for (const [nm, u] of srcs) { try { const l = await rssItems(u, n); if (l.length) return l.map((x) => ({ ...x, via: nm })); } catch (e) { err = e; } }
  if (err) throw err; return [];
}
/** 新聞搜尋：輸入代號（如 00406A、2330、AAPL）或名稱、關鍵字；合併個股新聞、關鍵字新聞與鉅亨網，依時間排序 */
async function searchNews(q) {
  await loadDir().catch(() => {});
  const up = q.trim().toUpperCase(); let sym = null;
  if (/^\d{4,6}[A-Z]?$/.test(up) || (S.dir && S.dir[up]) || D.quotes().some((x) => x.s === up)) sym = up;
  else if (/^[A-Z][A-Z.\-]{0,5}$/.test(up)) sym = up; // 美股代號
  else { // 名稱 → 代號（自選或股票目錄）
    const hit = D.quotes().find((x) => x.n === q.trim()) || null; if (hit) sym = hit.s;
    else if (S.dir) { const e = Object.entries(S.dir).find(([, v]) => v && v[0] === q.trim()); if (e) sym = e[0]; }
  }
  const name = sym ? D.name(sym) : ''; const us = sym && isUs(sym);
  const jobs = [];
  if (sym) jobs.push(rssItems(us ? 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=' + encodeURIComponent(sym) + '&region=US&lang=en-US' : 'https://tw.stock.yahoo.com/rss?s=' + encodeURIComponent(sym), 20).then((l) => l.map((x) => ({ ...x, s: x.s || 'Yahoo 股市' }))));
  const kw = sym ? (name && name !== sym ? (us ? sym + ' stock' : name + ' ' + sym) : sym + (us ? ' stock' : ' ETF 股')) : q.trim();
  jobs.push(kwNews(kw, 25));
  if (!us) jobs.push(cnyesItems('tw_stock', 80).then((l) => l.filter((x) => [q.trim(), sym, name].filter((t) => t && t.length >= 2).some((t) => x.t.includes(t) || x.x.includes(t)))));
  const res = await Promise.allSettled(jobs); const ok = res.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw new Error('新聞來源暫時讀不到');
  const seen = new Set();
  const items = ok.flatMap((r) => r.value).filter((x) => x.t && !seen.has(x.t) && seen.add(x.t)).sort((a, b) => (Date.parse(b.d) || 0) - (Date.parse(a.d) || 0)).slice(0, 60);
  return { sym, name, items, failed: res.length - ok.length };
}
/** 依來源代碼讀新聞（RSS、鉅亨 JSON、關鍵字搜尋） */
function newsBy(src, n = 40) { return src.startsWith('cnyes:') ? cnyesItems(src.slice(6), n) : src.startsWith('kw:') ? kwNews(src.slice(3), n) : rssItems(src, n); }
function ago(d) { const t = Date.parse(d); if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 60 ? Math.max(1, m) + ' 分鐘前' : m < 1440 ? Math.round(m / 60) + ' 小時前' : Math.round(m / 1440) + ' 天前'; }
VIEWS.news = {
  title: '新聞',
  render() {
    if (S.pref.newsSrc === 'google') S.pref.newsSrc = 'bing'; // 舊設定：Google 新聞改為新聞搜尋（Bing 優先、Google 備援）
    const k = S.pref.newsSrc || 'news';
    return head('財經新聞', `<button class="btn" id="nwR">重新整理</button>`) + `<div class="chips" style="margin-bottom:12px;flex-wrap:wrap">${NEWS_SRC.map(([id, n]) => `<button class="chip ${k === id ? 'on' : ''}" data-ns="${id}">${n}</button>`).join('')}<button class="chip ${k === 'mine' ? 'on' : ''}" data-ns="mine">我的持股</button></div>
      <div class="row" style="gap:8px;margin-bottom:12px"><div class="search sp" style="margin:0"><input id="nwQ" placeholder="搜尋新聞：代號（00406A、2330、AAPL）、公司名稱或關鍵字，按 Enter" autocomplete="off" value="${esc(this._q || '')}"></div><button class="btn primary" id="nwS">搜尋</button>${this._q ? '<button class="btn" id="nwX">清除搜尋</button>' : ''}</div>
      <div id="dyn"><div class="card empty">讀取中…</div></div>`;
  },
  bind() {
    $$('[data-ns]').forEach((b) => b.onclick = () => { S.pref.newsSrc = b.dataset.ns; savePref(); route(); });
    $('#nwR').onclick = () => { this._c = {}; this.fill(); };
    $('#nwQ').oninput = () => { if (!this._q) this.draw(); };
    const go = () => { const v = $('#nwQ').value.trim(); this._q = v || null; route(); };
    $('#nwQ').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    $('#nwS').onclick = go;
    if ($('#nwX')) $('#nwX').onclick = () => { this._q = null; route(); };
  },
  async fill() {
    if (!can('NEWS')) { $('#dyn').innerHTML = lockCard('NEWS'); return; }
    this._c = this._c || {};
    if (this._q) { const k = 'q:' + this._q;
      if (!this._c[k] || Date.now() - this._c[k].at > 600000) { $('#dyn').innerHTML = '<div class="card empty">搜尋「' + esc(this._q) + '」相關新聞…</div>'; let r = null; try { r = await searchNews(this._q); } catch (e) {} this._c[k] = { at: Date.now(), items: r ? r.items : null, info: r }; }
      if (S.route === 'news') this.draw(); return; }
    const k = S.pref.newsSrc || 'news';
    if (!this._c[k] || Date.now() - this._c[k].at > 600000) {
      let items = [];
      try {
        if (k === 'mine') {
          const syms = holdings().slice().sort((a, b) => b.shares * b.avgCost - a.shares * a.avgCost).slice(0, 8).map((h) => h.symbol);
          const all = await Promise.all(syms.map((s) => rssItems(isUs(s) ? 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=' + encodeURIComponent(s) + '&region=US&lang=en-US' : 'https://tw.stock.yahoo.com/rss?s=' + s, 8).then((l) => l.map((x) => ({ ...x, sym: s }))).catch(() => [])));
          const seen = new Set(); items = all.flat().filter((x) => !seen.has(x.t) && seen.add(x.t)).sort((a, b) => (Date.parse(b.d) || 0) - (Date.parse(a.d) || 0));
        } else items = await newsBy((NEWS_SRC.find((x) => x[0] === k) || NEWS_SRC[0])[2], 40);
      } catch (e) { items = null; }
      this._c[k] = { at: Date.now(), items };
    }
    if (S.route !== 'news') return; this.draw();
  },
  draw() {
    const k = this._q ? 'q:' + this._q : S.pref.newsSrc || 'news'; const c = (this._c || {})[k]; if (!c || !$('#dyn')) return;
    if (this._q) { const inf = c.info || {}; const l = c.items || [];
      $('#dyn').innerHTML = `<div class="card"><h2>搜尋：${esc(this._q)}${inf.sym && inf.name && inf.name !== inf.sym ? '（' + esc(inf.name) + '）' : ''}<span class="r small muted">${l.length} 則${inf.failed ? ' · 部分來源暫時讀不到' : ''}</span></h2>
        ${c.items == null ? '<div class="empty">新聞來源暫時讀不到，請稍後再試（新來源需管理員重新部署轉送站）。</div>' : l.length ? `<div class="list">${l.map((n) => `<a class="it" href="${esc(n.l)}" target="_blank" rel="noopener" style="color:inherit;align-items:flex-start"><div class="l"><div class="t1" style="white-space:normal;line-height:1.5">${esc(n.t)}</div>
          ${n.x && !n.x.startsWith(n.t.slice(0, 10)) ? `<div class="t2" style="white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(n.x)}</div>` : ''}<div class="t2">${esc(n.s || n.via || '')}${n.s || n.via ? ' · ' : ''}${ago(n.d)}</div></div></a>`).join('')}</div>`
          : `<div class="empty">沒有找到「${esc(this._q)}」的相關新聞。${inf.sym ? ` <a href="#/s/${encodeURIComponent(inf.sym)}">查看 ${esc(inf.sym)} 個股頁 ›</a>` : ''}</div>`}
        ${inf.sym ? `<div class="small muted" style="margin-top:6px">來源：Yahoo 股市個股新聞、新聞搜尋（Bing／Google）、鉅亨網；新上市 ETF 新聞量較少屬正常。</div>` : ''}</div>`;
      return; }
    if (c.items == null) { $('#dyn').innerHTML = `<div class="card empty">這個來源暫時讀不到${['cna', 'ltn', 'udn', 'cnyes', 'cnyes-us', 'bing'].includes(k) ? '（需管理員在 LINE › 自動回覆按「重新部署」更新轉送站後才能使用）' : ''}，請改選其他來源。</div>`; return; }
    const q = ($('#nwQ').value || '').trim(); const l = c.items.filter((x) => !q || x.t.includes(q) || x.x.includes(q));
    $('#dyn').innerHTML = `<div class="card">${l.length ? `<div class="list">${l.map((n) => `<a class="it" href="${esc(n.l)}" target="_blank" rel="noopener" style="color:inherit;align-items:flex-start"><div class="l"><div class="t1" style="white-space:normal;line-height:1.5">${n.sym ? `<span class="tag" style="color:var(--primary)">${esc(D.name(n.sym))}</span> ` : ''}${esc(n.t)}</div>
      ${n.x && !n.x.startsWith(n.t.slice(0, 10)) ? `<div class="t2" style="white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(n.x)}</div>` : ''}<div class="t2">${esc(n.s || '')}${n.s ? ' · ' : ''}${ago(n.d)}</div></div></a>`).join('')}</div>` : '<div class="empty">沒有符合的新聞</div>'}</div>`;
  },
  syms() { return []; },
};

// ───────── 資產核對 ─────────
function assetAudit() {
  const P = portfolio(); const fx = usdTwd(); const issues = [];
  D.trades().forEach((t) => {
    if (t.t !== 'BUY' && t.t !== 'SELL') return; const q = S.q[t.s] || {};
    if (isUs(t.s) && t.x && (t.x < 20 || t.x > 45)) issues.push([t, `美股匯率 ${t.x} 看起來不正常（應約 28～35）`]);
    if (!isUs(t.s) && t.x && t.x !== 1) issues.push([t, `台股交易的匯率應為 1，目前是 ${t.x}`]);
    if (q.price && t.p && (t.p > q.price * 5 || t.p < q.price / 5)) issues.push([t, `成交價 ${fmtPrice(t.p)} 與現價 ${fmtPrice(q.price)} 差距超過 5 倍（是否有拆股或輸入錯誤）`]);
    if (!isUs(t.s) && t.n > 0 && t.n < 1) issues.push([t, '台股股數小於 1 股']);
    if (t.n >= 1e7) issues.push([t, `股數 ${fmtInt(t.n)} 異常偏大`]);
  });
  const lg = D.trades().length ? ledger() : null;
  const html = `<div class="scroll-x"><table class="tbl"><thead><tr><th>個股</th><th>股數</th><th>現價</th><th>匯率</th><th>台幣市值</th></tr></thead><tbody>
      ${P.rows.map((r) => `<tr><td class="nm">${esc(r.name)} <span class="muted small num">${r.symbol}</span></td><td class="num">${fmt(r.shares, r.shares % 1 ? 4 : 0)}</td><td class="num">${fmtPrice(r.price)}${S.q[r.symbol] && S.q[r.symbol].price ? '' : ' <span class="small down">無報價，用均價</span>'}</td><td class="num">${r.us ? fmt(fx, 3) : '1'}</td><td class="num">${fmtInt(r.mv)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>持股市值</td><td></td><td></td><td></td><td class="num">${fmtInt(P.mv)}</td></tr><tr><td>現金${lg && !lg.err ? '（帳本計算）' : '（手動）'}</td><td></td><td></td><td></td><td class="num">${fmtInt(P.cash)}</td></tr>${P.debt > 0 ? `<tr><td>− 融資餘額</td><td></td><td></td><td></td><td class="num up">${fmtInt(P.debt)}</td></tr>` : ''}<tr><td><b>總資產</b></td><td></td><td></td><td></td><td class="num"><b>${fmtInt(P.mv + P.cash - P.debt)}</b></td></tr></tfoot></table></div>
    ${lg && lg.err ? `<div class="notice" style="margin-top:10px">帳本計算錯誤：${esc(lg.err)}</div>` : ''}
    <h3 style="margin:14px 0 6px">可能輸入錯誤的交易（${issues.length}）</h3>${issues.length ? `<div class="list">${issues.map(([t, m]) => `<div class="it" data-aud="${t.id}"><div class="l"><div class="t1">${esc(D.name(t.s))} <span class="muted small">${esc(t.d)} ${TYPE_N[t.t]} ${fmtInt(t.n)} 股 @ ${fmtPrice(t.p)}</span></div><div class="t2 down">${esc(m)}</div></div><span class="muted">修改 ›</span></div>`).join('')}</div>` : '<div class="small muted">沒有發現異常。</div>'}`;
  dialog('資產核對', html, [['', '關閉']], (box, close) => { $$('[data-aud]', box).forEach((d) => d.onclick = () => { close(''); tradeModal(D.trades().find((t) => String(t.id) === d.dataset.aud)); }); });
}

// ───────── 資料來源診斷 ─────────
const DIAG = [
  ['證交所 MIS 即時', () => px(MIS + encodeURIComponent('tse_2330.tw'), 0).then((j) => { const a = (j.msgArray || [])[0]; if (!a) throw new Error('無資料'); return '台積電 ' + (a.z && a.z !== '-' ? a.z : a.y) + (a.d ? '（' + a.d + ' ' + (a.t || '') + '）' : ''); })],
  ['Yahoo K 線（台股）', () => fetchYahoo('2330.TW', '5d', '1d', 0).then((r) => { if (!r) throw new Error('無資料'); return '最新 ' + tsYmd(r.timestamp[r.timestamp.length - 1]) + ' 收 ' + fmtPrice(r.meta.regularMarketPrice); })],
  ['Yahoo 美股', () => fetchUs('AAPL').then((v) => { if (!v) throw new Error('無資料'); return 'AAPL ' + fmtPrice(v.price); })],
  ['Yahoo 排行', () => px('https://tw.stock.yahoo.com/_td-stock/api/resource/StockServices.rank;exchange=TAI;limit=5;offset=0;period=1D;sortBy=-changePercent', 0).then((j) => (j.list || []).length + ' 筆')],
  ['證交所 OpenAPI 收盤', () => px('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', 600).then((a) => { if (!a.length) throw new Error('無資料'); return a.length + ' 檔，日期 ' + rocDate(a[0].Date); })],
  ['櫃買 OpenAPI 收盤', () => px('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', 600).then((a) => { if (!a.length) throw new Error('無資料'); return a.length + ' 檔，日期 ' + rocDate(a[0].Date); })],
  ['發佈站資料（估值）', () => kv('sx:val').then((v) => { if (!v) throw new Error('尚無資料'); return Object.keys(v).length + ' 檔'; })],
  ['發佈站資料（盤後摘要）', () => kv('sx:mkt').then((v) => { if (!v) throw new Error('尚無資料'); return v.d || 'OK'; })],
  ['Yahoo 新聞 RSS', () => rssItems('https://tw.stock.yahoo.com/rss?category=news', 3).then((l) => { if (!l.length) throw new Error('無資料'); return l.length + ' 則，最新 ' + ago(l[0].d); })],
  ['發佈站程式版本', () => fetch('/api/ver').then((r) => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : null)).then((v) => { if (!v) throw new Error('舊版：請在管理員版 LINE › 自動回覆按「重新部署」'); return v.app ? 'v' + v.app + '（' + v.hash.slice(0, 7) + '）' + (v.at ? '，部署於 ' + new Date(v.at).toLocaleString('zh-TW', { hour12: false }) : '') : '已更新（未記錄版本）'; })],
  ['會員伺服器', () => api('me', { session: S.session, web: true }).then(() => '連線正常')],
];
VIEWS.diag = {
  title: '資料來源診斷',
  render() { return head('資料來源診斷', `<button class="btn primary" id="dgR">重新檢查</button><a class="btn" href="#/settings">‹ 設定</a>`) + '<div class="card"><div class="small muted" style="margin-bottom:8px">逐一實際連線各資料來源，確認是否可用與資料日期；用來排查「抓不到資料」。</div><div id="dyn"></div></div>'; },
  bind() { $('#dgR').onclick = () => this.fill(); },
  async fill() {
    $('#dyn').innerHTML = `<table class="tbl"><thead><tr><th>來源</th><th>狀態</th><th>耗時</th><th>結果</th></tr></thead><tbody>${DIAG.map(([n], i) => `<tr><td>${esc(n)}</td><td id="dg${i}s" class="muted">檢查中…</td><td id="dg${i}t" class="num"></td><td id="dg${i}r" class="small"></td></tr>`).join('')}</tbody></table>`;
    DIAG.forEach(async ([, fn], i) => {
      const t0 = performance.now(); let ok = true, msg = '';
      try { msg = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('逾時')), 20000))]); } catch (e) { ok = false; msg = e.message || String(e); }
      if (!$('#dg' + i + 's')) return;
      $('#dg' + i + 's').innerHTML = ok ? '<span style="color:#16a34a">✓ 正常</span>' : '<span style="color:#ef4444">✗ 失敗</span>';
      $('#dg' + i + 't').textContent = Math.round(performance.now() - t0) + ' ms'; $('#dg' + i + 'r').textContent = msg;
    });
  },
  syms() { return []; },
};

// ───────── 個股分頁（概覽、籌碼、財務、成分、股息、新聞、公司） ─────────
const SAPI = {};
/** 發佈站個股資料（Yahoo 基本面需 crumb、三大法人近 N 日、ETF 成分股） */
async function sapi(k, s, extra = '') {
  const key = k + s + extra; if (SAPI[key] && Date.now() - SAPI[key].at < 600000) return SAPI[key].v;
  const r = await fetch('/api/stock?k=' + k + '&s=' + encodeURIComponent(s) + extra);
  if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) throw new Error('NEEDDEPLOY');
  const j = await r.json(); if (j.err) throw new Error(j.err);
  SAPI[key] = { at: Date.now(), v: j }; return j;
}
async function ys(sym, modules) { return (await sapi('ys', ysym(sym), '&m=' + modules)).r || {}; }
const NEED_DEPLOY = '<div class="notice">這項資料需要管理員在 LINE › 自動回覆按一次「重新部署」後，網頁版才能讀取。</div>';
function sapiErr(e) { return e && e.message === 'NEEDDEPLOY' ? NEED_DEPLOY : `<div class="small muted">暫時無法取得（${esc((e && e.message) || '')}）</div>`; }
const yf = (o, k) => { const v = o && o[k]; if (v == null) return null; if (typeof v === 'object') return v.fmt || (v.raw != null ? String(v.raw) : null); return String(v); };
const yr = (o, k) => { const v = o && o[k]; if (v == null) return null; const x = typeof v === 'object' ? v.raw : v; return x == null || isNaN(x) ? null : +x; };
const kvRows = (items) => `<div class="grid g3" style="gap:10px">${items.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<div><div class="small muted">${esc(k)}</div><div class="num">${esc(String(v))}</div></div>`).join('')}</div>`;
/**
 * ETF 每日操作（與 App EtfComposition 相同）：今天與前一個資料日的持股比較，得出新增、刪除、加碼、減碼與估算金額。
 * 前一日快照優先用發佈站保存的（所有人共用），沒有時用這個瀏覽器自己存的。
 */
async function etfOps(sym, list, asOf, prev) {
  const key = 'etfs_' + sym; const local = store.get(key, {}); const cur = {}; list.forEach((x) => { cur[x.s || x.n] = [x.sh || -1, x.w, x.n]; });
  local[asOf] = cur; Object.keys(local).sort().slice(0, -5).forEach((k) => delete local[k]); store.set(key, local);
  if (!prev) { const pk = Object.keys(local).filter((k) => k < asOf).sort().pop(); if (pk) prev = { asOf: pk, rows: local[pk] }; }
  if (!prev || !prev.rows) return { asOf, prevAsOf: null, changes: [] };
  const P = prev.rows; const out = []; const nowKeys = new Set();
  list.forEach((x) => { const k = x.s || x.n; nowKeys.add(k); nowKeys.add(x.n); const p = P[k] || P[x.n];
    if (!p) { out.push({ s: x.s, n: x.n, kind: 0, d: x.sh || 0, pct: null, w: x.w, dw: x.w }); return; }
    const ps = p[0], pw = p[1];
    if (x.sh > 0 && ps > 0) { const d = x.sh - ps; if (Math.abs(d) >= 1) out.push({ s: x.s, n: x.n, kind: d > 0 ? 2 : 3, d, pct: d / ps * 100, w: x.w, dw: x.w - pw }); }
    else if (Math.abs(x.w - pw) >= 0.1) out.push({ s: x.s, n: x.n, kind: x.w > pw ? 2 : 3, d: 0, pct: null, w: x.w, dw: x.w - pw, byW: true }); });
  Object.keys(P).forEach((k) => { if (nowKeys.has(k) || nowKeys.has(P[k][2])) return; const ps = P[k][0];
    out.push({ s: /^[0-9A-Z]+$/.test(k) && /\d/.test(k) ? k : '', n: P[k][2] || k, kind: 1, d: ps > 0 ? -ps : 0, pct: -100, w: 0, dw: -(P[k][1] || 0) }); });
  out.sort((a, b) => a.kind - b.kind || Math.abs(b.pct ?? 100) - Math.abs(a.pct ?? 100));
  const syms = out.map((c) => c.s).filter(Boolean).slice(0, 40); if (syms.length) await refreshQuotes(syms).catch(() => {});
  out.forEach((c) => { const px0 = c.s && (S.q[c.s] || {}).price; c.amt = px0 && c.d ? c.d * px0 : null; });
  return { asOf, prevAsOf: prev.asOf, changes: out };
}
function etfOpsHtml(o) {
  const K = [['新增', 'up'], ['刪除', 'down'], ['加碼', 'up'], ['減碼', 'down']];
  if (!o.prevAsOf) return `<div class="card" style="grid-column:1/-1"><h2>每日操作</h2><div class="small muted">已記錄 ${esc(o.asOf)} 的持股；下一個資料日起即可比較出新增、刪除、加碼與減碼。</div></div>`;
  const c = o.changes; const buy = c.filter((x) => x.amt > 0).reduce((a, x) => a + x.amt, 0), sell = -c.filter((x) => x.amt < 0).reduce((a, x) => a + x.amt, 0);
  const lots = (v) => (Math.abs(v) >= 1000 ? fmtSigned(v / 1000, Math.abs(v) % 1000 ? 1 : 0) + ' 張' : fmtSigned(v) + ' 股');
  return `<div class="card" style="grid-column:1/-1"><h2>每日操作<span class="r small muted">${esc(o.prevAsOf)} → ${esc(o.asOf)}</span></h2>
    <div class="grid g3" style="gap:8px;margin-bottom:10px">${K.map(([n, cl], i) => `<div class="tile"><div class="k">${n}</div><div class="v num ${c.filter((x) => x.kind === i).length ? cl : ''}">${c.filter((x) => x.kind === i).length} 檔</div></div>`).join('')}
      <div class="tile"><div class="k">估算買進金額</div><div class="v num up">${buy ? fmtInt(buy) : '—'}</div></div><div class="tile"><div class="k">估算賣出金額</div><div class="v num down">${sell ? fmtInt(sell) : '—'}</div></div></div>
    ${c.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>動作</th><th style="text-align:left">成分股</th><th>股數變化</th><th>變動</th><th>權重</th><th>估算金額</th></tr></thead><tbody>
      ${c.map((x) => `<tr ${x.s ? `class="click" data-go="#/s/${encodeURIComponent(x.s)}"` : ''}><td><span class="tag ${K[x.kind][1]}">${K[x.kind][0]}</span></td><td style="text-align:left">${esc(x.s && D.name(x.s) !== x.s ? D.name(x.s) : x.n)} <span class="muted small num">${esc(x.s || '')}</span></td>
        <td class="num ${cls(x.d)}">${x.d ? lots(x.d) : x.byW ? '（依權重）' : '—'}</td><td class="num ${cls(x.pct ?? x.dw)}">${x.pct != null ? fmtPct(x.pct) : '—'}</td><td class="num">${x.w.toFixed(2)}%<span class="small ${cls(x.dw)}"> ${x.dw >= 0 ? '+' : ''}${x.dw.toFixed(2)}</span></td><td class="num ${cls(x.amt)}">${x.amt ? fmtSigned(x.amt) : '—'}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="small muted">與前一個資料日相比，持股沒有變動。</div>'}
    <div class="small muted" style="margin-top:6px">依每日揭露的持股（股數）比較；估算金額＝股數變化 × 目前股價，僅供參考，實際以投信公告為準。</div></div>`;
}
// ───────── FinMind（台股月營收、季損益、本益比區間、法人 60 日、融資融券、外資持股、股利政策）：經發佈站 /api/fm 共用快取 ─────────
const FMC = {};
const etfLike = (sym) => D.isEtf(sym) || (!isUs(sym) && /^00/.test(sym)) || (S.q[sym] || {}).type === 'ETF';
async function fmGet(ds, sym, span) {
  const k = ds + sym + span; if (FMC[k] && Date.now() - FMC[k].at < 1800000) return FMC[k].v;
  const fsrc = keySrc('fmSrc'); const sysFm = !!(S.sk && S.sk.finmind);
  const tk = aiHas('finmind') && !(fsrc === 'system' && sysFm) ? await aiKeyGet('finmind') : '';
  const r = await fetch('/api/fm?ds=' + ds + '&id=' + encodeURIComponent(sym) + '&span=' + span, tk ? { headers: { 'x-fm-token': tk } } : S.session && fsrc !== 'own' ? { headers: { 'x-m-session': S.session } } : {});
  if (!/json/.test(r.headers.get('content-type') || '')) throw new Error('NEEDDEPLOY');
  const j = await r.json(); if (j.err) throw new Error(j.err);
  FMC[k] = { at: Date.now(), v: j.data || [] }; return FMC[k].v;
}
const fmYi = (v) => fmt(v / 1e8, Math.abs(v) >= 1e10 ? 0 : 2);
const fmFoot = (x) => `<div class="small muted" style="margin-top:6px">資料來源：FinMind${x || ''}</div>`;
const fmErr = (t, e) => `<div class="card"><h2>${t}</h2>${sapiErr(e)}</div>`;
function fmBars(vals, colorOf, h = 70) {
  const mx = Math.max(1e-9, ...vals.map((v) => Math.abs(v))); const neg = vals.some((v) => v < 0);
  return `<div style="display:flex;align-items:${neg ? 'center' : 'flex-end'};gap:2px;height:${h}px;margin:6px 0">${vals.map((v, i) => { const hh = Math.max(1, Math.abs(v) / mx * (neg ? h / 2 : h));
    return `<div style="flex:1;height:${neg ? h : hh}px;display:flex;flex-direction:column;justify-content:${neg ? (v >= 0 ? 'flex-start' : 'flex-end') : 'flex-end'}">${neg ? `<div style="height:${h / 2}px;display:flex;align-items:${v >= 0 ? 'flex-end' : 'flex-start'}"><div style="width:100%;height:${hh}px;background:${colorOf(v, i)};border-radius:2px;opacity:.85"></div></div>` : `<div style="width:100%;height:${hh}px;background:${colorOf(v, i)};border-radius:2px;opacity:.85"></div>`}</div>`; }).join('')}</div>`;
}
const fmUpDn = (v) => css(v > 0 ? '--up' : v < 0 ? '--down' : '--muted');
/** 月營收：(年,月,營收) → 月增、年增、累計年增，新到舊 */
function fmMonthRev(rows) {
  const m = new Map(); rows.forEach((o) => { let y = +o.revenue_year, mo = +o.revenue_month; if (!(y > 0 && mo >= 1 && mo <= 12)) { const d = new Date(o.date); d.setMonth(d.getMonth() - 1); y = d.getFullYear(); mo = d.getMonth() + 1; } if (o.revenue != null) m.set(y * 100 + mo, +o.revenue); });
  const ks = Array.from(m.keys()).sort((a, b) => a - b);
  return ks.map((k) => { const y = Math.floor(k / 100), mo = k % 100, rev = m.get(k); const pv = m.get(mo === 1 ? (y - 1) * 100 + 12 : k - 1), ly = m.get(k - 100);
    let ytd = 0, lyt = 0, full = true; for (let i = 1; i <= mo; i++) { const a = m.get(y * 100 + i), b = m.get((y - 1) * 100 + i); if (a != null) ytd += a; else full = false; if (b != null) lyt += b; else full = false; }
    return { y, mo, rev, mom: pv > 0 ? (rev / pv - 1) * 100 : null, yoy: ly > 0 ? (rev / ly - 1) * 100 : null, ytd, ytdYoy: full && lyt > 0 ? (ytd / lyt - 1) * 100 : null }; }).reverse();
}
function fmQuarters(rows) {
  const by = {}; rows.forEach((o) => { (by[o.date] = by[o.date] || {})[o.type] = +o.value; });
  const pick = (m, ...ks) => { for (const k of ks) if (m[k] != null && !isNaN(m[k])) return m[k]; return null; };
  return Object.keys(by).sort().reverse().map((d) => { const m = by[d]; const rev = pick(m, 'Revenue', 'OperatingRevenue'), gp = pick(m, 'GrossProfit'), op = pick(m, 'OperatingIncome'), ni = pick(m, 'EquityAttributableToOwnersOfParent', 'IncomeAfterTaxes', 'NetIncome');
    const dt = new Date(d); return { label: dt.getFullYear() + 'Q' + (Math.floor(dt.getMonth() / 3) + 1), rev, eps: pick(m, 'EPS'), gm: rev && gp != null ? gp / rev * 100 : null, om: rev && op != null ? op / rev * 100 : null, nm: rev && ni != null ? ni / rev * 100 : null }; })
    .filter((q) => q.rev != null || q.eps != null);
}
function fmBand(vals) {
  const v = vals.filter((x) => x > 0 && isFinite(x)); if (v.length < 20) return null; const s = v.slice().sort((a, b) => a - b); const q = (p) => s[Math.floor((s.length - 1) * p)];
  return { min: s[0], p25: q(0.25), med: q(0.5), p75: q(0.75), max: s[s.length - 1], cur: v[0], pct: s.filter((x) => x < v[0]).length * 100 / s.length };
}
function fmBandHtml(name, b, price, d = 1) {
  const span = b.max - b.min || 1; const x = (v) => ((v - b.min) / span * 100).toFixed(1); const px = (v) => price > 0 ? fmt(price * v / b.cur, price >= 100 ? 0 : 1) : '—';
  const col = b.pct <= 25 ? 'down' : b.pct >= 75 ? 'up' : '';
  return `<div style="margin:10px 0 4px"><div class="row between"><b>${name}</b><span class="num small ${col}">目前 ${fmt(b.cur, d)}　位於 ${b.pct.toFixed(0)}%</span></div>
    <div style="position:relative;height:14px;margin:8px 0"><div style="position:absolute;left:0;right:0;top:5px;height:4px;background:var(--card2);border-radius:2px"></div>
      <div style="position:absolute;left:${x(b.p25)}%;width:${(x(b.p75) - x(b.p25)).toFixed(1)}%;top:0;height:14px;background:var(--primary);opacity:.22;border-radius:3px"></div>
      <div style="position:absolute;left:${x(b.med)}%;top:0;height:14px;width:2px;background:var(--muted)"></div>
      <div style="position:absolute;left:${x(b.cur)}%;top:1px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--primary)"></div></div>
    <div class="scroll-x"><table class="tbl"><thead><tr><th></th><th>低</th><th>25%</th><th>中位</th><th>75%</th><th>高</th></tr></thead><tbody>
      <tr><td class="muted">比值</td>${[b.min, b.p25, b.med, b.p75, b.max].map((v) => `<td class="num">${fmt(v, d)}</td>`).join('')}</tr>
      ${price > 0 ? `<tr><td class="muted">對應股價</td>${[b.min, b.p25, b.med, b.p75, b.max].map((v, i) => `<td class="num ${i < 2 ? 'down' : i > 2 ? 'up' : ''}">${px(v)}</td>`).join('')}</tr>` : ''}</tbody></table></div></div>`;
}

/** 資產負債、現金流（與 App FinMindParse 同算法；現金流量表為累計數，換算單季） */
function fmPick(m, exact, contains = [], not = []) { for (const k of exact) if (m[k] != null) return m[k]; const ks = Object.keys(m).filter((k) => !/_per$/.test(k) && contains.some((c) => k.includes(c)) && !not.some((c) => k.includes(c))).sort((a, b) => a.length - b.length); return ks.length ? m[ks[0]] : null; }
function fmByDate(rows) { const by = {}; rows.forEach((o) => { const v = +o.value; if (!isNaN(v)) (by[o.date] = by[o.date] || {})[o.type] = v; }); return by; }
const fmQl = (d) => { const t = new Date(d); return t.getFullYear() + 'Q' + (Math.floor(t.getMonth() / 3) + 1); };
function fmBalance(rows) { const by = fmByDate(rows); return Object.keys(by).sort().reverse().map((d) => { const m = by[d];
  const ta = fmPick(m, ['TotalAssets'], ['TotalAssets']), tl = fmPick(m, ['Liabilities', 'TotalLiabilities'], ['Liabilities'], ['Current', 'NonCurrent', 'Equity']), ca = fmPick(m, ['CurrentAssets'], ['CurrentAssets'], ['NonCurrent']), cl = fmPick(m, ['CurrentLiabilities'], ['CurrentLiabilities'], ['NonCurrent']);
  return { d, ql: fmQl(d), debt: ta && tl != null ? tl / ta * 100 : null, cur: ca != null && cl ? ca / cl * 100 : null, cash: fmPick(m, ['CashAndCashEquivalents'], ['CashAndCashEquivalents']) }; }).filter((x) => x.debt != null || x.cur != null); }
function fmCashFlow(rows) { const by = fmByDate(rows); const cum = Object.keys(by).sort().map((d) => { const m = by[d];
  return { d, o: fmPick(m, ['CashFlowsFromOperatingActivities', 'NetCashInflowFromOperatingActivities'], ['OperatingActivities']), c: fmPick(m, ['PropertyAndPlantAndEquipment', 'AcquisitionOfPropertyPlantAndEquipment'], ['PropertyPlantAndEquipment', 'PropertyAndPlantAndEquipment'], ['Disposal', 'Proceeds']) }; });
  return cum.map((x, i) => { const mo = new Date(x.d).getMonth() + 1, p = cum[i - 1]; if (mo <= 3) return x; if (!p || new Date(p.d).getFullYear() !== new Date(x.d).getFullYear() || x.o == null || p.o == null) return null;
    return { d: x.d, o: x.o - p.o, c: x.c != null && p.c != null ? x.c - p.c : null }; }).filter((x) => x && x.o != null).map((x) => ({ ...x, ql: fmQl(x.d), f: x.o + (x.c || 0) })).reverse(); }
async function fmFinCards(el, sym, isCur) {
  const price = (S.q[sym] || {}).price || 0;
  const [rv, inc, val, bsr, cfr] = await Promise.allSettled([fmGet('TaiwanStockMonthRevenue', sym, 1500), fmGet('TaiwanStockFinancialStatements', sym, 1280), fmGet('TaiwanStockPER', sym, 1830), fmGet('TaiwanStockBalanceSheet', sym, 900), fmGet('TaiwanStockCashFlowsStatement', sym, 1200)]);
  if (!isCur()) return;
  let h = '';
  if (rv.status === 'rejected') h += fmErr('月營收', rv.reason);
  else { const l = fmMonthRev(rv.value); if (l.length) { const m0 = l[0]; const last24 = l.slice(0, 24).reverse();
    const s0 = Math.sign(m0.yoy || 0); let streak = 0; if (s0) for (const x of l) { if (Math.sign(x.yoy || 0) === s0) streak++; else break; }
    h += `<div class="card"><h2>月營收<span class="r small muted">${m0.y}/${m0.mo}</span></h2>
      <div class="grid g3"><div class="tile"><div class="k">單月營收（億）</div><div class="v num">${fmYi(m0.rev)}</div></div><div class="tile"><div class="k">月增</div><div class="v num ${cls(m0.mom)}">${fmtPct(m0.mom, 1)}</div></div><div class="tile"><div class="k">年增</div><div class="v num ${cls(m0.yoy)}">${fmtPct(m0.yoy, 1)}</div></div></div>
      ${kvRows([['今年累計（億）', fmYi(m0.ytd)], ['累計年增', fmtPct(m0.ytdYoy, 1)], ['連續', streak >= 2 ? (s0 > 0 ? `年增 ${streak} 個月` : `年減 ${streak} 個月`) : null]])}
      <div class="small muted" style="margin-top:8px">近 ${last24.length} 個月營收（顏色＝年增／年減）</div>${fmBars(last24.map((x) => x.rev), (v, i) => fmUpDn(last24[i].yoy || 0))}
      <div class="scroll-x" style="max-height:260px;overflow:auto"><table class="tbl"><thead><tr><th>年月</th><th>營收（億）</th><th>月增</th><th>年增</th><th>累計年增</th></tr></thead><tbody>
        ${l.slice(0, 24).map((x) => `<tr><td class="num">${x.y}/${x.mo}</td><td class="num">${fmYi(x.rev)}</td><td class="num ${cls(x.mom)}">${fmtPct(x.mom, 1)}</td><td class="num ${cls(x.yoy)}">${fmtPct(x.yoy, 1)}</td><td class="num ${cls(x.ytdYoy)}">${fmtPct(x.ytdYoy, 1)}</td></tr>`).join('')}</tbody></table></div>${fmFoot('（每月 10 日前公布上月營收）')}</div>`; } }
  if (inc.status === 'rejected') h += fmErr('季度損益', inc.reason);
  else { const qs = fmQuarters(inc.value); if (qs.length) { const e4 = qs.slice(0, 4).map((q) => q.eps).filter((x) => x != null); const p4 = qs.slice(4, 8).map((q) => q.eps).filter((x) => x != null);
    const ttm = e4.length === 4 ? e4.reduce((a, b) => a + b, 0) : null, pttm = p4.length === 4 ? p4.reduce((a, b) => a + b, 0) : null; const last = qs.slice(0, 12).reverse();
    h += `<div class="card"><h2>季度損益<span class="r small muted">營收單位：億</span></h2>
      ${kvRows([['近四季 EPS', ttm != null ? fmt(ttm, 2) : null], ['前四季 EPS', pttm != null ? fmt(pttm, 2) : null], ['本益比（現價／近四季）', ttm > 0 && price ? fmt(price / ttm, 1) : null], ['最近一季毛利率', qs[0].gm != null ? qs[0].gm.toFixed(1) + '%' : null]])}
      <div class="small muted" style="margin-top:8px">EPS 趨勢（近 ${last.length} 季）</div>${fmBars(last.map((q) => q.eps || 0), (v) => fmUpDn(v))}
      <div class="chart-wrap" id="fmMg" style="margin-top:6px"><canvas></canvas><div class="chart-tip"></div></div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>季度</th><th>營收</th><th>毛利率</th><th>營益率</th><th>淨利率</th><th>EPS</th></tr></thead><tbody>
        ${qs.slice(0, 12).map((q) => `<tr><td class="num">${q.label}</td><td class="num">${q.rev != null ? fmYi(q.rev) : '—'}</td><td class="num">${q.gm != null ? q.gm.toFixed(1) + '%' : '—'}</td><td class="num">${q.om != null ? q.om.toFixed(1) + '%' : '—'}</td><td class="num">${q.nm != null ? q.nm.toFixed(1) + '%' : '—'}</td><td class="num ${cls(q.eps)}">${q.eps != null ? fmt(q.eps, 2) : '—'}</td></tr>`).join('')}</tbody></table></div>${fmFoot('（財報為單季數字）')}</div>`;
    el._fmMg = last; } }
  { const bs = bsr.status === 'fulfilled' ? fmBalance(bsr.value) : [], cf = cfr.status === 'fulfilled' ? fmCashFlow(cfr.value) : [];
    if (bs.length || cf.length) { const b0 = bs[0] || {}; const c4 = cf.slice(0, 4); const ocf = c4.length === 4 ? c4.reduce((a, x) => a + x.o, 0) : null, fcf = c4.length === 4 ? c4.reduce((a, x) => a + x.f, 0) : null;
      const qs = inc.status === 'fulfilled' ? fmQuarters(inc.value) : []; const n4 = qs.slice(0, 4).map((q) => (q.nm != null && q.rev ? q.nm / 100 * q.rev : null)).filter((x) => x != null); const net = n4.length === 4 ? n4.reduce((a, b) => a + b, 0) : null;
      const last = cf.slice(0, 8).reverse(); const qsAll = Array.from(new Set(bs.map((x) => x.d).concat(cf.map((x) => x.d)))).sort().reverse().slice(0, 6);
      h += `<div class="card"><h2>資產負債與現金流<span class="r small muted">金額單位：億</span></h2>
        <div class="grid g3"><div class="tile"><div class="k">負債比率</div><div class="v num ${b0.debt >= 60 ? 'up' : ''}">${b0.debt != null ? b0.debt.toFixed(1) + '%' : '—'}</div></div><div class="tile"><div class="k">流動比率</div><div class="v num ${b0.cur != null && b0.cur < 100 ? 'up' : ''}">${b0.cur != null ? b0.cur.toFixed(0) + '%' : '—'}</div></div><div class="tile"><div class="k">現金</div><div class="v num">${b0.cash != null ? fmYi(b0.cash) : '—'}</div></div></div>
        <div style="margin-top:10px">${kvRows([['近四季營業現金流', ocf != null ? fmYi(ocf) : null], ['近四季自由現金流', fcf != null ? fmYi(fcf) : null], ['營業現金流／淨利', ocf != null && net > 0 ? (ocf / net * 100).toFixed(0) + '%' : null]])}</div>
        ${last.length >= 2 ? `<div class="small muted" style="margin-top:8px">單季自由現金流（近 ${last.length} 季）</div>${fmBars(last.map((x) => x.f), (v) => fmUpDn(v))}` : ''}
        <div class="scroll-x"><table class="tbl"><thead><tr><th>季度</th><th>負債比</th><th>流動比</th><th>營業現金流</th><th>自由現金流</th></tr></thead><tbody>
        ${qsAll.map((d) => { const b = bs.find((x) => x.d === d) || {}, c = cf.find((x) => x.d === d); return `<tr><td class="num">${fmQl(d)}</td><td class="num">${b.debt != null ? b.debt.toFixed(1) + '%' : '—'}</td><td class="num">${b.cur != null ? b.cur.toFixed(0) + '%' : '—'}</td><td class="num ${c ? cls(c.o) : ''}">${c ? fmYi(c.o) : '—'}</td><td class="num ${c ? cls(c.f) : ''}">${c ? fmYi(c.f) : '—'}</td></tr>`; }).join('')}</tbody></table></div>
        <div class="small muted" style="margin-top:6px">自由現金流＝營業現金流＋資本支出；現金流量表由累計數換算為單季。</div>${fmFoot()}</div>`; } }
  if (val.status === 'rejected') h += fmErr('本益比・淨值比區間', val.reason);
  else { const vs = val.value.slice().sort((a, b) => (a.date < b.date ? 1 : -1)); const per = fmBand(vs.map((x) => +x.PER)), pbr = fmBand(vs.map((x) => +x.PBR)), yl = fmBand(vs.map((x) => +x.dividend_yield));
    if (vs.length >= 20) h += `<div class="card"><h2>本益比・淨值比區間<span class="r small muted">近 5 年 · ${esc(vs[0].date)}</span></h2>
      ${per ? fmBandHtml('本益比 PER', per, price) : '<div class="small muted">本益比：近期虧損或資料不足，無法計算區間</div>'}${pbr ? fmBandHtml('股價淨值比 PBR', pbr, price, 2) : ''}
      ${yl ? kvRows([['殖利率（目前）', fmt(yl.cur, 2) + '%'], ['殖利率（5 年中位）', fmt(yl.med, 2) + '%'], ['殖利率（5 年高）', fmt(yl.max, 2) + '%']]) : ''}
      <div class="small muted" style="margin-top:6px">「對應股價」＝現價依比值等比例換算（假設每股盈餘、淨值不變），只是區間參考。百分位越低代表相對過去 5 年越便宜。</div>${fmFoot()}</div>`; }
  el.innerHTML = h;
  if (rv.status === 'fulfilled' && rv.value.length && $('#oldRev')) $('#oldRev').remove();
  if (el._fmMg && $('#fmMg')) { const l = el._fmMg; drawSeries($('#fmMg'), l.map((q) => q.label), [{ v: l.map((q) => q.gm), color: css('--primary'), name: '毛利率' }, { v: l.map((q) => q.om), color: '#f59e0b', name: '營益率' }, { v: l.map((q) => q.nm), color: '#a855f7', name: '淨利率' }], { h: 170, fmt: (x) => x.toFixed(0) + '%', key: 'fmmg' + sym }); }
}
async function fmChipCards(el, sym, isCur) {
  const [ins, mg, fh, px] = await Promise.allSettled([fmGet('TaiwanStockInstitutionalInvestorsBuySell', sym, 110), fmGet('TaiwanStockMarginPurchaseShortSale', sym, 110), fmGet('TaiwanStockShareholding', sym, 200), fmGet('TaiwanStockPrice', sym, 120)]);
  if (!isCur()) return;
  let h = ''; const draws = [];
  if (ins.status === 'rejected') h += fmErr('法人 60 日動向', ins.reason);
  else { const by = {}; ins.value.forEach((o) => { const a = by[o.date] = by[o.date] || [0, 0, 0]; const n = (+o.buy || 0) - (+o.sell || 0); if (/^Foreign/.test(o.name)) a[0] += n; else if (/^Investment_Trust/.test(o.name)) a[1] += n; else if (/^Dealer/.test(o.name)) a[2] += n; });
    const days = Object.keys(by).sort().reverse().slice(0, 60).map((d) => ({ d, f: by[d][0], t: by[d][1], dl: by[d][2] }));
    if (days.length > 1) { const L = (v) => Math.round(v / 1000); const sum = (n, k) => days.slice(0, n).reduce((a, x) => a + (k ? x[k] : x.f + x.t + x.dl), 0);
      const chron = days.slice().reverse(); const cum = (k) => { let s = 0; return chron.map((x) => (s += x[k] / 1000)); };
      h += `<div class="card" style="grid-column:1/-1"><h2>法人近 ${days.length} 日動向（張）<span class="r small muted">FinMind · ${esc(days[0].d)}</span></h2>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>累計</th><th>5 日</th><th>20 日</th><th>${days.length} 日</th></tr></thead><tbody>
          ${[['外資', 'f'], ['投信', 't'], ['自營商', 'dl'], ['合計', '']].map(([n, k]) => `<tr><td>${n}</td>${[5, 20, days.length].map((x) => { const v = L(sum(x, k)); return `<td class="num ${cls(v)}">${fmtSigned(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="chart-wrap" id="fmIn" style="margin-top:8px"><canvas></canvas><div class="chart-tip"></div></div><div class="small muted">累計買賣超走勢：藍＝外資、橘＝投信、灰＝自營商</div></div>`;
      draws.push(() => drawSeries($('#fmIn'), chron.map((x) => x.d.slice(5)), [{ v: cum('f'), color: css('--primary'), name: '外資' }, { v: cum('t'), color: '#f59e0b', name: '投信' }, { v: cum('dl'), color: css('--muted'), name: '自營商' }], { h: 190, zero: true, key: 'fmin' + sym })); } }
  if (mg.status === 'rejected') h += fmErr('融資融券', mg.reason);
  else { const ms = mg.value.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60);
    if (ms.length) { const m0 = ms[0]; const mb = +m0.MarginPurchaseTodayBalance || 0, sb = +m0.ShortSaleTodayBalance || 0; const chg = (n) => ms[n] ? mb - (+ms[n].MarginPurchaseTodayBalance || 0) : null; const chron = ms.slice().reverse();
      h += `<div class="card"><h2>融資融券（張）<span class="r small muted">${esc(m0.date)}</span></h2>
        <div class="grid g3"><div class="tile"><div class="k">融資餘額</div><div class="v num">${fmtInt(mb)}</div><div class="s ${cls(mb - (+m0.MarginPurchaseYesterdayBalance || mb))}">${fmtSigned(mb - (+m0.MarginPurchaseYesterdayBalance || mb))}</div></div>
          <div class="tile"><div class="k">融券餘額</div><div class="v num">${fmtInt(sb)}</div><div class="s ${cls(sb - (+m0.ShortSaleYesterdayBalance || sb))}">${fmtSigned(sb - (+m0.ShortSaleYesterdayBalance || sb))}</div></div>
          <div class="tile"><div class="k">券資比</div><div class="v num">${mb ? (sb / mb * 100).toFixed(2) + '%' : '—'}</div></div></div>
        ${(() => { const lim = +m0.MarginPurchaseLimit || 0; const use = lim > 0 ? mb / lim * 100 : null;
          const closes = px.status === 'fulfilled' ? Object.fromEntries(px.value.map((o) => [o.date, +o.close])) : {}; let w = 0, sum = 0;
          ms.forEach((x) => { const inc = (+x.MarginPurchaseTodayBalance || 0) - (+x.MarginPurchaseYesterdayBalance || 0); if (inc > 0 && closes[x.date]) { w += inc; sum += inc * closes[x.date]; } });
          const cost = w > 0 && w >= mb * 0.01 ? sum / w : null; const cur = (S.q[sym] || {}).price; const pl = cost && cur ? (cur / cost - 1) * 100 : null;
          const pc = (n) => ms[n] && +ms[n].MarginPurchaseTodayBalance ? ' (' + fmtPct(chg(n) / +ms[n].MarginPurchaseTodayBalance * 100, 1) + ')' : '';
          return kvRows([['融資 5 日增減', chg(5) != null ? fmtSigned(chg(5)) + ' 張' + pc(5) : null], ['融資 20 日增減', chg(20) != null ? fmtSigned(chg(20)) + ' 張' + pc(20) : null],
            ['融資使用率', use != null ? use.toFixed(2) + '%' + (use >= 60 ? '（偏高）' : '') : null], ['融資平均成本（估）', cost ? fmtPrice(cost) + (pl != null ? '　融資戶' + (pl >= 0 ? '獲利 ' : '套牢 ') + fmtPct(pl, 1) : '') : null]]); })()}
        <div class="chart-wrap" id="fmMgn" style="margin-top:8px"><canvas></canvas><div class="chart-tip"></div></div><div class="small muted">融資餘額走勢。股價上漲而融資減少，籌碼相對安定。融資平均成本以近 60 日融資增加張數 × 當日收盤價估算，融資戶大幅套牢時常有停損賣壓。</div>${fmFoot()}</div>`;
      draws.push(() => drawSeries($('#fmMgn'), chron.map((x) => x.date.slice(5)), [{ v: chron.map((x) => +x.MarginPurchaseTodayBalance || 0), color: '#ef4444', name: '融資餘額', fill: true }], { h: 160, key: 'fmmgn' + sym })); } }
  if (fh.status === 'fulfilled') { const hs = fh.value.filter((o) => o.ForeignInvestmentSharesRatio != null).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 120);
    if (hs.length > 1) { const r0 = +hs[0].ForeignInvestmentSharesRatio; const dif = (n) => hs[n] ? r0 - +hs[n].ForeignInvestmentSharesRatio : null; const chron = hs.slice().reverse();
      h += `<div class="card"><h2>外資持股比率<span class="r small muted">${esc(hs[0].date)}</span></h2>
        <div class="grid g3"><div class="tile"><div class="k">目前</div><div class="v num">${r0.toFixed(2)}%</div></div><div class="tile"><div class="k">20 日變化</div><div class="v num ${cls(dif(20))}">${fmtPct(dif(20))}</div></div><div class="tile"><div class="k">60 日變化</div><div class="v num ${cls(dif(60))}">${fmtPct(dif(60))}</div></div></div>
        <div class="chart-wrap" id="fmFh" style="margin-top:8px"><canvas></canvas><div class="chart-tip"></div></div>${fmFoot()}</div>`;
      draws.push(() => drawSeries($('#fmFh'), chron.map((x) => x.date.slice(5)), [{ v: chron.map((x) => +x.ForeignInvestmentSharesRatio), color: css('--primary'), name: '外資持股', fill: true }], { h: 150, fmt: (x) => x.toFixed(1) + '%', key: 'fmfh' + sym })); } }
  el.innerHTML = h; el.style.display = 'contents'; draws.forEach((f) => { try { f(); } catch (e) {} });
}
async function fmDivCard(el, sym, isCur) {
  let rows; try { rows = await fmGet('TaiwanStockDividend', sym, 3700); } catch (e) { if (isCur()) el.innerHTML = fmErr('股利政策', e); return; }
  if (!isCur()) return;
  const ds = rows.map((o) => ({ y: o.year || String(o.date || '').slice(0, 4), cash: (+o.CashEarningsDistribution || 0) + (+o.CashStatutorySurplus || 0), stock: (+o.StockEarningsDistribution || 0) + (+o.StockStatutorySurplus || 0), ex: o.CashExDividendTradingDate || o.StockExDividendTradingDate || '', pay: o.CashDividendPaymentDate || '' }))
    .filter((d) => d.cash > 0 || d.stock > 0).sort((a, b) => (a.ex < b.ex ? 1 : a.ex > b.ex ? -1 : 0));
  if (!ds.length) { el.innerHTML = ''; return; }
  const yk = (d) => (String(d.y).match(/\d+/) || [d.y])[0]; const years = {}; ds.forEach((d) => { years[yk(d)] = (years[yk(d)] || 0) + d.cash + d.stock; }); const ys = Object.keys(years).sort().slice(-10);
  el.innerHTML = `<div class="card"><h2>股利政策<span class="r small muted">每股（元）· ${Object.keys(years).length} 個年度有配發</span></h2>
    ${fmBars(ys.map((y) => years[y]), () => css('--primary'))}<div class="row between small muted"><span>${esc(ys[0] || '')}</span><span>${esc(ys[ys.length - 1] || '')}</span></div>
    <div class="scroll-x" style="max-height:300px;overflow:auto;margin-top:6px"><table class="tbl"><thead><tr><th>所屬期間</th><th>現金</th><th>股票</th><th>除息日</th><th>發放日</th></tr></thead><tbody>
      ${ds.slice(0, 40).map((d) => `<tr><td>${esc(d.y)}</td><td class="num">${fmt(d.cash, 4).replace(/\.?0+$/, '')}</td><td class="num">${d.stock ? fmt(d.stock, 4).replace(/\.?0+$/, '') : '—'}</td><td class="num">${esc(d.ex || '—')}</td><td class="num">${esc(d.pay || '—')}</td></tr>`).join('')}</tbody></table></div>${fmFoot('（董事會／股東會決議）')}</div>`;
}

/** 概覽：基本面快照（台股個股） */
async function fmSnap(el, sym, isCur) {
  if (!el || isUs(sym) || etfLike(sym) || !can('STOCKPRO')) return;
  el.innerHTML = '<div class="card"><h2>基本面快照<span class="r small muted">FinMind</span></h2><div class="small muted">讀取中…</div></div>';
  const [rv, inc, val, fh] = await Promise.allSettled([fmGet('TaiwanStockMonthRevenue', sym, 1500), fmGet('TaiwanStockFinancialStatements', sym, 1280), fmGet('TaiwanStockPER', sym, 1830), fmGet('TaiwanStockShareholding', sym, 200)]);
  if (!isCur()) return;
  const m0 = rv.status === 'fulfilled' ? fmMonthRev(rv.value)[0] : null; const qs = inc.status === 'fulfilled' ? fmQuarters(inc.value) : [];
  const e4 = qs.slice(0, 4).map((q) => q.eps).filter((x) => x != null), p4 = qs.slice(4, 8).map((q) => q.eps).filter((x) => x != null);
  const ttm = e4.length === 4 ? e4.reduce((a, b) => a + b, 0) : null, pttm = p4.length === 4 ? p4.reduce((a, b) => a + b, 0) : null;
  const vs = val.status === 'fulfilled' ? val.value.slice().sort((a, b) => (a.date < b.date ? 1 : -1)) : []; const per = fmBand(vs.map((x) => +x.PER));
  const hs = fh.status === 'fulfilled' ? fh.value.filter((o) => o.ForeignInvestmentSharesRatio != null).sort((a, b) => (a.date < b.date ? 1 : -1)) : [];
  const f0 = hs[0] ? +hs[0].ForeignInvestmentSharesRatio : null, f20 = hs[20] && f0 != null ? f0 - +hs[20].ForeignInvestmentSharesRatio : null;
  if (!m0 && ttm == null && !per && f0 == null) { el.innerHTML = ''; return; }
  const tile = (go, k, v, c, sub) => `<div class="tile click" data-fmgo="${go}"><div class="k">${k}</div><div class="v num ${c}">${v}</div><div class="s muted">${sub}</div></div>`;
  el.innerHTML = `<div class="card"><h2>基本面快照<span class="r small muted">FinMind · 點選看完整資料</span></h2><div class="grid g4">
    ${tile('fin', m0 ? m0.mo + ' 月營收年增' : '月營收', m0 ? fmtPct(m0.yoy, 1) : '—', cls(m0 && m0.yoy), m0 ? '累計 ' + fmtPct(m0.ytdYoy, 1) : '')}
    ${tile('fin', '近四季 EPS', ttm != null ? fmt(ttm, 2) : '—', ttm != null && pttm != null ? cls(ttm - pttm) : '', [pttm != null ? '前四季 ' + fmt(pttm, 2) : '', qs[0] && qs[0].gm != null ? '毛利 ' + qs[0].gm.toFixed(1) + '%' : ''].filter(Boolean).join('・'))}
    ${tile('fin', '本益比 5 年位階', per ? per.pct.toFixed(0) + '%' : '—', per ? (per.pct <= 25 ? 'down' : per.pct >= 75 ? 'up' : '') : '', per ? '目前 ' + fmt(per.cur, 1) + '・中位 ' + fmt(per.med, 1) : '虧損或資料不足')}
    ${tile('chip', '外資持股', f0 != null ? f0.toFixed(2) + '%' : '—', cls(f20), f20 != null ? '20 日 ' + fmtPct(f20) : '')}</div></div>`;
  $$('[data-fmgo]', el).forEach((x) => x.onclick = () => { const b = $(`[data-st="${x.dataset.fmgo}"]`); if (b) { b.click(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
}
/** 持股月營收（年增排行） */
async function fmHoldRev(el) {
  const P = portfolio(); const syms = P.rows.filter((r) => !isUs(r.symbol) && !etfLike(r.symbol)).sort((a, b) => b.weight - a.weight).map((r) => r.symbol).slice(0, 20);
  if (!syms.length) { el.innerHTML = '<div class="card empty">目前沒有台股個股持股（ETF 不公布月營收）。</div>'; return; }
  el.innerHTML = `<div class="card"><h2>持股月營收</h2><div class="small muted">讀取 ${syms.length} 檔持股月營收中…</div></div>`;
  const got = []; let err = null;
  for (let i = 0; i < syms.length; i += 4) { const part = await Promise.allSettled(syms.slice(i, i + 4).map((s) => fmGet('TaiwanStockMonthRevenue', s, 1500).then((r) => [s, fmMonthRev(r)[0]])));
    part.forEach((x) => { if (x.status === 'fulfilled' && x.value[1]) got.push(x.value); else if (x.status === 'rejected') err = x.reason; }); }
  if (!el.isConnected) return;
  if (!got.length) { el.innerHTML = `<div class="card"><h2>持股月營收</h2>${sapiErr(err)}</div>`; return; }
  const newest = Math.max(...got.map(([, m]) => m.y * 100 + m.mo)); const up = got.filter(([, m]) => (m.yoy || 0) > 0).length;
  got.sort((a, b) => (b[1].yoy ?? -1e9) - (a[1].yoy ?? -1e9));
  el.innerHTML = `<div class="card"><h2>持股月營收<span class="r small muted">依年增排序 · FinMind</span></h2>
    <div class="small muted" style="margin-bottom:6px">最新 ${Math.floor(newest / 100)}/${newest % 100}：${got.length} 檔中 ${up} 檔年增${got.length < syms.length ? `（${syms.length - got.length} 檔取不到）` : ''}</div>
    <div class="scroll-x"><table class="tbl"><thead><tr><th style="text-align:left">股票</th><th>月份</th><th>營收（億）</th><th>月增</th><th>年增</th><th>累計年增</th></tr></thead><tbody>
    ${got.map(([s, m]) => `<tr class="click" data-go="#/s/${encodeURIComponent(s)}"><td class="nm" style="text-align:left">${esc(D.name(s))} <span class="muted small num">${esc(s)}</span></td><td class="num ${m.y * 100 + m.mo < newest ? 'muted' : ''}">${m.y % 100}/${m.mo}</td><td class="num">${fmYi(m.rev)}</td><td class="num ${cls(m.mom)}">${fmtPct(m.mom, 1)}</td><td class="num ${cls(m.yoy)}"><b>${fmtPct(m.yoy, 1)}</b></td><td class="num ${cls(m.ytdYoy)}">${fmtPct(m.ytdYoy, 1)}</td></tr>`).join('')}</tbody></table></div>
    <div class="small muted" style="margin-top:6px">月份灰色＝尚未公布最新月份。每月 10 日前公布上月營收。</div></div>`;
  $$('[data-go]', el).forEach((x) => x.onclick = () => { location.hash = x.dataset.go; });
}
const STABS = [['ov', '概覽'], ['ta', '技術分析'], ['chip', '籌碼'], ['fin', '財務'], ['hold', '成分'], ['div', '股息'], ['news', '新聞'], ['talk', '討論'], ['co', '公司']];
/** 個股分頁列：依「分頁列排版」設定排序與隱藏（S.pref.stabL＝{o:順序, h:隱藏, def:預設分頁, pos:'top'|'bottom'}） */
function stockTabs(sym, all) {
  const q = S.q[sym] || {}; const etf = (!isUs(sym) && /^00/.test(sym)) || D.isEtf(sym) || q.type === 'ETF';
  const base = STABS.filter(([k]) => k !== 'hold' || etf);
  const L = S.pref.stabL || {}; const ord = L.o || [];
  const sorted = base.map((t, i) => [t, ord.indexOf(t[0]) >= 0 ? ord.indexOf(t[0]) : 100 + i]).sort((a, b) => a[1] - b[1]).map(([t]) => t);
  if (all) return sorted;
  const vis = sorted.filter(([k]) => !(L.h || []).includes(k));
  return vis.length ? vis : sorted;
}
function stabBar(view) {
  const full = (S.pref.stabL || {}).w === 'full';
  return `<div class="seg${full ? ' full' : ''}" id="stab" style="margin-top:12px;flex-wrap:wrap${full ? ';display:flex;width:100%' : ''}">${stockTabs(view.sym).map(([k, n]) => `<button data-st="${k}" class="${view.tab() === k ? 'on' : ''}">${n}</button>`).join('')}<button id="stabE" title="分頁列排版：順序、顯示、預設分頁、位置">⚙</button></div>`;
}
/** 分頁列排版設定 */
function stabEditor() {
  const L0 = S.pref.stabL || {};
  let L = { o: L0.o || [], h: L0.h || [], def: L0.def || 'last', pos: L0.pos || 'bottom', w: L0.w || '' };
  const draw = (box) => {
    const list = STABS.map((t, i) => [t, L.o.indexOf(t[0]) >= 0 ? L.o.indexOf(t[0]) : 100 + i]).sort((a, b) => a[1] - b[1]).map(([t]) => t);
    box.innerHTML = `<div class="small muted" style="margin-bottom:8px">個股頁的分頁列：勾選要顯示的分頁、按住 ≡ 拖曳（或用 ↑↓）調整順序（「成分」只在 ETF 顯示）。設定存在這個瀏覽器。</div>
      <div class="row wrap" style="margin-bottom:8px"><span class="small">分頁列位置</span><div class="seg">${[['top', '圖表上方'], ['bottom', '圖表下方']].map(([v, n]) => `<button data-sp="${v}" class="${L.pos === v ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <div class="row wrap" style="margin-bottom:8px"><span class="small">分頁列寬度</span><div class="seg">${[['', '依文字'], ['full', '等寬整列']].map(([v, n]) => `<button data-sw="${v}" class="${(L.w || '') === v ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <div class="row wrap" style="margin-bottom:10px"><span class="small">開啟個股時顯示</span><select id="sdef" style="width:auto"><option value="last" ${L.def === 'last' ? 'selected' : ''}>上次看的分頁</option>${list.map(([k, n]) => `<option value="${k}" ${L.def === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="list">${list.map(([k, n], i) => `<div class="it" style="cursor:default;padding:6px 2px;gap:6px"><input type="checkbox" data-sh="${k}" ${L.h.includes(k) ? '' : 'checked'} style="width:auto"><div class="l"><div class="t1">${n}</div></div>
        <button class="btn sm" data-sm="${i}:-1" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-sm="${i}:1" ${i < list.length - 1 ? '' : 'disabled'}>↓</button><span class="draghd" data-drag title="按住拖曳">≡</span></div>`).join('')}</div>`;
    const save = () => { S.pref.stabL = { ...L }; savePref(); draw(box); };
    $$('[data-sp]', box).forEach((b) => b.onclick = () => { L.pos = b.dataset.sp; save(); });
    $$('[data-sw]', box).forEach((b) => b.onclick = () => { L.w = b.dataset.sw; save(); });
    $('#sdef', box).onchange = (e) => { L.def = e.target.value; save(); };
    $$('[data-sh]', box).forEach((x) => x.onchange = () => { const h = new Set(L.h); if (x.checked) h.delete(x.dataset.sh); else h.add(x.dataset.sh); if (h.size >= STABS.length) { toast('至少要顯示一個分頁'); x.checked = true; return; } L.h = Array.from(h); save(); });
    $$('[data-sm]', box).forEach((b) => b.onclick = () => { const o = list.map(([k]) => k); const [i, d] = b.dataset.sm.split(':').map(Number); [o[i], o[i + d]] = [o[i + d], o[i]]; L.o = o; save(); });
    dragList($('.list', box), (from, to) => { const o = list.map(([k]) => k); const [m] = o.splice(from, 1); o.splice(to, 0, m); L.o = o; save(); });
  };
  dialog('個股分頁列排版', '<div id="stEd"></div>', [['reset', '恢復預設'], ['', '完成', 'primary']], (box) => draw($('#stEd', box))).then((v) => {
    if (v === 'reset') { delete S.pref.stabL; savePref(); }
    if (S.route === 's') route();
  });
}
// 稅務類別（與 App TaxKind 相同代碼，存於同步鍵 taxKinds／taxRatios）
const TAX_KINDS = { TW_STOCK: ['台股一般股票', 1, '現金股利為股利所得：計入綜所稅（可選 8.5% 抵減或 28% 分開計稅）；單次 ≥ 2 萬元扣二代健保 2.11%。'],
  TW_ETF_EQUITY: ['國內股票型 ETF', 1, '配息可能含股利所得、收益平準金、資本利得；只有股利所得部分計稅並計算二代健保。請依投信公告的配息組成調整應稅比例。'],
  TW_ETF_OPTION: ['權利金收益型 ETF', 0, '配息以選擇權權利金為主，屬證券期貨交易所得，目前停徵所得稅且不扣二代健保。'],
  TW_ETF_BOND: ['債券型 ETF', 0, '配息多為海外債券利息（海外所得），不計綜所稅、不扣二代健保，改適用個人最低稅負制。'],
  TW_ETF_OVERSEAS: ['海外股票型 ETF', 0, '配息屬海外所得，不計綜所稅、不扣二代健保，改適用個人最低稅負制。'],
  US: ['美股／美國 ETF', 1, '非美國稅務居民配息預扣 30% 所得稅，實收為 70%；不扣二代健保。'] };
function taxDetect(sym) {
  if (isUs(sym)) return 'US'; if (sym === '00406A') return 'TW_ETF_OPTION';
  if (!(/^00/.test(sym) || D.isEtf(sym))) return 'TW_STOCK'; const n = D.name(sym);
  if (/B$/.test(sym) || n.includes('債')) return 'TW_ETF_BOND';
  if (/掩護|選擇權|Covered|買權/i.test(n)) return 'TW_ETF_OPTION';
  if (/美國|美股|標普|S&P|NASDAQ|那斯達克|費城|道瓊|全球|國際|海外|日本|日經|東證|中國|滬深|上証|上證|恒生|香港|印度|越南|歐洲|德國|韓國|新興|亞洲|美元/i.test(n)) return 'TW_ETF_OVERSEAS';
  return 'TW_ETF_EQUITY';
}
function taxKindOf(sym) { const o = kjson('taxKinds', {}); return o[sym] && TAX_KINDS[o[sym]] ? o[sym] : taxDetect(sym); }
function taxRatioOf(sym) { const o = kjson('taxRatios', {}); return o[sym] != null ? +o[sym] : TAX_KINDS[taxKindOf(sym)][1]; }

Object.assign(VIEWS.s, {
  tab() {
    const tabs = stockTabs(this.sym); const L = S.pref.stabL || {};
    const t = this._tab || (L.def && L.def !== 'last' ? L.def : S.pref.stab) || tabs[0][0];
    return tabs.some(([k]) => k === t) ? t : tabs[0][0];
  },
  /** 標題下方：ETF 標籤、配息方式、即將除息 */
  async tags() {
    const sym = this.sym; const el = $('#stags'); if (!el) return;
    const [plans, list] = await Promise.all([kv('sx:plans'), divHist(sym)]); if (this.sym !== sym || !$('#stags')) return;
    const t = []; const etf = /^00/.test(sym) || D.isEtf(sym);
    if (etf && !isUs(sym)) { t.push([etfCat(sym, D.name(sym)), 'var(--primary)']); t.push([/A$/.test(sym) || D.name(sym).startsWith('主動') ? '主動式' : '被動式', /A$/.test(sym) ? '#f59e0b' : 'var(--text2)']); }
    { const pp = plans && plans[sym]; const [f] = divFreq(list, sym, pp && pp.ex); if (list.length || f !== '無配息資料') t.push([f, '#a855f7']); }
    t.push([TAX_KINDS[taxKindOf(sym)][0], 'var(--text2)']);
    const p = plans && plans[sym]; const today = ymd();
    el.innerHTML = t.filter(([x], i) => t.findIndex(([y]) => y === x) === i).map(([x, c]) => `<span class="tag" style="color:${c};border-color:${c}">${esc(x)}</span>`).join(' ') +
      (can('KLINE') ? ` <span class="tag" id="advTag" style="color:var(--muted);border-color:var(--line)">進場評估 計算中…</span>` : '') +
      (p && p.ex >= today ? ` <span class="tag" style="color:#f59e0b;border-color:#f59e0b">除息 ${esc(p.ex.slice(5))}${p.lb ? '・最後買進 ' + esc(p.lb.slice(5)) : ''}${p.cash ? '・' + fmt(p.cash, 4) + ' 元' : ''}${p.pay ? '・發放 ' + esc(p.pay.slice(5)) : ''}</span>` : '');
    if (can('KLINE')) entryAdviceCached(sym).then((a) => { if (this.sym === sym) setAdvTag(sym, a); }).catch(() => setAdvTag(sym, null));
  },
  /** 五檔 */
  book() {
    const el = $('#book'); if (!el) return; const q = S.q[this.sym] || {}; const b = q.book;
    if (!b || !(b.b.length || b.a.length)) { el.innerHTML = ''; return; }
    const mx = Math.max(1, ...b.g, ...b.f); const tb = b.g.reduce((a, v) => a + v, 0), ta = b.f.reduce((a, v) => a + v, 0);
    const row = (p, v, side) => `<div class="row" style="gap:6px;height:24px"><span class="num ${cls(p - (q.prev || p))}" style="width:70px;text-align:${side === 'b' ? 'left' : 'right'}">${fmtPrice(p)}</span>
      <div class="sp" style="position:relative;height:16px"><div style="position:absolute;${side === 'b' ? 'right' : 'left'}:0;top:0;bottom:0;width:${(v / mx * 100).toFixed(1)}%;background:${side === 'b' ? 'color-mix(in srgb, var(--up) 30%, transparent)' : 'color-mix(in srgb, var(--down) 30%, transparent)'};border-radius:3px"></div></div>
      <span class="num small" style="width:56px;text-align:right">${fmtInt(v)}</span></div>`;
    el.innerHTML = `<div class="card"><h2>最佳五檔<span class="r small muted">${q.time ? hm(q.time) : ''}</span></h2>
      <div class="grid g2" style="gap:14px"><div><div class="small muted" style="margin-bottom:4px">委買</div>${b.b.map((p, i) => row(p, b.g[i] || 0, 'b')).join('')}</div>
      <div><div class="small muted" style="margin-bottom:4px">委賣</div>${b.a.map((p, i) => row(p, b.f[i] || 0, 'a')).join('')}</div></div>
      <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;margin-top:10px"><div style="flex:${tb || 1};background:var(--up)"></div><div style="flex:${ta || 1};background:var(--down)"></div></div>
      <div class="row between small muted" style="margin-top:4px"><span>委買 ${fmtInt(tb)} 張（${tb + ta ? (tb / (tb + ta) * 100).toFixed(0) : 0}%）</span><span>委賣 ${fmtInt(ta)} 張</span></div></div>`;
  },
  /** 關鍵數據、報酬、回撤 */
  async stats() {
    const sym = this.sym; const el = $('#kst'); if (!el) return; const us = isUs(sym);
    const k5 = sym + '5y'; const d5 = barCache[k5] || (barCache[k5] = await loadBars(sym, '5y'));
    const km = 'm' + sym; const m = barCache[km] || (barCache[km] = await fetchYahoo(ysym(sym), '10y', '1mo', 86400));
    const val = us ? null : await kv('sx:val'); if (this.sym !== sym || !$('#kst')) return;
    if (!d5 || d5.length < 20) { el.innerHTML = ''; return; }
    const q = S.q[sym] || {}; const px0 = q.price || d5[d5.length - 1].c; const c = d5.map((x) => x.c);
    const back = (days) => (c.length > days ? c[c.length - 1 - days] : null);
    const ret = (p) => (p ? (px0 / p - 1) * 100 : null);
    const y0 = String(tpeNow().getFullYear()); const ytdBase = (() => { for (let i = d5.length - 1; i >= 0; i--) if (!d5[i].d.startsWith(y0)) return d5[i].c; return null; })();
    const y1 = d5.slice(-250); const h52 = Math.max(...y1.map((x) => x.h)), l52 = Math.min(...y1.map((x) => x.l));
    const v20 = d5.slice(-20).reduce((a, x) => a + (x.v || 0), 0) / 20;
    let peak = -Infinity, mdd = 0, mddD = '', pk = ''; d5.forEach((x) => { if (x.c > peak) { peak = x.c; pk = x.d; } const dd = (x.c / peak - 1) * 100; if (dd < mdd) { mdd = dd; mddD = x.d; } });
    const curDD = (px0 / Math.max(...c) - 1) * 100;
    const vv = val && val[sym];
    const periods = [['1 個月', ret(back(21))], ['3 個月', ret(back(63))], ['6 個月', ret(back(126))], ['今年', ret(ytdBase)], ['1 年', ret(back(250))], ['3 年', ret(back(750))], ['5 年', ret(back(1240))]];
    let yearly = [];
    if (m && m.timestamp) { const mc = m.indicators.quote[0].close; const byY = {}; m.timestamp.forEach((t, i) => { if (mc[i] == null) return; const y = String(new Date((t + 8 * 3600) * 1000).getUTCFullYear()); byY[y] = byY[y] || [null, null]; if (byY[y][0] == null) byY[y][0] = i > 0 && mc[i - 1] != null ? mc[i - 1] : mc[i]; byY[y][1] = mc[i]; });
      yearly = Object.keys(byY).sort().slice(-10).map((y) => [y, (byY[y][1] / byY[y][0] - 1) * 100]); }
    const ymx = Math.max(1, ...yearly.map(([, v]) => Math.abs(v)));
    el.innerHTML = `<div class="card"><h2>關鍵數據</h2>${kvRows([
        ['52 週最高', fmtPrice(h52)], ['52 週最低', fmtPrice(l52)], ['距 52 週高', fmtPct((px0 / h52 - 1) * 100)],
        ['20 日均量', us ? fmtVol(v20) : fmtInt(v20) + ' 張'], ['本益比', vv && vv[0] ? fmt(vv[0], 2) : null], ['殖利率', vv && vv[1] ? fmt(vv[1], 2) + '%' : null], ['淨值比', vv && vv[2] ? fmt(vv[2], 2) : null],
        ['距歷史（5 年）高點', fmtPct(curDD)], ['5 年最大回撤', fmtPct(mdd) + (mddD ? '（' + mddD.slice(0, 7) + '）' : '')]])}</div>
      <div class="card"><h2>報酬表現</h2><div class="grid g4" style="gap:8px">${periods.map(([k, v]) => `<div><div class="small muted">${k}</div><div class="num ${cls(v)}">${v == null ? '—' : fmtPct(v)}</div></div>`).join('')}</div>
        ${yearly.length ? `<div class="small muted" style="margin:12px 0 4px">歷年報酬（未含息）</div>${yearly.map(([y, v]) => `<div class="row" style="gap:8px;height:22px"><span class="num small" style="width:40px">${y}</span><div class="sp" style="position:relative;height:12px"><div style="position:absolute;top:0;bottom:0;${v >= 0 ? 'left:50%' : 'right:50%'};width:${(Math.abs(v) / ymx * 50).toFixed(1)}%;background:${css(v >= 0 ? '--up' : '--down')};border-radius:2px"></div><div style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--border)"></div></div><span class="num small ${cls(v)}" style="width:62px;text-align:right">${fmtPct(v, 1)}</span></div>`).join('')}` : ''}
        <div class="small muted" style="margin-top:6px">以收盤價計算，未含股息；${q.price ? '以目前價格為終點。' : ''}</div></div>`;
  },
  /** 相似股票（Yahoo 依瀏覽行為推薦） */
  async peers() {
    const sym = this.sym; const el = $('#peers'); if (!el) return;
    let list = [];
    try { const j = await px('https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/' + encodeURIComponent(ysym(sym)), 86400);
      list = ((((j.finance || {}).result || [])[0] || {}).recommendedSymbols || []).map((x) => x.symbol.replace(/\.TWO?$/, '')).filter((x) => x !== sym).slice(0, 8); } catch (e) {}
    if (!list.length) { el.innerHTML = ''; return; }
    await refreshQuotes(list); await loadDir(); if (this.sym !== sym || !$('#peers')) return;
    el.innerHTML = `<div class="card"><h2>相似股票</h2><div class="list">${list.map((s) => { const q = S.q[s] || {}; const p = q.price && q.prev ? (q.price / q.prev - 1) * 100 : null;
      return `<div class="it" data-go="#/s/${encodeURIComponent(s)}"><div class="l"><div class="t1">${esc(D.name(s))} <span class="muted small num">${esc(s)}</span></div></div><div class="r"><div class="num ${cls(p)}">${fmtPrice(q.price)}</div><div class="num small ${cls(p)}">${p == null ? '' : fmtPct(p)}</div></div></div>`; }).join('')}</div>
      <div class="small muted" style="margin-top:6px">依 Yahoo Finance 使用者瀏覽關聯推薦，非同業分類。</div></div>`;
  },
  // ── 籌碼 ──
  /** 技術分析：K 線形態（日／週）、K 棒策略訊號、波動、投資分析指數（與 App 同規則） */
  async t_ta() {
    const sym = this.sym; const si = $('#si'); si.innerHTML = '<div class="card empty" style="grid-column:1/-1">分析中…</div>';
    if (!can('KLINE')) { si.innerHTML = lockCard('KLINE'); return; }
    const etf = D.isEtf(sym) || (!isUs(sym) && /^00/.test(sym)) || (S.q[sym] || {}).type === 'ETF';
    const b = await liveBars(sym, '2y'); if (this.sym !== sym || this.tab() !== 'ta') return;
    if (b.length < 60) { si.innerHTML = '<div class="card empty" style="grid-column:1/-1">歷史資料不足，無法分析</div>'; return; }
    this._sm = { sym }; si.innerHTML = '<div class="card rx" id="sumC" data-lay="top" style="grid-column:1/-1">' + sumHtml(this._sm) + '</div><div class="card" id="rgC" style="grid-column:1/-1"><h2>三環條件（週 K → 日 K → 即時）</h2><div class="small muted">計算中…</div></div><div class="card" id="kaC" style="grid-column:1/-1"></div><div class="card" id="voC" style="grid-column:1/-1"></div><div class="card" id="iaC" style="grid-column:1/-1"><h2>投資分析指數</h2><div class="small muted">計算中…</div></div>';
    const tickOf = (p) => (isUs(sym) ? 0.01 : twTick(p, etf));
    const sigs = kbarSignals(b, etf, tickOf);
    const drawKa = async (weekly) => {
      const cs = weekly ? weeklyBars(await liveBars(sym, '5y')) : b; if (this.sym !== sym || !$('#kaC')) return;
      const r = klineAnalyze(cs); const el = $('#kaC');
      if (!r) { el.innerHTML = '<h2>K 線形態分析</h2><div class="small muted">資料不足</div>'; return; }
      // 與 App 相同：K 棒策略訊號＋經典型態修正進場評估
      r.etf = etf; r.sigs = weekly ? kbarSignals(cs, etf, tickOf) : sigs;
      try { r.pats = chartPatterns(cs, tickOf); } catch (e) { r.pats = []; }
      r.entry = withPatterns(r, refineEntry(r, r.sigs, etf), r.pats);
      r.reasons = r.reasons.concat(r.pats.slice(0, 2).map((p) => '經典型態：' + p.name + '（' + CP_ST[p.state] + '，盈虧比 1:' + p.rr.toFixed(2) + '）'));
      const held = holdings().some((h) => h.symbol === sym && h.shares > 0);
      const render = () => {
        if (!$('#kaC')) return;
        const all = kaOverlays(r, tickOf); const ov = kaFocus(sym, r, all);
        el.innerHTML = kaCardHtml(r, weekly, sym, { ov, all, held });
        $$('[data-tf]', el).forEach((x) => x.onclick = () => { this._kaW = x.dataset.tf === 'w'; drawKa(this._kaW); });
        const setF = (id) => { S.kaFocus = S.kaFocus || {}; if (id == null) delete S.kaFocus[sym]; else S.kaFocus[sym] = id; render(); };
        $$('[data-ovpick]', el).forEach((x) => x.onclick = (e) => { if (e.target.closest('a,button,select')) return; setF(x.dataset.ovpick); });
        $$('[data-ovoff]', el).forEach((x) => x.onclick = () => setF('off'));
        $$('[data-ovon]', el).forEach((x) => x.onclick = () => setF(null));
        const sel = $('[data-ovsel]', el); if (sel) sel.onchange = () => setF(sel.value);
        const n = cs.length, N = Math.min(n, 160), sov = ovShift(ov, n - N);
        const count = sov ? Math.min(N, Math.max(60, N - Math.max(0, sov.minIdx - 3))) : 60;
        drawChart($('#kaChart'), cs.slice(-N), { key: 'ka' + sym + (weekly ? 'w' : 'd') + (ov ? ov.id : ''), count, pats: !ov, mas: [20, 60], H: ov ? 340 : 300, overlay: sov });
      };
      render();
    };
    drawKa(!!this._kaW);
    this.rings(sym, b, etf);
    const v = volaOf(b); const kr = klineAnalyze(b);
    this.sumSet(sym, { ka: kr ? { dir: kr.dir, str: kr.strength, n: sigs.length, sup: kr.x.support, res: kr.x.resistance } : 0, vo: v || 0 });
    if (v) { $('#voC').innerHTML = voCardHtml(v, kr && kr.plan); drawSeries($('#voChart'), v.series.map((x) => x[0]), [{ v: v.series.map((x) => x[1]), color: '#f59e0b', name: '年化波動', fill: true }], { h: 180, fmt: (x) => x.toFixed(0) + '%', key: 'vo' + sym }); }
    else $('#voC').innerHTML = '<h2>波動</h2><div class="small muted">資料不足</div>';
    try { const a = await investAnalysis(sym, b); if (this.sym !== sym || this.tab() !== 'ta') return; $('#iaC').innerHTML = a ? iaCardHtml(a) : '<h2>投資分析指數</h2><div class="small muted">資料不足</div>'; this.sumSet(sym, { ia: a || 0 }); }
    catch (e) { if ($('#iaC')) $('#iaC').innerHTML = '<h2>投資分析指數</h2>' + sapiErr(e); this.sumSet(sym, { ia: 0 }); }
  },
  /** 分析總結方框：各單項結果各自一格、依結果變色（分歧效果）；點方框捲到該項卡片 */
  sumSet(sym, o) {
    const E = $('#sumC'); if (!E || this.sym !== sym || !this._sm || this._sm.sym !== sym) return;
    Object.assign(this._sm, o); E.innerHTML = sumHtml(this._sm);
    $$('[data-smgo]', E).forEach((x) => x.onclick = () => { const t = $('#' + x.dataset.smgo); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $$('[data-smg]', E).forEach((x) => x.onclick = async () => { if (await sumSettings()) this.sumSet(sym, {}); });
  },
  /** 三環條件卡（與 App K 線分頁 TargetRingsCard 相同判定；停損模式 S.pref.ringMode：0 波段（日 K）／1 存股（週 K）） */
  async rings(sym, b, etf) {
    const el = () => $('#rgC'); const mode = S.pref.ringMode === 1 ? 1 : 0;
    let st = null;
    try { const w = weeklyBars(await liveBars(sym, '5y')); if (this.sym !== sym || !el()) return;
      const d = klineAnalyze(b), wk = w.length >= 60 ? klineAnalyze(w) : null; const q = S.q[sym] || {}; const price = q.price || b[b.length - 1].c; const us = isUs(sym);
      if (d && wk) st = ringsEval(ringsInput(price, d, wk), mode, us ? (v) => Math.round(v * 100) / 100 : (v) => twSnap(v, etf), us ? 0.01 : twTick(price, etf), ringRule()); } catch (e) {}
    if (!el()) return;
    this.sumSet(sym, { rg: st || 0 });
    const E = el(); E.classList.add('rx'); E.innerHTML = ringsCardHtml(st, mode);
    if (st && $('#rxFx', E)) rxRun($('#rxFx', E), rxData(st), S.pref.ringSty == null ? 3 : +S.pref.ringSty, S.pref.ringAnim !== false);
    $$('[data-rgm]', E).forEach((x) => x.onclick = () => { S.pref.ringMode = +x.dataset.rgm; savePref(); this.rings(sym, b, etf); });
    $$('[data-rxs]', E).forEach((x) => x.onclick = () => { S.pref.ringSty = +x.dataset.rxs; savePref(); const sl = $('.rxs', E).scrollLeft; this.rings(sym, b, etf).then(() => { const r2 = $('.rxs', el()); if (r2) r2.scrollLeft = sl; }); });
    $$('[data-rxa]', E).forEach((x) => x.onclick = () => { S.pref.ringAnim = S.pref.ringAnim === false; savePref(); this.rings(sym, b, etf); });
    $$('[data-rxg]', E).forEach((x) => x.onclick = async () => { if (await ringSettings()) this.rings(sym, b, etf); else if (st && $('#rxFx', el())) rxRun($('#rxFx', el()), rxData(st), S.pref.ringSty == null ? 3 : +S.pref.ringSty, S.pref.ringAnim !== false); });
  },
  async t_chip() {
    const sym = this.sym; const us = isUs(sym); const si = $('#si'); si.innerHTML = '<div class="card empty" style="grid-column:1/-1">讀取中…</div>';
    if (!can('STOCKPRO')) { si.innerHTML = lockCard('STOCKPRO', '籌碼（個股進階資料）'); return; }
    if (us) {
      let h;
      try { const r = await ys(sym, 'majorHoldersBreakdown,institutionOwnership,fundOwnership,netSharePurchaseActivity');
        const mb = r.majorHoldersBreakdown || {}; const io = ((r.institutionOwnership || {}).ownershipList || []).slice(0, 10); const fo = ((r.fundOwnership || {}).ownershipList || []).slice(0, 10); const ns = r.netSharePurchaseActivity || {};
        const tbl = (l) => l.length ? `<table class="tbl"><thead><tr><th>機構</th><th>持股比例</th><th>持股</th><th>變動</th></tr></thead><tbody>${l.map((o) => `<tr><td>${esc(o.organization || '')}</td><td class="num">${esc(yf(o, 'pctHeld') || '—')}</td><td class="num">${esc(yf(o, 'position') || '—')}</td><td class="num ${cls(yr(o, 'pctChange'))}">${esc(yf(o, 'pctChange') || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="small muted">無資料</div>';
        h = `<div class="card"><h2>持股結構</h2>${kvRows([['機構持股比例', yf(mb, 'institutionsPercentHeld')], ['內部人持股比例', yf(mb, 'insidersPercentHeld')], ['機構占流通股', yf(mb, 'institutionsFloatPercentHeld')], ['持股機構數', yf(mb, 'institutionsCount')]])}
            ${ns.period ? `<div class="small muted" style="margin:12px 0 4px">內部人近 ${esc(ns.period)} 買賣</div>${kvRows([['買進', yf(ns, 'buyInfoShares')], ['賣出', yf(ns, 'sellInfoShares')], ['淨買賣', yf(ns, 'netInfoShares')], ['占內部人持股', yf(ns, 'netPercentInsiderShares')]])}` : ''}</div>
          <div class="card"><h2>前十大機構</h2><div class="scroll-x">${tbl(io)}</div></div>${fo.length ? `<div class="card" style="grid-column:1/-1"><h2>前十大基金</h2><div class="scroll-x">${tbl(fo)}</div></div>` : ''}`;
      } catch (e) { h = `<div class="card"><h2>持股結構</h2>${sapiErr(e)}</div>`; }
      if (this.sym === sym && this.tab() === 'chip') si.innerHTML = h; return;
    }
    const chipAll = await kv('sx:chip'); const c = chipAll && chipAll[sym];
    let days = null, err = null; try { days = (await sapi('chip', sym, '&n=20')).days; } catch (e) { err = e; }
    if (this.sym !== sym || this.tab() !== 'chip') return;
    let h = '';
    if (days && days.length) {
      const L = (v) => Math.round(v / 1000); const sum = (n, k) => days.slice(0, n).reduce((a, d) => a + d[k], 0);
      const streak = (k) => { let n = 0; const s0 = Math.sign(days[0][k]); if (!s0) return 0; for (const d of days) { if (Math.sign(d[k]) === s0) n++; else break; } return n * s0; };
      const st = (k) => { const n = streak(k); return n > 0 ? `<span class="up">連買 ${n} 日</span>` : n < 0 ? `<span class="down">連賣 ${-n} 日</span>` : '—'; };
      const mx = Math.max(1, ...days.flatMap((d) => [Math.abs(d.f), Math.abs(d.t), Math.abs(d.dl)]));
      const bar = (v) => `<div style="position:relative;height:10px;width:100%"><div style="position:absolute;top:0;bottom:0;${v >= 0 ? 'left:50%' : 'right:50%'};width:${(Math.abs(v) / mx * 50).toFixed(1)}%;background:${css(v >= 0 ? '--up' : '--down')};border-radius:2px"></div></div>`;
      h += `<div class="card" style="grid-column:1/-1"><h2>三大法人買賣超（張）<span class="r small muted">證交所 · ${esc(days[0].d.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3'))}</span></h2>
        <div class="grid g3">${[['外資', 'f'], ['投信', 't'], ['自營商', 'dl']].map(([n, k]) => `<div class="tile"><div class="k">${n}</div><div class="v num ${cls(days[0][k])}">${fmtSigned(L(days[0][k]))}</div>
          <div class="s">近 5 日 <span class="num ${cls(sum(5, k))}">${fmtSigned(L(sum(5, k)))}</span>　近 ${days.length} 日 <span class="num ${cls(sum(days.length, k))}">${fmtSigned(L(sum(days.length, k)))}</span></div><div class="s">${st(k)}</div></div>`).join('')}</div>
        <div class="scroll-x" style="margin-top:12px"><table class="tbl"><thead><tr><th>日期</th><th>外資</th><th style="width:16%"></th><th>投信</th><th style="width:16%"></th><th>自營商</th><th style="width:16%"></th><th>合計</th></tr></thead><tbody>
          ${days.map((d) => `<tr><td class="num">${d.d.slice(4, 6)}/${d.d.slice(6)}</td><td class="num ${cls(d.f)}">${fmtSigned(L(d.f))}</td><td>${bar(d.f)}</td><td class="num ${cls(d.t)}">${fmtSigned(L(d.t))}</td><td>${bar(d.t)}</td><td class="num ${cls(d.dl)}">${fmtSigned(L(d.dl))}</td><td>${bar(d.dl)}</td><td class="num ${cls(d.f + d.t + d.dl)}">${fmtSigned(L(d.f + d.t + d.dl))}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if (err) h += `<div class="card" style="grid-column:1/-1"><h2>三大法人近 20 日</h2>${sapiErr(err)}</div>`;
    else if (days) h += `<div class="card" style="grid-column:1/-1"><h2>三大法人近 20 日</h2><div class="small muted">上櫃證券的多日資料請見下方「法人動向」（FinMind）。</div></div>`;
    h += `<div class="card"><h2>最新一日${c && c[0] ? `<span class="r muted">${esc(c[0])}</span>` : ''}</h2>${c ? `<div class="grid g3">${[['外資', c[1]], ['投信', c[2]], ['自營商', c[3]]].map(([k, v]) => `<div><div class="small muted">${k}</div><div class="num big ${cls(v)}">${v == null ? '—' : fmtSigned(v) + ' 張'}</div></div>`).join('')}</div>` : '<div class="small muted">尚無資料</div>'}</div>
      <div class="card"><h2>信用交易</h2>${c ? `<div class="grid g3"><div><div class="small muted">融資餘額</div><div class="num">${fmtInt(c[4])} 張</div><div class="small ${cls((c[4] || 0) - (c[5] || 0))}">${fmtSigned((c[4] || 0) - (c[5] || 0))}</div></div>
        <div><div class="small muted">融券餘額</div><div class="num">${fmtInt(c[6])} 張</div><div class="small ${cls((c[6] || 0) - (c[7] || 0))}">${fmtSigned((c[6] || 0) - (c[7] || 0))}</div></div>
        <div><div class="small muted">券資比</div><div class="num">${c[4] ? ((c[6] || 0) / c[4] * 100).toFixed(2) + '%' : '—'}</div></div>
        <div><div class="small muted">當沖量</div><div class="num">${c[8] != null ? fmtInt(c[8]) + ' 張' : '—'}</div></div></div>` : '<div class="small muted">尚無資料</div>'}</div>`;
    si.innerHTML = h + '<div id="fmChip" style="display:contents"></div>';
    fmChipCards($('#fmChip'), sym, () => this.sym === sym && this.tab() === 'chip' && !!$('#fmChip'));
  },
  // ── 財務 ──
  async t_fin() {
    const sym = this.sym; const us = isUs(sym); const si = $('#si'); si.innerHTML = '<div class="card empty" style="grid-column:1/-1">讀取中…</div>';
    if (!can('STOCKPRO')) { si.innerHTML = lockCard('STOCKPRO', '財務（個股進階資料）'); return; }
    const [val, rev] = us ? [null, null] : await Promise.all([kv('sx:val'), kv('sx:rev')]);
    let r = null, err = null; try { r = await ys(sym, 'summaryDetail,defaultKeyStatistics,financialData,earnings,calendarEvents,price'); } catch (e) { err = e; }
    if (this.sym !== sym || this.tab() !== 'fin') return;
    const v = val && val[sym], rv = rev && rev[sym]; const sd = (r && r.summaryDetail) || {}, ks = (r && r.defaultKeyStatistics) || {}, fd = (r && r.financialData) || {}, er = (r && r.earnings) || {}, ce = (r && r.calendarEvents) || {}, pr = (r && r.price) || {};
    let h = `<div class="card"><h2>估值</h2>${kvRows([['本益比', v && v[0] ? fmt(v[0], 2) : yf(sd, 'trailingPE')], ['預估本益比', yf(sd, 'forwardPE')], ['股價淨值比', v && v[2] ? fmt(v[2], 2) : yf(ks, 'priceToBook')],
      ['殖利率', v && v[1] ? fmt(v[1], 2) + '%' : yf(sd, 'dividendYield') || yf(sd, 'trailingAnnualDividendYield')], ['EPS（近四季）', yf(ks, 'trailingEps')], ['預估 EPS', yf(ks, 'forwardEps')],
      ['市值', yf(sd, 'marketCap') || yf(pr, 'marketCap')], ['Beta', yf(sd, 'beta')], ['PEG', yf(ks, 'pegRatio')], ['下次財報', (((ce.earnings || {}).earningsDate || [])[0] || {}).fmt]])}${err ? sapiErr(err) : ''}</div>`;
    if (rv) h += `<div class="card" id="oldRev"><h2>月營收<span class="r small muted">${esc(rv[0])}</span></h2>${kvRows([['當月營收', fmt((rv[1] || 0) * 1000 / 1e8, 2) + ' 億元'], ['月增率', fmtPct(rv[2])], ['年增率', fmtPct(rv[3])], ['累計年增率', fmtPct(rv[4])]])}</div>`;
    const fin = [['totalRevenue', '營收（近四季）'], ['revenueGrowth', '營收成長（年）'], ['grossMargins', '毛利率'], ['operatingMargins', '營業利益率'], ['profitMargins', '淨利率'], ['returnOnEquity', 'ROE'], ['returnOnAssets', 'ROA'],
      ['earningsGrowth', '獲利成長（年）'], ['debtToEquity', '負債權益比'], ['currentRatio', '流動比率'], ['freeCashflow', '自由現金流'], ['totalCash', '現金'], ['totalDebt', '總負債']].map(([k, n]) => [n, yf(fd, k)]).filter(([, x]) => x);
    if (fin.length) h += `<div class="card"><h2>財務指標</h2>${kvRows(fin)}</div>`;
    const qtr = ((er.earningsChart || {}).quarterly || []);
    if (qtr.length) { const mx = Math.max(...qtr.flatMap((o) => [Math.abs(yr(o, 'actual') || 0), Math.abs(yr(o, 'estimate') || 0)]), 1e-9);
      h += `<div class="card"><h2>季度 EPS（實際／預估）</h2><div style="display:flex;gap:12px;align-items:flex-end;height:150px;padding-top:16px">${qtr.map((o) => { const a = yr(o, 'actual'), e = yr(o, 'estimate'); return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
        <div class="num small ${a != null && e != null ? (a >= e ? 'up' : 'down') : ''}">${a != null ? fmt(a, 2) : '—'}</div><div style="display:flex;gap:3px;align-items:flex-end;height:100px"><div title="實際" style="width:14px;height:${a ? Math.max(2, Math.abs(a) / mx * 100) : 0}px;background:var(--primary);border-radius:2px"></div><div title="預估" style="width:14px;height:${e ? Math.max(2, Math.abs(e) / mx * 100) : 0}px;background:var(--border);border-radius:2px"></div></div><div class="small muted">${esc(o.date || '')}</div></div>`; }).join('')}</div>
        <div class="small muted" style="margin-top:6px">藍＝實際、灰＝分析師預估；數字為實際 EPS，紅色代表優於預估。</div></div>`; }
    const yrs = ((er.financialsChart || {}).yearly || []);
    if (yrs.length) h += `<div class="card"><h2>年度營收與獲利</h2><table class="tbl"><thead><tr><th>年度</th><th>營收</th><th>獲利</th><th>淨利率</th></tr></thead><tbody>${yrs.map((o) => `<tr><td>${esc(String(o.date))}</td><td class="num">${esc(yf(o, 'revenue') || '—')}</td><td class="num">${esc(yf(o, 'earnings') || '—')}</td><td class="num">${yr(o, 'revenue') ? (yr(o, 'earnings') / yr(o, 'revenue') * 100).toFixed(1) + '%' : '—'}</td></tr>`).join('')}</tbody></table>
      <div class="small muted" style="margin-top:6px">幣別：${esc((er.financialCurrency) || pr.currency || '')}</div></div>`;
    const rk = fd.recommendationKey; const RK = { strong_buy: '強力買進', buy: '買進', hold: '持有', underperform: '表現落後', sell: '賣出', strong_sell: '強力賣出' };
    if (rk && rk !== 'none') { const lo = yr(fd, 'targetLowPrice'), hi = yr(fd, 'targetHighPrice'), mean = yr(fd, 'targetMeanPrice'); const cur = (S.q[sym] || {}).price || yr(fd, 'currentPrice');
      const pos = (x) => (hi > lo ? Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100)) : 50);
      h += `<div class="card"><h2>分析師觀點</h2>${kvRows([['建議', RK[rk] || rk], ['分析師人數', yf(fd, 'numberOfAnalystOpinions')], ['平均目標價', yf(fd, 'targetMeanPrice')], ['最高', yf(fd, 'targetHighPrice')], ['最低', yf(fd, 'targetLowPrice')], ['潛在空間', mean && cur ? fmtPct((mean / cur - 1) * 100) : null]])}
        ${lo && hi ? `<div style="position:relative;height:8px;background:var(--card2);border-radius:4px;margin:18px 0 6px"><div title="現價" style="position:absolute;left:${pos(cur)}%;top:-5px;width:3px;height:18px;background:var(--text)"></div><div title="平均目標" style="position:absolute;left:${pos(mean)}%;top:-3px;width:10px;height:14px;margin-left:-5px;border-radius:3px;background:var(--primary)"></div></div><div class="row between small muted"><span>${fmtPrice(lo)}</span><span>黑線＝現價、藍＝平均目標價</span><span>${fmtPrice(hi)}</span></div>` : ''}</div>`; }
    si.innerHTML = (us || etfLike(sym) ? '' : '<div id="fmFin" style="display:contents"><div class="card empty" style="grid-column:1/-1">讀取 FinMind 月營收與財報…</div></div>') + h + `<div class="small muted" style="grid-column:1/-1">資料：${us ? '' : 'FinMind、證交所／櫃買公開資料、'}Yahoo Finance；台股財報數字幣別為台幣。</div>`;
    if (!us && !etfLike(sym)) fmFinCards($('#fmFin'), sym, () => this.sym === sym && this.tab() === 'fin' && !!$('#fmFin'));
  },
  // ── 成分 ──
  async t_hold() {
    const sym = this.sym; const us = isUs(sym); const si = $('#si'); si.innerHTML = '<div class="card empty" style="grid-column:1/-1">讀取中…</div>';
    if (!can('STOCKPRO')) { si.innerHTML = lockCard('STOCKPRO', 'ETF 成分股（個股進階資料）'); return; }
    let list = [], asOf = '', src = '', sectors = [], err = null, extra = {};
    let prev = null;
    if (!us) { try { const j = await sapi('etfh', sym); list = j.list || []; asOf = j.asOf; src = j.src; prev = j.prev || null; } catch (e) { err = e; } }
    try { const r = await ys(sym, 'topHoldings,fundProfile'); const th = r.topHoldings || {};
      if (!list.length) { list = (th.holdings || []).map((o) => ({ s: (o.symbol || '').replace(/\.TWO?$/, ''), n: o.holdingName || o.symbol, w: (yr(o, 'holdingPercent') || 0) * 100 })); src = 'Yahoo Finance'; }
      const SN = { realestate: '房地產', consumer_cyclical: '非必需消費', basic_materials: '原物料', consumer_defensive: '必需消費', technology: '科技', communication_services: '通訊服務', financial_services: '金融', utilities: '公用事業', industrials: '工業', energy: '能源', healthcare: '醫療保健' };
      sectors = (th.sectorWeightings || []).map((o) => { const k = Object.keys(o)[0]; return [SN[k] || k, (yr(o, k) || 0) * 100]; }).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      const fp = r.fundProfile || {}; extra = { fam: fp.family, cat: fp.categoryName, exp: yf((fp.feesExpensesInvestment || {}), 'annualReportExpenseRatio'), eq: yf(th, 'stockPosition'), bd: yf(th, 'bondPosition'), cash: yf(th, 'cashPosition') };
    } catch (e) { if (!list.length) err = err || e; }
    if (this.sym !== sym || this.tab() !== 'hold') return;
    if (!list.length) { si.innerHTML = `<div class="card" style="grid-column:1/-1"><h2>成分股</h2>${err ? sapiErr(err) : '<div class="small muted">查無成分股資料</div>'}</div>`; return; }
    await loadDir(); const mine = new Set(holdings().map((h) => h.symbol)); const mx = Math.max(...list.map((x) => x.w));
    const ops = !us && asOf ? await etfOps(sym, list, asOf, prev) : null; if (this.sym !== sym || this.tab() !== 'hold') return;
    const top10 = list.slice(0, 10).reduce((a, x) => a + x.w, 0); const overlap = list.filter((x) => x.s && mine.has(x.s));
    const h = holdings().find((x) => x.symbol === sym); const mv = h ? h.shares * ((S.q[sym] || {}).price || h.avgCost) * (us ? usdTwd() : 1) : 0;
    si.innerHTML = (ops ? etfOpsHtml(ops) : '') + `<div class="card" style="grid-column:1/-1"><h2>成分股<span class="r small muted">${esc(src)}${asOf ? ' · 資料日期 ' + esc(asOf) : ''}</span></h2>
        <div class="grid g4" style="margin-bottom:10px"><div class="tile"><div class="k">檔數</div><div class="v num">${list.length}</div></div><div class="tile"><div class="k">前十大占比</div><div class="v num">${top10.toFixed(1)}%</div></div>
          <div class="tile"><div class="k">與我的持股重疊</div><div class="v num">${overlap.length} 檔</div><div class="s muted">${overlap.reduce((a, x) => a + x.w, 0).toFixed(1)}%</div></div>
          ${extra.exp ? `<div class="tile"><div class="k">內扣費用率</div><div class="v num">${esc(extra.exp)}</div></div>` : extra.cat ? `<div class="tile"><div class="k">類別</div><div class="v" style="font-size:15px">${esc(extra.cat)}</div></div>` : ''}</div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>#</th><th style="text-align:left">成分股</th><th style="width:34%">權重</th><th>持有股數</th>${mv ? '<th>我的曝險（元）</th>' : ''}</tr></thead><tbody>
          ${list.slice(0, 100).map((x, i) => `<tr ${x.s ? `class="click" data-go="#/s/${encodeURIComponent(x.s)}"` : ''}><td class="muted num">${i + 1}</td><td class="nm" style="text-align:left">${esc(x.s && D.name(x.s) !== x.s ? D.name(x.s) : x.n)} <span class="muted small num">${esc(x.s || '')}</span>${x.s && mine.has(x.s) ? ' <span class="tag" style="color:var(--primary)">持股</span>' : ''}</td>
            <td><div class="row" style="gap:6px"><div class="sp"><div style="height:8px;border-radius:4px;background:var(--primary);width:${(x.w / mx * 100).toFixed(1)}%"></div></div><span class="num small" style="width:52px;text-align:right">${x.w.toFixed(2)}%</span></div></td>
            <td class="num">${x.sh ? fmtInt(x.sh) : '—'}</td>${mv ? `<td class="num">${fmtInt(mv * x.w / 100)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
        ${list.length > 100 ? `<div class="small muted">只列出前 100 檔，共 ${list.length} 檔。</div>` : ''}<div class="small muted" style="margin-top:6px">主動式 ETF 持股每日變動，請以投信公告為準。</div></div>
      ${sectors.length ? `<div class="card"><h2>產業分布</h2>${sectors.map(([n, v]) => `<div class="row" style="gap:8px;height:24px"><span class="small" style="width:90px">${esc(n)}</span><div class="sp"><div style="height:8px;border-radius:4px;background:#a855f7;width:${(v / sectors[0][1] * 100).toFixed(1)}%"></div></div><span class="num small" style="width:52px;text-align:right">${v.toFixed(1)}%</span></div>`).join('')}</div>` : ''}
      ${extra.eq || extra.bd ? `<div class="card"><h2>資產配置</h2>${kvRows([['股票', extra.eq], ['債券', extra.bd], ['現金', extra.cash], ['基金公司', extra.fam]])}</div>` : ''}`;
  },
  // ── 股息 ──
  async t_div() {
    const sym = this.sym; const us = isUs(sym); const si = $('#si');
    si.innerHTML = `<div id="dvs" style="grid-column:1/-1"></div><div id="dvtax"></div><div id="dvup"></div><div id="dvlist"></div><div id="dvpol"></div><div id="dvsplit"></div>`;
    if (!can('DIVTAX')) { si.innerHTML = lockCard('DIVTAX'); return; }
    if (!us) fmDivCard($('#dvpol'), sym, () => this.sym === sym && this.tab() === 'div' && !!$('#dvpol'));
    divStatsCard($('#dvs'), sym); this.taxCard();
    { const bar = document.createElement('div'); bar.className = 'row wrap'; bar.style.cssText = 'gap:8px;grid-column:1/-1'; bar.innerHTML = '<button class="btn sm primary" id="toDrip">以此股複利試算 ›</button><button class="btn sm" id="toDivSim">配息試算（要領多少需買多少）›</button>'; si.prepend(bar);
      $('#toDrip').onclick = () => { S.dripSym = sym; S.pref.tool = 'drip'; savePref(); location.hash = '#/tools'; };
      $('#toDivSim').onclick = () => { S.pref.dsSym = sym; S.pref.tool = 'divsim'; savePref(); location.hash = '#/tools'; }; }
    const [plans, list] = await Promise.all([kv('sx:plans'), divHist(sym)]); if (this.sym !== sym || this.tab() !== 'div') return;
    const p = plans && plans[sym]; const h = holdings().find((x) => x.symbol === sym);
    $('#dvup').innerHTML = `<div class="card"><h2>即將除權息</h2>${p && p.ex >= ymd() ? kvRows([['除息日', p.ex], ['最後買進日', p.lb || '—'], ['發放日', p.pay || '—'], ['現金股利', p.cash ? fmt(p.cash, 4) + ' 元' : '—'], ['股票股利', p.stock || null], ['預估可領', h && p.cash ? fmtInt(h.shares * p.cash) + ' 元' : null]]) : '<div class="small muted">目前沒有已公告的除權息。</div>'}</div>`;
    if (!(p && p.ex >= ymd()) && !us && !etfLike(sym)) fmGet('TaiwanStockDividend', sym, 3700).then((rows) => {
      const ds = rows.map((o) => ({ y: o.year || '', cash: (+o.CashEarningsDistribution || 0) + (+o.CashStatutorySurplus || 0), stock: (+o.StockEarningsDistribution || 0) + (+o.StockStatutorySurplus || 0), ex: o.CashExDividendTradingDate || o.StockExDividendTradingDate || '', pay: o.CashDividendPaymentDate || '' })).filter((d) => d.cash > 0 || d.stock > 0);
      const today = ymd().replace(/\//g, '-'); const fut = ds.filter((d) => d.ex && d.ex >= today).sort((a, b) => (a.ex < b.ex ? -1 : 1))[0];
      const dated = ds.filter((d) => d.ex).sort((a, b) => (a.ex < b.ex ? 1 : -1))[0]; const pend = ds.filter((d) => !d.ex && dated && d.y > dated.y).sort((a, b) => (a.y < b.y ? 1 : -1))[0];
      const f = fut || pend; if (!f || !$('#dvup') || this.sym !== sym) return;
      $('#dvup').innerHTML = `<div class="card"><h2>即將除權息<span class="r small muted">公司決議 · FinMind</span></h2>${kvRows([['所屬期間', f.y], ['現金股利', fmt(f.cash, 4).replace(/\.?0+$/, '') + ' 元'], ['股票股利', f.stock ? fmt(f.stock, 4).replace(/\.?0+$/, '') + ' 元' : null], ['除息日', f.ex || '尚未公布'], ['發放日', f.pay || null], ['預估可領', h && f.cash ? fmtInt(h.shares * f.cash) + ' 元' : null]])}
        <div class="small muted" style="margin-top:6px">交易所尚未公告除權息時程，以上為董事會／股東會決議；實際日期以公告為準。</div></div>`; }).catch(() => {});
    const price = (S.q[sym] || {}).price;
    $('#dvlist').innerHTML = `<div class="card"><h2>配息紀錄<span class="r small muted">${list.length} 筆</span></h2>${list.length ? `<div class="scroll-x" style="max-height:420px;overflow:auto"><table class="tbl"><thead><tr><th>除息日</th><th>每股</th><th>以現價殖利率</th>${h ? '<th>以目前持股可領</th>' : ''}</tr></thead><tbody>
      ${list.slice().reverse().map(([d, c]) => `<tr><td class="num">${esc(d)}</td><td class="num">${fmt(c, us ? 3 : 4)}</td><td class="num">${price ? (c / price * 100).toFixed(2) + '%' : '—'}</td>${h ? `<td class="num">${fmtInt(h.shares * c * divNetFactor(sym))}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<div class="small muted">查無配息紀錄</div>'}</div>`;
    try { const j = await px(YC + encodeURIComponent(ysym(sym)) + '?range=max&interval=3mo&events=split', 86400); const sp = ((((j.chart || {}).result || [])[0] || {}).events || {}).splits;
      const l = sp ? Object.values(sp).sort((a, b) => b.date - a.date) : [];
      if (l.length && $('#dvsplit')) $('#dvsplit').innerHTML = `<div class="card"><h2>股票分割</h2><table class="tbl"><thead><tr><th>生效日</th><th>比例</th></tr></thead><tbody>${l.map((x) => `<tr><td class="num">${tsYmd(x.date)}</td><td class="num">${esc(x.splitRatio || (x.numerator + ':' + x.denominator))}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (e) {}
  },
  async taxCard() {
    const sym = this.sym; const el = $('#dvtax'); if (!el) return; const us = isUs(sym);
    const kind = taxKindOf(sym); const auto = !kjson('taxKinds', {})[sym]; const ratio = taxRatioOf(sym);
    const list = await divHist(sym); const last = list.length ? list[list.length - 1][1] : 0; const h = holdings().find((x) => x.symbol === sym);
    let calc = '';
    if (h && last > 0) {
      const gross = us ? h.shares * last : divGross(h.shares, last); let lines = [], net;
      if (us) { const wh = Math.round(gross * 0.3 * 100) / 100; lines = [['預扣所得稅 30%', '−$' + fmt(wh, 2)], ['二代健保', '不扣']]; net = gross - wh; }
      else { const taxable = gross * ratio; const nhi = divNhi(taxable);
        lines = [[`應稅股利所得（${Math.round(ratio * 100)}%）`, fmtInt(taxable)], ['二代健保 2.11%', taxable <= 0 ? '不扣' : nhi ? '−' + fmtInt(nhi) : '未達 2 萬免扣'],
          ['所得稅', kind === 'TW_ETF_BOND' || kind === 'TW_ETF_OVERSEAS' ? '海外所得，最低稅負制' : taxable > 0 ? '併入綜所稅（8.5% 抵減上限 8 萬）或 28% 分開計稅' : '不計']];
        const [rf0, rfWhy] = divFeeFor(sym); const rf = Math.min(rf0, Math.max(0, gross - nhi)); lines.push(['銀行開票處理費／郵資／匯費', rf > 0 ? '−' + fmtInt(rf) : '0（' + rfWhy + '）']); net = gross - nhi - rf; }
      calc = `<div style="border-top:1px solid var(--card2);margin-top:10px;padding-top:10px"><div class="small muted">以最近一次配息 ${fmt(last, 4)} × 持有 ${fmtInt(h.shares)} 股試算</div>
        ${[[us ? '配息總額' : '配息總額（四捨五入）', (us ? '$' + fmt(gross, 2) : fmtInt(gross))], ...lines].map(([k, v]) => `<div class="row between" style="padding:4px 0"><span class="text2">${esc(k)}</span><span class="num">${esc(v)}</span></div>`).join('')}
        <div class="row between" style="padding:4px 0"><b>實收</b><b class="num" style="color:var(--primary)">${us ? '$' + fmt(net, 2) : fmtInt(net)}</b></div></div>`;
    }
    el.innerHTML = `<div class="card"><h2>配息稅務</h2>
      <div class="field"><label>類型${auto ? '（自動判斷）' : '（已設定）'}</label>${us ? `<div>${TAX_KINDS.US[0]}</div>` : `<select id="txK">${Object.entries(TAX_KINDS).filter(([k]) => k !== 'US').map(([k, [n, d]]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${n}（預設應稅 ${d * 100}%）</option>`).join('')}</select>`}</div>
      <div class="small muted" style="margin-bottom:8px">${esc(TAX_KINDS[kind][2])}</div>
      ${us ? '' : `<div class="field"><label>應稅比例 %（股利所得占配息）</label><input id="txR" type="number" step="1" min="0" max="100" value="${Math.round(ratio * 100)}"></div>
        <div class="small muted">依投信每期公告的「收益分配組成」中股利所得比例填寫，與手機 App 同步。${/^00/.test(sym) ? ` <a href="https://www.twse.com.tw/zh/ETFortune/etfInfo/${sym}" target="_blank" rel="noopener">查看證交所 ETF 資訊 ›</a>` : ''}${auto ? '' : ' <a href="javascript:void 0" id="txA">恢復自動判斷</a>'}</div>`}${calc}</div>`;
    if ($('#txK')) $('#txK').onchange = () => { const o = kjson('taxKinds', {}); o[sym] = $('#txK').value; ksetJson('taxKinds', o); const r = kjson('taxRatios', {}); delete r[sym]; ksetJson('taxRatios', r); changed(); this.taxCard(); };
    if ($('#txR')) $('#txR').onchange = () => { const v = parseFloat($('#txR').value); const r = kjson('taxRatios', {}); if (v >= 0 && v <= 100) r[sym] = v / 100; else delete r[sym]; ksetJson('taxRatios', r); changed(); this.taxCard(); };
    if ($('#txA')) $('#txA').onclick = () => { const o = kjson('taxKinds', {}); delete o[sym]; ksetJson('taxKinds', o); const r = kjson('taxRatios', {}); delete r[sym]; ksetJson('taxRatios', r); changed(); this.taxCard(); };
  },
  // ── 新聞 ──
  async t_news() {
    const sym = this.sym; const si = $('#si');
    const mops = !isUs(sym) && !etfLike(sym);
    si.innerHTML = (mops ? '<div class="card" id="mops" style="grid-column:1/-1"><h2>重大訊息<span class="r small muted">公開資訊觀測站</span></h2><div class="muted small">載入中…</div></div>' : '') + '<div class="card" id="news"><h2>新聞</h2><div class="muted small">載入中…</div></div><div class="card" id="gnews"><h2>相關新聞</h2><div class="muted small">載入中…</div></div>';
    if (mops) fetch('/api/mops?id=' + encodeURIComponent(sym)).then((r) => r.json()).then((j) => {
      const el = $('#mops'); if (!el || this.sym !== sym) return; const l = j.data || [];
      el.innerHTML = `<h2>重大訊息<span class="r small muted">公開資訊觀測站</span></h2>${j.err ? `<div class="small muted">${esc(j.err)}</div>` : !l.length ? '<div class="small muted">近期沒有重大訊息（開放資料只提供當日訊息，本站從啟用後開始累積，保留 90 天）。</div>'
        : `<div class="list">${l.slice(0, 10).map((x, i) => `<div class="it" data-mops="${i}" style="display:block"><div class="small muted num">${esc(x.d)} ${esc(x.t || '')}</div><div class="t1" style="white-space:normal">${esc(x.subject)}</div>
          <div class="small text2 hide" style="margin-top:6px;white-space:pre-wrap">${x.rule ? '符合條款：' + esc(x.rule) + (x.fact ? '　事實發生日：' + esc(x.fact) : '') + '\n' : ''}${esc(x.body || '')}</div></div>`).join('')}</div><div class="small muted" style="margin-top:6px">點標題展開說明。</div>`}`;
      $$('[data-mops]', el).forEach((it) => it.onclick = () => it.lastElementChild.classList.toggle('hide'));
    }).catch(() => { const el = $('#mops'); if (el) el.innerHTML = '<h2>重大訊息</h2><div class="small muted">暫時無法取得（轉送站需重新部署才有此功能）。</div>'; });
    this.news();
    if (!can('NEWS')) { $('#gnews').remove(); return; }
    let items = [], fail = false; try { items = await kwNews((isUs(sym) ? sym + ' ' : '') + D.name(sym) + (isUs(sym) ? ' stock' : ' ' + sym + ' 股'), 15); } catch (e) { fail = true; }
    if (!items.length && !isUs(sym)) { try { items = (await cnyesItems('tw_stock', 60)).filter((x) => x.t.includes(D.name(sym)) || x.t.includes(sym)); fail = false; } catch (e) {} }
    if (this.sym !== sym || !$('#gnews')) return;
    $('#gnews').innerHTML = `<h2>相關新聞<span class="r small muted">${items[0] && items[0].via ? esc(items[0].via) + ' 新聞' : items.length ? '鉅亨網' : ''}</span></h2>${items.length ? `<div class="list">${items.map((n) => `<a class="it" href="${esc(n.l)}" target="_blank" rel="noopener" style="color:inherit"><div class="l"><div class="t1" style="white-space:normal">${esc(n.t)}</div><div class="t2">${esc(n.s || '')}${n.s ? ' · ' : ''}${ago(n.d)}</div></div></a>`).join('')}</div>` : (fail ? '<div class="muted small">新聞搜尋來源暫時讀不到（需管理員重新部署轉送站），請先看上方的個股新聞。</div>' : '<div class="muted small">沒有找到相關新聞</div>')}`;
  },
  // ── 公司 ──
  // ── 討論區 ──
  async t_talk() {
    const sym = this.sym; const si = $('#si'); const F = this._f && this._f.sym === sym ? this._f : (this._f = { sym, hot: 0, posts: [], more: false, me: null, open: 0 });
    if (F.open) return this.talkThread(F.open);
    si.innerHTML = `<div class="f-wrap"><div class="card"><h2>${esc(D.name(sym))} 討論區<span class="r small muted" id="fTot"></span></h2><div id="fMeter">${fMeter(0, 0)}</div>
        <div class="seg" id="fSort" style="margin-top:8px"><button data-v="0" class="${F.hot ? '' : 'on'}">最新</button><button data-v="1" class="${F.hot ? 'on' : ''}">熱門（30 天）</button></div></div>
      <div class="card" id="fCompose"><div class="muted small">載入中…</div></div><div id="fList" class="f-list"><div class="muted small">載入中…</div></div>
      <div id="fMoreW"></div><div class="small muted" style="margin:8px 4px">${F_NOTE}</div></div>`;
    $$('#fSort button').forEach((b) => b.onclick = () => { F.hot = +b.dataset.v; F.posts = []; this.t_talk(); });
    const meP = F.me ? Promise.resolve(F.me) : fapi('me').catch(() => ({ login: false }));
    const load = async (more) => {
      try {
        const r = await fapi('list', { s: sym, sort: F.hot ? 'hot' : 'new', before: more && !F.hot ? (F.posts[F.posts.length - 1] || {}).id || 0 : 0, off: more ? F.posts.length : 0 });
        if (this.sym !== sym || !$('#fList')) return;
        F.posts = more ? F.posts.concat(r.posts.filter((p) => !F.posts.some((x) => x.id === p.id))) : r.posts; F.more = r.more;
        $('#fMeter').innerHTML = fMeter(r.bull, r.bear); $('#fTot').textContent = r.total ? r.total + ' 則主題' : '';
        if (!r.on) { $('#fCompose').remove(); $('#fList').innerHTML = '<div class="card muted small">討論區目前暫停開放。</div>'; return; }
        this.talkRender();
      } catch (e) { if ($('#fList')) $('#fList').innerHTML = `<div class="card small up">${esc(e.message)}</div>`; }
    };
    this._fload = load; load(false);
    F.me = await meP; if (this.sym !== sym || !$('#fCompose')) return;
    this.talkCompose();
  },
  talkCompose() {
    const F = this._f; const me = F.me || {}; const el = $('#fCompose'); if (!el) return;
    if (!me.login) { el.innerHTML = '<div>登入會員後即可發文、回覆與按讚</div><div class="small muted">發文以暱稱顯示，不會公開你的姓名或 Email。</div>'; return; }
    const muted = me.muted > Date.now();
    el.innerHTML = `${muted ? `<div class="small up" style="margin-bottom:6px">你目前被暫停發言至 ${new Date(me.muted).toLocaleString('zh-TW')}${me.why ? '（' + esc(me.why) + '）' : ''}</div>` : ''}
      <div class="row between small muted"><span>以「${esc(me.nick || '會員' + me.no)}」發文</span><a href="javascript:void 0" id="fNick">改暱稱</a></div>
      <textarea id="fTxt" rows="3" maxlength="1000" placeholder="分享你對這檔的看法…（最多 1000 字，不開放貼連結）" style="width:100%;margin-top:6px"></textarea>
      <div class="row between" style="margin-top:6px"><span class="f-stance"><button data-s="1" class="up">看多</button><button data-s="0" class="on">中立</button><button data-s="-1" class="down">看空</button></span>
        <span class="row" style="gap:8px"><span class="small muted" id="fCnt">0/1000</span><button class="btn primary" id="fSend">發布</button></span></div>`;
    let stance = 0;
    $$('.f-stance button', el).forEach((b) => b.onclick = () => { stance = +b.dataset.s; $$('.f-stance button', el).forEach((x) => x.classList.toggle('on', x === b)); });
    $('#fTxt').oninput = () => { $('#fCnt').textContent = $('#fTxt').value.length + '/1000'; };
    $('#fNick').onclick = () => this.talkNick();
    $('#fSend').onclick = async () => {
      const t = $('#fTxt').value.trim(); if (t.length < 2) return toast('內容太短');
      $('#fSend').disabled = true;
      try { const r = await fapi('post', { s: this.sym, body: t, stance }); F.posts.unshift(r.post); $('#fTxt').value = ''; $('#fCnt').textContent = '0/1000'; this.talkRender(); toast('已發布'); }
      catch (e) { toast(e.message, 5000); }
      if ($('#fSend')) $('#fSend').disabled = false;
    };
  },
  async talkNick() {
    const F = this._f; let box = null;
    const v = await dialog('討論區暱稱', `<div class="field"><label>2～16 個字</label><input id="fNk" maxlength="16" value="${esc((F.me || {}).nick || '')}"></div><div class="small muted">暱稱會顯示在你所有的文章上（含舊文章），不能與他人重複。</div><div id="merr" class="small up"></div>`,
      [['', '取消'], ['ok', '儲存', 'primary']], (b) => { box = b; return () => ($('#fNk', b).value.trim().length < 2 ? '暱稱至少 2 個字' : null); });
    if (v !== 'ok') return;
    try { const r = await fapi('nick', { nick: $('#fNk', box).value.trim() }); F.me.nick = r.nick; toast('已更新暱稱'); F.posts = []; this.t_talk(); } catch (e) { toast(e.message, 5000); }
  },
  talkRender() {
    const F = this._f; const el = $('#fList'); if (!el) return;
    el.innerHTML = F.posts.length ? F.posts.map((p) => fPost(p)).join('') : '<div class="card muted small">還沒有人討論這檔，來發表第一篇吧！</div>';
    $('#fMoreW').innerHTML = F.more ? '<button class="btn" id="fMore" style="width:100%">載入更多</button>' : '';
    if ($('#fMore')) $('#fMore').onclick = () => this._fload(true);
    this.talkBind(el, F.posts);
  },
  /** 文章上的按讚、回覆、更多選單 */
  talkBind(el, list, onRemoved) {
    const F = this._f; const find = (id) => list.find((p) => p.id === +id);
    $$('[data-fo]', el).forEach((b) => b.onclick = () => { F.open = +b.dataset.fo; this.talkThread(F.open); });
    $$('.f-body.clamp', el).forEach((b) => b.onclick = () => { F.open = +b.closest('[data-fid]').dataset.fid; this.talkThread(F.open); });
    $$('[data-fl]', el).forEach((b) => b.onclick = async () => {
      if (!(F.me || {}).login) return toast('登入會員後即可按讚');
      try { const r = await fapi('like', { id: +b.dataset.fl }); const p = find(b.dataset.fl); if (p) { p.liked = r.liked; p.likes = r.likes; } b.classList.toggle('on', r.liked); b.textContent = (r.liked ? '♥ ' : '♡ ') + r.likes; } catch (e) { toast(e.message); }
    });
    $$('[data-fm]', el).forEach((b) => b.onclick = async () => {
      const p = find(b.dataset.fm); if (!p) return; const acts = [];
      if ((F.me || {}).login && !p.mine && !p.official) acts.push(['rep', '檢舉']);
      if (p.mine) acts.push(['del', '刪除']);
      acts.push(['copy', '複製內容']);
      const v = await dialog('文章 #' + p.id, '<div class="small muted">' + esc(p.nick) + '・' + fAgo(p.at) + '</div>', [['', '取消']].concat(acts));
      if (v === 'copy') { navigator.clipboard.writeText(p.body).then(() => toast('已複製')); }
      if (v === 'del') { try { await fapi('del', { id: p.id }); const i = list.indexOf(p); if (i >= 0) list.splice(i, 1); onRemoved ? onRemoved(p) : this.talkRender(); toast('已刪除'); } catch (e) { toast(e.message); } }
      if (v === 'rep') {
        let idx = 0; const w = await dialog('檢舉原因', F_REASONS.map((r, i) => `<label class="row" style="gap:6px;padding:4px 0"><input type="radio" name="frr" value="${i}" ${i ? '' : 'checked'}>${r}</label>`).join(''), [['', '取消'], ['ok', '送出', 'primary']], (bx) => () => { idx = +(($('input[name=frr]:checked', bx) || {}).value || 0); return null; });
        if (w !== 'ok') return;
        try { await fapi('report', { id: p.id, why: F_REASONS[idx] }); toast('已送出檢舉，謝謝你的回報'); } catch (e) { toast(e.message); }
      }
    });
  },
  async talkThread(id) {
    const F = this._f; const si = $('#si'); const sym = this.sym;
    si.innerHTML = `<div class="f-wrap"><div class="row" style="margin:4px 0 10px"><button class="btn" id="fBack">‹ 返回討論區</button></div><div id="fTh"><div class="muted small">載入中…</div></div></div>`;
    $('#fBack').onclick = () => { F.open = 0; this.t_talk(); };
    let r; try { r = await fapi('thread', { id }); } catch (e) { $('#fTh').innerHTML = `<div class="card small up">${esc(e.message)}</div>`; return; }
    if (this.sym !== sym || !$('#fTh')) return;
    const all = [r.post].concat(r.replies);
    const draw = () => {
      $('#fTh').innerHTML = fPost(r.post, { full: true }) + `<div class="small muted" style="margin:10px 4px 6px">${r.replies.length ? r.replies.length + ' 則回覆' : '還沒有回覆'}</div>`
        + r.replies.map((x) => fPost(x, { full: true, reply: true })).join('')
        + ((F.me || {}).login ? `<div class="card" style="margin-top:10px"><textarea id="fRe" rows="2" maxlength="1000" placeholder="回覆…" style="width:100%"></textarea><div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn primary" id="fReS">送出回覆</button></div></div>`
          : '<div class="card small muted" style="margin-top:10px">登入會員後即可回覆。</div>');
      this.talkBind($('#fTh'), all, (p) => { if (p.id === r.post.id) { F.open = 0; F.posts = F.posts.filter((x) => x.id !== p.id); this.t_talk(); return; } r.replies = r.replies.filter((x) => x.id !== p.id); r.post.replies = Math.max(0, r.post.replies - 1); draw(); });
      if ($('#fReS')) $('#fReS').onclick = async () => {
        const t = $('#fRe').value.trim(); if (t.length < 2) return toast('內容太短'); $('#fReS').disabled = true;
        try { const x = await fapi('post', { parent: r.post.id, body: t }); r.replies.push(x.post); all.push(x.post); r.post.replies++; const lp = F.posts.find((p) => p.id === r.post.id); if (lp) lp.replies = r.post.replies; draw(); }
        catch (e) { toast(e.message, 5000); if ($('#fReS')) $('#fReS').disabled = false; }
      };
    };
    draw();
  },
  async t_co() {
    const sym = this.sym; const us = isUs(sym); const si = $('#si'); si.innerHTML = '<div class="card empty" style="grid-column:1/-1">讀取中…</div>';
    let co = null;
    if (!us && !/^00/.test(sym)) {
      const IND = { '01': '水泥', '02': '食品', '03': '塑膠', '04': '紡織纖維', '05': '電機機械', '06': '電器電纜', '08': '玻璃陶瓷', '09': '造紙', '10': '鋼鐵', '11': '橡膠', '12': '汽車', '14': '建材營造', '15': '航運', '16': '觀光餐旅', '17': '金融保險', '18': '貿易百貨', '20': '其他', '21': '化學', '22': '生技醫療', '23': '油電燃氣', '24': '半導體', '25': '電腦及週邊設備', '26': '光電', '27': '通信網路', '28': '電子零組件', '29': '電子通路', '30': '資訊服務', '31': '其他電子', '32': '文化創意', '33': '農業科技', '34': '電子商務', '35': '綠能環保', '36': '數位雲端', '37': '運動休閒', '38': '居家生活' };
      const roc = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 6 ? (+d.slice(0, -4) + 1911) + '/' + d.slice(-4, -2) + '/' + d.slice(-2) : s; };
      const find = (o, k, not) => { const key = Object.keys(o).find((x) => x.includes(k) && (!not || !x.includes(not))); return key ? String(o[key]).trim() : ''; };
      for (const [u, otc] of [['https://openapi.twse.com.tw/v1/opendata/t187ap03_L', false], ['https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', true]]) {
        try { const a = await px(u, 86400); const o = (Array.isArray(a) ? a : []).find((x) => find(x, '公司代號') === sym || x.SecuritiesCompanyCode === sym); if (!o) continue;
          const cap = parseFloat(find(o, '實收資本額').replace(/,/g, '')); const ind = find(o, '產業別');
          co = [['公司名稱', find(o, '公司名稱')], ['產業別', IND[ind.padStart(2, '0')] || ind], ['董事長', find(o, '董事長')], ['總經理', find(o, '總經理')], ['成立日期', roc(find(o, '成立日期'))], [otc ? '上櫃日期' : '上市日期', roc(find(o, otc ? '上櫃日期' : '上市日期'))],
            ['實收資本額', cap ? fmt(cap / 1e8, 2) + ' 億元' : ''], ['發行股數（約）', cap ? fmtInt(cap / 10 / 1000) + ' 張' : ''], ['市值（約）', cap && (S.q[sym] || {}).price ? fmt(cap / 10 * S.q[sym].price / 1e8, 0) + ' 億元' : ''], ['發言人', find(o, '發言人', '電話')], ['網址', find(o, '網址')], ['地址', find(o, '地址', '英文')]].filter(([, v]) => v);
          break; } catch (e) {}
      }
    }
    let ap = null, err = null; try { ap = (await ys(sym, 'assetProfile,price,fundProfile')); } catch (e) { err = e; }
    if (this.sym !== sym || this.tab() !== 'co') return;
    const a = (ap && ap.assetProfile) || {}; const pr = (ap && ap.price) || {}; const fp = (ap && ap.fundProfile) || {};
    let h = '';
    if (co) h += `<div class="card"><h2>公司基本資料<span class="r small muted">${/^\d/.test(sym) ? '公開資訊觀測站' : ''}</span></h2><div class="list">${co.map(([k, v]) => `<div class="it" style="cursor:default"><div class="l"><div class="t2">${esc(k)}</div><div class="t1" style="white-space:normal">${k === '網址' ? `<a href="${esc(/^http/.test(v) ? v : 'https://' + v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v)}</div></div></div>`).join('')}</div></div>`;
    const yi = [['名稱', pr.longName || pr.shortName], ['交易所', pr.exchangeName], ['類股', a.sector], ['產業', a.industry], ['員工數', a.fullTimeEmployees ? fmtInt(a.fullTimeEmployees) : ''], ['總部', [a.city, a.country].filter(Boolean).join(', ')], ['基金公司', fp.family], ['類別', fp.categoryName], ['網址', a.website]].filter(([, v]) => v);
    if (yi.length) h += `<div class="card"><h2>${co ? '國際資料' : '基本資料'}<span class="r small muted">Yahoo Finance</span></h2>${kvRows(yi.filter(([k]) => k !== '網址'))}${a.website ? `<div style="margin-top:8px"><a href="${esc(a.website)}" target="_blank" rel="noopener">${esc(a.website)}</a></div>` : ''}</div>`;
    if (a.longBusinessSummary) h += `<div class="card" style="grid-column:1/-1"><h2>公司簡介<span class="r small muted">英文原文</span></h2><div class="small text2" style="line-height:1.8">${esc(a.longBusinessSummary)}</div></div>`;
    const off = (a.companyOfficers || []).slice(0, 8);
    if (off.length) h += `<div class="card"><h2>主要經營者</h2><div class="list">${off.map((o) => `<div class="it" style="cursor:default"><div class="l"><div class="t1">${esc(o.name || '')}</div><div class="t2">${esc(o.title || '')}</div></div></div>`).join('')}</div></div>`;
    if (!h) h = `<div class="card"><h2>公司</h2>${err ? sapiErr(err) : '<div class="small muted">暫無公司資料</div>'}</div>`;
    else if (err && !co) h += `<div class="card">${sapiErr(err)}</div>`;
    si.innerHTML = h;
  },
});

// ───────── 各頁版面自訂：卡片顯示／隱藏、順序、寬度、欄數（存在這個瀏覽器） ─────────
const LAY_SKIP = new Set(['', 'more', 'diag']);
const LAY_ID_NAMES = { adv: '綜合進場評估', book: '最佳五檔', sig: 'K 線體檢', kst: '關鍵數據與報酬', aib: 'AI 個股體檢', pro: '進階分析（三關價、位階、分價量、月份）', peers: '相似股票',
  dvs: '配息統計', dvtax: '配息稅務', dvup: '即將除權息', dvlist: '配息紀錄', dvsplit: '股票分割', news: '新聞', gnews: '相關新聞', dd: '加權指數回撤', season: '月份漲跌', el: 'ETF 清單' };
const LAY_PAGE_NAMES = { watch: '行情', hold: '持股', trades: '交易', div: '股息', analysis: '分析', compare: '比較', calendar: '行事曆', sim: '模擬交易', tools: '工具', alerts: '提醒',
  market: '市場', cash: '現金與帳戶', member: '會員', settings: '設定', s: '個股', us: '美股市場', etf: 'ETF 市場', index: '指數與匯率', rank: '排行', limits: '漲跌停', report: '盤後報告', news: '新聞', crash: '歷次大跌' };
function layKey() {
  const r = S.route;
  if (r === 's') return 's:' + VIEWS.s.tab();
  if (r === 'analysis') return 'analysis:' + (S.pref.an || 'perf');
  if (r === 'tools') return 'tools:' + (S.pref.tool || 'cost');
  if (r === 'hold') return 'hold:' + (S.pref.holdView || 'table');
  return r;
}
function layName(k) { const [r, t] = k.split(':'); const tn = t && ($(`[data-st="${t}"],[data-an="${t}"],[data-tl="${t}"],[data-hv="${t}"]`) || {}).textContent; return (LAY_PAGE_NAMES[r] || r) + (tn ? ' › ' + tn.trim() : ''); }
function layRoot() { return $('#si') || $('#tool') || $('#dyn'); }
function layTitle(el) {
  const h = el.matches('h2') ? el : el.querySelector('h2'); if (!h) return '';
  let t = ''; h.childNodes.forEach((n) => { if (n.nodeType === 3) t += n.textContent; else if (n.nodeType === 1 && !n.classList.contains('r') && !n.matches('button,a,input,select')) t += n.textContent; });
  return t.replace(/\s+/g, ' ').trim();
}
/** 依目前畫面收集區塊：卡片、帶 id 的區塊、摘要數字列；其他元素（說明文字、按鈕列）跟著前一個區塊 */
function layCollect(root) {
  const groups = []; let tiles = 0; const rw = root.getBoundingClientRect().width || 1; const seen = {};
  const add = (el, key, name) => { if (seen[key]) key += '_' + (++seen[key]); else seen[key] = 1; groups.push({ key, name, els: [el], w: el.getBoundingClientRect().width > rw * 0.66 ? 'f' : 1 }); };
  const walk = (el) => {
    for (const c of Array.from(el.children)) {
      if (c.matches('script,style,canvas')) continue;
      if (c.dataset.lay === 'top') { groups.push({ key: '#' + c.id, name: '', els: [c], w: 'f', fixed: true }); continue; }
      if (c.classList.contains('card') || c.id) {
        const t = layTitle(c); const key = c.id ? '#' + c.id : 'c:' + t.replace(/[\d,.%+\-−／/：:\s（）()]+/g, '');
        add(c, key, (c.id && LAY_ID_NAMES[c.id]) || t || (c.id ? '#' + c.id : '卡片')); continue;
      }
      if (c.querySelector(':scope > .tile')) { tiles++; add(c, 'tiles' + tiles, tiles > 1 ? '摘要數字 ' + tiles : '摘要數字'); continue; }
      if (c.querySelector(':scope > .card, :scope > [id], :scope > div > .card')) { walk(c); continue; }
      if (groups.length) groups[groups.length - 1].els.push(c); else groups.push({ key: '_head', name: '', els: [c], w: 'f', fixed: true });
    }
  };
  walk(root);
  return groups;
}
function layCfg(k) { return ((S.pref.lay || {})[k]) || null; }
function layBuild(root, groups, cfg) {
  const order = cfg.order || []; const hide = new Set(cfg.hide || []); const ws = cfg.w || {}; const cols = cfg.cols || 2;
  const rank = (g, i) => (g.fixed ? -1 : order.indexOf(g.key) >= 0 ? order.indexOf(g.key) : 1000 + i);
  const sorted = groups.map((g, i) => [g, rank(g, i)]).sort((a, b) => a[1] - b[1]).map(([g]) => g);
  const dash = document.createElement('div'); dash.className = 'dash laydash'; dash.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`; dash.dataset.cols = cols;
  sorted.forEach((g) => {
    const w = g.fixed ? 'f' : (ws[g.key] ?? g.w); const box = document.createElement('div'); box.dataset.lk = g.key; box._g = g;
    if (w === 'f' || +w >= cols) box.style.gridColumn = '1 / -1'; else if (+w > 1) box.style.gridColumn = 'span ' + w;
    box.style.display = hide.has(g.key) ? 'none' : ''; box.style.minWidth = '0';
    g.els.forEach((e) => box.appendChild(e)); if (g.els.length > 1) { box.style.display = box.style.display || 'grid'; box.style.gap = 'var(--gap)'; box.style.alignContent = 'start'; }
    dash.appendChild(box);
  });
  dash.style.gridColumn = '1 / -1'; root.innerHTML = ''; root.appendChild(dash); root.classList.add('laid');
}
let layBusy = false;
function layPage(force = false) {
  if (layBusy || !S.session || LAY_SKIP.has(S.route)) return;
  const root = layRoot(); if (!root) return;
  const dash = root.firstElementChild && root.firstElementChild.classList.contains('laydash') && root.children.length === 1 ? root.firstElementChild : null;
  const k = layKey(); const cfg = layCfg(k);
  layBusy = true;
  try {
    if (dash) {
      if (!force) return;
      const groups = Array.from(dash.children).map((b) => b._g).filter(Boolean);
      if (cfg) layBuild(root, groups, cfg);
      S.layGroups = groups;
    } else {
      const fc = root.firstElementChild; if (!fc || (fc._layScanned && !force)) return;
      const groups = layCollect(root); S.layGroups = groups; fc._layScanned = true;
      if (cfg && groups.length) layBuild(root, groups, cfg);
    }
    layButton();
  } finally { setTimeout(() => { layBusy = false; }, 0); }
}
function layButton() {
  const top = $('#view > .top') || $('#view > .shd > .top'); if (!top) return;
  const n = (S.layGroups || []).filter((g) => !g.fixed).length; let b = $('#layBtn');
  if (n < 2) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('button'); b.id = 'layBtn'; b.className = 'btn'; b.title = '調整這一頁的卡片顯示、順序與寬度'; b.textContent = '⚙ 版面'; const h1 = top.querySelector('h1'); h1 && h1.nextSibling ? top.insertBefore(b, h1.nextSibling) : top.appendChild(b); b.onclick = layEditor; }
  b.classList.toggle('primary', !!layCfg(layKey()));
}
/** 拖曳排序（與行情牆一樣直接拖動）：按住列內 [data-drag] 把手上下拖，放開後回呼 onDrop(原位置, 新位置) */
function dragList(list, onDrop) {
  if (!list) return;
  list.querySelectorAll('[data-drag]').forEach((hd) => {
    hd.style.touchAction = 'none';
    hd.onpointerdown = (e) => {
      const row = hd.closest('.it') || hd.parentElement; if (!row) return;
      e.preventDefault(); hd.setPointerCapture(e.pointerId);
      const rows = () => Array.from(list.children);
      const from = rows().indexOf(row); row.classList.add('dragging');
      const move = (ev) => {
        const r = list.getBoundingClientRect();
        if (ev.clientY < r.top + 24) list.scrollTop -= 8; else if (ev.clientY > r.bottom - 24) list.scrollTop += 8;
        for (const o of rows()) {
          if (o === row) continue; const b = o.getBoundingClientRect();
          if (ev.clientY > b.top && ev.clientY < b.bottom) { const after = ev.clientY > b.top + b.height / 2; list.insertBefore(row, after ? o.nextSibling : o); break; }
        }
      };
      const up = () => {
        hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up);
        row.classList.remove('dragging'); const to = rows().indexOf(row);
        if (to !== from && to >= 0) onDrop(from, to);
      };
      hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
    };
  });
}
function layEditor() {
  const k = layKey(); const groups = (S.layGroups || []).filter((g) => !g.fixed);
  const cur = () => layCfg(k) || {};
  const draw = (box) => {
    const c = cur(); const order = c.order || []; const hide = new Set(c.hide || []); const ws = c.w || {}; const cols = c.cols || 2;
    const list = groups.map((g, i) => [g, order.indexOf(g.key) >= 0 ? order.indexOf(g.key) : 1000 + i]).sort((a, b) => a[1] - b[1]).map(([g]) => g);
    box.innerHTML = `<div class="small muted" style="margin-bottom:8px">${esc(layName(k))}：勾選要顯示的卡片、按住 ≡ 拖曳（或用 ↑↓）調整順序、選擇每張卡片的寬度。設定只存在這個瀏覽器。</div>
      <div class="row wrap" style="margin-bottom:10px"><span class="small">欄數（電腦）</span><div class="seg">${[1, 2, 3].map((n) => `<button data-lc="${n}" class="${cols === n ? 'on' : ''}">${n} 欄</button>`).join('')}</div></div>
      <div class="list" style="max-height:52vh;overflow:auto">${list.map((g, i) => { const w = ws[g.key] ?? g.w;
        return `<div class="it" style="cursor:default;padding:6px 2px;gap:6px"><input type="checkbox" data-lh="${esc(g.key)}" ${hide.has(g.key) ? '' : 'checked'} style="width:auto"><div class="l"><div class="t1" style="white-space:normal">${esc(g.name)}</div></div>
          <select data-lw="${esc(g.key)}" style="width:auto">${[[1, '1 欄'], ...(cols >= 3 ? [[2, '2 欄']] : []), ['f', '整列']].map(([v, n]) => `<option value="${v}" ${String(w) === String(v) || (v === 'f' && +w >= cols) ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <button class="btn sm" data-lm="${i}:-1" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-lm="${i}:1" ${i < list.length - 1 ? '' : 'disabled'}>↓</button><span class="draghd" data-drag title="按住拖曳">≡</span></div>`; }).join('')}</div>`;
    const save = (fn) => { const c2 = { order: list.map((g) => g.key), hide: Array.from(hide), w: { ...ws }, cols, ...(layCfg(k) ? {} : {}) }; fn(c2); S.pref.lay = { ...(S.pref.lay || {}), [k]: c2 }; savePref(); layPage(true); layButton(); draw(box); };
    $$('[data-lc]', box).forEach((b) => b.onclick = () => save((c2) => { c2.cols = +b.dataset.lc; }));
    $$('[data-lh]', box).forEach((x) => x.onchange = () => save((c2) => { const h = new Set(c2.hide); if (x.checked) h.delete(x.dataset.lh); else h.add(x.dataset.lh); c2.hide = Array.from(h); }));
    $$('[data-lw]', box).forEach((x) => x.onchange = () => save((c2) => { c2.w[x.dataset.lw] = x.value === 'f' ? 'f' : +x.value; }));
    $$('[data-lm]', box).forEach((b) => b.onclick = () => save((c2) => { const [i, d] = b.dataset.lm.split(':').map(Number); [c2.order[i], c2.order[i + d]] = [c2.order[i + d], c2.order[i]]; }));
    dragList($('.list', box), (from, to) => save((c2) => { const [m] = c2.order.splice(from, 1); c2.order.splice(to, 0, m); }));
  };
  const btns = S.route === 's' ? [['stab', '分頁列排版…'], ['reset', '恢復預設'], ['', '完成', 'primary']] : [['reset', '恢復預設'], ['', '完成', 'primary']];
  dialog('版面設定', '<div id="layEd"></div>', btns, (box) => { draw($('#layEd', box)); }).then((v) => {
    if (v === 'reset') { const l = { ...(S.pref.lay || {}) }; delete l[k]; S.pref.lay = l; savePref(); route(); }
    if (v === 'stab') stabEditor();
  });
}
// 畫面內容變動後自動套用（每次重新整理行情、切換分頁都會重排）
let layRaf = 0;
new MutationObserver(() => { if (layBusy || layRaf) return; layRaf = requestAnimationFrame(() => { layRaf = 0; layPage(); }); })
  .observe(document.getElementById('app') || document.body, { childList: true, subtree: true });

// ───────── 網頁到價提醒：網頁開著時依行情觸發瀏覽器通知、提示音（每則提醒每天最多一次） ─────────
let audioCtx = null;
function beep() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.55); } catch (e) {}
}
function webNotify(title, body, go) {
  toast('🔔 ' + title + '：' + body, 6000);
  if (S.pref.aSound !== false) beep();
  try { if ('Notification' in window && Notification.permission === 'granted') { const n = new Notification(title, { body, icon: '/web/icon.svg', tag: title }); if (go) n.onclick = () => { window.focus(); location.hash = go; n.close(); }; } } catch (e) {}
}
function checkAlerts() {
  if (S.pref.webAlert === false || !can('ALERTS')) return;
  const list = kjson('alertsV2', []).filter((a) => a.on !== false); if (!list.length) return;
  const today = ymd(); const fired = store.get('afired', {}); let dirty = false;
  Object.keys(fired).forEach((k) => { if (!k.endsWith(today)) { delete fired[k]; dirty = true; } });
  const fire = (a, sym, msg) => { const k = a.id + ':' + sym + ':' + today; if (fired[k]) return; fired[k] = 1; dirty = true; webNotify(D.name(sym) + ' ' + sym, msg, '#/s/' + encodeURIComponent(sym)); };
  list.forEach((a) => {
    const syms = a.s ? [a.s] : holdings().map((h) => h.symbol);
    syms.forEach((s) => {
      const q = S.q[s]; if (!q || !q.price) return; const pct = q.prev ? (q.price / q.prev - 1) * 100 : null; const v = +a.v;
      if (a.t === 'PRICE_ABOVE' && v && q.price >= v) fire(a, s, `價格 ${fmtPrice(q.price)} 已高於 ${fmtPrice(v)}`);
      else if (a.t === 'PRICE_BELOW' && v && q.price <= v) fire(a, s, `價格 ${fmtPrice(q.price)} 已低於 ${fmtPrice(v)}`);
      else if (a.t === 'CHANGE_UP' && v && pct != null && pct >= v) fire(a, s, `今日上漲 ${fmtPct(pct)}（達 ${v}%）`);
      else if (a.t === 'CHANGE_DOWN' && v && pct != null && pct <= -v) fire(a, s, `今日下跌 ${fmtPct(pct)}（達 −${v}%）`);
    });
  });
  if (dirty) store.set('afired', fired);
}

// ───────── 歷次大跌（指數月線，自高點回落 ≥ 門檻的波段與修復時間） ─────────
const CRASH_IX = [['^TWII', '台灣加權'], ['^GSPC', 'S&P 500'], ['^IXIC', '那斯達克'], ['^DJI', '道瓊'], ['^SOX', '費城半導體'], ['^N225', '日經 225']];
function crashEpisodes(dates, closes, th) {
  const out = []; let peak = closes[0], pi = 0, ep = null;
  for (let i = 1; i < closes.length; i++) {
    const c = closes[i]; if (c == null) continue;
    if (c >= peak) { if (ep) { ep.rec = i; out.push(ep); ep = null; } peak = c; pi = i; continue; }
    const dd = (c / peak - 1) * 100;
    if (dd <= -th) { if (!ep) ep = { pk: pi, tr: i, dd, peak }; else if (dd < ep.dd) { ep.tr = i; ep.dd = dd; } }
  }
  if (ep) out.push(ep);
  return out.map((e) => ({ pkD: dates[e.pk], trD: dates[e.tr], recD: e.rec != null ? dates[e.rec] : null, dd: e.dd, down: e.tr - e.pk, up: e.rec != null ? e.rec - e.tr : null, peak: e.peak, trough: closes[e.tr] })).reverse();
}
VIEWS.crash = {
  title: '歷次大跌',
  render() {
    const k = S.pref.crIx || '^TWII', th = S.pref.crTh || 15;
    return head('歷次大跌與修復', `<a class="btn" href="#/market">‹ 市場</a>`) + `<div class="row wrap" style="margin-bottom:12px"><div class="chips" style="flex-wrap:wrap">${CRASH_IX.map(([s, n]) => `<button class="chip ${k === s ? 'on' : ''}" data-cx="${s}">${n}</button>`).join('')}</div>
      <span class="sp"></span><span class="small muted">跌幅門檻</span><div class="seg">${[10, 15, 20, 30].map((v) => `<button data-ct="${v}" class="${th === v ? 'on' : ''}">${v}%</button>`).join('')}</div></div><div id="dyn"><div class="card empty">讀取中…</div></div>`;
  },
  bind() {
    $$('[data-cx]').forEach((b) => b.onclick = () => { S.pref.crIx = b.dataset.cx; savePref(); route(); });
    $$('[data-ct]').forEach((b) => b.onclick = () => { S.pref.crTh = +b.dataset.ct; savePref(); route(); });
  },
  async fill() {
    if (!can('MARKET')) { $('#dyn').innerHTML = lockCard('MARKET'); return; }
    const k = S.pref.crIx || '^TWII', th = S.pref.crTh || 15; const ck = 'max' + k;
    const r = barCache[ck] || (barCache[ck] = await fetchYahoo(k, 'max', '1mo', 86400)); if (S.route !== 'crash') return;
    if (!r || !r.timestamp) { $('#dyn').innerHTML = '<div class="card empty">無法取得指數歷史資料</div>'; return; }
    const cl = r.indicators.quote[0].close; const dates = r.timestamp.map((t) => tsYmd(t).slice(0, 7)); const ok = cl.map((v, i) => [dates[i], v]).filter(([, v]) => v != null);
    const D0 = ok.map((x) => x[0]), C0 = ok.map((x) => x[1]); const eps = crashEpisodes(D0, C0, th);
    const peak = Math.max(...C0); const cur = C0[C0.length - 1]; const curDD = (cur / peak - 1) * 100;
    const done = eps.filter((e) => e.up != null); const avgDD = eps.length ? eps.reduce((a, e) => a + e.dd, 0) / eps.length : 0;
    const avgUp = done.length ? done.reduce((a, e) => a + e.up, 0) / done.length : 0; const avgDown = eps.length ? eps.reduce((a, e) => a + e.down, 0) / eps.length : 0;
    const name = (CRASH_IX.find((x) => x[0] === k) || [k, k])[1];
    let peakRun = 0; const dd = C0.map((v) => { peakRun = Math.max(peakRun, v); return (v / peakRun - 1) * 100; });
    $('#dyn').innerHTML = `<div class="grid g4" style="margin-bottom:12px"><div class="tile"><div class="k">目前距歷史高點</div><div class="v num ${cls(curDD)}">${fmtPct(curDD)}</div><div class="s muted">高點 ${fmt(peak, 0)}</div></div>
        <div class="tile"><div class="k">跌幅 ≥ ${th}% 次數</div><div class="v num">${eps.length}</div><div class="s muted">${esc(D0[0])} 起</div></div>
        <div class="tile"><div class="k">平均最大跌幅</div><div class="v num down">${fmtPct(avgDD, 1)}</div><div class="s muted">平均下跌 ${avgDown.toFixed(0)} 個月</div></div>
        <div class="tile"><div class="k">平均修復時間</div><div class="v num">${done.length ? (avgUp / 12).toFixed(1) + ' 年' : '—'}</div><div class="s muted">谷底回到前高</div></div></div>
      <div class="card" style="margin-bottom:12px"><h2>${esc(name)} 回撤走勢（月線）</h2><div class="chart-wrap" id="crC"><canvas></canvas><div class="chart-tip"></div></div></div>
      <div class="card"><h2>歷次跌幅 ≥ ${th}%</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>高點</th><th>谷底</th><th>最大跌幅</th><th>下跌月數</th><th>修復（回到前高）</th><th>修復月數</th><th>高點／谷底</th></tr></thead><tbody>
        ${eps.map((e) => `<tr><td class="num">${esc(e.pkD)}</td><td class="num">${esc(e.trD)}</td><td class="num down">${fmtPct(e.dd, 1)}</td><td class="num">${e.down}</td><td class="num">${e.recD ? esc(e.recD) : '<span class="muted">尚未修復</span>'}</td><td class="num">${e.up != null ? e.up : '—'}</td><td class="num small">${fmt(e.peak, 0)}／${fmt(e.trough, 0)}</td></tr>`).join('')}</tbody></table></div>
        <div class="small muted" style="margin-top:6px">以月收盤計算（不含股息），月中最低點可能更低；「修復」指月收盤重新站上前波高點。過去不代表未來。</div></div>`;
    drawSeries($('#crC'), D0, [{ v: dd, color: '#ef4444', name: '回撤', fill: true }], { h: 220, fmt: (v) => v.toFixed(1) + '%', key: 'cr' + k });
  },
  syms() { return []; },
};

// ───────── 行事曆：總經與期貨日程（台指期結算、FOMC、美股休市、月營收公布） ─────────
const FOMC = { 2026: ['01/28', '03/18', '04/29', '06/17', '07/29', '09/16', '10/28', '12/09'] };
const US_HOLIDAY = { 2026: [['01/01', '元旦'], ['01/19', '馬丁路德金恩紀念日'], ['02/16', '總統日'], ['04/03', '耶穌受難日'], ['05/25', '陣亡將士紀念日'], ['06/19', '六月節'], ['07/03', '獨立紀念日（補假）'], ['09/07', '勞動節'], ['11/26', '感恩節'], ['12/25', '聖誕節']],
  2027: [['01/01', '元旦'], ['01/18', '馬丁路德金恩紀念日'], ['02/15', '總統日'], ['03/26', '耶穌受難日'], ['05/31', '陣亡將士紀念日'], ['06/18', '六月節（補假）'], ['07/05', '獨立紀念日（補假）'], ['09/06', '勞動節'], ['11/25', '感恩節'], ['12/24', '聖誕節（補假）']] };
function macroEvents(yy, mm) {
  const pre = yy + '/' + String(mm).padStart(2, '0'); const out = [];
  const f = new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay(); const wed3 = 1 + ((3 - f + 7) % 7) + 14; out.push([pre + '/' + String(wed3).padStart(2, '0'), '台指期／選擇權月結算']);
  out.push([pre + '/10', '上市櫃公司月營收公布截止']);
  (FOMC[yy] || []).filter((d) => d.startsWith(String(mm).padStart(2, '0'))).forEach((d) => out.push([yy + '/' + d, 'FOMC 利率決議（台灣隔日凌晨）']));
  (US_HOLIDAY[yy] || []).filter(([d]) => d.startsWith(String(mm).padStart(2, '0'))).forEach(([d, n]) => out.push([yy + '/' + d, '美股休市：' + n]));
  return out;
}

// ───────── 美股代號搜尋（Yahoo，英文名稱也能找） ─────────
let ySearchSeq = 0;
async function yahooSearch(t) {
  const my = ++ySearchSeq;
  try { const j = await px('https://query2.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(t) + '&quotesCount=8&newsCount=0&enableFuzzyQuery=false', 3600);
    if (my !== ySearchSeq) return null;
    return (j.quotes || []).filter((x) => (x.quoteType === 'EQUITY' || x.quoteType === 'ETF') && !/\.(TW|TWO)$/.test(x.symbol) && /^[A-Z][A-Z.\-]{0,7}$/.test(x.symbol))
      .map((x) => [x.symbol, x.shortname || x.longname || x.symbol, (x.quoteType === 'ETF' ? 'ETF ' : '') + (x.exchDisp || '美股')]);
  } catch (e) { return null; }
}

// ───────── 列印資產報表 ─────────
function printReport() {
  const P = portfolio(); const fx = usdTwd(); const lg = D.trades().length ? ledger() : null; const now = new Date().toLocaleString('zh-TW', { hour12: false });
  const UP = S.pref.color === 'us' ? '#16a34a' : '#dc2626', DN = S.pref.color === 'us' ? '#dc2626' : '#16a34a'; const c = (v) => (v > 0 ? UP : v < 0 ? DN : '#333');
  const tw = P.rows.filter((r) => !r.us), us = P.rows.filter((r) => r.us); const sum = (l, k) => l.reduce((a, r) => a + r[k], 0);
  const rows = P.rows.slice().sort((a, b) => b.mv - a.mv).map((r) => `<tr><td>${esc(r.name)} <small>${r.symbol}</small></td><td>${fmt(r.shares, r.shares % 1 ? 2 : 0)}</td><td>${fmtPrice(r.avgCost)}</td><td>${fmtPrice(r.price)}</td><td>${fmtInt(r.cost)}</td><td>${fmtInt(r.mv)}</td><td style="color:${c(r.pl)}">${fmtSigned(r.pl)}</td><td style="color:${c(r.pl)}">${fmtPct(r.plPct)}</td><td>${r.weight.toFixed(1)}%</td></tr>`).join('');
  const html = `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><title>資產報表 ${ymd()}</title><style>
    body{font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#222;margin:24px;font-size:12px}h1{font-size:20px;margin:0 0 4px}.sub{color:#777;margin-bottom:14px}
    .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}.t{border:1px solid #ddd;border-radius:6px;padding:8px}.t b{display:block;font-size:16px;margin-top:2px}
    table{width:100%;border-collapse:collapse;margin-bottom:14px}th,td{border-bottom:1px solid #e5e5e5;padding:5px 6px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#f5f5f5;font-weight:600}small{color:#888}
    h2{font-size:14px;margin:16px 0 6px}.foot{color:#999;font-size:10px;margin-top:20px}@media print{body{margin:10mm}}</style></head><body>
    <h1>資產報表</h1><div class="sub">產生時間 ${esc(now)}　美元匯率 ${fmt(fx, 3)}</div>
    <div class="tiles"><div class="t">總資產（台幣）<b>${fmtInt(P.mv + P.cash - P.debt)}</b></div><div class="t">持股市值<b>${fmtInt(P.mv)}</b></div><div class="t">現金<b>${fmtInt(P.cash)}</b></div>
      <div class="t">未實現損益<b style="color:${c(P.pl)}">${fmtSigned(P.pl)}（${fmtPct(P.cost ? P.pl / P.cost * 100 : 0)}）</b></div>
      <div class="t">今日損益<b style="color:${c(P.day)}">${fmtSigned(P.day)}</b></div><div class="t">已實現損益<b style="color:${c(P.realized)}">${fmtSigned(P.realized || 0)}</b></div>
      <div class="t">台股市值<b>${fmtInt(sum(tw, 'mv'))}</b></div><div class="t">美股市值（台幣）<b>${fmtInt(sum(us, 'mv'))}</b></div></div>
    <h2>持股明細（${P.rows.length} 檔）</h2><table><thead><tr><th>個股</th><th>股數</th><th>均價</th><th>現價</th><th>成本</th><th>市值</th><th>損益</th><th>報酬率</th><th>占比</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><th>合計</th><th></th><th></th><th></th><th>${fmtInt(P.cost)}</th><th>${fmtInt(P.mv)}</th><th style="color:${c(P.pl)}">${fmtSigned(P.pl)}</th><th>${fmtPct(P.cost ? P.pl / P.cost * 100 : 0)}</th><th>100%</th></tr></tfoot></table>
    ${lg && !lg.err ? `<h2>股息</h2><div>台股股息累計 ${fmtInt(P.divTw || 0)}　美股股息累計 ${fmtInt(P.divUs || 0)}</div>` : ''}
    <div class="foot">台美股資產 網頁版產生；金額為台幣，美股以即時匯率換算。僅供個人紀錄參考。</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;
  const w = window.open('', '_blank'); if (!w) return toast('瀏覽器擋下了新視窗，請允許彈出視窗後再試');
  w.document.open(); w.document.write(html); w.document.close();
}

// ───────── 安裝為 App（PWA）與離線外殼 ─────────
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; const b = $('#instBtn'); if (b) b.classList.remove('hide'); });
async function installApp() { if (!installEvt) return toast('請用瀏覽器選單的「安裝應用程式」或「加入主畫面」'); installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; }
if ('serviceWorker' in navigator && !/[?&]mock\b/.test(location.search)) {
  navigator.serviceWorker.register('/web/sw.js', { scope: '/web' }).catch(() => navigator.serviceWorker.register('/web/sw.js').catch(() => {}));
}

// ───────── 綜合進場評估（多指標同一把尺 −2～+2 加權彙總；與 App 同樣的等級、信心度、先投比例規則） ─────────
async function entryAdvice(sym) {
  const key = sym + '2y'; const b0 = barCache[key] || (barCache[key] = await loadBars(sym, '2y')); if (!b0 || b0.length < 60) return null;
  const q = S.q[sym] || {}; const b = b0.slice(); const today = ymd();
  if (q.price && !isUs(sym) && twOpen()) { const last = b[b.length - 1]; const cur = { d: today, o: q.open || q.price, h: Math.max(q.high || q.price, q.price), l: Math.min(q.low || q.price, q.price), c: q.price, v: q.volLots || 0 }; if (last.d === today) b[b.length - 1] = cur; else b.push(cur); }
  const c = b.map((x) => x.c), n = c.length - 1, px0 = c[n];
  const m = await stockMetrics(sym).catch(() => null);
  const us = isUs(sym); const [val, rev, chip] = us ? [null, null, null] : await Promise.all([kv('sx:val'), kv('sx:rev'), kv('sx:chip')]);
  const src = []; const add = (name, group, score, weight, note) => { if (score == null || isNaN(score)) return; src.push({ name, group, score: Math.max(-2, Math.min(2, score)), weight, note }); };
  const m5 = sma(c, 5)[n], m20 = sma(c, 20)[n], m60 = sma(c, 60)[n];
  const trend = m5 && m20 && m60 ? (px0 > m20 && m20 > m60 ? 1 : px0 < m20 && m20 < m60 ? -1 : 0) : 0;
  add('均線趨勢', '技術', trend * 1.2 + (m5 > m20 ? 0.3 : -0.3), 1.2, trend > 0 ? '多頭排列，收盤站上月線' : trend < 0 ? '空頭排列，收盤在月線下' : '均線糾結，方向未明');
  if (m && m.bias20Pct != null) { const bz = m.bias20Pct; add('月線乖離', '技術', bz > 12 ? -1.2 : bz > 8 ? -0.5 : bz < -10 ? 0.8 : bz < -5 ? 0.4 : 0.1, 0.8, '乖離 ' + fmtPct(bz) + (bz > 12 ? '，短線過熱' : bz < -10 ? '，超跌易反彈' : '')); }
  if (m && m.rsi14 != null) { const r = m.rsi14; add('RSI(14)', '技術', r < 30 ? 1 : r < 40 ? 0.4 : r > 75 ? -1 : r > 65 ? -0.3 : 0.1, 0.7, 'RSI ' + r.toFixed(0) + (r < 30 ? ' 超賣' : r > 75 ? ' 超買' : '')); }
  if (m && m.kdK != null) { const [K, Dd] = kdArr(b.map((x) => x.h), b.map((x) => x.l), c); const gold = K[n - 1] <= Dd[n - 1] && K[n] > Dd[n], dead = K[n - 1] >= Dd[n - 1] && K[n] < Dd[n];
    add('KD', '技術', gold ? (K[n] < 30 ? 1.2 : 0.6) : dead ? (K[n] > 70 ? -1.2 : -0.6) : K[n] > Dd[n] ? 0.2 : -0.2, 0.7, `K ${K[n].toFixed(0)}／D ${Dd[n].toFixed(0)}` + (gold ? '，黃金交叉' : dead ? '，死亡交叉' : '')); }
  if (m) { const pv = m.priceVolumeState; add('量價', '技術', { 價漲量增: 0.6, 價漲爆量: 0.4, 價漲量縮: -0.3, 價跌量縮: 0.2, 價跌量增: -0.5, 價跌爆量: -1.2 }[pv] ?? 0, 0.7, pv + (m.volumeRatioToMa5 != null ? '（量比 ' + m.volumeRatioToMa5.toFixed(1) + '）' : '')); }
  if (m && m.candlestickPatterns.length) { const bot = m.candlestickPatterns.filter((x) => PAT_BOTTOM.includes(x)), tp = m.candlestickPatterns.filter((x) => PAT_TOP.includes(x));
    add('K 棒型態', '技術', (bot.length ? (m.patternNearMa ? 1.2 : 0.6) : 0) - (tp.length ? ((m.bias20Pct || 0) > 5 ? 1.2 : 0.6) : 0), 0.8, m.candlestickPatterns.join('、') + (bot.length && m.patternNearMa ? '，止跌位於 ' + m.patternNearMa : '')); }
  const zones = ['低檔', '偏低', '中低', '中高', '偏高', '高檔']; const zone = m && m.priceBandZone; const zi = zones.indexOf(zone);
  if (zi >= 0) add('一年價格位階', '位置', [1.5, 1, 0.4, -0.2, -0.8, -1.5][zi], 1.0, '位於「' + zone + '」區');
  const y1 = b.slice(-250); const h52 = Math.max(...y1.map((x) => x.h)), l52 = Math.min(...y1.map((x) => x.l)); const pos = h52 > l52 ? (px0 - l52) / (h52 - l52) : 0.5;
  add('52 週位置', '位置', pos < 0.1 ? (trend < 0 ? 0.1 : 0.6) : pos > 0.95 ? (trend > 0 ? 0.2 : -0.4) : 0, 0.5, '位於一年區間 ' + (pos * 100).toFixed(0) + '%');
  const base = b[b.length - 1].d === today && b.length > 1 ? b[b.length - 2] : b[b.length - 1]; const rg = base.h - base.l; const upK = base.l + rg * 1.382, dnK = base.h - rg * 1.382;
  add('三關價', '位置', px0 > upK ? 0.7 : px0 < dnK ? -0.7 : px0 >= (base.h + base.l) / 2 ? 0.2 : -0.2, 0.5, px0 > upK ? '站上上關' : px0 < dnK ? '跌破下關' : px0 >= (base.h + base.l) / 2 ? '中關之上' : '中關之下');
  const tr = b.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - b[i].c), Math.abs(x.l - b[i].c))); const atr14 = tr.slice(-14).reduce((a, v) => a + v, 0) / 14; const atr60 = tr.slice(-60).reduce((a, v) => a + v, 0) / Math.min(60, tr.length);
  const regime = atr60 ? atr14 / atr60 : 1; const atrPct = atr14 / px0 * 100;
  add('波動', '風險', regime >= 1.6 ? -0.8 : regime >= 1.25 ? -0.3 : regime < 0.8 ? 0.3 : 0, 0.5, 'ATR ' + atrPct.toFixed(1) + '%，波動' + (regime >= 1.6 ? '急遽放大' : regime >= 1.25 ? '放大' : regime < 0.8 ? '收斂' : '持平'));
  const v = val && val[sym]; if (v && v[0] > 0 && !D.isEtf(sym)) add('本益比', '估值', v[0] < 10 ? 1 : v[0] < 15 ? 0.5 : v[0] > 40 ? -1 : v[0] > 25 ? -0.4 : 0, 0.7, '本益比 ' + fmt(v[0], 1));
  if (v && v[1] > 0) add('殖利率', '估值', v[1] >= 6 ? 0.8 : v[1] >= 4 ? 0.4 : v[1] < 1.5 ? -0.2 : 0, 0.5, '殖利率 ' + fmt(v[1], 2) + '%');
  const r = rev && rev[sym]; if (r && r[3] != null) add('月營收年增', '基本面', r[3] > 30 ? 1 : r[3] > 10 ? 0.6 : r[3] > 0 ? 0.2 : r[3] < -15 ? -1 : -0.4, 0.7, esc(r[0]) + ' 年增 ' + fmtPct(r[3]));
  const ch = chip && chip[sym]; if (ch) { const inst = (ch[1] || 0) + (ch[2] || 0); add('法人', '籌碼', inst > 0 ? Math.min(1, 0.3 + Math.abs(ch[2] || 0) / 2000) : -Math.min(1, 0.3 + Math.abs(inst) / 10000), 0.7, '外資 ' + fmtSigned(ch[1] || 0) + '、投信 ' + fmtSigned(ch[2] || 0) + ' 張');
    if (ch[4] && ch[5]) { const dm = ch[4] - ch[5]; const up0 = q.prev ? q.price >= q.prev : true; add('融資', '籌碼', dm > 0 && !up0 ? -0.5 : dm < 0 && up0 ? 0.3 : 0, 0.4, '融資 ' + fmtSigned(dm) + ' 張'); } }
  if (!src.length) return null;
  const W = src.reduce((a, s) => a + s.weight, 0); const cap = 0.18;
  src.forEach((s) => { s.share = Math.min(cap, s.weight / W); }); const SW = src.reduce((a, s) => a + s.share, 0); src.forEach((s) => { s.share /= SW; });
  let total = src.reduce((a, s) => a + s.score * s.share, 0) * 1.6; total = Math.max(-2, Math.min(2, total));
  const decided = src.filter((s) => Math.abs(s.score) >= 0.25);
  const agree = decided.length ? decided.filter((s) => Math.sign(s.score) === Math.sign(total)).reduce((a, s) => a + s.share, 0) / decided.reduce((a, s) => a + s.share, 0) : 0.5;
  const coverage = Math.min(1, src.length / (us ? 9 : 14)); const confidence = Math.max(5, Math.min(98, Math.round((agree * 0.75 + coverage * 0.25) * 100)));
  const guards = []; let level = total >= 0.85 && agree >= 0.6 ? 2 : total >= 0.3 ? 1 : total > -0.3 ? 0 : total > -0.85 ? -1 : -2;
  if (level >= 1 && zi === 5) { level = Math.min(level, 0); guards.push('股價位於價格位階「高檔」，位階偏高'); }
  if (level >= 1 && regime >= 1.6 && trend < 0) { level = 0; guards.push('波動急遽放大且趨勢向下，先觀望'); }
  if (level === -2 && zi >= 0 && zi <= 1) { level = -1; guards.push('價格已在價格位階偏低區，避免過度悲觀'); }
  if (coverage < 0.6 && level === 2) { level = 1; guards.push('部分資料尚未取得，結論保守一級'); }
  const bullRev = m && m.candlestickPatterns.some((x) => PAT_BOTTOM.includes(x));
  const tech = src.filter((s) => s.group === '技術').reduce((a, s) => a + s.score * s.share, 0); const valu = src.filter((s) => s.group === '估值' || s.group === '位置').reduce((a, s) => a + s.score * s.share, 0);
  const label = level === 2 ? '訊號偏多' : level === 1 ? '訊號略偏多' : level === 0 ? (tech >= 0.05 && valu < 0 ? '待回測' : bullRev && total < 0 ? '觀察止跌' : '觀望') : level === -1 ? (bullRev ? '等待止跌確認' : '訊號偏弱') : '訊號轉弱';
  const tip = { 2: '已持有：持有者可留意停利', 1: '已持有：續抱', 0: '已持有：續抱觀察', '-1': '已持有：暫不加碼', '-2': '已持有：風險升高，留意停損' }[level];
  const baseR = { 2: 80, 1: 50, 0: 20, '-1': 5, '-2': 0 }[level]; const volAdj = Math.max(0.6, Math.min(1, 1 / regime));
  const ratio = Math.round(baseR * (0.6 + 0.4 * confidence / 100) * volAdj / 5) * 5;
  const sorted = src.slice().sort((a, b2) => b2.score * b2.share - a.score * a.share);
  return { level, label, tip, total, score: Math.round((total + 2) / 4 * 100), confidence, ratio, src: src.slice().sort((a, b2) => Math.abs(b2.score * b2.share) - Math.abs(a.score * a.share)),
    pros: sorted.filter((s) => s.score >= 0.4).slice(0, 4), cons: sorted.slice().reverse().filter((s) => s.score <= -0.4).slice(0, 4), guards, atrPct,
    stop: Math.min(px0 - atr14, m20 && m20 < px0 ? Math.max(m20 - atr14 * 0.5, px0 - atr14 * 3) : px0 - atr14 * 2),
    plan: (() => { try { const kr = klineAnalyze(b); return kr && (kr.longPlan || kr.plan); } catch (e) { return null; } })(), px: px0 };
}
/**
 * 進場評估總結（與 App TradeDecision 同算法）：條件符合（level ≥ 1 且現價風報比 ≥ 1.5）／等待回測（附風報比 1:2 參考價＝(目標＋2×停損)÷3）／條件未符合（附重新評估價）。
 * 僅為依規則計算的分析成果，不是買賣指令。
 */
function tdRef(target, stop, rr = 2) { return (target + rr * stop) / (1 + rr); }
function tdSummary(level, ratio, price, stop, target, e0, e1) {
  const bull = stop != null && target != null && stop < price && target > stop;
  if (!(price > 0) || level <= -1 || !bull) {
    const re = [stop > price ? stop : null, e1 > price ? e1 : null, target > price ? target : null].filter((v) => v != null);
    const r = re.length ? Math.min(...re) : null;
    return { state: 'NOT', label: '條件未符合', ratio: 0, stop, target, e0, e1, rr: null, ref: null, reeval: r, note: r != null ? '評估轉弱，站回 ' + fmtPrice(r) + ' 後重新評估' : '評估轉弱，暫無符合條件的價位' };
  }
  const rr = price > stop && target > price ? (target - price) / (price - stop) : null;
  if (level >= 1 && rr != null && rr >= 1.5) return { state: 'MET', label: '條件符合', ratio, stop, target, e0, e1, rr, ref: null, reeval: null, note: '評估偏多，現價風報比 1:' + rr.toFixed(1) };
  const ref0 = tdRef(target, stop); const ref = ref0 < price && ref0 > stop ? Math.round(ref0 * 100) / 100 : null;
  return { state: 'WAIT', label: '等待回測', ratio, stop, target, e0, e1, rr, ref, reeval: null,
    note: ref != null ? '現價風報比 ' + (rr != null ? '1:' + rr.toFixed(1) : '不足') + '，風報比 1:2 的參考價 ' + fmtPrice(ref) : '風報比已足夠，等待評估轉為偏多' };
}
function tdOf(a, price) { if (!a) return null; const p = a.plan; return tdSummary(a.level, a.ratio, price || a.px, p ? p.stop : null, p ? p.tp1 : null, p ? p.e0 : null, p ? p.e1 : null); }
function tdCardHtml(sym, a) {
  const t = tdOf(a, (S.q[sym] || {}).price); if (!t) return '';
  const col = t.state === 'MET' ? (S.pref.color === 'us' ? '#16a34a' : '#dc2626') : t.state === 'WAIT' ? '#f2b544' : (S.pref.color === 'us' ? '#dc2626' : '#16a34a');
  const cells = [['試算比例', t.state === 'NOT' ? '0%' : t.ratio + '%']];
  if (t.ref != null) cells.push(['1:2 參考價', fmtPrice(t.ref)]);
  if (t.state === 'MET' && t.e0 != null && t.e1 != null) cells.push(['參考區間', fmtPrice(Math.min(t.e0, t.e1)) + '～' + fmtPrice(Math.max(t.e0, t.e1))]);
  if (t.reeval != null) cells.push(['重新評估價', fmtPrice(t.reeval)]);
  if (t.state !== 'NOT' && t.stop != null) cells.push(['參考停損', fmtPrice(t.stop)]);
  if (t.state !== 'NOT' && t.target != null) cells.push(['參考目標', fmtPrice(t.target)]);
  if (t.rr != null) cells.push(['現價風報比', '1:' + t.rr.toFixed(1)]);
  // 試算配置（醒目標示）：每檔預計投入 × 試算比例，依現價換算股數（台股另列張數＋零股）
  const budget = +(S.pref.budget || 0); const price = (S.q[sym] || {}).price || a.px; const us = isUs(sym); const fx = us ? usdTwd() : 1;
  const alloc = (px) => { if (!(budget > 0) || !(px > 0) || !(t.ratio > 0)) return null; const sh = Math.floor(budget * t.ratio / 100 / (px * fx) + 1e-9); const cost = sh * px * fx; return { sh, lots: us ? 0 : Math.floor(sh / 1000), odd: us ? sh : sh % 1000, cost, pct: cost / budget * 100 }; };
  const shTxt = (x) => fmt(x.sh, 0) + ' 股' + (!us && x.lots > 0 ? '（' + x.lots + ' 張' + (x.odd > 0 ? '＋零股 ' + x.odd + ' 股' : '') + '）' : '');
  const now = t.state === 'NOT' ? null : alloc(price); const atRef = t.ref != null && t.state !== 'NOT' ? alloc(t.ref) : null;
  const allocHtml = `<div style="margin-top:8px;padding:12px;border-radius:12px;background:${col}22">
      <div class="row between" style="align-items:center"><b>試算配置</b><span style="font-size:22px;font-weight:900;color:${col}">${t.state === 'NOT' ? 0 : t.ratio}%</span></div>
      ${!(budget > 0) ? '<div class="small muted">設定每檔預計投入金額，即可依目前價格換算可配置的股數與比例。</div>'
        : t.state === 'NOT' ? `<div style="font-weight:700;color:${col}">條件未符合：試算 0%，暫不配置</div>`
        : now && now.sh > 0 ? `<div style="font-size:20px;font-weight:900;color:${col}">可配置 ${shTxt(now)}</div><div class="small">以現價 ${fmtPrice(price)} 計約 NT$${fmt(now.cost, 0)}，占預計投入 ${now.pct.toFixed(1)}%（預計投入 NT$${fmt(budget, 0)}，其餘 ${(100 - now.pct).toFixed(1)}% 保留）</div>`
        : `<div style="font-weight:700;color:${col}">試算金額不足 1 股</div>`}
      ${atRef && atRef.sh > 0 ? `<div class="small" style="margin-top:4px;font-weight:700;color:#f2b544">回測到參考價 ${fmtPrice(t.ref)} 時：可配置 ${shTxt(atRef)}，約 NT$${fmt(atRef.cost, 0)}（${atRef.pct.toFixed(1)}%）</div>` : ''}
      <div class="row" style="gap:6px;margin-top:6px"><input id="tdBudget" type="number" min="0" step="1000" placeholder="每檔預計投入（台幣）" value="${budget > 0 ? budget : ''}" style="max-width:200px"><button class="btn sm" id="tdBudgetS">儲存</button></div></div>`;
  return `<div class="card"><h2>進場評估總結<span class="r"><span class="tag" style="background:${col};color:#fff">${t.label}</span></span></h2>
    <div class="small">${esc(t.note)}</div>${allocHtml}
    <div class="grid g3" style="margin-top:8px;gap:8px">${cells.map(([k, v]) => `<div class="tile"><div class="small muted">${k}</div><div class="num" style="font-weight:700">${v}</div></div>`).join('')}</div>
    <details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">評估依據</summary><div class="small text2" style="margin-top:4px">進場評估：${esc(a.label)}（評分 ${a.score}、信心 ${a.confidence}%）${a.plan ? '；K 線操作計畫：' + esc(a.plan.title) : ''}<br>條件符合：評估偏多且現價風報比 ≥ 1.5；等待回測：方向未轉弱但風報比不足，參考價＝(目標＋2×停損)÷3，在此價位風報比為 1:2；條件未符合：評估轉弱，站回重新評估價後再看。</div></details>
    <div class="small muted" style="margin-top:6px">依規則計算的分析成果，不構成投資建議；投資有風險，請自行評估並自負盈虧。</div></div>`;
}
const ADV_COL = { 2: '#dc2626', 1: '#f97316', 0: '#64748b', '-1': '#16a34a', '-2': '#15803d' };
/** 進場評估快取（個股頁標籤列與綜合進場評估卡共用，2 分鐘內不重算；同時只算一次） */
const ADV_CACHE = {};
function entryAdviceCached(sym, maxAge = 120000) {
  const c = ADV_CACHE[sym]; if (c && Date.now() - c.at < maxAge) return c.p;
  const p = entryAdvice(sym).catch(() => null); ADV_CACHE[sym] = { at: Date.now(), p }; return p;
}
function advColor(level) { return S.pref.color === 'us' ? { 2: '#16a34a', 1: '#22c55e', 0: '#64748b', '-1': '#f97316', '-2': '#dc2626' }[level] : ADV_COL[level]; }
/** 個股標籤列的進場評估標籤：建議＋先投比例（已持有顯示加減碼建議）、分數與信心度；點一下捲到綜合進場評估卡 */
function setAdvTag(sym, a) {
  const t = $('#advTag'); if (!t) return;
  if (!a) { t.textContent = '進場評估 資料不足'; return; }
  const col = advColor(a.level); const held = holdings().some((x) => x.symbol === sym);
  const px = (S.q[sym] || {}).price;
  t.style.color = col; t.style.borderColor = col; t.style.fontWeight = '700'; t.style.cursor = 'pointer';
  t.innerHTML = `${a.level >= 1 ? '▲' : a.level <= -1 ? '▼' : '●'} ${esc(a.label)}${held ? '・' + esc(a.tip.replace('已持有：', '')) : '・試算 ' + a.ratio + '%'} <span style="font-weight:400;opacity:.8">${a.score} 分・信心 ${a.confidence}%</span>`;
  t.title = `綜合進場評估：${a.label}（綜合分數 ${a.score}／100、信心度 ${a.confidence}%、${a.src.length} 項指標）` + (px ? `\n參考停損 ${fmtPrice(a.stop)}（${fmtPct((a.stop / px - 1) * 100, 1)}）` : '') +
    (a.pros.length ? '\n利多：' + a.pros.map((x) => x.name).join('、') : '') + (a.cons.length ? '\n利空：' + a.cons.map((x) => x.name).join('、') : '') + (a.guards.length ? '\n' + a.guards.join('；') : '') + '\n點一下看完整分析（僅供參考）';
  t.onclick = () => { const el = $('#adv'); if (el && el.firstElementChild) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); else { const b = $('[data-st="ov"]'); if (b) { b.click(); setTimeout(() => { const e2 = $('#adv'); if (e2) e2.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 900); } } };
}
async function advCard(el, sym) {
  if (!el) return; if (!can('KLINE')) { el.innerHTML = lockCard('KLINE'); return; }
  el.innerHTML = '<div class="card"><h2>綜合進場評估</h2><div class="small muted">計算中…</div></div>';
  const a = await entryAdviceCached(sym); if (!el.isConnected) return; setAdvTag(sym, a);
  if (!a) { el.innerHTML = '<div class="card"><h2>綜合進場評估</h2><div class="small muted">資料不足，無法計算。</div></div>'; return; }
  const col = advColor(a.level);
  const h = holdings().find((x) => x.symbol === sym);
  el.innerHTML = tdCardHtml(sym, a) + `<div class="card"><h2>綜合進場評估<span class="r small muted">${a.src.length} 項指標 · 信心度 ${a.confidence}%</span></h2>
    <div class="row wrap" style="gap:16px;align-items:center">
      <div style="text-align:center;min-width:110px"><div style="font-size:22px;font-weight:800;color:${col}">${esc(a.label)}</div><div class="small muted" style="margin-top:2px">${h ? esc(a.tip) : '模型試算'}</div>${h ? '' : `<div class="num" style="font-size:28px;font-weight:800;color:${col}">${a.ratio}%</div>`}</div>
      <div style="flex:1;min-width:200px"><div style="position:relative;height:10px;border-radius:5px;background:linear-gradient(90deg,${S.pref.color === 'us' ? '#dc2626,#f97316,#94a3b8,#22c55e,#16a34a' : '#15803d,#22c55e,#94a3b8,#f97316,#dc2626'})"><i style="position:absolute;top:-4px;left:calc(${a.score}% - 2px);width:4px;height:18px;border-radius:2px;background:var(--text)"></i></div>
        <div class="row between small muted" style="margin-top:4px"><span>偏空</span><span>綜合分數 ${a.score}</span><span>偏多</span></div>
        <div class="small text2" style="margin-top:6px">參考停損 ${fmtPrice(a.stop)}（約 ${fmtPct((a.stop / ((S.q[sym] || {}).price || a.stop) - 1) * 100, 1)}）　日均波動 ${a.atrPct.toFixed(1)}%${h ? '　已持有可參考加減碼；未持有時建議先投 ' + a.ratio + '%' : ''}</div></div></div>
    <div class="grid g2" style="margin-top:10px;gap:10px"><div><div class="small" style="font-weight:700;color:${S.pref.color === 'us' ? '#16a34a' : '#dc2626'}">利多</div>${a.pros.length ? a.pros.map((s) => `<div class="small text2">・${esc(s.name)}：${s.note}</div>`).join('') : '<div class="small muted">—</div>'}</div>
      <div><div class="small" style="font-weight:700;color:${S.pref.color === 'us' ? '#dc2626' : '#16a34a'}">利空</div>${a.cons.length ? a.cons.map((s) => `<div class="small text2">・${esc(s.name)}：${s.note}</div>`).join('') : '<div class="small muted">—</div>'}</div></div>
    ${a.guards.length ? `<div class="notice" style="margin-top:10px">${a.guards.map(esc).join('；')}</div>` : ''}
    <details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">全部指標與權重</summary><table class="tbl" style="margin-top:6px"><thead><tr><th>指標</th><th>類別</th><th>分數</th><th>影響</th><th>說明</th></tr></thead><tbody>
      ${a.src.map((s) => `<tr><td>${esc(s.name)}</td><td class="small">${esc(s.group)}</td><td class="num ${cls(s.score)}">${s.score > 0 ? '+' : ''}${s.score.toFixed(1)}</td><td class="num">${(s.share * 100).toFixed(0)}%</td><td class="small text2" style="text-align:left">${s.note}</td></tr>`).join('')}</tbody></table></details>
    <div class="small muted" style="margin-top:6px">每項指標換算成 −2～+2 再加權（單項上限 18%），信心度看各指標方向是否一致；僅為分析成果，不構成投資建議；投資有風險，請自行評估並自負盈虧。</div></div>`;
  const tb = $('#tdBudgetS', el); if (tb) tb.onclick = () => { S.pref.budget = Math.max(0, +($('#tdBudget', el).value || 0)); savePref(); advCard(el, sym); };
}

// ───────── 指令面板（Ctrl＋K）：跳頁、找個股、常用動作 ─────────
const CMDS = () => NAV.map(([r, n, ic]) => [ic + ' ' + n, () => { location.hash = '#/' + r; }, n + ' ' + r])
  .concat([['🌍 美股市場', '#/us'], ['📊 ETF 市場', '#/etf'], ['📉 歷次大跌', '#/crash'], ['🧾 盤後報告', '#/report'], ['🔍 資料來源診斷', '#/diag']].map(([n, h]) => [n, () => { location.hash = h; }, n]))
  .concat([['＋ 新增交易', () => tradeModal(), '新增 交易 買進'], ['🌓 切換深色／淺色', () => { S.pref.theme = (document.documentElement.dataset.theme === 'dark') ? 'light' : 'dark'; savePref(); applyLook(); }, '主題 深色 淺色'],
    ['🖨 列印資產報表', () => printReport(), '列印 報表'], ['⚙ 這一頁的版面', () => { if ($('#layBtn')) layEditor(); else toast('這一頁沒有可調整的版面'); }, '版面 排版'], ['🗂 個股分頁列排版', () => stabEditor(), '個股 分頁 導航 排版'], ['✛ 切換圖表十字線', () => { S.pref.xh = S.pref.xh === false; savePref(); toast(S.pref.xh !== false ? '已開啟十字線' : '已關閉十字線'); if ($('#kxh')) $('#kxh').classList.toggle('on', S.pref.xh !== false); }, '十字線 crosshair'],
    ['🔄 立即同步', () => { pull(true).then(() => toast('已同步')).catch((e) => toast(e.message)); }, '同步 下載']]);
function cmdPalette() {
  if ($('#cmdp')) return;
  const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'cmdp';
  bg.innerHTML = `<div class="modal" style="max-width:560px;width:100%;align-self:flex-start;margin-top:10vh"><input id="cmdIn" placeholder="輸入頁面、動作或個股代號／名稱…" autocomplete="off" style="font-size:16px"><div id="cmdL" class="list" style="max-height:55vh;overflow:auto;margin-top:8px"></div><div class="small muted" style="margin-top:6px">↑↓ 選擇　Enter 執行　Esc 關閉</div></div>`;
  document.body.appendChild(bg); const inp = $('#cmdIn'); let items = [], sel = 0;
  const close = () => bg.remove();
  const draw = () => { $('#cmdL').innerHTML = items.map((it, i) => `<div class="it" data-ci="${i}" style="${i === sel ? 'background:var(--card2)' : ''}"><div class="l"><div class="t1">${esc(it[0])}</div></div>${it[3] ? `<span class="small muted">${esc(it[3])}</span>` : ''}</div>`).join('') || '<div class="small muted" style="padding:8px">找不到</div>';
    $$('[data-ci]', bg).forEach((d) => d.onmousedown = (e) => { e.preventDefault(); run(+d.dataset.ci); }); };
  const run = (i) => { const it = items[i]; if (!it) return; close(); it[1](); };
  const upd = async () => { const t = inp.value.trim(); const lo = t.toLowerCase(); sel = 0;
    items = CMDS().filter((x) => !t || (x[0] + ' ' + x[2]).toLowerCase().includes(lo)).slice(0, 12);
    if (t) { const dir = await loadDir(); const up = t.toUpperCase(); let k = 0; for (const [c, a] of Object.entries(dir)) { if (c.startsWith(up) || (a[0] && a[0].includes(t))) { items.push(['📈 ' + c + ' ' + a[0], () => { location.hash = '#/s/' + c; }, '', '個股']); if (++k >= 8) break; } }
      if (/^[A-Z][A-Z.\-]{0,6}$/.test(up)) items.push(['🇺🇸 ' + up, () => { location.hash = '#/s/' + up; }, '', '美股']); }
    draw(); };
  inp.oninput = upd; inp.onkeydown = (e) => { if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter') { run(sel); e.preventDefault(); } else if (e.key === 'Escape') close(); };
  bg.onclick = (e) => { if (e.target === bg) close(); };
  upd(); setTimeout(() => inp.focus(), 20);
}
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.session) { e.preventDefault(); cmdPalette(); } });

// ───────── 總覽：近期行事 ─────────
async function upcomingEvents(days = 14) {
  const [plans] = await Promise.all([kv('sx:plans')]); const today = ymd(); const end = (() => { const d = tpeNow(); d.setDate(d.getDate() + days); return ymd(d); })();
  const mine = new Set(holdings().map((h) => h.symbol).concat(D.quotes().map((q) => q.s))); const held = Object.fromEntries(holdings().map((h) => [h.symbol, h])); const out = [];
  Object.entries(plans || {}).forEach(([c, p]) => { if (!mine.has(c)) return; if (p.ex >= today && p.ex <= end) out.push([p.ex, `${D.name(c)} 除息${p.cash ? ' ' + fmt(p.cash, 2) + ' 元' : ''}`, '#/s/' + c, held[c] && p.cash ? held[c].shares * p.cash : 0]);
    if (p.pay && p.pay >= today && p.pay <= end && held[c]) out.push([p.pay, `${D.name(c)} 股利發放`, '#/s/' + c, held[c] && p.cash ? held[c].shares * p.cash : 0]); });
  const d0 = tpeNow(); for (let k = 0; k < 2; k++) { const d = new Date(Date.UTC(d0.getFullYear(), d0.getMonth() + k, 1)); macroEvents(d.getUTCFullYear(), d.getUTCMonth() + 1).forEach(([dd, t]) => { if (dd >= today && dd <= end) out.push([dd, t, '#/calendar', 0]); }); }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}
// ───────── 個股討論區（與 App 共用同一個資料庫）─────────
async function fapi(a, p = {}) {
  const r = await fetch('/api/f', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, a, session: S.session || '', src: 'web' }) });
  const j = await r.json().catch(() => ({ ok: false, err: r.status === 404 ? '發佈站尚未支援討論區' : '討論區回應錯誤' }));
  if (!j.ok) throw new Error(j.err || '討論區錯誤');
  return j;
}
const F_REASONS = ['廣告／洗版', '不實或誤導資訊', '人身攻擊／不雅', '與本股無關', '其他'];
const F_NOTE = '討論內容為會員個人意見，不代表本站立場，亦非投資建議；請勿張貼個資、廣告或明牌招攬。';
function fAgo(t) {
  const d = (Date.now() - t) / 1000; if (d < 60) return '剛剛'; if (d < 3600) return Math.floor(d / 60) + ' 分鐘前'; if (d < 86400) return Math.floor(d / 3600) + ' 小時前';
  const a = new Date(t + 8 * 3600e3), n = new Date(Date.now() + 8 * 3600e3); const y = new Date(n); y.setUTCDate(y.getUTCDate() - 1);
  if (a.toISOString().slice(0, 10) === y.toISOString().slice(0, 10)) return '昨天';
  return (a.getUTCFullYear() === n.getUTCFullYear() ? '' : a.getUTCFullYear() + '/') + (a.getUTCMonth() + 1) + '/' + a.getUTCDate();
}
function fAvatar(p) {
  const pal = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#84cc16', '#f97316']; let h = 0; for (const ch of p.nick) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const c = p.official ? 'var(--primary)' : pal[Math.abs(h) % pal.length];
  return `<span class="f-av" style="color:${c};background:color-mix(in srgb, ${c} 20%, transparent)">${esc(p.official ? '官' : [...p.nick][0] || '?')}</span>`;
}
function fPost(p, opt = {}) {
  const t = (S.policy.tiers || []).find((x) => x.name === p.tier); const tc = t ? argb(t.color) : 'var(--primary)';
  const st = p.stance === 1 ? '<span class="f-b up">看多</span>' : p.stance === -1 ? '<span class="f-b down">看空</span>' : '';
  return `<div class="f-post${opt.reply ? ' reply' : ''}" data-fid="${p.id}">
    <div class="f-hd">${fAvatar(p)}<div class="f-who"><div><b>${esc(p.nick)}</b>${p.official ? ' <span class="f-b" style="color:var(--primary)">官方</span>' : ''}${p.tier ? ` <span class="f-b" style="color:${tc}">${esc(p.tier)}</span>` : ''}${p.pinned ? ' <span class="f-b" style="color:var(--primary)">置頂</span>' : ''}</div><div class="small muted">${fAgo(p.at)}</div></div>${st}
      <button class="f-more" data-fm="${p.id}" title="更多">⋯</button></div>
    <div class="f-body${opt.full ? '' : ' clamp'}">${esc(p.body)}</div>
    <div class="f-act"><button data-fl="${p.id}" class="${p.liked ? 'on' : ''}">${p.liked ? '♥' : '♡'} ${p.likes}</button>${opt.reply ? '' : `<button data-fo="${p.id}">💬 ${p.replies} 則回覆</button>`}</div></div>`;
}
function fMeter(bull, bear) {
  const n = bull + bear; const pct = n ? Math.round(bull * 100 / n) : null;
  return `<div class="f-meter"><div class="row between small"><span><b class="up">看多 ${pct == null ? '—' : pct + '%'}</b> <span class="muted">（${bull} 人）</span></span><span><span class="muted">（${bear} 人）</span> <b class="down">看空 ${pct == null ? '—' : 100 - pct + '%'}</b></span></div>
    <div class="f-bar">${pct == null ? '' : `<i class="up-bg" style="width:${pct}%"></i><i class="down-bg" style="width:${100 - pct}%"></i>`}</div>
    <div class="small muted">${pct == null ? '近 30 天還沒有會員表態' : '近 30 天會員表態（每人只計最新一次）'}</div></div>`;
}
// ───────── 會員 ─────────
/** 註冊後的會員資料填寫 */
async function onboarding(isNew) {
  const me = S.me || {}; const p = S.policy; let box = null;
  const v = await dialog(isNew ? '🎉 註冊完成，歡迎加入' : '補充會員資料', `${isNew ? `<div class="notice" style="margin-bottom:10px">會員代號 <b>${esc(me.no || '')}</b>${p.trialDays > 0 ? `　已開始 ${p.trialDays} 天試用（${esc(p.trialName || 'USER')}）` : ''}</div>` : ''}
      <div class="field"><label>暱稱（顯示在會員資料）</label><input id="pfN" maxlength="30" value="${esc(me.name || '')}"></div>
      <div class="field"><label>聯絡方式（選填：LINE ID、手機或 Email，方便開通與通知）</label><input id="pfC" maxlength="60" value="${esc(me.contact || '')}"></div>
      <div class="small muted">資料只給管理員開通會員使用。之後可在「會員」頁修改。${isNew ? '想直接開通正式會員，也可以在會員頁線上申請。' : ''}</div><div id="merr" class="small up"></div>`,
    [['', '稍後'], ['ok', '儲存', 'primary']], (b) => { box = b; return () => (!$('#pfN', b).value.trim() ? '請輸入暱稱' : null); });
  if (v !== 'ok') { store.set('profSkip', true); return; }
  try { const r = await api('profile', { session: S.session, name: $('#pfN', box).value.trim(), contact: $('#pfC', box).value.trim() }); if (r.kicked) return kicked(); S.me = { ...S.me, ...r }; toast('已儲存會員資料'); if (S.route === 'member') route(); }
  catch (e) { toast(/未知動作|驗證失敗/.test(e.message) ? '管理員的會員伺服器需要更新到第 5 版才能儲存，請稍後再試' : e.message, 5000); }
}
async function applyModal(preset = '') {
  const p = S.policy; const m = member(); let box = null;
  const kind = m.status === 'MEMBER' || m.status === 'GRACE' ? 'change' : m.status === 'EXPIRED' ? 'renew' : 'new';
  const v = await dialog('申請開通／升級會員', `<div class="field"><label>申請類型</label><select id="apK"><option value="new" ${kind === 'new' ? 'selected' : ''}>開通正式會員</option><option value="renew" ${kind === 'renew' ? 'selected' : ''}>續約</option><option value="change" ${kind === 'change' ? 'selected' : ''}>變更／升級方案</option></select></div>
      <div class="field"><label>想要的方案</label><select id="apT">${p.plans.map((x) => { const pr = planPrice(p, x); return `<option ${preset === x.name ? 'selected' : ''}>${esc(x.name)} NT$${pr}${pr !== x.price ? '（原價 ' + x.price + '）' : ''}</option>`; }).join('')}</select></div>
      <div class="field"><label>聯絡方式</label><input id="apC" maxlength="60" value="${esc((S.me || {}).contact || '')}" placeholder="LINE ID、手機或 Email"></div>
      <div class="field"><label>留言（選填）</label><textarea id="apM" rows="3" maxlength="200" placeholder="例如付款方式、希望開通時間"></textarea></div>
      <div class="small muted">送出後由管理員審核，開通後授權會自動套用到網頁與手機（同一帳號）。</div><div id="merr" class="small up"></div>`,
    [['', '取消'], ['ok', '送出申請', 'primary']], (b) => { box = b; return () => (!$('#apC', b).value.trim() ? '請留下聯絡方式，方便管理員聯繫' : null); });
  if (v !== 'ok') return;
  try { const r = await api('applyWeb', { session: S.session, kind: $('#apK', box).value, contact: $('#apC', box).value.trim(), name: (S.me || {}).name || '', message: '方案：' + $('#apT', box).value + (($('#apM', box).value.trim()) ? '；' + $('#apM', box).value.trim() : '') });
    if (r.kicked) return kicked(); S.me = { ...S.me, requests: r.requests }; toast('已送出申請，管理員處理後會開通'); if (S.route === 'member') route(); }
  catch (e) { toast(/未知動作|驗證失敗/.test(e.message) ? '管理員的會員伺服器需要更新到第 5 版才能線上申請，請改在手機 App 申請' : e.message, 6000); }
}
/** 手機 App 綁定狀態（伺服器第 7 版起回報） */
function bindHtml(me) {
  if (me.phone === undefined) return '';
  if (me.phone) return `<div class="small" style="margin-top:8px">📱 已綁定手機 App${me.phoneAt ? '（最後登入 ' + esc(String(me.phoneAt).slice(0, 16)) + '）' : ''}</div>`;
  const dl = (S.policy && S.policy.pub) ? S.policy.pub.replace(/\/?$/, '/') + 'app' : location.origin + '/';
  return `<div class="notice" style="margin-top:8px">📱 尚未綁定手機 App（只用網頁也能使用全部會員功能，不受裝置碼限制）。想在手機使用：<a href="${dl}" target="_blank" rel="noopener">下載 App</a> 後在「設置 › 會員與授權 › 帳號與同步」用同一個 Google 帳號登入，第一次登入時可選擇保留網頁版或手機的資料。</div>`;
}
VIEWS.member = {
  title: '會員',
  render() { return head('會員中心') + '<div id="dyn"></div>'; },
  fill() {
    const m = member(); const p = S.policy; const me = S.me || {};
    const prog = m.status === 'TRIAL' && !m.freeRun ? 1 - m.left / Math.max(1, p.trialDays) : m.status === 'MEMBER' && m.left != null && S.code ? 1 - m.left / Math.max(1, (m.exp - S.code.issued)) : null;
    const cols = [];
    if (p.trialDays > 0) cols.push([p.trialName || 'USER', '試用 ' + p.trialDays + ' 天', TRIAL_COLOR, p.trialFeatures, m.status === 'TRIAL']);
    publicTiers(p, m.tierId).forEach((t) => cols.push([t.name, t.desc || '會員', t.color, t.features, (m.status === 'MEMBER' || m.status === 'GRACE') && m.tierId === t.id]));
    cols.push(['到期', '鎖定後', LOCK_COLOR, p.freeFeatures, !!m.locked]);
    const dOn = discActive(p); const base = (() => { const x = p.plans.slice().sort((a, b) => a.months - b.months)[0]; return x ? planPrice(p, x) / x.months : 0; })();
    const priceHtml = p.plans.length && p.payOn !== false ? `<div class="card" style="margin-top:12px"><h2>訂閱方案${dOn ? `<span class="r" style="color:var(--up);font-size:13px">🎉 ${esc(p.discLabel || '限時優惠')} ${offText(p.disc)}${p.discUntil ? '・至 ' + esc(p.discUntil) : ''}</span>` : ''}</h2>
      <div class="grid g4" style="gap:10px">${p.plans.map((x) => { const pr = planPrice(p, x); const save = x.months > 1 && base > 0 ? Math.max(0, Math.round((1 - pr / (base * x.months)) * 100)) : 0;
        return `<div class="tile" style="text-align:center;cursor:pointer" data-plan="${esc(x.name)}"><div style="font-weight:700">${esc(x.name)}${save ? ` <span class="small" style="color:var(--up)">省 ${save}%</span>` : ''}</div>
          ${pr !== x.price ? `<div class="small muted" style="text-decoration:line-through;margin-top:4px">NT$${x.price}</div>` : '<div style="height:4px"></div>'}<div class="num" style="font-size:24px;font-weight:800;color:${pr !== x.price ? 'var(--up)' : 'var(--text)'}">NT$${pr}</div>
          <div class="small muted">平均每月 NT$${Math.round(pr / x.months)}</div><button class="btn sm primary" style="margin-top:8px">申請</button></div>`; }).join('')}</div>
      <div class="small muted" style="margin-top:6px">點選方案即可線上申請，管理員確認付款後開通；開通後網頁與手機同時生效。</div></div>` : '';
    $('#dyn').innerHTML = `<div class="grid g2 stack">
      <div class="card"><div class="row">${badge(m)}<b style="font-size:19px">${esc(m.desc)}</b></div>
        <div class="${m.locked || m.status === 'GRACE' ? 'up' : 'text2'}" style="margin-top:8px">${esc(stateLine(m))}</div>
        ${prog != null ? `<div class="bar" style="margin-top:10px"><div style="width:${Math.min(100, Math.max(2, prog * 100))}%;background:${argb(m.color)}"></div></div>` : ''}
        ${termHtml(m, me)}
        ${S.code ? `<div class="small muted" style="margin-top:8px">授權編號 ${S.code.idText}${S.code.rel ? '　（網頁以簽發日起算；實際以手機啟用日為準）' : ''}</div>` : ''}
        ${p.notice ? `<div class="notice" style="margin-top:10px">📢 ${esc(p.notice)}</div>` : ''}
        ${p.payOn === false ? '<div class="small text2" style="margin-top:12px">🎉 目前為試運作期間，免費使用；正式收費前會另行公告。</div>' : ''}<div class="row wrap ${p.payOn === false ? 'hide' : ''}" style="margin-top:12px"><button class="btn primary" id="apBtn">${m.status === 'MEMBER' ? '升級／變更方案' : m.status === 'EXPIRED' || m.status === 'GRACE' ? '申請續約' : '申請開通會員'}</button><span class="small muted">也可以在手機 App「會員與授權」申請；開通後網頁自動套用。</span></div>
        ${lineOaId() ? `<div class="tile" style="margin-top:12px"><div class="row" style="gap:12px;align-items:center"><img class="line-qr" src="https://qr-official.line.me/sid/L/${encodeURIComponent(lineOaId().slice(1))}.png" alt="LINE QR Code" data-linejoin style="cursor:pointer" onerror="this.remove()">
          <div class="sp"><b>LINE 官方帳號</b><div class="small text2" style="margin-top:2px">開通、續約或方案問題可直接在 LINE 詢問管理員，也能接收每日盤後報告。</div><div style="margin-top:6px">${lineJoinHtml()}</div></div></div></div>` : ''}
        ${(me.requests || []).length ? `<div class="list" style="margin-top:10px">${me.requests.slice().reverse().map((r) => `<div class="it" style="cursor:default"><div class="l"><div class="t1">${esc({ new: '開通', renew: '續約', change: '變更方案' }[r.kind] || r.kind)} ${reqStateTag(r)}</div><div class="t2">${esc(r.at)}　${esc(String(r.message || '').replace(/^［網頁］\S*\s?/, ''))}</div></div></div>`).join('')}</div>` : ''}</div>
      ${riskCardHtml()}
      <div class="card"><h2>會員帳號</h2><div class="row"><div class="logo" style="width:42px;height:42px;font-size:20px;border-radius:50%">${esc((me.name || me.email || '?').slice(0, 1).toUpperCase())}</div>
        <div class="sp"><div><b>${esc(me.name || '會員')}</b>${me.no ? ' <span class="muted">（' + esc(me.no) + '）</span>' : ''}</div><div class="small muted">${esc(me.email || '')}</div></div>
        <button class="btn" id="pfE">編輯</button><button class="btn" id="lo">登出</button></div>
        <div class="grid g2" style="margin-top:10px;gap:8px">${[['會員代號', me.no], ['聯絡方式', me.contact || '未填寫'], ['註冊時間', me.registeredAt ? String(me.registeredAt).slice(0, 16) : ''], ['伺服器版本', me.serverVersion ? '第 ' + me.serverVersion + ' 版' : '第 4 版以前'], ['網頁版本', webVerText(true)], ['網頁版網址', String((S.policy && S.policy.pub) || location.origin + '/').replace(/^https:\/\//, '').replace(/\/$/, '')]].filter(([, v0]) => v0).map(([k, v0]) => `<div><div class="small muted">${k}</div><div class="small">${esc(String(v0))}</div></div>`).join('')}</div>
        <div class="tile" style="margin-top:12px"><div class="row"><div class="sp"><b>手機⇄網頁資料同步</b><div class="small muted"><span class="syncst"></span></div></div>
          <button class="btn sm" id="syn">立即同步</button><button class="btn sm" id="dl">從雲端重新下載</button></div>
          <div class="row" style="gap:8px;margin-top:8px"><span class="tag" style="${phoneMaster() ? 'color:var(--primary);border-color:var(--primary)' : ''}">📱 手機 → 網頁</span><span class="tag" style="${S.cloudDir === 'w2p' ? 'color:var(--primary);border-color:var(--primary)' : ''}">💻 網頁 → 手機</span></div>
          <label class="row small" style="margin-top:8px;cursor:pointer;gap:6px"><input type="checkbox" id="sAuto" style="width:auto" ${autoSync() ? 'checked' : ''}> 自動同步（關閉時只在按「立即同步」時上傳／下載，不會跳出提醒）</label>
          ${bindHtml(me)}
          <div class="small text2" style="margin-top:6px">${phoneMaster() ? '目前以手機為主：手機的變更會自動出現在這裡；網頁上的修改不會上傳。要在網頁記帳或編輯，請在手機「會員與授權 › 帳號與同步」把同步方向改為「網頁 → 手機」。'
            : S.cloudDir === 'w2p' ? (me.phone === false ? '目前只在網頁使用：資料存放在雲端，換電腦或瀏覽器登入同一帳號即可帶回。' : '目前以網頁為主：在這裡的修改會上傳，手機開啟 App 時自動下載；手機上的修改不會上傳。') : '尚未設定同步方向（舊版雙向同步）；請更新手機 App 後在「會員與授權 › 帳號與同步」選擇方向。'}</div>
          <div class="row" style="margin-top:10px;gap:8px;align-items:center"><div class="sp small"><b>🔒 端對端加密${S.e2ee ? '（已開啟）' : ''}</b><div class="${!S.e2ee && S.sealed ? 'up' : 'muted'}">${S.e2ee ? '同步資料在瀏覽器以同步密碼加密後才上傳，伺服器與管理員都無法讀取。' : S.sealed ? '雲端資料已加密：請輸入手機設定的同步密碼。' : '開啟後同步資料先在瀏覽器加密再上傳，只有知道同步密碼的裝置能讀取。'}</div></div><button class="btn sm" id="e2e">${S.e2ee ? '變更' : '設定'}</button></div>
          <div class="small muted" style="margin-top:6px">自選、群組、交易、持股、帳戶與提醒；資料存放在管理員的會員伺服器${S.e2ee ? '（端對端加密）' : ''}。同一帳號網頁同時只能在一個瀏覽器登入。手機需用同一個 Google 帳號登入才會同步。</div></div></div></div>
      ${priceHtml}<div class="card" style="margin-top:12px"><h2>會員等級方案</h2><div class="scroll-x"><table class="tbl cmp"><thead><tr><th>功能</th>${cols.map(([n, s, c, , cur]) => `<th style="${cur ? 'background:' + argb(c) + '22' : ''}"><span class="badge" style="color:${argb(c)};border-color:${argb(c)}">${esc(n)}</span><div class="small muted">${esc(s)}${cur ? '・目前' : ''}</div></th>`).join('')}</tr></thead>
        <tbody>${FEATURES.map(([k, t]) => `<tr><td>${esc(t)}</td>${cols.map(([, , c, mask]) => `<td style="color:${mask & F[k] ? argb(c) : 'var(--border)'};font-weight:700">${mask & F[k] ? '✓' : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="small muted" style="margin-top:6px">自選、持股記帳、個股行情等基本功能各等級皆可使用。</div></div>`;
    $('#pfE').onclick = () => onboarding(false);
    if (me.no) { $('#pfE').closest('.card').insertAdjacentHTML('afterend', promoHtml(me)); promoBind(me); }
    if (lineOaId()) { $('#pfE').closest('.card').insertAdjacentHTML('beforeend', '<div id="lineBind"></div>'); lineBindFill(); }
    $('#e2e').onclick = () => e2eeModal();
    $('#sAuto').onchange = (e) => { S.pref.syncAuto = e.target.checked; savePref(); toast(e.target.checked ? '已改為自動同步' : '已改為手動同步：按「立即同步」才會上傳／下載'); renderSync(); };
    $('#apBtn').onclick = () => applyModal();
    $$('[data-plan]').forEach((el) => el.onclick = () => applyModal(el.dataset.plan));
    $('#lo').onclick = async () => { let ck = false;
      if ((await dialog('登出', '登出後這個瀏覽器的投資資料會清除（雲端資料保留），重新登入即可恢復。<label class="row small" style="gap:6px;margin-top:10px;cursor:pointer;justify-content:flex-start"><input type="checkbox" id="loK" style="width:auto"> 同時清除這個瀏覽器保存的 API 金鑰（共用電腦建議勾選）</label>',
        [['', '取消'], ['ok', '登出', 'primary']], (b) => () => { ck = $('#loK', b).checked; return null; })) === 'ok') logout(undefined, ck); };
    $('#pfE').closest('.card').insertAdjacentHTML('beforeend', '<div class="row" style="margin-top:12px;gap:16px"><a href="/web/risk.html" target="_blank" rel="noopener" class="small">投資風險告知書</a><a href="/web/privacy.html" target="_blank" rel="noopener" class="small">隱私權政策</a><a href="/web/terms.html" target="_blank" rel="noopener" class="small">使用者條款</a><a href="/web/notice.html" target="_blank" rel="noopener" class="small">資料來源與授權</a><a href="javascript:void 0" id="delAcc" class="small muted">刪除帳號</a></div>');
    $('#delAcc').onclick = () => deleteAccountModal(me);
    $('#syn').onclick = async () => { await syncNow(); this.fill(); };
    $('#dl').onclick = async () => { if ((await dialog('從雲端重新下載', '以雲端資料取代這個網頁的資料？（尚未上傳的變更會遺失）', [['', '取消'], ['ok', '下載', 'primary']])) !== 'ok') return; S.dirty = false; await pull(true); toast('已下載雲端資料'); route(); };
    renderSync();
  },
  syms() { return []; },
};

/** LINE 綁定（會員資料庫在 D1 時開放）：產生 6 位數綁定碼，在官方帳號傳「綁定 123456」 */
async function lineBindFill(code) {
  const el = $('#lineBind'); if (!el) return;
  let st; try { st = await api('lineStatus', { session: S.session }); } catch (e) { el.remove(); return; }
  if (st.kicked) return kicked();
  const oa = lineOaId(); const msg = code ? 'https://line.me/R/oaMessage/' + encodeURIComponent(oa) + '/?' + encodeURIComponent('綁定 ' + code) : '';
  el.innerHTML = `<div class="tile" style="margin-top:12px"><div class="row"><div class="sp"><b>LINE 綁定</b><div class="small ${st.bound && !st.friend ? 'up' : 'muted'}">${st.bound ? (st.friend ? '已綁定官方帳號（' + esc(st.boundAt) + '），到價提醒與會員通知會傳到 LINE' : '已綁定，但你已封鎖官方帳號，收不到通知') : '綁定後，LINE 上設定的到價提醒會歸到你的會員帳號'}</div></div>
      <button class="btn sm ${st.bound ? '' : 'primary'}" id="lbCode">${st.bound ? '重新綁定' : '產生綁定碼'}</button>${st.bound ? '<button class="btn sm" id="lbOff">解除綁定</button>' : ''}</div>
    ${code ? `<div style="margin-top:10px"><div style="font-size:24px;font-weight:700;letter-spacing:4px" class="num">${code}</div><div class="small muted">10 分鐘內在官方帳號 ${esc(oa)} 傳送「綁定 ${code}」即可完成。</div>
      <div class="row" style="gap:8px;margin-top:8px"><a class="btn sm primary" href="${msg}" target="_blank" rel="noopener">開啟 LINE 傳送</a><button class="btn sm" id="lbRe">完成後更新狀態</button></div></div>` : ''}</div>`;
  $('#lbCode').onclick = async () => { try { const r = await api('lineCode', { session: S.session }); lineBindFill(r.code); } catch (e) { toast(e.message); } };
  if ($('#lbOff')) $('#lbOff').onclick = async () => { if ((await dialog('解除 LINE 綁定', '解除後到價提醒與會員通知不再對應你的會員帳號。', [['', '取消'], ['ok', '解除', 'primary']])) !== 'ok') return; try { await api('lineUnbind', { session: S.session }); lineBindFill(); } catch (e) { toast(e.message); } };
  if ($('#lbRe')) $('#lbRe').onclick = () => lineBindFill();
}

// ───────── 股息 ─────────
function barsHtml(items, color) {
  const max = Math.max(1, ...items.map((x) => x[1]));
  return `<div class="bars">${items.map(([k, v, sub]) => `<div class="b"><div class="v num">${v ? fmtInt(v) : ''}</div><div class="col" style="height:${(v / max * 100).toFixed(1)}%;background:${color}"></div><div class="k">${esc(k)}</div>${sub ? `<div class="k">${esc(sub)}</div>` : ''}</div>`).join('')}</div>`;
}
VIEWS.div = {
  title: '股息',
  render() { return head('股息', `<button class="btn primary" id="addD">＋ 記錄股息</button>`) + '<div id="dyn"></div>'; },
  bind() { $('#addD').onclick = () => tradeModal(null, { t: 'DIVIDEND' }); },
  async fill() {
    if (!can('DIVTAX')) { $('#dyn').innerHTML = lockCard('DIVTAX'); return; }
    const lg = ledger(); const today = ymd(); const fx = usdTwd();
    const divs = D.trades().filter((t) => t.t === 'DIVIDEND');
    const got = divs.filter((t) => lg.dividendById && lg.dividendById[t.id] != null).map((t) => ({ ...t, net: lg.dividendById[t.id] }));
    const pending = divs.filter((t) => String(t.d).replace(/-/g, '/') > today);
    const year = new Date().getFullYear();
    const byYear = {}; got.forEach((t) => { const y = String(t.d).slice(0, 4); byYear[y] = (byYear[y] || 0) + t.net; });
    const months = Array.from({ length: 12 }, (_, i) => [String(i + 1) + '月', got.filter((t) => String(t.d).startsWith(year + '/' + String(i + 1).padStart(2, '0'))).reduce((a, t) => a + t.net, 0)]);
    const bySym = {}; got.forEach((t) => { bySym[t.s] = (bySym[t.s] || 0) + t.net; });
    const [plans, divh] = await Promise.all([kv('sx:plans'), kv('sx:divh')]);
    if (S.route !== 'div') return;
    const P = portfolio(); const held = Object.fromEntries(P.rows.map((r) => [r.symbol, r]));
    // 依近 12 個月配息估算全年股息
    const yearAgo = (() => { const d = tpeNow(); d.setFullYear(d.getFullYear() - 1); return ymd(d); })();
    const dhAll = Object.fromEntries(await Promise.all(P.rows.map(async (r) => [r.symbol, await divHist(r.symbol)]))); if (S.route !== 'div') return;
    const est = P.rows.map((r) => { const h = dhAll[r.symbol] || []; const ps = h.filter(([d]) => d >= yearAgo).reduce((a, [, c]) => a + c, 0); return { r, ps, amt: ps * r.shares * divNetFactor(r.symbol) }; }).filter((x) => x.ps > 0).sort((a, b) => b.amt - a.amt);
    const estTotal = est.reduce((a, x) => a + x.amt, 0); const costTw = est.reduce((a, x) => a + x.r.cost, 0);
    const upSyms = Array.from(new Set(P.rows.map((r) => r.symbol).concat(D.quotes().map((q) => q.s))));
    const upcoming = upSyms.map((s) => [s, plans && plans[s]]).filter(([, p]) => p && p.ex >= today).sort((a, b) => a[1].ex.localeCompare(b[1].ex));
    let h = `<div class="grid g4" style="margin-bottom:12px">
      <div class="tile"><div class="k">今年已入帳</div><div class="v num">${fmtInt(byYear[year] || 0)}</div></div>
      <div class="tile"><div class="k">去年全年</div><div class="v num">${fmtInt(byYear[year - 1] || 0)}</div></div>
      <div class="tile"><div class="k">預估年股息（近 12 個月配息，美股稅後）</div><div class="v num">${fmtInt(estTotal)}</div><div class="s muted">成本殖利率 ${costTw ? (estTotal / costTw * 100).toFixed(2) : '—'}%</div></div>
      <div class="tile"><div class="k">待入帳</div><div class="v num">${fmtInt(pending.reduce((a, t) => a + tGross(t) * (isUs(t.s) ? 0.7 * fx : 1) - (isUs(t.s) ? 0 : t.fee || 0), 0))}</div><div class="s muted">${pending.length} 筆發放日未到</div></div></div>`;
    h += `<div class="grid g2 stack"><div class="card"><h2>${year} 年每月股息</h2>${barsHtml(months, 'var(--primary)')}</div>
      <div class="card"><h2>歷年股息</h2>${Object.keys(byYear).length ? barsHtml(Object.keys(byYear).sort().slice(-8).map((y) => [y, byYear[y]]), '#a855f7') : '<div class="empty">尚無股息紀錄</div>'}</div></div>`;
    h += `<div class="card" style="margin-top:12px"><h2>即將除權息（持股與自選）</h2>${upcoming.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>個股</th><th>除息日</th><th>最後買進</th><th>發放日</th><th>現金股利</th><th>持有股數</th><th>預估入帳</th></tr></thead><tbody>${upcoming.map(([s, p]) => {
      const r = held[s]; return `<tr class="click" data-go="#/s/${s}"><td class="nm">${esc(D.name(s))} <span class="muted small num">${s}</span>${r ? ' <span class="tag" style="color:var(--primary)">持股</span>' : ''}</td><td>${esc(p.ex)}</td><td>${esc(p.lb || '—')}</td><td>${esc(p.pay || '—')}</td>
        <td class="num">${p.cash ? fmt(p.cash, 4) : '—'}${p.stock ? '<div class="small muted">股票 ' + p.stock + '</div>' : ''}</td><td class="num">${r ? fmtInt(r.shares) : '—'}</td><td class="num">${r && p.cash ? fmtInt(p.cash * r.shares) : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="muted small">近期沒有除權息。</div>'}</div>`;
    h += `<div class="grid g2 stack" style="margin-top:12px"><div class="card"><h2>預估年股息明細</h2>${est.length ? `<table class="tbl"><thead><tr><th>個股</th><th>近 12 月每股</th><th>預估</th><th>成本殖利率</th></tr></thead><tbody>${est.map((x) => `<tr class="click" data-go="#/s/${x.r.symbol}"><td class="nm">${esc(x.r.name)}</td><td class="num">${fmt(x.ps, 3)}</td><td class="num">${fmtInt(x.amt)}</td><td class="num">${x.r.cost ? (x.amt / x.r.cost * 100).toFixed(2) + '%' : '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="muted small">台股持股近 12 個月沒有配息資料。</div>'}</div>
      <div class="card"><h2>累計股息（依個股）</h2>${Object.keys(bySym).length ? `<table class="tbl"><thead><tr><th>個股</th><th>累計實收</th></tr></thead><tbody>${Object.entries(bySym).sort((a, b) => b[1] - a[1]).map(([s, v]) => `<tr class="click" data-go="#/s/${s}"><td class="nm">${esc(D.name(s))} <span class="muted small num">${s}</span></td><td class="num">${fmtInt(v)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted small">尚無股息紀錄。</div>'}</div></div>`;
    // 配息月份分布（依近 12 個月除息月份 × 持股）
    const mat = P.rows.map((r) => { const hs = (dhAll[r.symbol] || []).filter(([d]) => d >= yearAgo); const m = Array(12).fill(0); const nf = divNetFactor(r.symbol);
      hs.forEach(([d, c]) => { m[Number(String(d).slice(5, 7)) - 1] += c * r.shares * nf; }); return [r, m]; }).filter(([, m]) => m.some((v) => v > 0));
    if (mat.length) {
      const col = Array.from({ length: 12 }, (_, i) => mat.reduce((a, [, m]) => a + m[i], 0)); const mxv = Math.max(...col, 1);
      h += `<div class="card" style="margin-top:12px"><h2>配息月份分布<span class="r small muted">${col.filter((v) => v > 0).length}／12 個月有股息</span></h2><div class="scroll-x"><table class="tbl"><thead><tr><th>個股</th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}月</th>`).join('')}</tr></thead><tbody>
        ${mat.map(([r, m]) => `<tr><td class="nm">${esc(r.name)}</td>${m.map((v) => `<td class="num" style="${v ? 'color:var(--primary)' : 'color:var(--border)'}">${v ? fmtInt(v) : '·'}</td>`).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><td>合計</td>${col.map((v) => `<td class="num" style="background:color-mix(in srgb, var(--primary) ${Math.round(v / mxv * 35)}%, transparent)">${v ? fmtInt(v) : '—'}</td>`).join('')}</tr></tfoot></table></div>
        <div class="small muted" style="margin-top:6px">依近 12 個月的除息月份推估（以除息月計，實際入帳約晚 3～5 週）。空白月份可考慮搭配其他月份配息的標的。</div></div>`;
    }
    h += `<div class="card" style="margin-top:12px"><h2>股息紀錄</h2>${divs.length ? `<div class="list">${divs.slice().sort((a, b) => b.d.localeCompare(a.d)).slice(0, 60).map((t) => `<div class="it" data-ed="${t.id}"><div class="l"><div class="t1">${esc(D.name(t.s))} <span class="muted small num">${t.s}</span>${String(t.d).replace(/-/g, '/') > today ? ' <span class="tag" style="color:var(--warn)">待入帳</span>' : ''}</div><div class="t2">${esc(t.d)} · ${fmt(t.n, 0)} 股 × ${fmt(t.p, 4)}</div></div><div class="r num">${lg.dividendById && lg.dividendById[t.id] != null ? fmtInt(lg.dividendById[t.id]) : fmtInt(tGross(t))}</div></div>`).join('')}</div>` : '<div class="muted small">按右上「記錄股息」新增。</div>'}</div>`;
    $('#dyn').innerHTML = h;
    $$('[data-ed]').forEach((b) => b.onclick = () => tradeModal(D.trades().find((t) => String(t.id) === b.dataset.ed)));
  },
  syms() { return holdings().map((h) => h.symbol); },
};

// ───────── 投資分析 ─────────
VIEWS.analysis = {
  title: '投資分析',
  render() { return head('投資分析') + `<div class="chips" style="margin-bottom:12px">${[['perf', '已實現損益'], ['review', '績效回顧'], ['alloc', '配置分析'], ['rev', '持股營收'], ['rebal', '再平衡'], ['health', '組合診斷'], ['cost', '交易成本'], ['goal', '目標規劃']].map(([k, n]) => `<button class="chip ${(S.pref.an || 'perf') === k ? 'on' : ''}" data-an="${k}">${n}</button>`).join('')}</div><div id="dyn"></div>`; },
  bind() { $$('[data-an]').forEach((b) => b.onclick = () => { S.pref.an = b.dataset.an; savePref(); route(); }); },
  fill() {
    if (!can('ANALYSIS')) { $('#dyn').innerHTML = lockCard('ANALYSIS'); return; }
    const tab = S.pref.an || 'perf';
    if (tab === 'perf') return this.perf();
    if (tab === 'alloc') return this.alloc();
    if (tab === 'review') return this.review();
    if (tab === 'health') return this.health();
    if (tab === 'cost') return this.cost();
    if (tab === 'goal') return this.goal();
    if (tab === 'rev') return can('STOCKPRO') ? fmHoldRev($('#dyn')) : ($('#dyn').innerHTML = lockCard('STOCKPRO', '持股月營收'));
    return this.rebal();
  },
  /** 績效回顧：依資產紀錄算每年與每月報酬（扣除入出金）、與 0050 比較 */
  async review() {
    const nav = kjson('nav', {}); const days = Object.keys(nav).sort();
    if (days.length < 5) { $('#dyn').innerHTML = '<div class="card empty">資產紀錄不足。手機 App 每天會自動記錄總資產，同步後即可看到績效回顧。</div>'; return; }
    const flows = D.cashFlows(); const flowBetween = (a, b) => flows.filter((f) => { const d = String(f.d).replace(/\//g, '-'); return d > a && d <= b; }).reduce((s0, f) => s0 + f.a, 0);
    const per = (keyOf) => { const g = {}; days.forEach((d) => { const k = keyOf(d); (g[k] = g[k] || []).push(d); });
      return Object.entries(g).map(([k, ds], i, arr) => { const prevEnd = i ? arr[i - 1][1][arr[i - 1][1].length - 1] : ds[0]; const end = ds[ds.length - 1]; const startV = nav[prevEnd];
        const fl = flowBetween(prevEnd, end); const ret = startV ? (nav[end] - startV - fl) / startV * 100 : 0; return [k, ret, nav[end] - startV - fl]; }); };
    const years = per((d) => d.slice(0, 4)); const months = per((d) => d.slice(0, 7)).slice(-12);
    let bench = null; const b = barCache['0050' + '5y'] || (barCache['0050' + '5y'] = await loadBars('0050', '5y'));
    if (S.route !== 'analysis') return;
    if (b && b.length) { const m = new Map(b.map((x) => [x.d.replace(/\//g, '-'), x.c])); const first = days.find((d) => m.has(d)); const last = days.slice().reverse().find((d) => m.has(d));
      if (first && last && first !== last) bench = (m.get(last) / m.get(first) - 1) * 100; }
    const total = (() => { let v = 1; years.forEach(([, r]) => { v *= 1 + r / 100; }); return (v - 1) * 100; })();
    $('#dyn').innerHTML = `<div class="grid g3" style="margin-bottom:12px"><div class="tile"><div class="k">期間報酬（${esc(days[0])} 起，扣除入出金）</div><div class="v num ${cls(total)}">${fmtPct(total)}</div></div>
      <div class="tile"><div class="k">同期 0050（不含息）</div><div class="v num ${cls(bench || 0)}">${bench == null ? '—' : fmtPct(bench)}</div></div>
      <div class="tile"><div class="k">超額報酬</div><div class="v num ${cls(total - (bench || 0))}">${bench == null ? '—' : fmtPct(total - bench)}</div></div></div>
      <div class="grid g2 stack"><div class="card"><h2>每年報酬</h2><table class="tbl"><thead><tr><th>年度</th><th>報酬率</th><th>損益（扣入出金）</th></tr></thead><tbody>${years.map(([k, r, v]) => `<tr><td>${k}</td><td class="num ${cls(r)}">${fmtPct(r)}</td><td class="num ${cls(v)}">${fmtSigned(v)}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h2>近 12 個月</h2><div class="mcal">${months.map(([k, r]) => `<div class="mc" style="background:color-mix(in srgb, ${css(r >= 0 ? '--up' : '--down')} ${Math.round(Math.min(60, Math.abs(r) * 6) + 8)}%, var(--card2))"><div class="small">${k.slice(2).replace('-', '/')}</div><div class="num">${fmtPct(r, 1)}</div></div>`).join('')}</div></div></div>
      <div class="small muted" style="margin-top:8px">以每日總資產紀錄計算（時間加權近似），已扣除期間的入金與出金。</div>`;
  },
  /** 健康檢查：集中度、虧損部位、現金比例、配置偏離 */
  health() {
    const P = portfolio(); const tg = kjson('targets', {}); const ind = kjson('industries', {});
    if (!P.rows.length) { $('#dyn').innerHTML = '<div class="card empty">尚無持股。</div>'; return; }
    const g = P.mv + Math.max(0, P.cash) || 1; const lev = (n) => /正2|反1|反向|槓桿|2X|-1X|ULTRA|PROSHARES/i.test(n);
    const input = { positions: P.rows.map((r) => { const etf = D.isEtf(r.symbol) || /^00/.test(r.symbol);
        return { symbol: r.symbol, name: r.name, type: etf ? (r.us ? '美國 ETF' : '台股 ETF') : r.us ? '美股個股' : '台股個股', industry: etf ? null : ind[r.symbol] || null, weight: r.mv / g * 100, plPct: r.plPct, yieldPct: null, broadEtf: etf && !lev(r.name), us: r.us }; }),
      cashPct: P.cash / g * 100, marginPct: (P.margin || 0) / g * 100, shortPct: (P.shorts || []).reduce((a, x) => a + x.n * x.px, 0) / g * 100 };
    const r = pfDiag(input); const m = r.metrics;
    const dev = Object.keys(tg).length ? P.rows.map((x) => Math.abs(x.weight - (tg[x.symbol] || 0))).reduce((a, v) => Math.max(a, v), 0) : null;
    if (dev != null) r.findings.push({ level: dev <= 5 ? 0 : 1, title: '目標配置偏離', detail: `最大偏離 ${dev.toFixed(1)} 個百分點（建議 ≤ 5，見「再平衡」）` });
    const col = r.score >= 70 ? 'var(--down)' : r.score >= 55 ? 'var(--warn)' : 'var(--up)'; const ic = ['✅', '⚠️', '⛔'];
    const key = 'pf:' + ymd() + ':' + hashStr(JSON.stringify(pfDiagJson(input, r))); const cached = aiCacheGet(key);
    $('#dyn').innerHTML = `<div class="card" style="margin-bottom:12px"><div class="row" style="gap:14px"><div style="font-size:44px;font-weight:800;color:${col}" class="num">${r.score}</div><div><b style="color:${col}">${r.grade}</b><div class="small muted">${m.count} 檔 · 等效分散 ${m.effectiveN.toFixed(1)} 檔 · 最大持股 ${m.top1.toFixed(1)}% · 前三大 ${m.top3.toFixed(1)}% · ETF ${m.etfPct.toFixed(0)}% · 現金 ${Math.max(0, input.cashPct).toFixed(1)}%</div></div></div></div>
      <div class="grid g2 stack"><div class="card"><h2>本地診斷</h2><div class="list">${r.findings.map((f) => `<div class="it" style="cursor:default"><span style="font-size:18px">${ic[f.level]}</span><div class="l"><div class="t1">${esc(f.title)}</div><div class="t2" style="white-space:normal">${esc(f.detail)}</div></div></div>`).join('')}</div>
        <div class="small muted" style="margin-top:8px">評分依集中度、產業、槓桿、現金、匯率與套牢部位估算（與手機 App 相同規則）。</div></div>
        <div class="card"><h2>AI 綜合解讀<span class="r"><button class="btn sm" id="pfAi">${cached ? '重新分析' : 'AI 解讀'}</button></span></h2><div id="pfOut">${cached ? pfAiHtml(cached) : `<div class="small muted">${aiChain().length ? '按「AI 解讀」把上方百分比資料交給 AI 綜合解讀。' : '在 設定 › AI 個股體檢 設定任一家 AI 服務金鑰後可使用。'}</div>`}</div>
        <div class="small muted" style="margin-top:8px">送給 AI 的只有權重、報酬率等百分比，不含金額與交易紀錄；金鑰只存在這個瀏覽器。</div></div></div>`;
    $('#pfAi').onclick = async () => {
      if (!can('AI')) { toast('AI 解讀為會員功能'); return; } const chain = aiChain(); if (!chain.length) { toast('請先設定 AI 金鑰'); return; }
      $('#pfAi').disabled = true; $('#pfOut').innerHTML = '<div class="small muted">AI 分析中…</div>'; let err = '';
      const sys = await fetch('/web/pfskill.json?v=' + Math.floor(Date.now() / 3600000)).then((x) => x.json()).then((o) => o.prompt).catch(() => '你是投資組合顧問，只根據輸入 JSON 解讀，輸出 JSON：style, summary, strengths, risks, actions。');
      for (const p of chain) {
        try { const { text, model } = await aiCall(p, sys, JSON.stringify(pfDiagJson(input, r)), 1200, 0.2); const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
          if (!o.summary) throw new Error('回應不是有效 JSON'); o.by = model; o.date = ymd(); o._at = Date.now(); aiCachePut(key, o); if (S.route === 'analysis') $('#pfOut').innerHTML = pfAiHtml(o); $('#pfAi').disabled = false; $('#pfAi').textContent = '重新分析'; return; }
        catch (e) { err = e.message; }
      }
      $('#pfOut').innerHTML = `<div class="notice err">${esc(err || 'AI 分析失敗')}</div>`; $('#pfAi').disabled = false;
    };
  },
  /** 交易成本：手續費與交易稅 */
  cost() {
    const ts = D.trades().filter((t) => t.t === 'BUY' || t.t === 'SELL'); const fx = (t) => (isUs(t.s) ? t.x || usdTwd() : 1);
    const by = {}; ts.forEach((t) => { const y = String(t.d).slice(0, 4); const o = (by[y] = by[y] || { fee: 0, tax: 0, amt: 0, n: 0 }); o.fee += (t.fee || 0) * fx(t); o.tax += (t.tax || 0) * fx(t); o.amt += tGross(t) * fx(t); o.n++; });
    const accs = D.accounts(); const byAcc = {}; ts.forEach((t) => { const k = (accs.find((a) => a.id === Number(t.acc)) || { n: '未指定' }).n; byAcc[k] = (byAcc[k] || 0) + (t.fee || 0) * fx(t); });
    const tot = Object.values(by).reduce((a, o) => ({ fee: a.fee + o.fee, tax: a.tax + o.tax, amt: a.amt + o.amt, n: a.n + o.n }), { fee: 0, tax: 0, amt: 0, n: 0 });
    $('#dyn').innerHTML = `<div class="grid g4" style="margin-bottom:12px"><div class="tile"><div class="k">累計手續費</div><div class="v num">${fmtInt(tot.fee)}</div></div><div class="tile"><div class="k">累計交易稅</div><div class="v num">${fmtInt(tot.tax)}</div></div>
      <div class="tile"><div class="k">交易筆數</div><div class="v num">${tot.n}</div></div><div class="tile"><div class="k">成本占成交金額</div><div class="v num">${tot.amt ? ((tot.fee + tot.tax) / tot.amt * 100).toFixed(3) : 0}%</div></div></div>
      <div class="grid g2 stack"><div class="card"><h2>依年度</h2><table class="tbl"><thead><tr><th>年度</th><th>筆數</th><th>成交金額</th><th>手續費</th><th>交易稅</th></tr></thead><tbody>${Object.keys(by).sort().reverse().map((y) => `<tr><td>${y}</td><td class="num">${by[y].n}</td><td class="num">${fmtInt(by[y].amt)}</td><td class="num">${fmtInt(by[y].fee)}</td><td class="num">${fmtInt(by[y].tax)}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h2>依帳戶手續費</h2><table class="tbl"><tbody>${Object.entries(byAcc).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmtInt(v)}</td></tr>`).join('')}</tbody></table><div class="small muted" style="margin-top:6px">在「現金與帳戶」設定券商折扣，新交易會自動試算。</div></div></div>`;
  },
  /** 目標規劃：目標金額與日期 → 每月需投入 */
  goal() {
    const P = portfolio(); const now = P.mv + P.cash - P.debt; const amt = knum('goalAmount', 0); const mon = String(kget('goalMonth', '') || '');
    const months = (() => { const m = mon.match(/(\d{4})-(\d{1,2})/); if (!m) return 0; const d = tpeNow(); return Math.max(0, (+m[1] - d.getFullYear()) * 12 + (+m[2] - 1 - d.getMonth())); })();
    const r = (S.pref.goalR ?? 6) / 100 / 12; const fvNow = now * Math.pow(1 + r, months); const need = months ? Math.max(0, (amt - fvNow) * (r ? r / (Math.pow(1 + r, months) - 1) : 1 / months)) : 0;
    $('#dyn').innerHTML = `<div class="grid g2 stack"><div class="card"><h2>財務目標</h2>
      <div class="grid g2"><div class="field"><label>目標金額（台幣）</label><input id="ga" type="number" value="${amt || ''}" placeholder="10000000"></div><div class="field"><label>達成年月</label><input id="gm" type="month" value="${esc(mon)}"></div></div>
      <div class="field"><label>預期年化報酬（%）</label><input id="gr" type="number" step="0.5" value="${S.pref.goalR ?? 6}"></div><button class="btn primary" id="gs2" style="margin-top:10px">儲存目標（與手機同步）</button></div>
      <div class="card"><h2>進度</h2>${amt ? `<div class="num" style="font-size:30px;font-weight:800">${(now / amt * 100).toFixed(1)}%</div><div class="bar" style="margin:8px 0"><div style="width:${Math.min(100, now / amt * 100)}%;background:var(--primary)"></div></div>
        <div class="small text2">目前總資產 ${fmtInt(now)}／目標 ${fmtInt(amt)}，還差 ${fmtInt(Math.max(0, amt - now))}</div>
        ${months ? `<div class="tile" style="margin-top:12px"><div class="k">距離目標 ${months} 個月，以年化 ${S.pref.goalR ?? 6}% 估算，每月需投入</div><div class="v num">${fmtInt(need)}</div><div class="s muted">現有資產到期預估成長為 ${fmtInt(fvNow)}</div></div>` : '<div class="small muted" style="margin-top:8px">設定達成年月即可估算每月需投入金額。</div>'}`
        : '<div class="muted small">輸入目標金額與日期開始規劃。</div>'}</div></div>`;
    $('#gs2').onclick = () => { const a = parseFloat($('#ga').value) || 0; kset('goalAmount', Math.round(a), 'l'); kset('goalMonth', $('#gm').value, 's'); S.pref.goalR = parseFloat($('#gr').value) || 0; savePref(); changed(); toast('已儲存目標'); this.goal(); };
  },
  perf() {
    const lg = ledger(); if (lg.err) { $('#dyn').innerHTML = `<div class="notice err">${esc(lg.err)}</div>`; return; }
    const sells = D.trades().filter((t) => (t.t === 'SELL' || (t.sh && t.t === 'BUY')) && lg.realizedById[t.id] != null).map((t) => ({ ...t, r: lg.realizedById[t.id] }));
    const byYear = {}; sells.forEach((t) => { const y = String(t.d).slice(0, 4); byYear[y] = (byYear[y] || 0) + t.r; });
    const years = Object.keys(byYear).sort(); const y = S.pref.anY && byYear[S.pref.anY] != null ? S.pref.anY : years[years.length - 1] || String(new Date().getFullYear());
    const months = Array.from({ length: 12 }, (_, i) => sells.filter((t) => String(t.d).startsWith(y + '/' + String(i + 1).padStart(2, '0'))).reduce((a, t) => a + t.r, 0));
    const bySym = {}; sells.forEach((t) => { (bySym[t.s] = bySym[t.s] || { r: 0, n: 0, w: 0 }); bySym[t.s].r += t.r; bySym[t.s].n++; if (t.r > 0) bySym[t.s].w++; });
    const win = sells.filter((t) => t.r > 0), loss = sells.filter((t) => t.r < 0);
    const total = sells.reduce((a, t) => a + t.r, 0);
    let h = `<div class="grid g4" style="margin-bottom:12px">
      <div class="tile"><div class="k">累計已實現</div><div class="v num ${cls(total)}">${fmtSigned(total)}</div></div>
      <div class="tile"><div class="k">勝率</div><div class="v num">${sells.length ? (win.length / sells.length * 100).toFixed(1) + '%' : '—'}</div><div class="s muted">${win.length} 勝 ${loss.length} 敗</div></div>
      <div class="tile"><div class="k">平均獲利</div><div class="v num up">${win.length ? fmtSigned(win.reduce((a, t) => a + t.r, 0) / win.length) : '—'}</div></div>
      <div class="tile"><div class="k">平均虧損</div><div class="v num down">${loss.length ? fmtSigned(loss.reduce((a, t) => a + t.r, 0) / loss.length) : '—'}</div></div></div>`;
    h += `<div class="card"><h2>${esc(y)} 年每月已實現<span class="r"><select id="anY" style="width:auto">${(years.length ? years : [y]).map((x) => `<option ${x === y ? 'selected' : ''}>${x}</option>`).join('')}</select></span></h2>
      <div class="mcal">${months.map((v, i) => `<div class="mc" style="background:${v ? `color-mix(in srgb, ${css(v > 0 ? '--up' : '--down')} ${Math.min(70, 15 + Math.abs(v) / Math.max(1, ...months.map(Math.abs)) * 55).toFixed(0)}%, var(--card2))` : 'var(--card2)'}"><div class="small">${i + 1} 月</div><div class="num">${v ? fmtSigned(v) : '—'}</div></div>`).join('')}</div>
      <div class="small muted" style="margin-top:8px">全年 <span class="num ${cls(byYear[y] || 0)}">${fmtSigned(byYear[y] || 0)}</span></div></div>`;
    h += `<div class="card" style="margin-top:12px"><h2>依個股</h2>${Object.keys(bySym).length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>個股</th><th>賣出次數</th><th>勝率</th><th>已實現損益</th></tr></thead><tbody>${Object.entries(bySym).sort((a, b) => b[1].r - a[1].r).map(([s, v]) => `<tr class="click" data-go="#/s/${s}"><td class="nm">${esc(D.name(s))} <span class="muted small num">${s}</span></td><td class="num">${v.n}</td><td class="num">${(v.w / v.n * 100).toFixed(0)}%</td><td class="num ${cls(v.r)}">${fmtSigned(v.r)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted small">尚無賣出紀錄。</div>'}</div>`;
    $('#dyn').innerHTML = h;
    $('#anY').onchange = () => { S.pref.anY = $('#anY').value; savePref(); this.perf(); };
  },
  alloc() {
    const P = portfolio(); const total = P.mv + P.cash - P.debt; const ind = kjson('industries', {});
    const group = (fn) => { const m = {}; P.rows.forEach((r) => { const k = fn(r); m[k] = (m[k] || 0) + r.mv; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#22c55e', '#ef4444', '#14b8a6', '#ec4899', '#64748b', '#eab308', '#0ea5e9'];
    const block = (title, list, base) => `<div class="card"><h2>${title}</h2><div class="bar">${list.map(([, v], i) => `<div style="width:${(v / base * 100).toFixed(2)}%;background:${COLORS[i % COLORS.length]}"></div>`).join('')}</div>
      <table class="tbl" style="margin-top:8px"><tbody>${list.map(([k, v], i) => `<tr><td><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${COLORS[i % COLORS.length]};margin-right:6px"></i>${esc(k)}</td><td class="num">${fmtInt(v)}</td><td class="num">${base ? (v / base * 100).toFixed(1) : 0}%</td></tr>`).join('')}</tbody></table></div>`;
    $('#dyn').innerHTML = `<div class="grid g2 stack">
      ${block('資產類別', [['台股', P.rows.filter((r) => !r.us).reduce((a, r) => a + r.mv, 0)], ['美股', P.rows.filter((r) => r.us).reduce((a, r) => a + r.mv, 0)], ['現金', Math.max(0, P.cash)]].filter((x) => x[1] > 0), total)}
      ${block('股票與 ETF', group((r) => (D.isEtf(r.symbol) ? 'ETF' : '個股') + (r.us ? '（美）' : '（台）')), P.mv)}
      ${block('產業', group((r) => ind[r.symbol] || (D.isEtf(r.symbol) ? 'ETF' : '未分類')), P.mv)}
      ${block('前十大持股', P.rows.slice().sort((a, b) => b.mv - a.mv).slice(0, 10).map((r) => [r.name, r.mv]), P.mv)}</div>`;
  },
  rebal() {
    const P = portfolio(); const tg = kjson('targets', {});
    const syms = Array.from(new Set(P.rows.map((r) => r.symbol).concat(Object.keys(tg))));
    const sumT = syms.reduce((a, s) => a + (Number(tg[s]) || 0), 0);
    const rows = syms.map((s) => { const r = P.rows.find((x) => x.symbol === s); const mv = r ? r.mv : 0; const t = Number(tg[s]) || 0; const want = P.mv * t / 100; const q = S.q[s] || {};
      const px = (q.price || (r && r.price) || 0) * (isUs(s) ? usdTwd() : 1); return { s, mv, cur: P.mv ? mv / P.mv * 100 : 0, t, diff: want - mv, sh: px ? (want - mv) / px : 0 }; });
    $('#dyn').innerHTML = `<div class="card"><h2>目標配置與再平衡<span class="r muted">目標合計 <b class="${Math.abs(sumT - 100) < 0.05 ? '' : 'up'}">${sumT.toFixed(1)}%</b></span></h2>
      <div class="small muted" style="margin-bottom:8px">輸入每檔的目標占比（與手機 App「再平衡」同步），系統依目前持股市值試算要買賣的金額與股數。</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>個股</th><th>目前市值</th><th>目前占比</th><th>目標占比</th><th>需調整金額</th><th>約股數</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="nm">${esc(D.name(r.s))} <span class="muted small num">${r.s}</span></td>
        <td class="num">${fmtInt(r.mv)}</td><td class="num">${r.cur.toFixed(1)}%</td><td><input class="tg" data-s="${r.s}" type="number" step="0.1" min="0" max="100" value="${r.t || ''}" style="width:90px;text-align:right"></td>
        <td class="num ${r.t ? cls(r.diff) : ''}">${r.t ? (r.diff > 0 ? '買 ' : '賣 ') + fmtInt(Math.abs(r.diff)) : '—'}</td><td class="num">${r.t && r.sh ? fmtInt(Math.abs(r.sh)) + ' 股' : '—'}</td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" id="eq">平均分配</button><button class="btn sm" id="cu">目標＝目前</button><button class="btn sm danger" id="cl">清除目標</button></div></div>`;
    const save = (o) => { ksetJson('targets', o); changed(); this.rebal(); };
    $$('.tg').forEach((i) => i.onchange = () => { const o = kjson('targets', {}); const v = parseFloat(i.value); if (v > 0) o[i.dataset.s] = v; else delete o[i.dataset.s]; save(o); });
    $('#eq').onclick = () => { const n = P.rows.length; if (!n) return; const o = {}; P.rows.forEach((r) => { o[r.symbol] = Math.round(1000 / n) / 10; }); save(o); };
    $('#cu').onclick = () => { const o = {}; P.rows.forEach((r) => { o[r.symbol] = Math.round(r.weight * 10) / 10; }); save(o); };
    $('#cl').onclick = () => save({});
  },
  syms() { return holdings().map((h) => h.symbol); },
};

// ───────── 提醒（由手機 App 推播） ─────────
const ALERT_T = {
  PRICE_ABOVE: ['價格高於', '價格'], PRICE_BELOW: ['價格低於', '價格'], CHANGE_UP: ['單日漲幅達', '%'], CHANGE_DOWN: ['單日跌幅達', '%'],
  EXDIV: ['除息前', '天'], EARNINGS: ['財報前', '天'], US_OPEN: ['美股開盤', ''], RAPID: ['5 分鐘急漲急跌', '%'], BIG_TRADE: ['逐筆大單', '張'],
  KEY_LEVEL: ['三關突破跌破', ''], ENTRY_SIGNAL: ['進場訊號變化', ''],
};
function alertTitle(a) {
  const [n, u] = ALERT_T[a.t] || [a.t, '']; const who = a.s ? D.name(a.s) + ' ' + a.s : (a.t === 'US_OPEN' ? '' : '全部持股');
  return (who ? who + ' ' : '') + n + (u && a.v ? ' ' + (u === '價格' ? fmt(a.v, 2) : a.v + ' ' + u) : '');
}
VIEWS.alerts = {
  title: '提醒',
  render() { return head('提醒', `<button class="btn primary" id="addA">＋ 新增提醒</button>`) + '<div id="dyn"></div>'; },
  bind() { $('#addA').onclick = () => alertModal(); },
  fill() {
    if (!can('ALERTS')) { $('#dyn').innerHTML = lockCard('ALERTS'); return; }
    const list = kjson('alertsV2', []);
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const dist = (a) => { const q = S.q[a.s] || {}; if (!q.price || !a.v) return ''; if (a.t === 'PRICE_ABOVE' || a.t === 'PRICE_BELOW') { const d = (a.v / q.price - 1) * 100; return '　距離 ' + fmtPct(d); } if ((a.t === 'CHANGE_UP' || a.t === 'CHANGE_DOWN') && q.prev) return '　今日 ' + fmtPct((q.price / q.prev - 1) * 100); return ''; };
    $('#dyn').innerHTML = `<div class="card" style="margin-bottom:12px"><h2>網頁提醒</h2>
        <div class="row wrap" style="gap:14px"><label class="row small"><input type="checkbox" id="waOn" ${S.pref.webAlert === false ? '' : 'checked'} style="width:auto"> 網頁開著時也提醒（價格、漲跌幅）</label>
          <label class="row small"><input type="checkbox" id="waSnd" ${S.pref.aSound === false ? '' : 'checked'} style="width:auto"> 提示音</label>
          ${perm === 'granted' ? '<span class="small" style="color:#16a34a">✓ 已允許瀏覽器通知</span>' : perm === 'denied' ? '<span class="small down">瀏覽器已封鎖通知，請在網址列左側的網站設定開啟</span>' : perm === 'unsupported' ? '<span class="small muted">這個瀏覽器不支援通知</span>' : '<button class="btn sm primary" id="waPerm">允許瀏覽器通知</button>'}
          <button class="btn sm" id="waTest">測試提醒</button></div>
        <div class="small muted" style="margin-top:6px">手機 App 仍會在背景推播；網頁版只在分頁開著時檢查（每次行情更新），同一則提醒每天最多通知一次。在這裡新增或修改的提醒會同步到手機。</div></div>
      <div class="card">${list.length ? `<div class="list">${list.map((a) => { const q = S.q[a.s] || {};
        return `<div class="it" style="cursor:default"><div class="l"><div class="t1 ${a.on === false ? 'muted' : ''}">${esc(alertTitle(a))}</div><div class="t2">${a.s && q.price ? '現價 ' + fmtPrice(q.price) + dist(a) + '　' : ''}${a.f ? '上次觸發 ' + esc(a.f) : '尚未觸發'}</div></div>
        <label class="row small"><input type="checkbox" data-on="${a.id}" ${a.on === false ? '' : 'checked'} style="width:auto"> 啟用</label><button class="btn sm danger" data-del="${a.id}">刪除</button></div>`; }).join('')}</div>` : '<div class="empty">尚無提醒。</div>'}</div>`;
    $$('[data-on]').forEach((c) => c.onchange = () => { ksetJson('alertsV2', kjson('alertsV2', []).map((a) => String(a.id) === c.dataset.on ? { ...a, on: c.checked } : a)); changed(); });
    $$('[data-del]').forEach((b) => b.onclick = () => { ksetJson('alertsV2', kjson('alertsV2', []).filter((a) => String(a.id) !== b.dataset.del)); changed(); this.fill(); });
    $('#waOn').onchange = (e) => { S.pref.webAlert = e.target.checked; savePref(); };
    $('#waSnd').onchange = (e) => { S.pref.aSound = e.target.checked; savePref(); };
    if ($('#waPerm')) $('#waPerm').onclick = async () => { try { await Notification.requestPermission(); } catch (e) {} this.fill(); };
    $('#waTest').onclick = () => webNotify('測試提醒', '這是網頁版提醒的樣子', '#/alerts');
  },
  syms() { return kjson('alertsV2', []).map((a) => a.s).filter(Boolean); },
};
async function alertModal(sym) {
  const types = ['PRICE_ABOVE', 'PRICE_BELOW', 'CHANGE_UP', 'CHANGE_DOWN', 'EXDIV'];
  let made = null;
  const r = await dialog('新增提醒', `<div class="field search"><label>代號</label><input id="as" value="${esc(sym || '')}" placeholder="2330、AAPL" autocomplete="off"><div class="res hide"></div></div>
    <div class="field"><label>條件</label><select id="at">${types.map((t) => `<option value="${t}">${ALERT_T[t][0]}</option>`).join('')}</select></div>
    <div class="field"><label id="avl">價格</label><input id="av" type="number" step="any"></div><div id="merr" class="small up" style="margin-top:6px"></div>`, [['', '取消'], ['ok', '新增', 'primary']], (root) => {
    const upd = () => { const t = $('#at', root).value; $('#avl', root).textContent = ALERT_T[t][1] === '價格' ? '價格' : ALERT_T[t][1] === '%' ? '漲跌幅（%）' : '天數'; const s2 = $('#as', root).value.trim().toUpperCase(); if (ALERT_T[t][1] === '價格' && !$('#av', root).value && S.q[s2]) $('#av', root).placeholder = '現價 ' + S.q[s2].price; };
    $('#at', root).onchange = upd; bindSearch($('#as', root), (s2) => { $('#as', root).value = s2; refreshQuotes([s2]).then(upd); });
    upd();
    return () => {
      const s2 = $('#as', root).value.trim().toUpperCase(); const t = $('#at', root).value; const v = parseFloat($('#av', root).value);
      if (!s2) return '請輸入代號'; if (!(v > 0)) return '請輸入數值';
      const list = kjson('alertsV2', []); made = list.concat([{ id: Math.max(0, ...list.map((a) => +a.id || 0)) + 1, s: s2, t, v, on: true, f: '' }]); return null;
    };
  });
  if (r === 'ok' && made) { ksetJson('alertsV2', made); changed(); toast('已新增提醒，手機同步後生效'); route(); }
}

// ───────── 現金與帳戶 ─────────
const FLOW_C = ['入金', '出金', '利息', '費用', '其他'];
// ───────── 自訂策略回測（與 App StrategyBacktest 相同算法；共用 app/src/test/resources/strategy_cases.txt） ─────────
const STRAT_K = { ma_up: ['均線黃金交叉', '短均線', '長均線', 5, 20], ma_down: ['均線死亡交叉', '短均線', '長均線', 5, 20], above_ma: ['收盤站上均線', '均線天數', null, 20, 0], below_ma: ['收盤跌破均線', '均線天數', null, 20, 0],
  rsi_below: ['RSI(14) 低於', '數值', null, 30, 0], rsi_above: ['RSI(14) 高於', '數值', null, 70, 0], kd_up: ['KD 黃金交叉', 'K 值低於（0＝不限）', null, 30, 0], kd_down: ['KD 死亡交叉', 'K 值高於（0＝不限）', null, 70, 0],
  break_high: ['突破 N 日新高', '天數', null, 20, 0], break_low: ['跌破 N 日新低', '天數', null, 10, 0], drop_from_high: ['自 N 日高點回落', '跌幅 %', '天數', 20, 60] };
const STRAT_P = [['均線黃金交叉', [['ma_up', 5, 20]], [['ma_down', 5, 20]], 0, 0, 0], ['站上季線、跌破出場', [['above_ma', 60]], [['below_ma', 60]], 0, 0, 0],
  ['RSI 超賣反彈', [['rsi_below', 30]], [['rsi_above', 70]], 15, 0, 0], ['KD 低檔金叉', [['kd_up', 25]], [['kd_down', 75]], 10, 0, 0],
  ['突破 20 日新高', [['break_high', 20]], [['break_low', 10]], 8, 0, 0], ['跌深 20% 分批', [['drop_from_high', 20, 60]], [], 0, 20, 250]];
function stratSma(c, n) { const out = []; let s = 0; for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; out.push(n > 0 && i >= n - 1 ? s / n : null); } return out; }
function stratRsi(c, n = 14) { const out = c.map(() => null); if (c.length <= n) return out; let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } let ag = g / n, al = l / n; const v = () => (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  out[n] = v(); for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (n - 1) + Math.max(d, 0)) / n; al = (al * (n - 1) + Math.max(-d, 0)) / n; out[i] = v(); } return out; }
function stratKd(b, n = 9) { const k = b.map(() => null), d = b.map(() => null); let pk = 50, pd = 50;
  for (let i = n - 1; i < b.length; i++) { let hh = -Infinity, ll = Infinity; for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, b[j].h); ll = Math.min(ll, b[j].l); }
    const rsv = hh - ll > 0 ? (b[i].c - ll) / (hh - ll) * 100 : 50; pk = pk * 2 / 3 + rsv / 3; pd = pd * 2 / 3 + pk / 3; k[i] = pk; d[i] = pd; } return [k, d]; }
function stratDays(a, b) { const f = (s) => Date.parse(String(s).slice(0, 10).replace(/\//g, '-') + 'T00:00:00Z'); const x = (f(b) - f(a)) / 86400000; return isNaN(x) ? null : Math.round(x); }
function stratRun(b, st, buyCost, sellCost) {
  if (b.length < 2 || !st.entry.length) return null;
  const c = b.map((x) => x.c); const smaC = {}; const sma = (n) => smaC[n] || (smaC[n] = stratSma(c, n)); let rsiC = null, kdC = null;
  const rsi = () => rsiC || (rsiC = stratRsi(c)); const kd = () => kdC || (kdC = stratKd(b));
  const cross = (f, s, i, up) => { if (i < 1) return false; const f0 = f[i - 1], s0 = s[i - 1], f1 = f[i], s1 = s[i]; if (f0 == null || s0 == null || f1 == null || s1 == null) return false; return up ? f0 <= s0 && f1 > s1 : f0 >= s0 && f1 < s1; };
  const met = (x, i) => { const [k, p1, p2] = x; const n1 = Math.trunc(p1), n2 = Math.trunc(p2 || 0);
    switch (k) {
      case 'ma_up': return cross(sma(n1), sma(n2), i, true); case 'ma_down': return cross(sma(n1), sma(n2), i, false);
      case 'above_ma': { const m = sma(n1)[i]; return m != null && c[i] > m; } case 'below_ma': { const m = sma(n1)[i]; return m != null && c[i] < m; }
      case 'rsi_below': { const r = rsi()[i]; return r != null && r < p1; } case 'rsi_above': { const r = rsi()[i]; return r != null && r > p1; }
      case 'kd_up': { const [K, D] = kd(); return cross(K, D, i, true) && (p1 <= 0 || (K[i] ?? 100) < p1); }
      case 'kd_down': { const [K, D] = kd(); return cross(K, D, i, false) && (p1 <= 0 || (K[i] ?? 0) > p1); }
      case 'break_high': { if (!(n1 > 0 && i >= n1)) return false; let m = -Infinity; for (let j = i - n1; j < i; j++) m = Math.max(m, b[j].h); return c[i] > m; }
      case 'break_low': { if (!(n1 > 0 && i >= n1)) return false; let m = Infinity; for (let j = i - n1; j < i; j++) m = Math.min(m, b[j].l); return c[i] < m; }
      case 'drop_from_high': { if (!(n2 > 0 && i >= n2 - 1)) return false; let m = -Infinity; for (let j = i - n2 + 1; j <= i; j++) m = Math.max(m, b[j].h); return c[i] <= m * (1 - p1 / 100); }
    } return false; };
  let cash = 1, units = 0, inPos = false, entryPx = 0, entryIdx = -1, entryDate = '', pendEntry = false, pendExit = null, held = 0; const trades = [], eq = [];
  for (let i = 0; i < b.length; i++) {
    const px = b[i].o > 0 ? b[i].o : b[i].c;
    if (pendExit && inPos) { cash = units * px * (1 - sellCost); trades.push({ ed: entryDate, ep: entryPx, xd: b[i].d, xp: px, ret: ((px * (1 - sellCost)) / (entryPx * (1 + buyCost)) - 1) * 100, bars: i - entryIdx, why: pendExit }); units = 0; inPos = false; pendExit = null; }
    if (pendEntry && !inPos) { units = cash / (px * (1 + buyCost)); cash = 0; inPos = true; entryPx = px; entryIdx = i; entryDate = b[i].d; pendEntry = false; }
    if (inPos) { held++; const r = (b[i].c / entryPx - 1) * 100;
      pendExit = st.sl > 0 && r <= -st.sl ? '停損' : st.tp > 0 && r >= st.tp ? '停利' : st.hold > 0 && i - entryIdx >= st.hold ? '持有期滿' : st.exit.some((x) => met(x, i)) ? '出場條件' : null; }
    else if (st.entry.every((x) => met(x, i))) pendEntry = true;
    eq.push(inPos ? units * b[i].c : cash);
  }
  const last = b[b.length - 1];
  if (inPos) trades.push({ ed: entryDate, ep: entryPx, xd: last.d, xp: last.c, ret: ((last.c * (1 - sellCost)) / (entryPx * (1 + buyCost)) - 1) * 100, bars: b.length - 1 - entryIdx, why: '期末未平倉' });
  const endEq = inPos ? units * last.c * (1 - sellCost) : cash; let peak = 0, mdd = 0; eq.forEach((v) => { peak = Math.max(peak, v); if (peak > 0) mdd = Math.min(mdd, (v / peak - 1) * 100); });
  const wins = trades.filter((t) => t.ret > 0), losses = trades.filter((t) => t.ret <= 0); const dd = stratDays(b[0].d, last.d); const yrs = dd == null ? null : dd / 365.25;
  const avg = (l) => (l.length ? l.reduce((a, t) => a + t.ret, 0) / l.length : null); const ls = losses.reduce((a, t) => a + t.ret, 0);
  return { trades, total: (endEq - 1) * 100, cagr: yrs != null && yrs >= 0.5 && endEq > 0 ? (endEq ** (1 / yrs) - 1) * 100 : null, bh: (last.c / b[0].c - 1) * 100, mdd: -mdd,
    win: trades.length ? wins.length * 100 / trades.length : null, avgWin: avg(wins), avgLoss: avg(losses), pf: ls < 0 ? wins.reduce((a, t) => a + t.ret, 0) / -ls : null,
    exposure: held * 100 / b.length, eq, hold: b.map((x) => x.c / b[0].c), open: inPos };
}
function stratCosts(us, etf, disc) { return us ? [0, 0] : [0.001425 * disc, 0.001425 * disc + (etf ? 0.001 : 0.003)]; }

// ───────── 投資組合診斷（與 App PortfolioDiag 相同規則；只用百分比） ─────────
function pfDiag(i) {
  const ps = i.positions.filter((p) => p.weight > 0).sort((a, b) => b.weight - a.weight); const f1 = (v) => v.toFixed(1);
  const inv = ps.reduce((a, p) => a + p.weight, 0); const w = ps.map((p) => p.weight / inv * 100);
  const top1 = w[0], top3 = w.slice(0, 3).reduce((a, v) => a + v, 0); const hhi = w.reduce((a, v) => a + (v / 100) ** 2, 0); const effN = hhi > 0 ? 1 / hhi : 0;
  const stocks = ps.filter((p) => !p.broadEtf); const ts = stocks[0]; const tsp = ts ? ts.weight / inv * 100 : 0;
  const im = {}; stocks.filter((p) => p.industry).forEach((p) => { im[p.industry] = (im[p.industry] || 0) + p.weight / inv * 100; }); const ind = Object.entries(im).sort((a, b) => b[1] - a[1])[0];
  const etfPct = ps.filter((p) => p.broadEtf).reduce((a, p) => a + p.weight, 0) / inv * 100; const usdPct = ps.filter((p) => p.us).reduce((a, p) => a + p.weight, 0) / Math.max(1e-9, inv + i.cashPct) * 100;
  const deep = ps.filter((p) => p.plPct <= -20); const deepPct = deep.reduce((a, p) => a + p.weight, 0) / inv * 100;
  const yw = ps.filter((p) => p.yieldPct != null); const ywS = yw.reduce((a, p) => a + p.weight, 0); const yieldPct = ywS >= inv * 0.5 ? yw.reduce((a, p) => a + p.weight * p.yieldPct, 0) / ywS : null;
  let score = 100; const out = []; const F = (level, title, detail) => out.push({ level, title, detail });
  if (ts && tsp >= 40) { score -= 25; F(2, '單一個股過度集中', `「${ts.name}」占持股 ${f1(tsp)}%，個股出狀況時整體受傷大。`); }
  else if (ts && tsp >= 25) { score -= 12; F(1, '單一個股比重偏高', `「${ts.name}」占持股 ${f1(tsp)}%，可設定停損或分散。`); }
  if (ps.length >= 4 && effN < 3 && etfPct < 50) { score -= 8; F(1, '權重集中', `等效分散檔數約 ${f1(effN)} 檔，前三大合計 ${f1(top3)}%。`); }
  if (ps.length <= 3 && etfPct < 50) { score -= 10; F(1, '持股檔數少', `只有 ${ps.length} 檔且以個股為主，分散不足。`); }
  if (ind && ind[1] >= 50 && stocks.length >= 2) { score -= 10; F(1, '產業集中', `「${ind[0]}」占持股 ${f1(ind[1])}%，產業循環時同漲同跌。`); }
  if (effN >= 8 || etfPct >= 50) F(0, '分散度良好', etfPct >= 50 ? `分散型 ETF 占持股 ${f1(etfPct)}%，核心部位穩健。` : `等效分散 ${f1(effN)} 檔。`);
  if (i.marginPct >= 30) { score -= 18; F(2, '融資槓桿高', `融資占總資產 ${f1(i.marginPct)}%，股價下跌時虧損放大並可能被追繳。`); }
  else if (i.marginPct >= 10) { score -= 6; F(1, '使用融資', `融資占總資產 ${f1(i.marginPct)}%，留意維持率。`); }
  if (i.shortPct >= 10) { score -= 6; F(1, '放空部位', `放空市值占總資產 ${f1(i.shortPct)}%，上漲風險理論上無上限。`); }
  if (i.cashPct < 3) { score -= 5; F(1, '現金偏低', `現金只占總資產 ${f1(Math.max(0, i.cashPct))}%，建議保留緊急預備金。`); }
  else if (i.cashPct > 50) { score -= 3; F(1, '現金比重高', `現金占總資產 ${f1(i.cashPct)}%，長期可能跑輸通膨。`); }
  else if (i.cashPct >= 5 && i.cashPct <= 30) F(0, '現金水位適中', `現金占總資產 ${f1(i.cashPct)}%。`);
  if (usdPct >= 60) { score -= 4; F(1, '美元資產比重高', `美股占總資產 ${f1(usdPct)}%，台幣升值時有匯損。`); }
  if (deepPct >= 20) { score -= 10; F(2, '深度套牢部位', `虧損超過 20% 的持股占 ${f1(deepPct)}%：${deep.slice(0, 3).map((p) => p.name).join('、')}，請檢視原本買進理由是否還成立。`); }
  else if (deep.length) F(1, '個別虧損持股', deep.slice(0, 3).map((p) => p.name + ' ' + f1(p.plPct) + '%').join('、') + '。');
  if (i.maxDrawdownPct != null) { if (i.maxDrawdownPct >= 35) { score -= 8; F(2, '回撤幅度大', `近一年最大回撤 ${f1(i.maxDrawdownPct)}%，需確認能承受同樣跌幅。`); } else if (i.maxDrawdownPct <= 15) F(0, '回撤可控', `近一年最大回撤 ${f1(i.maxDrawdownPct)}%。`); }
  if (i.volPct != null && i.volPct >= 35) { score -= 4; F(1, '波動度高', `年化波動 ${f1(i.volPct)}%。`); }
  if (i.ret1y != null && i.bench1y != null) { const d = i.ret1y - i.bench1y; if (d >= 0) F(0, '績效優於大盤', `近一年 ${f1(i.ret1y)}%，台灣 50 為 ${f1(i.bench1y)}%。`); else F(1, '績效落後大盤', `近一年 ${f1(i.ret1y)}%，落後台灣 50（${f1(i.bench1y)}%）${f1(-d)} 個百分點，可考慮以市值型 ETF 為核心。`); }
  if (yieldPct != null && yieldPct >= 4) F(0, '現金流穩定', `加權殖利率約 ${f1(yieldPct)}%。`);
  const sc = Math.round(Math.min(100, Math.max(0, score))); const grade = sc >= 85 ? '穩健' : sc >= 70 ? '良好' : sc >= 55 ? '普通' : sc >= 40 ? '偏高風險' : '高風險';
  return { score: sc, grade, metrics: { count: ps.length, top1, top1Name: ps[0].name, top3, effectiveN: effN, topIndustry: ind ? ind[0] : null, topIndustryPct: ind ? ind[1] : 0, etfPct, usdPct, lossDeepPct: deepPct, yieldPct, investedPct: inv },
    findings: out.map((f, k) => [f, k]).sort((a, b) => b[0].level - a[0].level || a[1] - b[1]).map((x) => x[0]) };
}
function hashStr(t) { let h = 0; for (let k = 0; k < t.length; k++) h = (h * 31 + t.charCodeAt(k)) | 0; return (h >>> 0).toString(36); }
function pfDiagJson(i, r) { const d = (v) => Math.round(v * 10) / 10; const m = r.metrics;
  const o = { score: r.score, grade: r.grade, positions: i.positions.slice().sort((a, b) => b.weight - a.weight).slice(0, 30).map((p) => ({ symbol: p.symbol, name: p.name, type: p.type, industry: p.industry, weightPct: d(p.weight), plPct: d(p.plPct), yieldPct: p.yieldPct == null ? null : d(p.yieldPct), broadEtf: p.broadEtf })),
    cashPct: d(i.cashPct), marginPct: d(i.marginPct), shortPct: d(i.shortPct), usdPct: d(m.usdPct), top1Pct: d(m.top1), top3Pct: d(m.top3), effectiveN: d(m.effectiveN), topIndustry: m.topIndustry, topIndustryPct: d(m.topIndustryPct), etfPct: d(m.etfPct), lossDeepPct: d(m.lossDeepPct), yieldPct: m.yieldPct == null ? null : d(m.yieldPct),
    findings: r.findings.map((f) => ({ level: f.level, title: f.title, detail: f.detail })) };
  ['maxDrawdownPct', 'volPct'].forEach((k) => { if (i[k] != null) o[k] = d(i[k]); }); if (i.ret1y != null) o.ret1yPct = d(i.ret1y); if (i.bench1y != null) o.bench1yPct = d(i.bench1y); return o; }
function pfAiHtml(o) { const L = (k, l) => (l && l.length ? `<div style="margin-top:8px"><b>${k}</b>${l.map((x) => `<div class="small">・${esc(x)}</div>`).join('')}</div>` : '');
  return `${o.style ? `<span class="tag">${esc(o.style)}</span>` : ''}<div style="margin-top:6px">${esc(o.summary || '')}</div>${L('優點', o.strengths)}${L('風險', o.risks)}${L('調整方向', o.actions)}<div class="small muted" style="margin-top:8px">${esc(o.by || '')} · ${esc(o.date || '')} · 僅供參考，非投資建議</div>`; }

VIEWS.strategy = {
  title: '策略回測',
  render(arg) { if (arg) this.sym = arg.toUpperCase(); this.sym = this.sym || (holdings()[0] || {}).symbol || '0050';
    if (!this.st) this.preset(0);
    return head('策略回測') + `<div class="grid g2 stack"><div class="card"><h2>設定</h2>
      <div class="field search"><label>股票代號</label><input id="sgS" value="${esc(this.sym)}" autocomplete="off"><div class="res hide"></div><div id="sgN" class="small muted" style="margin-top:3px">${esc(D.name(this.sym))} · 還原權值日 K（含息）</div></div>
      <div class="seg" style="margin:6px 0 10px">${[['1y', '1 年'], ['2y', '2 年'], ['5y', '5 年'], ['10y', '10 年']].map(([k, n]) => `<button data-sr="${k}" class="${(this.range || '2y') === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="chips" style="margin-bottom:10px">${STRAT_P.map((p, i) => `<button class="chip ${this.st.name === p[0] ? 'on' : ''}" data-sp="${i}">${esc(p[0])}</button>`).join('')}</div>
      <div id="sgE"></div>
      <div class="grid g3" style="margin-top:8px"><div class="field"><label>停損 %</label><input id="sgSl" type="number" step="any" value="${this.st.sl || ''}"></div><div class="field"><label>停利 %</label><input id="sgTp" type="number" step="any" value="${this.st.tp || ''}"></div><div class="field"><label>最多持有（交易日）</label><input id="sgH" type="number" step="1" value="${this.st.hold || ''}"></div></div>
      <div class="field"><label>台股手續費折數（1＝不打折）</label><input id="sgD" type="number" step="any" value="${this.disc ?? ((D.accounts().find((a) => !a.m || a.m === 'TW') || {}).d || 0.6)}"></div>
      <div class="small muted">收盤時判斷訊號、隔天開盤成交；一次一個部位、全額進出複利計算。台股賣出另計證交稅（股票 0.3%、ETF 0.1%）。與手機 App 相同算法。</div>
      <button class="btn primary" id="sgGo" style="margin-top:10px;width:100%">開始回測</button></div>
      <div id="sgR"><div class="card empty">設定條件後按「開始回測」。</div></div></div>`; },
  preset(i) { const p = STRAT_P[i]; this.st = { name: p[0], entry: p[1].map((x) => [x[0], x[1] ?? STRAT_K[x[0]][3], x[2] ?? STRAT_K[x[0]][4]]), exit: p[2].map((x) => [x[0], x[1] ?? STRAT_K[x[0]][3], x[2] ?? STRAT_K[x[0]][4]]), sl: p[3], tp: p[4], hold: p[5] }; },
  conds() {
    const ed = (key, title, hint) => `<div style="margin-top:8px"><div class="row" style="justify-content:space-between"><b>${title}</b><select data-add="${key}" style="width:auto"><option value="">＋ 條件</option>${Object.entries(STRAT_K).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></div>
      ${this.st[key].length ? this.st[key].map((c, i) => { const K = STRAT_K[c[0]]; return `<div class="row" style="gap:6px;margin-top:6px;align-items:flex-end"><div style="flex:1.3;font-size:13px">${K[0]}</div>
        <div class="field" style="flex:1;margin:0"><label>${K[1]}</label><input type="number" step="any" data-c="${key}:${i}:1" value="${c[1]}"></div>${K[2] ? `<div class="field" style="flex:1;margin:0"><label>${K[2]}</label><input type="number" step="any" data-c="${key}:${i}:2" value="${c[2]}"></div>` : ''}
        <button class="btn sm" data-del="${key}:${i}">✕</button></div>`; }).join('') : `<div class="small muted">${hint}</div>`}</div>`;
    $('#sgE').innerHTML = ed('entry', '進場（全部成立）', '至少要有一個進場條件。') + ed('exit', '出場（任一成立）', '沒有出場條件時，只靠停損、停利或持有天數出場。');
    $$('[data-add]').forEach((el) => el.onchange = () => { const k = el.value; if (!k) return; this.st[el.dataset.add].push([k, STRAT_K[k][3], STRAT_K[k][4]]); this.st.name = '自訂'; this.conds(); });
    $$('[data-c]').forEach((el) => el.oninput = () => { const [k, i, j] = el.dataset.c.split(':'); this.st[k][+i][+j] = +el.value || 0; this.st.name = '自訂'; });
    $$('[data-del]').forEach((el) => el.onclick = () => { const [k, i] = el.dataset.del.split(':'); this.st[k].splice(+i, 1); this.st.name = '自訂'; this.conds(); });
  },
  bind() {
    this.conds();
    $$('[data-sp]').forEach((b) => b.onclick = () => { this.preset(+b.dataset.sp); route(); });
    $$('[data-sr]').forEach((b) => b.onclick = () => { this.range = b.dataset.sr; $$('[data-sr]').forEach((x) => x.classList.toggle('on', x === b)); });
    bindSearch($('#sgS'), (sym) => { $('#sgS').value = sym; this.sym = sym; $('#sgN').textContent = D.name(sym) + ' · 還原權值日 K（含息）'; });
    $('#sgGo').onclick = () => this.go();
  },
  async go() {
    const sym = $('#sgS').value.trim().toUpperCase(); if (!sym) return toast('請輸入股票代號'); this.sym = sym;
    this.st.sl = +$('#sgSl').value || 0; this.st.tp = +$('#sgTp').value || 0; this.st.hold = Math.trunc(+$('#sgH').value || 0); this.disc = Math.min(1, Math.max(0, +$('#sgD').value || 0.6));
    if (!this.st.entry.length) return toast('至少要有一個進場條件');
    $('#sgR').innerHTML = '<div class="card empty">下載歷史價格並回測中…</div>'; $('#sgGo').disabled = true;
    try {
      const r0 = await fetchYahoo(ysym(sym), this.range || '2y', '1d', 3600); if (!r0 || !r0.timestamp) throw new Error('查無 ' + sym + ' 的歷史價格');
      const q = r0.indicators.quote[0]; const adj = ((r0.indicators.adjclose || [])[0] || {}).adjclose || [];
      const bars = []; const seen = new Set();
      r0.timestamp.forEach((t, i) => { const c0 = q.close[i]; if (!(c0 > 0)) return; const f = adj[i] > 0 ? adj[i] / c0 : 1; const dd = new Date((t + 8 * 3600) * 1000);
        const d = dd.getUTCFullYear() + '/' + String(dd.getUTCMonth() + 1).padStart(2, '0') + '/' + String(dd.getUTCDate()).padStart(2, '0'); if (seen.has(d)) return; seen.add(d);
        const c = c0 * f, o = (q.open[i] > 0 ? q.open[i] : c0) * f; bars.push({ d, o, h: (q.high[i] > 0 ? q.high[i] : Math.max(q.open[i] || c0, c0)) * f, l: (q.low[i] > 0 ? q.low[i] : Math.min(q.open[i] || c0, c0)) * f, c }); });
      if (bars.length < 30) throw new Error('歷史資料不足');
      const [bc, sc] = stratCosts(isUs(sym), D.isEtf(sym) || /^00/.test(sym), this.disc);
      const r = stratRun(bars, this.st, bc, sc); if (!r) throw new Error('資料不足，無法回測');
      if (S.route === 'strategy') this.show(sym, r, bars);
    } catch (e) { $('#sgR').innerHTML = `<div class="notice err">${esc(e.message || '回測失敗')}</div>`; }
    $('#sgGo').disabled = false;
  },
  show(sym, r, bars) {
    const P = (v, d = 1) => (v == null ? '—' : fmtPct(v, d)); const d = r.total - r.bh;
    $('#sgR').innerHTML = `<div class="card"><h2>${esc(D.name(sym))} ${esc(sym)} 回測結果<span class="r small muted">${esc(bars[0].d)}～${esc(bars[bars.length - 1].d)}</span></h2>
      <div class="grid g2"><div class="tile"><div class="k">策略報酬</div><div class="v num ${cls(r.total)}">${P(r.total)}</div></div><div class="tile"><div class="k">買進持有</div><div class="v num ${cls(r.bh)}">${P(r.bh)}</div></div></div>
      <div style="margin:6px 0;font-weight:700;color:${d >= 0 ? 'var(--primary)' : 'var(--text2)'}">${d >= 0 ? '勝過' : '落後'}買進持有 ${Math.abs(d).toFixed(1)} 個百分點</div>
      <div class="chart-wrap" id="sgC"><canvas></canvas><div class="chart-tip"></div></div><div class="small muted">策略淨值與買進持有（起點 = 0%）</div>
      <table class="tbl" style="margin-top:8px"><tbody>
        <tr><td>年化報酬</td><td class="num">${r.cagr == null ? '—（期間未滿半年）' : P(r.cagr)}</td></tr><tr><td>最大回撤</td><td class="num up">−${r.mdd.toFixed(1)}%</td></tr>
        <tr><td>交易次數／勝率</td><td class="num">${r.trades.length} 次 / ${r.win == null ? '—' : r.win.toFixed(0) + '%'}</td></tr><tr><td>平均獲利／平均虧損</td><td class="num">${P(r.avgWin)} / ${P(r.avgLoss)}</td></tr>
        <tr><td>獲利因子</td><td class="num">${r.pf == null ? '—' : r.pf.toFixed(2)}</td></tr><tr><td>持有時間比例</td><td class="num">${r.exposure.toFixed(0)}%</td></tr></tbody></table>
      ${r.open ? '<div class="small" style="color:var(--primary);margin-top:6px">目前仍持有部位（最後一筆以最新收盤價計算）</div>' : ''}</div>
      ${r.trades.length ? `<div class="card" style="margin-top:12px"><h2>交易明細<span class="r small muted">${r.trades.length} 筆</span></h2><div class="scroll-x"><table class="tbl"><thead><tr><th style="text-align:left">進場</th><th>出場</th><th>進場價</th><th>出場價</th><th>天數</th><th>原因</th><th>報酬</th></tr></thead><tbody>
        ${r.trades.slice().reverse().slice(0, 200).map((t) => `<tr><td class="num" style="text-align:left">${esc(t.ed)}</td><td class="num">${esc(t.xd)}</td><td class="num">${fmtPx(t.ep)}</td><td class="num">${fmtPx(t.xp)}</td><td class="num">${t.bars}</td><td>${esc(t.why)}</td><td class="num ${cls(t.ret)}">${P(t.ret)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <div class="small muted" style="margin-top:8px">回測以歷史資料模擬，未含滑價；過去績效不代表未來，僅供研究參考。</div>`;
    drawSeries($('#sgC'), bars.map((b) => b.d), [{ name: '策略', color: '#3b82f6', v: r.eq.map((v) => (v - 1) * 100) }, { name: '買進持有', color: '#94a3b8', v: r.hold.map((v) => (v - 1) * 100) }], { h: 220, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%', zero: true });
  },
  fill() {}, syms() { return [this.sym]; },
};

// ───────── 年度報稅彙總（與 App ReportCalc／TaxSummary 相同算法） ─────────
const TAXC = { credit: 0.085, cap: 80000, sep: 0.28, ovs: 1000000, amtEx: 7500000, amtRate: 0.2, rates: [0.05, 0.12, 0.2, 0.3, 0.4] };
function taxCompare(taxable, rate) { const t = Math.max(0, taxable); const credit = Math.min(t * TAXC.credit, TAXC.cap); const combined = t * rate - credit, separate = t * TAXC.sep;
  return { taxable: t, rate, credit, combined, separate, combinedBetter: combined <= separate, saving: Math.abs(combined - separate), breakEven: t > 0 ? TAXC.sep + credit / t : TAXC.sep + TAXC.credit }; }
function taxAmt(propertyGain, otherOverseas, otherAmt = 0) { const overseas = Math.max(0, propertyGain) + Math.max(0, otherOverseas); const included = overseas >= TAXC.ovs ? overseas : 0;
  const basic = included + Math.max(0, otherAmt); const over = Math.max(0, basic - TAXC.amtEx); return { overseas, included, basic, over, maxTax: over * TAXC.amtRate }; }
function taxReport(year) {
  const y = String(year); const lg = ledger(); const rz = (lg && lg.realizedById) || {}; const today = ymd();
  const ts = D.trades().filter((t) => (t.o || '') === '' && String(t.d).startsWith(y));
  const r = { year, rTw: 0, rUs: 0, bySym: {}, dGross: 0, dTaxable: 0, nhi: 0, dOverseas: 0, usGross: 0, usWh: 0, fees: 0, taxes: 0, divs: {}, nb: 0, ns: 0, nd: 0 };
  for (const t of ts) {
    const us = isUs(t.s); const fx = us ? (t.x || 1) : 1; const g = tGross(t);
    if (t.t === 'SELL' || (t.sh && t.t === 'BUY')) { const v = rz[t.id] || 0; if (t.t === 'SELL' || t.sh) { if (us) r.rUs += v; else r.rTw += v; r.bySym[t.s] = (r.bySym[t.s] || 0) + v; } }
    if (t.t === 'SELL') { r.ns++; r.fees += (t.fee || 0) * fx; r.taxes += (t.tax || 0) * fx; }
    else if (t.t === 'BUY') { r.nb++; r.fees += (t.fee || 0) * fx; }
    else if (t.t === 'DIVIDEND') {
      if (String(t.d).replace(/-/g, '/') > today) continue; r.nd++;
      const gg = g * fx;
      if (us) { r.usGross += gg; r.usWh += gg * 0.3; continue; }
      const kind = taxKindOf(t.s); const ovs = kind === 'TW_ETF_BOND' || kind === 'TW_ETF_OVERSEAS'; const ratio = ovs ? 0 : taxRatioOf(t.s);
      if (ovs) r.dOverseas += gg; else { r.dGross += gg; r.dTaxable += gg * ratio; } r.nhi += t.fee || 0;
      const o = r.divs[t.s] || { s: t.s, g: 0, tx: 0, nhi: 0, n: 0, ratio, kind }; o.g += gg; o.tx += gg * ratio; o.nhi += t.fee || 0; o.n++; r.divs[t.s] = o;
    }
  }
  r.amt = taxAmt(r.rUs, r.usGross + r.dOverseas); return r;
}
VIEWS.tax = {
  title: '年度報稅',
  render() { this.year = this.year || new Date().getFullYear();
    return head('年度報稅彙總', `<button class="btn" id="txY0">‹</button><b class="num" style="min-width:64px;text-align:center">${this.year} 年</b><button class="btn" id="txY1" ${this.year >= new Date().getFullYear() ? 'disabled' : ''}>›</button><button class="btn" id="txX">匯出 CSV</button>`) + '<div id="dyn"></div>'; },
  bind() {
    $('#txY0').onclick = () => { this.year--; route(); }; $('#txY1').onclick = () => { if (this.year < new Date().getFullYear()) { this.year++; route(); } };
    $('#txX').onclick = () => this.csv();
  },
  rate() { const v = Number(S.pref.taxRate); return TAXC.rates.includes(v) ? v : 0.12; },
  fill() {
    const r = taxReport(this.year); const m = taxCompare(r.dTaxable, this.rate()); const a = r.amt; const N = (v) => fmtInt(v);
    const divs = Object.values(r.divs).sort((x, y) => y.g - x.g); const syms = Object.entries(r.bySym).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
    const kv = (k, v, c = '') => `<div class="row" style="justify-content:space-between;padding:4px 0"><span class="text2">${k}</span><b class="num ${c}">${v}</b></div>`;
    $('#dyn').innerHTML = `<div class="grid g2 stack">
      <div class="card"><h2>已實現損益</h2>${kv('台股（證所稅停徵）', fmtSigned(r.rTw), cls(r.rTw))}${kv('美股（海外財產交易所得）', fmtSigned(r.rUs), cls(r.rUs))}${kv('買進／賣出／股息筆數', `${r.nb} / ${r.ns} / ${r.nd}`)}${kv('手續費', N(r.fees))}${kv('交易稅', N(r.taxes))}</div>
      <div class="card"><h2>台股股利（綜合所得稅）</h2>${kv('股利總額', N(r.dGross))}${kv('股利所得（應稅部分，估）', N(r.dTaxable))}${kv('合併計稅可抵減稅額（估）', N(m.credit))}${kv('已扣二代健保', N(r.nhi))}
        <div class="small muted">合併計稅：股利 × 8.5% 可抵減，每戶上限 8 萬元；分開計稅：股利所得按 28% 單獨計算。應稅比例依各檔稅務類別設定（個股頁可調整）。</div></div>
      ${r.dTaxable > 0 ? `<div class="card"><h2>報稅試算：合併 vs 分開計稅</h2><div class="small text2">選擇你（或全戶）的綜所稅邊際稅率：</div>
        <div class="seg" style="margin:8px 0">${TAXC.rates.map((v) => `<button data-tr="${v}" class="${v === m.rate ? 'on' : ''}">${Math.round(v * 100)}%</button>`).join('')}</div>
        ${kv(`合併計稅（股利 × ${Math.round(m.rate * 100)}% − 抵減 ${N(m.credit)}）`, N(m.combined), m.combined < 0 ? 'up' : '')}${kv('分開計稅（股利 × 28%）', N(m.separate))}
        <div style="margin-top:6px;font-weight:700;color:var(--primary)">${m.combinedBetter ? '建議合併計稅' : '建議分開計稅'}，約可少繳 ${N(m.saving)}</div>
        <div class="small muted" style="margin-top:4px">${m.combined < 0 ? '合併計稅結果為負數：抵減稅額大於股利增加的稅額，可退稅或抵其他所得稅額。' : ''}邊際稅率超過 ${(m.breakEven * 100).toFixed(1)}% 時分開計稅較省。此為股利部分的稅額增減估算，申報時系統會自動選擇有利方式，仍以國稅局試算為準。</div></div>` : ''}
      <div class="card"><h2>海外所得（最低稅負制）</h2>${kv('美股已實現損益', fmtSigned(r.rUs), cls(r.rUs))}${kv('美股股息（稅前）', N(r.usGross))}${kv('美股已預扣 30%', N(r.usWh))}${kv('國內債券／海外 ETF 配息', N(r.dOverseas))}${kv('海外所得合計（估）', N(a.overseas), a.overseas >= TAXC.ovs ? 'up' : '')}
        ${a.included > 0 ? kv('計入基本所得額', N(a.included)) + kv('超過免稅額 750 萬', N(a.over)) + kv('基本稅額上限（× 20%）', N(a.maxTax), a.maxTax > 0 ? 'up' : '') : ''}
        <div class="small muted">${a.included > 0 ? '海外所得全年合計已達 100 萬元，須全數計入基本所得額申報。' + (a.maxTax > 0 ? '基本稅額還要減去一般所得稅額與可扣抵的國外已納稅額（美股預扣稅），差額為正才需補繳。' : '基本所得額未超過 750 萬免稅額，通常不需繳基本稅額。') : '海外所得全年合計未達 100 萬元者免計入基本所得額。'}美股已實現損失只能抵同年度海外財產交易所得。</div></div></div>
      ${divs.length ? `<div class="card" style="margin-top:12px"><h2>台股股利明細（對照扣繳憑單）</h2><div class="scroll-x"><table class="tbl"><thead><tr><th style="text-align:left">股票</th><th>類別</th><th>次數</th><th>配息總額</th><th>應稅比例</th><th>股利所得</th><th>二代健保</th></tr></thead><tbody>
        ${divs.map((d) => `<tr class="click" data-go="#/s/${encodeURIComponent(d.s)}"><td class="nm" style="text-align:left">${esc(D.name(d.s))} <span class="muted small num">${esc(d.s)}</span></td><td>${esc(TAX_KINDS[d.kind][0])}</td><td class="num">${d.n}</td><td class="num">${N(d.g)}</td><td class="num">${Math.round(d.ratio * 100)}%</td><td class="num">${N(d.tx)}</td><td class="num">${d.nhi ? N(d.nhi) : '—'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${syms.length ? `<div class="card" style="margin-top:12px"><h2>個股已實現損益</h2><div class="list">${syms.map(([sy, v]) => `<div class="it" data-go="#/s/${encodeURIComponent(sy)}"><div class="l"><div class="t1">${esc(D.name(sy))} <span class="muted small num">${esc(sy)}</span></div></div><div class="r num ${cls(v)}">${fmtSigned(v)}</div></div>`).join('')}</div></div>` : ''}
      <div class="small muted" style="margin-top:8px">本表依交易紀錄估算（不含期初持股與舊版紀錄），僅供報稅參考；請以券商年度對帳單與國稅局資料為準。數字依 115 年度規定（基本所得額免稅額 750 萬）。</div>`;
    $$('[data-tr]').forEach((b) => b.onclick = () => { S.pref.taxRate = +b.dataset.tr; savePref(); this.fill(); });
    $$('[data-go]', $('#dyn')).forEach((x) => x.onclick = () => { location.hash = x.dataset.go; });
  },
  csv() {
    const r = taxReport(this.year); const m = taxCompare(r.dTaxable, this.rate()); const a = r.amt; const R = Math.round;
    const rows = [['項目', '金額（TWD）'], [r.year + ' 台股已實現損益', R(r.rTw)], [r.year + ' 美股已實現損益', R(r.rUs)], ['台股股利總額', R(r.dGross)], ['股利所得（應稅部分，估）', R(r.dTaxable)],
      ['可抵減稅額（8.5%，上限 8 萬，估）', R(m.credit)], ['二代健保補充保費', R(r.nhi)], ['國內 ETF 海外所得配息', R(r.dOverseas)], ['美股股息（稅前）', R(r.usGross)], ['美股預扣稅 30%', R(r.usWh)],
      ['海外所得合計（估）', R(a.overseas)], [`合併計稅：股利稅額增減（邊際稅率 ${R(m.rate * 100)}%，估）`, R(m.combined)], ['分開計稅：股利稅額 28%（估）', R(m.separate)],
      ['計入基本所得額的海外所得（估）', R(a.included)], ['基本稅額上限（估，未扣一般所得稅額）', R(a.maxTax)], ['手續費', R(r.fees)], ['交易稅', R(r.taxes)], [],
      ['台股股利明細'], ['代號', '配息總額', '應稅比例', '股利所得', '二代健保'], ...Object.values(r.divs).map((d) => [d.s, R(d.g), R(d.ratio * 100) + '%', R(d.tx), R(d.nhi)]), [],
      ['個股已實現損益'], ['代號', '金額（TWD）'], ...Object.entries(r.bySym).map(([sy, v]) => [sy, R(v)]), [], ['本表依交易紀錄估算，僅供報稅參考，請以券商與國稅局資料為準。']];
    download(`CETFTW-${r.year}年度報稅.csv`, rows.map((x) => x.map(csvCell).join(',')).join('\n'));
  },
  syms() { return []; },
};
VIEWS.cash = {
  title: '現金與帳戶',
  render() { return head('現金與帳戶', `<button class="btn primary" id="addF">＋ 入金／出金</button>`) + '<div id="dyn"></div>'; },
  bind() { $('#addF').onclick = () => this.flowModal(); },
  fill() {
    const P = portfolio(); const flows = D.cashFlows().slice().sort((a, b) => String(b.d).localeCompare(String(a.d))); const accs = D.accounts();
    const inSum = flows.filter((f) => f.a > 0).reduce((a, f) => a + f.a, 0), outSum = flows.filter((f) => f.a < 0).reduce((a, f) => a + f.a, 0);
    $('#dyn').innerHTML = `<div class="grid g3" style="margin-bottom:12px">
      <div class="tile"><div class="k">目前現金（台幣）</div><div class="v num">${fmtInt(P.cash)}</div><div class="s muted">期初 ${fmtInt(D.base().cash)} ＋ 交易與股息 ＋ 現金流</div></div>
      <div class="tile"><div class="k">累計入金</div><div class="v num up">${fmtInt(inSum)}</div></div><div class="tile"><div class="k">累計出金</div><div class="v num down">${fmtInt(Math.abs(outSum))}</div></div></div>
      <div class="grid g2 stack"><div class="card"><h2>現金流紀錄</h2>${flows.length ? `<div class="list">${flows.map((f) => `<div class="it" style="cursor:default"><div class="l"><div class="t1">${esc(f.c || (f.a >= 0 ? '入金' : '出金'))}${f.n ? ' · ' + esc(f.n) : ''}</div><div class="t2">${esc(f.d)}</div></div>
        <div class="r num ${cls(f.a)}">${fmtSigned(f.a)}</div><button class="btn sm danger" data-df="${f.id}">刪除</button></div>`).join('')}</div>` : '<div class="muted small">尚無入金或出金紀錄。</div>'}</div>
      <div class="card"><h2>證券帳戶</h2>${accs.length ? `<table class="tbl"><thead><tr><th>帳戶</th><th>市場</th><th>手續費折扣</th><th>最低手續費</th><th></th></tr></thead><tbody>${accs.map((a) => `<tr><td class="nm">${esc(a.n)}</td><td>${a.m === 'US' ? '美股' : '台股'}</td>
        <td class="num">${a.m === 'US' ? ((a.r || 0) * 100).toFixed(3) + '%' : ((a.d || 1) * 10).toFixed(2) + ' 折'}</td><td class="num">${a.m === 'US' ? '$' + (a.umin || 0) : (a.min ?? 20) + ' 元'}</td><td><button class="btn sm" data-ea="${a.id}">編輯</button></td></tr>`).join('')}</tbody></table>` : '<div class="muted small">尚未建立帳戶。</div>'}
        <button class="btn sm" id="addAcc" style="margin-top:10px">＋ 新增帳戶</button><div class="small muted" style="margin-top:6px">新增交易時依帳戶折扣自動試算台股手續費。</div></div></div>`;
    $$('[data-df]').forEach((b) => b.onclick = async () => { if ((await dialog('刪除現金流', '確定刪除這筆紀錄？', [['', '取消'], ['ok', '刪除', 'primary']])) !== 'ok') return; ksetJson('cashFlows', D.cashFlows().filter((f) => String(f.id) !== b.dataset.df)); changed(); this.fill(); });
    $$('[data-ea]').forEach((b) => b.onclick = () => this.accModal(accs.find((a) => String(a.id) === b.dataset.ea)));
    $('#addAcc').onclick = () => this.accModal();
  },
  async flowModal() {
    let made = null;
    const r = await dialog('入金／出金', `<div class="seg" id="fk"><button data-k="in" class="on">入金</button><button data-k="out">出金</button></div>
      <div class="grid g2"><div class="field"><label>日期</label><input id="fd" type="date" value="${ymd().replace(/\//g, '-')}"></div><div class="field"><label>金額（台幣）</label><input id="fa" type="number" step="any"></div></div>
      <div class="field"><label>類別</label><select id="fc">${FLOW_C.map((c) => `<option>${c}</option>`).join('')}</select></div><div class="field"><label>備註</label><input id="fn"></div><div id="merr" class="small up"></div>`,
    [['', '取消'], ['ok', '新增', 'primary']], (root) => {
      let k = 'in'; $$('[data-k]', root).forEach((b) => b.onclick = () => { k = b.dataset.k; $$('[data-k]', root).forEach((x) => x.classList.toggle('on', x === b)); $('#fc', root).value = k === 'in' ? '入金' : '出金'; });
      return () => { const a = parseFloat($('#fa', root).value); if (!(a > 0)) return '請輸入金額'; const fl = D.cashFlows();
        made = fl.concat([{ id: Math.max(0, ...fl.map((f) => +f.id || 0)) + 1, d: $('#fd', root).value.replace(/-/g, '/'), a: k === 'in' ? a : -a, c: $('#fc', root).value, n: $('#fn', root).value.trim() }]); return null; };
    });
    if (r === 'ok' && made) { ksetJson('cashFlows', made); changed(); toast('已新增'); route(); }
  },
  async accModal(a0) {
    const a = a0 || { id: Math.max(0, ...D.accounts().map((x) => +x.id || 0)) + 1, n: '', m: 'TW', d: 1, min: 20, r: 0.001, umin: 0 }; let made = null;
    const r = await dialog(a0 ? '編輯帳戶' : '新增帳戶', `<div class="field"><label>名稱</label><input id="an" value="${esc(a.n)}" placeholder="例：元大、國泰複委託"></div>
      <div class="field"><label>市場</label><select id="am"><option value="TW" ${a.m !== 'US' ? 'selected' : ''}>台股</option><option value="US" ${a.m === 'US' ? 'selected' : ''}>美股</option></select></div>
      <div class="grid g2"><div class="field"><label>台股折扣（0.28＝2.8 折）</label><input id="ad" type="number" step="0.01" value="${a.d ?? 1}"></div><div class="field"><label>台股最低手續費</label><input id="amin" type="number" value="${a.min ?? 20}"></div></div>
      <div class="grid g2"><div class="field"><label>美股費率（0.001＝0.1%）</label><input id="ar" type="number" step="0.0001" value="${a.r ?? 0.001}"></div><div class="field"><label>美股最低（美元）</label><input id="aumin" type="number" step="0.01" value="${a.umin ?? 0}"></div></div>
      <div class="grid g2"><div class="field"><label>股利入帳銀行（同行免匯費）</label><input id="adbk" value="${esc(a.dbk || '')}" placeholder="例：華南銀行" list="bankList"><datalist id="bankList">${['華南銀行', '臺灣銀行', '土地銀行', '合作金庫', '第一銀行', '彰化銀行', '兆豐銀行', '國泰世華', '中國信託', '玉山銀行', '台新銀行', '永豐銀行', '台北富邦', '凱基銀行', '元大銀行', '郵局'].map((b) => `<option>${b}</option>`).join('')}</datalist></div><div class="field"><label>股利跨行匯費（元）</label><input id="advf" type="number" min="0" step="1" value="${a.dvf ?? divFee()}"></div></div><div id="merr" class="small up"></div>`,
    (a0 ? [['del', '刪除', 'danger']] : []).concat([['', '取消'], ['ok', '儲存', 'primary']]), (root) => () => {
      const n = $('#an', root).value.trim(); if (!n) return '請輸入名稱';
      const na = { ...a, n, m: $('#am', root).value, d: parseFloat($('#ad', root).value) || 1, min: parseFloat($('#amin', root).value) || 0, r: parseFloat($('#ar', root).value) || 0, umin: parseFloat($('#aumin', root).value) || 0,
        dbk: $('#adbk', root).value.trim(), dvf: Math.max(0, parseFloat($('#advf', root).value) || 0) };
      made = D.accounts().filter((x) => x.id !== a.id).concat([na]).sort((x, y) => x.id - y.id); return null;
    });
    if (r === 'ok' && made) { ksetJson('accounts', made); changed(); route(); }
    else if (r === 'del') { if (D.trades().some((t) => Number(t.acc) === a.id)) { toast('此帳戶有交易紀錄，無法刪除', 3500); return; } ksetJson('accounts', D.accounts().filter((x) => x.id !== a.id)); changed(); route(); }
  },
  syms() { return []; },
};

// ───────── 更多（手機）與設定 ─────────
VIEWS.more = {
  title: '更多',
  render() {
    return head('更多') + `<div class="search" style="margin-bottom:12px"><input id="ms2" placeholder="搜尋個股：代號或名稱" autocomplete="off"><div class="res hide"></div></div>
      <div class="card" style="margin-bottom:12px;padding:10px">${dlAppHtml(true)}</div>
      <div class="grid g2 stack">${NAV_GROUPS.map(([g, rs]) => `<div class="card"><h2>${g}</h2><div class="list">${rs.map((r) => { const [, n, ic] = navItem(r);
        return `<a class="it" href="#/${r}" style="color:inherit"><span style="font-size:20px">${ic}</span><div class="l"><div class="t1">${n}${BOTTOM.includes(r) ? ' <span class="small muted">（下方選單）</span>' : ''}</div><div class="t2">${esc(NAV_DESC[r] || '')}</div></div><span class="muted">›</span></a>`; }).join('')}</div></div>`).join('')}</div>
      <div class="small muted" style="margin-top:10px">電腦版可按 Ctrl＋K 開啟指令面板，快速跳到任何頁面或個股。</div>`;
  },
  bind() { bindSearch($('#ms2'), (sym) => { location.hash = '#/s/' + sym; }); dlAppVer(); },
  fill() {}, syms() { return []; },
};
function applyColor() { applyLook(); }
function applyWall() { applyLook(); }
/** 外觀：主題、字級、內容寬度、側欄、密度、行情牆格寬 */
function applyLook() {
  const p = S.pref, el = document.documentElement;
  el.dataset.color = p.color === 'us' ? 'us' : 'tw';
  const dark = p.theme === 'light' ? false : p.theme === 'dark' ? true : !(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
  el.dataset.theme = dark ? 'dark' : 'light';
  el.style.fontSize = ({ s: '14px', m: '15px', l: '16.5px', xl: '18px' })[p.font || 'm'];
  el.style.setProperty('--maxw', ({ std: '1280px', wide: '1600px', full: '100%' })[p.width || 'std']);
  el.style.setProperty('--wall-w', (p.wallW || 220) + 'px');
  el.dataset.side = p.sideMini ? 'mini' : 'full';
  el.dataset.density = p.dense ? 'compact' : 'normal';
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = dark ? '#0f1420' : '#f5f7fb';
}
if (window.matchMedia) matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (!S.pref.theme || S.pref.theme === 'auto') { applyLook(); if (cur) cur.fill(); } });
const WALL_ITEMS = [['spark', '走勢小圖'], ['vol', '成交量與高低'], ['hold', '持股股數與損益'], ['mkt', '市場標籤']];
VIEWS.settings = {
  title: '設定',
  render() {
    const p = S.pref; const opt = (k, v, t, d) => `<button data-k="${k}" data-v="${v}" class="${String(p[k] ?? d ?? '') === String(v) ? 'on' : ''}">${t}</button>`;
    const chk = (id, on, label) => `<label class="row small" style="padding:4px 0;cursor:pointer"><input type="checkbox" ${id} ${on ? 'checked' : ''} style="width:auto"> ${label}</label>`;
    const ov = ovLayout(); const hh = new Set(p.holdHide || HOLD_DEFAULT_HIDE); const wh = new Set(p.wallHide || []);
    return head('設定') + `<div class="grid g2 stack">
      <div class="card"><h2>外觀</h2>
        <div class="field"><label>主題</label><div class="seg">${opt('theme', 'auto', '跟隨系統', 'auto')}${opt('theme', 'dark', '深色')}${opt('theme', 'light', '淺色')}</div></div>
        <div class="field"><label>字級</label><div class="seg">${opt('font', 's', '小')}${opt('font', 'm', '標準', 'm')}${opt('font', 'l', '大')}${opt('font', 'xl', '特大')}</div></div>
        <div class="field"><label>內容寬度（電腦）</label><div class="seg">${opt('width', 'std', '標準', 'std')}${opt('width', 'wide', '加寬')}${opt('width', 'full', '滿版')}</div></div>
        <div class="field"><label>版面密度</label><div class="seg">${opt('dense', '', '舒適', '')}${opt('dense', '1', '緊湊')}</div></div>
        <div class="field"><label>側邊選單（電腦）</label><div class="seg">${opt('sideMini', '', '完整', '')}${opt('sideMini', '1', '只顯示圖示')}</div></div>
        <div class="field"><label>漲跌顏色</label><div class="seg">${opt('color', 'tw', '紅漲綠跌（台股）', 'tw')}${opt('color', 'us', '綠漲紅跌（美股）')}</div></div>
        <div class="field"><label>開啟網頁時的首頁</label><div class="seg">${opt('home', '', '總覽', '')}${opt('home', 'watch', '行情')}${opt('home', 'hold', '持股')}</div></div></div>
      <div class="card"><h2>總覽版面<span class="r"><button class="btn sm" id="ovReset">恢復預設</button></span></h2>
        <div class="small muted" style="margin-bottom:6px">勾選要顯示的卡片，用 ↑↓ 調整順序，「整列／半寬」調整寬度。</div>
        ${chk('id="ovTk"', p.ovTicker !== false, '顯示指數列與漲跌停列')}
        <div class="list">${ov.map((c, i) => `<div class="it" style="cursor:default;padding:6px 2px"><input type="checkbox" data-ovon="${c.k}" ${c.on ? 'checked' : ''} style="width:auto"><div class="l"><div class="t1">${esc(c.n)}</div></div>
          <button class="btn sm" data-ovw="${c.k}">${c.w === 2 ? '整列' : '半寬'}</button><button class="btn sm" data-ovm="${i}:-1" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-ovm="${i}:1" ${i < ov.length - 1 ? '' : 'disabled'}>↓</button></div>`).join('')}</div></div>
      <div class="card"><h2>持股表格欄位</h2><div class="grid g2">${HOLD_COLS.filter(([k]) => k !== 'name').map(([k, n]) => chk(`data-hc="${k}"`, !hh.has(k), n)).join('')}</div></div>
      <div class="card"><h2>行情牆</h2>
        <div class="field"><label>每格寬度</label><div class="seg">${opt('wallW', '180', '小')}${opt('wallW', '220', '中', '220')}${opt('wallW', '280', '大')}</div></div>
        <div class="field"><label>格子顯示項目</label><div class="grid g2">${WALL_ITEMS.map(([k, n]) => chk(`data-wc="${k}"`, !wh.has(k), n)).join('')}</div></div></div>
      <div class="card"><h2>各頁版面</h2><div class="small muted" style="margin-bottom:8px">每一頁標題旁的「⚙ 版面」可以調整該頁卡片的顯示、順序、寬度與欄數（個股、分析、工具的各分頁分開設定）。</div>
        ${Object.keys(p.lay || {}).length ? `<div class="list">${Object.keys(p.lay).map((k) => `<div class="it" style="cursor:default;padding:6px 2px"><div class="l"><div class="t1">${esc((LAY_PAGE_NAMES[k.split(':')[0]] || k) + (k.includes(':') ? ' › ' + k.split(':')[1] : ''))}</div><div class="t2">${(p.lay[k].cols || 2)} 欄 · 隱藏 ${(p.lay[k].hide || []).length} 張</div></div><button class="btn sm" data-layrs="${esc(k)}">恢復預設</button></div>`).join('')}</div>
          <button class="btn sm" id="layAll" style="margin-top:8px">全部恢復預設</button>` : '<div class="small muted">目前沒有自訂的頁面。</div>'}</div>
      ${aiSettingsHtml()}
      <div class="card" id="rtCard"><h2>即時行情</h2>
        <div class="field"><label>台股盤中來源</label><div class="seg">${opt('twSrc', 'twse', '證交所即時', 'twse')}${opt('twSrc', 'fugle', '富果串流')}</div></div>
        <div class="small text2">${p.twSrc === 'fugle' ? '盤中以富果 WebSocket 串流同步（正在看的個股 → 持股 → 其他自選）；超出方案訂閱上限、未填金鑰或斷線時，自動改用證交所即時。盤後一律用證交所／櫃買收盤資料。' : '盤中使用證交所 MIS 即時行情（上市＋上櫃，依下方頻率更新），免金鑰。要更即時可改用富果串流（需金鑰）。'}</div>
        <div class="field" style="margin-top:10px"><label>富果 Fugle API 金鑰（選填）</label>
          ${aiHas('fugle') ? `<div class="row wrap" style="gap:6px"><span class="tag up">已儲存</span><button class="btn sm" id="fgT">測試連線</button><button class="btn sm" id="fgD">清除</button></div>`
            : `<div class="row" style="gap:6px"><input id="fgK" type="password" autocomplete="off" placeholder="貼上富果 API Key"><button class="btn sm primary" id="fgS">儲存</button><button class="btn sm" id="fgT">測試</button></div>`}
          <div class="small muted" style="margin-top:4px">金鑰以瀏覽器加密保存在這台電腦，不上傳、不同步到手機（手機 App 請另外在「設置 › 行情資料來源」填寫）。<a href="https://developer.fugle.tw/" target="_blank" rel="noopener">還沒有金鑰？到富果開發者平台免費申請 ›</a></div>
          <div class="small" id="fgR" style="margin-top:4px"></div></div>
        <div class="field" style="margin-top:10px"><label>Alpaca 美股即時（選填）</label>
          ${apHas() ? `<div class="row wrap" style="gap:6px"><span class="tag up">已儲存</span><button class="btn sm" id="apT">測試連線</button><button class="btn sm" id="apD">清除</button><label class="small" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="apSt" style="width:auto" ${S.pref.apStream === '0' ? '' : 'checked'}>盤中逐筆串流</label></div>`
            : `<div class="grid g2" style="gap:6px"><input id="apI" type="password" autocomplete="off" placeholder="API Key ID"><input id="apK" type="password" autocomplete="off" placeholder="Secret Key"></div><div class="row" style="gap:6px;margin-top:6px"><button class="btn sm primary" id="apS">儲存</button><button class="btn sm" id="apT">測試</button></div>`}
          <div class="small muted" style="margin-top:4px">填入自己的 Alpaca 金鑰後：美股盤中以 IEX 逐筆串流即時跳價（免費最多 30 檔，正在看的個股與持股優先）；Yahoo 抓不到時改用 Alpaca；商業合規模式下美股報價與 K 線改用 Alpaca（全市場歷史 K、昨收以官方收盤計算）。免費方案即時價只來自 IEX 一家交易所，可能與全市場略有差異，成交量只是 IEX 的量；同一組金鑰同時只能有一條串流（手機 App 與網頁同時開，後開的一方改用輪詢）。金鑰以瀏覽器加密保存在這台電腦，由瀏覽器直連 Alpaca；瀏覽器擋跨網域查詢時才經本站轉送（不保存、不快取）。<a href="https://app.alpaca.markets/signup" target="_blank" rel="noopener">還沒有金鑰？到 Alpaca 免費註冊 ›</a>（註冊後在 Paper Trading 首頁「API Keys」產生，Secret 只顯示一次）</div>
          <div class="small" id="apR" style="margin-top:4px"></div></div>
        ${keySrcHtml('fmSrc', !!(S.sk && S.sk.finmind), { auto: '有填自己的 Token 時優先使用，沒填時用系統提供的 Token。', system: '只用系統提供的 Token（經本站查詢並共用快取），不使用下方自己的 Token。', own: '只用下方自己的 Token；沒填時以免費額度查詢。' })}
        <div class="field" style="margin-top:10px"><label>FinMind API Token（選填）</label>
          ${aiHas('finmind') ? `<div class="row wrap" style="gap:6px"><span class="tag up">已儲存</span><button class="btn sm" id="fmT">測試連線</button><button class="btn sm" id="fmD">清除</button></div>`
            : `<div class="row" style="gap:6px"><input id="fmK" type="password" autocomplete="off" placeholder="貼上 FinMind Token"><button class="btn sm primary" id="fmS">儲存</button><button class="btn sm" id="fmT">測試</button></div>`}
          <div class="small muted" style="margin-top:4px">個股「財務」的月營收、季度損益、本益比區間，「籌碼」的法人 60 日、融資融券、外資持股，「股息」的股利政策來自 FinMind。不填也能用（由本站共用快取）；查詢量大時填入自己的免費 Token 可提高額度。Token 以瀏覽器加密保存，只在查詢時經本站轉送給 FinMind、不保存。<a href="https://finmindtrade.com/analysis/#/account/user" target="_blank" rel="noopener">免費註冊取得 Token ›</a></div>
          <div class="small" id="fmR" style="margin-top:4px"></div></div>
        <div class="field"><label>台股盤中更新頻率（證交所）</label><div class="seg">${opt('refresh', 5, '5 秒')}${opt('refresh', 10, '10 秒', 10)}${opt('refresh', 30, '30 秒')}${opt('refresh', 60, '1 分鐘')}</div></div>
        <div class="field"><label>美股盤中更新頻率（Yahoo Finance）</label><div class="seg">${opt('usRefresh', 0, '與台股相同', 0)}${opt('usRefresh', 30, '30 秒')}${opt('usRefresh', 60, '1 分鐘')}${opt('usRefresh', 300, '5 分鐘')}</div></div>
        <div class="field"><label>分頁在背景時</label><div class="seg">${opt('bgRefresh', '', '暫停更新（省流量）', '')}${opt('bgRefresh', '1', '持續更新（提醒不漏）')}</div></div>
        <div class="tile small" style="margin-top:6px"><div><b>目前狀態</b></div><div class="text2" id="rtSt" style="white-space:pre-line">${esc(rtStatusText())}</div></div>
        <div class="row wrap" style="margin-top:8px;gap:6px"><button class="btn sm" id="rtNow">立即更新行情</button><a class="btn sm" href="#/diag">資料來源診斷</a></div>
        <div class="small muted" style="margin-top:8px">非交易時間每分鐘更新一次。美股與指數使用 Yahoo Finance（免金鑰）；台指期等期貨資料請使用手機 App。</div></div>
      <div class="card"><h2>股息計算</h2><div class="small text2">台股股利依股務代理發放方式計算：股利總額＝股數 × 每股股利，元以下四捨五入；二代健保＝應稅股利單次 ≥ 2 萬 × 2.11%（四捨五入）；實付＝總額 − 二代健保 − 匯費／處理費。與手機 App 相同。</div>
        <div class="field" style="margin-top:8px"><label>每筆匯費／處理費（元，常見 10 元；同行或免收填 0）</label><div class="row" style="gap:6px"><input id="dvFee" type="number" min="0" step="1" value="${divFee()}" style="max-width:140px"><button class="btn sm" id="dvFeeS">儲存</button></div>
        <div class="small muted" style="margin-top:4px">例：330 股 × 0.138 = 45.54 → 46 元，扣匯費 10 元，實付 36 元。新增台股股息時，費用欄自動帶入「二代健保＋銀行開票處理費／郵資／匯費」。股利入帳銀行與跨行匯費可在各帳戶設定；入帳銀行與發放單位撥款銀行相同（同行）時不扣匯費，各股撥款銀行可在手機 App「股息與稅務 › 股息設定」設定並同步。</div></div></div>
      <div class="card"><h2>融資融券</h2><div class="small text2">新增台股買進時可勾選「融資買進」：現金只扣自備款，融資金額記為負債；賣出時依比例償還並扣利息。總資產以淨值（市值＋現金−融資）計算，與手機 App 相同。</div>
        <div class="grid g2" style="margin-top:8px"><div class="field"><label>融資成數 %</label><input id="mgRt" type="number" step="1" value="${mgRatio()}"></div><div class="field"><label>融資年利率 %</label><input id="mgRr" type="number" step="0.01" value="${mgRate()}"></div></div>
        <div class="small text2" style="margin-top:10px"><b>融券與當沖先賣</b>：台股賣出勾選「放空」。融券繳保證金、價款由券商留置；當沖先賣不繳保證金、價款直接入帳（證交稅 0.15%）。回補時新增買進並勾選「回補放空部位」。</div>
        <div class="grid g2" style="margin-top:8px"><div class="field"><label>融券保證金成數 %</label><input id="shDp" type="number" step="1" value="${shDepPct()}"></div><div class="field"><label>借券費率 %</label><input id="shFe" type="number" step="0.01" value="${shFeePct()}"></div></div>
        <div class="small muted">成數與利率只存在這個瀏覽器（手機 App 另在「設置 › 帳本」設定）。</div></div>
      <div class="card"><h2>資料</h2>
        <div class="row wrap"><button class="btn" id="ex1">匯出交易紀錄 CSV</button><button class="btn" id="ex2">匯出持股 CSV</button><button class="btn" id="rsAll">重設網頁版面設定</button><a class="btn" href="#/diag">資料來源診斷</a></div>
        <div class="small muted" style="margin-top:8px">CSV 可用 Excel 開啟；交易 CSV 也能在手機 App「交易紀錄 › 匯入」使用。版面設定只存在這個瀏覽器。</div></div>
      <div class="card"><h2>安裝為 App</h2><div class="small text2">把網頁版安裝到電腦或手機桌面，像 App 一樣用獨立視窗開啟，離線時也能看到上次的畫面。</div>
        <div class="row wrap" style="margin-top:8px"><button class="btn primary ${installEvt ? '' : 'hide'}" id="instBtn">安裝網頁版</button><span class="small muted">${window.matchMedia('(display-mode: standalone)').matches ? '✓ 目前已以 App 方式開啟' : '沒有按鈕時，請用瀏覽器選單的「安裝應用程式」或「加入主畫面」。'}</span></div></div>
      <div class="card"><h2>鍵盤快速鍵</h2><div class="small text2">／ 搜尋個股　　Esc 關閉搜尋或對話框　　G 再按 H／W／P／T 切換總覽／行情／持股／交易</div>
        <div class="small muted" style="margin-top:10px">網頁版 · 與手機 App 共用帳號與資料</div></div></div>`;
  },
  bind() {
    // 設定分類：外觀／版面／行情／資料／其他，只看需要的那一類
    const SET_CAT = { 外觀: '外觀', 總覽版面: '版面', 持股表格欄位: '版面', 行情牆: '版面', 各頁版面: '版面', 即時行情: '行情', 資料: '資料', 融資: '資料' };
    const cards = $$('#view .card').filter((c) => c.querySelector('h2'));
    cards.forEach((c) => { const t = (c.querySelector('h2').childNodes[0] || {}).textContent || ''; c.dataset.scat = SET_CAT[t.trim()] || '其他'; });
    const cats = ['全部', '外觀', '版面', '行情', '資料', '其他']; let cur0 = ''; try { cur0 = sessionStorage.getItem('cetf_scat') || '全部'; } catch (e) { cur0 = '全部'; }
    const bar = document.createElement('div'); bar.className = 'seg setcat'; bar.style.cssText = 'margin-bottom:12px;flex-wrap:wrap';
    bar.innerHTML = cats.map((c) => `<button data-sc="${c}" class="${c === cur0 ? 'on' : ''}">${c}${c === '全部' ? '' : ' ' + cards.filter((x) => x.dataset.scat === c).length}</button>`).join('');
    const grid = cards[0] && cards[0].parentElement; if (grid) grid.parentElement.insertBefore(bar, grid);
    const apply = (c) => { cards.forEach((x) => { x.style.display = c === '全部' || x.dataset.scat === c ? '' : 'none'; }); $$('[data-sc]', bar).forEach((b) => b.classList.toggle('on', b.dataset.sc === c)); try { sessionStorage.setItem('cetf_scat', c); } catch (e) {} };
    $$('[data-sc]', bar).forEach((b) => b.onclick = () => apply(b.dataset.sc)); apply(cur0);
    const re = () => { savePref(); applyLook(); route(); };
    $$('[data-k]').forEach((b) => b.onclick = () => { const k = b.dataset.k; const v = b.dataset.v; S.pref[k] = k === 'refresh' || k === 'usRefresh' ? +v : v; re(); if (k === 'twSrc' || k === 'bgRefresh') { FG.authFail = ''; tick(); } });
    $('#ovTk').onchange = (e) => { S.pref.ovTicker = e.target.checked; savePref(); };
    const hidden = () => new Set(S.pref.ovHidden || OV_DEFAULT_HIDDEN);
    $$('[data-ovon]').forEach((c) => c.onchange = () => { const h = hidden(); if (c.checked) h.delete(c.dataset.ovon); else h.add(c.dataset.ovon); S.pref.ovHidden = Array.from(h); re(); });
    $$('[data-ovw]').forEach((b) => b.onclick = () => { const k = b.dataset.ovw; const cur0 = ovLayout().find((c) => c.k === k).w; S.pref.ovWidth = { ...(S.pref.ovWidth || {}), [k]: cur0 === 2 ? 1 : 2 }; re(); });
    $$('[data-ovm]').forEach((b) => b.onclick = () => { const [i, d] = b.dataset.ovm.split(':').map(Number); const o = ovLayout().map((c) => c.k); [o[i], o[i + d]] = [o[i + d], o[i]]; S.pref.ovOrder = o; re(); });
    $('#ovReset').onclick = () => { delete S.pref.ovOrder; delete S.pref.ovHidden; delete S.pref.ovWidth; delete S.pref.ovTicker; re(); };
    $$('[data-hc]').forEach((c) => c.onchange = () => { const h = new Set(S.pref.holdHide || HOLD_DEFAULT_HIDE); if (c.checked) h.delete(c.dataset.hc); else h.add(c.dataset.hc); S.pref.holdHide = Array.from(h); savePref(); });
    $$('[data-wc]').forEach((c) => c.onchange = () => { const h = new Set(S.pref.wallHide || []); if (c.checked) h.delete(c.dataset.wc); else h.add(c.dataset.wc); S.pref.wallHide = Array.from(h); savePref(); });
    $('#rsAll').onclick = async () => { if ((await dialog('重設版面設定', '恢復網頁版預設的外觀與版面？（不影響資料）', [['', '取消'], ['ok', '重設', 'primary']])) !== 'ok') return; S.pref = { layout: 'wall', group: 'all', holdSort: 'mv', sub: 'KD', range: '6M' }; re(); };
    aiSettingsBind();
    const fgOut = (ok, msg) => { const el = $('#fgR'); if (el) { el.textContent = msg; el.className = 'small ' + (ok ? 'up' : 'down'); } };
    if ($('#shDp')) { $('#shDp').onchange = () => { S.pref.shDep = +$('#shDp').value || 90; savePref(); toast('已更新融券保證金成數'); }; $('#shFe').onchange = () => { S.pref.shFee = Math.max(0, +$('#shFe').value || 0); savePref(); toast('已更新借券費率'); }; }
    if ($('#mgRt')) { $('#mgRt').onchange = () => { S.pref.mgRatio = +$('#mgRt').value || 60; savePref(); toast('已更新融資成數'); }; $('#mgRr').onchange = () => { S.pref.mgRate = +$('#mgRr').value || 6.45; savePref(); toast('已更新融資利率'); }; }
    if ($('#fmS')) $('#fmS').onclick = async () => { const v = $('#fmK').value.trim(); if (!v) return toast('請先貼上 Token'); await aiKeySet('finmind', v); Object.keys(FMC).forEach((k) => delete FMC[k]); toast('已儲存 FinMind Token'); route(); };
    if ($('#fmD')) $('#fmD').onclick = async () => { await aiKeySet('finmind', ''); toast('已清除 FinMind Token'); route(); };
    if ($('#fmT')) $('#fmT').onclick = async () => { const o = $('#fmR'); const k = $('#fmK') ? $('#fmK').value.trim() : await aiKeyGet('finmind'); o.textContent = '測試中…';
      try { const r = await fetch('/api/fm?ds=TaiwanStockPrice&id=2330&span=7&nc=1', k ? { headers: { 'x-fm-token': k } } : {}); const j = await r.json(); if (j.err) throw new Error(j.err); const l = (j.data || [])[j.data.length - 1];
        o.className = 'small up'; o.textContent = l ? `連線成功：2330 ${l.date} 收 ${l.close}` : '連線成功（查無資料）'; } catch (e) { o.className = 'small down'; o.textContent = '失敗：' + (e.message || e); } };
    if ($('#fgS')) $('#fgS').onclick = async () => { const v = $('#fgK').value.trim(); if (!v) return toast('請先貼上金鑰'); await aiKeySet('fugle', v); FG.authFail = ''; fgStop(''); toast('已儲存富果金鑰'); route(); tick(); };
    if ($('#fgD')) $('#fgD').onclick = async () => { await aiKeySet('fugle', ''); fgStop(''); toast('已清除富果金鑰'); route(); };
    if ($('#fgT')) $('#fgT').onclick = async () => { const k = $('#fgK') ? $('#fgK').value.trim() : await aiKeyGet('fugle'); if (!k) return toast('請先貼上金鑰'); fgOut(true, '測試中…'); const [ok, msg] = await fgTest(k); fgOut(ok, msg); if (ok) { FG.authFail = ''; } };
    const apOut = (ok, msg) => { const el = $('#apR'); if (el) { el.textContent = msg; el.className = 'small ' + (ok ? 'up' : 'down'); } };
    if ($('#apS')) $('#apS').onclick = async () => { const i = $('#apI').value.trim(), k = $('#apK').value.trim(); if (!i || !k) return toast('請貼上 Key ID 與 Secret'); await aiKeySet('alpacaId', i); await aiKeySet('alpacaSec', k); AP.authFail = ''; AP.direct = null; apStop(''); toast('已儲存 Alpaca 金鑰'); route(); tick(); };
    if ($('#apD')) $('#apD').onclick = async () => { await aiKeySet('alpacaId', ''); await aiKeySet('alpacaSec', ''); apStop(''); AP.cc = {}; AP.prev = {}; toast('已清除 Alpaca 金鑰'); route(); };
    if ($('#apT')) $('#apT').onclick = async () => { const k = $('#apI') ? { id: $('#apI').value.trim(), sec: $('#apK').value.trim() } : await apKeys(); if (!k || !k.id || !k.sec) return toast('請貼上 Key ID 與 Secret'); apOut(true, '測試中…'); const [ok, msg] = await apTest(k); apOut(ok, msg); if (ok) AP.authFail = ''; };
    if ($('#apSt')) $('#apSt').onchange = (e) => { S.pref.apStream = e.target.checked ? '' : '0'; savePref(); if (!e.target.checked) apStop(''); tick(); };
    if ($('#dvFeeS')) $('#dvFeeS').onclick = () => { S.pref.divFee = Math.max(0, +($('#dvFee').value || 0)); savePref(); toast('已儲存匯費：' + divFee() + ' 元'); };
    $('#rtNow').onclick = async () => { S.usAt = {}; await tick(); toast('已更新行情'); };
    if ($('#instBtn')) $('#instBtn').onclick = () => installApp();
    $$('[data-layrs]').forEach((b) => b.onclick = () => { const l = { ...(S.pref.lay || {}) }; delete l[b.dataset.layrs]; S.pref.lay = l; savePref(); route(); });
    if ($('#layAll')) $('#layAll').onclick = () => { delete S.pref.lay; savePref(); route(); };
    $('#ex1').onclick = () => exportCsv('trades'); $('#ex2').onclick = () => exportCsv('hold');
    if (!can('BACKUP')) { ['#ex1', '#ex2'].forEach((id) => { $(id).disabled = true; }); $('#ex1').insertAdjacentHTML('afterend', '<span class="small muted">🔒 會員功能（備份與設定檔）</span>'); }
  },
  fill() {}, syms() { return []; },
};
// G 開頭的快速鍵
let gKey = 0;
document.addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'g') { gKey = Date.now(); return; }
  if (Date.now() - gKey < 1200) { const r = { h: '', w: 'watch', p: 'hold', t: 'trades', d: 'div', a: 'analysis', m: 'market', s: 'settings' }[k]; if (r != null) { location.hash = '#/' + r; gKey = 0; } }
});
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
// ───────── 匯出加密（AES-256-GCM＋PBKDF2-SHA256 20 萬次；與 App 格式相同，可互相匯入）─────────
const EXP_ITER = 200000;
let EXP_PWD = '';   // 本次開啟期間記住的匯出密碼（只在記憶體，不存檔）
const b64big = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
async function expKey(pwd, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function expEncrypt(plain, pwd, kind) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await expKey(pwd, salt, EXP_ITER), new TextEncoder().encode(plain)));
  return JSON.stringify({ app: 'CETFTW', enc: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: EXP_ITER, kind, salt: b64big(salt), iv: b64big(iv), ct: b64big(ct) });
}
function expIsEnc(text) { try { return /^\s*\{/.test(text) && JSON.parse(text).enc === 'AES-256-GCM'; } catch (e) { return false; } }
async function expDecrypt(text, pwd) {
  try { const o = JSON.parse(text); const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64bytes(o.iv) }, await expKey(pwd, b64bytes(o.salt), o.iter || EXP_ITER), b64bytes(o.ct)); return new TextDecoder().decode(pt); }
  catch (e) { return null; }
}
/** 取得匯出密碼（第一次輸入兩次確認，可記住到關閉網頁為止） */
async function expPassword() {
  if (EXP_PWD) return EXP_PWD;
  let box = null;
  const v = await dialog('設定匯出密碼', `<div class="notice small" style="margin-bottom:8px">為保護個人投資資料，匯出的檔案一律以 AES-256 加密；匯入（App 或網頁版）時需輸入同一組密碼。<b>密碼忘記就無法開啟檔案</b>。</div>
      <div class="field"><label>匯出密碼（至少 8 個字）</label><input id="xp1" type="password" autocomplete="new-password"></div>
      <div class="field"><label>再輸入一次</label><input id="xp2" type="password" autocomplete="new-password"></div>
      <label class="row" style="gap:6px;justify-content:flex-start"><input type="checkbox" id="xpR" style="width:auto" checked>關閉網頁前記住這組密碼</label><div id="merr" class="small up"></div>`,
    [['', '取消'], ['ok', '加密匯出', 'primary']], (b) => { box = b; return () => { const a = $('#xp1', b).value; return a.length < 8 ? '密碼至少 8 個字' : a !== $('#xp2', b).value ? '兩次輸入的密碼不同' : null; }; });
  if (v !== 'ok') return null;
  const pwd = $('#xp1', box).value; if ($('#xpR', box).checked) EXP_PWD = pwd; return pwd;
}
/** 開啟加密檔：先試記住的密碼，不對再詢問 */
async function expOpen(text) {
  if (!expIsEnc(text)) return text;
  if (EXP_PWD) { const t = await expDecrypt(text, EXP_PWD); if (t != null) return t; }
  for (let i = 0; i < 3; i++) {
    let box = null;
    const v = await dialog('輸入匯出密碼', `<div class="small muted" style="margin-bottom:8px">這是加密的匯出檔（AES-256），請輸入匯出時設定的密碼。</div><div class="field"><label>匯出密碼</label><input id="xpo" type="password"></div>${i ? '<div class="small up">密碼錯誤，請再試一次</div>' : ''}`,
      [['', '取消'], ['ok', '開啟', 'primary']], (b) => { box = b; });
    if (v !== 'ok') return null;
    const pwd = $('#xpo', box).value; const t = await expDecrypt(text, pwd);
    if (t != null) { EXP_PWD = pwd; return t; }
  }
  toast('密碼錯誤，無法開啟檔案'); return null;
}
/** 下載匯出檔：一律加密（檔名加 .aes） */
async function download(name, text) {
  const pwd = await expPassword(); if (!pwd) return;
  const enc = await expEncrypt(text.startsWith('\ufeff') ? text : '\ufeff' + text, pwd, /\.csv$/.test(name) ? 'csv' : 'backup');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([enc], { type: 'application/octet-stream' })); a.download = name + '.aes'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('已加密匯出（AES-256）');
}
function exportCsv(kind) {
  const day = ymd().replace(/\//g, '-');
  if (kind === 'trades') {
    const lg = ledger();
    const rows = [['日期', '類別', '代號', '股數', '價格', '手續費', '交易稅', '匯率', '備註', '名稱', '成交金額(原幣)', '已實現損益(台幣)']];
    D.trades().filter((t) => t.o !== 'legacy').sort((a, b) => a.d.localeCompare(b.d)).forEach((t) => rows.push([t.d, t.o === 'opening' ? '期初' : TYPE_N[t.t], t.s, t.n, t.p, t.fee, t.tax, t.x, t.note || '', D.name(t.s), tGross(t), lg.realizedById && lg.realizedById[t.id] != null ? Math.round(lg.realizedById[t.id]) : '']));
    download('CETFTW-交易-' + day + '.csv', rows.map((r) => r.map(csvCell).join(',')).join('\n'));
  } else {
    const P = portfolio();
    const rows = [['代號', '名稱', '股數', '均價', '現價', '市值(台幣)', '成本(台幣)', '未實現損益', '報酬率%', '占比%']];
    P.rows.forEach((r) => rows.push([r.symbol, r.name, r.shares, r.avgCost.toFixed(4), r.price, Math.round(r.mv), Math.round(r.cost), Math.round(r.pl), r.plPct.toFixed(2), r.weight.toFixed(2)]));
    download('CETFTW-持股-' + day + '.csv', rows.map((r) => r.map(csvCell).join(',')).join('\n'));
  }
  toast('已下載 CSV');
}


// ───────── 技術分析（與 App KlineAnalysis／KBarSignalEngine／InvestAnalysis／EntryAdvisor.volatility 同規則） ─────────
const KP = {
  MB: ['大陽線（長紅 K）', '延續', 2], MS: ['大陰線（長黑 K）', '延續', -2], HAM: ['鎚子線', '反轉', 1], IHAM: ['倒鎚線', '反轉', 1], SS: ['流星線', '反轉', -1], HM: ['吊人線', '反轉', -1],
  DOJI: ['十字線', '反轉', 0], DD: ['蜻蜓十字（T 字）', '反轉', 1], DG: ['墓碑十字（倒 T）', '反轉', -1], EGB: ['多頭吞噬（陽包陰）', '反轉', 2], EGS: ['空頭吞噬（陰包陽）', '反轉', -2],
  PIER: ['貫穿線（曙光初現）', '反轉', 1], DCC: ['烏雲罩頂', '反轉', -1], HRB: ['多頭母子（陰孕陽）', '反轉', 1], HRS: ['空頭母子（陽孕陰）', '反轉', -1], TB: ['平底（雙腳打底）', '反轉', 1], TT: ['平頂（雙頂受阻）', '反轉', -1],
  MST: ['晨星', '反轉', 2], EST: ['暮星（夜星）', '反轉', -2], S3: ['紅三兵', '延續', 2], C3: ['黑三鴉', '延續', -2], GU: ['向上跳空缺口', '缺口/突破', 2], GD: ['向下跳空缺口', '缺口/突破', -2],
  BO: ['帶量突破前高', '缺口/突破', 2], BD: ['帶量跌破前低', '缺口/突破', -2], BT: ['假突破（多頭陷阱）', '缺口/突破', -2], RT: ['假跌破（空頭陷阱）', '缺口/突破', 2],
};
const DIRL = { 2: '強烈偏多', 1: '偏多', 0: '中性', '-1': '偏空', '-2': '強烈偏空' };
const kb = { body: (x) => Math.abs(x.c - x.o), range: (x) => x.h - x.l, up: (x) => x.h - Math.max(x.o, x.c), lo: (x) => Math.min(x.o, x.c) - x.l, mid: (x) => (x.o + x.c) / 2 };
function smaAt(v, i, n) { if (i < 0 || i + 1 < n) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += v[k]; return s / n; }
function atrAt(cs, i, n = 14) { if (i < 1) return cs[i].h - cs[i].l; const from = Math.max(1, i - n + 1); let s = 0, c = 0; for (let k = from; k <= i; k++) { s += Math.max(cs[k].h - cs[k].l, Math.abs(cs[k].h - cs[k - 1].c), Math.abs(cs[k].l - cs[k - 1].c)); c++; } return s / c; }
function kaTrendAt(cl, i) {
  const j = i - 1; const ma = smaAt(cl, j, 20), mp = smaAt(cl, j - 5, 20); if (ma == null || mp == null) return 0; const c = cl[j];
  if (c > ma && ma > mp) return 1; if (c < ma && ma < mp) return -1; if (c < cl[Math.max(0, j - 5)] * 0.97) return -1; if (c > cl[Math.max(0, j - 5)] * 1.03) return 1; return 0;
}
function kaDetect(cs, cl, i) {
  if (i < 22) return [];
  const out = []; const c = cs[i], p = cs[i - 1]; const f = fmtPx;
  let ab = 0, ar = 0; for (let k = i - 10; k < i; k++) { ab += kb.body(cs[k]); ar += kb.range(cs[k]); } ab /= 10; ar /= 10; if (!(ab > 0) || !(ar > 0)) return out;
  const tr = kaTrendAt(cl, i); let vm = 0; for (let k = i - 20; k < i; k++) vm += cs[k].v || 0; vm /= 20; const big = vm > 0 && (c.v || 0) >= vm * 1.5;
  const adj = (b, want) => Math.max(0.3, Math.min(0.97, b + (tr === want ? 0.05 : tr === -want ? -0.25 : -0.1)));
  const H = (k, conf, low, high, note) => out.push({ k, i, conf, low, high, note });
  const body = kb.body(c), rg = kb.range(c), up = kb.up(c), lo = kb.lo(c), bull = c.c > c.o, bear = c.c < c.o;
  const doji = rg > 0 && body / rg <= 0.1 && rg >= ar * 0.5;
  if (rg > 0 && !doji) {
    if (body >= ab * 1.8 && up <= body * 0.15 && lo <= body * 0.15) {
      if (bull) H('MB', big ? 0.88 : 0.78, c.l, c.h, '實體長紅、幾乎無影線，買盤主導' + (big ? '，且帶量。' : '。'));
      else H('MS', big ? 0.88 : 0.78, c.l, c.h, '實體長黑、幾乎無影線，賣壓主導' + (big ? '，且帶量。' : '。'));
    }
    const lL = lo >= body * 2 && up <= Math.max(body * 0.5, rg * 0.1) && rg >= ar * 0.8, lU = up >= body * 2 && lo <= Math.max(body * 0.5, rg * 0.1) && rg >= ar * 0.8;
    if (lL) { if (tr === -1) H('HAM', 0.78, c.l, c.h, '下跌後出現長下影線，低檔有買盤承接；隔日收高確認更佳。'); else if (tr === 1) H('HM', 0.66, c.l, c.h, '上漲後出現長下影線，盤中曾遭大量賣壓，留意高檔轉弱。'); }
    if (lU) { if (tr === 1) H('SS', 0.78, c.l, c.h, '上漲後留長上影線，上方賣壓沉重。'); else if (tr === -1) H('IHAM', 0.6, c.l, c.h, '下跌後出現倒鎚，買盤試探反攻，需隔日紅 K 確認。'); }
  }
  if (doji) {
    if (lo >= rg * 0.7) H('DD', adj(0.72, -1), c.l, c.h, '蜻蜓十字（T 字），下方有強支撐。');
    else if (up >= rg * 0.7) H('DG', adj(0.72, 1), c.l, c.h, '墓碑十字（倒 T），上方壓力強。');
    else H('DOJI', 0.55, c.l, c.h, '十字線，多空拉鋸，' + (tr !== 0 ? '趨勢中出現常為變盤訊號。' : '觀察下一根方向。'));
  }
  const lo2 = Math.min(p.l, c.l), hi2 = Math.max(p.h, c.h); const pb = kb.body(p), pBull = p.c > p.o, pBear = p.c < p.o;
  if (pBear && bull && pb >= ab * 0.3 && c.c >= p.o && c.o <= p.c && body > pb) H('EGB', adj(0.86, -1), lo2, hi2, '陽線實體完全吞噬前一根陰線，多方反攻' + (big ? '，且帶量。' : '。'));
  if (pBull && bear && pb >= ab * 0.3 && c.c <= p.o && c.o >= p.c && body > pb) H('EGS', adj(0.86, 1), lo2, hi2, '陰線實體完全吞噬前一根陽線，空方反撲' + (big ? '，且帶量。' : '。'));
  if (pBear && pb >= ab && bull && c.o <= p.c && c.c > kb.mid(p) && c.c < p.o) H('PIER', adj(0.78, -1), lo2, hi2, '開低後收復前一根長黑實體一半以上，買盤回籠。');
  if (pBull && pb >= ab && bear && c.o >= p.c && c.c < kb.mid(p) && c.c > p.o) H('DCC', adj(0.78, 1), lo2, hi2, '開高後跌破前一根長紅實體一半，賣壓湧現。');
  const inside = Math.max(c.o, c.c) <= Math.max(p.o, p.c) && Math.min(c.o, c.c) >= Math.min(p.o, p.c) && body <= pb * 0.5;
  if (inside && pb >= ab) { if (pBear) H('HRB', adj(0.68, -1), lo2, hi2, '長黑後出現小實體孕線，賣壓暫歇。'); if (pBull) H('HRS', adj(0.68, 1), lo2, hi2, '長紅後出現小實體孕線，買氣轉弱。'); }
  if (p.l > 0 && Math.abs(p.l - c.l) / p.l <= 0.002 && tr === -1 && c.c > c.o) H('TB', 0.72, lo2, hi2, '連兩根低點幾乎相同，低點獲得支撐。');
  if (p.h > 0 && Math.abs(p.h - c.h) / p.h <= 0.002 && tr === 1 && c.c < c.o) H('TT', 0.72, lo2, hi2, '連兩根高點幾乎相同，上檔遇壓。');
  const a = cs[i - 2], b = p; const lo3 = Math.min(a.l, b.l, c.l), hi3 = Math.max(a.h, b.h, c.h); const abody = kb.body(a), bbody = kb.body(b);
  if (a.c < a.o && abody >= ab && bbody <= abody * 0.4 && Math.max(b.o, b.c) <= a.c + abody * 0.1 && bull && c.c > kb.mid(a)) H('MST', adj(0.9, -1), lo3, hi3, '長黑、小星、長紅三根組合，底部反轉訊號。');
  if (a.c > a.o && abody >= ab && bbody <= abody * 0.4 && Math.min(b.o, b.c) >= a.c - abody * 0.1 && bear && c.c < kb.mid(a)) H('EST', adj(0.9, 1), lo3, hi3, '長紅、小星、長黑三根組合，頭部反轉訊號。');
  const sold = (x, pv) => x.c > x.o && x.c > pv.c && x.o >= Math.min(pv.o, pv.c) && x.o <= Math.max(pv.o, pv.c) && kb.body(x) >= ab * 0.5 && kb.up(x) <= kb.body(x) * 0.35;
  const crow = (x, pv) => x.c < x.o && x.c < pv.c && x.o >= Math.min(pv.o, pv.c) && x.o <= Math.max(pv.o, pv.c) && kb.body(x) >= ab * 0.5 && kb.lo(x) <= kb.body(x) * 0.35;
  if (a.c > a.o && abody >= ab * 0.5 && sold(b, a) && sold(c, b)) H('S3', tr === 1 ? 0.8 : 0.88, lo3, hi3, '連三根實體紅 K 逐步墊高，多方動能延續' + (tr === 1 ? '（已漲一段，留意追高）。' : '。'));
  if (a.c < a.o && abody >= ab * 0.5 && crow(b, a) && crow(c, b)) H('C3', tr === -1 ? 0.8 : 0.88, lo3, hi3, '連三根實體黑 K 逐步走低，賣壓持續。');
  if (c.l > p.h) H('GU', big ? 0.86 : 0.74, p.h, c.h, '向上跳空，缺口 ' + f(p.h) + '～' + f(c.l) + ' 為短線支撐。');
  if (c.h < p.l) H('GD', big ? 0.86 : 0.74, c.l, p.l, '向下跳空，缺口 ' + f(c.h) + '～' + f(p.l) + ' 為短線壓力。');
  let res = -Infinity, sup = Infinity; for (let k = i - 20; k < i; k++) { res = Math.max(res, cs[k].h); sup = Math.min(sup, cs[k].l); }
  if (c.c > res && big) H('BO', 0.84, sup, c.h, '帶量收在前 20 根高點 ' + f(res) + ' 之上。');
  if (c.c < sup && big) H('BD', 0.84, c.l, res, '帶量收在前 20 根低點 ' + f(sup) + ' 之下。');
  if (c.h > res && c.c < res && up >= body) H('BT', 0.8, c.l, c.h, '盤中突破前高 ' + f(res) + ' 後拉回收在下方，形成多頭陷阱。');
  if (c.l < sup && c.c > sup && lo >= body) H('RT', 0.8, c.l, c.h, '盤中跌破前低 ' + f(sup) + ' 後收復，形成空頭陷阱。');
  return out;
}
function kaPlan(cur, dir, latest, x) {
  const p = cur.c, atr = x.atr, f = fmtPx; if (!(atr > 0)) return null;
  if (dir > 0) {
    const bl = latest.filter((h) => KP[h.k][2] > 0); const pl = bl.length ? Math.min(...bl.map((h) => h.low)) : cur.l, ph = bl.length ? Math.max(...bl.map((h) => h.high)) : cur.h;
    let stop = Math.min(pl, x.support < p ? x.support : pl) - atr * 0.3; stop = Math.max(p - atr * 3, Math.min(p - atr * 0.8, stop));
    const risk = p - stop; const tp1 = x.resistance > p + risk ? x.resistance : p + risk * 1.5; const tp2 = Math.max(p + risk * 3, tp1 + risk);
    return { bull: true, title: '偏多操作參考', trigger: '收盤站穩形態高點 ' + f(ph) + '，或回測 ' + f(p - atr * 0.5) + ' 附近不破再布局', e0: p - atr * 0.5, e1: p, stop, tp1, tp2, rr: (tp1 - p) / risk,
      note: '停損以 ATR(14)=' + f(atr) + ' 調整；目標一優先取前 20 根壓力 ' + f(x.resistance) + '。' };
  }
  if (dir < 0) {
    const bs = latest.filter((h) => KP[h.k][2] < 0); const ph = bs.length ? Math.max(...bs.map((h) => h.high)) : cur.h, pl = bs.length ? Math.min(...bs.map((h) => h.low)) : cur.l;
    let stop = Math.max(ph, x.resistance > p ? x.resistance : ph) + atr * 0.3; stop = Math.min(p + atr * 3, Math.max(p + atr * 0.8, stop));
    const risk = stop - p; const tp1 = x.support < p - risk ? x.support : p - risk * 1.5; const tp2 = Math.max(0, Math.min(p - risk * 3, tp1 - risk));
    return { bull: false, title: '偏空：持股減碼／防守參考', trigger: '反彈至 ' + f(p) + '～' + f(p + atr * 0.5) + ' 減碼；收盤跌破形態低點 ' + f(pl) + ' 轉保守', e0: p, e1: p + atr * 0.5, stop, tp1, tp2, rr: (p - tp1) / risk,
      note: '空手者觀望；放空者以 ' + f(stop) + ' 為停損。下方第一支撐 ' + f(x.support) + '。' };
  }
  return null;
}
function kaEntry(dir, plan, x, latest, last) {
  const rr = plan ? plan.rr : 0; const f = fmtPx; const r2 = (v) => v.toFixed(2);
  const bullRev = latest.some((h) => h.i === last && KP[h.k][2] > 0 && (KP[h.k][1] === '反轉' || h.k === 'RT'));
  const bearRev = latest.some((h) => h.i === last && KP[h.k][2] < 0 && (KP[h.k][1] === '反轉' || h.k === 'BT'));
  if (dir === 2 && rr >= 1.5 && x.vol !== 'DT' && x.loc !== 'R') return { label: '訊號偏多', level: 2, reason: '多方訊號強、盈虧比 1:' + r2(rr) + '，可依布局區間進場，跌破 ' + f(plan.stop) + ' 停損。', tip: '持有者可留意停利' };
  if (dir > 0 && rr >= 1.2 && x.loc !== 'R' && x.vol !== 'DT') return { label: '訊號略偏多', level: 1, reason: '偏多、盈虧比 1:' + r2(rr) + '，先進 1/3～1/2，站穩形態高點再加碼。', tip: '續抱' };
  if (dir > 0) return { label: '待回測', level: 0, reason: x.vol === 'DT' ? '價漲量縮，追價風險高，等回測支撐 ' + f(x.support) + ' 附近量縮不破再進。' : x.loc === 'R' ? '接近壓力 ' + f(x.resistance) + '，等突破站穩或回測再進。' : '方向偏多但盈虧比僅 1:' + r2(rr) + '，等拉回到 ' + f(plan ? plan.e0 : x.ma20) + ' 附近再進。', tip: '續抱' };
  if (dir === 0 && bullRev) return { label: '觀察止跌', level: 0, reason: '出現止跌形態但力道未確認，等下一根收紅並站上 ' + f(x.ma20) + '（MA20）再考慮。', tip: '續抱觀察' };
  if (dir === 0) return { label: '觀望', level: 0, reason: '多空不明，等帶量突破 ' + f(x.resistance) + ' 或回測 ' + f(x.support) + ' 有撐再決定。', tip: '續抱觀察' };
  if (dir < 0 && bullRev) return { label: '等待止跌確認', level: -1, reason: '空頭格局中出現止跌形態，尚未扭轉，等站回 MA20 ' + f(x.ma20) + ' 再評估。', tip: '留意風險' };
  if (dir === -1) return { label: '訊號偏弱', level: -1, reason: '偏空' + (bearRev ? '，最新出現轉弱形態' : '') + '，等止跌訊號出現再評估。', tip: '反彈減碼、跌破 ' + f(x.support) + ' 防守' };
  return { label: '訊號轉弱', level: -2, reason: '強烈偏空' + (x.loc === 'B' ? '且跌破支撐' : '') + '，避免接刀。', tip: '風險升高，留意停損' };
}
const KVOL = { C: '帶量（≥ 1.5 倍均量）', D: '量縮（≤ 0.6 倍均量）', DT: '量價背離：價創高、量縮', DB: '量價背離：價創低、量縮', N: '量能正常' };
const KLOC = { S: '接近支撐', R: '接近壓力', M: '區間中段', A: '突破壓力上方', B: '跌破支撐下方' };
/** K 線形態分析：全歷史掃描（統計同形態 N 根後勝率）＋近 3 根形態＋量價、位置、趨勢綜合評分與操作計畫 */
function klineAnalyze(cs, forward = 5) {
  if (!cs || cs.length < 40) return null;
  const n = cs.length, cl = cs.map((x) => x.c), last = n - 1, cur = cs[last]; const f = fmtPx;
  const ma20 = smaAt(cl, last, 20), ma60 = smaAt(cl, last, 60);
  let vm = 0; for (let k = last - 20; k < last; k++) vm += cs[k].v || 0; vm /= 20;
  const atr = atrAt(cs, last); let res = -Infinity, sup = Infinity, hi20 = -Infinity, lo20 = Infinity;
  for (let k = last - 20; k < last; k++) { res = Math.max(res, cs[k].h); sup = Math.min(sup, cs[k].l); hi20 = Math.max(hi20, cl[k]); lo20 = Math.min(lo20, cl[k]); }
  if (ma60 != null && ma60 < cur.c && ma60 > sup) sup = ma60;
  const trend = kaTrendAt(cl, n);
  const cv = cur.v || 0, pv = cs[last - 1].v || 0;
  const vol = cur.c >= hi20 && vm > 0 && cv < vm * 0.8 && pv < vm ? 'DT' : cur.c <= lo20 && vm > 0 && cv < vm * 0.8 && pv < vm ? 'DB' : vm > 0 && cv >= vm * 1.5 ? 'C' : vm > 0 && cv <= vm * 0.6 ? 'D' : 'N';
  const near = Math.max(atr, cur.c * 0.015);
  const loc = cur.c > res ? 'A' : cur.c < sup ? 'B' : cur.c - sup <= near ? 'S' : res - cur.c <= near ? 'R' : 'M';
  const x = { trend, ma20, ma60, atr, support: sup, resistance: res, vol, loc };
  const all = []; for (let i = 22; i <= last; i++) kaDetect(cs, cl, i).forEach((h) => all.push(h));
  const stats = {};
  all.filter((h) => h.i + forward <= last && KP[h.k][2] !== 0).forEach((h) => { const r = (cl[h.i + forward] / cl[h.i] - 1) * (KP[h.k][2] > 0 ? 1 : -1); (stats[h.k] = stats[h.k] || []).push(r); });
  Object.keys(stats).forEach((k) => { const a = stats[k]; stats[k] = { count: a.length, win: a.filter((r) => r > 0).length / a.length, avg: a.reduce((s, v) => s + v, 0) / a.length * 100 }; });
  const recent = all.filter((h) => h.i >= n - 40);
  const latest = all.filter((h) => h.i >= n - 3).sort((a, b) => b.i - a.i || b.conf - a.conf);
  const decay = { [last]: 1, [last - 1]: 0.6, [last - 2]: 0.35 }; const reasons = []; let score = 0;
  latest.forEach((h) => { const st = stats[h.k]; const hist = st && st.count >= 3 ? 0.6 + st.win * 0.8 : 1; score += KP[h.k][2] * h.conf * (decay[h.i] ?? 0.3) * hist; });
  if (latest.length) reasons.push('近 3 根出現：' + Array.from(new Set(latest.map((h) => KP[h.k][0]))).join('、'));
  const lastDir = latest.filter((h) => h.i === last).reduce((a, h) => a + KP[h.k][2], 0);
  if (vol === 'C' && lastDir !== 0) { score += 0.4 * Math.sign(lastDir); reasons.push('今日帶量，' + (lastDir > 0 ? '多方' : '空方') + '形態可信度提高'); }
  if (vol === 'DT') { score -= 0.8; reasons.push('價創 20 日新高但量縮，追價力道不足'); }
  if (vol === 'DB') { score += 0.5; reasons.push('價創 20 日新低但量縮，殺盤力道減弱'); }
  if (loc === 'S') { score += 0.5; reasons.push('股價接近支撐 ' + f(sup)); } else if (loc === 'R') { score -= 0.5; reasons.push('股價接近壓力 ' + f(res)); }
  else if (loc === 'A') { score += 0.4; reasons.push('收盤站上前 20 根高點'); } else if (loc === 'B') { score -= 0.4; reasons.push('收盤跌破前 20 根低點'); }
  score += trend * 0.5;
  reasons.push('趨勢：' + (trend === 1 ? '多頭趨勢' : trend === -1 ? '空頭趨勢' : '盤整') + '（MA20 ' + f(ma20) + (ma60 != null ? '、MA60 ' + f(ma60) : '') + '）');
  const dir = score >= 2.2 ? 2 : score >= 0.8 ? 1 : score <= -2.2 ? -2 : score <= -0.8 ? -1 : 0;
  const strength = Math.max(3, Math.min(97, Math.round(50 + score * 14)));
  const plan = kaPlan(cur, dir, latest, x);
  // 兩套計畫：不論目前方向都算出做多與做空（與 App longPlan／shortPlan 同算法）
  const lp0 = kaPlan(cur, 1, latest, x), sp0 = kaPlan(cur, -1, latest, x);
  const longPlan = lp0 && { ...lp0, title: dir > 0 ? '做多計畫（順勢，偏多操作參考）' : dir < 0 ? '做多計畫（逆勢，等止跌再分批）' : '做多計畫（方向未明，宜小量）' };
  const shortPlan = sp0 && { ...sp0, title: dir < 0 ? '做空計畫（持股減碼／防守參考）' : '做空計畫（逆勢，僅供防守參考）' };
  return { cs, dir, strength, score, latest, recent, x, plan, longPlan, shortPlan, stats, forward, reasons, entry: kaEntry(dir, plan, x, latest, last) };
}
/** 週 K：由日 K 合併（週一為一週起點） */
function weeklyBars(b) {
  const out = []; let wk = null;
  b.forEach((x) => { const d = new Date(x.d.replace(/\//g, '-') + 'T00:00:00Z'); const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); const key = mon.toISOString().slice(0, 10);
    if (!wk || wk.key !== key) { wk = { key, d: x.d, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v || 0 }; out.push(wk); } else { wk.h = Math.max(wk.h, x.h); wk.l = Math.min(wk.l, x.l); wk.c = x.c; wk.v += x.v || 0; wk.d = x.d; } });
  return out;
}

// ---- K 棒策略訊號（普通股／ETF 分流） ----
const KS_ST = { SFP: '流動性掃蕩（SFP）', BOS: '突破＋缺口回踩（BOS／FVG）', BOX: '箱型爆量突破', ENG: '關鍵均線吞噬', IB: '母子線壓縮突破', R3: '上升三法中繼', PANIC: '恐慌大跌末端止跌', GAP: '竭盡缺口回補' };
const KS_TM = { CLOSE: ['收盤確認', 'K 棒收盤前 5 分鐘或收盤價確認後進場'], NEXT: ['次日開盤', '訊號 K 棒確認後，於下一根 K 棒開盤價進場'], RETEST: ['限價回踩', '不追高，價格回踩關鍵價位（缺口、頸線、箱頂）時限價買進'], BRK: ['盤中突破', '價格盤中突破關鍵點位（例如母棒高點＋1 檔）時觸發'] };
const KS_STA = { ACTIVE: '今日成立', RECENT: '近日成立', WAITING: '等待觸發', TRIGGERED: '已觸發' };
function rsiAt(c, n = 14, end = c.length - 1) { if (end < n) return 50; let g = 0, l = 0; for (let i = end - n + 1; i <= end; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } if (l === 0) return 100; return 100 - 100 / (1 + (g / n) / (l / n)); }
function kbarSignals(cs, etf, tickOf) {
  if (!cs || cs.length < 30) return [];
  const n = cs.length, cl = cs.map((x) => x.c), f = fmtPx;
  const ma = (p) => cl.map((_, i) => smaAt(cl, i, p)); const ma10 = ma(10), ma20 = ma(20), ma60 = ma(60); const vv = cs.map((x) => x.v || 0); const vma20 = vv.map((_, i) => smaAt(vv, i, 20));
  const tick = (p) => tickOf(p); const volR = (i) => (vma20[i - 1] > 0 ? (cs[i].v || 0) / vma20[i - 1] : 1); const conf = (v) => Math.max(30, Math.min(95, Math.floor(v)));
  const bodyMin = (x) => Math.max(kb.body(x), kb.range(x) * 0.05); const br = (x) => (kb.range(x) > 0 ? kb.body(x) / kb.range(x) : 0);
  const sig = (st, bull, i, entry, sl, tp1, tp2, cf, tm, desc, pattern, status, trailing) => ({ st, bull, i, age: n - 1 - i, entry, sl, tp1, tp2, rr: Math.abs(entry - sl) > 0 ? Math.abs(tp1 - entry) / Math.abs(entry - sl) : 0,
    conf: cf, tm, desc, pattern, status: status || (i === n - 1 ? 'ACTIVE' : 'RECENT'), trailing });
  const out = [];
  const hiOf = (a, b) => { let m = -Infinity; for (let k = a; k < b; k++) m = Math.max(m, cs[k].h); return m; }; const loOf = (a, b) => { let m = Infinity; for (let k = a; k < b; k++) m = Math.min(m, cs[k].l); return m; };
  if (!etf) {
    for (let i = n - 3; i < n; i++) { if (i < 21) continue; const c = cs[i]; const sL = loOf(i - 20, i), sH = hiOf(i - 20, i);
      if (c.l < sL && c.c > sL && kb.lo(c) >= 1.5 * bodyMin(c)) { const fresh = i === n - 1; const entry = fresh ? c.c : cs[i + 1].o; const sl = c.l - tick(c.l); const tp1 = entry + (entry - sl) * 2;
        let cf = 70; if (volR(i) >= 1.5) cf += 10; if (c.c >= c.l + kb.range(c) * 0.66) cf += 5; if ((ma60[i] || 0) < c.c) cf += 5;
        out.push(sig('SFP', true, i, entry, sl, tp1, sH > tp1 ? sH : null, conf(cf), fresh ? 'CLOSE' : 'NEXT', fresh ? `收盤前 5 分鐘確認收盤價仍在前低 ${f(sL)} 之上，以收盤價 ${f(entry)} 進場；或次日開盤進場。` : `訊號已於 ${n - 1 - i} 日前成立，以次日開盤價 ${f(entry)} 為進場參考；現價離進場價過遠時不追。`,
          `盤中跌破前 20 日低點 ${f(sL)} 後收回，下影線 ${f(kb.lo(c))} ≥ 實體 1.5 倍（掃停損後拉回）。`)); }
      if (c.h > sH && c.c < sH && kb.up(c) >= 1.5 * bodyMin(c)) { const sl = c.h + tick(c.h); const tp1 = c.c - (sl - c.c) * 2; let cf = 68; if (volR(i) >= 1.5) cf += 10; if ((ma20[i] ?? Infinity) > c.c) cf += 5;
        out.push(sig('SFP', false, i, c.c, sl, tp1, sL < tp1 ? sL : null, conf(cf), 'CLOSE', `持股者：收盤確認仍在前高 ${f(sH)} 之下時減碼；空手者不進場。站回 ${f(sl)} 則訊號失效。`, `盤中突破前 20 日高點 ${f(sH)} 後拉回，上影線 ≥ 實體 1.5 倍（假突破）。`)); } }
    const bos = []; for (let j = Math.max(21, n - 12); j < n - 2; j++) { const b1 = cs[j], b3 = cs[j + 2]; const atr = atrAt(cs, j); const pH = hiOf(j - 20, j);
      if (!(b1.c > b1.o && br(b1) >= 0.6 && kb.body(b1) >= atr * 0.9 && b1.c > pH && b1.h < b3.l)) continue;
      const top = b3.l, mid = b1.h + (b3.l - b1.h) / 2; let touched = false; for (let k = j + 3; k < n; k++) if (cs[k].l <= top) touched = true;
      const sl = Math.min(b1.o, b1.l) - tick(b1.l); const swing = hiOf(j, n); const entry = mid; const tp1 = swing > entry + (entry - sl) ? swing : entry + (entry - sl) * 2;
      let cf = 72; if (volR(j) >= 1.8) cf += 8; if ((ma20[n - 1] || 0) < cs[n - 1].c) cf += 5;
      bos.push(sig('BOS', true, j + 2, entry, sl, tp1, null, conf(cf), 'RETEST', touched ? `價格已回踩缺口（${f(mid)}～${f(top)}），回踩不破可依限價進場；收盤跌破 ${f(sl)} 停損。` : `突破當下不追高。掛限價單等待回踩缺口頂部 ${f(top)} 或缺口 50% 位置 ${f(mid)} 買進。`,
        `長紅突破前 20 日高點 ${f(pH)}，並留下 ${f(b1.h)}～${f(b3.l)} 的不平衡缺口。`, touched ? 'TRIGGERED' : 'WAITING')); }
    if (bos.length) out.push(bos[bos.length - 1]);
    for (let i = n - 3; i < n; i++) { if (i < 36) continue; const c = cs[i]; const top = hiOf(i - 15, i), bot = loOf(i - 15, i); const atr = atrAt(cs, i - 1);
      if ((top - bot) / bot > 0.12 && top - bot > atr * 4.5) continue; const vr = volR(i), h = top - bot;
      if (c.c > top && br(c) >= 0.6 && vr >= 1.8) { const fresh = i === n - 1; const entry = fresh ? c.c : top; const sl = fresh ? (c.o + c.c) / 2 - tick(c.c) : top - atr * 0.5;
        let cf = 72 + Math.min(10, (vr - 1.8) * 5); if ((ma60[i] || 0) < c.c) cf += 5;
        out.push(sig('BOX', true, i, entry, sl, Math.max(top + h, entry + (entry - sl) * 1.5), top + h * 2, conf(cf), fresh ? 'CLOSE' : 'RETEST',
          fresh ? `激進：收盤前 15 分鐘確認量能達標、實體站穩箱頂 ${f(top)}，以 ${f(entry)} 買進。穩健：1～3 天內等縮量回踩 ${f(top)} 不破再進。` : `突破後第 ${n - 1 - i} 天：等縮量回踩箱頂 ${f(top)} 附近、盤中止跌時限價買進，跌破 ${f(sl)} 停損。`,
          `盤整 15 日（箱頂 ${f(top)}、箱底 ${f(bot)}）後爆量 ${vr.toFixed(1)} 倍長紅突破；目標為箱高等倍映射。`)); }
      if (c.c < bot && br(c) >= 0.6 && vr >= 1.8) { const sl = Math.max(bot, (c.o + c.c) / 2) + tick(bot);
        out.push(sig('BOX', false, i, c.c, sl, bot - h, null, conf(70 + Math.min(10, (vr - 1.8) * 5)), 'CLOSE', `持股者：爆量跌破箱底 ${f(bot)}，收盤確認後減碼；站回 ${f(sl)} 才重新評估。空手者不進場。`, `盤整 15 日後爆量 ${vr.toFixed(1)} 倍長黑跌破箱底。`)); } }
    for (let i = n - 2; i < n; i++) { if (i < 61) continue; const b1 = cs[i - 1], b2 = cs[i]; const atr = atrAt(cs, i);
      const m = [['20 日均線', ma20[i]], ['60 日均線', ma60[i]]].filter(([, v]) => v != null).find(([, v]) => Math.abs(b2.l - v) <= atr || Math.abs(b2.h - v) <= atr || (b2.l <= v && b2.h >= v)); if (!m) continue;
      const resist = hiOf(i - 20, i), support = loOf(i - 20, i);
      if (b1.c < b1.o && b2.c > b2.o && b2.o <= b1.c && b2.c >= b1.o && kb.body(b2) > kb.body(b1)) { const fresh = i === n - 1; const entry = fresh ? b2.c : cs[i + 1].o; const sl = b2.l - tick(b2.l);
        const tp1 = resist > entry + (entry - sl) ? resist : entry + (entry - sl) * 2; let cf = 68; if (volR(i) >= 1.3) cf += 8; if (b2.c > m[1]) cf += 6;
        out.push(sig('ENG', true, i, entry, sl, tp1, null, conf(cf), fresh ? 'CLOSE' : 'NEXT', fresh ? `吞噬紅 K 收盤確定（完全包覆前一根）時，於收盤前以 ${f(entry)} 進場，或次日開盤買進。` : `吞噬於昨日成立，以今日開盤 ${f(entry)} 為進場參考。`, `在${m[0]}（${f(m[1])}）附近出現多頭吞噬。`)); }
      if (b1.c > b1.o && b2.c < b2.o && b2.o >= b1.c && b2.c <= b1.o && kb.body(b2) > kb.body(b1)) { const sl = b2.h + tick(b2.h); const tp1 = support < b2.c - (sl - b2.c) ? support : b2.c - (sl - b2.c) * 2;
        out.push(sig('ENG', false, i, b2.c, sl, tp1, null, conf(b2.c < m[1] ? 74 : 66), 'CLOSE', `持股者：空頭吞噬收盤確定後減碼；站回 ${f(sl)} 視為失效。`, `在${m[0]}（${f(m[1])}）附近出現空頭吞噬。`)); } }
  } else {
    const ib = []; for (let i = n - 3; i < n; i++) { if (i < 21) continue; const m = cs[i - 1], k = cs[i]; const mm = ma20[i]; if (mm == null) continue; if (!(k.h <= m.h && k.l >= m.l && k.c > mm)) continue;
      const trig = m.h + tick(m.h); let hit = false; for (let j = i + 1; j < n; j++) if (cs[j].h >= trig) hit = true; const sl = k.l - tick(k.l); let cf = 70; if ((ma60[i] || 0) < k.c) cf += 6; if (kb.range(k) < kb.range(m) * 0.6) cf += 5;
      ib.push(sig('IB', true, i, trig, sl, trig + (trig - sl) * 2, null, conf(cf), 'BRK', hit ? `已盤中突破母棒高點 ${f(trig)} 觸發；以子棒低點 ${f(sl)} 停損，收盤跌破 20 日均線（${f(mm)}）出場。` : `設定盤中觸發單：價格突破母棒高點 ${f(m.h)}＋1 檔（${f(trig)}）瞬間進場；未突破前不動作。`,
        `20 日均線上方的母子線（子棒 ${f(k.l)}～${f(k.h)} 收斂在母棒 ${f(m.l)}～${f(m.h)} 內），波動壓縮待表態。`, hit ? 'TRIGGERED' : 'WAITING', '移動停利：收盤跌破 20 日均線出場')); }
    if (ib.length) out.push(ib[ib.length - 1]);
    for (let e = n - 2; e < n; e++) { if (e < 25) continue; const b1 = cs[e - 4], mid = cs.slice(e - 3, e), b5 = cs[e]; const atr = atrAt(cs, e - 4);
      if (!(b1.c > b1.o && br(b1) >= 0.6 && kb.body(b1) >= atr * 0.8)) continue; if (!mid.every((x) => kb.body(x) <= kb.body(b1) * 0.5 && x.l >= b1.l && x.h <= b1.h + atr * 0.3)) continue; if (!(b5.c > b5.o && br(b5) >= 0.5 && b5.c > b1.h)) continue;
      const fresh = e === n - 1; const entry = fresh ? b5.c : cs[e + 1].o; const sl = b1.l - tick(b1.l);
      out.push(sig('R3', true, e, entry, sl, entry + (entry - sl) * 2, null, conf((ma20[e] || 0) < b5.c ? 78 : 68), fresh ? 'CLOSE' : 'NEXT', fresh ? `第 5 根長紅收盤前確認已超越第 1 根高點 ${f(b1.h)}，於收盤以 ${f(entry)} 進場。` : `上升三法昨日確立，以今日開盤 ${f(entry)} 為參考。`,
        `長紅後三根小 K 整理不破 ${f(b1.l)}，再以長紅突破 ${f(b1.h)}（多方中繼）。`, null, `移動停利：沿 10 日均線（${f(ma10[e] || b5.c)}）或 20 日均線抱牢`)); }
    const pn = []; for (let i = n - 3; i < n; i++) { if (i < 25) continue; const c = cs[i]; const r = Math.min(rsiAt(cl, 14, i), rsiAt(cl, 14, i - 1)); if (r >= 30) continue;
      const hammer = kb.lo(c) >= 2.5 * bodyMin(c) && volR(i) >= 2; const a = cs[i - 2], b = cs[i - 1];
      const star = a.c < a.o && br(a) >= 0.55 && kb.body(b) <= kb.body(a) * 0.4 && Math.max(b.o, b.c) <= a.c + atrAt(cs, i) * 0.3 && c.c > c.o && c.c >= (a.o + a.c) / 2; if (!hammer && !star) continue;
      const fresh = i === n - 1; const entry = fresh ? c.c : cs[i + 1].o; const lm = loOf(i - 4, i + 1); const sl = lm - tick(lm); const m6 = ma60[i]; const tp1 = m6 != null && m6 > entry + (entry - sl) ? m6 : entry + (entry - sl) * 2;
      pn.push(sig('PANIC', true, i, entry, sl, tp1, null, conf(hammer && star ? 85 : hammer ? 78 : 74), fresh ? 'CLOSE' : 'NEXT', (fresh ? '止跌 K 棒收盤確定時進場' : `止跌訊號 ${n - 1 - i} 日前成立，可在 ${f(entry)} 附近`) + `；ETF 大跌末端屬右側較安全的分批加碼點，建議分 2～3 批。停損 ${f(sl)}，目標回升至 60 日均線${m6 != null ? '（' + f(m6) + '）' : ''}。`,
        `RSI(14) ${r.toFixed(0)} 超賣，` + (hammer ? `爆量 ${volR(i).toFixed(1)} 倍長下影線` : '早晨之星') + '止跌。')); }
    if (pn.length) out.push(pn[pn.length - 1]);
    const gp = []; for (let g = Math.max(22, n - 5); g < n - 1; g++) { const pre = cs[g - 1], gap = cs[g]; if (!(gap.h < pre.l)) continue; if ((ma20[g] || 0) <= gap.c && pre.c >= (ma20[g - 1] || 0)) continue;
      let fi = -1; for (let k = g + 1; k <= Math.min(n - 1, g + 3); k++) if (cs[k].c > cs[k].o && cs[k].c > pre.l) { fi = k; break; } if (fi < 0) continue;
      const fresh = fi === n - 1; const c = cs[fi]; const entry = fresh ? c.c : cs[fi + 1].o; const sl = gap.l - tick(gap.l); const top = hiOf(Math.max(0, g - 20), g); const tp1 = top > entry + (entry - sl) ? top : entry + (entry - sl) * 2;
      gp.push(sig('GAP', true, fi, entry, sl, tp1, null, conf(volR(fi) >= 1.3 ? 78 : 70), fresh ? 'CLOSE' : 'NEXT', fresh ? `紅 K 已完全回補向下缺口（收在 ${f(pre.l)} 之上），收盤前以 ${f(entry)} 進場。` : `缺口回補已確立，以 ${f(entry)} 為進場參考。`,
        `下跌末端跳空缺口（${f(gap.h)}～${f(pre.l)}）於 ${fi - g} 日內被紅 K 回補，空方力竭。`)); }
    if (gp.length) out.push(gp[gp.length - 1]);
  }
  const lastC = cs[n - 1].c;
  const valid = (s) => { for (let k = s.i + 1; k < n; k++) if (s.bull ? cs[k].c < s.sl : cs[k].c > s.sl) return false; return s.bull ? lastC > s.sl : lastC < s.sl; };
  const seen = new Set();
  return out.filter(valid).filter((s) => { const k = s.st + s.bull; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.age - b.age || b.conf - a.conf);
}
/** 以 K 棒策略訊號修正進場評估（與 App refineEntry 相同） */
function refineEntry(r, sigs, etf) {
  const e = r.entry; const f = fmtPx;
  const now = sigs.filter((s) => s.age <= 1 && s.status !== 'WAITING' && s.conf >= 70);
  const best = (l) => l.reduce((a, s) => (!a || s.conf > a.conf ? s : a), null);
  const bull = best(now.filter((s) => s.bull)), bear = best(now.filter((s) => !s.bull)), wait = best(sigs.filter((s) => s.bull && s.status === 'WAITING'));
  const tag = (s) => '【' + KS_ST[s.st] + '｜' + KS_TM[s.tm][0] + '】' + s.desc;
  if (bull && (!bear || bull.conf > bear.conf + 5)) {
    const lv = r.dir === -2 && !(etf && bull.st === 'PANIC') ? Math.max(e.level, -1) : e.level >= 1 && bull.conf >= 80 && r.dir > 0 ? 2 : Math.min(2, Math.max(e.level + 1, etf ? 1 : 0));
    return { label: { 2: '訊號偏多', 1: '訊號略偏多', 0: '待回測' }[lv] || '等待止跌確認', level: lv, reason: tag(bull) + ' 停損 ' + f(bull.sl) + '。' + e.reason, tip: lv >= 1 ? '續抱，可依訊號加碼' : e.tip };
  }
  if (bear) { const lv = Math.min(e.level, r.dir > 0 ? 0 : -1); return { label: { 0: '觀望', '-1': '訊號偏弱' }[lv] || '訊號轉弱', level: lv, reason: tag(bear) + ' ' + e.reason, tip: '減碼，跌破 ' + f(Math.min(bear.sl, r.x.support)) + ' 防守' }; }
  if (etf && e.level <= -2) { const rsi = rsiAt(r.cs.map((x) => x.c)); if (rsi < 32) return { label: '等待止跌確認', level: -1, reason: 'ETF 已超賣（RSI ' + rsi.toFixed(0) + '），不追殺；等止跌 K 棒或缺口回補再分批。' + e.reason, tip: '暫不加碼，勿殺低' }; }
  if (wait && e.level >= -1 && e.level <= 1) return { label: e.level >= 1 ? e.label : wait.tm === 'BRK' ? '等突破觸發' : '待回測', level: Math.max(e.level, 0), reason: tag(wait) + ' ' + e.reason, tip: e.tip };
  return e;
}
/** 波動：近 20 日年化波動、相對一年中位數的倍數、ATR(14)／股價 */
function volaOf(cs) {
  if (!cs || cs.length < 60) return null;
  const r = []; for (let i = 1; i < cs.length; i++) r.push(Math.log(cs[i].c / cs[i - 1].c));
  const sd = (l) => { const m = l.reduce((a, v) => a + v, 0) / l.length; return Math.sqrt(l.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(1, l.length - 1)); };
  const cur = sd(r.slice(-20)) * Math.sqrt(250); const hist = []; for (let k = 20; k <= r.length; k++) if (k % 5 === 0) hist.push(sd(r.slice(k - 20, k)) * Math.sqrt(250));
  const h = hist.slice(-50).sort((a, b) => a - b); const med = h.length ? h[Math.floor(h.length / 2)] : cur;
  let atr = 0; for (let i = cs.length - 14; i < cs.length; i++) { const p = cs[i - 1].c; atr += Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - p), Math.abs(cs[i].l - p)); } atr = atr / 14 / cs[cs.length - 1].c * 100;
  const regime = med > 0 ? cur / med : 1;
  const label = regime >= 1.6 ? '波動急遽放大' : regime >= 1.25 ? '波動放大' : regime <= 0.7 ? '波動收斂' : '波動正常';
  // 一年內每 20 日年化波動走勢（給圖）
  const series = []; for (let k = Math.max(20, r.length - 250); k <= r.length; k++) series.push([cs[k].d, sd(r.slice(k - 20, k)) * Math.sqrt(250) * 100]);
  return { atrPct: atr, annual: cur * 100, regime, label, med: med * 100, series };
}
/** 一年價格位階：近一年收盤線性迴歸 ±1σ／±2σ，回傳區位 0（低檔）～5（高檔） */
function bandInfo(b, price) {
  const cl = b.slice(-250).map((x) => x.c); const n = cl.length; if (n < 60) return null;
  const mx = (n - 1) / 2, my = cl.reduce((a, v) => a + v, 0) / n; let sxy = 0, sxx = 0; cl.forEach((v, i) => { sxy += (i - mx) * (v - my); sxx += (i - mx) ** 2; });
  const slope = sxy / sxx, a0 = my - slope * mx; const sigma = Math.sqrt(cl.reduce((acc, v, i) => acc + (v - (a0 + slope * i)) ** 2, 0) / n); const t = a0 + slope * (n - 1);
  const lines = [-2, -1, 0, 1, 2].map((k) => t + k * sigma); const i = lines.findIndex((v) => price < v); const zone = i < 0 ? 5 : i;
  return { zone, name: ['低檔', '偏低', '中低', '中高', '偏高', '高檔'][zone], trend: t, lines, z: sigma > 0 ? (price - t) / sigma : 0 };
}
/**
 * 位階（網頁版自有樣式）：「趨勢偏離走勢」＋「價格階梯」。
 * 偏離走勢：近一年每日收盤相對迴歸趨勢的偏離（σ），以單線呈現，±1σ 為常態區、±2σ 為極端區；
 * 價格階梯：由高到低列出各區的價格門檻，標出現價所在的一階與距離上下一階的漲跌幅。
 */
const BZ_N = ['低檔', '偏低', '中低', '中高', '偏高', '高檔'];
function bandSeries(b) {
  const bb = b.slice(-250); const cl = bb.map((x) => x.c); const n = cl.length; if (n < 60) return null;
  const mx = (n - 1) / 2, my = cl.reduce((a, v) => a + v, 0) / n; let sxy = 0, sxx = 0; cl.forEach((v, i) => { sxy += (i - mx) * (v - my); sxx += (i - mx) ** 2; });
  const slope = sxy / sxx, a0 = my - slope * mx; const sigma = Math.sqrt(cl.reduce((acc, v, i) => acc + (v - (a0 + slope * i)) ** 2, 0) / n);
  return { d: bb.map((x) => x.d), z: cl.map((v, i) => (sigma > 0 ? (v - (a0 + slope * i)) / sigma : 0)), sigma };
}
function bandCardHtml(title, bd, price, f, id) {
  const L = bd.lines; const rows = [5, 4, 3, 2, 1, 0].map((zi) => {
    const lo = zi === 0 ? null : L[zi - 1], hi = zi === 5 ? null : L[zi]; const here = zi === bd.zone;
    const rng = lo == null ? '低於 ' + f(hi) : hi == null ? f(lo) + ' 以上' : f(lo) + '～' + f(hi);
    let dist = '';
    if (here) dist = `<b>現價 ${f(price)}</b>`;
    else if (zi > bd.zone) dist = `<span class="up">再漲 ${((lo / price - 1) * 100).toFixed(1)}%</span>`;
    else dist = `<span class="down">再跌 ${((1 - hi / price) * 100).toFixed(1)}%</span>`;
    return `<div class="bz-row${here ? ' on' : ''}"><span class="bz-step">${'▮'.repeat(zi + 1)}</span><span class="bz-name">${BZ_N[zi]}</span><span class="num bz-rng">${rng}</span><span class="small bz-dist">${dist}</span></div>`;
  }).join('');
  const zt = (bd.z >= 0 ? '+' : '') + bd.z.toFixed(2) + 'σ';
  return `<h2>${title}<span class="r tag">${bd.name}・${zt}</span></h2>
    <div class="chart-wrap bz-wrap" id="${id}"><canvas></canvas><div class="chart-tip"></div></div>
    <div class="bz-ladder">${rows}</div>
    <div class="small muted" style="margin-top:6px">上圖為近一年每日收盤偏離迴歸趨勢（${f(bd.trend)}）的標準差倍數；灰帶為 ±1σ 常態區，虛線為 ±2σ。只代表相對過去趨勢的位置，非買賣建議。</div>`;
}
function drawBandZ(wrap, s, price, bd) {
  if (!wrap || !s) return; wrap._redraw = () => drawBandZ(wrap, s, price, bd); const cv = wrap.querySelector('canvas'); const tip = wrap.querySelector('.chart-tip');
  const W = wrap.clientWidth, H = 170, dpr = pxRatio();
  // 版面還沒排好（寬度 0）時稍後再畫；之後寬度改變（旋轉、側欄收合）自動重畫
  if (W < 60) { wrap._try = (wrap._try || 0) + 1; if (wrap._try < 30) setTimeout(() => drawBandZ(wrap, s, price, bd), 150); return; }
  if (!wrap._ro && window.ResizeObserver) { let lw = W; wrap._ro = new ResizeObserver(() => { if (document.body.contains(wrap) && Math.abs(wrap.clientWidth - lw) > 4) { lw = wrap.clientWidth; drawBandZ(wrap, s, price, bd); } }); wrap._ro.observe(wrap); }
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H); g.font = '11px sans-serif'; g.textBaseline = 'middle';
  const z = s.z.slice(); z[z.length - 1] = bd.z; const n = z.length;
  const lim = Math.max(2.6, Math.ceil(Math.max(...z.map(Math.abs)) * 2) / 2 + 0.2);
  const padL = 6, padR = 40, top = 10, mh = H - 30; const x = (i) => padL + i / (n - 1) * (W - padL - padR); const y = (v) => top + (lim - v) / (2 * lim) * mh;
  const pri = css('--primary') || '#3b82f6', mut = css('--muted') || '#94a3b8', grid = css('--grid') || '#33415555';
  // ±1σ 常態區（灰帶）、±2σ 虛線、0 軸
  g.fillStyle = mut + '22'; g.fillRect(padL, y(1), W - padL - padR, y(-1) - y(1));
  g.strokeStyle = grid; g.lineWidth = 1; g.beginPath(); g.moveTo(padL, y(0)); g.lineTo(W - padR, y(0)); g.stroke();
  g.setLineDash([4, 4]); g.strokeStyle = mut; [2, -2].forEach((k) => { g.beginPath(); g.moveTo(padL, y(k)); g.lineTo(W - padR, y(k)); g.stroke(); }); g.setLineDash([]);
  g.fillStyle = mut; [[2, '+2σ'], [1, '+1σ'], [0, '趨勢'], [-1, '−1σ'], [-2, '−2σ']].forEach(([k, t]) => g.fillText(t, W - padR + 4, y(k)));
  // 偏離線：上方、下方分開填色（不同於色帶樣式）
  const path = () => { g.beginPath(); z.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); };
  ['up', 'dn'].forEach((side) => { g.save(); g.beginPath(); if (side === 'up') g.rect(0, 0, W, y(0)); else g.rect(0, y(0), W, H); g.clip();
    path(); g.lineTo(x(n - 1), y(0)); g.lineTo(x(0), y(0)); g.closePath(); g.fillStyle = (side === 'up' ? '#f59e0b' : '#14b8a6') + '33'; g.fill(); g.restore(); });
  path(); g.strokeStyle = pri; g.lineWidth = 1.6; g.stroke();
  // 現在位置
  const cx = x(n - 1), cy = y(z[n - 1]); g.fillStyle = pri; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill(); g.strokeStyle = css('--card') || '#fff'; g.lineWidth = 2; g.stroke();
  g.fillStyle = mut; const step = Math.max(1, Math.floor(n / 5)); for (let i = 0; i < n - step / 2; i += step) g.fillText(String(s.d[i]).slice(2, 7), Math.max(0, x(i) - 14), H - 8);
  const info = (i) => esc(s.d[i]) + '　偏離 <b>' + (z[i] >= 0 ? '+' : '') + z[i].toFixed(2) + 'σ</b>';
  tip.innerHTML = info(n - 1);
  const move = (e) => { const r = cv.getBoundingClientRect(); const i = Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left - padL) / (W - padL - padR) * (n - 1)))); tip.innerHTML = info(i); };
  cv.onmousemove = move; cv.onclick = move; cv.onmouseleave = () => { tip.innerHTML = info(n - 1); };
}
async function idxCloses(sym) { const r = await fetchYahoo(sym, '6mo', '1d', 1800); return r ? ((r.indicators.quote[0].close) || []).filter((v) => v != null) : []; }
/** 投資分析指數（0–100，與 App InvestAnalysis 同因子與權重） */
async function investAnalysis(sym, bars) {
  const us = isUs(sym); const q = S.q[sym] || {}; const etf = D.isEtf(sym) || (!us && /^00/.test(sym)) || q.type === 'ETF';
  const b = bars.slice(-250); const raw = b.map((x) => x.c); const price = q.price || raw[raw.length - 1]; if (!price) return null;
  const c = raw.slice(0, -1).concat([price]); const F = []; const clamp = (v) => Math.round(Math.max(0, Math.min(100, v))); const add = (name, score, weight, note) => F.push({ name, score: clamp(score), weight, note });
  const f2 = (v) => fmtPx(v);
  // 趨勢
  if (c.length >= 25) { const m20 = smaAt(c, c.length - 1, 20), m60 = smaAt(c, c.length - 1, 60), m120 = smaAt(c, c.length - 1, 120), m20p = smaAt(c, c.length - 6, 20); let s = 0, k = 0; const notes = [];
    [['月線', m20], ['季線', m60], ['半年線', m120]].forEach(([nm, m]) => { if (m > 0) { k++; if (price >= m) { s++; notes.push('站上' + nm); } else notes.push('跌破' + nm); } });
    if (k) { let sc = s / k * 80; if (m20 != null && m20p > 0) { if (m20 > m20p) { sc += 20; notes.push('月線上彎'); } else notes.push('月線下彎'); }
      const base = bars[bars.length - 1].d === ymd() && bars.length > 1 ? bars[bars.length - 2] : bars[bars.length - 1]; const rg = base.h - base.l; const upK = base.l + rg * 1.382, dnK = base.h - rg * 1.382;
      if (price >= upK) { sc += 5; notes.push('站上上關'); } else if (price < dnK) { sc -= 10; notes.push('跌破下關'); }
      add('趨勢', sc, 25, notes.join('、')); } }
  // 動能
  if (c.length >= 21) { const rsi = rsiAt(c); const r20 = (c[c.length - 1] / c[c.length - 21] - 1) * 100; const base = rsi >= 80 ? 35 : rsi >= 70 ? 55 : rsi >= 50 ? 50 + (rsi - 50) * 1.5 : rsi >= 30 ? 25 + (rsi - 30) * 1.25 : 45;
    add('動能', base + Math.max(-10, Math.min(10, r20)), 15, 'RSI ' + rsi.toFixed(0) + '（' + (rsi >= 80 ? '過熱' : rsi >= 70 ? '偏強' : rsi >= 50 ? '多方' : rsi >= 30 ? '空方' : '超賣') + '）、近 20 日 ' + (r20 >= 0 ? '+' : '') + r20.toFixed(1) + '%'); }
  // 估值（台股）
  if (!us) { const val = await kv('sx:val'); const v = val && val[sym]; const pe = v && v[0] > 0 ? v[0] : null, y = v && v[1] >= 0 ? v[1] : null; const parts = [], notes = [];
    if (pe) { parts.push(pe < 10 ? 85 : pe < 15 ? 72 : pe < 20 ? 58 : pe < 30 ? 42 : 28); notes.push('本益比 ' + pe.toFixed(1)); }
    if (y != null && v[1] > 0) { parts.push(y >= 6 ? 85 : y >= 4.5 ? 72 : y >= 3 ? 58 : y >= 1.5 ? 45 : 35); notes.push('殖利率 ' + y.toFixed(2) + '%'); }
    if (parts.length) add('估值', parts.reduce((a, v0) => a + v0, 0) / parts.length, 20, notes.join('、')); }
  // 位置（52 週）
  { const hi = Math.max(...b.map((x) => x.h)), lo = Math.min(...b.map((x) => x.l)); if (hi > lo) { const pos = Math.max(0, Math.min(1, (price - lo) / (hi - lo))); add('位置', 85 - pos * 55, 10, '位於 52 週區間 ' + (pos * 100).toFixed(0) + '%（低 ' + f2(lo) + '／高 ' + f2(hi) + '）'); } }
  // 籌碼（台股）
  if (!us) { try { const days = ((await sapi('chip', sym, '&n=20')).days || []).slice(0, 5); if (days.length) { const lots = days.reduce((a, d) => a + d.f + d.t + d.dl, 0) / 1000, fr = days.reduce((a, d) => a + d.f, 0) / 1000; const buy = days.filter((d) => d.f + d.t + d.dl > 0).length;
    add('籌碼', 50 + (buy - days.length / 2) * 12 + (lots > 0 ? 8 : lots < 0 ? -8 : 0), 15, `法人近 ${days.length} 日 ${fmtSigned(Math.round(lots))} 張（外資 ${fmtSigned(Math.round(fr))}），買超 ${buy} 天`); } } catch (e) {} }
  // 市場
  { const isym = us ? '^GSPC' : '^TWII'; const ic = await idxCloses(isym).catch(() => []); if (ic.length >= 60) { const last = ic[ic.length - 1]; const m60 = ic.slice(-60).reduce((a, v) => a + v, 0) / 60, m20 = ic.slice(-20).reduce((a, v) => a + v, 0) / 20;
    add('市場', (last >= m60 ? 65 : 35) + (last >= m20 ? 15 : -10), 10, (us ? 'S&P 500' : '加權指數') + (last >= m60 ? ' 在季線之上' : ' 在季線之下') + (last >= m20 ? '、站上月線' : '、跌破月線')); } }
  // 風險
  if (c.length >= 30) { const r = []; for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1])); const m = r.reduce((a, v) => a + v, 0) / r.length; const vol = Math.sqrt(r.reduce((a, v) => a + (v - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100;
    add('風險', vol < 15 ? 80 : vol < 25 ? 65 : vol < 35 ? 50 : vol < 50 ? 35 : 25, 5, '年化波動 ' + vol.toFixed(1) + '%'); }
  // 價格位階
  const band = bandInfo(bars, price);
  if (band) add('價格位階', [90, 75, 60, 45, 25, 10][band.zone], 20, `一年價格位階「${band.name}」區，偏離趨勢 ${(band.z >= 0 ? '+' : '') + band.z.toFixed(1)}σ（便宜價 ${f2(band.lines[1])}、趨勢價 ${f2(band.trend)}、偏高價 ${f2(band.lines[3])}）`);
  // 分析師（個股）或 ETF 指標
  let analyst = null, etfInfo = null;
  if (!etf) { try { const fd = (await ys(sym, 'financialData')).financialData || {}; const raw0 = (k) => { const v = fd[k] && fd[k].raw; return v > 0 ? v : null; };
    const key = fd.recommendationKey && fd.recommendationKey !== 'none' ? fd.recommendationKey : null;
    analyst = { rating: key ? ({ strong_buy: '強力買進', buy: '買進', hold: '持有', underperform: '表現落後', sell: '賣出', strong_sell: '強力賣出' }[key] || key) : null, mean: raw0('recommendationMean'), count: raw0('numberOfAnalystOpinions'), target: raw0('targetMeanPrice'), high: raw0('targetHighPrice'), low: raw0('targetLowPrice') };
    const parts = [], notes = []; if (analyst.mean) { parts.push(Math.max(10, Math.min(95, 100 - (analyst.mean - 1) * 21))); notes.push((analyst.rating || '評等') + '（' + analyst.mean.toFixed(1) + '）'); }
    if (analyst.target) { const up = (analyst.target / price - 1) * 100; parts.push(Math.max(10, Math.min(95, 50 + up * 1.5))); notes.push('目標價 ' + f2(analyst.target) + '（' + (up >= 0 ? '+' : '') + up.toFixed(0) + '%）'); }
    if (parts.length) { if (analyst.count) notes.push(analyst.count + ' 位分析師'); add('分析師', parts.reduce((a, v0) => a + v0, 0) / parts.length, 10, notes.join('、')); } else analyst = null; } catch (e) {} }
  else {
    etfInfo = {}; const dh = await divHist(sym).catch(() => []); const yAgo = yearAgoYmd(1); const y12 = dh.filter((d) => d[0] >= yAgo).reduce((a, d) => a + d[1], 0); if (y12 > 0) etfInfo.yieldPct = y12 / price * 100;
    const two = yearAgoYmd(2); const recentDiv = dh.filter((d) => d[0] >= two); let filled = 0, days = [];
    recentDiv.forEach(([d0]) => { const i = bars.findIndex((x) => x.d >= d0); if (i <= 0) return; const pre = bars[i - 1].c; const j = bars.findIndex((x, k) => k >= i && x.c >= pre); if (j >= 0) { filled++; days.push(j - i + 1); } });
    if (recentDiv.length) { etfInfo.divCount = recentDiv.length; etfInfo.filled = filled; etfInfo.avgFill = days.length ? days.reduce((a, v) => a + v, 0) / days.length : null; }
    const parts = [], notes = []; if (etfInfo.yieldPct != null) { const y = etfInfo.yieldPct; parts.push(y >= 7 ? 80 : y >= 5 ? 72 : y >= 3 ? 60 : y >= 1 ? 48 : 40); notes.push('殖利率 ' + y.toFixed(2) + '%'); }
    if (etfInfo.divCount) { parts.push(30 + 60 * etfInfo.filled / etfInfo.divCount); notes.push(`填息 ${etfInfo.filled}/${etfInfo.divCount}` + (etfInfo.avgFill ? `（平均 ${etfInfo.avgFill.toFixed(0)} 天）` : '')); }
    if (parts.length) add('配息', parts.reduce((a, v0) => a + v0, 0) / parts.length, 10, notes.join('、'));
    const vols = bars.slice(-20).map((x) => x.v || 0).filter((v) => v > 0); if (vols.length) { const v = vols.reduce((a, x) => a + x, 0) / vols.length; const lots = us ? v : v; etfInfo.avgVol = lots;
      const sc = us ? (v >= 5e6 ? 85 : v >= 1e6 ? 72 : v >= 2e5 ? 58 : v >= 5e4 ? 45 : 30) : (v >= 10000 ? 85 : v >= 3000 ? 72 : v >= 1000 ? 60 : v >= 200 ? 45 : 30);
      add('流動性', sc, 5, '近 20 日均量 ' + fmtInt(v) + (us ? ' 股' : ' 張') + (sc < 50 ? '，買賣價差可能較大' : '')); }
    try { const r = await ys(sym, 'summaryDetail,defaultKeyStatistics,fundProfile'); const g = (m, k) => { const v = r[m] && r[m][k] && r[m][k].raw; return v > 0 ? v : null; };
      const nav = g('summaryDetail', 'navPrice'), assets = g('summaryDetail', 'totalAssets') || g('defaultKeyStatistics', 'totalAssets'); const ex0 = r.fundProfile && r.fundProfile.feesExpensesInvestment && r.fundProfile.feesExpensesInvestment.annualReportExpenseRatio; const ex = ex0 && ex0.raw > 0 ? ex0.raw * 100 : null;
      const p2 = [], n2 = []; if (ex != null) { p2.push(ex <= 0.2 ? 85 : ex <= 0.5 ? 70 : ex <= 1 ? 52 : 35); n2.push('費用率 ' + ex.toFixed(2) + '%'); } if (assets) { p2.push(assets >= 1e10 ? 80 : assets >= 1e9 ? 65 : assets >= 1e8 ? 50 : 35); n2.push('規模 ' + (assets >= 1e8 ? fmtInt(assets / 1e8) + ' 億' : fmtInt(assets / 1e4) + ' 萬')); }
      if (p2.length) add('規模費用', p2.reduce((a, v0) => a + v0, 0) / p2.length, 5, n2.join('、'));
      if (nav) { const p = ((q.prev || price) / nav - 1) * 100; etfInfo.premium = p; etfInfo.nav = nav; add('折溢價', p > 2 ? 25 : p > 1 ? 40 : p > 0.3 ? 55 : p >= -0.3 ? 72 : p >= -1 ? 70 : 60, 10, '昨收' + (p >= 0 ? '溢價 ' : '折價 ') + Math.abs(p).toFixed(2) + '%（前一日淨值 ' + f2(nav) + '）'); } } catch (e) {}
  }
  if (!F.length) return null;
  const W = F.reduce((a, x) => a + x.weight, 0); const score = Math.round(F.reduce((a, x) => a + x.score * x.weight, 0) / W);
  const [label, advice] = score >= 70 ? ['偏多', '多數指標正向，可考慮分批布局；仍需設定停損與控制部位'] : score >= 58 ? ['中性偏多', '趨勢或基本面略佔優勢，適合拉回分批或續抱'] : score >= 45 ? ['中性', '多空訊號互見，建議觀望或維持原部位'] : score >= 33 ? ['中性偏空', '弱勢指標較多，新資金宜保守，持有者留意支撐'] : ['偏空', '趨勢與籌碼偏弱，宜降低部位或等待轉強訊號'];
  const ratioOf = (s) => (s >= 70 ? 80 : s >= 58 ? 60 : s >= 45 ? 40 : s >= 33 ? 25 : 10);
  const where = band ? `股價位於一年價格位階「${band.name}」區（趨勢價 ${f2(band.trend)}）` : '無價格位階資料'; const z = band ? band.zone : null;
  const vd = z == null ? (score >= 58 ? ['指標偏多', `指數 ${score} 偏多；${where}`, ratioOf(score), 1] : score >= 45 ? ['中性觀察', `指數 ${score} 中性；${where}`, ratioOf(score), 0] : ['指標偏弱', `指數 ${score} 偏弱；${where}`, 10, -1])
    : z <= 1 && score >= 45 ? ['價格偏低・指標偏多', `價格便宜且指標不弱：${where}、指數 ${score}`, score >= 58 ? 80 : 60, 1]
    : z <= 1 ? ['價格偏低・指標偏弱', `${where}，但指數 ${score} 趨勢與籌碼偏弱，可留意是否出現止跌訊號`, 25, 0]
    : z <= 3 && score >= 58 ? ['價格合理・指標偏多', `價格合理、指數 ${score} 偏多；${where}`, 60, 1]
    : z <= 3 && score >= 45 ? ['價格合理・指標中性', `價格合理、指數 ${score} 中性；${where}`, 30, 0]
    : z <= 3 ? ['指標偏弱', `價格不算便宜、指數 ${score} 偏弱；${where}`, 10, -1]
    : score >= 70 ? ['價格偏高・指標強勢', `${where}，偏貴但指數 ${score} 強勢`, 10, 0] : ['價格偏高・指標不強', `${where}，價格偏貴且指數 ${score} 不夠強`, 0, -1];
  return { score, label, advice, factors: F, analyst, etf: etfInfo, band, verdict: { title: vd[0], reason: vd[1], ratio: vd[2], tone: vd[3] }, isEtf: etf };
}
/** 個股日 K（2 年）並以即時報價補上今日 K 棒 */
async function liveBars(sym, range = '2y') {
  const key = sym + range; const b0 = barCache[key] || (barCache[key] = await loadBars(sym, range)); if (!b0 || !b0.length) return [];
  const q = S.q[sym] || {}; const b = b0.slice(); const today = ymd();
  if (q.price && !isUs(sym) && twOpen()) { const last = b[b.length - 1]; const cur = { d: today, o: q.open || q.price, h: Math.max(q.high || q.price, q.price), l: Math.min(q.low || q.price, q.price), c: q.price, v: q.volLots || 0 }; if (last.d === today) b[b.length - 1] = cur; else b.push(cur); }
  return b;
}
const RING_C = { ok: '#2ED29A', mid: '#F2B33D', idle: '#6B7385', alert: '#E5534B' };
function ringColor(st) { return st.broken ? RING_C.alert : st.level >= 3 ? RING_C.ok : st.level >= 1 ? RING_C.mid : RING_C.idle; }
const RING_LB = ['0/3 待機', '1/3 週 K 支撐帶', '2/3 日 K 止跌', '3/3 條件全達成'];
/** 三環準星（外環週 K、中環日 K、靶心即時；達成的環亮起） */
function ringSvg(st, size = 120) {
  const c = ringColor(st); const on = [st.outer, st.middle, st.center]; const R = [54, 37, 20];
  const ring = (i) => `<circle cx="60" cy="60" r="${R[i]}" fill="none" stroke="${on[i] ? c : RING_C.idle}" stroke-opacity="${on[i] ? 1 : 0.35}" stroke-width="${on[i] ? 5 : 3}"/>`;
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" style="flex:none">${on[2] ? `<circle cx="60" cy="60" r="58" fill="${c}" fill-opacity="0.10"/>` : ''}
    <line x1="2" y1="60" x2="118" y2="60" stroke="${RING_C.idle}" stroke-opacity="0.3"/><line x1="60" y1="2" x2="60" y2="118" stroke="${RING_C.idle}" stroke-opacity="0.3"/>
    ${ring(0)}${ring(1)}${ring(2)}<circle cx="60" cy="60" r="7" fill="${on[2] ? c : RING_C.idle}" fill-opacity="${on[2] ? 1 : 0.4}"/></svg>`;
}
/** 三環科技版動畫（網頁）：8 種樣式，S.pref.ringSty（0～7，預設 3 多重安全鎖）、S.pref.ringAnim（預設開）。
 *  只在 1/3～3/3 且未破停損時跑動畫（0/3、破停損靜態）；分頁隱藏或卡片不在畫面時暫停；約 20 fps。 */
const RX_C = { ok: '#19FFB2', mid: '#FFC23D', id: '#2E5470', al: '#FF3B5C', cy: '#00E5FF' };
const RX_STY = [['全像光圈', 'FOCUS'], ['資料管線', 'PIPELINE'], ['全像波場', 'WAVEFIELD'], ['多重安全鎖', 'SECURITY'], ['三軸對位', 'ALIGN'], ['HUD 戰術量尺', 'TACTICAL'], ['神經迴路', 'CIRCUIT'], ['能量核心', 'CORE']];
let RX_N = 0;
function rxCol(s) { return s.b ? RX_C.al : s.lv >= 3 ? RX_C.ok : s.lv >= 1 ? RX_C.mid : RX_C.cy; }
/** 由三環結果取繪圖資料：lv、b（破停損）、價位 */
function rxData(st) { return { lv: st.level, b: !!st.broken, rr: st.rr, lo: st.zoneLo, hi: st.zoneHi, stop: st.stop, tp: st.target, px: st.price }; }
function rxSvg(sty, s, t, size = 150, mini = false) {
  const C = RX_C, c = rxCol(s), M = 'font-family="monospace"', on = (i) => !s.b && s.lv > i, f = (v) => fmtPx(v);
  const P = (r, a) => [60 + r * Math.cos(a), 60 + r * Math.sin(a)];
  const arc = (r, d0, d1) => { const [x0, y0] = P(r, d0 * Math.PI / 180), [x1, y1] = P(r, d1 * Math.PI / 180); return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`; };
  const ticks = (r, n, l, cc, op = 0.5, rot = 0, cx = 60, cy = 60) => { let x = ''; for (let k = 0; k < n; k++) { const a = k * 2 * Math.PI / n + rot; const l2 = k % 5 ? l : l * 2;
    x += `<line x1="${(cx + r * Math.cos(a)).toFixed(1)}" y1="${(cy + r * Math.sin(a)).toFixed(1)}" x2="${(cx + (r - l2) * Math.cos(a)).toFixed(1)}" y2="${(cy + (r - l2) * Math.sin(a)).toFixed(1)}" stroke="${cc}" stroke-opacity="${op}" stroke-width=".8"/>`; } return x; };
  const lbl = ['W-K', 'D-K', 'RT'];
  let x = '';
  switch (sty) {
    case 0: { // 全像光圈
      const r = s.b ? 40 : 44 - s.lv * 10; const rot = t * 0.25;
      x += ticks(54, 60, 3, c, 0.6, -rot * 0.5) + `<circle cx="60" cy="60" r="54" fill="none" stroke="${c}" stroke-width="1"/>`;
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.25 + rot, a2 = a + Math.PI / 3; const [p1, q1] = P(48, a), [p2, q2] = P(48, a2), [p3, q3] = P(r, a2 + 0.5), [p4, q4] = P(r, a + 0.5);
        x += `<polygon points="${p1.toFixed(1)},${q1.toFixed(1)} ${p2.toFixed(1)},${q2.toFixed(1)} ${p3.toFixed(1)},${q3.toFixed(1)} ${p4.toFixed(1)},${q4.toFixed(1)}" fill="#06223a" fill-opacity=".85" stroke="${c}" stroke-width=".9"/>`; }
      x += `<line x1="60" y1="${60 - r + 2}" x2="60" y2="${60 + r - 2}" stroke="${c}" stroke-width=".6"/><line x1="${60 - r + 2}" y1="60" x2="${60 + r - 2}" y2="60" stroke="${c}" stroke-width=".6"/>`;
      if (s.lv >= 3 && !s.b) x += `<circle cx="60" cy="60" r="${3 + 2 * (0.5 + 0.5 * Math.sin(t * 3))}" fill="#fff"/>`;
      if (s.b) for (let k = 0; k < 9; k++) x += `<rect x="${28 + (k * 29) % 60}" y="${30 + (k * 17) % 58}" width="${6 + (k * 7) % 14}" height="1.6" fill="${C.al}" opacity=".8"/>`;
      if (!mini) x += `<rect x="34" y="1" width="52" height="9" fill="#050a14"/><text x="60" y="8" text-anchor="middle" ${M} font-size="7" fill="${c}">FOCUS ${s.b ? 'ERR' : [0, 34, 67, 100][s.lv] + '%'}</text>`;
      break; }
    case 1: { // 資料管線
      const L = [[14, 106, 24, 96], [26, 94, 38, 82], [40, 80, 50, 70]];
      L.forEach((l, i) => { const y = 14 + i * 24; const o = on(i); const cc = o ? c : C.id;
        x += `<polygon points="${l[0]},${y} ${l[1]},${y} ${l[3]},${y + 18} ${l[2]},${y + 18}" fill="${o ? c : '#08182a'}" fill-opacity="${o ? 0.12 : 0.9}" stroke="${cc}" stroke-width="1.2"/>`;
        if (!mini) x += `<text x="${l[1] + 3}" y="${y + 12}" ${M} font-size="6.5" fill="${cc}">${['W', 'D', 'RT'][i]}</text>`;
        if (o) for (let k = 0; k < 6; k++) { const yy = y + 2 + ((k * 5 + t * 14) % 14); const w = l[2] - l[0]; const fr = (yy - y) / 18; const xl = l[0] + w * fr + 3, xr = l[1] - (l[1] - l[3]) * fr - 7;
          x += `<rect x="${(xl + ((k * 19) % Math.max(1, xr - xl))).toFixed(1)}" y="${yy.toFixed(1)}" width="4" height="2" fill="${c}"/>`; }
        else if (!mini) x += `<text x="${(l[0] + l[1]) / 2}" y="${y + 12}" text-anchor="middle" ${M} font-size="6.5" fill="${s.b ? C.al : C.id}">${s.b ? '× HALT' : '— —'}</text>`; });
      const fl = s.lv >= 3 && !s.b; const blink = fl ? 0.2 + 0.15 * Math.sin(t * 4) : 1;
      x += `<line x1="60" y1="86" x2="60" y2="94" stroke="${fl ? c : C.id}" stroke-dasharray="1.5 2" stroke-dashoffset="${-t * 8}"/><rect x="34" y="94" width="52" height="11" fill="${fl ? c : '#08182a'}" fill-opacity="${fl ? blink : 1}" stroke="${fl ? c : s.b ? C.al : C.id}"/>`;
      if (!mini) x += `<text x="60" y="102" text-anchor="middle" ${M} font-size="6.5" fill="${fl ? '#fff' : s.b ? C.al : C.id}">${fl ? 'SIGNAL READY' : s.b ? 'STOP' : 'WAIT'}</text>`;
      break; }
    case 2: { // 全像波場
      for (let k = -3; k <= 3; k++) x += `<line x1="${60 + k * 8}" y1="70" x2="${60 + k * 22}" y2="104" stroke="${C.cy}" stroke-opacity=".25" stroke-width=".7"/>`;
      for (let k = 0; k < 4; k++) { const yy = 72 + k * k * 3.2; x += `<line x1="${60 - 30 - k * 13}" y1="${yy}" x2="${60 + 30 + k * 13}" y2="${yy}" stroke="${C.cy}" stroke-opacity=".2" stroke-width=".7"/>`; }
      [48, 33, 18].forEach((r0, i) => { const o = on(i); const r = o ? r0 * (1 - 0.08 * ((t * 0.8 + i * 0.33) % 1)) : r0;
        x += `<ellipse cx="60" cy="82" rx="${r.toFixed(1)}" ry="${(r * 0.36).toFixed(1)}" fill="none" stroke="${o ? c : C.id}" stroke-opacity="${o ? 1 : 0.6}" stroke-width="${o ? 2.2 : 1}" ${o ? '' : 'stroke-dasharray="3 3"'}/>`;
        if (o) x += `<path d="M${(60 - r - 6).toFixed(1)},82 l4,-2 v4z M${(60 + r + 6).toFixed(1)},82 l-4,-2 v4z" fill="${c}"/>`; });
      if (s.lv >= 3 && !s.b) { const h = Math.min(58, 14 + (s.rr || 0) * 11); const fl = 0.35 + 0.15 * Math.sin(t * 5);
        x += `<rect x="57" y="${80 - h}" width="6" height="${h}" fill="${c}" opacity="${fl.toFixed(2)}"/><rect x="59" y="${80 - h}" width="2" height="${h}" fill="#fff"/>`;
        if (!mini) x += `<text x="68" y="${86 - h}" ${M} font-size="7.5" fill="${c}">RR ${(s.rr || 0).toFixed(1)}</text>`; }
      if (s.b) x += `<ellipse cx="60" cy="82" rx="54" ry="20" fill="${C.al}" opacity=".2"/>` + (mini ? '' : `<text x="60" y="50" text-anchor="middle" ${M} font-size="9" fill="${C.al}">!! BREACH</text>`);
      break; }
    case 3: { // 多重安全鎖
      x += ticks(56, 72, 2.5, C.cy, 0.35, t * 0.1);
      [48, 36, 24].forEach((r, i) => { const o = on(i); const n = [12, 9, 6][i]; const rot = o ? t * [14, -20, 28][i] : 0;
        for (let k = 0; k < n; k++) { const gp = o ? 360 / n * 0.2 : 2; const d0 = k * 360 / n + gp + rot, d1 = (k + 1) * 360 / n - gp + rot; x += `<path d="${arc(r, d0 - 90, d1 - 90)}" fill="none" stroke="${o ? c : s.b ? '#7a1f33' : C.id}" stroke-width="${o ? 4 : 5}"/>`; }
        if (!o) { const [lx, ly] = P(r, -Math.PI / 2); x += `<rect x="${lx - 3.5}" y="${ly - 3.5}" width="7" height="7" fill="#050a14" stroke="${s.b ? C.al : C.cy}"/><circle cx="${lx}" cy="${ly}" r="1.3" fill="${s.b ? C.al : C.cy}"/>`; } });
      if (mini) break;
      x += s.lv >= 3 && !s.b ? `<text x="60" y="57" text-anchor="middle" ${M} font-size="6" fill="${c}">ZONE</text><text x="60" y="64" text-anchor="middle" ${M} font-size="6.5" fill="#fff">${f(s.lo)}</text><text x="60" y="71" text-anchor="middle" ${M} font-size="6.5" fill="#fff">${f(s.hi)}</text>`
        : `<text x="60" y="63" text-anchor="middle" ${M} font-size="8" fill="${s.b ? C.al : C.cy}">${s.b ? 'LOCK' : '0' + s.lv + '/3'}</text>`;
      break; }
    case 4: { // 三軸對位
      [22, 60, 98].forEach((cx, i) => { const o = on(i); const cc = o ? c : s.b ? C.al : C.cy;
        const off = o ? Math.sin(t * 3 + i) * 3 : s.b ? [64, -118, 146][i] : [64, -118, 146][i] + Math.sin(t * 0.9 + i * 2) * (s.lv ? 40 : 0);
        const a = (-90 + off) * Math.PI / 180;
        x += `<circle cx="${cx}" cy="50" r="16" fill="#061525" stroke="${cc}" stroke-width="1"/>` + ticks(15, 24, 2, cc, 0.6, 0, cx, 50);
        x += `<line x1="${cx}" y1="28" x2="${cx}" y2="33" stroke="${RX_C.ok}" stroke-width="1.5"/><line x1="${cx}" y1="50" x2="${(cx + 12 * Math.cos(a)).toFixed(1)}" y2="${(50 + 12 * Math.sin(a)).toFixed(1)}" stroke="${o ? c : '#cfe9f5'}" stroke-width="2" stroke-linecap="round"/><circle cx="${cx}" cy="50" r="2" fill="${cc}"/>`;
        x += `<rect x="${cx - 13}" y="72" width="26" height="10" fill="${o ? c : '#061525'}" fill-opacity="${o ? 0.2 : 1}" stroke="${cc}" stroke-width=".8"/>`;
        if (!mini) x += `<text x="${cx}" y="79.5" text-anchor="middle" ${M} font-size="6.5" fill="${o ? '#fff' : cc}">${o ? 'OK' : s.b ? 'ERR' : '---'}</text><text x="${cx}" y="92" text-anchor="middle" ${M} font-size="6.5" fill="#86a9bd">${lbl[i]}</text>`; });
      if (s.lv >= 3 && !s.b) x += `<line x1="10" y1="34" x2="110" y2="34" stroke="${c}" stroke-dasharray="2 2" stroke-dashoffset="${-t * 10}" stroke-width=".8"/>`;
      break; }
    case 5: { // HUD 戰術量尺
      const lo = Math.min(s.stop, s.px, s.lo) , hi = Math.max(s.tp, s.px, s.hi); const pad = (hi - lo) * 0.08 || 1; const y = (v) => 100 - (v - (lo - pad)) / ((hi + pad) - (lo - pad)) * 84;
      x += `<circle cx="34" cy="58" r="27" fill="none" stroke="${C.cy}" stroke-opacity=".3"/>` + ticks(27, 36, 2, C.cy, 0.5, t * 0.4, 34, 58);
      let g = '';
      [22, 14, 6].forEach((r, i) => { const o = on(i); x += `<circle cx="34" cy="58" r="${r}" fill="none" stroke="${o ? c : C.id}" stroke-width="${o ? 2 : 1}" ${o ? '' : 'stroke-dasharray="2 2"'}/>`; });
      x += `<path d="M34,26 v8 M34,82 v8 M2,58 h8 M58,58 h8" stroke="${c}" stroke-width="1.2"/>`;
      for (let k = 0; k <= 8; k++) { const yy = 16 + k * 10.5; g += `<line x1="${k % 2 ? 86 : 84}" y1="${yy}" x2="90" y2="${yy}" stroke="${C.cy}" stroke-opacity=".6" stroke-width=".7"/>`; }
      const yp = y(s.px), yt = y(s.tp), ys = y(s.stop);
      g += `<line x1="90" y1="16" x2="90" y2="100" stroke="${C.cy}" stroke-opacity=".6"/>`;
      if (yp > yt) g += `<rect x="91" y="${yt.toFixed(1)}" width="5" height="${(yp - yt).toFixed(1)}" fill="${RX_C.ok}" opacity=".7"/>`;
      if (ys > yp) g += `<rect x="91" y="${yp.toFixed(1)}" width="5" height="${(ys - yp).toFixed(1)}" fill="${RX_C.al}" opacity=".7"/>`;
      g += `<rect x="89" y="${y(s.hi).toFixed(1)}" width="9" height="${Math.max(1, y(s.lo) - y(s.hi)).toFixed(1)}" fill="none" stroke="${RX_C.mid}" stroke-dasharray="1.5 1.5" stroke-width=".8"/>`;
      if (!mini) { g += `<text x="99" y="${(yt + 2.5).toFixed(1)}" ${M} font-size="5.5" fill="${RX_C.ok}">TP ${f(s.tp)}</text><text x="99" y="${(ys + 2.5).toFixed(1)}" ${M} font-size="5.5" fill="${RX_C.al}">SL ${f(s.stop)}</text>`;
        g += `<text x="76" y="${(yp + 2.5).toFixed(1)}" text-anchor="end" ${M} font-size="6.5" fill="#fff">${f(s.px)}</text>`; }
      g += `<path d="M78,${yp.toFixed(1)} l7,-3.5 v7z" fill="#fff" opacity="${s.lv && !s.b ? (0.55 + 0.45 * Math.abs(Math.sin(t * 2.5))).toFixed(2) : 1}"/>`;
      x += `<g transform="translate(-9 0)">${g}</g>`;
      break; }
    case 6: { // 神經迴路
      const N = [[22, 88], [98, 88], [60, 24]];
      for (let k = 0; k < 5; k++) x += `<path d="M${10 + k * 25},112 v-6 h6" fill="none" stroke="${C.cy}" stroke-opacity=".25"/>`;
      const tr = [[[22, 88], [60, 88], [60, 60]], [[98, 88], [60, 88]], [[60, 24], [60, 60]]];
      tr.forEach((pts, i) => { const o = on(i); x += `<path d="M${pts.map((p) => p.join(',')).join(' L')}" fill="none" stroke="${o ? c : C.id}" stroke-width="${o ? 1.8 : 1}" ${o ? '' : 'stroke-dasharray="2 2"'}/>`;
        if (o) { // 電流脈衝沿走線移動
          const seg = []; let tot = 0; for (let k = 1; k < pts.length; k++) { const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); seg.push(l); tot += l; }
          [0, 0.5].forEach((ph) => { let d = ((t * 0.7 + ph + i * 0.2) % 1) * tot; let k = 0; while (k < seg.length - 1 && d > seg[k]) { d -= seg[k]; k++; } const fr = seg[k] ? d / seg[k] : 0;
            x += `<circle cx="${(pts[k][0] + (pts[k + 1][0] - pts[k][0]) * fr).toFixed(1)}" cy="${(pts[k][1] + (pts[k + 1][1] - pts[k][1]) * fr).toFixed(1)}" r="2" fill="#fff"/>`; }); } });
      const core = s.lv >= 3 && !s.b; const cs = core ? 22 + 2 * Math.sin(t * 3) : 14;
      x += `<rect x="${(60 - cs / 2).toFixed(1)}" y="${(60 - cs / 2).toFixed(1)}" width="${cs.toFixed(1)}" height="${cs.toFixed(1)}" fill="#061525" stroke="${core ? c : s.b ? C.al : C.id}" stroke-width="1.4" transform="rotate(45 60 60)"/>` + (core ? `<circle cx="60" cy="60" r="4" fill="#fff"/>` : '');
      N.forEach((p, i) => { const o = on(i); const cc = o ? c : s.b ? C.al : C.id; x += `<circle cx="${p[0]}" cy="${p[1]}" r="8" fill="#061525" stroke="${cc}" stroke-width="1.5"/><circle cx="${p[0]}" cy="${p[1]}" r="${o ? 3.5 : 1.5}" fill="${o ? '#fff' : cc}"/>`;
        if (!mini) x += `<text x="${p[0]}" y="${p[1] + (i === 2 ? -11 : 16)}" text-anchor="middle" ${M} font-size="6" fill="${cc}">${lbl[i]}</text>`; });
      break; }
    default: { // 能量核心
      x += ticks(54, 48, 2, C.cy, 0.4, -t * 0.15);
      for (let i = 0; i < 3; i++) { const o = on(i); for (let k = 0; k < 6; k++) { const d0 = -90 + i * 120 + k * 20 + 2, d1 = d0 + 16; const sh = o ? 0.65 + 0.35 * Math.max(0, Math.sin(t * 4 - (i * 6 + k) * 0.5)) : 1;
        x += `<path d="${arc(42, d0, d1)}" fill="none" stroke="${o ? c : '#0f2a40'}" stroke-width="10" stroke-opacity="${sh.toFixed(2)}"/>`; } }
      const core = s.lv >= 3 && !s.b;
      x += `<circle cx="60" cy="60" r="28" fill="#061525" stroke="${c}" stroke-opacity=".6"/>` + (core ? `<circle cx="60" cy="60" r="${(18 + 3 * Math.sin(t * 2.5)).toFixed(1)}" fill="${c}" opacity=".2"/>` : '');
      if (!mini) x += s.b ? `<text x="60" y="64" text-anchor="middle" ${M} font-size="10" font-weight="700" fill="${C.al}">STOP</text>` : `<text x="60" y="63" text-anchor="middle" ${M} font-size="14" font-weight="700" fill="#fff">${s.lv}/3</text><text x="60" y="72" text-anchor="middle" ${M} font-size="5.5" fill="${c}">${[0, 33, 67, 100][s.lv]}% CHARGE</text>`;
    }
  }
  const id = 'rxg' + (++RX_N % 1000);
  const br = `<path d="M4,16 V4 H16 M104,4 H116 V16 M116,104 V116 H104 M16,116 H4 V104" fill="none" stroke="${c}" stroke-width="1.4" opacity=".8"/>`;
  const rd = mini ? '' : `<rect x="24" y="108" width="72" height="9" fill="#050a14"/><text x="60" y="114" text-anchor="middle" ${M} font-size="7" fill="${c}" letter-spacing="1">${s.b ? 'STOP BREACH' : 'LV ' + s.lv + '/3 · RR 1:' + (s.rr || 0).toFixed(1)}</text>`;
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" style="flex:none;display:block"><defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(2.2 * (RX.gl ?? 1)).toFixed(2)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${mini ? '' : br}<g filter="url(#${id})">${x}${rd}</g></svg>`;
}
// ───────── 分析總結方框（各單項一格，依結果變色：紅偏多／黃中性／綠偏弱／灰虛線失效） ─────────
const SM_C = { up: '#FF5A6E', mid: '#F2B544', dn: '#22C58B', off: '#6B7A94', ld: '#2E5470' };
const SM_IC = {
  rg: '<circle cx="10" cy="10" r="8"/><circle cx="10" cy="10" r="5"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/>',
  ka: '<line x1="5" y1="3" x2="5" y2="17"/><rect x="3" y="6" width="4" height="7" fill="currentColor"/><line x1="14" y1="2" x2="14" y2="16"/><rect x="12" y="5" width="4" height="8"/>',
  ia: '<path d="M3 15a7 7 0 0 1 14 0"/><line x1="10" y1="15" x2="14" y2="8"/>',
  vo: '<path d="M2 10h3l2-5 3 10 3-7 2 2h3"/>' };
function smStyleInject() {
  if (document.getElementById('smCss')) return; const el = document.createElement('style'); el.id = 'smCss';
  el.textContent = `.smw{position:relative;container-type:inline-size}.smg{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@container (min-width:640px){.smg{grid-template-columns:repeat(4,minmax(0,1fr))}}
.sml{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:#6f84a3;margin-top:8px}.sml i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:0}
.smb{position:relative;border-radius:12px;padding:10px 11px;background:linear-gradient(160deg,var(--c1),#07101e 72%);border:1.5px solid var(--c);box-shadow:0 0 calc(12px * var(--gw,1)) -3px var(--c),inset 0 0 calc(16px * var(--gw,1)) -8px var(--c);cursor:pointer;min-width:0}
.smg.c2{grid-template-columns:1fr 1fr !important}.smg.c4{grid-template-columns:repeat(4,minmax(0,1fr)) !important}.smg.nc .smb:before,.smg.nc .smb:after{display:none}
.smg.pl .smb:not(.ld){animation:smP var(--ps,2.4s) ease-in-out infinite}@keyframes smP{50%{box-shadow:0 0 calc(22px * var(--gw,1)) -1px var(--c),inset 0 0 calc(22px * var(--gw,1)) -6px var(--c)}}
.smbk{animation:smK 1.2s steps(2,end) infinite}@keyframes smK{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.smg.pl .smb,.smbk{animation:none}}
.smb:before,.smb:after{content:"";position:absolute;width:11px;height:11px;border:2px solid var(--c)}.smb:before{top:4px;left:4px;border-right:0;border-bottom:0}.smb:after{bottom:4px;right:4px;border-left:0;border-top:0}
.smb .k{display:flex;align-items:center;gap:6px;font-size:12px;color:#9fb0cc}.smb .k svg{width:17px;height:17px;flex:none;color:var(--c)}.smb .k em{margin-left:auto;font-style:normal;font-size:11px;color:#6f84a3}
.smb .r{font-size:20px;font-weight:800;color:var(--c);margin:3px 0 1px;text-shadow:0 0 calc(10px * var(--gw,1)) var(--c);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.smb .s{font-size:11.5px;color:#c4d0e4;line-height:1.5}.smb .m{display:flex;gap:4px;margin-top:6px}.smb .m i{flex:1;height:5px;border-radius:3px;background:#22304d}.smb .m i.on{background:var(--c);box-shadow:0 0 6px var(--c)}
.smb.off{border-style:dashed}.smb.off .r{text-decoration:line-through;text-shadow:none}.smb.ld .r{color:#6f84a3;text-shadow:none;font-size:15px}
@media (max-width:360px){.smb .r{font-size:17px}}`;
  document.head.appendChild(el);
}
/** o：{ rg: ringsEval 結果, ka: {dir,str,n,sup,res}, ia: investAnalysis 結果, vo: volaOf 結果 }；undefined＝計算中、0＝資料不足 */
function sumHtml(o, C = sumCfg(), pv = false) {
  rxStyleInject(); smStyleInject(); const f = fmtPx; const sh = C.show || {};
  const seg = (n, t) => `<div class="m">${Array.from({ length: t }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`;
  const bar = (v) => `<div class="m" style="gap:0;background:#22304d;border-radius:3px"><i class="on" style="flex:none;width:${Math.max(2, Math.min(100, v))}%"></i></div>`;
  const box = (k, go, name, tone, r, sub, meter) => sh[k] === false ? '' : `<div class="smb ${tone}" style="--c:${SM_C[tone]};--c1:${SM_C[tone]}26" data-smgo="${go}"><div class="k"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">${SM_IC[k]}</svg>${name}<em>詳情 ›</em></div><div class="r">${r}</div><div class="s">${sub}</div>${meter || ''}</div>`;
  const ld = (k, go, name, v) => box(k, go, name, 'ld', v === 0 ? '資料不足' : '計算中…', '', '');
  const tn = []; let h = '';
  const g = o.rg;
  if (!g) h += ld('rg', 'rgC', '三環條件', g);
  else { const lv = g.broken ? 0 : g.level; const t = g.broken ? 'off' : lv >= C.rgUp ? 'up' : lv >= 1 ? 'mid' : 'dn'; if (sh.rg !== false) tn.push(t);
    h += box('rg', 'rgC', '三環條件', t, g.broken ? '失效' : lv + ' / 3 環', (g.broken ? '收盤跌破停損 ' + f(g.stop) + '<br>條件重置' : ['週 K 條件未成立', '週 K 成立・日 K 待確認', '日 K 已確認・即時待確認', '三環條件全數成立'][lv] + (g.zoneLo ? '<br>區間 ' + f(g.zoneLo) + '–' + f(g.zoneHi) : '')), seg(lv, 3)); }
  const k = o.ka;
  if (!k) h += ld('ka', 'kaC', 'K 線形態', k);
  else { const t = k.str < C.kaStr ? 'mid' : k.dir > 0 ? 'up' : k.dir < 0 ? 'dn' : 'mid'; if (sh.ka !== false) tn.push(t);
    h += box('ka', 'kaC', 'K 線形態', t, DIRL[k.dir], '日 K 強度 ' + k.str + (k.n ? '・訊號 ' + k.n : '') + '<br>支撐 ' + f(k.sup) + '／壓力 ' + f(k.res), bar(k.str)); }
  const a = o.ia;
  if (!a) h += ld('ia', 'iaC', '投資分析指數', a);
  else { const t = a.score >= C.iaUp ? 'up' : a.score < C.iaDn ? 'dn' : 'mid'; if (sh.ia !== false) tn.push(t);
    h += box('ia', 'iaC', '投資分析指數', t, a.score + ' ' + esc(a.label), esc(a.verdict.title) + '<br>模型試算 ' + a.verdict.ratio + '%', bar(a.score)); }
  const v = o.vo;
  if (!v) h += ld('vo', 'voC', '波動', v);
  else { const t = v.regime >= 1.25 ? 'dn' : v.regime <= 0.7 ? 'up' : 'mid'; if (C.voIn && sh.vo !== false) tn.push(t);
    h += box('vo', 'voC', '波動', t, esc(v.label) + ' ×' + v.regime.toFixed(1), '年化 ' + v.annual.toFixed(0) + '%・ATR ' + v.atrPct.toFixed(1) + '%' + (v.regime >= 1.25 ? '<br>停損距離需放寬' : ''), bar(Math.min(100, v.regime * 50))); }
  const nu = tn.filter((x) => x === 'up').length, nd = tn.filter((x) => x === 'dn' || x === 'off').length, nm = tn.length - nu - nd;
  const want = ['rg', 'ka', 'ia'].filter((x) => sh[x] !== false).length + (C.voIn && sh.vo !== false ? 1 : 0);
  const split = C.div === 'any' ? new Set(tn.map((x) => (x === 'off' ? 'dn' : x))).size > 1 : nu && nd;
  const tag = tn.length < want || !want ? ['計算中', SM_C.ld] : split ? ['分歧', SM_C.mid] : nu === want ? [want + ' 偏多・同向', SM_C.up] : nd === want ? [want + ' 偏弱・同向', SM_C.dn]
    : [[nu && nu + ' 偏多', nm && nm + ' 中性', nd && nd + ' 偏弱'].filter(Boolean).join('・'), nu > nd ? SM_C.up : nd > nu ? SM_C.dn : SM_C.mid];
  const cls2 = [C.cols === 2 ? 'c2' : C.cols === 4 ? 'c4' : '', C.corner === false ? 'nc' : '', C.pulse ? 'pl' : ''].join(' ');
  return `<h2 style="position:relative;display:flex;align-items:center;gap:8px;white-space:nowrap;font-size:16px;margin:0 0 10px">分析總結 <span class="small" style="color:#6f84a3;font-weight:400">// SUMMARY</span><span class="${split && C.blink ? 'smbk' : ''}" style="margin-left:auto;font-size:12px;padding:2px 9px;border-radius:99px;border:1px solid ${tag[1]};color:${tag[1]}">${tag[0]}</span>${pv ? '' : '<span class="rxsw" data-smg title="總結設定" style="cursor:pointer">⚙</span>'}</h2>
    <div class="smw" style="--gw:${C.glow};--ps:${(2.4 / (C.pulseSpd || 1)).toFixed(2)}s"><div class="smg ${cls2}">${h}</div>${C.legend === false ? '' : `<div class="sml">${[['up', '偏多'], ['mid', '中性'], ['dn', '偏弱'], ['off', '失效']].map(([c, t]) => `<span><i style="background:${SM_C[c]}"></i>${t}</span>`).join('')}<span>波動：紅低／綠高</span><span style="margin-left:auto">點方框看完整分析・僅為分析彙整，不構成投資建議</span></div>`}</div>`;
}
// ───────── 三環／分析總結設定（構造與 starSettings 相同） ─────────
const RING_DEF = { trend: true, bandLo: 0.5, nearPct: 3, brkRev: true, brkRsi: true, brkLow: true, brkMin: 1, rrMin: 2, dStopAtr: 0.3, wStopAtr: 0.5 };
const ringRule = () => ({ ...RING_DEF, ...(S.pref.ringRule || {}) });
const SUM_DEF = { show: { rg: true, ka: true, ia: true, vo: true }, rgUp: 2, kaStr: 0, iaUp: 58, iaDn: 45, voIn: false, div: 'opp', cols: 0, glow: 1, corner: true, pulse: false, pulseSpd: 1, blink: true, legend: true };
const sumCfg = () => { const c = S.pref.sumCfg || {}; return { ...SUM_DEF, ...c, show: { ...SUM_DEF.show, ...(c.show || {}) } }; };
const fxRg = (o, k, label, min, max, step, unit = '') => `<div class="field" style="margin:6px 0"><label class="small">${label}　<b data-sv="${k}">${o[k]}${unit}</b></label><input type="range" style="width:100%" data-sk="${k}" min="${min}" max="${max}" step="${step}" value="${o[k]}" data-u="${unit}"></div>`;
const fxCk = (o, k, label, rb) => `<label class="small" style="display:inline-flex;gap:4px;align-items:center;margin:4px 10px 4px 0"><input type="checkbox" style="width:auto;flex:none;margin:0" data-sc="${k}" ${rb ? 'data-rb="1"' : ''} ${o[k] ? 'checked' : ''}>${label}</label>`;
const fxSg = (o, k, opts) => `<span class="seg" style="margin:4px 0;flex-wrap:wrap">${opts.map(([v, t]) => `<button type="button" data-sg="${k}" data-v2="${v}" class="${String(o[k]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</span>`;
/** 可收合區塊：標題列（▸／▾）＋右側開關；區塊內細項與「此項回預設」 */
const fxSec = (OPEN, id, title, sub, body, o, tg) => { const on = !tg || o[tg], op = OPEN.has(id);
  return `<div style="border:1px solid var(--border);border-radius:10px;margin:6px 0;overflow:hidden">
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--card2)"><span data-op="${id}" style="flex:1;cursor:pointer;user-select:none"><b style="font-size:14px">${op ? '▾' : '▸'} ${title}</b> <span class="small muted">${sub}</span></span>
    ${tg ? `<label class="small" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" style="width:auto;flex:none;margin:0" data-sc="${tg}" data-rb="1" ${on ? 'checked' : ''}>${on ? '開' : '關'}</label>` : ''}</div>
    ${op ? `<div style="padding:4px 10px 8px">${on ? body : '<div class="small muted" style="padding:4px 0">已關閉，開啟後可調整細項</div>'}<div style="text-align:right"><button type="button" class="btn sm" data-rs="${id}">此項回預設</button></div></div>` : ''}</div>`; };
/** 綁定表單：滑桿／勾選／分段；o() 取目前編輯中的物件，redraw 重畫表單，pv 只更新預覽 */
function fxBind(F, o, OPEN, RS, DEF, redraw, pv) {
  $$('[data-sk]', F).forEach((x) => x.oninput = () => { o()[x.dataset.sk] = +x.value; const v = $(`[data-sv="${x.dataset.sk}"]`, F); if (v) v.textContent = x.value + (x.dataset.u || ''); pv(); });
  $$('[data-sc]', F).forEach((x) => x.onchange = () => { o()[x.dataset.sc] = x.checked; if (x.dataset.rb) redraw(); else pv(); });
  $$('[data-sg]', F).forEach((x) => x.onclick = () => { const k = x.dataset.sg, v = x.dataset.v2; o()[k] = /^-?[\d.]+$/.test(v) ? +v : v; redraw(); });
  $$('[data-op]', F).forEach((x) => x.onclick = () => { const k = x.dataset.op; if (OPEN.has(k)) OPEN.delete(k); else OPEN.add(k); redraw(); });
  $$('[data-rs]', F).forEach((x) => x.onclick = () => { (RS[x.dataset.rs] || []).forEach((q) => { o()[q] = DEF[q]; }); redraw(); });
}
/** 三環設定：頂端 HUD 即時預覽（可循環環數、預覽失效）＋「判定條件」「樣式與動畫」兩頁；儲存才套用 */
async function ringSettings() {
  const R = ringRule(); const A = { sty: S.pref.ringSty == null ? 3 : +S.pref.ringSty, anim: S.pref.ringAnim !== false, spd: S.pref.ringSpd ?? 1, glow: S.pref.ringGlow ?? 1, pick: S.pref.ringPick !== false };
  const ADEF = { sty: 3, anim: true, spd: 1, glow: 1, pick: true };
  const demo = { lv: 2, b: false, rr: 2.6, lo: 100, hi: 104, stop: 96, tp: 115, px: 102 }; let tab = 0, tm = 0; const OPEN = new Set(['trend', 'look']);
  const RS = { trend: ['trend', 'bandLo', 'nearPct'], brake: ['brkRev', 'brkRsi', 'brkLow', 'brkMin'], center: ['rrMin'], stop: ['dStopAtr', 'wStopAtr'], look: ['sty', 'pick'], anim: ['anim', 'spd'], glow: ['glow'] };
  const form = () => { if (tab === 0) { const r = R; const nb = [r.brkRev, r.brkRsi, r.brkLow].filter(Boolean).length;
      return fxSec(OPEN, 'trend', '外環：週 K 支撐帶', (r.trend ? '要求均線多頭' : '不看均線') + '・帶寬 −' + r.bandLo + ' ATR', fxCk(r, 'trend', '要求週 MA20 > 週 MA60（多頭排列）') + fxRg(r, 'bandLo', '支撐帶下緣（週 ATR 倍數）', 0.2, 1.5, 0.1, '×') + fxRg(r, 'nearPct', '支撐帶上緣最少（股價 %）', 1, 8, 0.5, '%'), r)
        + fxSec(OPEN, 'brake', '中環：日 K 止跌', '至少 ' + r.brkMin + ' 項', `<div class="small">採計的止跌跡象</div><div>${fxCk(r, 'brkRev', '多方反轉形態', 1)}${fxCk(r, 'brkRsi', 'RSI 離開超賣', 1)}${fxCk(r, 'brkLow', '近 3 根不破前低', 1)}</div>` + fxRg(r, 'brkMin', '至少需成立幾項', 1, Math.max(1, nb), 1, ' 項'), r)
        + fxSec(OPEN, 'center', '靶心：交集區＋風報比', '風報比 ≥ ' + r.rrMin, fxRg(r, 'rrMin', '風報比門檻（1 : ?）', 1, 4, 0.1), r)
        + fxSec(OPEN, 'stop', '停損備援', '缺停損資料時使用', fxRg(r, 'dStopAtr', '波段：日支撐 − 日 ATR ×', 0.1, 1, 0.05) + fxRg(r, 'wStopAtr', '存股：週支撐 − 週 ATR ×', 0.2, 1.5, 0.05), r)
        + '<div class="small muted" style="margin:6px 0">只影響個股技術分頁的三環卡與分析總結；星團與綜合評估仍用預設判定（與 App 相同）。</div><div style="text-align:right"><button type="button" class="btn sm" data-rall>判定條件全部回預設</button></div>'; }
    const pick = RX_STY.map(([n], i) => `<button type="button" data-sg="sty" data-v2="${i}" class="${i === A.sty ? 'on' : ''}">${rxSvg(i, demo, 0, 44, true)}<span>${n}</span></button>`).join('');
    return fxSec(OPEN, 'look', '動畫樣式', RX_STY[A.sty][0], `<div class="rx" style="border-radius:8px;padding:6px"><div class="rxs" style="flex-wrap:wrap">${pick}</div></div>` + fxCk(A, 'pick', '卡片內顯示樣式列'), A)
      + fxSec(OPEN, 'anim', '動畫', A.anim ? '速度 ' + A.spd + '×' : '關閉', fxRg(A, 'spd', '動畫速度', 0.3, 2.5, 0.1, '×') + '<div class="small muted">只在 1/3～3/3 播放；0/3、破停損為靜態。</div>', A, 'anim')
      + fxSec(OPEN, 'glow', '光暈', A.glow + '×', fxRg(A, 'glow', '光暈強度', 0, 2, 0.1, '×'), A)
      + '<div style="text-align:right;margin-top:4px"><button type="button" class="btn sm" data-rall>樣式全部回預設</button></div>'; };
  let iv = 0; const gl0 = RX.gl;
  const ok = await dialog('三環條件設定', `<div style="position:sticky;top:-18px;z-index:3;background:var(--card);padding:2px 0 4px"><div class="rx" style="border-radius:10px;padding:8px 10px;display:flex;gap:10px;align-items:center">
      <div id="rgPv" style="flex:none;width:130px;height:130px"></div><div id="rgPt" style="flex:1;min-width:0;position:relative"></div></div>
    <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px"><button type="button" class="btn sm" id="rgPl">切換達成環數</button><button type="button" class="btn sm" id="rgPb">預覽破停損</button></div></div>
    <span class="seg" id="rgTab" style="margin-top:6px"><button type="button" data-tb="0" class="on">判定條件</button><button type="button" data-tb="1">樣式與動畫</button></span><div id="rgF"></div>`, [['', '取消'], ['ok', '儲存', 'primary']], (root) => {
    rxStyleInject(); const F = $('#rgF', root);
    const pv = () => { RX.gl = A.glow; const d = { ...demo, rrMin: R.rrMin }; $('#rgPv', root).innerHTML = rxSvg(A.sty, d, A.anim && !d.b && d.lv >= 1 ? tm : 0, 130);
      $('#rgPt', root).innerHTML = `<div class="rxm">${RX_STY[A.sty][1]} // PREVIEW</div><b style="color:${rxCol(d)};font-size:15px">${d.b ? '破停損・失效' : RING_LB[d.lv]}</b><div class="rxk" style="margin-top:4px">靶心門檻 風報比 ≥ ${R.rrMin}・止跌至少 ${R.brkMin} 項</div><div class="rxk">動畫 ${A.anim ? A.spd + '×' : '關'}・光暈 ${A.glow}×</div>`; };
    const redraw = () => { F.innerHTML = form(); fxBind(F, () => (tab === 0 ? R : A), OPEN, RS, tab === 0 ? RING_DEF : ADEF, redraw, pv);
      $$('[data-rall]', F).forEach((x) => x.onclick = () => { Object.assign(tab === 0 ? R : A, tab === 0 ? RING_DEF : ADEF); redraw(); });
      const nb = [R.brkRev, R.brkRsi, R.brkLow].filter(Boolean).length; if (R.brkMin > nb) R.brkMin = Math.max(1, nb); pv(); };
    $$('[data-tb]', root).forEach((b) => b.onclick = () => { tab = +b.dataset.tb; $$('[data-tb]', root).forEach((x) => x.classList.toggle('on', x === b)); redraw(); });
    $('#rgPl', root).onclick = () => { demo.b = false; demo.lv = (demo.lv + 1) % 4; pv(); };
    $('#rgPb', root).onclick = () => { demo.b = !demo.b; pv(); };
    redraw(); iv = setInterval(() => { if (!document.body.contains(root)) return clearInterval(iv); tm += 0.05 * A.spd; if (A.anim && !demo.b && demo.lv >= 1) pv(); }, 50);
    return () => (!R.brkRev && !R.brkRsi && !R.brkLow ? '止跌跡象至少保留一項' : null);
  });
  clearInterval(iv); RX.gl = gl0;
  if (ok !== 'ok') return false;
  S.pref.ringRule = { ...R }; S.pref.ringSty = A.sty; S.pref.ringAnim = A.anim; S.pref.ringSpd = A.spd; S.pref.ringGlow = A.glow; S.pref.ringPick = A.pick; savePref(); toast('已儲存三環設定'); return true;
}
/** 分析總結設定：頂端即時預覽（同向／分歧／偏弱三組範例）＋「項目與判定」「外觀與特效」兩頁；儲存才套用 */
async function sumSettings() {
  const C = sumCfg(); const SH = { ...C.show }; let tab = 0, dm = 1; const OPEN = new Set(['items', 'glow']);
  const DEMO = [
    { n: '同向偏多', rg: { level: 3, zoneLo: 100, zoneHi: 104, stop: 96 }, ka: { dir: 1, str: 72, n: 2, sup: 99, res: 112 }, ia: { score: 66, label: '中性偏多', verdict: { title: '價格合理・指標偏多', ratio: 60 } }, vo: { label: '正常', regime: 0.9, annual: 24, atrPct: 1.6 } },
    { n: '分歧', rg: { level: 2, zoneLo: 100, zoneHi: 104, stop: 96 }, ka: { dir: -1, str: 64, n: 1, sup: 99, res: 108 }, ia: { score: 51, label: '中性', verdict: { title: '價格合理・指標中性', ratio: 30 } }, vo: { label: '偏高', regime: 1.4, annual: 38, atrPct: 2.6 } },
    { n: '同向偏弱', rg: { level: 1, broken: true, stop: 96 }, ka: { dir: -1, str: 80, n: 0, sup: 92, res: 101 }, ia: { score: 38, label: '偏空', verdict: { title: '指標偏弱', ratio: 10 } }, vo: { label: '偏低', regime: 0.6, annual: 15, atrPct: 1 } }];
  const RS = { items: [], rule: ['rgUp', 'kaStr', 'iaUp', 'iaDn', 'voIn', 'div'], layout: ['cols', 'legend'], glow: ['glow', 'corner'], pulse: ['pulse', 'pulseSpd'], blink: ['blink'] };
  const form = () => { if (tab === 0) return fxSec(OPEN, 'items', '顯示的方框', Object.values(SH).filter(Boolean).length + ' 項', `<div>${fxCk(SH, 'rg', '三環條件', 1)}${fxCk(SH, 'ka', 'K 線形態', 1)}${fxCk(SH, 'ia', '投資分析指數', 1)}${fxCk(SH, 'vo', '波動', 1)}</div><div class="small muted">隱藏的方框不列入共識。</div>`, SH)
      + fxSec(OPEN, 'rule', '各項判定門檻', '指數 ' + C.iaDn + '／' + C.iaUp, `<div class="small">三環：幾環以上算偏多（紅）</div>${fxSg(C, 'rgUp', [[1, '1 環'], [2, '2 環'], [3, '3 環']])}` + fxRg(C, 'kaStr', 'K 線：多空強度低於此值視為中性', 0, 80, 5) + fxRg(C, 'iaUp', '投資指數：偏多門檻（≥）', 50, 80, 1, ' 分') + fxRg(C, 'iaDn', '投資指數：偏弱門檻（<）', 20, 55, 1, ' 分')
        + `<div class="small" style="margin-top:6px">分歧的定義</div>${fxSg(C, 'div', [['opp', '偏多與偏弱並存'], ['any', '任兩項方向不同']])}<div>${fxCk(C, 'voIn', '波動列入共識（低波動算偏多、高波動算偏弱）')}</div>`, C)
      + '<div style="text-align:right;margin-top:4px"><button type="button" class="btn sm" data-rall>全部回預設</button></div>';
    return fxSec(OPEN, 'layout', '排列', C.cols ? '每排 ' + C.cols + ' 格' : '自動', fxSg(C, 'cols', [[0, '自動（寬畫面 4 格）'], [2, '固定 2 格'], [4, '固定 4 格']]) + `<div>${fxCk(C, 'legend', '顯示底部圖例')}</div>`, C)
      + fxSec(OPEN, 'glow', '發光與角框', '光暈 ' + C.glow + '×', fxRg(C, 'glow', '光暈強度', 0, 2, 0.1, '×') + `<div>${fxCk(C, 'corner', 'HUD 角框')}</div>`, C)
      + fxSec(OPEN, 'pulse', '呼吸光', C.pulse ? C.pulseSpd + '×' : '關閉', fxRg(C, 'pulseSpd', '呼吸速度', 0.3, 2.5, 0.1, '×'), C, 'pulse')
      + fxSec(OPEN, 'blink', '分歧閃爍', '右上「分歧」標籤閃爍', '<div class="small muted">開啟時，判定為分歧會讓標籤閃爍提示。</div>', C, 'blink')
      + '<div style="text-align:right;margin-top:4px"><button type="button" class="btn sm" data-rall>全部回預設</button></div>'; };
  const ok = await dialog('分析總結設定', `<div style="position:sticky;top:-18px;z-index:3;background:var(--card);padding:2px 0 4px"><div class="rx" id="smPv" style="border-radius:10px;padding:10px 12px;max-height:40vh;overflow:auto"></div>
    <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px"><span class="small muted" id="smPn" style="align-self:center;margin-right:auto"></span><button type="button" class="btn sm" id="smPd">切換範例（同向／分歧／偏弱）</button></div></div>
    <span class="seg" id="smTab" style="margin-top:6px"><button type="button" data-tb="0" class="on">項目與判定</button><button type="button" data-tb="1">外觀與特效</button></span><div id="smF"></div>`, [['', '取消'], ['ok', '儲存', 'primary']], (root) => {
    const F = $('#smF', root);
    const pv = () => { C.show = SH; $('#smPv', root).innerHTML = sumHtml(DEMO[dm], C, true); $('#smPn', root).textContent = '範例：' + DEMO[dm].n; };
    const redraw = () => { F.innerHTML = form(); fxBind(F, () => C, OPEN, RS, SUM_DEF, redraw, pv);
      $$('#smF [data-sc="rg"],#smF [data-sc="ka"],#smF [data-sc="ia"],#smF [data-sc="vo"]', root).forEach((x) => x.onchange = () => { SH[x.dataset.sc] = x.checked; redraw(); });
      $$('[data-rs="items"]', F).forEach((x) => x.onclick = () => { Object.assign(SH, SUM_DEF.show); redraw(); });
      $$('[data-rall]', F).forEach((x) => x.onclick = () => { if (tab === 0) { Object.assign(SH, SUM_DEF.show); RS.rule.forEach((q) => { C[q] = SUM_DEF[q]; }); } else [...RS.layout, ...RS.glow, ...RS.pulse, ...RS.blink].forEach((q) => { C[q] = SUM_DEF[q]; }); redraw(); });
      pv(); };
    $$('[data-tb]', root).forEach((b) => b.onclick = () => { tab = +b.dataset.tb; $$('[data-tb]', root).forEach((x) => x.classList.toggle('on', x === b)); redraw(); });
    $('#smPd', root).onclick = () => { dm = (dm + 1) % DEMO.length; pv(); };
    redraw();
    return () => (C.iaDn >= C.iaUp ? '偏弱門檻需小於偏多門檻' : !Object.values(SH).some(Boolean) ? '至少顯示一個方框' : null);
  });
  if (ok !== 'ok') return false;
  S.pref.sumCfg = { ...C, show: { ...SH } }; savePref(); toast('已儲存總結設定'); return true;
}
function rxStyleInject() {
  if (document.getElementById('rxCss')) return; const el = document.createElement('style'); el.id = 'rxCss';
  el.textContent = `.rx{position:relative;color:#d8f3ff;background:#050a14 radial-gradient(circle at 50% 0,#0b2a44 0,#050a14 70%) !important;border:1px solid #13405c !important;box-shadow:inset 0 0 22px #00d9ff22;overflow:hidden}
.rx:before{content:"";position:absolute;inset:0;background-image:linear-gradient(#00e5ff12 1px,transparent 1px),linear-gradient(90deg,#00e5ff12 1px,transparent 1px);background-size:22px 22px;pointer-events:none}
.rx:after{content:"";position:absolute;left:0;top:0;width:46px;height:2px;background:#00e5ff;box-shadow:0 0 8px #00e5ff}
.rx>*{position:relative}.rx h2{color:#e8fbff}.rx h2 i{font:10px monospace;color:#3fb6d6;font-style:normal;margin-left:6px;letter-spacing:1px}
.rx .rxm{font:10px monospace;color:#3fb6d6;letter-spacing:1px}.rx .rxk{font-size:11px;color:#86a9bd}.rx .rxv{font-family:monospace;font-size:14px;color:#e8fbff}
.rx .seg{background:#071728;border-color:#13405c}.rx .seg button{color:#86a9bd}.rx .seg button.on{background:#0d3350;color:#7fe9ff}
.rx .rxbox{background:#071728cc;border:1px solid #13405c;border-radius:4px;padding:8px}.rx .rxr{font-size:12px;color:#a9c7d8}
.rx .rxs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}.rx .rxs::-webkit-scrollbar{display:none}
.rx .rxs button{flex:none;display:flex;flex-direction:column;align-items:center;gap:2px;background:#071728;border:1px solid #13405c;border-radius:4px;padding:4px 4px 3px;color:#86a9bd;font-size:10px;width:62px}
.rx .rxs button.on{border-color:#00e5ff;color:#7fe9ff;box-shadow:0 0 8px #00e5ff55}.rx .rxsw{font:11px monospace;color:#7fe9ff;cursor:pointer;border:1px solid #13405c;border-radius:4px;padding:3px 8px;background:#071728}`;
  document.head.appendChild(el);
}
/** 動畫迴圈：只保留一個；元素離開 DOM 即停 */
const RX = { raf: 0, el: null, st: null, sty: 3, last: 0, t0: 0 };
function rxRun(el, d, sty, anim) {
  RX.gl = S.pref.ringGlow ?? 1; RX.spd = S.pref.ringSpd ?? 1; RX.el = el; RX.st = d; RX.sty = sty; cancelAnimationFrame(RX.raf);
  const live = anim && !d.b && d.lv >= 1;
  el.innerHTML = rxSvg(sty, d, 0);
  if (!live) return;
  RX.t0 = performance.now();
  const loop = (now) => {
    if (!RX.el || !RX.el.isConnected || RX.el !== el) return;
    RX.raf = requestAnimationFrame(loop);
    if (document.hidden || now - RX.last < 50) return;
    const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
    RX.last = now; el.innerHTML = rxSvg(sty, d, (now - RX.t0) / 1000 * (RX.spd || 1));
  };
  RX.raf = requestAnimationFrame(loop);
}
function ringsCardHtml(st, mode) {
  rxStyleInject();
  const anim = S.pref.ringAnim !== false; const sty = Math.min(7, Math.max(0, S.pref.ringSty == null ? 3 : +S.pref.ringSty));
  const seg = `<div class="seg" style="margin-top:6px"><button data-rgm="0" class="${mode === 0 ? 'on' : ''}">波段（日 K 停損）</button><button data-rgm="1" class="${mode === 1 ? 'on' : ''}">存股（週 K 停損）</button></div>`;
  const h = `<h2 style="flex-wrap:nowrap">三環條件<i>// TARGET RINGS</i><span class="r" style="display:inline-flex;gap:6px"><span class="rxsw" data-rxa style="white-space:nowrap">動畫 ${anim ? '開' : '關'}</span><span class="rxsw" data-rxg title="三環設定">⚙</span></span></h2>`;
  if (!st) return h + seg + '<div class="rxr" style="margin-top:8px">K 線資料不足（週 K 需 60 根以上），暫無法判斷</div>';
  const d = rxData(st); const c = rxCol(d); const f = fmtPrice;
  const step = (t, en, on) => `<div class="row" style="gap:6px;align-items:center;font-size:12px"><span style="width:8px;height:8px;background:${on ? RX_C.ok : RX_C.id};box-shadow:${on ? '0 0 6px ' + RX_C.ok : 'none'};transform:rotate(45deg)"></span><span style="color:${on ? '#e8fbff' : '#6f8ca0'}">${t}</span><span class="rxm" style="margin-left:auto;color:${on ? RX_C.ok : '#3c5a70'}">${on ? 'OK' : en}</span></div>`;
  const kv = (k, v, col) => `<div><div class="rxk">${k}</div><div class="rxv" style="${col ? 'color:' + col : ''}">${v}</div></div>`;
  const pick = RX_STY.map(([n], i) => `<button data-rxs="${i}" class="${i === sty ? 'on' : ''}">${rxSvg(i, d, 0, 44, true)}<span>${n}</span></button>`).join('');
  return `${h}${seg}
    <div class="row" style="gap:12px;align-items:center;margin-top:10px"><div id="rxFx" style="flex:none;width:150px;height:150px"></div><div style="flex:1;display:grid;gap:5px;min-width:0">
      <div class="rxm">週 K → 日 K → 即時 // ${RX_STY[sty][1]}</div><b style="color:${c};font-size:17px;text-shadow:0 0 8px ${c}88">${RING_LB[st.level]}</b>
      ${step('外環 週 K 支撐帶', 'W-K', st.outer)}${step('中環 日 K 止跌', 'D-K', st.middle)}${step('靶心 交集區＋風報比 ≥ ' + (st.rrMin ?? 2), 'RT', st.center)}${st.broken ? `<b class="small" style="color:${RX_C.al}">現價低於停損 ${f(st.stop)}</b>` : ''}</div></div>
    <div class="grid" style="grid-template-columns:2fr 1fr;gap:8px;margin-top:10px">${kv('試算區間', f(st.zoneLo) + ' ～ ' + f(st.zoneHi), RX_C.mid)}${kv('風報比', '1:' + st.rr.toFixed(2), st.rr >= 2 ? RX_C.ok : '')}</div>
    <div class="grid g3" style="gap:8px;margin-top:6px">${kv(st.mode === 1 ? '週 K 停損' : '日 K 停損', f(st.stop), RX_C.al)}${kv('目標', f(st.target), RX_C.cy)}${kv('價格容忍上限', f(st.cap))}</div>
    <div class="rxbox" style="margin-top:8px"><div class="rxk">試算分批（比例僅供試算，不構成建議）</div><div class="rxv" style="font-size:12px">${st.batches.map(([p, pct]) => f(p) + ' × ' + pct + '%').join('　')}　價格容忍上限 ${f(st.cap)}</div>${st.overlap ? '' : '<div class="rxk">日／週支撐帶沒有交集，區間暫以日支撐帶試算</div>'}</div>
    <div style="margin-top:6px">${st.reasons.map((t) => `<div class="rxr">・${esc(t)}</div>`).join('')}</div>
    ${S.pref.ringPick === false ? '' : `<div class="rxm" style="margin:10px 0 4px">STYLE // 動畫樣式</div><div class="rxs">${pick}</div>`}
    <div class="rxk" style="margin-top:6px">三環只是條件檢核與數字試算，不代表任何買賣建議；請自行判斷。動畫只在 1/3～3/3 播放，0/3、破停損為靜態。</div>`;
}
// ───────── 三環條件（與 App TargetRings 同規則：週 K 定方向 → 日 K 找止跌 → 即時價位；只輸出達成幾環與試算價位） ─────────
function ringsEval(x, mode, snap = (v) => v, tick = 0.01, c = {}) {
  const r = []; const p = x.price; const f = fmtPrice;
  // 可調參數（網頁三環設定 S.pref.ringRule；省略時與 App 相同）
  const bandLo = c.bandLo ?? 0.5, nearPct = (c.nearPct ?? 3) / 100, rrMin = c.rrMin ?? 2, dStopAtr = c.dStopAtr ?? 0.3, wStopAtr = c.wStopAtr ?? 0.5, needTrend = c.trend ?? true, brkMin = c.brkMin ?? 1;
  const wNear = Math.max(x.wAtr, p * nearPct);
  const trendUp = x.wMa60 != null && x.wMa20 != null && x.wMa20 > x.wMa60;
  const inBand = p >= x.wSupport - x.wAtr * bandLo && p <= x.wSupport + wNear;
  const outer = (trendUp || !needTrend) && inBand;
  r.push(x.wMa60 == null ? '週 K 不足 60 根，無法判斷週 MA20／MA60' : '週 MA20 ' + f(x.wMa20) + (trendUp ? ' > ' : ' ≤ ') + '週 MA60 ' + f(x.wMa60));
  if (!needTrend) r.push('（設定：不要求週均線多頭排列）');
  r.push('週支撐帶 ' + f(x.wSupport - x.wAtr * bandLo) + '～' + f(x.wSupport + wNear) + (inBand ? '，現價在帶內' : '，現價不在帶內'));
  const brakes = [c.brkRev !== false && x.bullReversal ? '多方反轉形態' : null, c.brkRsi !== false && x.rsiTurn ? 'RSI 離開超賣' : null, c.brkLow !== false && x.noNewLow ? '近 3 根不破前低' : null].filter(Boolean);
  const middle = brakes.length >= brkMin;
  r.push(middle ? '日 K 止跌跡象：' + brakes.join('、') : brakes.length ? '日 K 止跌跡象 ' + brakes.length + ' 項，未達設定的 ' + brkMin + ' 項' : '日 K 尚無止跌跡象');
  const dLo = x.dSupport, dHi = x.dSupport + x.dAtr, wLo = x.wSupport, wHi = x.wSupport + x.wAtr;
  let lo = Math.max(dLo, wLo), hi = Math.min(dHi, wHi);
  const overlap = lo <= hi;
  if (!overlap) { lo = dLo; hi = dHi; }
  lo = snap(lo); hi = snap(Math.max(hi, lo));
  r.push('試算區間 ' + f(lo) + '～' + f(hi) + (overlap ? '（日／週支撐交集）' : '（日／週支撐無交集，暫以日支撐帶）'));
  const stop0 = mode === 1 ? (x.wStop != null ? x.wStop : x.wSupport - x.wAtr * wStopAtr) : (x.dStop != null ? x.dStop : x.dSupport - x.dAtr * dStopAtr);
  const stop = snap(stop0);
  const broken = p > 0 && p < stop;
  const rr = p > stop && x.target > p ? (x.target - p) / (p - stop) : 0;
  const inZone = p >= lo - tick / 2 && p <= hi + tick / 2;
  const center = (inZone || !!x.reclaim) && rr >= rrMin;
  r.push((mode === 1 ? '存股模式（週 K 停損 ' : '波段模式（日 K 停損 ') + f(stop) + '），目標 ' + f(x.target) + '，試算風報比 1:' + rr.toFixed(2));
  if (x.reclaim) r.push('今日帶量站回日 MA20 ' + f(x.dMa20));
  if (broken) r.push('現價已低於停損價 ' + f(stop));
  const level = broken || !outer ? 0 : !middle ? 1 : !center ? 2 : 3;
  const three = [[hi, 40], [snap((lo + hi) / 2), 30], [lo, 30]];
  const batches = mode === 1 && new Set(three.map((t) => t[0])).size === 3 ? three : [[hi, 100]];
  return { level, outer, middle: outer && middle, center: outer && middle && center, broken, zoneLo: lo, zoneHi: hi, overlap, stop, target: x.target, rr, price: p, batches, cap: snap(hi + tick), reasons: r, mode, rrMin };
}
/** 由日 K、週 K 的 klineAnalyze 結果萃取三環輸入（與 App TargetRings.inputOf 相同） */
function ringsInput(price, d, w) {
  const cs = d.cs, closes = cs.map((c) => c.c), n = cs.length;
  const rsiNow = rsiW(closes);
  const rsiHist = [1, 2, 3, 4, 5].map((k) => (n - k > 15 ? rsiW(closes.slice(0, n - k)) : null)).filter((v) => v != null);
  const rsiPrev = rsiHist.length ? rsiHist[0] : null;
  const rsiTurn = rsiNow != null && rsiPrev != null && rsiNow > rsiPrev && ((rsiPrev <= 30 && rsiNow > 30) || Math.min(...rsiHist) < 35);
  const noNewLow = n >= 13 && Math.min(...cs.slice(n - 3).map((c) => c.l)) >= Math.min(...cs.slice(n - 13, n - 3).map((c) => c.l));
  const bullReversal = d.latest.some((h) => KP[h.k][2] > 0 && KP[h.k][1] === '反轉');
  const reclaim = n >= 2 && d.x.vol === 'C' && closes[n - 2] < d.x.ma20 && price > d.x.ma20;
  const target = d.longPlan && d.longPlan.tp1 > price ? d.longPlan.tp1 : d.x.resistance;
  return { price, wMa20: w.x.ma20, wMa60: w.x.ma60, wSupport: w.x.support, wAtr: w.x.atr, wStop: w.longPlan ? w.longPlan.stop : null,
    dSupport: d.x.support, dAtr: d.x.atr, dStop: d.longPlan ? d.longPlan.stop : null, dMa20: d.x.ma20, target, bullReversal, rsiTurn, noNewLow, reclaim };
}
/** 台股價位對齊升降單位（無條件捨去，與 App TwSession.snap 相同） */
function twSnap(v, etf) {
  if (!(v > 0)) return v;
  const x = Math.round(v * 1e4) / 1e4; const t = twTick(x, etf);
  return Math.round(Math.floor(x / t + 1e-9) * t * 100) / 100;
}
// ───────── 量比預估（與 App VolEstimate 同規則：台股前高後低累積量曲線、開盤 15 分鐘平滑；只供視覺化） ─────────
function volTwShare(m) {
  if (m <= 0) return 0;
  if (m < 265) return 0.88 * Math.pow(m / 265, 0.72);
  if (m < 270) return 0.88 + 0.12 * (m - 265) / 5;
  return 1;
}
function volEstimate(today, avg5, us, minutes) {
  if (minutes == null) return today;
  const m = Math.max(0, minutes);
  const share = Math.max(0.01, us ? Math.min(1, Math.max(0, m / 390)) : volTwShare(m));
  const raw = today / share;
  if (avg5 <= 0) return raw;
  const w = Math.min(1, Math.max(0, m / 15));
  return w * raw + (1 - w) * avg5;
}
function volRatio(today, avg5, us, minutes) {
  return today == null || !(today > 0) || !(avg5 > 0) ? null : volEstimate(today, avg5, us, minutes) / avg5;
}
/** 盤中回傳開盤後分鐘數，否則 null（台股 09:00～13:30、美股 09:30～16:00） */
function volMinutesNow(us) {
  if (!us) { const d = tpeNow(); const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 - 540; return d.getDay() >= 1 && d.getDay() <= 5 && m >= 0 && m <= 270 ? m : null; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const m = +p.hour * 60 + +p.minute + +p.second / 60 - 570;
  return p.weekday !== 'Sat' && p.weekday !== 'Sun' && m >= 0 && m <= 390 ? m : null;
}
// ───────── 雙極星團雷達（首頁卡片；與 App StarRank／StarCluster 同規則，案例 web/test/star_cases.mjs） ─────────
// 遲滯入選／剔除、停損防守價彈出（30 分鐘冷卻）、權重排行。只描述條件是否成立，不給任何買賣指令。
const STAR_NEW = 1e9;
const STAR_MKTS = [['TW', '台股'], ['ETF', 'ETF'], ['US', '美股']];
const STAR_STOPS = [['KLINE', 'K 線防守價'], ['VWAP', '盤中均價'], ['FIXED', '固定 %']];
const STAR_US_CORE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'LLY', 'V', 'MA', 'UNH', 'XOM',
  'COST', 'NFLX', 'AMD', 'ORCL', 'CRM', 'ADBE', 'PLTR', 'TSM', 'ASML', 'MU', 'QCOM', 'INTC', 'ARM', 'COIN'];
const STAR_ANIM = { motion: 'GRAVITY', eject: 'BURST', whaleBeam: true, magnet: true, flow: true, haze: false, scale: 0.65, turbulence: 0.5, whaleX: 2, height: 0.42, listSec: 4, scanMin: 3, anim: true, style: 'GALAXY', density: 0.75,
  // 各特效細項（預設值＝原本外觀）
  speed: 1, labelN: 3, pulseAmp: 0.14, ejectAmt: 1, ejectDur: 1, beamSec: 1.2, magSpd: 0.6, magR: 30, flowAmt: 1, flowSpd: 1, hazeA: 0.2, hazeR: 1.3,
  galSpin: 1, galBright: 1, galCore: 0.9, neuLink: 1, neuPulse: 1, neuDust: 1, clsSpread: 1, clsLine: true,
  dstRise: 1, dstTwk: 0.5, dstBokeh: 1, orbSpd: 1, orbTilt: 0.6, orbLine: 1, aurBands: 3, aurAmp: 1, aurSpd: 1, holeSpd: 1, holeTilt: 0.35, holeGlow: 1,
  radSpd: 1, radTrail: 1, radRings: 4, hivSize: 12, hivHeat: 1, hivPulse: 1 };
const STAR_STYLES = [['GALAXY', '螺旋星系'], ['NEURAL', '神經網路'], ['CLASSIC', '經典星團'], ['DUST', '光塵星團'], ['ORBIT', '行星軌道'], ['AURORA', '極光帷幕'], ['HOLE', '黑洞吸積'], ['RADAR', '雷達掃描'], ['HIVE', '蜂巢熱力']];
function starRuleDef(m) {
  const etf = m === 'ETF';
  return { maxN: 8, minScore: etf ? 70 : 75, exitScore: etf ? 63 : 68, rings: 2, requireK: true, wC: 0.4, wR: 0.3, wK: 0.3, stop: 'KLINE', pct: etf ? 1.5 : 2.5 };
}
function starSane(r) {
  const cl = (v, a, b) => Math.max(a, Math.min(b, isNaN(v) ? a : v));
  const mn = cl(+r.minScore, 50, 95);
  return { ...r, maxN: cl(Math.round(+r.maxN), 3, 15), minScore: mn, exitScore: cl(+r.exitScore, 30, mn - 1), rings: cl(Math.round(+r.rings), 0, 3), requireK: r.requireK !== false,
    wC: Math.max(0, +r.wC || 0), wR: Math.max(0, +r.wR || 0), wK: Math.max(0, +r.wK || 0), pct: cl(+r.pct, 0.5, 15), stop: STAR_STOPS.some((s) => s[0] === r.stop) ? r.stop : 'KLINE' };
}
/** K 線訊號強度：同向等級越高越強（side：'bull'／'bear'） */
function starKScore(level, side) {
  const l = side === 'bull' ? level : -level;
  return l >= 2 ? 100 : l === 1 ? 75 : l === 0 ? 35 : l === -1 ? 10 : 0;
}
function starComp(x, side) {
  return side === 'bull' ? x.composite : 100 - x.composite;
}
function starRingsOf(x, side) {
  return side === 'bull' ? x.bullRings : x.bearRings;
}
/** 權重正規化後的總排行分（0..100） */
function starFinal(r, c, rg, k) {
  const s = r.wC + r.wR + r.wK;
  return s <= 0 ? c : (r.wC * c + r.wR * rg + r.wK * k) / s;
}
/** 停損防守價：K 線計畫停損 → 盤中均價 → 固定 %（缺資料時依序退回固定 %） */
function starStopOf(r, x, side, anchor) {
  const fixed = anchor > 0 ? (side === 'bull' ? anchor * (1 - r.pct / 100) : anchor * (1 + r.pct / 100)) : null;
  const ok = (v) => (v != null && v > 0 ? v : null); const pl = ok(side === 'bull' ? x.longStop : x.shortStop);
  if (r.stop === 'FIXED') return fixed;
  if (r.stop === 'VWAP') return ok(x.vwap) ?? pl ?? fixed;
  return pl ?? fixed;
}
function starBreached(side, price, stop) {
  return stop != null && price > 0 && (side === 'bull' ? price <= stop : price >= stop);
}
/** 未入選者是否符合入選條件 */
function starQualifies(r, x, side) {
  if (!(x.price > 0)) return false;
  if (starComp(x, side) < r.minScore) return false;
  if (starRingsOf(x, side) < r.rings) return false;
  if (r.requireK && (side === 'bull' ? x.kLevel < 1 : x.kLevel > -1)) return false;
  return true;
}
/** 一次評估（與 App StarRank.step 相同）：回傳 { bull, bear, ejects, members } */
function starStep(rule, inputs, prev, now, cooldown = {}) {
  const r = starSane(rule); const ejects = []; const keep = []; const seen = new Set();
  const rs = (n) => Math.max(0, Math.min(3, n)) / 3 * 100;
  for (const x of inputs) {
    if (seen.has(x.symbol)) continue; seen.add(x.symbol);
    const pm = prev[x.symbol];
    if (pm) {
      const side = pm.side; const stop = starStopOf(r, x, side, pm.anchor);
      if (starBreached(side, x.price, stop)) { ejects.push({ symbol: x.symbol, name: x.name, side, price: x.price, stop, forced: true, reason: side === 'bull' ? '跌破停損防守價' : '突破空方防守價' }); continue; }
      const c = starComp(x, side);
      if (c < r.exitScore) { ejects.push({ symbol: x.symbol, name: x.name, side, price: x.price, stop, forced: false, reason: '綜合評估低於 ' + Math.trunc(r.exitScore) + ' 分' }); continue; }
      const rg = rs(starRingsOf(x, side)), k = starKScore(x.kLevel, side);
      keep.push({ x, side, since: pm.since, anchor: pm.anchor, stop, c, rg, k, f: starFinal(r, c, rg, k) });
    } else {
      if ((cooldown[x.symbol] || 0) > now) continue;
      const side = starQualifies(r, x, 'bull') ? 'bull' : starQualifies(r, x, 'bear') ? 'bear' : null; if (!side) continue;
      const stop = starStopOf(r, x, side, x.price);
      if (starBreached(side, x.price, stop)) continue; // 入選當下已在防守價外側：不列入
      const c = starComp(x, side), rg = rs(starRingsOf(x, side)), k = starKScore(x.kLevel, side);
      keep.push({ x, side, since: now, anchor: x.price, stop, c, rg, k, f: starFinal(r, c, rg, k) });
    }
  }
  // 上次是成員但這次沒有輸入（資料暫缺）：保留成員資格，不顯示、不彈出
  const members = {}; Object.values(prev).forEach((m) => { if (!seen.has(m.symbol)) members[m.symbol] = m; });
  const rank = (side) => keep.filter((c) => c.side === side).sort((a, b) => b.f - a.f || b.c - a.c || (a.x.symbol < b.x.symbol ? -1 : a.x.symbol > b.x.symbol ? 1 : 0)).map((c, i) => {
    const pm = prev[c.x.symbol]; const rk = i + 1; const p = c.x.price;
    members[c.x.symbol] = { symbol: c.x.symbol, side, since: c.since, anchor: c.anchor, rank: rk };
    const ds = [c.x.resistance, c.x.support].filter((v) => v > 0).map((v) => Math.abs(v - p) / p * 100);
    return { symbol: c.x.symbol, name: c.x.name, side, rank: rk, rankDelta: !pm || pm.side !== side ? STAR_NEW : pm.rank - rk, price: p, chgPct: c.x.chgPct,
      composite: c.c, rings: c.rg, kline: c.k, final: c.f, stop: c.stop, slBuffer: c.stop == null || !(p > 0) ? null : side === 'bull' ? (p - c.stop) / p * 100 : (c.stop - p) / p * 100,
      trigPct: p > 0 && ds.length ? Math.min(...ds) : null, whale: !!c.x.whale, hot: c.x.rsi != null ? (side === 'bull' ? c.x.rsi >= 75 : c.x.rsi <= 25) : false };
  });
  const bull = rank('bull'), bear = rank('bear');
  return { bull: bull.slice(0, r.maxN), bear: bear.slice(0, r.maxN), ejects, members };
}
/** 盤後排行（與 App StarRank.board 相同）：不動成員、不彈出；寬鬆門檻 min(入選分, 55)、K 線不反向，met＝已達入選條件 */
function starBoard(rule, inputs) {
  const r = starSane(rule); const th = Math.min(r.minScore, 55); const seen = new Set(); const all = [];
  for (const x of inputs) {
    if (seen.has(x.symbol)) continue; seen.add(x.symbol);
    if (!(x.price > 0)) continue;
    const side = x.composite >= 50 ? 'bull' : 'bear'; const c = starComp(x, side); if (c < th) continue;
    if (side === 'bull' ? x.kLevel < 0 : x.kLevel > 0) continue;
    const rg = Math.max(0, Math.min(3, starRingsOf(x, side))) / 3 * 100, k = starKScore(x.kLevel, side);
    all.push({ x, side, c, rg, k, f: starFinal(r, c, rg, k), stop: starStopOf(r, x, side, x.price) });
  }
  const rank = (side) => all.filter((c) => c.side === side).sort((a, b) => b.f - a.f || b.c - a.c || (a.x.symbol < b.x.symbol ? -1 : a.x.symbol > b.x.symbol ? 1 : 0)).slice(0, r.maxN).map((c, i) => {
    const p = c.x.price; const ds = [c.x.resistance, c.x.support].filter((v) => v > 0).map((v) => Math.abs(v - p) / p * 100);
    return { symbol: c.x.symbol, name: c.x.name, side, rank: i + 1, rankDelta: 0, price: p, chgPct: c.x.chgPct, composite: c.c, rings: c.rg, kline: c.k, final: c.f, stop: c.stop,
      slBuffer: c.stop == null ? null : side === 'bull' ? (p - c.stop) / p * 100 : (c.stop - p) / p * 100, trigPct: ds.length ? Math.min(...ds) : null, whale: !!c.x.whale,
      hot: c.x.rsi != null ? (side === 'bull' ? c.x.rsi >= 75 : c.x.rsi <= 25) : false, met: starQualifies(r, c.x, side) };
  });
  return { bull: rank('bull'), bear: rank('bear') };
}
/** 盤中即時排行（與 App StarRank.live 相同）：成員在前（met），其餘名額以 starBoard 候選補位（cand）；冷卻中與成員不列入；prev＝{代號:[方向,名次]} */
function starLive(rule, inputs, res, now, cooldown = {}, prev = {}) {
  const r = starSane(rule); const skip = new Set(Object.keys(res.members || {})); Object.keys(cooldown).forEach((k) => { if (cooldown[k] > now) skip.add(k); });
  const b = starBoard(r, inputs.filter((x) => !skip.has(x.symbol)));
  const merge = (mem, cands, side) => {
    const out = mem.map((n) => ({ ...n, met: true, cand: false }));
    for (const c of cands) { if (out.length >= r.maxN) break; const rk = out.length + 1; const p = prev[c.symbol];
      out.push({ ...c, rank: rk, rankDelta: !p || p[0] !== side ? STAR_NEW : p[1] - rk, met: false, cand: true }); }
    return out;
  };
  return { bull: merge(res.bull, b.bull, 'bull'), bear: merge(res.bear, b.bear, 'bear') };
}
/** RSI(14)（Wilder 平滑）；資料不足回 null */
function starRsi(c, n = 14) {
  if (c.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + (d > 0 ? d : 0)) / n; l = (l * (n - 1) + (d < 0 ? -d : 0)) / n; }
  if (l === 0) return g === 0 ? 50 : 100;
  return 100 - 100 / (1 + g / l);
}
/** 空方鏡像三環：日 MA20 < MA60、K 線偏空（等級 ≤ −1 或空頭趨勢）、現價 < MA20 */
function starBearRings(price, ma20, ma60, kLevel, trend) {
  let n = 0;
  if (ma20 != null && ma60 != null && ma20 < ma60) n++;
  if (kLevel <= -1 || trend === -1) n++;
  if (ma20 != null && price > 0 && price < ma20) n++;
  return Math.min(n, 3);
}
// —— 執行期（瀏覽器端計算；成員、快照存在這個瀏覽器，不上傳、不共用；Alpaca 資料只在本機使用） ——
const ST = { el: null, eng: null, loop: 0, busy: '', prog: 0, inp: {}, scanAt: {}, qAt: {}, snap: {}, sel: null, ej: [], ejId: 0, rs: '', rsAt: {}, rsDone: {} };
const STAR_RESCORE_MS = 30000;
function starPref() { const p = S.pref.star || (S.pref.star = {}); p.rules = p.rules || {}; return p; }
function starRule(m) { return starSane({ ...starRuleDef(m), ...(starPref().rules[m] || {}) }); }
function starAnimCfg() { const a = { ...STAR_ANIM, ...(starPref().anim || {}) }; if (!STAR_STYLES.some(([k]) => k === a.style)) a.style = a.galaxy === false ? 'CLASSIC' : 'GALAXY'; delete a.galaxy; return a; }
function starMkt() { const m = starPref().mkt; return STAR_MKTS.some((x) => x[0] === m) ? m : 'TW'; }
function starOpen(m) { return m === 'US' ? usOpen() : twOpen(); }
function starSnap(m) { if (!(m in ST.snap)) ST.snap[m] = store.get('star_snap_' + m, null); return ST.snap[m]; }
/** 選股池（上限 36，既有成員優先）：台股＝成交值 ≥ 3 億的漲跌幅兩端＋自選／持股；ETF＝成交量前段與漲跌兩端（排除槓桿／反向）；美股＝大型股＋Alpaca 當日最活躍（有金鑰時）＋自選 */
async function starPool(m) {
  const out = new Set(Object.keys(store.get('star_mem_' + m, {})));
  const mine = D.quotes().map((q) => q.s).concat(holdings().map((h) => h.symbol));
  if (m === 'TW') {
    try { const rows = (await scrUniverse()).rows.filter((r) => r.chg != null && (r.val || 0) >= 3);
      rows.slice().sort((a, b) => b.chg - a.chg).slice(0, 15).forEach((r) => out.add(r.s));
      rows.slice().sort((a, b) => a.chg - b.chg).slice(0, 15).forEach((r) => out.add(r.s)); } catch (e) {}
    mine.filter((s) => !isUs(s) && !/^00/.test(s)).forEach((s) => out.add(s));
  } else if (m === 'ETF') {
    try { const all = await px('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', 1800);
      const rows = (Array.isArray(all) ? all : []).map((o) => { const c = nn(o.ClosingPrice), ch = nn(o.Change); return { s: String(o.Code || '').trim(), n: String(o.Name || ''), v: nn(o.TradeVolume) || 0, val: nn(o.TradeValue) || 0, pc: c > 0 && ch != null && c - ch > 0 ? ch / (c - ch) * 100 : 0 }; })
        .filter((r) => /^00\d{2,4}[A-Z]?$/.test(r.s) && r.v >= 500000 && !/正2|反1|反向|槓桿|兩倍|2X/i.test(r.n));
      rows.filter((r) => r.pc > 0).sort((a, b) => b.pc - a.pc).slice(0, 12).forEach((r) => out.add(r.s));
      rows.filter((r) => r.pc < 0).sort((a, b) => a.pc - b.pc).slice(0, 12).forEach((r) => out.add(r.s));
      rows.slice().sort((a, b) => b.val - a.val).slice(0, 20).forEach((r) => out.add(r.s)); } catch (e) {}
    mine.filter((s) => !isUs(s) && /^00/.test(s)).forEach((s) => out.add(s));
  } else {
    STAR_US_CORE.forEach((s) => out.add(s));
    if (apHas()) try { const j = await apGet('/v1beta1/screener/stocks/most-actives?by=volume&top=25'); (j.most_actives || []).forEach((o) => { if (o.symbol && /^[A-Z.]+$/.test(o.symbol)) out.add(apY(o.symbol)); }); } catch (e) {}
    mine.filter(isUs).forEach((s) => out.add(s));
  }
  return Array.from(out).slice(0, 36);
}
/** 單一標的的評估輸入（綜合進場評估＋日／週 K＋三環；與 App StarCluster.inputOf 相同） */
async function starInput(sym) {
  const b = await liveBars(sym, '2y'); if (b.length < 60) return null;
  const d = klineAnalyze(b); if (!d) return null;
  const a = await entryAdviceCached(sym, 900000);
  const q = S.q[sym] || {}; const us = isUs(sym); const price = q.price || b[b.length - 1].c; const kl = d.entry ? d.entry.level : 0;
  let rs = null;
  try { const wk = klineAnalyze(weeklyBars(await liveBars(sym, '5y'))); if (wk) rs = ringsEval(ringsInput(price, d, wk), 0); } catch (e) {}
  const bull = rs ? (rs.outer ? 1 : 0) + (rs.middle ? 1 : 0) + (rs.center ? 1 : 0) : [d.x.ma60 != null && d.x.ma20 > d.x.ma60, kl >= 1 || d.x.trend === 1, price > d.x.ma20].filter(Boolean).length;
  const last = b[b.length - 1]; const today = last.d === ymd() ? last.v : null;
  const hist = (today != null ? b.slice(0, -1) : b).slice(-5).map((x) => x.v).filter((v) => v > 0); const avg5 = hist.length ? hist.reduce((s, v) => s + v, 0) / hist.length : 0;
  const ratio = avg5 > 0 ? volRatio(today, avg5, us, volMinutesNow(us)) : null;
  const vwap = q.high > 0 && q.low > 0 ? (q.high + q.low + price) / 3 : today != null ? (last.h + last.l + last.c) / 3 : null;
  const lp = (a && a.plan) || d.longPlan;
  return { symbol: sym, name: D.name(sym), price, chgPct: q.prev ? (price / q.prev - 1) * 100 : 0, composite: Math.max(0, Math.min(100, a ? a.score : 50 + kl * 15)), kLevel: kl,
    bullRings: bull, bearRings: starBearRings(price, d.x.ma20, d.x.ma60, kl, d.x.trend), longStop: (lp && lp.stop) || (rs && rs.stop) || null, shortStop: d.shortPlan ? d.shortPlan.stop : null,
    vwap, resistance: d.x.resistance > 0 ? d.x.resistance : null, support: d.x.support > 0 ? d.x.support : null, whale: (ratio || 0) >= starAnimCfg().whaleX, rsi: starRsi(b.slice(-60).map((x) => x.c)) };
}
async function starScan(m) {
  if (ST.busy) return; ST.busy = m; ST.prog = 0; starStatus();
  try {
    let syms = await starPool(m);
    await refreshQuotes(syms).catch(() => {});
    if (m === 'US') { const keep = new Set(Object.keys(store.get('star_mem_US', {})).concat(STAR_US_CORE, D.quotes().map((q) => q.s), holdings().map((h) => h.symbol)));
      syms = syms.filter((s) => keep.has(s) || ((S.q[s] || {}).price || 0) >= 10); }
    const inp = {}; let i = 0, done = 0;
    const work = async () => { while (i < syms.length) { const s = syms[i++]; try { const x = await starInput(s); if (x) inp[s] = x; } catch (e) {} done++; ST.prog = done / syms.length; starStatus(); } };
    await Promise.all([work(), work(), work(), work()]);
    ST.inp[m] = inp; ST.scanAt[m] = ST.qAt[m] = Date.now(); starRecompute(m);
  } finally { ST.busy = ''; starStatus(); }
}
/** 盤中即時重新評估：每 STAR_RESCORE_MS 以最新報價重跑每一檔 starInput（K 線沿用快取、當日 K 換成現價），分數與名次隨盤勢變動；重掃中略過 */
async function starRescore(m) {
  const now = Date.now(); if (ST.busy || ST.rs || !starOpen(m) || !ST.inp[m] || now - (ST.rsAt[m] || 0) < STAR_RESCORE_MS - 1000) return;
  ST.rs = m; ST.rsAt[m] = now;
  try {
    const syms = Object.keys(ST.inp[m]); const fresh = {}; let i = 0;
    const work = async () => { while (i < syms.length) { const s = syms[i++]; try { const x = await starInput(s); if (x) fresh[s] = x; } catch (e) {} } };
    await Promise.all([work(), work(), work(), work()]);
    const cur = ST.inp[m]; if (!cur) return; Object.keys(fresh).forEach((s) => { if (cur[s]) cur[s] = fresh[s]; });
    if (Object.keys(fresh).length) ST.rsDone[m] = Date.now();
  } finally { ST.rs = ''; }
}
/** 快更新：只換現價／漲跌／盤中均價再重新排行（K 線與評估沿用上次分析） */
function starPatch(m) {
  const inp = ST.inp[m]; if (!inp) return;
  Object.values(inp).forEach((x) => { const q = S.q[x.symbol]; if (!q || !q.price) return; x.price = q.price; if (q.prev) x.chgPct = (q.price / q.prev - 1) * 100; if (q.high > 0 && q.low > 0) x.vwap = (q.high + q.low + q.price) / 3; });
  starRecompute(m);
}
function starRecompute(m) {
  const inp = ST.inp[m]; if (!inp) return;
  if (!starOpen(m)) {
    // 非盤中：依最近收盤評估排行（不動成員、不彈出），避免星團空白
    const b = starBoard(starRule(m), Object.values(inp));
    ST.snap[m] = { bull: b.bull, bear: b.bear, at: Date.now(), live: false, pool: Object.keys(inp).length }; store.set('star_snap_' + m, ST.snap[m]);
    if (m === starMkt()) starRender(); return;
  }
  const now = Date.now(); const cd = store.get('star_cd_' + m, {}); Object.keys(cd).forEach((k) => { if (cd[k] < now) delete cd[k]; });
  const r = starStep(starRule(m), Object.values(inp), store.get('star_mem_' + m, {}), now, cd);
  r.ejects.forEach((e) => { if (e.forced) cd[e.symbol] = now + 1800000; ST.ej.unshift({ id: ++ST.ejId, m, e, at: now }); }); ST.ej = ST.ej.slice(0, 30);
  // 即時排行：成員在前、候選補位，避免盤中兩側空白
  const ps = ST.snap[m] || {}; const prevRk = {}; [...(ps.bull || []), ...(ps.bear || [])].forEach((n) => { prevRk[n.symbol] = [n.side, n.rank]; });
  const lv = starLive(starRule(m), Object.values(inp), r, now, cd, prevRk);
  ST.snap[m] = { bull: lv.bull, bear: lv.bear, at: now, live: starOpen(m), pool: Object.keys(inp).length };
  store.set('star_mem_' + m, r.members); store.set('star_cd_' + m, cd); store.set('star_snap_' + m, ST.snap[m]);
  if (m === starMkt()) starRender();
}
function starTick() {
  if (!ST.el || !ST.el.isConnected) { clearInterval(ST.loop); ST.loop = 0; return; }
  if (starPref().paused || ST.busy) return;
  const m = starMkt(), a = starAnimCfg(), open = starOpen(m), now = Date.now(), snap = starSnap(m);
  if (!ST.inp[m] ? open || !snap || now - snap.at > 6 * 3600000 || (!(snap.bull || []).length && !(snap.bear || []).length) : open && now - (ST.scanAt[m] || 0) >= a.scanMin * 60000) { starScan(m); return; }
  if (!ST.inp[m]) return;
  if (!open) { if (snap && snap.live) starRecompute(m); return; } // 剛收盤：改為盤後排行
  if (now - (ST.qAt[m] || 0) >= 20000) { ST.qAt[m] = now; refreshQuotes(Object.keys(ST.inp[m])).catch(() => {}).then(() => starRescore(m)).catch(() => {}).then(() => starPatch(m)); } else starPatch(m);
}
function starSrc() {
  const m = starMkt(); const s = starSnap(m) || {};
  return { bull: s.bull || [], bear: s.bear || [], anim: starAnimCfg(), live: starOpen(m), paused: !!starPref().paused, sel: ST.sel, ejects: ST.ej.filter((x) => x.m === m), right: m === 'ETF' ? '轉弱／回檔' : '空方看跌', busy: ST.busy === m };
}
/** 星團畫布：節點依名次排列（第 1 名在中心、黃金角向外），彈出特效、大量光束、多空流向、磁吸脈衝、星雲光暈；不在畫面或分頁隱藏時停畫 */
function starFx(cv, src) {
  const g = cv.getContext('2d'); const N = new Map(); const F = [];
  const E = { raf: 0, vis: true, last: 0, t: 0, rot: 0, dead: false, io: null, col: null, colAt: 0, beam: 0, flow: 0, handled: src().ejects.reduce((s, x) => Math.max(s, x.id), 0) };
  // 螺旋星系恆星（與 App 相同的配置：約 22% 核球、12% 盤面散星、其餘沿兩條旋臂；固定亂數種子）
  const GS = 900, TW = 4, TILT = 0.78, GT = new Float32Array(GS * 2), GA = new Float32Array(GS * 2), GB = new Uint8Array(GS * 2);
  const HXA = new Float32Array(36), HXD = new Float32Array(36), HXL = new Uint8Array(36), DUS = []; E.pu = []; E.puAcc = 0; E.clk = 0; E.sw = [0, 0];
  const DPN = 300, DX = new Float32Array(DPN * 2), DY = new Float32Array(DPN * 2), DZ = new Float32Array(DPN * 2), DPH = new Float32Array(DPN * 2), HPN = 420, HRr = new Float32Array(HPN * 2), HAa = new Float32Array(HPN * 2);
  { let sd = 20260117; const rnd = () => { sd = (sd + 0x6D2B79F5) | 0; let t = Math.imul(sd ^ (sd >>> 15), 1 | sd); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const gs = () => (rnd() + rnd() + rnd() - 1.5) / 0.5;
    for (let i = 0; i < GS * 2; i++) { const q = rnd();
      if (q < 0.22) { GT[i] = Math.min(1, Math.abs(gs()) * 0.12); GA[i] = rnd() * 6.283; }
      else if (q < 0.34) { GT[i] = 0.1 + rnd() * 0.95; GA[i] = rnd() * 6.283; }
      else { const t = 0.08 + Math.pow(rnd(), 0.8) * 0.92; GT[i] = t * (1 + gs() * 0.04); GA[i] = (rnd() < 0.5 ? 0 : Math.PI) + t * TW + gs() * 0.18 * (1.1 - t * 0.5); }
      const b = rnd(); GB[i] = b < 0.62 ? 0 : b < 0.9 ? 1 : 2; }
    // 神經網路：外圍節點（角度、距離比例、連到第幾名）與背景微塵（與 App 相同配置）
    for (let i = 0; i < 36; i++) { HXA[i] = rnd() * 6.283; HXD[i] = 0.55 + rnd() * 0.55; HXL[i] = 1 + Math.floor(rnd() * 15); }
    for (let i = 0; i < 160; i++) DUS.push([rnd(), rnd(), rnd(), rnd() * 6.283]);
    // 光塵（景深微塵：位置、深度、相位）與黑洞吸積盤粒子（半徑比例、角度）
    for (let i = 0; i < DPN * 2; i++) { DX[i] = gs(); DY[i] = gs(); DZ[i] = Math.pow(rnd(), 1.6); DPH[i] = rnd() * 6.283; }
    for (let i = 0; i < HPN * 2; i++) { HRr[i] = 0.24 + Math.pow(rnd(), 0.7) * 0.76; HAa[i] = rnd() * 6.283; } }
  const mix = (c, k) => { const m = /^#([0-9a-f]{6})$/i.exec(String(c).trim()); if (!m) return c; const v = parseInt(m[1], 16), f = (x) => Math.round(x + (255 - x) * k); return `rgb(${f(v >> 16)},${f((v >> 8) & 255)},${f(v & 255)})`; };
  try { E.io = new IntersectionObserver((es) => { E.vis = es.some((x) => x.isIntersecting); }); E.io.observe(cv); } catch (e) {}
  const fx = (o) => { if (F.length >= 150) F.shift(); F.push(o); };
  const stop = () => { cancelAnimationFrame(E.raf); E.dead = true; if (E.io) E.io.disconnect(); };
  const frame = (ts) => {
    if (!cv.isConnected) { stop(); return; }
    E.raf = requestAnimationFrame(frame);
    const d = src(), a = d.anim, moving = a.anim && !d.paused;
    if (document.hidden || !E.vis || ts - E.last < (!moving ? 400 : d.live ? 0 : 66)) return;
    const dt = (E.last ? Math.min(0.05, (ts - E.last) / 1000) : 0.016) * Math.max(0.2, Math.min(2.5, a.speed || 1)); E.last = ts; E.t += dt;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (!E.col || ts - E.colAt > 2000) { E.col = { up: css('--up') || '#dc2626', dn: css('--down') || '#16a34a', tx: css('--text') || '#111', t2: css('--text2') || '#888', bd: css('--border') || '#ddd' }; E.colAt = ts; }
    const C = E.col, cy = H * 0.57, maxR = Math.min(W * 0.21, H * 0.36), cx = (s) => (s === 'bull' ? W * 0.25 : W * 0.75), col = (s) => (s === 'bull' ? C.up : C.dn);
    const gal = a.style === 'GALAXY', neu = a.style === 'NEURAL', GR = Math.min(W * 0.26, H * 0.44 / TILT), sg = (s) => (s === 'bull' ? 1 : -1);
    const gx = (s, t, an) => cx(s) + Math.cos(sg(s) * (an - E.rot)) * GR * t, gy = (s, t, an) => cy + Math.sin(sg(s) * (an - E.rot)) * GR * t * TILT;
    const dark = a.style !== 'CLASSIC', dus = a.style === 'DUST', orb = a.style === 'ORBIT', aur = a.style === 'AURORA', hol = a.style === 'HOLE', rad = a.style === 'RADAR', hiv = a.style === 'HIVE';
    // 行星軌道：第 1 名為恆星，其餘依名次由內而外繞行（內圈較快）；黑洞吸積：節點繞黑洞，吸積盤粒子內熱外冷
    const OT = Math.max(0.2, a.orbTilt || 0.6), OR = Math.min(W * 0.24, H * 0.42 / Math.max(0.45, OT)), orR = (i, n) => (i === 0 ? 0 : 0.36 + 0.64 * (i - 1) / Math.max(1, n - 2));
    const orbP = (s, i, n) => { const rr = orR(i, n), an = i * 2.39996 + sg(s) * E.clk * a.orbSpd * 0.25 / Math.pow(Math.max(0.2, rr), 1.5); return [cx(s) + Math.cos(an) * OR * rr, cy + Math.sin(an) * OR * rr * OT]; };
    const HT = Math.max(0.12, a.holeTilt || 0.35), HR = Math.min(W * 0.22, H * 0.6);
    const holP = (s, i, n) => { const rr = 0.55 + 0.6 * i / Math.max(1, n - 1), an = i * 2.39996 + sg(s) * E.clk * a.holeSpd * 0.3 / Math.pow(rr, 1.5); return [cx(s) + Math.cos(an) * HR * rr, cy + Math.sin(an) * HR * rr * Math.min(0.85, HT + 0.4)]; };
    if (dark && moving) { E.rot += dt * 0.05 * (0.4 + a.turbulence) * (gal ? a.galSpin : 1); E.clk += dt; } else if (!moving) { E.rot = 0; E.pu = []; }
    const NR = Math.min(W * 0.22, H * 0.4), nx = (s, dv, an) => cx(s) + Math.cos(an + sg(s) * E.rot * 0.8) * NR * dv, ny = (s, dv, an) => cy + Math.sin(an + sg(s) * E.rot * 0.8) * NR * dv * 0.85;
    // 背景：螺旋星系（深空、盤面霧光、旋臂恆星、核心光芒）或分隔線
    if (gal) {
      g.fillStyle = '#070A14'; g.fillRect(0, 0, W, H);
      const cnt = Math.round(GS * Math.max(0.3, Math.min(1, a.density || 0.75)));
      ['bull', 'bear'].forEach((s) => { const c = col(s), x0 = cx(s);
        g.save(); g.translate(x0, cy); g.scale(1, TILT); const hz = g.createRadialGradient(0, 0, 0, 0, 0, GR * 1.05); hz.addColorStop(0, mix(c, 0) + ''); hz.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = 0.2; g.fillStyle = hz; g.beginPath(); g.arc(0, 0, GR * 1.05, 0, 6.283); g.fill(); g.restore(); g.globalAlpha = 1;
        g.globalCompositeOperation = 'lighter'; const o = s === 'bull' ? 0 : GS;
        const gb = Math.max(0.3, a.galBright || 1);
        for (let b = 0; b < 3; b++) { g.fillStyle = mix(c, b === 2 ? 0.75 : 0.35); g.globalAlpha = Math.min(1, (b === 0 ? 0.55 : b === 1 ? 0.8 : 1) * gb); const z = (b === 0 ? 1.3 : b === 1 ? 1.8 : 2.6) * (gb > 1 ? 0.7 + 0.3 * gb : 1);
          g.beginPath(); for (let k = 0; k < cnt; k++) { const i = o + k; if (GB[i] !== b) continue; const t = GT[i], an = GA[i] - E.rot * (0.35 / (0.35 + t) - 0.3); const x = gx(s, t, an), y = gy(s, t, an); g.moveTo(x + z / 2, y); g.arc(x, y, z / 2, 0, 6.283); } g.fill(); }
        g.globalAlpha = 1; const cr = g.createRadialGradient(x0, cy, 0, x0, cy, GR * 0.26); cr.addColorStop(0, 'rgba(255,255,255,0.95)'); cr.addColorStop(0.45, mix(c, 0.2)); cr.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = Math.max(0, Math.min(1, a.galCore)); g.fillStyle = cr; g.beginPath(); g.arc(x0, cy, GR * 0.26, 0, 6.283); g.fill(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; });
    } else if (neu) {
      // 神經網路：深色底＋微塵、外圍節點細線、名次連線（分數越高越粗越亮）、流向中樞的資料脈衝、兩網中樞匯流
      g.fillStyle = '#04060B'; g.fillRect(0, 0, W, H); const den = Math.max(0.3, Math.min(1, a.density || 0.75));
      for (let k = 0; k < Math.round(160 * den); k++) { const [x, y, z, ph] = DUS[k], tw = 0.5 + 0.5 * Math.sin(E.clk * 1.3 + ph); g.fillStyle = `rgba(70,140,255,${Math.min(1, 0.25 * tw * z * a.neuDust)})`; g.fillRect(x * W, (((y - E.clk * 0.004 * z) % 1) + 1) % 1 * H, 1.1, 1.1); }
      const BS = { bull: [], bear: [] }; N.forEach((o) => { if (o.st === 1 && o.rank <= 15) BS[o.side][o.rank] = o; });
      const cv2 = (A, B) => [A.x, A.y, (A.x + B.x) / 2 + 8, (A.y + B.y) / 2 - 8, B.x, B.y];
      ['bull', 'bear'].forEach((s, si) => { const c = col(s), bs = BS[s]; let mk = 0; for (let k = 1; k <= 15; k++) if (bs[k]) mk = k; if (!mk) return;
        g.lineWidth = 0.6; g.strokeStyle = c; g.fillStyle = c;
        for (let k = 0; k < Math.max(6, Math.round(18 * den)); k++) { const h = si * 18 + k, hx = nx(s, HXD[h], HXA[h] * 0.7), hy = ny(s, HXD[h], HXA[h] * 0.7); let tk = Math.min(HXL[h], mk); while (tk > 1 && !bs[tk]) tk--;
          if (bs[tk]) { g.globalAlpha = Math.min(1, 0.10 * a.neuLink); g.beginPath(); g.moveTo(hx, hy); g.lineTo(bs[tk].x, bs[tk].y); g.stroke(); } g.globalAlpha = 0.35; g.fillRect(hx - 0.8, hy - 0.8, 1.6, 1.6); g.globalAlpha = 1; }
        for (let k = 2; k <= mk; k++) { const B = bs[k]; if (!B) continue; const wv = Math.max(0, Math.min(1, ((B.fin || 50) - 50) / 50));
          g.strokeStyle = c; g.globalAlpha = Math.min(1, (0.12 + wv * 0.3) * a.neuLink) * Math.max(0, Math.min(1, B.a)); g.lineWidth = 0.7 + wv * 1.2;
          [Math.floor((k - 2) / 2) + 1, k > 3 ? k - 1 : 0].forEach((pk) => { const A = bs[pk]; if (!pk || !A) return; const q = cv2(A, B); g.beginPath(); g.moveTo(q[0], q[1]); g.quadraticCurveTo(q[2], q[3], q[4], q[5]); g.stroke(); }); }
        g.globalAlpha = 1; g.lineWidth = 1;
        E.pu.forEach((p) => { if (p.si !== si || p.k > mk) return; const A = bs[Math.floor((p.k - 2) / 2) + 1], B = bs[p.k]; if (!A || !B) return; const q = cv2(A, B), u = 1 - p.u, v = 1 - u;
          const x = v * v * q[0] + 2 * v * u * q[2] + u * u * q[4], y = v * v * q[1] + 2 * v * u * q[3] + u * u * q[5];
          g.fillStyle = c; g.globalAlpha = 0.18; g.beginPath(); g.arc(x, y, 6, 0, 6.283); g.fill(); g.globalAlpha = 0.55; g.beginPath(); g.arc(x, y, 2.6, 0, 6.283); g.fill(); g.globalAlpha = 0.9; g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 1.2, 0, 6.283); g.fill(); g.globalAlpha = 1; }); });
      if (moving) { const wh = Array.from(N.values()).filter((o) => o.st === 1 && o.whale).length; E.puAcc += dt * (3 + a.turbulence * 6 + (a.whaleBeam ? wh * 2 : 0)) * a.neuPulse;
        while (E.puAcc >= 1) { E.puAcc -= 1; const si = Math.random() < 0.5 ? 0 : 1, n = Math.min(15, (si ? d.bear : d.bull).length); if (n >= 2 && E.pu.length < 80) E.pu.push({ si, k: 2 + Math.floor(Math.random() * (n - 1)), u: 0, sp: 0.5 + Math.random() * 0.6 }); }
        E.pu = E.pu.filter((p) => (p.u += dt * p.sp) < 1); }
      const HA = BS.bull[1], HB = BS.bear[1];
      if (a.flow && HA && HB) { const toBull = d.bull.reduce((s, x) => s + x.final, 0) >= d.bear.reduce((s, x) => s + x.final, 0), mx = W / 2;
        g.strokeStyle = 'rgba(70,140,255,0.16)'; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(HA.x, HA.y); g.bezierCurveTo(mx - 30, HA.y + k * 22, mx + 30, HB.y + k * 22, HB.x, HB.y); g.stroke(); }
        const fn = Math.max(4, Math.round(14 * a.flowAmt));
        for (let k = 0; k < fn; k++) { const u0 = (E.clk * 0.35 * a.flowSpd + k / fn) % 1, u = toBull ? 1 - u0 : u0, kk = (k % 5) - 2, v = 1 - u;
          const x = v * v * v * HA.x + 3 * v * v * u * (mx - 30) + 3 * v * u * u * (mx + 30) + u * u * u * HB.x, y = v * v * v * HA.y + 3 * v * v * u * (HA.y + kk * 22) + 3 * v * u * u * (HB.y + kk * 22) + u * u * u * HB.y;
          g.fillStyle = u0 > 0.5 ? (toBull ? C.up : C.dn) : 'rgb(70,140,255)'; g.globalAlpha = 0.85; g.beginPath(); g.arc(x, y, 1.6, 0, 6.283); g.fill(); } g.globalAlpha = 1; }
    } else if (dus) {
      // 光塵星團：景深微塵（遠小暗、近大柔光斑），多方緩慢上升、空方下沉，輕微閃爍
      g.fillStyle = '#06080F'; g.fillRect(0, 0, W, H); const dn = Math.round(DPN * Math.max(0.3, Math.min(1, a.density || 0.75))), span = maxR * 3.2;
      g.globalCompositeOperation = 'lighter';
      ['bull', 'bear'].forEach((s, si) => { const c = col(s), x0 = cx(s), dir = s === 'bull' ? -1 : 1, o0 = si * DPN, cn = [mix(c, 0.15), mix(c, 0.45), mix(c, 0.8)];
        for (let k = 0; k < dn; k++) { const i = o0 + k, z = DZ[i], ph = DPH[i];
          let v = DY[i] * maxR * 0.75 + dir * E.clk * a.dstRise * 10 * (0.35 + z); v = ((v + span / 2) % span + span) % span - span / 2;
          const fe = Math.max(0, 1 - Math.pow(Math.abs(v) / (span / 2), 2)), x = x0 + DX[i] * maxR * 0.6 + Math.sin(E.clk * 0.5 + ph) * 5 * z, y = cy + v, tw = 1 - a.dstTwk * 0.5 * (1 + Math.sin(E.clk * 2.4 + ph * 3));
          if (z > 0.86 && a.dstBokeh > 0) { g.globalAlpha = Math.min(1, 0.07 * fe * a.dstBokeh); g.fillStyle = cn[1]; g.beginPath(); g.arc(x, y, 3 + z * 5 * a.dstBokeh, 0, 6.283); g.fill(); }
          else { const sz = 0.6 + z * 1.8; g.globalAlpha = Math.min(1, (0.2 + 0.65 * z) * tw * fe); g.fillStyle = cn[z < 0.35 ? 0 : z < 0.7 ? 1 : 2]; g.fillRect(x - sz / 2, y - sz / 2, sz, sz); } } });
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    } else if (orb) {
      // 行星軌道：細軌道線＋恆星光暈
      g.fillStyle = '#05070D'; g.fillRect(0, 0, W, H);
      for (let k = 0; k < 90; k++) { const [x, y, z, ph] = DUS[k]; g.fillStyle = `rgba(255,255,255,${0.12 + 0.25 * z * (0.6 + 0.4 * Math.sin(E.clk + ph))})`; g.fillRect(x * W, y * H, 1, 1); }
      ['bull', 'bear'].forEach((s) => { const c = col(s), x0 = cx(s), n = (d[s] || []).length; if (!n) return;
        const sr = g.createRadialGradient(x0, cy, 0, x0, cy, OR * 0.16); sr.addColorStop(0, 'rgba(255,255,255,0.9)'); sr.addColorStop(0.4, mix(c, 0.3)); sr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = 0.6; g.fillStyle = sr; g.beginPath(); g.arc(x0, cy, OR * 0.16, 0, 6.283); g.fill();
        g.strokeStyle = c; g.lineWidth = 0.6; g.globalAlpha = Math.min(1, 0.28 * a.orbLine);
        for (let i = 1; i < n; i++) { const rr = orR(i, n); g.beginPath(); g.ellipse(x0, cy, OR * rr, OR * rr * OT, 0, 0, 6.283); g.stroke(); }
        g.globalAlpha = 1; g.lineWidth = 1; });
    } else if (aur) {
      // 極光帷幕：兩側光帶飄動，整體越強光帶越亮；邊緣收窄
      g.fillStyle = '#040812'; g.fillRect(0, 0, W, H);
      for (let k = 0; k < 110; k++) { const [x, y, z, ph] = DUS[k]; g.fillStyle = `rgba(255,255,255,${0.1 + 0.3 * z * (0.6 + 0.4 * Math.sin(E.clk * 1.4 + ph))})`; g.fillRect(x * W, y * H, 1, 1); }
      g.globalCompositeOperation = 'lighter';
      ['bull', 'bear'].forEach((s, si) => { const c = col(s), x0 = cx(s), L = d[s] || [], st = L.length ? Math.min(1, L.reduce((q, x) => q + x.final, 0) / L.length / 100) : 0.3;
        const xl = x0 - W * 0.23, xr = x0 + W * 0.23, amp = H * 0.05 * a.aurAmp, nb = Math.max(1, Math.round(a.aurBands)), t = E.clk * a.aurSpd;
        for (let b = 0; b < nb; b++) { const yB = H * (0.36 + b * 0.05), len = H * (0.26 + 0.05 * b), ph = b * 1.7 + si * 2;
          const gr = g.createLinearGradient(0, yB - len - amp, 0, yB + amp + 6); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, mix(c, 0.35)); gr.addColorStop(0.9, mix(c, 0.7)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr;
          const ba = (0.06 + 0.14 * st) * (1 - b * 0.15);
          for (let x = Math.ceil(xl); x < xr; x += 3) { const u = (x - xl) / (xr - xl), tp = Math.pow(Math.sin(Math.PI * u), 0.8), yb = yB + Math.sin(x * 0.017 + t * (0.6 + 0.2 * b) + ph) * amp + Math.sin(x * 0.041 - t * 0.9 + b) * amp * 0.4;
            const h = len * (0.7 + 0.3 * Math.sin(x * 0.07 + t * 0.7 + ph * 2) * Math.sin(x * 0.023 - t * 0.4 + ph)); g.globalAlpha = ba * tp; g.fillRect(x, yb - h, 3, h + 6); } } });
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    } else if (hol) {
      // 黑洞吸積：盤面後半 → 黑洞與光環 → 盤面前半
      g.fillStyle = '#030308'; g.fillRect(0, 0, W, H);
      for (let k = 0; k < 80; k++) { const [x, y, z] = DUS[k]; g.fillStyle = `rgba(255,255,255,${0.1 + 0.2 * z})`; g.fillRect(x * W, y * H, 1, 1); }
      const hn = Math.round(HPN * Math.max(0.3, Math.min(1, a.density || 0.75)));
      ['bull', 'bear'].forEach((s, si) => { const c = col(s), x0 = cx(s), o0 = si * HPN, cn = [mix(c, 0.85), mix(c, 0.45), c];
        const disk = (front) => { g.globalCompositeOperation = 'lighter';
          for (let k = 0; k < hn; k++) { const i = o0 + k, rr = HRr[i], an = HAa[i] + sg(s) * E.clk * a.holeSpd * 0.5 / Math.pow(rr, 1.5), sn = Math.sin(an); if ((sn >= 0) !== front) continue;
            const x = x0 + Math.cos(an) * HR * rr, y = cy + sn * HR * rr * HT, sz = 0.8 + (1 - rr) * 1.6; g.globalAlpha = Math.min(1, 0.3 + 0.6 * (1 - rr)); g.fillStyle = cn[rr < 0.45 ? 0 : rr < 0.7 ? 1 : 2]; g.fillRect(x - sz / 2, y - sz / 2, sz, sz); }
          g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; };
        disk(false);
        const hr = HR * 0.2, gl = Math.max(0, a.holeGlow), lg = g.createRadialGradient(x0, cy, hr * 0.9, x0, cy, hr * 2.2); lg.addColorStop(0, mix(c, 0.7)); lg.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = Math.min(1, 0.55 * gl); g.fillStyle = lg; g.beginPath(); g.arc(x0, cy, hr * 2.2, 0, 6.283); g.fill();
        g.globalAlpha = 1; g.fillStyle = '#000'; g.beginPath(); g.arc(x0, cy, hr, 0, 6.283); g.fill();
        g.strokeStyle = mix(c, 0.8); g.globalAlpha = Math.min(1, 0.8 * gl); g.lineWidth = 1.4; g.beginPath(); g.arc(x0, cy, hr * 1.04, 0, 6.283); g.stroke(); g.lineWidth = 1; g.globalAlpha = 1;
        disk(true); });
    } else if (rad) {
      // 雷達掃描：同心環＋十字線，掃描線帶餘暉旋轉；掃過的節點會亮一下（在節點處理）
      g.fillStyle = '#020806'; g.fillRect(0, 0, W, H); const sw = E.clk * a.radSpd * 1.6, nr = Math.max(2, Math.round(a.radRings)), RR = maxR * 1.05;
      ['bull', 'bear'].forEach((s, si) => { const c = col(s), x0 = cx(s), dr = sg(s), an = dr * sw + si * Math.PI; E.sw[si] = an;
        g.strokeStyle = c; g.lineWidth = 0.7; g.globalAlpha = 0.22;
        for (let k = 1; k <= nr; k++) { g.beginPath(); g.arc(x0, cy, RR * k / nr, 0, 6.283); g.stroke(); }
        g.beginPath(); g.moveTo(x0 - RR, cy); g.lineTo(x0 + RR, cy); g.moveTo(x0, cy - RR); g.lineTo(x0, cy + RR); g.stroke();
        const tr = 1.2 * Math.max(0.1, a.radTrail), sg2 = 24; g.fillStyle = c;
        for (let k = 0; k < sg2; k++) { const a0 = an - dr * tr * k / sg2, a1 = an - dr * tr * (k + 1) / sg2; g.globalAlpha = 0.26 * (1 - k / sg2); g.beginPath(); g.moveTo(x0, cy); g.arc(x0, cy, RR, Math.min(a0, a1), Math.max(a0, a1)); g.closePath(); g.fill(); }
        g.globalAlpha = 0.9; g.strokeStyle = mix(c, 0.5); g.lineWidth = 1.4; g.beginPath(); g.moveTo(x0, cy); g.lineTo(x0 + Math.cos(an) * RR, cy + Math.sin(an) * RR); g.stroke(); });
      g.globalAlpha = 1; g.lineWidth = 1;
    } else if (hiv) {
      // 蜂巢熱力：六角格依附近節點分數加熱，顏色取較強的一方，緩慢呼吸
      g.fillStyle = '#07070A'; g.fillRect(0, 0, W, H);
      const hs = Math.max(6, a.hivSize), hw = hs * 1.732, sig = maxR * 0.35 * Math.max(0.3, a.hivHeat), s2 = 2 * sig * sig, pts = [];
      N.forEach((o) => { if (o.st === 1) pts.push([o.x, o.y, o.side === 'bull', (o.fin || 50) / 100]); });
      g.lineWidth = 0.6;
      for (let row = 0, y = 0; y < H + hs; row++, y += hs * 1.5) for (let x = (row % 2) * hw / 2; x < W + hw; x += hw) {
        let hb = 0, hr = 0; for (const [px, py, bu, w] of pts) { const e = Math.exp(-((x - px) ** 2 + (y - py) ** 2) / s2) * w; if (bu) hb += e; else hr += e; }
        const hh = Math.min(1, Math.max(hb, hr)), ph = 1 - 0.15 * a.hivPulse * (0.5 + 0.5 * Math.sin(E.clk * 2 + x * 0.05 + y * 0.07)), c = hb >= hr ? C.up : C.dn;
        g.beginPath(); for (let k = 0; k < 6; k++) { const an = Math.PI / 6 + k * Math.PI / 3, vx = x + Math.cos(an) * hs * 0.94, vy = y + Math.sin(an) * hs * 0.94; if (k) g.lineTo(vx, vy); else g.moveTo(vx, vy); } g.closePath();
        if (hh > 0.04) { g.globalAlpha = Math.min(0.75, hh * 0.7 * ph); g.fillStyle = c; g.fill(); }
        g.globalAlpha = 0.12 + hh * 0.3; g.strokeStyle = hh > 0.04 ? c : '#3a3f4a'; g.stroke(); }
      g.globalAlpha = 1; g.lineWidth = 1;
    } else if (a.clsLine !== false) { g.strokeStyle = C.bd; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(W / 2, 22); g.lineTo(W / 2, H - 6); g.stroke(); g.setLineDash([]); }
    g.font = '600 12px system-ui,sans-serif'; g.textAlign = 'center'; g.fillStyle = C.up; g.fillText('多方看漲 ' + d.bull.length, W * 0.25, 15); g.fillStyle = C.dn; g.fillText(d.right + ' ' + d.bear.length, W * 0.75, 15);
    if (a.haze) ['bull', 'bear'].forEach((s) => { const gr = g.createRadialGradient(cx(s), cy, 0, cx(s), cy, maxR * a.hazeR); gr.addColorStop(0, col(s)); gr.addColorStop(1, col(s) + '00'); g.globalAlpha = Math.max(0, Math.min(1, a.hazeA)); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalAlpha = 1; });
    // 同步節點目標位置
    const live = new Set();
    ['bull', 'bear'].forEach((side) => { const list = d[side] || [], n = list.length;
      list.forEach((nd, i) => { const ang = i * 2.39996 + (side === 'bear' ? Math.PI : 0), dist = i === 0 ? 0 : maxR * Math.sqrt(i / Math.max(1, n - 1)) * 0.92 * a.clsSpread;
        // 星系模式：第 1 名在核心，其餘依名次沿兩條旋臂由內而外，隨星系旋轉
        const gt = i === 0 ? 0 : 0.3 + 0.65 * (i - 1) / Math.max(1, n - 2), ga = ((i + 1) % 2) * Math.PI + gt * TW;
        // 神經網路：第 1 名為中樞，其餘依名次以黃金角向外
        const dv = i === 0 || n <= 1 ? 0 : 0.22 + 0.7 * Math.sqrt(i / Math.max(1, n - 1)), na = (i + 1) * 2.39996 + (side === 'bear' ? Math.PI : 0);
        let o = N.get(nd.symbol);
        if (!o || o.side !== side || o.st !== 1) { o = { x: cx(side) + (Math.random() - 0.5) * maxR * 2, y: cy + (Math.random() - 0.5) * maxR * 1.6, vx: 0, vy: 0, a: 0, side, st: 1, rp: 0 }; N.set(nd.symbol, o); }
        const P = gal ? [gx(side, gt, ga), gy(side, gt, ga)] : neu ? [nx(side, dv, na), ny(side, dv, na)] : orb ? orbP(side, i, n) : hol ? holP(side, i, n) : [cx(side) + Math.cos(ang) * dist, cy + Math.sin(ang) * dist * 0.85 + (aur ? H * 0.1 : 0)];
        Object.assign(o, { tx: P[0], ty: P[1], fin: nd.final, r: Math.max(3, (4 + nd.final / 10) * a.scale * (i === 0 ? 1.35 : 1)), rank: nd.rank, whale: nd.whale, hot: nd.hot, sym: nd.symbol }); live.add(nd.symbol); }); });
    // 彈出事件
    d.ejects.slice().reverse().forEach((ev) => { if (ev.id <= E.handled) return; E.handled = ev.id;
      const o = N.get(ev.e.symbol), x = o ? o.x : cx(ev.e.side), y = o ? o.y : cy, c = ev.e.forced ? '#f59e0b' : col(ev.e.side);
      const ea = Math.max(0.3, a.ejectAmt), ed = Math.max(0.4, a.ejectDur), es = Math.sqrt(ea);
      if (a.eject === 'BURST') { const nb = Math.round(18 * ea); for (let k = 0; k < nb; k++) { const an = k / nb * 6.283, sp = (60 + Math.random() * 90) * es; fx({ k: 0, x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: 0.9 * ed, max: 0.9 * ed, sz: 2, c }); } }
      else if (a.eject === 'SHATTER') { const nb = Math.round(8 * ea); for (let k = 0; k < nb; k++) { const an = Math.random() * 6.283, sp = (30 + Math.random() * 60) * es; fx({ k: 3, x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 40, life: 1.1 * ed, max: 1.1 * ed, sz: 3 + Math.random() * 3, c, rot: Math.random() * 6 }); } }
      fx({ k: 4, x, y, vx: 0, vy: 0, life: 0.8 * ed, max: 0.8 * ed, sz: o ? o.r : 8, c });
      if (o) o.st = a.eject === 'DISSOLVE' ? 3 : 2; });
    N.forEach((o, s) => { if (o.st === 1 && !live.has(s)) o.st = 3; if (o.st === 2) N.delete(s); });
    // 大量光束、多空流向
    if (moving && a.whaleBeam && (E.beam += dt) >= Math.max(0.3, a.beamSec)) { E.beam = 0; const wh = Array.from(N.values()).filter((o) => o.st === 1 && o.whale); if (wh.length) { const o = wh[Math.floor(Math.random() * wh.length)]; fx({ k: 1, x: o.x + (Math.random() - 0.5) * 40, y: -4, vx: 0, vy: 0, life: 3, max: 3, sz: 2, c: '#fbbf24', tgt: o }); } }
    if (moving && a.flow && !neu) { const sb = d.bull.reduce((s, x) => s + x.final, 0), sr = d.bear.reduce((s, x) => s + x.final, 0), df = sb - sr;
      if (Math.abs(df) > 20 && (E.flow += dt * Math.min(12, Math.abs(df) / 60) * a.flowAmt) >= 1) { E.flow = 0; const from = df > 0 ? 'bear' : 'bull', to = df > 0 ? 'bull' : 'bear', y0 = cy + (Math.random() - 0.5) * maxR, lf = 2.2 / Math.max(0.3, a.flowSpd);
        fx({ k: 2, x: cx(from), y: y0, vx: (cx(to) - cx(from)) / lf, vy: (Math.random() - 0.5) * 20, life: lf, max: lf, sz: 1.6, c: col(to) }); } }
    // 節點
    N.forEach((o, s) => {
      if (o.st === 3) { const ed = Math.max(0.4, a.ejectDur); o.a -= dt * 1.5 / ed; o.r *= 1 - dt / ed; if (o.a <= 0) { N.delete(s); return; } }
      else if (!moving) { o.x = o.tx; o.y = o.ty; o.a = 1; o.vx = o.vy = 0; }
      else { const tu = a.turbulence * 50; o.vx += ((o.tx - o.x) * 12 - o.vx * 5) * dt + (Math.random() - 0.5) * tu * dt; o.vy += ((o.ty - o.y) * 12 - o.vy * 5) * dt + (Math.random() - 0.5) * tu * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.a = Math.min(1, o.a + dt * 2); }
      const pr = (moving && a.motion === 'PULSE' ? 1 + a.pulseAmp * Math.sin(E.t * 3 + o.rank) : 1) * (gal ? 0.7 : neu ? 0.4 : dark ? 0.6 : 1), r = o.r * pr, c = col(o.side);
      g.globalAlpha = Math.max(0, o.a) * (o.rank <= 3 || dark ? 1 : 0.7);
      if (o.hot) { g.fillStyle = '#f9731633'; g.beginPath(); g.arc(o.x, o.y, r + 5, 0, 6.283); g.fill(); }
      if (neu) {
        // 網路節點：柔光＋側色環＋白色核心
        const al = g.globalAlpha; g.fillStyle = c; g.globalAlpha = al * 0.12; g.beginPath(); g.arc(o.x, o.y, r * 4, 0, 6.283); g.fill(); g.globalAlpha = al * 0.25; g.beginPath(); g.arc(o.x, o.y, r * 2.4, 0, 6.283); g.fill();
        g.globalAlpha = al * 0.9; g.strokeStyle = c; g.lineWidth = 1; g.beginPath(); g.arc(o.x, o.y, r * 1.3, 0, 6.283); g.stroke(); g.fillStyle = '#fff'; g.globalAlpha = al * 0.95; g.beginPath(); g.arc(o.x, o.y, r * 0.6, 0, 6.283); g.fill(); g.globalAlpha = al;
      } else if (gal) {
        // 亮星：光暈＋白色星核＋側色光環；前 3 名加四芒星光
        const al = g.globalAlpha; g.globalAlpha = al * 0.35; g.fillStyle = c; g.beginPath(); g.arc(o.x, o.y, r * 1.8, 0, 6.283); g.fill();
        if (o.rank <= 3 && o.st === 1) { g.globalAlpha = al * 0.55; g.strokeStyle = '#fff'; g.lineWidth = 1; const fl = r * 3.2; g.beginPath(); g.moveTo(o.x - fl, o.y); g.lineTo(o.x + fl, o.y); g.moveTo(o.x, o.y - fl); g.lineTo(o.x, o.y + fl); g.stroke(); }
        g.globalAlpha = al * 0.95; g.strokeStyle = c; g.lineWidth = 1.6; g.beginPath(); g.arc(o.x, o.y, r, 0, 6.283); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(o.x, o.y, r * 0.6, 0, 6.283); g.fill(); g.globalAlpha = al; g.lineWidth = 1;
      } else if (orb) {
        // 行星：實心＋受光亮點；第 1 名恆星加光暈
        const al = g.globalAlpha; g.fillStyle = c; if (o.rank === 1) { g.globalAlpha = al * 0.25; g.beginPath(); g.arc(o.x, o.y, r * 3, 0, 6.283); g.fill(); }
        g.globalAlpha = al; g.beginPath(); g.arc(o.x, o.y, r, 0, 6.283); g.fill(); g.fillStyle = '#fff'; g.globalAlpha = al * 0.7; g.beginPath(); g.arc(o.x - r * 0.3, o.y - r * 0.3, r * 0.35, 0, 6.283); g.fill(); g.globalAlpha = al;
      } else if (dark) {
        // 光塵／極光／黑洞：柔光球＋白色核心
        const al = g.globalAlpha; g.fillStyle = c; g.globalAlpha = al * 0.14; g.beginPath(); g.arc(o.x, o.y, r * 2.6, 0, 6.283); g.fill(); g.globalAlpha = al * 0.3; g.beginPath(); g.arc(o.x, o.y, r * 1.8, 0, 6.283); g.fill();
        g.globalAlpha = al * 0.95; g.fillStyle = mix(c, 0.55); g.beginPath(); g.arc(o.x, o.y, r, 0, 6.283); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(o.x, o.y, r * 0.45, 0, 6.283); g.fill(); g.globalAlpha = al;
      } else { g.fillStyle = c; g.beginPath(); g.arc(o.x, o.y, r, 0, 6.283); g.fill(); }
      if (rad && o.st === 1) { const si = o.side === 'bull' ? 0 : 1, na = Math.atan2(o.y - cy, o.x - cx(o.side)), df = ((sg(o.side) * (E.sw[si] - na)) % 6.283 + 6.283) % 6.283, pk = Math.exp(-df * 2.5);
        if (pk > 0.05 && Math.hypot(o.x - cx(o.side), o.y - cy) > 3) { const al = g.globalAlpha; g.strokeStyle = '#fff'; g.globalAlpha = al * pk * 0.9; g.lineWidth = 1.2; g.beginPath(); g.arc(o.x, o.y, r + 3 + (1 - pk) * 6, 0, 6.283); g.stroke(); g.globalAlpha = al; g.lineWidth = 1; } }
      if (o.whale) { g.strokeStyle = '#fbbf24'; g.lineWidth = 1.2; g.beginPath(); g.arc(o.x, o.y, r + 2.5, 0, 6.283); g.stroke(); }
      if (o.rp > 0) { g.strokeStyle = '#fbbf24'; g.globalAlpha = o.rp; g.beginPath(); g.arc(o.x, o.y, r + (1 - o.rp) * 18, 0, 6.283); g.stroke(); o.rp = Math.max(0, o.rp - dt * 1.6); }
      if (moving && a.magnet && o.rank === 1 && o.st === 1) { const f = (E.t * a.magSpd + (o.side === 'bull' ? 0 : 0.5)) % 1; g.strokeStyle = c; g.globalAlpha = (1 - f) * 0.6; g.lineWidth = 1; g.beginPath(); g.arc(o.x, o.y, r + 4 + f * a.magR, 0, 6.283); g.stroke(); }
      if (d.sel === s) { g.globalAlpha = 1; g.strokeStyle = dark ? '#fff' : C.tx; g.lineWidth = 2; g.beginPath(); g.arc(o.x, o.y, r + 4, 0, 6.283); g.stroke(); }
      if (o.rank <= a.labelN && o.st === 1) { g.globalAlpha = Math.max(0, o.a); g.fillStyle = dark ? '#fff' : C.tx; g.font = '600 11px system-ui,sans-serif'; g.fillText(s, o.x, o.y - r - 5); }
      g.globalAlpha = 1; g.lineWidth = 1;
    });
    // 特效粒子
    for (let i = F.length - 1; i >= 0; i--) { const p = F[i]; p.life -= dt; if (p.life <= 0) { F.splice(i, 1); continue; } const f = p.life / p.max; g.globalAlpha = Math.max(0, f);
      if (p.k === 1) { const o = p.tgt; if (!o || !N.has(o.sym) || N.get(o.sym) !== o) { F.splice(i, 1); continue; } const dx = o.x - p.x, dy = o.y - p.y, dd = Math.hypot(dx, dy);
        if (dd < o.r + 2) { o.vy += 60; o.rp = 1; F.splice(i, 1); continue; } p.x += dx / dd * 260 * dt; p.y += dy / dd * 260 * dt; g.globalAlpha = 1; g.strokeStyle = p.c; g.lineWidth = 2; g.beginPath(); g.moveTo(p.x - dx / dd * 14, p.y - dy / dd * 14); g.lineTo(p.x, p.y); g.stroke(); g.lineWidth = 1; }
      else if (p.k === 4) { g.strokeStyle = p.c; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, p.sz + (1 - f) * 28, 0, 6.283); g.stroke(); g.lineWidth = 1; }
      else { if (p.k === 3) p.vy += 160 * dt; else if (p.k === 0) { p.vx *= 0.96; p.vy *= 0.96; } p.x += p.vx * dt; p.y += p.vy * dt; g.fillStyle = p.c;
        if (p.k === 3) { p.rot += dt * 6; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.sz / 2, -p.sz / 4, p.sz, p.sz / 2); g.restore(); } else { if (p.k === 2) g.globalAlpha = 0.5 * Math.min(1, f * 3); g.beginPath(); g.arc(p.x, p.y, p.sz, 0, 6.283); g.fill(); } }
      g.globalAlpha = 1; }
    if (!N.size) { g.fillStyle = C.t2; g.font = '13px system-ui,sans-serif'; g.fillText(d.busy ? '分析中…' : '目前沒有符合條件的標的', W / 2, cy); }
  };
  E.raf = requestAnimationFrame(frame);
  return { stop, get dead() { return E.dead; }, pick(x, y) { let best = null, bd = 1e9; N.forEach((o, s) => { if (o.st !== 1) return; const dd = Math.hypot(o.x - x, o.y - y); if (dd < o.r + 14 && dd < bd) { bd = dd; best = s; } }); return best; } };
}
function starRowsHtml(list, side, m) {
  if (!list.length) return '<div class="small muted" style="padding:8px 0">' + ((starSnap(m) || {}).live === false ? '最近收盤沒有綜合評估達 55 分且 K 線不反向的標的' : '選股池中沒有綜合評估達 55 分且 K 線不反向的標的') + '</div>';
  const us = m === 'US';
  return list.map((n) => { const dl = n.rankDelta >= STAR_NEW ? '<span class="tag" style="font-size:10px;padding:0 4px">NEW</span>' : n.rankDelta > 0 ? `<span class="up">▲${n.rankDelta}</span>` : n.rankDelta < 0 ? `<span class="down">▼${-n.rankDelta}</span>` : '<span class="muted">－</span>'; const sb = n.slBuffer;
    return `<div data-go="#/s/${esc(n.symbol)}" style="display:flex;gap:6px;align-items:center;padding:5px 2px;border-bottom:1px solid var(--border);cursor:pointer;${ST.sel === n.symbol ? 'background:var(--card2);' : ''}">
      <span class="num" style="min-width:18px;font-weight:700;color:var(${side === 'bull' ? '--up' : '--down'})">${n.rank}</span>
      <div style="flex:1;min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;font-size:13px">${n.met ? `<span style="color:var(${side === 'bull' ? '--up' : '--down'})" title="已達入選條件">✓</span> ` : n.cand ? '<span class="small muted" style="font-weight:400" title="尚未入選，依綜合評估補位">候選</span> ' : ''}${esc(n.symbol)} <span class="small muted" style="font-weight:400">${esc(n.name === n.symbol ? '' : n.name)}</span></div>
      <div class="small num" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span class="${cls(n.chgPct)}">${fmtPrice(n.price, us)} ${fmtPct(n.chgPct)}</span>${sb != null ? ` <span style="color:${sb < 1 ? '#f97316' : 'var(--text2)'}" title="距停損防守價">緩衝 ${fmt(sb, 1)}%</span>` : ''}</div></div>
      <span class="small" style="min-width:26px;text-align:right">${dl}</span></div>`; }).join('');
}
function starStatus() {
  const el = ST.el && $('#stSt', ST.el); if (!el) return; const m = starMkt(), s = starSnap(m), open = starOpen(m);
  const tm = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  el.textContent = ST.busy === m ? '分析中 ' + Math.round(ST.prog * 100) + '%' : (starPref().paused ? '已暫停 · ' : '') + (s ? '更新 ' + tm(s.at) + (s.pool ? ' · 選股池 ' + s.pool + ' 檔' : '') : '尚未分析') + (open ? ' · 盤中即時排行（✓＝星團成員、候選＝依綜合評估補位）' + (ST.rsDone[m] ? ' · 評分每 30 秒重算（' + tm(ST.rsDone[m]) + '）' : '') : s && s.live === false ? ' · 盤後排行（最近收盤評估，✓＝已達入選條件）' : ' · 非盤中（顯示最近一次結果）') + (m === 'US' && !apHas() ? ' · 未設定 Alpaca 金鑰，只用大型股與自選' : '');
}
function starRender() {
  const el = ST.el; if (!el) return; const m = starMkt(), s = starSnap(m) || {}, p = starPref();
  $$('[data-stm]', el).forEach((b) => b.classList.toggle('on', b.dataset.stm === m));
  $('#stP', el).textContent = p.paused ? '▶' : '⏸';
  const ev = ST.ej.find((x) => x.m === m && Date.now() - x.at < 600000);
  $('#stEj', el).innerHTML = ev ? `<span style="color:${ev.e.forced ? '#f59e0b' : 'var(--text2)'}">${ev.e.forced ? '⚡' : '·'} ${esc(ev.e.symbol)} ${esc(ev.e.name === ev.e.symbol ? '' : ev.e.name)} ${esc(ev.e.reason)}（${fmtPrice(ev.e.price, m === 'US')}${ev.e.stop ? '／防守 ' + fmtPrice(ev.e.stop, m === 'US') : ''}）移出星團</span>` : '';
  const sel = ST.sel && (s.bull || []).concat(s.bear || []).find((n) => n.symbol === ST.sel);
  $('#stSel', el).innerHTML = sel ? `<b>${esc(sel.symbol)}</b> ${esc(sel.name === sel.symbol ? '' : sel.name)}　${sel.side === 'bull' ? '多方' : '空方'}第 ${sel.rank} 名 · 綜合 ${Math.round(sel.composite)} · 三環 ${Math.round(sel.rings / 33.4)}/3 · K 線 ${Math.round(sel.kline)} · 總分 ${fmt(sel.final, 1)}${sel.stop ? ' · 防守 ' + fmtPrice(sel.stop, m === 'US') : ''}${sel.whale ? ' · 大量' : ''}${sel.hot ? ' · RSI 過熱' : ''}　<a data-go="#/s/${esc(sel.symbol)}" href="javascript:void 0">個股 ›</a>` : '';
  $('#stL', el).innerHTML = `<div><div class="small" style="font-weight:700;color:var(--up)">多方看漲</div>${starRowsHtml(s.bull || [], 'bull', m)}</div><div><div class="small" style="font-weight:700;color:var(--down)">${m === 'ETF' ? '轉弱／回檔' : '空方看跌'}</div>${starRowsHtml(s.bear || [], 'bear', m)}</div>`;
  starStatus();
}
function starBuild() {
  const el = document.createElement('div'); el.className = 'card'; el.id = 'starCard';
  el.innerHTML = `<h2>雙極星團雷達<span class="r"><button class="btn sm" id="stP" title="暫停／繼續"></button> <button class="btn sm" id="stG" title="星團設定">⚙</button></span></h2>
    <span class="seg">${STAR_MKTS.map(([k, n]) => `<button data-stm="${k}">${n}</button>`).join('')}</span>
    <canvas id="stC" style="width:100%;display:block;margin-top:6px;cursor:pointer"></canvas>
    <div id="stSt" class="small muted"></div><div id="stSel" class="small" style="margin-top:2px"></div><div id="stEj" class="small" style="margin-top:2px"></div>
    <div id="stL" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px"></div>
    <details class="small muted" style="margin-top:6px"><summary>說明</summary>左＝多方看漲、右＝空方看跌（ETF 為轉弱／回檔）；入選需綜合進場評估達入選分、三環同向達門檻、（可選）K 線訊號同向；已入選者分數不低於剔除分就保留，觸及停損防守價立即移出（30 分鐘內不重新入選）。星點大小＝總排行分，第 1 名在中心；金色光束＝量比達大量門檻。點星點看明細，再點一次開個股頁。資料在這個瀏覽器計算與保存；盤中每 30 秒以最新報價重新評估每一檔（綜合評估、三環、K 線分數與名次即時變動），成員（✓）排前面，其餘名額以候選（綜合評估 ≥ 55 且 K 線不反向）補位並隨每次更新重排，候選不會彈出；非盤中改為盤後排行（依最近收盤評估，✓＝已達入選條件，不影響盤中成員）。僅為依規則計算的視覺化，不代表任何買賣建議。</details>`;
  $$('[data-stm]', el).forEach((b) => b.onclick = () => { starPref().mkt = b.dataset.stm; savePref(); ST.sel = null; starRender(); starTick(); });
  $('#stP', el).onclick = () => { const p = starPref(); p.paused = !p.paused; savePref(); starRender(); if (!p.paused) starTick(); };
  $('#stG', el).onclick = () => starSettings();
  const cv = $('#stC', el);
  cv.onclick = (e) => { const rc = cv.getBoundingClientRect(); const s = ST.eng && ST.eng.pick(e.clientX - rc.left, e.clientY - rc.top);
    if (s && s === ST.sel) { location.hash = '#/s/' + s; return; } ST.sel = s || null; starRender(); };
  return el;
}
/** 總覽頁每次重畫時把常駐的星團卡片搬回新的位置（畫布與動畫不重建） */
function starMount() {
  const host = $('#ovStar'); if (!host) return;
  if (!ST.el) ST.el = starBuild();
  if (ST.el.parentNode !== host) host.appendChild(ST.el);
  const cv = $('#stC', ST.el); cv.style.height = Math.round(Math.max(180, Math.min(560, window.innerHeight * starAnimCfg().height))) + 'px';
  if (!ST.eng || ST.eng.dead) ST.eng = starFx(cv, starSrc);
  if (!ST.loop) { ST.loop = setInterval(starTick, Math.max(2, starAnimCfg().listSec) * 1000); starRender(); starTick(); }
}
/** 星團專屬設定：各市場篩選與排行、動畫與特效（含預覽） */
async function starSettings() {
  const R = {}; STAR_MKTS.forEach(([k]) => { R[k] = starRule(k); }); const an = starAnimCfg(); let m = starMkt(), tab = 0;
  const demo = { bull: [], bear: [], ejects: [], id: 0 };
  const mk = (side, i) => ({ symbol: (side === 'bull' ? 'B' : 'S') + (i + 1), name: '', side, rank: i + 1, final: 95 - i * 6, whale: i === 1, hot: i === 0 && side === 'bull' });
  demo.bull = [0, 1, 2, 3, 4, 5].map((i) => mk('bull', i)); demo.bear = [0, 1, 2, 3, 4].map((i) => mk('bear', i));
  const rg = (o, k, label, min, max, step, unit = '') => `<div class="field" style="margin:6px 0"><label class="small">${label}　<b data-sv="${k}">${o[k]}${unit}</b></label><input type="range" style="width:100%" data-sk="${k}" min="${min}" max="${max}" step="${step}" value="${o[k]}" data-u="${unit}"></div>`;
  const ck = (o, k, label) => `<label class="small" style="display:inline-flex;gap:4px;align-items:center;margin:4px 10px 4px 0"><input type="checkbox" data-sc="${k}" ${o[k] ? 'checked' : ''}>${label}</label>`;
  const sg = (o, k, opts) => `<span class="seg" style="margin:4px 0">${opts.map(([v, t]) => `<button type="button" data-sg="${k}" data-v2="${v}" class="${String(o[k]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</span>`;
  const form = () => { if (tab === 0) { const r = R[m]; return `<div style="margin:6px 0">${sg({ m }, 'm', STAR_MKTS)}</div>
      ${rg(r, 'maxN', '每側顯示上限', 3, 15, 1, ' 檔')}${rg(r, 'minScore', '入選分（綜合評估 ≥）', 50, 95, 1, ' 分')}${rg(r, 'exitScore', '剔除分（低於即移出，需小於入選分）', 30, 94, 1, ' 分')}
      <div class="small" style="margin-top:6px">三環同向門檻</div>${sg(r, 'rings', [[0, '不限'], [1, '1 環'], [2, '2 環'], [3, '3 環']])}<div>${ck(r, 'requireK', '要求 K 線訊號同向')}</div>
      <div class="small" style="margin-top:6px">排行權重（自動正規化）</div>${rg(r, 'wC', '綜合評估', 0, 1, 0.05)}${rg(r, 'wR', '三環強度', 0, 1, 0.05)}${rg(r, 'wK', 'K 線訊號', 0, 1, 0.05)}
      <div class="small" style="margin-top:6px">停損防守價</div>${sg(r, 'stop', STAR_STOPS)}${rg(r, 'pct', '固定 %（其他模式缺資料時也用這個）', 0.5, 15, 0.5, '%')}
      <div class="small muted" style="margin:6px 0">已入選者分數 ≥ 剔除分就保留（緩衝帶防洗榜）；觸及防守價立即移出，30 分鐘內不重新入選。</div><button type="button" class="btn sm" id="stRst">重設此市場</button>`; }
    // 動畫與特效：每個特效一個區塊（標題列可收合、右側開關），區塊內是該特效專屬的細項，各自可回復預設
    const sec = (id, title, sub, body, tg, always = '') => { const on = !tg || an[tg], op = OPEN.has(id);
      return `<div style="border:1px solid var(--border);border-radius:10px;margin:6px 0;overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--card2)"><span data-op="${id}" style="flex:1;cursor:pointer;user-select:none"><b style="font-size:14px">${op ? '▾' : '▸'} ${title}</b> <span class="small muted">${sub}</span></span>
        ${tg ? `<label class="small" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" data-sc="${tg}" data-rb="1" ${on ? 'checked' : ''}>${on ? '開' : '關'}</label>` : ''}</div>
        ${op ? `<div style="padding:4px 10px 8px">${always}${on ? body : '<div class="small muted" style="padding:4px 0">已關閉，開啟後可調整細項</div>'}<div style="text-align:right"><button type="button" class="btn sm" data-rs="${id}">此項回預設</button></div></div>` : ''}</div>`; };
    const STY = Object.fromEntries(STAR_STYLES), EJ = { BURST: '放射爆散', SHATTER: '碎裂淡出', DISSOLVE: '簡單消散' };
    const styBody = an.style === 'GALAXY' ? rg(an, 'density', '恆星數量', 0.3, 1, 0.05) + rg(an, 'galSpin', '旋轉速度', 0, 3, 0.1, '×') + rg(an, 'galBright', '恆星亮度', 0.4, 1.6, 0.05, '×') + rg(an, 'galCore', '核心光芒', 0, 1, 0.05)
      : an.style === 'NEURAL' ? rg(an, 'density', '外圍節點與微塵數量', 0.3, 1, 0.05) + rg(an, 'neuLink', '連線亮度', 0.3, 2.5, 0.1, '×') + rg(an, 'neuPulse', '資料脈衝頻率', 0, 3, 0.1, '×') + rg(an, 'neuDust', '背景微塵亮度', 0, 2.5, 0.1, '×')
      : an.style === 'DUST' ? rg(an, 'density', '光塵數量', 0.3, 1, 0.05) + rg(an, 'dstRise', '上升／下沉速度', 0, 3, 0.1, '×') + rg(an, 'dstTwk', '閃爍程度', 0, 1, 0.05) + rg(an, 'dstBokeh', '近景光斑', 0, 2, 0.1, '×')
      : an.style === 'ORBIT' ? rg(an, 'orbSpd', '公轉速度', 0, 3, 0.1, '×') + rg(an, 'orbTilt', '軌道傾角（越小越扁）', 0.25, 1, 0.05) + rg(an, 'orbLine', '軌道線亮度', 0, 2.5, 0.1, '×')
      : an.style === 'AURORA' ? rg(an, 'aurBands', '光帶數', 1, 5, 1, ' 條') + rg(an, 'aurAmp', '擺動幅度', 0, 2, 0.1, '×') + rg(an, 'aurSpd', '飄動速度', 0, 3, 0.1, '×')
      : an.style === 'HOLE' ? rg(an, 'density', '吸積盤粒子數量', 0.3, 1, 0.05) + rg(an, 'holeSpd', '旋轉速度', 0, 3, 0.1, '×') + rg(an, 'holeTilt', '盤面傾角（越小越扁）', 0.15, 0.7, 0.05) + rg(an, 'holeGlow', '光環亮度', 0, 1.5, 0.05, '×')
      : an.style === 'RADAR' ? rg(an, 'radSpd', '掃描速度', 0.2, 3, 0.1, '×') + rg(an, 'radTrail', '餘暉長度', 0.2, 2.5, 0.1, '×') + rg(an, 'radRings', '同心環數', 2, 6, 1, ' 圈')
      : an.style === 'HIVE' ? rg(an, 'hivSize', '格子大小', 7, 22, 1, ' px') + rg(an, 'hivHeat', '熱度擴散範圍', 0.4, 2.5, 0.1, '×') + rg(an, 'hivPulse', '呼吸起伏', 0, 2.5, 0.1, '×')
      : rg(an, 'clsSpread', '星團擴散範圍', 0.6, 1.25, 0.05, '×') + `<div>${ck(an, 'clsLine', '中間分隔線')}</div>`;
    return `${sec('all', '整體', an.anim ? '速度 ' + an.speed + '×' : '動畫關閉', rg(an, 'speed', '動畫速度', 0.3, 2.5, 0.1, '×') + rg(an, 'height', '雷達高度（畫面比例）', 0.25, 0.7, 0.01) + rg(an, 'listSec', '排行更新間隔', 2, 15, 1, ' 秒') + rg(an, 'scanMin', '盤中重新分析間隔', 1, 15, 1, ' 分'), 'anim')}
      ${sec('style', '星團樣式', STY[an.style], `<div>${sg(an, 'style', STAR_STYLES).replace('style="margin:4px 0"', 'style="margin:4px 0;flex-wrap:wrap"')}</div>` + styBody)}
      ${sec('node', '星點', (an.motion === 'PULSE' ? '能量脈動' : '引力向心') + ' · 標示前 ' + an.labelN + ' 名', rg(an, 'scale', '星點大小', 0.3, 1, 0.05) + `<div class="small" style="margin-top:4px">動態</div>${sg(an, 'motion', [['GRAVITY', '引力向心'], ['PULSE', '能量脈動']])}` + (an.motion === 'PULSE' ? rg(an, 'pulseAmp', '脈動幅度', 0.04, 0.4, 0.02) : '') + rg(an, 'turbulence', '擾動', 0, 1, 0.05) + rg(an, 'labelN', '標示代號的名次', 0, 6, 1, ' 名'))}
      ${sec('eject', '跳離特效', EJ[an.eject], `<div>${sg(an, 'eject', Object.entries(EJ))}</div>` + (an.eject === 'DISSOLVE' ? '' : rg(an, 'ejectAmt', '碎片數量與飛散力道', 0.3, 2.5, 0.1, '×')) + rg(an, 'ejectDur', '持續時間', 0.4, 2.5, 0.1, '×'))}
      ${sec('beam', '大量光束', '量比 ≥ ' + an.whaleX + ' 倍', rg(an, 'beamSec', '光束發射間隔', 0.4, 4, 0.1, ' 秒'), 'whaleBeam', rg(an, 'whaleX', '大量門檻（量比 ≥，也決定金色外環）', 1.2, 5, 0.1, ' 倍'))}
      ${sec('magnet', '磁吸脈衝', '第 1 名外擴波紋', rg(an, 'magSpd', '波紋速度', 0.2, 2, 0.05, '×') + rg(an, 'magR', '擴散範圍', 10, 60, 1, ' px'), 'magnet')}
      ${sec('flow', '多空流向', an.style === 'NEURAL' ? '中樞匯流通道' : '粒子流向較強一側', rg(an, 'flowAmt', '粒子數量', 0.3, 3, 0.1, '×') + rg(an, 'flowSpd', '流動速度', 0.3, 2.5, 0.1, '×'), 'flow')}
      ${sec('haze', '星雲光暈', '兩側底光', rg(an, 'hazeA', '光暈強度', 0.05, 0.6, 0.01) + rg(an, 'hazeR', '光暈範圍', 0.8, 2, 0.05, '×'), 'haze')}
      <div style="text-align:right;margin-top:4px"><button type="button" class="btn sm" data-rs="*">動畫全部回預設</button></div>`; };
  const OPEN = new Set(['style']);
  const RS = { all: ['anim', 'speed', 'height', 'listSec', 'scanMin'], style: ['density', 'galSpin', 'galBright', 'galCore', 'neuLink', 'neuPulse', 'neuDust', 'clsSpread', 'clsLine', 'dstRise', 'dstTwk', 'dstBokeh', 'orbSpd', 'orbTilt', 'orbLine', 'aurBands', 'aurAmp', 'aurSpd', 'holeSpd', 'holeTilt', 'holeGlow', 'radSpd', 'radTrail', 'radRings', 'hivSize', 'hivHeat', 'hivPulse'], node: ['scale', 'motion', 'pulseAmp', 'turbulence', 'labelN'],
    eject: ['eject', 'ejectAmt', 'ejectDur'], beam: ['whaleBeam', 'whaleX', 'beamSec'], magnet: ['magnet', 'magSpd', 'magR'], flow: ['flow', 'flowAmt', 'flowSpd'], haze: ['haze', 'hazeA', 'hazeR'] };
  let eng = null;
  const ok = await dialog('雙極星團雷達設定', `<div style="position:sticky;top:-18px;z-index:3;background:var(--card);padding:2px 0 4px"><canvas id="stPv" style="width:100%;height:170px;display:block;border:1px solid var(--border);border-radius:10px"></canvas>
    <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px"><button type="button" class="btn sm" id="stPf">翻轉多空強弱</button><button type="button" class="btn sm" id="stPw">切換大量</button><button type="button" class="btn sm" id="stPe">預覽跳離</button></div></div>
    <span class="seg" id="stTab" style="margin-top:6px"><button type="button" data-tb="0" class="on">篩選與排行</button><button type="button" data-tb="1">動畫與特效</button></span><div id="stF"></div>`, [['', '取消'], ['ok', '儲存', 'primary']], (root) => {
    const F = $('#stF', root);
    const bind = () => { F.innerHTML = form(); const o = tab === 0 ? R[m] : an;
      $$('[data-sk]', F).forEach((x) => x.oninput = () => { o[x.dataset.sk] = +x.value; const v = $(`[data-sv="${x.dataset.sk}"]`, F); if (v) v.textContent = x.value + (x.dataset.u || ''); });
      $$('[data-sc]', F).forEach((x) => x.onchange = () => { o[x.dataset.sc] = x.checked; if (x.dataset.rb) bind(); });
      $$('[data-op]', F).forEach((x) => x.onclick = () => { const k = x.dataset.op; if (OPEN.has(k)) OPEN.delete(k); else OPEN.add(k); bind(); });
      $$('[data-rs]', F).forEach((x) => x.onclick = () => { const k = x.dataset.rs; (k === '*' ? Object.keys(STAR_ANIM) : RS[k] || []).forEach((q) => { if (q !== 'style') an[q] = STAR_ANIM[q]; }); bind(); });
      $$('[data-sg]', F).forEach((x) => x.onclick = () => { const k = x.dataset.sg, v = x.dataset.v2; if (k === 'm') m = v; else o[k] = k === 'rings' ? +v : v; bind(); });
      const rs = $('#stRst', F); if (rs) rs.onclick = () => { R[m] = starRuleDef(m); bind(); }; };
    $$('[data-tb]', root).forEach((b) => b.onclick = () => { tab = +b.dataset.tb; $$('[data-tb]', root).forEach((x) => x.classList.toggle('on', x === b)); bind(); });
    bind();
    eng = starFx($('#stPv', root), () => ({ bull: demo.bull, bear: demo.bear, anim: { ...an, anim: true }, live: true, paused: false, sel: null, ejects: demo.ejects, right: '空方看跌', busy: false }));
    $('#stPe', root).onclick = () => { const side = Math.random() < 0.5 ? 'bull' : 'bear'; const l = demo[side]; if (!l.length) return; const n = l[l.length - 1];
      demo.ejects.unshift({ id: ++demo.id, e: { symbol: n.symbol, side, forced: true } }); demo[side] = l.slice(0, -1); setTimeout(() => { demo[side] = demo[side].concat([n]); }, 2500); };
    // 翻轉多空強弱（看流向反轉）、切換大量標的（看光束與金色外環）
    $('#stPf', root).onclick = () => { demo.flip = !demo.flip; ['bull', 'bear'].forEach((sd) => { demo[sd] = demo[sd].map((n, i) => ({ ...n, final: (sd === 'bull') !== demo.flip ? 95 - i * 6 : 70 - i * 6 })); }); };
    $('#stPw', root).onclick = () => { demo.wh = !demo.wh; ['bull', 'bear'].forEach((sd) => { demo[sd] = demo[sd].map((n, i) => ({ ...n, whale: demo.wh ? i < 3 : i === 1 && sd === 'bull' })); }); };
    return () => { const r = R[m]; return r.exitScore >= r.minScore ? '剔除分需小於入選分' : null; };
  });
  if (eng) eng.stop();
  if (ok !== 'ok') return;
  const p = starPref(); STAR_MKTS.forEach(([k]) => { p.rules[k] = starSane(R[k]); }); p.anim = { ...an }; savePref();
  clearInterval(ST.loop); ST.loop = 0; STAR_MKTS.forEach(([k]) => starRecompute(k)); starMount(); starRender(); toast('已儲存星團設定');
}
// （網頁版買賣量粒子已移除：使用者指定；App 端 VolumeFlowPanel 不變）
/** #rrggbb（或 rgb()）加透明度 */
function hexA(c, a) {
  c = String(c || '').trim(); a = Math.max(0, Math.min(1, a));
  if (c[0] === '#') { let h = c.slice(1); if (h.length === 3) h = h.split('').map((x) => x + x).join(''); const n = parseInt(h.slice(0, 6), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
  const m = c.match(/\d+(\.\d+)?/g); return m && m.length >= 3 ? `rgba(${m[0]},${m[1]},${m[2]},${a})` : `rgba(128,128,128,${a})`;
}
// ───────── 經典型態（與 App ChartPatterns 相同規則）：頭肩頂底、M 頭 W 底、三角、楔形、旗形、支撐壓力轉換、訂單塊 ─────────
const CP_T = {
  DOUBLE_BOTTOM: ['W 底（雙重底）', true, '進場：收盤站上頸線｜停損：右底下方｜目標：型態高度'],
  DOUBLE_TOP: ['M 頭（雙重頂）', false, '警示：收盤跌破頸線｜防守：最後反彈高點上方｜下看：型態高度'],
  HS_BOTTOM: ['頭肩底', true, '進場：收盤站上頸線｜停損：右肩下方｜目標：頭部到頸線的高度'],
  HS_TOP: ['頭肩頂', false, '警示：收盤跌破頸線｜防守：右肩上方｜下看：頭部到頸線的高度'],
  ASC_TRIANGLE: ['上升三角', true, '進場：收盤突破水平壓力｜停損：最後一個較高低點下方｜目標：三角形高度'],
  DESC_TRIANGLE: ['下降三角', false, '警示：收盤跌破水平支撐｜防守：最後一個較低高點上方｜下看：三角形高度'],
  SYM_TRIANGLE: ['對稱三角', null, '進場：收盤突破上緣（跌破下緣則轉弱）｜停損：最後一個較高低點下方｜目標：三角形高度'],
  FALLING_WEDGE: ['下降楔形', true, '進場：收盤突破楔形上緣｜停損：最後低點下方｜目標：楔形起點高點'],
  RISING_WEDGE: ['上升楔形', false, '警示：收盤跌破楔形下緣｜防守：最後高點上方｜下看：楔形起點低點'],
  BULL_FLAG: ['多頭旗形', true, '進場：收盤突破旗形上緣｜停損：旗形最後低點下方｜目標：旗桿高度'],
  BEAR_FLAG: ['空頭旗形', false, '警示：收盤跌破旗形下緣｜防守：旗形最後高點上方｜下看：旗桿高度'],
  RESIST_FLIP: ['壓力轉支撐', true, '進場：突破後回測舊壓力守住｜停損：回測低點下方｜目標：前波高點'],
  SUPPORT_FLIP: ['支撐轉壓力', false, '警示：跌破後反彈到舊支撐被壓回｜防守：反彈高點上方｜下看：前波低點'],
  ORDER_BLOCK: ['多方訂單塊回測', true, '進場：拉回訂單塊內｜停損：訂單塊下方｜目標：前波高點'],
};
/** 回測參考（台股 30 檔＋美股 7 檔、近 2 年日 K）：突破後 40 根內先到目標的比例與次數 */
const CP_HIST = { DOUBLE_BOTTOM: [75, 116], DOUBLE_TOP: [33, 102], HS_BOTTOM: [47, 32], HS_TOP: [38, 38], ASC_TRIANGLE: [86, 24], DESC_TRIANGLE: [29, 16], SYM_TRIANGLE: [36, 129],
  FALLING_WEDGE: [47, 113], RISING_WEDGE: [23, 148], BULL_FLAG: [43, 208], BEAR_FLAG: [50, 9], RESIST_FLIP: [50, 267], SUPPORT_FLIP: [56, 123], ORDER_BLOCK: [0, 8] };
const CP_BASE = { DOUBLE_BOTTOM: 62, ASC_TRIANGLE: 56, FALLING_WEDGE: 58, HS_BOTTOM: 58, RESIST_FLIP: 58, BULL_FLAG: 56, SYM_TRIANGLE: 52, SUPPORT_FLIP: 52,
  HS_TOP: 54, DOUBLE_TOP: 44, RISING_WEDGE: 40, DESC_TRIANGLE: 46, BEAR_FLAG: 46, ORDER_BLOCK: 44 };
const CP_ST = { F: '成形中・待突破', B: '已突破', R: '突破後回測' };
function cpHistText(t) { const h = CP_HIST[t]; if (!h) return ''; const [w, n] = h; return '回測參考：台美股 37 檔近 2 年出現 ' + n + ' 次，突破後 40 根內先到' + (CP_T[t][1] === false ? '下看' : '') + '目標 ' + w + '%' + (n < 20 ? '（樣本少，僅供參考）' : ''); }
function cpName(p) { return p.type === 'SYM_TRIANGLE' ? CP_T[p.type][0] + (p.bull ? '（向上）' : '（向下）') : CP_T[p.type][0]; }
function cpAction(p, f = fmtPx) {
  if (p.bull) return p.state === 'F' ? `等收盤站上 ${f(p.entry)} 再進場；跌破 ${f(p.stop)} 型態失效。目標 ${f(p.target)}。`
    : p.state === 'B' ? `已收盤突破，可在 ${f(p.entry)} 附近進場，收盤跌破 ${f(p.stop)} 停損，目標 ${f(p.target)}。`
    : `突破後回測守住，可在 ${f(p.entry)} 附近分批，收盤跌破 ${f(p.stop)} 停損，目標 ${f(p.target)}。`;
  return p.state === 'F' ? `接近 ${f(p.entry)}，若收盤跌破，持股者減碼、空手者避開；站上 ${f(p.stop)} 型態失效。`
    : p.state === 'B' ? `已收盤跌破 ${f(p.entry)}，持股者減碼、空手者避開，下看 ${f(p.target)}；站回 ${f(p.stop)} 以上才解除警示。`
    : `反彈到 ${f(p.entry)} 被壓回，持股者趁反彈減碼，下看 ${f(p.target)}；站回 ${f(p.stop)} 以上才解除警示。`;
}
function cpAtr(cs, n = 14) {
  const e = cs.length - 1; if (e < 1) return cs.length ? cs[0].h - cs[0].l : 0;
  const from = Math.max(1, e - n + 1); let s = 0; for (let i = from; i <= e; i++) { const p = cs[i - 1].c; s += Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - p), Math.abs(cs[i].l - p)); } return s / (e - from + 1);
}
/** 波段高低點：左右各 k 根內的極值，再以 minMove 過濾成高低交替 */
function cpPivots(cs, from, k, minMove) {
  const raw = [];
  for (let i = Math.max(from, k); i < cs.length - k; i++) {
    const h = cs[i].h, l = cs[i].l; let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) { if (j === i) continue;
      if (j < i) { if (cs[j].h >= h) isH = false; if (cs[j].l <= l) isL = false; } else { if (cs[j].h > h) isH = false; if (cs[j].l < l) isL = false; } }
    if (isH) raw.push({ i, v: h, high: true }); if (isL) raw.push({ i, v: l, high: false });
  }
  const out = [];
  for (const p of raw) { const last = out[out.length - 1];
    if (!last) out.push(p);
    else if (p.high === last.high) { if ((p.high && p.v > last.v) || (!p.high && p.v < last.v)) out[out.length - 1] = p; }
    else if (Math.abs(p.v - last.v) >= minMove && p.i !== last.i) out.push(p); }
  return out;
}
const cpAvg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const cpRange = (a, b) => { const r = []; for (let k = a; k < b; k++) r.push(k); return r; };
function cpCtx(cs, atr, tick) {
  const n = cs.length, last = cs[n - 1]; const cl = cs.map((x) => x.c);
  const ma = cpAvg(cl.slice(-60)), ma0 = cpAvg(cl.slice(0, -10).slice(-60));
  const up = last.c > ma && ma > ma0, down = last.c < ma && ma < ma0;
  return { cs, n, last, atr, tick, up, down,
    snap(v) { const t = tick(v); return t > 0 ? Math.round(v / t) * t : v; },
    aligned(b) { return b ? up : down; },
    avgVol(j, len = 20) { const f = Math.max(0, j - len); if (j <= f) return 0; let s = 0; for (let k = f; k < j; k++) s += cs[k].v || 0; return s / (j - f); } };
}
function cpClamp(x, bull, entry, stop) { const d = Math.min(3 * x.atr, Math.max(1 * x.atr, Math.abs(entry - stop))); return x.snap(bull ? entry - d : entry + d); }
/** 突破後的共通判斷：狀態、失效、達標、量能、盈虧比與信心分數 */
function cpFinish(x, type, bull, start, lastPivot, level, stop0, target0, segs, marks = [], o = {}) {
  const extra = o.extra || 0; let note = o.note || '';
  if (o.needTrend && !x.aligned(bull)) return null;
  const cs = x.cs, n = x.n; let j = null;
  for (let k = lastPivot + 1; k < n; k++) { const c = cs[k].c; if (bull ? c > level(k) : c < level(k)) { j = k; break; } }
  let state, at;
  if (j == null) {
    const lv = level(n - 1), c = x.last.c;
    const near = bull ? c <= lv && lv - c <= 1.2 * x.atr : c >= lv && c - lv <= 1.2 * x.atr;
    if (!near || lastPivot < n - 40) return null; state = 'F'; at = n - 1;
  } else {
    if (n - 1 - j > 10) return null; at = j; const lvj = level(j);
    let away = null; for (let k = j + 1; k < n; k++) if (bull ? cs[k].h >= lvj + x.atr : cs[k].l <= lvj - x.atr) { away = k; break; }
    let back = false; if (away != null) for (let k = away + 1; k < n; k++) if (bull ? cs[k].l <= lvj + 0.5 * x.atr : cs[k].h >= lvj - 0.5 * x.atr) { back = true; break; }
    state = back && j < n - 1 ? 'R' : 'B';
  }
  const entry = x.snap(state === 'F' ? level(n - 1) + (bull ? 1 : -1) * x.tick(level(n - 1)) : level(at));
  const stop = cpClamp(x, bull, entry, stop0); const target = x.snap(target0(entry));
  if (bull ? stop >= entry || target <= entry : stop <= entry || target >= entry) return null;
  for (let k = lastPivot + 1; k < n; k++) { const c = cs[k];
    if (bull ? c.c < stop0 : c.c > stop0) return null;
    if (k >= at && state !== 'F') { if (bull ? c.c < stop : c.c > stop) return null; if (bull ? c.h >= target : c.l <= target) return null; } }
  const rr = Math.abs(target - entry) / Math.abs(entry - stop); if (rr < 0.8) return null;
  let conf = (CP_BASE[type] || 52) + extra + (state === 'F' ? 0 : state === 'B' ? 8 : 10); let volOk = false;
  if (state !== 'F') { const av = x.avgVol(at); if (av > 0 && (cs[at].v || 0) >= av * 1.3) { conf += 10; volOk = true; } if (o.needVol && !volOk) return null; }
  if (x.aligned(bull)) conf += 6;
  if (rr >= 2) conf += 3; else if (rr < 1.2) conf -= 6;
  if (state !== 'F' && Math.abs(x.last.c - entry) > 1.5 * x.atr) { conf -= 10; note = (note ? note + '；' : '') + '現價已遠離進場點，不追價，等拉回'; }
  return { type, bull, state, start, at, entry, stop, target, rr, conf: Math.max(30, Math.min(92, conf)), segs, marks, box: null, note, volOk };
}
const cpEq = (p) => ({ ...p, segs: p.segs.concat([{ i1: p.at, v1: p.entry, i2: p.at, v2: p.target, kind: 'H', label: '等高' }]) });
function cpDoubles(x, pv) {
  const res = [], cs = x.cs, n = x.n, a = x.atr;
  for (let t = pv.length - 3; t >= Math.max(0, pv.length - 6); t--) {
    const p1 = pv[t], mid = pv[t + 1], p2 = pv[t + 2];
    if (p1.high !== p2.high || mid.high === p1.high) continue;
    if (p2.i < n - 40 || p2.i - p1.i < 6 || p2.i - p1.i > 80) continue;
    if (Math.abs(p1.v - p2.v) > Math.max(0.7 * a, 0.012 * mid.v)) continue;
    const bull = !p1.high; const ext = bull ? Math.min(p1.v, p2.v) : Math.max(p1.v, p2.v); const depth = Math.abs(mid.v - ext);
    if (depth < 2 * a) continue;
    const pre = cpRange(Math.max(0, p1.i - 25), p1.i).map((k) => cs[k].c); if (!pre.length) continue;
    if (bull && Math.max(...pre) < p1.v + depth * 0.7) continue;
    if (!bull && Math.min(...pre) > p1.v - depth * 0.7) continue;
    const neck = mid.v; let stop;
    if (bull) stop = p2.v - 0.2 * a;
    else { let lh = null; for (let k = p2.i + 1; k < n; k++) { if (cs[k].c < neck) break; lh = lh == null ? cs[k].h : Math.max(lh, cs[k].h); } stop = (lh != null && lh < p2.v ? lh : p2.v) + 0.2 * a; }
    const type = bull ? 'DOUBLE_BOTTOM' : 'DOUBLE_TOP';
    const segs = [{ i1: p1.i, v1: p1.v, i2: mid.i, v2: mid.v, kind: 'O' }, { i1: mid.i, v1: mid.v, i2: p2.i, v2: p2.v, kind: 'O' },
      { i1: Math.max(0, p1.i - 3), v1: neck, i2: n - 1, v2: neck, kind: 'L', label: '頸線' }, { i1: p1.i, v1: ext, i2: p1.i, v2: neck, kind: 'H', label: '高度' }];
    const marks = bull ? [{ i: p1.i, v: p1.v, text: '底 1', above: false }, { i: p2.i, v: p2.v, text: '底 2', above: false }] : [{ i: p1.i, v: p1.v, text: '頂 1', above: true }, { i: p2.i, v: p2.v, text: '頂 2', above: true }];
    const sym = 1 - Math.abs(p1.v - p2.v) / Math.max(0.7 * a, 1e-9);
    const p = cpFinish(x, type, bull, p1.i, p2.i, () => neck, stop, (e) => (bull ? e + depth : e - depth), segs, marks, { extra: Math.trunc(sym * 6) });
    if (p) res.push(cpEq(p));
  }
  return res;
}
function cpHS(x, pv) {
  const res = [], cs = x.cs, n = x.n, a = x.atr;
  for (let t = pv.length - 5; t >= Math.max(0, pv.length - 8); t--) {
    if (t < 0) break;
    const s1 = pv[t], n1 = pv[t + 1], hd = pv[t + 2], n2 = pv[t + 3], s2 = pv[t + 4];
    if (s1.high !== hd.high || hd.high !== s2.high || n1.high === s1.high || n2.high === s1.high) continue;
    if (s2.i < n - 40 || s2.i - s1.i > 100) continue;
    const top = s1.high; const sh = top ? Math.max(s1.v, s2.v) : Math.min(s1.v, s2.v);
    if (top && hd.v < sh + 0.5 * a) continue; if (!top && hd.v > sh - 0.5 * a) continue;
    const slope = (n2.v - n1.v) / (n2.i - n1.i); const neck = (k) => n1.v + slope * (k - n1.i);
    const hgt = Math.abs(hd.v - neck(hd.i)); if (hgt < 2 * a) continue;
    if (Math.abs(s1.v - s2.v) > Math.max(a, 0.35 * hgt)) continue;
    const sGap = top ? Math.min(s1.v, s2.v) - Math.max(n1.v, n2.v) : Math.min(n1.v, n2.v) - Math.max(s1.v, s2.v); if (sGap < 0.8 * a) continue;
    if (Math.abs(n2.v - n1.v) > 0.6 * hgt) continue;
    const pre = cpRange(Math.max(0, s1.i - 25), s1.i).map((k) => cs[k].c); if (!pre.length) continue;
    if (top && Math.min(...pre) > n1.v) continue; if (!top && Math.max(...pre) < n1.v) continue;
    const bull = !top; const type = bull ? 'HS_BOTTOM' : 'HS_TOP'; const stop = bull ? s2.v - 0.2 * a : s2.v + 0.2 * a;
    const l0 = Math.max(0, s1.i - 2);
    const segs = [{ i1: s1.i, v1: s1.v, i2: n1.i, v2: n1.v, kind: 'O' }, { i1: n1.i, v1: n1.v, i2: hd.i, v2: hd.v, kind: 'O' }, { i1: hd.i, v1: hd.v, i2: n2.i, v2: n2.v, kind: 'O' }, { i1: n2.i, v1: n2.v, i2: s2.i, v2: s2.v, kind: 'O' },
      { i1: l0, v1: neck(l0), i2: n - 1, v2: neck(n - 1), kind: 'L', label: '頸線' }, { i1: hd.i, v1: hd.v, i2: hd.i, v2: neck(hd.i), kind: 'H', label: '高度' }];
    const marks = [{ i: s1.i, v: s1.v, text: '左肩', above: top }, { i: hd.i, v: hd.v, text: '頭', above: top }, { i: s2.i, v: s2.v, text: '右肩', above: top }];
    const p = cpFinish(x, type, bull, s1.i, s2.i, neck, stop, (e) => (bull ? e + hgt : e - hgt), segs, marks); if (p) res.push(cpEq(p));
  }
  return res;
}
function cpTriangle(x, pv) {
  const cs = x.cs, n = x.n, a = x.atr;
  for (let m = 6; m >= 4; m--) {
    if (pv.length < m) continue;
    const ps = pv.slice(-m); const hs = ps.filter((p) => p.high), ls = ps.filter((p) => !p.high);
    if (hs.length < 2 || ls.length < 2) continue;
    const start = ps[0].i, endP = ps[ps.length - 1].i, span = endP - start;
    if (span < 12 || span > 80 || endP < n - 25) continue;
    const h1 = hs[0], h2 = hs[hs.length - 1], l1 = ls[0], l2 = ls[ls.length - 1];
    const su = (h2.v - h1.v) / (h2.i - h1.i), sl = (l2.v - l1.v) / (l2.i - l1.i);
    const up = (k) => h1.v + su * (k - h1.i), lo = (k) => l1.v + sl * (k - l1.i);
    if (hs.some((p) => p.v > up(p.i) + 0.5 * a) || ls.some((p) => p.v < lo(p.i) - 0.5 * a)) continue;
    const w0 = up(start) - lo(start), w1 = up(endP) - lo(endP);
    if (w0 < 2 * a || w1 <= 0 || w1 > w0 * 0.75) continue;
    const flatU = Math.abs(su) * span <= 0.8 * a, flatL = Math.abs(sl) * span <= 0.8 * a;
    const type = flatU && sl > 0 ? 'ASC_TRIANGLE' : flatL && su < 0 ? 'DESC_TRIANGLE' : su < 0 && sl > 0 ? 'SYM_TRIANGLE' : su > 0 && sl > 0 && sl > su ? 'RISING_WEDGE' : su < 0 && sl < 0 && su < sl ? 'FALLING_WEDGE' : null;
    if (!type) continue;
    const trendUp = cs[start].c >= cs[Math.max(0, start - 30)].c;
    let bull;
    if (type === 'SYM_TRIANGLE') {
      let ju = null, jd = null; for (let k = endP + 1; k < n; k++) { if (ju == null && cs[k].c > up(k)) ju = k; if (jd == null && cs[k].c < lo(k)) jd = k; }
      bull = ju != null && (jd == null || ju < jd) ? true : jd != null ? false : trendUp;
    } else bull = CP_T[type][1];
    let brk = false; for (let k = endP + 1; k < n; k++) if (bull ? cs[k].c > up(k) : cs[k].c < lo(k)) { brk = true; break; }
    if (!brk && up(n - 1) <= lo(n - 1)) continue;
    const stop = bull ? l2.v - 0.2 * a : h2.v + 0.2 * a;
    const target = type === 'FALLING_WEDGE' ? () => h1.v : type === 'RISING_WEDGE' ? () => l1.v : (e) => (bull ? e + w0 : e - w0);
    const e = n - 1;
    const segs = [{ i1: h1.i, v1: h1.v, i2: e, v2: up(e), kind: 'L', label: type === 'ASC_TRIANGLE' ? '壓力' : '上緣' }, { i1: l1.i, v1: l1.v, i2: e, v2: lo(e), kind: 'L', label: type === 'DESC_TRIANGLE' ? '支撐' : '下緣' },
      { i1: start, v1: lo(start), i2: start, v2: up(start), kind: 'H', label: '高度' }];
    const p = cpFinish(x, type, bull, start, endP, (k) => (bull ? up(k) : lo(k)), stop, target, segs, [], { needTrend: type === 'SYM_TRIANGLE' || type === 'DESC_TRIANGLE', needVol: type === 'ASC_TRIANGLE' });
    if (!p) continue;
    return type === 'FALLING_WEDGE' || type === 'RISING_WEDGE' ? p : cpEq(p);
  }
  return null;
}
function cpFlag(x, bull) {
  const cs = x.cs, n = x.n, a = x.atr; let best = null;
  for (let p = n - 20; p <= n - 4; p++) { if (p < 12) continue;
    for (let s = p - 10; s <= p - 3; s++) { if (s < 0) continue;
      const mv = bull ? cs[p].h - cs[s].l : cs[s].h - cs[p].l;
      let ext = true; for (let k = s; k <= p; k++) if (bull ? cs[k].h > cs[p].h : cs[k].l < cs[p].l) { ext = false; break; }
      if (!ext || mv < 4 * a) continue; if (!best || mv > best[2]) best = [s, p, mv]; } }
  if (!best) return null; const [s, p, pole] = best;
  const fit = (idx, v) => { const mx = cpAvg(idx), my = cpAvg(idx.map(v)); let sxx = 0, sxy = 0; idx.forEach((k) => { sxx += (k - mx) ** 2; sxy += (k - mx) * (v(k) - my); }); const b = sxx > 0 ? sxy / sxx : 0; return (k) => my + b * (k - mx); };
  let j = null, fitU = () => 0, fitL = () => 0, bodyEnd = n - 1;
  for (let k = p + 4; k < n; k++) {
    const idx = cpRange(p + 1, k); const u = fit(idx, (q) => cs[q].h), l = fit(idx, (q) => cs[q].l);
    const upM = Math.max(...idx.map((q) => cs[q].h)), dn = Math.min(...idx.map((q) => cs[q].l));
    const brk = bull ? cs[k].c > Math.max(u(k), 0) && cs[k].c > u(k) : cs[k].c < l(k);
    if (brk) { j = k; fitU = (q) => Math.min(u(q), upM); fitL = (q) => Math.max(l(q), dn); bodyEnd = k - 1; break; }
  }
  const idx = cpRange(p + 1, bodyEnd + 1); if (idx.length < 3 || idx.length > 15) return null;
  if (j == null) { fitU = fit(idx, (q) => cs[q].h); fitL = fit(idx, (q) => cs[q].l); }
  const fh = Math.max(...idx.map((q) => cs[q].h)), fl = Math.min(...idx.map((q) => cs[q].l));
  const retr = bull ? cs[p].h - fl : fh - cs[p].l; if (retr > pole * 0.5 || fh - fl > pole * 0.55) return null;
  const slopeU = fitU(bodyEnd) - fitU(p + 1), slopeL = fitL(bodyEnd) - fitL(p + 1);
  if (bull && slopeU > 0.8 * a) return null; if (!bull && slopeL < -0.8 * a) return null;
  const pennant = fitU(p + 1) - fitL(p + 1) > 1.5 * (fitU(bodyEnd) - fitL(bodyEnd));
  const tail = idx.slice(-3); const stop = bull ? Math.min(...tail.map((q) => cs[q].l)) - 0.2 * a : Math.max(...tail.map((q) => cs[q].h)) + 0.2 * a;
  const type = bull ? 'BULL_FLAG' : 'BEAR_FLAG'; const e = n - 1, e2 = Math.min(e, bodyEnd + 2);
  const segs = [{ i1: s, v1: bull ? cs[s].l : cs[s].h, i2: s, v2: bull ? cs[p].h : cs[p].l, kind: 'H', label: '旗桿' },
    { i1: p + 1, v1: fitU(p + 1), i2: e2, v2: fitU(e2), kind: 'L', label: pennant ? '三角旗' : '旗形' }, { i1: p + 1, v1: fitL(p + 1), i2: e2, v2: fitL(e2), kind: 'L' }];
  const fu = fitU, fl2 = fitL; const lv = j != null ? () => (bull ? fu(j) : fl2(j)) : (k) => (bull ? fu(k) : fl2(k));
  const pt = cpFinish(x, type, bull, s, bodyEnd, lv, stop, (en) => (bull ? en + pole : en - pole), segs, [], { note: pennant ? '三角旗（收斂整理）' : '', needTrend: true, needVol: !bull });
  return pt ? cpEq(pt) : null;
}
function cpFlip(x, pv, bull) {
  const cs = x.cs, n = x.n, a = x.atr;
  const touches = pv.filter((p) => p.high === bull && p.i >= n - 90 && p.i < n - 8); let best = null;
  for (const t of touches) { const grp = touches.filter((p) => Math.abs(p.v - t.v) <= 0.5 * a);
    if (grp.length >= 2 && (!best || grp[grp.length - 1].i > best[1][best[1].length - 1].i)) best = [cpAvg(grp.map((p) => p.v)), grp]; }
  if (!best) return null; const [lv, grp] = best; const lastTouch = Math.max(...grp.map((p) => p.i));
  let b = null; for (let k = lastTouch + 1; k < n - 2; k++) if (bull ? cs[k].c > lv + 0.3 * a : cs[k].c < lv - 0.3 * a) { b = k; break; }
  if (b == null || b < n - 40) return null;
  const after = cpRange(b + 1, n); if (after.length < 3) return null;
  let r = null; for (const k of after) if (bull ? cs[k].l <= lv + 0.4 * a : cs[k].h >= lv - 0.4 * a) r = k;
  if (r == null || r < n - 4 || r <= b + 1) return null;
  if (after.some((k) => (bull ? cs[k].c < lv - 0.3 * a : cs[k].c > lv + 0.3 * a))) return null;
  if (bull ? x.last.c < lv : x.last.c > lv) return null;
  const rg = cpRange(b, r + 1); const swing = bull ? Math.max(...rg.map((k) => cs[k].h)) : Math.min(...rg.map((k) => cs[k].l));
  const tl = cpRange(r - 2, n).filter((k) => k > b); const stop = bull ? Math.min(...tl.map((k) => cs[k].l)) - 0.2 * a : Math.max(...tl.map((k) => cs[k].h)) + 0.2 * a;
  const entry = x.snap(lv), target = x.snap(swing), st = cpClamp(x, bull, entry, stop);
  if (bull ? target - entry < a || st >= entry : entry - target < a || st <= entry) return null;
  const rr = Math.abs(target - entry) / Math.abs(entry - st); if (rr < 1) return null;
  const type = bull ? 'RESIST_FLIP' : 'SUPPORT_FLIP'; if (!bull && !x.aligned(false)) return null;
  let conf = (CP_BASE[type] || 55) + 10 + (grp.length >= 3 ? 4 : 0) + (x.aligned(bull) ? 6 : 0);
  const av = x.avgVol(b); const volOk = av > 0 && (cs[b].v || 0) >= av * 1.3; if (volOk) conf += 8; if (rr >= 2) conf += 3;
  const g0 = Math.min(...grp.map((p) => p.i));
  return { type, bull, state: 'R', start: g0, at: r, entry, stop: st, target, rr, conf: Math.max(30, Math.min(90, conf)),
    segs: [{ i1: g0, v1: lv, i2: n - 1, v2: lv, kind: 'L', label: bull ? '舊壓力→支撐' : '舊支撐→壓力' }],
    marks: [{ i: b, v: bull ? cs[b].h : cs[b].l, text: bull ? '突破' : '跌破', above: bull }, { i: r, v: bull ? cs[r].l : cs[r].h, text: '回測', above: !bull }], box: null, note: '', volOk };
}
function cpOrderBlock(x) {
  const cs = x.cs, n = x.n, a = x.atr;
  for (let k = n - 5; k >= n - 30; k--) {
    if (k < 22) break; const ob = cs[k]; if (ob.c >= ob.o) continue;
    let imp = null; for (let q = k + 1; q <= Math.min(n - 1, k + 3); q++) if (cs[q].c >= ob.h + 2 * a) { imp = q; break; } if (imp == null) continue;
    const prevHigh = Math.max(...cpRange(k - 20, k).map((q) => cs[q].h)); if (Math.max(...cpRange(k + 1, imp + 1).map((q) => cs[q].c)) <= prevHigh) continue;
    const rest = cpRange(imp + 1, n); if (rest.length < 2) continue; if (rest.some((q) => cs[q].c < ob.l)) continue;
    let r = null; for (const q of rest) if (cs[q].l <= ob.h) r = q; if (r == null || r < n - 3) continue;
    const ih = Math.max(...cpRange(k + 1, r).map((q) => cs[q].h));
    const entry = x.snap(ob.h), stop = cpClamp(x, true, entry, ob.l - 0.2 * a), target = x.snap(ih);
    if (target - entry < 1.5 * a) continue; const rr = (target - entry) / (entry - stop); if (rr < 1) continue;
    const sweep = Math.min(...cpRange(k - 3, k + 1).map((q) => cs[q].l)) < Math.min(...cpRange(k - 20, k - 3).map((q) => cs[q].l)); if (!sweep) continue;
    let conf = (CP_BASE.ORDER_BLOCK || 54) + 10 + (rr >= 2 ? 3 : 0) + (x.aligned(true) ? 6 : 0);
    const av = x.avgVol(imp); const volOk = av > 0 && (cs[imp].v || 0) >= av * 1.5; if (volOk) conf += 6;
    return { type: 'ORDER_BLOCK', bull: true, state: 'R', start: k, at: r, entry, stop, target, rr, conf: Math.max(30, Math.min(90, conf)),
      segs: [{ i1: k, v1: ih, i2: r, v2: ih, kind: 'L', label: '前高' }], marks: [{ i: r, v: cs[r].l, text: '回測', above: false }],
      box: { i1: k, i2: n - 1, lo: ob.l, hi: ob.h, label: '訂單塊' }, note: '訂單塊前先掃過前低（流動性掃蕩＋訂單塊）', volOk };
  }
  return null;
}
/** 經典型態偵測（近 120 根，最多 4 個；成形中的排後面） */
function chartPatterns(cs, tick = () => 0.01) {
  if (!cs || cs.length < 40) return [];
  const atr = cpAtr(cs); if (!(atr > 0)) return [];
  const x = cpCtx(cs, atr, tick); const pv = cpPivots(cs, Math.max(0, cs.length - 120), 3, atr);
  let out = []; const add = (p) => { if (p) out.push(p); }; const run = (f) => { try { f(); } catch (e) { console.warn('chartPatterns', e); } };
  run(() => cpDoubles(x, pv).forEach(add)); run(() => cpHS(x, pv).forEach(add)); run(() => add(cpTriangle(x, pv)));
  run(() => { add(cpFlag(x, true)); add(cpFlag(x, false)); }); run(() => { add(cpFlip(x, pv, true)); add(cpFlip(x, pv, false)); }); run(() => add(cpOrderBlock(x)));
  const REV = ['HS_TOP', 'HS_BOTTOM', 'DOUBLE_TOP', 'DOUBLE_BOTTOM'], TRI = ['ASC_TRIANGLE', 'DESC_TRIANGLE', 'SYM_TRIANGLE', 'RISING_WEDGE', 'FALLING_WEDGE'];
  const rev = out.filter((p) => REV.includes(p.type)); out = out.filter((p) => !(TRI.includes(p.type) && rev.some((q) => Math.abs(q.at - p.at) <= 3)));
  const by = {}; out.forEach((p) => { const o = by[p.type]; if (!o || p.conf * 1000 + p.at > o.conf * 1000 + o.at) by[p.type] = p; });
  return Object.values(by).sort((a, b) => ((b.state !== 'F') - (a.state !== 'F')) || b.conf - a.conf || b.at - a.at).slice(0, 4)
    .map((p) => ({ ...p, id: 'cp:' + p.type, name: cpName(p) }));
}
/** 經典型態修正進場評估（與 App withPatterns 相同） */
function withPatterns(r, e, pats) {
  const n = r.cs.length; const f = fmtPx; const fresh = (p) => p.state !== 'F' && n - 1 - p.at <= 3 && p.conf >= 68;
  const best = (l) => l.reduce((a, p) => (!a || p.conf > a.conf ? p : a), null);
  const bull = best(pats.filter((p) => p.bull && fresh(p))), bear = best(pats.filter((p) => !p.bull && fresh(p)));
  const tag = (p) => '【' + p.name + '｜' + CP_ST[p.state] + '】' + cpAction(p);
  if (bear && (!bull || bear.conf >= bull.conf)) { if (e.level <= 0) return { ...e, reason: tag(bear) + ' ' + e.reason }; return { label: '觀望', level: 0, reason: tag(bear) + ' ' + e.reason, tip: '減碼，站回 ' + f(bear.stop) + ' 前不加碼' }; }
  if (bull && e.level >= -1 && e.level <= 1 && r.dir !== -2) { let lv = Math.min(2, Math.max(e.level + 1, 1)); if (bull.rr < 1.2) lv = Math.min(lv, 1); return { label: lv >= 2 ? '訊號偏多' : '訊號略偏多', level: lv, reason: tag(bull) + ' ' + e.reason, tip: '續抱，跌破 ' + f(bull.stop) + ' 減碼' }; }
  return e;
}
/** 支撐壓力計畫：近 20 根低點為支撐、高點為壓力（空頭走勢改為持股防守） */
function cpSimplePlan(cs, tick = () => 0.01) {
  if (!cs || cs.length < 15) return null; const a = cpAtr(cs); if (!(a > 0)) return null;
  const x = cpCtx(cs, a, tick); const n = cs.length; const win = cs.slice(-20); const sup = Math.min(...win.map((b) => b.l)), res = Math.max(...win.map((b) => b.h)); const c = cs[n - 1].c;
  const ma = cpAvg(cs.slice(-20).map((b) => b.c)), ma0 = cpAvg(cs.slice(0, -5).slice(-20).map((b) => b.c)); const bear = c < ma && ma < ma0; const from = n - win.length;
  const segs = [{ i1: from, v1: sup, i2: n - 1, v2: sup, kind: 'L', label: '支撐' }, { i1: from, v1: res, i2: n - 1, v2: res, kind: 'L', label: '壓力' }];
  const entry = x.snap(c);
  if (!bear) { const stop = cpClamp(x, true, entry, sup - 0.3 * a); const target = x.snap(res - entry >= a ? res : entry + 2 * (entry - stop)); return cpOv('sr', '支撐壓力計畫・偏多', true, n - 1, entry, stop, target, segs); }
  const stop = cpClamp(x, false, entry, Math.min(res, c + 3 * a) + 0.3 * a); const target = x.snap(entry - sup >= a ? sup : entry - 2 * (stop - entry));
  return cpOv('sr', '支撐壓力計畫・空頭防守', false, n - 1, entry, stop, target, segs);
}
function cpOv(id, title, bull, start, entry, stop, target, segs = [], marks = [], box = null) {
  return { id, title, bull, start, entry, stop, target, segs, marks, box, rr: Math.abs(entry - stop) > 0 ? Math.abs(target - entry) / Math.abs(entry - stop) : 0,
    minIdx: Math.min(start, ...segs.map((s) => Math.min(s.i1, s.i2)), ...marks.map((m) => m.i), ...(box ? [box.i1] : [])),
    prices: [entry, stop, target].concat(segs.flatMap((s) => [s.v1, s.v2]), marks.map((m) => m.v), box ? [box.lo, box.hi] : []) };
}
const KS_SIGID = (s) => 'ks:' + s.st + (s.bull ? '+' : '-');
/** 交易計畫方向（S.pref.planSide：long 做多（預設）／short 做空／auto 依訊號），與 App planSide 相同 */
function kaSide() { return S.pref.planSide || 'long'; }
function kaPick(r) { const sd = kaSide(); return sd === 'short' ? (r.shortPlan || r.plan) : sd === 'auto' ? (r.plan || r.longPlan) : (r.longPlan || r.plan); }
function kaSideHtml() {
  const sd = kaSide(); const b = (v, t) => `<button class="${sd === v ? 'on' : ''}" data-ps="${v}">${t}</button>`;
  return `<div class="seg" style="margin-top:10px">${b('long', '做多計畫')}${b('short', '做空計畫')}${b('auto', '依訊號')}</div>`;
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-ps]'); if (!b) return; S.pref.planSide = b.dataset.ps; savePref(); if (S.kaFocus) S.kaFocus = {}; route(); });
/** 可畫在圖上的交易計畫：經典型態＋K 棒策略訊號＋K 線操作計畫＋支撐壓力（依做多／做空篩選） */
function kaOverlays(r, tick) {
  const n = r.cs.length; const out = (r.pats || []).map((p) => cpOv(p.id, p.name + '・' + CP_ST[p.state], p.bull, p.at, p.entry, p.stop, p.target, p.segs, p.marks, p.box));
  (r.sigs || []).forEach((s) => out.push(cpOv(KS_SIGID(s), KS_ST[s.st] + '・' + KS_STA[s.status], s.bull, Math.max(0, Math.min(n - 1, n - 1 - s.age)), s.entry, s.sl, s.tp1)));
  const p = kaPick(r); if (p) { const e = (p.e0 + p.e1) / 2; const ok = p.bull ? p.stop < e && p.tp1 > e : p.stop > e && p.tp1 < e;
    if (ok) out.push(cpOv('plan', 'K 線操作計畫・' + p.title, p.bull, n - 1, e, p.stop, p.tp1, [{ i1: Math.max(0, n - 20), v1: r.x.support, i2: n - 1, v2: r.x.support, kind: 'L', label: '支撐' }, { i1: Math.max(0, n - 20), v1: r.x.resistance, i2: n - 1, v2: r.x.resistance, kind: 'L', label: '壓力' }])); }
  const sp = cpSimplePlan(r.cs, tick); if (sp) out.push(sp);
  const sd = kaSide(); return sd === 'auto' ? out : out.filter((o) => !!o.bull === (sd === 'long'));
}
/** 目前要畫的計畫：使用者點選的優先，否則取已突破的型態 → 策略訊號 → 成形中的型態 → 操作計畫 */
function kaFocus(sym, r, all) {
  const id = (S.kaFocus || {})[sym];
  if (id === 'off') return null;
  if (id) { const o = all.find((x) => x.id === id); if (o) return o; }
  const pats = r.pats || []; const pick = (pid) => all.find((x) => x.id === pid);
  // 只在符合目前做多／做空選擇的計畫中挑選（all 已依方向篩選）
  const pb = pats.filter((p) => p.state !== 'F').map((p) => pick(p.id)).find(Boolean); if (pb) return pb;
  const sg = (r.sigs || []).map((s2) => pick(KS_SIGID(s2))).find(Boolean); if (sg) return sg;
  return pick('plan') || pats.map((p) => pick(p.id)).find(Boolean) || all[0] || null;
}
/** 圖上交易計畫：獲利區（綠）、風險區（紅）、進場／停損／目標線、型態線段與標記；回傳右側標籤 */
const PLAN_C = { profit: '#2EBD85', risk: '#E5484D', target: '#3B82F6' };
function drawOverlayZones(g, ov, x, y, cw, right) {
  const x0 = Math.max(0, x(ov.start) - cw / 2);
  if (right > x0) { const ye = y(ov.entry), yt = y(ov.target), ys = y(ov.stop);
    g.fillStyle = PLAN_C.profit + '29'; g.fillRect(x0, Math.min(ye, yt), right - x0, Math.abs(yt - ye));
    g.fillStyle = PLAN_C.risk + '29'; g.fillRect(x0, Math.min(ye, ys), right - x0, Math.abs(ys - ye)); }
  if (ov.box) { const b = ov.box; const bx = x(b.i1) - cw / 2; const bw = Math.max(cw, right - bx); const col = ov.bull ? PLAN_C.profit : PLAN_C.risk;
    g.fillStyle = col + '24'; g.fillRect(bx, y(b.hi), bw, y(b.lo) - y(b.hi)); g.strokeStyle = col; g.lineWidth = 1.5; g.strokeRect(bx, y(b.hi), bw, y(b.lo) - y(b.hi)); g.lineWidth = 1; }
}
function drawOverlayLines(g, ov, x, y, cw, right, TXT, MUT) {
  const x0 = Math.max(0, x(ov.start) - cw / 2);
  if (right > x0) { const ln = (v, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y(v)); g.lineTo(right, y(v)); g.stroke(); };
    ln(ov.target, PLAN_C.target, 2); ln(ov.stop, PLAN_C.risk, 2); ln(ov.entry, TXT, 1.5); g.lineWidth = 1; }
  g.font = 'bold 10px sans-serif'; g.textBaseline = 'alphabetic';
  ov.segs.forEach((s) => { const x1 = x(s.i1), y1 = y(s.v1), x2 = x(s.i2), y2 = y(s.v2);
    if (s.kind === 'L') { g.strokeStyle = TXT; g.globalAlpha = 0.85; g.lineWidth = 2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.globalAlpha = 1; }
    else if (s.kind === 'O') { g.strokeStyle = MUT; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]); }
    else { g.strokeStyle = g.fillStyle = PLAN_C.target; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); const up = y2 < y1, ah = 5;
      g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - ah * 0.7, y2 + (up ? ah : -ah)); g.lineTo(x2 + ah * 0.7, y2 + (up ? ah : -ah)); g.closePath(); g.fill(); }
    g.lineWidth = 1;
    if (s.label) { g.fillStyle = s.kind === 'H' ? PLAN_C.target : TXT; g.textAlign = 'left'; g.fillText(s.label, s.kind === 'H' ? x1 + 3 : Math.max(2, x1), s.kind === 'H' ? (y1 + y2) / 2 : y1 - 3); } });
  if (ov.box) { g.fillStyle = ov.bull ? PLAN_C.profit : PLAN_C.risk; g.textAlign = 'left'; g.fillText(ov.box.label, x(ov.box.i1), y(ov.box.lo) + 12); }
  ov.marks.forEach((m) => { g.fillStyle = TXT; g.textAlign = 'center'; g.fillText(m.text, x(m.i), m.above ? y(m.v) - 5 : y(m.v) + 14); });
  g.textAlign = 'start'; g.textBaseline = 'middle'; g.font = '11px sans-serif';
}
/** 把整段 K 棒的索引平移成圖上（切片後）的索引 */
function ovShift(ov, d) {
  if (!ov || !d) return ov; const s = (i) => i - d;
  return { ...ov, start: s(ov.start), minIdx: s(ov.minIdx), segs: ov.segs.map((g) => ({ ...g, i1: s(g.i1), i2: s(g.i2) })), marks: ov.marks.map((m) => ({ ...m, i: s(m.i) })), box: ov.box ? { ...ov.box, i1: s(ov.box.i1), i2: s(ov.box.i2) } : null };
}
const LVC = { 2: 'up', 1: 'up', 0: '', '-1': 'down', '-2': 'down' };
function kaCardHtml(r, weekly, sym, o = {}) {
  const f = fmtPx; const x = r.x; const dc = r.dir > 0 ? 'up' : r.dir < 0 ? 'down' : ''; const n = r.cs.length; const ov = o.ov; const all = o.all || [];
  const hit = (h) => { const st = r.stats[h.k]; const d = KP[h.k][2]; return `<div class="tile" style="margin-top:6px"><div class="row"><b class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}" style="flex:1">${KP[h.k][0]}</b><span class="tag">${KP[h.k][1]}</span><span class="tag ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${DIRL[d]}</span></div>
    <div class="row small muted"><span style="flex:1">${esc(r.cs[h.i].d)}</span><span>可信度 ${Math.round(h.conf * 100)}%</span></div><div class="small text2">${esc(h.note)}</div>
    ${st && st.count >= 2 ? `<div class="small ${st.win >= 0.55 ? 'up' : st.win < 0.45 ? 'down' : 'muted'}">此股歷史出現 ${st.count} 次，${r.forward} 根後符合方向 ${(st.win * 100).toFixed(0)}%，平均 ${(st.avg >= 0 ? '+' : '') + st.avg.toFixed(2)}%</div>` : ''}</div>`; };
  const older = r.recent.filter((h) => h.i < n - 3).sort((a, b) => b.i - a.i);
  const p = kaPick(r); const e = r.entry; const ec = LVC[e.level] || '';
  const pill = (t, bull) => `<span class="cp-pill ${bull ? 'up' : 'down'}">${t}</span>`;
  const selSt = (id) => (ov && ov.id === id ? 'border-color:' + PLAN_C.target + ';box-shadow:0 0 0 1px ' + PLAN_C.target : '');
  const sigHtml = !r.sigs ? '' : `<div class="tile" style="margin-top:10px"><div class="row"><b style="flex:1">K 棒策略訊號</b><span class="tag" style="color:var(--primary);border-color:var(--primary)">${r.etf ? 'ETF 引擎' : '普通股引擎'}</span></div>
    <div class="small muted">${r.etf ? '偵測：母子線壓縮突破、上升三法中繼、恐慌大跌末端止跌、竭盡缺口回補' : '偵測：流動性掃蕩（SFP）、突破＋缺口回踩、箱型爆量突破、關鍵均線吞噬'}</div>
    ${r.sigs.length ? r.sigs.map((s) => { const id = KS_SIGID(s); const on = ov && ov.id === id; return `<div class="card cp-it" data-ovpick="${id}" style="${selSt(id)}">
      <div class="row">${pill(s.bull ? '做多' : '偏空', s.bull)}<b style="flex:1;margin-left:6px">${KS_ST[s.st]}</b><span class="small" style="color:${s.status === 'WAITING' ? '#F2B544' : 'var(--text2)'}">${KS_STA[s.status]}${s.age ? '（' + s.age + ' 根前）' : ''}</span><b class="small ${s.bull ? 'up' : 'down'}" style="margin-left:8px">信心 ${s.conf}</b></div>
      <div class="small text2" style="margin-top:4px"><span class="tag" style="color:var(--primary);border-color:var(--primary)">${KS_TM[s.tm][0]}</span> 進場 ${f(s.entry)} · 停損 ${f(s.sl)} · 目標 ${f(s.tp1)}${s.tp2 ? '／' + f(s.tp2) : ''} · 風報比 1:${s.rr.toFixed(1)}</div>
      <div class="small" style="margin-top:4px">${esc(s.desc)}</div>
      ${on ? `<div class="small text2" style="margin-top:4px">型態：${esc(s.pattern)}</div><div class="small muted">時機說明：${KS_TM[s.tm][1]}</div>${s.trailing ? `<div class="small muted">${esc(s.trailing)}</div>` : ''}` : '<div class="small muted" style="margin-top:2px">點一下看型態說明，並在圖上顯示交易計畫</div>'}</div>`; }).join('') : '<div class="small muted" style="margin-top:4px">近期沒有符合條件的策略訊號。</div>'}</div>`;
  const pats = r.pats;
  const patHtml = !pats ? '' : `<div class="tile" style="margin-top:10px"><div class="row"><b style="flex:1">經典型態</b><span class="small muted">近 120 根</span></div>
    <div class="small muted">偵測：頭肩頂／頭肩底、M 頭／W 底、三角、楔形、旗形、支撐壓力轉換、訂單塊。點選可在圖上顯示進場、停損與目標。</div>
    ${pats.length ? pats.map((q) => { const on = ov && ov.id === q.id; return `<div class="card cp-it" data-ovpick="${q.id}" style="${selSt(q.id)}">
      <div class="row">${pill(q.bull ? '偏多' : '警示', q.bull)}<b style="flex:1;margin-left:6px">${esc(q.name)}</b><span class="small" style="color:${q.state === 'F' ? '#F2B544' : 'var(--text2)'}">${CP_ST[q.state]}</span><b class="small ${q.bull ? 'up' : 'down'}" style="margin-left:8px">信心 ${q.conf}</b></div>
      <div class="small text2" style="margin-top:4px">${q.bull ? '進場' : '關鍵'} ${f(q.entry)} · ${q.bull ? '停損' : '防守'} ${f(q.stop)} · ${q.bull ? '目標' : '下看'} ${f(q.target)} · 盈虧比 1:${q.rr.toFixed(1)}</div>
      <div class="small" style="margin-top:4px">${esc(cpAction(q))}</div>
      ${on ? `<div class="small muted" style="margin-top:2px">${esc(CP_T[q.type][2])}</div><div class="small muted">${esc(cpHistText(q.type))}</div><div class="small muted">${q.volOk ? '突破帶量' : q.state === 'F' ? '尚未突破' : '突破量能普通'}</div>${q.note ? `<div class="small muted">${esc(q.note)}</div>` : ''}` : ''}</div>`; }).join('') : '<div class="small muted" style="margin-top:4px">近期沒有成形或剛突破的經典型態。</div>'}
    ${pats.some((q) => !q.bull) ? '<div class="small muted" style="margin-top:6px">台股以持股減碼／避開為主，不建議放空。</div>' : ''}</div>`;
  const legend = ov ? `<div class="row small" style="margin-top:4px;gap:6px;flex-wrap:wrap"><span style="color:${PLAN_C.profit}">■</span> 獲利區 <span style="color:${PLAN_C.risk}">■</span> 風險區 <span class="muted" style="flex:1">· ${esc(ov.title)} · 盈虧比 1:${ov.rr.toFixed(1)}</span>
      ${all.length > 1 ? `<select data-ovsel style="width:auto;padding:2px 6px;font-size:12px">${all.map((a) => `<option value="${esc(a.id)}" ${a.id === ov.id ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select>` : ''}<a href="javascript:void 0" data-ovoff style="color:var(--primary)">隱藏</a></div>`
    : `<div class="row small muted" style="margin-top:4px"><span style="flex:1">▲ 偏多　▼ 偏空（K 線形態）</span>${all.length ? '<a href="javascript:void 0" data-ovon style="color:var(--primary)">顯示交易計畫</a>' : ''}</div>`;
  return `<h2>K 線形態分析<span class="r"><span class="seg" id="kaTf"><button data-tf="d" class="${weekly ? '' : 'on'}">日 K</button><button data-tf="w" class="${weekly ? 'on' : ''}">週 K</button></span></span></h2>
    <div class="row wrap" style="gap:10px;align-items:center"><span class="small muted">${weekly ? '週 K' : '日 K'}綜合訊號</span><span class="badge ${dc}" style="font-size:15px;padding:4px 10px">${DIRL[r.dir]}</span><span class="small muted">多空強度 ${r.strength}</span></div>
    <div class="tile" style="margin-top:10px;background:${css(ec === 'up' ? '--up' : ec === 'down' ? '--down' : '--muted')}1a"><div class="row" style="align-items:flex-start;gap:10px"><div class="sp"><div class="small muted">K 線觀點（綜合建議見「分析」分頁）</div><div class="small text2" style="margin-top:2px">${esc(e.reason)}</div>${o.held ? `<div class="small" style="margin-top:2px"><b>已持有：${esc(e.tip)}</b></div>` : `<div class="small muted" style="margin-top:2px">持股者：${esc(e.tip)}</div>`}</div><span class="badge ${ec}" style="font-size:15px;padding:5px 12px;white-space:nowrap">${esc(e.label)}</span></div></div>
    ${sigHtml}${patHtml}
    <div class="bar" style="margin-top:10px"><div style="width:${r.strength}%;background:${css(r.dir >= 0 ? '--up' : '--down')}"></div></div>
    <div class="row small muted"><span style="flex:1">偏空</span><span style="flex:1;text-align:center">中性</span><span style="flex:1;text-align:right">偏多</span></div>
    <div class="row wrap" style="gap:6px;margin-top:6px"><span class="tag ${x.trend === 1 ? 'up' : x.trend === -1 ? 'down' : ''}">${x.trend === 1 ? '多頭趨勢' : x.trend === -1 ? '空頭趨勢' : '盤整'}</span><span class="tag">${KVOL[x.vol]}</span><span class="tag">${KLOC[x.loc]}</span></div>
    <div class="grid g4" style="margin-top:10px;gap:8px">${[['支撐', f(x.support), 'up'], ['壓力', f(x.resistance), 'down'], ['MA20', f(x.ma20), ''], ['ATR(14)', f(x.atr), '']].map(([k, v, c]) => `<div><div class="small muted">${k}</div><div class="num ${c}">${v}</div></div>`).join('')}</div>
    <div class="chart-wrap" id="kaChart" style="margin-top:10px"><canvas></canvas><div class="chart-tip"></div></div>${legend}
    <div style="margin-top:10px"><b>最新形態（近 3 根）</b>${r.latest.length ? Array.from(new Map(r.latest.map((h) => [h.k + h.i, h])).values()).map(hit).join('') : '<div class="small muted">近 3 根沒有明顯的 K 線形態，以趨勢與量價為主。</div>'}</div>
    <div class="tile" style="margin-top:10px"><b>判斷依據</b>${r.reasons.map((t) => `<div class="small text2">・${esc(t)}</div>`).join('')}</div>
    ${kaSideHtml()}${p ? `<div class="tile" style="margin-top:10px;background:${css(p.bull ? '--up' : '--down')}14"><div class="row"><b class="${p.bull ? 'up' : 'down'}" style="flex:1">${esc(p.title)}</b><span class="small muted">盈虧比</span> <b class="num ${p.rr >= 2 ? 'up' : p.rr < 1.2 ? 'down' : ''}">1 : ${p.rr.toFixed(2)}</b></div>
      <div class="small text2" style="margin-top:4px">${esc(p.trigger)}</div>${kvRows([[p.bull ? '布局區間' : '減碼區間', f(p.e0) + ' ～ ' + f(p.e1)], ['停損／防守', f(p.stop)], ['目標一', f(p.tp1)], ['目標二', f(p.tp2)]])}<div class="small muted">${esc(p.note)}</div></div>`
      : '<div class="small muted" style="margin-top:8px">訊號中性：建議觀望，等待帶量突破壓力或跌破支撐再決定方向。</div>'}
    ${older.length ? `<details style="margin-top:8px"><summary class="small" style="cursor:pointer;color:var(--primary)">近 40 根其他形態（${older.length}）</summary>${older.map(hit).join('')}</details>` : ''}
    <div class="small muted" style="margin-top:6px">形態辨識依據 K 棒實體、影線、前趨勢、量能與前 20 根高低點；勝率為此股過去 ${weekly ? '5 年週 K' : '2 年日 K'} 同形態出現後 ${r.forward} 根的結果。經典型態回測為台美股 37 檔近 2 年統計。僅為分析成果，不構成投資建議；投資有風險，請自行評估並自負盈虧。</div>`;
}
function ksCardHtml(sigs, etf) {
  const f = fmtPx;
  return `<h2>K 棒策略訊號<span class="r small muted">${etf ? 'ETF 策略：母子線、上升三法、恐慌止跌、缺口回補' : '普通股策略：SFP、BOS／FVG、箱型突破、均線吞噬'}</span></h2>
    ${sigs.length ? sigs.map((s) => `<div class="tile" style="margin-top:8px;border-left:3px solid ${css(s.bull ? '--up' : '--down')}">
      <div class="row wrap"><b class="${s.bull ? 'up' : 'down'}" style="flex:1">${KS_ST[s.st]}</b><span class="tag ${s.bull ? 'up' : 'down'}">${s.bull ? '做多' : '偏空／減碼'}</span><span class="tag">${KS_STA[s.status]}${s.age ? '（' + s.age + ' 日前）' : ''}</span><span class="tag">信心 ${s.conf}</span></div>
      <div class="small text2" style="margin-top:4px">${esc(s.pattern)}</div>
      <div class="grid g4" style="margin-top:6px;gap:6px">${[['進場', f(s.entry)], ['停損', f(s.sl)], ['停利', f(s.tp1) + (s.tp2 ? '／' + f(s.tp2) : '')], ['風報比', '1 : ' + s.rr.toFixed(2)]].map(([k, v]) => `<div><div class="small muted">${k}</div><div class="num">${v}</div></div>`).join('')}</div>
      <div class="small" style="margin-top:6px"><span class="tag">${KS_TM[s.tm][0]}</span> ${esc(s.desc)}</div><div class="small muted">${KS_TM[s.tm][1]}</div>${s.trailing ? `<div class="small muted">${esc(s.trailing)}</div>` : ''}</div>`).join('')
      : '<div class="small muted">近 3 日沒有成立中的策略訊號（已跌破停損的訊號自動排除）。</div>'}
    <div class="small muted" style="margin-top:6px">每個訊號附進場時機、停損、停利與風報比；成立後收盤跌破停損即失效。僅為分析成果，不構成投資建議；投資有風險，請自行評估並自負盈虧。</div>`;
}
function iaCardHtml(a) {
  const col = a.score >= 58 ? 'up' : a.score < 45 ? 'down' : ''; const v = a.verdict;
  return `<h2>投資分析指數<span class="r tag ${col}">${esc(a.label)}</span></h2>
    <div class="row" style="gap:16px;align-items:center"><div class="num ${col}" style="font-size:38px;font-weight:800">${a.score}</div><div class="sp"><div class="bar"><div style="width:${a.score}%;background:${css(a.score >= 50 ? '--up' : '--down')}"></div></div><div class="small text2" style="margin-top:6px">${esc(a.advice)}</div></div></div>
    <div class="tile" style="margin-top:10px;border-left:3px solid ${css(v.tone > 0 ? '--up' : v.tone < 0 ? '--down' : '--muted')}"><div class="row"><b class="${v.tone > 0 ? 'up' : v.tone < 0 ? 'down' : ''}" style="flex:1;font-size:15px">${esc(v.title)}</b><span class="small muted">模型試算 ${v.ratio}%</span></div><div class="small text2">${esc(v.reason)}</div></div>
    <div class="scroll-x" style="margin-top:10px"><table class="tbl"><thead><tr><th style="text-align:left">因子</th><th>分數</th><th>權重</th><th style="text-align:left">依據</th></tr></thead><tbody>${a.factors.map((x) => `<tr><td style="text-align:left">${esc(x.name)}</td><td class="num ${x.score >= 58 ? 'up' : x.score < 45 ? 'down' : ''}">${x.score}</td><td class="num">${x.weight}</td><td class="small" style="text-align:left;white-space:normal">${esc(x.note)}</td></tr>`).join('')}</tbody></table></div>
    ${a.analyst ? `<div class="small muted" style="margin-top:6px">分析師：${esc(a.analyst.rating || '—')}　目標價 ${fmtPx(a.analyst.target)}（${fmtPx(a.analyst.low)}～${fmtPx(a.analyst.high)}）</div>` : ''}
    <div class="small muted" style="margin-top:6px">${a.isEtf ? 'ETF 依趨勢、動能、52 週位置、法人籌碼、配息與填息、流動性、規模費用、折溢價、大盤環境與波動度計算' : '依趨勢、動能、估值、52 週位置、法人籌碼、分析師、大盤環境與波動度計算'}的參考分數，缺資料的項目不計入。僅為分析成果，不構成投資建議；投資有風險，請自行評估並自負盈虧。</div>`;
}
function voCardHtml(v, plan) {
  const c = v.regime >= 1.25 ? 'down' : v.regime <= 0.7 ? 'up' : '';
  return `<h2>波動<span class="r tag ${c}">${esc(v.label)}</span></h2>
    <div class="grid g3" style="gap:8px">${[['近 20 日年化波動', v.annual.toFixed(0) + '%'], ['一年中位數', v.med.toFixed(0) + '%（目前 ×' + v.regime.toFixed(1) + '）'], ['ATR(14)／股價', v.atrPct.toFixed(2) + '%（每日平均振幅）']].map(([k, x]) => `<div class="tile"><div class="k">${k}</div><div class="num" style="font-size:16px;font-weight:700;margin-top:4px">${x}</div></div>`).join('')}</div>
    <div class="chart-wrap" id="voChart" style="margin-top:10px"><canvas></canvas><div class="chart-tip"></div></div>
    ${v.regime > 1 ? '<div class="small text2" style="margin-top:6px">波動越大，建議投入比例越低（綜合進場評估已自動打折）。</div>' : ''}
    ${plan ? `<div style="margin-top:8px"><b>操作參考（日 K）</b>${kvRows([['布局區間', fmtPx(plan.e0) + ' ～ ' + fmtPx(plan.e1)], ['停損', fmtPx(plan.stop)], ['目標一／二', fmtPx(plan.tp1) + ' ／ ' + fmtPx(plan.tp2)]])}</div>` : ''}
    <div class="small muted" style="margin-top:6px">年化波動＝近 20 日日報酬標準差 × √250；倍數為目前波動相對近一年中位數。</div>`;
}

// ───────── 登入 ─────────
function loginView(msg, mode) {
  const p = S.policy; mode = mode || store.get('lmode', 'login');
  const tr = p.trialDays > 0 ? `註冊即可試用 ${p.trialDays} 天（${esc(p.trialName || 'USER')}）` : '註冊後即可使用基本功能';
  $('#app').innerHTML = `<div class="login"><div class="box"><div class="logo" style="margin:0 auto">台</div><h1>台美股資產 網頁版</h1>
    <div class="seg" style="margin:12px auto 0;display:inline-flex"><button data-lm="login" class="${mode === 'login' ? 'on' : ''}">登入</button><button data-lm="reg" class="${mode === 'reg' ? 'on' : ''}">註冊新帳號</button></div>
    ${msg ? `<div class="notice err" style="margin-top:14px">${esc(msg)}</div>` : ''}
    ${mode === 'reg' ? `<div class="text2" style="margin-top:12px">${tr}，用 Google 帳號一鍵建立會員（不需手機 App）</div>
      <div class="steps" style="text-align:left;margin:14px auto 0;max-width:330px">${[['1', '同意使用條款', '勾選下方同意事項'], ['2', 'Google 帳號驗證', '不需另設密碼，帳號即會員身分'], ['3', '填寫暱稱與聯絡方式', '方便管理員開通與聯繫'], ['4', '開始使用', '不需要手機也能使用；之後下載 App 用同一帳號登入即可綁定同步']].map(([n, t, d]) => `<div class="row" style="gap:10px;margin-bottom:8px;align-items:flex-start"><span class="badge" style="min-width:22px;text-align:center">${n}</span><div><b>${t}</b><div class="small muted">${d}</div></div></div>`).join('')}</div>
      <label class="row small" style="justify-content:center;margin-top:10px;cursor:pointer"><input type="checkbox" id="agree" style="width:auto" ${store.get('agree', false) ? 'checked' : ''}> 我已閱讀並同意<a href="/web/risk.html" target="_blank" rel="noopener">投資風險告知書</a>、<a href="/web/terms.html" target="_blank" rel="noopener">使用者條款</a>與<a href="/web/privacy.html" target="_blank" rel="noopener">隱私權政策</a>（含個人資料蒐集目的與境外儲存），同意以 Google 帳號識別會員身分，並了解本服務內容僅供參考、不構成投資建議</label>`
    : `<div class="text2" style="margin-top:12px">用註冊時的 Google 帳號登入（與手機 App 相同帳號）</div>
      <div class="feat"><div>📈 自選行情牆、指數、今日漲跌停</div><div>💼 持股損益、資產配置、交易記帳</div><div>📊 個股 K 線、進場評估、籌碼與財務</div><div>🔄 與手機 App 自動同步</div></div>`}
    ${QR_HINT ? `<div class="notice" style="margin-top:14px;text-align:left">這是電腦登入用的 QR Code：請打開手機「台美股資產」App › 會員 › 帳號與同步 ›「掃描登入網頁版」來掃描，不是用相機開啟。</div>` : ''}
    <div id="gbtn" class="gbtn" style="margin-top:14px">${p.gClient || MOCK ? '' : '<div class="notice">管理員尚未開放網頁登入（Google 登入未設定）。</div>'}</div>
    ${mode === 'login' ? `<div style="margin-top:12px"><button class="btn" id="qrBtn" style="min-width:280px">📱 用 App 掃描登入</button><div class="small muted" style="margin-top:4px">手機 App 已登入帳號時，掃描 QR Code 即可登入，免在電腦輸入 Google 帳號</div></div>` : ''}
    <div id="lerr" class="small up" style="margin-top:10px"></div>
    <div class="small" style="margin-top:8px"><a href="/web/risk.html" target="_blank" rel="noopener">投資風險告知書</a>・<a href="/web/privacy.html" target="_blank" rel="noopener">隱私權政策</a>・<a href="/web/terms.html" target="_blank" rel="noopener">使用者條款</a>・<a href="/web/notice.html" target="_blank" rel="noopener">資料來源與授權</a></div>
    <div class="small muted" style="margin-top:18px">${mode === 'reg' ? '已經在手機 App 用 Google 登入過？直接按「登入」即可，不需重新註冊。' : '還沒有帳號？按上方「註冊新帳號」。'}同一帳號網頁同時只能在一個瀏覽器使用。</div>${webVerHtml()}</div></div>`;
  $$('[data-lm]').forEach((b) => b.onclick = () => { store.set('lmode', b.dataset.lm); loginView('', b.dataset.lm); });
  const ready = () => mode !== 'reg' || ($('#agree') && $('#agree').checked);
  const cb = (resp) => onCredential(resp, mode === 'reg');
  const showBtn = () => {
    if (!ready()) { $('#gbtn').innerHTML = '<div class="small muted">請先勾選同意事項</div>'; return; }
    if (MOCK) { $('#gbtn').innerHTML = `<button class="btn primary" id="mk">${mode === 'reg' ? '測試註冊' : '測試登入'}</button>`; $('#mk').onclick = () => cb({ credential: 'mock' }); return; }
    if (!p.gClient) return;
    const init = () => { $('#gbtn').innerHTML = '';
      google.accounts.id.initialize({ client_id: p.gClient, callback: cb, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true });
      google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_blue', size: 'large', text: mode === 'reg' ? 'signup_with' : 'signin_with', shape: 'pill', locale: 'zh-TW', width: 280 }); };
    if (window.google && google.accounts) init();
    else { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = init; sc.onerror = () => { $('#lerr').textContent = '無法載入 Google 登入，請檢查網路或關閉阻擋程式。'; }; document.head.appendChild(sc); }
  };
  if ($('#agree')) $('#agree').onchange = (e) => { store.set('agree', e.target.checked); showBtn(); };
  if ($('#qrBtn')) $('#qrBtn').onclick = () => qrLogin();
  showBtn();
}
// 用相機掃到登入 QR Code 而開啟網頁時（網址帶 ?qr=）顯示提示，並把網址清乾淨
const QR_HINT = /[?&]qr=/.test(location.search);
if (QR_HINT) try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
/** 瀏覽器簡述（顯示在手機確認畫面，讓使用者辨認是哪台電腦） */
function uaText() {
  const u = navigator.userAgent;
  const b = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : '瀏覽器';
  const o = /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) && !/Mobile/.test(u) ? 'macOS' : /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Linux/.test(u) ? 'Linux' : '';
  return b + (o ? ' · ' + o : '') + ' · ' + new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
}
/** 產生 QR Code（SVG）：使用 qrcode-generator（jsDelivr），載入失敗時用 QR 圖片服務備援 */
async function qrSvg(text, px = 220) {
  try {
    if (!window.qrcode) await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), cell = Math.max(2, Math.floor(px / (n + 4)));
    return q.createSvgTag({ cellSize: cell, margin: cell * 2, scalable: true });
  } catch (e) {
    return `<img alt="QR Code" width="${px}" height="${px}" src="https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&margin=8&data=${encodeURIComponent(text)}">`;
  }
}
/** 用 App 掃描登入：網頁取得一次性代碼 → 顯示 QR Code 與確認碼 → 輪詢等手機確認 → 取得網頁工作階段 */
async function qrLogin() {
  let alive = true, timer = 0;
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" style="text-align:center;max-width:360px"><h3>用 App 掃描登入</h3><div class="mb" id="qrB"><div class="small muted">產生中…</div></div><div class="acts"><button class="btn" data-x>取消</button></div></div>`;
  document.body.appendChild(bg);
  const close = () => { alive = false; clearTimeout(timer); bg.remove(); };
  $('[data-x]', bg).onclick = close; bg.onclick = (e) => { if (e.target === bg) close(); };
  const box = $('#qrB', bg);
  const make = async () => {
    let r;
    try { r = await api('qrNew', { ua: uaText() }); }
    catch (e) { box.innerHTML = `<div class="notice err">${esc(/未知動作|驗證失敗/.test(e.message) ? '管理員的會員伺服器需要更新到第 11 版才能掃描登入，請先用 Google 帳號登入。' : e.message)}</div>`; return; }
    if (!alive) return;
    const url = location.origin + '/web?qr=' + r.id; const end = Date.now() + (r.ttl || 180) * 1000;
    box.innerHTML = `<div class="qrbox" style="background:#fff;border-radius:12px;padding:10px;display:inline-block;width:240px;height:240px">${await qrSvg(url, 220)}</div>
      <div class="row" style="justify-content:center;gap:8px;margin-top:10px;align-items:baseline"><span class="small text2">確認碼</span><b class="num" style="font-size:28px;color:var(--primary)">${esc(r.code)}</b></div>
      <div class="small text2" id="qrSt" style="margin-top:6px">打開手機「台美股資產」App › 會員 › 帳號與同步 ›「掃描登入網頁版」，掃描後確認手機上的確認碼相同再按「確認登入」。</div>
      <div class="small muted" id="qrT" style="margin-top:6px"></div>`;
    const svg = $('svg', box); if (svg) { svg.setAttribute('width', '220'); svg.setAttribute('height', '220'); }
    const poll = async () => {
      if (!alive) return;
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      if ($('#qrT', bg)) $('#qrT', bg).textContent = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 後失效` : '';
      if (!left) { box.innerHTML = `<div class="small text2">QR Code 已失效</div><button class="btn primary" id="qrRe" style="margin-top:10px">重新產生</button>`; $('#qrRe', bg).onclick = () => { box.innerHTML = '<div class="small muted">產生中…</div>'; make(); }; return; }
      let p = null; try { p = await api('qrPoll', { id: r.id, key: r.key }); } catch (e) {}
      if (!alive) return;
      if (p && p.st === 'ok' && p.session) { close(); toast('已用手機 App 登入', 3000); await loginWith(p, false); return; }
      if (p && p.st === 'deny') { box.innerHTML = `<div class="notice err">手機上已拒絕這次登入。</div><button class="btn primary" id="qrRe" style="margin-top:10px">重新產生</button>`; $('#qrRe', bg).onclick = () => { box.innerHTML = '<div class="small muted">產生中…</div>'; make(); }; return; }
      if (p && p.st === 'expired') { timer = setTimeout(poll, 0); return; }
      if (p && p.scanned && $('#qrSt', bg)) { $('#qrSt', bg).innerHTML = '<b class="up">✓ 手機已掃描</b>，請在手機上確認確認碼並按「確認登入」。'; }
      timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1500);
  };
  make();
}
async function onCredential(resp, reg) {
  $('#lerr').textContent = reg ? '註冊中…' : '登入中…';
  try {
    const r = await api('login', { idToken: resp.credential, web: true, version: 'web', trialStart: dayNum(), register: !!reg, ref: store.get('ref', '') });
    store.del('ref');
    if (!r.session) throw new Error('伺服器未回傳登入資訊（請管理員更新雲端伺服器程式為第 4 版）');
    await loginWith(r, reg);
  } catch (e) {
    if (e.data && e.data.pendingDelete) { $('#lerr').textContent = ''; return restoreModal(e.data); }
    if (e.data && e.data.full) { $('#lerr').textContent = ''; return dialog(e.data.waitlisted ? '已登記候補' : '名額已滿', `<div class="small text2" style="line-height:1.7">${esc(e.message)}</div>`, [['', '確定', 'primary']]); }
    $('#lerr').textContent = e.message === '裝置碼錯誤' ? '雲端會員伺服器版本過舊（需第 4 版），請管理員更新 Apps Script 程式碼後重新部署。' : e.message; }
}
/** 取得網頁工作階段後（Google 登入或 App 掃描登入）：保存並進入 */
async function loginWith(r, reg) {
  {
    S.session = r.session; store.set('session', r.session);
    // 換帳號登入：清除上一個帳號的本機資料
    if (store.get('no', '') !== r.no) { S.keys = {}; S.rev = 0; S.dirty = false; store.del('keys'); store.set('rev', 0); store.set('dirty', false); }
    // 換成別的帳號：上一個帳號留在這個瀏覽器的 API 金鑰不沿用
    const kno = store.get('aikNo', ''); if (kno && kno !== r.no) { store.del('aik'); store.del('aic'); store.del('aikNo'); }
    if (!kno && Object.keys(store.get('aik', {})).length) store.set('aikNo', r.no);
    store.set('no', r.no); store.set('lmode', 'login');
    if (reg && !r.isNew && r.serverVersion) toast('這個 Google 帳號已經註冊過，已直接登入', 4000);
    await start(r);
    if (r.isNew || (r.serverVersion >= 5 && !r.contact && !store.get('profSkip', false))) setTimeout(() => onboarding(r.isNew), 600);
  }
}

/** 會員自助刪除帳號：輸入會員代號確認 → 伺服器清除個資與雲端資料 → 本機登出 */
/** 會員中心「使用期限」：等級、起算日、到期日、剩餘天數 */
function termHtml(m, me) {
  const c = S.code; const rows = [];
  if (m.status === 'TRIAL' && m.freeRun) rows.push(['方案', (m.name || 'USER') + '（試運作）'], ['費用', '免費'], ['到期日', '不限'], ['剩餘', '—']);
  else if (m.status === 'TRIAL') { const st = Number(me.trialStart || 0); rows.push(['方案', (m.name || '試用') + '（試用）'], ['開始日', st ? dayDate(st) : '—'], ['到期日', dayDate(dayNum() + m.left)], ['剩餘', m.left + ' 天']); }
  else if (m.status === 'MEMBER' || m.status === 'GRACE') {
    rows.push(['方案', m.name], ['開始日', c ? dayDate(c.issued) : '—'], ['到期日', m.perm ? '永久有效' : dayDate(m.exp)], ['剩餘', m.perm ? '—' : m.grace ? '已過期（寬限 ' + Math.max(0, (S.policy.grace || 0) + m.left) + ' 天）' : m.left + ' 天']);
  } else if (m.status === 'EXPIRED' || m.status === 'FREE') rows.push(['方案', m.desc], ['到期日', c && c.expiry !== 0xFFFF ? dayDate(c.rel ? c.issued + c.expiry : c.expiry) : '—'], ['剩餘', '0 天']);
  if (!rows.length) return '';
  const warn = (m.status === 'MEMBER' && !m.perm && m.left <= (S.policy.remind || 7)) || m.status === 'GRACE' || m.status === 'TRIAL' && !m.freeRun && m.left <= 3;
  return `<div class="tile" style="margin-top:12px"><div class="row" style="justify-content:space-between"><b>使用期限</b>${warn ? '<span class="tag up">即將到期，請記得續約</span>' : ''}</div>
    <div class="grid g4" style="gap:8px;margin-top:6px">${rows.map(([k, v]) => `<div><div class="small muted">${k}</div><div class="num" style="font-weight:600">${esc(v)}</div></div>`).join('')}</div></div>`;
}
/** 申請狀態：伺服器狀態＋本機授權判斷（舊資料可能停在「已匯入」，授權已在申請之後簽發就視為已完成） */
function reqStateTag(r) {
  let st = r.state;
  if ((st === '已匯入' || st === '待處理') && S.code && r.at) { const d = String(r.at).slice(0, 10).split('/'); const day = Math.round((Date.UTC(+d[0], +d[1] - 1, +d[2]) - Date.UTC(2024, 0, 1)) / 86400000); if (S.code.issued >= day) st = '已完成'; }
  const [t, c] = st === '待處理' ? ['待處理', ''] : st === '已匯入' ? ['管理員處理中', ''] : st === '已完成' || st === '已處理' ? ['✓ 已完成', 'ok'] : st === '已結案' ? ['已結案', 'muted'] : [st, ''];
  return `<span class="tag ${c}">${esc(t)}</span>`;
}
/** 會員自助刪除帳號（兩道確認）：①輸入會員代號 ②確認保留期並輸入「確定刪除」 */
async function deleteAccountModal(me) {
  const no = String(me.no || '');
  const html = `<div class="small muted" style="margin-bottom:6px">第 1 步（共 2 步）</div><div class="small text2" style="line-height:1.7">刪除後以下資料會從雲端移除：<br>・名稱、Email、聯絡方式、Google 綁定<br>・手機⇄網頁同步的雲端資料<br>・LINE 綁定與到價提醒<br>・討論區留言與暱稱<br>・剩餘的會員期限（不退費）</div>
    <div class="small muted" style="margin-top:6px">手機 App 內的持股與交易紀錄不受影響；需要保留請先在「設定 › 資料」匯出備份。</div>
    <div class="field" style="margin-top:10px"><label>輸入會員代號 ${esc(no)} 確認</label><input id="dac" autocomplete="off"></div><div id="merr" class="small up" style="margin-top:6px"></div>`;
  const r = await dialog('刪除帳號', html, [['', '取消'], ['ok', '下一步', 'danger']], (root) => () => {
    const v = $('#dac', root).value.trim().toUpperCase(); if (!no || v !== no.toUpperCase()) return '請輸入正確的會員代號 ' + no; return null; });
  if (r !== 'ok') return;
  let s1; try { s1 = await api('deleteMe', { session: S.session, step: 1, confirm: no, web: true }); } catch (e) { await dialog('無法刪除', `<div class="small">${esc(e.message)}</div>`, [['ok', '確定', 'primary']]); return; }
  const keep = s1.days > 0;
  const r2 = await dialog('確認刪除帳號', `<div class="small muted" style="margin-bottom:6px">第 2 步（共 2 步）</div>
    <div class="small text2" style="line-height:1.7">${keep ? `帳號會先保留 <b>${s1.days} 天</b>（至 ${esc(s1.purgeDate)}），期間立即登出、停止 LINE 到價提醒，其他人看不到你的資料。<br>保留期間如果反悔，用同一個 Google 帳號登入後可「申請恢復帳號」，管理員確認後即恢復；期滿後永久刪除，無法復原。` : '確認後立即永久刪除，無法復原。'}</div>
    <div class="field" style="margin-top:10px"><label>請輸入「確定刪除」</label><input id="dac2" autocomplete="off"></div><div id="merr" class="small up" style="margin-top:6px"></div>`,
    [['', '取消'], ['ok', keep ? '刪除帳號' : '永久刪除', 'danger']], (root) => () => ($('#dac2', root).value.replace(/\s/g, '') !== '確定刪除' ? '請輸入「確定刪除」' : null));
  if (r2 !== 'ok') return;
  try {
    const o = await api('deleteMe', { session: S.session, token: s1.token, confirm2: '確定刪除', web: true });
    S.session = ''; store.del('session'); store.del('keys'); store.set('rev', 0); store.set('dirty', false); store.del('no'); store.del('aik'); store.del('aic');
    S.keys = {}; S.rev = 0; S.dirty = false; S.me = null; S.code = null; S.timers.forEach(clearInterval); S.timers = [];
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) {}
    loginView(o.pending ? `帳號已申請刪除，將於 ${o.purgeDate} 永久刪除；在那之前用同一個 Google 帳號登入可申請恢復。` : '帳號已刪除，雲端的會員資料與同步資料都已清除。');
  } catch (e) { await dialog('無法刪除', `<div class="small">${esc(e.message)}</div>`, [['ok', '確定', 'primary']]); }
}
/** 登入時帳號在刪除保留期：可申請恢復 */
async function restoreModal(d) {
  let note = '';
  const r = await dialog('帳號刪除中', `<div class="small text2" style="line-height:1.7">會員 ${esc(d.no)} 已於 ${esc(d.delDate)} 申請刪除，將於 <b>${esc(d.purgeDate)}</b> 永久刪除。</div>
    ${d.restoreAsked ? '<div class="small" style="margin-top:8px">已收到你的恢復申請，管理員確認後會以 LINE 或 Email 通知你，屆時重新登入即可。</div>'
      : '<div class="small text2" style="margin-top:8px">想拿回帳號嗎？送出申請後，管理員確認即可恢復，原有的會員期限與同步資料都會保留。</div><div class="field" style="margin-top:8px"><label>說明（選填）</label><textarea id="rsn" rows="2" maxlength="300"></textarea></div>'}`,
    d.restoreAsked ? [['', '確定']] : [['', '取消'], ['ok', '申請恢復帳號', 'primary']], (root) => () => { const x = $('#rsn', root); note = x ? x.value.trim() : ''; return null; });
  if (r !== 'ok') return;
  try { const o = await api('restoreReq', { ticket: d.ticket, note }); toast('已送出恢復申請，管理員確認後會通知你（' + o.no + '）', 6000); }
  catch (e) { toast('申請失敗：' + e.message, 5000); }
}
/** 登出：自動登出（逾時、其他瀏覽器登入、伺服器更新）一律保留這個瀏覽器的 API 金鑰；只有使用者勾選清除才刪除 */
async function logout(msg, clearKeys) {
  const ses = S.session;
  S.session = ''; store.del('session'); store.del('keys'); store.set('rev', 0); store.set('dirty', false); store.del('no');
  if (clearKeys) { store.del('aik'); store.del('aic'); store.del('aikNo'); }
  S.keys = {}; S.rev = 0; S.dirty = false; S.me = null; S.code = null;
  S.timers.forEach(clearInterval); S.timers = [];
  if (ses) api('logout', { session: ses }).catch(() => {});
  try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) {}
  loginView(msg);
}

// ───────── 路由 ─────────
function parseHash() { const h = location.hash.replace(/^#\/?/, ''); const [r, ...rest] = h.split('/'); return [r || '', rest.join('/')]; }
let cur = null;
async function route() {
  if (!S.session) return;
  if (!location.hash && S.pref.home && !S.homed) { S.homed = true; location.hash = '#/' + S.pref.home; return; }
  S.homed = true;
  const [r, arg] = parseHash(); const v = VIEWS[r] || VIEWS[''];
  if (cur && cur.leave) cur.leave();
  cur = v; S.route = VIEWS[r] ? r : '';
  markNav(S.route in PARENT ? PARENT[S.route] : S.route);
  $$('.bottom [data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === (BOTTOM.includes(PARENT[S.route] ?? S.route) ? (PARENT[S.route] ?? S.route) : 'more')));
  document.title = (v === VIEWS.s ? D.name(arg) + ' ' + arg : v.title) + '｜台美股資產';
  $('#view').innerHTML = v.render(decodeURIComponent(arg || ''));
  if (v.bind) v.bind();
  await v.fill(); renderSync();
  refreshQuotes(v.syms()).then(() => { if (cur === v) v.fill(); });
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-go]'); if (!el || !el.dataset.go) return;
  if (e.target.closest('button') && e.target.closest('button') !== el) return;
  location.hash = el.dataset.go;
});
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

// ───────── 啟動 ─────────
async function tick() {
  if (!S.session || (document.hidden && S.pref.bgRefresh !== '1') || !cur) return;
  S.lastTick = Date.now();
  const syms = new Set(cur.syms()); holdings().forEach((h) => syms.add(h.symbol));
  kjson('alertsV2', []).forEach((a) => { if (a.s && a.on !== false) syms.add(a.s); });
  fgSync(Array.from(syms)).catch(() => {});
  apSync(Array.from(syms)).catch(() => {});
  await Promise.all([refreshQuotes(Array.from(syms)), refreshIndexes(), refreshLimits()]);
  try { checkAlerts(); } catch (e) {}
  softFill();
}
/** 重畫目前頁面的動態內容（打字中、對話框開啟或拖曳時略過） */
function softFill() {
  const ae = document.activeElement;
  const typing = ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName) && $('#dyn') && $('#dyn').contains(ae);
  if (cur && !$('.modal-bg') && !typing && !S.dragging) { try { cur.fill(); } catch (e) {} }
  if ($('#rtSt')) $('#rtSt').textContent = rtStatusText();
}
async function start(meResp) {
  const me = meResp || await api('me', { session: S.session, web: true });
  if (me.kicked) return logout('你的帳號已在其他瀏覽器登入，這裡已自動登出');
  if (!me.registered) return logout('登入已失效，請重新登入');
  S.me = me; S.code = me.code ? await verifyCode(me.code) : null;
  if (me.phone === false && !S.cloudDir) { S.cloudDir = 'w2p'; store.set('cdir', 'w2p'); }
  shell();
  dlAppVer();
  S.keys = store.get('keys', {}); S.dirty = store.get('dirty', false);
  // 手動同步：只有這個瀏覽器還沒有資料（第一次登入）才自動下載一次；其餘由使用者按「同步」
  const firstLoad = !Object.keys(S.keys).length;
  try { if (autoSync() || firstLoad) { const pr = await pull(); if (pr === 'empty') S.syncMsg = me.phone ? '雲端還沒有手機資料' : '網頁為主（尚未綁定手機）'; } else S.syncMsg = '尚未同步'; }
  catch (e) { S.syncMsg = '同步失敗：' + e.message; }
  loadDir().then(() => cur && cur.fill());
  skLoad();
  await route();
  riskAck();
  tick();
  S.timers.push(setInterval(() => { if (Date.now() - (S.lastTick || 0) >= (twOpen() ? (S.pref.refresh || 10) : 60) * 1000 - 500) tick(); }, 5000));
  // 每分鐘檢查雲端是否有手機的新變更；每 10 分鐘確認登入狀態
  S.timers.push(setInterval(async () => { if (!autoSync() || document.hidden || S.syncing) return; try { if ((await pull()) === 'applied' && cur) route(); } catch (e) {} }, 60000));
  S.timers.push(setInterval(async () => { try { const m = await api('me', { session: S.session, web: true }); if (m.kicked) logout('你的帳號已在其他瀏覽器登入，這裡已自動登出'); else { S.me = m; S.code = m.code ? await verifyCode(m.code) : null; } } catch (e) {} }, 600000));
}

// ───────── 社群推廣：推薦連結（/r/會員代號）、分享按鈕、推廣圖卡 ─────────
function promoBase() { return ((S.policy && S.policy.pub) || location.origin + '/').replace(/\/?$/, '/'); }
function promoLink(no) { return no ? promoBase() + 'r/' + no : promoBase(); }
const PROMO_TEXT = '我在用「台美股資產」管理台股、美股與 ETF：即時行情、持股損益、股息日曆、K 線與 AI 個股體檢，手機和網頁同步。';
function promoHtml(me) {
  const link = promoLink(me.no); const t = encodeURIComponent(PROMO_TEXT); const u = encodeURIComponent(link);
  return `<div class="card"><h2>邀請好友<span class="r small muted">已成功推薦 <b style="color:var(--primary)">${me.refCount || 0}</b> 位</span></h2>
    ${me.refNote ? `<div class="notice" style="margin-bottom:8px">🎁 ${esc(me.refNote)}</div>` : ''}
    <div class="small text2">分享你的專屬連結，朋友透過連結註冊就會記在你的推薦名單（推薦碼＝你的會員代號 <b>${esc(me.no || '')}</b>）。</div>
    <div class="row" style="gap:6px;margin-top:8px"><input id="prLink" value="${esc(link)}" readonly style="flex:1"><button class="btn sm" id="prCopy">複製</button></div>
    <div class="row wrap" style="gap:6px;margin-top:8px">
      <a class="btn sm" target="_blank" rel="noopener" href="https://social-plugins.line.me/lineit/share?url=${u}&text=${t}">LINE</a>
      <a class="btn sm" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${u}">Facebook</a>
      <a class="btn sm" target="_blank" rel="noopener" href="https://www.threads.net/intent/post?text=${t}%20${u}">Threads</a>
      <a class="btn sm" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${t}&url=${u}">X</a>
      ${navigator.share ? '<button class="btn sm" id="prShare">更多…</button>' : ''}
      <button class="btn sm primary" id="prCard">製作推廣圖卡</button></div></div>`;
}
function promoBind(me) {
  const link = promoLink(me.no);
  if ($('#prCopy')) $('#prCopy').onclick = () => { navigator.clipboard.writeText(PROMO_TEXT + '\n' + link).then(() => toast('已複製推廣文字與連結'), () => { $('#prLink').select(); toast('請長按複製'); }); };
  if ($('#prShare')) $('#prShare').onclick = () => navigator.share({ title: '台美股資產', text: PROMO_TEXT, url: link }).catch(() => {});
  if ($('#prCard')) $('#prCard').onclick = () => promoCardModal(link);
}
/** 推廣圖卡：1080×1350（IG／Threads 直式）或 1080×1080，三種配色，可改標題與重點，含 QR Code 與推薦碼 */
const PROMO_THEMES = [
  { n: '深夜藍', bg: ['#0B1220', '#1E3A8A'], fg: '#F8FAFC', sub: '#BFD3F5', acc: '#60A5FA', box: 'rgba(255,255,255,.08)' },
  { n: '曜金', bg: ['#14100A', '#3A2A0C'], fg: '#FFF8EC', sub: '#E8D6B0', acc: '#F5B942', box: 'rgba(255,255,255,.07)' },
  { n: '清新白', bg: ['#FFFFFF', '#E6EEFF'], fg: '#0F172A', sub: '#475569', acc: '#2563EB', box: 'rgba(37,99,235,.07)' },
];
const PROMO_LINES = ['即時行情與自選清單', '持股損益、交易紀錄、已實現損益', '股息日曆與預估入帳', 'K 線分析、進場參考與 AI 個股體檢', '手機與網頁資料同步'];
async function promoQr(text) {
  if (!window.qrcode) await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
  const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q;
}
function promoWrap(ctx, text, maxW) {
  const out = []; for (const para of String(text).split('\n')) { let line = ''; for (const ch of para) { if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch; } out.push(line); }
  return out;
}
async function promoDraw(out, o) {
  // 先畫在離屏畫布，只有最後一次繪製會貼到畫面上（避免快速切換時互相覆蓋）
  const tok = (out._tok = (out._tok || 0) + 1);
  const W = 1080, H = o.square ? 1080 : 1350; const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d'); const th = PROMO_THEMES[o.theme] || PROMO_THEMES[0];
  const F = '"PingFang TC","Noto Sans TC","Microsoft JhengHei","Heiti TC",sans-serif';
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, th.bg[0]); g.addColorStop(1, th.bg[1]); c.fillStyle = g; c.fillRect(0, 0, W, H);
  // 裝飾：右上光暈與 K 線（只在標題上方的品牌列右側）
  const rg = c.createRadialGradient(W - 120, 140, 10, W - 120, 140, 420); rg.addColorStop(0, th.acc + '55'); rg.addColorStop(1, th.acc + '00'); c.fillStyle = rg; c.fillRect(0, 0, W, H);
  c.globalAlpha = 0.22; [[0.66, 0.55, 0.85], [0.72, 0.4, 0.75], [0.78, 0.48, 0.62], [0.84, 0.28, 0.55], [0.9, 0.22, 0.42], [0.96, 0.08, 0.3]].forEach(([x, top, bot], i) => {
    c.fillStyle = i % 3 === 2 ? th.sub : th.acc; const X = W * x, T = 40 + top * 170, B = 40 + bot * 170; c.fillRect(X - 3, T - 22, 6, B - T + 44); c.fillRect(X - 16, T, 32, Math.max(10, B - T));
  }); c.globalAlpha = 1;
  const P = 84; let y = 110;
  // 品牌
  c.fillStyle = th.acc; c.beginPath(); c.arc(P + 34, y, 34, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fff'; c.font = `800 34px ${F}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('台', P + 34, y + 2); c.textAlign = 'left';
  c.fillStyle = th.fg; c.font = `700 40px ${F}`; c.fillText('台美股資產', P + 84, y + 2);
  if (o.freeRun) { c.font = `700 28px ${F}`; const t = '試運作・免費使用'; const tw = c.measureText(t).width + 36; c.fillStyle = th.acc; c.beginPath(); c.roundRect(W - P - tw, y + 46, tw, 50, 25); c.fill(); c.fillStyle = '#fff'; c.fillText(t, W - P - tw + 18, y + 72); }
  // 版面：底部區塊（QR、行動呼籲）固定在下方，重點區塊依剩餘高度調整
  const qs = o.square ? 220 : 250, bottomTop = H - 70 - qs - 18;
  // 標題
  y = o.square ? 210 : 250; c.textBaseline = 'alphabetic'; c.fillStyle = th.fg; const tf = o.square ? 74 : 86; c.font = `900 ${tf}px ${F}`;
  for (const ln of promoWrap(c, o.title, W - P * 2).slice(0, 3)) { y += Math.round(tf * 1.12); c.fillText(ln, P, y); }
  if (o.sub) { c.fillStyle = th.sub; c.font = `500 34px ${F}`; for (const ln of promoWrap(c, o.sub, W - P * 2).slice(0, 2)) { y += 52; c.fillText(ln, P, y); } }
  // 重點
  y += 40; const lines = o.lines.filter(Boolean).slice(0, o.square ? 4 : 5);
  if (lines.length) {
    const room = bottomTop - 30 - y - 30; const rowH = Math.max(46, Math.min(o.square ? 62 : 74, Math.floor(room / lines.length))); const fs = Math.min(38, rowH - 24);
    const shown = lines.slice(0, Math.max(1, Math.floor(room / rowH)));
    c.fillStyle = th.box; c.beginPath(); c.roundRect(P - 20, y, W - (P - 20) * 2, shown.length * rowH + 30, 28); c.fill();
    c.font = `600 ${fs}px ${F}`;
    shown.forEach((t, i) => { const cy = y + 15 + i * rowH + rowH / 2; c.fillStyle = th.acc; c.beginPath(); c.arc(P + 14, cy, 10, 0, Math.PI * 2); c.fill(); c.fillStyle = th.fg; c.textBaseline = 'middle'; c.fillText(promoWrap(c, t, W - P * 2 - 80)[0], P + 46, cy + 1); c.textBaseline = 'alphabetic'; });
  }
  // QR 與推薦碼
  const qx = W - P - qs, qy = bottomTop + 18;
  if (o.qr) {
    c.fillStyle = '#fff'; c.beginPath(); c.roundRect(qx - 18, qy - 18, qs + 36, qs + 36, 24); c.fill();
    try { const q = await promoQr(o.link); const n = q.getModuleCount(); const cell = qs / n; c.fillStyle = '#0F172A';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect(qx + k * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell)); }
    catch (e) { c.fillStyle = '#64748B'; c.font = `500 26px ${F}`; c.textAlign = 'center'; c.fillText('掃描連結', qx + qs / 2, qy + qs / 2); c.textAlign = 'left'; }
  }
  const tx = (o.qr ? qx - 50 : W - P) - P;
  c.fillStyle = th.fg; c.font = `800 46px ${F}`; c.fillText(promoWrap(c, o.cta || '立即免費試用', tx)[0], P, qy + 46);
  c.fillStyle = th.sub; c.font = `500 30px ${F}`;
  const url = (o.url || o.link).replace(/^https?:\/\//, '').replace(/\/$/, ''); promoWrap(c, url, tx).slice(0, 2).forEach((ln, i) => c.fillText(ln, P, qy + 108 + i * 40));
  if (o.code) { c.fillStyle = th.acc; c.font = `700 36px ${F}`; c.fillText('推薦碼 ' + o.code, P, qy + qs - 10); }
  c.fillStyle = th.sub; c.globalAlpha = 0.8; c.font = `400 22px ${F}`; c.fillText('資產管理與分析工具，不構成投資建議；投資有風險，請自行評估', P, H - 34); c.globalAlpha = 1;
  if (tok !== out._tok) return;
  out.width = W; out.height = H; out.getContext('2d').drawImage(cv, 0, 0);
}
async function promoCardModal(link, code = '') {
  // 圖卡不另外印推薦碼，只顯示一行網址（推薦網址：短網址/r/會員代號，手動輸入也會記在推薦名單）；QR Code 同一個網址
  const o = { theme: 0, square: false, qr: true, title: '台股・美股・ETF\n一個 App 管好', sub: '行情、記帳、股息、分析一次搞定', lines: PROMO_LINES.slice(), link, code, url: link, cta: S.policy.payOn === false ? '試運作中，免費使用' : '立即免費試用', freeRun: S.policy.payOn === false };
  let cv;
  await dialog('推廣圖卡', `<div class="row wrap" style="gap:6px">${PROMO_THEMES.map((t, i) => `<button class="btn sm ${i ? '' : 'primary'}" data-pth="${i}">${t.n}</button>`).join('')}
      <button class="btn sm" id="pSq">改為方形 1080×1080</button><label class="row small" style="gap:4px;cursor:pointer"><input type="checkbox" id="pQr" checked style="width:auto"> QR Code</label></div>
    <div class="field" style="margin-top:8px"><label>標題（可換行）</label><textarea id="pT" rows="2" maxlength="40">${esc(o.title)}</textarea></div>
    <div class="field"><label>副標</label><input id="pS" maxlength="40" value="${esc(o.sub)}"></div>
    <div class="field"><label>重點（每行一項，最多 5 項）</label><textarea id="pL" rows="5" maxlength="200">${esc(o.lines.join('\n'))}</textarea></div>
    <div class="field"><label>行動呼籲</label><input id="pC" maxlength="20" value="${esc(o.cta)}"></div>
    <canvas id="pCv" style="width:100%;max-width:360px;display:block;margin:8px auto;border-radius:12px;box-shadow:0 4px 18px #0003"></canvas>
    <div class="row wrap" style="gap:6px;justify-content:center"><button class="btn primary" id="pDl">下載圖片</button>${navigator.canShare ? '<button class="btn" id="pSh">分享圖片</button>' : ''}</div>`,
    [['', '關閉']], (root) => {
      cv = $('#pCv', root); const redraw = () => promoDraw(cv, o).catch((e) => toast('繪製失敗：' + e.message));
      $$('[data-pth]', root).forEach((b) => b.onclick = () => { o.theme = +b.dataset.pth; $$('[data-pth]', root).forEach((x) => x.classList.toggle('primary', x === b)); redraw(); });
      $('#pSq', root).onclick = (e) => { o.square = !o.square; e.target.textContent = o.square ? '改為直式 1080×1350' : '改為方形 1080×1080'; redraw(); };
      $('#pQr', root).onchange = (e) => { o.qr = e.target.checked; redraw(); };
      $('#pT', root).oninput = (e) => { o.title = e.target.value; redraw(); }; $('#pS', root).oninput = (e) => { o.sub = e.target.value; redraw(); };
      $('#pL', root).oninput = (e) => { o.lines = e.target.value.split('\n').map((x) => x.trim()); redraw(); }; $('#pC', root).oninput = (e) => { o.cta = e.target.value; redraw(); };
      const blob = () => new Promise((ok) => cv.toBlob(ok, 'image/png'));
      $('#pDl', root).onclick = async () => { const a = document.createElement('a'); a.href = URL.createObjectURL(await blob()); a.download = '台美股資產-推廣圖卡' + (code ? '-' + code : '') + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
      if ($('#pSh', root)) $('#pSh', root).onclick = async () => { const f = new File([await blob()], '台美股資產推廣.png', { type: 'image/png' });
        if (navigator.canShare({ files: [f] })) navigator.share({ files: [f], text: PROMO_TEXT + '\n' + link }).catch(() => {}); else toast('這個瀏覽器不支援分享圖片，請改用下載'); };
      redraw(); return null;
    });
}

async function boot() {
  // 推薦連結 /r/代號 → ?ref=代號：記住推薦碼，註冊時送出
  try { const rf = new URLSearchParams(location.search).get('ref'); if (rf && /^[A-Za-z0-9]{3,12}$/.test(rf)) store.set('ref', rf.toUpperCase()); } catch (e) {}
  applyLook();
  try { S.cfg = await (await fetch('/api/cfg')).json(); } catch (e) { S.cfg = { policy: '', pubkey: '' }; }
  S.policy = await loadPolicy(S.cfg);
  if (!S.session) return loginView();
  try { await start(); } catch (e) {
    if (Object.keys(store.get('keys', {})).length) { // 離線：用本機資料
      S.keys = store.get('keys', {}); shell(); await route(); toast('無法連線會員伺服器：' + e.message, 4000);
    } else loginView('無法連線會員伺服器：' + e.message);
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
window.addEventListener('beforeunload', () => { if (S.dirty && autoSync()) push(); });
boot();
