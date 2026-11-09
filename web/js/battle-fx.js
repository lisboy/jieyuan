/* 拾缘 · battle-fx —— 由 app.js 拆分（2026-10-26） */
/* ================= 投射粒子特效 =================
 * 大招：全屏立绘退场后，投射物从施法者飞向目标卡，砸中才扣血。
 * 普攻：同一个系统，但更小更短；颜色由六气决定，形状由定位决定，
 *       再叠一个按角色 id 取的变体，让同元素的两个人也不撞效果。
 */
// 六气真实 key：flame 离火 / verdant 青木 / tide 沧水 / light 曜光 / storm 紫雷 / dusk 素月
// 这里的取值是"发光的亮色调"，与 DATA.elements 里的界面色分开，避免投射物发闷。
const PROJ_COLOR = {
  flame: "#ff7a45", verdant: "#5fd47a", tide: "#54c8f0",
  light: "#ffe08a", storm: "#b98cff", dusk: "#b9a6e8",
};
function projColor(el) {
  return PROJ_COLOR[el]
    || (DATA && DATA.elements && DATA.elements[el] && DATA.elements[el].color)
    || "#e8c98a";
}
const PROJ_SHAPE = {
  burst: "pj-orb", cleave: "pj-slash", break: "pj-spear",
  sustain: "pj-leaf", support: "pj-star", guard: "pj-orb", control: "pj-spiral",
};
function projHash(s) {
  let h = 0;
  const t = String(s || "");
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/* ================= 普攻的六气形态 =================
 * 同一个投射物系统，但每气的"出手方式"不一样：
 *   离火 三连小火球 / 青木 双叶缠绕 / 沧水 双水箭带涟漪
 *   紫雷 直接劈一道电光 / 曜光 三连光点 / 素月 一记月牙横切
 */
const ATTACK_PATTERN = {
  flame:   { shots: 3, gap: 62, jitter: 34, scale: 0.66, burst: "burn" },
  verdant: { shots: 2, gap: 92, jitter: 26, scale: 0.86, burst: "wrap" },
  tide:    { shots: 2, gap: 78, jitter: 20, scale: 0.88, burst: "ripple" },
  storm:   { shots: 1, gap: 0,  jitter: 0,  scale: 1.0,  burst: "chain" },
  light:   { shots: 3, gap: 46, jitter: 16, scale: 0.6,  burst: "flare" },
  dusk:    { shots: 1, gap: 0,  jitter: 0,  scale: 1.0,  burst: "moon" },
};

/** 命中后的元素收尾（缠绕 / 涟漪 / 光爆 / 燃烧） */
function attackBurst(kind, toEl, element) {
  if (bvFxMuted) return;
  const host = document.getElementById("battleView");
  if (!host || !toEl) return;
  const hb = host.getBoundingClientRect();
  const r = toEl.getBoundingClientRect();
  const x = r.left + r.width / 2 - hb.left;
  const y = r.top + r.height * 0.5 - hb.top;
  const color = projColor(element);
  const mk = (cls, extra) => {
    const d = document.createElement("div");
    d.className = cls;
    d.style.left = x + "px";
    d.style.top = y + "px";
    d.style.setProperty("--pj-c", color);
    if (extra) for (const [k, v] of Object.entries(extra)) d.style.setProperty(k, v);
    host.appendChild(d);
    setTimeout(() => d.remove(), 760);
    return d;
  };
  if (kind === "wrap") {
    // 只留飞叶，不画缠绕环
    for (let i = 0; i < 8; i++) {
      const s = mk("pj-leaf-bit");
      s.style.setProperty("--ang", (i * 45) + "deg");
    }
  } else if (kind === "ripple") {
    // 水花四溅，不画扩散环
    for (let i = 0; i < 8; i++) {
      const s = mk("pj-drop");
      s.style.setProperty("--ang", (i * 45 + Math.random() * 20) + "deg");
      s.style.setProperty("--d", (34 + Math.random() * 26).toFixed(0) + "px");
    }
  } else if (kind === "flare") {
    mk("pj-flare");
    mk("pj-flare f2");
  } else if (kind === "burn") {
    mk("pj-burn");
  }
}

/** 紫雷普攻：不飞球，直接一道电光劈过去 */
function chainBolt(fromEl, toEl, element, speed) {
  return new Promise((resolve) => {
    const host = document.getElementById("battleView");
    if (!host || !fromEl || !toEl) { resolve(); return; }
    const hb = host.getBoundingClientRect();
    const a1 = fromEl.getBoundingClientRect();
    const b1 = toEl.getBoundingClientRect();
    const x0 = a1.left + a1.width / 2 - hb.left;
    const y0 = a1.top + a1.height * 0.42 - hb.top;
    const x1 = b1.left + b1.width / 2 - hb.left;
    const y1 = b1.top + b1.height * 0.5 - hb.top;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
    const color = projColor(element);

    const bolt = document.createElement("div");
    bolt.className = "pj-boltbeam";
    bolt.style.left = x0 + "px";
    bolt.style.top = y0 + "px";
    bolt.style.width = len + "px";
    bolt.style.transform = "rotate(" + ang + "deg)";
    bolt.style.setProperty("--pj-c", color);
    host.appendChild(bolt);

    const spd = Math.max(0.6, speed || 1);
    setTimeout(() => {
      bolt.remove();
      impactBurst(host, x1, y1, color, false, element);
      resolve();
    }, 240 / spd);
  });
}

/** 素月普攻：一记月牙横切 */
function crescentSlash(fromEl, toEl, element, speed) {
  return new Promise((resolve) => {
    const host = document.getElementById("battleView");
    if (!host || !fromEl || !toEl) { resolve(); return; }
    const hb = host.getBoundingClientRect();
    const a1 = fromEl.getBoundingClientRect();
    const b1 = toEl.getBoundingClientRect();
    const x0 = a1.left + a1.width / 2 - hb.left;
    const y0 = a1.top + a1.height * 0.42 - hb.top;
    const x1 = b1.left + b1.width / 2 - hb.left;
    const y1 = b1.top + b1.height * 0.5 - hb.top;
    const color = projColor(element);
    const ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;

    const blade = document.createElement("div");
    blade.className = "pj-moonblade";
    blade.style.left = x0 + "px";
    blade.style.top = y0 + "px";
    blade.style.setProperty("--pj-c", color);
    host.appendChild(blade);

    const spd = Math.max(0.6, speed || 1);
    const dur = 300 / spd;
    const anim = blade.animate([
      { transform: "translate(-50%,-50%) rotate(" + ang + "deg) scale(.6)", opacity: 0 },
      { transform: "translate(-50%,-50%) rotate(" + ang + "deg) scale(1)", opacity: 1, offset: 0.25 },
      { transform: "translate(calc(-50% + " + (x1 - x0) + "px), calc(-50% + " + (y1 - y0) + "px)) rotate(" + (ang + 40) + "deg) scale(1.15)", opacity: 1 },
    ], { duration: dur, easing: "cubic-bezier(.3,.6,.4,1)", fill: "forwards" });
    anim.onfinish = () => {
      blade.remove();
      impactBurst(host, x1, y1, color, false, element);
      resolve();
    };
    BGT.tmo(() => { if (blade.isConnected) { blade.remove(); resolve(); } }, dur + 240);
  });
}

/** 角色层普攻变体（content/vfx.json → variants.attack，由 build 写进角色档案 vfx.variant.attack） */
const ATK_VARIANT = {
  a1: { shots: 1, gap: 0,   scale: 1.00, jitter: 0,  burst: "",        trail: "thin"  },
  a2: { shots: 3, gap: 58,  scale: 0.62, jitter: 22, burst: "",        trail: "short" },
  a3: { shots: 2, gap: 84,  scale: 0.84, jitter: 14, burst: "",        trail: "mid"   },
  a4: { shots: 1, gap: 0,   scale: 1.12, jitter: 0,  burst: "boomerang", trail: "long" },
  a5: { shots: 4, gap: 42,  scale: 0.50, jitter: 34, burst: "",        trail: "spark" },
  a6: { shots: 1, gap: 0,   scale: 1.28, jitter: 0,  burst: "slam",    trail: "heavy" },
  a7: { shots: 2, gap: 110, scale: 0.72, jitter: 8,  burst: "thread",  trail: "silk"  },
  a8: { shots: 1, gap: 0,   scale: 0.95, jitter: 0,  burst: "flare",   trail: "ray"   },
};

/** 普攻总入口：六气定"是什么在飞"，角色变体定"几段、什么节奏、命中怎么收" */
async function attackCombo(fromEl, toEl, opts) {
  const base = ATTACK_PATTERN[opts.element] || ATTACK_PATTERN.light;
  const v = ATK_VARIANT[opts.variant] || null;
  const pat = v
    ? { shots: v.shots, gap: v.gap, jitter: v.jitter, scale: v.scale, burst: v.burst || base.burst }
    : base;
  const spd = Math.max(0.6, opts.speed || 1);
  // 紫雷/素月的专属飞行体只保留给基础形态；角色变体改走统一投射物，保证"每个人都不同"
  if (!v && pat.burst === "chain") { await chainBolt(fromEl, toEl, opts.element, spd); return; }
  if (!v && pat.burst === "moon") { await crescentSlash(fromEl, toEl, opts.element, spd); return; }

  const jobs = [];
  for (let i = 0; i < pat.shots; i++) {
    if (i > 0) await sleep(pat.gap / spd);
    jobs.push(launchProjectile(fromEl, toEl, {
      big: false, element: opts.element, role: opts.role, charId: opts.charId,
      speed: spd, scale: pat.scale, jitter: pat.jitter, trail: v?.trail,
    }));
  }
  await Promise.all(jobs);
  attackBurst(pat.burst, toEl, opts.element);
  // 角色变体的收尾（回锋/沉岳/游丝/破晓）额外补一层，读得出"这一下是这个人打的"
  if (v && v.burst) variantBurst(v.burst, toEl, opts.element);
}

/** 角色变体命中收尾 */
function variantBurst(kind, toEl, element) {
  if (bvFxMuted) return;
  const host = document.getElementById("battleView");
  if (!host || !toEl) return;
  const hb = host.getBoundingClientRect();
  const r = toEl.getBoundingClientRect();
  const x = r.left + r.width / 2 - hb.left;
  const y = r.top + r.height * 0.5 - hb.top;
  const color = projColor(element);
  const mk = (cls, extra, life = 700) => {
    const d = document.createElement("div");
    d.className = cls;
    d.style.left = x + "px";
    d.style.top = y + "px";
    d.style.setProperty("--pj-c", color);
    if (extra) for (const [k, v] of Object.entries(extra)) d.style.setProperty(k, v);
    host.appendChild(d);
    setTimeout(() => d.remove(), life);
  };
  if (kind === "boomerang") {
    // 回锋：一道月牙从目标倒飞回施法者方向
    mk("pj-recall", { "--dx": "-120px" }, 760);
  } else if (kind === "slam") {
    mk("pj-slam");
    shake("sm");
  } else if (kind === "thread") {
    for (let i = 0; i < 5; i++) mk("pj-thread-bit", { "--ang": (i * 72) + "deg", "--d": (30 + i * 7) + "px" });
  } else if (kind === "flare") {
    mk("pj-flare");
    mk("pj-flare f2");
  }
}

function launchProjectile(fromEl, toEl, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    if (bvFxMuted) { resolve(); return; }
    const host = document.getElementById("battleView");
    if (!host || !fromEl || !toEl) { resolve(); return; }
    // 先算参数，再用它们算落点（顺序反了会踩 TDZ 直接抛错）
    const scale = opts.scale || 1;
    const jit = opts.jitter || 0;

    const hb = host.getBoundingClientRect();
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    // 出手点取施法者卡面偏上，落点取目标卡正中（连发时轻微错开，避免叠成一条线）
    const x0 = a.left + a.width / 2 - hb.left;
    const y0 = a.top + a.height * 0.45 - hb.top;
    const x1 = b.left + b.width / 2 - hb.left + (jit ? (Math.random() * 2 - 1) * jit : 0);
    const y1 = b.top + b.height * 0.5 - hb.top + (jit ? (Math.random() * 2 - 1) * jit * 0.6 : 0);

    const color = projColor(opts.element);
    const shape = opts.shape || PROJ_SHAPE[opts.role] || "pj-orb";
    const big = !!opts.big;
    const spd = Math.max(0.6, opts.speed || 1);
    const v = projHash(opts.charId || opts.element) % 3;

    const el = document.createElement("div");
    el.className = "pj " + shape + " pj-v" + v + (big ? " pj-big" : "");
    el.style.setProperty("--pj-c", color);
    if (scale !== 1) {
      const base = 76 * scale;
      el.style.width = base + "px";
      el.style.height = base + "px";
    }
    // 核心 + 尾迹 + 环绕火花：三层叠一起才有"打出去"的速度感
    el.innerHTML = '<b class="pj-core"></b><b class="pj-tail"></b>' +
      '<b class="pj-orbit"></b><b class="pj-orbit o2"></b>';
    el.style.left = x0 + "px";
    el.style.top = y0 + "px";
    host.appendChild(el);

    const dx = x1 - x0, dy = y1 - y0;
    const dur = (big ? 430 : 280) / spd;
    // 抛物线：中途往上抬一点，砸下来才有重量
    const arc = Math.min(170, Math.abs(dx) * 0.24 + 40);
    const anim = el.animate([
      { transform: "translate(-50%,-50%) scale(.45) rotate(0deg)", opacity: 0, offset: 0 },
      { transform: "translate(-50%,-50%) scale(" + (big ? 1.05 : 0.85) + ") rotate(" + (120 + v * 30) + "deg)", opacity: 1, offset: 0.14 },
      { transform: "translate(" + (dx * 0.55) + "px," + (dy * 0.55 - arc) + "px) translate(-50%,-50%) scale(" + (big ? 1.3 : 1) + ") rotate(" + (300 + v * 40) + "deg)", opacity: 1, offset: 0.62 },
      { transform: "translate(" + dx + "px," + dy + "px) translate(-50%,-50%) scale(" + (big ? 1.55 : 1.1) + ") rotate(" + (480 + v * 60) + "deg)", opacity: 1, offset: 1 },
    ], { duration: dur, easing: "cubic-bezier(.4,.05,.55,1)", fill: "forwards" });

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.remove();
      impactBurst(host, x1, y1, color, big, opts.element);
      resolve();
    };
    anim.onfinish = finish;
    // 兜底：动画被打断（切屏/暂停时 WAAPI 时间轴冻结，onfinish 不来）也不能让战斗卡死
    BGT.tmo(finish, dur + 260);
  });
}

/* 命中反馈：不画光圈。
 * 之前是一圈巨大的扩散环（.pj-impact），视觉上像"套了个呼啦圈"，和"打中了"这件事无关；
 * 现在只撒一层细碎的火星，配合受击卡的弹出/闪亮与伤害数字，交代"打到了、掉了多少血"。
 */
function impactBurst(host, x, y, color, big, element) {
  if (bvFxMuted || !host) return;
  const n = big ? 14 : 7;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("i");
    s.className = "pj-spark";
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.55;
    const dist = (big ? 78 : 40) * (0.6 + Math.random() * 0.7);
    s.style.left = x + "px";
    s.style.top = y + "px";
    s.style.setProperty("--pj-c", color);
    s.style.setProperty("--dx", (Math.cos(ang) * dist).toFixed(1) + "px");
    s.style.setProperty("--dy", (Math.sin(ang) * dist).toFixed(1) + "px");
    host.appendChild(s);
    setTimeout(() => s.remove(), 660);
  }
}

/* ================= 施法动作：谁挨打，特效就只落在谁身上 =================
 * 三件事分开：
 *   strikeOnce  单体/多段 —— 只在"施法者 → 目标"这一条线上飞一次
 *   volleyAll   群伤 —— 所有目标同时挨打（错开几十毫秒），读得出是"AOE 打了一片"
 *   supportCast 友军增益 —— 从施法者飞向真正被加成的友军卡，落点是友军而不是敌人
 * 全部在"伤害事件结算之前"完成，砸中了才扣血、才飘数字、才判死。
 */
async function strikeOnce(actor, side, slot, meta) {
  const fromEl = cardEl(actor?.side, actor?.slot);
  const toEl = cardEl(side, slot);
  if (!fromEl || !toEl || fromEl === toEl) return;   // 反噬/自身伤害不飞投射物
  await attackCombo(fromEl, toEl, {
    element: meta.element, role: meta.role, charId: meta.charId, speed: bvNow(),
    variant: meta.atkVariant,
  });
}

/** 群伤：一次性把投射物打到每个目标（微错开），再统一进入结算 */
async function volleyAll(actor, keys, meta) {
  const fromEl = cardEl(actor?.side, actor?.slot);
  if (!fromEl) return;
  const spd = Math.max(0.6, bvNow());
  const jobs = [];
  keys.forEach((k, i) => {
    const [side, slot] = k.split("-").map(Number);
    const toEl = cardEl(side, slot);
    if (!toEl || toEl === fromEl) return;
    jobs.push(sleep((i * 70) / spd).then(() => launchProjectile(fromEl, toEl, {
      element: meta.element, role: meta.role, charId: meta.charId,
      speed: bvNow(), scale: 0.95, jitter: 16, trail: meta.atkVariant ? "mid" : undefined,
    })));
  });
  if (!jobs.length) return;
  await Promise.all(jobs);
  shake("sm");
}

/** 纯辅助/纯状态类术法：把效果送到"真正被作用的那张卡"上。
 *  打友军 → 柔光（pj-star）；打敌方（纯减益、无伤害的诅咒）→ 按定位的形状飞过去。 */
async function supportCast(actor, evs, meta) {
  const fromEl = cardEl(actor?.side, actor?.slot);
  if (!fromEl) return;
  const keys = [...new Set(evs.map(e => btKey(e.side, e.slot)))]
    .filter(k => k !== btKey(actor.side, actor.slot));
  if (!keys.length) return;
  const spd = Math.max(0.6, bvNow());
  const jobs = keys.map((k, i) => {
    const [side, slot] = k.split("-").map(Number);
    const toEl = cardEl(side, slot);
    if (!toEl) return null;
    const hostile = side !== actor.side;
    return sleep((i * 60) / spd).then(() => launchProjectile(fromEl, toEl, {
      element: hostile ? meta.element : actor.element,
      role: hostile ? meta.role : "support",
      charId: actor.id, speed: bvNow(), scale: hostile ? 0.85 : 0.72, jitter: 10,
    }));
  }).filter(Boolean);
  await Promise.all(jobs);
}

/* ================= 大招满屏演出 =================
 * 立绘退场后接管整屏：按六气各走一套（离火流星雨 / 沧水巨浪 / 青木藤生 /
 * 紫雷落雷 / 曜光光柱 / 素月月蚀），落点锚定【这一次真正被打到/被加成的卡】，
 * 砸完再进伤害结算。
 *
 * 落点为什么必须由事件决定：以前固定取"敌方全部卡位"，于是单体大招也铺满对面五个人，
 * 玩家看到的是"明明写着单体，特效却五个人一起吃"。现在先把这一发实际命中的目标
 * 从事件流里挑出来，单体就只砸那一张卡，群伤才铺开。
 */
function anchorOf(side, slot) {
  const el = document.getElementById(`bu-${side}-${slot}`);
  if (!el) return null;
  const host = document.getElementById("battleView");
  if (!host) return null;
  const hb = host.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  return { x: r.left + r.width / 2 - hb.left, y: r.top + r.height * 0.52 - hb.top };
}
function anchorsOf(side, slots) {
  const out = [];
  for (const slot of slots) {
    const a = anchorOf(side, Number(slot));
    if (a) out.push(a);
  }
  return out;
}
function foeAnchors() {
  const out = [];
  for (const el of document.querySelectorAll("#bvFoes .buc, #bvFoes .boss-unit")) {
    const sideEl = el.closest("[data-slot]");
    if (!sideEl) continue;
    const a = anchorOf(1, sideEl.dataset.slot);
    if (a) out.push(a);
  }
  return out;
}

/**
 * @param {string} element 六气
 * @param {number} speed   演出倍速
 * @param {{anchors?: {x:number,y:number}[], spread?: boolean, friendly?: boolean, variant?: string, name?: string, video?: string, cvSync?: boolean}} opts
 *        anchors  落点（这一发真正的目标）；spread = 打的是群体；friendly = 打在友军身上的增益
 *        variant  角色专属终式变体（content/vfx.json → variants.ult，u1~u8）
 *        name     终式演出名（角色专属，显示在屏幕上方）
 *        video    专属大招视频（/art/ult/<id>.mp4）；cvSync = 与配音同步，强制 1 倍速
 */
function ultBarrage(element, speed, opts = {}) {
  if (bvFxMuted) return Promise.resolve();
  // 专属大招视频演出（晶钻档）：整段 mp4 压在战场之上播完，再交给下面的元素特效。
  // 视频缺失/解码失败/超时一律静默降级回原特效——绝不能让一场战斗卡在演出里。
  if (opts.video && /^\/?art\/ult\/[\w.-]+\.mp4$/.test(opts.video)) {
    return new Promise((resolve) => {
      const host = document.getElementById("battleView");
      if (!host) { resolve(); return; }
      const layer = document.createElement("div");
      layer.className = "ub-video-layer";
      // 双源：WebM(VP9) 优先——无头 Chromium/部分 Linux 构建不带 H.264 解码；MP4 兜底 Safari/旧浏览器。
      const base = opts.video.replace(/\.mp4$/, "");
  layer.innerHTML = `<video class="ub-video" muted playsinline preload="auto">
          <source src="${base}.webm" type="video/webm">
          <source src="${opts.video}" type="video/mp4">
        </video>
        <i class="ub-cine ub-cine-top"></i><i class="ub-cine ub-cine-bottom"></i>
        <div class="ub-video-name"><b>${String(opts.name || "").replace(/[<>&]/g, "")}</b></div>
        <i class="ub-video-flash"></i>`;
      // 同一时刻只允许一层终式视频：跳过/连战时上一层的清理是异步的，这里先兜底移除，
      // 防止多个 <video> 同时解码叠在全屏层上（Chrome 渲染进程会因此卡死整页）。
      host.querySelectorAll(".ub-video-layer").forEach(old => {
        try { const ov = old.querySelector("video"); if (ov) { ov.pause(); ov.removeAttribute("src"); } } catch {}
        old.remove();
      });
      host.appendChild(layer);
      const v = layer.querySelector("video");
      // 倍速跟随战斗演出速度，但视频本身是 30fps 的完整动画，最高 2x、最低 1x 保底可看清
      // cvSync（专属视频 + 同步 CV）时必须锁 1x：声音不会跟着倍速，画面加速会让台词与口型/动作脱节
      try { v.playbackRate = opts.cvSync ? 1 : Math.min(2, Math.max(1, Number(speed) || 1)); } catch {}
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        layer.classList.add("out");
        setTimeout(() => { layer.remove(); resolve(); }, 260);
      };
      // 视频为 3.03s 人物动画，超时 6s 兜底（留一倍余量）；仍保留兜底，绝不把战斗卡死
      const guard = setTimeout(finish, 6000);
      v.addEventListener("ended", () => { clearTimeout(guard); finish(); }, { once: true });
      v.addEventListener("error", () => { clearTimeout(guard); finish(); }, { once: true });
      // 点跳过时 bvClearFx 会直接移除本层：MutationObserver 立刻收尾，Promise 不会永久挂住
      const mo = new MutationObserver(() => {
        if (!layer.isConnected) { mo.disconnect(); clearTimeout(guard); finish(); }
      });
      try { mo.observe(host, { childList: true }); } catch {}
      v.play().catch(() => { clearTimeout(guard); finish(); });
    });
  }
  return new Promise((resolve) => {
    const host = document.getElementById("battleView");
    if (!host) { resolve(); return; }
    const W = host.clientWidth, H = host.clientHeight;
    const color = projColor(element);
    const anchors = (opts.anchors && opts.anchors.length) ? opts.anchors : foeAnchors();
    const spread = opts.spread !== undefined ? !!opts.spread : anchors.length > 1;
    const friendly = !!opts.friendly;
    const pick = (i) => anchors.length ? anchors[i % anchors.length] : { x: W / 2, y: H * 0.42 };
    // 单体聚焦：落点只围着一张卡微微一散；群伤才大幅铺开
    const jx = spread ? 170 : 52;
    const spd = Math.max(0.6, speed || 1);

    const wrap = document.createElement("div");
    wrap.className = "ubar" + (friendly ? " ubar-ally" : "") + (spread ? "" : " ubar-single");
    wrap.style.setProperty("--ub-c", color);
    const parts = [];
    const rnd = (a2, b2) => a2 + Math.random() * (b2 - a2);

    /* 角色层终式变体：u1~u8 各一套"前置演出"。
     * 之前 content/vfx.json 给每个角色算了 ult 变体、battle.js 也传了下来，
     * 但 ultBarrage 从来没读过 opts.variant——所有角色只剩六气那一套同款大招。
     * 现在按变体在元素主演出之前叠一层专属动作，先起势、再落主特效。 */
    const variant = opts.variant || null;
    if (variant && !friendly) {
      const addVar = (cls, extra = "", life = 900) => {
        for (const [i, t] of anchors.entries()) {
          const delay = (i * 55);
          parts.push(`<i class="${cls}" style="--x:${t.x.toFixed(0)}px;--y:${t.y.toFixed(0)}px;--delay:${delay}ms;--life:${life}ms;${extra}"></i>`);
          if (!spread) break; // 单体只落在主目标上，不铺全屏
        }
      };
      if (variant === "u1") addVar("ub-var-ring");
      else if (variant === "u2") addVar("ub-var-crack", "--rot:" + rnd(-8, 8).toFixed(0) + "deg");
      else if (variant === "u3") addVar("ub-var-vortex");
      else if (variant === "u4") addVar("ub-var-chains", "", 760);
      else if (variant === "u5") addVar("ub-var-pillar");
      else if (variant === "u6") addVar("ub-var-ripple");
      else if (variant === "u7") {
        // 飞羽：一次撒 7 片，错开落点与节奏，才有"漫天"的感觉
        for (const [i, t] of anchors.entries()) {
          for (let k = 0; k < 7; k++) {
            parts.push(`<i class="ub-var-feather" style="--x:${(t.x + rnd(-70, 70)).toFixed(0)}px;--y:${(t.y + rnd(-30, 40)).toFixed(0)}px;--delay:${(i * 40 + k * 55).toFixed(0)}ms"></i>`);
          }
          if (!spread) break;
        }
      }
      else if (variant === "u8") addVar("ub-var-bolt", "", 620);
    }

    if (friendly) {
      /* 增益型终式：不铺任何"从天而降"的东西（光柱/落雷/流星/浪），
       * 否则落点虽是友军，整屏下压的柱子和光轮看起来仍像在打对面一整排。
       * 只做"加持"：每张受益卡上一圈暖光轮 + 一串上浮光点 + 一层很淡的元素色光。
       */
      for (const t of anchors) {
        parts.push(`<i class="ub-bless" style="--x:${t.x.toFixed(0)}px;--y:${t.y.toFixed(0)}px;--delay:${rnd(80, 420).toFixed(0)}ms"></i>`);
        for (let i = 0; i < 7; i++) {
          parts.push(`<i class="ub-mote" style="--x:${(t.x + rnd(-52, 52)).toFixed(0)}px;--y:${(t.y + rnd(-20, 60)).toFixed(0)}px;--dx:${rnd(-26, 26).toFixed(0)}px;--dy:${rnd(-150, -70).toFixed(0)}px;--delay:${rnd(0, 520).toFixed(0)}ms"></i>`);
        }
      }
      parts.push('<i class="ub-veil"></i>');
    } else if (element === "flame") {
      // 离火：一片火球流星雨斜砸下来，落点就是这次的目标卡
      const n = spread ? 22 : 13;
      for (let i = 0; i < n; i++) {
        const t = pick(i);
        const d = rnd(0, spread ? 640 : 460);
        const dur = rnd(560, 780);
        parts.push(`<i class="ub-meteor" style="--x:${(t.x + rnd(-jx, jx)).toFixed(0)}px;--w:${rnd(20, 38).toFixed(0)}px;--h:${rnd(62, 116).toFixed(0)}px;--dx:${rnd(-80, 80).toFixed(0)}px;--fy:${t.y.toFixed(0)}px;--delay:${d.toFixed(0)}ms;--dur:${dur.toFixed(0)}ms"></i>`);
        parts.push(`<i class="ub-boom" style="--x:${t.x.toFixed(0)}px;--y:${t.y.toFixed(0)}px;--delay:${(d + dur * 0.82).toFixed(0)}ms"></i>`);
      }
    } else if (element === "tide") {
      // 沧水：巨浪横扫，浪尖带水珠（单体时浪收窄到目标那张卡上）
      const waves = spread ? [0.26, 0.42, 0.58] : [0];
      waves.forEach((yf, i) => {
        const y = spread ? H * yf : pick(0).y;
        const x = spread ? 50 : (anchors[0] ? anchors[0].x / W * 100 : 50);
        parts.push(`<i class="ub-wave" style="--x:${x.toFixed(1)}%;--y:${y.toFixed(0)}px;--delay:${i * 130}ms"></i>`);
      });
      const n = spread ? 18 : 10;
      for (let i = 0; i < n; i++) {
        const t = pick(i);
        parts.push(`<i class="ub-drop" style="--x:${(t.x + rnd(-jx, jx) * 0.5).toFixed(0)}px;--y:${(t.y - rnd(0, 120)).toFixed(0)}px;--delay:${rnd(120, 620).toFixed(0)}ms"></i>`);
      }
    } else if (element === "verdant") {
      // 青木：藤蔓从下往上抽生，再撒一片飞叶
      const vines = spread ? 7 : 4;
      for (let i = 0; i < vines; i++) {
        const x = spread ? W * (0.16 + i * 0.12) : anchors[0] ? anchors[0].x + (i - vines / 2) * 46 : W / 2;
        parts.push(`<i class="ub-vine" style="--x:${x.toFixed(0)}px;--h:${rnd(H * 0.45, H * 0.8).toFixed(0)}px;--rot:${rnd(-14, 14).toFixed(0)}deg;--delay:${(i * 70)}ms"></i>`);
      }
      const n = spread ? 20 : 12;
      for (let i = 0; i < n; i++) {
        const t = pick(i);
        parts.push(`<i class="ub-petal" style="--x:${(t.x + rnd(-jx, jx) * 0.5).toFixed(0)}px;--y:${t.y.toFixed(0)}px;--dx:${rnd(-90, 90).toFixed(0)}px;--dy:${rnd(-190, -70).toFixed(0)}px;--delay:${rnd(60, 520).toFixed(0)}ms"></i>`);
      }
    } else if (element === "storm") {
      // 紫雷：落雷劈在目标卡上；单体就连劈同一张
      const n = spread ? 6 : 5;
      for (let i = 0; i < n; i++) {
        const t = pick(i);
        parts.push(`<i class="ub-bolt" style="--x:${(t.x + (spread ? 0 : rnd(-26, 26))).toFixed(0)}px;--h:${(t.y + 30).toFixed(0)}px;--delay:${(i * 90).toFixed(0)}ms"></i>`);
      }
      parts.push(`<i class="ub-flash" style="--delay:0ms"></i>`);
      parts.push(`<i class="ub-flash" style="--delay:280ms"></i>`);
    } else if (element === "light") {
      // 曜光：光柱落在目标卡上 + 目标位置扩散的光轮
      const n = spread ? 6 : 4;
      for (let i = 0; i < n; i++) {
        const t = pick(i);
        parts.push(`<i class="ub-pillar" style="--x:${(t.x + (spread ? 0 : rnd(-40, 40))).toFixed(0)}px;--w:${rnd(70, 130).toFixed(0)}px;--h:${(t.y + 40).toFixed(0)}px;--delay:${(i * 80).toFixed(0)}ms"></i>`);
      }
      for (const [k, t] of [pick(0), pick(1)].entries()) {
        parts.push(`<i class="ub-halo" style="--x:${t.x.toFixed(0)}px;--y:${t.y.toFixed(0)}px;--delay:${120 + k * 220}ms"></i>`);
      }
    } else {
      // 素月：月轮升起 + 数道月刃横扫（单体就只扫那一行）
      parts.push(`<i class="ub-moon"></i>`);
      const n = spread ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const t = pick(i);
        parts.push(`<i class="ub-crescent" style="--y:${t.y.toFixed(0)}px;--rot:${rnd(-16, 10).toFixed(0)}deg;--delay:${(i * 110).toFixed(0)}ms"></i>`);
      }
    }
    parts.push('<i class="ub-vignette"></i>');
    // 终式演出名：每个角色都有自己的招式名（content/vfx.json → variants.byChar.ultName），
    // 在元素主特效之上压一行竖排/横排题字，让"这一下是谁的招式"读得出来。
    if (opts.name) parts.push(`<i class="ub-name">${String(opts.name).replace(/[<>&]/g, "")}</i>`);
    wrap.innerHTML = parts.join("");
    host.appendChild(wrap);

    const dur = (spread ? 1180 : 1000) / spd;
    setTimeout(() => { wrap.remove(); resolve(); }, dur);
  });
}

function floatText(side, slot, text, cls) {
  if (bvFxMuted) return;
  const el = document.getElementById(`bu-${side}-${slot}`);
  if (!el) return;
  const f = document.createElement("span");
  f.className = "bfloat " + cls;
  f.textContent = text;
  el.appendChild(f);
  setTimeout(() => f.remove(), 1000);
}

/* ================= 战斗特效层 =================
 * 三层构成：
 *   1) 打击感 —— 受击卡牌的抖动/闪白/震屏，让"打中了"有分量
 *   2) 命中特效 —— 按元素在目标卡上爆开对应粒子（火/木/水/光/雷/月）
 *   3) 终式特效 —— 按角色元素+定位出不同的大招演出，不再全员共用一套
 * 全部用纯 CSS 动画 + 少量 DOM 节点，不引入 canvas，避免和现有布局打架。
 */

/** 六气各自的命中表现：颜色、粒子形状、动势。道门气质照 content/elements.json 的 mood。 */
const ELEM_FX = {
  flame:   { color: "#d0563c", glow: "#ff9a6a", shape: "spark",  drift: "up",    label: "焚" },
  verdant: { color: "#54915f", glow: "#9be08a", shape: "leaf",   drift: "float", label: "生" },
  tide:    { color: "#3d7f9c", glow: "#8fd6f0", shape: "drop",   drift: "down",  label: "涌" },
  light:   { color: "#dcc182", glow: "#fff3c4", shape: "ray",    drift: "out",   label: "曜" },
  storm:   { color: "#8f7cc0", glow: "#c9b6ff", shape: "bolt",   drift: "zig",   label: "霆" },
  dusk:    { color: "#6a5f86", glow: "#b9a9d6", shape: "moon",   drift: "vortex",label: "阴" },
};
const fxOf = e => ELEM_FX[e] || { color: "#c9b48a", glow: "#efe3c4", shape: "spark", drift: "float", label: "缘" };

/** 取某张卡元素的根节点；拿不到就静默返回 */
const cardEl = (side, slot) => document.getElementById(`bu-${side}-${slot}`);

/** 顿帧：命中瞬间把演出按住几十毫秒，再从停顿里"弹"出来 —— 打击感的关键。
 *  实现上分两步：特效层动画真的暂停（animation-play-state），计时也真的等，
 *  这样不只是"看起来慢"，而是伤害数字确实晚 70ms 才弹。 */
let _hsTimer = null;
async function hitStop(side, slot, opts) {
  opts = opts || {};
  const bv = document.getElementById("battleView");
  const el = cardEl(side, slot);
  const ms = Math.round((opts.ms || 70) / Math.max(0.6, opts.speed || 1));
  if (bv) bv.classList.add("hitstop");
  if (el) {
    el.classList.remove("hitpunch");
    void el.offsetWidth;
    el.classList.add("hitpunch");
    clearTimeout(_hsTimer);
    _hsTimer = setTimeout(() => el.classList.remove("hitpunch"), 200);
  }
  await sleep(ms);
  if (bv) bv.classList.remove("hitstop");
}

/** 在目标卡上撒一层元素粒子。数量克制（默认 9），避免战斗界面糊成一片。 */
function burst(side, slot, element, { n = 9, big = false } = {}) {
  if (bvFxMuted) return;
  const el = cardEl(side, slot);
  if (!el) return;
  const fx = fxOf(element);
  const wrap = document.createElement("div");
  wrap.className = "fx-burst" + (big ? " big" : "");
  wrap.style.setProperty("--fx-c", fx.color);
  wrap.style.setProperty("--fx-g", fx.glow);
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = `fx-p fx-${fx.shape}`;
    // 角度铺满一圈，半径带随机，看起来才不呆板
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const r = (big ? 46 : 26) + Math.random() * (big ? 34 : 16);
    p.style.setProperty("--dx", `${Math.cos(a) * r}px`);
    p.style.setProperty("--dy", `${Math.sin(a) * r}px`);
    p.style.animationDelay = `${Math.random() * 90}ms`;
    wrap.appendChild(p);
  }
  el.appendChild(wrap);
  setTimeout(() => wrap.remove(), 720);
}

/** 受击反馈：抖动 + 元素色描边 + 粒子 + 数字。这是"打击感"的主体。
 *  会心顺带震屏，把"该不该震"收在这个函数里，免得每个调用点都要记得再写一次 shake()。
 *  unit 传入被击单位时顺带喊受击台词：会心必出、普伤 25% 概率，同角色 2.8s 冷却，
 *  且优先级低（priority 1）——绝不打断在播的大招/登场语音。 */
function hitFeedback(side, slot, { element, crit = false, kill = false, unit = null } = {}) {
  if (bvFxMuted) return;
  const el = cardEl(side, slot);
  if (!el) return;
  el.classList.remove("hit", "hit-crit", "hit-kill");
  // 强制回流，否则连续两次同类受击不会重播动画
  void el.offsetWidth;
  el.classList.add(crit ? "hit-crit" : "hit");
  if (kill) el.classList.add("hit-kill");
  const fx = fxOf(element);
  el.style.setProperty("--hit-c", fx.color);
  el.style.setProperty("--hit-g", fx.glow);
  // 用共享清理定时器，避免连击时后一次的 class 被前一次的回调摘掉
  clearTimeout(el._hitTimer);
  el._hitTimer = setTimeout(() => el.classList.remove("hit", "hit-crit", "hit-kill"), 460);
  burst(side, slot, element, { n: crit ? 14 : 9, big: crit });
  if (crit || kill) shake("md");
  if (unit?.id && !kill && (crit || Math.random() < 0.25))
    AudioSys.cv(unit.id, "hurt", { priority: 1, gate: 2.8 });
}

/** 屏幕震动：会心/击杀/大招时给，普通受击不给，否则整场都在抖。
 *  用共享定时器句柄：连续会心时若各起一个 setTimeout，前一次的清理会
 *  把后一次的 shake class 提前摘掉，表现就是"连击时震屏只抖第一下"。 */
let _shakeTimer = null;
function shake(level = "sm") {
  if (bvFxMuted) return;
  const bv = document.getElementById("battleView");
  if (!bv) return;
  clearTimeout(_shakeTimer);
  bv.classList.remove("shake-sm", "shake-md", "shake-lg");
  void bv.offsetWidth;
  bv.classList.add(`shake-${level}`);
  _shakeTimer = setTimeout(() => {
    bv.classList.remove("shake-sm", "shake-md", "shake-lg");
    _shakeTimer = null;
  }, 420);
}

/** 出手前的蓄势：行动者的卡向上顶一下并亮边，提示"该它了"。 */
function castWindup(side, slot, element, isUlt = false) {
  if (bvFxMuted) return;
  const el = cardEl(side, slot);
  if (!el) return;
  el.classList.remove("windup", "windup-ult");
  void el.offsetWidth;
  el.classList.add(isUlt ? "windup-ult" : "windup");
  el.style.setProperty("--hit-c", fxOf(element).color);
  el.style.setProperty("--hit-g", fxOf(element).glow);
  setTimeout(() => el.classList.remove("windup", "windup-ult"), 520);
}

const BUFF_FX_CLASS = { heal: "heal", shield: "shield", buff: "boon", curse: "curse" };
/** 治疗/护盾/增益/减益的柔和反馈：颜色各走一套，不再一律套"治疗绿" */
function buffFeedback(side, slot, kind = "heal") {
  if (bvFxMuted) return;
  const el = cardEl(side, slot);
  if (!el) return;
  el.classList.remove("fx-buff", "fx-heal", "fx-shield", "fx-curse", "fx-boon");
  void el.offsetWidth;
  el.classList.add("fx-buff", `fx-${BUFF_FX_CLASS[kind] || kind}`);
  clearTimeout(el._buffTimer);
  el._buffTimer = setTimeout(() => el.classList.remove("fx-buff", "fx-heal", "fx-shield", "fx-curse", "fx-boon"), 760);
}

/* ---- 终式特效：按元素 + 定位分裂出不同演出 ---- */
const ULT_STYLE = {
  flame:   { kind: "pillar",  label: "炎柱" },
  verdant: { kind: "bloom",   label: "藤生" },
  tide:    { kind: "wave",    label: "潮涌" },
  light:   { kind: "rays",    label: "曜临" },
  storm:   { kind: "thunder", label: "雷落" },
  dusk:    { kind: "vortex",  label: "月蚀" },
};

/** 终式专属全屏特效层。
 *  在 cutIn 立绘【退场之后】单独播放：立绘负责"是谁在放大招"，
 *  这一层负责"招式长什么样"，两段串行，互不遮挡。
 */
function ultFx(element, role, speed = 1) {
  if (bvFxMuted) return;
  const fxEpoch = bvFxEpoch;
  const host = document.getElementById("bvUltFx");
  if (!host) return;
  const fx = fxOf(element);
  const st = ULT_STYLE[element] || { kind: "rays", label: "缘" };
  /* 定位决定演出的"重量感"。role 取自 content/roles.json 的 list：
   *   burst 破军 / cleave 席卷 / break 凿阵 → 输出，最锐
   *   sustain 回春 / support 扶倾 → 辅助，偏柔
   *   guard 磐石 / control 摄魂 → 防守与控制，偏重
   */
  const roleBoost = ["sustain", "support"].includes(role) ? "soft"
    : ["guard", "control"].includes(role) ? "heavy" : "sharp";
  host.className = "";
  void host.offsetWidth;
  host.style.setProperty("--ufx-c", fx.color);
  host.style.setProperty("--ufx-g", fx.glow);
  host.innerHTML =
    `<div class="ufx-backdrop"></div>` +
    `<div class="ufx-core ufx-${st.kind}"></div>` +
    `<div class="ufx-ring"></div>` +
    (st.kind === "thunder" ? `<div class="ufx-bolt"></div><div class="ufx-bolt b2"></div>` : "") +
    (st.kind === "pillar" ? `<div class="ufx-embers">${"<i></i>".repeat(10)}</div>` : "") +
    (st.kind === "bloom" ? `<div class="ufx-petals">${"<i></i>".repeat(10)}</div>` : "") +
    (st.kind === "wave" ? `<div class="ufx-wave w1"></div><div class="ufx-wave w2"></div><div class="ufx-wave w3"></div>` : "") +
    (st.kind === "vortex" ? `<div class="ufx-vortex-spin"></div>` : "") +
    `<div class="ufx-flash"></div>`;
  host.classList.add("on", `ufx-mode-${roleBoost}`);
  setTimeout(() => {
    if (fxEpoch !== bvFxEpoch) return;   // 已跳过/换场：不要清掉新一场的特效层
    host.classList.remove("on"); host.innerHTML = "";
  }, 1900 / speed);
}


function logLine(html) {
  const box = $("#bvLog");
  box.insertAdjacentHTML("beforeend", `<div class="bvl">${html}</div>`);
  while (box.children.length > 6) box.firstChild.remove();
}

/* ================= 跳过/换场时的演出清理 =================
 * 背景：点「跳过」只让回放循环立刻退出，但已经启动的异步演出（投射物、cut-in、终式视频、
 * 全屏特效、粒子计时器）还会继续往 #battleView 里写节点。下一场开始时用的是同一个
 * #battleView 元素，于是上一场的演出会叠在新一场上继续播——玩家看到的就是
 * 「我跳过了，后台还在按战斗画面打」。连跳几场后残留的全屏层越叠越多，其中
 * cut-in / 视频层还是能接收点击的实心元素，整页就变成"点什么都没反应"。
 * 这里在跳过/关战斗层时统一：
 *   ① 停掉所有终式视频并清空视频层；② 移除全部临时特效节点（ubar/pj/bfloat/…）；
 *   ③ 关闭 cut-in；④ 清空终式特效层与横幅。只清演出，不碰战斗数据/结算。 */
let bvFxEpoch = 0;   // 演出代次：新一场/清理时 +1，旧场次的迟到演出据此放过新战场
let bvFxMuted = false;   // 跳过/关层后置 true：旧场次的迟到特效不再写入 DOM，直到下一场开战
function bvFxReset() { bvFxMuted = false; bvFxEpoch++; }
function bvClearFx() {
  try {
    const bv = document.getElementById("battleView");
    bvFxMuted = true;
    bvFxEpoch++;
    if (!bv) return;
    // 终式视频：暂停 + 清源，避免解码器继续跑
    bv.querySelectorAll("video").forEach(v => {
      try { v.pause(); } catch {}
      try { v.removeAttribute("src"); v.load && v.load(); } catch {}
    });
    /* 所有临时演出节点必须一次性清空。
     * 2026-11-05 复盘：phaseDescend()（BOSS 阶段 Cut-in）把 .xpb-phase 直接挂在 #battleView 上，
     * 但这里原来的清理名单只列了 ubar/pj/bfloat/ufx，漏掉 xpb-* 全套；而 phaseDescend 自己的
     * 延时删除又带 `fxEpoch === bvFxEpoch` 守卫——点跳过时 epoch 已经 +1，这个 remove 永远不会执行。
     * 结果每跳一场就永久残留一层 position:fixed 的全屏黑幕（还挂着动画），连跳几场后整页被多层
     * 遮罩盖住、主线程被残留动画拖死，玩家看到的就是「跳过之后后台还在打，然后点什么都没反应」。
     * 这里补齐全部 xpb-* / fx-* 演出层，并在删除前先 cancel 该节点自己的动画。 */
    const FX_SEL = ".ub-video-layer, .ubar, .pj, .pj-spark, .pj-boltbeam, .pj-moonblade, .pj-recall, .pj-slam, .pj-thread-bit, .pj-flare, .bfloat, .ufx-layer, .xpb-phase, .xpb-boss-enter, .xpb-shatters, .xpb-rb, .xpb-modban, .fx-burst, .xpb-ci2";
    // 注意：.xpb-enter / .xpb-breakflash 是加在单位卡「本身」上的临时类，不是独立节点，
    // 不能放进选择器——否则会连整张角色卡一起删掉。
    bv.querySelectorAll(FX_SEL).forEach(el => {
      try { if (el.getAnimations) el.getAnimations().forEach(a => { try { a.cancel(); } catch {} }); } catch {}
      el.remove();
    });
    // 兜底扫尾：任何仍挂在战斗层下的 xpb-*/ub-*/fx-* 临时节点（防止以后新增演出又忘了登记）
    [...bv.children].forEach(el => {
      const cls = typeof el.className === "string" ? el.className : "";
      if (/(^|\s)(xpb-|ub-|fx-|pj|bfloat)/.test(cls) && !el.id?.startsWith("bv")) el.remove();
    });
    const cut = document.getElementById("bvCutin");
    if (cut) {
      cut.classList.remove("on");
      cut.querySelectorAll(".xpb-ci2").forEach(el => el.remove());
    }
    const ufx = document.getElementById("bvUltFx");
    if (ufx) { ufx.classList.remove("on"); ufx.innerHTML = ""; }
    const banner = document.getElementById("bvBanner");
    if (banner) { banner.classList.remove("on", "xpb-mod-on", "fcast-on"); banner.innerHTML = ""; }
    const flash = document.getElementById("bvFlash");
    if (flash) flash.classList.remove("on");
    bv.classList.remove("hitstop", "shake-sm", "shake-md", "shake-lg");
  } catch (e) { console.warn("[battle-fx] 清理演出失败", e); }
}

/* ================= 底部单位面板（点谁看谁） =================
 * 以前这块跟着"当前行动者"自动换人，玩家想看一眼自己某个角色的攻防/身上挂的 buff，
 * 得等它出手那一瞬间。现在改成"点卡片选中谁就看谁"：
 *   · 左上角仍是选中角色的头像/名字/稀有度/等级
 *   · 下面是实时血量、怒气、面板六维（基础值来自 C#，战斗内增减由 BT 追踪到的状态叠上去）
 *   · 再下面是它身上的状态图标（和卡片下那排同一套，悬停可看数值与剩余回合）
 *   · 右边三张技能卡也换成选中角色的
 * 行动者不再抢面板，只用卡片高亮 + 名字后面的「行动中」标记。
 */
let bvUnits = {};        // "side-slot" → 单位身份行（UnitRow）
let bvSel = null;        // {side, slot} 当前选中的单位
let bvActing = null;     // {side, slot} 本回合行动者（只做标记，不抢面板）
let bvCastNote = "";     // 本回合放出的技能名（用来点亮技能卡）
let bvSkSig = "";        // 技能卡/姓名区的签名，没变就不重画

const BA_STATS = [
  ["atk", "攻", v => Math.round(v)],
  ["def", "防", v => Math.round(v)],
  ["mdef", "法抗", v => Math.round(v)],
  ["spd", "速", v => Math.round(v)],
  ["crit", "暴", v => `${(v * 100).toFixed(1)}%`],
];

/** 选中某个单位（点卡片触发） */
function bvSelect(side, slot) {
  if (!BT.live.has(btKey(side, slot))) return;
  bvSel = { side, slot };
  $$("#battleView .buc, #battleView .boss-unit").forEach(el => {
    el.classList.toggle("sel", +el.dataset.side === side && +el.dataset.slot === slot);
  });
  bvSkSig = "";
  bvShowPanel();
}

/** 面板六维 = 开战面板值 + 自己追踪到的状态（和 C# 的 Unit.Modified 同一套规则） */
function bvStatValue(side, slot, stat) {
  const unit = bvUnits[btKey(side, slot)];
  let v = Number(unit?.[stat] ?? 0);
  if (!v) return 0;
  for (const st of BT.status.get(btKey(side, slot)) || []) {
    if (st.stat !== stat) continue;
    const n = Number(st.value) || 0;
    v = st.op === "mul" ? v * Math.pow(n, st.stacks || 1) : v + n * (st.stacks || 1);
  }
  return v;
}

/** 面板里"实时会变"的那几块：血量/护盾/怒气/六维/状态图标 */
function bvPanelRefresh() {
  const sel = bvSel;
  const u = sel && BT.live.get(btKey(sel.side, sel.slot));
  const unit = sel && bvUnits[btKey(sel.side, sel.slot)];
  if (!u || !unit) return;
  const pct = Math.max(0, Math.min(100, u.hp / Math.max(1, u.maxHp) * 100));
  const bar = $("#baHp");
  if (bar) {
    bar.style.width = pct + "%";
    bar.style.background = pct > 45 ? "linear-gradient(90deg,#5fbf7f,#3f9f63)"
      : pct > 20 ? "linear-gradient(90deg,#d9a13b,#b8862c)" : "linear-gradient(90deg,#c0564a,#9e4038)";
  }
  const t = $("#baHpT");
  if (t) t.textContent = `${Math.round(u.hp)} / ${Math.round(u.maxHp)}`;
  const en = $("#baEn");
  if (en) en.textContent = u.alive ? `怒气 ${Math.round(u.energy)}/100${u.shield > 0 ? ` · 盾 ${Math.round(u.shield)}` : ""}` : "已 倒 下";
  const stBox = $("#baStat");
  if (stBox) {
    stBox.innerHTML = BA_STATS.map(([key, label, fmt]) => {
      const base = Number(unit[key] || 0);
      const cur = bvStatValue(sel.side, sel.slot, key);
      const tone = cur > base * 1.005 ? " up" : cur < base * 0.995 ? " down" : "";
      const arrow = tone === " up" ? "↑" : tone === " down" ? "↓" : "";
      return `<span class="bast${tone}">${label}<b>${fmt(cur)}</b><i>${arrow}</i></span>`;
    }).join("");
  }
  const bf = $("#baBuffs");
  if (bf) {
    const list = BT.status.get(btKey(sel.side, sel.slot)) || [];
    bf.innerHTML = list.length ? btChipsHtml(list, u) : `<span class="ba-none">${u.alive ? "无状态" : "已倒下"}</span>`;
  }
  const tag = $("#baTag");
  if (tag) {
    const acting = bvActing && bvActing.side === sel.side && bvActing.slot === sel.slot;
    tag.textContent = !u.alive ? "倒下" : acting ? "行动中" : "已选中";
    tag.className = `ba-tag${u.alive ? (acting ? " acting" : "") : " dead"}`;
  }
}

/** 整块重画（换选中目标时调用；平时只走 bvPanelRefresh） */
function bvShowPanel() {
  const sel = bvSel;
  const u = sel && BT.live.get(btKey(sel.side, sel.slot));
  const unit = sel && bvUnits[btKey(sel.side, sel.slot)];
  const face = $("#baFace");
  if (!u || !unit) {
    if (face) face.innerHTML = "";
    $("#baName").textContent = "—";
    $("#baMeta").textContent = "";
    $("#baTag").textContent = "";
    $("#bvSkills").innerHTML = `<div class="skc wide"><div class="sk-t">点 选 角 色</div>
      <div class="sk-d">点任意一张卡（我方或敌方），这里显示它的血量、攻防面板与身上状态。</div>
      <span class="sk-tag">单 位</span></div>`;
    bvSkSig = "";
    return;
  }
  if (face) face.innerHTML = `<img src="${art(unit.id, "avatar")}" alt="" data-fb="portrait,card">`;
  $("#baName").textContent = unit.name;
  const rc = RTAG(unit.rarity || "blue");
  const el = DATA.elements[unit.element];
  const role = unit.role ? ` · ${RLABLEX(unit.role) || ""}` : "";
  const sideLabel = sel.side === 0 ? "" : " · 敌";
  $("#baMeta").innerHTML =
    `<span style="color:${RCOLOR(unit.rarity)}">${rc}</span> · ${el ? el.label : "?"}${role} · Lv.${unit.level}${sideLabel}`;
  bvPanelRefresh();

  // 技能卡：只有我方角色有完整技能数据；敌方给一张"观察其意图"的宽卡
  const sig = `${sel.side}-${sel.slot}-${bvCastNote}-${u.alive}-${bvActing && bvActing.side === sel.side && bvActing.slot === sel.slot ? 1 : 0}`;
  if (sig === bvSkSig) return;
  bvSkSig = sig;
  const sk = $("#bvSkills");
  if (sel.side === 0) {
    const c = charById(unit.id);
    const list = (c?.skills || []).filter(s => ["attack", "ultimate", "passive"].includes(s.slot));
    sk.innerHTML = list.map(s => `
      <div class="skc" data-slot="${s.slot}">
        <div class="sk-t">${esc(s.name)}</div>
        <div class="sk-d">${skillDesc(s.desc) || "——"}</div>
        <span class="sk-tag">${SLOT_NAME[s.slot] || s.slot}</span>
      </div>`).join("") || `<div class="skc"><div class="sk-t">行 动</div><div class="sk-d">——</div></div>`;
    if (bvCastNote && bvActing && bvActing.side === sel.side && bvActing.slot === sel.slot) {
      // 只有"选中的这个人自己出手"才点亮技能卡：不同单位常有同名招式（比如 当关拒浪），
      // 光按技能名匹配会把别人的出手点亮到自己的卡上。
      const hit = (c?.skills || []).find(s => s.name === bvCastNote);
      const key = hit?.slot || "attack";
      if (key) sk.querySelector(`.skc[data-slot="${key}"]`)?.classList.add("cast");
    }
  } else {
    const nm = bvCastNote || (unit.role ? `${RPOS(unit.role) || RLABEL(unit.role) || ""}型` : "敌 方");
    sk.innerHTML = `<div class="skc wide"><div class="sk-t">${esc(nm)}</div>
      <div class="sk-d">敌方单位 · 观察其意图与身上状态；点我方卡可切回查看自己的角色。</div>
      <span class="sk-tag">敌 方</span></div>`;
  }
}

/** 终式 cut-in：元素染黑幕 → 大招立绘全屏推近 → 放射光 → 名字/技能落位 → 三段刀光 → 闪白。 */
async function cutIn(u, skillName, desc, speed) {
  if (bvFxMuted) return;
  const fxEpoch = bvFxEpoch;
  const c = $("#bvCutin");
  const elc = ECOLOR(u.element) || "#e8c98a";
  c.style.setProperty("--ci-el", elc);
  $("#ciWho").textContent = `${u.name} · ${DATA.elements[u.element]?.label ?? ""}气`;
  const sk = $("#ciSkill");
  sk.textContent = skillName;
  sk.style.color = elc;
  $("#ciDesc").textContent = desc || "";
  // 大招必须用专属大招立绘全屏铺满；缺图依次退动态立绘、卡面
  const artEl = $("#ciArt");
  artEl.onerror = () => {
    if (artEl.dataset.stage === "ult") { artEl.dataset.stage = "dyn"; artEl.src = art(u.id, "dynamic"); return; }
    artEl.onerror = null; artEl.src = art(u.id, "portrait");
  };
  artEl.dataset.stage = "ult";
  artEl.src = art(u.id, "ultimate");
  c.classList.add("on");
  setTimeout(() => AudioSys.sfx("ult_boom", { force: true }), Math.round(1300 / speed));
  await sleep(1750 / speed);
  if (fxEpoch !== bvFxEpoch) return;   // 已经跳过/开新场：别去关新一场的 cut-in
  c.classList.remove("on");
}

/** 敌方大招横幅：小怪放大招时只给"抬头看一眼"的信息量，不铺全屏立绘。
 *  时长刻意比 cutIn 短（cutIn 约 1.75s），并随倍速一起压缩，避免拖垮战斗节奏。 */
async function foeCastBanner(u, skillName, speed) {
  if (bvFxMuted) return;
  const fxEpoch = bvFxEpoch;
  const banner = $("#bvBanner");
  const elc = ECOLOR(u?.element) || "#e8c98a";
  banner.innerHTML =
    `<div class="fcast" style="--fc-el:${elc}">` +
      `<span class="fc-who">${esc(u?.name || "")}</span>` +
      `<span class="fc-skill">${esc(skillName || "终式")}</span>` +
    `</div>`;
  banner.classList.add("on", "fcast-on");
  await sleep(760 / speed);
  if (fxEpoch !== bvFxEpoch) return;
  banner.classList.remove("on", "fcast-on");
  banner.innerHTML = "";
}

/* ================= 扩展演出（DESIGN-EXPANSION） =================
 * 天时横幅 / BOSS 阶段 Cut-in / 双人合击 Cut-in / 破防碎裂 /
 * 六气反应气泡 / 候补·召唤滑入 / 天时脉冲提示。
 * 全部复用既有通道（#bvBanner 暗带、#bvCutin 立绘、卡片浮字与粒子），
 * 每个入口自带 try/catch：任何一条演出抛错都只跳过本条，绝不卡死整场回放。 */

/** 天时词条横幅（开战逐条，2.5s 一条）。tone 可能是色值也可能是语义键，非色值走默认青。 */
async function modBannerOnce(mod, speed) {
  try {
    const banner = $("#bvBanner");
    if (!banner || !mod || bvFxMuted) return;
    const fxEpoch = bvFxEpoch;
    const elc = typeof mod.tone === "string" && mod.tone.startsWith("#") ? mod.tone : "#8fb6e8";
    banner.innerHTML =
      `<div class="xpb-modban" style="--xpb-el:${elc}">` +
        `<span class="xpb-mb-who">天 时</span>` +
        `<span class="xpb-mb-name">${esc(mod.name || "")}</span>` +
        (mod.desc ? `<span class="xpb-mb-desc">${esc(mod.desc)}</span>` : "") +
      `</div>`;
    banner.classList.add("on", "xpb-mod-on");
    await sleep(2500 / Math.max(0.6, speed || 1));
    if (fxEpoch !== bvFxEpoch) return;
    banner.classList.remove("on", "xpb-mod-on");
    banner.innerHTML = "";
  } catch (e) { console.warn("[battle-fx] 天时横幅失败，跳过", e); }
}

/** BOSS 阶段切换：暗幕 + 「进入第 X 形」 + 台词气泡（事件 note），震屏一次，约 2s。 */
function phaseDescend(bossName, phaseIdx, line, speed) {
  return new Promise((resolve) => {
    try {
      if (bvFxMuted) { resolve(); return; }
      const fxEpoch = bvFxEpoch;
      const host = document.getElementById("battleView");
      if (!host) { resolve(); return; }
      const spd = Math.max(0.6, speed || 1);
      const dur = 2000 / spd;
      // 引擎默认 note 是「第 X 阶段」，与标题重复时不作台词显示
      const hasLine = !!line && !/^第\s*\d+\s*阶段$/.test(line);
      const ov = document.createElement("div");
      ov.className = "xpb-phase";
      ov.innerHTML =
        `<div class="xpb-ph-shade"></div>` +
        `<div class="xpb-ph-body">` +
          `<span class="xpb-ph-who">${esc(bossName || "关 主")}</span>` +
          `<span class="xpb-ph-title">进入第 ${Number(phaseIdx) || 1} 形</span>` +
          (hasLine ? `<span class="xpb-ph-line">「${esc(line)}」</span>` : "") +
        `</div>`;
      host.appendChild(ov);
      shake("md");
      AudioSys.sfx("ult_charge", { force: true });
      /* 无条件 remove 自己这一层：ov 是本函数新建的独占节点，即使期间点了跳过（bvFxEpoch 已 +1）
       * 或已开下一场，删掉它也不会碰到新场次的任何元素。旧写法带 fxEpoch 守卫，跳过时这里永远
       * 不执行，全屏黑幕就永久留在 #battleView 上——连跳几场必卡死。 */
      setTimeout(() => { ov.remove(); resolve(); }, dur);
    } catch (e) { console.warn("[battle-fx] 阶段演出失败，跳过", e); resolve(); }
  });
}

/** 关主档案补全：战斗结果行只带战斗字段，台词/称号从角色档案或万妖谱取。 */
function bossMetaOf(id) {
  let c = null;
  try {
    c = typeof charById === "function" ? charById(id) : null;
  } catch (e) { /* 非战斗页无妨 */ }
  let b = null;
  try {
    b = (DATA.bestiary?.list || []).find(x => x.id === id) || null;
  } catch (e) { /* 无万妖谱数据 */ }
  // 名册档案可能不带完整 voice（serve 只下发展示字段），万妖谱条目带了 voice + cvSlots：
  // 两边合并，voice 优先取带 cvSlots 的那份。
  if (c && b) return { ...c, ...b, voice: b.voice || c.voice, title: c.title || b.title };
  return b || c;
}

/** 取关主台词：voice.lines.enter / voice.phases[n] 两种档案结构都兼容。 */
function bossLineOf(id, slot = "enter") {
  const c = bossMetaOf(id);
  const voice = c?.voice || {};
  const lines = voice.lines || {};
  // 有实录音效的出场句优先用 lines.enter（字幕与音频同源）；
  // 活动妖王等没录 enter 的档案，登场句退回 mobs.json 的第 1 阶段台词。
  const hasEnter = Array.isArray(voice.cvSlots) ? voice.cvSlots.includes("enter") : true;
  if (slot === "enter") {
    if (hasEnter && typeof lines.enter === "string" && (voice.source === "authored" || !Array.isArray(voice.phases))) return lines.enter;
    if (Array.isArray(voice.phases) && voice.phases.length) return String(voice.phases[0] || "");
    return typeof lines.enter === "string" ? lines.enter : "";
  }
  if (typeof lines[slot] === "string") return lines[slot];
  const m = /^phase-(\d+)$/.exec(String(slot));
  if (m && Array.isArray(voice.phases)) return String(voice.phases[Number(m[1]) - 1] || "");
  return "";
}

/** 关主是否有某个槽位的实录音频（活动妖王常缺 CV，别去请求 404）。 */
function bossHasCv(id, slot) {
  const c = bossMetaOf(id);
  const slots = c?.voice?.cvSlots;
  return Array.isArray(slots) ? slots.includes(slot) : true;
}

/** 关主登场：黑幕压场 → 妖气旋涡 → 立绘自下而上推入 → 名号落位 → 台词 + 登场 CV。
 *  约 3s（随战斗倍速压缩），只在本场第一次见到关主时由 battle.js 调用一次。 */
async function bossEnter(boss, speed) {
  try {
    if (bvFxMuted || !boss) return;
    const fxEpoch = bvFxEpoch;
    const host = document.getElementById("battleView");
    if (!host) return;
    /* 关主登场是整场战斗的仪式感顶点：倍速最多压到 1.25×，不能跟着 2× 变成一闪而过
     * （玩家连台词都来不及看）。普通演出仍严格按玩家选择的速度。 */
    const spd = Math.min(1.25, Math.max(0.6, Number(speed) || 1));
    const elc = ECOLOR(boss.element) || "#c0564a";
    const meta = bossMetaOf(boss.id);
    const title = boss.title || meta?.title || meta?.bossTitle || "";
    const line = bossLineOf(boss.id, "enter");
    const ov = document.createElement("div");
    ov.className = "xpb-boss-enter";
    ov.style.setProperty("--xbe-el", elc);
    ov.innerHTML =
      `<div class="xbe-shade"></div>` +
      `<div class="xbe-vortex"></div>` +
      `<div class="xbe-artwrap"><img class="xbe-art" src="${art(boss.id, "dynamic")}" alt="" data-fb="standee,portrait,card"></div>` +
      `<div class="xbe-plate">` +
        `<span class="xbe-mark">妖 王 登 场</span>` +
        `<span class="xbe-name">${esc(boss.name || "关 主")}</span>` +
        (title ? `<span class="xbe-title">${esc(title)}</span>` : "") +
      `</div>` +
      `<div class="xbe-line">${line ? `「${esc(line)}」` : ""}</div>`;
    host.appendChild(ov);
    // 动态立绘缺失时逐级回退：standee → portrait → 卡面；全缺就只留名号与台词
    const img = ov.querySelector(".xbe-art");
    if (img) {
      img.onerror = () => {
        const st = img.dataset.stage || "dynamic";
        if (st === "dynamic") { img.dataset.stage = "standee"; img.src = art(boss.id, "standee"); return; }
        if (st === "standee") { img.dataset.stage = "portrait"; img.src = art(boss.id, "portrait"); return; }
        img.onerror = null; img.remove();
      };
    }
    AudioSys.sfx("ult_charge", { force: true });
    setTimeout(() => { try { if (fxEpoch === bvFxEpoch) AudioSys.sfx("ult_boom", { force: true }); } catch (e) {} }, Math.round(950 / spd));
    // 立绘落位后再显台词，同时起关主登场 CV（enter.mp3/wav）
    setTimeout(() => {
      try {
        if (fxEpoch !== bvFxEpoch || !ov.isConnected) return;
        ov.classList.add("show-line");
        if (bossHasCv(boss.id, "enter")) AudioSys.cv(boss.id, "enter", { priority: 3 });
      } catch (e) { /* 语音失败不影响演出 */ }
    }, Math.round(1250 / spd));
    await sleep(3200 / spd);
    ov.remove();
  } catch (e) { console.warn("[battle-fx] 关主登场演出失败，跳过", e); }
}

/** 立绘三级兜底：ultimate → card → portrait（合击用，与终式的 ult→dynamic→portrait 链分开） */
function comboArtChain(img, id) {
  img.onerror = () => {
    const stage = img.dataset.stage;
    if (stage === "ult") { img.dataset.stage = "card"; img.src = art(id, "card"); return; }
    if (stage === "card") { img.dataset.stage = "portrait"; img.src = art(id, "portrait"); return; }
    img.onerror = null;
    img.remove();
  };
}

/** 双人合击 Cut-in：复用 #bvCutin。主位立绘在 #ciArt，副位从右侧斜切推入（.xpb-ci2）。
 *  ciWho = 「A ✕ B」，ciSkill = 合击名，ciDesc = 台词（comboLine 事件的 note）。 */
async function comboCutIn(uA, uB, comboName, line, speed) {
  let art2 = null;
  try {
    if (bvFxMuted) return;
    const fxEpoch = bvFxEpoch;
    const c = $("#bvCutin");
    if (!c) return;
    const spd = Math.max(0.6, speed || 1);
    const elc = ECOLOR(uA?.element) || "#e8c98a";
    c.style.setProperty("--ci-el", elc);
    $("#ciWho").textContent = `${uA?.name || "?"} ✕ ${uB?.name || "?"}`;
    const sk = $("#ciSkill");
    sk.textContent = comboName || "合 击";
    sk.style.color = "var(--gold-hi)";
    $("#ciDesc").textContent = line || "";
    const artEl = $("#ciArt");
    comboArtChain(artEl, uA?.id);
    artEl.dataset.stage = "ult";
    artEl.src = art(uA?.id, "ultimate");
    if (uB?.id) {
      art2 = document.createElement("img");
      art2.className = "ci-art xpb-ci2";
      art2.alt = "";
      comboArtChain(art2, uB.id);
      art2.dataset.stage = "ult";
      art2.src = art(uB.id, "ultimate");
      const text = c.querySelector(".ci-text");
      if (text) c.insertBefore(art2, text); else c.appendChild(art2);
    }
    c.classList.add("on");
    setTimeout(() => AudioSys.sfx("ult_boom", { force: true }), Math.round(1300 / spd));
    await sleep(1750 / spd);
  } catch (e) {
    console.warn("[battle-fx] 合击演出失败，跳过", e);
    try { $("#bvCutin")?.classList.remove("on"); } catch (e2) { /* 忽略 */ }
  } finally {
    try {
      if (fxEpoch === bvFxEpoch) {
        $("#bvCutin")?.classList.remove("on");
        art2?.remove();   // 副位立绘是临时节点，用完即撤，别污染下一次终式 cut-in
      }
    } catch (e) { /* 忽略 */ }
  }
}

/** 破防碎裂：目标卡白红碎裂色闪 + 碎片四溅 + 浮字「破防」。
 *  卡片持久的红光边由 btPaint 按 broken 标记挂 .broken（联动韧性条）。 */
function breakShatterFx(side, slot) {
  try {
    if (bvFxMuted) return;
    const el = cardEl(side, slot);
    if (!el) return;
    el.classList.remove("xpb-breakflash");
    void el.offsetWidth;
    el.classList.add("xpb-breakflash");
    setTimeout(() => el.classList.remove("xpb-breakflash"), 700);
    const wrap = document.createElement("div");
    wrap.className = "xpb-shatters";
    const cols = ["#ffe9c9", "#ff8a70", "#d0563c"];
    for (let i = 0; i < 12; i++) {
      const p = document.createElement("i");
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
      const r = 26 + Math.random() * 36;
      p.style.setProperty("--dx", `${Math.round(Math.cos(a) * r)}px`);
      p.style.setProperty("--dy", `${Math.round(Math.sin(a) * r)}px`);
      p.style.setProperty("--pc", cols[i % cols.length]);
      p.style.animationDelay = `${Math.round(Math.random() * 60)}ms`;
      wrap.appendChild(p);
    }
    el.appendChild(wrap);
    setTimeout(() => wrap.remove(), 780);
    floatText(side, slot, "破 防", "debuf");
    AudioSys.sfx("crit", { gate: 0.1, gain: 0.85 });
    shake("sm");
  } catch (e) { console.warn("[battle-fx] 破防演出失败，跳过", e); }
}

/** 六气反应：目标位置弹反应气泡（元素色渐变圆点），反应名走浮字。 */
function reactionBubble(side, slot, name) {
  try {
    if (bvFxMuted) return;
    const el = cardEl(side, slot);
    if (el) {
      el.querySelector(".xpb-react")?.remove();
      const b = document.createElement("div");
      b.className = "xpb-react";
      b.innerHTML = `<i class="xpb-rb-dot"></i>`;
      el.appendChild(b);
      setTimeout(() => b.remove(), 1500);
    }
    floatText(side, slot, String(name || "六气反应"), "buff");
    AudioSys.sfx("magic", { gate: 0.1, gain: 0.5 });
  } catch (e) { console.warn("[battle-fx] 反应演出失败，跳过", e); }
}

/** 候补/召唤入场：新卡从侧面滑入 + 浮字。我方从左进、敌方从右进。 */
function unitSlideIn(side, slot, label) {
  try {
    if (bvFxMuted) return;
    const el = cardEl(side, slot);
    if (el) {
      el.classList.add("xpb-enter", side === 0 ? "from-left" : "from-right");
      setTimeout(() => el.classList.remove("xpb-enter", "from-left", "from-right"), 920);
    }
    if (label) floatText(side, slot, label, "buff");
  } catch (e) { console.warn("[battle-fx] 登场演出失败，跳过", e); }
}

/** 天时脉冲（瘴气等）顶部提示：8s 节流，同一轮脉冲只轻提一次，不抢戏。 */
let _xpbModHintAt = 0;
function modPulseHint(name) {
  try {
    if (bvFxMuted) return;
    const now = Date.now();
    if (now - _xpbModHintAt < 8000) return;
    _xpbModHintAt = now;
    const host = document.getElementById("battleView");
    if (!host) return;
    const el = document.createElement("div");
    el.className = "xpb-modhint";
    el.textContent = `天时 · ${name || "战场异变"}`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  } catch (e) { /* 顶部小提示失败无所谓 */ }
}

