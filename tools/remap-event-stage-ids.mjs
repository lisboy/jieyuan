// 一次性数据迁移（2026-11-03 活动主线扩容后）：
// 12 关重排时，原有主线的 id 被新关卡占用了。这里把「原有关卡」的 id 还原回原名（保老存档星数），
// 新增关卡改用 -mXX 的独立 id（不会和任何老 id 撞车）。
// 可重复执行：先按关卡名识别锚点 -> 原 id 按 01..0N 顺序回填。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'content', 'events');
const PLAN = {
  'caiyao-1': { orig: 4 },
  'chaosheng-1': { orig: 6 },
  'luhuo-1': { orig: 5 },
  'shuangdeng-1': { orig: 5 },
  'xingcha-1': { orig: 5 },
  'yaochao-1': { orig: 6 },
};
const anchorsOf = (origCount, target = 12) =>
  Array.from({ length: origCount }, (_, i) => Math.round((i * (target - 1)) / Math.max(1, origCount - 1)));

for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const fp = path.join(DIR, f);
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const plan = PLAN[j.id];
  if (!plan) continue;
  const main = j.stages.filter((s) => !s.section);
  if (main.length !== 12) {
    console.log(`跳过 ${j.id}：主线 ${main.length} 关（预期 12）`);
    continue;
  }
  const firstId = main[0].id;
  const prefix = firstId.replace(/-[^-]+$/, '').replace(/-m?\d+$/, '') || firstId.replace(/-\d+$/, '');
  const anchors = anchorsOf(plan.orig);
  const remapped = main.map((s, pos) => {
    const anchorAt = anchors.indexOf(pos);
    if (anchorAt >= 0) {
      s.id = `${prefix}-${String(anchorAt + 1).padStart(2, '0')}`;
    } else {
      s.id = `${prefix}-m${String(pos + 1).padStart(2, '0')}`;
    }
    return s;
  });
  j.stages = [...remapped, ...j.stages.filter((s) => s.section)];
  const trial1 = j.stages.find((s) => s.section === 'trial');
  if (trial1) trial1.requires = remapped[remapped.length - 1].id;
  fs.writeFileSync(fp, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log(`${j.id}: ${remapped.map((s) => s.id).join(', ')}`);
}
