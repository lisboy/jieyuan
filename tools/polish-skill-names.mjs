// 技能改名：把"点一线/叩门/挡一劫/定"这类工作名换成有画面感的四到七字名。
// 只改名字不动数值与 fx，因此交叉校验（CROSS-CHECK）不受影响。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const write = (p, o) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(o, null, 2), 'utf8');

// —— 普攻（按定位共用）
const ROLE_ATTACK = {
  burst: '一线悬星',
  cleave: '横扫千峰',
  break: '叩关碎甲',
  sustain: '引香续脉',
  guard: '当关拒浪',
  control: '摄魄乱神',
  support: '递力同舟',
};

// —— 紫/蓝/绿的模板终结技与天赋
const ULT = {
  '断水一式': '一刃断沧溟',
  '点额': '指落惊鸿',
  '三叠': '三叠落星辰',
  '叩门': '叩阙问天',
  '碎玉': '碎玉裂金声',
  '渡一口气': '渡厄续长生',
  '涤尘': '涤尘洗碧落',
  '挡一劫': '一肩挡千劫',
  '守门人': '镇关守夜人',
  '定': '一喝山河定',
  '缄口': '封喉锁玉言',
  '借力': '借东风一缕',
  '续香': '续香火千年',
  // cleave 的两个变体（对象式名字）
  '漫卷': '万壑松风',
  '裂空': '千峰裂雪',
};
const PASSIVE = {
  '先手': '未动先声',
  '余烬': '烬余不熄',
  '称重': '寸劲称斤',
  '不灭灯': '长明不灭灯',
  '硬扛': '铁骨承霜',
  '看破': '洞见秋毫',
  '分香': '分香赠故人',
};

let hits = 0;
function rename(node, table) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((v) => rename(v, table)); return; }
  if (typeof node.name === 'string' && table[node.name]) { node.name = table[node.name]; hits++; }
  else if (node.name && typeof node.name === 'object') {
    for (const k of Object.keys(node.name)) {
      const nv = table[node.name[k]];
      if (nv) { node.name[k] = nv; hits++; }
    }
  }
  for (const k of Object.keys(node)) if (k !== 'name') rename(node[k], table);
}

const roles = read('content/roles.json');
for (const key of Object.keys(roles.list)) {
  const atk = roles.list[key].attack;
  if (atk && ROLE_ATTACK[key]) { atk.name = ROLE_ATTACK[key]; hits++; }
}
write('content/roles.json', roles);

const tpl = read('content/skill_templates.json');
rename(tpl.ultimate, ULT);
rename(tpl.passive, PASSIVE);
rename(tpl.attack, ROLE_ATTACK);
write('content/skill_templates.json', tpl);

console.log(`技能改名 ${hits} 处（roles.attack + skill_templates）`);
