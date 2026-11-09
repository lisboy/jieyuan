/* 拾缘 · screens-main —— 由 app.js 拆分（2026-10-26） */
function renderHome() {
  const ownedN = Object.keys(S.owned).length, total = DATA.characters.length;
  const hero = heroPool()[heroIdx % heroPool().length] || Object.keys(S.owned)[0] || "";
  const hc = charById(hero);
  const noHero = !hc;   // 新档一个角色都没有：舞台改引导抽卡，不摆空立绘与他人名牌
  const bonds = activeBonds().slice(0, 3);
  const nextStage = DATA.chapters.map(c => c.nodes.find(n => !S.cleared[n.id])).find(Boolean)
    || DATA.chapters.at(-1).nodes.at(-1);
  const clearedN = SUM.stagesCleared;
  const loginReady = !S.daily.loginClaimed;

  $("#scr-home").innerHTML = `
  <div class="home-grid">
    <div class="home-col home-rail">
      <section class="panel panel-pad xp-sign" id="xpSignPanel">${xpSignHtml(xpSignCache)}</section>
      <section class="panel panel-pad xp-visitp" id="xpVisitPanel">${xpVisitHtml(xpVisitCache)}</section>
      <section class="panel xp-chap">
        <button class="xp-chapbtn" data-xprev="1" data-tip="章末回望|重读当前章节的关卡回望与剧情">
          ${I("chapter")}
          <b>章末回望</b>
          <span>重读本卷征程</span>
        </button>
      </section>
    </div>
    <div class="home-col">
      <section class="panel panel-pad profile-panel">
        <div class="profile" data-profile="1" style="cursor:pointer" data-tip="个人资料|点头像可以换头像、改昵称">
          <div class="avatar">${PROFILE.avatar
            ? `<img src="${esc(PROFILE.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover">`
            : (S.team[0] || hero)
              ? artImg(S.team[0] || hero)
              : `<span class="avatar-ph">${I("story")}</span>`}</div>
          <div class="who">
            <h2>${esc(PROFILE.displayName || USERNAME)}</h2>
            <div class="lvline num">出战 ${SUM.wins} 胜 · 图鉴 ${SUM.collected}/${total}</div>
            <div class="bar"><i style="width:${Math.min(100, teamPowerNow() / 3200)}%"></i></div>
          </div>
        </div>
        <div class="statpair">
          <div class="sp"><div class="k">编队战力</div><div class="v gold num">${fmt(teamPowerNow())}</div></div>
          <div class="sp"><div class="k">累计星数</div><div class="v num">${fmt(SUM.stars)}</div></div>
        </div>
      </section>

      <section class="panel panel-pad">
        <div class="panel-title">今 日</div>
        <div style="display:grid;gap:9px;margin-top:12px">
          <div class="rowitem"><span class="dot" style="background:var(--gold)"></span>
            <div class="grow"><div class="t">每日签到</div><div class="s num">铜钱 ×${fmt(DATA.daily.login.coin)} · 心神 +${DATA.daily.login.stamina}</div></div>
            <div class="daily-claimslot">${loginReady ? `<button class="btn sm primary" data-act="login">领 取</button>` : `<span class="tag dim">已领取</span>`}</div></div>
          <div class="rowitem"><span class="dot" style="background:var(--blue)"></span>
            <div class="grow"><div class="t">每日首胜</div><div class="s num">每势力首胜 · 铜钱 ×${fmt(DATA.daily.firstWinPerFaction.coin)} · 缘玉 ×${DATA.daily.firstWinPerFaction.jade}</div></div>
            <button class="btn sm" data-go="stages">去出征</button></div>
          <div class="rowitem"><span class="dot" style="background:var(--green)"></span>
            <div class="grow"><div class="t">心神</div><div class="s num">${S.wallet.stamina}/${staminaCap()} · 每 ${DATA.currencies.stamina.regenMinutesPerUnit} 分钟回 1 点</div></div>
            <button class="btn sm" data-act="stamina">补充</button></div>
        </div>
      </section>

      <section class="panel panel-pad">
        <div class="panel-title">下 一 站</div>
        <div style="margin-top:12px">
          <div style="font-family:var(--font-display);font-size:19px;letter-spacing:.1em">${esc(nextStage.name)}</div>
          <div class="panel-sub" style="margin:6px 0 12px">敌方 Lv.${nextStage.elv} · 体力 ${nextStage.stamina} ${nextStage.boss ? "· 关主作战" : ""}</div>
          <button class="btn primary" data-go="stages">${I("fight")} 前往关卡</button>
        </div>
      </section>
    </div>

    <section class="panel hero-stage">
      <div class="aura"></div>
      ${noHero ? `
      <div class="hero-empty">
        ${I("sparkle", "width:46px;height:46px")}
        <b>尚无同行之缘</b>
        <span>去缘阁抽签结缘，迎来第一位同行伙伴</span>
        <button class="btn primary" data-go="gacha">${I("gem")} 前 往 结 缘</button>
      </div>
      <div class="cta-wrap">
        <div class="cta-note">编队虚位以待</div>
        <button class="btn primary lg" data-go="gacha">去 抽 卡</button>
      </div>` : `
      <img class="pimg dyn" src="${art(hero, "dynamic")}" alt=""
        data-fb="portrait">
      <button class="hero-switch l" data-hero="-1">‹</button>
      <button class="hero-switch r" data-hero="1">›</button>
      <div class="cta-wrap">
        <div class="cta-note">点击立绘 · 她会回应你</div>
        <button class="btn primary lg" data-go="stages">开 始 征 战</button>
      </div>
      <div class="hero-plate">
        <div class="hp-head"><b>${esc(hc.name)}</b><span class="rtag" style="color:${RCOLOR(hc.rarity)};border-color:${RCOLOR(hc.rarity)}">${RTAG(hc.rarity)}</span></div>
        <span class="hp-meta">${DATA.elements[hc.element].label} · ${RLABLEX(hc.role)} · ${FLABEL(hc.faction)}</span>
      </div>`}
    </section>

    <div class="home-col">
      <section class="panel panel-pad">
        <div class="panel-title">羁 绊</div>
        <div style="display:grid;gap:9px;margin-top:12px">
          ${bonds.length ? bonds.map(b => `
            <div class="rowitem"><div class="grow">
              <div class="t" style="color:var(--gold)">${esc(b.name)}</div>
              <div class="s">${esc(b.effect)}</div></div></div>`).join("")
          : `<div class="panel-sub">编队里凑齐同门 / 同气的伙伴即可成绊。</div>`}
          <button class="btn sm" data-go="bondstory" style="justify-self:start">${I("story")} 羁 缘</button>
        </div>
      </section>

      <section class="panel panel-pad">
        <div class="panel-title">目 标</div>
        <div style="display:grid;gap:14px;margin-top:14px">
          ${[["主线通关", clearedN, DATA.chapters.reduce((a, c) => a + c.nodes.length, 0)],
             ["图鉴收集", SUM.collected, total],
             ["累计星数", SUM.stars, DATA.chapters.reduce((a, c) => a + c.nodes.length, 0) * 3]].map(([k, v, m]) => `
            <div>
              <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
                <span>${k}</span><span class="num" style="color:var(--dim)">${fmt(v)}/${fmt(m)}</span></div>
              <div class="bar tiny"><i style="width:${Math.min(100, v / m * 100)}%"></i></div>
            </div>`).join("")}
        </div>
      </section>
    </div>
  </div>

  <div class="panel home-bottom">
    <span class="lbl">出战编队</span>
    <div class="teamrow">${S.team.map((id, i) => `
      <div class="tslot" data-open="${id}" data-tip="第${i + 1}位 · ${esc(charById(id).name)}|点击查看详情">
        <span class="n num">${i + 1}</span>${artImg(id)}</div>`).join("")}
      ${Array.from({ length: Math.max(0, 5 - S.team.length) }, () => `<div class="tslot empty" data-go="team">+</div>`).join("")}
    </div>
    <span class="num" style="color:var(--dim);font-size:13px">战力 ${fmt(teamPowerNow())}</span>
    <button class="btn sm" data-go="team">编 队</button>
  </div>`;

  // 扩展三件套：面板骨架已按缓存画好，数据过期/缺失时再异步补拉（只换面板 innerHTML，不整屏重绘）
  xpHomeLoad();
  // 初始大礼包：未领取时在主城挂一个摇晃的小礼盒悬浮图标（领过就不出现）
  try { mountStarterGiftIcon(); } catch (e) { console.warn("starterGift", e); }
}

/* ---------------- 扩展 · 主城三件（七日签到 / 今日来访 / 章末回望） ---------------- */

// login7 / visit 的会话内缓存：主城重绘很频繁（切换立绘、领奖刷新都会整屏重画），
// 每次都打两发接口既浪费又会让面板闪「加载中」，60 秒内直接复用。
let xpSignCache = null, xpSignAt = 0, xpVisitCache = null, xpVisitAt = 0;
const XP_CACHE_MS = 60000;

/* 缘值数据的展示缓存：带 save 的响应会让 api() 重建 S（buildView 不透出 bonds，
 * 任何动作都会把 S.bonds 冲掉），所以把 bonds 存进自持缓存 —— 渲染时优先读它。
 * 数据源：visit / visitGreet / login7Claim 等扩展响应（xpSyncSave 统一合并）。 */
let xpBondCache = null;
function xpSyncSave(j) {
  const b = j && j.save && j.save.bonds;
  if (b && typeof b === "object") {
    xpBondCache = Object.assign(xpBondCache || {}, b);
    S.bonds = Object.assign({}, xpBondCache);  // 顺手挂回 S，其他读 S.bonds 的代码也能用
  }
}

/** 当前进度所在章：第一个还有未通关卡节的章（即最远已解锁章）；全部打穿则取末章。
 * 返回 1 起算的章节号 —— openChapterReview/chapterInfo/chapterClaim 服务端均按章节号取章。 */
function xpCurChapter() {
  const chs = DATA.chapters || [];
  const open = chs.findIndex(c => c.nodes.some(n => !S.cleared[n.id]));
  return (open >= 0 ? open : Math.max(0, chs.length - 1)) + 1;
}

// 名册缘值水合：自持缓存为空时，借 visit 接口（顺带回全量 save）捞一次，之后不再打。
let xpBondsTried = false;
async function xpHydrateBonds() {
  if (xpBondsTried || xpBondCache) return;
  xpBondsTried = true;
  const j = await call({ type: "visit" }).catch(() => null);
  xpSyncSave(j);
  if (xpBondCache && cur === "roster" && rosterSel) renderRoster();  // 回填当前详情
}

/** 七日签到面板：7 格横排，今天高亮、已领打勾；未领时页头出「签到」按钮 */
function xpSignHtml(x) {
  const hd = `<div class="xp-hd">
    <span class="panel-title">${I("gift", "width:15px;height:15px")} 七 日 签 到</span>
    ${x ? (x.day > 0 && !x.claimed
      ? `<button class="btn sm primary" data-xp7claim="1">签 到</button>`
      : `<span class="tag ${x.day === 0 ? "gold" : "dim"}">${x.day === 0 ? "本轮已满 · 明日重开" : "今日已签"}</span>`)
      : `<span class="tag dim">…</span>`}
  </div>`;
  if (!x || !Array.isArray(x.table) || !x.table.length) return hd + `<div class="panel-sub" style="margin-top:10px">签到表加载中…</div>`;
  const cur = x.day > 0 ? x.day : 7;   // day=0：第 7 天已领、整轮完成，全部按已领显示
  return hd + `<div class="xp-cells">${x.table.map(row => {
    const st = (x.day === 0 || row.day < cur) ? "done" : row.day === cur ? (x.claimed ? "done" : "now") : "next";
    return `<div class="xp-cell ${st}" data-tip="第 ${row.day} 天|${esc(row.note)}">
      <span class="d num">第${row.day}天</span>
      <span class="gi">${I("gift")}</span>
      <span class="nt">${esc(row.note)}</span>
      ${st === "done" ? `<span class="ck">${I("check")}</span>` : ""}
    </div>`;
  }).join("")}</div>`;
}

/** 今日来访面板：头像 + 称号 + 台词 + 缘值；未问候出「打招呼」按钮 */
function xpVisitHtml(v) {
  const hd = `<div class="xp-hd"><span class="panel-title">${I("visit", "width:15px;height:15px")} 今 日 来 访</span></div>`;
  if (!v) return hd + `<div class="panel-sub" style="margin-top:10px">正在叩门…</div>`;
  if (!v.id) return hd + `<div class="panel-sub" style="margin-top:10px">今日无人来访。结缘的角色越多，来访也越热闹。</div>`;
  const c = charById(v.id);
  const rc = v.rarity ? RCOLOR(v.rarity) : (c ? RCOLOR(c.rarity) : "#888");
  const name = v.name || (c && c.name) || v.id;
  const title = v.title || (c && (c.title || FLABEL(c.faction))) || "";
  const bond = v.bond || { lv: 0, v: 0 };
  const face = v.avatar
    ? `<img src="${esc(v.avatar)}" alt="" data-fb="rm">`
    : (c ? artImg(v.id, "avatar") : "");
  return hd + `<div class="xp-visitor">
    <div class="face" style="border-color:${rc}66;box-shadow:0 0 0 3px ${rc}1f">${face}</div>
    <div class="who">
      <div class="nm" style="color:${rc}">${esc(name)}<span class="ttl">${esc(title)}</span></div>
      <div class="line">「${esc(v.line || "她只是静静看着你，欲言又止。")}」</div>
      <div class="bondline">
        ${I("bondlv", "width:13px;height:13px;color:var(--gold)")} 缘值 <b class="num">Lv.${bond.lv}</b>
        <span class="xp-bbar"><i style="width:${bond.lv >= 10 ? 100 : Math.min(100, bond.v * 10)}%"></i></span>
        ${v.greeted ? `<span class="tag gold">缘 +5 · 今日已问候</span>` : ""}
      </div>
    </div>
  </div>
  ${v.greeted ? "" : `<button class="btn sm primary xp-greetbtn" data-xpgreet="1">${I("visit", "width:13px;height:13px")} 打招呼 +5 缘</button>`}`;
}

/** 数据补拉：只替换对应面板的 innerHTML（先确认还挂在文档上，防止整屏已重绘后写飞） */
function xpHomeLoad() {
  const signBox = $("#xpSignPanel");
  if (signBox && (!xpSignCache || Date.now() - xpSignAt > XP_CACHE_MS)) {
    call({ type: "login7" }).then(j => {
      // 带 save 的响应会让 api() 重建 S（buildView 不含 bonds）——这里补捞一次
      xpSyncSave(j);
      if (j && j.login7) { xpSignCache = j.login7; xpSignAt = Date.now(); }
      const b = $("#xpSignPanel");
      if (b && b.isConnected && xpSignCache) b.innerHTML = xpSignHtml(xpSignCache);
    }).catch(() => {});
  }
  const visitBox = $("#xpVisitPanel");
  if (visitBox && (!xpVisitCache || Date.now() - xpVisitAt > XP_CACHE_MS)) {
    call({ type: "visit" }).then(j => {
      xpSyncSave(j);
      if (j && j.visit) {
        xpVisitCache = j.visit;
        // 空来访者不落缓存（新号还没抽到人时首次拉取会返回 id:null），
        // 保持 xpVisitAt=0，下次主城重绘再试 —— 招来人后面板就能接上。
        xpVisitAt = j.visit.id ? Date.now() : 0;
      }
      const b = $("#xpVisitPanel");
      if (b && b.isConnected && xpVisitCache) b.innerHTML = xpVisitHtml(xpVisitCache);
    }).catch(() => {});
  }
}

/* ---------------- 屏：缘阁 ---------------- */

/** 池生效概率行：rateBoost 覆盖全局 rates（UP 池红阶 10%，常规池 2%） */
function rateLine(b) {
  const eff = { ...DATA.gacha.rates, ...(b.rateBoost || {}) };
  // 晶钻 UP 池的定向对象是晶钻角色，不能笼统写成「红阶必为 UP」——那是 UR 池的说法。
  const upRarity = (b.featured || []).some(id => (charById(id) || {}).rarity === "diamond") ? "晶钻" : "红阶";
  const up = (b.featured || []).length && b.type === "featured" ? ` · ${upRarity}必为 UP` : "";
  const pct = v => v >= 0.01 ? (Math.round(v * 1000) / 10) : (Math.round(v * 10000) / 100);
  // 不产出其他 UR 的晶钻限定池：宣传「UR 1.2%」会直接误导玩家（实测原本能抽出三个别的 UR）。
  const redTxt = b.noRed ? "UR 0%" : `UR ${Math.round(eff.red * 100)}%`;
  return `晶钻 ${pct(eff.diamond || 0)}% · ${redTxt} · SSR ${Math.round(eff.gold * 100)}% · SR ${Math.round(eff.purple * 100)}% · R ${Math.round(eff.blue * 100)}% · N ${Math.round(eff.green * 100)}%${up}`;
}

/** 池内容公示：按阶位列出可抽角色（小立绘 + 名字，UP 描边标亮），红阶为 UP 专属时注明 */
function showPoolView(key) {
  const x = DATA.gacha.banners.find(v => v.key === key);
  if (!x) return;
  const groups = RAR_ORDER.map(r => ({ r, ids: (x.pool || []).filter(id => (charById(id) || {}).rarity === r) })).filter(g => g.ids.length);
  modal(`<div class="menu" style="width:560px">
    <div style="display:flex;align-items:center;gap:10px">
      <div class="panel-title">可 抽 角 色 · ${esc(x.label)}</div>
      <span style="flex:1"></span>
      <button class="iconbtn mclose" data-close>${I("close")}</button>
    </div>
    <div class="panel-sub" style="margin:6px 0 12px">概率：${rateLine(x)}</div>
    ${x.noRed ? '<div class="panel-sub" style="margin:-4px 0 12px;color:var(--gold)">本池为晶钻限定：不产出任何其他 UR 角色</div>' : ""}
    ${groups.map(g => {
      const upOnly = g.r === "red" && (x.featured || []).length > 0;
      return `<div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span class="rtag" style="color:${RCOLOR(g.r)};border-color:${RCOLOR(g.r)}">${RTAG(g.r)}</span>
          <span class="panel-sub num">${g.ids.length} 名</span>
          ${upOnly ? '<span class="panel-sub">· 本池红阶仅 UP 角色可出</span>' : ""}
        </div>
        <div class="pv-grid">
          ${g.ids.map(id => {
            const c = charById(id);
            const isUp = (x.featured || []).includes(id);
            return `<div class="pv-chip${isUp ? " up" : ""}" style="--rc:${RCOLOR(g.r)}">
              <img src="${art(id)}" alt="" loading="lazy" data-fb="rm">
              <span>${esc(c.name)}</span>
            </div>`;
          }).join("")}
        </div>
      </div>`;
    }).join("")}
  </div>`);
}

function renderGacha() {
  /* 限抽池（新手池）抽满 pullLimit 后整条下架：服务端 boot 已过滤，这里再兜一层，
   * 保证刚抽完最后一发、存档还没重新拉取时也不会在列表里残留一条点不动的卡池。 */
  const banners = DATA.gacha.banners.filter(x => !(x.pullLimit > 0 && ((S.bannerUse?.[x.key] || 0) >= x.pullLimit)));
  const list = banners.length ? banners : DATA.gacha.banners;
  const b = list.find(x => x.key === curBanner)
    || list.find(x => x.type === "featured")
    || list[0];
  curBanner = b.key;
  const featured = (b.featured && b.featured.length ? b.featured : b.pool.slice(0, 3));
  const f = charById(featured[0]) || DATA.characters[0];
  const pity = S.pity[b.key] || { sinceRed: 0, sincePurple: 0, pulls: 0 };
  const disc = b.costDiscount || 0;
  const single = Math.round(DATA.gacha.cost.single * (disc || 1));
  const ten = Math.round(DATA.gacha.cost.ten * (disc || 1));
  const rc = RCOLOR(f.rarity);
  /* 晶钻 UP 池有自己的保底口径：160 抽必出当期晶钻，和 UR 的 51 软保底/80 硬保底是两套。
   * 面板必须跟着当前卡池走，否则玩家在晶钻池里会看到「UR 概率提升」这种无关文案。 */
  const diamondPity = b.diamondHardAt > 0;
  const pityDone = diamondPity ? (pity.sinceDiamond || 0) : pity.sinceRed;
  const pityAt = diamondPity ? b.diamondHardAt : DATA.gacha.pity.hardAt;
  const hardLeft = Math.max(0, pityAt - pityDone);
  /* 晶钻软保底：120 抽起每抽晶钻出率 +1%，面板必须把起点和「当前实际出率」写清楚，
   * 否则玩家在 120~159 抽之间只看得到硬保底倒计时，感受不到概率已经在涨。 */
  const dSoftAt = diamondPity ? (b.diamondSoftAt || 0) : 0;
  const dStep = diamondPity ? (b.diamondRateStepPerPull || 0) : 0;
  const dSoftOn = dSoftAt > 0 && (pity.sinceDiamond || 0) >= dSoftAt;
  const dNowRate = (DATA.gacha.rates.diamond || 0) + (dSoftOn ? dStep * ((pity.sinceDiamond || 0) - dSoftAt + 1) : 0);
  const pct2 = v => `${Math.round(v * 10000) / 100}%`;

  $("#scr-gacha").innerHTML = `
  <div class="gacha-grid">
    <div class="banner-list">
      ${list.map(x => {
        const on = x.key === b.key;
        const mark = x.type === "featured" ? "限定" : x.type === "novice" ? "新手" : "常驻";
        const used = (S.pity[x.key] || {}).pulls || 0;
        return `<div class="banner ${on ? "on" : ""}">
          <button class="bn-main" data-banner="${x.key}">
            <div class="bn">${esc(x.label)}</div>
            <div class="bs"><span>${mark}</span>·<span class="num">已签 ${used} 次</span>
              ${x.costDiscount ? `<span class="tag red" style="padding:2px 8px">限时折扣</span>` : ""}</div>
          </button>
          <button class="bn-view" data-poolview="${x.key}" title="查看可抽角色与概率">${I("scroll")}</button>
        </div>`;
      }).join("")}
    </div>

    <section class="panel upstage">
      <img class="pbg" src="/bg/gacha.jpg" alt="">
      <div class="aura" style="width:520px;height:520px;background:radial-gradient(circle, ${rc}22, transparent 62%)"></div>
      <img class="pimg" src="${art(f.id, "dynamic")}" alt="" data-fb="portrait">
      <div class="fr" style="border-color:${rc}55;box-shadow:inset 0 0 70px ${rc}14"></div>
      ${b.type === "featured" ? `<div class="seal-up">UP</div><div class="ribbon">UP · ${esc(f.name)}</div>` : ""}
    </section>

    <div class="gacha-side">
      <section class="panel panel-pad pity-box">
        <div class="panel-title">保 底</div>
        <div class="pity-line"><span class="panel-sub">距${diamondPity ? "晶钻" : "UR"}硬保底</span><b class="num">${hardLeft} 抽</b></div>
        <div class="bar"><i style="width:${Math.min(100, pityDone / pityAt * 100)}%"></i></div>
        <div class="panel-sub" style="margin-top:8px">${diamondPity
          ? `第 ${b.diamondHardAt} 抽保底必得当期晶钻 UP（翻卡可见）· 本池不产出其他 UR${dSoftAt > 0 ? ` · <b style="color:#9be9ff">${dSoftAt} 抽起每抽晶钻出率 +${pct2(dStep)}${dSoftOn ? `，当前 ${pct2(dNowRate)}` : `（当前 ${pct2(dNowRate)}）`}</b>` : ""} · 晶钻基础出率 ${pct2(DATA.gacha.rates.diamond || 0)} · 十连必出 ${RTAG(DATA.gacha.pity.tenGuarantees)} 以上 · 累计已签 ${pity.pulls} 抽`
          : `${DATA.gacha.pity.softAt} 抽起每抽 UR 概率 +${Math.round((DATA.gacha.pity.redRateStepPerPull || 0.06) * 100)}% · 十连必出 ${RTAG(DATA.gacha.pity.tenGuarantees)} 以上 · 累计已签 ${pity.pulls} 抽`}</div>
      </section>
      ${b.type === "featured" ? `
      <section class="panel panel-pad">
        <div class="panel-title">本 期 UP</div>
        <div style="display:grid;gap:8px;margin-top:12px">
          ${featured.slice(0, 3).map(id => {
            const c = charById(id);
            return c ? `<div class="uprow"><img src="${art(id)}" alt="" data-fb="rm">
              <b style="flex:1">${esc(c.name)}</b>
              <span class="rtag" style="color:${RCOLOR(c.rarity)};border-color:${RCOLOR(c.rarity)}">${RTAG(c.rarity)}</span></div>` : "";
          }).join("")}
        </div>
      </section>` : ""}
    </div>
  </div>

  <div class="panel gacha-bottom">
    <div class="hint">每抽返还尘缘 ${DATA.gacha.perPullEssence} · 缘玉 ${fmt(S.wallet.jade)}<br>概率：${rateLine(b)}</div>
    <button class="btn" data-pull="1">缘签 · 单抽　<b class="num">${fmt(single)}</b> 缘玉</button>
    <button class="btn primary" data-pull="10">十 连 缘 签　<b class="num">${fmt(ten)}</b> 缘玉</button>
  </div>`;
}
// 默认进首个限定池（限定池已改为后台配置，key 不固定）；renderGacha 里有兜底
let curBanner = "";

async function doPull(n) {
  const j = await call({ type: "pull", banner: curBanner, count: n });
  if (!j) return;
  renderResBar();
  showReveal(j.pull.results);
}
let revealPending = [];
/* 按张数决定列数，保证每行排满、上下两行等宽：
 *   1~5 张 → 单行，列数=张数
 *   6 张   → 3×2
 *   7 张   → 不是质数友好的行数，退回 4×2（末行 3 张，居中不突兀）
 *   8 张   → 4×2
 *   9 张   → 3×3
 *   10 张  → 5×2（十连主用，两行齐平）
 *   其余   → 尽量 6 列
 * 目标是消除"6+4"那种第二行右边空一大块的情况。
 */
function revealCols(n) {
  if (n <= 5) return Math.max(1, n);
  if (n === 6) return 3;
  if (n === 9) return 3;
  if (n === 7 || n === 8) return 4;
  if (n === 10) return 5;   // 十连主路径：5×2，两行齐平
  if (n <= 12) return 6;
  return 6;
}
/* 稀有度 → 翻开特效分级（2026-11-02 用户口径：UR / SSR 翻开必须有各自的专属特效）：
 *   diamond 晶钻 —— 棱晶折射光爆 + 36 束放射棱光 + 晶屑粒子 + 「晶钻」题字 + 旋转晶冠（最高规格）
 *   red  UR  —— 卡面光爆（金红渐变推光）+ 放射光束 + 碎金粒子 + 「红阶」题字 + 缘至波纹
 *   gold SSR —— 冷金边光 + 上升光柱 + 星屑 + 「金阶」题字
 *   其余阶位 —— 只做轻量闪白（.fc-spark），不再和红/金抢注意力
 * 特效节点全部在 showReveal 里一次性建好（display:none），翻开时才加 .burst 触发动画，
 * 这样「全部翻开」时不会临时创建 DOM 拉长主线程。 */
const RARITY_FX = {
  diamond: { cls: "r-diamond", words: "晶 钻 · 独 尊", beams: 36, motes: 28, sfx: "reveal_hi" },
  red:  { cls: "r-red",  words: "红 阶 · 缘 定", beams: 16, motes: 18, sfx: "reveal_hi" },
  gold: { cls: "r-gold", words: "金 阶 · 相 逢", beams: 10, motes: 10, sfx: "reveal_hi" },
};
const fxTierOf = r => (RARITY_FX[r] ? r : "");
function rarityFxHtml(rarity) {
  const fx = RARITY_FX[rarity];
  if (!fx) return `<i class="fc-spark"></i>`;
  // 光束/粒子用固定伪随机角度（不随时间抖动），保证每次展开形状一致、可复现
  const beams = Array.from({ length: fx.beams }, (_, i) =>
    `<i style="--a:${(i * 360 / fx.beams).toFixed(1)}deg;--d:${(i % 3) * 0.06}s;--len:${62 + (i * 37) % 30}%"></i>`).join("");
  const motes = Array.from({ length: fx.motes }, (_, i) => {
    const a = (i * 137.5) % 360, dist = 58 + (i * 29) % 44, dl = ((i * 53) % 34) / 100;
    return `<i style="--a:${a.toFixed(1)}deg;--dist:${dist}px;--dl:${dl}s;--sz:${3 + (i % 4)}px"></i>`;
  }).join("");
  return `<div class="fx">
    <i class="fx-aura"></i>
    <div class="fx-beams">${beams}</div>
    <i class="fx-ring"></i>
    ${rarity === "red" ? `<i class="fx-crown"></i>` : rarity === "diamond" ? `<i class="fx-crown"></i><i class="fx-prism"></i>` : `<i class="fx-pillar"></i>`}
    <div class="fx-motes">${motes}</div>
    <div class="fx-title"><b>${fx.words}</b></div>
  </div>`;
}
function showReveal(results) {
  revealPending = results;
  cancelRevealAll();
  const grid = $("#revealGrid");
  // 160 抽晶钻硬保底：单独起一条「保底获得」说明，别让玩家以为这张卡是普通抽出来的，
  // 更不能静默进名册（那是「抽了 160 抽却什么都没看到」的根因）。
  const pityCards = (results || []).filter(r => r && r.pityGuarantee);
  const pityBar = $("#revealPity");
  if (pityBar) {
    /* 保底条要报「这张卡是第几抽出的」：十连里看到的第 10 张不等于全池第 10 抽，
     * 对 160 抽硬保底必须显示全池累计抽数（如「第 160 抽」），否则玩家会误以为保底没生效。
     * S / curBanner 在 jsdom 单测的隔离作用域里可能不存在，取值前先兜底。 */
    const totalPulls = (typeof S !== "undefined" && typeof curBanner !== "undefined")
      ? (S?.pity?.[curBanner]?.pulls || 0) : 0;
    pityBar.innerHTML = pityCards.length
      ? `<div class="reveal-pity-title">保 底 获 得</div>
         <div class="reveal-pity-sub">${pityCards.map(r => {
           const c = charById(r.id) || {};
           const localIdx = results.indexOf(r) + 1;
           const globalNo = totalPulls >= results.length ? totalPulls - results.length + localIdx : localIdx;
           return `第 ${globalNo} 抽 · ${esc(c.name || r.id)}（${RTAG(r.rarity)}）`;
         }).join(" · ")}</div>`
      : "";
    pityBar.classList.toggle("on", pityCards.length > 0);
  }
  grid.style.setProperty("--cols", revealCols(results.length));
  grid.innerHTML = results.map((r, i) => {
    const c = charById(r.id) || {};
    const rc = RCOLOR(r.rarity);
    const isNew = !r.dupe;
    const tier = fxTierOf(r.rarity);
    // 兜底：万一卡池/存档里混进名册外 id（历史脏数据、运营池配置错误），
    // 不能让 charById() 返回 undefined 把整个翻牌浮层炸掉——只用 id 当名字继续渲染。
    const cname = c.name || String(r.id || "?");
    const cel = c.element && DATA.elements[c.element] ? DATA.elements[c.element].label : "";
    const crole = c.role ? RLABLEX(c.role) : "";
    // 交错入场延迟改用 CSS 变量，避免内联 animation 覆盖掉 CSS 里的动画定义
    return `<div class="fcard${tier ? " " + RARITY_FX[tier].cls : ""}${r.pityGuarantee ? " pity-guarantee" : ""}" data-i="${i}" data-r="${r.rarity}" data-pity="${r.pityGuarantee ? "1" : ""}" style="--delay:${i * 0.05}s;--rc:${rc}">
      <div class="inner">
        <div class="fface back"><div class="seal">缘</div></div>
        <div class="fface front fx-${tier || "none"}" style="border-color:${rc}88">
          <div class="rline" style="border-color:${rc};color:${rc}"></div>
          ${rarityFxHtml(tier)}
          ${r.pityGuarantee ? `<span class="badge-pity">保底获得</span>` : ""}
          ${isNew ? `<span class="badge-new">NEW</span>`
            : `<span class="badge-new" style="background:linear-gradient(120deg,#cfd6e4,#98a1b4)">${r.fateMax ? `6缘圆满 · 缘尘+${r.essenceGain || 0}` : `重复 · 缘+${r.fateGain || 1} 尘缘+${r.essenceGain || 0}`}</span>`}
          ${c.id ? artImg(r.id, "portrait") : ""}
          <div class="fin">
            <b style="font-size:15px">${esc(cname)}</b>
            <span style="font-size:11px;color:var(--dim)">${cel}${cel && crole ? " · " : ""}${crole}</span>
            <span class="rtag" style="justify-self:start;color:${rc};border-color:${rc}">${RTAG(r.rarity)}</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join("");
  $("#reveal").classList.add("on");
  // 卡背展示期间顺手把正面立绘解码预热：用户点「全部翻开」时不会因为临时解码而卡顿
  grid.querySelectorAll(".fface.front img").forEach(img => { if (img.decode) img.decode().catch(() => {}); });
  blip(760, .09);
}
function revealOne(card) {
  if (card.classList.contains("flip")) return;
  card.classList.add("flip");
  const r = revealPending[+card.dataset.i];
  const tier = r ? fxTierOf(r.rarity) : "";
  if (tier) { card.classList.add("glow", "burst"); AudioSys.sfx(RARITY_FX[tier].sfx); }
  else { card.classList.add("spark"); AudioSys.sfx("reveal"); }
}

/* 批量「全部翻开」：
 * 旧实现是 $$('.fcard').forEach(revealOne) 一帧里同步翻转 10 张卡。
 * 每张卡都带一张 1024~1672px 大立绘，10 个 3D 翻转 + 稀有卡 glow 的滤镜动画同时起，
 * 主线程被样式重算/图层重建卡住 70~150ms，观感就是"点下去先顿一下，卡片才哗地全翻"。
 * 现在：点击后立刻逐帧分批推进，把样式/图层重建摊到多帧；
 * 正面立绘在 showReveal 展示卡背时已预热 decode，不占用翻牌时机。
 *
 * 2026-11-02 用户口径「全部翻开时 UR / SSR 要有对应的翻开特效」：
 *   - 翻开顺序改为「低阶先、红金最后」：UR/SSR 的题字与碎金爆放在最后一批，
 *     不会被同时翻开的 8 张普卡和卡面挤掉注意力；
 *   - 红金单独一批，从不和普卡混批（普卡 2 张/批，红金 1 张/批 + 240ms 收势）；
 *   - 音效按层级只各响一次：普卡一次 reveal，红金一次 reveal_hi（不叠 10 路）。
 */
let revealAllRun = 0;
function cancelRevealAll() { revealAllRun++; }
function revealAllCards() {
  const rest = $$("#revealGrid .fcard").filter(c => !c.classList.contains("flip"));
  if (!rest.length) return;
  const run = ++revealAllRun;
  const PRI = { green: 0, blue: 1, purple: 2, gold: 3, red: 4 };
  const priOf = c => PRI[revealPending[+c.dataset.i]?.rarity] ?? 0;
  // 稳定排序：同阶位保持抽卡返回的原顺序
  const cards = rest.map((c, i) => ({ c, i })).sort((a, b) => (priOf(a.c) - priOf(b.c)) || (a.i - b.i)).map(v => v.c);
  const isRare = c => priOf(c) >= 3;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let playedLo = false, playedHi = false;
  (async () => {
    let i = 0;
    while (i < cards.length) {
      if (run !== revealAllRun) return;
      const c = cards[i];
      if (isRare(c)) {
        // 红金独批：一张一张来，翻开后留足题字/碎金的收势时间
        c.classList.add("flip", "glow", "burst");
        if (!playedHi) { playedHi = true; AudioSys.sfx("reveal_hi", { force: true }); }
        i += 1;
        await wait(420);
      } else {
        // 普卡 2 张一批，快速翻完；最后一批翻完再给红金让出舞台
        const batch = cards.slice(i, i + 2).filter(x => !isRare(x));
        i += batch.length;
        batch.forEach(x => x.classList.add("flip", "spark"));
        if (!playedLo) { playedLo = true; AudioSys.sfx("reveal", { force: true }); }
        await wait(100);
      }
    }
  })();
}

/* ---------------- 屏：名册（养成） ---------------- */

let rosterFilter = "all", rosterSel = null;
const SLOT_NAME = { attack: "普攻", skill: "术法", ultimate: "终式", passive: "天赋", assist: "助战" };
const SLOT_COLOR = { attack: "#8a7ba8", skill: "#5b83b8", ultimate: "#c98d3f", passive: "#5ba883", assist: "#7a8ba0" };

/* 单角色养成弹窗。
 * 原来养成操作挤在名册右侧的固定侧栏里：技能升级/缘器/升级都要往下滚，
 * 而且角色一多，侧栏还会被压缩得只剩很窄一列，很难点。
 * 改成居中弹窗：左立绘 + 右操作区，全部操作一屏可见，不受页面滚动影响。
 */
/** 星级分段配色：1-3 白 → 4-6 蓝 → 7-9 金 → 满星红 MAX，让升星随时有颜色反馈。 */
function starChipStyle(star, cap) {
  if (star >= cap) return ` style="color:#e0565e" title="满星"`;
  if (star >= 7) return ` style="color:var(--gold)"`;
  if (star >= 4) return ` style="color:#8fb6e0"`;
  return "";
}

/* —— 升级（原「喂经验」）——
 * 2026-11-01 用户口径：养成改成一级一级「升级」，每次只升 1 级，
 * 并且把这一级要花的铜钱与经验物直接写在按钮上，不用点下去才知道扣什么。
 * 数值与 tools/lib/game.mjs 的 feedPlan(T, save, id, lv+1) 同口径：
 *   经验曲线取 progression.expToNext[rarity][lv-1]，铜钱取 coinToNext 同下标，
 *   经验物按价值从小到大消耗（散页 > 注疏 > 藏卷的优先顺序，先吃小件避免整卷浪费），
 *   有库存才会被选中。与服务端 feedPlan 同序。
 */
function nextUpgradePlan(id) {
  const sel = charById(id), so = S.owned[id];
  if (!sel || !so) return null;
  const expCurve = DATA.progression?.expToNext?.[sel.rarity] || [];
  const coinCurve = DATA.progression?.coinToNext?.[sel.rarity] || [];
  const idx = Math.min(expCurve.length - 1, Math.max(0, so.lv - 1));
  const expNeed = expCurve[idx] || 0;
  const coinNeed = coinCurve[Math.min(coinCurve.length - 1, Math.max(0, so.lv - 1))] || 0;
  const mats = Object.entries(DATA.materials || {})
    .filter(([, m]) => m && m.exp > 0)
    .sort((a, b) => a[1].exp - b[1].exp);
  let left = expNeed;
  const items = [];
  for (const [key, m] of mats) {
    if (left <= 0) break;
    const have = S.wallet?.mat?.[key] || 0;
    if (have <= 0) continue;
    const take = Math.min(have, Math.ceil(left / m.exp));
    if (take > 0) { items.push({ key, label: m.label || key, count: take }); left -= take * m.exp; }
  }
  return { lv: so.lv, expNeed, coinNeed, items, expShort: Math.max(0, left), coinHave: S.wallet?.coin || 0 };
}

/** 升级按钮：主文案「升 级」+ 下一级的资源消耗；缺料时把差多少直接写在按钮上并置灰。 */
function upgradeButtonHtml(id) {
  const sel = charById(id), so = S.owned[id];
  if (!sel || !so) return "";
  const cap = DATA.rarities[sel.rarity].levelCap;
  const gates = DATA.progression?.breakthroughs || [];
  const gate = gates[so.bt] || null;
  const maxLv = gate ? Math.min(cap, gate.atLevel) : cap;
  if (so.lv >= maxLv) {
    return `<button class="btn primary up-btn" data-feed="${id}" disabled>
      <span class="up-main">${I("sparkle")} 升 级</span>
      <span class="up-cost">${gate ? `需突破至 ${so.bt + 1} 阶` : "已满级"}</span>
    </button>`;
  }
  const p = nextUpgradePlan(id);
  const matText = p.items.map(i => `${i.label}×${i.count}`).join(" + ");
  const blocked = p.expShort > 0 || p.coinHave < p.coinNeed;
  /* 消耗永远完整展示（升到几级 + 铜钱 + 经验物），差料只在后面补一句差多少 */
  const shortText = p.expShort > 0
    ? `（经验差 ${fmt(p.expShort)}）`
    : p.coinHave < p.coinNeed ? `（缺铜钱 ${fmt(p.coinNeed - p.coinHave)}）` : "";
  const costText = `Lv.${p.lv}→${p.lv + 1} · 铜钱 ${fmt(p.coinNeed)}${matText ? ` · ${matText}` : ""}${shortText}`;
  const tipCost = `升至 Lv.${p.lv + 1}|铜钱 ${fmt(p.coinNeed)}${p.items.length ? ` · ${p.items.map(i => `${i.label}×${i.count}（${fmt(i.count * ((DATA.materials[i.key] || {}).exp || 0))} 经验）`).join(" + ")}` : ""}`;
  return `<button class="btn primary up-btn" data-feed="${id}" ${blocked ? "disabled" : ""} data-tip="${esc(tipCost)}">
    <span class="up-main">${I("sparkle")} 升 级</span>
    <span class="up-cost">${costText}</span>
  </button>`;
}

/* —— 突破门槛与缺口（养成弹窗 / 名册右栏共用）——
 * 与服务端 tools/lib/game.mjs breakthroughPlan 同口径：等级、星级、材料、铜钱四项全齐才可突破。
 * 展示必须是「现有 / 需要」，缺口是 need-have：玩家有 3 颗洗髓丹、总量要 12 时，
 * 要看到「洗髓丹 3/12 · 还差 9」，而不是一句「缺 洗髓丹 ×12」——那读起来像一颗都没有。
 */
function btStatus(id) {
  const sel = charById(id), so = S.owned[id];
  const cap = DATA.rarities[sel.rarity].levelCap;
  const gates = DATA.progression?.breakthroughs || [];
  const gate = gates[so.bt] || null;
  if (!gate) return { gate: null, maxLv: cap, ok: false, lock: "已满", rows: [], tip: "已达最高突破阶", coinHave: 0 };
  const rows = Object.entries(gate.materials || {}).map(([k, n]) => {
    const have = (S.wallet?.mat?.[k]) || 0;
    return { key: k, label: matLabel(k), have, need: n, short: Math.max(0, n - have) };
  });
  const coinHave = S.wallet?.coin || 0;
  const lvOk = so.lv >= gate.atLevel;
  const starOk = so.star >= gate.starMin;
  const lackRow = rows.find(r => r.short > 0);
  const coinShort = Math.max(0, gate.coin - coinHave);
  const ok = lvOk && starOk && !lackRow && coinShort === 0;
  const lock = !lvOk ? `Lv.${gate.atLevel}`
    : !starOk ? `★${gate.starMin}`
    : lackRow ? `缺${lackRow.label} ${lackRow.short}`
    : coinShort > 0 ? `缺铜钱 ${fmt(coinShort)}` : "";
  const tip = [
    `突破至 ${so.bt + 1} 阶`,
    `等级 ${so.lv}/${gate.atLevel}${lvOk ? "" : "（不足）"} · 星级 ★${so.star}/${gate.starMin}${starOk ? "" : "（不足）"}`,
    ...rows.map(r => `${r.label} ${r.have}/${r.need}${r.short ? `（还差 ${r.short}）` : "（已够）"}`),
    `铜钱 ${fmt(coinHave)}/${fmt(gate.coin)}${coinShort ? `（还差 ${fmt(coinShort)}）` : "（已够）"}`,
  ].join("|");
  return { gate, maxLv: Math.min(cap, gate.atLevel), ok, lock, rows, tip, coinHave };
}

/* —— 归一：已强化角色退回 Lv.1 / ★1 / 0 阶，返还 80% 突破·升星·升级投入 ——
 * 服务端口径在 tools/lib/game.mjs normalizePlan；这里算的是同一份账，只用于确认框展示。
 * 只退这三项，技能等级 / 命格 / 心法 / 觉醒等永久养成保留——归一不是"删卡重来"。
 * 因为不可撤销，按钮本身不直接执行，必须先弹出明细确认框。
 */
function normalizePreview(id) {
  const sel = charById(id), so = S.owned[id];
  if (!sel || !so) return null;
  const rate = DATA.progression?.normalizeRate ?? 0.8;
  const expCurve = DATA.progression?.expToNext?.[sel.rarity] || [];
  const coinCurve = DATA.progression?.coinToNext?.[sel.rarity] || [];
  let expSpent = 0, levelCoin = 0;
  for (let lv = 1; lv < so.lv; lv++) {
    expSpent += expCurve[Math.min(expCurve.length - 1, Math.max(0, lv - 1))] || 0;
    levelCoin += coinCurve[Math.min(coinCurve.length - 1, Math.max(0, lv - 1))] || 0;
  }
  const gates = DATA.progression?.breakthroughs || [];
  const btMats = {};
  let btCoin = 0;
  for (let i = 0; i < so.bt && i < gates.length; i++) {
    for (const [k, n] of Object.entries(gates[i].materials || {})) btMats[k] = (btMats[k] || 0) + n;
    btCoin += gates[i].coin || 0;
  }
  const starTable = DATA.progression?.starCost?.[sel.rarity] || [];
  let starScroll = 0, starCoin = 0;
  for (let s = 1; s < so.star && s - 1 < starTable.length; s++) {
    starScroll += (starTable[s - 1].toStar - 1) || 0;
    starCoin += starTable[s - 1].coin || 0;
  }
  const floorRate = (n) => Math.floor(n * rate);
  const refundCoin = Math.floor((levelCoin + btCoin + starCoin) * rate);
  const expItems = DATA.materials || {};
  const order = Object.keys(expItems).filter(k => (expItems[k].exp || 0) > 0)
    .sort((a, b) => (expItems[b].exp || 0) - (expItems[a].exp || 0));
  let expLeft = Math.floor(expSpent * rate);
  const mats = {};
  for (const k of order) {
    const v = expItems[k].exp || 0;
    if (v <= 0) continue;
    const n = Math.floor(expLeft / v);
    if (n > 0) { mats[k] = n; expLeft -= n * v; }
  }
  for (const [k, n] of Object.entries(btMats)) { const f = floorRate(n); if (f > 0) mats[k] = (mats[k] || 0) + f; }
  const fresh = so.lv <= 1 && (so.star || 1) <= 1 && (so.bt || 0) <= 0;
  return { rate, fresh, now: { lv: so.lv, star: so.star, bt: so.bt || 0 }, coin: refundCoin, mats, starScroll: floorRate(starScroll), starScrollRarity: sel.rarity, levelCoin, btCoin, starCoin };
}

/** 归一按钮：未强化过（Lv.1/★1/0 阶）置灰；其余可点开确认框。 */
function normalizeButtonHtml(id) {
  const p = normalizePreview(id);
  if (!p) return "";
  return `<button class="btn ghost" data-normalize="${id}" ${p.fresh ? "disabled" : ""} data-tip="归 一|重置为 Lv.1 · ★1 · 0 阶，返还 ${Math.round(p.rate * 100)}% 突破·升星·升级材料（技能与命格保留）|操作不可撤销，确认前会列出返还明细">${I("break")} 归 一</button>`;
}

/** 归一确认框：把「现在 → 归一后」和返还清单一次列清。 */
function openNormalizeConfirm(id) {
  const sel = charById(id), p = normalizePreview(id);
  if (!sel || !p) return;
  const rc = RCOLOR(sel.rarity);
  const rows = [];
  if (p.coin > 0) rows.push({ label: "铜钱", val: `+${fmt(p.coin)}` });
  if (p.starScroll > 0) rows.push({ label: (DATA.fate?.starScrolls?.[p.starScrollRarity] || {}).label || "升星卷", val: `×${fmt(p.starScroll)}` });
  for (const [k, n] of Object.entries(p.mats)) if (n > 0) rows.push({ label: matLabel(k), val: `×${fmt(n)}` });
  modal(`<div class="menu skcmp">
    <button class="iconbtn mclose" data-close>${I("close")}</button>
    <div class="skcmp-kicker">归一 · 重置养成</div>
    <div class="skcmp-title" style="color:${rc}">${esc(sel.name)}</div>
    <div class="skcmp-lv"><span>Lv.<b class="num">${p.now.lv}</b> · ★<b class="num">${p.now.star}</b> · <b class="num">${p.now.bt}</b> 阶</span><span class="ar">→</span><span class="up">Lv.<b class="num">1</b> · ★<b class="num">1</b> · <b class="num">0</b> 阶</span></div>
    <div class="skcmp-table">
      <div class="skcmp-tr skcmp-th"><span>返还项目（${Math.round(p.rate * 100)}%）</span><span></span><span></span><span>数量</span></div>
      ${rows.length ? rows.map((r) => `<div class="skcmp-tr"><span class="k">${esc(r.label)}</span><span class="a num"></span><span class="ar"></span><span class="b num">${esc(r.val)}</span></div>`).join("") : `<div class="skcmp-empty">该角色没有可返还的养成投入。</div>`}
    </div>
    <div class="skcmp-foot">
      <div class="skcmp-ok">突破、升星、升级材料按 ${Math.round(p.rate * 100)}% 返还 · 技能等级、命格、心法、觉醒保留</div>
      <div class="skcmp-lack">归一会清空该角色的等级/星级/突破阶，操作不可撤销。</div>
    </div>
    <div class="skcmp-acts">
      <button class="btn primary" data-normalizecfm="${id}">${I("sparkle")} 确认归一</button>
      <button class="btn" data-close>取 消</button>
    </div>
  </div>`, { dimClose: true });
}

/* —— 三期：觉醒三步清单（养成弹窗「觉醒」区用）——
 * 服务端口径在 tools/lib/game.mjs awakenSteps：tower=t100 首通 / weapon=本命缘器+15 / bio=三传皆读。
 * 本命缘器等级存档不直出：refreshLoadout 拉到 loadout 后回填 awBenmingLv 并就地刷新勾叉。 */
const awBenmingLv = {};
function awStepsState(id) {
  const ch = (DATA.awaken && (DATA.awaken.chars || {})[id]) || null;
  if (!ch) return [];
  const read = (S.bioRead || {})[id] || [];
  const bioAll = (ch.bio || []).length > 0 && (ch.bio || []).every((_, i) => read[i]);
  return ((DATA.awaken || {}).steps || []).map(st => ({
    key: st.key, label: st.label, desc: st.desc,
    ok: st.key === "tower" ? !!(S.cleared && S.cleared.t100)
      : st.key === "weapon" ? (awBenmingLv[id] || 0) >= 15
      : st.key === "bio" ? bioAll : false,
  }));
}

function openGrow(id) {
  const sel = charById(id);
  const so = S.owned[id];
  if (!sel || !so) { toast("这个角色还没结缘"); return; }
  const cap = DATA.rarities[sel.rarity].levelCap;
  const starCap = DATA.rarities[sel.rarity].starCap;
  const rc = RCOLOR(sel.rarity);
  rosterSel = id;
  /* 突破与升星的门槛来自服务端同一张表（data/config.json → meta.progression.breakthroughs）：
   *   bt=0 需 Lv.20+★1 · bt=1 需 Lv.40+★2 · bt=2 需 Lv.60+★4 · bt=3 需 Lv.80+★6
   * 等级上限又被"下一次突破"锁住（MaxLevel = gates[bt].atLevel）。
   * 所以三件事互为前置，界面上必须把"现在卡在哪"直接写出来，
   * 否则玩家只会看到一句"已到当前可达等级，先突破或升星"却不知道突破差什么。
   */
  const gates = DATA.progression?.breakthroughs || [];
  const gate = gates[so.bt] || null;
  const bt = btStatus(id);
  const maxLv = bt.maxLv;
  const lvFull = so.lv >= maxLv;                    // 等级已顶到本次突破的上限
  const canBt = bt.ok;
  // 按钮上只放最短的必要信息，完整原因在 .gd-gate 行与 title 里
  const btLock = bt.lock;
  /* 升星成本（与服务端同口径，2026-11-05 改版）：只吃「对应阶级升星卷」，
   * 1→2 星 1 张，2→3 星 2 张 …… 9→10 星 9 张；铜钱照常。 */
  const starTable = DATA.progression?.starCost?.[sel.rarity] || [];
  const starCost = starTable[so.star - 1] || null;
  const scrollNeed = starCost ? (starCost.toStar - 1) : 0;
  const scrollHave = (S.wallet?.starScroll || {})[sel.rarity] || 0;
  const scrollLabel = (DATA.fate?.starScrolls?.[sel.rarity] || {}).label || "升星卷";
  const coinHave = S.wallet?.coin || 0;
  const starLock = !starCost ? "已满星"
    : scrollHave < scrollNeed ? `缺 ${scrollLabel} ${scrollNeed - scrollHave}`
      : coinHave < starCost.coin ? `缺铜钱` : "";
  const starTip = !starCost ? "已满星"
    : `升 ★${starCost.toStar}：${scrollLabel} ${scrollHave}/${scrollNeed} · 铜钱 ${fmt(starCost.coin)}`;
  /* —— 二期养成三件套（PLAYABLE P1）：命格盘 + 心法改造 ——
   * 盘按角色定位在服务端已映射好（diskMap），点亮进度与改造结果都在存档里。 */
  const conDiskKey = DATA.constellations?.diskMap?.[id];
  const conDisk = conDiskKey ? (DATA.constellations.disks || {})[conDiskKey] : null;
  const conChosen = (S.constellations || {})[id] || {};
  const xingshaHave = S.wallet?.mat?.xingsha || 0;
  const modFam = (DATA.skillmods?.families || {})[sel.role] || [];
  const modKey = (S.skillmods || {})[id];
  const mod = modKey ? modFam.find(m => m.key === modKey) : null;
  const xinyinHave = S.wallet?.mat?.xinyin || 0;
  /* —— 三期：觉醒 + 传记 —— 只有 DATA.awaken.chars 里登了名的角色（六位 UR）才有此区。 */
  const awCh = (DATA.awaken && (DATA.awaken.chars || {})[id]) || null;
  const awDone = !!(awCh && S.awaken && S.awaken[id]);
  modal(`<div class="grow-dlg">
    <button class="iconbtn mclose" data-close>${I("close")}</button>
    <div class="gd-left">
      <div class="portrait" style="aspect-ratio:3/4">
        ${artImg(id, "portrait")}
        <span class="rtag" style="position:absolute;top:10px;left:10px;color:${rc};border-color:${rc}">${RTAG(sel.rarity)}</span>
        ${S.team.includes(id) ? `<span class="gtag">出战</span>` : ""}
      </div>
      <div class="gd-name ${awDone ? "awakened-name" : ""}">${esc(sel.name)}</div>
      <div class="panel-sub">${esc(sel.title || FLABEL(sel.faction))}</div>
      <div class="gd-basic">
        <span style="color:${rc};border-color:${rc}">${RTAG(sel.rarity)}</span>
        <span>${ELABEL(sel.element)}</span><span>·</span><span>${RLABEL(sel.role)}</span>
        <span class="poschip" data-tip="角色定位|${esc(RPOS(sel.role))} · ${esc((DATA.roles[sel.role] || {}).tagline || "")}">${esc(RPOS(sel.role))}</span>
      </div>
    </div>

    <div class="gd-right">
      <div class="statgrid" style="grid-template-columns:repeat(4,1fr)">
      <div class="sg"><div class="k">等级</div><div class="v num"${lvFull ? ` style="color:var(--gold)" title="已到当前突破上限，先突破"` : ""}>Lv.${so.lv}<span style="color:var(--faint);font-size:11px">/${maxLv}</span></div></div>
      <div class="sg"><div class="k">星级</div><div class="v num"${starChipStyle(so.star, starCap)}>★${so.star}${so.star >= starCap ? `<span style="font-size:11px"> MAX</span>` : ""}</div></div>
      <div class="sg"><div class="k">缘</div><div class="v num" style="display:flex;align-items:center;gap:6px;color:${(DATA.fate?.colors?.find(x => Number(x.fate) === (so.fate || 0)) || {}).color || "var(--faint)"}">${so.fate ? fateStarRow(so.fate, 17) : "0 缘"}<span style="font-size:11px">${so.fate || 0}/6</span></div></div>
      <div class="sg"><div class="k">突破</div><div class="v num"${so.bt > 0 ? ` style="color:var(--gold)"` : ` style="color:var(--faint)"`}>${so.bt} 阶</div></div>
    </div>
    ${fatePanelHtml(id, so)}
      ${gate ? `<div class="gd-gate">
        <span class="gk">下一阶突破</span>
      <span class="${so.lv >= gate.atLevel ? "ok" : "no"}">Lv.${so.lv}/${gate.atLevel}</span>
      <span class="${so.star >= gate.starMin ? "ok" : "no"}">★${so.star}/${gate.starMin}</span>
      ${bt.rows.map(r => `<span class="${r.short === 0 ? "ok" : "no"}" data-tip="${r.label}|现有 ${r.have} / 需要 ${r.need}${r.short ? ` · 还差 ${r.short}` : " · 已够"}">${r.label} ${r.have}/${r.need}${r.short ? ` · 还差 ${r.short}` : ""}</span>`).join(" ")}
      <span class="${coinHave >= gate.coin ? "ok" : "no"}" data-tip="铜钱|现有 ${fmt(coinHave)} / 需要 ${fmt(gate.coin)}${coinHave < gate.coin ? ` · 还差 ${fmt(gate.coin - coinHave)}` : " · 已够"}">铜钱 ${fmt(coinHave)}/${fmt(gate.coin)}</span>
      ${canBt ? `<span class="ok">条件已满足</span>` : ""}
      </div>` : `<div class="gd-gate"><span class="ok">已达最高突破阶</span></div>`}

      <div class="gd-sec">
        <div class="panel-title" style="font-size:14px">技 能</div>
        ${sel.skills.slice(0, 4).map(sk => `
          <div class="skill-item"><div class="sh">
            <span class="slotchip" style="background:${SLOT_COLOR[sk.slot] || "#888"}">${SLOT_NAME[sk.slot] || sk.slot}</span>
            <span class="sn ${sk.slot === "ultimate" && awDone ? "awakened-name" : ""}">${esc(sk.slot === "ultimate" && awDone ? awCh.trueName : sk.name)}</span>
            <span class="panel-sub num" style="margin-left:auto">Lv.${so.skills[sk.slot] || 1}</span>
            ${sk.slot !== "attack" ? `<button class="btn sm ghost" data-skill="${sk.slot}" data-for="${id}" style="padding:2px 10px">升级</button>` : ""}
            ${sk.slot === "ultimate" ? (modKey
              ? `<span class="rtag" style="color:#d9a13b;border-color:#d9a13b;cursor:help" data-tip="心法·${esc(mod?.name || "")}|${esc(mod?.desc || "")} · 终身一次 · 不可更改">心法·${esc(mod?.name || "")}</span>`
              : (modFam.length ? `<button class="btn sm ghost" data-skillmod="${id}" style="padding:2px 10px">改 造</button>` : "")) : ""}
          </div>
            <div class="sd">${skillDesc(sk.desc) || "——"}</div></div>`).join("")}
        ${modFam.length ? `<div class="cons-modline ${modKey ? "has" : ""}">${modKey
          ? `<span class="mt">心法·${esc(mod?.name || "")}</span><span class="mdd">${skillDesc(mod?.desc || "")}</span><span class="mfix">终身一次 · 不可更改</span>`
          : `<span class="mt">心法未改</span><span class="mdd">终式可改造一次 · 消耗 心印×1${xinyinHave < 1 ? `（现有 ${xinyinHave}）` : ""} · 改后终身不变</span>`}</div>` : ""}
      </div>

      ${conDisk ? `<div class="gd-sec">
        <div class="panel-title" style="font-size:14px">命 格 <span class="cons-diskname">${I("constellation", "width:13px;height:13px;vertical-align:-2px")} ${esc(conDisk.name)}</span></div>
        <div class="panel-sub" style="font-size:11px">六格随突破阶渐次点亮 · 三选一 · 点亮即永久生效，不可更改</div>
        <div class="con-grid">
          ${conDisk.slots.map((sl, i) => {
            const optI = conChosen[i];
            const lit = optI !== undefined && sl.opts[optI];
            const locked = so.bt < i;
            const cost = DATA.constellations.costs[i] ?? 0;
            const opt = lit ? sl.opts[optI] : null;
            const tip = lit
              ? `${esc(sl.name)} · 已点亮|${esc(fxDesc(opt.fx))}`
              : locked ? `${esc(sl.name)} · 未点亮|需先突破至 ${i} 阶`
              : `${esc(sl.name)} · 未点亮|三选一点亮 · 消耗星砂 ×${cost}`;
            return `<button class="con-slot ${lit ? "lit" : ""} ${!lit && locked ? "lock" : ""}"
              ${lit || locked ? "" : `data-conslot="${i}" data-for="${id}"`} data-tip="${tip}">
              <span class="cname">${esc(sl.name)}</span>
              <span class="copt">${lit ? esc(opt.name) : locked ? "未解锁" : "未点亮"}</span>
              ${lit ? `<span class="ccost num" style="color:#d9a13b">${esc(fxDesc(opt.fx))}</span>`
                : locked ? `<span class="ccost num">突破 ${i} 阶</span>`
                : `<span class="ccost num">星砂 ×${cost}</span>`}
            </button>`;
          }).join("")}
        </div>
        <div class="panel-sub" style="font-size:11px">${matLabel("xingsha")} 持有 <b class="num" style="color:#d9a13b">${fmt(xingshaHave)}</b></div>
      </div>` : ""}

      ${awCh ? `<div class="gd-sec" id="awBox" data-for="${id}">
        <div class="panel-title" style="font-size:14px;display:flex;align-items:center">觉 醒
          <button class="btn sm ghost" data-biopen="${id}" style="margin-left:auto;padding:2px 10px">传 记</button>
        </div>
        ${awDone ? `
          <div class="aw-badge">${I("sparkle", "width:14px;height:14px;vertical-align:-2px")} 已觉醒 · 称号「${esc(awCh.title)}」</div>
          <div class="panel-sub" style="font-size:11px">终式已归真名「${esc(awCh.trueName)}」 · 出战伤害 +${Math.round(((DATA.awaken || {}).dmgUp || 0.15) * 100)}%</div>
        ` : `
          <div class="aw-steps">
            ${awStepsState(id).map(st => `
              <div class="aw-step ${st.ok ? "ok" : "no"}" data-stepkey="${st.key}">
                <span class="aw-ck">${st.ok ? "✓" : "✗"}</span>
                <span class="aw-lb">${esc(st.label)}<i>${esc(st.desc)}</i></span>
              </div>`).join("")}
          </div>
          <div class="aw-actrow">
            <button class="btn primary" data-awclaim="${id}">觉 醒</button>
            <span class="panel-sub" style="font-size:11px">三缘皆满，方可唤出真名 · 成后伤害 +${Math.round(((DATA.awaken || {}).dmgUp || 0.15) * 100)}%</span>
          </div>
        `}
      </div>` : ""}

      <div class="gd-sec">
        <div id="loadoutBox" data-for="${id}" style="display:grid;gap:8px">
          <div class="panel-title" style="font-size:14px">缘 器</div>
          <div class="panel-sub" style="font-size:11px">加载中…</div>
        </div>
      </div>

      <div class="gd-actions">
        ${upgradeButtonHtml(id)}
        <button class="btn" data-starup="${id}" ${starLock ? "disabled" : ""} title="${esc(starTip)}">
          ${I("gem")} ${starLock ? `升 星 · ${starLock}` : `升 星 · ${fmt(starCost.coin)} 铜钱`}
        </button>
        <button class="btn" data-break="${id}" ${btLock ? "disabled" : ""} data-tip="${esc(bt.tip)}">
          ${I("shield")} ${btLock ? `突 破 · ${btLock}` : "突 破"}
        </button>
        ${normalizeButtonHtml(id)}
        <button class="btn ghost" data-open="${id}">完整卡面</button>
      </div>
    </div>
  </div>`);
  // 缘器信息是异步拉的，DOM 进弹窗后可直接填充
  refreshLoadout(id);
  // 已觉醒：立绘染金（goldtint 是整串 filter，直接挂到弹窗大立绘的 img 上）
  if (awDone && awCh.goldtint) {
    const pimg = document.querySelector(".grow-dlg .gd-left .portrait img");
    if (pimg) pimg.style.filter = awCh.goldtint;
  }
}

/* 命格点亮 · 三选一浮层（settle.js 的 data-conslot 委托进来的）。
 * 会替换掉养成弹窗：选定成功后由委托方重开 openGrow 刷新。 */
function openConPick(id, slot) {
  const diskKey = DATA.constellations?.diskMap?.[id];
  const disk = diskKey ? (DATA.constellations.disks || {})[diskKey] : null;
  const sl = disk?.slots?.[slot];
  if (!S.owned[id] || !sl) return;
  const cost = DATA.constellations.costs?.[slot] ?? 0;
  const locked = (S.owned[id].bt || 0) < slot;
  const have = S.wallet?.mat?.xingsha || 0;
  const poor = have < cost;
  const why = locked ? `需先突破至 ${slot} 阶，方能点亮此格`
    : poor ? `${matLabel("xingsha")}不足 · 现有 ${have} / 需 ${cost}`
    : `消耗 ${matLabel("xingsha")} ×${cost} · 现有 ${fmt(have)}`;
  modal(`<div class="menu con-pick">
    <div class="panel-title" style="text-align:center">点 亮 · ${esc(sl.name)}</div>
    <div class="panel-sub" style="text-align:center;margin-top:6px">${esc(disk.name)} 第 ${slot + 1} 格 · 三选一，点亮后终身不变</div>
    <div class="con-opts">
      ${sl.opts.map((o, oi) => `<button class="con-opt" data-conopt="${slot}|${oi}" data-for="${id}" ${locked || poor ? "disabled" : ""}>
        <span class="on">${esc(o.name)}</span><span class="od">${esc(fxDesc(o.fx))}</span>
      </button>`).join("")}
    </div>
    <div class="con-foot">${esc(why)}</div>
    <div style="margin-top:10px"><button class="btn" style="width:100%" data-close>取 消</button></div>
  </div>`);
}

/* 心法改造 · 三选一浮层（settle.js 的 data-skillmod 委托进来的）。终身一次，慎之。 */
function openModPick(id) {
  const sel = charById(id);
  const fam = (DATA.skillmods?.families || {})[sel?.role] || [];
  if (!S.owned[id] || !fam.length) return;
  if ((S.skillmods || {})[id]) { toast("此角色已改造，终身一次不可更改"); return; }
  const cost = DATA.skillmods?.cost ?? 1;
  const have = S.wallet?.mat?.xinyin || 0;
  const poor = have < cost;
  modal(`<div class="menu con-pick">
    <div class="panel-title" style="text-align:center">心 法 · 技 能 改 造</div>
    <div class="panel-sub" style="text-align:center;margin-top:6px">${esc(sel.name)} · ${esc(RLABLEX(sel.role))}之属 · 只对终式生效 · 消耗 ${esc(matLabel("xinyin"))}×${cost} · 终身一次</div>
    <div class="con-opts">
      ${fam.map(m => `<button class="con-opt" data-modpick="${esc(m.key)}" data-for="${id}" ${poor ? "disabled" : ""}>
        <span class="on">${esc(m.name)}</span><span class="od">${skillDesc(m.desc)}</span>
      </button>`).join("")}
    </div>
    <div class="con-foot">${poor ? `${esc(matLabel("xinyin"))}不足 · 现有 ${have} / 需 ${cost}` : "选定后终身不变，请慎思笃行"}</div>
    <div style="margin-top:10px"><button class="btn" style="width:100%" data-close>取 消</button></div>
  </div>`);
}

/* —— 三期：传记（觉醒区内「传 记」按钮进来，settle.js 的 data-biopen 委托）——
 * 三段卷轴：锁定（缘值不足）/ 可读未读（展卷）/ 已读（重读）。
 * 锁定口径与服务端 bioState 同源：bonds[id].v < need 即锁，读毕与否看 S.bioRead。 */
function bioBondV(id) {
  const b = (xpBondCache && xpBondCache[id]) || (S.bonds && S.bonds[id]) || null;
  return b ? (b.v || 0) : 0;
}

function renderBioList(id, mode) {
  const ch = (DATA.awaken && (DATA.awaken.chars || {})[id]) || null;
  const c = charById(id);
  if (!ch || !c || !S.owned[id]) { toast("还没有这位的传记"); return; }
  const v = bioBondV(id);
  const read = (S.bioRead || {})[id] || [];
  const story = mode === "story";
  modal(`<div class="menu bio-modal" data-bimode="${story ? "story" : "bio"}">
    <button class="iconbtn mclose" data-close>${I("close")}</button>
    <div class="panel-title" style="text-align:center">${story ? "经 历" : "传 记"} · ${esc(c.name)}</div>
    <div class="panel-sub" style="text-align:center;margin-top:4px">缘起 · 纠缠 · 了断 —— 缘值越深，卷帙越展</div>
    <div class="cs-sec" style="margin-top:12px">
      <div class="cs-k">生 平</div>
      <p class="cs-text">${esc(c.lore || "")}</p>
    </div>
    <div class="bio-list">
      ${ch.bio.map((b, i) => {
        const isRead = !!read[i];
        const locked = v < b.need;
        return `<div class="bio-seg ${locked ? "lock" : isRead ? "read" : "open"}">
          <div class="bs-hd"><span class="bs-t">${esc(b.title)}</span>${isRead ? `<span class="bs-ck">✓</span>` : ""}</div>
          ${locked
            ? `<div class="bs-tip">缘值 ${b.need} 解锁 · 当前缘值 ${v}</div>`
            : `<div class="bs-tip">${isRead ? "已展卷 · 可重读" : "缘已至此 · 展卷一观"}</div>
               <div><button class="btn sm ${isRead ? "ghost" : "primary"}" data-bioread="${id}" data-biidx="${i}">${isRead ? "重 读" : "展 卷"}</button></div>`}
        </div>`;
      }).join("")}
    </div>
    <div style="margin-top:12px"><button class="btn" style="width:100%" data-close>合 卷</button></div>
  </div>`);
}

function openBio(id, mode) {
  const ch = (DATA.awaken && (DATA.awaken.chars || {}))[id] || null;
  if (!ch || !S.owned[id]) { toast("还没有这位的传记"); return; }
  // 先按当前已知缘值铺卷目（同步，点开即有反馈）；
  // 缘值数据 buildView 不透出：缓存为空时再借一次 visit 响应回填并就地刷新。
  renderBioList(id, mode);
  if (!xpBondCache) {
    call({ type: "visit" }).then(j => {
      if (!j) return;
      try { xpSyncSave(j); } catch (e) { return; }
      if (document.querySelector(".bio-modal")) renderBioList(id, mode);
    }).catch(() => { /* 拉不到就按缘值 0 画锁定 */ });
  }
}

/* —— 角色经历：名册详情「经 历」入口 ——
 * 有传记的角色（DATA.awaken.chars）直接走三段卷目：缘值 3/6/9 逐段解锁，首读有赠；
 * 其余角色展示档案与随身线索，让每一张卡都至少有一页可读的来历。 */
function openCharStory(id) {
  const c = charById(id);
  if (!c) return;
  const ch = (DATA.awaken && (DATA.awaken.chars || {})[id]) || null;
  if (ch && (ch.bio || []).length) return openBio(id, "story");
  const rc = RCOLOR(c.rarity);
  modal(`<div class="menu charstory-modal">
    <button class="iconbtn mclose" data-close>${I("close")}</button>
    <div class="panel-title" style="text-align:center">经 历 · ${esc(c.name)}</div>
    <div class="panel-sub" style="text-align:center;margin-top:4px">${esc(c.title || "")} · <span style="color:${rc}">${RTAG(c.rarity)}</span> · ${FLABEL(c.faction)}</div>
    <div class="cs-sec">
      <div class="cs-k">生 平</div>
      <p class="cs-text">${esc(c.lore || "这位的经历还藏在雾里。")}</p>
    </div>
    ${c.prop ? `<div class="cs-sec"><div class="cs-k">随 身</div><p class="cs-text">${esc(c.prop)}</p></div>` : ""}
    <div class="panel-sub" style="text-align:center;margin-top:10px">更深的身世尚未展开 —— 与她多走动，缘到了自然会讲。</div>
    <div style="margin-top:12px"><button class="btn" style="width:100%" data-close>合 卷</button></div>
  </div>`);
}

/* —— 角色语音：列出全部台词并可逐句试听 ——
 * 台词优先现读角色档案（data/characters/<id>/character.json，构建产物，no-store），
 * 拿不到时回退 /api/boot 下发的 vlines（content/voice.json → character.json → /api/boot）。
 * 现读是为了避免「改完台词 + build 了，但服务还是旧进程/旧 boot 缓存」时弹窗仍显示旧句。
 * 播放统一走 AudioSys.cv（单通道：新的一句会接管正在播的旧句）。 */
const VOX_SLOTS = [
  { key: "enter", label: "登场", note: "进战 / 详情页翻开时" },
  { key: "ultimate", label: "终结技", note: "终式演出时" },
  { key: "win", label: "胜利", note: "战斗胜利时" },
  { key: "hurt", label: "受击", note: "受击短句" },
];
async function openCharVoice(id) {
  const c = charById(id);
  if (!c) return;
  let lines = c.vlines || {};
  let vp = c.vprofile || {};
  try {
    const r = await fetch(`/data/characters/${encodeURIComponent(id)}/character.json`, { cache: "no-store" });
    if (r.ok) {
      const doc = await r.json();
      if (doc && doc.voice) {
        if (doc.voice.lines) lines = doc.voice.lines;
        vp = { timbre: doc.voice.timbre || "", pace: doc.voice.pace || "", quirk: doc.voice.quirk || "" };
        c.vlines = lines; c.vprofile = vp;   // 写回内存：主城字幕等其它入口也立刻用新台词
      }
    }
  } catch (e) { /* 档案读不到就用 boot 下发的兜底，不阻塞弹窗 */ }
  const rc = RCOLOR(c.rarity);
  modal(`<div class="menu vox-modal">
    <button class="iconbtn mclose" data-close>${I("close")}</button>
    <div class="panel-title" style="text-align:center">语 音 · ${esc(c.name)}</div>
    <div class="panel-sub" style="text-align:center;margin-top:4px">${esc(c.title || "")} · <span style="color:${rc}">${RTAG(c.rarity)}</span></div>
    ${(vp.timbre || vp.pace || vp.quirk) ? `<div class="vox-profile">
      ${vp.timbre ? `<span class="vx"><i>声线</i>${esc(vp.timbre)}</span>` : ""}
      ${vp.pace ? `<span class="vx"><i>语速</i>${esc(vp.pace)}</span>` : ""}
      ${vp.quirk ? `<span class="vx"><i>口癖</i>${esc(vp.quirk)}</span>` : ""}
    </div>` : ""}
    <div class="vox-list">
      ${VOX_SLOTS.map(sl => {
        const text = lines[sl.key] || "";
        return `<div class="vox-row" data-vox="${sl.key}">
          <span class="vox-k">${sl.label}<i>${sl.note}</i></span>
          <span class="vox-t">${text ? esc(text) : `<span class="vox-empty">这句还没录</span>`}</span>
          <button class="vox-play" data-cvplay="${esc(id)}|${sl.key}" ${text ? "" : "disabled"} data-tip="播放|试听这句台词">${I("story", "width:13px;height:13px;vertical-align:-2px")} <span class="vox-label">播放</span></button>
        </div>`;
      }).join("")}
    </div>
    <div class="vox-foot panel-sub">战斗里登场 / 终式 / 胜利 / 受击会自动播对应的一句。</div>
    <div style="margin-top:12px"><button class="btn" style="width:100%" data-close>合 上</button></div>
  </div>`);
}

/* —— 角色立绘：名册详情与卡面详情的「立 绘」入口 ——
 * 把这名角色所有已出图的资产（全身 / 卡面 / 大招 / 抠图 / 动态 / 头像 / 缘器）一屏列全，
 * 点缩略图换大图；翻页按钮循环切换。资产清单由 /api/boot 的 statics.characters[].artList 下发，
 * 只包含 fileReady 且磁盘上确实存在的图，不会出现空白框。 */
let agState = null;   // { id, list, idx }

function openCharArts(id, kind) {
  const c = charById(id);
  if (!c) return;
  const list = (c.artList || []).slice();
  if (!list.length) { toast("这位的立绘还在画"); return; }
  agState = { id, list, idx: Math.max(0, list.findIndex(x => x.kind === kind)) };
  modal(`<div class="menu art-gallery-modal">
    <button class="iconbtn mclose" data-close>${I("close")}</button>
    <div class="panel-title" style="text-align:center">立 绘 · ${esc(c.name)}</div>
    <div class="panel-sub" style="text-align:center;margin-top:4px">${esc(c.title || "")} · 共 ${list.length} 张</div>
    <div class="ag-stage">
      <img id="agBig" src="" alt="" data-fb="rm">
      <button class="ag-nav l" data-agstep="-1" data-tip="上一张|循环翻页">‹</button>
      <button class="ag-nav r" data-agstep="1" data-tip="下一张|循环翻页">›</button>
    </div>
    <div class="ag-cap"><b id="agName"></b><span id="agMeta"></span></div>
    <div class="ag-thumbs">${list.map(a => `
      <button class="ag-thumb" data-agsel="${esc(a.kind)}" data-tip="${esc(a.label)}|${esc(a.use || "")}">
        <img src="${esc(a.src)}" alt="" loading="lazy" data-fb="rm">
        <span>${esc(a.label)}</span>
      </button>`).join("")}</div>
    <div class="ag-foot panel-sub">点缩略图切换大图 · 左右按钮翻页</div>
    <div style="margin-top:12px"><button class="btn" style="width:100%" data-close>合 上</button></div>
  </div>`);
  agShow();
}

function agShow() {
  if (!agState) return;
  const n = agState.list.length;
  agState.idx = (agState.idx + n) % n;
  const a = agState.list[agState.idx];
  const img = $("#agBig");
  if (!img) return;
  img.src = a.src; img.alt = a.label;
  const nm = $("#agName"); if (nm) nm.textContent = a.label;
  const meta = $("#agMeta"); if (meta) meta.textContent = [a.ratio, a.use].filter(Boolean).join(" · ");
  document.querySelectorAll(".ag-thumb").forEach(b => b.classList.toggle("on", b.dataset.agsel === a.kind));
}

function agStep(d) {
  if (!agState) return;
  agState.idx += d;
  agShow();
}

/* 阅读页：bioRead 成功后整页替换卷目；「返 回」回卷目列表（可接着读下一段） */
function renderBioRead(id, r, mode) {
  const c = charById(id);
  if (!c || !r || !r.ok) return;
  const story = mode === "story";
  modal(`<div class="menu bio-modal bio-reading">
    <button class="iconbtn mclose" data-close>${I("close")}</button>
    <div class="bio-pass">
      <div class="bp-kicker">${story ? "经 历" : "传 记"} · ${esc(c.name)}</div>
      <div class="bp-title">${esc(r.title)}</div>
      <div class="bp-rule"></div>
      <div class="bp-text">${esc(r.text)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px">
      <button class="btn ghost" data-biback="${id}" data-bimode="${story ? "story" : "bio"}">返 回</button>
      <button class="btn" data-close>合 卷</button>
    </div>
  </div>`);
}

/* 名册 = 一座「工作台」，不是一叠面板。
 * 上一版把五格编队、筛选、角色网格、养成详情各包成一张带标题的面板卡，
 * 屏幕上一半面积是卡片留白与标题，真正要看的角色只缩在右上角一小格；
 * 五格编队点开养成要跳到另一屏（弹窗），回来还得重新找人。
 * 现在：顶上一条窄栏（编队五格 + 队伍数值 + 操作），下面三栏——
 *   左：筛选（竖排索引式）｜ 中：角色网格 ｜ 右：养成详情（原弹窗内容原样搬来）。
 * 选人、上阵、养成全在同一个视线范围内，不用来回切屏。
 */
let rosterTab = "grow";   // 旧入口兼容：养成/编队已合成一屏，页签不再出现
let rosterPage = 0;       // 名册角色网格分页（筛选变化回第 1 页）
/* 名册每页张数同样按「当前窗口真正铺得下的列×行」算（见 core.js gridCapacity）：
 * 名册是 左筛选 200 + 中网格 + 右详情 424 的三栏工作台，中间列宽/高度都随窗口变。
 * 固定 24 张在宽屏上两行就放完、底下大片空白还要硬分页（用户批注「都没占满，分什么页」），
 * 在矮窗口又会把一页挤出内滚动条。改成容量自适应后，只有角色多到一页真放不下才出现分页条。
 * 窄屏（≤1120）三栏堆叠成单列、整页回到文档流，退回固定的 24 张/页。 */
let rosterCapCache = 0;
function rosterPageCapacity() {
  /* 2026-10-31 用户口径：桌面上每页固定 20 个（不再按窗口容量无限放大）；
   * 非全屏 / 矮窗口降一档到 12 个，减轻渲染压力。网格随后按容器宽高铺满整片区域。 */
  return pageRenderCap("roster");
}

/* 图鉴 / 羁绊是从名册工作台点进来的「子页」：它们不再占顶栏一级导航，
 * 所以必须自带一条返回条 —— 否则进来之后顶栏没有任何一项是高亮的，
 * 玩家会以为卡在这两屏里出不去（这个反馈实际出现过）。 */
function subBack(title, to = "roster", toLabel = "名册") {
  return `<div class="subback">
    <button class="btn sm ghost" data-back="${to}">‹ 返回${toLabel}</button>
    <span class="subback-title">${esc(title)}</span>
  </div>`;
}
/* 筛选状态存 localStorage：养成是高频操作，切屏回来还要重新点一遍筛选很烦。
 * 这属于纯前端偏好，前后端都没有对应的存档字段。 */
const rfSave = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const rfLoad = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const RL_GRADES = ["diamond", "red", "gold", "purple", "blue", "green"];
let rosterGrade = rfLoad("rfGrade", "all");   // all | red | gold | purple | blue | green
let rosterElem = rfLoad("rfElem", "all");     // all | flame | verdant | tide | light | storm | dusk
let rosterPos = rfLoad("rfPos", "all");       // all | burst/cleave/... 通用角色定位
let rosterSort = rfLoad("rfSort", "smart");   // smart | power | level | star | rarity
if (rosterGrade !== "all" && !RL_GRADES.includes(rosterGrade)) rosterGrade = "all";
if (!["smart", "power", "level", "star", "rarity"].includes(rosterSort)) rosterSort = "smart";

/* —— 名册排序 ——
 * 智能（默认）：按「战力为主 + 稀有度/星级微调 + 出战中小幅加成」的综合分降序。
 * 战力用与右栏详情同一份 panelStats（charPower），所以卡面数字就是详情里的那份属性折算，
 * 不会出现「排序说强、点开属性很低」的错位。其余选项给玩家按单一维度翻看的自由。 */
const RARITY_RANK = { diamond: 6, red: 5, gold: 4, purple: 3, blue: 2, green: 1 };
function rosterSortList(list) {
  const arr = list.filter((id) => !!charById(id));   // 存档旧 id / 脏数据不进名册，防 undefined 崩页

  const rarity = (id) => RARITY_RANK[charById(id).rarity] || 0;
  const pw = (id) => charPower(id);
  const lv = (id) => S.owned[id]?.lv || 0;
  const star = (id) => S.owned[id]?.star || 0;
  if (rosterSort === "power") arr.sort((a, b) => pw(b) - pw(a) || rarity(b) - rarity(a) || lv(b) - lv(a));
  else if (rosterSort === "level") arr.sort((a, b) => lv(b) - lv(a) || pw(b) - pw(a));
  else if (rosterSort === "star") arr.sort((a, b) => star(b) - star(a) || pw(b) - pw(a));
  else if (rosterSort === "rarity") arr.sort((a, b) => rarity(b) - rarity(a) || pw(b) - pw(a));
  else {
    const smart = (id) => pw(id) + rarity(id) * 6 + star(id) * 2 + (S.team.includes(id) ? 30 : 0);
    arr.sort((a, b) => smart(b) - smart(a) || pw(b) - pw(a) || lv(b) - lv(a));
  }
  return arr;
}
const ROSTER_SORT_LABEL = { smart: "智能排序", power: "按战力", level: "按等级", star: "按星级", rarity: "按稀有度" };

/** 顶栏：五格编队 + 队伍数值 + 全局操作 */
function rosterHeader() {
  const team = S.team;
  const avg = team.length ? Math.round(team.reduce((a, id) => a + (S.owned[id]?.lv || 0), 0) / team.length) : 0;
  const bonds = activeBonds().length;
  return `<div class="rl-strip panel">
    <div class="rl-left">
      <div class="m"><span class="k">总战力</span><b class="v gold num">${fmt(teamPowerNow())}</b></div>
      <div class="m"><span class="k">平均等级</span><b class="v num">${team.length ? `Lv.${avg}` : "—"}</b></div>
      <div class="m"><span class="k">已成绊</span><b class="v num">${bonds ? `${bonds} 组` : "—"}</b></div>
    </div>
    <div class="rl-slots" data-team-list>
      <span class="rl-cap">出战 <b class="num">${team.length}</b>/5</span>
      <span class="rl-drag-hint" data-tip="拖动排序|按住下方角色卡左右拖动，调整出战顺序（第 1 位先手）">拖动排序</span>
      ${Array.from({ length: 5 }, (_, i) => {
        const id = team[i];
        if (!id) return `<div class="rl-slot empty" data-team-slot="${i}" data-tip="空 位|在下方点角色卡上的「上阵」">
          <span class="sx num">${i + 1}</span><span class="plus">＋</span></div>`;
        const c = charById(id), rc = RCOLOR(c.rarity);
        return `<div class="rl-slot ${id === rosterSel ? "on" : ""} ${c.rarity === "diamond" ? "r-diamond" : ""}" data-team-slot="${i}" data-team-id="${id}" style="border-color:${rc}66">
          ${c.rarity === "diamond" ? `<i class="dframe"></i><span class="dgem tl"></span><span class="dgem tr"></span><span class="dgem bl"></span><span class="dgem br"></span>` : ""}
          <span class="sx num">${i + 1}</span>
          <span class="rtag" style="color:${rc};border-color:${rc}">${RTAG(c.rarity)}</span>
          <span class="echip" style="background:${ECOLOR(c.element)}">${ELABEL(c.element)}</span>
          <button class="rl-face" data-rfocus="${id}" data-tip="${esc(c.name)}|点开养成 · 按住可拖动排序">
            ${artImg(id)}
            <span class="rl-lv num">Lv.${S.owned[id].lv}</span>
          </button>
          <button class="rl-off" data-uteam="${id}" data-tip="下阵|${esc(c.name)}">×</button>
        </div>`;
      }).join("")}
    </div>
    <div class="rl-acts">
      <button class="btn sm ghost" data-go="codex" data-tip="全角色图鉴|未结缘的以剪影显示，收集进度一目了然">${I("tome")} 图 鉴</button>
      <button class="btn sm primary" data-act="suggest" data-tip="一键推荐编队|按当前等级与六气自动配一队，可反复点换思路">${I("sparkle")} 一 键 推 荐</button>
      <button class="btn sm ghost" data-go="bondstory" data-tip="羁 绊|特定两人同队触发属性加成，这里看条件与羁绊剧情">${I("story")} 羁 绊</button>
    </div>
  </div>`;
}

/** 左栏：阶位 + 六气两段筛选，数字是「已拥有」而不是卡池总数 */
function rosterRail(ownedAll, shownN) {
  const nGrade = k => ownedAll.filter(id => charById(id).rarity === k).length;
  const nElem = k => ownedAll.filter(id => charById(id).element === k).length;
  const nPos = k => ownedAll.filter(id => charById(id).role === k).length;
  return `<aside class="rl-rail panel">
    <div class="rl-rail-hd"><span class="rl-cap">筛 选</span><span class="rl-num num">${shownN}/${ownedAll.length}</span></div>
    <div class="rl-rail-sec">
      <button class="rf ${rosterGrade === "all" ? "on" : ""}" data-rg="all">
        <span>全 部</span><span class="c num">${ownedAll.length}</span></button>
      ${RL_GRADES.map(k => `<button class="rf ${rosterGrade === k ? "on" : ""}" data-rg="${k}">
        <span style="color:${rosterGrade === k ? RCOLOR(k) : "inherit"}">${RTAG(k)} 阶</span>
        <span class="c num">${nGrade(k)}</span></button>`).join("")}
    </div>
    <div class="rl-rail-hd"><span class="rl-cap">定 位</span></div>
    <div class="rl-rail-sec tight">
      <button class="rf ${rosterPos === "all" ? "on" : ""}" data-rp="all"><span>全部定位</span><span class="c num">${ownedAll.length}</span></button>
      ${Object.entries(DATA.roles).map(([k, r]) => `<button class="rf ${rosterPos === k ? "on" : ""}" data-rp="${k}">
        <span style="flex:1;text-align:left">${esc(r.position || r.label)}</span>
        <span class="c num">${nPos(k)}</span></button>`).join("")}
    </div>
    <div class="rl-rail-hd"><span class="rl-cap">六 气</span></div>
    <div class="rl-rail-sec tight">
      <button class="rf ${rosterElem === "all" ? "on" : ""}" data-re="all"><span>全部六气</span><span class="c num">${ownedAll.length}</span></button>
      ${Object.keys(DATA.elements).map(k => `<button class="rf ${rosterElem === k ? "on" : ""}" data-re="${k}">
        <span class="dot" style="background:${ECOLOR(k)}"></span>
        <span style="flex:1;text-align:left">${ELABEL(k)}</span>
        <span class="c num">${nElem(k)}</span></button>`).join("")}
    </div>
    <div class="rl-rail-ft">
      <span class="panel-sub">在册 <b class="num">${ownedAll.length}</b> 张 · 图鉴 ${DATA.characters.length} 张</span>
    </div>
  </aside>`;
}

/** 详情面板属性区：数值由服务端 panelStatsOf 下发（与战斗引擎同一张表 + 装备/羁绊加成同通道）。 */
function panelStatsBlock(id) {
  const ps = (S.pstats || {})[id];
  if (!ps) return `<div class="panel-sub">属性加载中…</div>`;
  const cell = (k, lb, v) => `<div class="sg"><div class="k">${lb}</div><div class="v num">${v}</div></div>`;
  return `
    <div class="statgrid" style="grid-template-columns:repeat(4,1fr)">
      ${cell("hp", "生命", fmt(ps.hp))}
      ${cell("atk", "攻击", fmt(ps.atk))}
      ${cell("def", "物防", fmt(ps.def))}
      ${cell("mdef", "法防", fmt(ps.mdef))}
      ${cell("spd", "速度", fmt(ps.spd))}
      ${cell("crit", "暴击", `${Math.round(ps.crit * 1000) / 10}%`)}
      ${cell("erg", "怒气回复", `${ps.erg}/回合`)}
    </div>
    <div class="panel-sub" style="margin-top:6px;font-size:11px">已含缘器与羁绊加成 · 怒气回复决定终结技频率（攒满 100 点开大）</div>`;
}

/** 右栏：该角色的全部养成操作（自旧养成弹窗原样搬来，数值口径未改） */
function fatePanelHtml(id, so) {
  const doc = DATA.fate || {};
  const sel = charById(id);
  if (!sel) return "";
  // 2026-11-05 三次修订：天赋强度按角色阶级缩放——优先取服务端按 rarity 预缩放的模板，
  // 老数据没有 templatesByRarity 时回退原始模板（金阶=1.00 基准，不改变旧存档观感）。
  const byRarity = doc.templatesByRarity || {};
  const tpl = (byRarity[sel.rarity] || doc.templates || {})[sel.role] || (byRarity[sel.rarity] || doc.templates || {}).burst;
  if (!tpl) return "";
  const scale = Number((doc.tierScale || {})[sel.rarity]) || 1;
  const TIER_CN = { diamond: "晶钻", red: "红", gold: "金", purple: "紫", blue: "蓝", green: "绿" };
  const tierCn = TIER_CN[sel.rarity] || RTAG(sel.rarity);
  const cur = Math.max(0, Math.min(6, so.fate || 0));
  const rows = (tpl.levels || []).map((lv, i) => {
    const n = i + 1;
    const col = (doc.colors || []).find(c => Number(c.fate) === n) || {};
    const active = n <= cur;
    const fx = [];
    // 机制型效果（2026-11-05）：优先展示，属性只作辅料——「减速/易伤/护盾/追击」比一串 +x% 更有记忆点。
    if (lv.desc) fx.push(lv.desc);
    const fmt = (obj) => Object.entries(obj || {}).map(([k, v]) => k === "crit" ? `暴击 +${Math.round(v * 1000) / 10}%` : `${({ hp: "生命", atk: "攻击", def: "防御", mdef: "法防", spd: "速度", erg: "怒气回复" })[k] || k} +${Math.round((v - 1) * 100)}%`).join(" · ");
    const selfTxt = fmt(lv.self), teamTxt = fmt(lv.team);
    if (selfTxt) fx.push(`自身：${selfTxt}`);
    if (teamTxt) fx.push(`全队：${teamTxt}`);
    return `<div class="fate-row ${active ? "on" : ""}" style="--fc:${col.color || "#666"}">
      <span class="fate-n">${n}缘</span>
      <span class="fate-name">${esc(lv.name || "")}</span>
      <span class="fate-fx">${fx.map(esc).join(" ｜ ") || "—"}</span>
      ${active ? `<span class="fate-on">已得</span>` : n === cur + 1 ? `<span class="fate-next">下一缘</span>` : ""}
    </div>`;
  }).join("");
  const summary = cur > 0 ? (tpl.levels || []).slice(0, cur).map(l => l.desc).filter(Boolean) : [];
  return `<div class="gd-sec fate-sec">
    <div class="panel-title" style="font-size:14px">${I("star", "width:13px;height:13px;vertical-align:-2px")} 缘 · 专属天赋链 <span class="panel-sub" style="font-weight:400;letter-spacing:0;margin-left:6px">${tpl.title || ""} · 重复抽取或定向残卷提升（最高 6 缘）</span></div>
    <div class="panel-sub fate-tierline" style="margin:4px 0 2px;font-size:11px"><span style="color:${RCOLOR(sel.rarity)};font-weight:600">${tierCn}阶天赋</span> · 强度 ×${scale.toFixed(2)}（同缘谱按角色阶级缩放，金阶基准 1.00）</div>
    ${summary.length ? `<div class="panel-sub" style="margin:4px 0 6px;font-size:11px;color:var(--gold)">当前累计：${summary.map(esc).join(" · ")}</div>` : ""}
    <div class="fate-list">${rows}</div>
  </div>`;
}


/* ==========================================================================
   名册右栏 · 人物档案卡（2026-11-05 重做）
   --------------------------------------------------------------------------
   旧版把立绘、战力图、天赋链、突破、属性、技能、缘器、羁绊全塞进一条 424px
   窄栏里，一屏看下来要滚很久。新版按「先认识人，再看细节」分三层：
     1) 顶部身份区：立绘 + 名字/称号/阶位 + 四项速览（战力/等级/星级/缘）
     2) 六个分页签：概览 / 养成 / 天赋 / 技能 / 缘器 / 羁绊 —— 一次只显示一组
     3) 底部常驻操作条：升级（含下一级消耗）/ 升星 / 突破 —— 最常用的养成不用翻页签
   页签状态存在 rosterDTab 里，切角色时保持当前页签（方便横向比较技能/缘器）。
   ========================================================================== */
let rosterDTab = "overview";
const RD_TABS = [["overview", "概览"], ["grow", "养成"], ["fate", "天赋"], ["skills", "技能"], ["equip", "缘器"], ["bonds", "羁绊"]];

/** 突破需求行：名称 + 现有/需要 + 进度条（够=绿、不够=橙） */
function rdReqRow(label, have, need, ok) {
  const pct = need > 0 ? Math.min(100, Math.round(have / need * 100)) : 100;
  return `<div class="rd-req ${ok ? "ok" : "no"}">
    <span class="rk">${esc(label)}</span>
    <span class="rbar"><i style="width:${pct}%"></i></span>
    <span class="rv">${have}<em> / ${need}</em></span>
  </div>`;
}

/** 名册详情页签内容：每次切换只重渲染这一块，避免整屏重绘 */
function rosterDetailBody(id) {
  const sel = charById(id);
  const so = S.owned[id];
  if (!sel || !so) return `<div class="panel-sub">这一位还没结缘。</div>`;
  const rc = RCOLOR(sel.rarity);
  const gates = DATA.progression?.breakthroughs || [];
  const gate = gates[so.bt] || null;
  const bt = btStatus(id);
  const coinHave = S.wallet?.coin || 0;
  const teamLvs = (S.team || []).map(tid => S.owned[tid]?.lv || 0).sort((a, b) => b - a);
  const resoLv = teamLvs.length >= 5 ? teamLvs[4] : null;
  const bond = (xpBondCache && xpBondCache[id]) || (S.bonds && S.bonds[id]) || { lv: 0, v: 0 };
  const relBonds = (DATA.bonds || []).filter(b => (b.members || []).includes(id));

  if (rosterDTab === "grow") {
    return `
      <div class="rd-sec">
        <div class="rd-sec-hd"><span class="panel-title">突 破</span><span class="panel-sub">${gate ? `下一阶 · ${so.bt + 1} 阶` : "已达最高突破阶"}</span></div>
        ${gate ? `<div class="rd-gatelist">
          ${rdReqRow("等级", `Lv.${so.lv}`, `Lv.${gate.atLevel}`, so.lv >= gate.atLevel)}
          ${rdReqRow("星级", `★${so.star}`, `★${gate.starMin}`, so.star >= gate.starMin)}
          ${bt.rows.map(r => rdReqRow(r.label, r.have, r.need, r.short === 0)).join("")}
          ${rdReqRow("铜钱", fmt(coinHave), fmt(gate.coin), coinHave >= gate.coin)}
        </div>
        <div class="rd-tip ${bt.ok ? "ok" : ""}">${bt.ok ? "条件已满足，可直接突破（按钮在下方操作条）" : `还差：${esc(bt.lock)}`}</div>`
        : `<div class="gd-gate"><span class="ok">已达最高突破阶</span></div>`}
      </div>
      <div class="rd-sec">
        <div class="rd-sec-hd"><span class="panel-title">其 他</span><span class="panel-sub">归一保留技能 / 命格 / 心法 / 觉醒</span></div>
        <div class="rd-other">${normalizeButtonHtml(id)}<button class="btn ghost" data-open="${id}">完整卡面</button></div>
      </div>`;
  }
  if (rosterDTab === "fate") return fatePanelHtml(id, so);
  if (rosterDTab === "skills") {
    return `<div class="rd-sec">
      <div class="rd-sec-hd"><span class="panel-title">技 能</span><span class="panel-sub">悬停技能卡可看数值 · 点击彩色词看说明</span></div>
      ${sel.skills.slice(0, 4).map(sk => `
        <div class="skill-item"><div class="sh">
          <span class="slotchip" style="background:${SLOT_COLOR[sk.slot] || "#888"}">${SLOT_NAME[sk.slot] || sk.slot}</span>
          <span class="sn">${esc(sk.name)}</span>
          <span class="panel-sub num" style="margin-left:auto">Lv.${so.skills[sk.slot] || 1}</span>
          ${sk.slot !== "attack" ? `<button class="btn sm ghost" data-skill="${sk.slot}" data-for="${id}" data-tip="升级 ${esc(sk.name)}|消耗铜钱提升技能效果，等级上限随星级" style="padding:2px 10px">升级</button>` : ""}
        </div>
        <div class="sd">${skillDesc(sk.desc) || "——"}</div></div>`).join("")}
    </div>`;
  }
  if (rosterDTab === "equip") {
    return `<div class="rd-sec"><div id="loadoutBox" data-for="${id}" style="display:grid;gap:8px">
      <div class="panel-sub" style="font-size:11px">加载中…</div>
    </div></div>`;
  }
  if (rosterDTab === "bonds") {
    return `<div class="rd-sec">
      <div class="rd-sec-hd"><span class="panel-title">羁 绊</span><span class="panel-sub">同一编队两人即成绊</span></div>
      ${relBonds.length ? relBonds.map(b => {
        const members = (b.members || []).map(m => charById(m)).filter(Boolean);
        const onN = (b.members || []).filter(m => S.team.includes(m)).length;
        return `<div class="rd-bond ${onN >= 2 ? "on" : ""}" data-bond="${esc(b.id)}" data-tip="${esc(b.name)}|${esc(b.effect)}|点击查看羁绊详情" style="cursor:pointer">
          <div class="rb-hd"><span>${esc(b.name)}</span><span style="color:${onN >= 2 ? "var(--green,#6fd18f)" : "var(--faint)"}">${onN >= 2 ? "已成绊" : `${onN}/2`}</span></div>
          <div class="rb-eff">${esc(b.effect || "")}</div>
          <div class="rb-mem">${members.map(m => `<span class="${S.team.includes(m.id) ? "on" : ""}">${esc(m.name)}</span>`).join("")}</div>
        </div>`;
      }).join("") : `<div class="panel-sub">暂无羁绊</div>`}
    </div>`;
  }
  /* 概览：属性 + 状态（突破明细放「养成」页签，避免一屏塞太满） */
  return `
    <div class="rd-sec">
      <div class="rd-sec-hd"><span class="panel-title">属 性</span><span class="panel-sub">含缘器与羁绊加成</span></div>
      ${panelStatsBlock(id)}
    </div>
    <div class="rd-sec">
      <div class="rd-sec-hd"><span class="panel-title">状 态</span><span class="panel-sub">${gate ? `下一阶 ${so.bt + 1} 阶 · ${bt.ok ? "条件已满足" : esc(bt.lock)}` : "已达最高突破阶"}</span></div>
      <div class="xp-rmeta">
        ${resoLv != null ? `<span class="xp-reso" data-tip="共 鸣|战斗中全队生效等级取编队第 5 高等级（服务端已计入），当前共鸣 Lv.${resoLv}">${I("resonance", "width:13px;height:13px")} 共鸣 <b class="num">Lv.${resoLv}</b></span>` : ""}
        <span class="xp-bond" data-tip="缘 值|来访打招呼等互动积攒，10 点进 1 级（上限 10 级）；缘值提供攻击加成，5 级解锁合击强化">
          ${I("bondlv", "width:13px;height:13px")} 缘值 <b class="num">Lv.${bond.lv}</b>
          <span class="xp-bbar"><i style="width:${bond.lv >= 10 ? 100 : Math.min(100, bond.v * 10)}%"></i></span>
          <span class="v num">${bond.lv >= 10 ? "MAX" : `${bond.v}/10`}</span>
        </span>
      </div>
    </div>
  `;
}

/** 名册右栏：人物档案卡（顶部身份区 + 分页签 + 常驻操作条） */
function rosterDetail(id) {
  const sel = charById(id);
  const so = S.owned[id];
  if (!sel || !so) return `<section class="rl-detail panel"><div class="panel-sub" style="padding:20px">这一位还没结缘。</div></section>`;
  const rc = RCOLOR(sel.rarity);
  const gates = DATA.progression?.breakthroughs || [];
  const gate = gates[so.bt] || null;
  const bt = btStatus(id);
  const maxLv = bt.maxLv;
  const inTeam = S.team.includes(id);
  const starTable = DATA.progression?.starCost?.[sel.rarity] || [];
  const starCost = starTable[so.star - 1] || null;
  const scrollNeed = starCost ? (starCost.toStar - 1) : 0;
  const scrollHave = (S.wallet?.starScroll || {})[sel.rarity] || 0;
  const scrollLabel = (DATA.fate?.starScrolls?.[sel.rarity] || {}).label || "升星卷";
  const coinHave = S.wallet?.coin || 0;
  const starLock = !starCost ? "已满星"
    : scrollHave < scrollNeed ? `缺 ${scrollLabel} ${scrollNeed - scrollHave}`
      : coinHave < starCost.coin ? "缺铜钱" : "";
  const starTip = !starCost ? "已满星"
    : `升 ★${starCost.toStar}：${scrollLabel} ${scrollHave}/${scrollNeed} · 铜钱 ${fmt(starCost.coin)}`;
  const btLock = bt.lock;
  const fateColor = (DATA.fate?.colors?.find(x => Number(x.fate) === (so.fate || 0)) || {}).color || "var(--faint)";
  return `<section class="rl-detail panel" data-char="${id}">
    <div class="rd-hero">
      <div class="rd-hero-bg" aria-hidden="true">${artImg(id, "portrait")}</div>
      <div class="rd-hero-in">
        <div class="rd-portrait">
          ${artImg(id, "portrait")}
          <span class="rtag" style="position:absolute;top:5px;left:5px;color:${rc};border-color:${rc}">${RTAG(sel.rarity)}</span>
          ${inTeam ? `<span class="gtag">出战</span>` : ""}
        </div>
        <div class="rd-id">
          <div class="rd-name-row">
            <div class="gd-name rd-name ${S.awaken && S.awaken[id] ? "awakened-name" : ""}">${esc(sel.name)}</div>
            <button class="rl-team rd-team ${inTeam ? "off" : ""}" ${inTeam ? `data-uteam="${id}"` : `data-tteam="${id}"`}
              data-tip="${inTeam ? "下 阵|把她移出出战编队，空位可再上阵他人" : "上 阵|编入出战编队（最多 5 人），战斗按编队出击"}">
              ${inTeam ? "下 阵" : "上 阵"}</button>
          </div>
          <div class="rd-sub">${esc(sel.title || FLABEL(sel.faction))}</div>
          <div class="rd-basic">
            <span style="color:${rc};border-color:${rc}66">${RTAG(sel.rarity)}</span>
            <span style="color:${ECOLOR(sel.element)};border-color:${ECOLOR(sel.element)}44">${ELABEL(sel.element)}</span>
            <span>${RLABEL(sel.role)}</span>
            <span class="poschip" data-tip="角色定位|${esc(RPOS(sel.role))} · ${esc((DATA.roles[sel.role] || {}).tagline || "")}">${esc(RPOS(sel.role))}</span>
            <span>${so.bt} 阶</span>
          </div>
        </div>
      </div>
      <div class="rd-quick">
        <div class="rq main"><span>战 力</span><b class="num">${fmt(charPower(id))}</b></div>
        <div class="rq"><span>等 级</span><b class="num">Lv.${so.lv}<i>/${maxLv}</i></b></div>
        <div class="rq"><span>星 级</span><b class="num"${starChipStyle(so.star, DATA.rarities[sel.rarity].starCap)}>★${so.star}</b></div>
        <div class="rq"><span>缘</span><b class="num" style="color:${fateColor}">${so.fate || 0}<i>/6</i></b></div>
      </div>
      <div class="rl-mini-acts rd-hero-acts">
        <button class="rl-mini" data-chstory="${id}" data-tip="经 历|角色的来历与三段传记，缘值越深看得越多">${I("scroll", "width:12px;height:12px;vertical-align:-2px")} 经 历</button>
        <button class="rl-mini" data-cvoice="${id}" data-tip="语 音|查看该角色的全部台词，点「播放」即可试听">${I("story", "width:12px;height:12px;vertical-align:-2px")} 语 音</button>
        <button class="rl-mini" data-carts="${id}" data-tip="立 绘|查看该角色的全部立绘（全身 / 卡面 / 大招 / 抠图 / 动态 / 头像 / 缘器）">${I("gem", "width:12px;height:12px;vertical-align:-2px")} 立 绘</button>
      </div>
    </div>
    <div class="rd-tabs">
      ${RD_TABS.map(([k, label]) => `<button class="rd-tab ${rosterDTab === k ? "on" : ""}" data-rdtab="${k}">${label}</button>`).join("")}
    </div>
    <div class="rd-body">${rosterDetailBody(id)}</div>
    <div class="rd-foot">
      ${upgradeButtonHtml(id)}
      <div class="rd-foot-row">
        <button class="btn" data-starup="${id}" ${starLock ? "disabled" : ""} title="${esc(starTip)}">
          <span class="fmain">${I("gem")} 升 星</span>
          <span class="fcost">${starLock || `${fmt(starCost.coin)} 铜钱`}</span>
        </button>
        <button class="btn" data-break="${id}" ${btLock ? "disabled" : ""} data-tip="${esc(bt.tip)}">
          <span class="fmain">${I("shield")} 突 破</span>
          <span class="fcost">${btLock || `至 ${so.bt + 1} 阶`}</span>
        </button>
      </div>
    </div>
  </section>`;
}

function renderRoster() {
  const ownedAll = rosterSortList(Object.keys(S.owned));
  const list = ownedAll.filter(id => (rosterGrade === "all" || charById(id).rarity === rosterGrade)
    && (rosterElem === "all" || charById(id).element === rosterElem)
    && (rosterPos === "all" || charById(id).role === rosterPos));
  const rosterPageSize = rosterPageCapacity();
  const rosterPages = Math.max(1, Math.ceil(list.length / rosterPageSize));
  if (!Number.isFinite(rosterPage) || rosterPage < 0) rosterPage = 0;
  if (rosterPage > rosterPages - 1) rosterPage = rosterPages - 1;
  const pageList = list.slice(rosterPage * rosterPageSize, (rosterPage + 1) * rosterPageSize);
  if (!rosterSel || !S.owned[rosterSel]) rosterSel = S.team[0] || ownedAll[0] || null;
  // 筛选把当前选中的人滤掉时，右栏跟着切到结果里的第一位，
  // 否则会出现"左栏写着 UR 阶、右栏却在讲一个 SSR"的错位。
  if (rosterSel && list.length && !list.includes(rosterSel)) rosterSel = list[0];
  const bench = ownedAll.length - S.team.length;

  // 整屏 innerHTML 重绘会把窗口滚动位置打断归零（宽屏锁定布局滚不动没感觉，
  // 窄屏/小窗口下点下方卡片就表现成"被弹回最上面"），先接住再原样还回去。
  // roster-mode 下 .rl-rail/.rl-main/.rl-side 是三个独立滚动的容器，重建后
  // scrollTop 同样归零——名册里点一张卡整屏重绘，列表就"跳回最上面"，一起接住。
  const winY = scrollY;
  const keep = [".rl-rail", ".rl-main", ".rl-side"].map(sel => {
    const el = $("#scr-roster " + sel);
    return { sel, y: el ? el.scrollTop : 0 };
  });
  $("#scr-roster").innerHTML = `
    ${rosterHeader()}
    <div class="rl-body">
      ${rosterRail(ownedAll, list.length)}
      <div class="rl-main">
        <div class="rl-main-hd">
          <div style="display:flex;align-items:baseline;gap:10px">
            <div class="panel-title" style="font-size:15px">全 部 角 色</div>
            <button class="rl-sortbtn" data-rsort="next" data-tip="排序方式|智能：出战优先，再按战力/稀有度/等级综合排；点击切换其他排序">
              ${I("sort", "width:11px;height:11px;vertical-align:-1px")} ${ROSTER_SORT_LABEL[rosterSort] || "智能排序"}
            </button>
          </div>
          <span class="panel-sub">点卡片看养成 · 卡片下方按钮上阵／下阵 · 候补 ${bench} 张</span>
        </div>
        <div class="rl-grid">
          ${pageList.map(id => {
            const on = S.team.includes(id);
            return `<div class="rl-cell ${id === rosterSel ? "sel" : ""}" data-rfocus="${id}">
              ${charCard(id, { showTeam: true })}
              <button class="btn sm ${on ? "danger" : "primary"} rl-tbtn" data-${on ? "uteam" : "tteam"}="${id}">${on ? "下 阵" : "上 阵"}</button>
            </div>`;
          }).join("") || `<div class="rl-empty panel-sub">这一组筛选下还没有角色 —— 换个阶位或六气试试。</div>`}
        </div>
        ${pagerBar("rs", rosterPage, rosterPages,
          `第 <b class="num">${rosterPage + 1}</b> / ${rosterPages} 页 · 本页 ${rosterPage * rosterPageSize + 1}-${Math.min(list.length, (rosterPage + 1) * rosterPageSize)} 张 · 共 ${list.length} 张`)}
      </div>
      <div class="rl-side">
        ${rosterSel ? rosterDetail(rosterSel) : `<section class="rl-detail panel"><div class="panel-sub">还没有可选角色。</div></section>`}
      </div>
    </div>`;
  if (winY) scrollTo({ top: winY });
  for (const k of keep) {
    const el = $("#scr-roster " + k.sel);
    if (el && k.y) el.scrollTop = k.y;
  }
  // 首帧后按共享卡尺寸铺满：名册列×行由图鉴同款卡宽推得，卡片像素尺寸与图鉴一致。
  requestAnimationFrame(() => {
    if (cur !== "roster") return;
    const grid = $("#scr-roster .rl-grid");
    if (grid) {
      const r = rosterMetrics();
      applyFixedGrid(grid, { cols: r.cols, rows: r.rows, cardW: r.cardW, cardH: r.cardH, cellExtraH: r.btnH, gap: r.gap });
    }
  });
  // 缘器信息是异步拉的，DOM 进页面后可直接填充
  if (rosterSel) refreshLoadout(rosterSel);
  xpHydrateBonds();  // 缘值数据缺位时借一次 visit 响应回填（每会话至多一发）
}

/** 编队页签已合并进名册：保留入口以兼容老路由，实际渲染同一屏 */
function renderTeamPane() { return renderRoster(); }

async function refreshLoadout(id) {
  const box = $("#loadoutBox");
  if (!box) return;
  const j = await api({ type: "loadout", id }).catch(() => null);
  // 用弹窗自身记录的目标角色校验，不要依赖 rosterSel：
  // 养成弹窗可独立打开，rosterSel 未必等于这里要渲染的角色。
  if (!j || !box.isConnected || box.dataset.for !== id) return;
  const lo = j.loadout;
  // 觉醒清单的「本命圆满」要看专属缘器等级：loadout 到手即回填缓存，并就地刷新弹窗里的勾叉
  awBenmingLv[id] = lo.exclusiveInfo && lo.exclusiveInfo.forged ? (lo.exclusiveInfo.level || 0) : 0;
  const awW = document.querySelector(`#awBox[data-for="${id}"] .aw-step[data-stepkey="weapon"]`);
  if (awW) {
    const ok = (awBenmingLv[id] || 0) >= 15;
    awW.classList.toggle("ok", ok); awW.classList.toggle("no", !ok);
    const ck = awW.querySelector(".aw-ck");
    if (ck) ck.textContent = ok ? "✓" : "✗";
  }
  const slotCell = (kind, label) => {
    const it = lo[kind];
    // 空槽位原先只有 data-tip，点了没有任何动作 —— 玩家看到的就是"闪一下没反应"。
    // 现在给它一个明确的点击目标：引导到下方开匣按钮。
    if (!it) return `<div class="eqslot empty" data-eqempty="${kind}" data-tip="${label}|点击只查看这一类缘器，选一件穿上" style="cursor:pointer">
      <div class="eqi">${I({ weapon: "sword", artifact: "essence", talisman: "knot", attire: "shield" }[kind] || "circle")}</div>
      <div class="eqm">${label}</div></div>`;
    const rc = RCOLOR(it.rarity);
    // 已穿戴：整格点击＝强化（升级是这里最常用的操作），卸下收进右上角小按钮，
    // 避免"点一下就脱掉"这种误触。
    return `<div class="eqslot has" data-eqid="${it.uid}" data-tip="${esc(it.desc)}|点击打开强化确认 · 右上角可卸下" style="border-color:${rc}66">
      <img class="eqi" src="${it.icon}" alt="" data-fb="rm">
      <div class="eqm" style="color:${rc}">${esc(it.name || label)}</div>
      <div class="eqm" style="color:var(--faint);font-size:10px">${label} · Lv.${it.level}${it.bt ? ` · 突破${it.bt}阶` : ""}</div>
      <button class="eqoff" data-uneq="${kind}" title="卸下">×</button></div>`;
  };
  const ex = lo.exclusiveInfo;
  const exCell = ex.forged
    ? `<div class="eqslot excl" data-tip="${esc(ex.desc)}|缘 ${ex.fate || 0}/6 · 点击打开强化确认（内含「本命升缘」）${(ex.fate || 0) < 6 ? ` · 满级后用铸魂券突破升缘` : ""}" data-exup="1" style="border-color:var(--gold)88;cursor:pointer">
        <img class="eqi" src="${ex.icon}" alt="" data-fb="rm">
        <div class="eqm" style="color:var(--gold)">专属 · ${ex.fate || 0}缘 · Lv.${ex.level}/${ex.levelCap || 15}</div>
        ${(ex.fate || 0) < 6 && ex.level >= (ex.levelCap || 15) ? `<button class="eqoff" data-exfatebt="${ex.uid}" title="铸魂券突破升缘">缘</button>` : ""}</div>`
    : `<div class="eqslot excl" data-tip="专属缘器|${ex.forgeable
        ? (ex.tickets >= ex.ticketCost ? `铸魂券已集齐 · 点击铸魂（需铜钱 ${fmt(ex.cost)}）` : `铸魂需 ${ex.ticketCost} 张本命铸魂券（缘器阁·本命签可攒，当前 ${ex.tickets}/${ex.ticketCost}）+ 铜钱 ${fmt(ex.cost)}`)
        : `突破 ${ex.unlockBt} 阶后开放铸魂（需 ${ex.ticketCost} 张铸魂券 + 铜钱 ${fmt(ex.cost)}）`}" ${ex.forgeable ? 'data-forge="1" style="cursor:pointer"' : ''}>
        <div class="eqi" style="display:grid;place-items:center;color:var(--faint)">${I(ex.forgeable ? "sparkle" : "lock")}</div>
        <div class="eqm">${ex.forgeable ? "铸 魂" : `未 铸 魂`}</div></div>`;
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="panel-title" style="font-size:14px">${I("gem", "width:13px;height:13px;vertical-align:-2px")} 缘 器</div>
      <div style="display:flex;gap:6px">
        <button class="btn sm ghost" data-eqbag="1" data-tip="缘器背包|未穿戴的缘器都在这里，可穿戴/强化/分解">${I("gem", "width:13px;height:13px;vertical-align:-2px")} 背包</button>
        <button class="btn sm ghost" data-eqcodex="1" data-tip="缘器图鉴|普通 20 款 + 各角色本命，收集进度">${I("tome", "width:13px;height:13px;vertical-align:-2px")} 图鉴</button>
      </div>
    </div>
    <div class="eqgrid">
      ${slotCell("weapon", "兵刃")}${slotCell("artifact", "法宝")}${slotCell("talisman", "灵饰")}${slotCell("attire", "道袍")}${exCell}
    </div>
    ${ex.exclusiveInfo && ex.exclusiveInfo.skill && ex.exclusiveInfo.forged ? `
      <div class="exskill" data-tip="${esc(ex.exclusiveInfo.skill.desc)}">
        <div class="exs-hd">${I("sparkle", "width:12px;height:12px;vertical-align:-2px")} 专属技能 · ${esc(ex.exclusiveInfo.skill.name || "本命")}</div>
        <div class="exs-d">${skillDesc(ex.exclusiveInfo.skill.desc)}</div>
      </div>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn sm primary" data-go="eforge" data-tip="缘器阁|开匣抽缘器，攒本命铸魂券">${I("gem")} 缘器阁 · 开匣抽缘器</button>
      <button class="btn sm ghost" data-eqbag="1" data-tip="行囊·缘器页签|管理全部缘器：穿戴/强化/一键分解">${I("pouch")} 行囊 · 缘器管理</button>
    </div>`;
}

/* ---------------- 缘器图鉴 ---------------- */

async function openEquipCodex(tab) {
  const j = await api({ type: "equipCodex" }).catch(() => null);
  if (!j || !j.equipCodex) { toast("图鉴加载失败"); return; }
  const cx = j.equipCodex;
  const view = tab || "normal";
  const list = view === "normal" ? cx.normal : cx.exclusive;

  const cell = (it) => `
    <div class="cdxcell ${it.owned ? "" : "miss"}" data-tip="${esc(it.name)}|${it.owned ? "已获得" : "未获得"}">
      ${it.owned
        ? `<img src="${esc(it.icon)}" alt="" data-fb="rm">`
        : `<div class="cdxq">？</div>`}
      <div class="cdxn" style="${it.owned ? `color:${RCOLOR(it.rarity)}` : ""}">${esc(it.name)}</div>
      <div class="cdxs">${esc(it.kindLabel)}${it.charName ? "" : " · " + RTAG(it.rarity)}</div>
    </div>`;

  modal(`<div class="menu" style="width:860px;max-height:80vh;display:flex;flex-direction:column">
    <div class="panel-title" style="text-align:center">缘 器 图 鉴</div>
    <div class="panel-sub" style="text-align:center;margin-top:6px">
      已收集 <b class="num" style="color:var(--gold)">${cx.stats.owned}</b> / ${cx.stats.total}
      · 普通 ${cx.stats.normalOwned}/${cx.stats.normalTotal}
      · 专属 ${cx.stats.exOwned}/${cx.stats.exTotal}
    </div>
    <div class="chipwrap" style="justify-content:center;margin-top:12px">
      <button class="fchip ${view === "normal" ? "on" : ""}" data-cdxtab="normal">普通缘器<span class="cnt num">${cx.stats.normalOwned}/${cx.stats.normalTotal}</span></button>
      <button class="fchip ${view === "exclusive" ? "on" : ""}" data-cdxtab="exclusive">专属缘器<span class="cnt num">${cx.stats.exOwned}/${cx.stats.exTotal}</span></button>
    </div>
    <div class="cdxgrid" style="overflow:auto;margin-top:14px;flex:1">
      ${list.map(cell).join("")}
    </div>
    <div style="margin-top:14px"><button class="btn" style="width:100%" data-close>关 闭</button></div>
  </div>`, { dimClose: true });
}

/** 背包：列出全部缘器，点一件就装到当前角色身上。
 *  kind 传入部位（weapon/artifact/talisman/attire/exclusive）时只列该部位——
 *  从养成面板的「法宝」「灵饰」等槽位点进来，看到的就是这一类，不用在整包里翻。 */
let eqBagKind = "all";           // 背包弹窗当前部位筛选（跨重开保留）
async function openEquipBag(charId, kind) {
  const j = await api({ type: "bag" }).catch(() => null);
  if (!j || !j.bag) { toast("背包加载失败"); return; }
  const items = j.bag;
  const char = charById(charId) || {};
  const KIND_LABEL = { weapon: "兵刃", artifact: "法宝", talisman: "灵饰", attire: "道袍", exclusive: "专属" };
  if (kind !== undefined) eqBagKind = kind || "all";
  const curKind = KIND_LABEL[eqBagKind] ? eqBagKind : "all";
  // 三组分开 + 组内按品阶（红>金>紫>蓝>绿）再按等级排，别把"未装备"和"他人身上"混在一起
  const RANK = { red: 0, gold: 1, purple: 2, blue: 3, green: 4 };
  const byTier = (a, b) => ((RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9)) || ((b.level || 0) - (a.level || 0));
  const kindItems = curKind === "all" ? items : items.filter((it) => it.kind === curKind);
  const worn = kindItems.filter((it) => it.equippedBy === charId).sort(byTier);
  const free = kindItems.filter((it) => !it.equippedBy).sort(byTier);
  const othersWorn = kindItems.filter((it) => it.equippedBy && it.equippedBy !== charId).sort(byTier);
  const kindName = curKind === "all" ? "" : KIND_LABEL[curKind];

  const rowHtml = (it) => {
    const rc = RCOLOR(it.rarity);
    const owner = it.equippedBy ? (charById(it.equippedBy) || {}).name || it.equippedBy : "";
    // 三态配色：自己身上的灰标「已装备」；别人身上的「换装」用描边款（会扒下来，非主行动）；
    // 未穿戴的「装备」金色主按钮 —— 金色=一键穿上，描边=需要换下别人的，一眼可分。
    const use = it.equippedBy === charId ? `<span class="tag dim">已装备</span>`
      : it.equippedBy ? `<button class="btn sm ghost" data-eqwear="${it.uid}" data-eqchar="${charId}"
           data-tip="换装|将从 ${esc(owner)} 身上换下" ${it.exclusive && it.exclusiveFor !== charId ? "disabled" : ""}>换 装</button>`
      : `<button class="btn sm ${it.exclusive ? "" : "primary"}" data-eqwear="${it.uid}" data-eqchar="${charId}"
           ${it.exclusive && it.exclusiveFor !== charId ? "disabled" : ""}>装 备</button>`;
    return `<div class="bagrow" style="border-color:${rc}44">
      <img class="bagic" src="${esc(it.icon)}" alt="" data-fb="rm">
      <div class="bagmain">
        <div class="bagt" style="color:${rc}">${esc(it.name || (KIND_LABEL[it.kind] || it.kind))}${it.level ? ` <span style="color:var(--faint);font-weight:400">Lv.${it.level}</span>` : ""}</div>
        <div class="bagd">${KIND_LABEL[it.kind] || it.kind} · ${RTAG(it.rarity)}${it.main ? " · 主属性 " + it.main : ""}</div>
        <div class="bagd">${esc((it.desc || "").split("：")[1] || it.desc || "")}</div>
        ${it.skill ? `<div class="bagsk">${I("sparkle", "width:11px;height:11px;vertical-align:-1px")} ${esc(it.skill.name)}：${skillDesc(it.skill.desc)}</div>` : ""}
        ${owner && it.equippedBy !== charId ? `<div class="bagd" style="color:var(--faint)">在 ${esc(owner)} 身上</div>` : ""}
      </div>
      <div class="bagops">${use}</div>
    </div>`;
  };

  const filters = [["all", "全部"], ["weapon", "兵刃"], ["artifact", "法宝"], ["talisman", "灵饰"], ["attire", "道袍"], ["exclusive", "专属"]];
  modal(`<div class="menu" id="eqBagMenu" data-eqbagcur="${esc(charId || "")}" data-eqbagkind="${curKind}" style="width:640px;max-height:76vh;display:flex;flex-direction:column">
    <div class="panel-title" style="text-align:center">缘 器 背 包</div>
    <div class="panel-sub" style="text-align:center;margin-top:6px">
      共 ${items.length} 件${kindName ? ` · 只看 <b style="color:var(--gold)">${kindName}</b>（${kindItems.length} 件）` : ""} · 正在为 <b style="color:var(--gold)">${esc(char.name || "")}</b> 穿戴
    </div>
    <div class="chipwrap" style="justify-content:center;margin-top:10px">
      ${filters.map(([k, l]) => `<button class="fchip ${curKind === k ? "on" : ""}" data-eqbagfilter="${k}">${l}</button>`).join("")}
    </div>
    <div style="overflow:auto;margin-top:14px;flex:1">
      ${worn.length ? `<div class="bagsec">${esc(char.name || "")} 身上 · ${worn.length} 件</div>${worn.map(rowHtml).join("")}` : ""}
      <div class="bagsec">未装备 · ${free.length} 件</div>
      ${free.length ? free.map(rowHtml).join("") : `<div class="panel-sub" style="padding:10px 0">${kindName ? `还没有闲置的${kindName}缘器，去缘器阁开匣吧。` : "还没有闲置的缘器，去开缘器匣吧。"}</div>`}
      ${othersWorn.length ? `<div class="bagsec">他人身上 · ${othersWorn.length} 件</div>${othersWorn.map(rowHtml).join("")}` : ""}
    </div>
    <div style="margin-top:14px"><button class="btn" style="width:100%" data-close>关 闭</button></div>
  </div>`, { dimClose: true });
}

/** 强化确认弹窗：点槽位不再直接扣钱，先看清楚强化到几级、花多少再确认。
 *  uid 为空时按专属缘器查找（专属槽整格点击）。 */
async function confirmEquipUp(gid, uid) {
  const lj = await api({ type: "loadout", id: gid }).catch(() => null);
  if (!lj || !lj.loadout) return;
  let it = null;
  if (uid) it = Object.values(lj.loadout).find((v) => v && v.uid === uid) || null;
  else { const ex = lj.loadout.exclusiveInfo; it = ex && ex.uid ? ex : null; }
  if (!it) return;
  const EQl = DATA.equip || {};   // 注意：EQ 在行囊函数里是局部变量，这里只能从 DATA 现取
  const rc = RCOLOR(it.rarity || "gold");
  const coinTip = Math.round(800 * (it.level + 1) * ({ red: 3.0, gold: 2.4, purple: 1.8, blue: 1.2, green: 0.8 }[it.rarity] || 1));
  const soulTip = EQl.soulCost ? (EQl.soulCost[it.rarity] || 1) * (1 + Math.floor(it.level / 4)) : 0;
  // 器魂真实存在 wallet.mat.soul（见 tools/lib/equip.mjs addSoul）；wallet.soul 永远不存在，
  // 曾因此显示「现有 0」却还能强化成功——显示必须与服务端校验读同一处。
  const soulHave = (S.wallet && S.wallet.mat && S.wallet.mat.soul) || 0;
  const coinHave = (S.wallet && S.wallet.coin) || 0;
  const lack = [];
  if (coinHave < coinTip) lack.push(`铜钱还差 ${fmt(coinTip - coinHave)}`);
  if (soulHave < soulTip) lack.push(`器魂还差 ${fmt(soulTip - soulHave)}`);
  /* 本命缘器：强化弹窗同时是「升缘」的主入口。
   * 以前只有专属槽角上一个很小的「缘」字按钮、还必须满 15 级才出现，玩家根本找不到。
   * 这里常驻一段升缘信息：缘进度、下一级上限、需要的铸魂券与铜钱；条件不满足直接写缺什么。 */
  const exInfo = lj.loadout.exclusiveInfo;
  const isEx = !!(exInfo && exInfo.forged && exInfo.uid === it.uid);
  const fate = isEx ? (it.fate || 0) : 0;
  const fateMax = isEx ? (it.fateMax || 6) : 0;
  const levelCap = isEx ? (it.levelCap || (15 + fate * 3)) : 15;
  const tkHave = isEx ? (it.tickets ?? exInfo.tickets ?? 0) : 0;
  const tkCost = isEx ? (it.ticketCost || 3) : 0;
  const fateCoin = isEx ? (it.fateCoin ?? (20000 + fate * 20000)) : 0;
  const atCap = it.level >= levelCap;
  const fateMaxed = isEx && fate >= fateMax;
  const fateLack = [];
  if (isEx && !fateMaxed) {
    if (!atCap) fateLack.push(`需先强化至 Lv.${levelCap}（当前 Lv.${it.level}）`);
    if (tkHave < tkCost) fateLack.push(`铸魂券还差 ${tkCost - tkHave} 张（现有 ${tkHave}/${tkCost}）`);
    if (coinHave < fateCoin) fateLack.push(`铜钱还差 ${fmt(fateCoin - coinHave)}`);
  }
  const canFate = isEx && !fateMaxed && !fateLack.length;
  const grow = it.grow || null;
  const growRows = grow ? grow.before.map((b, i) => {
    const a = grow.after[i] || b;
    return `<div class="skcmp-tr ${a.val !== b.val ? "up" : "same"}">
      <span class="k">${esc(b.label)}</span>
      <span class="a num">${esc(b.val)}</span>
      <span class="ar">→</span>
      <span class="b num">${esc(a.val)}${a.val === b.val ? `<i class="d same">不变</i>` : ""}</span>
    </div>`;
  }).join("") : "";
  modal(`<div class="menu skcmp">
    <button class="iconbtn mclose" data-close>${I("close")}</button>
    <div class="skcmp-kicker">缘器 · 强化</div>
    <div class="skcmp-title">${esc(it.name || "专属缘器")}</div>
    <div style="display:flex;align-items:center;gap:12px;margin:6px 0 2px;justify-content:center">
      <img src="${it.icon || ""}" alt="" data-fb="rm" style="width:44px;height:44px;border-radius:9px;border:1px solid ${rc}66">
      <div style="text-align:left">
        <div><span style="color:${rc};font-size:11px">${RTAG(it.rarity || "gold")}</span></div>
        <div class="panel-sub" style="margin-top:2px">当前 Lv.${it.level}${isEx ? ` / ${levelCap} · ${fate} 缘` : ""}${it.bt ? ` · 突破${it.bt}阶` : ""}</div>
      </div>
    </div>
    <div class="skcmp-lv"><span>Lv.<b class="num">${it.level}</b></span><span class="ar">→</span><span class="up">Lv.<b class="num">${grow ? grow.nextLevel : it.level}</b></span></div>
    ${grow ? `<div class="skcmp-table">
      <div class="skcmp-tr skcmp-th"><span>属性</span><span>当前</span><span></span><span>强化后</span></div>
      ${growRows || `<div class="skcmp-empty">该缘器没有可展示的属性。</div>`}
    </div>` : `<div class="skcmp-table"><div class="skcmp-empty">${isEx ? `已达 ${fate} 缘等级上限 Lv.${levelCap}${fate < fateMax ? " · 升缘后可继续强化" : ""}` : `已达最高等级 Lv.${it.level}`}</div></div>`}
    ${isEx ? `<div class="skcmp-fate">
      <div class="skcmp-fate-hd"><span>本 命 升 缘</span><b class="num">${fate} / ${fateMax} 缘</b></div>
      <div class="skcmp-fate-lv">等级上限 <b class="num">Lv.${levelCap}</b>${fateMaxed ? " · 六缘圆满" : ` → <b class="num">Lv.${levelCap + 3}</b>（升缘后）`}</div>
      ${fateMaxed ? `<div class="skcmp-ok">本命缘器已六缘圆满，全部加成已拉满。</div>`
        : `<div class="skcmp-cost"><span class="lbl">升缘消耗</span>铸魂券 <b class="num${tkHave < tkCost ? " bad" : ""}">×${tkCost}</b><em>（现有 ${tkHave}）</em> · 铜钱 <b class="num${coinHave < fateCoin ? " bad" : ""}">${fmt(fateCoin)}</b><em>（现有 ${fmt(coinHave)}）</em></div>
      ${fateLack.length
        ? `<div class="skcmp-lack">${esc(fateLack.filter(x => !x.startsWith("铸魂券")).join(" · ")) || "升缘条件未满足"}</div>
            ${tkHave < tkCost ? `<div class="skcmp-hint">铸魂券还差 <b class="num">${tkCost - tkHave}</b> 张（现有 ${tkHave}/${tkCost}）<button class="btn sm ghost" data-goforge="1">去缘器阁 · 本命签攒券</button></div>` : ""}`
        : `<div class="skcmp-ok">升缘条件齐备 · 全属性加成 ×(1+8%)</div>`}
      <div class="skcmp-fate-acts"><button class="btn ${canFate ? "primary" : ""}" data-exfatebt="${it.uid}|${gid}" ${canFate ? "" : "disabled"}>${canFate ? `${I("sparkle")} 升 缘 · ${fate + 1} 缘` : "升 缘 条 件 不 足"}</button></div>`}
    </div>` : ""}
    <div class="skcmp-foot">
      <div class="skcmp-cost"><span class="lbl">消耗</span>铜钱 <b class="num${coinHave < coinTip ? " bad" : ""}">${fmt(coinTip)}</b><em>（现有 ${fmt(coinHave)}）</em> · 器魂 <b class="num${soulHave < soulTip ? " bad" : ""}">×${fmt(soulTip)}</b><em>（现有 ${fmt(soulHave)}）</em></div>
      ${lack.length ? `<div class="skcmp-lack">${esc(lack.join(" · "))}</div>` : `<div class="skcmp-ok">材料充足 · 确认后立即生效</div>`}
    </div>
    <div class="skcmp-acts">
      <button class="btn primary" data-equpcfm="${it.uid}|${gid}" ${lack.length || !grow ? "disabled" : ""}>${lack.length ? "材 料 不 足" : !grow ? (isEx && !fateMaxed ? "已 达 本 级 上 限" : "已 满 级") : `${I("sparkle")} 确认强化`}</button>
      <button class="btn" data-close>取 消</button>
    </div>
  </div>`, { dimClose: true });
}

async function doFeed(id) {
  // 一级一级升：targetLevel 只到当前等级 +1，不多升；按钮上的消耗按这一级算
  const target = (S.owned[id]?.lv || 1) + 1;
  const j = await call({ type: "feed", id, targetLevel: target });
  if (!j) return;
  if (j.feed.error) { toast(j.feed.error); return; }
  toast(`升级完成 · Lv.${S.owned[id].lv}`);
  blip(700, .07);
  afterGrowth(id);
}
async function doStar(id) {
  const j = await call({ type: "star", id });
  if (!j) return;
  if (j.star.error) { toast(j.star.error); return; }
  toast(`升至 ★${S.owned[id].star}`);
  blip(760, .09);
  afterGrowth(id);
}
async function doBreak(id) {
  const j = await call({ type: "break", id });
  if (!j) return;
  if (j.bt.error) { toast(j.bt.error); return; }
  toast(`突破至 ${S.owned[id].bt} 阶`);
  blip(780, .1);
  afterGrowth(id);
}
/* 归一：确认框里点「确认归一」后执行。返回的 refund 里铜钱与材料已进存档，
 * toast 只报最关键的几项，明细在确认框里已经看过。 */
async function doNormalize(id) {
  const j = await call({ type: "normalize", id });
  if (!j) return;
  if (j.normalize && j.normalize.error) { toast(j.normalize.error); return; }
  const r = (j.normalize && j.normalize.refund) || {};
  const bits = [];
  if (r.coin) bits.push(`铜钱 +${fmt(r.coin)}`);
  if (r.sameShard) bits.push(`本体残卷 +${fmt(r.sameShard)}`);
  for (const [k, n] of Object.entries(r.mat || {})) if (n) bits.push(`${matLabel(k)} +${fmt(n)}`);
  toast(`已归一 · ${bits.length ? "返还 " + bits.join(" · ") : "无返还"}`);
  blip(620, .1);
  closeModal();
  afterGrowth(id);
}
/* —— 技能升级对比框 ——
 * 点「升级」不立刻扣材料，先把当前等级与升级后的效果数值并排摆出来。
 * 数值口径与服务端/战斗引擎同源：meta.materials.skillLevels.perLevel（默认每级 +5%）。
 * 2026-11-04 起所有数值型效果都随技能等级成长：伤害/治疗/护盾/持续伤害乘 power，
 * 增减益系数按 power 拉开（mul 围绕 1，add 直接乘），整数续气每级 +1。
 * 只有回合数、概率、驱散层数这类"计数/时长"不随等级变化，才标"不变"。
 */
const SKCMP_TRIGGER = {
  battle_start: "战斗开始", turn_start: "回合开始", turn_end: "回合结束",
  skill_used: "施术后", attack_used: "普攻后", self_hit: "自身受击", self_low_hp: "自身低血",
  self_down: "自身倒下", ally_down: "同伴倒下", ally_low_hp: "同伴低血", critical_hit: "暴击时",
  shield_broken: "护盾击破", marked_target_down: "标记目标倒下",
};
const SKCMP_STAT = { hp: "生命", atk: "攻击", def: "防御", mdef: "法抗", spd: "速度", crit: "暴击", dmg: "伤害", heal: "治疗", shield: "护盾", dot: "持续伤害", healRecv: "受疗", healTake: "受疗", aoeReduce: "群伤减免", evasion: "闪避", ultCoef: "终式倍率", skillCoef: "技能倍率", nextAtkCoef: "下两次攻击", dmgTake: "受伤", dmgTaken: "受伤", dmgReduce: "受伤", graze: "免死", extraAction: "额外行动", silenceImmune: "缄口免疫", debuffExtend: "负面延长" };
const skcmpRound1 = (n) => Math.round(n * 10) / 10;
/** 单条 fx 在当前/升级后威力下的展示行；num = 实际参与涨幅计算的数值。 */
function skcmpFxRow(f, power) {
  const c = (x) => skcmpRound1(((x ?? 0) * power) * 100);
  const turns = (f.turns === 99) ? "（整场）" : `（${f.turns ?? 1}回合）`;
  const scaled = (op, raw) => op === "mul" ? 1 + ((raw ?? 1) - 1) * power : (raw ?? 0) * power;
  switch (f.k) {
    case "damage": return { label: `伤害倍率${f.times > 1 ? `（${f.times}段）` : ""}`, val: `${c(f.coef ?? 1)}% 攻击力`, num: c(f.coef ?? 1) };
    case "heal": return { label: "治疗量", val: `${c(f.coef)}% 攻击力`, num: c(f.coef) };
    case "shield": return { label: "护盾量", val: `${c(f.coef)}% 攻击力`, num: c(f.coef) };
    case "dot": return { label: "持续伤害", val: `${c(f.coef)}% ${f.mode === "maxHp" ? "最大生命" : "攻击力"}/回合`, num: c(f.coef) };
    case "buff": {
      if (["graze", "extraAction", "silenceImmune", "debuffExtend"].includes(f.stat)) {
        return { label: `增益 · ${SKCMP_STAT[f.stat] || f.stat}`, val: `+${Math.round(f.value ?? 0)}${turns}`, num: null };
      }
      const v = scaled(f.op, f.value);
      if ((f.stat === "dmgTake" || f.stat === "dmgReduce") && (f.op ?? "mul") === "mul" && v < 1) {
        const pct = skcmpRound1(Math.abs((v - 1) * 100));
        return { label: "减伤 · 受到伤害", val: `-${pct}%${turns}`, num: pct };
      }
      const pct = (f.op === "mul") ? skcmpRound1(Math.abs((v - 1) * 100)) : skcmpRound1(v * 100);
      return { label: `增益 · ${SKCMP_STAT[f.stat] || f.stat}`, val: `+${pct}%${turns}`, num: pct };
    }
    case "debuff": {
      const v = scaled(f.op, f.value);
      const pct = (f.op === "mul") ? skcmpRound1(Math.abs((v - 1) * 100)) : skcmpRound1(v * 100);
      return { label: `减益 · ${SKCMP_STAT[f.stat] || f.stat}`, val: `-${pct}%${turns}`, num: pct };
    }
    case "energy": {
      // 与服务端同口径：整数续气每级 +1（Lv.1 的 +6 → Lv.2 +7），保证每次升级都能看到变化。
      const per = (DATA.progression && DATA.progression.skillPerLevel) || 0.05;
      const lv = Math.max(1, Math.round((power - 1) / per) + 1);
      const val = Math.max(0, Math.round(f.value ?? 0) + (lv - 1));
      return { label: "怒气", val: `+${val}`, num: val, count: true };
    }
    case "mark": {
      const pct = skcmpRound1((f.dmgTake ?? 0) * power * 100);
      return { label: "易伤标记", val: `受到伤害 +${pct}%（${f.turns ?? 2}回合）`, num: pct };
    }
    case "shieldBreak": return { label: "破盾", val: `打掉 ${Math.round((f.value ?? 0) * 100)}% 护盾`, num: null };
    case "dispel": return { label: "驱散", val: `解除 ${f.count ?? 1} 层负面`, num: null };
    case "taunt": return { label: "嘲讽", val: `${f.turns ?? 1} 回合`, num: null };
    case "stun": return { label: "定身", val: `${f.turns ?? 1} 回合（${Math.round((f.chance ?? 1) * 100)}%）`, num: null };
    case "silence": return { label: "缄口", val: `${f.turns ?? 1} 回合（${Math.round((f.chance ?? 1) * 100)}%）`, num: null };
    case "stealth": return { label: "匿影", val: `${f.turns ?? 1} 回合`, num: null };
    case "revive": return { label: "复活", val: `保留 ${Math.round((f.pctHp ?? 0.3) * 100)}% 生命`, num: null };
    default: return { label: f.k, val: "—", num: null };
  }
}
function skcmpRows(skill, p0, p1) {
  const out = [];
  const walk = (list, trig) => {
    for (const f of list || []) {
      if (f.k === "trigger") { walk(f.fx, SKCMP_TRIGGER[f.on] || f.on); continue; }
      const a = skcmpFxRow(f, p0), b = skcmpFxRow(f, p1);
      out.push({
        label: (trig ? `${trig} · ` : "") + a.label,
        a: a.val, b: b.val,
        delta: a.num != null && b.num != null && b.num !== a.num ? b.num - a.num : null,
        // 怒气这类整数资源不是百分比，涨幅不带 % 号
        count: !!a.count,
      });
    }
  };
  walk(skill.fx, "");
  return out;
}

/** 技能升级对比作用框：确认后才真正调 skillUp，取消则一分材料不扣。 */
function openSkillCompare(id, slot) {
  const sel = charById(id), so = S.owned[id];
  if (!sel || !so) { toast("这个角色还没结缘"); return; }
  const sk = (sel.skills || []).find((s) => s.slot === slot);
  if (!sk) return;
  const lv = so.skills[slot] || 1;
  const table = (DATA.progression && DATA.progression.skillCost && DATA.progression.skillCost[sel.rarity]) || [];
  const plan = table.find((x) => x.toLevel === lv + 1) || null;
  if (!plan) { toast("该技能已满级"); return; }
  const per = (DATA.progression && DATA.progression.skillPerLevel) || 0.05;
  const rows = skcmpRows(sk, 1 + per * (lv - 1), 1 + per * lv);
  const tomeLabel = ({ gold: "金阶技能书", red: "红阶技能书", purple: "紫阶技能书", blue: "紫阶技能书", green: "紫阶技能书" })[plan.tome] || "技能书";
  const tomeHave = (S.wallet && S.wallet.tome && S.wallet.tome[plan.tome]) || 0;
  const coinHave = (S.wallet && S.wallet.coin) || 0;
  const lack = [];
  if (coinHave < plan.coin) lack.push(`铜钱还差 ${fmt(plan.coin - coinHave)}`);
  if (tomeHave < plan.tomeCount) lack.push(`${tomeLabel}还差 ${plan.tomeCount - tomeHave} 本`);
  modal(`<div class="menu skcmp">
    <button class="iconbtn mclose" data-close>${I("close")}</button>
    <div class="skcmp-kicker">${SLOT_NAME[slot] || slot} · 技能升级</div>
    <div class="skcmp-title">${esc(sk.name)}</div>
    <div class="skcmp-lv"><span>Lv.<b class="num">${lv}</b></span><span class="ar">→</span><span class="up">Lv.<b class="num">${lv + 1}</b></span></div>
    <div class="skcmp-table">
      <div class="skcmp-tr skcmp-th"><span>效果</span><span>当前</span><span></span><span>升级后</span></div>
      ${rows.map((r) => `<div class="skcmp-tr ${r.delta != null ? "up" : "same"}">
        <span class="k">${esc(r.label)}</span>
        <span class="a num">${esc(r.a)}</span>
        <span class="ar">→</span>
        <span class="b num">${esc(r.b)}${r.delta != null ? `<i class="d">+${skcmpRound1(r.delta)}${r.count ? "" : "%"}</i>` : `<i class="d same">不变</i>`}</span>
      </div>`).join("") || `<div class="skcmp-empty">该技能没有数值型效果，升级不改变战斗数值。</div>`}
    </div>
    <div class="skcmp-foot">
      <div class="skcmp-cost"><span class="lbl">消耗</span>铜钱 <b class="num${coinHave < plan.coin ? " bad" : ""}">${fmt(plan.coin)}</b><em>（现有 ${fmt(coinHave)}）</em> · ${tomeLabel} <b class="num${tomeHave < plan.tomeCount ? " bad" : ""}">×${plan.tomeCount}</b><em>（现有 ${tomeHave}）</em></div>
      ${lack.length ? `<div class="skcmp-lack">${esc(lack.join(" · "))}</div>` : `<div class="skcmp-ok">材料充足 · 确认后立即生效</div>`}
    </div>
    <div class="skcmp-acts">
      <button class="btn primary" data-skcfm="${id}|${slot}" ${lack.length ? "disabled" : ""}>${I("sparkle")} 确认升级</button>
      <button class="btn" data-close>取 消</button>
    </div>
  </div>`, { dimClose: true });
}

async function doSkill(id, slot) {
  const j = await call({ type: "skill", id, slot });
  if (!j) return;
  if (j.skill.error) { toast(j.skill.error); return; }
  toast(`${SLOT_NAME[slot]} 升至 Lv.${S.owned[id].skills[slot]}`);
  blip(700, .07);
  closeModal();
  afterGrowth(id);
}

/* 成长操作成功后的统一刷新。
 * 养成详情现在内嵌在名册右栏（不再是弹窗）：整屏重绘会同时刷新顶栏战力、网格等级、
 * 详情数值这几处，但要手动接住右栏的滚动位置——不然点一次「升级」详情就跳回顶部。 */
function afterGrowth(id) {
  renderResBar();
  const side = $("#scr-roster .rd-body") || $("#scr-roster .rl-detail");
  const sc = side ? side.scrollTop : 0;
  renderRoster();
  const nr = $("#scr-roster .rd-body") || $("#scr-roster .rl-detail");
  if (nr && sc) nr.scrollTop = sc;
  // 兜底：若还有人从旧的养成弹窗路径进来，弹窗里的数值也要跟着更新
  if ($(".grow-dlg")) openGrow(id);
}

/* ---------------- 屏：图鉴 ---------------- */

let cxR = "all", cxF = "all", cxE = "all", cxP = "all";
let codexPage = 0;

/* 图鉴页每页张数同样按窗口实际容量算（见 core.js gridCapacity），
 * 再套 pageRenderCap 的单页渲染预算：左栏 320、右侧里程碑栏 236、主区吃剩余宽度，
 * 页面本身锁成一屏高度、不出现窗口滚动条。 */
function codexPageCapacity() {
  /* 2026-10-31 用户口径：桌面上每页 20 个铺满主区；非全屏 / 矮窗口降一档到 12 个。 */
  return pageRenderCap("codex");
}

/* 图鉴网格：20 张/页必须整除成整行，优先 5 列 × 4 行；
 * 窗口更窄时退成 4 列 × 5 行，保证每页都铺成完整矩形。 */
function codexColumns() {
  if (window.innerWidth <= 1120) return 0; // 窄屏交给 CSS auto-fill
  const shell = Math.min(window.innerWidth - 72, 1200);
  const availW = shell - 240 - 200 - 28;
  return availW >= 600 ? 5 : 4;
}

async function loadCodexTiers() {
  const box = $("#codexTiers");
  if (!box) return;
  const j = await api({ type: "codexTiers" }).catch(() => null);
  if (!j || !box.isConnected) return;
  const c = j.codex;
  box.innerHTML = c.tiers.map(t => `
    <div class="rowitem" style="padding:6px 4px">
      <div class="grow"><div class="t num" style="font-size:12.5px">${t.at} 位</div>
      <div class="s num" style="font-size:11px">玉${t.jade} 尘${t.essence}${t.coin ? ` 钱${t.coin}` : ""}</div></div>
      <div class="codex-claimslot">${t.claimed ? `<span class="tag dim">已领</span>`
        : t.can ? `<button class="btn sm primary" data-ctier="${t.at}">领取</button>`
        : `<span class="tag dim">${c.collected}/${t.at}</span>`}</div>
    </div>`).join("") || `<span class="panel-sub">暂无档位</span>`;
}
async function claimTier(at) {
  const j = await call({ type: "codexClaim", at });
  if (j) { toast("里程碑奖励已领取"); AudioSys.sfx("coin"); renderResBar(); renderCodex(); }
}

function renderCodex() {
  const total = DATA.characters.length, ownedN = Object.keys(S.owned).length;
  const list = DATA.characters
    .filter(c => (cxR === "all" || c.rarity === cxR) && (cxF === "all" || c.faction === cxF) && (cxE === "all" || c.element === cxE) && (cxP === "all" || c.role === cxP))
    .sort((a, b) => RAR_ORDER.indexOf(a.rarity) - RAR_ORDER.indexOf(b.rarity) || a.id.localeCompare(b.id));
  const have = list.filter(c => S.owned[c.id]).length;
  const codexPageSize = codexPageCapacity();
  const codexPages = Math.max(1, Math.ceil(list.length / codexPageSize));
  if (!Number.isFinite(codexPage) || codexPage < 0) codexPage = 0;
  if (codexPage > codexPages - 1) codexPage = codexPages - 1;
  const pageList = list.slice(codexPage * codexPageSize, (codexPage + 1) * codexPageSize);

  $("#scr-codex").innerHTML = `
  ${subBack("图 鉴")}
  <div class="cx-body">
    <aside class="panel panel-pad cx-rail">
      <div class="cx-ringrow" data-tip="收集进度|已结缘 ${ownedN} / ${total}">
        <div class="ring">
          <svg width="64" height="64" viewBox="0 0 92 92"><circle cx="46" cy="46" r="40" stroke="rgba(255,255,255,.07)" stroke-width="7" fill="none"/>
          <circle cx="46" cy="46" r="40" stroke="var(--gold)" stroke-width="7" fill="none" stroke-linecap="round"
            stroke-dasharray="${2 * Math.PI * 40}" stroke-dashoffset="${2 * Math.PI * 40 * (1 - ownedN / total)}"/></svg>
          <div class="pc"><div><b class="num">${ownedN}</b><span>/ ${total}</span></div></div>
        </div>
        <div class="cx-ringmeta"><b>已结缘</b><span>共 ${total} 位角色</span><span>已拥有 ${have} 位</span></div>
      </div>
      <div class="cx-rail-sec">
        ${RAR_ORDER.map(r => {
          const t = DATA.characters.filter(c => c.rarity === r), o = t.filter(c => S.owned[c.id]).length;
          return `<button class="filter-row ${cxR === r ? "on" : ""}" data-cx="r" data-v="${r}">
            <span style="color:${cxR === r ? RCOLOR(r) : "inherit"}">${RTAG(r)} 阶</span><span class="cnt num">${o}/${t.length}</span></button>`;
        }).join("")}
        <button class="filter-row ${cxR === "all" ? "on" : ""}" data-cx="r" data-v="all"><span>全部阶位</span><span class="cnt num">${ownedN}/${total}</span></button>
      </div>
      <div class="cx-rail-hd">势 力</div>
      <div class="chipwrap">${["all", ...Object.keys(DATA.factions)].map(f => {
        const t = DATA.characters.filter(c => f === "all" || c.faction === f);
        const o = t.filter(c => S.owned[c.id]).length;
        return `<button class="fchip ${cxF === f ? "on" : ""}" data-cx="f" data-v="${f}">${f === "all" ? "全部" : FLABEL(f)}<span class="cnt num">${o}/${t.length}</span></button>`;
      }).join("")}</div>
      <div class="cx-rail-hd">六 气</div>
      <div class="chipwrap">${["all", ...Object.keys(DATA.elements)].map(e => {
        const t = DATA.characters.filter(c => e === "all" || c.element === e);
        const o = t.filter(c => S.owned[c.id]).length;
        return `<button class="fchip ${cxE === e ? "on" : ""}" data-cx="e" data-v="${e}">${e === "all" ? "全部" : DATA.elements[e].label}<span class="cnt num">${o}/${t.length}</span></button>`;
      }).join("")}</div>
      <div class="cx-rail-hd">定 位</div>
      <div class="chipwrap">${["all", ...Object.keys(DATA.roles)].map(p => {
        const t = DATA.characters.filter(c => p === "all" || c.role === p);
        const o = t.filter(c => S.owned[c.id]).length;
        return `<button class="fchip ${cxP === p ? "on" : ""}" data-cx="p" data-v="${p}">${p === "all" ? "全部" : (DATA.roles[p].position || DATA.roles[p].label)}<span class="cnt num">${o}/${t.length}</span></button>`;
      }).join("")}</div>
    </aside>

    <section class="cx-main">
      <div class="cx-main-hd">
        <div class="panel-title">全 部 角 色</div>
        <span class="panel-sub num">${have}/${list.length} 已结缘 · 未结缘者以剪影示人</span>
      </div>
      <div class="cgrid cx-grid">
        ${pageList.map(c => charCard(c.id, { locked: !S.owned[c.id] })).join("")}
      </div>
      ${pagerBar("cx", codexPage, codexPages,
        `第 <b class="num">${codexPage + 1}</b> / ${codexPages} 页 · 本页 ${codexPage * codexPageSize + 1}-${Math.min(list.length, (codexPage + 1) * codexPageSize)} 位 · 共 ${list.length} 位`)}
    </section>

    <aside class="panel panel-pad cx-miles">
      <div class="cx-miles-hd">里 程 碑</div>
      <div class="cx-miles-sub">收集足够数量的角色可领取奖励</div>
      <div id="codexTiers"><span class="panel-sub">加载中…</span></div>
    </aside>
  </div>`;
  loadCodexTiers();
  // 首帧后按共享卡尺寸铺满：图鉴 7 列×3 行是尺寸基准，每页 21 张固定 3:4 竖卡。
  requestAnimationFrame(() => {
    if (cur !== "codex") return;
    const grid = $("#scr-codex .cx-grid");
    if (grid) {
      const c = codexMetrics();
      applyFixedGrid(grid, { cols: c.cols, rows: c.rows, cardW: c.cardW, cardH: c.cardH, gap: c.gap });
    }
  });
}

/* ---------------- 屏：编队 ---------------- */

let slotSel = -1;

/* 兼容旧调用点（下阵、一键推荐等）：编队已并入名册，
 * 统一转发到名册的编队页签渲染，避免到处改调用。
 */

/* ---------------- 扩展 · 主城三件交互（独立委托，只认 data-xp*，不与 settle 总线互相牵连） ---------------- */

document.addEventListener("click", async e => {
  const t = e.target;
  // 七日签到领取：响应 {login7Claim:{ok,day,reward,note}}；失败时 call() 已 toast 并返回 null
  if (t.closest("[data-xp7claim]")) {
    const j = await call({ type: "login7Claim" });
    if (j && j.login7Claim && !j.login7Claim.error) {
      xpSyncSave(j);
      xpSignAt = 0;   // 强制下次重拉，拿最新的 day/claimed
      toast(`签到成功 · ${j.login7Claim.note || "奖励已发放"}`);
      AudioSys.sfx("coin");
      // refreshWallet 由并行扩展提供（若无则退回 renderResBar；钱包刷新后 resBar 同步更新）
      if (typeof refreshWallet === "function") refreshWallet(); else renderResBar();
      if (cur === "home") renderHome();
    }
    return;
  }
  // 来访打招呼：+5 缘值，10 点溢出转 1 级（服务端结算）
  if (t.closest("[data-xpgreet]")) {
    const j = await call({ type: "visitGreet" });
    if (j && j.visitGreet && !j.visitGreet.error) {
      xpSyncSave(j);
      xpVisitAt = 0;
      toast(`她收下了你的问候 · 缘值 +5（Lv.${j.visitGreet.bond?.lv ?? 0}）`);
      blip(760, .09);
      if (typeof refreshWallet === "function") refreshWallet(); else renderResBar();
      if (cur === "home") renderHome();
    }
    return;
  }
  // 章末回望入口：openChapterReview 由 js/events.js 提供，尚未加载时兜底提示
  const rev = t.closest("[data-xprev]");
  if (rev) {
    if (typeof openChapterReview === "function") openChapterReview(xpCurChapter());
    else toast("功能加载中");
    return;
  }
});

/* ---------------- 名册 · 出战编队拖动排序 ----------------
 * 需求：名册顶部「出战 x/5」的五个编队格要支持拖动调整出战顺序。
 * 出战顺序不是纯展示：战斗按 save.team 的数组顺序出击（第 1 位先手），
 * 所以拖动结果必须回写服务端（type:"team" 接口本来就按传入 ids 顺序保存）。
 *
 * 交互取舍：
 * - Pointer Events 统一鼠标/触屏；按下后移动超过 6px 才进入拖动态，
 *   没超过阈值就松手仍按普通点击处理（点开右侧养成），不会和点击抢事件。
 * - 编队格里是 <img>，浏览器默认会启动原生 HTML5 拖拽（dragstart），
 *   一旦启动 pointer 事件会被取消，拖动排序就永远进不了拖动态 ——
 *   所以必须同时拦截 dragstart，并用 CSS 关闭图片的原生拖拽。
 * - 拖动中用 fixed 定位的缩略图跟随指针，目标格高亮；松手按目标槽位重排。
 * - 拖动结束后短暂拦截一次 click，避免松手瞬间顺手触发了卡片选中/养成弹窗。
 * - 只在有角色的格子上拖；「×下阵」按钮不参与拖动。
 */
const TEAM_DRAG_THRESHOLD = 6;
let teamDrag = null;             // { id, from, startX, startY, slot, ghost, active, overIndex }
let teamDragSuppressClickUntil = 0;

document.addEventListener("dragstart", (e) => {
  if (e.target.closest && e.target.closest("#scr-roster [data-team-list] .rl-slot[data-team-id]")) e.preventDefault();
}, true);

function teamSlotEls() {
  return $$("#scr-roster [data-team-list] .rl-slot[data-team-slot]");
}

function teamDragCleanup() {
  if (!teamDrag) return;
  if (teamDrag.ghost) teamDrag.ghost.remove();
  if (teamDrag.slot) teamDrag.slot.classList.remove("dragging");
  for (const el of teamSlotEls()) el.classList.remove("drag-over");
  document.body.classList.remove("team-dragging");
  teamDrag = null;
}

/** 指针所在位置 → 目标槽位（优先命中，移出时取水平距离最近的已上阵格） */
function teamDropIndexAt(x, y) {
  const els = teamSlotEls();
  const filled = els.filter(el => el.dataset.teamId);
  if (!filled.length) return -1;
  const hit = document.elementFromPoint(x, y);
  const hitSlot = hit && hit.closest ? hit.closest("#scr-roster [data-team-list] .rl-slot[data-team-slot]") : null;
  if (hitSlot && hitSlot.dataset.teamId) return +hitSlot.dataset.teamSlot;
  let best = -1, bestD = Infinity;
  for (const el of filled) {
    const r = el.getBoundingClientRect();
    const d = Math.abs(x - (r.left + r.width / 2));
    if (d < bestD) { bestD = d; best = +el.dataset.teamSlot; }
  }
  return bestD <= 220 ? best : -1;
}

document.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button !== 0) return;
  const slot = e.target.closest && e.target.closest("#scr-roster [data-team-list] .rl-slot[data-team-id]");
  if (!slot) return;
  if (e.target.closest("[data-uteam]")) return;   // 下阵按钮不参与拖动
  const id = slot.dataset.teamId;
  if (!id || !S || !S.team.includes(id)) return;
  teamDrag = {
    id, from: +slot.dataset.teamSlot, startX: e.clientX, startY: e.clientY,
    slot, ghost: null, active: false, overIndex: -1, pointerId: e.pointerId,
  };
}, true);

document.addEventListener("pointermove", (e) => {
  if (!teamDrag || teamDrag.pointerId !== e.pointerId) return;
  const dx = e.clientX - teamDrag.startX, dy = e.clientY - teamDrag.startY;
  if (!teamDrag.active) {
    if (Math.hypot(dx, dy) < TEAM_DRAG_THRESHOLD) return;
    teamDrag.active = true;
    const rect = teamDrag.slot.getBoundingClientRect();
    const ghost = teamDrag.slot.cloneNode(true);
    ghost.classList.add("team-drag-ghost");
    ghost.classList.remove("on");
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    ghost.style.left = rect.left + "px";
    ghost.style.top = rect.top + "px";
    document.body.appendChild(ghost);
    teamDrag.ghost = ghost;
    teamDrag.slot.classList.add("dragging");
    document.body.classList.add("team-dragging");
    try { teamDrag.slot.setPointerCapture && teamDrag.slot.setPointerCapture(e.pointerId); } catch {}
    AudioSys.sfx("click");
  }
  e.preventDefault();
  if (teamDrag.ghost) {
    const g = teamDrag.ghost.getBoundingClientRect();
    teamDrag.ghost.style.left = (e.clientX - g.width / 2) + "px";
    teamDrag.ghost.style.top = (e.clientY - g.height / 2) + "px";
  }
  const over = teamDropIndexAt(e.clientX, e.clientY);
  if (over !== teamDrag.overIndex) {
    teamDrag.overIndex = over;
    for (const el of teamSlotEls()) el.classList.toggle("drag-over", +el.dataset.teamSlot === over && over !== teamDrag.from);
  }
}, { passive: false, capture: true });

document.addEventListener("pointerup", (e) => {
  if (!teamDrag || teamDrag.pointerId !== e.pointerId) return;
  const d = teamDrag;
  if (!d.active) { teamDrag = null; return; }   // 没拖动：按普通点击走
  const to = d.overIndex;
  const from = d.from;
  teamDragSuppressClickUntil = performance.now() + 380;
  teamDragCleanup();
  if (to < 0 || to === from) return;
  const oldTeam = [...S.team];
  const id = d.id;
  const next = oldTeam.filter(x => x !== id);
  next.splice(Math.min(to, next.length), 0, id);
  if (next.join(",") === oldTeam.join(",")) return;
  // 先乐观更新界面，再把新顺序提交服务端；失败回滚并重绘。
  S.team = next;
  renderRoster();
  api({ type: "team", ids: next }).then(j => {
    if (!j || j.ok === false) throw new Error((j && j.actionError) || "保存失败");
    S.team = (j.team && j.team.slice()) || next;
    renderRoster();
    toast("出战顺序已保存");
    AudioSys.sfx("coin");
  }).catch(err => {
    S.team = oldTeam;
    renderRoster();
    toast("出战顺序保存失败：" + (err && err.message ? err.message : "网络错误"));
  });
}, true);

document.addEventListener("pointercancel", (e) => {
  if (!teamDrag || teamDrag.pointerId !== e.pointerId) return;
  if (teamDrag.active) teamDragSuppressClickUntil = performance.now() + 380;
  teamDragCleanup();
}, true);

/* 拖动结束后的那一次 click 直接吞掉（在捕获阶段拦截，先于 settle 的点击总线） */
document.addEventListener("click", (e) => {
  if (performance.now() < teamDragSuppressClickUntil) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

