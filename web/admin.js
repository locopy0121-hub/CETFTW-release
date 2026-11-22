// 台美股資產 網頁管理後台（管理員專用）
// 讀取：雲端會員伺服器的會員、申請、工作佇列與管理員 App 回報的狀態。
// 寫入：一律排入「工作」佇列，由管理員 App 執行（授權碼簽章私鑰、GitHub／Cloudflare 權杖只在手機），完成後即時顯示結果。
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem('cetf_adm_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cetf_adm_' + k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem('cetf_adm_' + k); } catch (e) {} } };
const argb = (c) => '#' + ((Number(c) >>> 0) & 0xFFFFFF).toString(16).padStart(6, '0');
const S = { ses: store.get('ses', ''), email: store.get('email', ''), tab: store.get('tab', 'home'), d: null, timer: null, fast: 0, q: '' };

async function api(a, payload = {}) {
  const r = await fetch('/api/m', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a, payload: JSON.stringify(payload) }) });
  const j = await r.json().catch(() => ({ ok: false, err: '伺服器回應格式錯誤' }));
  if (!j.ok) throw new Error(/未知動作/.test(j.err || '') ? '雲端會員伺服器需更新到第 9 版：管理員 App「會員 › 設定與備份 › 雲端會員伺服器 › 一鍵更新」' : j.err || '伺服器錯誤');
  return j;
}
async function call(op, extra = {}) { const r = await api('adminCall', { session: S.ses, op, ...extra }); if (r.kicked) { logout('登入已失效，請重新登入'); throw new Error('登入已失效'); } return r; }

function toast(t, ms = 3500) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--text);color:var(--card);padding:10px 16px;border-radius:10px;z-index:99;max-width:90vw;font-size:14px'; document.body.appendChild(el); setTimeout(() => el.remove(), ms); }
function dialog(title, html, buttons, setup) {
  return new Promise((resolve) => {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><div class="mb">${html}</div><div class="acts">${buttons.map(([v, t, c]) => `<button class="btn ${c || ''}" data-v="${v}">${esc(t)}</button>`).join('')}</div></div>`;
    document.body.appendChild(bg); const check = setup ? setup(bg) : null;
    $$('[data-v]', bg).forEach((b) => b.onclick = () => { if (b.dataset.v && check) { const e = check(b.dataset.v); if (e) { const m = $('#derr', bg); if (m) m.textContent = e; return; } } const box = bg; resolve({ v: b.dataset.v, box }); setTimeout(() => bg.remove(), 0); });
  });
}
const ago = (ms) => { const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? s + ' 秒前' : s < 3600 ? Math.round(s / 60) + ' 分鐘前' : s < 86400 ? Math.round(s / 3600) + ' 小時前' : Math.round(s / 86400) + ' 天前'; };

// ───────── 登入 ─────────
async function loginView(msg) {
  let cfg = {}; try { cfg = await (await fetch('/api/cfg')).json(); } catch (e) {}
  let gClient = ''; try { gClient = JSON.parse(JSON.parse(cfg.policy).policy).gClient || ''; } catch (e) {}
  $('#app').innerHTML = `<div class="login"><div class="box"><img src="/web/app-icon.png" width="64" height="64" style="border-radius:16px" alt=""><h1>管理後台</h1>
    <div class="text2" style="margin-top:6px">台美股資產 · 管理員專用</div>
    ${msg ? `<div class="notice err" style="margin-top:14px">${esc(msg)}</div>` : ''}
    <div id="gbtn" style="margin-top:18px;display:flex;justify-content:center">${gClient ? '' : '<div class="notice">尚未設定 Google 登入（管理員 App › 政策 › Google 帳號登入）。</div>'}</div>
    <div id="step2"></div><div id="lerr" class="small up" style="margin-top:10px"></div>
    <div class="small muted" style="margin-top:18px">只有管理員 App 指定的 Google 帳號能登入；第一次需輸入管理員 App 產生的配對碼。</div></div></div>`;
  const cb = async (resp) => {
    $('#lerr').textContent = '驗證中…';
    try {
      const r = await api('adminLogin', { idToken: resp.credential, session: S.ses });
      if (r.needCode) {
        $('#lerr').textContent = '';
        $('#step2').innerHTML = `<div class="small text2" style="margin-top:14px">${esc(r.email)}：請在管理員 App「會員 › 設定與備份 › 網頁管理後台」按「產生配對碼」，輸入 6 位數字</div>
          <input id="pcode" class="codebox" inputmode="numeric" maxlength="7" autocomplete="one-time-code" style="margin-top:8px"><button class="btn primary" id="pgo" style="margin-top:8px;width:100%">配對並登入</button>`;
        $('#pcode').focus();
        const go = async () => { $('#lerr').textContent = '配對中…'; try { const r2 = await api('adminLogin', { idToken: resp.credential, code: $('#pcode').value.replace(/\s/g, '') }); done(r2); } catch (e) { $('#lerr').textContent = e.message; } };
        $('#pgo').onclick = go; $('#pcode').onkeydown = (e) => { if (e.key === 'Enter') go(); };
        return;
      }
      done(r);
    } catch (e) { $('#lerr').textContent = e.message; }
  };
  const done = (r) => { S.ses = r.session; S.email = r.email; store.set('ses', r.session); store.set('email', r.email); start(); };
  if (/[?&]mock\b/.test(location.search)) { $('#gbtn').innerHTML = '<button class="btn primary" id="mk">測試登入</button>'; $('#mk').onclick = () => cb({ credential: 'mock' }); return; }
  if (!gClient) return;
  const init = () => { google.accounts.id.initialize({ client_id: gClient, callback: cb, ux_mode: 'popup', auto_select: false });
    google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'zh-TW', width: 280 }); };
  if (window.google && google.accounts) init(); else { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = init; document.head.appendChild(sc); }
}
async function logout(msg) {
  if (S.ses) call('logout').catch(() => {});
  S.ses = ''; store.del('ses'); clearInterval(S.timer); loginView(msg);
}

// ───────── 主畫面 ─────────
/** 網頁版本（發布時由 .github/public/sync.sh 填入） */
const WEB_VER = /*WEBVER*/{"v":"","sha":"268d923","at":"2026-11-22 22:39"};
const verText = () => (WEB_VER ? (WEB_VER.v ? (/^v/i.test(WEB_VER.v) ? WEB_VER.v : 'v' + WEB_VER.v) + ' · ' : '') + WEB_VER.sha + (WEB_VER.at ? ' · ' + WEB_VER.at : '') : '開發版');
const TABS = [['home', '總覽'], ['req', '申請'], ['mem', '會員'], ['pol', '政策'], ['tier', '會員等級'], ['rel', '發布'], ['line', 'LINE'], ['forum', '討論區'], ['job', '工作紀錄']];
/** 功能位元（與 App License.Feature 順序相同，不可調整） */
const FEATS = ['K 線分析與進場建議', 'AI 個股體檢', '提醒與進場鈴聲', '行情牆與熱度圖', '股息與稅務', '投資分析工具', '報告', '市場與排行', '群聊', '備份與設定檔', '盤中持股監控', '桌面小工具', '進階圖表', '新聞', '外觀自訂', '個股進階資料'];
const featBoxes = (name, mask) => `<div class="grid g2" style="gap:4px 12px">${FEATS.map((f, i) => `<label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" data-${name}="${i}" style="width:auto" ${mask & (1 << i) ? 'checked' : ''}> ${esc(f)}</label>`).join('')}</div>`;
const maskOf = (box, name) => $$(`[data-${name}]`, box).reduce((a, el) => a | (el.checked ? 1 << +el.dataset[name] : 0), 0);
function shell() {
  $('#app').innerHTML = `<div class="adm"><div class="adm-top"><img src="/web/app-icon.png" alt=""><h1>管理後台 <span class="small muted" style="font-weight:400" title="網頁版本">${esc(verText())}</span></h1>
      <span class="live" id="live"><i></i><span>連線中…</span></span><span class="small muted">${esc(S.email)}</span><a class="btn sm" href="/web" target="_blank">使用者網頁版</a><button class="btn sm" id="lo">登出</button></div>
    <div class="adm-tabs" id="tabs"></div><div id="view"></div></div>`;
  $('#lo').onclick = () => logout();
  renderTabs();
}
function renderTabs() {
  const d = S.d; const nReq = d ? pendingReqs().length : 0; const nJob = d ? d.jobs.filter((j) => j.state === '待處理' || j.state === '處理中').length : 0;
  $('#tabs').innerHTML = TABS.map(([k, n]) => `<button data-t="${k}" class="${S.tab === k ? 'on' : ''}">${n}${k === 'req' && nReq ? `<span class="cnt">${nReq}</span>` : ''}${k === 'job' && nJob ? `<span class="cnt" style="background:#f59e0b">${nJob}</span>` : ''}</button>`).join('');
  $$('[data-t]', $('#tabs')).forEach((b) => b.onclick = () => { S.tab = b.dataset.t; store.set('tab', S.tab); renderTabs(); render(); });
}
function appOnline() { return S.d && S.d.appSeen && S.d.now - S.d.appSeen < 45000; }
function renderLive() {
  const el = $('#live'); if (!el || !S.d) return; const on = appOnline();
  el.classList.toggle('on', on); el.querySelector('span').textContent = on ? '管理員 App 已連線' : S.d.appSeen ? '管理員 App 未開啟（最後連線 ' + ago(Date.now() - (S.d.now - S.d.appSeen)) + '）' : '管理員 App 尚未連線';
}
async function refresh() {
  // 編輯中的頁面（政策、等級、LINE）不自動重畫，避免輸入到一半被覆蓋
  try {
    S.d = await call('state', S.tab === 'line' ? { want: 'line' } : {}); renderLive(); renderTabs(); jobsDone();
    const done = lineJobsDone();
    // LINE 頁：沒有在輸入、沒有開對話框時才重畫（輸入內容都保存在 S，重畫不會遺失）
    if (S.tab === 'line' && S.rendered === 'line') { if (!lineFocused() && !$('.modal-bg')) render(); else renderLineRes(); if (done) renderLineRes(); }
    else if (!(['pol', 'tier', 'forum'].includes(S.tab) && S.rendered === S.tab)) render();
  }
  catch (e) { if (S.ses) { const el = $('#live'); if (el) el.querySelector('span').textContent = '讀取失敗：' + e.message; } }
}
function pendingReqs() {
  const app = (S.d.app && S.d.app.requests) || []; const sheet = (S.d.requests || []).filter((r) => r.state === '待處理');
  return app.map((r) => ({ ...r, src: 'app' })).concat(sheet.map((r) => ({ key: '', kind: r.kind, name: r.name, contact: r.contact, msg: r.message, no: r.no, dev: r.device, at: r.at, src: 'sheet', id: r.id })));
}
/**
 * 送出操作：資料庫在 D1 時，會員資料、強制登出、回覆 LINE 由轉送站直接完成（不必等管理員 App）；
 * 其他需要手機金鑰的操作（開通、政策、發布…）交給管理員 App，App 開著時約 2 秒內完成並顯示結果。
 */
const DIRECT = { edit: 1, account: 1, linePush: 1 };
async function job(type, payload, label) {
  if (S.d && S.d.d1 && DIRECT[type]) {
    try { const r = await call('direct', { type, payload }); if (!r.ok) throw new Error(r.err || '失敗'); toast('✓ ' + (r.result || '已完成')); await refresh(); return 'direct'; }
    catch (e) { toast('✗ ' + e.message, 6000); return null; }
  }
  try {
    const r = await call('job', { type, payload }); S.jwait = S.jwait || {}; S.jwait[r.id] = { at: Date.now(), label: label || '' };
    toast(appOnline() ? '處理中…' : (label || '已送出') + '：管理員 App 開啟後自動執行'); S.fast = 20; await refresh(); return r.id;
  } catch (e) { toast('送出失敗：' + e.message, 6000); }
}
/** 交給管理員 App 的操作完成時顯示結果 */
function jobsDone() {
  const w = S.jwait || {}; const jobs = (S.d && S.d.jobs) || [];
  Object.keys(w).forEach((id) => { const j = jobs.find((x) => String(x.id) === String(id)); if (!j) { if (Date.now() - w[id].at > 600000) delete w[id]; return; }
    if (['完成', '失敗', '已取消'].includes(j.state)) { delete w[id]; if (j.type !== 'line') toast((j.state === '完成' ? '✓ ' : '✗ ') + String(j.result || j.state).slice(0, 120), 5000); } });
}

// ───────── 個股討論區管理（直接連轉送站的討論資料庫，以後台登入確認身分）─────────
async function fadm(a, p = {}) {
  const r = await fetch('/api/f', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, a, adminSession: S.ses, src: 'admin' }) });
  const j = await r.json().catch(() => ({ ok: false, err: r.status === 404 ? '轉送站尚未支援討論區，請重新部署' : '討論區回應錯誤' }));
  if (!j.ok) throw new Error(j.err || '討論區錯誤');
  return j;
}
const FK = [['reported', '被檢舉'], ['hidden', '已隱藏'], ['recent', '最新'], ['removed', '已刪除']];
const FST = ['', '已自動隱藏', '作者刪除', '管理員移除'];
async function renderForum(v) {
  S.fk = S.fk || 'reported';
  v.innerHTML = '<div class="card empty">載入中…</div>';
  let st, cf, mu, ls;
  try { [st, cf, mu, ls] = await Promise.all([fadm('adm.stats'), fadm('adm.cfg'), fadm('adm.mutes'), fadm('adm.list', { kind: S.fk })]); }
  catch (e) { v.innerHTML = `<div class="card"><h2>個股討論區</h2><div class="notice">${esc(e.message)}</div><div class="small muted" style="margin-top:8px">討論區資料存在轉送站的 Cloudflare D1 資料庫：請在 Cloudflare API 權杖加上「D1：編輯」權限，再由管理員 App 重新部署轉送站。</div></div>`; return; }
  if (S.tab !== 'forum') return;
  const s = st.stats || {}; const c = cf.cfg;
  v.innerHTML = `<div class="grid g4" style="gap:10px">${[['今日發文', s.day_n || 0], ['近 7 天', s.week_n || 0], ['全部', s.all_n || 0], ['待處理檢舉', s.reported || 0]].map(([k, x]) => `<div class="card"><div class="small muted">${k}</div><div style="font-size:24px;font-weight:700">${x}</div></div>`).join('')}</div>
    <div class="grid g2 stack" style="margin-top:12px">
      <div class="card"><h2>文章<span class="r"><button class="btn sm" id="frf">重新整理</button></span></h2>
        <div class="seg" style="margin-bottom:10px">${FK.map(([k, n]) => `<button data-fk="${k}" class="${S.fk === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div id="fls">${ls.posts.length ? ls.posts.map(fRow).join('') : '<div class="small muted">沒有文章</div>'}</div></div>
      <div><div class="card"><h2>規則設定</h2>
        <label class="row" style="gap:8px;justify-content:flex-start"><input type="checkbox" style="width:auto" id="fon" ${c.on ? 'checked' : ''}>開放討論區</label>
        <label class="row" style="gap:8px;margin-top:6px;justify-content:flex-start"><input type="checkbox" style="width:auto" id="flk" ${c.links ? 'checked' : ''}>允許會員貼連結</label>
        <div class="grid g2" style="gap:8px;margin-top:8px">${[['hide', '檢舉幾次自動隱藏'], ['gap', '發文間隔（秒）'], ['daily', '每人每日上限'], ['max', '每則字數上限']].map(([k, n]) => `<div class="field"><label>${n}</label><input type="number" min="0" data-fc="${k}" value="${c[k]}"></div>`).join('')}</div>
        <div class="field"><label>禁用字詞（以空白或逗號分隔）</label><textarea id="fwd" rows="3">${esc(c.words || '')}</textarea></div>
        <button class="btn primary" id="fsave">儲存規則</button></div>
      <div class="card" style="margin-top:12px"><h2>禁言中（${mu.list.length}）</h2>${mu.list.length ? mu.list.map((m) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)"><div style="flex:1"><b>${esc(m.nick || '會員' + m.no)}</b>（${esc(m.no)}）<div class="small muted">至 ${new Date(m.until).toLocaleDateString('zh-TW')}${m.why ? '・' + esc(m.why) : ''}</div></div><button class="btn sm" data-unm="${esc(m.no)}">解除</button></div>`).join('') : '<div class="small muted">沒有</div>'}</div>
      <div class="card" style="margin-top:12px"><h2>近 7 天熱門</h2><div class="small">${(st.top || []).map((x) => esc(x.sym) + '（' + x.n + '）').join('、') || '—'}</div></div>
      <div class="card" style="margin-top:12px"><h2>管理紀錄</h2>${(st.log || []).map((x) => `<div class="small" style="padding:3px 0">${new Date(x.at).toLocaleString('zh-TW')}　${esc(x.who)}　${esc(x.act)}${x.pid ? ' #' + x.pid : ''}${x.no ? ' 會員 ' + esc(x.no) : ''}${x.note ? '（' + esc(x.note) + '）' : ''}</div>`).join('') || '<div class="small muted">尚無紀錄</div>'}</div></div></div>`;
  $$('[data-fk]', v).forEach((b) => b.onclick = () => { S.fk = b.dataset.fk; renderForum(v); });
  $('#frf').onclick = () => renderForum(v);
  $('#fsave').onclick = async () => {
    const set = { on: $('#fon').checked, links: $('#flk').checked, words: $('#fwd').value }; $$('[data-fc]', v).forEach((el) => { set[el.dataset.fc] = +el.value; });
    try { await fadm('adm.cfg', { set }); toast('已儲存規則'); } catch (e) { toast(e.message, 5000); }
  };
  $$('[data-unm]', v).forEach((b) => b.onclick = async () => { try { await fadm('adm.mute', { no: b.dataset.unm, days: 0 }); toast('已解除禁言'); renderForum(v); } catch (e) { toast(e.message); } });
  $$('[data-fa]', v).forEach((b) => b.onclick = async () => {
    const id = +b.dataset.id; const a = b.dataset.fa; const p = ls.posts.find((x) => x.id === id);
    try {
      if (a === 'restore') await fadm('adm.state', { id, state: 0 });
      if (a === 'remove') await fadm('adm.state', { id, state: 3 });
      if (a === 'pin') await fadm('adm.pin', { id, pinned: !p.pinned });
      if (a === 'mute') {
        let o = null; const r = await dialog('禁言「' + p.nick + '」（會員 ' + p.no + '）', `<div class="field"><label>天數</label><select id="mdays"><option value="1">1 天</option><option value="7">7 天</option><option value="30">30 天</option><option value="3650">永久</option></select></div>
          <div class="field"><label>原因（會顯示給該會員）</label><input id="mwhy" maxlength="60"></div><label class="row" style="gap:6px;justify-content:flex-start"><input type="checkbox" style="width:auto" id="mpurge">同時移除這位會員的全部文章</label>`,
          [['', '取消'], ['ok', '禁言', 'primary']], (bx) => () => { o = { days: +$('#mdays', bx).value, why: $('#mwhy', bx).value, purge: $('#mpurge', bx).checked }; return null; });
        if (r !== 'ok') return;
        await fadm('adm.mute', { no: p.no, ...o });
      }
      toast('已完成'); renderForum(v);
    } catch (e) { toast(e.message, 5000); }
  });
}
function fRow(p) {
  return `<div class="tile" style="margin-top:8px"><div class="row" style="gap:8px"><b style="flex:1">${esc(p.nick)}${p.official ? ' <span class="tag">官方</span>' : ''} <span class="small muted">會員 ${esc(p.no)}・${esc(p.sym)}・#${p.id}${p.parent ? '（回覆 #' + p.parent + '）' : ''}</span></b>
      <span class="small muted">${new Date(p.at).toLocaleString('zh-TW')}</span></div>
    <div style="white-space:pre-wrap;word-break:break-word;margin:6px 0">${esc(p.body)}</div>
    <div class="small ${p.state === 1 ? 'up' : 'muted'}">${[p.stance === 1 ? '看多' : p.stance === -1 ? '看空' : '', '♥ ' + p.likes, p.parent ? '' : p.replies + ' 則回覆', p.reports ? '檢舉 ' + p.reports + (p.why ? '：' + esc(p.why) : '') : '', FST[p.state] || '', p.pinned ? '置頂' : ''].filter(Boolean).join('・')}</div>
    <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${p.state !== 0 ? `<button class="btn sm" data-fa="restore" data-id="${p.id}">恢復顯示</button>` : ''}${p.state <= 1 ? `<button class="btn sm" data-fa="remove" data-id="${p.id}">移除</button>` : ''}${p.reports && p.state === 0 ? `<button class="btn sm" data-fa="restore" data-id="${p.id}">忽略檢舉</button>` : ''}${!p.parent && p.state === 0 ? `<button class="btn sm" data-fa="pin" data-id="${p.id}">${p.pinned ? '取消置頂' : '置頂'}</button>` : ''}${!p.official ? `<button class="btn sm" data-fa="mute" data-id="${p.id}">禁言會員</button>` : ''}</div></div>`;
}

function render() {
  if (!S.d) return; S.rendered = S.tab; const v = $('#view'); const d = S.d; const app = d.app || {};
  if (S.tab === 'home') {
    const ms = d.members || []; const st = (s) => ms.filter((m) => m.status === s).length; const reqs = pendingReqs();
    const rel = (app.builds || []).find((b) => !b.draft); const dr = (app.builds || []).find((b) => b.draft);
    v.innerHTML = `<div class="grid g4" style="gap:10px">${[['會員', ms.length], ['有效', st('有效') + st('即將到期')], ['即將到期', st('即將到期')], ['待處理申請', reqs.length]].map(([k, x]) => `<div class="tile"><div class="k">${k}</div><div class="v num">${x}</div></div>`).join('')}</div>
      ${!appOnline() ? `<div class="notice" style="margin-top:12px">📱 管理員 App 目前沒有開著：可以先送出工作，App 開啟後約 10 秒內自動執行。</div>` : ''}
      <div class="grid g2 stack" style="margin-top:12px">
        <div class="card"><h2>版本</h2>${kv([['使用者正式版', rel ? rel.tag + '（' + rel.at.slice(0, 10) + '）' : '—'], ['最新測試版', dr ? dr.tag : '—'], ['管理員 App', app.v ? 'v' + app.v : '—'], ['會員伺服器', '第 ' + d.version + ' 版']])}
          ${dr && (!rel || dr.tag.replace('admin-', '') !== rel.tag) ? `<button class="btn primary" data-go="rel" style="margin-top:10px">發布 ${esc(dr.tag.replace('admin-', ''))} 給使用者 ›</button>` : ''}</div>
        <div class="card"><h2>發佈站與 LINE</h2>${kv([['已部署版本', app.worker && app.worker.app ? 'v' + app.worker.app : '—'], ['部署時間', app.worker && app.worker.at ? new Date(app.worker.at).toLocaleString('zh-TW') : '—'], ['狀態', app.worker ? (app.worker.need ? '有新版可部署' : '最新') : '—']])}
          ${app.worker && app.worker.ready ? `<button class="btn" id="rdp" style="margin-top:10px">重新部署</button>` : ''}</div>
        <div class="card"><h2>最近申請</h2>${reqs.length ? reqs.slice(0, 5).map(reqRow).join('') : '<div class="small muted">沒有待處理的申請</div>'}</div>
        <div class="card"><h2>最近工作</h2>${d.jobs.slice(0, 6).map(jobRow).join('') || '<div class="small muted">尚無工作</div>'}</div>
        <div class="card" id="hcBox" style="grid-column:1/-1"><h2>資料源健康檢查<span class="r"><button class="btn sm" id="hcRun">立即檢查</button></span></h2><div class="small muted">讀取中…</div></div></div>`;
    healthBox($('#hcBox', v), false); $('#hcRun', v).onclick = () => healthBox($('#hcBox', v), true);
    $$('[data-go]', v).forEach((b) => b.onclick = () => { S.tab = b.dataset.go; renderTabs(); render(); });
    if ($('#rdp')) $('#rdp').onclick = () => job('redeploy', {}, '已送出重新部署');
    bindReq(v);
  } else if (S.tab === 'req') {
    const reqs = pendingReqs(); const done = (d.requests || []).filter((r) => r.state !== '待處理').slice(-15).reverse();
    v.innerHTML = `<div class="card"><h2>待處理申請（${reqs.length}）</h2>${reqs.length ? reqs.map(reqRow).join('') : '<div class="small muted">沒有待處理的申請</div>'}</div>
      <div class="card" style="margin-top:12px"><h2>近期申請紀錄</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>時間</th><th>類型</th><th>代號</th><th>名稱</th><th>聯絡</th><th>留言</th><th>狀態</th></tr></thead><tbody>
        ${done.map((r) => `<tr><td class="small">${esc(String(r.at).slice(0, 16))}</td><td>${kindN(r.kind)}</td><td>${esc(r.no)}</td><td>${esc(r.name)}</td><td>${esc(r.contact)}</td><td class="small">${esc(r.message)}</td><td>${esc(r.state)}</td></tr>`).join('')}</tbody></table></div></div>`;
    bindReq(v);
  } else if (S.tab === 'mem') {
    const q = S.q.trim().toLowerCase(); const ms = (d.members || []).filter((m) => !q || [m.no, m.name, m.contact, m.email, m.device].some((x) => String(x || '').toLowerCase().includes(q)));
    v.innerHTML = `<div class="card"><div class="row wrap" style="gap:8px;margin-bottom:10px"><input id="mq" placeholder="搜尋代號、名稱、聯絡、Email、裝置碼" value="${esc(S.q)}" style="flex:1;min-width:200px"><button class="btn primary" id="newm">＋ 開通新會員</button><button class="btn" id="msync">同步會員</button></div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>代號</th><th>名稱</th><th>等級</th><th>狀態</th><th>到期</th><th>聯絡／Email</th><th>裝置</th><th>最後上線</th></tr></thead><tbody>
      ${ms.map((m) => `<tr class="click" data-no="${esc(m.no)}"><td><b>${esc(m.no)}</b></td><td>${esc(m.name)}</td><td>${esc(m.tier || '—')}</td><td style="color:${/有效/.test(m.status) ? '#22c55e' : /停用|到期/.test(m.status) ? '#ef4444' : 'inherit'}">${esc(m.status || '—')}</td><td class="small">${esc(m.expiry || '—')}</td>
        <td class="small">${esc(m.contact || '')}${m.email ? '<br>' + esc(m.email) : ''}</td><td class="small">${m.device ? esc(m.device) : '💻 網頁'}${m.google ? ' · G' : ''}</td><td class="small">${esc(String(m.seen || '').slice(0, 16))}</td></tr>`).join('')}</tbody></table></div>
      <div class="small muted" style="margin-top:6px">共 ${ms.length} 位 · 點一列查看與管理</div></div>`;
    const mq = $('#mq'); mq.oninput = () => { S.q = mq.value; const pos = mq.selectionStart; render(); const n = $('#mq'); n.focus(); n.setSelectionRange(pos, pos); };
    $('#newm').onclick = () => issueDialog({});
    $('#msync').onclick = () => job('sync', {}, '已送出同步');
    $$('[data-no]', v).forEach((tr) => tr.onclick = () => memberDialog(d.members.find((m) => m.no === tr.dataset.no)));
  } else if (S.tab === 'pol') {
    const p = app.policy || {};
    if (!app.policy) { v.innerHTML = '<div class="card empty">等待管理員 App 回報政策（開啟 App 即可）</div>'; return; }
    v.innerHTML = `<div class="grid g2 stack"><div class="card"><h2>會員政策</h2>
      <div class="grid g2" style="gap:10px">${[['trialDays', '試用天數', p.trialDays], ['trialName', '試用等級名稱', p.trialName], ['graceDays', '到期寬限天數', p.graceDays], ['remindDays', '到期前提醒天數', p.remindDays], ['actWindow', '啟用期限（天）', p.actWindow]].map(([k, n, x]) => `<div class="field"><label>${n}</label><input data-pk="${k}" value="${esc(x)}" ${k === 'trialName' ? '' : 'type="number" min="0"'}></div>`).join('')}
        <div class="field"><label>Google 登入要求</label><select data-pk="loginMode">${['選用', '會員需登入', '全部需登入'].map((n, i) => `<option value="${i}" ${p.loginMode === i ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <div class="field"><label>公告（App 與網頁版會員頁顯示）</label><textarea data-pk="notice" rows="3" maxlength="300">${esc(p.notice || '')}</textarea></div>
      <div class="field"><label>試用可用功能</label>${featBoxes('tf', p.trialF ?? 65535)}</div>
      <div class="field"><label>到期（免費）可用功能</label>${featBoxes('ff', p.freeF ?? 0)}</div>
      <button class="btn primary" id="psave">儲存並回傳政策</button><div class="small muted" style="margin-top:6px">由管理員 App 簽章後回傳，使用者約半天內生效（會員頁可手動重新整理）。${p.updated ? '上次回傳 ' + new Date(p.updated).toLocaleString('zh-TW') : ''}</div></div>
      <div class="card" id="tierBox"></div><div class="card" id="priceBox"></div></div>`;
    tierEditor($('#tierBox', v), p); priceEditor($('#priceBox', v), p);
    $('#psave').onclick = () => { const o = {}; $$('[data-pk]', v).forEach((el) => { const k = el.dataset.pk; o[k] = /trialName|notice/.test(k) ? el.value : parseInt(el.value, 10) || 0; }); o.trialF = maskOf(v, 'tf'); o.freeF = maskOf(v, 'ff'); job('policy', o, '已送出政策更新'); };
  } else if (S.tab === 'tier') {
    const p = app.policy || {}; if (!app.policy) { v.innerHTML = '<div class="card empty">等待管理員 App 回報政策（開啟 App 即可）</div>'; return; }
    v.innerHTML = '<div class="card" id="tierBox"></div>'; tierEditor($('#tierBox', v), p);
  } else if (S.tab === 'line') {
    renderLine(v, app);
  } else if (S.tab === 'forum') {
    renderForum(v);
  } else if (S.tab === 'rel') {
    const bs = app.builds || []; const rel = bs.find((b) => !b.draft);
    v.innerHTML = `<div class="card"><h2>發布版本給使用者</h2>${!app.token ? '<div class="notice">管理員 App 尚未設定 GitHub 權杖，無法讀取版本與發布。</div>' : ''}
      ${bs.map((b) => { const ver = b.tag.replace('admin-', ''); const isRel = !b.draft; const live = rel && rel.tag === ver;
        return `<div class="tile" style="margin-top:8px"><div class="row"><b style="flex:1">${esc(b.tag)}</b>${isRel ? '<span class="tag up">正式版</span>' : '<span class="tag">測試版</span>'}<span class="small muted">${esc(b.at.replace('T', ' '))}</span>
          ${b.draft ? `<button class="btn sm ${live ? '' : 'primary'}" data-pv="${esc(ver)}">${live ? '重新部署' : '🚀 一鍵發布及部署'}</button>` : ''}</div>${b.notes ? `<div class="small text2" style="white-space:pre-wrap;margin-top:4px">${esc(b.notes)}</div>` : ''}</div>`; }).join('') || '<div class="small muted">等待管理員 App 回報版本清單</div>'}</div>
      <div class="card" style="margin-top:12px"><h2>發佈站與 LINE 自動回覆</h2>${kv([['已部署版本', app.worker && app.worker.app ? 'v' + app.worker.app : '—'], ['狀態', app.worker ? (app.worker.need ? '有新版程式可部署' : '最新') : '—']])}
        <button class="btn" id="rdp2" style="margin-top:10px" ${app.worker && app.worker.ready ? '' : 'disabled'}>重新部署發佈站</button></div>`;
    $$('[data-pv]', v).forEach((b) => b.onclick = async () => {
      const ver = b.dataset.pv; const live = rel && rel.tag === ver;
      const ck = (id, on, t, d) => `<label class="row small" style="gap:6px;margin-top:6px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="${id}" style="width:auto" ${on ? 'checked' : ''}><span><b>${t}</b><br><span class="muted">${d}</span></span></label>`;
      const r = await dialog('一鍵發布及部署 ' + ver, `<div class="text2">由管理員 App 依序執行（後端先、前端後），程式取自這次建置的原始碼：</div>
        ${ck('rS', true, '1. 更新會員伺服器', '版本較新才更新（Apps Script 一鍵更新）')}${ck('rW', true, '2. 部署轉送站', '網頁版、管理後台、發佈站、LINE 自動回覆；程式有變更才部署')}
        ${ck('rP', !live, '3. 發布使用者版', live ? '已是正式版，勾選＝重新發布' : '使用者 App 線上更新，網頁版同步切換到這一版')}${ck('rL', false, '4. LINE 群發更新通知', '發布後通知所有好友')}
        <div class="field" style="margin-top:10px"><label>更新說明（選填，空白沿用建置說明）</label><textarea id="rn" rows="3"></textarea></div>`, [['', '取消'], ['ok', '開始', 'primary']]);
      if (r.v === 'ok') { const g = (id) => $('#' + id, r.box).checked; job('release', { version: ver, notes: $('#rn', r.box).value.trim(), server: g('rS'), worker: g('rW'), promote: g('rP'), line: g('rP') && g('rL') }, '已送出一鍵發布及部署'); }
    });
    $('#rdp2').onclick = () => job('redeploy', {}, '已送出重新部署');
  } else if (S.tab === 'job') {
    v.innerHTML = `<div class="card"><h2>工作紀錄</h2><div class="small muted" style="margin-bottom:8px">網頁送出的動作由管理員 App 執行；${appOnline() ? '目前 App 已連線。' : '目前 App 沒有開著，開啟後自動執行。'}</div>${d.jobs.map(jobRow).join('') || '<div class="small muted">尚無工作</div>'}</div>`;
    $$('[data-cancel]', v).forEach((b) => b.onclick = async () => { await call('cancel', { id: b.dataset.cancel }).catch(() => {}); refresh(); });
  }
}
const kindN = (k) => ({ new: '開通', renew: '續約', change: '變更方案', register: '註冊' }[k] || k);
const JOBN = { line: 'LINE', broadcast: 'LINE 群發', issue: '開通授權', revoke: '停用授權', edit: '編輯會員', account: '帳號管理', policy: '更新政策', promote: '發布版本', release: '一鍵發布及部署', redeploy: '重新部署', sync: '同步會員', remove: '刪除資料', request: '處理申請' };
function kv(items) { return `<div class="grid g2" style="gap:8px">${items.map(([k, x]) => `<div><div class="small muted">${esc(k)}</div><div>${esc(x)}</div></div>`).join('')}</div>`; }
function jobRow(j) {
  let p = {}; try { p = JSON.parse(j.payload); } catch (e) {}
  const what = (JOBN[j.type] || j.type) + (j.type === 'line' && p.act ? '・' + (LACT[p.act] || p.act) : '') + (p.no ? ' ' + p.no : '') + (p.version ? ' ' + p.version : '');
  return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--border);align-items:flex-start"><div class="sp"><div><b>${esc(what)}</b> <span class="small st-${esc(j.state)}">${esc(j.state)}</span></div>
    <div class="small muted">${esc(j.at.slice(0, 16))}${j.doneAt ? ' → ' + esc(j.doneAt.slice(11, 16)) : ''}${j.src ? ' · ' + esc(j.src) : ''}</div>${j.result ? `<div class="small ${j.state === '失敗' ? 'down' : 'text2'}">${esc(j.result)}</div>` : ''}</div>
    ${j.state === '待處理' ? `<button class="btn sm" data-cancel="${esc(j.id)}">取消</button>` : ''}</div>`;
}
function reqRow(r, i) {
  return `<div class="tile" style="margin-top:8px"><div class="row wrap"><b style="flex:1">${kindN(r.kind)}　${esc(r.name || '（未填名稱）')}${r.no ? ' · ' + esc(r.no) : ''}</b><span class="small muted">${esc(typeof r.at === 'number' ? new Date(r.at).toLocaleString('zh-TW') : String(r.at).slice(0, 16))}</span></div>
    <div class="small text2">${r.contact ? '聯絡：' + esc(r.contact) + '　' : ''}${r.dev ? '裝置 ' + esc(r.dev) + '　' : '💻 網頁　'}${esc(r.msg || '')}</div>
    <div class="row" style="gap:6px;margin-top:6px"><button class="btn sm primary" data-ri="${i}">開通</button>${r.key ? `<button class="btn sm" data-rd="${i}">標記已處理</button>` : '<span class="small muted">（管理員 App 同步後可標記）</span>'}</div></div>`;
}
function bindReq(v) {
  const reqs = pendingReqs();
  $$('[data-ri]', v).forEach((b) => b.onclick = () => { const r = reqs[+b.dataset.ri]; const m = (S.d.members || []).find((x) => r.no && x.no === r.no);
    issueDialog({ no: r.no, name: r.name, contact: r.contact, device: r.dev, request: r.key, renew: r.kind !== 'new' && !!m, note: '申請：' + (r.msg || '').slice(0, 60) }); });
  $$('[data-rd]', v).forEach((b) => b.onclick = async () => { const r = reqs[+b.dataset.rd]; const x = await dialog('處理申請', `<div class="field"><label>處理結果</label><input id="rres" value="已處理"></div>`, [['', '取消'], ['del', '刪除'], ['ok', '標記已處理', 'primary']]);
    if (x.v === 'ok') job('request', { key: r.key, result: $('#rres', x.box).value }, '已送出'); else if (x.v === 'del') job('request', { key: r.key, delete: true }, '已送出刪除'); });
}
/** 開通／續約授權 */
async function issueDialog(m) {
  const app = S.d.app || {}; const tiers = ((app.policy || {}).tiers || []); const plans = app.plans || [{ d: 30, n: '1 個月' }, { d: 365, n: '1 年' }, { d: 0, n: '永久' }];
  if (!app.key) return toast('管理員 App 尚未建立簽章金鑰，無法開通', 6000);
  const r = await dialog(m.renew ? '續約／變更方案 ' + (m.no || '') : '開通會員', `
    <div class="grid g2" style="gap:10px"><div class="field"><label>使用者代號（空白自動配發）</label><input id="iNo" value="${esc(m.no || '')}"></div><div class="field"><label>名稱</label><input id="iName" value="${esc(m.name || '')}"></div>
    <div class="field"><label>聯絡方式</label><input id="iCt" value="${esc(m.contact || '')}"></div><div class="field"><label>裝置碼（網頁會員或不綁裝置請留空）</label><input id="iDev" value="${esc(m.device || '')}" placeholder="XXXX-XXXX"></div>
    <div class="field"><label>會員等級</label><select id="iTier">${tiers.map((t) => `<option value="${t.id}">${esc(t.name)}${t.desc ? '（' + esc(t.desc) + '）' : ''}</option>`).join('')}</select></div>
    <div class="field"><label>期限</label><select id="iPlan">${plans.map((p) => `<option value="${p.d}">${esc(p.n)}</option>`).join('')}<option value="-1">自訂天數…</option></select><input id="iDays" type="number" min="1" placeholder="天數" style="display:none;margin-top:6px"></div></div>
    <label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" id="iRel" style="width:auto" ${m.renew ? 'disabled' : ''}> 期限自會員啟用日起算（否則自今天起算）</label>
    ${m.renew ? '<div class="small text2" style="margin-top:6px">續約：從目前方案到期日接續計算。</div>' : ''}
    <div class="field" style="margin-top:8px"><label>備註</label><input id="iNote" value="${esc(m.note || '')}"></div><div id="derr" class="small down"></div>`,
  [['', '取消'], ['ok', m.renew ? '送出續約' : '送出開通', 'primary']], (bg) => {
    const tsel = $('#iTier', bg), psel = $('#iPlan', bg);
    const syncDays = () => { const t = tiers.find((x) => String(x.id) === tsel.value); if (t) { const opt = Array.from(psel.options).find((o) => +o.value === t.days); if (opt) psel.value = opt.value; } };
    tsel.onchange = syncDays; syncDays(); psel.onchange = () => { $('#iDays', bg).style.display = psel.value === '-1' ? '' : 'none'; };
    return () => (psel.value === '-1' && !(+$('#iDays', bg).value > 0) ? '請輸入天數' : null);
  });
  if (r.v !== 'ok') return; const b = r.box;
  const days = $('#iPlan', b).value === '-1' ? +$('#iDays', b).value : +$('#iPlan', b).value;
  job('issue', { no: $('#iNo', b).value.trim(), name: $('#iName', b).value.trim(), contact: $('#iCt', b).value.trim(), device: $('#iDev', b).value.trim(), tier: +$('#iTier', b).value, days, rel: $('#iRel', b).checked,
    renew: !!m.renew, request: m.request || '', note: $('#iNote', b).value.trim() }, '已送出開通');
}
/** 會員詳細 */
async function memberDialog(m) {
  if (!m) return; const active = /有效|即將到期/.test(m.status || '');
  const r = await dialog(m.no + '　' + (m.name || ''), `${kv([['狀態', m.status || '—'], ['等級', m.tier || '—'], ['到期', m.expiry || '—'], ['註冊', String(m.registered || '').slice(0, 16)], ['最後上線', String(m.seen || '').slice(0, 16) + (m.version ? '（App ' + m.version + '）' : '')], ['裝置', m.device || '網頁會員（未綁定手機）'],
      ['Google 帳號', m.email || '—'], ['網頁登入', String(m.webLoginAt || '—').slice(0, 16)]])}
    <div class="grid g2" style="gap:10px;margin-top:12px"><div class="field"><label>名稱</label><input id="eN" value="${esc(m.name || '')}"></div><div class="field"><label>聯絡方式</label><input id="eC" value="${esc(m.contact || '')}"></div></div>
    <div class="field"><label>備註</label><input id="eNote" value="${esc(m.note || '')}"></div>
    ${m.code ? `<div class="small muted" style="word-break:break-all">授權碼：${esc(m.code)}</div>` : ''}
    <div class="row wrap" style="gap:6px;margin-top:10px"><button class="btn sm primary" data-act="renew">${active ? '續約／變更方案' : '開通'}</button>${active ? '<button class="btn sm" data-act="revoke">停用授權</button>' : m.status === '停用' ? '<button class="btn sm" data-act="unrevoke">恢復授權</button>' : ''}
      ${m.google ? '<button class="btn sm" data-act="logout">強制登出</button><button class="btn sm" data-act="unlink">解除 Google 綁定</button>' : ''}</div>`,
  [['', '關閉'], ['save', '儲存資料', 'primary']], (bg) => {
    $$('[data-act]', bg).forEach((b) => b.onclick = async () => {
      bg.remove(); const a = b.dataset.act;
      if (a === 'renew') return issueDialog({ ...m, renew: active, device: m.device });
      const label = { revoke: '停用 ' + m.no + ' 的授權？會同時回傳停用名單。', unrevoke: '恢復 ' + m.no + ' 的授權？', logout: '強制登出 ' + m.no + '？', unlink: '解除 ' + m.no + ' 的 Google 帳號綁定？' }[a];
      const c = await dialog('確認', `<div class="text2">${esc(label)}</div>`, [['', '取消'], ['ok', '確定', 'primary']]); if (c.v !== 'ok') return;
      if (a === 'revoke' || a === 'unrevoke') job('revoke', { no: m.no, v: a === 'revoke' }, '已送出');
      else job('account', { no: m.no, unlink: a === 'unlink' }, '已送出');
    });
    return null;
  });
  if (r.v === 'save') job('edit', { no: m.no, name: $('#eN', r.box).value.trim(), contact: $('#eC', r.box).value.trim(), note: $('#eNote', r.box).value.trim() }, '已送出會員資料');
}

async function start() {
  shell(); await refresh();
  clearInterval(S.timer);
  // 一般每 10 秒更新；送出工作後 3 秒一次，直到完成
  let n = 0; S.timer = setInterval(() => { n++; if (document.hidden) return; if (S.fast > 0) { S.fast--; refresh(); } else if (n % 3 === 0) refresh(); }, 3300);
}
function boot() {
  try { const th = JSON.parse(localStorage.getItem('cetf_pref') || '{}').theme; if (th === 'light') document.documentElement.dataset.theme = 'light'; } catch (e) {}
  if (S.ses) start(); else loginView();
}
boot();

// ───────── LINE（與管理員 App「會員 › LINE」相同：連線設定、群發、自動回覆、下載發布、建置素材）─────────
// 網頁開著 LINE 頁時，管理員 App 會回報完整 LINE 狀態；每個動作排成工作（type=line）由 App 執行，權杖只在手機。
const LSECS = ['連線設定', '群發', '自動回覆', '下載發布', '建置素材'];
const LACT = { bc: '群發', validate: '檢查格式', testMe: '傳給自己', cancel: '取消排程', setMe: '設為我', arSave: '套用規則', arDefaults: '還原預設規則', arDeploy: '部署自動回覆', arTest: '測試連線',
  arDisable: '停用自動回覆', arAuto: '自動重新部署', arSync: '同步 App 資料', arAsk: '測試提問', arCheck: '檢查所有問答', arPush: '回覆好友', arReport: '更新盤後報告', notify: '待回覆通知',
  distDrive: '雲端硬碟', distPrefer: '下載連結', distFollow: '檢查最新版', distApk: '上架安裝檔', distAuto: '自動上架', distManual: '上架說明書', distImg: '報表圖', distReport: '上架盤後報告',
  rb: '定時群發設定', rbPreview: '預覽報表', rbMe: '報表傳給自己', rbNow: '立即群發報表', kitDeploy: '部署圖文選單', kitRemove: '移除圖文選單', refresh: '重新整理' };
const fmtT = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const sw = (id, on, label, sub) => `<label class="row" style="gap:10px;margin-top:8px;cursor:pointer;align-items:flex-start"><input type="checkbox" ${id} style="width:auto;margin-top:3px" ${on ? 'checked' : ''}><span class="sp"><span>${label}</span>${sub ? `<br><span class="small muted">${sub}</span>` : ''}</span></label>`;
async function copyTxt(t, msg) { try { await navigator.clipboard.writeText(t); toast(msg || '已複製'); } catch (e) { toast('無法複製，請手動選取'); } }

/** 送出 LINE 動作；結果完成後顯示在頁面上方（有些動作的結果要用對話框看，例如預覽、測試提問） */
async function lineJob(act, payload = {}, opt = {}) {
  const id = await job('line', { act, ...payload }, opt.label || ('已送出「' + (LACT[act] || act) + '」'));
  if (id) { S.lwait = S.lwait || {}; S.lwait[id] = { act, show: !!opt.show, at: Date.now() }; renderLineRes(); }
  return id;
}
/** 檢查送出的 LINE 工作是否完成 */
function lineJobsDone() {
  const w = S.lwait || {}; const jobs = (S.d && S.d.jobs) || []; let changed = false;
  Object.keys(w).forEach((id) => {
    const j = jobs.find((x) => String(x.id) === String(id)); if (!j) { if (Date.now() - w[id].at > 600000) delete w[id]; return; }
    if (j.state === '完成' || j.state === '失敗' || j.state === '已取消') {
      const info = w[id]; const ok = j.state === '完成'; const r = { act: info.act, ok, text: j.result || j.state, at: Date.now() };
      delete w[id]; changed = true; S.lres = r;
      if (info.show && r.ok) dialog(LACT[r.act] || '結果', `<div class="tile" style="white-space:pre-wrap;max-height:60vh;overflow:auto;font-size:13px">${esc(r.text)}</div>`, [['', '關閉']]);
    }
  });
  return changed;
}
function renderLineRes() {
  const el = $('#lres'); if (!el) return;
  const wait = Object.values(S.lwait || {}); const r = S.lres;
  el.innerHTML = (wait.length ? `<div class="notice" style="margin-bottom:10px">⏳ ${wait.map((x) => esc(LACT[x.act] || x.act)).join('、')}：${appOnline() ? '管理員 App 處理中…' : '等待管理員 App 開啟'}</div>` : '') +
    (r && Date.now() - r.at < 120000 ? `<div class="notice ${r.ok ? '' : 'err'}" style="margin-bottom:10px;white-space:pre-wrap">${r.ok ? '✓' : '✗'} ${esc(LACT[r.act] || r.act)}：${esc(String(r.text).slice(0, 600))}</div>` : '');
}
function lineFocused() { const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $('#view') && $('#view').contains(a); }

function renderLine(v, app) {
  const L = S.d.line; const base = app.line || {};
  S.lsec = S.lsec == null ? store.get('lsec', 0) : S.lsec;
  if (L && L.ar && !S.lrDirty) { try { S.lr = JSON.parse(L.ar.rules || '{}'); } catch (e) { S.lr = null; } }
  const seen = store.get('inboxSeen', 0); const unread = L ? (L.inbox || []).filter((m) => m.at > seen && !String(m.t).startsWith('（')).length : 0;
  const head = `<div class="adm-tabs" style="margin-bottom:10px">${LSECS.map((n, i) => `<button data-ls="${i}" class="${S.lsec === i ? 'on' : ''}">${n}${i === 2 && unread && S.lsec !== 2 ? `<span class="cnt">${unread}</span>` : ''}</button>`).join('')}
    <span class="sp"></span><button class="btn sm" id="lrf">重新整理</button></div><div id="lres"></div>`;
  if (!L) {
    v.innerHTML = head + `<div class="card"><h2>LINE 官方帳號</h2>${base.name ? kv([['名稱', base.name], ['ID', base.id], ['好友數（前一日）', base.friends >= 0 ? base.friends : '—']]) : ''}
      <div class="notice" style="margin-top:10px">${appOnline() ? '正在向管理員 App 取得完整 LINE 資料（約 10–20 秒）…' : '📱 管理員 App 開啟後會回報完整 LINE 資料；所有 LINE 功能都由 App 執行（權杖只在手機）。'}</div>
      ${(S.d.version || 0) < 12 ? '<div class="notice err" style="margin-top:8px">雲端會員伺服器需更新到第 12 版才能在網頁使用完整 LINE 功能：管理員 App「會員 › 發布 › 一鍵發布及部署」或「設定與備份 › 雲端會員伺服器 › 一鍵更新」。</div>' : ''}</div>`;
    bindLineHead(v); renderLineRes(); return;
  }
  const sec = [lineSetup, lineBroadcast, lineAuto, lineDist, lineKit][S.lsec] || lineSetup;
  const needTok = !L.token && S.lsec !== 0;
  v.innerHTML = head + (needTok ? '<div class="card"><div class="notice err">管理員 App 尚未設定 LINE 頻道存取權杖：請在 App「會員 › LINE › 連線設定」輸入（權杖不經過網頁）。</div></div>' : sec.html(L));
  bindLineHead(v); if (!needTok) sec.bind(v, L); renderLineRes();
  if (S.lsec === 2) store.set('inboxSeen', Date.now());
}
function bindLineHead(v) {
  $$('[data-ls]', v).forEach((b) => b.onclick = () => { S.lsec = +b.dataset.ls; store.set('lsec', S.lsec); render(); });
  $('#lrf').onclick = () => lineJob('refresh', {}, { label: '已要求管理員 App 重新整理 LINE 資料' });
}

// ── ① 連線設定：帳號、額度、好友數據、管理入口 ──
const lineSetup = {
  html(L) {
    const i = L.info; const ins = L.insight;
    let quota = '';
    if (i && i.friends > 0 && i.left >= 0) {
      const t = new Date(); const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); const days = dim - t.getDate() + 1;
      let wd = 0; for (let k = 0; k < days; k++) { const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + k).getDay(); if (d >= 1 && d <= 5) wd++; }
      const times = Math.floor(i.left / i.friends);
      quota = `<div class="small ${times < 3 ? 'up' : 'muted'}" style="margin-top:6px">本月還可群發約 ${times} 次（每次 ${i.friends} 則）· 到月底平均每天 ${Math.floor(i.left / days)} 則${L.rb && L.rb.on && times < wd ? `<br>⚠ 每日盤後群發到月底約需 ${i.friends * wd} 則（${wd} 個交易日），額度不足` : ''}</div>`;
    }
    let insH = '<div class="small muted">讀取中…（LINE 每天更新前一日統計）</div>';
    if (ins && ins.days) {
      const d = ins.days; if (!d.length) insH = '<div class="small muted">尚無統計（新帳號隔天起才有資料）</div>';
      else {
        const last = d[d.length - 1], first = d[0], g = last[1] - first[1];
        const mx = Math.max(...d.map((x) => x[1]), 1), mn = Math.min(...d.map((x) => x[1]));
        insH = `${kv([['好友', last[1] + ' 人'], [d.length + ' 天增減', (g >= 0 ? '+' : '') + g], ['可傳送', last[2] + ' 人'], ['封鎖', last[3] + ' 人' + (last[3] - first[3] > 0 ? '（+' + (last[3] - first[3]) + '）' : '')]])}
          ${ins.sent != null ? `<div class="small muted" style="margin-top:6px">昨日群發送達 ${ins.sent} 人</div>` : ''}
          <div style="display:flex;align-items:flex-end;gap:3px;height:56px;margin-top:8px">${d.map((x) => `<div title="${x[0]}：${x[1]} 人" style="flex:1;height:${mx === mn ? 100 : 25 + 75 * (x[1] - mn) / (mx - mn)}%;background:var(--primary);opacity:.55;border-radius:3px"></div>`).join('')}</div>
          <div class="row small muted"><span class="sp">${d[0][0].slice(5).replace('-', '/')}</span><span>${last[0].slice(5).replace('-', '/')}</span></div>
          ${ins.demo ? [['性別', ins.demo.g], ['年齡', ins.demo.a], ['地區', ins.demo.r]].filter((x) => x[1] && x[1].length).map(([n, l]) => `<div class="small text2">${n}：${l.slice(0, 4).map((y) => esc(y[0]) + ' ' + y[1] + '%').join('、')}</div>`).join('') : ''}`;
      }
    }
    const steps = ['1. LINE 官方帳號 App › 設定 › Messaging API › 啟用，建立服務提供者。', '2. developers.line.biz › 頻道 › Messaging API › Channel access token 按 Issue。',
      '3. 在管理員 App「會員 › LINE › 連線設定」貼上權杖（以裝置加密保存，不經過網頁、不進備份）。', '4. 「自動回覆」輸入 Cloudflare 帳戶 ID、API 權杖與 Channel secret 後一鍵部署；「下載發布」上架安裝檔與說明書；「建置素材」部署圖文選單。'];
    return `<div class="grid g2 stack"><div class="card"><h2>LINE 官方帳號連線</h2>
        ${L.token ? (i ? `<div class="up" style="font-weight:700">✓ ${esc(i.name)}（${esc(i.id)}）</div>${kv([['本月已用', i.used + ' 則'], ['額度', i.limit >= 0 ? i.limit + ' 則（剩 ' + i.left + ' 則）' : '無上限方案'], ['好友', i.friends >= 0 ? i.friends + ' 人' : '統計中'], ['我的 LINE', L.me && L.me.id ? (L.me.name || '已設定') : '未設定（收件匣按「設為我」）']])}${quota}` : '<div class="small muted">已設定權杖，查詢中…</div>')
          : '<div class="notice err">管理員 App 尚未設定 LINE 頻道存取權杖。</div>'}
        <div class="small muted" style="margin-top:8px">權杖、Cloudflare 與 Channel secret 只能在管理員 App 輸入，網頁不會接觸到。</div></div>
      <div class="card"><h2>設定步驟</h2>${steps.map((s) => `<div class="small text2" style="margin-top:4px">${esc(s)}</div>`).join('')}</div>
      ${L.token ? `<div class="card"><h2>好友數據</h2><div class="small muted" style="margin-bottom:6px">LINE 每天更新前一日統計；好友 20 人以上才提供屬性分析。</div>${insH}</div>` : ''}
      <div class="card"><h2>管理入口</h2><div class="small muted">一對一聊天、自動回應、加入好友歡迎訊息、大頭貼與主頁，LINE 只開放在官方帳號後台設定。</div>
        <div class="row wrap" style="gap:8px;margin-top:10px"><a class="btn primary" href="https://manager.line.biz/" target="_blank" rel="noopener">管理後台</a><a class="btn" href="https://chat.line.biz/" target="_blank" rel="noopener">聊天</a>
          <a class="btn" href="https://developers.line.biz/console/" target="_blank" rel="noopener">Developers</a>${i && i.id ? `<a class="btn" href="https://line.me/R/ti/p/${encodeURIComponent(i.id)}" target="_blank" rel="noopener">好友連結</a>` : ''}</div></div></div>`;
  },
  bind() {},
};

// ── ② 群發：每日盤後報表定時群發、群發訊息（文字／按鈕卡片、排程）、排程中、傳送紀錄 ──
const lineBroadcast = {
  html(L) {
    const B = S.bc = S.bc || { kind: 'text', text: '', title: '', button: '下載 App', url: (L.links || {}).download || '', later: false, at: '' };
    const rb = L.rb || {}; const i = L.info || {};
    const est = i.friends > 0 ? ` · 預計使用 ${i.friends} 則` + (i.left >= 0 ? (i.friends > i.left ? `（超過剩餘 ${i.left} 則！）` : `，送出後剩 ${i.left - i.friends} 則`) : '') : '';
    const times = [[15, 0], [16, 0], [17, 0], [17, 30], [18, 0], [19, 0], [20, 0], [21, 0]];
    return `<div class="grid g2 stack"><div class="card"><h2>每日盤後報表定時群發</h2><div class="small muted">交易日於指定時間自動產生報表並群發摘要給所有好友；休市日不發，同一天只發一次。</div>
        ${sw('data-rbon', rb.on, '開啟定時群發')}
        ${rb.on ? `<div class="small text2" style="margin-top:8px">群發時間（台灣時間）</div><div class="row wrap" style="gap:6px;margin-top:4px">${times.map(([h, m]) => `<button class="btn sm ${rb.h === h && rb.m === m ? 'primary' : ''}" data-rbt="${h}:${m}">${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}</button>`).join('')}</div>
          <div class="small muted" style="margin-top:6px">證交所約 15:00、三大法人約 16:30 公布；建議 17:00 之後。開啟管理員版時若已逾時會自動補發。<br>上次群發：${esc(rb.last || '尚未群發')}</div>` : ''}
        ${rb.result ? `<div class="small text2" style="margin-top:6px">${esc(rb.result)}</div>` : ''}
        <div class="row wrap" style="gap:8px;margin-top:10px"><button class="btn" id="rbp">預覽內容</button><button class="btn" id="rbme">傳給自己</button><button class="btn primary" id="rbnow">立即群發今日</button></div></div>
      <div class="card"><h2>群發訊息</h2><div class="small muted">傳給所有加入官方帳號的好友；每位好友計 1 則額度。</div>
        <div class="row wrap" style="gap:6px;margin-top:8px">${(L.tpl || []).map((t, k) => `<button class="btn sm" data-tpl="${k}">${esc(t[0])}</button>`).join('')}</div>
        <div class="seg" style="margin-top:8px;display:inline-flex"><button data-bk="text" class="${B.kind === 'text' ? 'on' : ''}">純文字</button><button data-bk="card" class="${B.kind === 'card' ? 'on' : ''}">按鈕卡片</button></div>
        ${B.kind === 'card' ? `<div class="field" style="margin-top:8px"><label>卡片標題</label><input data-bf="title" maxlength="80" value="${esc(B.title)}"></div>` : ''}
        <div class="field" style="margin-top:8px"><label>${B.kind === 'card' ? '卡片內文' : '訊息內容'}</label><textarea data-bf="text" rows="${B.kind === 'card' ? 4 : 7}" maxlength="${B.kind === 'card' ? 1500 : 4900}">${esc(B.text)}</textarea></div>
        ${B.kind === 'card' ? `<div class="grid g2" style="gap:8px"><div class="field"><label>按鈕文字</label><input data-bf="button" maxlength="20" value="${esc(B.button)}"></div><div class="field"><label>按鈕連結</label><input data-bf="url" value="${esc(B.url)}"></div></div>
          <div class="row" style="gap:6px"><button class="btn sm" data-lk="download">下載頁</button><button class="btn sm" data-lk="manual">說明書</button></div>` : ''}
        <div class="small muted" id="bcn" style="margin-top:6px">${B.text.length} 字${est}</div>
        ${sw('data-later', B.later, '排程群發', '由手機在指定時間送出（需開機連網；省電模式可能延後幾分鐘，開啟管理員版時會補發）')}
        ${B.later ? `<div class="field" style="margin-top:6px"><label>日期與時間（台灣時間）</label><input type="datetime-local" data-bf="at" value="${esc(B.at)}"></div>` : ''}
        <div class="row wrap" style="gap:8px;margin-top:10px"><button class="btn" id="bcv">檢查格式</button><button class="btn" id="bcme">傳給自己</button><span class="sp"></span><button class="btn primary" id="bcs">${B.later ? '加入排程' : '群發給所有好友'}</button></div></div></div>
      ${(L.sched || []).length ? `<div class="card" style="margin-top:12px"><h2>排程中<span class="r small muted">${L.sched.length} 則</span></h2>${L.sched.map((s) => `<div class="tile" style="margin-top:8px"><div class="row"><span class="sp small muted">${fmtT(s.at)} · ${s.kind === 'card' ? '按鈕卡片' : '文字'}</span><button class="btn sm" data-scx="${s.id}">取消</button></div><div class="small" style="white-space:pre-wrap">${esc((s.kind === 'card' ? s.title + '\n' : '') + s.text).slice(0, 300)}</div></div>`).join('')}</div>` : ''}
      ${(L.hist || []).length ? `<div class="card" style="margin-top:12px"><h2>傳送紀錄<span class="r small muted">點一下帶入重發</span></h2>${L.hist.map((h, k) => `<div class="tile" style="margin-top:8px;cursor:pointer" data-hi="${k}"><div class="small muted">${fmtT(h.at)}</div><div class="small" style="white-space:pre-wrap">${esc(h.text.slice(0, 300))}</div></div>`).join('')}</div>` : ''}`;
  },
  bind(v, L) {
    const B = S.bc; const re = () => render();
    const payload = () => ({ kind: B.kind, text: B.text.trim(), title: B.title, button: B.button, url: B.url });
    $$('[data-bf]', v).forEach((el) => el.oninput = () => { B[el.dataset.bf] = el.value; if (el.dataset.bf === 'text') { const n = $('#bcn', v); if (n) n.textContent = B.text.length + ' 字'; } });
    $$('[data-bk]', v).forEach((b) => b.onclick = () => { B.kind = b.dataset.bk; re(); });
    $$('[data-tpl]', v).forEach((b) => b.onclick = () => { B.text = L.tpl[+b.dataset.tpl][1]; re(); });
    $$('[data-lk]', v).forEach((b) => b.onclick = () => { const k = b.dataset.lk; B.button = k === 'download' ? '下載 App' : '使用說明'; B.url = (L.links || {})[k] || ''; re(); });
    $('[data-later]', v).onchange = (e) => { B.later = e.target.checked; if (B.later && !B.at) { const d = new Date(Date.now() + 3600000); d.setMinutes(0); B.at = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); } re(); };
    $('#bcv').onclick = () => { if (!B.text.trim()) return toast('請輸入訊息內容'); lineJob('validate', payload()); };
    $('#bcme').onclick = () => { if (!B.text.trim()) return toast('請輸入訊息內容'); lineJob('testMe', payload()); };
    $('#bcs').onclick = async () => {
      if (!B.text.trim()) return toast('請輸入訊息內容');
      if (B.kind === 'card' && !/^https:\/\//.test(B.url)) return toast('按鈕連結需為 https:// 網址');
      if (B.later) {
        const at = new Date(B.at).getTime(); if (!at || at <= Date.now()) return toast('排程時間必須晚於現在');
        if (await lineJob('bc', { ...payload(), at })) { B.text = ''; re(); } return;
      }
      const i = L.info || {};
      const c = await dialog('確認群發', `<div class="text2">將傳給所有好友${i.friends > 0 ? `（約 ${i.friends} 人，使用 ${i.friends} 則額度）` : ''}，送出後無法收回。</div><div class="tile" style="margin-top:8px;white-space:pre-wrap">${esc((B.kind === 'card' ? '【卡片】' + B.title + '\n' : '') + B.text)}</div>`, [['', '取消'], ['ok', '送出', 'primary']]);
      if (c.v === 'ok' && await lineJob('bc', payload())) { B.text = ''; re(); }
    };
    $$('[data-scx]', v).forEach((b) => b.onclick = () => lineJob('cancel', { id: Number(b.dataset.scx) }));
    $$('[data-hi]', v).forEach((el) => el.onclick = () => { B.kind = 'text'; B.text = L.hist[+el.dataset.hi].text; re(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('[data-rbon]', v).onchange = (e) => lineJob('rb', { on: e.target.checked });
    $$('[data-rbt]', v).forEach((b) => b.onclick = () => { const [h, m] = b.dataset.rbt.split(':').map(Number); lineJob('rb', { on: true, h, m }); });
    $('#rbp').onclick = () => lineJob('rbPreview', {}, { show: true });
    $('#rbme').onclick = () => lineJob('rbMe');
    $('#rbnow').onclick = async () => { const c = await dialog('立即群發今日報表', '<div class="text2">產生今日盤後報表並群發給所有好友（每位好友計 1 則額度）。</div>', [['', '取消'], ['ok', '群發', 'primary']]); if (c.v === 'ok') lineJob('rbNow'); };
  },
};

// ── ③ 自動回覆：規則、歡迎／預設／非服務時間、智慧問答、部署與狀態、收件匣 ──
const KINDN = { TEXT: '文字', CARD: '按鈕卡片', REPORT: '盤後報告' };
function ruleDialog(r, isNew) {
  const x = { id: r.id, k: (r.k || []).slice(), c: !!r.c, kind: r.kind || 'TEXT', t: r.t || '', ti: r.ti || '', b: r.b || '', u: r.u || '', off: !!r.off, fr: r.fr || '', to: r.to || '' };
  return dialog(isNew ? '新增規則' : '編輯規則', `<div class="field"><label>關鍵字（多個用頓號或逗號分隔）</label><input id="rk" value="${esc(x.k.join('、'))}"></div>
    <label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" id="rc" style="width:auto" ${x.c ? 'checked' : ''}> 訊息「包含」關鍵字就回覆（未勾選＝完全相同）</label>
    <div class="field" style="margin-top:8px"><label>回覆類型</label><select id="rkind">${Object.entries(KINDN).map(([k, n]) => `<option value="${k}" ${x.kind === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="field" id="rti"><label>卡片標題</label><input id="rtt" value="${esc(x.ti)}" maxlength="80"></div>
    <div class="field"><label id="rtl">回覆內容</label><textarea id="rt" rows="5" maxlength="4900">${esc(x.t)}</textarea><div class="small muted">{name} 好友名稱；{price:2330}、{pct:2330}、{chg:2330} 即時股價、漲跌幅、漲跌；{download}、{manual} 下載與說明書連結</div></div>
    <div class="grid g2" id="rbu" style="gap:8px"><div class="field"><label>按鈕文字</label><input id="rb" value="${esc(x.b)}" maxlength="20"></div><div class="field"><label>按鈕連結</label><input id="ru" value="${esc(x.u)}"></div></div>
    <div class="grid g2" style="gap:8px"><div class="field"><label>生效起（yyyy/MM/dd，空白＝即日）</label><input id="rfr" value="${esc(x.fr)}" placeholder="2026/12/01"></div><div class="field"><label>生效迄（空白＝不限）</label><input id="rto" value="${esc(x.to)}" placeholder="2026/12/31"></div></div>
    <label class="row small" style="gap:6px;cursor:pointer;margin-top:6px"><input type="checkbox" id="roff" style="width:auto" ${x.off ? 'checked' : ''}> 暫停這條規則</label><div id="derr" class="small up"></div>`,
  isNew ? [['', '取消'], ['ok', '加入', 'primary']] : [['del', '刪除'], ['', '取消'], ['ok', '儲存', 'primary']], (bg) => {
    const sync = () => { const k = $('#rkind', bg).value; $('#rti', bg).style.display = k === 'CARD' ? '' : 'none'; $('#rbu', bg).style.display = k === 'CARD' ? '' : 'none'; $('#rtl', bg).textContent = k === 'REPORT' ? '前言（選填，放在報告前面）' : k === 'CARD' ? '卡片內文' : '回覆內容'; };
    $('#rkind', bg).onchange = sync; sync();
    return (val) => {
      if (val !== 'ok') return null;
      const keys = $('#rk', bg).value.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean);
      if (!keys.length) return '請輸入關鍵字';
      const kind = $('#rkind', bg).value;
      if (kind !== 'REPORT' && !$('#rt', bg).value.trim()) return '請輸入回覆內容';
      if (kind === 'CARD' && !/^(https:\/\/|\{download\}|\{manual\})/.test($('#ru', bg).value.trim())) return '按鈕連結需為 https:// 網址或 {download}／{manual}';
      const dt = /^(\d{4}\/\d{2}\/\d{2})?$/; if (!dt.test($('#rfr', bg).value.trim()) || !dt.test($('#rto', bg).value.trim())) return '日期格式請用 yyyy/MM/dd';
      return null;
    };
  }).then((r2) => {
    if (r2.v === 'del') return { del: true };
    if (r2.v !== 'ok') return null;
    const b = r2.box;
    return { id: x.id, k: $('#rk', b).value.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean), c: $('#rc', b).checked, kind: $('#rkind', b).value, t: $('#rt', b).value, ti: $('#rtt', b).value.trim(),
      b: $('#rb', b).value.trim(), u: $('#ru', b).value.trim(), off: $('#roff', b).checked, fr: $('#rfr', b).value.trim(), to: $('#rto', b).value.trim() };
  });
}
async function editRule(r, isNew) {
  const n = await ruleDialog(r, isNew); if (!n) return;
  const R = S.lr; R.rules = R.rules || [];
  if (n.del) R.rules = R.rules.filter((x) => x.id !== r.id);
  else if (R.rules.some((x) => x.id === n.id)) R.rules = R.rules.map((x) => (x.id === n.id ? n : x)); else R.rules.push(n);
  S.lrDirty = true; render();
}
function newRule(key) { const R = S.lr || { rules: [] }; return { id: (R.rules || []).reduce((m, x) => Math.max(m, x.id || 0), 0) + 1, k: [key || ''], c: false, kind: 'TEXT', t: '' }; }
/** 收件匣依 LINE 好友（ID）收合：每位好友一列，顯示則數、待回覆數與最新一則，點開看全部訊息（索引對應 list） */
const ibNeed = (m) => !m.g || m.g === '預設回覆' || String(m.g).includes('失敗');
function ibGroups(list, L) {
  const open = S.ibOpen = S.ibOpen || new Set(); const by = new Map();
  list.forEach((m, k) => { const u = m.u || '?'; if (!by.has(u)) by.set(u, []); by.get(u).push([m, k]); });
  const gs = Array.from(by.entries()).sort((a, b) => Math.max(...b[1].map(([m]) => m.at)) - Math.max(...a[1].map(([m]) => m.at)));
  return `<div class="small muted" style="margin-top:8px">${gs.length} 位好友 · ${list.length} 則訊息</div>` + gs.slice(0, 80).map(([u, arr]) => {
    arr.sort((a, b) => b[0].at - a[0].at); const [last, lk] = arr[0]; const name = (arr.find(([m]) => m.n) || [{}])[0].n || '好友';
    const need = arr.filter(([m]) => ibNeed(m)).length; const on = open.has(u); const me = L.me && L.me.id === u;
    return `<div class="tile" style="margin-top:6px;padding:0"><div class="row" data-ibg="${esc(u)}" style="cursor:pointer;padding:10px 12px;align-items:flex-start">
        <div class="sp"><div class="row" style="gap:6px;justify-content:flex-start"><b>${esc(name)}</b><span class="tag" style="color:var(--primary);border-color:var(--primary)">${arr.length} 則</span>${need ? `<span class="tag up" style="border-color:currentColor">待回 ${need}</span>` : ''}${me ? '<span class="small" style="color:var(--primary)">我</span>' : ''}</div>
          <div class="small muted">ID …${esc(String(u).slice(-6))} · ${fmtT(last.at)}</div>${on ? '' : `<div class="small text2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(last.t)}</div>`}</div>
        <span class="muted small">${on ? '▲' : '▼'}</span></div>
      ${on ? `<div style="padding:0 12px 10px">${last.g !== '封鎖' && u !== '?' ? `<div class="row" style="gap:6px;justify-content:flex-start;margin-bottom:6px"><button class="btn sm" data-ibr="${lk}">回覆</button><button class="btn sm" data-ibm="${lk}">${me ? '✓ 我' : '設為我'}</button></div>` : ''}
        ${arr.slice(0, 40).map(([m, k]) => `<div class="row" style="align-items:flex-start;padding:6px 0;border-top:1px solid var(--border)"><div class="sp"><div class="small ${ibNeed(m) ? 'up' : 'muted'}">${fmtT(m.at)} · ${esc(m.g || '未自動回覆')}</div><div class="small" style="white-space:pre-wrap">${esc(m.t)}</div></div>
          ${!/^[（［]/.test(m.t) && !String(m.g).startsWith('關鍵字') ? `<button class="btn sm" data-ibk="${k}">＋規則</button>` : ''}</div>`).join('')}
        ${arr.length > 40 ? '<div class="small muted">（只顯示最近 40 則）</div>' : ''}</div>` : ''}</div>`;
  }).join('');
}
function inboxCat(t) { return t.startsWith('關鍵字') ? '關鍵字' : t === '智慧問答' ? '智慧問答' : t === '預設回覆' ? '預設回覆' : t.includes('失敗') ? '回覆失敗' : !t ? '未回覆' : '其他'; }

const lineAuto = {
  html(L) {
    const A = L.ar || {}; const R = S.lr || { rules: [] }; const dep = A.at > 0;
    const sm = R.sCfg || {}; const smart = (k) => sm[k] !== false;
    const ruleList = (R.rules || []).map((r) => `<div class="tile" style="margin-top:6px;cursor:pointer" data-re="${r.id}"><div class="row"><b class="sp" style="${r.off ? 'opacity:.5' : ''}">${esc((r.k || []).join('／'))}${r.c ? '（包含）' : ''}</b><span class="small" style="color:var(--primary)">編輯</span></div>
      <div class="small muted">${r.kind === 'REPORT' ? '回覆最新盤後報告' + (r.t ? '＋前言' : '') : r.kind === 'CARD' ? '按鈕卡片：' + esc(r.ti) : esc(String(r.t || '').replace(/\n/g, ' ').slice(0, 60))}${r.fr || r.to ? ' · ' + esc(r.fr || '即日') + '～' + esc(r.to || '不限') : ''}${r.off ? ' · 已停用' : ''}</div></div>`).join('');
    // 收件匣統計（近 7 天）
    const inbox = L.inbox || []; const wk = inbox.filter((m) => m.at >= Date.now() - 7 * 864e5); const msgs = wk.filter((m) => !String(m.t).startsWith('（'));
    let stats = '';
    if (msgs.length) {
      const by = {}; msgs.forEach((m) => { const c = inboxCat(m.g || ''); by[c] = (by[c] || 0) + 1; });
      const hit = msgs.filter((m) => ['關鍵字', '智慧問答'].includes(inboxCat(m.g || ''))).length; const rate = Math.round(hit * 100 / msgs.length);
      const miss = {}; msgs.filter((m) => ['預設回覆', '未回覆'].includes(inboxCat(m.g || ''))).forEach((m) => { const q = String(m.t).trim(); if (q.length >= 1 && q.length <= 30) miss[q] = (miss[q] || 0) + 1; });
      const top = Object.entries(miss).sort((a, b) => b[1] - a[1]).slice(0, 5);
      stats = `<div class="tile" style="margin-top:8px"><b>近 7 天</b><div class="small text2">訊息 ${msgs.length} 則 · 好友 ${new Set(wk.map((m) => m.u)).size} 人 · 加入 ${wk.filter((m) => m.g === '加入好友').length} · 封鎖 ${wk.filter((m) => m.g === '封鎖').length}</div>
        <div class="small text2">${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + Math.round(n * 100 / msgs.length) + '%').join('　')}</div>
        <div class="small ${rate >= 70 ? 'down' : 'up'}">自動回答率 ${rate}%</div>
        ${top.length ? `<div class="small muted" style="margin-top:4px">沒對到的常見問題（點一下建立規則）</div>${top.map(([q, n]) => `<div class="small" style="cursor:pointer;color:var(--primary)" data-mk="${esc(q)}">・${esc(q)}（${n} 次）＋規則</div>`).join('')}` : ''}</div>`;
    }
    const F = S.ibf = S.ibf || { q: '', f: 0 };
    const list = inbox.filter((m) => !F.q || [m.t, m.n, m.g].some((x) => String(x || '').toLowerCase().includes(F.q.toLowerCase())))
      .filter((m) => F.f === 0 || (F.f === 1 && (!m.g || m.g === '預設回覆' || String(m.g).includes('失敗'))) || (F.f === 2 && m.g === '智慧問答')).slice(0, 400);
    return `<div class="card"><h2>自動回覆（Webhook）<span class="r small ${dep ? 'down' : 'muted'}">${dep ? '● 運作中 · 關鍵字 ' + (R.rules || []).filter((r) => !r.off).length + ' 組' : '尚未部署'}</span></h2>
        <div class="small muted">關鍵字回覆、加入好友歡迎、盤後報告即時查詢、智慧問答；回覆不扣訊息額度。${A.creds ? '' : '<br><span class="up">管理員 App 尚未設定 Cloudflare 帳戶 ID、API 權杖與 LINE Channel secret（請在 App「會員 › LINE › 自動回覆」輸入）。</span>'}</div></div>
      <div class="grid g2 stack" style="margin-top:12px"><div class="card"><h2>回覆規則${S.lrDirty ? '<span class="r small up">未套用</span>' : ''}</h2>
        <div class="small muted">由上而下比對，對到第一組就回覆。{name} 換成好友名稱；{price:2330}、{pct:2330}、{chg:2330} 換成即時股價、漲跌幅、漲跌。</div>
        ${ruleList || '<div class="small muted" style="margin-top:6px">尚無規則</div>'}
        <div class="row wrap" style="gap:8px;margin-top:8px"><button class="btn" id="radd">＋ 新增規則</button><button class="btn" id="rdef">還原預設</button><button class="btn" id="rexp">匯出規則</button><button class="btn" id="rimp">匯入規則</button></div>
        ${sw('data-wo', R.wOn !== false, '加入好友歡迎訊息')}${R.wOn !== false ? `<textarea data-rf="w" rows="3" style="margin-top:4px">${esc(R.w || '')}</textarea>` : ''}
        ${sw('data-fo', R.fOn !== false, '沒對到關鍵字時的預設回覆', '同一位好友 6 小時內只回一次，不會洗版')}${R.fOn !== false ? `<textarea data-rf="f" rows="3" style="margin-top:4px">${esc(R.f || '')}</textarea>` : ''}
        ${sw('data-oo', !!R.oOn, '非服務時間回覆', '服務時間外沒對到關鍵字時，改送這則（同一位好友 6 小時內一次）')}
        ${R.oOn ? `<div class="grid g2" style="gap:8px;margin-top:4px"><div class="field"><label>開始 HH:mm</label><input data-rf="oS" value="${esc(R.oS || '21:00')}"></div><div class="field"><label>結束 HH:mm</label><input data-rf="oE" value="${esc(R.oE || '09:00')}"></div></div>
          ${sw('data-ow', R.oW !== false, '週末全天算非服務時間')}<textarea data-rf="oT" rows="3" style="margin-top:4px">${esc(R.oT || '')}</textarea>` : ''}
        <button class="btn primary" id="rsave" style="margin-top:12px;width:100%">${dep ? '儲存並套用規則' : '儲存規則'}</button></div>
      <div class="card"><h2>智慧問答</h2><div class="small muted">沒對到關鍵字時，自動辨識問題並查即時行情與 App 資料回覆（附快速回覆按鈕）。</div>
        ${sw('data-so', R.sOn !== false, '開啟智慧問答')}
        ${R.sOn !== false ? (A.smart || []).map(([k, n, ex]) => sw(`data-sk="${esc(k)}"`, smart(k), esc(n), '例：' + esc(ex))).join('') : ''}
        <div class="small muted" style="margin-top:6px">代號名稱、除權息、歷史股利、休市日與盤後摘要由管理員 App 同步${A.smartAt ? '（上次 ' + fmtT(A.smartAt) + '）' : '（尚未同步）'}；改動開關後按左側「儲存並套用規則」。</div>
        ${dep ? `<div class="row wrap" style="gap:8px;margin-top:8px"><button class="btn" id="asy">立即同步 App 資料</button><button class="btn" id="achk">一鍵檢查所有問答</button></div>
          <div class="small text2" style="margin-top:10px">測試提問（不經 LINE、不扣額度；規則需先套用）</div>
          <div class="row" style="gap:6px;margin-top:4px"><input id="aq" placeholder="例：0056 股息" value="${esc(S.aq || '')}"><button class="btn" id="aqs">送出</button></div>
          <div class="row wrap" style="gap:4px;margin-top:4px">${['加權指數', '2330', '0056 股息', '本週除息', '明天有開盤嗎'].map((q) => `<button class="btn sm" data-aqx="${q}">${q}</button>`).join('')}</div>` : ''}</div></div>
      <div class="card" style="margin-top:12px"><h2>部署與狀態</h2>
        ${dep ? kv([['網址', A.url], ['上次部署', fmtT(A.at)], ['已部署版本', (A.app || '未記錄') + (A.hash ? '（' + A.hash.slice(0, 7) + '）' : '')], ['App 內版本', 'v' + A.appVer + '（' + String(A.bundled || '').slice(0, 7) + '）']]) : '<div class="small muted">尚未部署</div>'}
        ${dep ? `<div class="small ${A.stale ? 'up' : 'muted'}" style="margin-top:6px">${A.stale ? '⚠ 發佈站程式不是最新版，按「重新部署」更新' : '✓ 發佈站程式是最新版'}</div>` : ''}
        ${A.autoLog ? `<div class="small muted">上次自動部署 ${fmtT(A.autoLog[0])}：${esc(A.autoLog[1])}</div>` : ''}
        <div class="row wrap" style="gap:8px;margin-top:10px"><button class="btn ${dep ? '' : 'primary'}" id="adep" ${A.ready ? '' : 'disabled'}>${dep ? '重新部署' : '一鍵部署'}</button>${dep ? '<button class="btn" id="atest">測試連線</button><button class="btn" id="arep">更新盤後報告</button><button class="btn" id="adis">停用</button>' : ''}</div>
        ${dep ? sw('data-aauto', A.auto, '新版更新後自動重新部署', '安裝新的管理員版後，在背景自動上傳新版自動回覆程式，完成後發通知') : ''}
        ${dep && smart('alert') ? `<div class="small muted" style="margin-top:6px">到價提醒：${A.subs >= 0 ? A.subs + ' 位好友訂閱中' : '讀取中…'}；本月剩餘額度少於 30 則時自動暫停推播，保留給群發。</div>` : ''}
        ${dep ? '<div class="small muted" style="margin-top:4px">報表定時群發時會同步更新「盤後報告」的回覆內容。</div>' : ''}</div>
      ${dep ? `<div class="card" style="margin-top:12px"><h2>收件匣<span class="r small muted">最近 ${inbox.length} 則</span></h2>
        <div class="small muted">好友傳來的訊息與自動回覆結果；可直接回覆（主動傳送會扣訊息額度）。</div>
        ${sw('data-ntf', A.notify, '待回覆訊息通知', '每 15 分鐘檢查，好友訊息沒被自動回答時在手機通知你')}
        ${stats}
        <div class="row wrap" style="gap:8px;margin-top:10px"><input id="ibq" placeholder="搜尋訊息、好友名稱" value="${esc(F.q)}" style="flex:1;min-width:180px">
          <div class="seg">${['全部', '需人工回覆', '智慧問答'].map((n, k) => `<button data-ibf="${k}" class="${F.f === k ? 'on' : ''}">${n}</button>`).join('')}</div><button class="btn sm" id="ibcsv">匯出 CSV</button></div>
        ${list.length ? ibGroups(list, L) : '<div class="small muted" style="margin-top:8px">目前沒有訊息</div>'}</div>` : ''}`;
  },
  bind(v, L) {
    const R = S.lr = S.lr || { rules: [] }; const dirty = () => { S.lrDirty = true; };
    const F = S.ibf; const inbox = L.inbox || [];
    const list = inbox.filter((m) => !F.q || [m.t, m.n, m.g].some((x) => String(x || '').toLowerCase().includes(F.q.toLowerCase())))
      .filter((m) => F.f === 0 || (F.f === 1 && (!m.g || m.g === '預設回覆' || String(m.g).includes('失敗'))) || (F.f === 2 && m.g === '智慧問答')).slice(0, 400);
    $$('[data-re]', v).forEach((el) => el.onclick = () => editRule(R.rules.find((x) => String(x.id) === el.dataset.re), false));
    $('#radd', v).onclick = () => editRule(newRule(''), true);
    $('#rdef', v).onclick = async () => { const c = await dialog('還原預設規則', '<div class="text2">目前的規則會被預設規則取代（已部署時會直接套用）。</div>', [['', '取消'], ['ok', '還原', 'primary']]); if (c.v === 'ok') { S.lrDirty = false; lineJob('arDefaults'); } };
    $('#rexp', v).onclick = () => copyTxt('CETF-RULES:' + JSON.stringify(R), '已複製規則備份，可貼到記事本保存');
    $('#rimp', v).onclick = async () => {
      const c = await dialog('匯入規則', '<div class="small text2">貼上以 CETF-RULES: 開頭的規則備份：</div><textarea id="rimt" rows="6" style="margin-top:6px"></textarea><div id="derr" class="small up"></div>', [['', '取消'], ['ok', '匯入', 'primary']],
        (bg) => (val) => { if (val !== 'ok') return null; try { const o = JSON.parse($('#rimt', bg).value.trim().replace(/^CETF-RULES:/, '')); return o.rules ? null : '格式不符'; } catch (e) { return '格式不符（請貼上以 CETF-RULES: 開頭的文字）'; } });
      if (c.v === 'ok') { S.lr = JSON.parse($('#rimt', c.box).value.trim().replace(/^CETF-RULES:/, '')); S.lrDirty = true; toast('已匯入 ' + S.lr.rules.length + ' 組規則，按「儲存並套用規則」生效'); render(); }
    };
    $$('[data-rf]', v).forEach((el) => el.oninput = () => { R[el.dataset.rf] = el.value; dirty(); });
    const tog = (sel, key, rerender = true) => { const el = $(sel, v); if (el) el.onchange = (e) => { R[key] = e.target.checked; dirty(); if (rerender) render(); }; };
    tog('[data-wo]', 'wOn'); tog('[data-fo]', 'fOn'); tog('[data-oo]', 'oOn'); tog('[data-ow]', 'oW', false); tog('[data-so]', 'sOn');
    $$('[data-sk]', v).forEach((el) => el.onchange = (e) => { R.sCfg = R.sCfg || {}; R.sCfg[el.dataset.sk] = e.target.checked; dirty(); });
    $('#rsave', v).onclick = async () => { if (await lineJob('arSave', { rules: JSON.stringify(R) })) S.lrDirty = false; };
    const q = $('#aq', v); if (q) { q.oninput = () => { S.aq = q.value; }; q.onkeydown = (e) => { if (e.key === 'Enter') $('#aqs', v).click(); }; }
    if ($('#aqs', v)) $('#aqs', v).onclick = () => { if (!(S.aq || '').trim()) return toast('請輸入問題'); lineJob('arAsk', { q: S.aq.trim() }, { show: true }); };
    $$('[data-aqx]', v).forEach((b) => b.onclick = () => { S.aq = b.dataset.aqx; lineJob('arAsk', { q: S.aq }, { show: true }); render(); });
    if ($('#asy', v)) $('#asy', v).onclick = () => lineJob('arSync');
    if ($('#achk', v)) $('#achk', v).onclick = () => lineJob('arCheck', {}, { show: true, label: '已送出檢查（約 1 分鐘）' });
    $('#adep', v).onclick = () => lineJob('arDeploy', {}, { show: true });
    if ($('#atest', v)) $('#atest', v).onclick = () => lineJob('arTest', {}, { show: true });
    if ($('#arep', v)) $('#arep', v).onclick = () => lineJob('arReport');
    if ($('#adis', v)) $('#adis', v).onclick = async () => { const c = await dialog('停用自動回覆', '<div class="text2">停用後 LINE 不再送訊息到自動回覆，好友傳訊息不會自動回答。</div>', [['', '取消'], ['ok', '停用', 'primary']]); if (c.v === 'ok') lineJob('arDisable'); };
    const au = $('[data-aauto]', v); if (au) au.onchange = (e) => lineJob('arAuto', { on: e.target.checked });
    const nt = $('[data-ntf]', v); if (nt) nt.onchange = (e) => lineJob('notify', { on: e.target.checked });
    $$('[data-mk]', v).forEach((el) => el.onclick = () => editRule(newRule(el.dataset.mk), true));
    const ibq = $('#ibq', v); if (ibq) ibq.onchange = () => { F.q = ibq.value.trim(); render(); };
    $$('[data-ibf]', v).forEach((b) => b.onclick = () => { F.f = +b.dataset.ibf; render(); });
    $$('[data-ibg]', v).forEach((b) => b.onclick = () => { const o = S.ibOpen = S.ibOpen || new Set(); const u = b.dataset.ibg; if (o.has(u)) o.delete(u); else o.add(u); render(); });
    if ($('#ibcsv', v)) $('#ibcsv', v).onclick = () => {
      const qq = (x) => '"' + String(x || '').replace(/"/g, '""').replace(/\n/g, ' ') + '"';
      const csv = '﻿時間,好友,訊息,回覆類型\n' + inbox.map((m) => [fmtT(m.at), m.n, m.t, m.g || '未回覆'].map(qq).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'LINE收件匣.csv'; a.click();
    };
    $$('[data-ibm]', v).forEach((b) => b.onclick = () => { const m = list[+b.dataset.ibm]; lineJob('setMe', { u: m.u, n: m.n }); });
    $$('[data-ibk]', v).forEach((b) => b.onclick = () => editRule(newRule(String(list[+b.dataset.ibk].t).trim().slice(0, 30)), true));
    $$('[data-ibr]', v).forEach((b) => b.onclick = async () => {
      const m = list[+b.dataset.ibr]; const dl = (L.links || {}).download || '';
      const tpl = [['收到', '{name} 您好，已收到您的訊息，我們會盡快處理 🙏'], ['要截圖', '麻煩提供問題畫面截圖與 App 版本（App › 設置 › 關於與更新），方便我們確認，謝謝！'],
        ['授權碼', '您的授權碼已傳送，長按複製整段後打開 App 即可自動開通。'], ['更新', '請先更新到最新版：App › 設置 › 關於與更新 › 檢查更新，或點選單「下載 App」。'], ['下載', '📲 下載 App：' + dl]];
      const c = await dialog('回覆 ' + (m.n || '好友'), `<div class="small muted">對方：${esc(String(m.t).slice(0, 160))}</div><div class="row wrap" style="gap:4px;margin-top:6px">${tpl.map(([n], k) => `<button class="btn sm" data-rt="${k}">${n}</button>`).join('')}</div>
        <textarea id="rpt" rows="4" maxlength="4900" style="margin-top:6px" placeholder="回覆內容（扣 1 則額度）"></textarea><div id="derr" class="small up"></div>`, [['', '取消'], ['ok', '傳送', 'primary']],
        (bg) => { $$('[data-rt]', bg).forEach((x) => x.onclick = () => { $('#rpt', bg).value = tpl[+x.dataset.rt][1].replace('{name}', m.n || '').trim(); }); return (val) => (val === 'ok' && !$('#rpt', bg).value.trim() ? '請輸入回覆內容' : null); });
      if (c.v === 'ok') { if (S.d && S.d.d1) job('linePush', { u: m.u, n: m.n, text: $('#rpt', c.box).value.trim() }); else lineJob('arPush', { u: m.u, n: m.n, text: $('#rpt', c.box).value.trim() }); }
    });
  },
};

// ── ④ 下載發布：發布管道、App 安裝檔、說明書、每日盤後報告、對外連結 ──
const lineDist = {
  html(L) {
    const D = L.dist || {}; const off = D.official;
    const behind = off && ((D.ready && off !== D.apkTag) || (D.drive && D.paired && off !== D.driveApkTag));
    const prefer = [['github', 'GitHub 直連'], ['site', '發佈站'], ['drive', '雲端硬碟']];
    return `<div class="grid g2 stack"><div class="card"><h2>發布管道</h2><div class="small muted">正式版由伺服器轉送或存到 Google 雲端硬碟；好友、會員只看到發佈站或雲端硬碟連結。</div>
        <div class="small ${D.ready ? 'down' : 'muted'}" style="margin-top:8px">發佈站（Cloudflare）：${D.ready ? '✓ 已部署' : '未部署（先完成「自動回覆」的一鍵部署）'}</div>
        ${sw('data-ddr', D.drive, '同時存到 Google 雲端硬碟', D.paired ? '由雲端會員伺服器存到「台美股資產 發佈」資料夾，設為知道連結即可下載' : '需先在管理員 App 配對雲端會員伺服器')}
        <div class="small text2" style="margin-top:10px">LINE「下載 App」使用的連結</div>
        <div class="seg" style="margin-top:4px;display:inline-flex">${prefer.map(([k, n]) => `<button data-dpf="${k}" class="${D.prefer === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="small muted" style="margin-top:6px;word-break:break-all">${D.prefer === 'github' ? '直接下載最新正式版安裝檔；發布新版後自動換成新版網址，並同步自動回覆與圖文選單。' : D.prefer === 'drive' ? '使用 Google 雲端硬碟分享連結（需開啟雲端硬碟並上架）。' : '使用自己的發佈站下載頁（不顯示原始來源）。'}<br>目前：${esc((L.links || {}).download || '')}</div>
        ${D.prefer === 'github' ? '<button class="btn" id="dfl" style="margin-top:8px">立即檢查最新版並更新連結</button>' : ''}</div>
      <div class="card"><h2>App 安裝檔</h2>${kv([['正式版', off || '查詢中…'], ['發佈站', D.ready ? D.apkTag || '尚未上架' : '—'], ['雲端硬碟', D.drive ? D.driveApkTag || '尚未存入' : '未開啟']])}
        <button class="btn ${behind ? 'primary' : ''}" id="dapk" style="margin-top:10px;width:100%">${behind ? '上架 ' + esc(off) : '重新上架'}</button>
        ${sw('data-dau', D.auto, '正式版發布後自動上架', '開啟管理員版時檢查（每小時一次）')}</div>
      <div class="card"><h2>使用說明書</h2><div class="small muted">${D.pdf ? '已上架（正式版發布時說明書會隨 APK 一起更新；需要時可再按一次）' : '尚未上架'}</div><button class="btn" id="dman" style="margin-top:8px">${D.pdf ? '更新說明書' : '上架說明書'}</button></div>
      ${D.ready ? `<div class="card"><h2>每日盤後報告</h2><div class="small muted">由管理員 App 產生報表圖與摘要後上架；定時群發時自動執行。${D.reportDate ? '<br>目前上架：' + esc(D.reportDate) : ''}</div>
        ${sw('data-dimg', D.reportImage, '群發附報表圖')}<button class="btn" id="drep" style="margin-top:8px">產生並上架今日報告</button></div>` : ''}
      <div class="card"><h2>對外短網址</h2><div class="small muted">LINE 訊息、圖文選單、群發、自動回覆與使用者 App 顯示的連結改用短網址（Firebase Hosting 轉址到發佈站），打開後自動轉到發佈站。空白＝直接顯示發佈站網址。</div>
        <div class="row" style="gap:8px;margin-top:8px"><input id="dal" value="${esc(S.dal != null ? S.dal : D.alias || '')}" placeholder="https://cetftw.web.app/"><button class="btn primary" id="dals">套用</button></div>
        <div class="small muted" style="margin-top:6px">目前：${esc(D.alias || '（未使用）')}　發佈站：${esc(D.base || '—')}<br>套用會一併：自動回覆規則重新寫入、圖文選單重新部署、會員政策帶入短網址並回傳。</div></div>
      <div class="card"><h2>對外連結</h2>${(D.links || []).map(([n, u]) => `<div class="row" style="margin-top:6px;align-items:flex-start"><div class="sp"><div class="small">${esc(n)}</div><div class="small muted" style="word-break:break-all">${esc(u)}</div></div><a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">開啟</a><button class="btn sm" data-cp="${esc(u)}">複製</button></div>`).join('') || '<div class="small muted">尚未上架</div>'}
        <div class="small muted" style="margin-top:8px">LINE 目前使用：${esc((L.links || {}).download || '')}<br>上架後，圖文選單、自動回覆、群發範本的「下載」「說明書」會改用上面的連結。</div></div></div>`;
  },
  bind(v, L) {
    const ddr = $('[data-ddr]', v); ddr.onchange = (e) => lineJob('distDrive', { on: e.target.checked });
    $$('[data-dpf]', v).forEach((b) => b.onclick = () => lineJob('distPrefer', { v: b.dataset.dpf }));
    if ($('#dfl', v)) $('#dfl', v).onclick = () => lineJob('distFollow');
    $('#dapk', v).onclick = () => lineJob('distApk', {}, { label: '已送出上架（約 1–2 分鐘）' });
    $('[data-dau]', v).onchange = (e) => lineJob('distAuto', { on: e.target.checked });
    $('#dman', v).onclick = () => lineJob('distManual');
    const im = $('[data-dimg]', v); if (im) im.onchange = (e) => lineJob('distImg', { on: e.target.checked });
    if ($('#drep', v)) $('#drep', v).onclick = () => lineJob('distReport');
    $$('[data-cp]', v).forEach((b) => b.onclick = () => copyTxt(b.dataset.cp, '已複製連結'));
    $('#dal', v).oninput = (e) => { S.dal = e.target.value; };
    $('#dals', v).onclick = async () => { const u = ($('#dal', v).value || '').trim(); if (u && !/^(https:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(u)) return toast('網址格式不符，例 https://cetftw.web.app/');
      if (await lineJob('alias', { url: u }, { label: '已送出套用短網址' })) S.dal = null; };
  },
};

// ── ⑤ 建置素材：圖文選單、圖片素材、文案 ──
const lineKit = {
  html(L) {
    const K = L.kit || {};
    if (!K.has) return '<div class="card"><div class="small muted">此版本管理員 App 沒有內附官方帳號建置素材。</div></div>';
    const st = K.rich === true ? '✓ 已上線' : K.rich === false ? (K.richId ? 'LINE 上目前不是此選單' : '尚未部署') : L.token ? '查詢中…' : '需先設定權杖';
    return `<div class="grid g2 stack"><div class="card"><h2>圖文選單</h2><div class="small muted">6 格：${(K.areas || []).map((a) => esc(a[0])).join('、')}。文字按鈕會送出關鍵字，對應「自動回覆」的規則。</div>
        <div class="small ${K.rich === true ? 'down' : 'muted'}" style="margin-top:6px">狀態：${st}</div>
        <div class="row wrap" style="gap:8px;margin-top:8px"><button class="btn primary" id="kdep">${K.rich === true ? '重新部署' : '部署圖文選單'}</button>${K.rich === true ? '<button class="btn" id="krm">移除</button>' : ''}</div>
        <div class="small text2" style="margin-top:10px">手動設定時（LINE 官方帳號 App › 圖文選單 › 動作設定）每格填：</div>
        ${(K.areas || []).map((a, k) => `<div class="row" style="margin-top:4px;align-items:flex-start"><b style="width:110px;flex:none">${String.fromCharCode(65 + k)}  ${esc(a[0])}</b><span class="sp small text2" style="word-break:break-all">${esc(a[1])}：${esc(a[2])}</span><button class="btn sm" data-cp="${esc(a[2])}">複製</button></div>`).join('')}</div>
      <div class="card"><h2>圖片素材</h2><div class="small muted">大頭貼、主頁背景、歡迎圖等圖片內附在管理員 App：請在 App「會員 › LINE › 建置素材」存到相簿後，於 LINE 官方帳號 App 上傳。</div>
        ${(K.images || []).map((a) => `<div class="tile" style="margin-top:6px"><b>${esc(a[0])}</b>（${esc(a[1])}）<div class="small muted">${esc(a[2])}</div></div>`).join('')}</div></div>
      <div class="card" style="margin-top:12px"><h2>文案</h2><div class="small muted">依目前會員政策與群發時間自動產生；點「複製」後貼到 LINE 官方帳號對應位置。{Nickname} 會自動換成好友名稱。</div>
        ${(K.copies || []).map((c, k) => `<div class="tile" style="margin-top:8px"><div class="row"><div class="sp"><b>${esc(c.title)}</b>${c.limit > 0 ? `<span class="small muted"> · ${c.text.length}/${c.limit} 字</span>` : ''}<div class="small muted">${esc(c.where)}</div></div><button class="btn sm" data-cpk="${k}">複製</button></div><div class="small text2" style="white-space:pre-wrap;margin-top:4px">${esc(c.text)}</div></div>`).join('')}</div>`;
  },
  bind(v, L) {
    const K = L.kit || {};
    if ($('#kdep', v)) $('#kdep', v).onclick = () => lineJob('kitDeploy');
    if ($('#krm', v)) $('#krm', v).onclick = () => lineJob('kitRemove');
    $$('[data-cp]', v).forEach((b) => b.onclick = () => copyTxt(b.dataset.cp, '已複製'));
    $$('[data-cpk]', v).forEach((b) => b.onclick = () => copyTxt(K.copies[+b.dataset.cpk].text, '已複製「' + K.copies[+b.dataset.cpk].title + '」'));
  },
};

// ───────── 會員等級編輯（政策頁與會員等級頁共用；與管理員 App「會員 › 政策 › 會員等級」相同）─────────
/** 訂閱方案價格與活動折扣（由管理員 App 簽章回傳；App 與網頁版會員頁顯示） */
function priceEditor(box, p) {
  if (!S.prices) S.prices = JSON.parse(JSON.stringify(p.prices && p.prices.length ? p.prices : [{ n: '1 個月', m: 1, p: 199, t: 0 }, { n: '3 個月', m: 3, p: 499, t: 0 }, { n: '6 個月', m: 6, p: 799, t: 0 }, { n: '1 年', m: 12, p: 1099, t: 0 }]));
  if (!S.discEd) S.discEd = { disc: p.disc || 0, discUntil: p.discUntil || '', discLabel: p.discLabel || '' };
  const P = S.prices, D0 = S.discEd;
  const draw = () => {
    const on = D0.disc > 0 && (!D0.discUntil || new Date().toISOString().slice(0, 10).replace(/-/g, '/') <= D0.discUntil.replace(/-/g, '/'));
    box.innerHTML = `<h2>訂閱方案與價格<span class="r small muted">價格可隨時調整</span></h2>
      ${P.map((x, i) => `<div class="row" style="gap:8px;margin-top:8px;align-items:flex-end"><div class="field" style="flex:1.4;margin:0"><label>名稱</label><input data-pi="${i}" data-pk2="n" value="${esc(x.n)}" maxlength="12"></div>
        <div class="field" style="flex:.7;margin:0"><label>月數</label><input data-pi="${i}" data-pk2="m" type="number" min="1" max="120" value="${x.m}"></div>
        <div class="field" style="flex:1;margin:0"><label>原價（元）</label><input data-pi="${i}" data-pk2="p" type="number" min="1" value="${x.p}"></div>
        <div class="small muted" style="flex:1;padding-bottom:10px">${on ? '折後 ' + Math.round(x.p * (100 - D0.disc) / 100) + ' 元' : '月均 ' + Math.round(x.p / Math.max(1, x.m)) + ' 元'}</div><button class="btn sm" data-pd="${i}">刪除</button></div>`).join('')}
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn sm" id="padd">＋ 新增方案</button><button class="btn sm" id="pdef">恢復預設價格</button></div>
      <h2 style="margin-top:14px">活動折扣</h2><div class="grid g3" style="gap:8px"><div class="field"><label>折扣 %（0＝不打折，20＝8 折）</label><input id="dPct" type="number" min="0" max="90" value="${D0.disc}"></div>
        <div class="field"><label>截止日（空白＝不限期）</label><input id="dUntil" type="date" value="${esc(D0.discUntil.replace(/\//g, '-'))}"></div><div class="field"><label>活動名稱</label><input id="dLbl" maxlength="20" value="${esc(D0.discLabel)}" placeholder="例：雙 11 優惠"></div></div>
      <div class="small ${on ? '' : 'muted'}" style="${on ? 'color:var(--primary)' : ''}">${D0.disc ? (on ? '活動中：' + (100 - D0.disc) + '% 價格' + (D0.discUntil ? '，至 ' + esc(D0.discUntil) : '（不限期）') : '已過截止日，以原價顯示') : '目前不打折'}</div>
      <div class="row" style="margin-top:10px"><span class="sp"></span><button class="btn primary" id="psave2">儲存並回傳價格與折扣</button></div>`;
    $$('[data-pi]', box).forEach((el) => el.oninput = () => { const x = P[+el.dataset.pi]; const k = el.dataset.pk2; x[k] = k === 'n' ? el.value : Math.max(1, parseInt(el.value, 10) || 1); });
    $$('[data-pd]', box).forEach((b) => b.onclick = () => { if (P.length <= 1) return toast('至少要有一個方案'); P.splice(+b.dataset.pd, 1); draw(); });
    $('#padd', box).onclick = () => { if (P.length >= 8) return; P.push({ n: '新方案', m: 1, p: 199, t: 0 }); draw(); };
    $('#pdef', box).onclick = () => { S.prices = null; p = { ...p, prices: null }; priceEditor(box, p); };
    $('#dPct', box).onchange = (e) => { D0.disc = Math.max(0, Math.min(90, parseInt(e.target.value, 10) || 0)); draw(); };
    $('#dUntil', box).onchange = (e) => { D0.discUntil = e.target.value.replace(/-/g, '/'); draw(); };
    $('#dLbl', box).oninput = (e) => { D0.discLabel = e.target.value; };
    $('#psave2', box).onclick = async () => {
      if (P.some((x) => !String(x.n).trim())) return toast('請輸入每個方案的名稱');
      if (await job('policy', { prices: P.map((x) => ({ n: String(x.n).trim(), m: x.m, p: x.p, t: x.t || 0 })), disc: D0.disc, discUntil: D0.discUntil, discLabel: D0.discLabel.trim() }, '已送出價格與折扣')) { S.prices = null; S.discEd = null; }
    };
  };
  draw();
}
/** 資料源健康檢查（轉送站每天收盤後檢查；異常時管理員 App 會通知） */
async function healthBox(box, run) {
  const body = () => box.querySelector('.hcb') || (box.insertAdjacentHTML('beforeend', '<div class="hcb"></div>'), box.querySelector('.hcb'));
  box.querySelectorAll(':scope > .small.muted').forEach((e) => e.remove());
  const b = body(); b.innerHTML = '<div class="small muted">' + (run ? '檢查中（約 20 秒）…' : '讀取中…') + '</div>';
  try {
    const r = await fetch('/api/health' + (run ? '?run=1' : ''), { cache: 'no-store' }); const h = await r.json();
    if (!h.at) { b.innerHTML = '<div class="small muted">尚未檢查（每天 17:30 後自動執行；轉送站需重新部署才有此功能），可按「立即檢查」。</div>'; return; }
    b.innerHTML = `<div class="small ${h.ok ? 'muted' : 'up'}" style="margin-bottom:6px">${h.ok ? '✓ 全部正常' : '⚠ ' + h.bad + ' 項異常'}・${new Date(h.at).toLocaleString('zh-TW')}</div>
      <table class="tbl"><tbody>${h.items.map((x) => `<tr><td>${x.ok ? '✅' : '⛔'} ${esc(x.name)}</td><td class="num small muted">${x.ms} ms${x.n != null ? '・' + x.n + ' 筆' : ''}</td><td class="small ${x.ok ? 'muted' : 'up'}">${x.ok ? '正常' : esc(x.err)}</td></tr>`).join('')}</tbody></table>`;
  } catch (e) { b.innerHTML = '<div class="small up">無法讀取：' + esc(e.message) + '</div>'; }
}
function tierEditor(box, p) {
  if (!S.tiers) S.tiers = JSON.parse(JSON.stringify(p.tiers || []));
  const T = S.tiers;
  const draw = () => {
    box.innerHTML = `<h2>會員等級<span class="r small muted">開通時選擇等級即套用其功能與預設期限</span></h2>
      ${T.map((t, i) => `<div class="tile" style="margin-top:10px"><div class="row" style="gap:8px;margin-bottom:6px"><span class="badge" style="color:${argb(t.color)};border-color:${argb(t.color)}">${esc(t.name || '未命名')}</span><span class="sp small muted">${t.days > 0 ? t.days + ' 天' : '永久'} · 編號 ${t.id || '新'}</span>
          ${i ? `<button class="btn sm" data-tu="${i}" title="上移">↑</button>` : ''}${i < T.length - 1 ? `<button class="btn sm" data-tdn="${i}" title="下移">↓</button>` : ''}<button class="btn sm" data-td="${i}">刪除</button></div>
        <div class="grid g4" style="gap:8px"><div class="field"><label>名稱</label><input data-ti="${i}" data-tk="name" value="${esc(t.name)}" maxlength="12"></div>
        <div class="field"><label>說明</label><input data-ti="${i}" data-tk="desc" value="${esc(t.desc || '')}" maxlength="30"></div>
        <div class="field"><label>預設天數（0＝永久）</label><input data-ti="${i}" data-tk="days" type="number" min="0" max="3650" value="${t.days}"></div>
        <div class="field"><label>顏色</label><input data-ti="${i}" data-tk="color" type="color" value="${argb(t.color)}" style="height:38px;padding:2px"></div></div>
        <label class="row small" style="gap:6px;cursor:pointer;margin:4px 0 8px"><input type="checkbox" data-th="${i}" style="width:auto" ${t.hidden ? 'checked' : ''}> 不公開此等級（隱藏於會員頁方案比較、申請選單與 LINE 介紹；授權與權限照常有效）</label>
        <div class="field"><label>開放功能</label>${featBoxes('tm' + i, t.f)}</div></div>`).join('')}
      <div class="row wrap" style="gap:8px;margin-top:12px"><button class="btn" id="tadd">＋ 新增等級</button><span class="sp"></span><button class="btn" id="treset">還原</button><button class="btn primary" id="tsave">儲存並回傳會員等級</button></div>
      <div class="small muted" style="margin-top:6px">每個等級都可修改名稱、說明、天數、顏色與功能，也可新增、刪除、調整順序。儲存後由管理員 App 簽章回傳；已開通的授權碼依其等級編號顯示新名稱，功能以授權碼為準（調整既有會員權限請在會員頁「續約／變更方案」）。</div>`;
    // 輸入即寫回 S.tiers：自動重新整理或切換分頁都不會遺失
    $$('[data-ti]', box).forEach((el) => el.oninput = () => { const t = T[+el.dataset.ti]; const k = el.dataset.tk;
      t[k] = k === 'days' ? Math.max(0, Math.min(3650, parseInt(el.value, 10) || 0)) : k === 'color' ? (0xFF000000 + parseInt(el.value.slice(1), 16)) : el.value; S.tierDirty = true; });
    $$('[data-th]', box).forEach((el) => el.onchange = () => { T[+el.dataset.th].hidden = el.checked; S.tierDirty = true; });
    T.forEach((t, i) => $$(`[data-tm${i}]`, box).forEach((el) => el.onchange = () => { t.f = maskOf(box, 'tm' + i); S.tierDirty = true; }));
    $$('[data-td]', box).forEach((b) => b.onclick = () => { if (T.length <= 1) return toast('至少要有一個會員等級'); T.splice(+b.dataset.td, 1); S.tierDirty = true; draw(); });
    $$('[data-tu]', box).forEach((b) => b.onclick = () => { const i = +b.dataset.tu; [T[i - 1], T[i]] = [T[i], T[i - 1]]; S.tierDirty = true; draw(); });
    $$('[data-tdn]', box).forEach((b) => b.onclick = () => { const i = +b.dataset.tdn; [T[i + 1], T[i]] = [T[i], T[i + 1]]; S.tierDirty = true; draw(); });
    $('#tadd', box).onclick = () => { T.push({ id: 0, name: '新等級', desc: '', days: 30, color: 0xFF22C55E, f: 0 }); S.tierDirty = true; draw(); };
    $('#treset', box).onclick = () => { S.tiers = null; S.tierDirty = false; tierEditor(box, p); };
    $('#tsave', box).onclick = async () => {
      if (!T.length) return toast('至少要有一個會員等級');
      if (T.some((t) => !String(t.name).trim())) return toast('請輸入每個等級的名稱');
      const names = T.map((t) => t.name.trim()); if (new Set(names).size !== names.length) return toast('等級名稱不能重複');
      if (await job('policy', { tiers: T.map((t) => ({ id: t.id || 0, name: t.name.trim(), desc: t.desc || '', days: t.days, color: Number(t.color) >>> 0, f: t.f, hidden: !!t.hidden })) }, '已送出會員等級')) { S.tiers = null; S.tierDirty = false; }
    };
  };
  draw();
}
