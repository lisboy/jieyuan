// fix-ur15-desc-sync.mjs —— 把 15 名 UR 里两条「文案与结算不一致」的技能描述改成与 fx 一致
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = path.join(ROOT, 'content', 'roster.json');
const roster = JSON.parse(fs.readFileSync(p, 'utf8'));
const byName = (n) => roster.characters.find((c) => c.name === n);

const yuyi = byName('殷羽衣').skills.find((s) => s.slot === 'passive');
yuyi.desc = '自身防御 +19%。霜片在衣上结成薄甲，替她挡下那些没说完的话。';

const xiluo = byName('细螺').skills.find((s) => s.slot === 'ultimate');
xiluo.desc = '为全队回复 120% 攻击力生命，并附加 2 回合护盾（60% 攻击力）。';

fs.writeFileSync(p, JSON.stringify(roster, null, 2) + '\n', 'utf8');
console.log('已同步 2 条技能描述');
