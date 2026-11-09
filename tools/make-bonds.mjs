// 羁绊表生成：把 83 位角色按「同门 / 六气 / 定位」三种关系结成羁绊。
// 只产出 content/bonds.json 与 data/bonds.json（运行时查表），不改战斗核心，
// 加成通过 Request.Member.bias 注入，因此与 JS 参考实现天然一致。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const roster = read('content/roster.json').characters;
const factions = read('content/factions.json').list;
const elements = read('content/elements.json').list;
const roles = read('content/roles.json').list;

const RANK = { red: 0, gold: 1, purple: 2, blue: 3, green: 4 };
const byRank = (a, b) => (RANK[a.rarity] ?? 9) - (RANK[b.rarity] ?? 9) || a.id.localeCompare(b.id);

// 羁绊大招名与说明：一势力一句，写"同门合击"的画面，不写数值口号
const FACTION_ULT = {
  zf: { name: '紫垣照影·星落成章', desc: '两人同引星案，紫气垂落如帘，把敌人的命数改写成一页废稿。' },
  gh: { name: '广寒同樽·霜月共影', desc: '拾霜司共举一盏冷月，霜线自地面升起，将战场冻成一幅静物。' },
  yx: { name: '万灵同声·岫云共起', desc: '万灵坞唤来满山草木同声而鸣，云岫翻涌，替同伴挡下一劫。' },
  qx: { name: '栖霞共砚·书断长夜', desc: '两人合砚落笔，字迹化作锁链缠住长夜，敌人读到自己的败局。' },
  cc: { name: '赤城同炉·剑鸣九霄', desc: '赤城剑炉同开一炉，铁水成刃，一剑鸣彻九霄。' },
  yh: { name: '瀛海同舟·珠阙潮生', desc: '瀛海珠阙合潮而起，万顷水光托着同门，把敌人压回潮底。' },
};

const ELEMENT_ULT = {
  flame: { name: '离火焚天·灯花照夜', desc: '同气者的火并作一处，灯花炸开成海，烧穿敌阵。' },
  verdant: { name: '青木回春·万壑生风', desc: '林气同源，枯枝一瞬抽芽，风过万壑皆为援手。' },
  tide: { name: '沧水回澜·墨池生浪', desc: '同源之水叠成一浪高过一浪，把敌人推回岸上。' },
  light: { name: '曜光初照·千镜同辉', desc: '同气者共引一线天光，千镜同辉，无处可藏。' },
  storm: { name: '九霄雷动·紫电同鸣', desc: '同源之雷互相引动，一道落下，满场皆是回响。' },
  dusk: { name: '暮云合璧·雁字成行', desc: '暮色相合，雁阵掠过战场，敌人的身影被一寸寸吞掉。' },
};

const ROLE_ULT = {
  burst: { name: '破军同锋·矢无虚发', desc: '两人同执一锋，前后相衔，把一处伤口凿成深井。' },
  cleave: { name: '席卷共势·千山一推', desc: '同势者并肩一推，阵线如同退潮，全线崩开。' },
  break: { name: '凿阵同心·叩关碎甲', desc: '两人同凿一处，甲声连响三下，护体自此作废。' },
  sustain: { name: '回春共脉·长生同渡', desc: '两人合脉，伤处以肉眼可见的速度合上，谁也没被落下。' },
  guard: { name: '磐石同守·不动如山', desc: '两人并肩成墙，山河不动，风浪自消。' },
  control: { name: '摄魂同禁·万法归寂', desc: '两人同念一诀，场上符辞尽数哑火，敌手只剩呼吸。' },
  support: { name: '扶倾同舟·递力共渡', desc: '一人递力，一人接住，气脉在两具身体间来回奔跑。' },
};

const bonds = [];

function add(kind, key, cfg) {
  const members = cfg.members;
  if (members.length < cfg.tier) return;
  bonds.push({
    id: `bond-${kind}-${key}`,
    kind,
    name: cfg.name,
    tier: cfg.tier,
    members,
    bonus: cfg.bonus,
    effect: cfg.effect,
    ult: cfg.ult,
  });
}

// —— 同门：同势力三人取其二
const factionNames = {
  zf: '紫府·星案同契',
  gh: '广寒·拾霜同契',
  yx: '云岫·万灵同契',
  qx: '栖霞·书隐同契',
  cc: '赤城·剑炉同契',
  yh: '瀛海·珠阙同契',
};
for (const key of Object.keys(factions)) {
  const pool = roster.filter((c) => c.faction === key).sort(byRank).slice(0, 4).map((c) => c.id);
  add('faction', key, {
    name: factionNames[key] ?? `${factions[key].label}同契`,
    tier: 2,
    members: pool,
    bonus: { atk: 1.06, hp: 1.06, spd: 1.0 },
    effect: '同门同气：攻击 +6%、生命 +6%',
    ult: FACTION_ULT[key] ?? { name: '同门合击', desc: '同门并肩，气脉相通。' },
  });
}

// —— 六气：同属性三人成阵，加成更偏攻势
for (const key of Object.keys(elements)) {
  const pool = roster.filter((c) => c.element === key).sort(byRank).slice(0, 5).map((c) => c.id);
  if (pool.length < 3) continue;
  add('element', key, {
    name: `六气·${elements[key].label}同阵`,
    tier: 2,
    members: pool,
    bonus: { atk: 1.08, hp: 1.0, spd: 1.04 },
    effect: '同源相引：攻击 +8%、速度 +4%',
    ult: ELEMENT_ULT[key] ?? { name: '同气相引', desc: '同源之气互相引动。' },
  });
}

// —— 定位：同职业两人互补，偏生存
for (const key of Object.keys(roles)) {
  const pool = roster.filter((c) => c.role === key).sort(byRank).slice(0, 6).map((c) => c.id);
  if (pool.length < 2) continue;
  add('role', key, {
    name: `${roles[key].label}·相济同心`,
    tier: 2,
    members: pool,
    bonus: { atk: 1.03, hp: 1.10, spd: 1.0 },
    effect: '同行相济：生命 +10%、攻击 +3%',
    ult: ROLE_ULT[key] ?? { name: '同行相济', desc: '同行者互为后手。' },
  });
}

const doc = {
  comment: '羁绊：team 里同时上阵 tier 名成员即触发。加成通过 Member.bias 注入战斗，大招是表现层的合击演出。',
  schema: 1,
  bonds,
};
const json = JSON.stringify(doc, null, 2);
fs.writeFileSync(path.join(ROOT, 'content', 'bonds.json'), json, 'utf8');
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'bonds.json'), json, 'utf8');
console.log(`羁绊 ${bonds.length} 条 -> content/bonds.json + data/bonds.json`);
