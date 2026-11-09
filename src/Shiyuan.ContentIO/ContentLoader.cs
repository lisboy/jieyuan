using System.Text.Json;

namespace Shiyuan.Core;

/// <summary>
/// 运行时档案读取。解析函数只吃字符串，所以同一份代码既能读磁盘（dotnet 交叉验证），
/// 也能在 Unity 里喂 StreamingAssets/TextAsset 或 Addressables 的文本。
/// </summary>
public static class ContentLoader
{
    public static GameConfig ParseConfig(string json) => Json.Parse<GameConfig>(json);
    public static CharacterDoc ParseCharacter(string json) => Json.Parse<CharacterDoc>(json);
    public static IndexDoc ParseIndex(string json) => Json.Parse<IndexDoc>(json);

    public static GameConfig LoadConfig(string dataRoot) =>
        ParseConfig(File.ReadAllText(Path.Combine(dataRoot, "config.json")));

    public static IndexDoc LoadIndex(string dataRoot) =>
        ParseIndex(File.ReadAllText(Path.Combine(dataRoot, "index.json")));

    public static CharacterDoc LoadCharacter(string dataRoot, string id) =>
        ParseCharacter(File.ReadAllText(Path.Combine(dataRoot, "characters", id, "character.json")));

    /// <summary>整表载入：81 张卡约 1MB JSON，一次性读完比懒加载更省事。
    /// 小怪档案也在这里并入（关卡敌人全是小怪，战斗解算要能查到它们的数值模板）。</summary>
    public static List<CharacterDoc> LoadAll(string dataRoot)
    {
        var index = LoadIndex(dataRoot);
        var list = index.characters.Select(e => LoadCharacter(dataRoot, e.id)).ToList();
        var mobsPath = Path.Combine(dataRoot, "mobs.json");
        if (File.Exists(mobsPath))
        {
            var mobs = Json.Parse<MobIndexDoc>(File.ReadAllText(mobsPath));
            foreach (var m in mobs.mobs)
            {
                if (list.Any(c => c.id == m.id)) continue;
                list.Add(LoadCharacter(dataRoot, m.id));
            }
        }
        return list;
    }

    public sealed class MobIndexDoc
    {
        public int schema { get; set; }
        public int count { get; set; }
        public List<MobIndexRow> mobs { get; set; } = new();
    }

    public sealed class MobIndexRow
    {
        public string id { get; set; } = "";
    }
}
