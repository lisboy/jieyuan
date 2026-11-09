/* 拾缘 · screens-mid —— 由 app.js 拆分（2026-10-26） */
function renderTeam() {
  rosterTab = "team";
  if (cur === "roster") return renderRoster();
  return go("roster");
}


/* ---------------- 屏：出征 ---------------- */

let curChap = 0, curNode = null;
let stagePage = 0;                 // 章节内关卡列表的分页（每页 16 关 = 4×4）
const STAGE_PAGE_SIZE = 16;
/* 出征页每次「进入」都把选中关卡定位到当前最新可打关卡（而不是停在上一轮选过的第 1 关）。
 * 进屏、切章、打完一关刷新后 stageAutoPick=true；页内点穴 / 手动翻页不清零，玩家的选择保留。 */
let stageAutoPick = true;
/** 玩家刚点了分页按钮：本次重绘以 stagePage 为准，不按选中关反推页码（stageGoPage 里临时置 true）。 */
let stagePageLock = false;

/** 关卡是否未解锁（与服务端 requires 链同规则） */
function stageNodeLocked(n) {
  return n && n.requires ? !Object.keys(S.cleared).includes(n.requires) : false;
}

/** 当前最新可打关卡：该章第一个「已解锁且未通关」的关；全通则退到已解锁的最后一关。
 *  额外保护：该关之后仍有已解锁的第 j 关时取 j（前置链数据有洞也不会把玩家按回老关）。 */
function latestPlayableNode(ch) {
  const nodes = (ch || {}).nodes || [];
  const open = nodes.filter(n => !stageNodeLocked(n));
  const firstUncleared = nodes.findIndex(n => !stageNodeLocked(n) && !S.cleared[n.id]);
  if (firstUncleared < 0) return open.length ? open[open.length - 1] : (nodes[0] || null);
  const chosenIdx = nodes.findIndex(n => n.id === nodes[firstUncleared].id);
  const farther = open.filter(n => nodes.indexOf(n) > chosenIdx);
  return farther.length ? farther[farther.length - 1] : nodes[chosenIdx];
}

/** 翻页：翻到目标页后把选中关卡移到该页第一个可打关卡（整页都已通关则取该页最后一关）。
 *  分页是玩家在出征屏里的显式动作，所以落地后必须停在目标页——
 *  这里用 stagePageLock=true 告诉 renderStages「别按选中关反推页码」，否则会被拉回旧关所在页。 */
function stageGoPage(p) {
  const ch = DATA.chapters[curChap];
  if (!ch || !Array.isArray(ch.nodes) || !ch.nodes.length) return renderStages();
  const pages = Math.max(1, Math.ceil(ch.nodes.length / STAGE_PAGE_SIZE));
  const want = Math.max(0, Math.min(pages - 1, p | 0));
  const slice = ch.nodes.slice(want * STAGE_PAGE_SIZE, (want + 1) * STAGE_PAGE_SIZE);
  const pick = slice.find(n => !stageNodeLocked(n) && !S.cleared[n.id])
    || slice.filter(n => !stageNodeLocked(n)).at(-1);
  // 先定选中关、再定页码：反过来会被 renderStages 里「选中关在册 + 不自动定位」的逻辑判成
  // 「玩家选了旧关」，把页码拉回旧关那一页（翻页看着没反应，还越翻越远）。
  if (pick) curNode = pick.id;
  stagePage = want;
  stageAutoPick = false;
  stagePageLock = true;      // 本次重绘以 stagePage 为准，不按选中关反推页码
  const out = renderStages();
  stagePageLock = false;
  return out;
}

/** 本关敌人列表（可点开详情）。抽成独立函数：renderStages 与验收脚本共用同一段渲染逻辑。 */
function foeListHtml(node) {
  const wave0 = (node.mobs && node.mobs[0]) || [];
  if (!wave0.length) return "";
  return `<div class="foelist">
        <div class="foehd">本关敌人${node.waveCount > 1 ? ` · 共 ${node.waveCount} 波` : ""}<span class="foetip">点击敌人查看详情</span></div>
        ${wave0.map(f => `<div class="foerow foe-link" data-foe="${esc(f.id)}" data-foe-lv="${f.level}" data-foe-stage="${esc(node.title || node.name || "")}" data-tip="${esc(f.name)}|点击查看详情">
          <span class="foename">${esc(f.name)}</span>
          <span class="foetag" style="border-color:${ECOLOR(f.element)}66;color:${ECOLOR(f.element)}">${ELABEL(f.element)}</span>
          <span class="foelv num">Lv.${f.level}</span>
          <span class="foe-more">详情 ›</span>
        </div>`).join("")}
      </div>`;
}

/** 点「本关敌人」某一行 → 敌人详情（补本关等级与关名）。 */
function openFoeDetail(el) {
  return openBestiaryEntry(el.dataset.foe, { level: el.dataset.foeLv, stageName: el.dataset.foeStage });
}

function renderStages() {
  // 兜底：章节数据异常（缺字段 / 空数组）时也要能渲染，不能让重绘整屏抛错——出征屏一炸，自动连战和结算后的刷新全断。
  const chapters = Array.isArray(DATA.chapters) ? DATA.chapters : [];
  if (!chapters.length) {
    $("#scr-stages").innerHTML = `<div class="panel panel-pad"><div class="panel-title">关 卡</div>
      <div class="panel-sub" style="margin-top:12px">章节数据为空，请检查 content/stages.json 后重建。</div></div>`;
    return;
  }
  DATA.chapters = chapters;
  chapters.forEach(c => { c.nodes = c.nodes || []; });
  if (curChap < 0 || curChap >= chapters.length) curChap = 0;
  const unlockedCh = i => i === 0 || chapters[i - 1].nodes.every(n => S.cleared[n.id]);
  // 关卡解锁：服务端按 requires 判定，这里同规则前置，避免点进未解锁关还能「出战」
  const nodeLocked = stageNodeLocked;
  /* 自动定位只在「进屏」时发生（stageAutoPick 由 go() 置 true），且不能把玩家锁在最新章：
   * 玩家点左侧章节列表是显式动作（settle.js 的 data-chap 分支已把 stageAutoPick=false），
   * 以前这里无条件把「当前章已全通且后面还有已解锁章」的玩家拉去 lastOpenCh，
   * 导致打完下一章后点上一章永远被弹回来——「无法点击返回上一章」。
   * 现在只在自动定位（刚进屏/切章）时才跟随最新章，手动选章不再被劫持。 */
  const auto = stageAutoPick || curNode == null || !chapters[curChap].nodes.some(n => n.id === curNode);
  if (auto) {
    const lastOpenCh = chapters.reduce((acc, c, i) => (unlockedCh(i) ? i : acc), 0);
    if (stageAutoPick && curChap < lastOpenCh && chapters[curChap].nodes.every(n => S.cleared[n.id])) curChap = lastOpenCh;
    const pick = latestPlayableNode(chapters[curChap]);
    curNode = pick ? pick.id : (chapters[curChap].nodes[0] || {}).id;
    stageAutoPick = false;
  }
  const ch = chapters[curChap];
  const allNodes = chapters.flatMap(c => c.nodes);
  const curUnlocked = unlockedCh(curChap);
  const stagePages = Math.max(1, Math.ceil(ch.nodes.length / STAGE_PAGE_SIZE));
  // 选中关卡所在页决定分页：目标关翻页后仍在视口里，否则右侧「出战」和左侧高亮会各指一处。
  // 注意 findIndex 找不到时是 -1，必须显式判定，否则会把 stagePage 打成负页码、整页关卡消失。
  if (auto) {
    const autoIdx = ch.nodes.findIndex(n => n.id === curNode);
    if (autoIdx >= 0) stagePage = Math.floor(autoIdx / STAGE_PAGE_SIZE);
  }
  // 兜底：选中关不在当前页（切章 / 页内手选后刷新）时跟到它所在页，避免「高亮不见、出战却有效」。
  // 玩家刚手动翻页时（stagePageLock）以页码为准，不能反推回去，否则翻页会立刻弹回旧关那页。
  if (!stagePageLock) {
    const idx = ch.nodes.findIndex(n => n.id === curNode);
    const pg = idx >= 0 ? Math.floor(idx / STAGE_PAGE_SIZE) : stagePage;
    if (pg !== stagePage && pg >= 0 && pg <= stagePages - 1) stagePage = pg;
  }
  if (!Number.isFinite(stagePage) || stagePage < 0) stagePage = 0;
  if (stagePage > stagePages - 1) stagePage = stagePages - 1;
  const pageNodes = ch.nodes.slice(stagePage * STAGE_PAGE_SIZE, (stagePage + 1) * STAGE_PAGE_SIZE);
  const node = ch.nodes.find(n => n.id === curNode) || ch.nodes[0] || { index: 0, elv: 1, stamina: 0, faction: "", title: "—" };
  if (!ch.nodes.some(n => n.id === curNode)) curNode = node.id;
  const nodeLock = nodeLocked(node);
  const clearedN = ch.nodes.filter(n => S.cleared[n.id]).length;
  const stars = ch.nodes.reduce((a, n) => a + (S.cleared[n.id] || 0), 0);
  const canSweep = (S.cleared[node.id] || 0) >= 3;

  $("#scr-stages").innerHTML = `
  <div class="tri with-detail">
    <aside class="panel panel-pad rail">
      <div class="panel-title">章 节</div>
      <div class="chaplist" style="margin-top:10px">
        ${DATA.chapters.map((c, i) => {
          const ok = unlockedCh(i);
          const dn = c.nodes.filter(n => S.cleared[n.id]).length;
          return `<button class="chapbtn ${i === curChap ? "on" : ""} ${ok ? "" : "lock"}" data-chap="${i}">
            <div class="cp">${esc(c.label)}</div>
            <div class="cs num">${ok ? `${dn}/${c.nodes.length} 关 · ★${c.nodes.reduce((a, n) => a + (S.cleared[n.id] || 0), 0)}` : "通关上一章解锁"}</div>
          </button>`;
        }).join("")}
      </div>
    </aside>

    <section class="panel panel-pad">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div class="panel-title">${esc(ch.label)}</div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="panel-sub num">${clearedN}/${ch.nodes.length} 关 · ★${stars}/${ch.nodes.length * 3}</span>
          <button class="btn sm ghost" data-chapview="${ch.chapter}" data-tip="章末回望|本章进度 · 三星与出场之最 · 全通可领章节礼">${I("chapter", "width:13px;height:13px;vertical-align:-2px")} 回 望</button>
        </div>
      </div>
      <div class="nodemap ${stagePages > 1 ? "fill4" : ""}" style="margin-top:14px">
        ${pageNodes.map(n => {
          const st3 = S.cleared[n.id] || 0;
          const lk = nodeLocked(n);
          return `<div class="node ${n.id === curNode ? "on" : ""} ${st3 ? "cleared" : ""} ${n.boss ? "nboss" : ""} ${lk ? "lock" : ""}"
            data-node="${n.id}" ${lk ? `data-tip="${esc((allNodes.find(x => x.id === n.requires) || {}).title || (allNodes.find(x => x.id === n.requires) || {}).name || "前置关卡")}|通关前置关卡后解锁"` : ""}>
            <div class="nodestars">${lk ? `<span class="nlock">${I("lock", "width:12px;height:12px")}</span>` : starIcons(st3, 3)}</div>
            <div class="nk">${esc(n.title || n.name)}</div>
            <div class="nn num">${n.boss ? "关主" : n.kind === "midBoss" ? "小头目" : n.kind === "elite" ? "精英" : "关卡"} · ${String(n.index).padStart(2, "0")} · 敌 Lv.${n.elv}</div>
            ${n.chest && !st3 ? `<span class="chesttag chest-${n.chest.tier}" data-tip="${esc(n.chest.label)}${n.chestMob ? ` · 由${esc(n.chestMob.name || "宝箱妖")}守着，打倒才开箱` : ""}|首通额外：铜钱 +${n.chest.coin} · 缘玉 +${n.chest.jade}">${n.chestMob ? "宝箱妖" : "宝 箱"}</span>` : ""}
          </div>`;
        }).join("")}
      </div>
      ${stagePages > 1 ? `
      <div class="stage-pager">
        <button class="btn sm" data-spp="-1" ${stagePage <= 0 ? "disabled" : ""}>‹ 上一页</button>
        <span class="spg-info">第 <b class="num">${stagePage + 1}</b> / ${stagePages} 页 · 本页 ${stagePage * STAGE_PAGE_SIZE + 1}-${Math.min(ch.nodes.length, (stagePage + 1) * STAGE_PAGE_SIZE)} 关</span>
        <span class="spg-nums">
          ${Array.from({ length: stagePages }, (_, i) => i)
            // 页数少（≤14）时全部平铺固定：翻页时按钮位置不动，只有高亮在走
            .filter(i => stagePages <= 14 || i === 0 || i === stagePages - 1 || Math.abs(i - stagePage) <= 2)
            .map((i, idx, arr) => `${idx > 0 && i - arr[idx - 1] > 1 ? `<span class="spg-gap">…</span>` : ""}
              <button class="btn sm ${i === stagePage ? "primary" : ""}" data-sppage="${i}">${i + 1}</button>`).join("")}
        </span>
        <button class="btn sm" data-spp="1" ${stagePage >= stagePages - 1 ? "disabled" : ""}>下一页 ›</button>
      </div>` : ""}
    </section>

    <aside class="panel panel-pad detail-card">
      <div class="panel-title">关 卡</div>
      <h2 style="font-family:var(--font-display);font-size:20px;letter-spacing:.08em;margin-top:12px">${esc(node.title || node.name)}</h2>
      <div class="panel-sub" style="margin:6px 0 12px">消耗心神 ${node.stamina} · 敌方 Lv.${node.elv} · ${FLABEL(node.faction)}</div>
      <div class="panel-sub">建议战力 ${fmt(Math.round(teamPowerNow() * 0.9))} · 你的编队 ${fmt(teamPowerNow())}</div>
      ${node.mods && node.mods.length ? `<div class="xpe-modrow"><span class="xpe-modhd">${I("sparkle", "width:12px;height:12px;vertical-align:-2px")} 天时词条 · 每条掉落加成</span>${xpeModsHtml(node.mods)}</div>` : ""}
      ${foeListHtml(node)}
      ${(() => {
        const sn = (DATA.story || []).filter(x => x.chapter === (ch.chapter ?? (curChap + 1)) && x.stage === node.index);
        if (!sn.length) return "";
        const bef = sn.find(x => x.when === "before");
        return `<div class="storybar">
          <span class="sbt">${I("story", "width:13px;height:13px;vertical-align:-2px")} ${esc((bef && bef.title) || "本关剧情")}</span>
          <button class="btn sm" data-storyview="${node.id}">回看剧情</button>
        </div>`;
      })()}
      <div style="margin-top:16px;display:grid;gap:9px">
        ${nodeLock
          ? `<button class="btn lg" disabled data-tip="需先通关前置关卡">${I("lock")} 未 解 锁</button>
             <div class="panel-sub" style="text-align:center">通关「${esc((allNodes.find(x => x.id === node.requires) || {}).title || (allNodes.find(x => x.id === node.requires) || {}).name || "前置关卡")}」后开放</div>`
          : `<button class="btn primary lg" data-battle="${node.id}">${I("fight")} 出 战</button>
             ${pillTotal() > 0 ? `<button class="btn sm" data-pilluse="1">${I("pill", "width:13px;height:13px;vertical-align:-2px")} ${esc(pillBtnLabel())}</button>` : ""}`}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
          <button class="btn sm" data-sweep="${node.id}" data-times="1" ${canSweep && !nodeLock ? "" : "disabled"} data-tip="${canSweep ? "扫荡|消耗同等体力直接结算" : "三星后开放扫荡"}">${I("sweep")} 扫荡 ×1</button>
          <button class="btn sm" data-sweep="${node.id}" data-times="5" ${canSweep && !nodeLock ? "" : "disabled"}>${I("sweep")} 扫荡 ×5</button>
        </div>
      </div>
      ${!S.cleared[node.id] ? "" : `<div class="panel-sub" style="margin-top:10px">${I("check", "width:13px;height:13px;vertical-align:-2px")} 已通关 · ${starIcons(S.cleared[node.id], 3)}</div>`}
    </aside>
  </div>`;
}

/* ---------------- 屏：行囊 ---------------- */

let bagTab = "equip";            // 行囊页签：equip 缘器 / assets 材料货币
let bagEquipFilter = "all";
let bagEquipQuery = "";          // 缘器搜索词（按名字）
let bagEquipPage = 1;            // 缘器列表分页
let salBatchArm = false;         // 一键分解二次确认的待确认态
/** 每页件数随窗口高度自适应：一页刚好放下不滚动，剩下的交给分页。 */
function bagEquipPageSize() {
  const rowH = 34;               // 紧凑单行高（含行距）
  const chrome = 330;            // 顶栏+页签+面板骨架的固定占高（含 bag-mode 收窄后的底部留白）
  return Math.max(4, Math.min(12, Math.floor((window.innerHeight - chrome) / rowH)));
}
const EQ_KIND_LABEL = { weapon: "兵刃", artifact: "法宝", talisman: "灵饰", attire: "道袍", exclusive: "专属" };

function renderBag() {
  const tabs = `<div style="display:flex;gap:8px;margin-bottom:10px">
    <button class="btn sm ${bagTab === "equip" ? "primary" : ""}" data-bagtab="equip">${I("gem", "width:13px;height:13px;vertical-align:-2px")} 缘 器</button>
    <button class="btn sm ${bagTab === "assets" ? "primary" : ""}" data-bagtab="assets">${I("pouch", "width:13px;height:13px;vertical-align:-2px")} 材料 · 货币</button>
  </div>`;
  if (bagTab === "assets") { $("#scr-bag").innerHTML = tabs + bagAssetsHtml(); return; }
  $("#scr-bag").innerHTML = tabs + `<div id="bagEquipList"><div class="panel panel-pad"><div class="panel-sub">缘器加载中…</div></div></div>`;
  fillBagEquip();
}

function bagAssetsHtml() {
  const w = S.wallet, st = DATA.currencies;
  const shards = Object.entries(w.shard || {}).filter(([, v]) => v > 0);
  const tomes = Object.entries(w.tome || {}).filter(([, v]) => v > 0);
  // 升星卷（2026-11-06）：六档分开，按阶级显示；没有的档位不铺空卡
  const scrolls = Object.entries(w.starScroll || {}).filter(([, v]) => v > 0);
  const scrollLabel = (k) => (DATA.fate?.starScrolls?.[k] || {}).label || `${k}升星卷`;
  const scrollColor = (k) => (DATA.fate?.starScrolls?.[k] || {}).color || "#9be9ff";
  return `
  <div class="panel panel-pad">
    <div class="panel-title">货 币</div>
    <div class="matgrid" style="grid-template-columns:repeat(4,1fr);margin-top:12px">
      ${[["coin", w.coin, "#c9a227"], ["jade", w.jade, "#7fd1c8"], ["gourd", `${w.stamina}/${staminaCap()}`, "#e0796b"], ["essence", w.essence, "#b78fe0"]].map(([k, v, c]) => {
        const label = st[k]?.label || { gourd: "心神" }[k];
        return `<div class="mat" data-tip="${label}|${st[k]?.note || "体力：每 " + st.stamina.regenMinutesPerUnit + " 分钟回 1 点"}">
          <div class="mbadge" style="color:${c};border-color:${c}55;background:${c}14">${I(k === "gourd" ? "gourd" : k)}</div>
          <div><div class="mn">${label}</div><div class="md num">${typeof v === "number" ? fmt(v) : v}</div></div>
        </div>`;
      }).join("")}
    </div>
  </div>
  <div class="panel panel-pad" style="margin-top:16px">
    <div class="panel-title">材料 · 残卷 · 技能书</div>
    <div class="matgrid" style="margin-top:12px">
      ${Object.entries(w.mat || {}).filter(([, v]) => v > 0).map(([k, v]) => {
        const meta = DATA.materials[k] || { label: k, color: "#888" };
        return `<div class="mat" data-tip="${meta.label}|${meta.note || ""}">
          <div class="mbadge" style="color:${meta.color};border-color:${meta.color}55;background:${meta.color}14">${I({ page: "page", note: "note", scroll: "scroll", pill: "pill", soul: "gem" }[k] || "gem")}</div>
          <div><div class="mn">${meta.label}</div><div class="md">${meta.note || ""}</div></div>
          <span class="mcnt num">${fmt(v)}</span>
        </div>`;
      }).join("")}
      ${tomes.map(([k, v]) => `<div class="mat"><div class="mbadge" style="color:#e8c98a">${I("tome")}</div>
        <div><div class="mn">${({ diamond: "晶钻", red: "红阶", gold: "金阶", purple: "紫阶", blue: "蓝阶", green: "绿阶" }[k] || k)}技能书</div><div class="md">技能升级</div></div><span class="mcnt num">${fmt(v)}</span></div>`).join("")}
      ${shards.map(([k, v]) => `<div class="mat"><div class="mbadge" style="color:#d9a13b">${I("gem")}</div>
        <div><div class="mn">${({ ur: "红阶", ssr: "金阶", sr: "紫阶", r: "蓝阶", n: "绿阶" }[k] || k)}通用残卷</div><div class="md">旧版材料 · 仅作收藏</div></div><span class="mcnt num">${fmt(v)}</span></div>`).join("")}
      ${scrolls.map(([k, v]) => `<div class="mat" data-tip="${scrollLabel(k)}|升星唯一材料：1→2 星 1 张、2→3 星 2 张……9→10 星 9 张，满星共 45 张">
        <div class="mbadge" style="color:${scrollColor(k)};border-color:${scrollColor(k)}55;background:${scrollColor(k)}14">${I("gem")}</div>
        <div><div class="mn">${scrollLabel(k)}</div><div class="md">角色升星</div></div><span class="mcnt num">${fmt(v)}</span></div>`).join("")}
    </div>
  </div>
  ${xpeConvertHtml()}
  <div class="panel panel-pad" style="margin-top:16px">
    <div class="panel-title">生 涯</div>
    <div class="statgrid" style="margin-top:12px">
      ${[["累计抽取", SUM.pulls], ["十连次数", S.stats.tenPulls || 0], ["出战次数", SUM.battles], ["胜场", SUM.wins],
         ["通关关卡", SUM.stagesCleared], ["累计星数", SUM.stars],
         ["图鉴收集", `${SUM.collected}/${DATA.characters.length}`], ["编队战力", fmt(teamPowerNow())]]
        .map(([k, v]) => `<div class="sg"><div class="k">${k}</div><div class="v num">${typeof v === "number" ? fmt(v) : v}</div></div>`).join("")}
    </div>
  </div>`;
}

/** 缘器页：逐件单行卡（穿者/等级/突破阶）+ 穿戴/强化/突破/分解，全部走服务端同口径数值。
 *  紧凑单行 + 每页件数随窗口高度自适应：一页放下不滚动，剩下的交给分页；支持按名字搜索。 */
async function fillBagEquip() {
  const host = $("#bagEquipList");
  if (!host) return;
  salBatchArm = false;
  const refocus = document.activeElement && document.activeElement.id === "bagEquipSearch";
  const j = await api({ type: "bag" }).catch(() => null);
  if (!host.isConnected) return;
  if (!j || !j.bag) { host.innerHTML = `<div class="panel panel-pad"><div class="panel-sub">缘器加载失败</div></div>`; return; }
  const items = j.bag;
  const EQ = DATA.equip || {};
  const btMax = EQ.btMax || 10;
  const nameOf = (id) => (charById(id) || {}).name || id;
  // 同名 fodder 计数（未穿戴、非本命）——突破按钮的 have/need 就地显示，不让玩家点完才被拒
  const fodderCnt = {};
  for (const it of items)
    if (!it.exclusive && !it.equippedBy && it.name) fodderCnt[it.name] = (fodderCnt[it.name] || 0) + 1;
  const soulHave = S.wallet?.mat?.soul || 0;
  const filters = [["all", "全部"], ["weapon", "兵刃"], ["artifact", "法宝"], ["talisman", "灵饰"], ["attire", "道袍"], ["exclusive", "专属"], ["worn", "穿戴中"], ["free", "未穿戴"]];
  const q = bagEquipQuery.toLowerCase();
  const filtered = items.filter((it) =>
    bagEquipFilter === "all" ? true
    : bagEquipFilter === "worn" ? !!it.equippedBy
    : bagEquipFilter === "free" ? !it.equippedBy
    : it.kind === bagEquipFilter);
  const list = q ? filtered.filter((it) => (it.name || "").toLowerCase().includes(q)) : filtered;
  const PAGESZ = bagEquipPageSize();
  const pages = Math.max(1, Math.ceil(list.length / PAGESZ));
  if (bagEquipPage > pages) bagEquipPage = pages;
  if (bagEquipPage < 1) bagEquipPage = 1;
  const pageItems = list.slice((bagEquipPage - 1) * PAGESZ, bagEquipPage * PAGESZ);
  const rows = pageItems.map((it) => {
    const rc = RCOLOR(it.rarity);
    const bt = it.bt || 0;
    const need = EQ.btFodder ? EQ.btFodder[Math.min(bt, btMax - 1)] : bt + 1;
    const have = fodderCnt[it.name] || 0;
    const btCoin = EQ.btCoin ? EQ.btCoin[Math.min(bt, btMax - 1)] : 0;
    const soulTip = EQ.soulCost ? (EQ.soulCost[it.rarity] || 1) * (1 + Math.floor(it.level / 4)) : 0;
    const coinTip = Math.round(800 * (it.level + 1) * ({ red: 3.0, gold: 2.4, purple: 1.8, blue: 1.2, green: 0.8 }[it.rarity] || 1));
    // 器纹（PLAYABLE P1-2）：主纹存在 save.equip.items，buildView 已抽成 S.itemRunes；
    // 重铸保底进度在 S.runePity（grade≥3 归零），pityLeft = 总次数 - 已歪次数。
    const rn = S.itemRunes?.[it.uid] || null;
    const rm = rn ? runeMeta(rn.key) : null;
    const gmul = rn ? ((EQ.gradeMul || [])[rn.grade] ?? 1) : 0;
    const pityLeft = Math.max(0, (EQ.reforgePity ?? 8) - (S.runePity?.[it.uid] || 0));
    const ops = [];
    if (it.equippedBy) ops.push(`<button class="btn sm ghost" data-eqwear2="${it.uid}" data-tip="更换|将从 ${esc(nameOf(it.equippedBy))} 身上换下">更 换</button>`);
    else if (!it.exclusive) ops.push(`<button class="btn sm primary" data-eqwear2="${it.uid}">穿 戴</button>`);
    ops.push(`<button class="btn sm" data-equp="${it.uid}" data-tip="强化|铜钱 ${fmt(coinTip)} + 器魂 ${soulTip}">强 化</button>`);
    if (!it.exclusive && rn) {
      ops.push(`<button class="btn sm" data-eqreforge="${it.uid}" data-tip="重铸|纹砂 ×4 · 重洗档位（1~5 档，${EQ.reforgePity ?? 8} 次保底 3 档）· 距保底还剩 ${pityLeft} 次">重 铸</button>`);
    } else if (!it.exclusive) {
      ops.push(`<button class="btn sm" data-eqengrave="${it.uid}" data-tip="刻纹|纹砂 ×10 + 铜钱 ×2000 · 随机六纹之一（1~3 档）· 同角色穿 2/4 件同名纹激活套装">刻 纹</button>`);
    }
    if (!it.exclusive) {
      const btTip = bt >= btMax ? "已达最高 10 阶"
        : `同名缘器 ${have}/${need} · 铜钱 ${fmt(btCoin)} · 全属性再 +${Math.round((bt + 1) * (EQ.btRate || 0.06) * 100)}%`;
      ops.push(`<button class="btn sm" data-eqbrk="${it.uid}" ${bt >= btMax || have < need ? "disabled" : ""} data-tip="突破|${btTip}">突 破</button>`);
    }
    if (!it.equippedBy && !it.exclusive)
      ops.push(`<button class="btn sm" data-eqsal="${it.uid}" data-tip="分解|得器魂 ×${it.salvage || 1}">分 解</button>`);
    const who = it.equippedBy
      ? `<span class="bagmeta who">穿戴中 · ${esc(nameOf(it.equippedBy))}${EQ_KIND_LABEL[it.equippedByKind] ? " · " + EQ_KIND_LABEL[it.equippedByKind] : ""}</span>`
      : it.exclusive ? `<span class="bagmeta who">本命 · ${esc(nameOf(it.exclusiveFor))}</span>` : "";
    const runeBadge = rn
      ? `<span class="rtag runetag" style="color:#d9a13b;border-color:#d9a13b" data-tip="器纹 · ${esc(rm.name)} ${rn.grade} 档|档位系数 ×${gmul} · 二件套：${esc(fxDesc(rm.two))} · 四件套：${esc(fxDesc(rm.four))}（同角色穿戴同名纹按平均档激活）">纹·${esc(rm.name)} ${rn.grade}档</span>`
      : "";
    return `<div class="bagrow eqrow" style="border-color:${rc}44" data-tip="${esc(it.desc)}">
      <img class="bagic" src="${it.icon}" alt="" data-fb="rm">
      <div class="bagmain">
        <span class="bagt" style="color:${rc}">${esc(it.name)}</span>
        ${runeBadge}
        <span class="baglv">Lv.${it.level}</span>
        ${bt ? `<span class="rtag bt" style="color:var(--gold);border-color:var(--gold)">突破${bt}阶</span>` : ""}
        <span class="bagmeta">${EQ_KIND_LABEL[it.kind] || it.kind} · ${RTAG(it.rarity)}${it.sub ? " · 词条" : ""}</span>
        ${who}
      </div>
      <div class="bagops">${ops.join("")}</div>
    </div>`;
  }).join("");
  host.innerHTML = `
  <div class="panel" style="padding:12px 14px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div class="panel-title">缘 器</div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="panel-sub" style="margin:0">共 ${items.length} 件 · 器魂 <b class="num" style="color:#8fb6e0">${fmt(soulHave)}</b>${q ? ` · 命中 ${list.length} 件` : ""}</span>
        <input id="bagEquipSearch" value="${esc(bagEquipQuery)}" placeholder="搜索缘器名字…" spellcheck="false"
          style="width:200px;padding:6px 12px;border-radius:10px;border:1px solid #ffffff22;background:#0d0b1477;color:var(--ink);font-size:13px;outline:none">
        ${bagEquipQuery ? `<button class="btn sm ghost" data-eqclear="1">清空</button>` : ""}
      </div>
    </div>
    <div class="chipwrap" style="margin-top:7px">
      ${filters.map(([k, l]) => `<button class="fchip ${bagEquipFilter === k ? "on" : ""}" data-eqfilter="${k}">${l}</button>`).join("")}
    </div>
    <div style="margin-top:7px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <button id="eqSalBatchBtn" class="btn sm ghost" data-eqsalbatch="1">${I("gem", "width:13px;height:13px;vertical-align:-2px")} 一键分解未穿戴的 凡器 / 利器 / 灵器（绿 · 蓝 · 紫）</button>
      <button class="btn sm ghost" data-go="eforge">${I("gem", "width:12px;height:12px;vertical-align:-2px")} 缘器阁</button>
      <button class="btn sm ghost" data-go="roster">${I("book", "width:12px;height:12px;vertical-align:-2px")} 去穿戴</button>
      <span style="flex:1"></span>
      ${pages > 1 ? `<div style="display:flex;align-items:center;gap:7px">
        <button class="btn sm" data-eqpage="prev" ${bagEquipPage <= 1 ? "disabled" : ""}>上一页</button>
        <span class="num" style="font-size:12px;color:var(--faint)">第 ${bagEquipPage} / ${pages} 页 · 本类 ${list.length} 件</span>
        <button class="btn sm" data-eqpage="next" ${bagEquipPage >= pages ? "disabled" : ""}>下一页</button>
      </div>` : ""}
    </div>
    <div style="margin-top:7px">${rows || `<div class="panel-sub" style="padding:10px 0">${q ? "没有名字命中的缘器。" : "这一类下还没有缘器 —— 去「缘器阁」开匣获得。"}</div>`}</div>
  </div>`;
  // 搜索框：重渲染后保持焦点与光标在词尾
  const inp = $("#bagEquipSearch");
  if (inp) {
    inp.addEventListener("input", () => {
      bagEquipQuery = inp.value.trim();
      bagEquipPage = 1;
      fillBagEquip();
    });
    if (refocus) { inp.focus(); const L = inp.value.length; inp.setSelectionRange(L, L); }
  }
}

/* ---------------- 屏：缘器阁（缘器抽签） ---------------- */

let eqTicketTarget = null;       // 本命签当前选定的目标角色

/** 本命签卡：抽「本命铸魂券」的池——券是铸魂本命缘器的必需材料，集齐方可铸魂（铜钱照常）。 */
function ticketCard() {
  const tk = DATA.equip?.tickets || { price: 260, tenDisc: 0.9, pulls: 3, cost: 3, soul: 8 };
  const bk = eqTicketTarget ? ((S.benming || {})[eqTicketTarget] || { t: 0, p: 0 }) : null;
  const tgtName = eqTicketTarget ? ((charById(eqTicketTarget) || {}).name || eqTicketTarget) : "";
  return `
  <div class="panel panel-pad" style="margin-top:16px">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div class="mbadge" style="width:44px;height:44px;color:#d9a13b;border-color:#d9a13b55;background:#d9a13b14;flex:0 0 auto">${I("book")}</div>
      <div style="flex:1;min-width:240px">
        <div class="panel-title" style="font-size:16px">本 命 签 · 铸 魂 券</div>
        <div class="panel-sub" style="margin-top:2px">每抽 <b style="color:#d9a13b">30%</b> 概率直接得 1 张选定角色的「本命铸魂券」，且每 ${tk.pulls} 抽必得 1 张（保底）；集齐 ${tk.cost} 张可为本命缘器铸魂（铸魂仍需铜钱），本命缘器满级后可用券继续突破升缘（最高 6 缘）。本命已铸成且满缘后，每抽转器魂 ×${tk.soul}。</div>
        <div class="panel-sub" style="margin-top:4px;color:#c9a227">抽取消耗 <b>尘缘</b>（与金阶匣同价系，<b>不消耗缘玉</b>）：单抽 ${fmt(tk.price)} 尘缘 · 十连 ${fmt(Math.round(tk.price * 10 * tk.tenDisc))} 尘缘。</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn ${eqTicketTarget ? "" : "primary"}" data-eqtkpick>${eqTicketTarget ? esc(tgtName) : "选 目 标"}</button>
        <button class="btn" data-eqticket="1" ${eqTicketTarget ? "" : "disabled"}>单 抽 <b class="num">${fmt(tk.price)}</b> <span class="tk-cur">尘缘</span></button>
        <button class="btn primary" data-eqticket="10" ${eqTicketTarget ? "" : "disabled"}>十 连 <b class="num">${fmt(Math.round(tk.price * 10 * tk.tenDisc))}</b> <span class="tk-cur">尘缘</span></button>
      </div>
    </div>
    ${bk ? `<div class="panel-sub" style="margin-top:10px;text-align:center">目标 <b style="color:#d9a13b">${esc(tgtName)}</b> · 铸魂券 <b class="num" style="color:#d9a13b">${bk.t}/${tk.cost}</b> · 下一张进度 <b class="num">${bk.p}/${tk.pulls}</b>${bk.t >= tk.cost ? " · <b style='color:#d9a13b'>铸魂券已集齐</b>（铸魂 / 升缘用 · 见强化弹窗）" : ""}</div>` : ""}
  </div>`;
}

function renderEforge() {
  const eq = DATA.equip || {};
  const w = S.wallet;
  const coinCost = eq.chests?.coin?.cost ?? 4200, goldCost = eq.chests?.gold?.cost ?? 260;
  const disc = eq.chests?.tenDisc ?? 0.9;
  const chestCard = (key, title, sub, unit, unitColor, cost, ic) => `
    <div class="panel panel-pad" style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="mbadge" style="width:44px;height:44px;color:${unitColor};border-color:${unitColor}55;background:${unitColor}14">${I(ic)}</div>
        <div><div class="panel-title" style="font-size:16px">${title}</div>
        <div class="panel-sub">${sub}</div></div>
      </div>
      <div class="statgrid" style="grid-template-columns:1fr 1fr">
        <div class="sg"><div class="k">单价</div><div class="v num" style="color:${unitColor}">${fmt(cost)} <span style="font-size:11px">${unit}</span></div></div>
        <div class="sg"><div class="k">十连 · 九折</div><div class="v num" style="color:${unitColor}">${fmt(Math.round(cost * 10 * disc))} <span style="font-size:11px">${unit}</span></div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn" data-epull="${key}:1">${I("sparkle")} 单 抽</button>
        <button class="btn primary" data-epull="${key}:10">${I("sparkle")} 十 连</button>
      </div>
    </div>`;
  $("#scr-eforge").innerHTML = `
  <div class="panel panel-pad">
    <div class="panel-title">缘 器 阁</div>
    <div class="panel-sub" style="margin-top:6px">
      兵刃 / 法宝 / 灵饰 / 道袍四类缘器皆由开匣获得：部位与稀有度随机，并随机卷出一条副词条。
      多余缘器可在行囊分解为器魂，同名缘器可突破。
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      ${chestCard("coin", "缘 器 匣", "铜钱开匣 · 随机稀有度", "铜钱", "#b78fe0", coinCost, "gem")}
      ${chestCard("gold", "金 阶 匣", "尘缘开匣 · 保底金阶以上", "尘缘", "#c9a227", goldCost, "essence")}
    </div>

    ${ticketCard()}
    <div class="panel-sub" style="margin-top:14px;text-align:center">
      稀有度公示：${(() => {
        // 权重由服务端下发（tools/lib/equip.mjs 的 CHEST_WEIGHT 是唯一真值），别在前端再抄一份百分比。
        const cw = eq.chestWeights || { red: 5, gold: 8, purple: 24, blue: 33, green: 30 };
        return [["red", "UR"], ["gold", "SSR"], ["purple", "SR"], ["blue", "R"], ["green", "N"]]
          .map(([k, tag]) => `${tag} ${cw[k]}%`).join(" · ");
      })()}
      ｜当前 ${I("coin", "width:12px;height:12px;vertical-align:-2px")} <b class="num">${fmt(w.coin)}</b> · ${I("essence", "width:12px;height:12px;vertical-align:-2px")} <b class="num">${fmt(w.essence)}</b>
    </div>
  </div>`;
}

/** 缘器开匣揭示：与缘阁抽角色共用同一套翻牌浮层（卡背 → 逐张点击翻开 → UR/SSR 翻开特效）。
 *  卡面结构必须与 screens-main.js 的 showReveal 保持同构（fcard/inner/fface.back/fface.front/fx），
 *  否则 revealOne()/revealAllCards() 的 .flip/.glow/.burst 逻辑不会生效。 */
function showEquipReveal(items) {
  revealPending = items.map((it) => ({ rarity: it.rarity }));
  cancelRevealAll();
  /* 复用了抽卡的翻牌浮层，但缘器开匣没有「保底获得」的概念：
   * 上一次抽卡留下的 #revealPity 说明条必须先清掉，
   * 否则开匣时会看到上一池的「第 N 抽 · 某某（晶钻）」保底文案串场。 */
  const pityBar = $("#revealPity");
  if (pityBar) { pityBar.innerHTML = ""; pityBar.classList.remove("on"); }
  const grid = $("#revealGrid");
  grid.style.setProperty("--cols", revealCols(items.length));
  grid.innerHTML = items.map((it, i) => {
    const rc = RCOLOR(it.rarity);
    const isTk = it.kind === "ticket", isMiss = it.kind === "miss", isSoul = it.kind === "soul";
    const icon = it.exclusive ? `/data/exclusive/${it.exclusiveFor}.svg`
      : isTk ? (it.icon || "/art/equip/ticket_gold.svg")
      : isMiss ? (it.icon || "/art/equip/talisman_gold.png")
      : isSoul ? "/art/equip/artifact_purple.png"
      : `/art/equip/${it.kind}_${it.rarity}.png`;
    // 未得券 / 转器魂也要有像样的结果卡：失败不是没有演出，而是翻出一张「签」/「魂」说明去向
    const seal = isTk ? "命" : isMiss ? "签" : isSoul ? "魂" : "器";
    const tier = fxTierOf(it.rarity);               // UR/SSR 走与角色卡相同的翻开特效
    const badge = (isTk || isMiss) ? `<span class="badge-new" style="background:linear-gradient(120deg,#e8c26a,#c98d3f)">本命签</span>`
      : it.rarity === "red" ? `<span class="badge-new" style="background:linear-gradient(120deg,#d0563c,#a03028)">UR</span>`
      : it.rarity === "gold" ? `<span class="badge-new" style="background:linear-gradient(120deg,#e8c26a,#c98d3f)">SSR</span>` : "";
    const name = isTk ? (it.name || "本命铸魂券")
      : isMiss ? "签 意 渐 聚"
      : isSoul ? "器 魂"
      : (it.name || EQ_KIND_LABEL[it.kind] || it.kind);
    const sub = isTk ? "集齐 3 张方可铸魂本命缘器"
      : isMiss ? `${esc(it.tgt || "目标角色")} · 下一张券进度 ${it.progress || 0}/${it.pulls || 3}`
      : isSoul ? (it.overflow ? "铸魂券溢出 · 按张折算器魂" : "本命已铸成且满缘 · 抽签尽数化为器魂")
      : `${EQ_KIND_LABEL[it.kind] || it.kind}${it.sub ? ` · 词条` : ""}`;
    const tag = isTk ? "铸魂券"
      : isMiss ? `再抽 ${Math.max(1, (it.pulls || 3) - (it.progress || 0))} 次必得券`
      : isSoul ? `器魂 ×${it.soul || 0}`
      : RTAG(it.rarity);
    const tagColor = (isTk || isMiss) ? "#d9a13b" : isSoul ? "#b78fe0" : rc;
    return `<div class="fcard${tier ? " " + RARITY_FX[tier].cls : ""}" data-i="${i}" data-r="${it.rarity || ""}" style="--delay:${i * 0.05}s;--rc:${rc}">
      <div class="inner">
        <div class="fface back"><div class="seal">${seal}</div></div>
        <div class="fface front fx-${tier || "none"}" style="border-color:${rc}88">
          <div class="rline" style="border-color:${rc};color:${rc}"></div>
          ${rarityFxHtml(tier)}
          ${badge}
          <img class="eqart" src="${icon}" alt="" data-fb="rm" style="width:68%;height:auto;margin:16% auto 0;display:block;object-fit:contain;position:relative;z-index:1;filter:drop-shadow(0 6px 14px rgba(0,0,0,.45))">
          <div class="fin">
            <b style="font-size:14px">${esc(name)}</b>
            <span style="font-size:11px;color:var(--dim)">${sub}</span>
            <span class="rtag" style="justify-self:start;color:${tagColor};border-color:${tagColor}">${tag}</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join("");
  $("#reveal").classList.add("on");
  // 卡背展示期间预热全部正面图，点「全部翻开」时不再临时解码
  grid.querySelectorAll(".fface.front img").forEach(img => { if (img.decode) img.decode().catch(() => {}); });
  blip(760, .09);
}

/* ---------------- 屏：坊市 ---------------- */

let shopTab = "essence";
function renderShop() { renderShopTab(); }
function renderShopTab() {
  const lines = DATA.shop[shopTab] || [];
  $("#scr-shop").innerHTML = `
  <div style="display:flex;gap:12px;margin-bottom:16px">
    <button class="btn ${shopTab === "essence" ? "primary" : ""}" data-shoptab="essence">尘 缘 阁 · 周限购</button>
    <button class="btn ${shopTab === "coin" ? "primary" : ""}" data-shoptab="coin">铜 钱 坊 市 · 日限购</button>
    <div style="flex:1"></div>
    <div class="res"><span style="color:${shopTab === "essence" ? "#b78fe0" : "#c9a227"}">${I(shopTab === "essence" ? "essence" : "coin")}</span><b class="num">${fmt(shopTab === "essence" ? S.wallet.essence : S.wallet.coin)}</b></div>
  </div>
  <div class="goods-grid">
    ${lines.map(l => {
      const bought = S.stocks[l.key] || 0;
      const maxStock = l.stockPerWeek ?? l.stockPerDay ?? 99;
      const stock = maxStock - bought;
      const sold = stock <= 0;
      const gives = l.gives || {};
      const desc = gives.fateOf ? "任选一名已拥有角色 · 缘 +1（价格按角色阶级）"
        : gives.stamina ? `恢复心神 ${gives.stamina} 点`
        : Object.entries(gives).map(([k, v]) => `${(DATA.materials[k] || {}).label || (k.startsWith("tome:") ? "技能书" : k)} ×${v}`).join(" · ");
      const icon = gives.fateOf ? "scroll" : Object.keys(gives)[0]?.startsWith("tome") ? "tome" : gives.stamina ? "gourd" : ({ page: "page", note: "note", scroll: "scroll", pill: "pill" }[Object.keys(gives)[0]] || "gem");
      const color = gives.fateOf ? "#d9a13b" : (DATA.materials[Object.keys(gives)[0]] || {}).color || "#b78fe0";
      return `<div class="goods ${sold ? "sold" : ""}" style="border-color:${sold ? "" : color + "44"}">
        <div class="gbadge" style="color:${color};border-color:${color}55;background:${color}12">${I(icon)}</div>
        <div class="gmid">
          <div class="gt">${esc(l.label)}</div>
          <div class="gd">${desc}</div>
          <div class="gprice">${I(shopTab === "essence" ? "essence" : "coin")} ${fmt(l.costEach)} ${shopTab === "essence" ? "尘缘起" : "铜钱"}</div>
          <div class="gstock num">${sold ? "已售罄" : `${shopTab === "essence" ? "本周" : "今日"}余 ${stock}`}</div>
        </div>
        <div class="gact">
          ${sold ? `<button class="btn sm" disabled>售 罄</button>`
                 : `<button class="btn sm ${shopTab === "essence" ? "primary" : ""}" data-buy="${l.key}" ${gives.fateOf ? 'data-fateof="1"' : ""}>购 买</button>`}
        </div>
      </div>`;
    }).join("")}
  </div>`;
}
function pickTarget(key, count) {
  const owned = Object.keys(S.owned);
  const line = (DATA.shop[shopTab] || []).find(x => x.key === key) || {};
  const n = Math.max(1, count || 1);
  const ds = DATA.fate?.directScroll || {};
  const priceOf = (id) => (ds[charById(id)?.rarity] || {}).cost ?? (line.costEach || 0);
  modal(`<div class="menu" style="width:680px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="panel-title">选择定向残卷的赠予对象 · 缘 +${n}</div>
      <button class="iconbtn" data-close>${I("close")}</button></div>
    <div class="panel-sub" style="margin-top:6px">定向残卷改为「任选一名已拥有角色缘 +1」，价格按该角色阶级计算；6 缘圆满的角色不可再使用。</div>
    <div class="cgrid" style="grid-template-columns:repeat(5,1fr);margin-top:16px;max-height:56vh;overflow:auto">
      ${owned.map(id => {
        const c = charById(id);
        const fate = (S.owned[id]?.fate || 0);
        const price = priceOf(id);
        const max = fate >= 6;
        return `<div data-fategift="${id}|${key}|${n}" style="cursor:pointer;text-align:center;opacity:${max ? .35 : 1};pointer-events:${max ? "none" : "auto"}">
          <div class="avatar" style="width:100%;aspect-ratio:1;height:auto">${artImg(id)}</div>
          <div style="font-size:12px;margin-top:6px">${esc(c.name)}</div>
          <div style="font-size:11px;color:#d9a13b">${max ? "6缘圆满" : `${fate}缘 → ${fate + n}缘 · ${fmt(price * n)} 尘缘`}</div></div>`;
      }).join("")}
    </div>
  </div>`);
}
async function doBuy(key, fateOf) {
  if (fateOf) return pickTarget(key, 1);
  const j = await call({ type: "shop", key, count: 1 });
  if (j) { toast("已购入"); blip(700, .08); renderShopTab(); renderResBar(); }
}
async function doGift(gift) {
  const [targetId, key, nRaw] = gift.split("|");
  const n = Math.max(1, +nRaw || 1);
  const j = await call({ type: "shop", key, count: n, targetId });
  if (j && j.buy && !j.buy.error) { closeModal(); toast(`${charById(targetId).name} · 缘 +${j.buy.fateGain || n}（现 ${j.buy.fate} 缘）`); renderShopTab(); renderResBar(); }
  else if (j && j.buy && j.buy.error) toast(j.buy.error);
}

/* ---------------- 屏：洞府（P3：灵田 + 四建筑 + 炼丹） ---------------- */

let manorTimer = null;
const n1 = x => (Math.round((x || 0) * 10) / 10).toLocaleString("zh-CN");
const DF_TIER = { 1: "一转", 2: "二转", 3: "三转" };
const dfQLab = q => ((DATA.manorB?.quality || {}).label || {})[q] || q;
const dfQCol = q => ((DATA.manorB?.quality || {}).color || {})[q] || "#9aa3b2";

async function renderManor() {
  const [jm, jb] = await Promise.all([
    api({ type: "manor" }).catch(() => null),
    api({ type: "manorB" }).catch(() => null),
  ]);
  const M = jm?.manor;
  const B = jb?.manorB;               // { state:[{key,label,desc,res,resLabel,lv,rate,cap,stock,upCost,atCap}], pills }
  if (!M || !B) { $("#scr-manor").innerHTML = `<div class="panel panel-pad"><div class="panel-sub">加载失败</div></div>`; return; }
  const fmtLeft = ms => {
    const s2 = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s2 / 60)).padStart(2, "0")}:${String(s2 % 60).padStart(2, "0")}`;
  };
  const heldYaocao = S.wallet.mat?.yaocao || 0;
  // 灵田开垦：有上限 + 只收缘玉（价格/上限都由服务端算，前端只显示）
  const rcMax = M.maxPlots || 9;
  const rcFull = !!M.reclaimFull || M.state.length >= rcMax;
  const rcCost = M.reclaimCost || 0;
  const rcTip = rcFull
    ? `灵田上限|灵田最多 ${rcMax} 块，开垦已达上限`
    : `开垦新田|缘玉 ${fmt(rcCost)} 多开一块田 · 上限 ${rcMax} 块（还差 ${Math.max(0, rcMax - M.state.length)} 块）`;
  const rcLabel = rcFull ? "灵 田 已 满" : `开 垦 · ${fmt(rcCost)} 缘 玉`;
  const QORD = ["ex", "hi", "mid", "lo"];
  const pillRows = Object.entries(B.pills || {})
    .map(([key, bands]) => {
      const r = (DATA.manorB.recipes || []).find(x => x.key === key);
      if (!r) return null;
      const qs = QORD.map(q => ({ q, n: bands[q] || 0 })).filter(x => x.n > 0);
      if (!qs.length) return null;
      return { name: r.name, qs, total: qs.reduce((a, b) => a + b.n, 0) };
    })
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);
  $("#scr-manor").innerHTML = `
  <div class="panel panel-pad" style="margin-bottom:14px">
    <div class="panel-title">洞 府</div>
    <div class="panel-sub" style="margin-top:6px">灵田种药、丹房煨丹，剑冢与聚灵阵昼夜不歇——离线也在为你积攒家当。</div>
  </div>
  <div class="df-grid">
    <div class="panel panel-pad df-field">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="panel-title">灵 田 <span class="bsy-total">${M.state.length} / ${rcMax} 块 · 离线也生长</span></div>
        <button class="btn sm" data-mreclaim="1" ${!rcFull && (S.wallet.jade || 0) >= rcCost ? "" : "disabled"}
          data-tip="${rcTip}">${rcLabel}</button>
      </div>
      <div class="plotgrid" style="margin-top:12px">
        ${M.state.map((p, i) => {
          if (!p) return `<div class="plot" data-plant="${i}" style="cursor:pointer">
            <div class="picon">${I("plus")}</div><div class="pt">空 田</div>
            <div class="ps">点击播种</div></div>`;
          const crop = M.crops.find(c => c.key === p.crop);
          return `<div class="plot ${p.ready ? "ready" : "growing"}">
            <div class="picon">${I(crop.key === "grain" ? "leaf" : crop.key === "dew" ? "jade" : crop.key === "cloud" ? "pill" : "sparkle")}</div>
            <div class="pt">${crop.label}</div>
            <div class="ps">${p.ready ? "已成熟" : `剩余 <b class="num" data-mtimer="${i}">${fmtLeft(p.left)}</b>`}</div>
            <button class="btn sm ${p.ready ? "primary" : ""}" data-harvest="${i}" ${p.ready ? "" : "disabled"}>${p.ready ? "收 获" : "生长中"}</button>
            <div class="ps">${crop.note}</div>
          </div>`;
        }).join("")}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px" id="cropPick">
        ${M.crops.map(c => `<button class="btn sm" data-crop="${c.key}" data-tip="${c.label}|${c.note}">${c.label}</button>`).join("")}
      </div>
      <div class="panel-sub" style="margin-top:8px">先选一种作物，再点空田播种。</div>
    </div>
    ${(B.state || []).map(b => {
      const max = !b.upCost || b.lv >= 10;
      const pct = Math.max(0, Math.min(100, b.cap > 0 ? (b.stock / b.cap) * 100 : 0));
      const def = (DATA.manorB.buildings || []).find(x => x.key === b.key);
      return `<div class="panel panel-pad df-bcard">
        <div class="dfb-top"><span class="dfb-name">${esc(b.label)}</span><span class="dfb-lv num">Lv.${b.lv}</span></div>
        <div class="dfb-desc">${esc(b.desc)}</div>
        <div class="dfb-rate">${esc(b.resLabel)} <b class="num">${n1(b.rate)}</b> / 时</div>
        <div class="dfb-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="dfb-stock num">${n1(b.stock)} / ${n1(b.cap)}${b.atCap ? ` · <span class="dfb-cap">已满 ${def?.capHours ?? 8} 小时</span>` : ""}</div>
        <div class="dfb-btns">
          <button class="btn sm" data-mbcol="${esc(b.key)}" ${b.stock < 1 ? "disabled" : ""} data-tip="收取|${esc(b.resLabel)} +${Math.floor(b.stock)}">收 取</button>
          <button class="btn sm" data-mbup="${esc(b.key)}" ${max || S.wallet.coin < b.upCost ? "disabled" : ""}
            data-tip="升级|铜钱 ${fmt(b.upCost)} · 下一级产出按倍率提升">${max ? "M A X" : `升 级 <b class="num">${fmt(b.upCost)}</b>`}</button>
        </div>
      </div>`;
    }).join("")}
  </div>
  <div class="panel panel-pad" style="margin-top:14px">
    <div class="panel-title">炼 丹 <span class="bsy-total">火候越准，药力越足 · 灵药持有 <b class="num">${fmt(heldYaocao)}</b></span></div>
    <div class="df-recipes">
      ${(DATA.manorB.recipes || []).map(r => {
        const need = r.need || {};
        const lackY = heldYaocao < (need.yaocao || 0);
        const lackC = S.wallet.coin < (need.coin || 0);
        return `<div class="df-recipe">
          <div class="dfr-main">
            <span class="dfr-name">${esc(r.name)}<i class="dfr-tier">${DF_TIER[r.tier] || (r.tier + "转")}</i></span>
            <span class="dfr-desc">${esc(r.desc)}</span>
          </div>
          <div class="dfr-need num">
            <span class="${lackY ? "lack" : ""}" data-tip="灵药|当前持有 ${fmt(heldYaocao)}">灵药 ${need.yaocao || 0} / ${fmt(heldYaocao)}</span>
            <span class="${lackC ? "lack" : ""}">铜钱 ${fmt(need.coin || 0)}</span>
          </div>
          <button class="btn sm primary" data-brewgo="${esc(r.key)}" ${lackY || lackC ? "disabled" : ""}>开 炉</button>
        </div>`;
      }).join("")}
    </div>
    ${pillRows.length ? `<div class="df-pills">
      <div class="panel-sub" style="margin-bottom:2px">我 的 丹 药</div>
      ${pillRows.map(p => `<div class="df-pillrow"><b>${esc(p.name)}</b>
        ${p.qs.map(x => `<span class="df-pillq"><i class="df-qdot" style="background:${dfQCol(x.q)}"></i>${esc(dfQLab(x.q))} <span class="num">×${x.n}</span></span>`).join("")}
      </div>`).join("")}
    </div>` : `<div class="panel-sub" style="margin-top:12px">还没有存丹。炼好的丹药在出征开战前点「用 药」服下。</div>`}
  </div>`;
  // 灵田倒计时
  clearInterval(manorTimer);
  const lefts = M.state.map(p => p ? p.left : null);
  manorTimer = setInterval(() => {
    let anyReady = false;
    $$("[data-mtimer]").forEach(el => {
      const i = +el.dataset.mtimer;
      if (lefts[i] == null) return;
      lefts[i] -= 1000;
      if (lefts[i] <= 0) { anyReady = true; return; }
      el.textContent = fmtLeft(lefts[i]);
    });
    if (anyReady) { clearInterval(manorTimer); renderManor(); }
  }, 1000);
}

let pickCrop = null;
async function doPlant(i) {
  if (!pickCrop) return toast("先在「灵田」下方选一种作物");
  const j = await call({ type: "manorPlant", plot: i, crop: pickCrop });
  if (j) {
    if (j.manorErr) return toast(j.manorErr);
    toast("已播种"); renderManor();
  }
}
async function doHarvest(i) {
  const j = await call({ type: "manorHarvest", plot: i });
  if (j) {
    if (j.manorErr) return toast(j.manorErr);
    const r = j.reward || {};
    toast("收获 · " + Object.entries(r).map(([k, v]) => `${{coin: "铜钱", jade: "缘玉", pill: "洗髓丹"}[k] || k}+${v}`).join(" "));
    AudioSys.sfx("coin");
    renderResBar(); renderManor();
  }
}

/* —— 火候小游戏：指针 0→1→0 匀速往返（一个来回约 1.2s），「定 火」提交停点 —— */

let brewRAF = null, brewStart = 0, brewVal = 0, brewCloseTimer = null;
function brewLoop(ts) {
  // 弹窗已被关掉（取消 / 遮罩 / Esc）就自然熄火，不再提交
  if (!document.getElementById("brewBar")) { brewRAF = null; return; }
  if (!brewStart) brewStart = ts;
  const t = ((ts - brewStart) / 600) % 2;      // 0.6s 去 + 0.6s 回 = 1.2s 一个来回
  brewVal = t < 1 ? t : 2 - t;
  const n = document.getElementById("brewNeedle");
  if (n) n.style.left = (brewVal * 100).toFixed(2) + "%";
  brewRAF = requestAnimationFrame(brewLoop);
}
function brewStop() { if (brewRAF) { cancelAnimationFrame(brewRAF); brewRAF = null; } }

function openBrew(key) {
  const r = (DATA.manorB?.recipes || []).find(x => x.key === key);
  if (!r) return;
  if (brewCloseTimer) { clearTimeout(brewCloseTimer); brewCloseTimer = null; }
  const bands = (DATA.manorB?.quality || {}).bands || {};
  const colors = (DATA.manorB?.quality || {}).color || {};
  const band = (b, q) => b ? `<i class="bb-band" style="left:${b[0] * 100}%;width:${(b[1] - b[0]) * 100}%;background:${colors[q] || "#9aa3b2"}"></i>` : "";
  const mark = (b, q) => b ? `<span style="left:${((b[0] + b[1]) / 2) * 100}%;color:${colors[q] || "#9aa3b2"}">${esc(dfQLab(q))}</span>` : "";
  brewVal = 0; brewStart = 0;
  modal(`<div class="menu brew-modal" style="width:540px">
    <div class="panel-title" style="text-align:center">炼 丹 · ${esc(r.name)}</div>
    <div class="panel-sub" style="text-align:center;margin-top:4px">${esc(r.desc)}</div>
    <div class="brew-bar" id="brewBar">
      ${band(bands.mid, "mid")}${band(bands.hi, "hi")}${band(bands.ex, "ex")}
      <span class="bb-needle" id="brewNeedle" style="left:0%"></span>
    </div>
    <div class="brew-scale num">
      <span style="left:2%;transform:none">0</span>
      ${mark(bands.mid, "mid")}${mark(bands.hi, "hi")}${mark(bands.ex, "ex")}
      <span style="left:auto;right:0;transform:none">1</span>
    </div>
    <div class="brew-res" id="brewRes">看准色带，点「定 火」收势——停得越准，品质越高。</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px">
      <button class="btn" data-close>取 消</button>
      <button class="btn primary" id="brewSetBtn" data-brewset="${esc(key)}">定 火</button>
    </div>
  </div>`);
  brewRAF = requestAnimationFrame(brewLoop);
}

async function doBrewSet(key) {
  brewStop();
  const pct = Math.round(brewVal * 1000) / 1000;
  const btn = document.getElementById("brewSetBtn");
  if (btn) btn.disabled = true;
  const res = document.getElementById("brewRes");
  const j = await call({ type: "brew", recipe: key, pct });
  const r = j && j.brew;
  if (!r || r.error) {
    if (res) res.innerHTML = `<span style="color:#d0563c">${esc((r && r.error) || "炼制失败，材料不足。")}</span>`;
    // 失败也要能继续：恢复按钮 + 重新起针，否则指针停死等于卡住
    if (btn) { btn.disabled = false; btn.textContent = "定 火"; }
    const bar = document.getElementById("brewBar"), nd = document.getElementById("brewNeedle");
    if (bar) bar.classList.remove("done");
    if (nd) { nd.classList.remove("set"); nd.style.left = "0%"; }
    brewVal = 0; brewStart = 0;
    if (bar && !brewRAF) brewRAF = requestAnimationFrame(brewLoop);
    blip(300, .08);
    return;
  }
  // 成丹：定针高亮 + 按钮改「收 炉」+ toast，1.2s 后自动收炉并滚到「我的丹药」
  const bar = document.getElementById("brewBar"), nd = document.getElementById("brewNeedle");
  if (nd) nd.classList.add("set");
  if (bar) bar.classList.add("done");
  if (res) res.innerHTML = `炼成 <b style="color:${dfQCol(r.quality)}">${esc(dfQLab(r.quality))}</b> ${esc(r.name)} ×1`;
  if (btn) { btn.disabled = true; btn.textContent = "收 炉"; }
  blip(820, .12);
  toast(`成丹 · ${dfQLab(r.quality)} ${r.name} ×1`);
  renderResBar();
  await renderManor();     // 幕后刷新「我的丹药」与材料余量（等它渲染完，收炉后才好滚过去）
  if (brewCloseTimer) clearTimeout(brewCloseTimer);
  brewCloseTimer = setTimeout(() => {
    brewCloseTimer = null;
    if (!document.getElementById("brewBar")) return;   // 玩家已自己关掉
    closeModal();
    const row = document.querySelector(".df-pillrow");
    if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 1200);
}

/* ---------------- 屏：历练副本（真） ---------------- */

const DOW = ["日", "一", "二", "三", "四", "五", "六"];
function renderDungeons() {
  const byType = {};
  DATA.dungeons.forEach(d => {
    const type = d.type === "coin" ? "coin" : d.type === "skill" ? "skill" : d.type === "star" ? "star" : "exp";
    (byType[type] = byType[type] || []).push(d);
  });
  $("#scr-dungeons").innerHTML = `
  <div class="panel panel-pad" style="margin-bottom:16px">
    <div class="panel-title">历 练 副 本</div>
    <div class="panel-sub" style="margin-top:4px">日常资源循环：经验 / 铜钱 / 技能书 / 残卷。三星通关后可扫荡。</div>
    <div class="panel-sub" style="margin-top:4px;color:#7fd1c8">${I("jade", "width:13px;height:13px;vertical-align:-2px")} 每日历练奖励：前 <b class="num">${DATA.dungeonDaily?.times ?? 3}</b> 次通关各得 <b class="num">缘玉 +${DATA.dungeonDaily?.jade ?? 30}</b>（今日已领 <b class="num">${S.daily?.dungeonJade || 0}</b>/${DATA.dungeonDaily?.times ?? 3}，挑战与扫荡都算）</div>
  </div>
  <div class="dungrid">
    ${Object.entries(byType).map(([type, ds]) => {
      const meta = { exp: { label: "修行·经验", icon: "page", color: "#9aa3b2" }, coin: { label: "坊市·铜钱", icon: "coin", color: "#c9a227" },
                     skill: { label: "心法·技能书", icon: "tome", color: "#6f9bd1" }, star: { label: "星盘·残卷", icon: "gem", color: "#d9a13b" } }[type]
                || { label: type, icon: "gem", color: "#888" };
      return `<div class="duncard open" style="border-color:${meta.color}44">
        <div class="dt"><span style="color:${meta.color}">${I(meta.icon, "width:22px;height:22px")}</span><b>${meta.label}</b></div>
        <div style="display:grid;gap:8px">
          ${ds.map(d => {
            const st3 = S.cleared[d.id] || 0;
            return `<div class="rowitem" style="padding:8px 12px">
            <div class="grow"><div class="t" style="font-size:13px">${esc(d.name.split("·").slice(-1)[0])} <span class="num" style="color:var(--faint)">· 敌 Lv.${d.elv} ${st3 ? `· ★${st3}` : ""}</span></div>
            <div class="s num">体力 ${d.stamina}</div></div>
            <button class="btn sm" data-battle="${d.id}">挑战</button>
            <button class="btn sm ghost" data-sweep="${d.id}" data-times="1" ${st3 >= 3 ? "" : "disabled"}>扫荡</button>
          </div>`;
          }).join("")}
        </div>
      </div>`;
    }).join("")}
  </div>`;
}

/* ---------------- 屏：登仙塔（真） ---------------- */

let towerSel = "";
/* 打完一层后自动选中「下一个可挑战层」（首个未通关层）；页内点层不清零，玩家的选择保留。 */
let towerAutoPick = true;
function renderTower() {
  const floors = DATA.tower.list;
  const curFloor = floors.find(f => !S.cleared[f.id]) || floors.at(-1);
  if (towerAutoPick || !towerSel || !floors.some(f => f.id === towerSel)) towerSel = curFloor.id;
  towerAutoPick = false;
  const selFloor = floors.find(f => f.id === towerSel);
  // 层行点击=选中（右侧看详情再开打），不直接进战斗；解锁线（≤当前层）以内的层都可选中再战
  const rows = floors.filter(f => f.index <= curFloor.index + 3).map(f => {
    const st3 = S.cleared[f.id] || 0;
    const open = f.index <= curFloor.index;
    return `<div class="tfloor ${st3 ? "done play" : open ? "cur play" : "lock"} ${f.id === towerSel ? "sel" : ""}" ${open ? `data-tower="${f.id}" role="button" tabindex="0"` : ""}>
      <span class="num" style="width:44px">第 ${f.index} 层</span>
      <span style="font-size:12px">${f.boss ? "关主" : "小妖"} · 敌方 Lv.${f.elv || "?"}</span>
      <span class="fs">${st3 ? `★${st3}` : open ? "可挑战" : "未解锁"}</span></div>`;
  }).join("");
  const selOpen = selFloor.index <= curFloor.index;
  const selStars = S.cleared[selFloor.id] || 0;
  // 已通关层数：按塔层顺序连续统计（与服务端 towerClearedCount 同一口径，跳层不算）
  let clearedCount = 0;
  for (const f of floors) { if ((S.cleared[f.id] || 0) > 0) clearedCount++; else break; }
  const msList = (DATA.tower && DATA.tower.milestones) || [];
  const msText = (m) => [
    m.char ? `${RTAG(m.char.rarity)}角色 ×${m.char.count}` : "",
    m.equip ? `${RTAG(m.equip.rarity)}缘器 ×${m.equip.count}` : "",
  ].filter(Boolean).join(" + ");
  const msRows = msList.map((m) => {
    const done = !!(S.towerMilestones && S.towerMilestones[m.floor]);
    const reached = clearedCount >= m.floor;
    return `<div class="tms ${done ? "done" : reached ? "reached" : ""}">
      <span class="tms-f num">第 ${m.floor} 层</span>
      <span class="tms-r">${msText(m)}</span>
      <span class="tms-s">${done ? "已领取" : reached ? "已达成" : `还差 ${m.floor - clearedCount} 层`}</span>
    </div>`;
  }).join("");
  // 整屏 innerHTML 重绘会重建 .towercol，滚动位置归零——点下面层就表现为"自己跳回最上面"。
  // 与名册同理：重建前接住滚动位置（列表自身 + 小窗口下的整页滚动），重建后原样还回去。
  const towerCol = $("#scr-tower .towercol");
  const towerScrollTop = towerCol ? towerCol.scrollTop : 0;
  const winY = scrollY;
  $("#scr-tower").innerHTML = `
  <div class="tower-wrap">
    <section class="panel panel-pad">
      <div class="panel-title">登 仙 塔</div>
      <div class="panel-sub" style="margin:8px 0 12px">共 ${DATA.tower.floors} 层 · 每 5 层一个关主。检验编队深度，也给凹配置的玩家一个去处。已通关的层可随时回来再战（不重发首通奖励）。</div>
      <div class="towercol">${rows}</div>
    </section>
    <div style="display:grid;gap:16px;align-content:start">
      <section class="panel panel-pad" style="text-align:center">
        <div class="panel-sub">${selStars ? `已通关 · ★${selStars}` : selOpen ? "待挑战" : "未解锁"}</div>
        <div style="font-family:var(--font-display);font-size:56px;color:var(--gold);margin:6px 0" class="num">第 ${selFloor.index} 层</div>
        <div class="panel-sub">${selFloor.boss ? "关主坐镇" : "小妖把守"} · 敌方 Lv.${selFloor.elv || "?"} · 塔内不耗体力</div>
        ${selOpen
          ? `<button class="btn primary lg" style="margin-top:16px" data-battle="${selFloor.id}">挑 战</button>`
          : `<div class="panel-sub" style="margin-top:16px">先通过前面的层</div>`}
      </section>
      <section class="panel panel-pad">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <div class="panel-title">里 程 碑</div>
          <span class="panel-sub">已通 ${clearedCount} 层 · 最高 ${DATA.tower.floors} 层</span>
        </div>
        <div class="panel-sub" style="margin:6px 0 10px">首次通关指定层数时自动发放（角色已拥有则按重复卡折算尘缘）；每档只发一次，老存档达到后自动补发。</div>
        <div class="tmscol">${msRows || `<div class="panel-sub">暂无里程碑配置</div>`}</div>
      </section>
    </div>
  </div>`;
  const towerColNew = $("#scr-tower .towercol");
  if (towerColNew && towerScrollTop) towerColNew.scrollTop = towerScrollTop;
  if (winY) scrollTo({ top: winY });
}

/* ---------------- 屏：成就（真） ---------------- */

let achValues = {};
/* 成就分档：服务端带 group/category 就直接用，否则按 id 前缀归档（与 meta.mjs 的家族同构） */
const XPE_ACHV_META = {
  first:   { label: "初 启", icon: "achvCup",   note: "第一场胜利" },
  stage:   { label: "征 程", icon: "flag",      note: "主线关卡推进" },
  stars:   { label: "摘 星", icon: "star",      note: "累计星级" },
  tower:   { label: "登 仙", icon: "towerTall", note: "登仙塔层数" },
  collect: { label: "结 缘", icon: "bondKnot",  note: "图鉴收集" },
  pulls:   { label: "问 缘", icon: "knot",      note: "累计抽取" },
  wins:    { label: "武 勋", icon: "sword",     note: "胜场累积" },
  nodeath: { label: "完 璧", icon: "shield",    note: "无阵亡胜场" },
  fast:    { label: "疾 风", icon: "clock",     note: "三星速通" },
  xingsha: { label: "星 命", icon: "constellation", note: "星砂积累" },
};
const XPE_ACHV_ORDER = ["first", "stage", "stars", "tower", "collect", "pulls", "wins", "nodeath", "fast", "xingsha"];
/* 成就屏分页状态：组页签 = 页面卡片，组内再按窗口高度分页（替代原来的整屏长滚动） */
let achvGroup = "first", achvPage = 0;
function achvPageSize() { return Math.max(4, Math.min(8, Math.floor((innerHeight - 360) / 70))); }

async function renderAchv() {
  const stats = [...new Set(DATA.achievements.map(a => a.stat))];
  const j = await api({ type: "achValues", stats }).catch(() => null);
  achValues = j?.values || {};
  const list = DATA.achievements;
  const famOf = a => {
    if (a.group != null) return String(a.group);
    if (a.category != null) return String(a.category);
    const p = String(a.id || "").split("-")[0];
    return p === "first" ? "first" : p;
  };
  const groups = new Map();
  for (const a of list) {
    const k = famOf(a);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const groupKeys = [...groups.keys()].sort((x, y) => {
    const ix = XPE_ACHV_ORDER.indexOf(x), iy = XPE_ACHV_ORDER.indexOf(y);
    return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
  });
  if (!groupKeys.includes(achvGroup)) achvGroup = groupKeys[0] || "first";
  const curVal = a => Math.min(achValues[a.stat] ?? 0, a.goal);
  const claimable = list.filter(a => !S.achClaimed.includes(a.id) && curVal(a) >= a.goal);
  const rows = groups.get(achvGroup) || [];
  const size = achvPageSize();
  const pages = Math.max(1, Math.ceil(rows.length / size));
  achvPage = Math.min(achvPage, pages - 1);
  const pageRows = rows.slice(achvPage * size, achvPage * size + size);

  const tabs = `<div class="achv-tabs">${groupKeys.map(k => {
    const meta = XPE_ACHV_META[k] || { label: k, icon: "achvCup", note: "成就" };
    const g = groups.get(k);
    const done = g.filter(a => S.achClaimed.includes(a.id)).length;
    return `<button class="achv-tab ${k === achvGroup ? "on" : ""}" data-achvg="${esc(k)}"
      data-tip="${esc(meta.label)}|${esc(meta.note)} · 已领 ${done}/${g.length}">
      ${I(meta.icon, "width:14px;height:14px")}
      <span class="at">${esc(meta.label)}</span>
      <span class="an num">${done}/${g.length}</span>
    </button>`;
  }).join("")}</div>`;

  const pager = pages > 1 ? `<div class="achv-pager">
    <button class="btn sm" data-achvp="-1" ${achvPage <= 0 ? "disabled" : ""}>‹ 上一页</button>
    <span class="num">第 ${achvPage + 1}/${pages} 页</span>
    <button class="btn sm" data-achvp="1" ${achvPage >= pages - 1 ? "disabled" : ""}>下一页 ›</button>
  </div>` : "";

  $("#scr-achv").innerHTML = `
  <div class="tri" style="grid-template-columns:1fr 360px">
    <section class="panel panel-pad">
      <div style="display:flex;justify-content:space-between;align-items:center;min-height:32px">
        <div class="panel-title">成 就</div>
        <div class="achv-claimslot">${claimable.length ? `<button class="btn sm primary" data-achall="1">${I("gift", "width:13px;height:13px")} 一键领取 · ${claimable.length} 项</button>`
          : `<span class="tag dim">暂无可领取</span>`}</div>
      </div>
      ${tabs}
      <div class="xpe-achv-sec">
        <div class="xpe-achv-hd">${(() => {
          const meta = XPE_ACHV_META[achvGroup] || { label: achvGroup, icon: "achvCup", note: "成就" };
          return `${I(meta.icon, "width:15px;height:15px")} ${esc(meta.label)}<span class="n num">${rows.length} 项 · ${esc(meta.note)}</span>`;
        })()}</div>
        <div class="xpe-achv-rows">
          ${pageRows.map(a => {
            const v = achValues[a.stat] ?? 0;
            const cur = Math.min(v, a.goal);
            const done = cur >= a.goal, claimed = S.achClaimed.includes(a.id);
            const rw = Object.entries(a.reward || {}).map(([k2, m]) => `${DATA.currencies[k2]?.label || k2} ×${fmt(m)}`).join(" · ");
            return `<div class="achrow" style="${claimed ? "opacity:.5" : ""}">
              <div class="ai">${I(done ? "check" : "trophy")}</div>
              <div class="am"><div class="at">${esc(a.label)}</div><div class="ad">${esc(a.desc)}</div>
                <div class="bar tiny" style="margin-top:8px"><i style="width:${Math.min(100, cur / a.goal * 100)}%"></i></div></div>
              <div class="ach-act-wrap">
                <div class="apct num">${fmt(cur)}/${fmt(a.goal)}</div>
                <div class="ar">${rw}</div>
                <div class="ach-act">${claimed ? `<span class="tag dim">已领取</span>`
                  : done ? `<button class="btn sm primary" data-ach="${a.id}">领取</button>` : ""}</div>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>
      ${pager}
    </section>
    <aside class="panel panel-pad" style="align-self:start">
      <div class="panel-title">每 日</div>
      <div style="display:grid;gap:9px;margin-top:14px">
        <div class="rowitem"><div class="grow">
          <div class="t">每日签到 ${S.daily.loginClaimed ? `<span class="tag dim">已领取</span>` : ""}</div>
          <div class="s num">铜钱 ×${fmt(DATA.daily.login.coin)} · 心神 +${DATA.daily.login.stamina}</div></div>
          <div class="daily-claimslot">${S.daily.loginClaimed ? "" : `<button class="btn sm primary" data-act="login">领取</button>`}</div>
        </div>
        <div class="rowitem"><div class="grow">
          <div class="t">势力首胜</div>
          <div class="s num">每个势力每日首胜 · 铜钱 +${fmt(DATA.daily.firstWinPerFaction.coin)} · 缘玉 +${DATA.daily.firstWinPerFaction.jade}</div></div>
          <button class="btn sm" data-go="stages">出征</button>
        </div>
      </div>
      <div class="pity-box" style="margin-top:16px;border:1px solid rgba(232,201,138,.3);border-radius:var(--r-m);padding:14px">
        <div class="panel-title">生 涯</div>
        <div class="statgrid" style="grid-template-columns:1fr 1fr;margin-top:10px">
          <div class="sg"><div class="k">胜场</div><div class="v num">${fmt(SUM.wins)}</div></div>
          <div class="sg"><div class="k">抽卡</div><div class="v num">${fmt(SUM.pulls)}</div></div>
          <div class="sg"><div class="k">累计星数</div><div class="v num">${fmt(SUM.stars)}</div></div>
          <div class="sg"><div class="k">图鉴</div><div class="v num">${SUM.collected}/${DATA.characters.length}</div></div>
        </div>
      </div>
    </aside>
  </div>`;
}

/* ---------------- 屏：物志（万妖谱 + 奇遇录，二期 P2） ---------------- */

let bestiaryKin = "";

function renderBestiary() {
  const best = DATA.bestiary || { kins: [], list: [] };
  const rec = S.bestiary || {};
  if (!best.kins.includes(bestiaryKin)) bestiaryKin = best.kins[0] || "";
  const kinList = k => best.list.filter(b => b.kin === k);
  const kills = b => rec[b.id] || 0;
  const totalGot = best.list.filter(b => kills(b) >= 1).length;

  const kinTabs = best.kins.map(k => {
    const all = kinList(k);
    const got = all.filter(b => kills(b) >= 1).length;
    return `<button class="bsy-kintab ${k === bestiaryKin ? "on" : ""}" data-bkin="${esc(k)}">
      <span class="bk">${esc(k)} 族</span><span class="bn num">${got}/${all.length}</span>
    </button>`;
  }).join("");

  // 集齐奖励：当前族全收录且未领 → 高亮；已领 → 置灰文案；未齐 → 置灰 + 差几只
  const curAll = kinList(bestiaryKin);
  const curGot = curAll.filter(b => kills(b) >= 1).length;
  const claimed = !!(rec.claimed || {})[bestiaryKin];
  const rwTxt = "铜钱×10000 · 星砂×5";
  let claimHtml;
  if (!bestiaryKin) claimHtml = "";
  else if (claimed) claimHtml = `<span class="tag dim" data-tip="集齐奖励|${esc(rwTxt)} · 本族奖励已领取">${I("check", "width:13px;height:13px")} 集齐奖励 · 已领取</span>`;
  else if (curAll.length && curGot >= curAll.length)
    claimHtml = `<button class="btn sm primary" data-kinclaim="${esc(bestiaryKin)}">${I("gift", "width:13px;height:13px")} 领取${esc(bestiaryKin)}族集齐奖励 · ${esc(rwTxt)}</button>`;
  else
    claimHtml = `<button class="btn sm" disabled data-tip="集齐奖励|收录本族全部妖物后可领：${esc(rwTxt)} · 还差 ${curAll.length - curGot} 种">集齐奖励 · 还差 ${curAll.length - curGot} 种</button>`;

  /* 每只妖都配一张自己的图：已收录显示真图（头像裁切），未收录保留暗色剪影 + ？。
     图片从 data/characters/<id>/art/ 取，和名册/图鉴同一套资产，不另建目录。
     万妖谱不分页：单族最多十几只，一屏网格就能排满，拆页反而留下半屏空白。 */
  const cards = curAll.map(b => {
    const n = kills(b), rc = RCOLOR(b.rarity);
    // BOSS 有专属宽幅立绘；小怪用同一套角色资产。景别缺失时按链式回退（头像→全身→卡面→抠图），
    // 任何一张能出图都比直接删图留一个黑框强（data-fb 支持逗号分隔降级链，见 settle.js）。
    const bossImg = `<img src="/art/bosses/${esc(b.id)}.png" alt="" data-fb="rm">`;
    // 万妖谱卡面是玩家第一眼看到的内容，不用 loading="lazy"：屏幕从隐藏切到可见的瞬间，
    // 懒加载图可能还没开始请求，整屏会先黑一片（用户截图里「什么都没有」的观感来源之一）。
    const mug = `<img src="${art(b.id, "avatar")}" alt="" data-fb="portrait,card,standee">`;
    const img = b.boss ? bossImg : mug;
    const artHtml = `<div class="bsy-art">${img}
      ${b.boss ? `<i class="bsy-boss bsy-boss-art">首</i>` : ""}
      ${n >= 1 ? "" : `<span class="bsy-q">？</span>`}
    </div>`;
    if (n >= 1) return `<div class="bsy-card" data-bentry="${esc(b.id)}" data-tip="${esc(b.name)}|点击查看详情">
      ${artHtml}
      <div class="bsy-body">
        <div class="bsy-card-top">
          <span class="bsy-name" style="color:${rc}">${esc(b.name)}</span>
          ${n >= 10 ? `<span class="bsy-fam">熟稔</span>` : ""}
        </div>
        <div class="bsy-sub">击杀 <b class="num">${n}</b> 次</div>
      </div>
    </div>`;
    return `<div class="bsy-card lock" data-tip="未收录|战胜它一次即可录入物志">
      ${artHtml}
      <div class="bsy-body">
        <div class="bsy-card-top"><span class="bsy-unk">？？？</span></div>
        <div class="bsy-sub">尚未收录</div>
      </div>
    </div>`;
  }).join("");


  const advs = S.adventures || [];
  const advRows = advs.length ? advs.map(a => `<div class="bsy-advrow">
      <span class="bsy-adv-t">${esc(a.title || "奇遇")}</span>
      <span class="rtag bsy-adv-l">${esc(a.label || "")}</span>
      <span class="bsy-adv-x">${esc(a.text || "")}</span>
      <span class="bsy-adv-g">${esc(a.gains || "")}</span>
    </div>`).join("")
    : `<div class="panel-sub">尚未遭遇奇缘（战胜后偶发）</div>`;

  $("#scr-bestiary").innerHTML = `
  <div class="panel panel-pad">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div class="panel-title">万 妖 谱<span class="bsy-total num">已收录 ${totalGot}/${best.list.length}</span></div>
      ${claimHtml}
    </div>
    <div class="bsy-kintabs">${kinTabs}</div>
    <div class="bsy-grid">${cards}</div>
  </div>
  <div class="panel panel-pad" style="margin-top:14px">
    <div class="panel-title">奇 遇 录</div>
    <div class="bsy-advs">${advRows}</div>
  </div>`;
}

/** 敌人详情：物志条目（万妖谱）与出征关卡「本关敌人」共用同一套详情弹窗。
 *  opts.level / opts.stageName：从关卡点进来时补充「本关 Lv.x」与当前关名，避免只显示首次出没地。 */
function openBestiaryEntry(id, opts = {}) {
  const b = ((DATA.bestiary || {}).list || []).find(x => x.id === id);
  if (!b) {
    const nm = (DATA.mobs || {})[id];
    const name = typeof nm === "string" ? nm : (nm && nm.name);
    if (!name) return;
    return modal(`<div class="menu" style="width:420px">
      <div class="panel-title" style="text-align:center">${esc(name)}</div>
      <div class="panel-sub" style="text-align:center;margin-top:8px">${opts.stageName ? `出没：${esc(opts.stageName)}` : "出没：行踪不定"}${opts.level ? ` · 本关 Lv.${opts.level}` : ""}</div>
      <button class="btn" data-close style="width:100%;margin-top:16px">关 闭</button>
    </div>`, { dimClose: true });
  }
  const n = (S.bestiary || {})[id] || 0;
  const rc = RCOLOR(b.rarity);
  // 技能三段（普攻/终结技/被动）：档案来自 data/characters/<id>/character.json（服务端 enrich 后下发）
  const skills = Array.isArray(b.skills) ? b.skills : [];
  const SK_LABEL = { attack: "普攻", ultimate: "终结技", passive: "被动" };
  const skRows = skills.length ? skills.map((s) => `
    <div class="bsy-skrow">
      <div class="bsy-skhead">
        <span class="bsy-skname">${esc(s.name || "")}</span>
        <span class="rtag">${esc(s.type || SK_LABEL[s.slot] || "")}</span>
        ${s.energy != null ? `<span class="rtag">怒气 ${s.energy}</span>` : ""}
        ${s.cd != null ? `<span class="rtag">冷却 ${s.cd} 回合</span>` : ""}
      </div>
      <div class="bsy-skdesc">${esc(s.desc || "")}</div>
    </div>`).join("") : `<div class="bsy-skdesc">此妖无记载招式。</div>`;
  // 数值：档案 base + 每级成长，敌人等级按出没关取值估算
  const lv = Math.max(1, parseInt(opts.level || b.level || 1, 10) || 1);
  const st = b.stats || {};
  const statRows = [
    ["生命", st.hp], ["攻击", st.atk], ["防御", st.def], ["法防", st.mdef],
    ["速度", st.spd], ["暴击", st.crit], ["怒气", st.erg],
  ].filter(([, v]) => v && typeof v.base === "number").map(([label, v]) => {
    const val = v.base + (v.growth || 0) * (lv - 1);
    return `<span class="rtag">${esc(label)} ${Number.isInteger(val) ? val : val.toFixed(2)}</span>`;
  }).join("");
  // 左栏立绘：小怪用自己档案里的立绘（portrait → standee → card 逐级回退），BOSS 用 boss 立绘；
  // 右栏是文字档案。图片缺失时逐级回退，避免出现破图。
  // 注意：页面 CSP 拦内联事件属性，回退链只能用 JS 挂（下面 attachHeroFallback）。
  const chain = [...new Set([art(b.id, "portrait"), art(b.id, "standee"), art(b.id, "card")])];
  const heroSrc = b.boss ? `/art/bosses/${esc(b.id)}.png` : chain[0];
  const heroChain = b.boss ? [heroSrc, ...chain] : chain;
  const m = modal(`<div class="menu bsy-detail" style="width:760px">
    <div class="bsy-cols">
      <div class="bsy-col-l">
        <div class="bsy-hero bsy-hero-portrait"><img id="bsyHeroImg" src="${heroSrc}" alt="" loading="lazy" data-fb="rm">
          ${b.boss ? `<i class="bsy-boss bsy-hero-boss">首</i>` : ""}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:12px">
          <div class="panel-title" style="color:${rc}">${esc(b.name)}</div>
          <span class="rtag" style="color:${rc};border-color:${rc}">${RTAG(b.rarity)}</span>
        </div>
        <div class="panel-sub" style="margin-top:2px">${esc(b.title || "")}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 2px">
          <span class="rtag" style="color:${ECOLOR(b.element)};border-color:${ECOLOR(b.element)}">${esc(ELABEL(b.element))}</span>
          <span class="rtag">${esc(RLABEL(b.role))}${RPOS(b.role) ? ` · ${esc(RPOS(b.role))}` : ""}</span>
          <span class="rtag">${esc(b.kin)} 族</span>
          ${b.boss ? `<span class="rtag" style="color:#e8c98a;border-color:#e8c98a">首领</span>` : ""}
        </div>
        ${(b.roleTagline || b.factionLabel) ? `<div class="bsy-meta" style="margin-top:8px">
          <span>${esc(b.factionLabel || "")}${b.roleTagline ? ` · ${esc(b.roleTagline)}` : ""}</span>
        </div>` : ""}
        ${b.outfit ? `<div class="bsy-lore" style="margin-top:8px">形貌：${esc(b.outfit)}</div>` : ""}
      </div>
      <div class="bsy-col-r">
        <div class="bsy-lore">${esc(b.lore || "")}</div>
        ${statRows ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 2px">${statRows}</div>` : ""}
        <div class="bsy-skhd">招 式</div>
        ${skRows}
        <div class="bsy-meta">
          <span>出没：${opts.stageName ? esc(opts.stageName) : (b.stageName ? esc(b.stageName) : "随队出没，行踪不定")}${opts.level ? ` · 本关 Lv.${opts.level}` : ""}</span>
          <span>击杀：<b class="num">${n}</b> 次${n >= 10 ? ` · <span style="color:#e8c98a">熟稔</span>` : ""}</span>
        </div>
      </div>
    </div>
    <button class="btn" data-close style="width:100%;margin-top:14px">关 闭</button>
  </div>`, { dimClose: true });
  // 立绘逐级回退：portrait → standee → card（页面 CSP 拦内联 onerror，只能用 JS 挂）
  const img = m && m.querySelector("#bsyHeroImg");
  if (img) {
    let i = 0;
    img.addEventListener("error", () => {
      i++;
      if (i < heroChain.length) img.src = heroChain[i];
    });
  }
  return m;
}

/* ---------------- 屏：羁绊 ---------------- */

let bondFilter = "all";

const BOND_KIND = {
  faction: { label: "同门", color: "#e8c98a", note: "同势力二人成绊" },
  element: { label: "同气", color: "#8f7cc0", note: "同六气二人成绊" },
  role: { label: "同阵", color: "#6fa8d4", note: "同定位二人成绊" },
  own: { label: "拥有", color: "#c9a35a", note: "拥有即生效，不必上阵" },
  deploy: { label: "固定阵", color: "#5ba883", note: "成员全部同阵上阵才生效" },
};

const STAT_LABEL = { atk: "攻击", hp: "生命", def: "防御", mdef: "法防", spd: "速度", crit: "暴击", erg: "怒气" };

/** 当前编队/拥有情况已达成的羁绊（与服务端 bondBonuses 同规则） */
function activeBonds() {
  const team = S.team || [];
  const owned = Object.keys(S.owned || {});
  return (DATA.bonds || []).filter(b => bondActiveClient(b, team, owned));
}

/** 与 tools/lib/bonds.mjs 的 bondActive 同规则：同门/同气/同阵 ≥2 上阵；own 全拥有；deploy 全上阵 */
function bondActiveClient(b, team, owned) {
  const members = b.members || [];
  if (!members.length) return false;
  if (b.kind === "own") return members.every(m => owned.includes(m));
  if (b.kind === "deploy") return members.every(m => team.includes(m));
  return members.filter(m => team.includes(m)).length >= 2;
}

/** 编队级羁绊合计，用于顶部展示真实生效数值 */
function bondTally() {
  const t = { n: 0, atk: 1, hp: 1, def: 1, mdef: 1, spd: 1, crit: 0, erg: 1 };
  for (const b of activeBonds()) {
    t.n++;
    for (const [stat, mul] of Object.entries(b.bonus || {})) {
      if (mul === 1) continue;
      if (stat === "crit") t.crit += (mul - 1);
      else if (stat in t) t[stat] *= mul;
    }
  }
  return t;
}

function renderBonds() {
  const team = S.team || [];
  const list = (DATA.bonds || []).filter(b => bondFilter === "all" || b.kind === bondFilter);
  const act = activeBonds();
  const t = bondTally();
  const num = v => (Math.round((v - 1) * 100) > 0 ? `+${Math.round((v - 1) * 100)}%` : "");

  $("#scr-bondstory").innerHTML = `
  ${subBack("羁 绊")}
  <div class="panel panel-pad" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
      <div>
        <div class="panel-title">羁 绊</div>
        <div class="panel-sub" style="margin-top:6px">参与成员 ≥2 人即成绊，<b style="color:var(--gold)">加成直接进战斗面板</b>（与缘器加成相乘叠加）。</div>
      </div>
      <div class="bondtally" data-tip="统计口径|只统计当前上阵编队：同一羁绊内凑齐 ≥2 名成员即「成绊」生效；多个羁绊的同类加成按乘法叠加（暴击为加法）。成员未上阵则不计入。">
        <div class="btl"><span class="k">已成绊</span><b class="v num">${act.length}</b></div>
        ${Object.entries(STAT_LABEL).map(([k, lb]) => {
          const v = k === "crit" ? (t.crit > 0 ? `+${Math.round(t.crit * 100)}%` : "") : num(t[k]);
          return v ? `<div class="btl on"><span class="k">${lb}</span><b class="v num">${v}</b></div>` : "";
        }).join("")}
        ${act.length ? "" : `<div class="btl"><span class="k">尚未成绊</span></div>`}
      </div>
    </div>
    <div class="chipwrap" style="margin-top:14px">
      ${["all", "faction", "element", "role", "own", "deploy"].map(k => {
        const n = k === "all" ? DATA.bonds.length : DATA.bonds.filter(b => b.kind === k).length;
        return `<button class="fchip ${bondFilter === k ? "on" : ""}" data-bondf="${k}">${k === "all" ? "全部" : BOND_KIND[k].label}<span class="cnt num">${n}</span></button>`;
      }).join("")}
    </div>
  </div>

  <div class="bondgrid">
    ${list.map(b => {
      const ownedCnt = b.members.filter(m => S.owned[m]).length;
      const onCnt = b.members.filter(m => team.includes(m)).length;
      const on = bondActiveClient(b, team, Object.keys(S.owned || {}));
      const kd = BOND_KIND[b.kind] || { label: b.kind, color: "#888" };
      const statChips = Object.entries(b.bonus || {})
        .filter(([, v]) => v !== 1)
        .map(([k, v]) => `<span class="bstat">${STAT_LABEL[k] || k} ${k === "crit" ? "+" : "+"}${Math.round((v - 1) * 100)}%</span>`)
        .join("");
      // own：拥有即生效；deploy：全员同阵；其余：上阵 ≥2
      let foot;
      if (on) foot = `<span style="color:var(--green)">${b.kind === "own" ? "已生效" : "已成绊"} ${b.kind === "own" ? ownedCnt : onCnt}/${b.members.length}</span>`;
      else if (b.kind === "own") foot = `<span style="color:var(--faint)">还差 ${b.members.length - ownedCnt} 位同伴</span>`;
      else if (b.kind === "deploy") foot = `<span style="color:var(--faint)">${ownedCnt >= b.members.length ? `待 ${b.members.length} 人同阵` : `还差 ${b.members.length - ownedCnt} 位同伴`}</span>`;
      else if (ownedCnt >= b.members.length) foot = `<span style="color:var(--gold)">角色齐全 · 待上阵</span>`;
      else if (ownedCnt >= 2) foot = `<span style="color:var(--gold)">已集 ${ownedCnt} 位 · 可上阵成绊</span>`;
      else foot = `<span style="color:var(--faint)">还差 ${2 - ownedCnt} 位同伴</span>`;
      return `<div class="bondcard ${on ? "on" : ""}" data-bond="${b.id}" data-tip="${esc(b.name)}|${esc(b.effect)}|点击查看羁绊详情">
        <div class="bk" style="color:${kd.color};border-color:${kd.color}55">${kd.label}${b.tier > 2 ? ` · ${b.tier}人` : ""}</div>
        <div class="bmembers ${ownedCnt < 2 ? "bmiss" : ""}">
          ${b.members.slice(0, 4).map(m => {
            const inTeam = team.includes(m);
            const own = !!S.owned[m];
            return `<img src="${art(m)}" alt="" loading="lazy" data-fb="rm" class="${inTeam ? "inteam" : own ? "" : "notown"}" data-tip="${esc((charById(m) || {}).name || m)}|${inTeam ? "已上阵" : own ? "已结缘 · 未上阵" : "未结缘"}">`;
          }).join("")}
        </div>
        <div class="bt">${esc(b.name)}</div>
        <div class="bstats">${statChips}</div>
        <div class="be">${esc(b.effect)}</div>
        ${b.ult ? `<div class="bu">${I("story", "width:12px;height:12px;vertical-align:-2px")} ${esc(b.ult.name || "")}
          <br><span style="color:var(--faint)">${esc((b.ult.desc || "").slice(0, 46))}${(b.ult.desc || "").length > 46 ? "…" : ""}</span></div>` : ""}
        <div class="bfoot">
          <span>${foot}</span>
          ${!on && ownedCnt >= 2 && b.kind !== "own" ? `<button class="btn sm" data-bondteam="${b.id}">一键上阵</button>` : ""}
        </div>
      </div>`;
    }).join("")}
  </div>`;
}

/** 羁绊详情弹窗：成员 / 加成 / 效果 / 合击大招 / 当前生效状态。
 *  入口两处：羁绊页的卡片（data-bond）与角色详情右栏的羁绊标签（data-bond）。
 *  只读展示，不改存档；上阵等操作仍走羁绊页的「一键上阵」。 */
function openBondDetail(bondId) {
  const b = (DATA.bonds || []).find(x => x.id === bondId);
  if (!b) return;
  const team = S.team || [];
  const ownedIds = Object.keys(S.owned || {});
  const on = bondActiveClient(b, team, ownedIds);
  const kd = BOND_KIND[b.kind] || { label: b.kind, color: "#888", note: "" };
  const tier = b.tier || 2;
  const ownedCnt = (b.members || []).filter(m => S.owned[m]).length;
  const onCnt = (b.members || []).filter(m => team.includes(m)).length;
  const statChips = Object.entries(b.bonus || {}).filter(([, v]) => v !== 1)
    .map(([k, v]) => `<span class="bstat">${STAT_LABEL[k] || k} +${Math.round((v - 1) * 100)}%</span>`).join("");

  /* 状态一句话：own=拥有即生效；deploy=全员同阵；其余=上阵 ≥tier 人 */
  let stateText;
  if (b.kind === "own") stateText = on ? `已生效 · 已拥有 ${ownedCnt}/${b.members.length} 位` : `未生效 · 还差 ${b.members.length - ownedCnt} 位同伴`;
  else if (b.kind === "deploy") stateText = on ? `已生效 · ${b.members.length} 人同阵` : `未生效 · 需 ${b.members.length} 人全部上阵（当前 ${onCnt}/${b.members.length}）`;
  else stateText = on ? `已成绊 · 上阵 ${onCnt}/${b.members.length} 人` : `未成绊 · 上阵 ${onCnt}/${b.members.length} 人（需 ${tier} 人）`;

  const memberRows = (b.members || []).map(m => {
    const c = charById(m) || {};
    const own = !!S.owned[m], inTeam = team.includes(m);
    const rc = c.rarity ? RCOLOR(c.rarity) : "#888";
    return `<div class="bm-row ${own ? "" : "locked"}">
      <div class="bm-face">${artImg(m, "avatar")}</div>
      <div class="bm-main">
        <div class="bm-name" style="color:${rc}">${esc(c.name || m)}
          ${c.rarity ? `<span class="rtag" style="color:${rc};border-color:${rc}">${RTAG(c.rarity)}</span>` : ""}
        </div>
        <div class="bm-sub">${esc(c.title || FLABEL(c.faction || "") || "")}</div>
      </div>
      <div class="bm-state ${inTeam ? "on" : own ? "own" : ""}">${inTeam ? "已上阵" : own ? "已结缘" : "未结缘"}</div>
    </div>`;
  }).join("");

  modal(`<div class="menu bond-modal">
    <button class="iconbtn mclose" data-close>${I("close")}</button>
    <div class="bond-hd">
      <span class="bk" style="color:${kd.color};border-color:${kd.color}55">${kd.label}</span>
      <div class="panel-title">${esc(b.name)}</div>
      <div class="panel-sub">${esc(kd.note || "")}${b.tier > 2 ? ` · ${b.tier} 人` : ""}</div>
    </div>
    <div class="bond-state ${on ? "on" : ""}">${stateText}</div>
    <div class="bond-sec">羁 绊 效 果</div>
    <div class="bond-effect">${esc(b.effect)}</div>
    <div class="bond-chips">${statChips || `<span class="bstat dim">无属性加成</span>`}</div>
    ${b.ult ? `<div class="bond-sec">合 击 演 出</div>
      <div class="bond-ult"><div class="bu-name">${I("story", "width:13px;height:13px;vertical-align:-2px")} ${esc(b.ult.name || "")}</div>
        <div class="bu-desc">${esc(b.ult.desc || "")}</div></div>` : ""}
    <div class="bond-sec">成 员 <span class="panel-sub" style="font-weight:400;letter-spacing:0">已拥有 ${ownedCnt}/${b.members.length} · 已上阵 ${onCnt}</span></div>
    <div class="bm-list">${memberRows}</div>
    <button class="btn" data-close style="width:100%;margin-top:16px">关 闭</button>
  </div>`, { dimClose: true });
}

/** 一键把该羁绊的角色换上（保留原有上阵顺序，最多 5 人） */
async function bondAutoTeam(bondId) {
  const b = (DATA.bonds || []).find(x => x.id === bondId);
  if (!b) return;
  const add = b.members.filter(m => S.owned[m] && !S.team.includes(m));
  const team = [...S.team];
  for (const id of add) {
    if (team.length >= 5) break;
    team.push(id);
  }
  if (!team.length) return;
  const j = await call({ type: "team", ids: team });
  if (j) { toast(`已上阵 ${add.slice(0, 5 - (S.team.length - add.length)).length} 人`); blip(700, .07); renderBonds(); }
}

/* ---------------- 卡牌详情弹窗 ---------------- */

/** 卡面详情属性：已结缘读服务端 pstats（含缘器/羁绊加成）；未结缘读角色档案的满级基准。 */
async function cardStatsFor(id) {
  const ps = (S.pstats || {})[id];
  if (ps) return ps;
  try {
    const r = await fetch(`/data/characters/${encodeURIComponent(id)}/character.json`, { cache: "no-store" });
    if (r.ok) {
      const doc = await r.json();
      const s = doc.stats || {};
      return {
        hp: s.hp?.atCap, atk: s.atk?.atCap, def: s.def?.atCap, mdef: s.mdef?.atCap,
        spd: s.spd?.atCap, crit: s.crit?.atCap, erg: s.erg?.atCap,
      };
    }
  } catch (e) { /* 档案读不到就不显示属性，不阻塞卡面 */ }
  return null;
}
/* 与 core.js charPower 同一套权重：未结缘的图鉴卡也能看到「满级参考战力」。 */
const CARD_POWER_W = { hp: 0.12, atk: 1.6, def: 0.9, mdef: 0.9, spd: 2.5, crit: 900, erg: 12 };
function cardPowerOf(id, st) {
  if (S.owned[id] && (S.pstats || {})[id]) return charPower(id);
  const c = charById(id);
  let p = 0;
  for (const k in CARD_POWER_W) p += (Number(st?.[k]) || 0) * CARD_POWER_W[k];
  return Math.max(1, Math.round(p * (DATA.rarities[c?.rarity]?.powerScale ?? 1)));
}

async function showCard(id) {
  const c = charById(id); if (!c) return;
  const o = S.owned[id];
  const rc = RCOLOR(c.rarity);
  const ps = await cardStatsFor(id);
  const pw = ps ? cardPowerOf(id, ps) : null;
  const stCell = (lb, v) => `<div class="sg"><div class="k">${lb}</div><div class="v num">${v}</div></div>`;
  const statHtml = ps ? `
      <div class="statgrid cardstat" style="grid-template-columns:repeat(4,1fr)">
        ${stCell("生命", fmt(ps.hp))}
        ${stCell("攻击", fmt(ps.atk))}
        ${stCell("物防", fmt(ps.def))}
        ${stCell("法防", fmt(ps.mdef))}
        ${stCell("速度", fmt(ps.spd))}
        ${stCell("暴击", `${Math.round((ps.crit || 0) * 1000) / 10}%`)}
        ${stCell("怒气回复", `${ps.erg}/回合`)}
      </div>` : `<div class="panel-sub" style="margin-top:10px">属性档案读取中…</div>`;
  modal(`
  <div class="cardmodal panel ${c.rarity === "diamond" ? "r-diamond cm-lux" : ""}" style="border-color:${rc}66">
    <div class="left">${artImg(id, "portrait", o ? awArtStyle(id, "card") : "")}
      <span class="rtag ${c.rarity === "diamond" ? "r-diamond" : ""}" style="position:absolute;top:14px;left:14px;color:${rc};border-color:${rc}">${RTAG(c.rarity)}</span>
      ${c.rarity === "diamond" ? `<i class="cm-prism"></i>` : ""}
      ${o ? "" : `<div style="position:absolute;inset:0;background:rgba(6,8,13,.55)"></div>
        <div style="position:absolute;inset:0;display:grid;place-items:center;font-family:var(--font-display);font-size:30px;color:rgba(234,228,214,.6)">未 结 缘</div>`}
    </div>
    <div class="right">
      <button class="iconbtn mclose" data-close>${I("close")}</button>
      <h2 class="${c.rarity === "diamond" ? "crystal-name" : ""} ${o && S.awaken && S.awaken[id] ? "awakened-name" : ""}">${esc(c.name)}</h2>
      <div class="meta">
        <span class="rtag ${c.rarity === "diamond" ? "r-diamond cm-tag" : ""}" style="color:${rc};border-color:${rc}">${RTAG(c.rarity)}</span>
        <span class="echip" style="background:${ECOLOR(c.element)};width:20px;height:20px;font-size:10px">${ELABEL(c.element)}</span>
        <span>${DATA.elements[c.element].label}</span><span>·</span><span>${RLABEL(c.role)}</span><span class="poschip">${esc(RPOS(c.role))}</span><span>·</span><span>${FLABEL(c.faction)}</span>
        ${o ? `<span>·</span><span class="num">Lv.${o.lv} · ★${o.star} · 突破${o.bt}</span>` : ""}
      </div>
      <div class="cm-powerbar">
        <span class="cm-power"><i>战力</i><b class="num">${pw != null ? fmt(pw) : "—"}</b></span>
        <span class="cm-pos"><i>定位</i><b>${esc(RLABEL(c.role))} · ${esc(RPOS(c.role))}</b></span>
        ${ps ? `<span class="cm-ref">${o ? "已含缘器与羁绊加成" : "满级基准属性（未结缘）"}</span>` : ""}
      </div>
      ${statHtml}
      <p class="panel-sub" style="line-height:1.8;margin-top:8px">${esc(c.lore || "")}</p>
      <div style="display:grid;gap:9px">
        ${c.skills.map(sk => `<div class="skill-item"><div class="sh">
          <span class="slotchip" style="background:${SLOT_COLOR[sk.slot] || "#888"}">${SLOT_NAME[sk.slot] || sk.slot}</span>
          <span class="sn">${esc(sk.name)}</span>${o ? `<span class="panel-sub num" style="margin-left:auto">Lv.${o.skills[sk.slot] || 1}</span>` : ""}</div>
          <div class="sd">${skillDesc(sk.desc) || "——"}</div></div>`).join("")}
      </div>
      ${o ? `<div style="display:flex;gap:10px;margin-top:16px">
        ${S.team.includes(id)
          ? `<button class="btn danger" data-uteam="${id}">下 阵</button>`
          : `<button class="btn primary" data-uteam="${id}">上 阵</button>`}
        <button class="btn" data-go="roster" data-gosel="${id}">去养成</button>
      </div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn ghost" style="flex:1" data-chstory="${id}">${I("scroll", "width:13px;height:13px;vertical-align:-2px")} 经 历</button>
        <button class="btn ghost" style="flex:1" data-cvoice="${id}">${I("story", "width:13px;height:13px;vertical-align:-2px")} 语 音</button>
      </div>
      <div style="margin-top:8px">
        <button class="btn ghost" style="width:100%" data-carts="${id}">${I("gem", "width:13px;height:13px;vertical-align:-2px")} 立 绘</button>
      </div>` : `<button class="btn primary" data-go="gacha" style="margin-top:16px">去 缘 阁 结 缘</button>`}
    </div>
  </div>`);
  // 详情页语音：已结缘的角色翻开详情时报登场句
  if (o) AudioSys.cv(id, "enter", { priority: 2 });
}

async function toggleTeam(id) {
  const team = S.team.includes(id) ? S.team.filter(x => x !== id)
    : S.team.length < 5 ? [...S.team, id] : null;
  if (!team) { toast("编队已满 · 先下阵一位"); return; }
  const j = await call({ type: "team", ids: team });
  if (j) { closeModal(); toast(S.team.includes(id) ? `${charById(id).name} 已上阵` : `${charById(id).name} 已下阵`); go(cur); }
}

/* ---------------- 系统菜单 ---------------- */

function openMenu() {
  modal(`<div class="menu">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="panel-title">系 统</div>
      <button class="iconbtn" data-close>${I("close")}</button>
    </div>
    <div class="mrow"><span class="mk">音乐</span>
      <input type="range" id="volBgm" min="0" max="100" value="${Math.round(AudioSys.bgmVol * 100)}" style="flex:1">
      <b class="num" id="volBgmV" style="width:40px;text-align:right">${Math.round(AudioSys.bgmVol * 100)}%</b></div>
    <div class="mrow"><span class="mk">音效</span>
      <input type="range" id="volSfx" min="0" max="100" value="${Math.round(AudioSys.sfxVol * 100)}" style="flex:1">
      <b class="num" id="volSfxV" style="width:40px;text-align:right">${Math.round(AudioSys.sfxVol * 100)}%</b></div>
    <hr class="rule">
    <div class="mrow"><span class="mk">当前账号</span><b>${esc(USERNAME)}</b></div>
    <div class="mrow"><span class="mk">战斗引擎</span><span class="panel-sub">C# battle-repl · 服务器结算</span></div>
    <div class="mrow"><span class="mk">存档</span><span class="panel-sub">MySQL 云存档 · 换设备登录即恢复</span></div>
    <div class="mrow"><span class="mk">新手教学</span>
      <button class="btn sm" id="btnTutorial" style="margin-left:auto">重新查看指引</button></div>
    <hr class="rule">
    <div class="foot">
      <button class="btn danger" id="btnLogout">退出登录</button>
      <button class="btn danger" id="btnReset" data-tip="危险|清空当前账号的云存档并重新开局">重置存档</button>
    </div>
    <div class="panel-sub" style="margin-top:12px;text-align:center">Esc 或点暗处关闭</div>
  </div>`);
  // 拖动时只更新数值、不发声：oninput 在拖动过程中会连发几十次，
  // 每次播 click 就变成"越拖越吵"，而且是在调音效的时候吵，体验最差。
  // 松手（change）时再给一次试听，且音量已经生效所以听起来就是最终音量。
  const bgmSlider = $("#volBgm"), sfxSlider = $("#volSfx");
  /* 轨道上的金色填充由 CSS 变量 --fill 控制（见 style.css 的 range 样式）。
   * 之前没有任何 JS 去写它，于是轨道永远停在 50% 默认值 ——
   * 表现就是"数值已经是 0%，金色却只画到一半"，看着像滑块没反应。
   * 这里在打开菜单时先按当前值刷一次，之后每次 input 再同步。
   */
  const paintSlider = el => {
    const min = +el.min || 0, max = +el.max || 100;
    const pct = ((+el.value - min) / (max - min)) * 100;
    el.style.setProperty("--fill", pct + "%");
  };
  /* 用 input 事件（含键盘、点轨道跳转）统一刷新，避免只绑 oninput 漏掉拖动来源 */
  bgmSlider.addEventListener("input", () => paintSlider(bgmSlider));
  sfxSlider.addEventListener("input", () => paintSlider(sfxSlider));
  paintSlider(bgmSlider);
  paintSlider(sfxSlider);
  bgmSlider.oninput = e => {
    AudioSys.setBgmVol(e.target.value / 100);
    $("#volBgmV").textContent = e.target.value + "%";
  };
  sfxSlider.oninput = e => {
    AudioSys.setSfxVol(e.target.value / 100);
    $("#volSfxV").textContent = e.target.value + "%";
  };
  // 松手后给一次试听；拉到 0 就没必要试听了
  sfxSlider.onchange = e => { if (+e.target.value > 0) AudioSys.sfx("click", { force: true }); };
  bgmSlider.onchange = () => { if (AudioSys.bgmVol > 0) AudioSys.resumeBgm(); };
  $("#btnLogout").onclick = logout;
  $("#btnTutorial").onclick = () => { closeModal(); Tutorial.restart(); };
  $("#btnReset").onclick = async () => {
    modal(`<div class="menu" style="text-align:center;width:400px">
      <p style="margin:14px 0 20px;font-size:15px">确定清空 <b>${esc(USERNAME)}</b> 的云存档并重新开局吗？<br><span class="panel-sub">此操作不可恢复；重新开局后初始大礼包会重新出现。</span></p>
      <div style="display:flex;gap:12px"><button class="btn" style="flex:1" data-close>再 想 想</button>
      <button class="btn danger" style="flex:1" id="btnResetGo">确认重置</button></div></div>`);
    $("#btnResetGo").onclick = async () => { await call({ type: "reset" }); closeModal(); location.reload(); };
  };
}

