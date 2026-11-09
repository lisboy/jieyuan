/* 拾缘 · settle —— 由 app.js 拆分（2026-10-26） */
function refreshAfterBattle(outcome) {
  try {
    /* 胜利后把选中目标推进到「下一个可打关卡 / 下一层」：
     * 战斗结束时 api 已经把 S.cleared 换新，重绘前先标记自动定位，
     * 否则打完还停在刚通关的旧关/旧层上，玩家得自己再点一次。
     * 战败、扫荡不推进，保留玩家原来的选择。 */
    if (outcome && outcome.win) {
      if (cur === "stages") stageAutoPick = true;
      if (cur === "tower") towerAutoPick = true;
    }
    if (typeof RENDER !== "undefined" && RENDER[cur]) RENDER[cur]();
    renderResBar();
  } catch (e) { /* 重画失败不该挡住结算弹窗 */ }
}

let bvSkipHandler = null;
let bvAuto = false;
/* 战斗场次序号 / 进行中标记：
 * 多场连打（尤其每场都点「跳过」）时，上一场的收尾动画、900ms 结算停顿可能还没走完，
 * 下一场就已经开场。旧场次收尾时会把全局 bvSkipHandler 清空、把 #battleView 关掉，
 * 新场次就会「画面在但按钮全没反应」。用序号把收尾动作绑定到各自场次，并在入口挡住并发开战。 */
let bvBattleSeq = 0;
let bvStarting = false;
/* 出战锁起始时间：上一场如果卡在请求/演出里，超过 90s 就强制解锁，避免之后所有点击都被吞掉。 */
let bvStartAt = 0;
/* 是否有正在进行的战斗回放：供「战斗层残留」看门狗判断。
 * 若 #battleView 还亮着但已经没有任何回放在跑（异常分支提前 return），
 * 那块全屏层会挡住整个页面——玩家看到的就是「界面还在但点不动」。 */
let bvLive = false;
setInterval(() => {
  try {
    const bv = document.getElementById("battleView");
    if (!bv || !bv.classList.contains("on")) return;
    if (bvLive || bvStarting) return;
    console.warn("[battle] 检测到残留战斗层（无进行中回放），自动关闭");
    closeBattle();
  } catch (e) { /* 自愈失败不抛出 */ }
}, 2500);
/* 全屏演出层残留清理：跳过/异常分支可能留下 .xpb-phase（BOSS 阶段黑幕）等整屏节点。
 * 这类节点 pointer-events 虽然是 none，但会持续跑 CSS 动画、叠高渲染层，连跳几场后整页发卡。
 * 只要没有正在进行的战斗回放（bvLive=false），就把它们全部摘掉。 */
setInterval(() => {
  try {
    const bv = document.getElementById("battleView");
    if (!bv) return;
    if (bvLive) return;               // 战斗进行中：这些层可能正在正常演出，不能动
    const junk = bv.querySelectorAll(".xpb-phase, .xpb-modhint, .ub-video-layer, .ubar, .ufx-layer");
    if (!junk.length) return;
    console.warn(`[battle] 清理残留演出层 ${junk.length} 个`);
    junk.forEach(el => {
      try { if (el.getAnimations) el.getAnimations().forEach(a => { try { a.cancel(); } catch {} }); } catch {}
      el.remove();
    });
  } catch (e) { /* 自愈失败不抛出 */ }
}, 3000);
/* 主线程停顿自救守卫（2026-11-05）：
 * 玩家确认「就是浏览器前端卡死，换浏览器正常」。这类假死的本质是残留的全屏演出层
 * 和仍在跑的 CSS 动画把页面主线程/合成线程拖住，JS 定时器被挤到几秒才跑一次。
 * 这里每秒测一次事件循环延迟：一旦发现 ≥2s 的停顿（页面刚从假死中缓过来），立刻：
 *   ① 取消 #battleView 内所有动画并摘掉临时演出层；② 清掉孤儿 .modal-dim 遮罩。
 * 只在长时间停滞后执行，正常战斗演出/界面动画完全不受影响；清理后玩家无需刷新即可继续点。 */
let __uiGuardWorst = 0;
let __uiGuardLast = 0;
/* 后台标签页会被浏览器把定时器降到 1 次/分钟，不能当成主线程卡死；
 * 切回前台时重置心跳基准，避免刚回来就误清战斗演出。 */
document.addEventListener("visibilitychange", () => { __uiGuardLast = 0; });
setInterval(() => {
  if (document.visibilityState !== "visible") { __uiGuardLast = performance.now(); return; }
  const now = performance.now();
  /* 用「相邻两次心跳的真实间隔」判断：正常是 1000ms；被同步阻塞时 Chrome 会把错过的
   * 回调合并成一次，间隔会变成 1000+阻塞时长（例如阻塞 2.6s → 间隔约 2.6s）。
   * 阈值 1800ms 即「主线程被压住 ≥0.8s」，正常战斗演出远达不到这个量级。 */
  const delta = __uiGuardLast ? now - __uiGuardLast : 1000;
  __uiGuardLast = now;
  if (delta < 1800) return;
  const lag = Math.round(delta - 1000);
  __uiGuardWorst = Math.max(__uiGuardWorst, lag);
  try {
    const bv = document.getElementById("battleView");
    if (bv) {
      if (bv.getAnimations) bv.getAnimations().forEach(a => { try { a.cancel(); } catch {} });
      bv.querySelectorAll(".xpb-phase, .xpb-modhint, .ub-video-layer, .ubar, .ufx-layer, .pj, .pj-spark, .pj-boltbeam, .pj-moonblade, .pj-recall, .pj-slam, .pj-thread-bit, .pj-flare, .bfloat, .fx-burst, .xpb-ci2").forEach(el => {
        try { if (el.getAnimations) el.getAnimations().forEach(a => { try { a.cancel(); } catch {} }); } catch {}
        el.remove();
      });
    }
    const host = document.getElementById("modalHost");
    if (host) {
      const dim = host.querySelector(".modal-dim");
      const box = host.querySelector(".modal");
      if (dim && !box) { host.innerHTML = ""; host.classList.remove("has-modal"); }
    }
    console.warn(`[ui-guard] 检测到主线程停顿 ${lag}ms，已清理残留演出层/遮罩`);
    window.__uiGuard = { worstMs: __uiGuardWorst, lastAt: Date.now() };
  } catch (e) { /* 自愈失败不抛出 */ }
}, 1000);
/* 自动连战熔断计数（只在前端，不落存档）：
 *  - failRun：连续「没推进」的场次（败仗 / 引擎报错），同一关反复失败说明打不动，必须停；
 *  - advRun：连续推进的关数，用于给连战加最小间隔，别把引擎进程池连着打爆。 */
let bvFailRun = 0;
let bvAdvRun = 0;
const BV_FAIL_LIMIT = 3;

/** 自动按钮的显示态与 bvAuto 对齐（任何地方改 bvAuto 后都调它，避免按钮还亮着但已停） */
function syncAutoBtn() {
  const b = $("#bvAuto");
  if (!b) return;
  b.textContent = bvAuto ? "自动中" : "自动";
  b.classList.toggle("primary", !!bvAuto);
}

/** 停自动并说明原因：连战出错/打不动时统一收口，不让它无声继续点下去 */
function stopAuto(why) {
  if (!bvAuto) return;
  bvAuto = false;
  bvFailRun = 0;
  bvAdvRun = 0;
  syncAutoBtn();
  if (why) toast(why);
}
/** 关闭战斗层。带 seq 时只在「还是同一场」才收尾：旧场次的迟到收尾不能把新场次的按钮清掉。 */
function closeBattle(seq) {
  if (seq != null && seq !== bvBattleSeq) return;
  clearTimeout(bvTimer);
  bvSkipHandler = null;
  bvLive = false;
  try { if (typeof bvClearFx === "function") bvClearFx(); } catch (e) { /* 清演出残留失败不影响关闭 */ }
  $("#battleView").classList.remove("on");
}

/** 全场统计：把 result.turns 当纯数据走一遍（与演出/跳过无关），算我方每人的
 *  输出 / 承受 / 治疗 / 护盾 / 会心。归属规则：
 *  - 输出：damage/crit 记在出手回合的行动者头上（打敌方 side=1 的才算）；
 *  - 承受：敌方回合或任何来源打到 side=0 的伤害，记给挨打的人自己；
 *  - DOT 跳伤：跳在谁头上就记谁"承受"，但不记输出（没有可靠出处）；
 *  - 治疗/护盾：记给施放回合的行动者（施疗者/上盾者）。 */
function battleStats(result) {
  const rows = (result.allies || []).map((u, slot) => ({
    slot, id: u.id, name: (charById(u.id) || {}).name || u.id, dmg: 0, taken: 0, heal: 0, shield: 0, crits: 0,
  }));
  for (const turn of result.turns || []) {
    const me = turn.actorSide === 0 ? rows[turn.actorSlot] : null;
    for (const ev of turn.events || []) {
      const hostile = ev.kind === "damage" || ev.kind === "crit" || ev.kind === "dotTick";
      if (hostile && ev.side === 1 && me) {
        me.dmg += ev.amount || 0;
        if (ev.kind === "crit") me.crits++;
      } else if (hostile && ev.side === 0) {
        const tgt = rows[ev.slot];
        if (tgt) tgt.taken += ev.amount || 0;
      } else if (ev.kind === "heal" && ev.side === 0 && me) {
        me.heal += ev.amount || 0;
      } else if (ev.kind === "shield" && ev.side === 0 && me) {
        me.shield += ev.amount || 0;
      }
    }
  }
  rows.forEach(r => { for (const k of ["dmg", "taken", "heal", "shield"]) r[k] = Math.round(r[k]); });
  return rows;
}

/** 结算数字缩写：万位以上折算 x.x万，省宽度 */
function fmtW(n) { return n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1) + "万" : String(n); }

/** 下一关 id：主线同章下一关 / 打完进下一章首关；登仙塔=下一层；到头（或非主线/塔关）返回 null。
 *  结算弹窗「下一关」按钮与自动连战共用这一份推进规则。 */
function nextStageId(stageId) {
  if (stageId.startsWith("t")) {
    const tower = DATA.tower.list;
    const i = tower.findIndex(n => n.id === stageId);
    return i >= 0 && i < tower.length - 1 ? tower[i + 1].id : null;
  }
  const ch = DATA.chapters.find(c => c.nodes.some(n => n.id === stageId));
  if (!ch) return null;   // 副本/活动/虚境等非主线关：不推进，原地再战
  const idx = ch.nodes.findIndex(n => n.id === stageId);
  if (idx >= 0 && idx < ch.nodes.length - 1) return ch.nodes[idx + 1].id;
  const nc = DATA.chapters[DATA.chapters.indexOf(ch) + 1];
  return nc ? nc.nodes[0].id : null;
}

/** 关卡体力价：主线/本=节点 stamina；登仙塔免费（0）。查不到按 4 兜底（与旧硬编码一致）。 */
function stageStamina(stageId) {
  const node = stageId.startsWith("t")
    ? DATA.tower.list.find(n => n.id === stageId)
    : DATA.chapters.flatMap(c => c.nodes).find(n => n.id === stageId);
  return node ? (node.stamina || 0) : 4;
}

function showSettlement(stageId, result, outcome) {
  const rw = outcome.rewards || {};
  const matLine = Object.entries(rw.items || {}).map(([k, v]) =>
    `${matLabel(k)} ×${v}`).join("　");
  // 特殊掉落（通用残卷按阶分桶 / 技能书按档入包 / 本体残卷点名给谁）在服务端被从
  // rewards.items 摘到 rewards.notes 里。这里必须补渲染，否则「星盘·残卷」「心法·技能书」
  // 副本打完只看得到铜钱，玩家会以为残卷/技能书根本没发（2026-11-04 用户反馈）。
  const noteLines = Array.isArray(rw.notes) ? rw.notes.filter(Boolean) : [];
  // 本场统计：MVP（输出最高，没人有输出就比治疗）+ 全员四维明细（输出/承受/治疗/护盾）
  const stats = battleStats(result || {});
  const mvp = outcome.win && stats.length
    ? stats.slice().sort((a, b) => (b.dmg - a.dmg) || (b.heal - a.heal))[0] : null;
  if (mvp && mvp.dmg <= 0 && mvp.heal <= 0) mvp.id = null;   // 全员零输出（极端情况）不硬选
  // 胜利收势：MVP 报胜利台词（不再固定领队；败仗不报，留给战败音效）
  if (outcome.win && mvp?.id) AudioSys.cv(mvp.id, "win", { priority: 2 });
  const maxDmg = Math.max(1, ...stats.map(s => s.dmg));
  const hasDetail = stats.some(s => s.dmg || s.taken || s.heal || s.shield);
  // 四维明细表：名称列 + 输出/承受/治疗/护盾，MVP 行金色
  const statGrid = hasDetail ? `<div style="margin:8px 6px 0;text-align:left">
    <div style="display:flex;gap:6px;font-size:10px;color:var(--faint);letter-spacing:.06em;padding:0 0 3px">
      <span style="flex:none;width:58px"></span>
      <span style="flex:1.2;text-align:right">输出</span>
      <span style="flex:1;text-align:right">承受</span>
      <span style="flex:1;text-align:right">治疗</span>
      <span style="flex:1;text-align:right">护盾</span>
    </div>
    ${stats.map(s => {
      const hot = mvp && s.id === mvp.id && s.id;
      const cell = (v, color) => `<span class="num" style="flex:1;text-align:right;color:${v > 0 ? color : "var(--faint)"}">${v > 0 ? fmtW(v) : "—"}</span>`;
      return `<div style="display:flex;gap:6px;align-items:center;font-size:11.5px;padding:2.5px 0;border-top:1px solid rgba(255,255,255,.05)">
        <span style="flex:none;width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${hot ? "var(--gold)" : "var(--dim)"}">${hot ? "★ " : ""}${esc(s.name)}</span>
        <span style="flex:1.2;position:relative;display:flex;justify-content:flex-end">
          <span style="position:absolute;right:0;top:50%;transform:translateY(-50%);height:7px;width:${Math.round(s.dmg / maxDmg * 100)}%;max-width:100%;border-radius:3px;background:${hot ? "linear-gradient(90deg,rgba(232,201,138,.5),rgba(232,201,138,.14))" : "rgba(122,150,190,.28)"}"></span>
          <span class="num" style="position:relative;color:${s.dmg > 0 ? (hot ? "var(--gold-hi)" : "var(--ink)") : "var(--faint)"}">${s.dmg > 0 ? fmtW(s.dmg) : "—"}</span>
        </span>
        ${cell(s.taken, "#d99a6c")}
        ${cell(s.heal, "#79c9a0")}
        ${cell(s.shield, "#8fb6e8")}
      </div>`;
    }).join("")}
  </div>` : "";
  // 下一关：主线同章下一关 / 打完进下一章首关；登仙塔=下一层；已通到头就退回再战
  const nextId = outcome.win ? nextStageId(stageId) : null;
  const settleHost = modal(`<div class="menu" style="text-align:center;width:480px">
    <div style="font-family:var(--font-display);font-size:30px;letter-spacing:.3em;color:${outcome.win ? "var(--gold-hi)" : "#d0563c"};margin:8px 0 2px">${outcome.win ? "胜 利" : "战 败"}</div>
    ${starIcons(outcome.stars || 0, 3)}
    ${mvp && mvp.id ? `<div style="display:flex;gap:12px;align-items:center;margin:12px 6px 2px;padding:9px 11px;border:1px solid rgba(232,201,138,.4);border-radius:var(--r-m);background:rgba(232,201,138,.06);text-align:left">
      <div style="position:relative;flex:none">
        <img src="${art(mvp.id, "portrait")}" alt="" data-fb="standee,card,avatar" style="width:58px;height:80px;object-fit:cover;object-position:center 12%;border-radius:8px;border:1.5px solid var(--gold);display:block">
        <span style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:var(--gold);color:#1c1508;font-size:10px;font-weight:700;letter-spacing:.12em;padding:1px 7px;border-radius:8px">MVP</span>
      </div>
      <div style="min-width:0">
        <div style="font-family:var(--font-display);font-size:16px;color:var(--gold-hi)">${esc(mvp.name)}</div>
        <div class="panel-sub" style="margin-top:2px">本场输出 <b class="num" style="color:var(--ink)">${fmt(mvp.dmg)}</b>${mvp.crits ? ` · 会心 ×${mvp.crits}` : ""}${mvp.taken > 0 ? ` · 承受 ${fmtW(mvp.taken)}` : ""}${mvp.heal > 0 ? ` · 治疗 ${fmtW(mvp.heal)}` : ""}${mvp.shield > 0 ? ` · 护盾 ${fmtW(mvp.shield)}` : ""}</div>
      </div>
    </div>` : ""}
    ${statGrid}
    <div style="display:grid;gap:7px;text-align:left;margin:14px 0">
      ${outcome.log.map(l => `<span class="tag gold" style="justify-content:flex-start">${I("sparkle", "width:13px;height:13px")} ${esc(l)}</span>`).join("")}
      ${rw.coin ? `<span class="tag gold" style="justify-content:flex-start">${I("coin", "width:13px;height:13px")} 铜钱 +${fmt(rw.coin)}</span>` : ""}
      ${matLine ? `<span class="tag dim" style="justify-content:flex-start">${I("page", "width:13px;height:13px")} ${esc(matLine)}</span>` : ""}
      ${noteLines.map(n => `<span class="tag dim" style="justify-content:flex-start">${I("gem", "width:13px;height:13px")} ${esc(n)}</span>`).join("")}
      ${outcome.log.length + (rw.coin ? 1 : 0) + (matLine ? 1 : 0) + noteLines.length === 0 ? `<span class="panel-sub">什么都没拿到。</span>` : ""}
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn" style="flex:1;white-space:nowrap;padding:9px 8px;letter-spacing:.04em;font-size:14px" data-settleok>确 定</button>
      <button class="btn" style="flex:1;white-space:nowrap;padding:9px 8px;letter-spacing:.04em;font-size:14px;gap:5px" data-breport="1">${(typeof ICONS !== "undefined" && ICONS.report) ? I("report", "width:13px;height:13px") : ""}战 报</button>
      ${outcome.win && stageId !== "xujing" && !stageId.startsWith("t") ? `<button class="btn" style="flex:1;white-space:nowrap;padding:9px 8px;letter-spacing:.04em;font-size:14px" data-sweep="${stageId}" data-times="5">扫荡 ×5</button>` : ""}
      ${stageId === "xujing" ? "" : `<button class="btn primary" style="flex:1;white-space:nowrap;padding:9px 8px;letter-spacing:.04em;font-size:14px" data-battle="${nextId || stageId}">${outcome.win ? (nextId ? (stageId.startsWith("t") ? "下 一 层" : "下 一 关") : "再 战") : "再 试"}</button>`}
    </div>
  </div>`, { dimClose: false });
  // 结算关闭（确定按钮 / 点遮罩）后接住战斗掉出的待处理奇遇；
  // 确定/遮罩都走 data-settleok 语义，不能复用 data-close——
  // document 级委托的 data-close 分支会把刚弹出的奇遇 modal 又关掉。
  // 虚境局（P4）：关闭后回虚境屏要看到推进后的节点图/血量，主动重渲染。
  const settleClose = () => {
    closeModal();
    maybeShowAdventure();
    if (stageId === "xujing" && typeof renderRealm === "function") { try { renderRealm(); } catch {} }
  };
  const dimEl = $("#modalHost .modal-dim");
  if (dimEl) dimEl.onclick = settleClose;
  // 战报按钮：直接用本次结算闭包里的 result/outcome，不依赖全局时序
  const repBtn = settleHost.querySelector("[data-breport]");
  if (repBtn) repBtn.onclick = () => {
    try { openBattleReport(result, outcome); }
    catch (e) { console.warn("[settle] 打开战报失败", e); }
  };
  blip(outcome.win ? 820 : 320, .12);
}

/* 同一时刻只允许一场战斗在跑。
 * 之前连打多场（尤其每场都点「跳过」）时，点出征/下一关的连点会并发发起第二场：
 * 两个 playBattle 共用全局 bvSkipHandler / #battleView，先结束的旧场次会把新场次的
 * handler 清空、把战斗层关掉——玩家看到的就是「界面在但按钮全没反应」。
 * 自动连战内部的下一场走 doBattleInner，不经过这把锁。
 * 手动模式下若上一场还在收尾（点击落在锁上），把这次请求记下来、等收尾完自动接上；
 * 不能像以前那样直接 return 把点击吞掉——玩家会以为按钮坏了。重复点同一关只记一次。 */
let bvQueuedStage = null;
async function doBattle(stageId) {
  if (bvStarting) {
    // 上一场如果已经卡了很久（请求永远不回来），不能把之后所有点击都吞掉：
    // 超过 90s 视为锁已失效，强制解锁后接这次请求。
    if (!bvAuto && bvStartAt && performance.now() - bvStartAt > 90000) {
      console.warn("[battle] 上一场出战超过 90s 未收尾，强制解锁");
      bvStarting = false;
    } else {
      // 手动模式下的重复点击：只保留最后一次请求；同一关连点不重复排队
      if (!bvAuto && bvQueuedStage !== stageId) bvQueuedStage = stageId;
      return;
    }
  }
  bvStarting = true;
  bvStartAt = performance.now();
  try {
    let sid = stageId;
    for (;;) {
      bvQueuedStage = null;
      await doBattleInner(sid);
      if (!bvQueuedStage) break;
      sid = bvQueuedStage;
      if (S.wallet.stamina < stageStamina(sid)) { toast("心神不足"); break; }
    }
  } finally {
    bvStarting = false;
    bvQueuedStage = null;
    bvStartAt = 0;
  }
}

async function doBattleInner(stageId) {
  // 每场出战前对齐自动按钮态：连战里被 stopAuto 停掉后按钮不能还亮着「自动中」
  try { syncAutoBtn(); } catch (e) { /* 按钮不在场也无所谓 */ }
  // 进战前先播剧情（每段只自动播一次，沉进存档）
  try {
    await playStoryIf(stageId, "before");
  } catch (err) {
    console.warn("[battle] 战前剧情播放失败，跳过", err);
  }
  toast("进军中……");
  // 出征用药（P3 洞府炼丹）：每场限一颗，服务端扣库存并把丹药 fx 折进我方面板
  const pillBody = battlePill ? { pill: { key: battlePill.key, q: battlePill.q } } : {};
  let j = null;
  try {
    // 战斗请求要走引擎解算（单进程单线程），超时上限必须高于引擎 30s 超时，避免前端先中断
    j = await call({ type: "battle", stageId, ...pillBody }, { timeoutMs: 60000 });
  } catch (err) {
    // 网络中断 / 引擎超时 / 网关 500：call() 的 api() 在拿不到 JSON 时会直接抛，
    // 之前这里不加兜底，玩家就永远停在「进军中……」且没有任何提示。
    console.error("[battle] 出战请求失败", err);
    // 自动连战里引擎/网络出错不能接着无脑重试（连打会把引擎彻底打挂），直接停自动
    if (bvAuto) stopAuto("出战失败：网络或战斗引擎无响应，自动战斗已停止，请稍后重试");
    else toast("出战失败：网络或战斗引擎无响应，请重试");
    return;
  }
  if (!j) {
    stopAuto("出战被拒，自动战斗已停止");
    return;        // 请求被拒（含「没有这档丹药」）不清选择，换颗药再战
  }
  // 即使 HTTP 200，只要服务端没给 result/outcome，也必须在界面上说明原因，
  // 不能进入演出（playBattle 会在解构 undefined 时抛错，玩家只看到「进军中」一闪）。
  if (!j.result || !j.outcome) {
    console.error("[battle] 战斗响应不完整", j);
    stopAuto("出战失败：战斗数据异常，自动战斗已停止");
    if (!bvAuto) toast("出战失败：战斗数据异常，请重试");
    return;
  }
  battlePill = null;     // 丹已入炉：一颗用掉了
  // 战斗结算时服务端可能掉出一条待处理奇遇（仙缘奇遇，二期 P2-2）：
  // 先存住，等结算弹窗关掉再弹出来，避免两个弹窗叠在一起。
  pendingAdv = j.adventure || null;
  /* 演出链里任何一环抛异常都不能让界面停在半路"假死"——
   * 捕获后先补画结算，让玩家看到本场结果；控制台留全量堆栈方便定位。 */
  try {
    await playBattle(stageId, j.result, j.outcome);
  } catch (err) {
    console.error("[battle] 演出中断，跳到结算", err);
    bvLive = false;
    closeBattle();
    // 兜底结算：演出异常不能让玩家「白打一场」——结果已经在服务端结算并回存，
    // 这里直接把结算面板补出来；若连结算也画不出，至少给明确提示可重试。
    try { showSettlement(stageId, j.result, j.outcome); }
    catch (e2) {
      console.error("[battle] 兜底结算也失败", e2);
      toast("战斗演出异常，本场已结算，请刷新页面查看结果");
    }
  }
  if (j.outcome && !j.outcome.error) setTimeout(() => playStoryIf(stageId, "after"), 600);
}

/* ---------------- 出征用药（二期 P3 · 洞府炼丹） ---------------- */

let battlePill = null;   // 本次出战选用的丹药 { key, q, name }
const Q_ORDER = ["ex", "hi", "mid", "lo"];
function pillTotal() {
  let n = 0;
  for (const bands of Object.values(S.pills || {})) for (const q of Q_ORDER) n += bands[q] || 0;
  return n;
}
function pillBtnLabel() {
  if (!battlePill) return "用 药";
  return `用药：${battlePill.name} · ${((DATA.manorB?.quality || {}).label || {})[battlePill.q] || battlePill.q}`;
}
/** 出征战前选药浮层：只列有库存的档位，极品 → 普通排序 */
function openPillPick() {
  const rows = [];
  for (const [key, bands] of Object.entries(S.pills || {})) {
    const r = (DATA.manorB?.recipes || []).find(x => x.key === key);
    if (!r) continue;
    for (const q of Q_ORDER) { const n = bands[q] || 0; if (n > 0) rows.push({ key, q, n, name: r.name }); }
  }
  if (!rows.length) return toast("没有可用的丹药");
  rows.sort((a, b) => Q_ORDER.indexOf(a.q) - Q_ORDER.indexOf(b.q));
  const col = (DATA.manorB?.quality || {}).color || {};
  const lab = (DATA.manorB?.quality || {}).label || {};
  modal(`<div class="menu" style="width:420px">
    <div class="panel-title" style="text-align:center">出 征 用 药</div>
    <div class="panel-sub" style="text-align:center;margin-top:4px">每场限用一颗 · 开战时自动服下</div>
    <div style="display:grid;gap:8px;margin-top:14px">
      ${rows.map(r => `<button class="btn" data-pillpick="${esc(r.key)}|${r.q}" style="justify-content:flex-start">
        <i class="df-qdot" style="background:${col[r.q] || "#9aa3b2"}"></i>${esc(r.name)} · ${esc(lab[r.q] || r.q)}
        <span class="num" style="margin-left:auto;color:var(--faint)">×${r.n}</span>
      </button>`).join("")}
      ${battlePill ? `<button class="btn ghost" data-pillclear="1">取消本次用药</button>` : ""}
    </div>
    <div style="margin-top:12px"><button class="btn" style="width:100%" data-close>关 闭</button></div>
  </div>`, { dimClose: true });
}

/* ---------------- 仙缘奇遇（二期 P2-2） ----------------
 * 战斗响应带 j.adventure（只有题面：title/text/opts）→ 存 pendingAdv，
 * 结算弹窗关闭时弹出奇遇 modal；选项回传 adventurePick 换结果页。 */

let pendingAdv = null;

function maybeShowAdventure() {
  if (!pendingAdv) return;
  const adv = pendingAdv;
  pendingAdv = null;
  showAdventure(adv);
}

/** 奇遇题面：title 横幅 + 叙述 + N 个选项（opts 兼容 {label} 与纯字符串两种形态） */
function showAdventure(adv) {
  if (!adv) return;
  modal(`<div class="menu adv-modal" style="width:520px;text-align:center">
    <div class="adv-banner">仙 缘 奇 遇</div>
    <div class="adv-title">${esc(adv.title || "奇遇")}</div>
    <div class="adv-text">${esc(adv.text || "")}</div>
    <div class="adv-opts">
      ${(adv.opts || []).map((o, i) =>
        `<button class="btn" data-advopt="${i}">${esc(typeof o === "string" ? o : (o.label ?? ""))}</button>`).join("")}
    </div>
  </div>`, { dimClose: false });
}

/** 奇遇结果页：结果文案 + 收益 + 客串台词（若有） */
function showAdventureResult(r) {
  const host = $("#modalHost .modal");
  if (!host || !r) return;
  host.innerHTML = `<div class="menu adv-modal" style="width:520px;text-align:center">
    <div class="adv-banner">奇 遇 · 缘 结</div>
    <div class="adv-text">${esc(r.text || "")}</div>
    ${r.gains ? `<div class="adv-gains">${I("sparkle", "width:13px;height:13px;vertical-align:-2px")} ${esc(r.gains)}</div>` : ""}
    ${r.guest ? `<div class="adv-guest">
      <b>${esc(r.guest.name || "路人")}</b>
      <p>${esc(r.guest.line || "")}</p>
      ${r.guest.jade ? `<span class="rtag" style="color:#7fd1c8;border-color:#7fd1c8">缘玉 +${esc(r.guest.jade)}</span>` : ""}
    </div>` : ""}
    <button class="btn primary" style="width:100%;margin-top:14px" data-advok="1">收 下</button>
  </div>`;
}

/* ---------------- 剧情播放 ---------------- */

/* 剧情场景背景：以前剧情舞台只放角色立绘（主角连立绘都没有时只剩一层径向渐变），
 * 整块是纯黑 → 玩家看到的每一句剧情都「没有背景」。现在按章节铺真实场景图：
 * 章节 → 势力场景（与出征/战斗同一套 /bg/stage_*.jpg），特殊节点可在 content/story.json
 * 用 bg 字段单独覆盖（写文件名会自动补 /bg/ 前缀，也可直接写 /bg/xxx.jpg）。 */
const STORY_SCENE_BY_CHAPTER = {
  0: "stage_all",       // 楔子：云海初见
  1: "stage_qx",        // 栖霞·蒙学
  2: "stage_yx",        // 云岫·山径
  3: "stage_gh",        // 广寒·霜径
  4: "stage_zf",        // 紫府·星案
  5: "stage_cc",        // 赤城·剑炉
  6: "stage_yh",        // 瀛海·珠阙
  7: "evbg-yaochao_v1", // 万象·妖潮
  8: "stage_all",       // 归墟·无名之地
};
function storySceneBg(node) {
  const custom = node && (node.bg || node.scene);
  if (custom) {
    if (/^(https?:)?\/\//.test(custom) || custom.startsWith("/")) return custom;
    return `/bg/${/\.(jpg|jpeg|png|webp)$/i.test(custom) ? custom : custom + ".jpg"}`;
  }
  const chap = node && Number.isFinite(+node.chapter) ? +node.chapter : 0;
  let name = STORY_SCENE_BY_CHAPTER[chap];
  if (!name) {
    const ch = (DATA.chapters || [])[chap - 1];
    const f = ch && ch.faction;
    name = { qx: "stage_qx", yx: "stage_yx", gh: "stage_gh", zf: "stage_zf", cc: "stage_cc", yh: "stage_yh" }[f] || "stage_all";
  }
  return `/bg/${/\.(jpg|jpeg|png|webp)$/i.test(name) ? name : name + ".jpg"}`;
}

function storyWho(who) {
  if (who === "narrator") return { name: "", side: "narr" };
  /* 主角「拾缘人」不在名册里（data/characters/me 是独立档案），必须显式带上 art，
   * 否则 playStory 的 `w.art && !isNarr` 判空 → 整块舞台空白，看起来就是「人物画像没显示全」。
   * 主角没有「带场景的 portrait」，所以不设 bg；场景背景统一由 storySceneBg(node) 按章节铺。 */
  if (who === "me") return { name: "拾缘人", side: "me", id: "me", art: art("me", "standee") };
  const c = charById(who);
  if (c) return { name: c.name, side: "char", id: who, art: art(who, "portrait"), bg: art(who, "portrait") };
  const mob = (DATA.mobs && DATA.mobs[who]) || null;
  const mobName = typeof mob === "string" ? mob : (mob && mob.name);
  if (mobName) return { name: mobName, side: "foe", id: who, art: art(who, "portrait"), bg: art(who, "portrait") };
  return { name: who, side: "char" };
}

function storyNodesFor(stageId, when) {
  const ch = DATA.chapters[curChap];
  if (!ch) return null;
  const node = ch.nodes.find(n => n.id === stageId);
  if (!node) return null;
  const chap = ch.chapter ?? (curChap + 1);
  return (DATA.story || []).find(n => n.chapter === chap && n.stage === node.index && n.when === when) || null;
}

function storySeen() { S.storySeen = S.storySeen || {}; return S.storySeen; }
/* 手动回看：忽略已播标记 */
function replayStory(stageId, when) {
  const node = storyNodesFor(stageId, when || "before");
  if (!node) { toast("本关暂无剧情"); return; }
  playStory(node);
}

async function playStoryIf(stageId, when) {
  const node = storyNodesFor(stageId, when);
  if (!node) return;
  const seen = storySeen();
  if (seen[node.id]) return;
  await playStory(node);
  seen[node.id] = 1;
  try { call({ type: "storySeen", id: node.id }).catch(() => {}); } catch (e) {}
}

function playStory(node) {
  return new Promise((resolve) => {
    const lines = node.lines || [];
    /* 空剧情直接收尾：以前会建出一个只有标题的空弹窗，玩家关掉后 Promise 靠 finish
     * 才能结束；若被别的 closeModal 抢先清掉，调用方就永远卡住（出战锁不释放）。
     * 这里提前返回，既不给空弹窗，也杜绝这条卡死路径。 */
    if (!lines.length) { resolve(); return; }
    let i = 0;
    /* 自动连战时剧情不能等玩家点「继续」——之前战前剧情弹窗会一直挂着，
     * 自动连战链就断在这里（玩家看到的就是「自动遇到剧情就打不下去」）。
     * 自动模式：每句停留 ~1.4s 自动翻页，播完自动关；玩家手动点继续/跳过则立即生效。
     * 中途关掉自动（bvAuto=false）时停止自动翻页，把控制权交回玩家。 */
    const autoTimer = { id: null };
    const autoOn = () => typeof bvAuto !== "undefined" && !!bvAuto;
    const clearAuto = () => { if (autoTimer.id) { clearTimeout(autoTimer.id); autoTimer.id = null; } };
    const scheduleAuto = (cvEl) => {
      clearAuto();
      if (!autoOn() || !lines.length) return;
      // 有配音的句子按文本长度给足播放时间，避免自动连播在台词念到一半就翻页；
      // 配音真正播完会通过 ended 事件提前翻页（见下方监听），这里只是兜底时长。
      const textLen = (lines[i]?.text || "").length;
      const wait = cvEl ? Math.max(2200, Math.min(15000, textLen * 190)) : 1400;
      autoTimer.id = setTimeout(() => {
        if (!autoOn()) { autoTimer.id = null; return; }   // 已关自动：停在当前句等玩家
        next(true);
      }, wait);
      if (cvEl) {
        const at = i;
        const onEnd = () => {
          if (!autoOn() || i !== at) return;   // 玩家已手动翻页/关了自动，别抢
          clearAuto();
          next(true);
        };
        try { cvEl.addEventListener("ended", onEnd, { once: true }); } catch (e) {}
      }
    };
    const host = modal(`
      <div class="storybox">
        <div class="story-hd">
          <span class="story-title">${esc(node.title || "剧情")}</span>
          <button class="btn sm ghost" data-storyskip="1">跳 过</button>
        </div>
        <div class="story-stage" id="storyStage"></div>
        <div class="story-line" id="storyLine"></div>
        <div class="story-ft">
          <span class="story-pg num" id="storyPg"></span>
          <button class="btn sm primary" data-storynext="1">继续 ▸</button>
        </div>
      </div>`, { dimClose: false });

    /* 兜底：这个剧情弹窗可能被别处 closeModal()（Esc、data-close、别的弹窗覆盖）直接关掉，
     * 那样 finish() 永远不会跑，playStory 的 Promise 永不 resolve —— 调用方 doBattleInner
     * 就永远卡在 await 上，bvStarting 锁死，之后所有「出征」点击都被静默吞掉，
     * 玩家看到的就是「界面还在，但点什么都没反应」。监听 modalHost，节点被摘掉就收尾。 */
    let settled = false;
    const finishOnce = () => {
      if (settled) return;
      settled = true;
      clearAuto();
      try { AudioSys.stopCv(); } catch (e) {}
      closeModal();
      resolve();
    };
    const mo = new MutationObserver(() => {
      if (!host.isConnected) {
        mo.disconnect();
        if (!settled) { settled = true; clearAuto(); try { AudioSys.stopCv(); } catch (e) {} resolve(); }
      }
    });
    try { mo.observe($("#modalHost"), { childList: true }); } catch (e) { /* 无 MutationObserver 也不影响主流程 */ }

    const stage = host.querySelector("#storyStage");
    const lineEl = host.querySelector("#storyLine");
    const pg = host.querySelector("#storyPg");

    const render = () => {
      const l = lines[i];
      if (!l) return;
      const w = storyWho(l.who);
      const isFoe = w.side === "foe", isMe = w.side === "me", isNarr = w.side === "narr";
      /* 竖版人物像在宽横幅舞台里如果整张 contain，会把带背景的插画缩成中间一小块，
       * 看着就是「画像没显示全/人物太小」。这里用同图模糊铺满整屏做背景，
       * 前景改用透明底全身立绘 standee（缺图自动降级 portrait→card），人物占满舞台高度且从头到脚完整。 */
      const standee = w.id ? art(w.id, "standee") : "";
      const scene = storySceneBg(node);
      /* 场景图打底（所有句子都有，包括旁白），立绘叠在上面。
       * 角色自带的 portrait 模糊铺底只在没有场景图时兜底，避免两张背景互相糊成灰泥。 */
      stage.innerHTML = `${scene ? `<img class="story-scene" src="${scene}" alt="" aria-hidden="true" data-fb="rm">` : ""}
        ${(w.art && !isNarr)
          ? `${!scene && w.bg ? `<img class="story-art-bg" src="${w.bg}" alt="" aria-hidden="true" data-fb="rm">` : ""}
             <img class="story-art ${isMe ? "is-me" : ""} ${isFoe ? "is-foe" : ""}" src="${standee || w.art}" alt="" data-fb="${standee ? "portrait,card" : "card"}">`
          : ""}`;
      stage.className = "story-stage " + (isNarr ? "narr" : isMe ? "me" : isFoe ? "foe" : "char");
      lineEl.innerHTML = `
        ${w.name ? `<div class="story-who ${isFoe ? "foe" : ""}">${esc(w.name)}</div>` : ""}
        <div class="story-text ${isNarr ? "narr" : ""}">${esc(l.text)}</div>`;
      pg.textContent = `${i + 1} / ${lines.length}`;
      /* 剧情语音：真正播放要调 AudioSys（全局音频系统），不是浏览器原生 Audio 构造器。
       * 以前写的是 Audio.cv(...)，Audio 是 window.Audio 构造函数、没有 cv 方法，
       * 异常被 catch 静默吞掉 → 95 条主角剧情配音一条都播不出来。
       * 只播放真实存在的配音文件（serve 启动时扫 web/audio/cv/<id>/story-* 下发 storyVoice），
       * 没有配音的句子安静退回纯文本，不逐句 404。 */
      let cvEl = null;
      try {
        const voiceFile = w.id ? ((DATA.storyVoice || {})[w.id] || []).find(f => f.replace(/^story-/, "").replace(/\.(wav|mp3)$/i, "") === node.id + "-" + i) : "";
        if (voiceFile) cvEl = AudioSys.cv(w.id, voiceFile);
        else AudioSys.stopCv();
      } catch (e) {}
      lineEl.classList.remove("in");
      void lineEl.offsetWidth;
      lineEl.classList.add("in");
      scheduleAuto(cvEl);
    };
    const finish = () => finishOnce();
    const next = (fromAuto) => {
      clearAuto();
      // 自动轮到一半被玩家手动接管：仍按手动逻辑走
      i++;
      if (i >= lines.length) { finish(); return; }
      render();
      if (!fromAuto && typeof blip === "function") blip(520, .04);
    };

    host.querySelector("[data-storynext]").onclick = () => next(false);
    host.querySelector("[data-storyskip]").onclick = finish;
    render();
  });
}
let sweepBusy = false;   // 扫荡在途锁：防止同一帧内重复触发（双击 / 回车 / 空格）
async function doSweep(stageId, times) {
  if (sweepBusy) return;
  sweepBusy = true;
  try {
  const j = await call({ type: "sweep", stageId, times });
  if (!j) return;
  const s = j.sweep;
  const matLine = Object.entries(s.rewards?.items || {}).map(([k, v]) => `${matLabel(k)} ×${v}`).join("　");
  const noteLines = Array.isArray(s.rewards?.notes) ? s.rewards.notes.filter(Boolean) : [];
  const host = modal(`<div class="menu" style="text-align:center;width:420px">
    <div style="font-family:var(--font-display);font-size:28px;letter-spacing:.3em;color:var(--gold-hi);margin:8px 0 2px">扫 荡 完 成</div>
    ${starIcons(s.stars || 0, 3)}
    <div style="display:grid;gap:7px;text-align:left;margin:16px 0">
      ${s.log.map(l => `<span class="tag gold" style="justify-content:flex-start">${I("sparkle", "width:13px;height:13px")} ${esc(l)}</span>`).join("")}
      ${s.rewards?.coin ? `<span class="tag gold" style="justify-content:flex-start">${I("coin", "width:13px;height:13px")} 铜钱 +${fmt(s.rewards.coin)}</span>` : ""}
      ${matLine ? `<span class="tag dim" style="justify-content:flex-start">${I("page", "width:13px;height:13px")} ${esc(matLine)}</span>` : ""}
      ${noteLines.map(n => `<span class="tag dim" style="justify-content:flex-start">${I("gem", "width:13px;height:13px")} ${esc(n)}</span>`).join("")}
    </div>
    <button class="btn primary" data-sweepclose>确 定</button></div>`);
  // 扫荡可能发生在任何屏（出征/登仙塔/结算弹窗里），确定后回原地而不是硬跳出征
  host.querySelector("[data-sweepclose]").onclick = () => { closeModal(); refreshAfterBattle(); };
  blip(760, .1);
  } finally { sweepBusy = false; }
}

/* ---------------- 事件总线 ---------------- */

// CSP 禁止内联事件属性（onclick/onerror 字符串全部被浏览器丢弃），
// 动态 HTML 里一律挂 data-*，由这里的捕获/委托统一处理：
//   <img data-fb="portrait|avatar">  立绘 404 时换同角色后备景别
//   <img data-fb="rm">                加载失败直接移除（露底色/字标）
//   [data-close]                      关弹窗（结算「确定」等）
//   [data-goto="屏键"]                 关弹窗并跳屏
document.addEventListener("error", e => {
  const t = e.target;
  if (!(t instanceof HTMLImageElement) || !t.dataset.fb) return;
  /* data-fb 是「这张图失败后依次换哪些景别」的降级链（逗号分隔，如 "portrait,standee,card"）：
     某景别缺图/加载失败时换下一张，链走完仍失败才移除。
     以前一失败就 data-fb="rm" 直接删图——美术只补了部分景别的怪会留一块纯黑。 */
  const chain = t.dataset.fb.split(",").map(s => s.trim()).filter(Boolean);
  const id = (t.src.match(/characters\/([^/]+)\/art\//) || [])[1];
  if (!id) { t.dataset.fb = ""; t.remove(); return; }
  let next = chain.shift();
  // 跳过与当前地址相同的景别，避免同一张破图反复重试把降级状态卡死
  while (next && next !== "rm" && t.src.includes(art(id, next))) next = chain.shift();
  t.dataset.fb = chain.join(",");
  if (!next || next === "rm") { t.dataset.fb = ""; t.remove(); return; }
  t.src = art(id, next);
}, true);

document.addEventListener("click", async e => {
  const t = e.target;
  const closer = t.closest("[data-close]");
  if (closer) return closeModal();
  // 结算弹窗「确定」：关闭后接住战斗掉出的待处理奇遇（二期 P2-2）
  const sok = t.closest("[data-settleok]");
  if (sok) { closeModal(); return maybeShowAdventure(); }
  const jump = t.closest("[data-goto]");
  if (jump) { closeModal(); return go(jump.dataset.goto); }
  // 子页返回条（图鉴 / 羁绊 → 名册）
  const back = t.closest("[data-back]");
  if (back) { blip(600, .05); return go(back.dataset.back); }
  const tab = t.closest("[data-tab]");
  if (tab) { blip(600, .05); return go(tab.dataset.tab); }
  // 名册界面内的功能页签（养成 / 编队）
  const rtab = t.closest("[data-rtab]");
  if (rtab) { blip(640, .05); rosterTab = rtab.dataset.rtab; return renderRoster(); }
  // 名册右栏 · 人物档案卡页签：只重渲染内容区与页签高亮，不整屏重绘（保滚动位置）
  const rdtab = t.closest("[data-rdtab]");
  if (rdtab) {
    blip(660, .04);
    rosterDTab = rdtab.dataset.rdtab;
    const card = $("#scr-roster .rl-detail");
    if (card) {
      card.querySelectorAll(".rd-tab").forEach(b => b.classList.toggle("on", b.dataset.rdtab === rosterDTab));
      const body = card.querySelector(".rd-body");
      if (body) {
        body.innerHTML = rosterDetailBody(rosterSel);
        body.scrollTop = 0;
        if (rosterDTab === "equip") refreshLoadout(rosterSel);
      }
    }
    return;
  }
  // 编队空位「＋」→ 切回养成页签去挑人
  const rjump = t.closest("[data-rtab-jump]");
  if (rjump) { blip(640, .05); rosterTab = rjump.dataset.rtabJump; return renderRoster(); }
  // 上阵 / 下阵优先于一切「选中角色」分支：
  // 名册的卡片格与顶栏编队格都可点（data-rfocus），按钮就嵌在这些格子里，
  // 顺序错了会变成"点上下阵只是换了个选中，队伍根本没动"。
  const ut = t.closest("[data-uteam]");
  if (ut) return toggleTeam(ut.dataset.uteam);
  const tt = t.closest("[data-tteam]");
  if (tt) return toggleTeam(tt.dataset.tteam);
  // 名册内的「选中角色」跳转：顶栏头像、角色卡都可点，右侧详情就地换人。
  // 放在 data-open 之前命中，避免卡片的 data-grow/data-open 抢先弹窗。
  const rfocus = t.closest("[data-rfocus]");
  if (rfocus) {
    blip(660, .05);
    rosterSel = rfocus.dataset.rfocus;
    renderRoster();
    // 详情在右栏，宽屏下不用滚；窄屏（单列堆叠）时把详情顶到可视区
    const dt = $("#scr-roster .rl-detail");
    if (dt && dt.getBoundingClientRect().top > innerHeight * .5) dt.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  const open = t.closest("[data-open]");
  if (open) return showCard(open.dataset.open);
  // 名册卡片：直接开养成弹窗（把养成从右侧固定栏解放出来）
  const growEl = t.closest("[data-grow]");
  if (growEl) return openGrow(growEl.dataset.grow);
  const goEl = t.closest("[data-go]");
  // 卡片详情「去养成」等按钮是渲染在弹窗里的：不先关弹窗，go() 换了屏也看不见，
  // 表现就是"点了没反应"（弹窗还盖在上面）。
  if (goEl) {
    // 「去养成」顺手把这个人选上：不然跳到名册还得自己再找一遍是谁
    if (goEl.dataset.gosel) { rosterSel = goEl.dataset.gosel; rosterGrade = "all"; rosterElem = "all"; }
    closeModal();
    return go(goEl.dataset.go);
  }
  // 立绘切换必须先于「点击立绘互动」：‹ › 按钮在 .hero-stage 内部，
  // 顺序错了点击会被下面的 CV 分支 return 吞掉，表现为切换失灵。
  const heroBtn = t.closest("[data-hero]");
  if (heroBtn) { heroIdx = (heroIdx + +heroBtn.dataset.hero + heroPool().length) % heroPool().length; return renderHome(); }
  const stageClick = t.closest(".hero-stage");
  if (stageClick && !t.closest("button")) {
    const hero = heroPool()[heroIdx % heroPool().length];
    if (hero && S.owned[hero]) {
      AudioSys.cv(hero, "enter");
      const c = charById(hero);
      const line = c && (c.vlines?.enter || "");
      toast(line ? `${c.name}：「${line}」` : `${c?.name ?? ""} 看向你`);
    }
    return;
  }
  const poolview = t.closest("[data-poolview]");
  if (poolview) return showPoolView(poolview.dataset.poolview);
  const banner = t.closest("[data-banner]");
  if (banner) { curBanner = banner.dataset.banner; return renderGacha(); }
  const pull = t.closest("[data-pull]");
  if (pull) return doPull(+pull.dataset.pull);
  // 名册筛选：阶位 / 六气各一维，可叠加。写回 localStorage，切屏回来还保持。
  // 任何筛选变化都把页码拨回第 1 页 —— 否则筛完只剩 5 个人却停在「第 4 / 1 页」。
  const rg = t.closest("[data-rg]");
  if (rg) { rosterGrade = rg.dataset.rg; rosterPage = 0; rfSave("rfGrade", rosterGrade); blip(620, .04); return renderRoster(); }
  const re = t.closest("[data-re]");
  if (re) { rosterElem = re.dataset.re; rosterPage = 0; rfSave("rfElem", rosterElem); blip(620, .04); return renderRoster(); }
  const rp = t.closest("[data-rp]");
  if (rp) { rosterPos = rp.dataset.rp; rosterPage = 0; rfSave("rfPos", rosterPos); blip(620, .04); return renderRoster(); }
  // 名册排序：智能 → 战力 → 等级 → 星级 → 稀有度 循环
  const rsort = t.closest("[data-rsort]");
  if (rsort) {
    const modes = ["smart", "power", "level", "star", "rarity"];
    rosterSort = modes[(modes.indexOf(rosterSort) + 1) % modes.length];
    rosterPage = 0; rfSave("rfSort", rosterSort); blip(620, .04); return renderRoster();
  }
  const rf = t.closest("[data-rf]");
  if (rf) { rosterFilter = rf.dataset.rf; rosterGrade = rf.dataset.rf; rosterPage = 0; return renderRoster(); }
  // 名册 / 图鉴 / 万妖谱分页
  const rsp = t.closest("[data-rsp]");
  if (rsp) { rosterPage += +rsp.dataset.rsp; blip(600, .04); renderRoster(); const m = $("#scr-roster .rl-main"); if (m) m.scrollTop = 0; return; }
  const rspage = t.closest("[data-rspage]");
  if (rspage) { rosterPage = +rspage.dataset.rspage; renderRoster(); const m = $("#scr-roster .rl-main"); if (m) m.scrollTop = 0; return; }
  const cxp = t.closest("[data-cxp]");
  if (cxp) { codexPage += +cxp.dataset.cxp; blip(600, .04); renderCodex(); return; }
  const cxpage = t.closest("[data-cxpage]");
  if (cxpage) { codexPage = +cxpage.dataset.cxpage; renderCodex(); return; }
  const cx = t.closest("[data-cx]");
  if (cx) {
    if (cx.dataset.cx === "r") cxR = cx.dataset.v;
    if (cx.dataset.cx === "f") cxF = cx.dataset.v;
    if (cx.dataset.cx === "e") cxE = cx.dataset.v;
    if (cx.dataset.cx === "p") cxP = cx.dataset.v;
    codexPage = 0;
    return renderCodex();
  }
  const out = t.closest("[data-out]");
  if (out) { const id = S.team[+out.dataset.out]; if (id) { S.team.splice(+out.dataset.out, 1); return call({ type: "team", ids: S.team }).then(() => renderTeam()); } }
  const node = t.closest("[data-node]");
  if (node) {
    const nid = node.dataset.node;
    // 锁定关卡只提示、不切换（服务端也会拒，这里先挡住误操作）
    if (node.classList.contains("lock")) { toast("需先通关前置关卡"); return; }
    curNode = nid; return renderStages();
  }
  const chap = t.closest("[data-chap]");
  if (chap) {
    const i = +chap.dataset.chap;
    const okCh = i === 0 || DATA.chapters[i - 1].nodes.every(n => S.cleared[n.id]);
    if (!okCh) { toast("通关上一章全部关卡后解锁"); return; }
    // 玩家显式点章节：只切到这一章，不再被「全通后自动跳最新章」的定位劫持（否则永远回不到上一章）
    curChap = i; curNode = null; stagePage = 0; stageAutoPick = false; return renderStages();
  }
  // 关卡列表分页：翻页同时把选中关卡移到该页可打的关（否则右侧「出战」还停在上一页的关）
  const spStep = t.closest("[data-spp]");
  if (spStep) return stageGoPage(stagePage + (+spStep.dataset.spp));
  const spPage = t.closest("[data-sppage]");
  if (spPage) return stageGoPage(+spPage.dataset.sppage);
  const sv = t.closest("[data-storyview]");
  if (sv) return replayStory(sv.dataset.storyview, "before");
  const bondf = t.closest("[data-bondf]");
  if (bondf) { bondFilter = bondf.dataset.bondf; return renderBonds(); }
  const bondteam = t.closest("[data-bondteam]");
  if (bondteam) { e.stopPropagation(); return bondAutoTeam(bondteam.dataset.bondteam); }
  // 羁绊详情：羁绊页卡片与角色详情的羁绊标签共用（卡片内的「一键上阵」先命中上行）
  const bond = t.closest("[data-bond]");
  if (bond) { blip(660, .05); return openBondDetail(bond.dataset.bond); }
  // 登仙塔层行：点击=选中该层（右侧出详情与挑战按钮），不直接开打
  const tfloor = t.closest("[data-tower]");
  if (tfloor) { towerSel = tfloor.dataset.tower; blip(600, .04); return renderTower(); }
  const battle = t.closest("[data-battle]");
  if (battle) { closeModal(); return doBattle(battle.dataset.battle); }
  const sweep = t.closest("[data-sweep]");
  if (sweep && !sweep.disabled) return doSweep(sweep.dataset.sweep, +sweep.dataset.times || 1);
  const buyEl = t.closest("[data-buy]");
  if (buyEl) return doBuy(buyEl.dataset.buy, buyEl.dataset.fateof);
  const gift = t.closest("[data-fategift],[data-gift]");
  if (gift) return doGift(gift.dataset.fategift || gift.dataset.gift);
  const shoptab = t.closest("[data-shoptab]");
  if (shoptab) { shopTab = shoptab.dataset.shoptab; return renderShopTab(); }
  // 缘器背包 / 图鉴
  /* 养成弹窗可以独立打开，rosterSel 未必等于当前弹窗里的角色。
   * 缘器操作一律以 #loadoutBox 记录的目标为准，避免"看着 A 却改到 B"。
   * growId 必须声明在这批 data-eq* 分支之前——曾有 const 声明落在
   * data-eqbag 分支之后，点击即 TDZ ReferenceError，按钮"点了没反应"。 */
  const growId = () => $("#loadoutBox")?.dataset.for || rosterSel;
  const eqbag = t.closest("[data-eqbag]");
  if (eqbag) return openEquipBag(growId(), "all");
  const eqbagf = t.closest("[data-eqbagfilter]");
  if (eqbagf) {
    // 背包弹窗内切部位：按弹窗记录的角色重开，只换筛选（modal 整体替换）
    const menu = eqbagf.closest("#eqBagMenu");
    const cid = menu?.dataset.eqbagcur || growId();
    return openEquipBag(cid, eqbagf.dataset.eqbagfilter);
  }
  const eqcdx = t.closest("[data-eqcodex]");
  if (eqcdx) return openEquipCodex("normal");
  const cdxtab = t.closest("[data-cdxtab]");
  if (cdxtab) return openEquipCodex(cdxtab.dataset.cdxtab);
  // 背包里点「装备」
  const eqwear = t.closest("[data-eqwear]");
  if (eqwear && !eqwear.disabled) {
    const uid = eqwear.dataset.eqwear, cid = eqwear.dataset.eqchar;
    const j = await call({ type: "equipWear", id: cid, uid });
    if (j) {
      toast(j.wear && j.wear.error ? j.wear.error : "已装备");
      // 底下那层养成面板（名册详情 / 养成弹窗）的缘器槽位也要跟着刷新，
      // 不然关掉背包回来看还是穿之前的旧状态
      const gid = $("#loadoutBox")?.dataset.for;
      if (gid) refreshLoadout(gid);
      closeModal();
      openEquipBag(cid);          // 回到背包，状态已刷新
    }
    return;
  }
  const act = t.closest("[data-act]");
  if (act) {
    const a = act.dataset.act;
    if (a === "stamina") return openStaminaBuy();
    if (a === "login") return call({ type: "login" }).then(j => { if (j) { toast("签到奖励已领取"); renderResBar(); go(cur); } });
    if (a === "suggest") return call({ type: "suggest" }).then(j => { if (j) { toast("已按练度推荐编队"); renderTeam(); } });
  }
  const feed = t.closest("[data-feed]");
  if (feed) return doFeed(feed.dataset.feed);
  const starup = t.closest("[data-starup]");
  if (starup) return doStar(starup.dataset.starup);
  const brk = t.closest("[data-break]");
  if (brk) return doBreak(brk.dataset.break);
  // 归一：先弹确认框列出返还明细，确认后才真正执行（不可撤销，不能一键直落）
  const nrm = t.closest("[data-normalize]");
  if (nrm && !nrm.disabled) { openNormalizeConfirm(nrm.dataset.normalize); return; }
  const nrmcfm = t.closest("[data-normalizecfm]");
  if (nrmcfm && !nrmcfm.disabled) return doNormalize(nrmcfm.dataset.normalizecfm);
  const skill = t.closest("[data-skill]");
  // 用按钮自带的 data-for，而不是 rosterSel：养成弹窗可独立打开，两者未必同步，
  // 用 rosterSel 会升级到"上次选中的角色"身上。
  // 技能升级先开对比作用框（当前/升级后数值并排），确认后才真正扣材料。
  if (skill) return openSkillCompare(skill.dataset.for || rosterSel, skill.dataset.skill);
  const skcfm = t.closest("[data-skcfm]");
  if (skcfm && !skcfm.disabled) {
    const [cid, cslot] = String(skcfm.dataset.skcfm || "").split("|");
    if (cid && cslot) return doSkill(cid, cslot);
  }
  const ach = t.closest("[data-ach]");
  if (ach) return call({ type: "claimAch", id: ach.dataset.ach }).then(j => {
    const r = j && j.ach;
    if (r && !r.error) { toast(`成就达成 · ${r.label} · 铜钱 +${fmt(r.coin)} · 缘玉 +${r.jade}`); renderAchv(); renderResBar(); }
  });
  // 成就一键领取：服务端逐个校验发放，返回合计
  const achall = t.closest("[data-achall]");
  if (achall) return call({ type: "claimAchAll" }).then(j => {
    const r = j && j.achAll;
    if (r && r.claimed > 0) {
      toast(`一键领取 ${r.claimed} 项成就 · 铜钱 +${fmt(r.coin)} · 缘玉 +${fmt(r.jade)}`);
      blip(820, .1); renderAchv(); renderResBar();
    }
  });
  // 成就分组页签 / 组内翻页
  const achvg = t.closest("[data-achvg]");
  if (achvg) { achvGroup = achvg.dataset.achvg; achvPage = 0; blip(620, .05); return renderAchv(); }
  const achvp = t.closest("[data-achvp]");
  if (achvp) { achvPage = Math.max(0, achvPage + +achvp.dataset.achvp); return renderAchv(); }

  const uneq = t.closest("[data-uneq]");
  if (uneq) {
    // 卸下按钮在槽位内部，必须先于 data-eqid 命中并 return，否则会冒泡成"强化"
    const gid = growId();
    return call({ type: "equipOff", id: gid, kind: uneq.dataset.uneq })
      .then(j => { if (j) { toast("已卸下"); refreshLoadout(gid); } });
  }
  // 空槽位：直接打缘器背包选件穿上，并只筛选该部位（背包为空时里面自会提示去开匣）
  const eqempty = t.closest("[data-eqempty]");
  if (eqempty) return openEquipBag(growId(), eqempty.dataset.eqempty);
  // 已穿戴缘器：整格点击＝先弹强化确认（花多少看清楚再确认），不直接扣钱
  const eqid = t.closest("[data-eqid]");
  if (eqid) { confirmEquipUp(growId(), eqid.dataset.eqid); return; }
  const exfate = t.closest("[data-exfatebt]");
  if (exfate) {
    if (exfate.disabled) return;
    // 弹窗可能为任意角色打开，不能用 growId()（它读名册当前选中/loadoutBox，会改到别人身上）
    const [fuid, fgid] = String(exfate.dataset.exfatebt || "").split("|");
    const j = await call({ type: "equipFateBt", uid: fuid });
    if (j) {
      const r = j.equipFateBt;
      toast(r?.error || `本命缘器突破至 ${r.fate} 缘 · 等级上限 Lv.${r.levelCap}`);
      if (!r?.error) { blip(880, .14); closeModal(); }
      renderResBar(); refreshLoadout(fgid || growId());
      if (!r?.error) confirmEquipUp(fgid || growId(), null);
    }
    return;
  }
  // 升缘缺券时的快捷入口：关掉弹窗直接去缘器阁（本命签就在那一屏）
  const goforge = t.closest("[data-goforge]");
  if (goforge) { closeModal(); return go("eforge"); }
  const exup = t.closest("[data-exup]");
  if (exup) { confirmEquipUp(growId(), null); return; }
  const equpcfm = t.closest("[data-equpcfm]");
  if (equpcfm) {
    const [uid2, gid] = equpcfm.dataset.equpcfm.split("|");
    const j = await call({ type: "equipUp", uid: uid2 });
    if (j) {
      const r = j.equipUp;
      toast(r?.error || `缘器强化至 ${r.level} 级`);
      if (!r?.error) blip(720, .07);
      renderResBar(); closeModal(); refreshLoadout(gid);
    }
    return;
  }
  const forge = t.closest("[data-forge]");
  if (forge) return call({ type: "equipForge", id: growId() }).then(j => {
    if (j) {
      toast(j.forge.error ? j.forge.error : `本命缘器已铸成！（消耗铸魂券 ×3 · 铜钱照常结算）`);
      blip(820, .12); refreshLoadout(growId()); renderResBar();
    }
  });
  // —— 缘器阁开匣（复用抽卡翻牌演出）——
  const epull = t.closest("[data-epull]");
  if (epull) {
    const [k, nStr] = epull.dataset.epull.split(":");
    const j = await call({ type: "equipChest", count: +nStr || 1, gold: k === "gold" });
    if (j && j.equipChest) { renderResBar(); showEquipReveal(j.equipChest.items); }
    return;
  }
  // —— 缘器阁 · 本命签（铸魂券池）——
  const eqtkpick = t.closest("[data-eqtkpick]");
  if (eqtkpick) {
    // 头像网格选人：按品阶降序（UR→N），同阶按星级（与名册同款排序）
    const cands = Object.keys(S.owned || {}).sort((a, b) =>
      RAR_ORDER.indexOf(charById(a)?.rarity) - RAR_ORDER.indexOf(charById(b)?.rarity)
      || (S.owned[b]?.star || 0) - (S.owned[a]?.star || 0));
    return modal(`<div class="menu" style="width:640px">
      <div class="panel-title" style="text-align:center">本 命 签 · 为 谁 攒 券</div>
      <div class="panel-sub" style="text-align:center;margin-top:6px">抽签进度记在所选角色名下；角色未到突破 2 阶也可以先攒券</div>
      <div class="cgrid" style="grid-template-columns:repeat(6,1fr);gap:10px;margin-top:14px;max-height:52vh;overflow:auto">
        ${cands.map((id) => {
          const c = charById(id) || {};
          const rc = RCOLOR(c.rarity);
          return `<div data-eqtkset="${id}" style="cursor:pointer;text-align:center">
            <div class="avatar" style="width:100%;aspect-ratio:1;height:auto;border-color:${rc}">${artImg(id)}</div>
            <div style="font-size:12px;margin-top:5px;color:${rc}">${esc(c.name || id)}</div></div>`;
        }).join("") || `<div class="panel-sub">还没有角色</div>`}
      </div>
      <div style="margin-top:14px"><button class="btn" style="width:100%" data-close>取 消</button></div>
    </div>`, { dimClose: true });
  }
  const eqtkset = t.closest("[data-eqtkset]");
  if (eqtkset) { eqTicketTarget = eqtkset.dataset.eqtkset; closeModal(); return renderEforge(); }
  const eqticket = t.closest("[data-eqticket]");
  if (eqticket) {
    if (!eqTicketTarget) return toast("先选择目标角色");
    const j = await call({ type: "eqTicketPull", id: eqTicketTarget, count: +eqticket.dataset.eqticket || 1 });
    if (j && j.eqTicketPull) {
      const r = j.eqTicketPull;
      renderResBar(); renderEforge();
      const tgt = (charById(eqTicketTarget) || {}).name || eqTicketTarget;
      const tkPulls = DATA.equip?.tickets?.pulls || 3;
      if (r.gained?.tickets) {
        const cards = Array.from({ length: r.gained.tickets }, () => ({
          kind: "ticket", rarity: "gold", name: `本命铸魂券 · ${tgt}`
        }));
        if (r.gained.soul) cards.push({ kind: "soul", rarity: "purple", soul: r.gained.soul, overflow: !!r.gained.tickets });
        showEquipReveal(cards);
      } else if (r.gained?.soul) {
        showEquipReveal([{ kind: "soul", rarity: "purple", soul: r.gained.soul }]);
      } else {
        // 未得券：翻出「签」卡明示进度与还差几抽，而不是一条一闪而过的 toast
        showEquipReveal([{ kind: "miss", rarity: "blue", tgt, progress: r.progress, pulls: tkPulls }]);
      }
    }
    return;
  }
  // —— 行囊 · 缘器页签 ——
  const bagtab = t.closest("[data-bagtab]");
  if (bagtab) { bagTab = bagtab.dataset.bagtab; return renderBag(); }
  const eqfilter = t.closest("[data-eqfilter]");
  if (eqfilter) { bagEquipFilter = eqfilter.dataset.eqfilter; bagEquipPage = 1; return fillBagEquip(); }
  const eqpage = t.closest("[data-eqpage]");
  if (eqpage) { bagEquipPage += eqpage.dataset.eqpage === "next" ? 1 : -1; return fillBagEquip(); }
  const eqclear = t.closest("[data-eqclear]");
  if (eqclear) { bagEquipQuery = ""; bagEquipPage = 1; return fillBagEquip(); }
  const eqsal = t.closest("[data-eqsal]");
  if (eqsal) {
    const j = await call({ type: "equipSalvage", uids: [eqsal.dataset.eqsal] });
    if (j) { toast(`分解得器魂 ×${j.equipSalvage.soul}`); blip(600, .06); renderResBar(); fillBagEquip(); }
    return;
  }
  const eqsalb = t.closest("[data-eqsalbatch]");
  if (eqsalb) {
    const j = await api({ type: "bag" }).catch(() => null);
    const cands = (j?.bag || []).filter(it => !it.exclusive && !it.equippedBy && (it.rarity === "green" || it.rarity === "blue" || it.rarity === "purple"));
    if (!cands.length) { salBatchArm = false; fillBagEquip(); return toast("没有可分解的未穿戴绿/蓝/紫缘器"); }
    // 二次确认：第一点只变红报数，再点才真分解；6 秒不动自动退回
    const btn = $("#eqSalBatchBtn");
    if (!salBatchArm) {
      salBatchArm = true;
      const soul = cands.reduce((a, it) => a + (it.salvage || 0), 0);
      if (btn) {
        btn.classList.remove("ghost");
        btn.style.cssText = "background:#4a1418;border-color:#e05656;color:#ff9c9c";
        btn.innerHTML = `${I("gem", "width:13px;height:13px;vertical-align:-2px")} 确认分解 ${cands.length} 件 · 得器魂 ×${soul} · 再点一次执行（不可撤销）`;
      }
      setTimeout(() => { if (salBatchArm) fillBagEquip(); }, 6000);
      return;
    }
    salBatchArm = false;
    const r = await call({ type: "equipSalvage", uids: cands.map(it => it.uid) });
    if (r) { toast(`分解 ${r.equipSalvage.salvaged} 件 · 得器魂 ×${r.equipSalvage.soul}`); blip(600, .06); renderResBar(); fillBagEquip(); }
    return;
  }
  const eqbrk = t.closest("[data-eqbrk]");
  if (eqbrk) {
    const j = await call({ type: "equipBreak", uid: eqbrk.dataset.eqbrk });
    if (j) {
      toast(`缘器突破至 ${j.equipBreak.bt} 阶！`); blip(820, .12); renderResBar(); fillBagEquip();
      const gid = $("#loadoutBox")?.dataset.for; if (gid) refreshLoadout(gid);
    }
    return;
  }
  const equp2 = t.closest("[data-equp]");
  if (equp2) {
    const j = await call({ type: "equipUp", uid: equp2.dataset.equp });
    if (j) {
      toast(`缘器强化至 ${j.equipUp.level} 级 · 耗器魂 ${j.equipUp.soul}`); blip(720, .07); renderResBar(); fillBagEquip();
      const gid = $("#loadoutBox")?.dataset.for; if (gid) refreshLoadout(gid);
    }
    return;
  }
  // —— 二期养成三件套：命格 / 心法 / 器纹刻铸（PLAYABLE P1）——
  // 命格：点未点亮格 → 三选一浮层（浮层会替换养成弹窗，选定后重开）
  const conslot = t.closest("[data-conslot]");
  if (conslot) return openConPick(conslot.dataset.for, +conslot.dataset.conslot);
  const conopt = t.closest("[data-conopt]");
  if (conopt) {
    const [slot, opt] = conopt.dataset.conopt.split("|").map(Number);
    const id = conopt.dataset.for;
    const j = await call({ type: "constellationSet", charId: id, slot, opt });
    if (j && j.constellationSet && j.constellationSet.ok) {
      const sl = (DATA.constellations?.disks?.[DATA.constellations?.diskMap?.[id]] || {}).slots?.[slot];
      toast(`命格·${sl?.opts?.[opt]?.name || ""} 已点亮`);
      blip(820, .12); renderResBar();
      if (cur === "roster") renderRoster();
      openGrow(id);              // 重开养成弹窗，命格区即刻刷新
    }
    return;
  }
  // 心法：终式行的「改 造」→ 三选一浮层
  const skillmodBtn = t.closest("[data-skillmod]");
  if (skillmodBtn) return openModPick(skillmodBtn.dataset.skillmod);
  const modpick = t.closest("[data-modpick]");
  if (modpick) {
    const id = modpick.dataset.for, key = modpick.dataset.modpick;
    const j = await call({ type: "skillModSet", charId: id, key });
    if (j && j.skillModSet && j.skillModSet.ok) {
      const fam = (DATA.skillmods?.families || {})[(charById(id) || {}).role] || [];
      toast(`心法·${(fam.find(m => m.key === key) || {}).name || ""} 已成`);
      blip(820, .12); renderResBar();
      if (cur === "roster") renderRoster();
      openGrow(id);
    }
    return;
  }
  // —— 三期：觉醒 + 传记 ——
  // 觉醒：三步全齐才发；失败时服务端把未达成步骤名写进 awakenClaim.error（call 已 toast），这里只接成功
  const awclaim = t.closest("[data-awclaim]");
  if (awclaim) {
    const id = awclaim.dataset.awclaim;
    const j = await call({ type: "awakenClaim", id });
    if (j && j.awakenClaim && j.awakenClaim.ok) {
      toast(`觉醒！真名「${j.awakenClaim.trueName}」`);
      blip(880, .16); renderResBar();
      if (cur === "roster") renderRoster();
      openGrow(id);   // 重开养成弹窗：徽章 + 真名终式即刻刷新
    }
    return;
  }
  // 角色经历 / 语音（名册详情与完整卡面里都有入口）：先关弹窗再开，避免两个弹窗叠着
  const cstory = t.closest("[data-chstory]");
  if (cstory) { blip(660, .06); closeModal(); return openCharStory(cstory.dataset.chstory); }
  const cvoice = t.closest("[data-cvoice]");
  if (cvoice) { blip(700, .06); closeModal(); return openCharVoice(cvoice.dataset.cvoice); }
  // 角色立绘：先关当前弹窗（从卡面详情进来时），再开全立绘画廊
  const carts = t.closest("[data-carts]");
  if (carts) { blip(680, .06); closeModal(); return openCharArts(carts.dataset.carts); }
  const agsel = t.closest("[data-agsel]");
  if (agsel) {
    if (agState) {
      const i = agState.list.findIndex(x => x.kind === agsel.dataset.agsel);
      if (i >= 0) { agState.idx = i; agShow(); blip(720, .05); }
    }
    return;
  }
  const agstep = t.closest("[data-agstep]");
  if (agstep) { blip(700, .05); return agStep(+agstep.dataset.agstep || 0); }
  const cvplay = t.closest("[data-cvplay]");
  if (cvplay) {
    const [id, slot] = cvplay.dataset.cvplay.split("|");
    // 手动试听用最高优先级，随时接管正在播的台词
    AudioSys.cv(id, slot, { priority: 3 });
    blip(760, .05);
    // 播放态反馈：同一时刻只播一句，先把其它行的「播放中」收回
    document.querySelectorAll(".vox-play.playing").forEach(b => {
      b.classList.remove("playing");
      b.dataset.playToken = "";
      const lb = b.querySelector(".vox-label"); if (lb) lb.textContent = "播放";
    });
    const token = String(Date.now() + Math.random());
    cvplay.dataset.playToken = token;
    cvplay.classList.add("playing");
    const lbl = cvplay.querySelector(".vox-label"); if (lbl) lbl.textContent = "播放中…";
    const clear = () => {
      if (cvplay.dataset.playToken !== token) return;
      cvplay.classList.remove("playing");
      const l = cvplay.querySelector(".vox-label"); if (l) l.textContent = "播放";
    };
    const a = AudioSys._cvNow;
    if (a && a.src && a.src.includes("/" + id + "/" + slot + ".mp3")) {
      a.addEventListener("ended", clear, { once: true });
      a.addEventListener("pause", clear, { once: true });
      a.addEventListener("error", clear, { once: true });
      // 兜底：无媒体事件（被浏览器拦自动播放/文件异常）或 ended 丢失时按时长收尾，
      // 避免按钮永远停在「播放中…」。
      setTimeout(clear, Math.max(1200, (isFinite(a.duration) && a.duration > 0 ? a.duration : 3) * 1000 + 400));
    } else {
      // 静音/音效关闭时 AudioSys 不会真的播，直接恢复按钮态
      clear();
    }
    return;
  }
  // 传记：卷目列表 → 展卷（真接口，失败 toast 缘值不足等）→ 阅读页 → 返回
  const biopen = t.closest("[data-biopen]");
  if (biopen) return openBio(biopen.dataset.biopen);
  const bioread = t.closest("[data-bioread]");
  if (bioread) {
    const id = bioread.dataset.bioread, idx = +bioread.dataset.biidx;
    const mode = t.closest(".bio-modal")?.dataset.bimode || "bio";
    const j = await call({ type: "bioRead", id, idx });
    if (j && j.bioRead && j.bioRead.ok) {
      if (j.bioRead.first) { toast(`初读有赠 · ${j.bioRead.gains}`); blip(820, .1); renderResBar(); }
      renderBioRead(id, j.bioRead, mode);
    }
    return;
  }
  const biback = t.closest("[data-biback]");
  if (biback) return renderBioList(biback.dataset.biback, biback.dataset.bimode || "bio");
  // 器纹：刻纹（无纹） / 重铸（有纹），成后刷新行囊与货币条
  const eqeng = t.closest("[data-eqengrave]");
  if (eqeng) {
    const j = await call({ type: "equipEngrave", uid: eqeng.dataset.eqengrave });
    if (j && j.equipEngrave && j.equipEngrave.ok) {
      const r = j.equipEngrave.rune;
      toast(`刻成 ${runeMeta(r.key).name}·${r.grade}档`);
      blip(760, .1); renderResBar(); fillBagEquip();
    }
    return;
  }
  const eqref = t.closest("[data-eqreforge]");
  if (eqref) {
    const j = await call({ type: "equipReforge", uid: eqref.dataset.eqreforge });
    if (j && j.equipReforge && j.equipReforge.ok) {
      const r = j.equipReforge.rune;
      toast(`重铸为 ${runeMeta(r.key).name}·${r.grade}档 · 距保底 ${j.equipReforge.pityLeft} 次`);
      blip(760, .1); renderResBar(); fillBagEquip();
    }
    return;
  }
  // 穿戴：先选人（本命缘器只列铸魂角色），再落穿戴
  const eqwear2 = t.closest("[data-eqwear2]");
  if (eqwear2) {
    const uid = eqwear2.dataset.eqwear2;
    const j = await api({ type: "bag" }).catch(() => null);
    const it = (j?.bag || []).find(x => x.uid === uid);
    if (!it) return;
    const cands = Object.keys(S.owned).filter(id => !it.exclusive || it.exclusiveFor === id);
    return modal(`<div class="menu" style="width:520px">
      <div class="panel-title" style="text-align:center">为 谁 穿 戴</div>
      <div class="panel-sub" style="text-align:center;margin-top:6px">${esc(it.name)}${it.exclusive ? " · 本命缘器只属于铸魂角色" : ""}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;max-height:50vh;overflow:auto">
        ${cands.map(id => `<button class="btn" data-wearpick="${uid}|${id}">${esc((charById(id) || {}).name || id)}</button>`).join("")
          || `<div class="panel-sub">还没有可穿戴的角色</div>`}
      </div>
      <div style="margin-top:14px"><button class="btn" style="width:100%" data-close>取 消</button></div>
    </div>`, { dimClose: true });
  }
  const wearpick = t.closest("[data-wearpick]");
  if (wearpick) {
    const [uid, id] = wearpick.dataset.wearpick.split("|");
    const j = await call({ type: "equipWear", id, uid });
    if (j) {
      toast("已穿戴上身"); closeModal(); fillBagEquip();
      const gid = $("#loadoutBox")?.dataset.for; if (gid) refreshLoadout(gid);
    }
    return;
  }
  // —— 物志（万妖谱 + 奇遇录，二期 P2）——
  const bkin = t.closest("[data-bkin]");
  if (bkin) { bestiaryKin = bkin.dataset.bkin; blip(600, .05); return renderBestiary(); }
  const bentry = t.closest("[data-bentry]");
  if (bentry) return openBestiaryEntry(bentry.dataset.bentry);
  // 出征关卡详情「本关敌人」：点任意敌人行 → 同一条目详情（补本关等级与关名）
  const foe = t.closest("[data-foe]");
  if (foe) {
    blip(640, .05);
    return openFoeDetail(foe);
  }
  const kinclaim = t.closest("[data-kinclaim]");
  if (kinclaim && !kinclaim.disabled) {
    const j = await call({ type: "bestiaryClaim", kin: kinclaim.dataset.kinclaim });
    const r = j && j.bestiaryClaim;
    if (r && r.ok) {
      toast(`${r.kin}族图鉴奖励已领取：铜钱+${fmt(r.coin)} 星砂+${r.xingsha}`);
      blip(820, .12); renderResBar();
      if (cur === "bestiary") renderBestiary();
    }
    return;
  }
  // —— 仙缘奇遇 modal（选项 → 结果页 → 收下）——
  const advopt = t.closest("[data-advopt]");
  if (advopt) {
    const j = await call({ type: "adventurePick", opt: +advopt.dataset.advopt });
    const r = j && j.adventurePick;
    if (r && r.ok) { blip(760, .1); showAdventureResult(r); }
    return;
  }
  const advok = t.closest("[data-advok]");
  if (advok) {
    closeModal();
    renderResBar();
    if (typeof RENDER !== "undefined" && RENDER[cur]) RENDER[cur]();
    return;
  }
  // —— 洞府经营 + 炼丹（二期 P3）——
  // 四建筑收取 / 升级（manorB 接口）；灵田开垦（沿用旧 manor 接口）
  const mbcol = t.closest("[data-mbcol]");
  if (mbcol && !mbcol.disabled) {
    const j = await call({ type: "manorBCollect", key: mbcol.dataset.mbcol });
    const r = j && j.manorBCollect;
    if (r && r.error) return toast(r.error);
    if (r && r.ok) {
      const b = (DATA.manorB?.buildings || []).find(x => x.key === r.key) || {};
      toast(`${b.label || r.key} · ${b.resLabel || r.res} +${r.n}`);
      blip(700, .08); renderResBar(); renderManor();
    }
    return;
  }
  const mbup = t.closest("[data-mbup]");
  if (mbup && !mbup.disabled) {
    const j = await call({ type: "manorBUpgrade", key: mbup.dataset.mbup });
    const r = j && j.manorBUpgrade;
    if (r && r.error) return toast(r.error);
    if (r && r.ok) {
      const b = (DATA.manorB?.buildings || []).find(x => x.key === r.key) || {};
      toast(`${b.label || r.key} 升至 ${r.lv} 级`);
      blip(820, .1); renderResBar(); renderManor();
    }
    return;
  }
  const mrec = t.closest("[data-mreclaim]");
  if (mrec && !mrec.disabled) {
    const j = await call({ type: "manorReclaim" });
    if (j) {
      if (j.manorErr) return toast(j.manorErr);
      toast(j.full
        ? `开垦完成 · 灵田已满（${j.max} 块）`
        : `开垦完成 · 灵田 +1 块，再开需 ${fmt(j.cost)} 缘玉`);
      blip(760, .1); renderResBar(); renderManor();
    }
    return;
  }
  // 炼丹：开炉弹火候面板 / 定火提交停点
  const brewgo = t.closest("[data-brewgo]");
  if (brewgo) return openBrew(brewgo.dataset.brewgo);
  const brewset = t.closest("[data-brewset]");
  if (brewset) return doBrewSet(brewset.dataset.brewset);
  // 出征用药：开浮层 / 选定 / 取消
  const puse = t.closest("[data-pilluse]");
  if (puse) return openPillPick();
  const ppick = t.closest("[data-pillpick]");
  if (ppick) {
    const [key, q] = ppick.dataset.pillpick.split("|");
    const r = (DATA.manorB?.recipes || []).find(x => x.key === key);
    battlePill = { key, q, name: (r && r.name) || key };
    closeModal(); blip(660, .05);
    if (cur === "stages") renderStages();
    return toast(`本次出战用药：${battlePill.name} · ${((DATA.manorB?.quality || {}).label || {})[q] || q}`);
  }
  const pclear = t.closest("[data-pillclear]");
  if (pclear) {
    battlePill = null; closeModal(); blip(600, .05);
    if (cur === "stages") renderStages();
    return toast("已取消本次用药");
  }
  // —— 洞府灵田 / 图鉴里程碑 ——
  const ct = t.closest("[data-ctier]");
  if (ct) return claimTier(+ct.dataset.ctier);
  const cropEl = t.closest("[data-crop]");
  if (cropEl) {
    pickCrop = cropEl.dataset.crop;
    $$("#cropPick .btn").forEach(b => b.classList.toggle("primary", b === cropEl));
    return toast(`已选作物：${cropEl.textContent.trim()}`);
  }
  const plantAt = t.closest("[data-plant]");
  if (plantAt) return doPlant(+plantAt.dataset.plant);
  const harvestAt = t.closest("[data-harvest]");
  if (harvestAt && !harvestAt.disabled) return doHarvest(+harvestAt.dataset.harvest);
  const plus = t.closest("[data-plus]");
  if (plus) {
    // 缘玉的「+」直接进充值；心神的「+」打开补充弹窗（原来只弹一句提示，玩家以为按钮坏了）
    if (plus.dataset.plus === "jade") return openRecharge();
    if (plus.dataset.plus === "stamina") return openStaminaBuy();
    return toast("心神补充：缘玉购买 / 自然恢复");
  }
  // 主城头像 → 个人资料
  const pf = t.closest("[data-profile]");
  if (pf) return openProfile();
  // 充值档位点选 → 创建订单
  const pack = t.closest("[data-pack]");
  if (pack) return createOrder(pack.dataset.pack);
});

$("#revealGrid")?.addEventListener("click", e => {
  const card = e.target.closest(".fcard");
  if (card) revealOne(card);
});
const revealAll = $("#revealAll");
if (revealAll) revealAll.onclick = () => revealAllCards();
const revealOk = $("#revealOk");
if (revealOk) revealOk.onclick = () => { cancelRevealAll(); $("#reveal").classList.remove("on"); go(cur); };
const gear = $("#btnGear");
if (gear) { gear.innerHTML = I("gear"); gear.onclick = openMenu; }
$("#bvClose").onclick = () => { bvSkipHandler && bvSkipHandler(); };
$("#bvAuto").onclick = () => {
  bvAuto = !bvAuto;
  $("#bvAuto").textContent = bvAuto ? "自动 开" : "自动";
  $("#bvAuto").classList.toggle("primary", bvAuto);
  // 开自动 ≠ 跳过：bvSkipHandler 会直接跳出整个回合演出循环（等同「跳过」按钮），
  // 这里绝不能调——否则点自动的那一刻当前这场就被跳到结算了。
};
$("#bvSpeed").onclick = () => {
  bvSpeed = bvSpeed === 0.5 ? 1 : bvSpeed === 1 ? 2 : 0.5;
  try { localStorage.setItem("sy_bvSpeed", String(bvSpeed)); } catch (e) { /* 隐私模式忽略 */ }
  $("#bvSpeed").textContent = `速度 ×${bvSpeed}`;
};
$("#bvSkip").onclick = () => bvSkipHandler && bvSkipHandler();
/* 空格键禁止触发按钮点击：扫荡按钮点过一次后仍保持焦点，玩家敲空格（或连点）
 * 浏览器默认会再「click」一次同一个按钮 → 又扫荡一遍。这里只拦按钮类元素的空格默认行为，
 * 不影响输入框，也不拦页面正常滚动（焦点在 body 时照常翻页）。 */
document.addEventListener("keydown", e => {
  if (e.key === " " || e.code === "Space") {
    const el = document.activeElement;
    const tag = el && el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable)) return;
    if (el && el.closest && el.closest("button,[role=button],[data-sweep],[data-battle],.node,.chapbtn")) {
      e.preventDefault();
      return;
    }
  }
  if (e.key === "Escape") {
    if ($("#modalHost").innerHTML) return closeModal();
    if ($("#reveal").classList.contains("on")) { cancelRevealAll(); $("#reveal").classList.remove("on"); return go(cur); }
    if ($("#battleView").classList.contains("on")) return bvSkipHandler && bvSkipHandler();
    return openMenu();
  }
});

/* ---------------- 启动 ---------------- */

const RENDER = {
  home: renderHome, gacha: renderGacha, roster: renderRoster, codex: renderCodex,
  // team 已并入 roster（rosterTab==="team"），不再单列，避免指向已删除的函数
  stages: renderStages, bag: renderBag, shop: renderShop, eforge: renderEforge,
  manor: renderManor,
  dungeons: renderDungeons, tower: renderTower, achv: renderAchv, bondstory: renderBonds,
  bestiary: renderBestiary,
  // realm.js 在本文件之后加载，这里用箭头延迟解析，避免字面量求值时 renderRealm 还不存在
  realm: () => renderRealm(),
};

$("#tabsNew").innerHTML = "";
try {
  if (TOKEN) enterGame().catch(e => { window.__bootErr = "enterGame: " + String(e && e.stack || e).slice(0, 300); showAuth(); });
  else showAuth();
} catch (e) { window.__bootErr = "top: " + String(e && e.stack || e).slice(0, 300); showAuth(); }

