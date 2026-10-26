/* =========================================================
   家庭账本 · 前端应用（原生 JS，无外部依赖）
   ========================================================= */
(() => {
  'use strict';

  // -------------------------------------------------- 常量与状态
  const LS_TOKEN = 'fl.token';
  const LS_API = 'fl.api';

  const state = {
    apiBase: (localStorage.getItem(LS_API) || location.origin).replace(/\/+$/, ''),
    token: localStorage.getItem(LS_TOKEN) || '',
    siteName: '家庭账本',
    user: null,
    route: 'home',
    month: '',
    filter: { kind: 'all', userId: 0 },
    statsLevel: 'top',
    data: { tx: null, stats: null, accounts: null, categories: null, members: null, budgets: null, users: null },
    authForm: { username: '', password: '', server: (localStorage.getItem(LS_API) || location.origin), editingServer: false, site: '' },
    setupForm: { site: '家庭账本', username: '', display_name: '', password: '', confirm: '' },
    sheet: null,
  };

  const ICONS = {
    list: '<path d="M4 6h16M4 12h16M4 17h10"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.5h18"/><circle cx="17" cy="15" r="1.2"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.5a3 3 0 0 1 0 5.8M17.5 14.5A5.5 5.5 0 0 1 21.5 20"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4l10-10-4-4L4 16z"/>',
    download: '<path d="M12 4v10m0 0l-4-4m4 4l4-4M4 18h16"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h9"/>',
    lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    tag: '<path d="M4 12l8-8h7v7l-8 8z"/><circle cx="16" cy="8" r="1.2"/>',
    coins: '<ellipse cx="12" cy="6.5" rx="8" ry="3"/><path d="M4 6.5v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5"/><path d="M4 11.5v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    arrowLeft: '<path d="M15 5l-7 7 7 7"/>',
  };

  const icon = (name, cls = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="${cls}">${ICONS[name] || ''}</svg>`;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // -------------------------------------------------- 工具
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function currentMonth(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
  function shiftMonth(month, delta) {
    let [y, m] = month.split('-').map(Number);
    m += delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    return `${y}-${pad(m)}`;
  }
  function monthLabel(month) {
    const [y, m] = month.split('-').map(Number);
    return `${y}年${m}月`;
  }
  function fmt(n) {
    const v = Number(n || 0);
    return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtShort(n) {
    const v = Math.abs(Number(n || 0));
    if (v >= 100000) return (v / 10000).toFixed(0) + '万';
    if (v >= 10000) return (v / 10000).toFixed(1) + '万';
    return v.toFixed(0);
  }
  function dayLabel(dateStr) {
    const today = todayStr();
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    if (dateStr === today) return '今天';
    if (dateStr === todayStr(d)) return '昨天';
    const dt = new Date(dateStr + 'T00:00:00');
    return `${dt.getMonth() + 1}月${dt.getDate()}日 · 周${'日一二三四五六'[dt.getDay()]}`;
  }
  function greeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }
  function tint(hex, alpha = 0.12) {
    const h = String(hex || '#8A8578').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(full.slice(0, 2), 16) || 120;
    const g = parseInt(full.slice(2, 4), 16) || 120;
    const b = parseInt(full.slice(4, 6), 16) || 120;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  function can(perm) {
    if (!state.user) return false;
    return state.user.role === 'admin' || (state.user.perms || []).includes(perm);
  }
  function initials(name) {
    const s = String(name || '?').trim();
    return s.slice(0, 1).toUpperCase();
  }

  // -------------------------------------------------- 请求
  async function request(path, opts = {}) {
    const { method = 'GET', body, raw = false } = opts;
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    let res;
    try {
      res = await fetch(state.apiBase + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new Error('无法连接服务器，请检查地址与网络');
    }
    if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/setup')) {
      signOut(true);
      throw new Error('登录状态已失效');
    }
    if (!res.ok) {
      let msg = `请求失败（${res.status}）`;
      try {
        const d = await res.json();
        if (d && d.detail) msg = typeof d.detail === 'string' ? d.detail : '提交的数据不合法';
      } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    if (raw) return res;
    if (res.status === 204) return {};
    return res.json().catch(() => ({}));
  }

  // -------------------------------------------------- Toast
  function toast(msg, type = '') {
    const root = $('#toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .2s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 220);
    }, 2100);
  }

  // -------------------------------------------------- 抽屉
  function openSheet(html, onMount) {
    const root = $('#sheet-root');
    root.innerHTML = `<div class="sheet-mask"><div class="sheet">${html}</div></div>`;
    document.body.style.overflow = 'hidden';
    const mask = $('.sheet-mask', root);
    mask.addEventListener('click', (e) => {
      if (e.target === mask) closeSheet();
    });
    state.sheet = mask;
    if (onMount) onMount($('.sheet', root));
    const firstInput = $('.sheet input.input', root);
    if (firstInput && window.innerWidth > 700) firstInput.focus();
  }
  function closeSheet() {
    const root = $('#sheet-root');
    root.innerHTML = '';
    document.body.style.overflow = '';
    state.sheet = null;
    window.__draft = null;
  }
  function sheetHead(title, extra = '') {
    return `<div class="sheet-head">
      <h3>${esc(title)}</h3><div class="grow"></div>${extra}
      <button class="icon-btn" data-act="close-sheet">${icon('close')}</button>
    </div>`;
  }

  // -------------------------------------------------- 渲染入口
  function render() {
    const root = $('#root');
    root.className = '';
    if (!state.user) {
      if (state.mode === 'setup') root.innerHTML = viewSetup();
      else root.innerHTML = viewLogin();
      return;
    }
    root.innerHTML = viewApp();
  }

  // -------------------------------------------------- 登录页
  function viewLogin() {
    const f = state.authForm;
    return `<div class="auth">
      <div class="auth-card">
        <div class="auth-logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px"><rect x="4.6" y="3.2" width="14.8" height="17.6" rx="2.6"/><path d="M8.7 8.4h6.6M8.7 12.4h4.4"/><circle cx="16.1" cy="16.4" r="3.1" fill="#F3D19A" stroke="none"/></svg></div>
        <h2>${esc(state.siteName)}</h2>
        <p class="desc">一家人，一本账。<br/>记录每一笔收支，看清家里的钱去了哪里。</p>

        <div class="server-row" data-act="edit-server">
          <span>服务器</span>
          <span class="addr">${esc(f.server || location.origin)}</span>
          <span class="edit">修改</span>
        </div>
        ${f.editingServer ? `<div class="field">
          <label>服务器地址</label>
          <div class="inline-row">
            <input class="input" id="serverInput" value="${esc(f.server)}" placeholder="http://192.168.1.10:5257" />
            <button class="btn soft" style="flex:0 0 72px" data-act="save-server">确定</button>
          </div>
          <p class="hint mt8">填部署家庭账本的服务器地址，留空则使用当前域名。</p>
        </div>` : ''}

        <div id="authErr">${f.error ? `<div class="auth-err">${esc(f.error)}</div>` : ''}</div>

        <form data-form="login" autocomplete="on">
          <div class="field">
            <label>用户名</label>
            <input class="input" name="username" value="${esc(f.username)}" placeholder="请输入用户名" autocapitalize="none" autocomplete="username" />
          </div>
          <div class="field">
            <label>密码</label>
            <input class="input" name="password" type="password" placeholder="请输入密码" autocomplete="current-password" />
          </div>
          <button class="btn primary block mt8" type="submit" id="loginBtn">登录</button>
        </form>
        <p class="tip">还没有账号？请联系家庭管理员为你开通。</p>
      </div>
    </div>`;
  }

  function viewSetup() {
    const f = state.setupForm;
    return `<div class="auth">
      <div class="auth-card">
        <div class="auth-logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px"><rect x="4.6" y="3.2" width="14.8" height="17.6" rx="2.6"/><path d="M8.7 8.4h6.6M8.7 12.4h4.4"/><circle cx="16.1" cy="16.4" r="3.1" fill="#F3D19A" stroke="none"/></svg></div>
        <h2>创建管理员</h2>
        <p class="desc">这是第一次启用账本。设置管理员后，你可以为每位家庭成员单独开通账号与权限。</p>
        <div id="authErr">${f.error ? `<div class="auth-err">${esc(f.error)}</div>` : ''}</div>
        <form data-form="setup" autocomplete="off">
          <div class="field">
            <label>账本名称</label>
            <input class="input" name="site" value="${esc(f.site)}" placeholder="例如：我们的小家" maxlength="20" />
          </div>
          <div class="field">
            <label>管理员用户名</label>
            <input class="input" name="username" value="${esc(f.username)}" placeholder="2-20 位，中英文/数字" autocapitalize="none" />
          </div>
          <div class="field">
            <label>你的称呼（可选）</label>
            <input class="input" name="display_name" value="${esc(f.display_name || '')}" placeholder="例如：爸爸、妈妈，会显示在流水里" maxlength="20" />
          </div>
          <div class="field">
            <label>密码</label>
            <input class="input" name="password" type="password" placeholder="至少 6 位" autocomplete="new-password" />
          </div>
          <div class="field">
            <label>确认密码</label>
            <input class="input" name="confirm" type="password" placeholder="再输入一次" autocomplete="new-password" />
          </div>
          <button class="btn primary block mt8" type="submit">创建并开始使用</button>
        </form>
        <p class="tip">数据保存在你自己部署的服务器上，不上传任何第三方。</p>
      </div>
    </div>`;
  }

  // -------------------------------------------------- 应用框架
  function viewApp() {
    const navItems = [
      { key: 'home', label: '明细', ic: 'list' },
      ...(can('view_reports') ? [{ key: 'stats', label: '统计', ic: 'chart' }] : []),
      { key: 'ledger', label: '账本', ic: 'wallet' },
      { key: 'me', label: '我的', ic: 'user' },
    ];
    if (state.user.role === 'admin') navItems.push({ key: 'members', label: '成员', ic: 'users' });

    const page = {
      home: pageHome,
      stats: pageStats,
      ledger: pageLedger,
      me: pageMe,
      members: pageMembers,
    }[state.route] || pageHome;

    const sideNav = navItems
      .map(
        (n) => `<button class="nav-item ${state.route === n.key ? 'active' : ''}" data-act="go" data-route="${n.key}">
          ${icon(n.ic)}<span>${n.label}</span></button>`
      )
      .join('');

    const tabNav = navItems
      .filter((n) => n.key !== 'members')
      .map((n) => {
        const active = state.route === n.key || (state.route === 'members' && n.key === 'me');
        return `<button class="tab ${active ? 'active' : ''}" data-act="go" data-route="${n.key}">
          ${icon(n.ic)}<span>${n.label}</span></button>`;
      })
      .join('');

    return `<div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><rect x="4.6" y="3.2" width="14.8" height="17.6" rx="2.6"/><path d="M8.7 8.4h6.6M8.7 12.4h4.4"/><circle cx="16.1" cy="16.4" r="3.1" fill="#F3D19A" stroke="none"/></svg></div>
          <div><b>${esc(state.siteName)}</b><small>家庭共享账本</small></div>
        </div>
        ${sideNav}
        <div class="sidebar-user">
          <div class="avatar" style="background:${state.user.color}">${esc(initials(state.user.display_name))}</div>
          <div><div class="nm">${esc(state.user.display_name)}</div>
          <div class="rl">${state.user.role === 'admin' ? '管理员' : '家庭成员'}</div></div>
          <button class="out" data-act="logout">退出</button>
        </div>
      </aside>
      <main class="main">${page()}</main>
      <nav class="tabbar">${tabNav}</nav>
      <div id="fab-root">${state.route === 'home' && (can('record_expense') || can('record_income')) ? `<button class="fab" data-act="new-tx">${icon('plus')}</button>` : ''}</div>
    </div>`;
  }

  // -------------------------------------------------- 首页
  function pageHome() {
    const s = state.data.stats;
    const monthName = monthLabel(state.month);
    const isCur = state.month === currentMonth();
    const list = state.data.tx;
    const family = state.data.members || [];

    let delta = '';
    if (s && s.prev_expense > 0) {
      const diff = ((s.expense - s.prev_expense) / s.prev_expense) * 100;
      const up = diff >= 0;
      delta = `<span class="hero-delta">${up ? '↑' : '↓'} 较上月${up ? '多' : '少'} ${Math.abs(diff).toFixed(1)}%</span>`;
    }

    const hero = s
      ? `<div class="hero">
          <div class="hero-top">
            <div>
              <div class="hero-label">${isCur ? '本月支出' : monthName + '支出'}</div>
              <div class="hero-amount num"><small>¥</small>${fmt(s.expense)}</div>
              ${delta}
            </div>
            <button class="month-pick" data-act="pick-month" style="background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.2);color:#fff;box-shadow:none">
              ${monthName}
            </button>
          </div>
          <div class="hero-stats">
            <div><div class="k"><i class="dot inc"></i>收入</div><div class="v num">¥${fmt(s.income)}</div></div>
            <div><div class="k"><i class="dot" style="background:#f3d19a"></i>结余</div><div class="v num">¥${fmt(s.balance)}</div></div>
            <div><div class="k">记账笔数</div><div class="v num">${(list ? list.total : 0)} 笔</div></div>
          </div>
          ${s.budget ? `<div class="budget">
            <div class="budget-head"><span>本月预算 ¥${fmt(s.budget.amount)}</span><span>${s.budget.pct}%　剩余 ¥${fmt(s.budget.left)}</span></div>
            <div class="budget-track"><div class="budget-fill ${s.budget.pct > 100 ? 'over' : ''}" style="width:${Math.min(s.budget.pct, 100)}%"></div></div>
          </div>` : ''}
        </div>`
      : `<div class="hero"><div class="skeleton" style="height:96px;background:rgba(255,255,255,.18)"></div></div>`;

    const quick = `<div class="quick">
      ${can('record_expense') ? `<button class="q-out" data-act="new-tx" data-kind="expense"><span class="ico">−</span>记支出</button>` : '<div></div>'}
      ${can('record_income') ? `<button class="q-in" data-act="new-tx" data-kind="income"><span class="ico">+</span>记收入</button>` : '<div></div>'}
    </div>`;

    return `<div class="page-head">
        <div>
          <h1>${greeting()}，${esc((state.user.display_name || '').slice(0, 6))}</h1>
          <div class="sub">${esc(state.siteName)} · ${family.length || 1} 位成员</div>
        </div>
        <div class="avatar" style="background:${state.user.color}" data-act="go" data-route="me">${esc(initials(state.user.display_name))}</div>
      </div>
      ${hero}
      ${quick}
      ${filterBar()}
      <div id="txArea">${txListHtml(list)}</div>`;
  }

  function filterBar() {
    const f = state.filter;
    const showUser = (state.data.members || []).length > 1 && can('view_all');
    return `<div class="sec-title" style="margin-top:22px">
      <span>流水明细</span>
      <div class="row" style="gap:6px">
        ${showUser ? `<select class="mini-select" id="userFilter">
          <option value="0">全部成员</option>
          ${(state.data.members || []).map((m) => `<option value="${m.id}" ${f.userId === m.id ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('')}
        </select>` : ''}
        <div class="seg" style="padding:2px">
          ${[['all', '全部'], ['expense', '支出'], ['income', '收入']].map(
            ([k, l]) => `<button class="${f.kind === k ? 'on' : ''}" data-act="filter-kind" data-kind="${k}" style="padding:4px 9px;font-size:12px">${l}</button>`
          ).join('')}
        </div>
      </div>
    </div>`;
  }

  function txListHtml(list) {
    if (!list) {
      return `<div class="tx-list">${[1, 2, 3].map(() => `<div class="tx"><div class="skeleton" style="width:38px;height:38px;border-radius:12px"></div><div class="mid"><div class="skeleton" style="height:13px;width:45%"></div><div class="skeleton mt8" style="height:10px;width:30%"></div></div></div>`).join('')}</div>`;
    }
    if (!list.items.length) {
      return `<div class="card"><div class="empty"><div class="em">🍃</div><p>这个月还没有记录<br/>点右下角的「＋」记下第一笔吧</p></div></div>`;
    }
    const groups = new Map();
    list.items.forEach((t) => {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    });
    let html = '';
    groups.forEach((items, date) => {
      const exp = items.filter((t) => t.kind === 'expense').reduce((a, b) => a + b.amount, 0);
      const inc = items.filter((t) => t.kind === 'income').reduce((a, b) => a + b.amount, 0);
      const parts = [];
      if (exp) parts.push(`支出 ¥${fmt(exp)}`);
      if (inc) parts.push(`收入 ¥${fmt(inc)}`);
      html += `<div class="day-group">
        <div class="day-head"><span>${dayLabel(date)}</span><span class="sum">${parts.join(' · ')}</span></div>
        <div class="tx-list">${items.map(txRow).join('')}</div>
      </div>`;
    });
    return html;
  }

  function txRow(t) {
    const isTransfer = t.kind === 'transfer';
    const cat = t.category || { name: isTransfer ? '转账' : '未分类', icon: isTransfer ? '🔁' : '📦', color: '#8A8578' };
    const sign = isTransfer ? '' : t.kind === 'expense' ? '-' : '+';
    const cls = isTransfer ? 'tra' : t.kind === 'expense' ? 'exp' : 'inc';
    const sub = [];
    if (t.account) sub.push(`${t.account.icon} ${esc(t.account.name)}`);
    if (isTransfer && t.to_account) sub.push(`→ ${esc(t.to_account.name)}`);
    if (!isTransfer && state.data.members && state.data.members.length > 1) sub.push(esc(t.user.display_name));
    return `<div class="tx" data-act="edit-tx" data-id="${t.id}">
      <div class="cat-ico" style="background:${tint(cat.color)}">${esc(cat.icon)}</div>
      <div class="mid">
        <div class="t1">${esc(cat.name)}${t.note ? `<span class="note">${esc(t.note)}</span>` : ''}</div>
        <div class="t2">${sub.join(' · ')}</div>
      </div>
      <div class="amt ${cls} num">${sign}¥${fmt(t.amount)}</div>
    </div>`;
  }

  // -------------------------------------------------- 统计页
  function pageStats() {
    const s = state.data.stats;
    if (!s) {
      return `<div class="page-head"><h1>统计</h1></div><div class="card pad"><div class="skeleton" style="height:160px"></div></div>`;
    }
    const kind = state.statsKind || 'expense';
    const total = kind === 'expense' ? s.expense : s.income;
    const level = state.statsLevel || 'top';
    const raw = s.categories[kind] || [];
    let cats = raw;
    if (level === 'top') {
      // 按一级分类汇总：把每个二级分类的金额累加到所属分组
      const map = new Map();
      raw.forEach((c) => {
        const key = c.parent_id || c.id;
        const cur = map.get(key);
        if (cur) {
          cur.amount += c.amount;
          cur.subs += 1;
        } else {
          map.set(key, {
            id: key,
            name: c.parent_name || c.name,
            icon: c.parent_icon || c.icon,
            color: c.parent_color || c.color,
            amount: c.amount,
            subs: 1,
          });
        }
      });
      cats = [...map.values()]
        .map((c) => ({ ...c, amount: Math.round(c.amount * 100) / 100, pct: total ? Math.round((c.amount * 1000) / total) / 10 : 0 }))
        .sort((a, b) => b.amount - a.amount);
    }

    const donut = cats.length
      ? `<div class="donut-box">
          <div class="donut" style="background:${donutGradient(cats, total)}"></div>
          <div class="donut-center"><div><div class="k">${kind === 'expense' ? '总支出' : '总收入'}</div>
          <div class="v num">¥${fmt(total)}</div></div></div>
        </div>`
      : `<div class="empty" style="padding:30px 0"><div class="em">📊</div><p>本月暂无${kind === 'expense' ? '支出' : '收入'}记录</p></div>`;

    const legend = cats
      .map(
        (c) => `<div class="row" style="padding:9px 0">
          <div class="ico" style="background:${tint(c.color)};width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-size:15px">${esc(c.icon)}</div>
          <div class="nm" style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;font-size:13.5px"><span>${esc(c.name)}${
              level === 'sub' && c.parent_name && c.parent_name !== c.name ? `<span class="hint" style="margin-left:5px;font-weight:400">· ${esc(c.parent_name)}</span>` : ''
            }</span>
            <span class="num" style="font-weight:650">¥${fmt(c.amount)}</span></div>
            <div class="bar-track"><div style="height:100%;width:${Math.min(c.pct, 100)}%;background:${c.color};border-radius:99px"></div></div>
          </div>
          <div class="pc num">${c.pct}%</div>
        </div>`
      )
      .join('');

    const maxTrend = Math.max(...s.trend.map((m) => Math.max(m.income, m.expense)), 1);
    const barH = (v) => (v > 0 ? Math.max((v / maxTrend) * 100, 2) : 0);
    const trend = `<div class="card pad">
      <div class="row" style="justify-content:space-between"><b style="font-size:14px">近 6 个月趋势</b>
      <div class="legend-inline" style="padding:0"><span><i style="background:#d2493f"></i>支出</span><span><i style="background:#2e9e76"></i>收入</span></div></div>
      <div class="bars">
        ${s.trend.map((m) => `<div class="col">
          <div class="pair">
            <div class="b exp" style="height:${barH(m.expense)}%" title="支出 ¥${fmt(m.expense)}"></div>
            <div class="b inc" style="height:${barH(m.income)}%" title="收入 ¥${fmt(m.income)}"></div>
          </div>
          <div class="lb">${m.label}</div>
        </div>`).join('')}
      </div>
    </div>`;

    const maxDay = Math.max(...s.daily.map((d) => d.expense), 1);
    const daily = `<div class="card pad">
      <div class="row" style="justify-content:space-between"><b style="font-size:14px">每日支出</b><span class="hint">最高 ¥${fmt(maxDay)}</span></div>
      <div class="bars" style="height:96px;gap:2px">
        ${s.daily.map((d) => `<div class="col" title="${d.date} 支出 ¥${fmt(d.expense)}">
          <div class="b exp" style="width:100%;max-width:10px;height:${d.expense > 0 ? Math.max((d.expense / maxDay) * 100, 2) : 0}%"></div>
        </div>`).join('')}
      </div>
      <div class="row" style="justify-content:space-between;margin-top:2px">
        <span class="hint">1 日</span><span class="hint">${s.daily.length} 日</span>
      </div>
    </div>`;

    const members = can('view_all') && s.members.length
      ? `<div class="card">
          <div class="pad" style="padding-bottom:4px"><b style="font-size:14px">成员支出排行</b></div>
          ${s.members.map((m, i) => `<div class="rank">
            <div class="avatar" style="width:30px;height:30px;font-size:12px;background:${m.color}">${i + 1}</div>
            <div class="nm">${esc(m.name)}<div class="cnt">${m.count} 笔 · 收入 ¥${fmt(m.income)}</div></div>
            <div class="val num" style="color:var(--expense)">¥${fmt(m.expense)}</div>
          </div>`).join('')}
        </div>`
      : '';

    return `<div class="page-head">
      <div><h1>统计</h1><div class="sub">看清钱的方向，才好安排下一步</div></div>
      <button class="month-pick" data-act="pick-month">${monthLabel(state.month)}</button>
    </div>
    <div class="summary-row">
      <div class="card"><div class="k">收入</div><div class="v num" style="color:var(--income)">${fmtShort(s.income)}</div></div>
      <div class="card"><div class="k">支出</div><div class="v num" style="color:var(--expense)">${fmtShort(s.expense)}</div></div>
      <div class="card"><div class="k">结余</div><div class="v num">${fmtShort(s.balance)}</div></div>
    </div>
    <div class="grid-2 mt16">
      <div class="card">
        <div class="pad" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:0">
          <div class="seg">
            <button class="${kind === 'expense' ? 'on' : ''}" data-act="stats-kind" data-kind="expense">支出</button>
            <button class="${kind === 'income' ? 'on' : ''}" data-act="stats-kind" data-kind="income">收入</button>
          </div>
          <div class="seg seg-mini">
            <button class="${level === 'top' ? 'on' : ''}" data-act="stats-level" data-level="top">一级</button>
            <button class="${level === 'sub' ? 'on' : ''}" data-act="stats-level" data-level="sub">二级</button>
          </div>
        </div>
        <div class="donut-wrap">${donut}</div>
        <div class="cat-legend">${legend || '<div class="empty" style="padding:10px 0"><p>暂无数据</p></div>'}</div>
      </div>
      <div>
        ${trend}
        <div class="mt16">${daily}</div>
      </div>
    </div>
    ${members ? `<div class="mt16">${members}</div>` : ''}`;
  }

  function donutGradient(cats, total) {
    if (!cats.length || !total) return 'conic-gradient(#eeeae2 0% 100%)';
    let acc = 0;
    const stops = [];
    cats.forEach((c) => {
      const p = (c.amount / total) * 100;
      stops.push(`${c.color} ${acc.toFixed(2)}% ${(acc + p).toFixed(2)}%`);
      acc += p;
    });
    if (acc < 99.9) stops.push(`#eeeae2 ${acc.toFixed(2)}% 100%`);
    return `conic-gradient(${stops.join(',')})`;
  }

  // -------------------------------------------------- 账本页
  function pageLedger() {
    const accounts = state.data.accounts;
    const cats = state.data.categories;
    const budget = state.data.budgets;
    const totalBalance = (accounts || []).reduce((a, b) => a + b.balance, 0);
    const monthBudget = (budget || []).find((b) => b.month === state.month);

    const accList = !accounts
      ? `<div class="card pad"><div class="skeleton" style="height:120px"></div></div>`
      : `<div class="card">${accounts
          .map(
            (a) => `<div class="acc-row" data-act="edit-account" data-id="${a.id}">
              <div class="ico">${esc(a.icon)}</div>
              <div class="nm">${esc(a.name)}<span>${accountTypeLabel(a.type)}</span></div>
              <div class="val num" style="color:${a.balance < 0 ? 'var(--expense)' : 'var(--text)'}">¥${fmt(a.balance)}</div>
            </div>`
          )
          .join('')}
          ${can('manage_accounts') ? `<button class="list-row" data-act="new-account" style="color:var(--brand)"><div class="ico">${icon('plus')}</div><div class="lb">添加账户</div></button>` : ''}
        </div>`;

    const catBlock = (kind, title) => {
      const groups = catTree(kind);
      const editable = can('manage_categories');
      return `<div class="sec-title"><span>${title}</span>${
        editable ? `<button class="link" data-act="new-category" data-kind="${kind}">+ 一级分类</button>` : ''
      }</div>
      <div class="cat-tree">
        ${groups
          .map(
            (g) => `<div class="cat-group">
            <div class="cg-head">
              <span class="cg-ico" style="background:${tint(g.color)}">${esc(g.icon)}</span>
              <b>${esc(g.name)}</b>
              <span class="cg-cnt">${g.children.length}</span>
              ${editable ? `<button class="del" data-act="del-category" data-id="${g.id}" title="删除一级分类">×</button>` : ''}
            </div>
            <div class="chips cat-chips">${g.children
              .map(
                (c) => `<span class="chip"><span>${esc(c.icon)}</span>${esc(c.name)}${
                  editable ? `<button class="del" data-act="del-category" data-id="${c.id}" title="删除">×</button>` : ''
                }</span>`
              )
              .join('')}</div>
            ${editable ? `<button class="link cg-add" data-act="new-category" data-kind="${kind}" data-parent="${g.id}">+ 添加二级分类</button>` : ''}
          </div>`
          )
          .join('') || '<div class="hint" style="padding:8px 0">暂无分类</div>'}
      </div>`;
    };

    return `<div class="page-head">
      <div><h1>账本</h1><div class="sub">账户、分类与预算</div></div>
      <button class="month-pick" data-act="go" data-route="home">${monthLabel(state.month)}</button>
    </div>

    <div class="acc-sum">
      <div class="k">家庭总资产</div>
      <div class="v num">¥${fmt(totalBalance)}</div>
      <div class="hint mt8">含所有账户的余额${accounts ? `（${accounts.length} 个账户）` : ''}</div>
    </div>

    <div class="sec-title"><span>账户</span></div>
    ${accList}

    <div class="card mt16" style="padding:16px">
      <div class="row" style="justify-content:space-between">
        <div><b style="font-size:14px">本月预算</b><div class="hint mt8">${monthBudget ? '当前预算 ¥' + fmt(monthBudget.amount) : '还没设置预算'}</div></div>
        ${can('manage_budgets') ? `<button class="btn soft sm" data-act="set-budget">${monthBudget ? '修改' : '设置'}</button>` : ''}
      </div>
      ${state.data.stats && state.data.stats.budget ? `<div class="mt12">
        <div class="budget-track" style="background:var(--bg-deep)"><div class="budget-fill" style="width:${Math.min(state.data.stats.budget.pct, 100)}%;background:${state.data.stats.budget.pct > 90 ? 'var(--expense)' : 'var(--brand)'}"></div></div>
        <div class="row" style="justify-content:space-between;margin-top:6px"><span class="hint">已用 ¥${fmt(state.data.stats.budget.used)}</span><span class="hint">${state.data.stats.budget.pct}%</span></div>
      </div>` : ''}
    </div>

    ${catBlock('expense', '支出分类')}
    ${catBlock('income', '收入分类')}

    <div class="sec-title"><span>数据</span></div>
    <div class="list">
      <button class="list-row" data-act="export"><div class="ico">${icon('download')}</div><div class="lb">导出账单（CSV）</div><div class="rt">Excel 可打开</div><div class="chev">›</div></button>
    </div>`;
  }

  function accountTypeLabel(t) {
    return { cash: '现金', bank: '银行卡', wechat: '微信', alipay: '支付宝', credit: '信用卡', other: '其他' }[t] || '其他';
  }

  // -------------------------------------------------- 我的
  function pageMe() {
    const u = state.user;
    const permLabels = {
      record_expense: '记支出',
      record_income: '记收入',
      edit_own: '改删自己记录',
      view_all: '查看全家账本',
      view_reports: '查看统计',
      manage_accounts: '管理账户',
      manage_categories: '管理分类',
      manage_budgets: '管理预算',
    };
    const rows = [
      u.role === 'admin' ? { ic: 'users', label: '家庭成员管理', act: 'go', route: 'members', rt: (state.data.members || []).length + ' 位' } : null,
      { ic: 'tag', label: '分类管理', act: 'go', route: 'ledger' },
      { ic: 'coins', label: '账户管理', act: 'go', route: 'ledger' },
      { ic: 'download', label: '导出账单', act: 'export' },
      { ic: 'lock', label: '修改密码', act: 'password' },
      u.role === 'admin' ? { ic: 'settings', label: '账本名称', act: 'rename-site', rt: state.siteName } : null,
    ].filter(Boolean);

    return `<div class="page-head"><div><h1>我的</h1><div class="sub">账号与账本设置</div></div></div>

    <div class="me-card">
      <div class="avatar" style="background:${u.color}">${esc(initials(u.display_name))}</div>
      <div style="flex:1">
        <div class="nm">${esc(u.display_name)}</div>
        <div class="rl">@${esc(u.username)}
          <span class="badge ${u.role === 'admin' ? '' : 'gray'}">${u.role === 'admin' ? '管理员' : '家庭成员'}</span>
        </div>
      </div>
    </div>

    <div class="sec-title"><span>我的权限</span></div>
    <div class="chips">
      ${(u.role === 'admin' ? Object.keys(permLabels) : u.perms).map((p) => `<span class="badge">${permLabels[p] || p}</span>`).join('')}
    </div>

    <div class="sec-title"><span>功能</span></div>
    <div class="list">
      ${rows
        .map(
          (r) => `<button class="list-row" data-act="${r.act}" ${r.route ? `data-route="${r.route}"` : ''}>
            <div class="ico">${icon(r.ic)}</div><div class="lb">${r.label}</div>
            ${r.rt ? `<div class="rt">${esc(r.rt)}</div>` : ''}<div class="chev">›</div>
          </button>`
        )
        .join('')}
    </div>

    <div class="mt24">
      <button class="btn ghost block" data-act="logout" style="color:var(--expense)">${icon('logout')} 退出登录</button>
    </div>
    <p class="hint" style="text-align:center;margin-top:14px">家庭账本 v1.2 · 数据存放于你的服务器<br/>${esc(state.apiBase)}</p>`;
  }

  // -------------------------------------------------- 成员管理
  function pageMembers() {
    const list = state.data.users;
    if (!list) {
      return `<div class="page-head"><h1>家庭成员</h1></div><div class="card pad"><div class="skeleton" style="height:120px"></div></div>`;
    }
    const permLabels = {
      record_expense: '记支出', record_income: '记收入', edit_own: '改删记录', view_all: '看全家账',
      view_reports: '看统计', manage_accounts: '账户', manage_categories: '分类', manage_budgets: '预算',
    };
    return `<div class="page-head">
      <div><h1>家庭成员</h1><div class="sub">为每个人分配账号与权限</div></div>
      <button class="btn primary sm" data-act="new-user">${icon('plus')} 添加</button>
    </div>
    <div class="card">
      ${list
        .map(
          (u) => `<div class="u-row">
            <div class="avatar" style="background:${u.color};${u.is_active ? '' : 'opacity:.45'}">${esc(initials(u.display_name))}</div>
            <div class="mid">
              <div class="nm">${esc(u.display_name)}
                <span class="badge ${u.role === 'admin' ? '' : 'gray'}">${u.role === 'admin' ? '管理员' : '成员'}</span>
                ${u.is_active ? '' : '<span class="badge red">已停用</span>'}
              </div>
              <div class="meta">@${esc(u.username)} · ${u.tx_count || 0} 笔记账</div>
              <div class="meta" style="margin-top:3px">${u.role === 'admin' ? '拥有全部权限' : (u.perms || []).map((p) => permLabels[p] || p).join(' · ') || '暂无权限'}</div>
            </div>
            <div class="acts"><button class="btn ghost sm" data-act="edit-user" data-id="${u.id}">编辑</button></div>
          </div>`
        )
        .join('')}
    </div>
    <p class="hint mt16" style="padding:0 4px">提示：「查看全家账本」关闭时，该成员只能看到自己记录的流水；「改删自己的记录」关闭后只能新增，不能修改。</p>`;
  }

  // ================================================== 业务动作
  async function loadCore(force = false) {
    const d = state.data;
    const tasks = [];
    if (force || !d.categories) tasks.push(request('/api/categories').then((r) => (d.categories = r)));
    if (force || !d.accounts) tasks.push(request('/api/accounts').then((r) => (d.accounts = r)));
    if (force || !d.members) tasks.push(request('/api/members').then((r) => (d.members = r)));
    await Promise.all(tasks);
  }

  async function loadMonth(force = false) {
    const q = new URLSearchParams({ month: state.month });
    if (state.filter.kind !== 'all') q.set('kind', state.filter.kind);
    if (state.filter.userId) q.set('user_id', String(state.filter.userId));
    const jobs = [];
    if (force || !state.data.tx || state.data.txMonth !== state.month || state.data.txKey !== q.toString()) {
      jobs.push(
        request('/api/transactions?' + q.toString()).then((r) => {
          state.data.tx = r;
          state.data.txMonth = state.month;
          state.data.txKey = q.toString();
        })
      );
    }
    if (force || !state.data.stats || state.data.stats.month !== state.month) {
      jobs.push(request('/api/stats?month=' + state.month).then((r) => (state.data.stats = r)));
    }
    await Promise.all(jobs);
  }

  async function go(route) {
    state.route = route;
    render();
    window.scrollTo({ top: 0 });
    try {
      await loadCore();
      if (route === 'home' || route === 'ledger') await loadMonth();
      if (route === 'stats' && !can('view_reports')) {
        toast('没有查看统计的权限');
        state.route = 'home';
        await loadMonth();
      }
      if (route === 'members' && state.user.role !== 'admin') state.route = 'me';
      if (route === 'members') state.data.users = await request('/api/users');
      if (route === 'ledger') state.data.budgets = await request('/api/budgets');
      render();
    } catch (e) {
      toast(e.message, 'err');
      render();
    }
  }

  function signOut(silent) {
    state.token = '';
    state.user = null;
    state.data = { tx: null, stats: null, accounts: null, categories: null, members: null, budgets: null, users: null };
    localStorage.removeItem(LS_TOKEN);
    state.route = 'home';
    state.mode = '';
    render();
    if (!silent) toast('已退出登录');
  }

  // -------------------------------------------------- 分类树工具
  // 分类是两级结构：一级分类 parent_id 为 null，二级分类挂在下面
  function catTree(kind) {
    const list = (state.data.categories || []).filter((c) => c.kind === kind);
    const byParent = {};
    list.forEach((c) => {
      if (c.parent_id) (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c);
    });
    return list
      .filter((c) => !c.parent_id)
      .map((p) => ({ ...p, children: byParent[p.id] || [] }));
  }

  function catFind(id) {
    return (state.data.categories || []).find((c) => c.id === id) || null;
  }

  // -------------------------------------------------- 记账抽屉
  function openTxSheet(editTx, kind) {
    const cats = state.data.categories || [];
    const accounts = state.data.accounts || [];
    const initKind = editTx ? editTx.kind : kind || 'expense';
    const initGroups = catTree(initKind).filter((g) => g.children.length);
    const initCat = editTx && editTx.category ? catFind(editTx.category.id) : null;
    const firstGroup = initGroups[0];
    const draft = {
      id: editTx ? editTx.id : null,
      kind: initKind,
      amountStr: editTx ? String(editTx.amount) : '',
      base: 0,
      categoryId: initCat ? initCat.id : firstGroup ? firstGroup.children[0].id : null,
      groupId: initCat ? initCat.parent_id || initCat.id : firstGroup ? firstGroup.id : null,
      accountId: editTx && editTx.account ? editTx.account.id : accounts[0] ? accounts[0].id : null,
      toAccountId: editTx && editTx.to_account ? editTx.to_account.id : accounts[1] ? accounts[1].id : null,
      date: editTx ? editTx.date : todayStr(),
      note: editTx ? editTx.note : '',
    };

    // 预览态：金额输入的同时展示"
    openSheet(
      `<div class="sheet-head">
        <div class="seg" style="flex:0 0 auto">
          ${can('record_expense') ? `<button data-act="tx-kind" data-kind="expense" class="${draft.kind === 'expense' ? 'on' : ''}">支出</button>` : ''}
          ${can('record_income') ? `<button data-act="tx-kind" data-kind="income" class="${draft.kind === 'income' ? 'on' : ''}">收入</button>` : ''}
          ${can('record_expense') ? `<button data-act="tx-kind" data-kind="transfer" class="${draft.kind === 'transfer' ? 'on' : ''}">转账</button>` : ''}
        </div>
        <div class="grow"></div>
        ${draft.id ? `<button class="icon-btn" data-act="del-tx" data-id="${draft.id}" style="color:var(--expense)">${icon('trash')}</button>` : ''}
        <button class="icon-btn" data-act="close-sheet">${icon('close')}</button>
      </div>
      <div class="sheet-body" id="txBody"></div>
      <div class="keypad" id="keypad"></div>`,
      () => {
        window.__draft = draft;
        renderTxBody();
      }
    );
  }

  function renderTxBody() {
    const d = window.__draft;
    if (!d) return;
    const groups = d.kind === 'transfer' ? [] : catTree(d.kind).filter((g) => g.children.length);
    let activeGroup = null;
    if (d.kind !== 'transfer') {
      activeGroup = groups.find((g) => g.id === d.groupId) || groups[0] || null;
      if (activeGroup) {
        d.groupId = activeGroup.id;
        // 选中的二级分类必须落在当前一级分类里
        if (!activeGroup.children.some((c) => c.id === d.categoryId)) {
          d.categoryId = activeGroup.children[0] ? activeGroup.children[0].id : null;
        }
      } else {
        d.categoryId = null;
      }
    }
    const accounts = state.data.accounts || [];
    const disp = d.amountStr === '' ? '0.00' : d.amountStr;
    const sub = d.base ? `${d.kind === 'expense' ? '合计' : '合计'} ¥${fmt(d.base + (parseFloat(d.amountStr) || 0))}` : '';

    const body = `
      <div class="amount-box">
        <span class="cur">¥</span>
        <span class="val num ${d.amountStr === '' ? 'ph' : ''}">${esc(disp)}</span>
      </div>
      <div class="amount-sub">${sub}</div>

      ${d.kind === 'transfer' ? `
        <div class="field"><label>转出账户</label>
          <div class="pill-row">${accounts.map((a) => `<button class="pill ${d.accountId === a.id ? 'on' : ''}" data-act="pick-acc" data-id="${a.id}">${esc(a.icon)} ${esc(a.name)}</button>`).join('')}</div>
        </div>
        <div class="field"><label>转入账户</label>
          <div class="pill-row">${accounts.map((a) => `<button class="pill ${d.toAccountId === a.id ? 'on' : ''}" data-act="pick-acc-to" data-id="${a.id}">${esc(a.icon)} ${esc(a.name)}</button>`).join('')}</div>
        </div>
      ` : `
        <div class="cat-tabs">
          ${groups.map((g) => `<button class="cat-tab ${d.groupId === g.id ? 'on' : ''}" data-act="pick-group" data-id="${g.id}">
            <span class="gi" style="background:${tint(g.color)}">${esc(g.icon)}</span><span class="tn">${esc(g.name)}</span>
          </button>`).join('')}
        </div>
        <div class="cat-grid">
          ${(activeGroup ? activeGroup.children : []).map((c) => `<button class="cat-cell ${d.categoryId === c.id ? 'on' : ''}" data-act="pick-cat" data-id="${c.id}">
            <div class="ico" style="background:${tint(c.color)}">${esc(c.icon)}</div><div class="nm">${esc(c.name)}</div>
          </button>`).join('')}
          ${!groups.length ? '<div class="hint" style="grid-column:1/-1;padding:14px 0;text-align:center">还没有分类，去「账本」里添加</div>' : ''}
        </div>
        <div class="field mt16"><label>账户</label>
          <div class="pill-row">${accounts.map((a) => `<button class="pill ${d.accountId === a.id ? 'on' : ''}" data-act="pick-acc" data-id="${a.id}">${esc(a.icon)} ${esc(a.name)}</button>`).join('')}</div>
        </div>
      `}

      <div class="field"><label>日期</label>
        <input class="input" type="date" id="txDate" value="${d.date}" />
      </div>
      <div class="field" style="margin-bottom:0"><label>备注</label>
        <input class="input" id="txNote" maxlength="40" placeholder="写点什么…（选填）" value="${esc(d.note)}" />
      </div>`;

    const kb = [
      ['1', '2', '3', ['del', '⌫', 'fn']],
      ['4', '5', '6', ['+', '+', 'op']],
      ['7', '8', '9', ['-', '−', 'op']],
      [['.', '.', 'fn'], '0', '00', ['ok', '完成', 'ok']],
    ];

    const keypadHtml = kb
      .flat()
      .map((k) => {
        if (Array.isArray(k)) {
          const [key, label, cls] = k;
          return `<button class="${cls}" data-act="key" data-key="${key}">${label}</button>`;
        }
        return `<button data-act="key" data-key="${k}">${k}</button>`;
      })
      .join('');

    const bodyEl = $('#txBody');
    const kpEl = $('#keypad');
    if (bodyEl) bodyEl.innerHTML = body;
    if (kpEl) kpEl.innerHTML = keypadHtml;

    // 一级分类较多，切换后把当前分组滚进可视区，避免高亮项藏在屏幕外
    const onTab = bodyEl && bodyEl.querySelector('.cat-tab.on');
    if (onTab && onTab.scrollIntoView) {
      onTab.scrollIntoView({ inline: 'center', block: 'nearest' });
    }

    const dateEl = $('#txDate');
    if (dateEl) dateEl.addEventListener('change', (e) => { window.__draft.date = e.target.value; });
    const noteEl = $('#txNote');
    if (noteEl) noteEl.addEventListener('input', (e) => { window.__draft.note = e.target.value; });
  }

  function pressKey(key) {
    const d = window.__draft;
    if (!d) return;
    let s = d.amountStr;
    if (key === 'del') {
      d.amountStr = s.slice(0, -1);
    } else if (key === '+' || key === '-') {
      const v = parseFloat(s);
      if (!isNaN(v)) {
        d.base = (d.base || 0) + (key === '+' ? v : -v);
        d.amountStr = '';
      }
    } else if (key === 'ok') {
      saveTx();
      return;
    } else if (key === '.') {
      if (!s.includes('.')) d.amountStr = (s || '0') + '.';
    } else {
      // 数字
      if (s.includes('.')) {
        const dec = s.split('.')[1] || '';
        if (dec.length >= 2) return;
      }
      if (s.replace('.', '').length >= 9) return;
      if (key === '00' && (s === '' || s === '0')) return;
      d.amountStr = s === '0' ? key : s + key;
    }
    updateAmountDisplay();
  }

  function updateAmountDisplay() {
    const d = window.__draft;
    const box = $('.amount-box .val');
    if (!box || !d) return;
    box.textContent = d.amountStr === '' ? '0.00' : d.amountStr;
    box.classList.toggle('ph', d.amountStr === '');
    const sub = $('.amount-sub');
    if (sub) {
      const total = (d.base || 0) + (parseFloat(d.amountStr) || 0);
      sub.textContent = d.base ? `合计 ¥${fmt(total)}` : '';
    }
  }

  async function saveTx() {
    const d = window.__draft;
    if (!d) return;
    const amount = (d.base || 0) + (parseFloat(d.amountStr) || 0);
    if (!(amount > 0)) { toast('请先输入金额'); return; }
    if (d.kind !== 'transfer' && !d.categoryId) { toast('请选择分类'); return; }
    if (d.kind === 'transfer' && d.accountId === d.toAccountId) { toast('转出与转入账户不能相同'); return; }
    const payload = {
      kind: d.kind,
      amount: Math.round(amount * 100) / 100,
      category_id: d.kind === 'transfer' ? null : d.categoryId,
      account_id: d.accountId,
      to_account_id: d.kind === 'transfer' ? d.toAccountId : null,
      date: d.date || todayStr(),
      note: d.note || '',
    };
    try {
      if (d.id) await request('/api/transactions/' + d.id, { method: 'PUT', body: payload });
      else await request('/api/transactions', { method: 'POST', body: payload });
      closeSheet();
      toast(d.id ? '已保存修改' : '记账成功', 'ok');
      state.data.stats = null;
      await loadMonth(true);
      await loadCore(true);
      render();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  // -------------------------------------------------- 成员表单
  function openUserSheet(u) {
    const isNew = !u;
    const permLabels = {
      record_expense: '记支出', record_income: '记收入', edit_own: '改删自己的记录',
      view_all: '查看全家账本', view_reports: '查看统计报表',
      manage_accounts: '管理账户', manage_categories: '管理分类', manage_budgets: '管理预算',
    };
    const perms = u ? u.perms : ['record_expense', 'record_income', 'edit_own'];
    const isAdmin = u && u.role === 'admin';

    openSheet(
      `${sheetHead(isNew ? '添加家庭成员' : '编辑成员')}
      <div class="sheet-body">
        <form data-form="user" data-id="${u ? u.id : ''}">
          <div class="field"><label>显示名称</label>
            <input class="input" name="display_name" id="uNick" value="${esc(u ? u.display_name : '')}" placeholder="例如：妈妈、小宝" maxlength="20" />
          </div>
          <div class="field"><label>登录用户名</label>
            <input class="input" name="username" value="${esc(u ? u.username : '')}" placeholder="2-20 位，中英文/数字" ${u ? 'disabled' : ''} autocapitalize="none" />
          </div>
          <div class="field"><label>${isNew ? '初始密码' : '重置密码（留空则不修改）'}</label>
            <input class="input" name="password" type="text" placeholder="至少 6 位" autocomplete="new-password" />
          </div>
          <div class="field"><label>角色</label>
            <select class="input" name="role" id="uRole">
              <option value="member" ${isAdmin ? '' : 'selected'}>家庭成员</option>
              <option value="admin" ${isAdmin ? 'selected' : ''}>管理员（全部权限）</option>
            </select>
          </div>
          <div class="field"><label>权限</label>
            <div class="perm-grid" id="permGrid" style="${isAdmin ? 'display:none' : ''}">
              ${Object.entries(permLabels)
                .map(
                  ([k, l]) => `<label class="perm-item"><input type="checkbox" name="perms" value="${k}" ${perms.includes(k) ? 'checked' : ''}/><span>${l}</span></label>`
                )
                .join('')}
            </div>
            <p class="hint mt8" id="permHint" style="${isAdmin ? '' : 'display:none'}">管理员默认拥有全部权限。</p>
          </div>
          ${isNew ? '' : `<div class="row" style="justify-content:space-between;padding:10px 2px">
            <div><div style="font-size:13.5px">启用账号</div><div class="hint">停用后该成员无法登录</div></div>
            <label class="switch"><input type="checkbox" name="is_active" ${u.is_active ? 'checked' : ''}/><span class="track"></span></label>
          </div>`}
          <div class="mt16"></div>
        </form>
      </div>
      <div class="sheet-foot">
        ${isNew ? '' : `<button class="btn danger" data-act="delete-user" data-id="${u.id}">删除</button>`}
        <button class="btn primary" style="flex:1" data-act="save-user">保存</button>
      </div>`,
      () => {
        const role = $('#uRole');
        if (role) role.addEventListener('change', () => {
          const admin = role.value === 'admin';
          $('#permGrid').style.display = admin ? 'none' : 'grid';
          $('#permHint').style.display = admin ? '' : 'none';
        });
      }
    );
  }

  async function saveUser() {
    const form = $('[data-form="user"]');
    if (!form) return;
    const id = form.dataset.id;
    const fd = new FormData(form);
    const role = fd.get('role') || 'member';
    const perms = fd.getAll('perms');
    const body = {
      display_name: fd.get('display_name') || '',
      role,
      perms,
    };
    const pwd = (fd.get('password') || '').trim();
    if (pwd) body.password = pwd;
    if (id) {
      body.is_active = fd.get('is_active') !== null;
      try {
        await request('/api/users/' + id, { method: 'PATCH', body });
        closeSheet();
        toast('已保存', 'ok');
        state.data.users = await request('/api/users');
        state.data.members = null;
        await loadCore(true);
        render();
      } catch (e) { toast(e.message, 'err'); }
    } else {
      body.username = (fd.get('username') || '').trim();
      if (!body.username) { toast('请填写登录用户名'); return; }
      if (!pwd) { toast('请设置初始密码'); return; }
      try {
        await request('/api/users', { method: 'POST', body });
        closeSheet();
        toast('成员已添加', 'ok');
        state.data.users = await request('/api/users');
        state.data.members = null;
        await loadCore(true);
        render();
      } catch (e) { toast(e.message, 'err'); }
    }
  }

  // -------------------------------------------------- 其他抽屉
  function openBudgetSheet() {
    const cur = (state.data.budgets || []).find((b) => b.month === state.month);
    openSheet(
      `${sheetHead('设置本月预算')}
      <div class="sheet-body">
        <div class="field"><label>${monthLabel(state.month)} 预算金额（元）</label>
          <input class="input" id="budgetInput" type="number" inputmode="decimal" min="0" step="0.01" value="${cur ? cur.amount : ''}" placeholder="例如 5000" />
          <p class="hint mt8">设为 0 可取消预算。预算按整月统计家庭总支出。</p>
        </div>
      </div>
      <div class="sheet-foot"><button class="btn primary block" data-act="save-budget">保存</button></div>`
    );
  }

  async function saveBudget() {
    const v = parseFloat($('#budgetInput').value || '0');
    if (isNaN(v) || v < 0) { toast('请输入有效金额'); return; }
    try {
      await request('/api/budgets', { method: 'POST', body: { month: state.month, amount: v } });
      state.data.budgets = await request('/api/budgets');
      state.data.stats = null;
      await loadMonth(true);
      closeSheet();
      toast('预算已更新', 'ok');
      render();
    } catch (e) { toast(e.message, 'err'); }
  }

  function openAccountSheet(acc) {
    const isNew = !acc;
    openSheet(
      `${sheetHead(isNew ? '添加账户' : '编辑账户')}
      <div class="sheet-body">
        <form data-form="account" data-id="${acc ? acc.id : ''}">
          <div class="field"><label>账户名称</label>
            <input class="input" name="name" value="${esc(acc ? acc.name : '')}" placeholder="例如：工资卡" maxlength="20" />
          </div>
          <div class="field"><label>图标</label>
            <input class="input" name="icon" id="accIcon" value="${esc(acc ? acc.icon : '💰')}" maxlength="4" />
            <div class="chips mt8">${['💵', '💚', '💙', '🏦', '💳', '📱', '🪙', '🏠'].map((e) => `<button class="chip" data-act="pick-emoji" data-target="accIcon" data-emoji="${e}">${e}</button>`).join('')}</div>
          </div>
          <div class="field"><label>类型</label>
            <select class="input" name="type">
              ${[['cash', '现金'], ['bank', '银行卡'], ['wechat', '微信'], ['alipay', '支付宝'], ['credit', '信用卡'], ['other', '其他']]
                .map(([k, l]) => `<option value="${k}" ${acc && acc.type === k ? 'selected' : ''}>${l}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field"><label>初始余额（元）</label>
            <input class="input" name="initial_balance" type="number" step="0.01" value="${acc ? acc.initial_balance : '0'}" />
            <p class="hint mt8">账户开始使用时的余额，之后会随记账自动增减。</p>
          </div>
        </form>
      </div>
      <div class="sheet-foot">
        ${isNew ? '' : `<button class="btn danger" data-act="delete-account" data-id="${acc.id}">删除</button>`}
        <button class="btn primary" style="flex:1" data-act="save-account">保存</button>
      </div>`
    );
  }

  async function saveAccount() {
    const form = $('[data-form="account"]');
    const fd = new FormData(form);
    const body = {
      name: (fd.get('name') || '').trim(),
      icon: (fd.get('icon') || '💰').trim() || '💰',
      type: fd.get('type') || 'cash',
      initial_balance: parseFloat(fd.get('initial_balance') || '0') || 0,
    };
    if (!body.name) { toast('请填写账户名称'); return; }
    const id = form.dataset.id;
    try {
      if (id) await request('/api/accounts/' + id, { method: 'PATCH', body });
      else await request('/api/accounts', { method: 'POST', body });
      state.data.accounts = null;
      state.data.stats = null;
      await loadCore(true);
      await loadMonth(true);
      closeSheet();
      toast('已保存', 'ok');
      render();
    } catch (e) { toast(e.message, 'err'); }
  }

  function openCategorySheet(kind, parentId, parentName) {
    const kindLabel = kind === 'expense' ? '支出' : '收入';
    const title = parentId ? `添加二级分类 · ${parentName || ''}` : `添加${kindLabel}一级分类`;
    openSheet(
      `${sheetHead(title)}
      <div class="sheet-body">
        <form data-form="category" data-kind="${kind}" data-parent="${parentId || ''}">
          <div class="field"><label>分类名称</label>
            <input class="input" name="name" placeholder="${parentId ? '例如：早餐、话费' : '例如：食品酒水、行车交通'}" maxlength="10" />
          </div>
          <div class="field"><label>图标</label>
            <input class="input" name="icon" id="catIcon" value="🍜" maxlength="4" />
            <div class="chips mt8">${['🍜', '🍚', '☕', '🥬', '🚌', '🚗', '🧻', '🛍️', '🏠', '💡', '📱', '💊', '📚', '🎮', '🎁', '🐾', '💰', '🧧', '📈', '💵'].map((e) => `<button class="chip" data-act="pick-emoji" data-target="catIcon" data-emoji="${e}">${e}</button>`).join('')}</div>
          </div>
        </form>
      </div>
      <div class="sheet-foot"><button class="btn primary block" data-act="save-category">保存</button></div>`
    );
  }

  async function saveCategory() {
    const form = $('[data-form="category"]');
    const fd = new FormData(form);
    const kind = form.dataset.kind;
    const parentId = form.dataset.parent ? Number(form.dataset.parent) : null;
    const colors = ['#E2584A', '#4C9A5E', '#4A7DBB', '#9B7EBD', '#D9739B', '#D9A23B', '#4E9CA6', '#8A6FBF'];
    const body = {
      name: (fd.get('name') || '').trim(),
      icon: (fd.get('icon') || '📦').trim() || '📦',
      kind,
      parent_id: parentId,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
    if (!body.name) { toast('请填写分类名称'); return; }
    try {
      await request('/api/categories', { method: 'POST', body });
      state.data.categories = null;
      await loadCore(true);
      closeSheet();
      toast('分类已添加', 'ok');
      render();
    } catch (e) { toast(e.message, 'err'); }
  }

  function openPasswordSheet() {
    openSheet(
      `${sheetHead('修改密码')}
      <div class="sheet-body">
        <form data-form="password">
          <div class="field"><label>原密码</label><input class="input" name="old" type="password" autocomplete="current-password" /></div>
          <div class="field"><label>新密码</label><input class="input" name="new1" type="password" placeholder="至少 6 位" autocomplete="new-password" /></div>
          <div class="field"><label>确认新密码</label><input class="input" name="new2" type="password" autocomplete="new-password" /></div>
        </form>
      </div>
      <div class="sheet-foot"><button class="btn primary block" data-act="save-password">确认修改</button></div>`
    );
  }

  async function savePassword() {
    const form = $('[data-form="password"]');
    const fd = new FormData(form);
    const oldPwd = fd.get('old') || '';
    const n1 = fd.get('new1') || '';
    const n2 = fd.get('new2') || '';
    if (n1.length < 6) { toast('新密码至少 6 位'); return; }
    if (n1 !== n2) { toast('两次输入的新密码不一致'); return; }
    try {
      const r = await request('/api/auth/password', { method: 'POST', body: { old_password: oldPwd, new_password: n1 } });
      state.token = r.token;
      localStorage.setItem(LS_TOKEN, r.token);
      closeSheet();
      toast('密码已修改', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  function openRenameSheet() {
    openSheet(
      `${sheetHead('账本名称')}
      <div class="sheet-body">
        <div class="field"><label>显示名称</label>
          <input class="input" id="siteInput" value="${esc(state.siteName)}" maxlength="20" />
        </div>
      </div>
      <div class="sheet-foot"><button class="btn primary block" data-act="save-site">保存</button></div>`
    );
  }

  async function saveSite() {
    const v = ($('#siteInput').value || '').trim();
    if (!v) { toast('请填写名称'); return; }
    try {
      const r = await request('/api/settings/site', { method: 'POST', body: { site_name: v } });
      state.siteName = r.site_name;
      closeSheet();
      toast('已更新', 'ok');
      render();
    } catch (e) { toast(e.message, 'err'); }
  }

  // -------------------------------------------------- 月份选择
  function openMonthSheet() {
    const months = [];
    let m = currentMonth();
    for (let i = 0; i < 12; i++) {
      months.push(m);
      m = shiftMonth(m, -1);
    }
    openSheet(
      `${sheetHead('选择月份')}
      <div class="sheet-body">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
          ${months.map((mm) => `<button class="chip" style="justify-content:center;${mm === state.month ? 'background:var(--brand);color:#fff;border-color:var(--brand)' : ''}" data-act="set-month" data-month="${mm}">${mm.slice(0, 4)}年${Number(mm.slice(5))}月</button>`).join('')}
        </div>
      </div>`
    );
  }

  // -------------------------------------------------- 事件
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const v = window.__draft;

    try {
      switch (act) {
        case 'go':
          closeSheet();
          await go(el.dataset.route);
          break;
        case 'logout':
          signOut();
          break;
        case 'close-sheet':
          closeSheet();
          break;
        case 'edit-server':
          state.authForm.server = state.apiBase;
          state.authForm.editingServer = !state.authForm.editingServer;
          render();
          break;
        case 'save-server': {
          let addr = ($('#serverInput').value || '').trim();
          if (!addr) addr = location.origin;
          if (!/^https?:\/\//i.test(addr)) addr = 'http://' + addr;
          addr = addr.replace(/\/+$/, '');
          state.apiBase = addr;
          localStorage.setItem(LS_API, addr);
          state.authForm.server = addr;
          state.authForm.editingServer = false;
          state.authForm.error = '';
          try {
            const st = await request('/api/status');
            state.siteName = st.site_name || state.siteName;
            state.mode = st.setup_done ? '' : 'setup';
          } catch (err) {
            state.authForm.error = err.message;
          }
          render();
          break;
        }
        case 'pick-month':
          openMonthSheet();
          break;
        case 'set-month':
          state.month = el.dataset.month;
          state.data.stats = null;
          state.data.tx = null;
          closeSheet();
          await loadMonth(true);
          render();
          break;
        case 'new-tx':
          openTxSheet(null, el.dataset.kind);
          break;
        case 'edit-tx': {
          const id = Number(el.dataset.id);
          const t = (state.data.tx ? state.data.tx.items : []).find((x) => x.id === id);
          if (t) openTxSheet(t);
          break;
        }
        case 'del-tx': {
          if (!confirm('确定删除这条记录？')) return;
          await request('/api/transactions/' + el.dataset.id, { method: 'DELETE' });
          closeSheet();
          toast('已删除', 'ok');
          state.data.stats = null;
          await loadMonth(true);
          await loadCore(true);
          render();
          break;
        }
        case 'tx-kind':
          v.kind = el.dataset.kind;
          v.amountStr = v.amountStr;
          v.base = 0;
          if (v.kind !== 'transfer') {
            const gs = catTree(v.kind).filter((g) => g.children.length);
            const g = gs.find((x) => x.id === v.groupId) || gs[0] || null;
            v.groupId = g ? g.id : null;
            const keep = g && g.children.some((c) => c.id === v.categoryId);
            v.categoryId = keep ? v.categoryId : g && g.children[0] ? g.children[0].id : null;
          }
          renderTxBody();
          break;
        case 'pick-group': {
          const gid = Number(el.dataset.id);
          const g = catTree(v.kind).find((x) => x.id === gid);
          v.groupId = gid;
          if (g && g.children.length && !g.children.some((c) => c.id === v.categoryId)) {
            v.categoryId = g.children[0].id;
          }
          renderTxBody();
          break;
        }
        case 'pick-cat': {
          const cat = catFind(Number(el.dataset.id));
          v.categoryId = Number(el.dataset.id);
          if (cat && cat.parent_id) v.groupId = cat.parent_id;
          renderTxBody();
          break;
        }
        case 'pick-acc':
          v.accountId = Number(el.dataset.id);
          renderTxBody();
          break;
        case 'pick-acc-to':
          v.toAccountId = Number(el.dataset.id);
          renderTxBody();
          break;
        case 'key':
          pressKey(el.dataset.key);
          break;
        case 'stats-kind':
          state.statsKind = el.dataset.kind;
          render();
          break;
        case 'stats-level':
          state.statsLevel = el.dataset.level;
          render();
          break;
        case 'filter-kind':
          state.filter.kind = el.dataset.kind;
          state.data.tx = null;
          await loadMonth(true);
          render();
          break;
        case 'new-user':
          openUserSheet(null);
          break;
        case 'edit-user': {
          const u = (state.data.users || []).find((x) => x.id === Number(el.dataset.id));
          if (u) openUserSheet(u);
          break;
        }
        case 'save-user':
          await saveUser();
          break;
        case 'delete-user': {
          if (!confirm('删除该成员？其记录也会一并删除，且无法恢复。')) return;
          await request('/api/users/' + el.dataset.id, { method: 'DELETE' });
          closeSheet();
          toast('成员已删除', 'ok');
          state.data.users = await request('/api/users');
          state.data.members = null;
          await loadCore(true);
          render();
          break;
        }
        case 'new-account':
          openAccountSheet(null);
          break;
        case 'edit-account': {
          const a = (state.data.accounts || []).find((x) => x.id === Number(el.dataset.id));
          if (a) openAccountSheet(a);
          break;
        }
        case 'save-account':
          await saveAccount();
          break;
        case 'delete-account': {
          if (!confirm('删除该账户？历史记录会保留。')) return;
          await request('/api/accounts/' + el.dataset.id, { method: 'DELETE' });
          state.data.accounts = null;
          state.data.stats = null;
          await loadCore(true);
          closeSheet();
          toast('账户已删除', 'ok');
          render();
          break;
        }
        case 'new-category': {
          const pid = el.dataset.parent ? Number(el.dataset.parent) : null;
          const p = pid ? catFind(pid) : null;
          openCategorySheet(el.dataset.kind || 'expense', pid, p ? p.name : '');
          break;
        }
        case 'save-category':
          await saveCategory();
          break;
        case 'del-category': {
          if (!confirm('删除该分类？其下的二级分类会一起删除，已记录的流水会显示为「未分类」。')) return;
          await request('/api/categories/' + el.dataset.id, { method: 'DELETE' });
          state.data.categories = null;
          await loadCore(true);
          render();
          break;
        }
        case 'set-budget':
          openBudgetSheet();
          break;
        case 'save-budget':
          await saveBudget();
          break;
        case 'password':
          openPasswordSheet();
          break;
        case 'save-password':
          await savePassword();
          break;
        case 'rename-site':
          openRenameSheet();
          break;
        case 'save-site':
          await saveSite();
          break;
        case 'pick-emoji': {
          const input = document.getElementById(el.dataset.target);
          if (input) input.value = el.dataset.emoji;
          break;
        }
        case 'export':
          await exportCsv();
          break;
        default:
          break;
      }
    } catch (err) {
      toast(err.message || '操作失败', 'err');
    }
  });

  // 表单提交
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;

    if (kind === 'login') {
      const fd = new FormData(form);
      const username = (fd.get('username') || '').trim();
      const password = fd.get('password') || '';
      state.authForm.username = username;
      state.authForm.password = password;
      state.authForm.error = '';
      const btn = $('#loginBtn');
      if (btn) { btn.disabled = true; btn.textContent = '登录中…'; }
      try {
        const r = await request('/api/auth/login', { method: 'POST', body: { username, password } });
        state.token = r.token;
        state.user = r.user;
        state.siteName = r.site_name || '家庭账本';
        localStorage.setItem(LS_TOKEN, r.token);
        state.authForm.password = '';
        state.mode = '';
        await boot(true);
      } catch (err) {
        state.authForm.error = err.message;
        render();
        const p = $('input[name="password"]');
        if (p) { p.value = ''; p.focus(); }
      }
      return;
    }

    if (kind === 'setup') {
      const fd = new FormData(form);
      const username = (fd.get('username') || '').trim();
      const body = {
        site_name: (fd.get('site') || '').trim() || '家庭账本',
        username,
        password: fd.get('password') || '',
        display_name: (fd.get('display_name') || '').trim() || username,
      };
      const confirmPwd = fd.get('confirm') || '';
      if (body.password !== confirmPwd) {
        state.setupForm.error = '两次输入的密码不一致';
        render();
        return;
      }
      state.setupForm = { site: body.site_name, username: body.username, display_name: body.display_name, password: '', confirm: '', error: '' };
      try {
        const r = await request('/api/setup', { method: 'POST', body });
        state.token = r.token;
        state.user = r.user;
        state.siteName = r.site_name;
        localStorage.setItem(LS_TOKEN, r.token);
        state.mode = '';
        await boot(true);
      } catch (err) {
        state.setupForm.error = err.message;
        render();
      }
      return;
    }
  });

  // 筛选下拉
  document.addEventListener('change', async (e) => {
    if (e.target.id === 'userFilter') {
      state.filter.userId = Number(e.target.value) || 0;
      state.data.tx = null;
      await loadMonth(true);
      render();
    }
  });

  // 快捷键
  document.addEventListener('keydown', (e) => {
    if (!window.__draft) return;
    if (e.target.tagName === 'INPUT' && e.target.type !== 'date') return;
    if (/^[0-9]$/.test(e.key)) { pressKey(e.key); }
    else if (e.key === '.') pressKey('.');
    else if (e.key === 'Backspace') { e.preventDefault(); pressKey('del'); }
    else if (e.key === 'Escape') closeSheet();
    else if (e.key === 'Enter') { e.preventDefault(); pressKey('ok'); }
    else if (e.key === '+') pressKey('+');
    else if (e.key === '-') pressKey('-');
  });

  // -------------------------------------------------- 导出
  async function exportCsv() {
    try {
      const res = await request('/api/export?month=' + state.month, { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `家庭账本-${state.month}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('已导出', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  // -------------------------------------------------- 启动
  async function boot(force) {
    state.month = state.month || currentMonth();
    render();
    try {
      const st = await request('/api/status');
      state.siteName = st.site_name || '家庭账本';
      if (!st.setup_done) {
        state.mode = 'setup';
        state.user = null;
        render();
        return;
      }
      if (!state.token) {
        state.mode = '';
        state.user = null;
        render();
        return;
      }
      const me = await request('/api/auth/me');
      state.user = me.user;
      state.siteName = me.site_name || state.siteName;
      state.mode = '';
      render();
      await loadCore(true);
      await loadMonth(true);
      if (state.route === 'home' || !state.route) state.route = 'home';
      render();
    } catch (err) {
      // 令牌失效 / 服务器不可达
      state.user = null;
      state.authForm.error = err.message.includes('登录') ? '' : err.message;
      render();
    }
  }

  // Android 壳的返回键（MainActivity 通过 evaluateJavascript 调用）：
  // 先关弹层 → 再回首页 → 都没有则返回 'exit'，由系统把 App 退到后台。
  window.__flHandleBack = function () {
    try {
      if (state.sheet) {
        closeSheet();
        return 'handled';
      }
      if (state.mode === 'setup' || !state.token || !state.user) return 'exit';
      if (state.route && state.route !== 'home') {
        go('home');
        return 'handled';
      }
    } catch (e) {
      /* 出任何异常都让系统接管，避免返回键卡死 */
    }
    return 'exit';
  };

  // 启动
  // App（Capacitor 壳）里跑的是本地页面，没有 Service Worker 可注册，跳过
  const inAppShell = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !inAppShell) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  boot();
})();
