/* 拾缘 · report —— 战报与失败诊断（DESIGN-EXPANSION §2.7）
 * 从结算画面「战报」按钮打开：伤害构成 / 关键时间轴 / 战败心结自诊 / 抄作业串。
 * 数据全部来自最近一场 battle result（window.__lastBattle）与本地存档，不另发请求。
 * 规则表来自 DATA.diagnostics（serve 从 content/diagnostics.json 直读）。
 */
"use strict";

/** 把 result.turns 聚合成战报数字（口径与 settle.battleStats 一致，另补时间轴与诊断计数）。
 *  归属规则：打 side=1 的伤害记给本回合行动者；打 side=0 的记承受；治疗记给施放回合的行动者。 */
function reportStats(result) {
  const rows = new Map();   // slot → {slot,id,name,dmg,taken,heal}（候补与原队员同 slot：取首发行）
  for (const a of result.allies || []) {
    if (rows.has(a.slot)) continue;
    rows.set(a.slot, {
      slot: a.slot, id: a.id, element: a.element,
      name: a.name || (charById(a.id) || {}).name || a.id || "?",
      dmg: 0, taken: 0, heal: 0,
    });
  }
  const foeNames = new Map();   // slot → 敌方名（首个同 slot 的是本体，召唤物槽位独立）
  for (const w of result.foes || []) {
    for (const u of w.units || []) if (!foeNames.has(u.slot)) foeNames.set(u.slot, u.name || u.id || "?");
  }
  const agg = {
    allyTaken: 0, foeTaken: 0, heal: 0,
    ults: 0, combos: 0, healCount: 0, bossPhase: 0, comboUsed: 0, deaths: 0,
  };
  const waveDeaths = new Map();   // 波（显示号 1 起）→ 我方阵亡数
  const timeline = [];
  let firstDeathTurn = 0;
  let allyTurnIdx = 0;
  for (const turn of result.turns || []) {
    if (turn.actorSide === 0) allyTurnIdx++;
    const me = turn.actorSide === 0 ? rows.get(turn.actorSlot) : null;
    const evs = turn.events || [];
    const cast = evs.find(e => e.kind === "skill_cast");
    const isUlt = !!(cast && cast.amount === 1 && turn.actorSide === 0);
    if (isUlt) agg.ults++;
    for (const ev of evs) {
      const hostile = ev.kind === "damage" || ev.kind === "crit" || ev.kind === "dotTick";
      if (hostile && ev.side === 1) {
        agg.foeTaken += ev.amount || 0;
        if (me) me.dmg += ev.amount || 0;
      } else if (hostile && ev.side === 0) {
        agg.allyTaken += ev.amount || 0;
        const tgt = rows.get(ev.slot);
        if (tgt) tgt.taken += ev.amount || 0;
      } else if (ev.kind === "heal") {
        if (ev.side === 0) {
          agg.heal += ev.amount || 0;
          agg.healCount++;
          if (me) me.heal += ev.amount || 0;
        }
      } else if (ev.kind === "combo") {
        agg.combos++;
        agg.comboUsed = 1;
      } else if (ev.kind === "phase") {
        agg.bossPhase = Math.max(agg.bossPhase, ev.amount || 0);
      } else if (ev.kind === "death" && ev.side === 0) {
        agg.deaths++;
        const w = (turn.wave || 0) + 1;
        waveDeaths.set(w, (waveDeaths.get(w) || 0) + 1);
        if (!firstDeathTurn) firstDeathTurn = allyTurnIdx || turn.round || 1;
      }
    }
    /* 时间轴关键项：大招 / 合击 / 阶段 / 破防 / 候补（一行一条，最后取最近 20 条） */
    const wNo = (turn.wave || 0) + 1;
    const when = `第${wNo}波·第${turn.round || 0}回合`;
    const comboEv = evs.find(e => e.kind === "combo");
    const lineEv = evs.find(e => e.kind === "comboLine");
    if (isUlt && me) timeline.push({ when, t: `${me.name} 放出大招「${cast.note || "终式"}」` });
    if (comboEv) {
      const aName = rows.get(comboEv.slot)?.name || "?";
      const bName = lineEv ? (rows.get(lineEv.slot)?.name || "?") : "?";
      timeline.push({ when, t: `${aName} ✕ ${bName} 合击「${comboEv.note || "合击"}」` });
    }
    const phaseEv = evs.find(e => e.kind === "phase");
    if (phaseEv) timeline.push({ when, t: `${foeNames.get(phaseEv.slot) || "关主"} 进入第 ${phaseEv.amount || 1} 形` });
    const breakEv = evs.find(e => e.kind === "break");
    if (breakEv) {
      const who = breakEv.side === 1 ? (foeNames.get(breakEv.slot) || "敌方")
        : (rows.get(breakEv.slot)?.name || "我方");
      timeline.push({ when, t: `${who} 被破防` });
    }
    const benchEv = evs.find(e => e.kind === "bench");
    if (benchEv) timeline.push({ when, t: `${benchEv.note || "候补"} 登场` });
  }
  timeline.splice(0, Math.max(0, timeline.length - 20));   // 只留最近 20 条
  return { rows: [...rows.values()], agg, waveDeaths, timeline, firstDeathTurn };
}

/** 战报 facts（与 content/diagnostics.json 的 facts 键一一对应；win 恒为战败入口不用，但仍带上） */
function reportFacts(result, outcome) {
  const st = reportStats(result);
  const rows = st.rows;
  // worstWave：阵亡最多的波（显示号 1 起）
  let worstWave = 0, worstWaveDeaths = 0;
  for (const [w, n] of st.waveDeaths) if (n > worstWaveDeaths) { worstWave = w; worstWaveDeaths = n; }
  // aoeRound：单回合承受伤害最高的那一轮（回合号）
  let aoeRound = 0, aoeMax = 0;
  let roundTaken = 0, roundNo = 0;
  for (const turn of result.turns || []) {
    if (turn.round !== roundNo) { if (roundTaken > aoeMax) { aoeMax = roundTaken; aoeRound = roundNo; } roundNo = turn.round || 0; roundTaken = 0; }
    for (const ev of turn.events || []) {
      const hostile = ev.kind === "damage" || ev.kind === "crit" || ev.kind === "dotTick";
      if (hostile && ev.side === 0) roundTaken += ev.amount || 0;
    }
  }
  if (roundTaken > aoeMax) { aoeMax = roundTaken; aoeRound = roundNo; }
  // elemBad：我方被克比例 > 0.5（敌方任一六气 beats 我方六气即算被克）
  const foeEls = [...new Set((result.foes || []).flatMap(w => (w.units || []).map(u => u.element)).filter(Boolean))];
  const countered = rows.filter(a => foeEls.some(fe => (DATA.elements[fe] || {}).beats === a.element)).length;
  const elemBad = rows.length > 0 && countered / rows.length > 0.5;
  // turnsOverPar：出手数 / 关卡标谁出手（node.stars.turns，meta.mjs 展开时写入），拿不到就不超
  const stageId = window.__lastBattle?.stageId;
  const node = stageId ? (
    DATA.chapters.flatMap(c => c.nodes).find(n => n.id === stageId)
    || DATA.tower.list.find(n => n.id === stageId)
    || (DATA.dungeons || []).find(n => n.id === stageId)
  ) : null;
  const par = Number(node?.stars?.turns) || 0;
  const allyTurns = Number(result.allyTurns) || 0;
  return {
    deaths: Number.isFinite(result.deaths) ? result.deaths : st.agg.deaths,
    worstWave, worstWaveDeaths,
    aoeRound,
    firstDeathRound: st.firstDeathTurn || 99,
    avgHp: typeof result.avgHpRatio === "number" ? result.avgHpRatio : 1,
    turns: allyTurns,
    turnsOverPar: par > 0 ? allyTurns / par : 0,
    mods: (result.mods || []).map(m => m.id),
    bossPhase: st.agg.bossPhase,
    comboUsed: st.agg.comboUsed,
    ultCount: st.agg.ults,
    healCount: st.agg.healCount,
    elemBad,
    win: !!(outcome && outcome.win) || !!result.win,
  };
}

/** 逐条匹配诊断规则：when 里所有键 AND；后缀 Gte/Lte/Eq/Has 决定比较方式，其余按布尔/原值比 */
function reportMatchRules(facts) {
  const hits = [];
  for (const rule of (DATA && DATA.diagnostics) || []) {
    let ok = true;
    for (const [k, v] of Object.entries(rule.when || {})) {
      if (k.endsWith("Gte")) { if (!((facts[k.slice(0, -3)] ?? 0) >= v)) { ok = false; break; } }
      else if (k.endsWith("Lte")) { if (!((facts[k.slice(0, -3)] ?? 0) <= v)) { ok = false; break; } }
      else if (k.endsWith("Eq")) { if (!((facts[k.slice(0, -2)] ?? 0) == v)) { ok = false; break; } }
      else if (k.endsWith("Has")) {
        const arr = facts[k.slice(0, -3)];
        if (!Array.isArray(arr) || !arr.includes(v)) { ok = false; break; }
      } else if (facts[k] !== v) { ok = false; break; }
    }
    if (ok) hits.push(rule);
    if (hits.length >= 2) break;   // 心结自诊最多两条
  }
  return hits;
}

/** 规则文案里的 {键} 占位符：取展示值（avgHp 换算成百分比整数） */
function reportFillText(text, facts) {
  const map = {
    deaths: facts.deaths,
    worstWave: facts.worstWave,
    worstWaveDeaths: facts.worstWaveDeaths,
    aoeRound: facts.aoeRound,
    firstDeathRound: facts.firstDeathRound,
    turns: facts.turns,
    bossPhase: facts.bossPhase,
    avgHp: Math.round((facts.avgHp || 0) * 100),
  };
  return String(text || "").replace(/\{(\w+)\}/g, (m, k) => (map[k] !== undefined ? String(map[k]) : m));
}

/** 抄作业串：编队 + 候补 + 战术 → 紧凑 JSON → base64（可贴给他人直接复刻配置） */
function reportCopyString() {
  const payload = {
    v: 1,
    stage: (window.__lastBattle || {}).stageId || null,
    team: (typeof S !== "undefined" && S && Array.isArray(S.team)) ? S.team : [],
    bench: (typeof S !== "undefined" && S && S.bench) || null,
    tactics: (typeof S !== "undefined" && S && S.tactics) || null,
  };
  const json = JSON.stringify(payload);
  try { return btoa(unescape(encodeURIComponent(json))); }
  catch (e) { return json; }   // base64 万一失败（极端环境）退回明文 JSON
}

/** 战报全屏弹窗：三个区块（伤害构成 / 时间轴 / 失败诊断）+ 抄作业串 */
function openBattleReport(result, outcome) {
  try {
    result = result || (window.__lastBattle || {}).result || {};
    outcome = outcome || (window.__lastBattle || {}).outcome || {};
    const st = reportStats(result);
    const a = st.agg;
    const win = !!(outcome && outcome.win) || !!result.win;

    /* —— 伤害构成 —— */
    const dmgRows = st.rows.slice().sort((x, y) => y.dmg - x.dmg || y.heal - x.heal);
    const maxDmg = Math.max(1, ...dmgRows.map(r => r.dmg));
    const bars = dmgRows.map(r => `
      <div class="xpb-rp-row">
        <span class="xpb-rp-name" title="${esc(r.name)}">${esc(r.name)}</span>
        <span class="xpb-rp-track"><i class="xpb-rp-fill" style="width:${Math.round(r.dmg / maxDmg * 100)}%"></i></span>
        <span class="xpb-rp-val num">${r.dmg > 0 ? fmtW(r.dmg) : "—"}</span>
      </div>`).join("")
      || `<div class="xpb-rp-empty">本场没有可统计的输出。</div>`;
    const totals = `
      <div class="xpb-rp-tot">
        <span>敌方承受 <b class="num">${fmtW(Math.round(a.foeTaken))}</b></span>
        <span>我方承受 <b class="num">${fmtW(Math.round(a.allyTaken))}</b></span>
        <span>治疗总量 <b class="num">${fmtW(Math.round(a.heal))}</b></span>
        <span>大招 <b class="num">${a.ults}</b> 次</span>
        <span>合击 <b class="num">${a.combos}</b> 次</span>
      </div>`;

    /* —— 时间轴 —— */
    const tl = st.timeline.length ? st.timeline.map(item => `
      <div class="xpb-rp-tlrow"><span class="xpb-rp-tlw num">${esc(item.when)}</span><span class="xpb-rp-tlt">${esc(item.t)}</span></div>
    `).join("") : `<div class="xpb-rp-empty">本场没有关键事件记录。</div>`;

    /* —— 失败诊断（仅战败）—— */
    let diag = "";
    if (!win) {
      const facts = reportFacts(result, outcome);
      const hits = reportMatchRules(facts);
      diag = `
        <div class="xpb-rp-h">心 结 自 诊</div>
        ${hits.length ? hits.map((r, i) => `
          <div class="xpb-rp-diag">
            <b>${i === 0 ? "其一" : "其二"}</b>　${esc(reportFillText(r.text, facts))}
          </div>`).join("")
        : `<div class="xpb-rp-empty">这一仗没有明显的套路问题——多半是练度还差一口气。</div>`}`;
    }

    /* —— 抄作业串 —— */
    const code = reportCopyString();
    const reportIcon = (typeof ICONS !== "undefined" && ICONS.report)
      ? I("report", "width:13px;height:13px;vertical-align:-2px") : "";

    const host = modal(`
      <div class="menu xpb-report">
        <div class="xpb-rp-title">战 报</div>
        <div class="xpb-rp-sub">${win ? "此局已胜，留档复盘" : "此局战败，看看是哪里漏了气"}</div>
        <div class="xpb-rp-h">伤 害 构 成</div>
        ${bars}
        ${totals}
        <div class="xpb-rp-h">时 间 轴</div>
        <div class="xpb-rp-tl">${tl}</div>
        ${diag}
        <div class="xpb-rp-h">抄 作 业 串</div>
        <div class="xpb-rp-sub">含编队 / 候补 / 战术，复制后发给道友即可复刻这套配置。</div>
        <div class="xpb-rp-copy">
          <textarea class="num" readonly spellcheck="false" id="xpbCopyBox">${esc(code)}</textarea>
          <button class="btn" id="xpbCopyBtn">${reportIcon}复 制</button>
        </div>
        <div style="display:flex;gap:10px;margin-top:14px">
          <button class="btn primary" style="flex:1" data-close>关 闭</button>
        </div>
      </div>`, { dimClose: true });

    const btn = host.querySelector("#xpbCopyBtn");
    const box = host.querySelector("#xpbCopyBox");
    if (btn && box) {
      btn.onclick = async () => {
        let ok = false;
        try { await navigator.clipboard.writeText(box.value); ok = true; }
        catch (e) {
          // clipboard 不可用（非安全上下文等）：选中文本让用户手动 Ctrl+C
          try { box.focus(); box.select(); ok = document.execCommand && document.execCommand("copy"); } catch (e2) { /* 放弃 */ }
          if (!ok) box.select();
        }
        toast(ok ? "已复制，去发给道友吧" : "已选中文本，请手动 Ctrl+C 复制");
      };
    }
    blip(660, .06);
  } catch (e) {
    console.warn("[report] 打开战报失败", e);
    try { toast("战报打开失败"); } catch (e2) { /* 忽略 */ }
  }
}
