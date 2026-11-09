/* 拾缘 · battle —— 由 app.js 拆分（2026-10-26） */
async function playBattle(stageId, result, outcome) {
  /* 本场序号：跳过/守门收尾都只作用于自己这一场。
   * 连打多场时旧场次的迟到收尾（清 bvSkipHandler / 关 #battleView）不能踩掉新场次，
   * 否则新一场的「跳过」「自动」按钮会全部失灵（玩家反馈的「多打几场都跳过就卡住」）。 */
  const bvSeq = ++bvBattleSeq;
  bvLive = true;
  /* 开新一场前先把上一场可能残留的演出节点清干净，再恢复输出。
   * 只调 bvFxReset() 是不够的：它只开关「能否写特效」的闸门，不会删 DOM。
   * 上一场若是跳过收尾、又有节点漏清（如 .xpb-phase 全屏黑幕），就会原样叠到新战场上，
   * 连打几场后 #battleView 里堆满全屏遮罩层——玩家看到的正是「跳过几场后整页点不动」。 */
  try { if (typeof bvClearFx === "function") bvClearFx(); } catch (e) { /* 非战斗页无妨 */ }
  try { if (typeof bvFxReset === "function") bvFxReset(); } catch (e) { /* 非战斗页无妨 */ }
  /* 本场演出速度：严格按玩家点选（bvNow 不再给自动连战偷偷加压）。
   * 上一版自动连战强制 ≥4×，玩家选 2× 实际却按 4× 播，画面像被「跳过」。 */
  const bvp = bvNow();
  const bvPlayT0 = performance.now();
  let bvPlayedTurns = 0;
  /* 跳过/停滞的「强制中断」：
   * 演出链里全是 await（投射物、cut-in、hitStop…）。只设一个 skipped 标志的话，要等当前
   * 这段动画自己结束才会在下一回合开头生效——只要有一个动画 Promise 不回来（WAAPI 在切后台
   * 时时间轴冻结、过渡被打断等），点「跳过」就毫无反应，2× 也照样像卡死。
   * 这里给整场准备一个 abort Promise，所有演出 await 都通过 bvAwait 与它竞速：
   * 点跳过 / 判定演出停滞时立刻醒来，直接走结算（结果早已由服务端算好，演出只是回放）。 */
  let bvAbortResolve = null;
  const bvAbort = new Promise(resolve => { bvAbortResolve = resolve; });
  let skipped = false;
  let bvFinished = false;
  let bvEndReason = "turns-done";   // turns-done / foes-dead / allies-dead / skip / stall
  let bvLastBeat = performance.now();
  const bvBeat = () => { bvLastBeat = performance.now(); };
  /* 跳过/看门狗：除了让 bvAwait 立刻醒来，还要把已经在播的演出全部停掉。
   * 只置标志位的话，WAAPI/视频/粒子仍在后台继续跑——玩家看到「已经跳过了，后台还在打」，
   * 连跳几场后多个全屏视频/特效层叠在一起，主线程被拖死，整页就点不动了。 */
  const bvStop = () => {
    skipped = true; bvFinished = true;
    try { if (typeof bvClearFx === "function") bvClearFx(); } catch (e) { /* 清特效失败不影响中断 */ }
    if (bvAbortResolve) bvAbortResolve();
  };
  const bvWatchdogStop = () => { bvEndReason = "stall"; bvStop(); };
  const bvAwait = async p => {
    const r = await Promise.race([Promise.resolve(p), bvAbort]);
    bvBeat();
    return r;
  };
  /* 演出停滞看门狗（不是整场总时长）：
   * 上一版用固定总时限（自动75s/手动240s），长战斗即使一直在正常演，也会到点直接
   * 「跳过剩余回放」——玩家开 2× 仍会偶尔看到战斗被莫名跳过。现在改为「多久没有前进」：
   * 每回合/每条演出结束都 bvBeat() 续命；只有整整 20s（自动）/30s（手动）没有任何进展，
   * 才判定为演出真的卡死并强制收尾。正常打多久都不会被跳。 */
  const BV_STALL_MS = (typeof bvAuto !== "undefined" && bvAuto ? 20000 : 30000);
  const bvStallTick = () => {
    if (bvFinished) return;
    if (!document.getElementById("battleView")?.classList.contains("on")) return;
    // 切到后台时 WAAPI 时间轴会被浏览器冻结，这不是「演出卡死」：回来再重新计时
    if (typeof document !== "undefined" && document.hidden) {
      bvLastBeat = performance.now();
      BGT.tmo(bvStallTick, BV_STALL_MS);
      return;
    }
    const idle = performance.now() - bvLastBeat;
    if (idle >= BV_STALL_MS) {
      console.warn(`[battle] 演出停滞 ${Math.round(idle)}ms，跳过剩余回放直接结算`);
      bvWatchdogStop();
      return;
    }
    BGT.tmo(bvStallTick, Math.max(500, BV_STALL_MS - idle));
  };
  BGT.tmo(bvStallTick, BV_STALL_MS);
  /* 标题/背景钩子（虚境等变体战斗用）：调用方在进来前置 window.__bvTitle / window.__bvBg，
   * 这里先取值再清空（用完即清，避免泄漏到下一场普通战斗），最后回退到按 stageId 推导的默认值。 */
  const xjTitle = window.__bvTitle || null;
  const xjBg = window.__bvBg || null;
  window.__bvTitle = null; window.__bvBg = null;
  const evStage = (DATA.events || []).flatMap(e => (e.stages || []).map(s => ({ ...s, eventId: e.id }))).find(s => s.id === stageId) || null;
  const stage = DATA.chapters.flatMap(c => c.nodes).find(n => n.id === stageId)
    || DATA.tower.list.find(n => n.id === stageId) || DATA.dungeons.find(n => n.id === stageId) || evStage;
  $("#bvTitle").textContent = xjTitle || (stage ? `${stage.name}` : "战 斗");
  $("#bvLog").innerHTML = "";
  $("#bvWave").textContent = "";
  $("#bvBonds").innerHTML = activeBonds().slice(0, 2)
    .map(b => `<span class="bond">羁绊 · ${esc(b.name)}</span>`).join("");

  // 背景：章节势力 → 对应章节底图；活动关 → 活动战斗内景
  const faction = stage?.faction || "all";
  const bgMap = { qx: "stage_qx", yx: "stage_yx", gh: "stage_gh", zf: "stage_zf", cc: "stage_cc", yh: "stage_yh" };
  const bg = evStage ? "event-yaochao-battle" : (bgMap[faction] || xjBg || "stage_all");
  $("#bvBg").style.backgroundImage = `url(/bg/${bg}.jpg)`;

  /* 候补编入后引擎会把替补行追加进 result.allies（同 slot 两行：倒下的原队员 + 候补）。
   * 首见 slot 才建卡/入表（开战时候补还没登场），替补行存进 benchRows，等 bench 事件再换卡。 */
  const units = {};
  const benchRows = {};
  const allyBase = [];
  for (const a of result.allies) {
    const k = `0-${a.slot}`;
    if (units[k]) { benchRows[a.slot] = a; continue; }
    units[k] = { ...a, side: 0 };
    allyBase.push(a);
  }
  /* 波次号有两套：wave 事件里的 amount 是 1 起（"第 N 波"），result.foes[].wave 是 0 起。
   * 之前直接用 amount 去比 f.wave，整场都错开一波（第 1 波显示第 2 波的怪，最后又显示第 1 波的）——
   * c1s05 两波怪几乎一样所以没人发现。这里统一换算。
   * 战场召唤物由引擎并进对应波次的 foes（wave=-1 标记）：开战/换波先不建卡，
   * 等 summon 事件到场再滑入，避免"这一波刚开打召唤物就预先站桩"。 */
  const foesOf = w => ((result.foes.find(f => f.wave === w - 1) || result.foes[0])?.units || [])
    .filter(u => u.wave !== -1);
  const rebuildFoes = w => {
    for (const f of foesOf(w)) units[`1-${f.slot}`] = { ...f, side: 1 };
    $("#bvFoes").innerHTML = foesOf(w).map(u => unitCard(u, 1)).join("");
  };
  rebuildFoes(1);
  $("#bvAllies").innerHTML = allyBase.map(u => unitCard(u, 0)).join("");
  // 开战一律满血起算：turn[0].state 是第一回合打完的终态，不能拿来当开局画面
  btInit(result);
  btPaintAll();
  bvUnits = units;
  bvActing = null;
  bvCastNote = "";
  // 默认选中领队：面板一开场就有内容，玩家点别的卡再切
  bvSel = null;
  bvSkSig = "";
  bvSelect(0, result.allies[0]?.slot ?? 0);
  $("#bvActor").style.opacity = "1";

  const bv = $("#battleView");
  bv.classList.add("on");
  AudioSys.bgm("battle");
  /* 关主登场：本场第一次见到关主时演一次入场（黑幕→妖气→立绘推入→名号/台词）。
   * 关主只站最终波，所以放在波次切换后触发；登仙塔等第一波就有关主的场景则在开场触发。 */
  let bossEntered = false;
  const maybeBossEnter = async (w) => {
    if (bossEntered) return;
    const b = foesOf(w).find(u => u && (u.boss || /^boss-/.test(u.id || "")));
    if (!b) return;
    bossEntered = true;
    await bvAwait(bossEnter(b, bvp));
  };
  // 开战：随机一名存活队员报登场句（不再固定领队）
  const alive0 = (result.allies || []).filter(u => u?.id && (u.hp ?? 1) > 0);
  AudioSys.cv(alive0.length ? alive0[Math.floor(Math.random() * alive0.length)].id : null, "enter", { priority: 2 });
  bvSkipHandler = () => { if (bvSeq !== bvBattleSeq) return; bvEndReason = "skip"; bvStop(); };
  await maybeBossEnter(1);
  let bvCurWave = 1;   // 当前波次（1 起）：summon 事件据此刻对应波里找新单位的身份行

  /* 开战天时横幅：serve 把本关词条回显在 result.mods（[{id,name,desc,icon,tone}]），2.5s 一条 */
  if (Array.isArray(result.mods)) {
    for (const m of result.mods) {
      if (skipped) break;
      await bvAwait(modBannerOnce(m, bvp));
    }
  }

  for (const turn of result.turns) {
    if (skipped) break;
    bvBeat();
    /* 回合开头先验胜负：按"已经演出来的状态"判断，而不是读回合快照——
     * 快照会混进后面回合的伤害（见 btSyncMeta 的说明），拿它判会在大招还没砸下去时就直接收场。
     * 后面还有增援/复生就继续播。 */
    if (turn !== result.turns[0]) {
      const ahead = result.turns.slice(result.turns.indexOf(turn));
      const waveAhead = ahead.some(t => t.events.some(e => e.kind === "wave"));
      const reviveAhead = ahead.some(t => t.events.some(e => e.kind === "revive"));
      const foes = [...BT.live.values()].filter(u => u.side === 1);
      const allies = [...BT.live.values()].filter(u => u.side === 0);
      const foesDead = foes.length > 0 && foes.every(u => !u.alive);
      const alliesDead = allies.length > 0 && allies.every(u => !u.alive) && !reviveAhead;
      if (!waveAhead && (foesDead || alliesDead)) { bvEndReason = foesDead ? "foes-dead" : "allies-dead"; break; }
    }
    // 只有真正进入演出的回合才计数（用来核对「没有被提前截断」）
    bvPlayedTurns++;
    const waveEv = turn.events.find(e => e.kind === "wave");
    if (waveEv) {
      bvCurWave = waveEv.amount;
      rebuildFoes(waveEv.amount);
      // 新一波的怪满血上场（不用回合快照：那份血量可能是这一波刚被打过之后的）
      btWaveEnter(waveEv.amount);
      // 选中的是敌方时，卡片被重建过：把选中态和面板挪到新卡上
      if (bvSel && bvSel.side === 1) {
        const keep = document.getElementById(`bu-1-${bvSel.slot}`) ? bvSel.slot : 0;
        bvSelect(1, keep);
      }
      $("#bvWave").textContent = `第 ${waveEv.amount} / ${result.totalWaves} 波`;
      const banner = $("#bvBanner");
      banner.textContent = waveEv.note || `第 ${waveEv.amount} 波`;
      banner.classList.add("on");
      logLine(`<span style="color:var(--gold)">${esc(waveEv.note || "敌方增援到来")}</span>`);
      await bvAwait(sleep(900 / bvp));
      banner.classList.remove("on");
      /* 最后一波关主上场：先让「第 N 波」横幅退场，再演关主专属入场动画与台词。 */
      await maybeBossEnter(waveEv.amount);
    }
    $("#bvRound").textContent = `回合 ${turn.round}`;
    $$(".buc.on").forEach(e => e.classList.remove("on"));
    const actorEl = document.getElementById(`bu-${turn.actorSide}-${turn.actorSlot}`);
    if (actorEl && turn.actorSide >= 0) actorEl.classList.add("on");
    const actor = units[`${turn.actorSide}-${turn.actorSlot}`];
    const cast = turn.events.find(e => e.kind === "skill_cast");
    // 行动者只做"高亮 + 行动中"标记，不再把底部面板抢过去（面板由玩家点选）
    bvActing = turn.actorSide >= 0 ? { side: turn.actorSide, slot: turn.actorSlot } : null;
    bvCastNote = cast?.note || "";
    bvShowPanel();
    // 面板始终可见，不靠点击才亮起来
    $("#bvActor").style.opacity = "1";

    /* 本回合的事件切片：先分清"这一发打的是谁"，再按顺序一条条演。
     * 单体 / 群伤 / 友军增益全部由事件本身决定（谁的卡上出现 damage、谁的卡上出现 buff），
     * 不再靠"技能文本写着单体"这种间接信息——所以特效只会落在真正结算过的卡上。 */
    const evs = turn.events.filter(e => !["turn", "skill_cast", "wave"].includes(e.kind));
    const hits = evs.filter(e => e.kind === "damage" || e.kind === "crit");
    const supports = evs.filter(e => SUPPORT_EVS.has(e.kind));
    const hitKeys = [...new Set(hits.map(e => btKey(e.side, e.slot)))];
    const group = hitKeys.length > 1;   // 真正多目标=群伤；同一目标多段仍按段逐个飞
    // 角色档案里的 vfx.variant 是 build 写入的角色层演出配置（同元素同定位也能区分）。
    // 之前只写进了 character.json 却没人读——这里统一取出，普攻/终式两条链路共用。
    const card = actor?.id ? charById(actor.id) : null;
    const meta = {
      element: actor?.element,
      role: card?.role,
      charId: actor?.id,
      atkVariant: card?.vfx?.variant?.attack || null,
      ultVariant: card?.vfx?.variant?.ult || null,
      ultName: card?.vfx?.variant?.ultName || null,
      ultVideo: card?.vfx?.signature?.video || null,
      ultCvSync: !!card?.vfx?.signature?.cvSync,
    };
    let ultPlayed = false;   // 终式满屏演出已经砸过了，伤害事件里不再补投射物
    let firstHit = true;
    /* 空场回合防御（2026-11-03 玩家反馈「第一波怪全死了还放大招」）：
     * 引擎侧已修「同帧清波后不许再出手」；这里再加一道前端兜底——如果这一回合没有任何
     * 伤害/增益事件、而当前这波敌人已经全部倒下，说明这是一条旧回放里的空场出手记录，
     * 不再播蓄势/终式动画（否则玩家会看到角色对着满地尸体放一次大招）。 */
    const liveFoesNow = [...BT.live.values()].filter(u => u.side === 1);
    const liveAlliesNow = [...BT.live.values()].filter(u => u.side === 0);
    const allFoesDownNow = liveFoesNow.length > 0 && liveFoesNow.every(u => !u.alive);
    const allAlliesDownNow = liveAlliesNow.length > 0 && liveAlliesNow.every(u => !u.alive);
    const noEffectCast = !!cast && hits.length === 0 && supports.length === 0
      && (actor?.side === 0 ? allFoesDownNow : allAlliesDownNow);

    if (cast && !noEffectCast) {
      logLine(`${esc(actor?.name || "?")} · <span style="color:${cast.amount === 1 ? "var(--gold)" : "var(--ink)"}">${esc(cast.note || "出手")}</span>`);
      const isUlt = cast.amount === 1;
      const ultSkill = actor && charById(actor.id)?.skills.find(s => s.slot === "ultimate" && s.name === cast.note);
      // 出手前先给行动者一个蓄势动作，让"轮到谁出手"看得见
      if (actor && turn.actorSide >= 0) castWindup(turn.actorSide, turn.actorSlot, actor.element, isUlt);
      AudioSys.sfx(isUlt ? "ult_charge" : "whoosh");
      if (isUlt) {
        // 双方都出声：我方跟全屏 cut-in，敌方跟横幅（小怪放大招也有声音分量）
        // 带专属大招视频（cvSync）的角色不在 cutIn 里播 CV —— 否则 1.75s 静态立绘会把
        // 3.05s 的台词吃掉一大半，等视频真正开始时只剩尾音。改为 cutIn 结束后与视频同起点播。
        if (actor && actor.side === 0 && !meta.ultVideo) AudioSys.cv(actor.id, "ultimate", { priority: 2 });
        /* 终式目标集合来自事件：
         *   有伤害 → 被打的敌方卡（单体就只有一张，群伤才铺开）
         *   纯增益 → 被加成的友军卡（buff 特效必须落在友军身上）
         */
        const friendly = hits.length === 0 && supports.length > 0;
        const pickEvs = friendly ? supports : hits;
        const tSide = friendly ? (actor?.side ?? 0) : (actor?.side === 0 ? 1 : 0);
        const tSlots = [...new Set(pickEvs.map(e => e.slot))];
        const anchors = anchorsOf(tSide, tSlots);
        // 演出必须串行：立绘铺完退场 → 招式特效砸在目标卡上 → 才轮到下面的伤害结算
        // 有专属视频的角色跳过静态 cutIn：视频本身就是人物动画，再垫 1.75s 立绘等于同一段演出放两遍，
        // 而且 CV 与视频会错开 1.75s。只在视频缺失（降级回元素特效）时才保留立绘 cut-in。
        if (!meta.ultVideo && actor && actor.side === 0 && ultSkill) await bvAwait(cutIn(actor, cast.note, ultSkill.desc, bvp));
        else if (!meta.ultVideo) await bvAwait(foeCastBanner(actor, cast.note, bvp));
        await bvAwait(sleep(60 / bvp));
        if (actor) {
          // cvSync：视频开播同一帧起 CV，3.03s 画面与 3.05s 台词同起同收
          if (meta.ultVideo && actor.side === 0) AudioSys.cv(actor.id, "ultimate", { priority: 2 });
          await bvAwait(ultBarrage(actor.element, bvp, {
            anchors, spread: tSlots.length > 1, friendly,
            variant: meta.ultVariant,
            name: meta.ultName || cast.note,
            video: meta.ultVideo,
            cvSync: meta.ultCvSync,
          }));
          if (!friendly) shake("md");
        }
        ultPlayed = true;
      } else if (!hits.length && supports.length && actor) {
        // 纯辅助/纯状态术法：把效果送到真正被作用的那张卡上，而不是"放了但屏幕上什么都没发生"
        await bvAwait(supportCast(actor, supports, meta));
      }
    }

    for (let ei = 0; ei < evs.length; ei++) {
      const ev = evs[ei];
      /* 跳过/看门狗已触发：本条之后的所有事件都不再演。
       * bvAwait 只让 await 立刻醒来，底层特效 Promise 不会被取消；如果不在这里断，
       * 点过「跳过」后整串伤害/飘字/粒子仍会在后台继续往战场上写——玩家看到的
       * 就是「跳过了但后台还在打」，连跳几场后残留演出叠满，整页点不动。 */
      if (skipped) break;
      // 战斗里事件密集（尤其 ×2/×4 倍速），用更宽的门控把连响糊成噪音墙的情况挡掉
      const g = SFX_GATE_BATTLE;
      const tgtUnit = units[btKey(ev.side, ev.slot)];
      // 受击方元素的颜色：优先取该单位的元素，取不到用攻击者元素兜底
      const tgtEl = tgtUnit?.element || actor?.element;
      const isHit = ev.kind === "damage" || ev.kind === "crit";

      /* ① 先出手：投射物砸到目标身上之后，才轮到下面的扣血/飘字/判死。
       *    群伤一次性齐射（每个目标都有东西飞过去），单体只打它自己的目标。 */
      if (isHit && !ultPlayed && actor) {
        if (group) {
          if (firstHit) {
            firstHit = false;
            await bvAwait(volleyAll(actor, hitKeys, meta));
            await bvAwait(sleep(30 / bvp));
          }
        } else {
          firstHit = false;
          await bvAwait(strikeOnce(actor, ev.side, ev.slot, meta));
          // 会心顿得比普通命中久一点，让"暴击"这个信号更明确
          if (ev.kind === "crit") {
            shake("sm");
            await bvAwait(hitStop(ev.side, ev.slot, { speed: bvp, ms: 95 }));
          } else {
            await bvAwait(hitStop(ev.side, ev.slot, { speed: bvp, ms: 66 }));
          }
        }
      }

      /* ② 结算 + 反馈：血条/飘字/状态图标都在这一条里更新 */
      switch (ev.kind) {
        case "damage":
        case "crit": {
          const isCrit = ev.kind === "crit";
          const wasAlive = !!BT.live.get(btKey(ev.side, ev.slot))?.alive;
          const r = btDamage(ev.side, ev.slot, ev.amount);
          // 尸体上不再飘伤害数字/打击反馈（引擎在"多段"里会把后续段打在已经倒下的人身上）
          if (!wasAlive) break;
          if (r.through > 0 || r.absorbed <= 0) {
            floatText(ev.side, ev.slot, `${isCrit ? "会心 " : ""}-${Math.round(r.through || ev.amount)}`, isCrit ? "crit" : "dmg");
          } else {
            // 全被护盾吃掉了：别让玩家以为血掉了，也别让血条纹丝不动地"挨了一下"
            floatText(ev.side, ev.slot, `盾挡 ${Math.round(r.absorbed)}`, "shld");
          }
          hitFeedback(ev.side, ev.slot, { element: tgtEl, crit: isCrit, unit: tgtUnit });
          AudioSys.sfx(isCrit ? "crit" : "hit", { gate: g });
          break;
        }
        case "dotTick": {
          const r = btDamage(ev.side, ev.slot, ev.amount);
          floatText(ev.side, ev.slot, `${Math.round(r.through || ev.amount)} 持续`, "dot");
          hitFeedback(ev.side, ev.slot, { element: tgtEl });
          AudioSys.sfx("magic", { gate: g });
          break;
        }
        case "heal": {
          const gained = btHeal(ev.side, ev.slot, ev.amount);
          if (gained > 0) floatText(ev.side, ev.slot, `+${Math.round(gained)}`, "heal");
          buffFeedback(ev.side, ev.slot, "heal");
          AudioSys.sfx("heal", { gate: g });
          break;
        }
        case "shield": {
          btShieldUp(ev.side, ev.slot, ev.amount, ev.turns || 1);
          const fresh = btStatusAdd(ev.side, ev.slot, {
            stat: "shield", op: "add", value: ev.amount, turns: ev.turns || 1, kind: "buff",
          });
          if (fresh) floatText(ev.side, ev.slot, `盾+${Math.round(ev.amount)}`, "shld");
          buffFeedback(ev.side, ev.slot, "shield");
          AudioSys.sfx("shield", { gate: g });
          break;
        }
        case "buff":
        case "debuff": {
          const stat = ev.note || "buff";
          const fresh = btStatusAdd(ev.side, ev.slot, {
            stat, op: ev.op || "mul", value: ev.amount, turns: ev.turns || 1, kind: ev.kind,
          });
          // 只给"新得到的"飘字：每回合都被被动刷新一遍的 buff 不该每回合刷屏
          if (fresh) {
            floatText(ev.side, ev.slot, `${btStatInfo(stat).cn}${btValueText({ stat, op: ev.op || "mul", value: ev.amount }, null)}`,
              ev.kind === "buff" ? "buff" : "debuf");
          }
          buffFeedback(ev.side, ev.slot, ev.kind === "buff" ? "buff" : "curse");
          AudioSys.sfx(ev.kind === "buff" ? "heal" : "magic", { gate: g, gain: 0.55 });
          break;
        }
        case "dot": {
          // 挂上持续伤害（不是立刻掉血）：卡片下出现"持续伤害 N/回合"图标
          const fresh = btStatusAdd(ev.side, ev.slot, {
            stat: "dot", op: "add", value: ev.amount, turns: ev.turns || 2, kind: "debuff",
          });
          if (fresh) floatText(ev.side, ev.slot, `持续 ${Math.round(ev.amount)}`, "debuf");
          buffFeedback(ev.side, ev.slot, "curse");
          AudioSys.sfx("magic", { gate: g, gain: 0.7 });
          break;
        }
        case "stun":
        case "silence": {
          const turns = ev.turns || Math.round(ev.amount) || 1;
          const fresh = btStatusAdd(ev.side, ev.slot, {
            stat: ev.kind, op: "add", value: turns, turns, kind: "debuff",
          });
          if (fresh) floatText(ev.side, ev.slot, `${btStatInfo(ev.kind).cn} ${turns}`, "debuf");
          buffFeedback(ev.side, ev.slot, "curse");
          AudioSys.sfx("magic", { gate: g, gain: 0.8 });
          break;
        }
        case "mark": {
          const turns = ev.turns || 2;
          const fresh = btStatusAdd(ev.side, ev.slot, {
            stat: "mark", op: "mul", value: 1 + (ev.amount || 0), turns, kind: "debuff",
          });
          if (fresh) floatText(ev.side, ev.slot, "标 记", "debuf");
          buffFeedback(ev.side, ev.slot, "curse");
          break;
        }
        case "taunt":
        case "stealth": {
          const turns = ev.turns || Math.round(ev.amount) || 1;
          const fresh = btStatusAdd(ev.side, ev.slot, { stat: ev.kind, op: "add", value: 1, turns, kind: "buff" });
          floatText(ev.side, ev.slot, btStatInfo(ev.kind).cn, "buff");
          buffFeedback(ev.side, ev.slot, "buff");
          // 嘲讽/匿影会改变敌方单体选目标，给第一次看到的玩家一句解释，避免以为打错了
          if (fresh) toast(ev.kind === "taunt" ? "嘲讽：敌方单体技能只能打他" : "匿影：不会被单体技能选中");
          break;
        }
        case "dispel": {
          if (ev.amount > 0) {
            // 只用"和引擎同一套规则"清负面：定身/缄口、降低面板的 mul<1、扣值的 add<0。
            // 持续伤害是 add>0 的正值状态，引擎的 Dispel 不会动它，这里也不能抹掉它的图标。
            btStatusDrop(ev.side, ev.slot, st => {
              if (["dot", "mark", "taunt", "stealth", "shield"].includes(st.stat)) return false;
              if (st.stat === "stun" || st.stat === "silence") return true;
              const v = Number(st.value);
              if (!isFinite(v)) return false;
              return st.op === "mul" ? v < 1 : v < 0;
            });
            floatText(ev.side, ev.slot, "驱 散", "buff");
            burst(ev.side, ev.slot, "light", { n: 8 });
          }
          break;
        }
        case "shieldBreak": {
          btShieldBreak(ev.side, ev.slot, ev.amount);
          floatText(ev.side, ev.slot, "破 盾", "debuf");
          AudioSys.sfx("crit", { gate: g, gain: 0.7 });
          break;
        }
        case "revive": {
          if (ev.amount > 0) {
            btRevive(ev.side, ev.slot, 0.3);
            floatText(ev.side, ev.slot, "复 生", "heal");
            buffFeedback(ev.side, ev.slot, "heal");
            burst(ev.side, ev.slot, "light", { n: 12, big: true });
            AudioSys.sfx("heal", { gate: g, gain: 1.15 });
          }
          break;
        }
        /* —— 扩展事件（DESIGN-EXPANSION）：演出各自 try/catch，失败只跳过本条，绝不卡死回放 —— */
        case "combo": {
          try {
            // 合击名在 combo 事件上，双方与台词随其后的 comboLine（slot=副位）：向前看一条拿全
            const lineEv = evs[ei + 1];
            const uA = units[`0-${ev.slot}`] || actor;
            const uB = lineEv && lineEv.kind === "comboLine" ? units[`0-${lineEv.slot}`] : null;
            await bvAwait(comboCutIn(uA, uB, ev.note || "合击", lineEv?.kind === "comboLine" ? lineEv.note : "", bvp));
            logLine(`<span style="color:var(--gold-hi)">${esc(uA?.name || "?")} ✕ ${esc(uB?.name || "?")} · ${esc(ev.note || "合击")}</span>`);
          } catch (err) { console.warn("[battle] 合击演出失败，跳过", err); }
          break;
        }
        case "comboLine":
          // 台词已随 combo 的 cut-in 一起演出，这里不再重复
          break;
        case "phase": {
          try {
            const boss = units[`1-${ev.slot}`];
            // 事件结构：slot=boss 槽位，amount=第几阶段，note=台词（引擎默认「第 X 阶段」）
            // 阶段台词与暗幕同起：phase-1/2/3 的 CV 已按阶段录好，之前只演字不出声。
            // 字幕优先用档案里的阶段台词（与 CV 同源），没有才回退引擎 note。
            const phaseLine = (boss?.id && typeof bossLineOf === "function")
              ? (bossLineOf(boss.id, `phase-${Number(ev.amount) || 1}`) || ev.note) : ev.note;
            if (boss?.id && typeof bossHasCv === "function" && bossHasCv(boss.id, `phase-${Number(ev.amount) || 1}`)) {
              AudioSys.cv(boss.id, `phase-${Number(ev.amount) || 1}`, { priority: 3 });
            }
            await bvAwait(phaseDescend(boss?.name, ev.amount, phaseLine, bvp));
            logLine(`<span style="color:var(--gold)">${esc(boss?.name || "关主")} 进入第 ${ev.amount || 1} 形</span>`);
          } catch (err) { console.warn("[battle] 阶段演出失败，跳过", err); }
          break;
        }
        case "break": {
          try {
            // 破防：目标韧性归零。红光边由 btPaint 按 broken 标记挂到卡片上
            const bu = BT.live.get(btKey(ev.side, ev.slot));
            if (bu) { bu.tough = 0; bu.broken = true; btPaint(ev.side, ev.slot); }
            breakShatterFx(ev.side, ev.slot);
          } catch (err) { console.warn("[battle] 破防演出失败，跳过", err); }
          break;
        }
        case "reaction": {
          try { reactionBubble(ev.side, ev.slot, ev.note); }
          catch (err) { console.warn("[battle] 六气反应演出失败，跳过", err); }
          break;
        }
        case "bench": {
          try {
            // 候补落在首个倒下队友的槽位：把那张卡整体换成候补本人的身份行，满血新体上场
            const slot = ev.slot;
            const row = benchRows[slot] || [...(result.allies || [])].filter(a => a.slot === slot).pop();
            const old = document.getElementById(`bu-0-${slot}`);
            if (row && old) {
              units[`0-${slot}`] = { ...row, side: 0 };
              old.outerHTML = unitCard(row, 0);
              BT.shield.delete(btKey(0, slot));
              BT.status.delete(btKey(0, slot));
              const maxHp = row.maxHp || row.hp || 1;
              const tm = Number(row.toughMax) || 0;
              BT.live.set(btKey(0, slot), { side: 0, slot, hp: maxHp, maxHp, shield: 0, energy: 0, alive: true, tough: tm, toughMax: tm, broken: false });
              btPaint(0, slot);
              unitSlideIn(0, slot, "候补登场");
              logLine(`<span style="color:var(--gold)">${esc(row.name || ev.note || "候补")} 登场</span>`);
              AudioSys.sfx("heal", { gate: g, gain: 0.9 });
            } else if (old) {
              floatText(0, slot, "候补登场", "buff");
            }
          } catch (err) { console.warn("[battle] 候补登场演出失败，跳过", err); }
          break;
        }
        case "summon": {
          try {
            const slot = ev.slot;
            if (!document.getElementById(`bu-1-${slot}`)) {
              const wrow = result.foes.find(f => f.wave === bvCurWave - 1) || result.foes[0];
              const row = (wrow?.units || []).find(u => u.slot === slot);
              if (row) {
                units[`1-${slot}`] = { ...row, side: 1 };
                $("#bvFoes").insertAdjacentHTML("beforeend", unitCard(row, 1));
                const maxHp = row.maxHp || row.hp || 1;
                const tm = Number(row.toughMax) || 0;
                BT.live.set(btKey(1, slot), { side: 1, slot, hp: maxHp, maxHp, shield: 0, energy: 0, alive: true, tough: tm, toughMax: tm, broken: false });
                btPaint(1, slot);
                unitSlideIn(1, slot, "召 唤");
                logLine(`${esc(row.name || ev.note || "召唤物")} 加入战场`);
              }
            }
          } catch (err) { console.warn("[battle] 召唤演出失败，跳过", err); }
          break;
        }
        case "modPulse": {
          try {
            // 天时周期脉冲（瘴气掉血等）：全场每单位一条事件，轻量浮字 + 8s 节流的顶部提示
            if (BT.live.get(btKey(ev.side, ev.slot))?.alive) {
              const r = btDamage(ev.side, ev.slot, ev.amount);
              floatText(ev.side, ev.slot, `瘴 -${Math.round(r.through || ev.amount)}`, "dot");
              AudioSys.sfx("magic", { gate: g, gain: 0.4 });
            }
            modPulseHint(ev.note);
          } catch (err) { console.warn("[battle] 天时脉冲演出失败，跳过", err); }
          break;
        }
        case "death": {
          btKill(ev.side, ev.slot);
          logLine(`<span style="color:#d0563c">${esc(ev.note || "有人")} 倒下</span>`);
          const dEl = cardEl(ev.side, ev.slot);
          if (dEl) dEl.classList.add("hit-kill");
          shake("md");
          AudioSys.sfx("death", { gate: 0.25 });
          break;
        }
        default:
          // energy 之类不画：怒气在回合末随快照对齐
          break;
      }
    }
    // 回合末：行动者自己的状态/护盾计时 -1（引擎就是在这个单位自己的回合末递减）
    if (turn.actorSide >= 0) {
      btStatusTick(turn.actorSide, turn.actorSlot);
      btShieldTick(turn.actorSide, turn.actorSlot);
    }
    // 快照只同步怒气与上限：血量/护盾/生死一律以事件为准（快照会含后面回合的伤害）
    btSyncMeta(turn.state);
    // 面板刷新选中单位的实时数值（血量/怒气/六维/状态）；不跟着行动者换人
    bvPanelRefresh();
    await bvAwait(sleep(Math.max(140, (result.turns.length > 40 ? 300 : 480)) / bvp));
  }

  /* 已经被新一场接替：旧场次直接静默退场，绝不碰新场次的界面与结算 */
  if (bvSeq !== bvBattleSeq) return;
  $$(".buc.on").forEach(e => e.classList.remove("on"));
  await bvAwait(sleep(500 / bvp));
  if (bvSeq !== bvBattleSeq) return;
  bvFinished = true;
  bvLive = false;
  bvSkipHandler = null;
  /* 诊断标记：验收/玩家反馈「战斗被跳过」时可直接查这一场到底演了多少回合、是否被中止 */
  window.__bvLastPlay = {
    stageId, skipped, endReason: bvEndReason, playedTurns: bvPlayedTurns, totalTurns: result.turns.length,
    ms: Math.round(performance.now() - bvPlayT0), speed: bvp, mode: (typeof bvAuto !== "undefined" && bvAuto) ? "auto" : "manual",
  };
  AudioSys.sfx(outcome.win ? "victory" : "defeat");
  AudioSys.bgm(SCREEN_BGM[cur] || "home");
  closeBattle(bvSeq);
  // 战斗已经把 S.cleared 换新（api 回填 save），但各屏 DOM 还是进场前那一版，
  // 不重画就会出现"打赢了外面关卡还显示未通关，点一下才生效"。
  // 把 outcome 传进去：胜利时刷新会顺带把选中推进到下一关/下一层。
  refreshAfterBattle(outcome);
  // 留一份最近战斗给战报面板（settle 的「战报」按钮与 report.js 都从这里取数）
  window.__lastBattle = { stageId, result, outcome };
  showSettlement(stageId, result, outcome);
  if (bvAuto) {
    await sleep(900);
    /* 这 900ms 里玩家可能已经点了结算里的「下一关」开了新的一场：
     * 旧场次的自动链必须就此收手，否则会再并发开一场，两场共用 bvSkipHandler，
     * 先结束的一场把战斗层关掉，另一场就成了「界面在、按钮全死」。 */
    if (bvSeq !== bvBattleSeq) return;
    closeModal();
    // 自动连战：胜了就顺「下一关」链推进（登仙塔=下一层，跨章进下一章首关）；
    // 败仗/已通到头/副本活动等无下一关 → 原地再战（原扫荡行为）。
    const nxt = outcome.win ? (nextStageId(stageId) || stageId) : stageId;
    // 熔断：同一关连着打不动就停（否则会在打不过的关上一轮轮空转，把引擎连着打爆）
    // 宝箱关的结算异常会让本场没有 outcome.win（服务端已把异常吞成 actionError），
    // 这种"没推进"的场次也必须计数——否则会在同一关无限重试，把服务端连打到卡死。
    if (outcome && outcome.win && nxt !== stageId) { bvFailRun = 0; bvAdvRun++; }
    else {
      bvFailRun++;
      if (bvFailRun >= BV_FAIL_LIMIT) {
        return stopAuto(`连续 ${BV_FAIL_LIMIT} 场未能推进，自动战斗已停止（可查看战报确认原因）`);
      }
    }
    if (S.wallet.stamina < stageStamina(nxt)) {
      return stopAuto("心神不足，自动战斗停止");
    }
    // 节流：连战时每场之间留一点喘息，避免一轮接一轮地压引擎进程池
    await sleep(bvAdvRun > 0 ? 350 : 1200);
    if (!bvAuto) return;          // 间隔里玩家点了停自动
    if (bvSeq !== bvBattleSeq) return;  // 间隔里玩家已手动开了新一场，旧链让位
    return doBattleInner(nxt);    // 连战内部直接进下一场，不经过 doBattle 的单场锁
  }
}

/** 战斗结束后重画当前屏：关卡星数/解锁态/资源都在这一帧对齐 */
