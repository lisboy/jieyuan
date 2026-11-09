/* 剧情配音情绪表（Story CV emotion map）
 * ------------------------------------------------------------------
 * 剧情台词的情绪由「角色人设 + 本句语气」共同决定，不写死在 Python 脚本里。
 * 本表只保存需要人工干预的句子；没登记的句子走 storyEmoAuto() 的关键词兜底。
 *
 * 结构：
 *   window.STORY_EMO = {
 *     "节点id-句序": { emo: "情绪描述（喂给 IndexTTS2 emo_mode=3）", weight: 0.0~1.0 }
 *   }
 *
 * ⚠️ 这个文件只负责「配音生产口径」，前端播放不依赖它；
 *    新增剧情后先在这里补情绪，再用 tools/gen-story-cv.mjs 生成配音。
 */
(function () {
  "use strict";

  /* 关键词兜底：按台词表面语气给一个可用情绪，避免漏登记时全部念成平调。
   * 顺序即优先级：惊叹/怒 → 悲 → 疑 → 笑 → 平。 */
  var RULES = [
    { re: /[！!]$|[——]{2,}[^。]*$|滚|闭嘴|死|杀|不许|放肆|住手/, emo: "情绪外放，音量抬高，咬字加重，尾音压住" },
    { re: /[？?]$/, emo: "带疑问地询问，句尾轻轻上扬，语气留白" },
    { re: /(……|\.\.\.)/, emo: "欲言又止，气声偏多，句尾散掉" },
    { re: /(别怕|可怜|舍不得|对不起|等我|回来|记得)/, emo: "压着情绪的低语，温柔里带一点酸" },
    { re: /(快|立刻|马上|走|动手|上)/, emo: "短促果断，语速偏快，尾字咬实" },
  ];

  function storyEmoAuto(text) {
    var t = String(text || "");
    for (var i = 0; i < RULES.length; i++) if (RULES[i].re.test(t)) return RULES[i].emo;
    return "自然陈述，按人物人设说话，句读清楚，不拖腔";
  }

  /* 人工登记：只写「和关键词兜底不一样」的句子 */
  var TABLE = {
    /* 第一章 · 蠹简先生：吃书页成瘾，越说越馋 */
    "c1-s12-b-1": { emo: "居高临下地哄骗，像拿糖逗小孩，语气温柔得发黏", weight: 0.8 },
    "c1-s12-b-3": { emo: "回味般的满足，压低声音咂摸，越说越饿", weight: 0.85 },
    "c1-s12-b-5": { emo: "假装关切，尾音上扬带笑，最后一句逼近", weight: 0.85 },

    /* 第二章 · 涂山月见（清冷狐主）与云中等（小师妹） */
    "c2-s01-b-1": { emo: "警惕而疏离，语速慢，压着声警告", weight: 0.75 },
    "c2-s01-b-3": { emo: "急切慌张，语速快，带着担忧", weight: 0.8 },
    "c2-s03-b-1": { emo: "低沉解释，语气凝重", weight: 0.7 },
    "c2-s03-b-3": { emo: "压低声音的惊疑，尾音发颤", weight: 0.8 },
    "c2-s05-b-2": { emo: "俯身低语，神秘而迟疑", weight: 0.7 },
    "c2-s08-b-1": { emo: "不安地压低声音，越说越快", weight: 0.78 },
    "c2-s08-b-2": { emo: "冷冷一句，警觉", weight: 0.7 },
    "c2-s08-a-2": { emo: "轻声感慨，带一点无奈", weight: 0.65 },
    "c2-s10-b-1": { emo: "震惊后压低声，像发现秘密", weight: 0.8 },
    "c2-s10-b-2": { emo: "缓慢叙述，带着怜悯", weight: 0.72 },
    "c2-s12-b-1": { emo: "幽幽地喃喃，气息发颤，带着执念", weight: 0.85 },
    "c2-s12-b-3": { emo: "委屈转怒，声音拔高", weight: 0.85 },
    "c2-s12-b-4": { emo: "轻声劝慰，带着怜惜", weight: 0.7 },
    "c2-s12-b-5": { emo: "被刺痛后的怨毒，越说越冷", weight: 0.88 },
    "c2-s12-a-3": { emo: "轻快温柔，带点俏皮", weight: 0.72 },

    /* 第三章 · 顾霜心（清冷气声）与弃霜人（被除名者） */
    "c3-s01-b-1": { emo: "清冷疏离，淡淡的抱怨", weight: 0.7 },
    "c3-s01-b-3": { emo: "忧心忡忡，语气发沉", weight: 0.75 },
    "c3-s03-b-1": { emo: "低声陈述，带着疑惑", weight: 0.7 },
    "c3-s03-b-3": { emo: "压低声音提到禁忌，犹豫", weight: 0.75 },
    "c3-s05-b-2": { emo: "平静的冷悟", weight: 0.65 },
    "c3-s08-b-1": { emo: "公事公办的提醒", weight: 0.62 },
  };

  window.STORY_EMO = TABLE;
  window.storyEmoAuto = storyEmoAuto;
  /* 带人设前缀的完整提示词：IndexTTS2 需要「怎么念」，也吃人设里的音色描述 */
  window.storyEmoOf = function (nid, idx, text, persona) {
    var hit = TABLE[nid + "-" + idx];
    var base = hit ? hit.emo : storyEmoAuto(text);
    return persona ? persona + "；" + base : base;
  };
  window.storyEmoWeightOf = function (nid, idx) {
    var hit = TABLE[nid + "-" + idx];
    return hit && typeof hit.weight === "number" ? hit.weight : 0.72;
  };
})();
