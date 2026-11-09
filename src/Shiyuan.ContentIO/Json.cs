using System.Text.Json;
using System.Text.Json.Serialization;

namespace Shiyuan.Core;

/// <summary>JSON 约定集中在这里，Core 保持零序列化依赖（Unity 的 BCL 里没有 System.Text.Json）。</summary>
public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static T Parse<T>(string text) => JsonSerializer.Deserialize<T>(text, Options)!;
}
