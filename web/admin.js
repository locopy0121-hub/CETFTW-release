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
const WEB_VER = /*WEBVER*/{"v":"","sha":"e833d2b","at":"2026-11-21 18:41"};
const verText = () => (WEB_VER ? (WEB_VER.v ? (/^v/i.test(WEB_VER.v) ? WEB_VER.v : 'v' + WEB_VER.v) + ' · ' : '') + WEB_VER.sha + (WEB_VER.at ? ' · ' + WEB_VER.at : '') : '開發版');
const TABS = [['home', '總覽'], ['req', '申請'], ['mem', '會員'], ['pol', '政策'], ['tier', '會員等級'], ['rel', '發布'], ['line', 'LINE'], ['job', '工作紀錄']];
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
  try { S.d = await call('state'); renderLive(); renderTabs(); if (!(['pol', 'tier', 'line'].includes(S.tab) && S.rendered === S.tab)) render(); }
  catch (e) { if (S.ses) { const el = $('#live'); if (el) el.querySelector('span').textContent = '讀取失敗：' + e.message; } }
}
function pendingReqs() {
  const app = (S.d.app && S.d.app.requests) || []; const sheet = (S.d.requests || []).filter((r) => r.state === '待處理');
  return app.map((r) => ({ ...r, src: 'app' })).concat(sheet.map((r) => ({ key: '', kind: r.kind, name: r.name, contact: r.contact, msg: r.message, no: r.no, dev: r.device, at: r.at, src: 'sheet', id: r.id })));
}
async function job(type, payload, label) {
  try { const r = await call('job', { type, payload }); toast((label || '已送出') + (appOnline() ? '，管理員 App 處理中…' : '：管理員 App 開啟後執行')); S.fast = 12; await refresh(); return r.id; }
  catch (e) { toast('送出失敗：' + e.message, 6000); }
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
        <div class="card"><h2>最近工作</h2>${d.jobs.slice(0, 6).map(jobRow).join('') || '<div class="small muted">尚無工作</div>'}</div></div>`;
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
      <div class="card"><h2>會員等級</h2>${(p.tiers || []).map((t) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="badge" style="color:${argb(t.color)};border-color:${argb(t.color)}">${esc(t.name)}</span><span class="sp small text2">${esc(t.desc || '')}</span><span class="small muted">${t.days > 0 ? t.days + ' 天' : '永久'}</span></div>`).join('')}
        <div class="small muted" style="margin-top:6px">等級內容與功能請在管理員 App「會員 › 政策」調整。</div></div></div>`;
    $('#psave').onclick = () => { const o = {}; $$('[data-pk]', v).forEach((el) => { const k = el.dataset.pk; o[k] = /trialName|notice/.test(k) ? el.value : parseInt(el.value, 10) || 0; }); o.trialF = maskOf(v, 'tf'); o.freeF = maskOf(v, 'ff'); job('policy', o, '已送出政策更新'); };
  } else if (S.tab === 'tier') {
    const p = app.policy || {}; if (!app.policy) { v.innerHTML = '<div class="card empty">等待管理員 App 回報政策（開啟 App 即可）</div>'; return; }
    if (!S.tiers) S.tiers = JSON.parse(JSON.stringify(p.tiers || []));
    const T = S.tiers;
    v.innerHTML = `<div class="card"><h2>會員等級<span class="r small muted">開通時選擇等級即套用其功能與預設期限</span></h2>
      ${T.map((t, i) => `<div class="tile" style="margin-top:10px"><div class="grid g4" style="gap:8px"><div class="field"><label>名稱</label><input data-ti="${i}" data-tk="name" value="${esc(t.name)}" maxlength="12"></div>
        <div class="field"><label>說明</label><input data-ti="${i}" data-tk="desc" value="${esc(t.desc || '')}" maxlength="30"></div><div class="field"><label>預設天數（0＝永久）</label><input data-ti="${i}" data-tk="days" type="number" min="0" value="${t.days}"></div>
        <div class="field"><label>顏色</label><input data-ti="${i}" data-tk="color" type="color" value="${argb(t.color)}" style="height:38px;padding:2px"></div></div>
        <div class="field"><label>開放功能</label>${featBoxes('tm' + i, t.f)}</div><div class="row" style="justify-content:flex-end;gap:6px">${i ? `<button class="btn sm" data-tu="${i}">↑</button>` : ''}<button class="btn sm" data-td="${i}">刪除</button></div></div>`).join('')}
      <div class="row" style="gap:8px;margin-top:12px"><button class="btn" id="tadd">＋ 新增等級</button><span class="sp"></span><button class="btn" id="treset">還原</button><button class="btn primary" id="tsave">儲存並回傳政策</button></div>
      <div class="small muted" style="margin-top:6px">儲存後由管理員 App 簽章回傳；已開通的授權碼依其等級編號顯示新名稱，功能以授權碼為準（調整既有會員權限請在會員頁「續約／變更方案」）。</div></div>`;
    const sync = () => { $$('[data-ti]', v).forEach((el) => { const t = T[+el.dataset.ti]; const k = el.dataset.tk; t[k] = k === 'days' ? Math.max(0, parseInt(el.value, 10) || 0) : k === 'color' ? (0xFF000000 + parseInt(el.value.slice(1), 16)) : el.value; });
      T.forEach((t, i) => { t.f = maskOf(v, 'tm' + i); }); };
    $$('[data-td]', v).forEach((b) => b.onclick = () => { sync(); T.splice(+b.dataset.td, 1); render(); });
    $$('[data-tu]', v).forEach((b) => b.onclick = () => { sync(); const i = +b.dataset.tu; [T[i - 1], T[i]] = [T[i], T[i - 1]]; render(); });
    $('#tadd').onclick = () => { sync(); T.push({ id: 0, name: '新等級', desc: '', days: 30, color: 0xFF22C55E, f: 0 }); render(); };
    $('#treset').onclick = () => { S.tiers = null; render(); };
    $('#tsave').onclick = () => { sync(); if (!T.length) return toast('至少要有一個會員等級'); job('policy', { tiers: T }, '已送出會員等級'); S.tiers = null; };
  } else if (S.tab === 'line') {
    const L = app.line || {};
    v.innerHTML = `<div class="grid g2 stack"><div class="card"><h2>LINE 官方帳號</h2>${L.name ? kv([['名稱', L.name], ['ID', L.id], ['好友數（前一日）', L.friends >= 0 ? L.friends : '—'], ['本月訊息', L.used + (L.limit >= 0 ? ' / ' + L.limit + '（剩 ' + Math.max(0, L.limit - L.used) + '）' : ' / 不限')]]) : `<div class="small muted">${L.ready === false ? '管理員 App 尚未設定 LINE 頻道存取權杖' : '等待管理員 App 回報（約 30 分鐘更新一次）'}</div>`}
        <div class="small muted" style="margin-top:8px">自動回覆規則、圖文選單與每日報告請在管理員 App「LINE」頁設定。</div></div>
      <div class="card"><h2>群發訊息</h2><textarea id="bct" rows="6" maxlength="4900" placeholder="輸入要群發給所有好友的文字（每位好友計 1 則訊息額度）"></textarea>
        <div class="row" style="margin-top:8px"><span class="sp small muted" id="bcn">0 字</span><button class="btn primary" id="bcs">群發給所有好友</button></div></div></div>`;
    $('#bct').oninput = () => { $('#bcn').textContent = $('#bct').value.length + ' 字'; };
    $('#bcs').onclick = async () => { const t = $('#bct').value.trim(); if (!t) return toast('請輸入訊息內容');
      const c = await dialog('確認群發', `<div class="text2">將傳送給所有 LINE 好友${L.friends >= 0 ? '（約 ' + L.friends + ' 人，會用掉同數量的訊息額度）' : ''}：</div><div class="tile" style="margin-top:8px;white-space:pre-wrap">${esc(t)}</div>`, [['', '取消'], ['ok', '群發', 'primary']]);
      if (c.v === 'ok') { job('broadcast', { text: t }, '已送出群發'); $('#bct').value = ''; } };
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
const JOBN = { broadcast: 'LINE 群發', issue: '開通授權', revoke: '停用授權', edit: '編輯會員', account: '帳號管理', policy: '更新政策', promote: '發布版本', release: '一鍵發布及部署', redeploy: '重新部署', sync: '同步會員', remove: '刪除資料', request: '處理申請' };
function kv(items) { return `<div class="grid g2" style="gap:8px">${items.map(([k, x]) => `<div><div class="small muted">${esc(k)}</div><div>${esc(x)}</div></div>`).join('')}</div>`; }
function jobRow(j) {
  let p = {}; try { p = JSON.parse(j.payload); } catch (e) {}
  const what = JOBN[j.type] + (p.no ? ' ' + p.no : '') + (p.version ? ' ' + p.version : '');
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
