/* ==========================================================================
   技能效果词条（effects.json）
   - 技能描述里的效果词（「缄口」「嘲讽」「匿影」等）渲染成带颜色的可点击词条；
   - 点击在词条旁浮出效果说明（机制 / 应对），不打断当前界面（卡牌详情、名册右栏、战斗技能卡都能用）。
   数据来自 /api/boot 的 statics.effects（content/effects.json 直读）。
   ========================================================================== */
(function () {
  const TONE_CLASS = {
    control: "t-control", debuff: "t-debuff", dot: "t-dot", buff: "t-buff", special: "t-special",
  };
  let cachedList = null;
  let cachedRe = null;
  let cachedMap = null;

  function fxList() {
    const list = (typeof DATA !== "undefined" && DATA && Array.isArray(DATA.effects)) ? DATA.effects : [];
    if (list === cachedList && cachedRe) return list;
    cachedList = list;
    cachedMap = new Map();
    const terms = [];
    for (const e of list) {
      if (!e || !e.id || !e.name) continue;
      for (const t of [e.name, ...(e.alias || [])]) {
        if (!t) continue;
        if (!cachedMap.has(t)) cachedMap.set(t, e);
        terms.push(t);
      }
    }
    terms.sort((a, b) => b.length - a.length);
    cachedRe = terms.length
      ? new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g")
      : null;
    return list;
  }

  /** 渲染技能描述：普通文字照常转义，命中的效果词换成可点击词条。 */
  function skillDesc(text) {
    const s = String(text ?? "");
    if (!s) return "";
    fxList();
    if (!cachedRe || !cachedMap) return esc(s);
    // 每次重建，避免共享 lastIndex 在多处渲染间串状态
    const re = new RegExp(cachedRe.source, "g");
    let out = "";
    let last = 0;
    for (const m of s.matchAll(re)) {
      const eff = cachedMap.get(m[0]);
      if (!eff) continue;
      let start = m.index;
      let end = start + m[0].length;
      // 描述里常见的「缄口」把书名号一起做成词条，视觉上更接近原文
      const quoted = s[start - 1] === "「" && s[end] === "」";
      if (quoted) { start -= 1; end += 1; }
      out += esc(s.slice(last, start));
      const label = quoted ? `「${m[0]}」` : m[0];
      out += `<button type="button" class="fx-term ${TONE_CLASS[eff.tone] || "t-special"}" data-fx="${esc(eff.id)}" title="点击查看「${esc(eff.name)}」效果说明">${esc(label)}</button>`;
      last = end;
    }
    out += esc(s.slice(last));
    return out;
  }

  /* ---------------- 效果说明浮层 ---------------- */
  let popEl = null;
  let popOwner = null;

  function ensurePop() {
    if (popEl) return popEl;
    popEl = document.createElement("div");
    popEl.id = "fxPop";
    popEl.className = "fx-pop";
    popEl.setAttribute("role", "dialog");
    popEl.setAttribute("aria-label", "效果说明");
    popEl.addEventListener("click", (ev) => {
      if (ev.target.closest && ev.target.closest("[data-fxclose]")) closeEffect();
    });
    document.body.appendChild(popEl);
    return popEl;
  }

  function positionPop(anchor) {
    const pop = ensurePop();
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    // 先按视口高度上限自适应（长词条内部滚动），再量实际尺寸
    pop.style.maxHeight = Math.max(180, vh - 24) + "px";
    pop.style.overflowY = "auto";
    const pw = Math.min(pop.offsetWidth, vw - 24);
    const ph = Math.min(pop.offsetHeight, vh - 24);
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(12, Math.min(vw - pw - 12, left));
    let top = r.bottom + 8;
    if (top + ph > vh - 12) top = r.top - ph - 8;
    top = Math.max(12, Math.min(vh - ph - 12, top));
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  function openEffect(id, anchor) {
    const list = fxList();
    const e = list.find((x) => x.id === id) || (cachedMap && cachedMap.get(id));
    if (!e) return;
    const pop = ensurePop();
    pop.innerHTML = `
      <button class="fx-pop-x" type="button" data-fxclose aria-label="关闭">×</button>
      <div class="fxm-head">
        <span class="fx-term big ${TONE_CLASS[e.tone] || "t-special"}">${esc(e.name)}</span>
        <span class="fxm-tag">${esc(e.tag || "效果")}</span>
      </div>
      <div class="fxm-brief">${esc(e.brief || "")}</div>
      <div class="fxm-sec"><span class="k">机制</span><p>${esc(e.desc || "")}</p></div>
      ${e.counter ? `<div class="fxm-sec"><span class="k">应对</span><p>${esc(e.counter)}</p></div>` : ""}`;
    pop.style.visibility = "hidden";
    pop.hidden = false;
    pop.style.display = "block";
    positionPop(anchor);
    pop.style.visibility = "visible";
    popOwner = anchor;
    if (anchor && anchor.classList) anchor.classList.add("fx-on");
  }

  function closeEffect() {
    if (!popEl) return;
    popEl.hidden = true;
    popEl.style.display = "none";
    if (popOwner && popOwner.classList) popOwner.classList.remove("fx-on");
    popOwner = null;
  }

  // 点击词条 → 浮出说明；capture 阶段阻止冒泡，避免顺带触发技能卡/角色卡的其它点击逻辑
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest && ev.target.closest("[data-fx]");
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (popOwner === el && popEl && !popEl.hidden) { closeEffect(); return; }
    openEffect(el.dataset.fx, el);
  }, true);

  // 点别处 / Esc / 滚动 / 缩放：收起浮层（浮层内点击不关）
  document.addEventListener("click", (ev) => {
    if (!popEl || popEl.hidden) return;
    if (popEl.contains(ev.target)) return;
    closeEffect();
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeEffect(); });
  window.addEventListener("scroll", () => { if (popEl && !popEl.hidden) closeEffect(); }, true);
  window.addEventListener("resize", () => { if (popEl && !popEl.hidden) closeEffect(); });

  window.skillDesc = skillDesc;
  window.openEffect = (id) => openEffect(id, document.body);
  window.closeEffect = closeEffect;
})();
