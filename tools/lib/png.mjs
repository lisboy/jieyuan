// png.mjs —— 零依赖 PNG 编解码（只覆盖项目实际用到的子集：8bit、非隔行、灰度/RGB/带 alpha）。
// 为什么要自己写：立绘抠图是 1672x2508 的 RGBA，81 张加起来 ~600MB，直接进 StreamingAssets
// 会把包体和加载时间都拖垮。项目里没有 sharp/canvas，而 Node 自带 zlib，够用了。
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 解码成 RGBA8：{ w, h, data } */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('不是 PNG');
  let off = 8;
  let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  let trns = null, palette = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`不支持的位深 ${depth}`);
  if (interlace !== 0) throw new Error('不支持隔行 PNG');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error(`不支持的颜色类型 ${ctype}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    raw.copy(cur, 0, p, p + stride);
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = cur[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const s = x * ch;
      if (ctype === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
      else if (ctype === 2) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
      else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
      else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; }
      if (palette && ctype === 3) { /* 未使用 */ }
    }
    cur.copy(prev);
  }
  if (ctype === 3 && palette) throw new Error('暂不支持索引色');
  return { w, h, data: out };
}

/** 编码 RGBA8 */
export function encodePng(img) {
  const { w, h, data } = img;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** 面积平均缩放（缩小专用），alpha 加权避免透明区域把颜色拉黑 */
export function resizeBox(img, tw, th) {
  const { w, h, data } = img;
  const out = Buffer.alloc(tw * th * 4);
  const sx = w / tw, sy = h / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(h, Math.ceil((y + 1) * sy));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(w, Math.ceil((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * w + xx) * 4;
          const al = data[o + 3];
          r += data[o] * al; g += data[o + 1] * al; b += data[o + 2] * al;
          a += al; n++;
        }
      }
      const o = (y * tw + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = n ? Math.round(a / n) : 0;
    }
  }
  return { w: tw, h: th, data: out };
}

/** 按 alpha 裁掉四周空白，留一点边距；抠图立绘统一裁边后"人物占比"才稳定 */
export function trimAlpha(img, padRatio = 0.02) {
  const { w, h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return img;
  const padX = Math.round((x1 - x0 + 1) * padRatio), padY = Math.round((y1 - y0 + 1) * padRatio);
  x0 = Math.max(0, x0 - padX); y0 = Math.max(0, y0 - padY);
  x1 = Math.min(w - 1, x1 + padX); y1 = Math.min(h - 1, y1 + padY);
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    data.copy(out, y * tw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + tw) * 4);
  }
  return { w: tw, h: th, data: out };
}

/** 补透明边把画幅拉到指定宽高比（只加透明列/行，不改人物比例）。
 *  蹲、坐、趴这类姿态裁完接近方形，运行时按高度摆位会显得"很宽很矮"，
 *  补成竖长画幅后与站姿在舞台上的视觉高度一致。 */
export function padAspect(img, minAspect) {
  const { w, h, data } = img;
  const cur = h / w;
  if (cur >= minAspect) return img;
  if (w >= h / minAspect) {
    // 补高度
    const th = Math.round(w * minAspect);
    const out = Buffer.alloc(w * th * 4);
    const off = Math.floor((th - h) / 2);
    for (let y = 0; y < h; y++) data.copy(out, ((y + off) * w) * 4, y * w * 4, (y + 1) * w * 4);
    return { w, h: th, data: out };
  }
  const tw = Math.round(h / minAspect);
  const out = Buffer.alloc(tw * h * 4);
  const off = Math.floor((tw - w) / 2);
  for (let y = 0; y < h; y++) data.copy(out, (y * tw + off) * 4, y * w * 4, (y + 1) * w * 4);
  return { w: tw, h, data: out };
}

/** 抠图流水线：解码 -> 裁边 -> 限高缩放 -> 补画幅 -> 编码
 *  rawW/rawH 是补画幅之前的真实裁框尺寸，用来判断"是不是只抠到局部"。 */
export function prepareCutout(buf, maxHeight = 1024, minAspect = 0) {
  let img = decodePng(buf);
  img = trimAlpha(img, 0.02);
  if (img.h > maxHeight) {
    const k = maxHeight / img.h;
    img = resizeBox(img, Math.max(1, Math.round(img.w * k)), maxHeight);
  }
  const rawW = img.w, rawH = img.h;
  if (minAspect > 0) img = padAspect(img, minAspect);
  return { png: encodePng(img), w: img.w, h: img.h, rawW, rawH };
}
