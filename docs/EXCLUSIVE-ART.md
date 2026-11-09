# 专属缘器 · 出图（生图 API 模型）

> 81 件「专属缘器」立绘的批量出图流程。走**生图 API 模型**（OpenAI 兼容的
> `/images/generations` 端点），不再使用 ChatGPT 网页抓取。
>
> 相关文件：
> - `content/exclusive-art.json` —— **提示词词库与模板**（改画风/器形/配色改这里，不用动代码）
> - `content/art/<名>-<id>/专属缘器.prompt.md` —— 每个角色实际发出的提示词存档（81 份）
> - `tools/make-exclusive-art-ai.mjs` —— 拼提示词 / 导出作业 / 调生图 API
> - `tools/make-exclusive-art.mjs` —— 程序化 SVG 兜底（零成本，缺 PNG 时前端用它）
> - `content/art/<名>-<id>/专属缘器.png` —— **AI 出图产物（人工编辑源）**
> - `data/characters/<id>/art/exclusive.png` —— 上面那份的构建拷贝（`npm run build` 生成，别手改）

---

## 0. 通道与配置

出图由 `dsh-taptap-maker-dev` 的 `src/taptap-image.mjs` 调用，端点/模型/Key 三件套：

- 配置文件：`~/.dsh/taptap-maker-dev/image.json`（`{"baseURL","apiKey","model","size"}`）
- 或环境变量：`TAPTAP_IMAGE_BASE_URL` / `TAPTAP_IMAGE_API_KEY` / `TAPTAP_IMAGE_MODEL` / `TAPTAP_IMAGE_SIZE`
- 查看当前生效配置（Key 会打码）：`node "C:\Users\Lisboy\.dsh\profiles\web\node_modules\dsh-taptap-maker-dev\src\taptap-image.mjs" --config`

> 只要端点兼容 OpenAI 的 `/v1/images/generations` 即可（返回 `data[].b64_json` 或 `data[].url`）。
> 支持尺寸 `1024x1024 / 1024x1536 / 1536x1024`；不是这三种会自动就近重试一次。

---

## 1. 一句话用法

```bash
npm run art:exclusive:daily      # 每天一批（12 张），已出过 png 的自动跳过
npm run art:exclusive:all        # 补齐所有缺图的
npm run art:exclusive:jobs       # 只导出作业清单 target/exclusive-jobs.json（不调用 API）
```

产物落在 `content/art/<名>-<id>/专属缘器.png`。出图后要补两步才显示出来：

```bash
npm run build                                  # 拷成 data/characters/<id>/art/exclusive.png
node tools/art-jobs.mjs --mark <id>/exclusive  # 记下 promptHash，之后改提示词才会被判过期
```

**改了 `serve.mjs` 需重启服务**，普通刷新只重新拉图。

只重做某一张：

```bash
node tools/make-exclusive-art-ai.mjs --only ur-zf-01 --force
```

---

## 2. 用内置 ImageGen 或外部工具出图（不经 API）

不想用它配的 API，也可以只拿提示词，自己用内置 ImageGen / 任何工具出：

```bash
node tools/make-exclusive-art-ai.mjs --emit-jobs target/exclusive-jobs.json
```

作业清单每条是 `{id, prompt, out, force}`；按 `prompt` 出图，把结果存到 `out` 指向的
`content/art/<名>-<id>/专属缘器.png`，再 `npm run build` 即可。

> 注意：内置 ImageGen 的**图生图（带参考图）**偶发 `400 no models available`，纯文生图正常。
> 批量出专属缘器都是纯文字 prompt，不受影响；只有“在成品上做局部重绘”这类编辑才会撞上。

---

## 3. 提示词在哪

| 位置 | 是什么 | 什么时候改 |
|---|---|---|
| `content/exclusive-art.json` | 词库 + 模板（六气配色、7×4 器形、纹样/宝石/气纹/坠饰/气质/背景） | 想换画风、加器形、调配色 |
| `content/art/<名>-<id>/专属缘器.prompt.md` | 该角色最终发出去的提示词（81 份，入库） | 只读参考；要单独调某个角色时改它并用 `--only <id>` |

拼装逻辑在 `tools/make-exclusive-art-ai.mjs` 的 `promptFor()`，按**角色 id 的稳定哈希**取值，
同一角色每次拼出来的提示词完全一致。每次运行会把全部 81 个角色的 `专属缘器.prompt.md`
重刷一遍；加 `--no-archive` 可跳过。

器形按 **6 个维度**稳定哈希取值（器形 7 定位×4 变体 / 纹样 10 / 宝石 7 / 气纹 6 / 坠饰 6 / 气质 8），
避免 81 张撞脸。

> 踩过的坑：roster 里 `element` / `role` 是**字符串**（`"storm"` / `"control"`），
> 早期按对象取 `.code` 导致全部退化默认组合。现在 `codeOf()` 兼容两种写法。

---

## 4. 产物与前端联动

```
content/art/<名>-<id>/专属缘器.png      人工编辑源（出图直接写这里）
        │ npm run build
        ▼
data/characters/<id>/art/exclusive.png  运行时读的那一份
        │ 不存在时回退
        ▼
data/exclusive/<id>.svg                 程序化兜底，不会白框
```

选择逻辑在 `tools/serve.mjs` 的 `exclusiveIcon()`。`data/exclusive/` 下**只放 svg**。

---

## 5. 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| `custom image endpoint not configured` | image.json / 环境变量没配全 | 按第 0 节配 baseURL/model/apiKey |
| `endpoint returned non-JSON 200` | baseURL 填错/被代理页拦截 | 核对 baseURL |
| 连接失败 | 端点不可达/网络 | 先确认端点可用再重试（脚本不会自动重试以避免重复计费） |
| 尺寸被拒 | 端点不接受该尺寸 | 自动就近重试；仍失败就在 image.json 固定 size |
| 图出好了但界面还是占位图 | 忘了 `npm run build` | 产物要在 `content/art/...`，然后 build |

---

## 6. 兜底：不联网也能出图

```bash
npm run art:exclusive:svg     # 生成 81 张 data/exclusive/<id>.svg
```

按 六气配色 × 定位器形 × 角色铭文 生成，矢量、零额度、风格统一，前端在没有 PNG 时自动使用。
