/* 拾缘 · 初始大礼包 —— 主城悬浮礼盒 + 领取开盒演出
 *
 * 规则：每个存档只能领取一次（以存档 starterGift.claimedAt 为准，服务端强制校验）。
 * 重置存档=重新开局，领取标记会随旧存档清空，新存档会重新出现悬浮图标；
 * 领过之后主城不再渲染悬浮图标；资源数量全部来自 /api/boot 的 statics.starterGift，
 * 因此调数值只改 content/economy.json，前端不写死任何数量。
 *
 * 演出顺序（用户要求）：礼盒持续摇晃 → 点开后盒盖弹开 → 白光一闪 → 获得资源逐项列出。
 */

/** 主城悬浮礼包按钮：只在未领取时出现。插在 #scr-home 内部，切走主城会随屏幕一起隐藏。 */
function starterGiftIconHtml() {
  if (!DATA || !DATA.starterGift || (S && S.starterGift)) return "";
  return `
  <button class="sg-float" id="sgFloat" data-tip="初始大礼包|每个存档限领一次，内含 5 名角色直升 15 级的资源">
    <span class="sg-float-glow"></span>
    <img class="sg-float-img" src="/art/ui/starter-gift.png" alt="">
    <span class="sg-float-label">初始大礼包</span>
  </button>`;
}

/** 把悬浮按钮挂到主城（renderHome 末尾调用；重复调用只保留一个）。 */
function mountStarterGiftIcon() {
  const scr = document.getElementById("scr-home");
  if (!scr || (S && S.starterGift)) return;
  const old = document.getElementById("sgFloat");
  if (old) old.remove();
  scr.insertAdjacentHTML("beforeend", starterGiftIconHtml());
  const btn = document.getElementById("sgFloat");
  if (btn) btn.onclick = openStarterGift;
}

/** 资源条目：按配置生成（coin / mat），key 用于和领取结果对齐。 */
function starterGiftItems(g) {
  const out = [];
  if (g.coin) out.push({ key: "coin", icon: "coin", label: (DATA.currencies.coin && DATA.currencies.coin.label) || "铜钱", num: g.coin, color: "#c9a227" });
  for (const [k, n] of Object.entries(g.mat || {})) {
    const m = (DATA.materials && DATA.materials[k]) || {};
    out.push({ key: "mat:" + k, icon: k === "pill" ? "pill" : "page", label: m.label || k, num: n, color: m.color || "#9aa3b2" });
  }
  return out;
}

function starterGiftGained(it, gained) {
  if (it.key === "coin") return gained.coin != null ? gained.coin : it.num;
  const k = it.key.slice(4);
  return (gained.mat && gained.mat[k] != null) ? gained.mat[k] : it.num;
}

/** 打开大礼包弹窗：先摇晃，点击开启后播开盒 → 闪光 → 资源逐条列出。 */
function openStarterGift() {
  if (!DATA || !DATA.starterGift) return;
  if (S && S.starterGift) { toast("初始大礼包已领取过"); return; }
  const g = DATA.starterGift;

  const m = modal(`
    <div class="sg-modal" id="sgModal">
      <div class="sg-flash" id="sgFlash"></div>
      <div class="sg-title">初 始 大 礼 包</div>
      <div class="sg-sub">每次开局仅可领取一次 · 内含 5 名角色直升 15 级的资源</div>
      <div class="sg-stage">
        <span class="sg-rays"></span>
        <img class="sg-img wobble" id="sgImg" src="/art/ui/starter-gift.png" alt="">
      </div>
      <div class="sg-list" id="sgList"></div>
      <div class="sg-foot">
        <button class="btn primary lg" id="sgOpen">开 启 礼 包</button>
        <button class="btn" id="sgClose" style="display:none">收 下</button>
      </div>
    </div>`);
  m.classList.add("sg-modal-wrap");

  const img = m.querySelector("#sgImg");
  const list = m.querySelector("#sgList");
  const btnOpen = m.querySelector("#sgOpen");
  const btnClose = m.querySelector("#sgClose");
  const flash = m.querySelector("#sgFlash");

  btnClose.onclick = () => {
    closeModal();
    if (typeof renderResBar === "function") renderResBar();
    if (typeof renderHome === "function") renderHome();
  };

  btnOpen.onclick = async () => {
    btnOpen.disabled = true;
    btnOpen.textContent = "开 启 中…";
    img.classList.remove("wobble");
    img.classList.add("shake-hard");           // ① 剧烈摇晃
    try { AudioSys.sfx("blip", { force: true }); } catch (e) { /* 静音时无音频 */ }
    // 请求与演出并行：动画至少演满 900ms，接口慢也不会穿帮
    const req = call({ type: "starterGift" }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    await sleep(900);
    const j = await req;
    if (!j || j.ok === false || !j.starterGift || j.starterGift.error) {
      toast((j && (j.starterGift && j.starterGift.error || j.error)) || "领取失败，请稍后再试");
      closeModal();
      if (typeof renderHome === "function") renderHome();
      return;
    }
    // ② 开盒：换成打开的礼盒，盒子放大回弹；③ 白光一闪
    img.classList.remove("shake-hard");
    img.classList.add("open-pop");
    img.src = "/art/ui/starter-gift-open.png";
    flash.classList.add("on");
    try { AudioSys.sfx("ult_boom", { force: true }); } catch (e) { /* 静音时无音频 */ }
    await sleep(420);

    // ④ 资源逐项列出（条目依次浮现 + 数字滚动）
    btnOpen.style.display = "none";
    const gained = j.starterGift.gained || {};
    const gotItems = starterGiftItems(g).map((it) => ({ ...it, num: starterGiftGained(it, gained) }));
    list.innerHTML = gotItems.map((it, i) => `
      <div class="sg-item" style="animation-delay:${i * 110}ms">
        <span class="sg-ico" style="color:${it.color}">${I(it.icon)}</span>
        <span class="sg-name">${esc(it.label)}</span>
        <span class="sg-num num" data-count="${it.num}">×0</span>
      </div>`).join("");

    // 随机 UR 角色单独一张卡：头像 + 名字 + 品质（已集齐时会转成本体残卷，文案照实说）
    const gotCard = (j.starterGift.cards || [])[0] || {};
    const cid = gotCard.id || (j.starterGift.cardIds || [])[0] || "";
    const ch = cid && charById(cid);
    if (ch) {
      const isDupe = !!gotCard.dupe;
      const card = document.createElement("div");
      card.className = "sg-item sg-ur";
      card.style.animationDelay = `${gotItems.length * 110}ms`;
      card.innerHTML = `
        <img class="sg-ur-face" src="${art(cid, "avatar")}" alt="">
        <span class="sg-ico" style="color:${RCOLOR(ch.rarity)}">${I("sparkle")}</span>
        <span class="sg-name">随机 ${RTAG(ch.rarity)} 角色 · <b>${esc(ch.name)}</b></span>
        <span class="sg-num" style="color:${RCOLOR(ch.rarity)}">${isDupe ? "重复·转本体残卷" : RTAG(ch.rarity)}</span>`;
      const face = card.querySelector(".sg-ur-face");
      face.onerror = () => { face.src = art(cid, "portrait"); };
      list.appendChild(card);
    }
    list.querySelectorAll("[data-count]").forEach((el) => {
      const target = Number(el.dataset.count) || 0;
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 300);
        el.textContent = "×" + fmt(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    btnClose.style.display = "";
    // 关弹窗后主城重绘：S.starterGift 已由 api() -> buildView 写成已领取，图标自然消失
  };
}
