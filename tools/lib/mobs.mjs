// 小怪（敌人杂兵）归档：把 content/mobs.json 展开成 data/characters/<mobId>/。
//
// 为什么"克隆"而不是写一套全数值：小怪不该有自己的数值曲线——它的强度由关卡的
// mult 与等级决定，卡面数值必须和名册同源，否则 validate 的稀有度/势力计数和
// stats-fixtures 的交叉验算会立刻对不上。所以这里只换"身份与外观"，数值与技能槽
// 直接继承同势力同稀有度的名册角色。
import fs from 'node:fs';
import path from 'node:path';

const ART_KINDS = [
  ['卡面图', 'card.png'],
  ['头像', 'avatar.png'],
  ['大招立绘', 'ultimate.png'],
  ['全身立绘', 'portrait.png'],
  ['抠图立绘', 'standee.png'],
  ['动态立绘', 'dynamic.png'],
  ['专属缘器', 'exclusive.png']
];

/**
 * @param {object} p
 * @param {string} p.root 项目根
 * @param {object} p.mobsDoc content/mobs.json
 * @param {Array} p.roster 名册角色（含 id/faction/rarity）
 * @returns {{ list: Array, report: object }}
 */
export function buildMobs({ root, mobsDoc, roster, voiceDoc }) {
  const list = [];
  const report = { total: 0, art: {}, missingBase: [] };
  if (!mobsDoc || !Array.isArray(mobsDoc.mobs)) return { list, report };

  const findBase = (mob) => {
    const same = roster.filter((c) => c.faction === mob.faction);
    const exact = same.filter((c) => c.rarity === mob.rarity && c.role === mob.role);
    return exact[0] || same.find((c) => c.rarity === mob.rarity) || same[0] || null;
  };

  for (const mob of mobsDoc.mobs) {
    const base = mob.base ? roster.find((c) => c.id === mob.base) : findBase(mob);
    if (!base) { report.missingBase.push(mob.id); continue; }
    const srcJson = path.join(root, 'data', 'characters', base.id, 'character.json');
    if (!fs.existsSync(srcJson)) { report.missingBase.push(mob.id); continue; }

    const dir = path.join(root, 'data', 'characters', mob.id);
    fs.mkdirSync(path.join(dir, 'art'), { recursive: true });

    // 美术只用小怪自己的（render-mob-art.mjs 的剪影 / 妖王真图）。
    // 绝不回退 base 名册角色的图——玩家抽得到的人不能借脸给关卡敌人，
    // 缺哪类就缺哪类，战斗卡按 standee→portrait 的次序落到小怪自己的剪影上。
    // 先清空旧产物再拷，避免历史上回退拷进来的名册图残留。
    const artDir = path.join(root, 'content', 'art', `${mob.name}-${mob.id}`);
    for (const f of fs.readdirSync(path.join(dir, 'art'))) fs.rmSync(path.join(dir, 'art', f));
    const art = {};
    for (const [stem, out] of ART_KINDS) {
      const own = path.join(artDir, `${stem}.png`);
      if (!fs.existsSync(own)) continue;
      fs.copyFileSync(own, path.join(dir, 'art', out));
      art[out] = true;
      report.art[out] = (report.art[out] || 0) + 1;
    }

    const doc = JSON.parse(fs.readFileSync(srcJson, 'utf8'));
    // 小怪卡是从 base 名册角色克隆的，assets 里的 srcFile/fileReady 也跟着继承了过来。
    // 小怪自己有图的类别（见上面 ART_KINDS 拷贝）要把来源改回小怪自己的目录，
    // 否则 art-jobs 与后台核图会把 base 的图当成小怪已就位的图。
    if (doc.assets && typeof doc.assets === 'object') {
      for (const [stem, out] of ART_KINDS) {
        const kind = out.replace(/\.png$/, '');
        if (!doc.assets[kind]) continue;
        const ownRel = `content/art/${mob.name}-${mob.id}/${stem}.png`;
        const hasOwn = fs.existsSync(path.join(root, ownRel));
        // 小怪/妖王只能用自己的图：没有就标未就绪，绝不把 base 名册角色的图借过来。
        doc.assets[kind] = { ...doc.assets[kind], srcFile: ownRel, fileReady: hasOwn };
      }
    }
    doc.id = mob.id;
    doc.name = mob.name;
    doc.title = mob.title || doc.title;
    doc.lore = mob.lore || doc.lore;
    doc.isMob = true;
    doc.baseOf = base.id;
    // 身份字段：小怪/BOSS 必须能声明自己的种族与年龄档。过去只覆盖 look 的 set/outfit/motif，
    // sex/archetype/species/beast 会整组继承 base 名册角色——boss-gh-shuang 因此被
    // 自动匹配到 ur-gh-07 羽流萤（红/控制/广寒），画成了带翅膀的羽灵少女。
    if (mob.sex) doc.sex = mob.sex;
    if (mob.archetype) doc.archetype = mob.archetype;
    const ageBand = mob.ageBand || mob.age_band;
    if (ageBand) doc.ageBand = ageBand;
    if (mob.species) doc.species = mob.species;
    if (typeof mob.beast === 'boolean') doc.beast = mob.beast;
    // 小怪整队共享 base 技能组，若 base 带「回合末为同伴续气」这类喂怒被动，
    // 5 只小怪会互充成蜂巢——整队 2 回合齐开大。构建期剥掉小怪技能里
    // 一切「为他人充怒」的触发（角色本体不受影响），小怪怒气只走自己的回合续气。
    if (Array.isArray(doc.skills)) {
      for (const sk of doc.skills) {
        if (!Array.isArray(sk.fx)) continue;
        const strip = (fx) => fx.filter((f) => !(f.k === 'energy' && f.target && f.target !== 'self'));
        sk.fx = strip(sk.fx).filter((f) => {
          if (f.k !== 'trigger' || !Array.isArray(f.fx)) return true;
          return f.fx = strip(f.fx), f.fx.length > 0;
        });
      }
    }
    if (mob.element && doc.element) doc.element = { ...doc.element };
    // 血量定向缩放（2026-11-05 用户需求：在 2026-11-01「妖王×3/普通×2」基础上再上调 1.3~1.5 倍，
    // 即普通小怪 ×2 × 1.3 = ×2.6，妖王 ×3 × 1.5 = ×4.5；其他属性一律不动）。
    // 只动 hp 的 base/atCap/growthPerLevel，atk/def/mdef/spd/crit/erg 保持与 base 完全一致，
    // 免得顺手把敌人的输出与减伤一起拉高——用户要的是"更耐打"而不是"更痛"。
    const isBoss = mob.boss === true;
    const HP_MULT = isBoss ? 4.5 : 2.6;
    if (doc.stats && doc.stats.hp) {
      const hp = doc.stats.hp;
      hp.base = Math.round(hp.base * HP_MULT);
      hp.atCap = Math.round(hp.atCap * HP_MULT);
      hp.growthPerLevel = Math.round(hp.growthPerLevel * HP_MULT);
      doc.stats.hp = hp;
      doc.hpMult = HP_MULT;
    }
    if (mob.look) doc.look = { ...doc.look, ...mob.look };
    // art.outfit 也继承自 base，同样会被画成 base 的衣服（如羽流萤的萤色翅羽）。
    // 小怪档案里声明了自己的 outfit 就覆盖掉，避免 UI/提示词继续用 base 的服装描述。
    if (mob.look?.outfit && doc.art) doc.art = { ...doc.art, outfit: mob.look.outfit };
    doc.art = { ...(doc.art || {}), portrait: 'art/portrait.png', portraitReady: !!art['portrait.png'] };
    // 小怪不参与抽取/养成，UI 上不能出现"羁绊/养成"字样，这里留个标记让表现层区分
    doc.mob = { kind: mob.kind || 'normal', family: mob.family || doc.role?.label || '' };
    // 台词：voice.json 里有小怪自己的署名条目则优先（逐怪手写），否则继承 base 的声音档案
    const ownVoice = voiceDoc?.list?.[mob.id];
    if (ownVoice?.lines) {
      doc.voice = { cv: ownVoice.cv || '', timbre: ownVoice.timbre, pace: ownVoice.pace,
                    quirk: ownVoice.quirk, lines: ownVoice.lines, source: 'authored' };
    }
    // BOSS 阶段台词（mobs.json boss 档案 voice.phases）合入语音档案，cv_gen 据此合成 phase-N
    if (mob.voice?.phases?.length) {
      doc.voice = { ...(doc.voice || {}), phases: mob.voice.phases };
    }
    fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(doc, null, 2), 'utf8');
    list.push({ id: mob.id, name: mob.name, title: mob.title, faction: mob.faction, element: mob.element, rarity: base.rarity, role: base.role, base: base.id, boss: mob.boss === true, bossTitle: mob.bossTitle || '', eventOnly: mob.eventOnly === true, kin: mob.kin || '', lore: mob.lore || '' });
    report.total++;
  }

  // 运行时靠这张表把 id 翻成名字（小怪不进 index.json，否则会被当成可抽角色）
  fs.writeFileSync(path.join(root, 'data', 'mobs.json'), JSON.stringify({ schema: 1, count: list.length, mobs: list }, null, 2), 'utf8');
  return { list, report };
}
