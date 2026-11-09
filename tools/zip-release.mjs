// 重新压缩发布包 release/ → release-0.1.0.zip（2.2GB 级，后台跑）。
// 用 tar.exe -a -c -f（Windows 10+ 自带，走 zlib）避免 PowerShell Compress-Archive 在超大目录上内存爆炸。
// 进度：把开始/结束与产物大小写入 target/zip-progress.log；脚本自身无交互，可反复重跑（覆盖旧包）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'release-0.1.0.zip');
const LOG = path.join(ROOT, 'target', 'zip-progress.log');
const log = (m) => { const line = `${new Date().toISOString()} ${m}`; fs.appendFileSync(LOG, line + '\n'); console.log(line); };

fs.mkdirSync(path.join(ROOT, 'target'), { recursive: true });
log('开始压包 release/ -> release-0.1.0.zip');
if (fs.existsSync(OUT)) {
  const old = fs.statSync(OUT).size;
  fs.renameSync(OUT, OUT + '.old');
  log(`旧包移到 release-0.1.0.zip.old（${(old / 1048576).toFixed(1)} MB）`);
}

const t0 = Date.now();
// PATH 里的 tar.exe 是 Git 的 GNU tar（不支持 zip）；用 Windows 自带 System32 bsdtar。
// 用 -C 指定目录、绝对 -f 路径在 bsdtar 下可正常解析（GNU tar 才会把盘符当主机名）。
const TAR = 'C:\\Windows\\System32\\tar.exe';
const r = spawnSync(TAR, ['-a', '-c', '-f', OUT, '-C', path.join(ROOT, 'release'), '.'], { stdio: 'inherit' });
const dt = ((Date.now() - t0) / 1000).toFixed(0);
if (r.status !== 0) {
  log(`压包失败 exit=${r.status}，耗时 ${dt}s`);
  process.exit(r.status ?? 1);
}
const size = fs.statSync(OUT).size;
log(`压包完成：${(size / 1048576).toFixed(1)} MB，耗时 ${dt}s`);
