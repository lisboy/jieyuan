using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Shiyuan.Core;

namespace Shiyuan.Core.Runner;

/// <summary>
/// 战斗解算的命令行外壳：解算本身在 Core 的 BattleSolve，这里只管 JSON 进出。
/// 之所以还留着独立进程，是因为 Node 侧的构建期工具（14 天经济模拟、卡面数值、关卡校验）
/// 必须用同一份 C# 结算，而不是第二套 JS 实现——两套公式迟早会漂。
/// 桌面客户端不用这层：它进程内直接调 BattleSolve。
/// 用法：battle --in/--out 单次解算；battle-repl 常驻，按行读请求、按行写结果。
/// </summary>
public static class BattleHost
{
    static readonly JsonSerializerOptions WriteOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    public static int Run(string[] args)
    {
        var reqPath = Value(args, "--in");
        var outPath = Value(args, "--out");
        if (reqPath == null || outPath == null)
        {
            Console.WriteLine("usage: battle --in <request.json> --out <result.json>");
            return 2;
        }
        var content = LoadContent();
        var req = JsonSerializer.Deserialize<Request>(File.ReadAllText(reqPath), Json.Options);
        if (req == null) { Console.WriteLine("bad request json"); return 2; }

        var resp = BattleSolve.Solve(req, content.cfg, content.cards);
        File.WriteAllText(outPath, JsonSerializer.Serialize(resp, WriteOpts), new UTF8Encoding(false));
        Console.WriteLine($"BATTLE win={resp.win} steps={resp.steps} turns={resp.turns.Count} deaths={resp.deaths} waves={resp.totalWaves}");
        return 0;
    }

    /// <summary>常驻模式：Node 侧只养一个进程，之后每场战斗是管道上的一行 JSON。
    /// 管道两端固定 UTF8，否则中文角色名会在 GBK 控制台上变成问号。</summary>
    public static int Repl(string[] args)
    {
        var content = LoadContent();
        var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        Console.SetOut(stdout);
        stdout.WriteLine("{\"ready\":true}");

        string? line;
        while ((line = stdin.ReadLine()) != null)
        {
            line = line.Trim();
            if (line.Length == 0) continue;
            if (line == "{}") return 0;
            try
            {
                var req = JsonSerializer.Deserialize<Request>(line, Json.Options);
                if (req == null) throw new InvalidDataException("empty request");
                stdout.WriteLine(JsonSerializer.Serialize(BattleSolve.Solve(req, content.cfg, content.cards), WriteOpts));
            }
            catch (Exception e)
            {
                stdout.WriteLine(JsonSerializer.Serialize(new Response { ok = false, error = e.Message }, WriteOpts));
            }
        }
        return 0;
    }

    static (GameConfig cfg, Dictionary<string, CharacterDoc> cards) LoadContent()
    {
        var root = FindRoot();
        var cfg = ContentLoader.LoadConfig(Path.Combine(root, "data"));
        var cards = ContentLoader.LoadAll(Path.Combine(root, "data")).ToDictionary(c => c.id);
        return (cfg, cards);
    }

    static string? Value(string[] args, string flag)
    {
        for (var i = 0; i + 1 < args.Length; i++) if (args[i] == flag) return args[i + 1];
        return null;
    }

    static string FindRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "package.json"))) dir = dir.Parent;
        return dir!.FullName;
    }
}
