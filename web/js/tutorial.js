/* 拾缘 · tutorial —— 新手教学指引（强制式：聚光 + 指针 + 只许点指定位置）
 *
 * 设计口径（2026-10-29 用户确认）：
 *  - 新注册 / 重置存档后自动开始，不需要点任何按钮。
 *  - 每一步用指针指到「该点哪里」，并用文字说明「它有什么作用」。
 *  - 强制：教学期间只有目标元素和教学卡可点，其他位置一律吞掉（capture 拦截）。
 *  - action 类步骤要等服务器 action 真正返回、且动画/弹窗状态满足条件后才推进，
 *    避免“点完还在演出”时下一步找不到目标。
 *  - 步骤内容在 content/tutorial.json（服务端直读下发 statics.tutorial），前端不写死文案。
 *  - 进度写回 save.tutorial（step / done），换设备可续看；完成后不再重复弹。
 */
(function () {
  "use strict";

  const state = { active: false, idx: 0, steps: [], expectAction: null, waiting: false, repeatLeft: 0, bypass: false, fillTimer: null, waitWatch: null };

  const stepsOf = () => {
    const t = (DATA && DATA.tutorial) || {};
    return Array.isArray(t.steps) ? t.steps : [];
  };
  const progress = () => (S && S.tutorial) || { done: true, step: 0 };

  function layer() {
    let el = document.getElementById("tutorialLayer");
    if (!el) {
      el = document.createElement("div");
      el.id = "tutorialLayer";
      el.className = "tut-layer";
      el.innerHTML = `
        <div class="tut-shade"></div>
        <div class="tut-hole off" id="tutHole"></div>
        <div class="tut-pointer off" id="tutPointer"></div>
        <div class="tut-card-host" id="tutCardHost"></div>`;
      document.body.appendChild(el);
    }
    return el;
  }

  function removeLayer() {
    const el = document.getElementById("tutorialLayer");
    if (el) el.remove();
  }

  function persist(done, restart) {
    try {
      if (typeof api !== "function") return;
      api({ type: "tutorial", step: state.idx, done: !!done, restart: !!restart }).catch(() => {});
    } catch (e) { /* 进度回写失败不阻断流程 */ }
  }

  function targetOf(step) {
    if (!step || !step.target) return null;
    try { return document.querySelector(step.target); } catch { return null; }
  }

  /** 目标可能在滚动区外：先滚到视野内再取框。 */
  function ensureVisible(el) {
    if (!el) return null;
    let r = el.getBoundingClientRect();
    const vh = innerHeight || 900, vw = innerWidth || 1440;
    if (r.bottom < 8 || r.top > vh - 8 || r.right < 8 || r.left > vw - 8) {
      try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
      r = el.getBoundingClientRect();
    }
    return r;
  }

  function place() {
    if (!state.active) return;
    const step = state.steps[state.idx] || {};
    const wrap = document.getElementById("tutorialLayer");
    const hole = document.getElementById("tutHole");
    const card = document.querySelector("#tutCardHost .tut-card");
    const pointer = document.getElementById("tutPointer");
    if (!wrap || !hole || !card || !pointer) return;
    const el = targetOf(step);
    const rect = el ? ensureVisible(el) : null;

    if (!rect || (rect.width < 2 && rect.height < 2)) {
      wrap.classList.remove("has-target");
      hole.classList.add("off");
      pointer.classList.add("off");
      const cw = card.offsetWidth || 392, ch = card.offsetHeight || 240;
      card.style.left = Math.max(12, (innerWidth - cw) / 2) + "px";
      card.style.top = Math.max(12, (innerHeight - ch) / 2) + "px";
      return;
    }

    wrap.classList.add("has-target");
    hole.classList.remove("off");
    pointer.classList.remove("off");
    const pad = 7;
    const left = Math.max(4, rect.left - pad);
    const top = Math.max(4, rect.top - pad);
    const width = Math.min(innerWidth - left - 4, rect.width + pad * 2);
    const height = Math.min(innerHeight - top - 4, rect.height + pad * 2);
    hole.style.left = left + "px";
    hole.style.top = top + "px";
    hole.style.width = width + "px";
    hole.style.height = height + "px";

    // 指针落在目标中心偏左上，像指尖点在按钮上
    const px = Math.max(10, Math.min(innerWidth - 56, rect.left + rect.width / 2 - 26));
    const py = Math.max(10, Math.min(innerHeight - 56, rect.top + rect.height / 2 - 26));
    pointer.style.left = px + "px";
    pointer.style.top = py + "px";

    // 卡片：优先右侧，其次左侧，再下方/上方，最后居中兜底
    const cw = card.offsetWidth || 392, ch = card.offsetHeight || 240, gap = 20;
    let x, y;
    if (left + width + gap + cw <= innerWidth - 12) {
      x = left + width + gap;
      y = Math.max(12, Math.min(innerHeight - ch - 12, top + height / 2 - ch / 2));
    } else if (left - gap - cw >= 12) {
      x = left - gap - cw;
      y = Math.max(12, Math.min(innerHeight - ch - 12, top + height / 2 - ch / 2));
    } else if (top + height + gap + ch <= innerHeight - 12) {
      x = Math.max(12, Math.min(innerWidth - cw - 12, left + width / 2 - cw / 2));
      y = top + height + gap;
    } else if (top - gap - ch >= 12) {
      x = Math.max(12, Math.min(innerWidth - cw - 12, left + width / 2 - cw / 2));
      y = top - gap - ch;
    } else {
      x = Math.max(12, Math.min(innerWidth - cw - 12, left + width / 2 - cw / 2));
      y = Math.max(12, (innerHeight - ch) / 2);
    }
    card.style.left = x + "px";
    card.style.top = y + "px";
  }

  function render() {
    if (!state.active) return;
    const step = state.steps[state.idx] || {};
    const total = state.steps.length;
    const info = step.kind === "info";
    state.expectAction = step.kind === "action" ? (step.actionType || "") : null;
    // repeat：同一个点击步骤要重复 N 次（如上阵补满 5 人）。进入步骤时重置计数。
    // repeatFillTeam：按“队伍还差几人”动态算次数，断点续看时不会多算已上阵的人。
    if (step.repeat && state.repeatStep !== step.id) {
      state.repeatStep = step.id;
      state.repeatLeft = step.repeatFillTeam
        ? Math.max(0, 5 - ((typeof S !== "undefined" && S.team) || []).length)
        : Math.max(1, step.repeat | 0 || 1);
    }
    if (!step.repeat) state.repeatLeft = 0;
    // repeatFillTeam：进入后每 400ms 按真实队伍人数刷新，满 5 人才进入下一步。
    // 不数点击次数——渲染空档会丢点击，按次数判会提前放行。
    if (step.repeat && step.repeatFillTeam) {
      clearInterval(state.fillTimer);
      const myIdx = state.idx;
      state.fillTimer = setInterval(() => {
        if (!state.active || state.idx !== myIdx) { clearInterval(state.fillTimer); return; }
        const left = Math.max(0, 5 - ((S && S.team) || []).length);
        if (left !== state.repeatLeft) {
          state.repeatLeft = left;
          const p = document.querySelector("#tutCardHost .tut-progress");
          if (p) p.innerHTML = left > 0
            ? `还需完成 <b class="num">${left}</b> 次${step.repeatLabel ? " · " + esc(step.repeatLabel.replace("{n}", left)) : ""}`
            : "已完成";
        }
        if (left === 0) { clearInterval(state.fillTimer); advance(); }
      }, 400);
    } else {
      clearInterval(state.fillTimer);
    }
    // 跨页步骤：先切页再定位（go 是同步渲染）
    if (step.screen && typeof cur !== "undefined" && cur !== step.screen) {
      try { go(step.screen); } catch {}
    }
    // 页面内的页签前置条件（例如坊市必须停在“铜钱坊市”）：只在断点续看时兜底补齐
    if (step.ensureActive && step.ensureActive.check && !document.querySelector(step.ensureActive.check)) {
      const btn = document.querySelector(step.ensureActive.click);
      if (btn) {
        state.bypass = true;                  // 程序补点不能被自己的强制拦截吞掉
        try { btn.click(); } finally { state.bypass = false; }
      }
    }

    layer();
    const wrap = document.getElementById("tutorialLayer");
    if (wrap) wrap.style.display = "";
    const host = document.getElementById("tutCardHost");
    const kindLabel = info ? "说 明" : step.kind === "action" ? "实 操 · 完成动作" : "点 这 里";
    host.innerHTML = `
      <div class="tut-card" data-tut-card>
        <div class="tut-eyebrow">
          <span class="tut-kind ${info ? "info" : "do"}">${kindLabel}</span>
          第 ${state.idx + 1} / ${total} 步 · 约 ${step.seconds || 15} 秒
        </div>
        <h3>${esc(step.title || "新手教学")}</h3>
        <p>${esc(step.text || "").replace(/\n/g, "<br>")}</p>
        ${step.repeat ? `<div class="tut-progress">${state.repeatLeft > 0
          ? `还需完成 <b class="num">${state.repeatLeft}</b> 次${step.repeatLabel ? " · " + esc(step.repeatLabel.replace("{n}", state.repeatLeft)) : ""}`
          : "已完成"}</div>` : ""}
        <div class="tut-dots">${state.steps.map((_, i) =>
          `<i class="${i === state.idx ? "on" : ""} ${i < state.idx ? "done" : ""}"></i>`).join("")}</div>
        <div class="tut-actions">
          ${info
            ? `<span class="grow"></span><button class="btn primary sm" data-tutnext>${esc(step.cta || "下一步")}</button>
               <button class="btn ghost sm" data-tutskip>退出教学</button>`
            : `<span class="tut-wait">请点击指针所指位置：<b>${esc(step.cta || "目标位置")}</b>${step.kind === "action" ? "（完成后自动继续）" : ""}</span>
               <span class="grow"></span><button class="btn ghost sm" data-tutskip>退出教学</button>`}
        </div>
      </div>`;
    requestAnimationFrame(() => requestAnimationFrame(place));

    // 兜底：click/action 步骤若目标不存在（例如卡片已全翻、按钮已消失），
    // 不让流程卡死 —— 2.5 秒后自动继续，但绝不放开其他区域。
    // repeat 步骤不走这个兜底：它的完成条件由 fillTimer 按真实队伍人数判定。
    if (step.kind !== "info" && step.target && !step.repeat) {
      const myIdx = state.idx;
      waitFor(() => {
        const el = targetOf(step);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width >= 2 || r.height >= 2;
      }, 2500).then((ok) => {
        if (ok || !state.active || state.idx !== myIdx) return;
        const host2 = document.getElementById("tutCardHost");
        const acts = host2 && host2.querySelector(".tut-actions");
        if (acts) {
          acts.innerHTML = `<span class="tut-wait">这一步已经完成，自动继续…</span>`;
          setTimeout(() => { if (state.active && state.idx === myIdx) advance(); }, 900);
        }
      });
    }
  }

  function waitFor(cond, timeout = 6000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function loop() {
        let ok = false;
        try { ok = !!cond(); } catch {}
        if (ok) return resolve(true);
        if (Date.now() - t0 > timeout) return resolve(false);
        setTimeout(loop, 120);
      })();
    });
  }

  async function advance() {
    const step = state.steps[state.idx] || {};
    // 需要等待弹窗消失（结算/奇遇/剧情）或执行异步动作时，先收起教学层，否则会挡住系统弹窗
    if (step.kind === "action" || step.waitNoModal) hideWhileWaiting();
    if (step.kind === "action") {
      if (step.waitVisible) await waitFor(() => document.querySelector(step.waitVisible), 180000);
      if (step.waitHidden) await waitFor(() => !document.querySelector(step.waitHidden), 180000);
    }
    if (step.waitNoModal) await waitFor(() => !document.querySelector("#modalHost .modal"), 60000);
    state.waiting = false;
    if (state.idx >= state.steps.length - 1) { finish(true); return; }
    state.idx++;
    persist(false);
    render();
  }

  /** action 进行中：暂时收起教学层，让翻牌/战斗/结算能正常看和点。 */
  function hideWhileWaiting() {
    state.waiting = true;
    const el = document.getElementById("tutorialLayer");
    if (el) el.style.display = "none";
    // 兜底：若点击没有触发任何系统层（余额不足/按钮被禁用等），4 秒后把教学层还回来，
    // 否则界面会停在「遮罩没了、步骤也不推进」的半死状态。
    clearInterval(state.waitWatch);
    const since = Date.now();
    state.waitWatch = setInterval(() => {
      if (!state.active || !state.waiting) { clearInterval(state.waitWatch); return; }
      const busy = document.querySelector("#modalHost .modal") ||
                   document.querySelector("#reveal.on") ||
                   document.querySelector("#battleView.on");
      if (!busy && Date.now() - since > 4000) {
        clearInterval(state.waitWatch);
        showIfWaiting();
      }
    }, 800);
  }
  function showIfWaiting() {
    state.waiting = false;
    clearInterval(state.waitWatch);
    const el = document.getElementById("tutorialLayer");
    if (el) el.style.display = "";
  }

  function finish(done, silent) {
    const wasActive = state.active;
    state.active = false;
    clearInterval(state.fillTimer);
    clearInterval(state.waitWatch);
    removeLayer();
    if (wasActive) persist(!!done);
    if (!silent && done) toast("新手教学完成 · 之后按指引自由游玩");
  }

  function start(idx) {
    const steps = stepsOf();
    if (!steps.length) { toast("教学数据未加载"); return; }
    state.steps = steps;
    state.idx = Math.max(0, Math.min(steps.length - 1, idx | 0));
    state.repeatStep = null;
    state.active = true;
    render();
  }

  function restart() {
    start(0);
    persist(false, true);
  }

  function maybeStart() {
    if (state.active) return;
    const p = progress();
    if (p.done) return;
    start(p.step || 0);
  }

  /* ---------- 拦截：教学期间只允许点目标 / 允许区域 / 教学卡 ---------- */
  const inCard = (el) => !!(el && el.closest && el.closest("#tutCardHost"));
  const matches = (el, sel) => {
    if (!sel || !el || !el.closest) return false;
    try { return !!el.closest(sel); } catch { return false; }
  };
  function allowed(el, step) {
    if (matches(el, step && step.target)) return true;
    for (const sel of (step && step.allow) || []) if (matches(el, sel)) return true;
    // 系统层：剧情/奇遇弹窗、翻牌层、战斗演出、结算浮层——流程中不可跳过，
    // 必须允许在里面正常操作，否则会被教学拦截吞掉（表现为「点了没响应」）。
    if (matches(el, "#modalHost .modal") || matches(el, "#reveal") ||
        matches(el, "#battleView") || matches(el, "#toasts")) return true;
    return false;
  }

  const swallow = (e) => {
    if (!state.active || state.bypass) return;
    // action 动作进行中（教学层已收起）：完全交还原页面，翻牌/战斗/结算都要能点
    if (state.waiting) return;
    const step = state.steps[state.idx] || {};
    if (inCard(e.target) || allowed(e.target, step)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  ["pointerdown", "mousedown", "mouseup", "touchstart", "touchend", "wheel", "contextmenu", "dragstart"]
    .forEach((ev) => document.addEventListener(ev, swallow, { capture: true, passive: false }));

  document.addEventListener("click", (e) => {
    if (!state.active || state.bypass) return;
    if (state.waiting) return;                   // 动作演出中：完全放行
    const step = state.steps[state.idx] || {};
    const t = e.target;
    if (inCard(t)) {
      if (t.closest("[data-tutskip]")) { e.preventDefault(); finish(true); return; }
      if (t.closest("[data-tutnext]") && step.kind === "info") { e.preventDefault(); advance(); }
      return;
    }
    if (!allowed(t, step)) { e.preventDefault(); e.stopPropagation(); return; }
    if (step.kind === "click") {
      // repeatFillTeam 的上阵步骤由轮询判定，点击直接放行原生处理
      if (step.repeat) {
        if (step.repeatFillTeam) return;
        // repeat 步骤：点一次扣一次，没点满就原地重绘（目标会随渲染换成下一位未上阵角色）
        state.repeatLeft = Math.max(0, (state.repeatLeft || 0) - 1);
        if (state.repeatLeft > 0) {
          setTimeout(() => { if (state.active) render(); }, 260);
          return;
        }
      }
      // 放行原生点击（页签切换/上阵/购买等），下一拍再推进，避免目标被重渲染后事件丢失
      setTimeout(() => { if (state.active) advance(); }, 60);
      return;
    }
    // action 步骤：立刻收起教学层，让剧情/翻牌/战斗/结算能正常看和点
    if (step.kind === "action") hideWhileWaiting();
  }, true);

  // action 步骤：包 api()，指定 type 成功返回才推进；失败则恢复教学层
  const _api = window.api;
  if (typeof _api === "function") {
    window.api = async function (body) {
      let j = null;
      try {
        j = await _api.apply(this, arguments);
      } catch (err) {
        if (state.active && state.expectAction && body && body.type === state.expectAction) showIfWaiting();
        throw err;
      }
      if (state.active && state.expectAction && body && body.type === state.expectAction) {
        if (j && j.ok !== false) {
          state.expectAction = null;
          setTimeout(() => { if (state.active) advance(); }, 80);
        } else {
          showIfWaiting();
        }
      }
      return j;
    };
  }

  // 键盘：教学期间只允许教学卡上的 Enter/Space（info 下一步），其余吞掉
  document.addEventListener("keydown", (e) => {
    if (!state.active) return;
    if (state.waiting) return;                   // 动作演出中：完全放行（跳过战斗等）
    const step = state.steps[state.idx] || {};
    if ((e.key === "Enter" || e.key === " ") && step.kind === "info") { e.preventDefault(); advance(); return; }
    if (e.key !== "F5" && e.key !== "F12") e.preventDefault();
  }, true);

  window.addEventListener("resize", () => { if (state.active) place(); });
  window.addEventListener("scroll", () => { if (state.active) place(); }, true);
  new MutationObserver(() => { if (state.active) requestAnimationFrame(place); })
    .observe(document.body, { childList: true, subtree: true });

  window.Tutorial = {
    maybeStart,
    start,
    restart,
    close: () => { state.active = false; clearInterval(state.fillTimer); removeLayer(); },
    active: () => state.active,
  };
})();
