// dotnet 解析器：机器 PATH 上的 "C:\Program Files (x86)\dotnet" 常常只有运行时没有 SDK，
// 会把 `dotnet build` 顶成 "Did you mean to run .NET Core SDK commands?"。
// 这里按 DOTNET_ROOT -> 本机安装位 -> PATH 的顺序挑第一个真正带 SDK 的 dotnet，再转发参数。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CANDIDATES = [
  process.env.DOTNET_ROOT && path.join(process.env.DOTNET_ROOT, 'dotnet.exe'),
  'D:\\GameSoftWare\\dotnet\\dotnet.exe',
  'C:\\Program Files\\dotnet\\dotnet.exe',
  'C:\\Program Files (x86)\\dotnet\\dotnet.exe'
].filter(Boolean);

try {
  const fromPath = execFileSync('where', ['dotnet'], { encoding: 'utf8' })
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  CANDIDATES.push(...fromPath);
} catch { /* where 不可用时忽略 */ }

function hasSdk(exe) {
  try {
    const out = execFileSync(exe, ['--list-sdks'], { encoding: 'utf8', timeout: 20000 });
    return out.trim().length > 0;
  } catch { return false; }
}

const chosen = CANDIDATES.filter((p, i) => CANDIDATES.indexOf(p) === i).find((p) => fs.existsSync(p) && hasSdk(p));
if (!chosen) {
  console.error('未找到带 SDK 的 dotnet。已尝试：\n  ' + [...new Set(CANDIDATES)].join('\n  '));
  console.error('安装位置约定见 docs/ARCHITECTURE.md 的"工具链"一节。');
  process.exit(127);
}

const r = spawnSync(chosen, process.argv.slice(2), { stdio: 'inherit' });
process.exit(r.status ?? 1);
