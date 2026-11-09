// 一次性数据整理（2026-11-03）：活动主线扩到 12 关后，关卡名按「当前显示顺序」重新编号；
// 原有关卡保留原标题（只是序号随位置变化），新增关卡用新标题补齐。可重复执行。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'content', 'events');
const NAMES = {
  'caiyao-1': { orig: ['晨露', '山径', '药圃', '老参'], extra: ['溪畔', '石阶', '药王庙', '云崖', '采芝', '百草', '归山', '满载'] },
  'chaosheng-1': { orig: ['潮头', '珠市', '万灯', '祭海', '潮生', '珠阙'], extra: ['渔火', '踏浪', '蜃楼', '龙吟', '归潮', '海晏'] },
  'luhuo-1': { orig: ['守火', '淬锋', '开炉', '剑鸣', '炉主'], extra: ['拾薪', '鼓风', '试剑', '熔金', '铸心', '火光', '传炉'] },
  'shuangdeng-1': { orig: ['灯起', '霜桥', '月门', '拾霜', '入瓮'], extra: ['寒潭', '雪径', '冰灯', '夜巡', '月窟', '霜台', '归灯'] },
  'xingcha-1': { orig: ['启航', '星潮', '陨铁', '天阙', '归槎'], extra: ['星港', '云帆', '银河', '天市', '星槎', '渡劫', '星海'] },
  'yaochao-1': { orig: ['潮头', '霜线', '桂影', '月晦', '玉杵', '弃霜'], extra: ['雪原', '寒潮', '冰阵', '月蚀', '霜刃', '雪魅'] },
};
const anchorsOf = (n, target = 12) => Array.from({ length: n }, (_, i) => Math.round((i * (target - 1)) / Math.max(1, n - 1)));

for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const fp = path.join(DIR, f);
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const cfg = NAMES[j.id];
  if (!cfg) continue;
  const main = j.stages.filter((s) => !s.section);
  if (main.length !== 12) { console.log(`跳过 ${j.id}：主线 ${main.length} 关`); continue; }
  const anchors = anchorsOf(cfg.orig.length, 12);
  let extraIdx = 0;
  main.forEach((s, pos) => {
    const anchorAt = anchors.indexOf(pos);
    const title = anchorAt >= 0 ? cfg.orig[anchorAt] : (cfg.extra[extraIdx++] || `新路${pos + 1}`);
    s.name = `${j.name} ${String(pos + 1).padStart(2, '0')}·${title}`;
  });
  fs.writeFileSync(fp, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log(j.id + ': ' + main.map((s) => String(main.indexOf(s) + 1).padStart(2, '0') + '·' + s.name.split('·').pop()).join(' | '));
}
