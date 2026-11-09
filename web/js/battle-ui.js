/* 拾缘 · battle-ui —— 由 app.js 拆分（2026-10-26） */
/* ================= 战斗回放 ================= */

let bvTimer = null;
// 演出节奏基准：0.5 = 比 1:1 慢一倍；按钮在 0.5/1/2 间循环。上次选择存 localStorage，刷新不丢。
let bvSpeed = (() => {
  const v = +localStorage.getItem("sy_bvSpeed");
  /* 默认 2×：0.5× 下 30+ 回合的长关单场要演 90 秒以上（实测 c1s05 90.5s），
   * 玩家连打几场就会以为「卡死」。玩家手动点速度按钮仍可切回 0.5×/1×。 */
  return [0.5, 1, 2].includes(v) ? v : 2;
})();
/* 实际演出速度：严格按玩家点选的速度，不再偷偷加压。
 * 2026-11-03 反馈「我开2倍速，有时候还跳过的」：上一版为了压短自动连战，把自动模式强制
 * 提到 ≥4×——玩家明明选的 2×，实际却按 4× 播，画面就会像被「跳过」了一样。
 * 现在自动连战也尊重 bvSpeed；长时间不推进的问题交给 playBattle 的「停滞看门狗」兜底，
 * 不再靠偷偷加速或整场总时限来掩盖。 */
function bvNow() {
  return bvSpeed;
}
// 静态按钮初始文案跟随记忆值（index.html 里写死的是 ×0.5；本文件在 body 尾部加载，元素已存在）
{
  const b = document.getElementById("bvSpeed");
  if (b) b.textContent = `速度 ×${bvSpeed}`;
}

/* —— 战斗播放 v3：卡牌式布局 / 行动者面板 / 技能卡 / 终式 cut-in —— */

/** 关主专用：不套卡牌框，动态抠图立绘直接站在战场上，配一条远长于小怪的血条 / 怒气条 */
function bossUnit(u, side, rc, roleCode = u.role || "") {
  const el = ECOLOR(u.element) || "#e8c98a";
  return `<div class="boss-unit" id="bu-${side}-${u.slot}" data-side="${side}" data-slot="${u.slot}"
    style="--boss-el:${el};--buc-glow:${rc}">
    <div class="boss-mark">关 主</div>
    <div class="boss-figure">
      <div class="boss-aura"></div>
      <img class="boss-art" src="${art(u.id, "dynamic")}" alt="" data-fb="standee,portrait,card">    </div>
    <div class="boss-name">${esc(u.name)}</div>
    <div class="boss-sub num">Lv.${u.level} · ${ELABEL(u.element) || "缘"}气${roleCode ? ` · ${esc(RPOS(roleCode) || RLABEL(roleCode) || "")}` : ""}</div>
    <div class="bshield" id="bsh-${side}-${u.slot}"></div>
    <div class="boss-hp"><i id="bhp-${side}-${u.slot}" style="width:100%"></i>
      <span id="bhpt-${side}-${u.slot}">0 / 0</span></div>
    ${(u.toughMax || 0) > 0 ? `<div class="btough" id="btg-${side}-${u.slot}"><i style="width:100%"></i><b class="btg-brk">破</b></div>` : ""}
    <div class="boss-en"><i id="ben-${side}-${u.slot}" style="width:0%"></i>
      <span id="bent-${side}-${u.slot}" class="num">0</span></div>
    <div class="bbuffs boss-buffs" id="bbf-${side}-${u.slot}"></div>
  </div>`;
}

function unitCard(u, side) {
  const rc = RCOLOR(u.rarity || "blue");
  const isBoss = u.boss || /^boss-/.test(u.id || "");
  const roleCode = u.role || (typeof charById === "function" ? charById(u.id)?.role : "") || "";
  if (isBoss) return bossUnit(u, side, rc, roleCode);
  return `<div class="buc ${isBoss ? "is-boss" : ""} ${u.rarity === "diamond" ? "r-diamond" : ""}" id="bu-${side}-${u.slot}" data-side="${side}" data-slot="${u.slot}"
    style="--buc-glow:${rc}44">
    ${u.rarity === "diamond" ? `<i class="dframe"></i><span class="dgem tl"></span><span class="dgem tr"></span><span class="dgem bl"></span><span class="dgem br"></span>` : ""}
    ${isBoss ? `<span class="bossmark">关 主</span>` : ""}
    <span class="brt" style="color:${rc};border-color:${rc}">${RTAG(u.rarity || "blue")}</span>
    <span class="bechip" style="background:${ECOLOR(u.element) || "#888"}">${ELABEL(u.element) || "缘"}</span>
    ${roleCode ? `<span class="bpos">${esc(RPOS(roleCode) || RLABEL(roleCode) || "")}</span>` : ""}
    <div class="bart"><img src="${art(u.id, "portrait")}" alt=""
      data-fb="standee,card,avatar"><div class="bshield" id="bsh-${side}-${u.slot}"></div></div>
    <div class="bname">${esc(u.name)}</div>
    <div class="blv num">Lv.${u.level}</div>
    <div class="bhpbar"><i id="bhp-${side}-${u.slot}" style="width:100%;background:linear-gradient(90deg,#5fbf7f,#3f9f63)"></i>
      <span id="bhpt-${side}-${u.slot}">0 / 0</span></div>
    ${(u.toughMax || 0) > 0 ? `<div class="btough" id="btg-${side}-${u.slot}"><i style="width:100%"></i><b class="btg-brk">破</b></div>` : ""}
    <div class="benbar" data-tip="怒气|满 100 可放终式">
      <i id="ben-${side}-${u.slot}" style="width:0%"></i>
      <span id="bent-${side}-${u.slot}" class="num">0</span>
    </div>
    <div class="bbuffs" id="bbf-${side}-${u.slot}"></div>
  </div>`;
}

/* ================= 战斗状态追踪（事件驱动） =================
 * 为什么不"按回合快照摆血条"：turn.state 是这一回合全部打完之后的终态。
 * 直接拿它刷 UI 会出三个毛病：
 *   ① 开局先 applySnap(turns[0].state)，第一回合还没演，怪就已经是打完的样子/已经躺了；
 *   ② 一次群攻打五个目标，五下特效要飞两秒，血条却一动不动，整轮结束时一起掉；
 *   ③ 死亡同理：人还没出手，怪先黑掉。
 * 现在改成每条事件推进一次状态——投射物砸到谁身上，谁的血条才动；倒下的也确实是挨完那一下。
 * 回合末仍然用权威快照对账，防止逐条累加与引擎有细微出入（免死/护盾吸收之类）。
 */
const BT = {
  live: new Map(),     // "side-slot" → {side,slot,hp,maxHp,shield,energy,alive}
  status: new Map(),   // "side-slot" → [{stat,op,value,turns,stacks,kind}]（卡片下的状态图标）
  shield: new Map(),   // "side-slot" → [{left,turns}]（护盾按层记，逐层过期）
};
const btKey = (side, slot) => `${side}-${slot}`;
/** 非伤害结算类事件：友军增益/减益/治疗/护盾/持续伤害。用来判断"这一发到底打在谁身上" */
const SUPPORT_EVS = new Set(["buff", "debuff", "heal", "shield", "dot", "mark", "stun", "silence", "taunt", "stealth"]);

/* ---- 状态图标的字形（12px 下也认得出，不借用界面大图标） ---- */
const BST_ICON = {
  sword: '<path d="M14.5 3.5 20.5 9.5 10 20l-4 1 1-4Z"/><path d="M13.2 6.8l4 4"/>',
  shield: '<path d="M12 3l7 2.6v5.2c0 4.6-3 8.3-7 10.2-4-1.9-7-5.6-7-10.2V5.6Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h13a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  crit: '<path d="M12 3.5 14 9l5.5 2-5.5 2-2 5.5-2-5.5L4.5 11 10 9Z"/>',
  drop: '<path d="M12 3.6c3.4 4.3 5.8 6.8 5.8 9.7a5.8 5.8 0 0 1-11.6 0c0-2.9 2.4-5.4 5.8-9.7Z"/>',
  bolt: '<path d="M13 3 5.5 14H11l-1 7 8-11h-5.5Z"/>',
  mute: '<path d="M4 9.5h4l5-4v13l-5-4H4Z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/>',
  eye: '<path d="M2.5 12S6.2 6 12 6s9.5 6 9.5 6-3.7 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 1.8"/>',
  heart: '<path d="M12 20S4.5 15 4.5 9.6C4.5 7 6.5 5 9 5c1.3 0 2.4.6 3 1.5C12.6 5.6 13.7 5 15 5c2.5 0 4.5 2 4.5 4.6C19.5 15 12 20 12 20Z"/>',
  spark: '<path d="M12 4l1.6 4.9L18.5 10.5 13.6 12.1 12 17l-1.6-4.9L5.5 10.5l4.9-1.6Z"/>',
  up: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  feather: '<path d="M20 4c-6 .4-11 3-13 8.5L5 20l3.5-1.5C14 18 18.5 12 20 4Z"/><path d="M6 18 15 9"/>',
};
const bstSvg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BST_ICON[n] || BST_ICON.spark}</svg>`;

/** 状态 → 中文名 / 图标。key 与 C# 里 stat 的取值一一对应（tools/lib/skill-text.mjs 的 STAT_CN 同源）。 */
const BST_STAT = {
  atk: { cn: "攻击", icon: "sword" },
  def: { cn: "防御", icon: "shield" },
  mdef: { cn: "法抗", icon: "shield" },
  hp: { cn: "生命上限", icon: "heart" },
  spd: { cn: "速度", icon: "wind" },
  crit: { cn: "暴击", icon: "crit" },
  healRecv: { cn: "受治疗", icon: "plus" },
  healOut: { cn: "治疗量", icon: "plus" },
  dot: { cn: "持续伤害", icon: "drop", bad: true },
  dotReduce: { cn: "持续伤害减免", icon: "drop", good: true },
  dmgTake: { cn: "受伤加深", icon: "target", bad: true },
  dmgTaken: { cn: "受伤加深", icon: "target", bad: true },
  skillCoef: { cn: "技能威力", icon: "spark" },
  ultCoef: { cn: "终式威力", icon: "spark" },
  nextAtkCoef: { cn: "下次攻击", icon: "sword" },
  debuffedBonus: { cn: "对负面目标增伤", icon: "sword" },
  vsControlled: { cn: "对受控目标增伤", icon: "sword" },
  aoeReduce: { cn: "群伤减免", icon: "shield", good: true },
  evasion: { cn: "闪避", icon: "feather", good: true },
  graze: { cn: "免死", icon: "heart", good: true, count: true },
  extraAction: { cn: "额外行动", icon: "clock", good: true, count: true },
  silenceImmune: { cn: "缄口免疫", icon: "mute", good: true, count: true },
  debuffExtend: { cn: "负面延长", icon: "clock", count: true },
  taunt: { cn: "嘲讽", icon: "target", neutral: true },
  stealth: { cn: "匿影", icon: "eye", neutral: true },
  mark: { cn: "标记", icon: "target", bad: true },
  stun: { cn: "定身", icon: "bolt", bad: true },
  silence: { cn: "缄口", icon: "mute", bad: true },
  shield: { cn: "护盾", icon: "shield", good: true },
};
/** 计数型（不是百分比） */
const BST_COUNT = new Set(["graze", "extraAction", "silenceImmune", "debuffExtend", "energy"]);
/** 值越大越是负面 */
const BST_BAD = new Set(["dot", "dmgTake", "dmgTaken", "mark", "stun", "silence"]);

function btStatInfo(stat) {
  return BST_STAT[stat] || { cn: stat || "状态", icon: "spark" };
}
/** 好/坏/中性：决定图标底色。事件里带了 buff/debuff 就按事件，没有就按属性语义。 */
function btTone(st) {
  if (st.kind === "debuff") return "bad";
  if (st.kind === "buff") return "good";
  const info = btStatInfo(st.stat);
  if (info.bad || BST_BAD.has(st.stat)) return "bad";
  if (info.neutral) return "neutral";
  return "good";
}
/** 数值文案：攻击 +25% / 护盾 190 / 持续伤害 77 / 免死 +1 */
function btValueText(st, u) {
  const info = btStatInfo(st.stat);
  if (st.stat === "shield") return `${Math.round(u?.shield || st.value || 0)} 点`;
  if (st.stat === "dot") return `每回合 ${Math.round(st.value || 0)} 点`;
  // 控制类/士气类只看剩余回合，写百分比反而误导
  if (["stun", "silence", "taunt", "stealth"].includes(st.stat)) return "";
  if (info.count || BST_COUNT.has(st.stat)) return `+${Math.round(st.value || 0)}`;
  const v = Number(st.value);
  if (!isFinite(v)) return "";
  if (st.op === "mul") return `${v >= 1 ? "+" : "−"}${Math.round(Math.abs(v - 1) * 100)}%`;
  return `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`;
}

/* ---- 状态读写 ---- */

/** 上/刷新一个状态；返回 true 表示这是"新得到的"（只有新状态才飘字，避免每回合刷屏） */
function btStatusAdd(side, slot, st) {
  const k = btKey(side, slot);
  const list = BT.status.get(k) || [];
  const same = list.find(x => x.stat === st.stat && (x.op || "") === (st.op || ""));
  if (same) {
    const maxStacks = st.maxStacks || 1;
    if (st.allowStack && same.stacks < maxStacks) same.stacks += 1;
    if (st.value !== undefined && st.value !== null) same.value = st.value;
    same.turns = Math.max(same.turns || 0, st.turns || 0);
    same.kind = st.kind || same.kind;
    BT.status.set(k, list);
    btPaintBuffs(side, slot);
    return false;
  }
  list.push({ stacks: 1, ...st });
  BT.status.set(k, list);
  btPaintBuffs(side, slot);
  return true;
}
/** 掉一个状态（驱散用） */
function btStatusDrop(side, slot, pred) {
  const k = btKey(side, slot);
  const list = BT.status.get(k) || [];
  const left = list.filter(st => !pred(st));
  BT.status.set(k, left);
  btPaintBuffs(side, slot);
}
/** 回合末给单位的状态计时 -1（引擎是在"该单位自己的回合末"递减，这里对齐同一规则） */
function btStatusTick(side, slot) {
  const k = btKey(side, slot);
  const list = BT.status.get(k) || [];
  if (!list.length) return;
  for (const st of list) if (st.turns < 99) st.turns -= 1;
  BT.status.set(k, list.filter(st => st.turns > 0));
  btPaintBuffs(side, slot);
}

/** 画卡片下的一排状态图标 */
/** 状态图标一排（卡片下 / 选中面板里共用同一套标记） */
function btChipsHtml(list, u) {
  const chips = [];
  const shown = list.slice(0, 8);
  for (const st of shown) {
    const info = btStatInfo(st.stat);
    const tone = btTone(st);
    const turns = st.turns >= 99 ? "∞" : String(Math.max(0, st.turns | 0));
    const val = btValueText(st, u);
    const stack = st.stacks > 1 ? ` ×${st.stacks}` : "";
    // 悬浮说明用 | 分段：标题 | 数值 | 剩余回合
    const tip = `${info.cn}${stack}|${val}|${st.turns >= 99 ? "持续整场" : `剩余 ${Math.max(0, st.turns | 0)} 回合`}`;
    chips.push(`<span class="bst ${tone}" data-bst="${esc(tip)}">
      ${bstSvg(info.icon)}
      <i class="bst-t">${turns}</i>${st.stacks > 1 ? `<b class="bst-n">${st.stacks}</b>` : ""}
    </span>`);
  }
  // 状态太多时只留一行，多余的收进 "+N"（悬停能看全），免得卡片被撑高顶到技能条
  if (list.length > shown.length) {
    const rest = list.slice(shown.length).map(st => `${btStatInfo(st.stat).cn}${btValueText(st, u)}`).join("，");
    chips.push(`<span class="bst more" data-bst="还有 ${list.length - shown.length} 个状态|${esc(rest)}">+${list.length - shown.length}</span>`);
  }
  return chips.join("");
}

function btPaintBuffs(side, slot) {
  const box = document.getElementById(`bbf-${side}-${slot}`);
  if (!box) return;
  const u = BT.live.get(btKey(side, slot));
  const list = BT.status.get(btKey(side, slot)) || [];
  if (!u || !u.alive || !list.length) {
    if (box.innerHTML) box.innerHTML = "";
    box.classList.remove("has");
    box.dataset.sig = "";
    return;
  }
  /* 状态没变就不重画：悬停时提示框挂在具体那颗图标上，
   * 每次事件都把 innerHTML 重写一遍会把那颗图标换掉，提示框就再也收不到 pointerleave。 */
  const sig = `${Math.round(u.shield)}|` + list
    .map(st => `${st.stat}:${st.op}:${Math.round((Number(st.value) || 0) * 100)}:${st.turns}:${st.stacks}`)
    .join(",");
  if (box.dataset.sig === sig && box.classList.contains("has")) return;
  box.dataset.sig = sig;
  // 真要重画时，如果鼠标正停在这一排图标上，先把提示框收起来（否则它挂在被删掉的节点上就收不掉了）
  if (box.matches(":hover") && tipEl && tipEl.style.display === "block") tipEl.style.display = "none";
  box.innerHTML = btChipsHtml(list, u);
  box.classList.add("has");
}

/* ---- 战斗状态的生命周期 ---- */

/** 开战：上限取快照/角色行，血量一律从满血起算（快照里的血量是第一回合打完的，不能当开局） */
function btInit(result) {
  BT.live.clear();
  BT.status.clear();
  BT.shield.clear();
  /* 韧性：row.toughMax > 0 才有韧性条（旧数据没有该字段 → || 0 兜底，不渲染） */
  const put = (side, slot, maxHp, row) => {
    if (!(maxHp > 0)) return;
    const tm = Number(row?.toughMax) || 0;
    BT.live.set(btKey(side, slot), {
      side, slot, hp: maxHp, maxHp, shield: 0, energy: 0, alive: true,
      tough: tm, toughMax: tm, broken: false,
    });
  };
  for (const s of result.turns?.[0]?.state || []) put(s.side, s.slot, s.maxHp || 1, s);
  for (const a of result.allies || []) {
    if (!BT.live.has(btKey(0, a.slot))) put(0, a.slot, a.maxHp || a.hp || 1, a);
  }
  for (const w of result.foes || []) {
    for (const f of w.units || []) {
      if (!BT.live.has(btKey(1, f.slot))) put(1, f.slot, f.maxHp || f.hp || 0, f);
    }
  }
}

/** 画一个单位的全部状态（血条/护盾/怒气/死亡/状态图标） */
function btPaint(side, slot) {
  const u = BT.live.get(btKey(side, slot));
  if (!u) return;
  const hp = document.getElementById(`bhp-${side}-${slot}`);
  const t = document.getElementById(`bhpt-${side}-${slot}`);
  const sh = document.getElementById(`bsh-${side}-${slot}`);
  const en = document.getElementById(`ben-${side}-${slot}`);
  const ent = document.getElementById(`bent-${side}-${slot}`);
  const enVal = Math.max(0, Math.min(100, u.energy || 0));
  if (en) {
    en.style.width = enVal + "%";
    en.style.background = enVal >= 100
      ? "linear-gradient(90deg,#ffe08a,#e8c98a)"
      : enVal >= 60 ? "linear-gradient(90deg,#c9a6f0,#9b7cdb)"
      : "linear-gradient(90deg,#7f8fb5,#5d6b8c)";
  }
  if (ent) {
    ent.textContent = Math.round(enVal);
    ent.classList.toggle("full", enVal >= 100);
  }
  if (hp) {
    const pct = Math.max(0, Math.min(100, u.hp / Math.max(1, u.maxHp) * 100));
    hp.style.width = pct + "%";
    hp.style.background = pct > 45 ? "linear-gradient(90deg,#5fbf7f,#3f9f63)"
      : pct > 20 ? "linear-gradient(90deg,#d9a13b,#b8862c)" : "linear-gradient(90deg,#c0564a,#9e4038)";
    if (t) t.textContent = `${Math.round(u.hp)} / ${Math.round(u.maxHp)}`;
    if (sh) sh.textContent = u.shield > 0 ? `盾 ${Math.round(u.shield)}` : "";
  }
  // 韧性条：toughMax 为 0/缺失时不渲染（元素根本不存在），这里只管有条时的填充
  const tg = document.getElementById(`btg-${side}-${slot}`);
  if (tg) {
    const tm = Number(u.toughMax) || 0;
    const fill = tg.firstElementChild;
    if (fill && tm > 0) {
      fill.style.width = Math.max(0, Math.min(100, (Number(u.tough) || 0) / tm * 100)) + "%";
    }
    tg.classList.toggle("broken", !!u.broken);
  }
  const card = document.getElementById(`bu-${side}-${slot}`);
  if (card) {
    card.classList.toggle("dead", !u.alive);
    // 破防中：卡片红光边（旧数据没有 broken 字段 → 恒为 false）
    card.classList.toggle("broken", !!u.broken && u.alive !== false && (Number(u.toughMax) || 0) > 0);
  }
  btPaintBuffs(side, slot);
  // 选中面板跟着实时更新（点开的那个人挨打/回血/上状态时，底部数字同步变）
  if (bvSel && bvSel.side === side && bvSel.slot === slot) bvPanelRefresh();
}

/** 把当前追踪到的状态整体画一遍（开战、换波时用） */
function btPaintAll() {
  for (const u of BT.live.values()) btPaint(u.side, u.slot);
}

/* 回合快照只能用来对齐"每回合才变一次"的东西。
 * 为什么不能拿它对齐血量：TurnRecord.state 是在"下一条 turn 事件到达时"才补写的，
 * 而引擎一次 Step 可能已经跑完后面好几个单位——所以快照里经常混进了后面回合的伤害。
 * 用它刷血条，就会出现"这一下还没打到，怪的血先掉/人先躺下"。
 * 血量/护盾/生死一律走事件；快照只同步怒气与上限。 */
function btSyncMeta(snap) {
  for (const s of snap || []) {
    const u = BT.live.get(btKey(s.side, s.slot));
    if (!u) continue;
    if (s.maxHp > 0) {
      // 上限变了（成长/临时上限）就按比例保住血条长度
      if (Math.abs(s.maxHp - u.maxHp) > 0.5) u.hp = u.hp / Math.max(1, u.maxHp) * s.maxHp;
      u.maxHp = s.maxHp;
    }
    u.energy = Math.max(0, s.energy || 0);
    /* 韧性/破防是"回合边界才变"的量，随快照对齐；旧快照没有这些字段就不动（|| 0 兜底在建卡时已做） */
    if (typeof s.toughMax === "number" && s.toughMax > 0) u.toughMax = s.toughMax;
    if (typeof s.tough === "number") u.tough = s.tough;
    if (typeof s.broken === "boolean") u.broken = s.broken;
    btPaint(s.side, s.slot);
  }
}

/** 换波：新一波的怪就是满血上场（旧一波同阵位的数据不能串过去） */
function btWaveEnter(wave) {
  for (const u of BT.live.values()) {
    if (u.side !== 1) continue;
    u.hp = u.maxHp;
    u.shield = 0;
    u.alive = true;
    u.tough = u.toughMax || 0;   // 新一波的怪韧性也是满的
    u.broken = false;
    BT.shield.delete(btKey(u.side, u.slot));
    BT.status.delete(btKey(u.side, u.slot));
  }
  btPaintAll();
}

/* ---- 护盾：按"层"记账 ----
 * C# 里每层护盾有自己的剩余回合，在该单位自己的回合末递减。
 * 只累加总数会让"每回合补一层薄盾"的坦克护盾值无限膨胀（实测能滚到 1000+），
 * 所以这里同样按层存，回合末一起过期。 */
function btShieldList(side, slot) {
  const k = btKey(side, slot);
  if (!BT.shield.has(k)) BT.shield.set(k, []);
  return BT.shield.get(k);
}
function btShieldTotal(side, slot) {
  const list = btShieldList(side, slot);
  return list.reduce((a, b) => a + b.left, 0);
}
function btShieldSync(side, slot) {
  const u = BT.live.get(btKey(side, slot));
  if (!u) return;
  u.shield = Math.max(0, btShieldTotal(side, slot));
  btPaint(side, slot);
}

/* ---- 逐条结算：改动状态并立刻重画（顺序 = 玩家看到的顺序） ---- */

/** 扣血：护盾先吃（跟 C# 的 TakeDamage 同规则），返回实际打到血上的量 */
function btDamage(side, slot, amount) {
  const u = BT.live.get(btKey(side, slot));
  if (!u || !(amount > 0)) return { amount: 0, absorbed: 0, through: 0 };
  let left = amount;
  let absorbed = 0;
  for (const b of btShieldList(side, slot)) {
    if (left <= 0) break;
    const take = Math.min(b.left, left);
    b.left -= take;
    left -= take;
    absorbed += take;
  }
  BT.shield.set(btKey(side, slot), btShieldList(side, slot).filter(b => b.left > 0.01));
  u.shield = btShieldTotal(side, slot);
  const through = left;
  u.hp = Math.max(0, u.hp - through);
  btPaint(side, slot);
  // 护盾吃到伤害后，"护盾"图标要跟着掉；掉光了就摘掉图标
  const list = BT.status.get(btKey(side, slot));
  if (list) {
    const shSt = list.find(x => x.stat === "shield");
    if (shSt) {
      shSt.value = u.shield;
      if (u.shield <= 0) BT.status.set(btKey(side, slot), list.filter(x => x !== shSt));
    }
    btPaintBuffs(side, slot);
  }
  return { amount, absorbed, through };
}

function btHeal(side, slot, amount) {
  const u = BT.live.get(btKey(side, slot));
  if (!u || !(amount > 0)) return 0;
  const before = u.hp;
  u.hp = Math.min(u.maxHp, u.hp + amount);
  btPaint(side, slot);
  return u.hp - before;
}

/** 加一层护盾（turns 内有效，该单位自己的回合末递减） */
function btShieldUp(side, slot, amount, turns = 1) {
  const u = BT.live.get(btKey(side, slot));
  if (!u || !(amount > 0)) return;
  btShieldList(side, slot).push({ left: amount, turns: turns || 1 });
  btShieldSync(side, slot);
}

function btShieldBreak(side, slot, ratio) {
  const u = BT.live.get(btKey(side, slot));
  if (!u) return;
  const keep = 1 - Math.max(0, Math.min(1, ratio || 0));
  for (const b of btShieldList(side, slot)) b.left *= keep;
  BT.shield.set(btKey(side, slot), btShieldList(side, slot).filter(b => b.left > 0.01));
  btShieldSync(side, slot);
}

/** 单位自己的回合末：护盾层计时 -1，到期的整层退场 */
function btShieldTick(side, slot) {
  const list = btShieldList(side, slot);
  if (!list.length) return;
  for (const b of list) b.turns -= 1;
  BT.shield.set(btKey(side, slot), list.filter(b => b.turns > 0 && b.left > 0.01));
  btShieldSync(side, slot);
}

function btKill(side, slot) {
  const u = BT.live.get(btKey(side, slot));
  if (!u) return;
  u.alive = false;
  u.hp = 0;
  u.shield = 0;
  BT.shield.delete(btKey(side, slot));
  btPaint(side, slot);
}

function btRevive(side, slot, pct = 0.3) {
  const u = BT.live.get(btKey(side, slot));
  if (!u) return;
  u.alive = true;
  u.hp = Math.max(1, Math.round((u.maxHp || 1) * pct));
  btPaint(side, slot);
}

