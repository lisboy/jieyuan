/* 拾缘 · realm —— 虚境探秘（PLAYABLE P4）Roguelike 前端屏
 * 铁律：只演数据不算数 —— 地图 / 血量 / 符箓 / 奖励全部来自服务端 save.xujing（S.xujing）与 DATA.realm，
 * 本文件只把状态演出来 + 发动作（xujingEnter / xujingNode / xujingPick / xujingQuit / battle{xujing:1}），
 * 不重算任何经济与战斗数值。交互一律 data-* + 事件委托（CSP 禁内联事件）。 */
"use strict";

/* ---------------- 展示映射（节点种类 / 符箓稀有度 / 节点圆符） ---------------- */

const XJ_KIND = {
  battle: { name: "遇敌", desc: "虚境游荡的妖物" },
  elite:  { name: "精英", desc: "更强的把守者" },
  shop:   { name: "符摊", desc: "三选一领一张符箓" },
  spring: { name: "回响泉", desc: "全员回复部分气血" },
  boss:   { name: "守关", desc: "层末首领，通关发层奖" },
};
/* 节点圆符（24×24 线性，与 ICONS 同风格）：battle 剑 / elite 双剑 / shop 符纸 / spring 水滴 / boss 兽首 */
const XJ_NODE_ICON = {
  battle: ICONS.sword,
  elite: ICONS.combo,
  shop: '<rect x="7.2" y="3.6" width="9.6" height="16.8" rx="1.4"/><path d="M12 7.4v9.2M9.7 10.6h4.6M9.7 13.8h4.6"/>',
  spring: '<path d="M12 3.6c3.3 4.2 5.5 7 5.5 9.8a5.5 5.5 0 0 1-11 0c0-2.8 2.2-5.6 5.5-9.8Z"/><path d="M9.4 13.8a2.7 2.7 0 0 0 2.1 2.6"/>',
  boss: '<path d="M6.2 4.2 8.6 7M17.8 4.2 15.4 7"/><path d="M7 8.4c1.6-1.3 3.2-1.9 5-1.9s3.4.6 5 1.9"/><circle cx="9.3" cy="12.2" r="1.1"/><circle cx="14.7" cy="12.2" r="1.1"/><path d="M8.2 18.3c1-1.5 2.4-2.3 3.8-2.3s2.8.8 3.8 2.3"/>',
};
const XJ_RARITY = {
  common: { name: "凡品", color: "#9aa3b2" },
  rare:   { name: "良品", color: "#6fa8dc" },
  epic:   { name: "珍品", color: "#e8c98a" },
};
const xjTalisman = id => (DATA.realm?.talismans || []).find(t => t.id === id) || null;
const xjKindName = k => XJ_KIND[k]?.name || k;
/** 内联 SVG 小图标（复用节点圆符的路径，按钮/图例共用） */
const xjIconSvg = k => `<svg class="xj-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${XJ_NODE_ICON[k] || ICONS.circle}</svg>`;

/* ---------------- 屏渲染 ---------------- */

let xjQuitArm = false;   // 弃局二次确认待确认态（同行囊一键分解的 salBatchArm 模式）

function renderRealm() {
  const host = $("#scr-realm");
  if (!host) return;
  xjQuitArm = false;
  host.innerHTML = S.xujing ? xjRunHtml() : xjEntryHtml();
}

/* —— 无局：入口卡 —— */
function xjEntryHtml() {
  const R = DATA.realm || {};
  const need = R.entry?.stamina ?? 20;
  const per = R.rewards?.perLayer || {};
  const cb = R.rewards?.clearBonus || {};
  const keep = Math.round((R.rewards?.defeatKeep ?? 0.4) * 100);
  const xin = Math.round((per.xinyinChance ?? 0.4) * 100);
  const layers = R.layers || 3;
  const nodesTxt = (R.nodesPerLayer || [5, 5, 5]).join(" / ");
  const noTeam = !S.team.length;
  const poor = (S.wallet.stamina || 0) < need;
  const legend = Object.entries(XJ_KIND).map(([k, v]) =>
    `<span class="xj-leg">${xjIconSvg(k)}${esc(v.name)}<i>${esc(v.desc)}</i></span>`).join("");
  return `<div class="panel panel-pad xj-panel">
    <div class="panel-title">虚 境 探 秘<span class="bsy-total">ROGUELIKE · 限时局</span></div>
    <div class="panel-sub" style="margin-top:6px">一道未名的门扉悬于虚空。入境后每一步都不可回头，出境（或折戟）时结算所得。</div>
    <div class="xj-legend">${legend}</div>
    <div class="xj-brief">
      <div class="xj-briefrow"><span>局制</span><b>${layers} 层 · 每层 ${esc(nodesTxt)} 列</b><i>首列必遇敌 · 层末必守关 · 分叉列二选一</i></div>
      <div class="xj-briefrow"><span>层奖</span><b>星砂 ${per.xingsha ?? 6} · 纹砂 ${per.wensha ?? 4} · 缘玉 ${per.jadePerLayer ?? 30}×层</b><i>另附 ${xin}% 概率得心印</i></div>
      <div class="xj-briefrow"><span>保底</span><b>战败发已过层奖励 ×${keep}%</b><i>通盘另得 缘玉${cb.jade ?? 0} · 星砂${cb.xingsha ?? 0} · 纹砂${cb.wensha ?? 0}</i></div>
      <div class="xj-briefrow"><span>符箓</span><b>局内生效 · 出境清空</b><i>越深的层，符箓品阶越好</i></div>
    </div>
    <div class="xj-go">
      <button class="btn primary xj-enter" data-xjenter ${noTeam || poor ? "disabled" : ""}>入 境</button>
      <div class="xj-gonote">心神 −${need}${noTeam ? " · 请先编队" : poor ? " · 心神不足" : ""}</div>
    </div>
  </div>`;
}

/* —— 有局：地图 + 操作区 —— */
function xjRunHtml() {
  const xj = S.xujing;
  const layers = DATA.realm?.layers || 3;
  const cols = (xj.map || [])[xj.layer - 1] || [];
  const dots = Array.from({ length: layers }, (_, i) =>
    `<i class="${i < xj.layer - 1 ? "done" : i === xj.layer - 1 ? "cur" : ""}"></i>`).join("");
  const hpRow = S.team.map(id => {
    const c = charById(id);
    const hp = Math.max(0, Math.min(1, xj.hp?.[id] ?? 1));
    const pct = Math.round(hp * 100);
    const col = hp <= 0.3 ? "#d0563c" : hp <= 0.6 ? "#d9a13b" : "#7fbf7f";
    return `<div class="xj-hpu" data-tip="${esc(c?.name || id)}|气血 ${pct}%">
      <span class="xj-hpav">${artImg(id, "avatar")}</span>
      <span class="xj-hpbar"><i style="width:${pct}%;background:${col}"></i></span>
      <b class="num" style="color:${col};font-size:10.5px">${pct}%</b>
    </div>`;
  }).join("");
  const tals = (xj.talismans || []).map(id => {
    const t = xjTalisman(id);
    const rc = XJ_RARITY[t?.rarity]?.color || "#9aa3b2";
    return `<span class="xj-tal" style="border-color:${rc}66;color:${rc}" data-tip="${esc(t?.name || id)}|${esc(t?.desc || "")}">${esc(t?.name || id)}</span>`;
  }).join("") || `<span class="xj-talempty">尚未获得符箓</span>`;

  return `<div class="panel panel-pad xj-panel">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div class="panel-title">虚 境 探 秘<span class="xj-layer num">第 ${xj.layer} / ${layers} 层<span class="xj-dots">${dots}</span></span></div>
      <button class="btn sm ${xjQuitArm ? "" : "ghost"}" data-xjquit>${xjQuitArm
        ? `确认弃局？已过 ${Math.max(0, xj.layer - 1)} 层奖励保留 · 再点一次执行`
        : "弃 局"}</button>
    </div>
    <div class="xj-hprow">${hpRow}</div>
    <div class="xj-talrow">${tals}</div>
    <div class="xj-map">${xjMapSvg(cols, xj)}</div>
    <div class="xj-actions">${xjActionsHtml(cols)}</div>
  </div>`;
}

/* —— SVG 节点图：横向当前层全部列 —— */
function xjMapSvg(cols, xj) {
  const n = Math.max(1, cols.length);
  const W = Math.max(330, n * 92 + 56), H = 132;
  const xAt = i => 34 + i * (W - 68) / Math.max(1, n - 1);
  /* 收集每列候选的坐标：单候选居中，分叉上下两枚 */
  const pos = cols.map(c => {
    const ks = [c.a, c.b].filter(Boolean);
    const yy = ks.length > 1 ? [38, 94] : [66];
    return ks.map((k, j) => ({ kind: k.kind, x: 0, y: yy[j], idx: j }));
  });
  cols.forEach((_, i) => pos[i].forEach(p => { p.x = xAt(i); }));
  const colState = i => i < xj.col ? "done" : i === xj.col ? "cur" : "next";
  /* 列间连线 */
  let edges = "";
  for (let i = 0; i < n - 1; i++)
    for (const p1 of pos[i]) for (const p2 of pos[i + 1])
      edges += `<line class="xj-edge e-${colState(i + 1)}" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"/>`;
  /* 节点圆符 */
  let nodes = "";
  pos.forEach((colNodes, i) => {
    const st = colState(i);
    for (const p of colNodes) {
      const engaged = st === "cur" && !!xj.cur;   // 节点已选但未了结（战斗进行中）
      const pickable = st === "cur" && !xj.cur;   // 当前列待选：点圆符 = 点按钮
      nodes += `<g class="xj-nd ${st}${engaged ? " hot" : ""}" ${pickable ? `data-xjnode="${p.idx}"` : ""}
        data-tip="${esc(xjKindName(p.kind))}|${esc(XJ_KIND[p.kind]?.desc || "")}">
        ${st === "cur" ? `<circle class="xj-nd-halo" cx="${p.x}" cy="${p.y}" r="24"/>` : ""}
        <circle class="xj-nd-ring" cx="${p.x}" cy="${p.y}" r="17"/>
        <svg class="xj-nd-ic" x="${p.x - 10.5}" y="${p.y - 10.5}" width="21" height="21" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
          style="pointer-events:none">${XJ_NODE_ICON[p.kind] || ICONS.circle}</svg>
        ${st === "done" ? `<path class="xj-nd-check" d="M${p.x - 6.5} ${p.y + 0.5} l4 4.5 8.5 -9.5"/>` : ""}
        <text class="xj-nd-lb t-${st}" x="${p.x}" y="${p.y + 31}">${esc(xjKindName(p.kind))}</text>
      </g>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${edges}${nodes}</svg>`;
}

/* —— 当前列操作区（优先级：符摊三选一 > 待续战斗 > 列候选） —— */
function xjActionsHtml(cols) {
  const xj = S.xujing;
  if (xj.offer) {
    return `<div class="xj-offer-t">符 摊 · 三 选 一</div><div class="xj-offer">${xjOfferCards(xj.offer)}</div>`;
  }
  if (xj.cur?.waves) {
    const k = xj.cur.kind;
    return `<button class="btn primary xj-act" data-xjbattle>${xjIconSvg(k)} 迎战 · ${esc(xjKindName(k))}</button>`;
  }
  const col = cols[xj.col];
  if (!col) return `<div class="xj-wait">本层节点已走完</div>`;
  const cands = [col.a, col.b].filter(Boolean);
  if (cands.length === 1) {
    const k = cands[0].kind;
    return `<button class="btn primary xj-act" data-xjnode="0">${xjIconSvg(k)} 进入此节点 · ${esc(xjKindName(k))}</button>`;
  }
  return `<div class="xj-branch">${cands.map((c, i) =>
    `<button class="btn xj-act" data-xjnode="${i}">${xjIconSvg(c.kind)}<b>${esc(xjKindName(c.kind))}</b><i>${esc(XJ_KIND[c.kind]?.desc || "")}</i></button>`).join("")}</div>`;
}

/* —— 符箓三选一卡（浮层与内嵌共用，data-xjpick 统一收口） —— */
function xjOfferCards(offer) {
  return (offer || []).map((id, i) => {
    const t = xjTalisman(id);
    const rc = XJ_RARITY[t?.rarity]?.color || "#9aa3b2";
    const rn = XJ_RARITY[t?.rarity]?.name || t?.rarity || "？";
    return `<button class="xj-ocard" data-xjpick="${i}" style="border-color:${rc}88">
      <span class="xj-orar" style="color:${rc};border-color:${rc}">${esc(rn)}</span>
      <span class="xj-oname">${esc(t?.name || id)}</span>
      <span class="xj-odesc">${esc(t?.desc || "")}</span>
    </button>`;
  }).join("");
}
function xjOfferModal(offer) {
  modal(`<div class="menu" style="width:520px">
    <div class="panel-title" style="text-align:center">符 摊 · 三 选 一</div>
    <div class="panel-sub" style="text-align:center;margin-top:4px">选中的符箓本局生效，出境清空</div>
    <div class="xj-offer" style="margin-top:14px">${xjOfferCards(offer)}</div>
  </div>`);
}

/* ---------------- 虚境战斗（变体入口，不写第二套结算） ---------------- */

async function doXujingBattle() {
  const pre = S.xujing;
  if (!pre?.cur) return;
  /* 演出标题/背景：进战前先定格（战斗响应回来时 S 已是结算后的新局） */
  const title = `虚境 · 第 ${pre.layer} 层 · ${xjKindName(pre.cur.kind)}`;
  /* 自动连战链在虚境里走不通（playBattle 结尾的 doBattle(stageId) 会拿 "xujing" 去打普通关），
   * 入境战斗一律单场结算。 */
  if (bvAuto) stopAuto("");
  toast("进军虚境……");
  const j = await call({ type: "battle", xujing: 1 });
  if (!j) return;
  window.__bvTitle = title;
  window.__bvBg = "stage_all";
  try {
    await playBattle("xujing", j.result, j.outcome);
  } catch (err) {
    console.error("[realm] 演出中断，跳到结算", err);
    closeBattle();
  }
  /* 战斗响应已重建 S：complete → 回无局态；defeat → 保底已发；否则重画节点图 */
  const xj = j.xujing;
  if (xj?.complete) { toast("虚境通盘！"); blip(880, .12); }
  else if (xj?.defeat) toast("虚境折戟，保底奖励已发");
  renderRealm();
}

/* ---------------- 事件委托（本文件的 data-* 全在这里收口，只绑一次） ---------------- */

document.addEventListener("click", async e => {
  const t = e.target;

  const enter = t.closest("[data-xjenter]");
  if (enter) {
    const j = await call({ type: "xujingEnter" });
    if (j && j.xujing) { blip(760, .1); renderResBar(); renderRealm(); }
    return;
  }

  const node = t.closest("[data-xjnode]");
  if (node) {
    const j = await call({ type: "xujingNode", pick: Number(node.dataset.xjnode) || 0 });
    if (!j || !j.xujing) return;
    const r = j.xujing;
    if (r.battle) { renderRealm(); return doXujingBattle(); }
    if (r.offer) { renderRealm(); return xjOfferModal(r.offer); }
    if (r.node?.kind === "spring") { toast(`回响泉：全员回复 ${Math.round((r.heal || 0.3) * 100)}% 气血`); blip(660, .08); }
    renderRealm();
    return;
  }

  const pick = t.closest("[data-xjpick]");
  if (pick) {
    const j = await call({ type: "xujingPick", i: Number(pick.dataset.xjpick) || 0 });
    if (j && j.xujing) { toast(`获得 符箓 · ${j.xujing.name}`); blip(820, .1); closeModal(); renderRealm(); }
    return;
  }

  const bat = t.closest("[data-xjbattle]");
  if (bat) return doXujingBattle();

  const quit = t.closest("[data-xjquit]");
  if (quit) {
    if (!xjQuitArm) {
      xjQuitArm = true;
      quit.classList.remove("ghost");
      quit.classList.add("armed");
      quit.textContent = `确认弃局？已过 ${Math.max(0, (S.xujing?.layer || 1) - 1)} 层奖励保留 · 再点一次执行`;
      setTimeout(() => { if (xjQuitArm) { xjQuitArm = false; renderRealm(); } }, 6000);
      return;
    }
    xjQuitArm = false;
    const j = await call({ type: "xujingQuit" });
    if (j && j.xujing) { toast(`已弃局 · 保留 ${j.xujing.keptLayers || 0} 层奖励`); blip(420, .1); renderRealm(); }
    return;
  }
});
