// stage-names.mjs —— 关卡名按剧情锚点生成，不再叫「关卡 3」。
//
// 设计取舍：
//   剧情锚点（stage 1/15/30/50/75/100）自带文学标题，直接作为该关名字；
//   锚点之间的关卡用「场景 + 单字方位/推进词」，只出现一个分隔点，读起来像地名。
//   无剧情章节（第 9/10 章）用章节名造场景，同样不出现占位名。

/** 段内推进词：按进度取一个，构成「场景·词」 */
const FLOW = ['前径', '石阶', '转角', '回廊', '深处', '里门', '尽处', '暗阶', '残廊', '末路',
  '偏径', '侧门', '古道', '断桥', '荒阶', '旧庭', '下廊', '上阶', '远道', '终途'];

/** 无剧情章节兜底场景名 */
function fallbackScene(chapter, label) {
  const raw = String(label || '').split(/[·.]/).pop() || `第${chapter}章`;
  const s = raw.replace(/^第.+?章/, '').trim();
  return s || `第${chapter}章`;
}

function anchorsOf(storyNodes, chapter) {
  return (storyNodes || [])
    .filter((n) => n.chapter === chapter && n.when === 'before')
    .sort((a, b) => a.stage - b.stage)
    .map((n) => ({ stage: n.stage, title: n.title || '' }));
}

function sceneOf(title) {
  return String(title || '')
    .replace(/^第[一二三四五六七八九十百]+章[·\s]*/, '')
    .replace(/^终章[·\s]*/, '')
    .trim();
}

/**
 * 生成某关的展示名（纯函数）。
 */
export function stageName(chapter, index, stage, storyNodes, chapterLabel) {
  const kind = (stage && stage.kind) || 'normal';
  const anchors = anchorsOf(storyNodes, chapter);

  // 关主统一叫「场景·关主」，精英/小头目加括号，避免和普通关混淆
  const suffix = (scene) => {
    if (kind === 'boss') return `${scene}·关主`;
    if (kind === 'elite') return `${scene}（精英）`;
    if (kind === 'midBoss') return `${scene}（小头目）`;
    return scene;
  };

  // 无剧情章节
  if (!anchors.length) {
    const scene = fallbackScene(chapter, chapterLabel);
    const pos = FLOW[(index - 1) % FLOW.length];
    if (index === 1) return suffix(scene);
    return suffix(kind === 'normal' ? `${scene}·${pos}` : `${scene}·${pos}`);
  }

  let ai = 0;
  for (let i = 0; i < anchors.length; i++) if (anchors[i].stage <= index) ai = i;
  const base = anchors[ai];
  const scene = sceneOf(base.title) || fallbackScene(chapter, chapterLabel);

  // 锚点关直接用剧情标题
  if (base.stage === index) return suffix(scene);

  // 段内关卡：场景 + 推进词（只一个分隔点）
  const pos = FLOW[(index - base.stage - 1) % FLOW.length];
  return suffix(`${scene}·${pos}`);
}

/** 批量补名 + 去重保险 */
export function applyStageNames(chapters, storyNodes) {
  for (const ch of chapters) {
    const label = ch.label || '';
    for (const n of ch.nodes) {
      n.title = stageName(ch.chapter, n.index, n, storyNodes, label);
    }
    // 极端同名时追加罗马序，保证列表里可区分
    const cnt = new Map();
    for (const n of ch.nodes) cnt.set(n.title, (cnt.get(n.title) || 0) + 1);
    const used = new Map();
    for (const n of ch.nodes) {
      if (cnt.get(n.title) <= 1) continue;
      const k = (used.get(n.title) || 0) + 1;
      used.set(n.title, k);
      n.title = `${n.title}·${'①②③④⑤⑥⑦⑧⑨⑩'[Math.min(9, k - 1)]}`;
    }
  }
  return chapters;
}
