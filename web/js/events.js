/* 拾缘 · events —— 活动屏（妖潮·雪魅 / 仙令 / 日常 / 周常）/ 章末回望 / 跨屏增强挂点（DESIGN-EXPANSION）
 * 本文件在 settle.js 之后加载：顶层完成「活动」页签自注册，
 * 并给出征情报条 / 行囊炼化 / 成就分档提供共用渲染件与事件委托。
 * 铁律：只演数据不算数 —— 数值一律来自 /api/action 的返回，与 tools/lib 同口径。 */
"use strict";

/* ---------------- 服务端同口径的展示映射 ---------------- */

const XPE_MAT = { page: "散页", note: "注疏", scroll: "藏卷", pill: "洗髓丹", soul: "器魂", shard: "通用残卷", essence: "尘缘", coin: "铜钱", jade: "缘玉" };
const XPE_TOME = { purple: "紫阶技能书", gold: "金阶技能书", red: "红阶技能书" };
function xpeMatName(k) {
  const s = String(k || "");
  if (s.startsWith("tome:")) return XPE_TOME[s.split(":")[1]] || s;
  return XPE_MAT[s] || matLabel(s) || s;
}
/** 钱包里某种材料的现有量（tome 分桶 / shard 按最富档扣，展示给总数即可） */
function xpeHave(k) {
  const w = S.wallet || {};
  const s = String(k || "");
  if (s.startsWith("tome:")) return (w.tome || {})[s.split(":")[1]] || 0;
  if (s === "shard") return Object.values(w.shard || {}).reduce((a, b) => a + (b || 0), 0);
  return (w.mat || {})[s] || 0;
}
function xpeRewardText(rw = {}) {
  const parts = [];
  if (rw.coin) parts.push(`铜钱 ×${fmt(rw.coin)}`);
  if (rw.jade) parts.push(`缘玉 ×${fmt(rw.jade)}`);
  for (const [k, n] of Object.entries(rw.mat || {})) parts.push(`${xpeMatName(k)} ×${fmt(n)}`);
  return parts.join(" · ") || "—";
}

/* refreshWallet 由 core 侧扩展提供；文件加载序不同也不至于裸奔 */
if (typeof window.refreshWallet !== "function") {
  window.refreshWallet = function () { try { renderResBar(); } catch (e) { /* 忽略 */ } };
}

/* ---------------- 天时词条 chips（活动关列表 & 出征情报条共用） ---------------- */

function xpeModsHtml(mods) {
  if (!mods || !mods.length) return "";
  return mods.map(m => {
    const tone = ["bad", "mixed", "risk"].includes(m.tone) ? m.tone : "none";
    return `<span class="xpe-mchip t-${tone}" data-tip="${esc(m.name)}|${esc(m.desc)}">${I(m.icon || "sparkle", "width:12px;height:12px;vertical-align:-2px")}${esc(m.name)}</span>`;
  }).join("");
}

/* ---------------- 屏：活动（限时活动 / 常驻活动 / 仙令） ---------------- */

let xpeTab = "";            // "pass" = 仙令；"ev:<id>" = 某个活动；空串 = 首次进入自动选第一个限时活动
let xpeSec = "main";        // 活动内子页签：main/trial/challenge=关卡分段，shop=商店，ms=积分里程碑
let xpePassPage = 0;        // 仙令奖励轨分页（每页 10 级）
// 验收辅助：?dev_goto_event_tab 指定的活动页签（截图用，正常游玩不写这个键）
try {
  const devTab = localStorage.getItem("dev_goto_event_tab");
  if (devTab) {
    xpeTab = ["daily", "weekly", "pass"].includes(devTab) ? devTab : "ev:" + devTab;
    localStorage.removeItem("dev_goto_event_tab");
  }
  const devSec = localStorage.getItem("dev_goto_event_sec");
  if (devSec) {
    xpeSec = devSec;
    localStorage.removeItem("dev_goto_event_sec");
  }
} catch (e) { console.warn("dev_goto_event_tab", e); }
let xpeEvents = null;       // eventInfo 结果（带 stars / score / bought）
let xpePass = null;         // passInfo 结果
let xpeTasks = null;        // taskInfo 结果（daily / weekly）
let xpeCurEvent = "";       // 当前活动 id（兑换时用）

const xpeIsLtd = ev => (ev?.kind || "limited") === "limited";
/** 剩余时间短文案（endsAt 缺省则空串） */
function xpeLeftTxt(endsAt) {
  if (!endsAt) return "";
  const h = Math.floor((endsAt - Date.now()) / 3600000);
  if (h <= 0) return "即将结束";
  return h >= 48 ? `剩 ${Math.floor(h / 24)} 天` : `剩 ${h} 小时`;
}
/** 限时/常驻 徽章：活动卡与页签共用 */
function xpeKindChip(ev) {
  return xpeIsLtd(ev)
    ? `<span class="xpe-kindchip ltd" data-tip="限时活动|限时开放：活动结束后关卡与商店关闭，抓紧时间。">${I("clock", "width:11px;height:11px")}限时${ev?.endsAt ? ` · ${xpeLeftTxt(ev.endsAt)}` : ""}</span>`
    : `<span class="xpe-kindchip pmt" data-tip="常驻活动|长期开放，随时可以参与。">${I("flag", "width:11px;height:11px")}常驻</span>`;
}

function renderEvents() {
  return renderEventsAsync();
}

async function renderEventsAsync() {
  const host = $("#scr-event");
  if (!host) return;
  if (!DATA.events || !DATA.events.length) {
    host.innerHTML = `<div class="panel panel-pad"><div class="panel-title">活 动</div>
      <div class="panel-sub" style="margin-top:10px">近来四野无事，妖物蛰伏。—— 敬请期待。</div></div>`;
    return;
  }
  // 先拿 eventInfo（stars/score/bought 只在这里有），仙令页签再补 passInfo
  const infoJ = await call({ type: "eventInfo" }).catch(() => null);
  if (infoJ && infoJ.events) xpeEvents = infoJ.events;
  const isPass = xpeTab === "pass";
  const isTasks = xpeTab === "daily" || xpeTab === "weekly";
  if (isPass) {
    const passJ = await call({ type: "passInfo" }).catch(() => null);
    if (passJ && passJ.passInfo) xpePass = passJ.passInfo;
  }
  if (isTasks) {
    const taskJ = await call({ type: "taskInfo" }).catch(() => null);
    if (taskJ && taskJ.tasks) xpeTasks = taskJ.tasks;
  }
  // 页签归位：指向了已下线的活动 / 首次进入 → 第一个限时活动，没有限时才落仙令
  const evList = DATA.events;
  if (!isPass && !isTasks && !evList.find(e => "ev:" + e.id === xpeTab)) {
    const firstLtd = evList.find(xpeIsLtd);
    xpeTab = firstLtd ? "ev:" + firstLtd.id : "pass";
  }
  const e = (xpeTab === "pass" || isTasks) ? null : (evList.find(x => "ev:" + x.id === xpeTab) || evList[0]);
  if (e) xpeCurEvent = e.id;
  const evLive = (xpeEvents || []).find(x => x.id === e?.id) || e || {};
  const stages = xpeTab === "pass" ? [] : (evLive.stages || []);
  const shop = xpeTab === "pass" ? [] : (evLive.shop || []);
  const stageRows = stages.map((s, i) => {
    const short = s.name.includes(" ") ? s.name.split(" ").slice(1).join(" ") : s.name;
    return `<div class="xpe-stage ${(s.stars || 0) > 0 ? "done" : ""}" data-battle="${esc(s.id)}" role="button" tabindex="0">
      <div class="xs-no num">${String(i + 1).padStart(2, "0")}</div>
      <div class="xs-main">
        <div class="xs-name">${esc(short)}${s.boss ? `<span class="xs-boss">关 主</span>` : ""}</div>
        <div class="xs-meta num">体力 ${s.stamina} · 敌方 Lv.${s.elv}${(s.stars || 0) > 0 ? ` · 已通 ★${s.stars}` : ""}</div>
        ${s.mods && s.mods.length ? `<div class="xs-mods">${xpeModsHtml(s.mods)}</div>` : ""}
      </div>
      <div class="xs-stars">${starIcons(s.stars || 0, 3)}</div>
      <span class="xs-go">${I("fight", "width:15px;height:15px")}</span>
    </div>`;
  }).join("");
  const shopOneTime = evLive.shopMode === "once";
   const shopRows = shop.map(l => {
     const stock = l.stock ?? 0;
     const sold = (l.bought || 0) >= stock;
     const gives = [];
     for (const [k, n] of Object.entries(l.mat || {})) gives.push(`${xpeMatName(k)} ×${n}`);
     if (l.jade) gives.push(`缘玉 ×${l.jade}`);
     if (l.coin) gives.push(`铜钱 ×${l.coin}`);
     const cost = l.cost?.score ?? l.cost?.dust ?? l.cost?.essence ?? 0;
     return `<div class="xpe-good ${sold ? "out" : ""}">
       <div class="xg-ic">${I("gift", "width:17px;height:17px")}</div>
       <div class="xg-main">
         <div class="xg-t">${esc(l.label)}</div>
         <div class="xg-d">${esc(gives.join(" · ") || "—")}</div>
       </div>
       <div class="xg-buy">
         <span class="xg-price">${I("event", "width:12px;height:12px")} ${fmt(cost)}</span>
         <span class="xg-stock num">${shopOneTime ? (sold ? "已售罄" : `限购 ${stock} · 剩 ${Math.max(0, stock - (l.bought || 0))}`) : `今日 ${l.bought || 0}/${stock}`}</span>
         ${sold ? `<button class="btn sm" disabled>已 售 罄</button>`
                : `<button class="btn sm primary" data-xpebuy="${esc(l.key)}">兑 换</button>`}
       </div>
     </div>`;
   }).join("");
 
   // 活动积分里程碑（截图红框同款：每档显示所需积分、奖励、领取按钮）
   const milestones = (evLive.milestones || []).map(m => {
     const claimed = !!m.claimed;
     const reached = !!m.reached;
     return `<div class="xpe-ms ${claimed ? "done" : reached ? "ready" : "locked"}">
       <div class="xms-score num">${fmt(m.score)}<span>分</span></div>
       <div class="xms-main"><div class="xms-t">${esc(m.label)}</div>
         <div class="xms-d">${esc(xpeRewardText(m.reward))}</div></div>
       <div class="xms-act">${claimed ? `<span class="xms-done">${I("check", "width:13px;height:13px")} 已领取</span>`
        : reached ? `<button class="btn sm primary" data-xpems="${m.score}">领 取</button>`
        : `<span class="xms-lk num">还差 ${fmt(Math.max(0, m.score - (evLive.scoreEarned ?? evLive.score ?? 0)))} 分</span>`}</div>
     </div>`;
   }).join("");

  const ltdList = evList.filter(xpeIsLtd), pmtList = evList.filter(ev => !xpeIsLtd(ev));
  const evTabBtn = ev => `<button class="xpe-subtab ${xpeTab === "ev:" + ev.id ? "on" : ""}" data-xpetab="ev:${esc(ev.id)}">
    ${esc(ev.name)}${xpeIsLtd(ev) ? `<span class="xpe-subtip">${I("clock", "width:10px;height:10px")}${ev.endsAt ? esc(xpeLeftTxt(ev.endsAt)) : "限时"}</span>` : `<span class="xpe-subtip pmt">常驻</span>`}</button>`;
  const tasks = DATA.tasks || null;
  const tabs = `
  <div class="xpe-subtabs">
    ${ltdList.length ? `<span class="xpe-subtab-hd ltd">${I("clock", "width:11px;height:11px")}限时活动</span>${ltdList.map(evTabBtn).join("")}` : ""}
    <span class="xpe-subtab-hd pmt">${I("flag", "width:11px;height:11px")}常驻活动</span>${pmtList.map(evTabBtn).join("")}
    ${tasks ? `<button class="xpe-subtab ${xpeTab === "daily" ? "on" : ""}" data-xpetab="daily">日 常<span class="xpe-subtip pmt">每日刷新</span></button>
    <button class="xpe-subtab ${xpeTab === "weekly" ? "on" : ""}" data-xpetab="weekly">周 常<span class="xpe-subtip pmt">每周刷新</span></button>` : ""}
    <button class="xpe-subtab ${xpeTab === "pass" ? "on" : ""}" data-xpetab="pass">仙 令<span class="xpe-subtip pmt">常驻</span></button>
  </div>`;

  const accent = e?.accent || "#e8c98a";
  const bannerBg = e?.banner || "/bg/event-yaochao.jpg";
  // 仙令页签也给一张默认侧栏卡片：主题图 + 简短说明，避免左栏空、主面板被拉宽
  const passLeft = `
  <aside class="panel panel-pad xpe-side" style="--ev-ac:#9cc4e4">
    <div class="xpe-banner" style="background-image:url('/bg/event-yaochao.jpg')">
      <div class="xpe-banner-body">
        <div class="xpe-banner-sub">拾缘同行 · 每季一轮</div>
        <div class="xpe-banner-name">仙 令 <span class="xpe-kindchip pmt">${I("flag", "width:11px;height:11px")}常驻</span></div>
        <div class="xpe-banner-desc">出战与扫荡都会累积仙令经验。等级每到一档，同游轨免费领，顺缘轨解锁后一并领取；季末重置，新的一季再同行。</div>
      </div>
    </div>
    <div class="xpe-bossline">${I("pass", "width:12px;height:12px")} 同游免费 · 顺缘 ${fmt(DATA.passUnlockCost || 260)} 尘缘解锁</div>
    <div class="xpe-side-note">${I("sparkle", "width:12px;height:12px;vertical-align:-2px")} 仙令长期开放：每日出战即可稳步升级，奖励含铜钱、缘玉与器魂。</div>
  </aside>`;
  const left = xpeTab === "pass" ? passLeft : isTasks ? xpeTasksLeft(xpeTab) : (() => {
    const cleared = stages.filter(s => (s.stars || 0) > 0).length;
    const pct = stages.length ? Math.round((cleared / stages.length) * 100) : 0;
    const msList = evLive.milestones || [];
    const nextMs = msList.find(m => !m.reached);
    const scoreNow = evLive.scoreEarned ?? evLive.score ?? 0;
    return `
  <aside class="panel panel-pad xpe-side" style="--ev-ac:${esc(accent)}">
    <div class="xpe-banner" style="background-image:url('${esc(bannerBg)}')">
      ${e?.bossArt ? `<img class="xpe-banner-boss" src="${esc(e.bossArt)}" alt="" loading="lazy">` : ""}
      <div class="xpe-banner-body">
        ${e?.themeSub ? `<div class="xpe-banner-sub">${esc(e.themeSub)}</div>` : ""}
        <div class="xpe-banner-name">${esc(e.name)} ${xpeKindChip(evLive)}</div>
      </div>
    </div>
    <div class="xpe-side-desc">${esc(e.desc || "")}</div>
    ${e?.bossArt ? `<div class="xpe-bossline">${I("fight", "width:12px;height:12px")} 关主压阵 · ${esc((DATA.bestiary?.list || []).find?.(b => b.id === e.bossId)?.name || "")}</div>` : ""}
    <div class="xpe-scorebox">
      <div class="xpe-score">${I("event", "width:14px;height:14px")} ${evLive.kind === "limited" ? "累计积分" : "活动积分"} <b class="num">${fmt(scoreNow)}</b></div>
      <div class="xpe-score">${I("essence", "width:14px;height:14px")} 尘缘 <b class="num">${fmt(S.wallet.essence)}</b></div>
    </div>
    <div class="xpe-sideprog">
      <div class="sp-hd">${I("flag", "width:12px;height:12px")} 本期进度</div>
      <div class="sp-row"><span>已通关卡</span><b class="num">${cleared}<i>/${stages.length}</i></b></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="sp-row"><span>${evLive.kind === "limited" ? "累计星级" : "下一档里程碑"}</span><b class="num">${evLive.kind === "limited" ? `${stages.reduce((a, s) => a + (s.stars || 0), 0)}<i>/${stages.length * 3}</i>` : (nextMs ? fmt(nextMs.score) : "已满")}</b></div>
      <div class="sp-row"><span>下一档里程碑</span><b class="num">${nextMs ? fmt(nextMs.score) : "已满"}</b></div>
      <div class="sp-tip">${nextMs ? `还差 ${fmt(Math.max(0, nextMs.score - scoreNow))} 分可领「${esc(nextMs.label)}」` : "全部里程碑已达成，记得领取奖励。"}</div>
    </div>
    <div class="xpe-side-note">${I("sparkle", "width:12px;height:12px;vertical-align:-2px")} ${xpeIsLtd(e) ? "通关活动关卡拿星级奖励；全部三星后，积分刚好兑空商店。" : "常驻活动：关卡积分与商店随时可用。"}</div>
  </aside>`;
  })();

  let main = "";
  if (xpeTab === "pass") {
    main = xpePassHtml();
  } else if (isTasks) {
    main = xpeTasksHtml(xpeTab);
  } else {
    // 主关卡 / 试炼 / 挑战 / 商店 / 里程碑 用子页签切换：
    // 一个活动内容再多也不纵向堆叠，保证整页落在一屏内不出滚动条。
    const secOf = s => s.section || "main";
    const secMeta = {
      main: { label: "关 卡", note: `主线 ${stages.filter(s => secOf(s) === "main").length} 关 · ${evLive.kind === "limited" ? "星级奖励" : "首通给缘玉"}` },
      trial: { label: "试 炼", note: "三段连战 · 带天时词条 · 积分更高" },
      challenge: { label: "挑 战", note: "三波强敌 · 通关高分" },
    };
    const secCount = sec => stages.filter(s => secOf(s) === sec).length;
    if (!["main", "trial", "challenge", "shop", "ms"].includes(xpeSec)) xpeSec = "main";
    if (!secCount(xpeSec) && ["main", "trial", "challenge"].includes(xpeSec)) xpeSec = ["main", "trial", "challenge"].find(secCount) || "main";
    const secBtn = (id, label, n) => `<button class="xpe-subnav-btn ${xpeSec === id ? "on" : ""}" data-xpesec="${id}">${label}<span class="num">${n}</span></button>`;
    const secNav = `<div class="xpe-subnav">
      ${secBtn("main", "关 卡", secCount("main"))}${secBtn("trial", "试 炼", secCount("trial"))}${secBtn("challenge", "挑 战", secCount("challenge"))}
      ${secBtn("shop", "商 店", shop.length)}${secBtn("ms", "里 程 碑", (evLive.milestones || []).length)}
    </div>`;
    let secBody = "";
    const totalJade = stages.reduce((a, s) => a + (evLive.kind === "limited" ? [1, 2, 3].reduce((x, n) => x + ((s.starRewards?.[String(n)]?.jade) || 0), 0) : (s.jade || s.firstClear?.jade || 0)), 0);
    const maxElv = stages.reduce((a, s) => Math.max(a, s.elv || 0), 0);
    const leftTxt = xpeLeftTxt(e?.endsAt) || (xpeIsLtd(e) ? "限时开放" : "常驻开放");
    const extraStats = (cells) => `<div class="xpe-extrainfo">
      <div class="xe-grid">${cells.map(c => `<div class="xe-card"><span class="xe-k">${esc(c.k)}</span><b class="num">${esc(c.v)}</b><span class="xe-s">${esc(c.s || "")}</span></div>`).join("")}</div>
    </div>`;
    if (xpeSec === "shop") {
      const totalStock = shop.reduce((a, l) => a + (l.stock || 0), 0);
      const bought = shop.reduce((a, l) => a + (l.bought || 0), 0);
      secBody = `<div class="xpe-eventmain">
        <div class="xpe-scorebar">${I("event", "width:13px;height:13px")} 活动积分 <b class="num">${fmt(evLive.score || 0)}</b><span class="xpe-scorebar-tip">${evLive.kind === "limited" ? `累计获得 ${fmt(evLive.scoreEarned ?? 0)} · 星级奖励发放` : "打本活动关卡获得"}</span></div>
        <div class="xpe-goodgrid">${shopRows || `<div class="panel-sub">本期商店筹备中。</div>`}</div>
        ${extraStats([
          { k: "在售货架", v: `${shop.length} 件`, s: shopOneTime ? "活动期间限购" : "每日 04:00 补货" },
           { k: "已兑", v: `${bought} / ${totalStock}`, s: "库存兑完为止" },
          { k: "积分余额", v: fmt(evLive.score || 0), s: "仅限本活动" },
        ])}
      </div>
      <aside class="xpe-eventnote">
        <div class="xn-t">${I("gift", "width:13px;height:13px")} 兑换说明</div>
        <div class="xn-row"><span class="xn-k">计价</span><span>所有货架只消耗本活动积分，不消耗尘缘；积分由活动关卡结算发放。</span></div>
        <div class="xn-row"><span class="xn-k">库存</span><span>${shopOneTime ? "限时活动每件货架按标注次数限购，售罄不补；全部关卡三星所得积分刚好可兑空全部货架。" : "每件商品标注「今日已兑/库存」，每日 04:00 补货，兑完为止。"}</span></div>
        <div class="xn-row"><span class="xn-k">建议</span><span>优先兑换技能书与洗髓丹；缘玉类货架单价高，积分充裕时再换。</span></div>
        <div class="xn-sep"></div>
        <div class="xn-t">${I("sparkle", "width:13px;height:13px")} 本期兑换优先级</div>
        <div class="xn-row"><span class="xn-k">其一</span><span>红阶技能书 — 稀缺，优先换满。</span></div>
        <div class="xn-row"><span class="xn-k">其二</span><span>洗髓丹 — 突破材料，日常刚需。</span></div>
        <div class="xn-row"><span class="xn-k">其三</span><span>器魂 / 注疏 — 有余力再补。</span></div>
        <div class="xn-sep"></div>
        <div class="xn-t">${I("event", "width:13px;height:13px")} 积分获取</div>
        <div class="xn-row"><span class="xn-k">获取</span><span>${evLive.kind === "limited" ? "活动积分只来自关卡星级奖励（★1/★2/★3 逐档一次性发放），重复通关不再产出。" : "主线每关首通 +1000，重复通关按波次给分；试炼 +1500，挑战 +3000。"}</span></div>
      </aside>`;
    } else if (xpeSec === "ms") {
      const nextMs = (evLive.milestones || []).find(m => !m.reached);
      const maxMs = (evLive.milestones || []).slice(-1)[0];
      const scoreNow = evLive.scoreEarned ?? evLive.score ?? 0;
      const pct = nextMs ? Math.min(100, Math.round((scoreNow / nextMs.score) * 100)) : 100;
      secBody = `<div class="xpe-eventmain">
        <div class="xpe-scorebar">${I("event", "width:13px;height:13px")} 活动积分 <b class="num">${fmt(scoreNow)}</b><span class="xpe-scorebar-tip">按积分逐档解锁</span></div>
        <div class="xpe-mslist xpe-msgrid">${milestones || `<div class="panel-sub">本期暂无里程碑。</div>`}</div>
      </div>
      <aside class="xpe-eventnote">
        <div class="xn-t">${I("sparkle", "width:13px;height:13px")} 积分进度</div>
        <div class="xn-big"><b class="num">${fmt(scoreNow)}</b><span>/ ${fmt(nextMs ? nextMs.score : (maxMs ? maxMs.score : 0))}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="xn-row"><span class="xn-k">下一档</span><span>${nextMs ? `${esc(nextMs.label)} · 还差 ${fmt(Math.max(0, nextMs.score - scoreNow))} 分` : "全部档位已解锁"}</span></div>
        <div class="xn-sep"></div>
        <div class="xn-t">${I("event", "width:13px;height:13px")} 积分获取</div>
        <div class="xn-row"><span class="xn-k">获取</span><span>${evLive.kind === "limited" ? "活动积分只来自关卡星级奖励（★1/★2/★3 逐档一次性发放），重复通关不再产出。" : "主线每关首通 +1000，试炼 +1500，挑战 +3000，另按波次追加。"}</span></div>
        <div class="xn-sep"></div>
        <div class="xn-t">${I("gift", "width:13px;height:13px")} 档位奖励</div>
        <div class="xn-row"><span class="xn-k">说明</span><span>达到积分自动解锁，需手动点击「领取」入账。</span></div>
        <div class="xn-row"><span class="xn-k">提醒</span><span>活动结束后未领取的档位奖励不补发，请及时领取。</span></div>
      </aside>`;
    } else {
      const list = stages.filter(s => secOf(s) === xpeSec);
      const rows = list.map((s) => {
        const i = stages.indexOf(s);
        const short = s.name.includes(" ") ? s.name.split(" ").slice(1).join(" ") : s.name;
        const locked = s.requires && !(stages.find(x => x.id === s.requires)?.stars > 0);
        const reqName = s.requiresName || stages.find(x => x.id === s.requires)?.name || "前置关卡";
        return `<div class="xpe-stage ${(s.stars || 0) > 0 ? "done" : ""} ${locked ? "locked" : ""}" data-battle="${esc(s.id)}" role="button" tabindex="0" ${locked ? `data-tip="未解锁|先通关「${esc(reqName)}」"` : ""}>
          <div class="xs-no num">${String(i + 1).padStart(2, "0")}</div>
          <div class="xs-main">
            <div class="xs-name">${esc(short)}${s.boss ? `<span class="xs-boss">关 主</span>` : ""}${locked ? `<span class="xs-boss">未 解 锁</span>` : ""}</div>
            <div class="xs-meta num">体力 ${s.stamina} · 敌方 Lv.${s.elv}${(s.stars || 0) > 0 ? ` · 已通 ★${s.stars}` : ""}</div>
            ${s.starRewards
               ? `<div class="xs-first xs-starw">${[1, 2, 3].map(n => `<span class="xsw" data-tip="★${n} 星级奖励|${esc(xpeRewardText(s.starRewards[String(n)] || {}))}">★${n} ${esc(xpeRewardText(s.starRewards[String(n)] || {}))}</span>`).join("")}</div>`
               : (s.firstClear ? `<div class="xs-first">首通 · ${xpeRewardText(s.firstClear)}</div>` : "")}
            ${s.mods && s.mods.length ? `<div class="xs-mods">${xpeModsHtml(s.mods)}</div>` : ""}
          </div>
          <div class="xs-stars">${starIcons(s.stars || 0, 3)}</div>
          <span class="xs-go">${I("fight", "width:15px;height:15px")}</span>
        </div>`;
      }).join("");
      const done = list.filter(s => (s.stars || 0) > 0).length;
      const noteMap = {
        main: { t: "关卡说明", rows: evLive.kind === "limited"
           ? [["星级", "每关按 ★1 / ★2 / ★3 逐档发奖，各档只发一次；重复通关不再产出。"], ["全星", "全部关卡三星后，累计星级积分刚好可兑空活动商店。"], ["进度", `本段已通 ${done}/${list.length}，全部通关后解锁后续试炼。`]]
           : [["首通", "每关首通给缘玉与铜钱，并累积活动积分。"], ["三星", "按回合数、无阵亡、血量线判定，三星可扫荡。"], ["进度", `本段已通 ${done}/${list.length}，全部通关后解锁后续试炼。`]] },
        trial: { t: "试炼说明", rows: [["连战", "三段连战，中途阵亡即失败，建议带治疗与减伤。"], ["词条", "每关带天时词条，进场前可在关卡情报里查看。"], ["积分", "试炼积分高于主线，是刷活动积分的主力。"]] },
        challenge: { t: "挑战说明", rows: [["强敌", "三波强敌压阵，关主在最后一波登场。"], ["奖励", "通关拿最高档活动积分与限定首通礼。"], ["建议", "战力不足时先刷试炼提升活动积分与装备。"]] },
      };
      const nm = noteMap[xpeSec] || noteMap.main;
      secBody = `<div class="xpe-eventmain">
        <div class="xpe-sec">
          <div class="xpe-sec-hd">${esc(secMeta[xpeSec].label)} <span class="n num">${done}/${list.length} 已通</span><span class="xpe-sec-note">${esc(secMeta[xpeSec].note)}</span></div>
          <div class="xpe-stagelist">${rows || `<div class="panel-sub">本段暂未开放。</div>`}</div>
        </div>
        ${extraStats([
          { k: "本段关卡", v: `${list.length} 关`, s: xpeSec === "main" ? "主线推进" : xpeSec === "trial" ? "三段连战" : "三波强敌" },
          { k: evLive.kind === "limited" ? "星级奖励" : "首通缘玉", v: fmt(list.reduce((a, s) => a + (evLive.kind === "limited" ? [1, 2, 3].reduce((x, n) => x + ((s.starRewards?.[String(n)]?.jade) || 0), 0) : (s.jade || s.firstClear?.jade || 0)), 0)), s: evLive.kind === "limited" ? "逐档一次性发放" : "每关首通一次性" },
          { k: "最高敌等", v: `Lv.${list.reduce((a, s) => Math.max(a, s.elv || 0), 0)}`, s: `本期活动共 ${stages.length} 关` },
        ])}
      </div>
      <aside class="xpe-eventnote">
        <div class="xn-t">${I("sparkle", "width:13px;height:13px")} ${nm.t}</div>
        ${nm.rows.map(([k, v]) => `<div class="xn-row"><span class="xn-k">${k}</span><span>${esc(v)}</span></div>`).join("")}
        <div class="xn-sep"></div>
        <div class="xn-t">${I("clock", "width:13px;height:13px")} 本期活动</div>
        <div class="xn-row"><span class="xn-k">开放</span><span>${esc(leftTxt)}</span></div>
        <div class="xn-row"><span class="xn-k">总关</span><span>${stages.length} 关（含试炼 ${stages.filter(s => secOf(s) === "trial").length} · 挑战 ${stages.filter(s => secOf(s) === "challenge").length}）</span></div>
        <div class="xn-row"><span class="xn-k">${evLive.kind === "limited" ? "星级" : "首通"}</span><span>${evLive.kind === "limited" ? "每关三星共得缘玉" : "全活动首通缘玉合计"} ${fmt(totalJade)}，最高敌等 Lv.${maxElv}。</span></div>
        <div class="xn-row"><span class="xn-k">积分</span><span>${evLive.kind === "limited" ? "活动积分只来自关卡星级奖励（★1/★2/★3 逐档一次性发放），可在商店兑换与里程碑领奖。" : "通关即得活动积分，可在商店兑换与里程碑领奖。"}</span></div>
      </aside>`;
    }
    main = `<div class="xpe-eventpane">${secNav}<div class="xpe-eventbody">${secBody}</div></div>`;
  }
  // 仙令与其他 tab 同构：左侧默认卡片 + 右侧主面板（套主题底色）
  const passBg = "/bg/event-yaochao.jpg", passAc = "#9cc4e4";
  const wrapStyle = xpeTab === "pass"
    ? `style="--ev-ac:${passAc};--ev-bg:url('${passBg}')"`
    : `style="--ev-ac:${esc(accent)};--ev-bg:url('${esc(bannerBg)}')"`;
  // 页签行放整屏顶部（横跨左栏 + 主面板），否则会被右侧主面板宽度限制挤爆
  host.innerHTML = `<div class="xpe-screen" ${wrapStyle}><div class="xpe-tabsbar">${tabs}</div><div class="xpe-wrap">${left}<section class="panel panel-pad xpe-main xpe-themed">${main}</section></div></div>`;
}

function xpeTaskRewardText(rw = {}) { return xpeRewardText(rw); }

/** 日常 / 周常页签的左侧说明卡 */
function xpeTasksLeft(kind) {
  const doc = (DATA.tasks || {})[kind] || {};
  const panel = xpeTasks ? xpeTasks[kind] : null;
  const act = panel ? panel.activity : 0;
  // 上限从 taskInfo 的里程碑算（boot.statics.tasks 只下发摘要，不含 milestones）
  const msList = panel && panel.milestones && panel.milestones.length ? panel.milestones : [];
  const max = msList.reduce((a, m) => Math.max(a, m.at), 0) || 1;
  const pct = Math.min(100, Math.round((act / max) * 100));
  const isDaily = kind === "daily";
  return `<aside class="panel panel-pad xpe-side" style="--ev-ac:${isDaily ? "#9cc4e4" : "#d8b878"}">
    <div class="xpe-banner" style="background-image:url('/bg/${isDaily ? "evbg-caiyao_v1" : "event-yaochao"}.jpg')">
      <div class="xpe-banner-body">
        <div class="xpe-banner-sub">${isDaily ? "日复一日 · 积少成多" : "一周一会 · 厚积薄发"}</div>
        <div class="xpe-banner-name">${esc(doc.label || (isDaily ? "日常活动" : "周常活动"))} <span class="xpe-kindchip pmt">${I("flag", "width:11px;height:11px")}${esc(doc.reset || "")}</span></div>
        <div class="xpe-banner-desc">${esc(doc.desc || "")}</div>
      </div>
    </div>
    <div class="xpe-taskact">
      <div class="xpe-taskact-hd">${I("sparkle", "width:12px;height:12px")} 活跃值 <b class="num">${act}</b><span class="num">/ ${max}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="xpe-taskact-tip">完成${isDaily ? "日常" : "周常"}任务积累活跃值，达到档位即可领取里程碑宝箱。</div>
    </div>
    <div class="xpe-side-note">${I("clock", "width:12px;height:12px;vertical-align:-2px")} ${esc(doc.reset || "")}；已完成但未领取的任务不会清零，奖励保留到本周期结束。</div>
  </aside>`;
}

/** 日常 / 周常任务列表 + 里程碑 */
function xpeTasksHtml(kind) {
  const panel = xpeTasks ? xpeTasks[kind] : null;
  if (!panel) return `<div class="panel-sub">任务加载中……</div>`;
  const isDaily = kind === "daily";
  const rows = panel.tasks.map(t => {
    const pct = Math.min(100, Math.round((t.progress / Math.max(1, t.goal)) * 100));
    const claimable = t.done && !t.claimed;
    return `<div class="xpe-task ${t.done ? "done" : ""} ${t.claimed ? "claimed" : ""}">
      <div class="xt-main">
        <div class="xt-t">${esc(t.label)} <span class="xt-act num">+${t.activity}</span></div>
        <div class="xt-d">${esc(t.desc)}</div>
        <div class="xt-bar"><div class="bar"><i style="width:${pct}%"></i></div><span class="num">${fmt(t.progress)}/${fmt(t.goal)}</span></div>
      </div>
      <div class="xt-rw">${esc(xpeTaskRewardText(t.reward))}</div>
      <div class="xt-btn">${t.claimed ? `<span class="xt-done">${I("check", "width:13px;height:13px")} 已领取</span>`
        : claimable ? `<button class="btn sm primary" data-xtask="${kind}:${esc(t.id)}">领 取</button>`
        : `<span class="xt-lk num">${pct}%</span>`}</div>
    </div>`;
  }).join("");
  const ms = panel.milestones.map(m => `<div class="xpe-ms ${m.claimed ? "done" : m.reached ? "ready" : "locked"}">
      <div class="xms-score num">${m.at}<span>活跃</span></div>
      <div class="xms-main"><div class="xms-t">${esc(m.label)}</div><div class="xms-d">${esc(xpeTaskRewardText(m.reward))}</div></div>
      <div class="xms-act">${m.claimed ? `<span class="xms-done">${I("check", "width:13px;height:13px")} 已领取</span>`
        : m.reached ? `<button class="btn sm primary" data-xtms="${kind}:${m.at}">领 取</button>`
        : `<span class="xms-lk num">差 ${Math.max(0, m.at - panel.activity)}</span>`}</div>
    </div>`).join("");
  const doneCount = panel.tasks.filter(t => t.done).length;
  return `<div class="xpe-taskwrap">
    <div class="xpe-taskhd">
      <div>
        <div class="panel-title" style="font-size:15px">${I(isDaily ? "clock" : "flag", "width:14px;height:14px;vertical-align:-2px")} ${esc(panel.label)}</div>
        <div class="panel-sub" style="margin-top:4px">${esc(panel.desc)}</div>
      </div>
      <div class="xpe-taskhd-r">
        <div class="xpe-pass-lv"><b class="num">${doneCount}</b><span>/${panel.tasks.length} 已完成</span></div>
        <div class="xpe-pass-bar"><div class="bar"><i style="width:${Math.min(100, Math.round(panel.activity / Math.max(1, panel.milestones.reduce((a, m) => Math.max(a, m.at), 1)) * 100))}%"></i></div><span class="num">活跃 ${panel.activity}</span></div>
      </div>
    </div>
    <div class="xpe-tasklist">${rows}</div>
    ${isDaily ? xpeDailyShopHtml(panel) : ""}
    <div class="xpe-sec-hd" style="margin-top:16px">活 跃 里 程 碑 <span class="n">${esc(panel.reset)}</span></div>
    <div class="xpe-mslist">${ms}</div>
  </div>`;
}

/** 每日商城：完成全部日常任务（打满每日关卡）后才开放；每日 04:00 换一批 */
function xpeDailyShopHtml(panel) {
  const shop = panel.shop || [];
  if (!shop.length) return "";
  const unlocked = !!panel.shopUnlocked;
  const rows = shop.map(l => {
    const sold = (l.bought || 0) >= (l.stock ?? 1);
    const gives = Object.entries(l.gives || {}).map(([k, n]) => (k === "jade" ? "缘玉" : xpeMatName(k)) + " ×" + n).join(" · ");
    return `<div class="xds-item ${sold || !unlocked ? "off" : ""}">
      <div class="xds-main"><b>${esc(l.label)}</b><span>${esc(gives)}</span></div>
      <div class="xds-act">
        <span class="xds-price">${I("coin", "width:11px;height:11px")} ${fmt(l.cost)}</span>
        ${!unlocked ? `<span class="xds-lk">未开放</span>`
          : sold ? `<span class="xds-lk">已售罄</span>`
          : `<button class="btn sm primary" data-xtshop="${esc(l.key)}">兑换</button>`}
      </div>
    </div>`;
  }).join("");
  return `<div class="xpe-dailyshop-row">
    <div class="xpe-dailyshop-hd">${I("gift", "width:12px;height:12px")} 每 日 商 城 <span>${esc(panel.shopNote || "")}</span></div>
    <div class="xpe-dailyshop ${unlocked ? "" : "locked"}">${rows}</div>
    ${unlocked ? "" : `<div class="xpe-dailyshop-tip">${I("lock", "width:12px;height:12px;vertical-align:-2px")} 今日日常任务还差 ${panel.tasks.filter(t => !t.done).length} 项未完成——全部完成后才能兑换每日商城物品。</div>`}
  </div>`;
}

function xpePassHtml() {
  const p = xpePass;
  if (!p) return `<div class="panel-sub">仙令加载中……</div>`;
  const next = p.next || 100;
  const pct = Math.min(100, Math.round((p.exp / next) * 100));
  // 奖励轨按页展示：50 级两列铺开仍会顶出屏幕，改成分页（每页 10 级），
  // 配上一页/下一页，既保留全部奖励又不需要纵向滚动条。
  const per = 10;
  const table = DATA.passTable || [];
  const pages = Math.max(1, Math.ceil(table.length / per));
  if (xpePassPage >= pages) xpePassPage = 0;
  if (xpePassPage < 0) xpePassPage = 0;
  const slice = table.slice(xpePassPage * per, xpePassPage * per + per);
  const rows = slice.map(r => {
    const gotLv = r.level <= p.level;
    const cell = (track, rw, claimed) => {
      if (claimed) return `<div class="xpe-prw"><span class="rw">${xpeRewardText(rw)}</span><span class="xpe-pdone" data-tip="已领取">${I("check", "width:13px;height:13px")}</span></div>`;
      if (!gotLv) return `<div class="xpe-prw locked"><span class="rw">${xpeRewardText(rw)}</span><span class="xpe-plk num">Lv.${r.level}</span></div>`;
      if (track === "paid" && !p.paid) return `<div class="xpe-prw locked"><span class="rw">${xpeRewardText(rw)}</span><span class="xpe-plk">需解锁</span></div>`;
      return `<div class="xpe-prw"><span class="rw">${xpeRewardText(rw)}</span><button class="btn sm ${track === "free" ? "primary" : ""}" data-passclaim="${track}:${r.level}">领取</button></div>`;
    };
    return `<div class="xpe-passrow ${r.level % 5 === 0 ? "milestone" : ""}">
      <div class="xpe-plv num">${r.level}</div>
      ${cell("free", r.free, p.claimedFree.includes(r.level))}
      ${cell("paid", r.paid, p.claimedPaid.includes(r.level))}
    </div>`;
  }).join("");
  const pager = `<div class="xpe-pager">
    <button data-passpage="-1" ${xpePassPage === 0 ? "disabled" : ""}>上一页</button>
    <span class="num">Lv.${xpePassPage * per + 1}–${Math.min(table.length, xpePassPage * per + per)} / ${table.length} · 第 ${xpePassPage + 1}/${pages} 页</span>
    <button data-passpage="1" ${xpePassPage >= pages - 1 ? "disabled" : ""}>下一页</button>
  </div>`;
  return `
  <div class="xpe-pass-hd">
    <div>
      <div class="panel-title" style="font-size:15px">${I("pass", "width:14px;height:14px;vertical-align:-2px")} 仙 令 <span class="panel-sub" style="margin:0 0 0 8px">第 ${p.season} 季</span></div>
      <div class="panel-sub" style="margin-top:4px">出战与扫荡累积仙令经验，等级达标即可领取对应轨奖励。</div>
    </div>
    <div class="xpe-pass-lv">Lv.<b class="num">${p.level}</b><span>/50</span></div>
    <div class="xpe-pass-bar">
      <div class="bar"><i style="width:${pct}%"></i></div>
      <span class="num">经验 ${fmt(p.exp)} / ${fmt(next)}</span>
    </div>
    ${p.paid ? `<span class="tag gold">${I("check", "width:12px;height:12px;vertical-align:-2px")} 顺缘已解锁</span>`
             : `<button class="btn sm primary" data-passbuy="1">解锁顺缘 · ${fmt(DATA.passUnlockCost || 260)} 尘缘</button>`}
  </div>
  <div class="xpe-pass-head"><span></span><span>同游 · 免费轨</span><span>顺缘 · 付费轨</span></div>
  <div class="xpe-passlist">${rows}</div>
  ${pager}`;
}

/* ---------------- 章末回望弹窗 ---------------- */

const xpeChapClaimed = new Set();   // 本会话内已领章节（服务端仍是最终裁决）

async function openChapterReview(chapter) {
  const host = modal(`<div class="menu xpe-chaprev" style="width:470px">
    <div class="xpe-cv-bg"></div>
    <div class="xpe-cv-cap">章 末 回 望</div>
    <div class="panel-sub" style="text-align:center;margin-top:14px">回望加载中……</div>
  </div>`, { dimClose: true });
  const j = await call({ type: "chapterInfo", chapter }).catch(() => null);
  if (!host.isConnected) return;
  const info = j && j.chapterInfo;
  const ch = DATA.chapters[chapter - 1] || {};
  if (!info || info.error) {
    host.innerHTML = `<div class="menu xpe-chaprev" style="width:470px">
      <div class="xpe-cv-bg"></div>
      <button class="iconbtn" data-close style="position:absolute;top:10px;right:10px">${I("close")}</button>
      <div class="xpe-cv-cap">章 末 回 望</div>
      <div class="panel-sub" style="text-align:center;margin-top:14px">${esc((info && info.error) || "读取失败，稍后再试")}</div>
    </div>`;
    return;
  }
  const allCleared = info.cleared >= info.total;
  const canClaim = allCleared && !xpeChapClaimed.has(chapter);
  const top = (info.topChars || []).slice(0, 3);
  host.innerHTML = `<div class="menu xpe-chaprev" style="width:470px">
    <div class="xpe-cv-bg"></div>
    <button class="iconbtn" data-close style="position:absolute;top:10px;right:10px">${I("close")}</button>
    <div class="xpe-cv-cap">章 末 回 望</div>
    <div class="xpe-cv-name">${esc(ch.label || `第 ${chapter} 章`)}</div>
    <div class="xpe-cv-stats">
      <div class="sg"><div class="k">已清</div><div class="v num">${info.cleared}<span style="font-size:12px;color:var(--faint)">/${info.total}</span></div></div>
      <div class="sg"><div class="k">三星</div><div class="v num">${info.threeStar}</div></div>
      <div class="sg"><div class="k">星数</div><div class="v num">${info.stars}</div></div>
      <div class="sg"><div class="k">完成度</div><div class="v num">${Math.round((info.starRate || 0) * 100)}%</div></div>
    </div>
    ${top.length ? `<div class="panel-sub" style="text-align:center;margin-top:8px">出 场 之 最</div>
    <div class="xpe-cv-top">
      ${top.map((c, i) => `<div class="tp">
        <div class="av">${c.avatar ? `<img src="${esc(c.avatar)}" alt="" data-fb="portrait">` : ""}</div>
        <div class="nm">${i === 0 ? "★ " : ""}${esc(c.name)}</div>
      </div>`).join("")}
    </div>` : `<div class="panel-sub" style="text-align:center;margin-top:14px">整装待发，尚无出场记录。</div>`}
    <div class="xpe-cv-claimslot">
      ${canClaim
        ? `<button class="btn primary lg" data-xpechapclaim="${chapter}" style="width:100%">${I("gift", "width:14px;height:14px;vertical-align:-2px")} 领 取 通 关 礼</button>`
        : allCleared
          ? `<div class="xpe-cv-claimed">${I("check", "width:13px;height:13px;vertical-align:-2px")} 通关礼已领取</div>`
          : `<div class="panel-sub" style="text-align:center">全章通关后可领取章节礼（铜钱 · 缘玉 · 器魂）</div>`}
    </div>
  </div>`;
  blip(640, .07);
}

/* ---------------- 名册 · 作战方略 / 候补席 ---------------- */

let xpeTac = null;        // setTactics 回包缓存（buildView 未必透出 tactics）
let xpeBench = undefined; // setBench 回包缓存（undefined=尚未从 S 初始化）
function xpeTactics() { return xpeTac || S.tactics || { ult: "burst", combo: "boss", focus: "smart" }; }
function xpeBenchId() {
  if (xpeBench !== undefined) return xpeBench;
  xpeBench = S.bench ?? null;
  return xpeBench;
}
function xpeTacticsHtml() {
  const t = xpeTactics();
  const bid = xpeBenchId();
  const b = bid ? charById(bid) : null;
  const opts = (pairs, val) => pairs.map(([v, l]) => `<option value="${v}" ${v === val ? "selected" : ""}>${l}</option>`).join("");
  return `<div class="xpe-tac">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="panel-title" style="font-size:14px">${I("gear", "width:13px;height:13px;vertical-align:-2px")} 作 战 方 略</div>
      <span class="panel-sub" style="margin:0">改动即刻生效</span>
    </div>
    <div class="xpe-tac-row"><span class="k">终式时机</span>
      <select class="xpe-tacsel" data-tacaxis="ult" data-tip="终式时机|burst 先手爆发 · boss 对首领 · support 保队友">${opts([["burst", "先手爆发"], ["boss", "对首领"], ["support", "保队友"]], t.ult)}</select></div>
    <div class="xpe-tac-row"><span class="k">合击策略</span>
      <select class="xpe-tacsel" data-tacaxis="combo" data-tip="合击策略|boss 首领优先 · group 清群 · never 不合击">${opts([["boss", "首领优先"], ["group", "清群"], ["never", "不合击"]], t.combo)}</select></div>
    <div class="xpe-tac-row"><span class="k">集 火</span>
      <select class="xpe-tacsel" data-tacaxis="focus" data-tip="集火|smart 智能集火（斩杀优先） · low 血最低 · atk 攻最高 · spread 分散">${opts([["smart", "智能集火"], ["low", "血最低"], ["atk", "攻最高"], ["spread", "分散"]], t.focus)}</select></div>
    <div class="panel-sub" style="margin:2px 0 0;line-height:1.5">嘲讽会强制敌方单体技能转火嘲讽者；匿影单位不会被单体技能选中。两者优先于集火策略。</div>
    <div class="xpe-bench">
      <span class="k">候补席</span>
      ${b ? `<img class="xpe-bench-av" src="${art(bid, "avatar")}" alt="" data-fb="rm" data-tip="${esc(b.name)}|当前候补">
             <span style="font-size:12.5px;color:var(--ink)">${esc(b.name)}</span>
             <button class="btn sm" data-xpebenchpick="1">换 人</button>
             <button class="btn sm ghost" data-benchclear="1">撤 下</button>`
           : `<span class="panel-sub" style="margin:0">虚位以待 · 候补的等级计入共鸣线</span>
             <button class="btn sm" data-xpebenchpick="1">选 人</button>`}
    </div>
  </div>`;
}
/** 在名册右栏末尾注入方略卡（每次 renderRoster 后重挂，跟随重绘） */
function xpeTeamInject() {
  if (cur !== "roster") return;
  const side = $("#scr-roster .rl-side");
  if (!side) return;
  let box = document.getElementById("xpeTeamBox");
  if (!box) { box = document.createElement("div"); box.id = "xpeTeamBox"; side.appendChild(box); }
  box.innerHTML = xpeTacticsHtml();
}
function xpeBenchPick() {
  const cands = Object.keys(S.owned || {})
    .filter(id => !S.team.includes(id))
    .sort((a, b) => RAR_ORDER.indexOf(charById(a)?.rarity) - RAR_ORDER.indexOf(charById(b)?.rarity)
      || (S.owned[b]?.lv || 0) - (S.owned[a]?.lv || 0));
  modal(`<div class="menu" style="width:640px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="panel-title">候 补 席 · 选 人</div>
      <button class="iconbtn" data-close>${I("close")}</button>
    </div>
    <div class="panel-sub" style="margin-top:6px">候补不占编队五席，其等级计入共鸣线；编队中的人物不可再当候补。</div>
    <div class="cgrid" style="grid-template-columns:repeat(6,1fr);gap:10px;margin-top:14px;max-height:52vh;overflow:auto">
      ${cands.map((id) => {
        const c = charById(id) || {};
        const rc = RCOLOR(c.rarity);
        return `<div data-benchset="${esc(id)}" style="cursor:pointer;text-align:center">
          <div class="avatar" style="width:100%;aspect-ratio:1;height:auto;border-color:${rc}">${artImg(id)}</div>
          <div style="font-size:12px;margin-top:5px;color:${rc}">${esc(c.name || id)}</div></div>`;
      }).join("") || `<div class="panel-sub">还没有可候补的角色。</div>`}
    </div>
    <div style="margin-top:14px"><button class="btn" style="width:100%" data-close>取 消</button></div>
  </div>`, { dimClose: true });
}
/* 包装全局 renderRoster：渲染完顺手挂上方略卡（RENDER.roster 同步换绑） */
const _xpeRenderRoster = renderRoster;
const _xpeRosterWrapped = function () {
  const r = _xpeRenderRoster.apply(this, arguments);
  try { xpeTeamInject(); } catch (e) { /* 名册结构变化时不拖垮原渲染 */ }
  return r;
};
renderRoster = _xpeRosterWrapped;
if (typeof RENDER === "object" && RENDER) RENDER.roster = _xpeRosterWrapped;

/* ---------------- 事件委托（本文件的 data-* 全在这里收口） ---------------- */

document.addEventListener("click", async e => {
  const t = e.target;
  const tab = t.closest("[data-xpetab]");
  if (tab) { xpeTab = tab.dataset.xpetab; xpeSec = "main"; blip(620, .05); return renderEvents(); }
  const sec = t.closest("[data-xpesec]");
  if (sec) { xpeSec = sec.dataset.xpesec; blip(600, .04); return renderEvents(); }
  const pg = t.closest("[data-passpage]");
  if (pg) { xpePassPage = Math.max(0, xpePassPage + (+pg.dataset.passpage)); blip(560, .03); return renderEvents(); }
  const buy = t.closest("[data-xpebuy]");
  if (buy) {
    const j = await call({ type: "eventShopBuy", event: xpeCurEvent, key: buy.dataset.xpebuy });
    if (j && j.eventShopBuy) {
      const r = j.eventShopBuy;
      toast(r.note ? `已兑换 · ${r.note}` : "已兑换");
      blip(720, .08);
      refreshWallet(); renderEvents();
    }
    return;
  }
  const ems = t.closest("[data-xpems]");
  if (ems) {
    const j = await call({ type: "eventMilestone", event: xpeCurEvent, score: +ems.dataset.xpems });
    if (j && j.eventMilestone) {
      const r = j.eventMilestone;
      toast(`里程碑 · ${r.note || ""} ${xpeRewardText(r.reward)}`);
      blip(820, .12); refreshWallet(); renderEvents();
    }
    return;
  }
  const xt = t.closest("[data-xtask]");
  if (xt) {
    const [kind, id] = String(xt.dataset.xtask).split(":");
    const j = await call({ type: "taskClaim", kind, id });
    if (j && j.taskClaim) {
      toast(`任务 · ${j.taskClaim.note || ""} ${xpeRewardText(j.taskClaim.reward)}`);
      blip(740, .09); refreshWallet(); renderEvents();
    }
    return;
  }
  const xts = t.closest("[data-xtshop]");
  if (xts) {
    const j = await call({ type: "taskShopBuy", key: xts.dataset.xtshop });
    if (j && j.taskShopBuy) {
      toast(`每日商城 · ${j.taskShopBuy.note || ""} ${xpeRewardText(j.taskShopBuy.gives || {})}`);
      blip(720, .08); refreshWallet(); renderEvents();
    }
    return;
  }
  const xtm = t.closest("[data-xtms]");
  if (xtm) {
    const [kind, at] = String(xtm.dataset.xtms).split(":");
    const j = await call({ type: "taskMilestone", kind, at: +at });
    if (j && j.taskMilestone) {
      toast(`活跃宝箱 · ${j.taskMilestone.note || ""} ${xpeRewardText(j.taskMilestone.reward)}`);
      blip(820, .12); refreshWallet(); renderEvents();
    }
    return;
  }
  const pb = t.closest("[data-passbuy]");
  if (pb) {
    const j = await call({ type: "passBuy" });
    if (j && j.passBuy) { toast(`仙令顺缘已解锁 · 消耗尘缘 ${fmt(j.passBuy.cost)}`); blip(780, .1); renderEvents(); }
    return;
  }
  const pc = t.closest("[data-passclaim]");
  if (pc) {
    const [track, lv] = String(pc.dataset.passclaim).split(":");
    const j = await call({ type: "passClaim", track, level: +lv });
    if (j && j.passClaim) {
      toast(`仙令 · ${j.passClaim.note || ""} ${xpeRewardText(j.passClaim.reward)}`);
      blip(760, .09); refreshWallet(); renderEvents();
    }
    return;
  }
  const cv = t.closest("[data-chapview]");
  if (cv) return openChapterReview(+cv.dataset.chapview);
  const cc = t.closest("[data-xpechapclaim]");
  if (cc) {
    const n = +cc.dataset.xpechapclaim;
    const j = await call({ type: "chapterClaim", chapter: n });
    if (j && j.chapterClaim) {
      xpeChapClaimed.add(n);
      toast(`章节礼 · ${xpeRewardText(j.chapterClaim.reward)}`);
      blip(820, .12); refreshWallet();
      openChapterReview(n);
    }
    return;
  }
  const conv = t.closest("[data-xpeconv]");
  if (conv) {
    const route = XPE_CONVERTS[+conv.dataset.xpeconv];
    if (!route) return;
    const inp = document.getElementById("xpe-conv-" + conv.dataset.xpeconv);
    const times = Math.max(1, Math.min(999, Math.floor(+inp?.value || 1)));
    const j = await call({ type: "convert", from: route.from, to: route.to, times });
    if (j && j.convert && j.convert.ok) { toast(j.convert.note); blip(700, .07); refreshWallet(); if (cur === "bag") renderBag(); }
    return;
  }
  const bp = t.closest("[data-xpebenchpick]");
  if (bp) return xpeBenchPick();
  const bs = t.closest("[data-benchset]");
  if (bs) {
    const j = await call({ type: "setBench", id: bs.dataset.benchset });
    if (j) {
      xpeBench = j.bench || bs.dataset.benchset;
      toast("已入候补席"); blip(680, .07);
      closeModal(); xpeTeamInject();
    }
    return;
  }
  const bc = t.closest("[data-benchclear]");
  if (bc) {
    const j = await call({ type: "setBench", id: "" });
    if (j) { xpeBench = null; toast("候补已撤下"); xpeTeamInject(); }
    return;
  }
});

/* 方略下拉：change 事件统一收口（innerHTML 重挂也不丢） */
document.addEventListener("change", e => {
  const sel = e.target.closest("select.xpe-tacsel");
  if (!sel) return;
  const prev = xpeTactics();
  const next = { ...prev, [sel.dataset.tacaxis]: sel.value };
  call({ type: "setTactics", ult: next.ult, combo: next.combo, focus: next.focus }).then(j => {
    if (j) { xpeTac = j.tactics || next; toast("作战方略已更新"); }
    else sel.value = prev[sel.dataset.tacaxis];
  });
});

/* ---------------- 转化路线（行囊 · 材料页调用；与 tools/lib/expansion.mjs CONVERSIONS 同表） ---------------- */
/* 注意：器魂→尘缘的服务端路线键是 soul->dust（发放目标是 essence）。 */
const XPE_CONVERTS = [
  { from: "page", to: "note", need: 3, gainTxt: "×1", perDay: 10 },
  { from: "note", to: "scroll", need: 2, gainTxt: "×1", lossy: true },
  { from: "tome:purple", to: "tome:gold", need: 4, gainTxt: "×1" },
  { from: "tome:gold", to: "tome:red", need: 4, gainTxt: "×1" },
  { from: "soul", to: "dust", need: 1, gainTxt: "×60", toName: "尘缘" },
  { from: "shard", to: "soul", need: 1, gainTxt: "×5" },
];
/** 行囊材料页的「炼化转化」卡（screens-mid.js 的 bagAssetsHtml 引用） */
function xpeConvertHtml() {
  return `<div class="panel panel-pad" style="margin-top:16px">
    <div class="panel-title">炼 化 转 化</div>
    <div class="panel-sub" style="margin-top:4px">把富余材料炼成紧缺的一档；器魂可化尘缘，通用残卷不分阶炼成器魂。</div>
    <div style="margin-top:10px">
      ${XPE_CONVERTS.map((r, i) => {
        const toName = r.toName || xpeMatName(r.to);
        return `<div class="xpe-conv">
          <div class="xc-flow">${esc(xpeMatName(r.from))} <b class="num">×${r.need}</b>
            <span class="xc-arrow">→</span> ${esc(toName)} <b class="num">${r.gainTxt}</b>
            ${r.lossy ? `<span class="xc-loss">有损耗</span>` : ""}
            ${r.perDay ? `<span class="xc-limit num">日限 ${r.perDay} 次</span>` : ""}
          </div>
          <span class="xc-have num">有 ${fmt(xpeHave(r.from))}</span>
          <input class="xpe-qty num" id="xpe-conv-${i}" type="number" min="1" max="999" value="1" data-tip="次数|本次转化执行几次（每次消耗 ${r.need} 个）">
          <button class="btn sm" data-xpeconv="${i}">转 化</button>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

/* ---------------- 自注册：活动页签 ---------------- */

TABS_NEW.push(["event", "活动", "event"]);
SCREEN_BG.event = "event-yaochao";
SCREEN_BGM.event = "home";
RENDER.event = renderEvents;
