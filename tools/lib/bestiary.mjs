// 万妖谱条目增强：从 data/characters/<id>/character.json 抽取小怪/BOSS 的档案细节，
// 让前端「点击查看详情」能显示技能（普攻/终结技/被动）、定位说明、数值、势力与形态。
// 单一真源仍是 data/characters/<id>/character.json（由 tools/build.mjs 生成），
// 本文件只做「挑字段」，不产生新的内容数据。
import fs from 'node:fs';
import path from 'node:path';

/** 取一条小怪/BOSS 档案里的技能条目（只保留展示需要的字段） */
function pickSkills(card) {
  if (!Array.isArray(card.skills)) return [];
  return card.skills.map((s) => ({
    slot: s.slot || '',
    name: s.name || '',
    type: s.type || '',
    energy: s.energy ?? null,
    cd: s.cd ?? null,
    target: s.target || '',
    desc: s.desc || s.derivedText || '',
  }));
}

/** 数值：只留 base 与每级成长（敌人等级由关卡决定，前端按 Lv 估算） */
function pickStats(card) {
  const st = card.stats || {};
  const one = (k) => (st[k] ? { base: st[k].base, growth: st[k].growthPerLevel || 0 } : null);
  return {
    hp: one('hp'), atk: one('atk'), def: one('def'),
    mdef: one('mdef'), spd: one('spd'), crit: one('crit'), erg: one('erg'),
  };
}

/**
 * 给万妖谱条目补齐档案细节。
 * @param {string} root 项目根
 * @param {Array} list 原始条目（build.mjs 产出）
 * @returns {Array} 增强后的条目（原字段全部保留）
 */
export function enrichBestiary(root, list) {
  return list.map((b) => {
    const p = path.join(root, 'data', 'characters', b.id, 'character.json');
    // CV 槽位实况：浏览器只看这份清单决定要不要请求音频，避免活动妖王等没录过音的条目逐个 404。
    const cvDir = path.join(root, 'web', 'audio', 'cv', b.id);
    let cvSlots = [];
    try {
      cvSlots = fs.readdirSync(cvDir).filter((f) => /\.(mp3|wav)$/i.test(f)).map((f) => f.replace(/\.(mp3|wav)$/i, ''));
    } catch { cvSlots = []; }
    if (!fs.existsSync(p)) return { ...b, skills: [], stats: {}, voice: { cvSlots } };
    let card;
    try { card = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { ...b, skills: [], stats: {}, voice: { cvSlots } }; }
    return {
      ...b,
      skills: pickSkills(card),
      stats: pickStats(card),
      roleLabel: card.role?.label || '',
      rolePosition: card.role?.position || '',
      roleTagline: card.role?.tagline || '',
      elementLabel: card.element?.label || '',
      factionLabel: card.faction?.label || '',
      factionFull: card.faction?.full || '',
      outfit: card.look?.outfit || '',
      set: card.look?.set || '',
      hpMult: card.hpMult || 1,
      bossTitle: card.bossTitle || b.bossTitle || '',
      // 关主登场/阶段台词：战斗里要看字幕，而战斗结果行只带战斗字段，
      // 所以把档案 voice（lines + phases）连同实有 CV 槽位一并带进万妖谱，前端 bossEnter/phaseDescend 直接读。
      voice: { ...(card.voice || {}), cvSlots },
    };
  });
}
