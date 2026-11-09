// 一次性脚本：把妖王（boss）写进 content/mobs.json。
// 妖王沿用"克隆同势力同稀有度名册角色数值"的规则，只换身份、外观与强度标签，
// 所以 validate / stats-fixtures 的交叉验算仍然成立。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const file = path.join(ROOT, 'content', 'mobs.json');
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));

const BOSSES = [
  {
    id: 'boss-qx-du',
    name: '蠹简先生',
    title: '栖霞·把藏书吃空的人',
    faction: 'qx',
    element: 'verdant',
    rarity: 'gold',
    role: 'guard',
    boss: true,
    bossTitle: '妖王',
    look: {
      set: '栖霞藏书阁最里层，书架只剩骨，纸屑像雪一样落',
      outfit: '一袭被虫蛀穿的青袍，袖口爬满细密虫纹，头上一顶用书页折成的冠',
      motif: '翻开一本，里面的字全部爬出来钻进他的袍子里'
    },
    skills: { attack: '啮页', skill: '万卷穿身', passive: '字入腹中' },
    lore: '蒙学的孩子背书背不出，就来求他吃掉那一页。后来他把整座藏书阁都吃空了，孩子们也再没背出过书。'
  },
  {
    id: 'boss-zf-pan',
    name: '星案判官',
    title: '紫府·案上无名的执笔人',
    faction: 'zf',
    element: 'storm',
    rarity: 'red',
    role: 'control',
    boss: true,
    bossTitle: '妖王',
    look: {
      set: '悬空星案，案下万丈星渊，纸页翻动如潮',
      outfit: '玄紫圆领官袍，十二条玉衡串成冠，左手执笔、右手按着翻不开的命册',
      motif: '笔尖落处星轨断裂，被他划掉的名字就再没亮起过'
    },
    skills: { attack: '判笔点星', skill: '落星断命', passive: '案上无名' },
    lore: '他说自己只是抄录，从不判决。可案上那本册子，凡是名字被划掉的，世间再没人记得他长什么样。'
  },
  {
    id: 'boss-cc-zhu',
    name: '炉主',
    title: '赤城·千年不熄的一炉',
    faction: 'cc',
    element: 'flame',
    rarity: 'gold',
    role: 'break',
    boss: true,
    bossTitle: '妖王',
    look: {
      set: '赤城剑炉最深处，铁水像河一样在脚边流',
      outfit: '半身化作炉体的巨人，肩背嵌着断剑，胸口炉门开合一呼一吸',
      motif: '一锤落下，铁水与火星一起腾空成柱'
    },
    skills: { attack: '落锤', skill: '倾炉裂山', passive: '余火不熄' },
    lore: '剑炉烧了一千年，铸坏的剑比铸成的多。那些没成的剑，都在炉主胸腔里烧着。'
  },
  {
    id: 'boss-yh-jiao',
    name: '潮生蛟',
    title: '瀛海·珠阙底下的旧主',
    faction: 'yh',
    element: 'tide',
    rarity: 'red',
    role: 'cleave',
    boss: true,
    bossTitle: '妖王',
    look: {
      set: '瀛海珠阙之下，潮水逆流向上堆成一面墙',
      outfit: '盘绕的苍青蛟身，鳞间嵌着沉船的珠串，角上挂一盏灭了的引潮灯',
      motif: '翻身时整片海跟着起立，珠阙在水里倒转'
    },
    skills: { attack: '搅潮', skill: '万丈潮生', passive: '水底听声' },
    lore: '珠阙沉了三次，碑上写的都是「镇蛟」。它记得每一块碑的位置，也记得每一个刻碑的人。'
  }
];

let added = 0;
for (const b of BOSSES) {
  if (doc.mobs.some((m) => m.id === b.id)) continue;
  doc.mobs.push(b);
  added++;
}
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`妖王新增 ${added} 只，mobs 合计 ${doc.mobs.length} 只`);
