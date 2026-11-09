"use strict";
/* 拾缘 · GM 控制台
 * 结构：登录 → 侧栏路由（概览 / 账号 / 卡池 / 日志）→ 账号抽屉（概览/角色/缘器/操作）。
 * 约定：所有动态 HTML 走 esc()；CSP 禁内联事件，交互一律 data-* + 事件委托。 */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const TOKEN_KEY = "adm_token";
const NAME_KEY = "adm_name";
let TOKEN = sessionStorage.getItem(TOKEN_KEY) || "";

const S = {
  me: sessionStorage.getItem(NAME_KEY) || "",
  view: "dash",
  roster: [],
  rosterById: {},
  rosterReady: false,
  users: { rows: [], page: 1, pages: 1, total: 0, pageSize: 15, q: "", state: "all", role: "all", loading: false },
  banners: { custom: [], all: [], loading: false },
  logs: { rows: [], page: 1, pages: 1, total: 0, pageSize: 20, opFilter: "", q: "" },
  bgm: { files: [], rotate: {}, slots: ["home", "gacha", "battle"], aud: null },
  sys: { data: null, logs: [], source: "buffer", level: "", q: "", timer: null, rttMs: 0, failStreak: 0, hist: [] },
  dash: null,
  drawer: { id: 0, tab: "overview", detail: null, crar: "all", cq: "" },
};

const RAR = { diamond: "晶钻", red: "UR", gold: "SSR", purple: "SR", blue: "R", green: "N" };
const RAR_ORDER = ["diamond", "red", "gold", "purple", "blue", "green"];
// 缘器只有五档（红/金/紫/蓝/绿），发放下拉不能混用角色稀有度（选到晶钻会生成无图无系数的坏装备）。
const EQ_RAR_ORDER = ["red", "gold", "purple", "blue", "green"];
const KIND = { weapon: "兵刃", artifact: "法宝", talisman: "灵饰", attire: "道袍", exclusive: "本命" };
const MAT = { page: "散页", note: "手记", scroll: "卷轴", pill: "洗髓丹", soul: "器魂", xingsha: "星砂", wensha: "纹砂", xinyin: "心印" };
const OP_META = {
  grant: { t: "资源发放", c: "gold" }, setcard: { t: "角色调整", c: "" },
  grantEquip: { t: "缘器发放", c: "gold" }, grantExclusive: { t: "本命直发", c: "gold" },
  revokeEquip: { t: "缘器回收", c: "warn" }, ban: { t: "禁用 / 解禁", c: "bad" },
  freeze: { t: "冻结 / 解冻", c: "warn" }, wipe: { t: "清档", c: "bad" },
  resetPassword: { t: "重置密码", c: "warn" },
  bannerSave: { t: "卡池保存", c: "gold" }, bannerRandom: { t: "随机发池", c: "gold" },
  bannerToggle: { t: "卡池启停", c: "" },
  bannerDelete: { t: "卡池删除", c: "bad" },
};
const VIEW_META = {
  dash: { t: "概览", s: "运营数据与最近动态" },
  users: { t: "账号管理", s: "检索、查看、发放与风控" },
  banners: { t: "卡池管理", s: "玩家端缘阁的限定池" },
  bgm: { t: "背景音乐", s: "上传音频与场景轮换配置" },
  logs: { t: "操作日志", s: "后台变更全量审计" },
  sys: { t: "系统日志", s: "后台运行日志、内存与卡顿诊断" },
};

/* ---------------- 基础工具 ---------------- */
const fmtInt = (n) => Number(n || 0).toLocaleString("zh-CN");
const fmtCompact = (n) => {
  n = Number(n || 0);
  if (n >= 1e8) return (n / 1e8).toFixed(2) + " 亿";
  if (n >= 1e4) return (n / 1e4).toFixed(1) + " 万";
  return fmtInt(n);
};
const pad = (n) => String(n).padStart(2, "0");
function fmtDT(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(+d)) return "—";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtD(v) {
  const d = new Date(v);
  return Number.isNaN(+d) ? "—" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function relTime(v) {
  const t = new Date(v).getTime();
  if (!t) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 天前`;
  return fmtD(v);
}
const rarTag = (r) => `<span class="tag rar r-${esc(r)}">${RAR[r] || esc(r)}</span>`;
function charName(id) { return (S.rosterById[id] || {}).name || id; }
function avatarHTML(id, cls = "mini-ava") {
  const c = S.rosterById[id] || {};
  const url = c.art && c.art.avatar;
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">`
    : `<span class="${cls}">${esc((c.name || id || "?").slice(0, 1))}</span>`;
}
function statusTag(u) {
  if (Number(u.status) === 1) return `<span class="tag bad" title="${esc(u.banReason || "")}">已禁用</span>`;
  if (u.frozenUntil && u.frozenUntil > Date.now()) {
    const d = new Date(u.frozenUntil);
    return `<span class="tag warn">冻结至 ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}</span>`;
  }
  return '<span class="tag ok">正常</span>';
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const pageNums = (page, pages) => {
  if (pages <= 1) return "";
  const out = [`<button data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>`];
  const push = (n) => out.push(`<button data-page="${n}" class="${n === page ? "on" : ""}">${n}</button>`);
  if (pages <= 7) { for (let i = 1; i <= pages; i++) push(i); }
  else {
    push(1);
    const from = Math.max(2, page - 2), to = Math.min(pages - 1, page + 2);
    if (from > 2) out.push('<span class="sub">…</span>');
    for (let i = from; i <= to; i++) push(i);
    if (to < pages - 1) out.push('<span class="sub">…</span>');
    push(pages);
  }
  out.push(`<button data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>›</button>`);
  return out.join("");
};

/* ---------------- Toast ---------------- */
function toast(msg, type = "info") {
  if (!msg) return;
  const el = document.createElement("div");
  el.className = `toast ${type === "ok" ? "ok" : type === "err" ? "err" : ""}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 220); }, type === "err" ? 4200 : 2600);
}
async function run(fn) {
  try { return await fn(); }
  catch (e) {
    if (e && e.message === "auth") return;
    toast(e && e.message ? e.message : "操作失败", "err");
    return undefined;
  }
}

/* ---------------- 接口 ---------------- */
async function api(body) {
  const r = await fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  let j;
  try { j = await r.json(); } catch { throw new Error(`服务返回异常（HTTP ${r.status}）`); }
  if (r.status === 401 || j.authRequired) {
    showLogin("登录已过期，请重新登录");
    throw new Error("auth");
  }
  if (!j.ok) {
    const raw = j.error || "操作失败";
    // 后端还是旧版时给出可执行的动作，而不是「未知管理操作 xxx」
    throw new Error(/未知管理操作/.test(raw) ? "后台服务仍是旧版：请重启一次服务（stop.bat → start.bat）后重试" : raw);
  }
  return j;
}

/* ---------------- 弹窗 ---------------- */
let modalSettle = null;
function closeModal() {
  const root = $("#modalRoot");
  if (!root.innerHTML) return;
  root.innerHTML = "";
  document.body.style.overflow = drawerOpen() ? "hidden" : "";
  if (modalSettle) { modalSettle(false); modalSettle = null; }
}
function openModal({ title, sub = "", body = "", foot = "", wide = false, onMount }) {
  document.body.style.overflow = "hidden";
  const root = $("#modalRoot");
  root.innerHTML = `
    <div class="modal-mask" data-mask>
      <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${title}</h3><span class="sub">${sub}</span><span class="grow"></span>
          <button class="btn icon sm ghost" data-close title="关闭">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${foot || '<button class="btn ghost" data-close>关闭</button>'}</div>
      </div>
    </div>`;
  root.querySelector("[data-mask]").addEventListener("mousedown", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  if (onMount) onMount(root);
  return root;
}
function confirmModal({ title, text, okText = "确认", danger = false, extra = "" }) {
  return new Promise((resolve) => {
    modalSettle = resolve;
    openModal({
      title, body: `<div class="sub" style="font-size:12.5px;line-height:1.9">${text}</div>${extra}`,
      foot: `<button class="btn ghost" data-close>取消</button>
             <button class="btn ${danger ? "danger" : "gold"}" data-ok>${okText}</button>`,
      onMount(root) {
        root.querySelector("[data-ok]").addEventListener("click", () => {
          if (modalSettle) { modalSettle(true); modalSettle = null; }
          $("#modalRoot").innerHTML = "";
          document.body.style.overflow = drawerOpen() ? "hidden" : "";
          resolve(true);
        });
      },
    });
  });
}
function busy(btn, fn) {
  if (!btn || btn.disabled) return Promise.resolve();
  btn.disabled = true;
  return Promise.resolve(fn()).finally(() => { btn.disabled = false; });
}

/* ---------------- 路由 ---------------- */
function go(view) {
  if (!VIEW_META[view]) view = "dash";
  if (location.hash !== `#/${view}`) location.hash = `#/${view}`;
  else applyRoute(true);
}
function applyRoute(force) {
  const v = (location.hash.match(/^#\/([a-z]+)/) || [])[1] || "dash";
  const view = VIEW_META[v] ? v : "dash";
  if (S.view === "sys" && view !== "sys") stopSysRefresh();
  S.view = view;
  $$(".nav-item").forEach((b) => b.classList.toggle("on", b.dataset.nav === view));
  $$(".view").forEach((s) => { s.hidden = s.id !== `view-${view}`; });
  $("#vTitle").textContent = VIEW_META[view].t;
  $("#vSub").textContent = VIEW_META[view].s;
  document.title = `拾缘 · ${VIEW_META[view].t}`;
  if (force) loadView(view);
}
function loadView(view) {
  const map = { dash: loadDash, users: loadUsers, banners: loadBanners, bgm: loadBgm, logs: loadLogs, sys: loadSys };
  return (map[view] || loadDash)().catch((e) => { if (e.message !== "auth") toast(e.message, "err"); });
}
function stamp() {
  const d = new Date();
  $("#stamp").textContent = `更新于 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ---------------- 登录 ---------------- */
function showLogin(msg) {
  $("#shell").hidden = true;
  $("#login").hidden = false;
  $("#loginErr").textContent = msg || "";
  setTimeout(() => $("#loginUser").focus(), 30);
}
function enterApp() {
  $("#login").hidden = true;
  $("#shell").hidden = false;
  $("#meName").textContent = S.me || "管理员";
  $("#meAva").textContent = (S.me || "拾").slice(0, 1);
  applyRoute(true);
}
async function doLogin() {
  const username = $("#loginUser").value.trim();
  const password = $("#loginPass").value;
  if (!username || !password) { $("#loginErr").textContent = "请输入用户名和密码"; return; }
  const btn = $("#loginGo");
  btn.disabled = true;
  $("#loginErr").textContent = "";
  try {
    const r = await fetch("/api/auth", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "login", username, password }),
    });
    const j = await r.json();
    if (!j.ok) { $("#loginErr").textContent = j.error || "登录失败"; return; }
    TOKEN = j.token;
    sessionStorage.setItem(TOKEN_KEY, TOKEN);
    // 权限探测：非管理员 here 就被 403 挡下，不会进面板
    try { const me = await api({ op: "me" }); S.me = me.me.username; }
    catch (e) {
      if (e.message === "auth") return;
      sessionStorage.removeItem(TOKEN_KEY);
      $("#loginErr").textContent = e.message === "需要管理员权限" ? "该账号不是管理员" : (e.message || "登录失败");
      return;
    }
    sessionStorage.setItem(NAME_KEY, S.me);
    $("#loginPass").value = "";
    await bootData();
    enterApp();
    stamp();
  } catch (e) {
    $("#loginErr").textContent = "网络异常：" + (e.message || e);
  } finally { btn.disabled = false; }
}
async function doLogout() {
  const ok = await confirmModal({ title: "退出登录", text: "确定退出 GM 控制台？", okText: "退出" });
  if (!ok) return;
  try {
    await fetch("/api/logout", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
  } catch {}
  TOKEN = "";
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(NAME_KEY);
  location.reload();
}

/* ---------------- 启动数据 ---------------- */
async function loadRoster() {
  if (S.rosterReady) return;
  const r = await fetch("/api/boot", { headers: { authorization: `Bearer ${TOKEN}` } });
  if (r.status === 401) { showLogin("登录已过期，请重新登录"); throw new Error("auth"); }
  if (!r.ok) throw new Error("角色名册加载失败");
  const j = await r.json();
  S.roster = j.roster || [];
  S.rosterById = Object.fromEntries(S.roster.map((c) => [c.id, c]));
  S.rosterReady = true;
}
async function bootData() {
  await loadRoster();
  const st = await api({ op: "stats" });
  S.dash = st.stats;
  $("#navUserCount").textContent = fmtCompact(st.stats.users.total);
}

/* ---------------- 概览 ---------------- */
async function loadDash() {
  const j = await api({ op: "stats" });
  S.dash = j.stats;
  $("#navUserCount").textContent = fmtCompact(j.stats.users.total);
  renderDash();
  stamp();
}
function kpi(label, value, sub, cls = "", icon = "") {
  return `<div class="kpi ${cls}">
    <div class="lab">${icon}${label}</div>
    <div class="val">${value}</div>
    <div class="sub">${sub}</div>
  </div>`;
}
function renderDash() {
  const s = S.dash;
  if (!s) { $("#dashKpis").innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const u = s.users, b = s.banners, sv = s.saves;
  $("#dashKpis").innerHTML = [
    kpi("账号总数", fmtCompact(u.total), `<span>今日 <b>+${fmtInt(u.today)}</b></span><span>本周 <b>+${fmtInt(u.week)}</b></span>`, "gold",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/></svg>'),
    kpi("今日新增", fmtInt(u.today), `<span>近 30 日 <b>${fmtInt(u.month)}</b> · 管理员 ${fmtInt(u.admins)}</span>`, "",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'),
    kpi("风控中", fmtInt(u.banned + u.frozen), `<span>禁用 <b>${fmtInt(u.banned)}</b></span><span>冻结 <b>${fmtInt(u.frozen)}</b></span>`, "",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3.5 19.5 6v5.5c0 4.6-3 7.5-7.5 9-4.5-1.5-7.5-4.4-7.5-9V6z"/><path d="M9.5 12h5"/></svg>'),
    kpi("在线卡池", fmtInt(b.live), `<span>自定义 <b>${fmtInt(b.custom)}</b></span>${b.expiring ? `<span class="tag bad">3 日内到期 ${b.expiring}</span>` : "<span>无临期</span>"}`, "",
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7"/><path d="M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2"/><path d="M9.5 9h6M9.5 12.5h6M9.5 16h4"/></svg>'),
  ].join("");

  // 注册趋势
  const max = Math.max(1, ...s.daily.map((d) => d.n));
  const bars = s.daily.map((d) => `<div class="bar ${d.n ? "" : "zero"}" style="height:${Math.max(3, Math.round(d.n / max * 100))}%"
      title="${d.d} · 新增 ${d.n} 个账号"></div>`).join("");
  const xs = s.daily.map((d) => `<span title="${d.d}">${Number(d.d.slice(8))}</span>`).join("");
  const sum = s.daily.reduce((a, d) => a + d.n, 0);
  $("#dashTrendSum").textContent = `14 日合计 ${fmtInt(sum)}`;
  $("#dashChart").innerHTML = `<div class="chart">${bars}</div><div class="chart-x">${xs}</div>`;

  // 运营存量
  $("#dashOps").innerHTML = `
    <div class="stat-grid">
      <div class="stat gold"><span>抽卡总量</span><b>${fmtCompact(sv.pulls)}</b></div>
      <div class="stat"><span>铜钱存量</span><b>${fmtCompact(sv.coin)}</b></div>
      <div class="stat"><span>缘玉存量</span><b>${fmtCompact(sv.jade)}</b></div>
      <div class="stat"><span>平均图鉴</span><b>${sv.avgCollected}</b></div>
      <div class="stat"><span>存档数</span><b>${fmtInt(sv.saves)}</b></div>
      <div class="stat"><span>角色持有总量</span><b>${fmtCompact(sv.cards)}</b></div>
    </div>
    <div class="hint" style="margin-top:11px">读数来自全部存档聚合；抽卡/货币取生成存档时的累计值。</div>`;

  // 最近注册
  $("#dashRecent").innerHTML = s.recentUsers.length
    ? `<table><thead><tr><th>ID</th><th>用户名</th><th>状态</th><th>注册</th></tr></thead><tbody>${
        s.recentUsers.map((u2) => `
          <tr class="clickable" data-open-user="${u2.id}">
            <td class="id">${u2.id}</td>
            <td><div class="uname">${esc(u2.username)} ${u2.role === "admin" ? '<span class="tag gold">管理</span>' : ""}</div></td>
            <td>${statusTag({ status: u2.status, frozenUntil: u2.frozenUntil })}</td>
            <td class="num">${relTime(u2.created_at)}</td>
          </tr>`).join("")}</tbody></table>`
    : '<div class="empty">暂无账号</div>';

  // 最近操作
  $("#dashLogs").innerHTML = s.recentLogs.length
    ? s.recentLogs.map((l) => {
        const m = OP_META[l.op] || { t: l.op, c: "" };
        return `<div class="lg"><span class="dot"></span>
          <div class="lt">${relTime(l.created_at)}</div>
          <div class="lc"><b>${esc(l.admin_name)}</b> <span class="tag ${m.c}" style="display:inline-flex;margin:0 4px">${m.t}</span>
            ${l.target_name ? `<b>${esc(l.target_name)}</b>` : ""}
            <span>${esc(logDetailText(l))}</span></div></div>`;
      }).join("")
    : '<div class="empty">还没有后台操作记录</div>';
}

/* ---------------- 账号列表 ---------------- */
function renderLoadingRows(tbody, cols) {
  tbody.innerHTML = Array.from({ length: 6 }, () =>
    `<tr>${Array.from({ length: cols }, () => '<td><div class="skel"></div></td>').join("")}</tr>`).join("");
}
async function loadUsers() {
  const u = S.users;
  const tbody = $("#uRows");
  renderLoadingRows(tbody, 12);
  try {
    const j = await api({ op: "users", page: u.page, pageSize: u.pageSize, q: u.q, state: u.state, role: u.role });
    u.rows = j.users; u.total = j.total; u.page = j.page; u.pages = j.pages; u.pageSize = j.pageSize;
    renderUsers();
    stamp();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="12"><div class="empty">读取失败：${esc(e.message)}</div></td></tr>`;
    throw e;
  }
}
function renderUsers() {
  const u = S.users;
  $("#uCount").textContent = `共 ${fmtInt(u.total)} 个账号 · 第 ${u.page} / ${u.pages} 页`;
  $("#uRows").innerHTML = u.rows.length
    ? u.rows.map((x) => `
      <tr class="clickable" data-open-user="${x.id}">
        <td class="id">${x.id}</td>
        <td><div class="uname"><span class="mini-ava">${esc(x.username.slice(0, 1))}</span>${esc(x.username)}
          ${x.role === "admin" ? '<span class="tag gold">管理</span>' : ""}</div></td>
        <td>${statusTag(x)}</td>
        <td class="num">${fmtInt(x.collected)}</td>
        <td class="num hide-sm">${fmtInt(x.teamPower)}</td>
        <td class="num hide-sm">${fmtInt(x.stars)}</td>
        <td class="num hide-sm">${fmtInt(x.wins)}</td>
        <td class="num hide-sm">${fmtInt(x.pulls)}</td>
        <td class="num">${fmtInt(x.wallet && x.wallet.coin)}</td>
        <td class="num hide-sm">${fmtInt(x.wallet && x.wallet.jade)}</td>
        <td class="num hide-sm">${fmtD(x.created_at)}</td>
        <td class="ops hide-sm"><button class="btn sm ghost" data-open-user="${x.id}">详情 ›</button></td>
      </tr>`).join("")
    : `<tr><td colspan="12"><div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5" stroke-linecap="round"/></svg>
        没有匹配的账号${u.q ? `：${esc(u.q)}` : ""}</div></td></tr>`;
  $("#uFoot").innerHTML = `
    <span class="sub">每页</span>
    <select id="uPageSize" style="height:28px;font-size:12px">
      ${[15, 30, 50, 100].map((n) => `<option value="${n}" ${n === u.pageSize ? "selected" : ""}>${n}</option>`).join("")}
    </select>
    <span class="grow"></span>
    <div class="pager">${pageNums(u.page, u.pages)}</div>`;
}
function exportUsersCSV() {
  const u = S.users;
  if (!u.rows.length) return toast("当前页没有数据", "err");
  const head = ["id", "用户名", "角色", "状态", "图鉴", "战力", "星数", "胜场", "抽卡", "铜钱", "缘玉", "冻结至", "注册时间"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.map(cell).join(",")];
  for (const x of u.rows) {
    const st = Number(x.status) === 1 ? "已禁用" : x.frozenUntil > Date.now() ? "冻结中" : "正常";
    lines.push([x.id, x.username, x.role === "admin" ? "管理员" : "玩家", st, x.collected, x.teamPower, x.stars, x.wins,
      x.pulls, (x.wallet && x.wallet.coin) || 0, (x.wallet && x.wallet.jade) || 0,
      x.frozenUntil ? fmtDT(x.frozenUntil) : "", fmtDT(x.created_at)].map(cell).join(","));
  }
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `拾缘账号_第${u.page}页_${fmtD(Date.now())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`已导出本页 ${u.rows.length} 条`, "ok");
}

/* ---------------- 账号抽屉 ---------------- */
function drawerOpen() { return $("#drawer").classList.contains("on"); }
async function openUser(id, tab) {
  S.drawer.id = Number(id);
  if (tab) S.drawer.tab = tab;
  $("#drMask").classList.add("on");
  const dr = $("#drawer");
  dr.classList.add("on");
  dr.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  dr.innerHTML = `<div class="dr-head"><div class="dr-ava">…</div><div><div class="dr-name">加载中…</div>
      <div class="dr-meta">#${esc(id)}</div></div><span class="grow"></span>
      <button class="btn icon sm ghost" data-dr-close title="关闭">✕</button></div>
      <div class="dr-body"><div class="empty">正在读取存档…</div></div>`;
  await loadDrawer();
}
function closeDrawer() {
  $("#drawer").classList.remove("on");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#drMask").classList.remove("on");
  if (!$("#modalRoot").innerHTML) document.body.style.overflow = "";
  S.drawer.detail = null;
}
async function loadDrawer(silent) {
  if (!S.drawer.id) return;
  try {
    const j = await api({ op: "userDetail", userId: S.drawer.id });
    S.drawer.detail = j.detail;
    renderDrawer();
  } catch (e) {
    if (e.message === "auth") return;
    if (!silent) toast(e.message, "err");
    $("#drawer").querySelector(".dr-body").innerHTML = `<div class="empty">读取失败：${esc(e.message)}</div>`;
  }
}
function renderDrawer() {
  const d = S.drawer.detail;
  if (!d) return;
  const dr = $("#drawer");
  const tabs = [
    ["overview", "概览", ""],
    ["cards", "角色", d.cards.length],
    ["equips", "缘器", d.equips.length],
    ["actions", "操作", ""],
  ];
  const frozen = d.frozenUntil && d.frozenUntil > Date.now();
  const st = Number(d.status) === 1 ? '<span class="tag bad">已禁用</span>'
    : frozen ? `<span class="tag warn">冻结至 ${fmtDT(d.frozenUntil)}</span>` : '<span class="tag ok">正常</span>';
  dr.innerHTML = `
    <div class="dr-head">
      <div class="dr-ava">${esc(d.username.slice(0, 1))}</div>
      <div style="min-width:0">
        <div class="dr-name">${esc(d.username)} ${d.role === "admin" ? '<span class="tag gold">管理员</span>' : ""} ${st}</div>
        <div class="dr-meta">#${d.id} · 注册 ${fmtDT(d.createdAt)}${d.displayName ? ` · 昵称 ${esc(d.displayName)}` : ""}</div>
      </div>
      <span class="grow"></span>
      <button class="btn icon sm ghost" data-dr-close title="关闭">✕</button>
    </div>
    <div class="dr-tabs">
      ${tabs.map(([k, label, n]) => `<button class="dr-tab ${S.drawer.tab === k ? "on" : ""}" data-tab="${k}">${label}${n ? `<span class="n">${n}</span>` : ""}</button>`).join("")}
    </div>
    <div class="dr-body">${drawerBody(d)}</div>
    <div class="dr-foot">
      <span class="sub">操作会立即写入玩家存档</span><span class="grow"></span>
      <button class="btn ghost sm" data-dr-close>关闭</button>
    </div>`;
}
function drawerBody(d) {
  if (S.drawer.tab === "cards") return drawerCards(d);
  if (S.drawer.tab === "equips") return drawerEquips(d);
  if (S.drawer.tab === "actions") return drawerActions(d);
  return drawerOverview(d);
}
function drawerOverview(d) {
  const w = d.wallet || {};
  const mat = w.mat || {};
  const tome = w.tome || {};
  const shard = w.shard || {};
  const shardSum = Object.values(shard).reduce((a, n) => a + Number(n || 0), 0);
  const chip = (label, v, gold) => `<span class="wchip ${gold ? "gold" : ""}">${label}<b>${fmtInt(v)}</b></span>`;
  return `
    ${Number(d.status) === 1 || d.frozenUntil > Date.now() ? `
      <div class="dr-sec"><div class="danger-zone" style="padding:10px 12px">
        <h4 style="margin:0 0 4px">${Number(d.status) === 1 ? "账号已被禁用" : "账号冻结中"}</h4>
        <div class="sub">${Number(d.status) === 1 ? `理由：${esc(d.banReason || "未填写")}` : `解冻时间：${fmtDT(d.frozenUntil)}`}</div>
      </div></div>` : ""}
    <div class="dr-sec">
      <h3>养成概览 <span class="grow"></span></h3>
      <div class="stat-grid">
        <div class="stat gold"><span>图鉴</span><b>${fmtInt(d.cards.length)}</b></div>
        <div class="stat"><span>战力</span><b>${fmtInt(d.sum.teamPower)}</b></div>
        <div class="stat"><span>星数</span><b>${fmtInt(d.sum.stars)}</b></div>
        <div class="stat"><span>胜场</span><b>${fmtInt(d.sum.wins)}</b></div>
        <div class="stat"><span>抽卡</span><b>${fmtInt(d.sum.pulls)}</b></div>
        <div class="stat"><span>通关关卡</span><b>${fmtInt(d.stagesCleared)}</b></div>
      </div>
    </div>
    <div class="dr-sec">
      <h3>资产 <span class="grow"></span></h3>
      <div class="wall">
        ${chip("铜钱", w.coin, true)}${chip("缘玉", w.jade, true)}${chip("尘缘", w.essence)}${chip("心神", w.stamina)}
      </div>
      <div class="wall" style="margin-top:7px">
        ${Object.entries(MAT).map(([k, label]) => chip(label, mat[k])).join("")}
      </div>
      <div class="wall" style="margin-top:7px">
        ${chip("残卷·紫", tome.purple)}${chip("残卷·金", tome.gold)}${chip("残卷·红", tome.red)}${chip("通用残卷", shardSum)}
      </div>
    </div>
    <div class="dr-sec">
      <h3>当前阵容 <span class="grow"></span></h3>
      ${(d.team || []).length ? `<div class="team">${d.team.map((id) => {
        const c = (d.cards || []).find((x) => x.id === id);
        return `<div class="mem">${avatarHTML(id)}<div><b>${esc(charName(id))}</b><span>${c ? `Lv.${c.level} · ★${c.star}` : "—"}</span></div></div>`;
      }).join("")}</div>` : '<div class="sub">未编队</div>'}
    </div>`;
}
function drawerCards(d) {
  const list = d.cards.filter((c) => (S.drawer.crar === "all" || c.rarity === S.drawer.crar)
    && (!S.drawer.cq || c.name.toLowerCase().includes(S.drawer.cq) || c.id.toLowerCase().includes(S.drawer.cq)));
  return `
    <div class="dr-sec">
      <h3>角色 <span class="grow"></span>
        <button class="btn sm gold" data-grant-chars>＋ 发放角色</button></h3>
      <div class="chips" style="margin-bottom:9px">
        <button class="chip ${S.drawer.crar === "all" ? "on" : ""}" data-crar="all">全部 ${d.cards.length}</button>
        ${RAR_ORDER.map((r) => `<button class="chip ${S.drawer.crar === r ? "on" : ""}" data-crar="${r}">${RAR[r]} ${d.cards.filter((c) => c.rarity === r).length}</button>`).join("")}
      </div>
      <input id="cardQ" placeholder="搜索角色名 / id" value="${esc(S.drawer.cq)}" style="width:100%;margin-bottom:9px" autocomplete="off">
      <div class="clist" id="cardList">${cardListHTML(list)}</div>
      <div class="hint" style="margin-top:10px">等级上限随稀有度（UR 80）；突破会提高可升等级。改完点「保存」立即写入该玩家存档。</div>
    </div>`;
}
function cardListHTML(list) {
  if (!list.length) return '<div class="empty">没有匹配的角色</div>';
  return list.map((c) => `
    <div class="crow" data-card="${esc(c.id)}">
      ${avatarHTML(c.id)}
      <div class="cmeta">
        <div class="cname">${esc(c.name)} ${rarTag(c.rarity)}</div>
        <div class="csub">${esc(c.roleLabel || "")} · 重复 ${fmtInt(c.dupes)} · 本体残卷 ${fmtInt(c.sameShard)}</div>
      </div>
      <div class="cedit">
        <label>等级<input data-f="level" type="number" min="1" max="${c.levelCap}" value="${c.level}"></label>
        <label>星<input data-f="star" type="number" min="1" max="${c.starCap}" value="${c.star}"></label>
        <label>突破<input data-f="bt" type="number" min="0" max="${c.btCap}" value="${c.bt}"></label>
        <button class="btn sm" data-card-save>保存</button>
      </div>
    </div>`).join("");
}
function drawerEquips(d) {
  const worn = d.equips.filter((e) => e.wornBy).length;
  const ex = d.equips.filter((e) => e.exclusive).length;
  const kinds = ["weapon", "artifact", "talisman", "attire"];
  return `
    <div class="dr-sec">
      <h3>缘器 <span class="grow"></span>
        <span class="tag">${d.equips.length} 件</span><span class="tag ok">穿戴 ${worn}</span><span class="tag gold">本命 ${ex}</span></h3>
      <div class="tbl-wrap tall">
        <table class="eqlist">
          <thead><tr><th>名称</th><th>部位</th><th>稀有</th><th>强化</th><th>状态</th></tr></thead>
          <tbody>${d.equips.length ? d.equips.map((e) => `
            <tr>
              <td>${esc(e.name)}${e.exclusive ? ' <span class="tag gold">本命</span>' : ""}</td>
              <td class="sub">${KIND[e.kind] || esc(e.kind)}</td>
              <td>${rarTag(e.rarity)}</td>
              <td class="num">${e.level}</td>
              <td class="${e.wornBy ? "eq-worn" : "eq-free"}">${e.wornBy ? esc(charName(e.wornBy)) : "未穿戴"}</td>
            </tr>`).join("") : '<tr><td colspan="5"><div class="empty">还没有缘器</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="dr-sec">
      <h3>发放 <span class="grow"></span></h3>
      <div class="form-row">
        <div><label>部位</label><select id="eqKind">${kinds.map((k) => `<option value="${k}">${KIND[k]}</option>`).join("")}</select></div>
        <div><label>稀有度</label><select id="eqRar">${EQ_RAR_ORDER.map((r) => `<option value="${r}">${RAR[r]}</option>`).join("")}</select></div>
        <div><label>强化等级</label><input id="eqLv" type="number" value="0" min="0" max="15" style="width:80px"></div>
        <button class="btn" data-eq-grant>发放缘器</button>
      </div>
      <div class="form-row" style="margin-top:10px">
        <div style="min-width:180px"><label>本命直发 · 角色</label>
          <select id="exChar" style="min-width:180px">${d.cards.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}（${esc(c.id)}）</option>`).join("")}</select>
        </div>
        <button class="btn" data-ex-grant>直发本命</button>
      </div>
      <div class="hint" style="margin-top:8px">本命会跳过突破/铜钱门槛、自动绑定并穿到专属槽；已有本命会被拒绝。</div>
    </div>
    <div class="dr-sec">
      <h3>回收 <span class="grow"></span></h3>
      <div class="form-row">
        <div><label>稀有度</label><select id="rvRar">
          <option value="">全部</option>${RAR_ORDER.map((r) => `<option value="${r}">${RAR[r]}</option>`).join("")}
        </select></div>
        <label style="display:flex;align-items:center;gap:6px;margin:0 0 8px;color:var(--dim);font-size:12px">
          <input id="rvEx" type="checkbox" style="width:14px;height:14px;padding:0">含本命
        </label>
        <button class="btn warn" data-eq-revoke>回收未穿戴</button>
      </div>
      <div class="hint" style="margin-top:6px">只回收未穿戴的缘器，穿戴中的一律保留。</div>
    </div>`;
}
function drawerActions(d) {
  const frozen = d.frozenUntil && d.frozenUntil > Date.now();
  const banned = Number(d.status) === 1;
  const preset = (k, n, label) => `<button class="preset" data-preset="${k}:${n}">${label}</button>`;
  return `
    <div class="dr-sec">
      <h3>发放资源 <span class="grow"></span></h3>
      <div class="form-grid">
        <div><label>铜钱</label><input id="grCoin" type="number" value="0" min="0"></div>
        <div><label>缘玉</label><input id="grJade" type="number" value="0" min="0"></div>
        <div><label>尘缘</label><input id="grEss" type="number" value="0" min="0"></div>
        <div><label>心神</label><input id="grSta" type="number" value="0" min="0"></div>
        ${Object.entries(MAT).map(([k, label]) => `<div><label>${label}</label><input id="gr_${k}" type="number" value="0" min="0"></div>`).join("")}
      </div>
      <div class="presets">
        ${preset("grCoin", 10000, "铜钱 +1万")}${preset("grCoin", 100000, "铜钱 +10万")}
        ${preset("grJade", 1000, "缘玉 +1000")}${preset("grEss", 5000, "尘缘 +5000")}
        ${preset("grSta", 100, "心神 +100")}
        <button class="preset" data-preset="allmat:100">全部材料 +100</button>
      </div>
      <button class="btn gold" data-res-grant style="margin-top:11px">执行发放</button>
      <div class="hint" style="margin-top:7px">发放会累加到现有资产，写在玩家存档里，不经过邮件。</div>
    </div>

    <div class="dr-sec">
      <h3>账号状态 <span class="grow"></span></h3>
      ${banned ? `
        <div class="danger-zone" style="margin-bottom:10px">
          <h4>当前已禁用</h4>
          <div class="sub">理由：${esc(d.banReason || "未填写")}</div>
          <button class="btn sm" data-unban style="margin-top:9px">解除禁用</button>
        </div>` : `
        <div class="form-row">
          <div style="flex:1;min-width:200px"><label>禁用理由（会展示给玩家）</label>
            <input id="banReason" placeholder="如：使用外挂 / 恶意刷屏" style="width:100%"></div>
          <button class="btn danger" data-ban>禁用账号</button>
        </div>`}
      <div class="form-row" style="margin-top:12px">
        <div style="min-width:200px">
          <label>冻结时长</label>
          <div class="chips" id="fzChips">
            <button class="chip" data-fz="1">1 小时</button>
            <button class="chip on" data-fz="24">1 天</button>
            <button class="chip" data-fz="168">7 天</button>
            <button class="chip" data-fz="720">30 天</button>
          </div>
        </div>
        <div><label>自定义（小时）</label><input id="fzHours" type="number" value="24" min="1" style="width:100px"></div>
        <button class="btn warn" data-freeze>${frozen ? "重新冻结" : "冻结账号"}</button>
        ${frozen ? '<button class="btn" data-unfreeze>解除冻结</button>' : ""}
      </div>
      <div class="hint" style="margin-top:7px">冻结立即踢下线，到期自动恢复，不必手动解冻。</div>
    </div>

    <div class="dr-sec">
      <h3>登录密码 <span class="grow"></span></h3>
      <div class="form-row">
        <div style="flex:1;min-width:200px"><label>重置为随机密码（12 位，含字母和数字）</label>
          <div class="sub" style="font-size:11.5px">重置后旧密码立即失效，该账号所有设备强制下线；新密码只在本弹窗显示一次。</div></div>
        <button class="btn warn" data-reset-password>重置密码</button>
      </div>
      <div id="pwResetBox" style="display:none;margin-top:10px;padding:10px 12px;border:1px solid rgba(232,201,138,.4);border-radius:10px;background:rgba(232,201,138,.08)">
        <div class="sub" style="font-size:11.5px">新密码（请立即告知玩家，关闭后不再显示）</div>
        <div style="display:flex;align-items:center;gap:9px;margin-top:6px">
          <code id="pwResetVal" style="flex:1;font-size:17px;letter-spacing:.06em;color:var(--gold);user-select:all"></code>
          <button class="btn sm" id="pwResetCopy">复制</button>
        </div>
      </div>
    </div>

    <div class="dr-sec">
      <h3>危险操作 <span class="grow"></span></h3>
      <div class="danger-zone">
        <h4>清空存档</h4>
        <div class="sub">重置为空号存档（开局角色与货币按初始配置重发），账号与登录密码保留。不可撤销。</div>
        <div class="form-row" style="margin-top:9px">
          <div style="flex:1;min-width:180px"><label>输入用户名确认：<b style="color:var(--ink)">${esc(d.username)}</b></label>
            <input id="wipeName" placeholder="${esc(d.username)}" style="width:100%" autocomplete="off"></div>
          <button class="btn danger" data-wipe>清档</button>
        </div>
      </div>
    </div>`;
}

/* ---------------- 抽屉动作 ---------------- */
async function saveCardRow(row, btn) {
  const d = S.drawer.detail;
  const id = row.dataset.card;
  const level = Number(row.querySelector('[data-f="level"]').value);
  const star = Number(row.querySelector('[data-f="star"]').value);
  const bt = Number(row.querySelector('[data-f="bt"]').value);
  await busy(btn, async () => {
    const j = await api({ op: "setcard", userId: d.id, id, level, star, bt });
    toast(`${charName(id)} 已更新：Lv.${j.card.level} · ★${j.card.star} · 突${j.card.bt}`, "ok");
    await loadDrawer(true);
    loadUsers().catch(() => {});
  });
}
async function handleDrawerClick(e) {
  const d = S.drawer.detail;
  if (!d) return;
  const t = e.target;

  if (t.closest("[data-dr-close]")) return closeDrawer();
  const tab = t.closest("[data-tab]");
  if (tab) { S.drawer.tab = tab.dataset.tab; return renderDrawer(); }

  const crar = t.closest("[data-crar]");
  if (crar) {
    S.drawer.crar = crar.dataset.crar;
    return renderDrawer();
  }

  if (t.closest("[data-grant-chars]")) return openCharPicker();

  const saveBtn = t.closest("[data-card-save]");
  if (saveBtn) {
    const row = saveBtn.closest("[data-card]");
    return run(() => saveCardRow(row, saveBtn));
  }

  if (t.closest("[data-eq-grant]")) {
    const kind = $("#eqKind").value, rarity = $("#eqRar").value, level = Number($("#eqLv").value) || 0;
    return run(async () => {
      const j = await api({ op: "grantEquip", userId: d.id, kind, rarity, level });
      toast(`已发放 ${KIND[kind]} ${RAR[rarity]} +${j.item.level}`, "ok");
      await loadDrawer(true);
    });
  }
  if (t.closest("[data-ex-grant]")) {
    const id = $("#exChar").value;
    if (!id) return toast("先选角色", "err");
    const ok = await confirmModal({ title: "直发本命缘器", okText: "发放",
      text: `给 <b>${esc(d.username)}</b> 直发 <b>${esc(charName(id))}</b> 的本命缘器？<br>会跳过突破与铜钱门槛，自动绑定并穿戴；已有本命会被拒绝。` });
    if (!ok) return;
    return run(async () => {
      await api({ op: "grantExclusive", userId: d.id, id });
      toast(`本命缘器已发放：${charName(id)}`, "ok");
      await loadDrawer(true);
    });
  }
  if (t.closest("[data-eq-revoke]")) {
    const rarity = $("#rvRar").value;
    const withExclusive = $("#rvEx").checked;
    if (!rarity && !withExclusive) return toast("选稀有度，或勾「含本命」", "err");
    const ok = await confirmModal({ title: "回收缘器", danger: true, okText: "回收",
      text: `回收 <b>${esc(d.username)}</b> 所有未穿戴的 <b>${rarity ? RAR[rarity] : "全部稀有度"}</b> 缘器${withExclusive ? "（含本命）" : ""}？<br>穿戴中的缘器不会被回收，回收不可撤销。` });
    if (!ok) return;
    return run(async () => {
      const j = await api({ op: "revokeEquip", userId: d.id, rarity: rarity || undefined, all: !rarity, withExclusive });
      toast(`已回收 ${j.revoked} 件缘器`, "ok");
      await loadDrawer(true);
    });
  }

  const preset = t.closest("[data-preset]");
  if (preset) {
    const [k, n] = preset.dataset.preset.split(":");
    if (k === "allmat") {
      Object.keys(MAT).forEach((m) => { const el = $("#gr_" + m); if (el) el.value = (Number(el.value) || 0) + Number(n); });
    } else {
      const el = $("#" + k);
      if (el) el.value = (Number(el.value) || 0) + Number(n);
    }
    return;
  }
  if (t.closest("[data-res-grant]")) {
    const g = {};
    for (const [id, key] of [["grCoin", "coin"], ["grJade", "jade"], ["grEss", "essence"]]) {
      const v = Number($("#" + id).value);
      if (v) g[key] = v;
    }
    const mat = {};
    Object.keys(MAT).forEach((m) => { const v = Number($("#gr_" + m)?.value); if (v) mat[m] = v; });
    if (Object.keys(mat).length) g.mat = mat;
    const sta = Number($("#grSta").value);
    if (sta) g.stamina = sta;
    if (!Object.keys(g).length) return toast("什么都没填", "err");
    const btn = t.closest("button");
    return busy(btn, () => run(async () => {
      await api({ op: "grant", userId: d.id, grant: g });
      toast("发放完成", "ok");
      await loadDrawer(true);
    }));
  }

  const fz = t.closest("[data-fz]");
  if (fz) {
    $$("#fzChips .chip").forEach((b) => b.classList.toggle("on", b === fz));
    $("#fzHours").value = fz.dataset.fz;
    return;
  }
  if (t.closest("[data-ban]")) {
    const reason = ($("#banReason")?.value || "").trim();
    const ok = await confirmModal({ title: "禁用账号", danger: true, okText: "禁用并踢下线",
      text: `禁用 <b>${esc(d.username)}</b>？玩家当前会话会被立即注销。${reason ? `<br>理由：${esc(reason)}` : ""}` });
    if (!ok) return;
    return run(async () => {
      await api({ op: "ban", userId: d.id, on: true, reason });
      toast("已禁用并踢下线", "ok");
      await loadDrawer(true);
      loadUsers().catch(() => {});
    });
  }
  if (t.closest("[data-unban]")) {
    const ok = await confirmModal({ title: "解除禁用", okText: "解禁", text: `解除 <b>${esc(d.username)}</b> 的禁用？` });
    if (!ok) return;
    return run(async () => {
      await api({ op: "ban", userId: d.id, on: false });
      toast("已解禁", "ok");
      await loadDrawer(true);
      loadUsers().catch(() => {});
    });
  }
  if (t.closest("[data-freeze]")) {
    const hours = Number($("#fzHours").value);
    if (!hours || hours <= 0) return toast("填一个正数小时", "err");
    const until = new Date(Date.now() + hours * 3600000);
    const ok = await confirmModal({ title: "冻结账号", okText: `冻结 ${hours} 小时`,
      text: `冻结 <b>${esc(d.username)}</b> ${hours} 小时（至 ${fmtDT(until)}）？<br>立即踢下线，到期自动恢复。` });
    if (!ok) return;
    return run(async () => {
      await api({ op: "freeze", userId: d.id, hours });
      toast(`已冻结 ${hours} 小时`, "ok");
      await loadDrawer(true);
      loadUsers().catch(() => {});
    });
  }
  if (t.closest("[data-unfreeze]")) {
    return run(async () => {
      await api({ op: "freeze", userId: d.id, hours: 0 });
      toast("已解除冻结", "ok");
      await loadDrawer(true);
      loadUsers().catch(() => {});
    });
  }
  if (t.closest("[data-reset-password]")) {
    const ok = await confirmModal({ title: "重置登录密码", danger: true, okText: "重置为随机密码",
      text: `把 <b>${esc(d.username)}</b>（#${d.id}）的密码重置为随机密码？<br>旧密码立即失效，该账号所有设备会被强制下线。` });
    if (!ok) return;
    return run(async () => {
      const j = await api({ op: "resetPassword", userId: d.id });
      const pw = j.resetPassword?.password || "";
      const box = $("#pwResetBox"), val = $("#pwResetVal");
      if (box && val) { val.textContent = pw; box.style.display = ""; }
      const copyBtn = $("#pwResetCopy");
      if (copyBtn) copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(pw); copyBtn.textContent = "已复制"; }
        catch { toast(`新密码：${pw}`, "ok"); }
      };
      toast("密码已重置", "ok");
    });
  }
  if (t.closest("[data-wipe]")) {
    const typed = ($("#wipeName")?.value || "").trim();
    if (typed !== d.username) return toast("请输入完整用户名确认", "err");
    const ok = await confirmModal({ title: "清空存档", danger: true, okText: "确认清档",
      text: `确定把 <b>${esc(d.username)}</b>（#${d.id}）的存档重置为空号？<br>角色、缘器、货币、进度全部清空，且不可撤销。` });
    if (!ok) return;
    return run(async () => {
      await api({ op: "wipe", userId: d.id });
      toast("已清档", "ok");
      await loadDrawer(true);
      loadUsers().catch(() => {});
    });
  }
}
function openCharPicker() {
  const d = S.drawer.detail;
  const owned = new Set(d.cards.map((c) => c.id));
  const pool = S.roster.filter((c) => !owned.has(c.id));
  // 按名册既有顺序排队（UR→N 的出品顺序），新加入的角色自然排在最后；不再按名字重排。
  const sel = new Set();
  let q = "";
  const rowsOf = () => pool.filter((c) => !q || c.name.includes(q) || c.id.toLowerCase().includes(q));
  const listHTML = () => {
    const rows = rowsOf();
    if (!rows.length) return '<div class="empty">没有可选角色</div>';
    return rows.map((c) => `
      <label class="pick ${sel.has(c.id) ? "on" : ""}" data-cid="${esc(c.id)}">
        <input type="checkbox" ${sel.has(c.id) ? "checked" : ""}>
        ${avatarHTML(c.id)}
        <span>${esc(c.name)}</span>${rarTag(c.rarity)}
        <span class="pid">${esc(c.id)}</span>
      </label>`).join("");
  };
  const info = () => `已选 ${sel.size} 名 / 共 ${pool.length} 名 · 重复发放会转成本体残卷与尘缘`;
  const root = openModal({
    title: "发放角色", sub: "发放到当前账号", wide: true,
    body: `<input id="cpQ" placeholder="搜索角色名 / id" style="width:100%;margin-bottom:9px" autocomplete="off">
      <div class="pick-tools">
        <label class="pick-all"><input type="checkbox" id="cpAll"><span>全选</span></label>
        <span class="sub" id="cpAllHint"></span>
      </div>
      <div class="pick-list" id="cpList">${listHTML()}</div>
      <div class="sub" id="cpInfo" style="margin-top:9px">${info()}</div>`,
    foot: `<button class="btn ghost" data-close>取消</button>
      <button class="btn gold" id="cpOk" disabled>发放所选</button>`,
    onMount(root) {
      const list = root.querySelector("#cpList");
      const okBtn = root.querySelector("#cpOk");
      const allBox = root.querySelector("#cpAll");
      const allHint = root.querySelector("#cpAllHint");
      const syncAll = () => {
        const ids = rowsOf().map((c) => c.id);
        const chosen = ids.filter((id) => sel.has(id)).length;
        allBox.checked = ids.length > 0 && chosen === ids.length;
        allBox.indeterminate = chosen > 0 && chosen < ids.length;
        allBox.disabled = ids.length === 0;
        allHint.textContent = ids.length ? `当前列表 ${ids.length} 名 · 已选 ${chosen} 名` : "没有可选角色";
      };
      const sync = () => {
        root.querySelector("#cpInfo").textContent = info();
        okBtn.disabled = sel.size === 0;
        okBtn.textContent = sel.size ? `发放 ${sel.size} 名` : "发放所选";
        syncAll();
      };
      root.querySelector("#cpQ").addEventListener("input", (ev) => { q = ev.target.value.trim(); list.innerHTML = listHTML(); sync(); });
      allBox.addEventListener("change", () => {
        const ids = rowsOf().map((c) => c.id);
        if (allBox.checked) ids.forEach((id) => sel.add(id));
        else ids.forEach((id) => sel.delete(id));
        list.innerHTML = listHTML();
        sync();
      });
      list.addEventListener("change", (ev) => {
        const row = ev.target.closest("[data-cid]");
        if (!row) return;
        if (ev.target.checked) sel.add(row.dataset.cid); else sel.delete(row.dataset.cid);
        row.classList.toggle("on", ev.target.checked);
        sync();
      });
      okBtn.addEventListener("click", () => busy(okBtn, () => run(async () => {
        await api({ op: "grant", userId: d.id, grant: { chars: [...sel] } });
        toast(`已发放 ${sel.size} 名角色`, "ok");
        closeModal();
        S.drawer.tab = "cards";
        await loadDrawer(true);
      })));
      sync();
    },
  });
  return root;
}

/* ---------------- 背景音乐 ---------------- */
const BGM_SLOT_NAMES = { home: "主城", gacha: "缘阁（抽卡）", battle: "战斗" };
const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
const fmtMT = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
async function loadBgm() {
  $("#bgmRows").innerHTML = '<tr><td colspan="5" class="empty">加载中…</td></tr>';
  try {
    const j = await api({ op: "bgmList" });
    S.bgm.files = j.bgm.files || [];
    S.bgm.rotate = j.bgm.rotate || {};
    S.bgm.slots = j.bgm.slots || ["home", "gacha", "battle"];
    renderBgm();
    stamp();
  } catch (e) {
    $("#bgmRows").innerHTML = `<tr><td colspan="5" class="empty">读取失败：${esc(e.message)}</td></tr>`;
    throw e;
  }
}
function renderBgm() {
  const { files, rotate, slots } = S.bgm;
  $("#bgmRows").innerHTML = files.length ? files.map((f) => `
    <tr>
      <td class="uname">${esc(f.name)}</td>
      <td>${fmtSize(f.size)}</td>
      <td class="hide-sm">${fmtMT(f.mtime)}</td>
      <td><button class="btn ghost sm" data-bgm-play="${esc(f.url)}">▶ 试听</button></td>
      <td><button class="btn ghost sm" data-bgm-del="${esc(f.name)}" ${(f.deletable ?? /-u\d*\.(mp3|wav|ogg)$/i.test(f.name)) ? "" : 'disabled title="内置曲目不可删除"'}>删除</button></td>
    </tr>`).join("") : '<tr><td colspan="5" class="empty">还没有音频文件，点右上角「上传音频」</td></tr>';
  $("#bgmSlots").innerHTML = slots.map((slot) => {
    const chosen = rotate[slot] || [];
    return `<div style="padding:12px 16px;border-bottom:1px solid var(--line)">
      <div style="font-weight:600;margin-bottom:6px">${BGM_SLOT_NAMES[slot] || slot} <span class="sub">(${chosen.length} 首)</span></div>
      ${files.length ? files.map((f) => `
        <label style="display:flex;align-items:center;gap:7px;padding:2px 0;font-size:12.5px;cursor:pointer">
          <input type="checkbox" data-bgm-slot="${slot}" value="${esc(f.name)}" ${chosen.includes(f.name) ? "checked" : ""}>
          <span>${esc(f.name)}</span>
        </label>`).join("") : '<span class="sub">请先上传音频</span>'}
    </div>`;
  }).join("");
  $("#bgmEffective").innerHTML = slots.map((slot) => {
    const list = (rotate[slot] && rotate[slot].length) ? rotate[slot] : ["（默认内置曲）"];
    return `<div><b>${BGM_SLOT_NAMES[slot] || slot}：</b>${list.map(esc).join(" → ")}</div>`;
  }).join("");
}
function readRotate() {
  const rot = {};
  for (const box of $$("input[data-bgm-slot]")) {
    if (!box.checked) continue;
    (rot[box.dataset.bgmSlot] ||= []).push(box.value);
  }
  return rot;
}
async function doBgmUpload() {
  const input = $("#bgmFile");
  const file = input.files && input.files[0];
  if (!file) { toast("请先选择音频文件", "err"); return; }
  if (file.size > 20 * 1024 * 1024) { toast("音频不能超过 20MB", "err"); return; }
  const buf = await file.arrayBuffer();
  let bin = ""; const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  // file.type 本身就是完整的 "audio/mpeg" 之类的 MIME，不能再拼 "audio/" 前缀（否则变成 audio/audio/mpeg 被服务端拒收）
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const MIME_BY_EXT = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg" };
  const mime = /^audio\/[a-z0-9.+-]+$/i.test(file.type || "") ? file.type.toLowerCase() : (MIME_BY_EXT[ext] || "audio/mpeg");
  const data = "data:" + mime + ";base64," + btoa(bin);
  await busy($("#bgmUpload"), async () => {
    const j = await api({ op: "bgmUpload", name: file.name, data });
    if (!j.ok) { toast(j.error || "上传失败", "err"); return; }
    toast(`已上传 ${j.bgm.file}`);
    input.value = "";
    S.bgm.files = j.bgm.files; S.bgm.rotate = j.bgm.rotate;
    renderBgm(); stamp();
  });
}
async function doBgmSave() {
  await busy($("#bgmSave"), async () => {
    const j = await api({ op: "bgmSave", rotate: readRotate() });
    if (!j.ok) { toast(j.error || "保存失败", "err"); return; }
    S.bgm.rotate = j.bgm.rotate;
    toast("轮换配置已保存，玩家下次进游戏生效");
    renderBgm(); stamp();
  });
}

/* ---------------- 卡池 ---------------- */
async function loadBanners() {
  $("#bList").innerHTML = '<div class="empty">加载中…</div>';
  try {
    const [j] = await Promise.all([api({ op: "bannerList" }), loadRoster().catch(() => {})]);
    S.banners.custom = j.banners.custom || [];
    S.banners.all = j.banners.all || [];
    renderBanners();
    stamp();
  } catch (e) {
    $("#bList").innerHTML = `<div class="empty">读取失败：${esc(e.message)}</div>`;
    throw e;
  }
}
function periodText(row) {
  if (!row.endsAt) return "永久";
  return `${row.endsAt <= Date.now() ? "已于" : "至"} ${fmtD(row.endsAt)}`;
}
function upStack(featured) {
  const list = featured || [];
  return `<span class="upstack" title="${esc(list.map(charName).join("、"))}">${
    list.slice(0, 3).map((id) => avatarHTML(id)).join("")}</span>
    <span class="sub" style="margin-left:7px">${esc(list.map(charName).join("、")) || "—"}</span>`;
}
function renderBanners() {
  const { custom, all } = S.banners;
  const cmap = new Map(custom.map((r) => [r.key, r]));
  $("#bCount").textContent = `自定义 ${custom.length} · 在线 ${all.length}`;

  $("#bList").innerHTML = custom.length ? `<div class="tbl-wrap"><table class="btable">
    <thead><tr><th>卡池</th><th>UP 角色</th><th style="width:140px">周期</th><th style="width:62px">排序</th><th style="width:214px"></th></tr></thead>
    <tbody>${custom.map((row) => {
      const expired = row.endsAt && row.endsAt <= Date.now();
      const status = expired ? '<span class="tag bad">已到期</span>'
        : !row.enabled ? '<span class="tag dim">已停用</span>'
        : row.endsAt ? `<span class="tag warn">生效中 · 剩 ${Math.ceil((row.endsAt - Date.now()) / 86400000)} 天</span>`
        : '<span class="tag ok">生效中</span>';
      return `<tr>
        <td>
          <div class="t">${esc(row.label)} <span class="tag">${esc(row.key)}</span>${status}
            ${row.discount ? `<span class="tag bad">${Math.round((1 - row.discount) * 100) / 10} 折</span>` : ""}</div>
        </td>
        <td><div class="s">${upStack(row.featured)}</div></td>
        <td class="bt-period">${periodText(row)}</td>
        <td class="bt-sort">${row.sort ?? "—"}</td>
        <td><div class="bops">
          <button class="btn sm" data-bedit="${esc(row.key)}">编辑</button>
          <button class="btn sm ${row.enabled ? "warn" : ""}" data-btoggle="${esc(row.key)}" data-on="${row.enabled ? 0 : 1}">${row.enabled ? "停用" : "启用"}</button>
          <button class="btn sm danger" data-bdel="${esc(row.key)}">删除</button>
        </div></td>
      </tr>`;
    }).join("")}</tbody></table></div>`
    : '<div class="empty">还没有自定义卡池，点右上角「随机发池」一键上架，或「新建卡池」手动配置</div>';

  const builtin = all.filter((b) => !cmap.has(b.key));
  $("#bBuiltin").innerHTML = builtin.length ? `<div class="tbl-wrap"><table class="btable">
    <thead><tr><th>卡池</th><th>UP 角色</th><th style="width:140px">周期</th><th style="width:62px">排序</th><th style="width:80px"></th></tr></thead>
    <tbody>${builtin.map((b) => `
      <tr>
        <td><div class="t">${esc(b.label)} <span class="tag">${esc(b.key)}</span><span class="tag dim">内置</span>
          ${(b.costDiscount || 0) ? `<span class="tag bad">${Math.round((1 - b.costDiscount) * 100) / 10} 折</span>` : ""}</div></td>
        <td><div class="s">${upStack(b.featured)}</div></td>
        <td class="bt-period">${periodText({ endsAt: b.endsAt })}</td>
        <td class="bt-sort">—</td>
        <td class="ops"><span class="tag dim">只读</span></td>
      </tr>`).join("")}</tbody></table></div>`
    : '<div class="empty">没有内置卡池</div>';
}
function openBannerForm(row) {
  const isNew = !row;
  const b = row ? { ...row } : { key: "", label: "", featured: [], discount: 0, enabled: true, sort: 50, endsAt: 0 };
  let days = isNew ? 20 : (b.endsAt ? (b.endsAt > Date.now() ? Math.max(1, Math.ceil((b.endsAt - Date.now()) / 86400000)) : 20) : 0);
  const sel = new Set(b.featured || []);
  let upq = "";
  const pool = S.roster.slice().sort((x, y) => RAR_ORDER.indexOf(x.rarity) - RAR_ORDER.indexOf(y.rarity) || x.name.localeCompare(y.name, "zh"));

  const upListHTML = () => pool.filter((c) => !upq || c.name.includes(upq) || c.id.toLowerCase().includes(upq))
    .map((c) => {
      const on = sel.has(c.id);
      const off = !on && sel.size >= 3;
      return `<label class="pick ${on ? "on" : ""} ${off ? "dim" : ""}" data-cid="${esc(c.id)}" style="${off ? "opacity:.45" : ""}">
        <input type="checkbox" ${on ? "checked" : ""} ${off ? "disabled" : ""}>
        ${avatarHTML(c.id)}<span>${esc(c.name)}</span>${rarTag(c.rarity)}<span class="pid">${esc(c.id)}</span>
      </label>`;
    }).join("") || '<div class="empty">没有匹配角色</div>';
  const selHTML = () => [...sel].map((id) => `<span class="chip on">${esc(charName(id))}<button data-up-remove="${esc(id)}" style="border:0;background:none;color:inherit;cursor:pointer;margin-left:4px">✕</button></span>`).join("")
    || '<span class="sub">尚未选择 UP 角色</span>';
  const endText = (n) => n > 0 ? `保存后 ${fmtD(Date.now() + n * 86400000)} 自动下架` : "永久上架，不会自动下架";

  const root = openModal({
    title: isNew ? "新建卡池" : `编辑卡池 · ${esc(b.label)}`, sub: "保存后玩家端缘阁即时生效", wide: true,
    body: `
      <div class="form-row">
        <div><label>卡池 key（英文，2-32 位）</label><input id="bfKey" value="${esc(b.key)}" placeholder="featured_xx" style="width:190px" ${isNew ? "" : "readonly"}></div>
        <div style="flex:1;min-width:180px"><label>卡池名</label><input id="bfLabel" value="${esc(b.label)}" placeholder="限定·xxx" style="width:100%"></div>
        <div><label>排序（小在前）</label><input id="bfSort" type="number" min="0" max="99" value="${b.sort ?? 50}" style="width:80px"></div>
      </div>
      <div class="form-row" style="margin-top:12px">
        <div>
          <label>上架周期</label>
          <div class="chips" id="bfDaysChips">
            ${[0, 7, 14, 20, 30].map((n) => `<button class="chip ${n === days ? "on" : ""}" data-days="${n}">${n ? `${n} 天` : "永久"}</button>`).join("")}
          </div>
        </div>
        <span class="grow"></span>
        <div><label>自定义天数（0=永久）</label><input id="bfDays" type="number" min="0" max="3650" value="${days}" style="width:110px"></div>
      </div>
      <div class="hint" id="bfEnd" style="margin-top:7px">${endText(days)}</div>
      <div class="form-row" style="margin-top:12px">
        <div>
          <label>折扣</label>
          <div class="chips" id="bfDiscChips">
            ${[[0, "原价"], [0.05, "9.5 折"], [0.1, "9 折"], [0.2, "8 折"], [0.3, "7 折"]].map(([v, t]) => `<button class="chip ${Math.abs((b.discount || 0) - v) < 1e-6 ? "on" : ""}" data-disc="${v}">${t}</button>`).join("")}
          </div>
        </div>
        <span class="grow"></span>
        <div><label>自定义（0.1 = 九折）</label><input id="bfDisc" type="number" step="0.05" min="0" max="0.5" value="${b.discount || 0}" style="width:110px"></div>
        <div><label>启用</label><div class="switch ${b.enabled ? "on" : ""}" id="bfOn" role="switch" tabindex="0"></div></div>
      </div>
      <div style="margin-top:14px">
        <label>UP 角色（最多 3 名）</label>
        <div class="chips" id="bfSel" style="margin-bottom:8px">${selHTML()}</div>
        <input id="bfUpQ" placeholder="搜索角色名 / id" style="width:100%;margin-bottom:7px" autocomplete="off">
        <div class="pick-list" id="bfUpList">${upListHTML()}</div>
      </div>`,
    foot: `<span class="sub left" id="bfFoot"></span>
      <button class="btn ghost" data-close>取消</button>
      <button class="btn gold" id="bfSave">保存卡池</button>`,
    onMount(root) {
      const endEl = root.querySelector("#bfEnd");
      const daysEl = root.querySelector("#bfDays");
      const syncEnd = () => {
        const n = Math.max(0, Number(daysEl.value) | 0);
        endEl.textContent = endText(n);
        root.querySelectorAll("#bfDaysChips .chip").forEach((c) => c.classList.toggle("on", Number(c.dataset.days) === n));
      };
      daysEl.addEventListener("input", syncEnd);
      root.querySelector("#bfDaysChips").addEventListener("click", (ev) => {
        const c = ev.target.closest("[data-days]");
        if (!c) return;
        daysEl.value = c.dataset.days; syncEnd();
      });
      root.querySelector("#bfDiscChips").addEventListener("click", (ev) => {
        const c = ev.target.closest("[data-disc]");
        if (!c) return;
        root.querySelector("#bfDisc").value = c.dataset.disc;
        root.querySelectorAll("#bfDiscChips .chip").forEach((x) => x.classList.toggle("on", x === c));
      });
      root.querySelector("#bfOn").addEventListener("click", (ev) => ev.currentTarget.classList.toggle("on"));
      const upList = root.querySelector("#bfUpList");
      const selBox = root.querySelector("#bfSel");
      const syncSel = () => {
        selBox.innerHTML = selHTML();
        root.querySelector("#bfFoot").textContent = `已选 ${sel.size} / 3`;
      };
      root.querySelector("#bfUpQ").addEventListener("input", (ev) => { upq = ev.target.value.trim(); upList.innerHTML = upListHTML(); });
      upList.addEventListener("change", (ev) => {
        const row = ev.target.closest("[data-cid]");
        if (!row) return;
        const id = row.dataset.cid;
        if (ev.target.checked) {
          if (sel.size >= 3) { ev.target.checked = false; toast("最多 3 名 UP", "err"); return; }
          sel.add(id);
        } else sel.delete(id);
        upList.innerHTML = upListHTML();
        syncSel();
      });
      selBox.addEventListener("click", (ev) => {
        const rm = ev.target.closest("[data-up-remove]");
        if (!rm) return;
        sel.delete(rm.dataset.upRemove);
        upList.innerHTML = upListHTML();
        syncSel();
      });
      syncSel();
      root.querySelector("#bfSave").addEventListener("click", (ev) => {
        const btn = ev.currentTarget;
        const key = root.querySelector("#bfKey").value.trim();
        const label = root.querySelector("#bfLabel").value.trim();
        if (!/^[a-zA-Z0-9_-]{2,32}$/.test(key)) return toast("卡池 key 需 2-32 位字母/数字/下划线", "err");
        if (!label) return toast("填写卡池名", "err");
        if (!sel.size) return toast("至少选一名 UP 角色", "err");
        const daysN = Math.max(0, Number(root.querySelector("#bfDays").value) | 0);
        return busy(btn, () => run(async () => {
          const j = await api({
            op: "bannerSave", key, label, featured: [...sel],
            discount: Number(root.querySelector("#bfDisc").value) || 0,
            enabled: root.querySelector("#bfOn").classList.contains("on"),
            sort: Number(root.querySelector("#bfSort").value) | 0, days: daysN,
          });
          toast(j.endsAt ? `卡池已保存，${fmtDT(j.endsAt)} 自动下架` : "卡池已保存（永久上架）", "ok");
          closeModal();
          loadBanners();
        }));
      });
    },
  });
  return root;
}

/* ---------------- 操作日志 ---------------- */
function logDetailText(l) {
  let d = null;
  try { d = l.detail ? JSON.parse(l.detail) : null; } catch { return l.detail || ""; }
  if (!d || typeof d !== "object") return l.detail || "";
  switch (l.op) {
    case "grant": {
      const p = [];
      for (const [k, label] of [["coin", "铜钱"], ["jade", "缘玉"], ["essence", "尘缘"], ["stamina", "心神"]])
        if (d[k]) p.push(`${label} +${fmtInt(d[k])}`);
      if (d.mat) for (const [k, v] of Object.entries(d.mat)) if (v) p.push(`${MAT[k] || k} +${fmtInt(v)}`);
      if (d.shard) for (const [k, v] of Object.entries(d.shard)) if (v) p.push(`残卷(${k}) +${fmtInt(v)}`);
      if (d.chars && d.chars.length) p.push(`角色 ${d.chars.map(charName).join("、")}`);
      return p.join(" · ") || "—";
    }
    case "setcard": return `${charName(d.id)} → Lv.${d.level} · ★${d.star} · 突${d.bt}`;    case "grantEquip": return `${KIND[d.kind] || d.kind} ${RAR[d.rarity] || d.rarity} +${d.level || 0}`;
    case "grantExclusive": return `本命：${charName(d.id)}`;
    case "revokeEquip": return `回收 ${d.revoked} 件${d.rarity ? ` ${RAR[d.rarity] || d.rarity}` : ""}${d.withExclusive ? "（含本命）" : ""}`;
    case "ban": return d.on ? `禁用${d.reason ? `：${d.reason}` : ""}` : "解除禁用";
    case "freeze": return d.hours ? `冻结 ${d.hours} 小时` : "解除冻结";
    case "resetPassword": return "已重置为随机密码，全部旧会话已下线";
    case "bannerSave": return `${d.label || ""}${d.enabled ? "" : "（停用）"}${d.days ? ` · ${d.days} 天` : " · 永久"}`;
    case "bannerRandom": return `随机 UP：${d.character || ""} · ${d.label || ""} · ${d.days ? `${d.days} 天` : "永久"}`;
    case "bannerToggle": return d.enabled ? "启用" : "停用";
    case "bannerDelete": return "已删除该卡池";
    case "wipe": return "存档已重置";
    default: return JSON.stringify(d);
  }
}
async function loadLogs() {
  const L = S.logs;
  const j = await api({ op: "logs", page: L.page, pageSize: L.pageSize, opFilter: L.opFilter, q: L.q });
  L.rows = j.logs; L.total = j.total; L.page = j.page; L.pages = j.pages;
  renderLogs();
  stamp();
}
function renderLogs() {
  const L = S.logs;
  $("#lgCount").textContent = `共 ${fmtInt(L.total)} 条记录${L.opFilter || L.q ? "（已筛选）" : ""}`;
  $("#lgRows").innerHTML = L.rows.length ? L.rows.map((l) => {
    const m = OP_META[l.op] || { t: l.op, c: "" };
    return `<tr>
      <td class="num sub">${fmtDT(l.created_at)}</td>
      <td>${esc(l.admin_name)}</td>
      <td><span class="tag ${m.c}">${m.t}</span></td>
      <td>${l.target_id ? `<span class="linkbtn" data-open-user="${l.target_id}">${esc(l.target_name || "#" + l.target_id)}</span>` : esc(l.target_name || "—")}</td>
      <td><div class="lg-detail" data-lg-detail title="点击展开">${esc(logDetailText(l))}</div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="5"><div class="empty">没有符合条件的记录</div></td></tr>`;
  $("#lgFoot").innerHTML = `<span class="sub">第 ${L.page} / ${L.pages} 页</span>
    <span class="grow"></span><div class="pager">${pageNums(L.page, L.pages)}</div>`;
}

/* ---------------- 系统日志 / 运行状态 ---------------- */
const fmtBytes = (n) => {
  n = Number(n || 0);
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
};
const fmtCpu = (ms) => {
  ms = Number(ms) || 0;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} 秒`;
  return fmtDur(ms / 1000);
};
const fmtDur = (sec) => {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分`;
  if (m) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
};
function sysHealthOf(s, rtt) {
  // 健康判定看「最近 60 秒内的事件循环延迟」而不是历史峰值：单次 GC/DB 慢查询会短暂 >1s，属正常；
  // 持续阻塞才是「线程卡住」的信号。
  const samples = (s.eventLoop && s.eventLoop.samples) || [];
  const recentMax = samples.length ? Math.max(...samples.map((x) => Number(x.lag) || 0)) : 0;
  const lag = s.eventLoop ? s.eventLoop.currentLagMs : 0;
  const heapPct = s.mem && s.mem.heapLimit ? s.mem.heapUsed / s.mem.heapLimit : 0;
  if (rtt > 5000 || lag > 5000) return { t: "严重卡顿", c: "bad", why: `事件循环阻塞 ${Math.max(lag, rtt)}ms` };
  if (rtt > 1500 || lag > 1500 || heapPct > 0.92) return { t: "响应变慢", c: "warn", why: heapPct > 0.92 ? "堆内存接近上限" : `延迟 ${Math.max(lag, rtt)}ms` };
  if (recentMax > 1500) return { t: "有过卡顿", c: "warn", why: `近 60 秒峰值 ${Math.round(recentMax)}ms` };
  return { t: "运行正常", c: "ok", why: "事件循环通畅" };
}
async function fetchSysStatus() {
  const t0 = performance.now();
  // 专用超时：普通 api() 的 fetch 没有超时，服务真卡死时页面会一直转圈、看不出「没响应」。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ op: "sysStatus" }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (r.status === 401 || j.authRequired) { showLogin("登录已过期，请重新登录"); throw new Error("auth"); }
    if (!j.ok) throw new Error(j.error || "操作失败");
    S.sys.rttMs = Math.round(performance.now() - t0);
    S.sys.failStreak = 0;
    S.sys.data = j.sys;
    S.sys.hist.push({ t: Date.now(), heap: j.sys.mem.heapUsed, rss: j.sys.mem.rss, lag: j.sys.eventLoop.currentLagMs });
    if (S.sys.hist.length > 40) S.sys.hist.shift();
    return j.sys;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("请求超时（8 秒无响应，服务可能卡住）");
    throw e;
  } finally { clearTimeout(timer); }
}
async function loadSys() {
  const s = await fetchSysStatus();
  renderSys(s);
  await loadSysLogs();
  stamp();
  scheduleSysRefresh();
}
async function loadSysLogs() {
  const S2 = S.sys;
  const j = await api({ op: "sysLogs", source: S2.source, level: S2.level, limit: 400 });
  S2.logs = j.sysLogs || [];
  renderSysLogs();
}
function renderSys(s) {
  if (!s) return;
  const health = sysHealthOf(s, S.sys.rttMs);
  const el = $("#sysHealth");
  el.className = `tag ${health.c === "ok" ? "ok" : health.c === "warn" ? "warn" : "bad"}`;
  el.textContent = `● ${health.t}`;
  el.title = health.why;
  // 诊断结论：直接回答「是不是线程卡住了」
  const recent = (s.eventLoop.samples || []).slice(-60);
  const recentMax = recent.length ? Math.max(...recent.map((x) => Number(x.lag) || 0)) : 0;
  const hint = $("#sysHint");
  if (hint) {
    hint.textContent = health.c === "ok"
      ? `诊断：主线程通畅，未发现线程卡住（当前 ${Math.round(s.eventLoop.currentLagMs)}ms，近 60 秒峰值 ${Math.round(recentMax)}ms）。每 3 秒自动刷新。`
      : `诊断：${health.why}，疑似主线程被阻塞（线程卡住）。请结合下方「后台日志」「慢请求」排查；延迟持续 >1s 即不正常。`;
  }

  const heapPct = s.mem.heapLimit ? Math.round(s.mem.heapUsed / s.mem.heapLimit * 1000) / 10 : 0;
  const sysMemPct = s.system.totalmem ? Math.round((1 - s.system.freemem / s.system.totalmem) * 100) : 0;
  const engines = s.engines || [];
  const enginesUp = engines.filter((e) => e.running).length;
  $("#sysKpis").innerHTML = [
    kpi("后台内存（RSS）", fmtBytes(s.mem.rss), `<span>堆 <b>${fmtBytes(s.mem.heapUsed)}</b> / ${fmtBytes(s.mem.heapTotal)}</span><span>上限 ${fmtBytes(s.mem.heapLimit)}</span>`, "", ""),
    kpi("事件循环延迟（主线程）", `${Math.round(s.eventLoop.currentLagMs)} ms`, `<span>峰值 <b>${Math.round(s.eventLoop.maxLagMs)}</b> ms</span><span>&gt;2s 告警 ${fmtInt(s.eventLoop.stuckEvents)} 次</span>`, s.eventLoop.currentLagMs > 1500 ? "warn" : "", ""),
    kpi("运行时长", fmtDur(s.uptimeSec), `<span>PID <b>${s.pid}</b> · 端口 ${s.port}</span><span>${esc(s.platform)} · Node ${esc(s.node)}</span>`, "", ""),
    kpi("战斗引擎", `已拉起 ${enginesUp} / 池 ${engines.length}`, `<span>按需启动（首战才拉起进程）</span><span>在途请求 <b>${engines.reduce((a, e) => a + e.users, 0)}</b> · HTTP 在途 ${fmtInt(s.http.inflight)}</span>`, "", ""),
  ].join("");

  // 事件循环延迟柱图（最近 60 个采样）
  const samples = s.eventLoop.samples || [];
  if (!samples.length) $("#sysLagChart").innerHTML = '<div class="empty">暂无采样</div>';
  else {
    const max = Math.max(20, ...samples.map((x) => x.lag));
    const avg = Math.round(samples.reduce((a, x) => a + x.lag, 0) / samples.length);
    // 只画真实采样（不造假空柱），未满 60 秒时右侧留白并标注采集中，避免少量数据被拉伸成色块
    $("#sysLagChart").innerHTML = `<div class="sys-chart">${samples.map((x) => {
      const h = Math.max(4, Math.round(x.lag / max * 100));
      return `<span class="bar ${x.lag > 1500 ? "bad" : ""}" style="height:${h}%" title="${new Date(x.t).toLocaleTimeString()} · 阻塞 ${Math.round(x.lag)}ms"></span>`;
    }).join("")}</div><div class="sys-chart-x"><span>采集中 ${samples.length}/60</span><span>现在</span></div><div class="sys-chart-info">当前 ${Math.round(s.eventLoop.currentLagMs)}ms · 平均 ${avg}ms · 峰值 ${Math.round(max)}ms</div>`;
  }

  const db = s.db || {};
  $("#sysMeta").innerHTML = `
    <div class="m"><div class="k">事件循环</div><div class="v">${Math.round(s.eventLoop.currentLagMs)}ms <small>峰值 ${Math.round(s.eventLoop.maxLagMs)}ms</small></div></div>
    <div class="m"><div class="k">CPU 占用</div><div class="v">${Number(s.cpu.pct || 0).toFixed(1)}%<small>累计用户 ${fmtCpu(s.cpu.userMs)} · 内核 ${fmtCpu(s.cpu.systemMs)}</small></div></div>
    <div class="m"><div class="k">活跃句柄</div><div class="v">${fmtInt(Object.values(s.activeResources || {}).reduce((a, b) => a + b, 0))}<small>${["TCPServerWrap","TCPSocketWrap","PipeWrap","Timeout","Immediate"].map((k) => (s.activeResources && s.activeResources[k]) ? `${k.replace(/Wrap$/, "")}×${s.activeResources[k]}` : "").filter(Boolean).join(" · ") || "—"}</small></div></div>
    <div class="m"><div class="k">数据库连接池</div><div class="v">${db.active == null ? "—" : `${db.active}/${db.connectionLimit}`}<small>空闲 ${db.idle == null ? "—" : db.idle} · 排队 ${db.queued == null ? "—" : db.queued}</small></div></div>
    <div class="m"><div class="k">战斗引擎进程</div><div class="v">已拉起 ${enginesUp} / 池 ${engines.length}<small>${engines.length <= 8 ? engines.map((e) => `#${e.index} ${e.running ? "✓" : "待命"}`).join(" · ") : `共 ${engines.length} 个，${enginesUp} 个已拉起`}</small></div></div>
    <div class="m"><div class="k">存档缓存 / 用户锁</div><div class="v">${fmtInt(s.saveCache)}<small>锁 ${fmtInt(s.userLocks)} 个</small></div></div>
    <div class="m"><div class="k">主机内存</div><div class="v">${sysMemPct}%<small>${fmtBytes(s.system.freemem)} 可用 / ${fmtBytes(s.system.totalmem)}</small></div></div>
    <div class="m"><div class="k">后台响应</div><div class="v">${S.sys.rttMs} ms<small>本页接口往返</small></div></div>`;

  const hist = S.sys.hist || [];
  const histMax = Math.max(1, ...hist.map((x) => x.heap));
  const spark = hist.map((x) => `<span style="height:${Math.max(6, Math.round(x.heap / histMax * 100))}%" title="${new Date(x.t).toLocaleTimeString()} · 堆 ${fmtBytes(x.heap)}"></span>`).join("");
  $("#sysMem").innerHTML = `
    <div class="m"><div class="k">堆占用</div><div class="v">${heapPct}% <small>${fmtBytes(s.mem.heapUsed)} / ${fmtBytes(s.mem.heapLimit)}</small></div><div class="sys-bar"><i style="width:${Math.min(100, heapPct)}%"></i></div></div>
    <div class="m"><div class="k">RSS 常驻</div><div class="v">${fmtBytes(s.mem.rss)}<small>堆外 ${fmtBytes(s.mem.external)}</small></div></div>
    <div class="m"><div class="k">ArrayBuffer</div><div class="v">${fmtBytes(s.mem.arrayBuffers)}</div></div>
    <div class="m"><div class="k">主机负载</div><div class="v">${(s.system.loadavg || []).map((x) => Number(x).toFixed(2)).join(" / ") || "—"}<small>${s.system.cpus} 核</small></div></div>
    <div class="m" style="grid-column:1/-1"><div class="k">本页观察期内堆内存走势（${hist.length} 个采样）</div><div class="sys-spark">${spark || '<span class="sub">采样中…</span>'}</div></div>`;

  const slow = s.http.slow || [];
  $("#sysSlow").innerHTML = slow.length
    ? `<table style="min-width:100%"><thead><tr><th style="width:150px">时间</th><th>接口</th><th style="width:90px">耗时</th></tr></thead><tbody>${slow.slice().reverse().map((x) => `<tr><td class="num sub">${fmtDT(x.t)}</td><td class="lg-detail" style="max-width:340px">${esc(x.key)}</td><td class="num">${Math.round(x.ms)}ms</td></tr>`).join("")}</tbody></table>`
    : '<div class="empty">暂无慢请求（>3s）</div>';
}
function renderSysLogs() {
  const rows = S.sys.logs || [];
  $("#sysLogCount").textContent = `共 ${fmtInt(rows.length)} 条 · 来源 ${S.sys.source === "buffer" ? "运行日志（本次进程）" : S.sys.source === "serve" ? "target/serve.log" : "target/serve-crash.log"}${S.sys.level ? ` · 仅 ${S.sys.level.toUpperCase()}` : ""}`;
  const q = S.sys.q.toLowerCase();
  const list = q ? rows.filter((r) => String(r.msg || "").toLowerCase().includes(q)) : rows;
  if (!list.length) { $("#sysLogs").innerHTML = '<div class="empty">暂无日志</div>'; return; }
  $("#sysLogs").innerHTML = list.slice().reverse().map((r) => {
    const lv = String(r.level || "info").toLowerCase();
    const cls = lv === "error" ? "bad" : lv === "warn" ? "warn" : "dim";
    const time = r.t ? `${pad(new Date(r.t).getHours())}:${pad(new Date(r.t).getMinutes())}:${pad(new Date(r.t).getSeconds())}` : "—";
    return `<div class="lg-row ${esc(lv)}"><span class="lt">${time}</span><span class="lv"><span class="tag ${cls}">${esc(lv.toUpperCase())}</span></span><span class="lm">${esc(r.msg)}</span></div>`;
  }).join("");
}
function scheduleSysRefresh() {
  clearTimeout(S.sys.timer);
  S.sys.timer = null;
  if (S.view !== "sys") return;
  const auto = $("#sysAuto");
  if (auto && !auto.checked) return;
  S.sys.timer = setTimeout(async () => {
    if (S.view !== "sys") return;
    try {
      const s = await fetchSysStatus();
      renderSys(s);
      await loadSysLogs();
      stamp();
    } catch (e) {
      if (e.message === "auth") return;
      S.sys.failStreak++;
      const el = $("#sysHealth");
      if (el) { el.className = "tag bad"; el.textContent = `● 后台无响应（连续 ${S.sys.failStreak} 次）`; el.title = e.message; }
    }
    scheduleSysRefresh();
  }, 3000);
}
function stopSysRefresh() { clearTimeout(S.sys.timer); S.sys.timer = null; }

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  // 登录
  $("#loginGo").addEventListener("click", doLogin);
  $("#loginPass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("#loginUser").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#loginPass").focus(); });
  $("#btnLogout").addEventListener("click", doLogout);

  // 路由
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav && !nav.closest("#drawer")) { go(nav.dataset.nav); return; }
    const open = e.target.closest("[data-open-user]");
    if (open) { e.preventDefault(); openUser(open.dataset.openUser); return; }
    if (e.target.closest("[data-close]")) return closeModal();
    const lg = e.target.closest("[data-lg-detail]");
    if (lg) lg.classList.toggle("open");
  });
  window.addEventListener("hashchange", () => applyRoute(true));
  $("#btnRefresh").addEventListener("click", () => loadView(S.view));
  $("#drMask").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("#modalRoot").innerHTML) closeModal();
      else if (drawerOpen()) closeDrawer();
    }
    if (e.key === "/" && S.view === "users" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault(); $("#uQ").focus();
    }
  });

  // 账号
  const reloadUsers = () => { S.users.page = 1; loadUsers().catch((e) => { if (e.message !== "auth") toast(e.message, "err"); }); };
  $("#uQ").addEventListener("input", debounce(() => { S.users.q = $("#uQ").value.trim(); reloadUsers(); }, 300));
  $("#uState").addEventListener("change", () => { S.users.state = $("#uState").value; reloadUsers(); });
  $("#uRole").addEventListener("change", () => { S.users.role = $("#uRole").value; reloadUsers(); });
  $("#uReload").addEventListener("click", () => loadUsers());
  $("#uExport").addEventListener("click", exportUsersCSV);
  $("#uRows").addEventListener("click", (e) => {
    const row = e.target.closest("[data-open-user]");
    if (row) openUser(row.dataset.openUser);
  });
  $("#uFoot").addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (!b || b.disabled) return;
    S.users.page = Number(b.dataset.page); loadUsers();
  });
  $("#uFoot").addEventListener("change", (e) => {
    if (e.target.id !== "uPageSize") return;
    S.users.pageSize = Number(e.target.value); S.users.page = 1; loadUsers();
  });

  // 抽屉（容器常驻，内容重绘也不丢监听）
  $("#drawer").addEventListener("click", (e) => { handleDrawerClick(e).catch((err) => { if (err.message !== "auth") toast(err.message, "err"); }); });
  $("#drawer").addEventListener("input", (e) => {
    if (e.target.id !== "cardQ") return;
    S.drawer.cq = e.target.value.trim().toLowerCase();
    const d = S.drawer.detail;
    if (!d) return;
    const list = d.cards.filter((c) => (S.drawer.crar === "all" || c.rarity === S.drawer.crar)
      && (!S.drawer.cq || c.name.toLowerCase().includes(S.drawer.cq) || c.id.toLowerCase().includes(S.drawer.cq)));
    const box = $("#cardList");
    if (box) box.innerHTML = cardListHTML(list);
  });

  // 卡池
  $("#bRandom").addEventListener("click", () => run(async () => {
    if (!S.rosterReady) await loadRoster();
    openModal({
      title: "随机发限时 UP 池",
      sub: "随机选一名 UR / 晶钻角色作为 UP，立即上架",
      body: `
        <div class="sub" style="font-size:12.5px;line-height:1.9;margin-bottom:12px">
          系统会从名册中<b>随机抽取一名 UR / 晶钻角色</b>作为 UP，自动创建限定卡池并即时生效；优先避开当前已在其它卡池 UP 的角色。
        </div>
        <div class="form-row">
          <div><label>上架周期（天）</label><input id="brDays" type="number" min="0" max="3650" value="20" style="width:120px"></div>
          <div class="sub" style="padding-bottom:6px">默认 20 天，到期自动下架；填 0 = 永久。</div>
        </div>`,
      foot: `<button class="btn ghost" data-close>取消</button><button class="btn gold" id="brGo">🎲 随机发池</button>`,
      onMount(root) {
        root.querySelector("#brGo").addEventListener("click", (ev) => run(async () => {
          await busy(ev.currentTarget, async () => {
            const rawDays = String(root.querySelector("#brDays").value || "").trim();
            const nDays = Number(rawDays);
            const days = rawDays === "" || !Number.isFinite(nDays) ? 20 : Math.max(0, Math.min(3650, Math.trunc(nDays)));
            const j = await api({ op: "bannerRandom", days });
            closeModal();
            loadBanners();
            openModal({
              title: "已发池 · " + esc(j.label),
              sub: "玩家端缘阁即时生效",
              body: `<div style="display:flex;align-items:center;gap:14px;padding:4px 0 10px">
                ${avatarHTML(j.character.id)}
                <div><div style="font-size:16px;font-weight:600">${esc(j.character.name)} ${rarTag(j.character.rarity)}</div>
                <div class="sub" style="margin-top:5px">卡池 <b>${esc(j.key)}</b> · ${j.days ? `上架 ${j.days} 天 · ${fmtDT(j.endsAt)} 自动下架` : "永久上架"}</div></div>
              </div>`,
            });
          });
        }));
      },
    });
  }));
  $("#bList").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-bedit]");
    if (ed) {
      const row = S.banners.custom.find((r) => r.key === ed.dataset.bedit);
      return row ? openBannerForm(row) : toast("卡池已变化，刷新后重试", "err");
    }
    const tg = e.target.closest("[data-btoggle]");
    if (tg) return run(async () => {
      await busy(tg, () => api({ op: "bannerToggle", key: tg.dataset.btoggle, enabled: tg.dataset.on === "1" }));
      toast(tg.dataset.on === "1" ? "卡池已启用" : "卡池已停用", "ok");
      loadBanners();
    });
    const del = e.target.closest("[data-bdel]");
    if (del) return run(async () => {
      const ok = await confirmModal({ title: "删除卡池", danger: true, okText: "删除",
        text: `删除卡池 <b>${esc(del.dataset.bdel)}</b>？玩家端会立即下架，记录不可恢复。` });
      if (!ok) return;
      await api({ op: "bannerDelete", key: del.dataset.bdel });
      toast("已删除", "ok"); loadBanners();
    });
  });

  // 日志
  $("#lgOp").addEventListener("change", () => { S.logs.opFilter = $("#lgOp").value; S.logs.page = 1; loadLogs(); });
  $("#lgQ").addEventListener("input", debounce(() => { S.logs.q = $("#lgQ").value.trim(); S.logs.page = 1; loadLogs(); }, 300));
  $("#lgReload").addEventListener("click", () => loadLogs());
  $("#lgFoot").addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (!b || b.disabled) return;
    S.logs.page = Number(b.dataset.page); loadLogs();
  });

  // 系统日志
  $("#sysRefresh").addEventListener("click", () => loadSys().catch((e) => { if (e.message !== "auth") toast(e.message, "err"); }));
  $("#sysAuto").addEventListener("change", () => { if ($("#sysAuto").checked) scheduleSysRefresh(); else stopSysRefresh(); });
  $("#sysLogSource").addEventListener("change", () => { S.sys.source = $("#sysLogSource").value; loadSysLogs().catch((e) => { if (e.message !== "auth") toast(e.message, "err"); }); });
  $("#sysLogLevel").addEventListener("change", () => { S.sys.level = $("#sysLogLevel").value; loadSysLogs().catch((e) => { if (e.message !== "auth") toast(e.message, "err"); }); });
  $("#sysLogQ").addEventListener("input", debounce(() => { S.sys.q = $("#sysLogQ").value.trim(); renderSysLogs(); }, 200));
  $("#sysLogReload").addEventListener("click", () => loadSysLogs().catch((e) => { if (e.message !== "auth") toast(e.message, "err"); }));
  $("#sysLogClear").addEventListener("click", () => run(async () => { await api({ op: "sysLogsClear" }); S.sys.logs = []; renderSysLogs(); toast("日志缓冲已清空", "ok"); }));

  // 背景音乐
  $("#bgmUpload").addEventListener("click", () => $("#bgmFile").click());
  $("#bgmFile").addEventListener("change", () => { if ($("#bgmFile").files[0]) doBgmUpload().catch((e) => toast(e.message, "err")); });
  $("#bgmSave").addEventListener("click", () => doBgmSave().catch((e) => toast(e.message, "err")));
  $("#bgmRows").addEventListener("click", (e) => {
    const play = e.target.closest("[data-bgm-play]");
    if (play) {
      if (S.bgm.aud) { S.bgm.aud.pause(); S.bgm.aud = null; play.textContent = "▶ 试听"; return; }
      const a = new Audio(play.dataset.bgmPlay);
      S.bgm.aud = a;
      play.textContent = "■ 停止";
      a.onended = a.onerror = () => { S.bgm.aud = null; play.textContent = "▶ 试听"; };
      a.play().catch(() => { S.bgm.aud = null; play.textContent = "▶ 试听"; });
      return;
    }
    const del = e.target.closest("[data-bgm-del]");
    if (del && !del.disabled) {
      confirmModal({ title: "删除音频", danger: true, okText: "删除",
        text: `确定删除 <b>${esc(del.dataset.bgmDel)}</b>？轮换配置里会同步移除。` }).then(async (ok) => {
        if (!ok) return;
        try {
          const j = await api({ op: "bgmDelete", name: del.dataset.bgmDel });
          if (!j.ok) { toast(j.error || "删除失败", "err"); return; }
          toast("已删除");
          S.bgm.files = j.bgm.files; S.bgm.rotate = j.bgm.rotate;
          renderBgm(); stamp();
        } catch (e2) { toast(e2.message, "err"); }
      });
    }
  });
  $("#bgmSlots").addEventListener("change", () => {
    // 勾选即时反映到「当前生效」预览
    const rot = readRotate();
    $("#bgmEffective").innerHTML = S.bgm.slots.map((slot) => {
      const list = (rot[slot] && rot[slot].length) ? rot[slot] : ["（默认内置曲）"];
      return `<div><b>${BGM_SLOT_NAMES[slot] || slot}：</b>${list.map(esc).join(" → ")}</div>`;
    }).join("");
  });
}

/* ---------------- 启动 ---------------- */
(async function init() {
  bindEvents();
  if (!TOKEN) { showLogin(); return; }
  try {
    const me = await api({ op: "me" });
    S.me = me.me.username;
    sessionStorage.setItem(NAME_KEY, S.me);
    await bootData();
    enterApp();
    stamp();
  } catch (e) {
    if (e.message !== "auth") {
      // 后端不可达时给出可操作的提示，而不是白屏
      showLogin(`后台接口不可用：${e.message}`);
    }
  }
})();
