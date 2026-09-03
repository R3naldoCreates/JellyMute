using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace JellyMute.Plugin.Services;

/// <summary>A single muted interval, in seconds from the start of the media.</summary>
public record MuteInterval(double StartSeconds, double EndSeconds, string Start, string End);

/// <summary>
/// Locates ".mute" sidecar files next to media paths and parses them.
/// Accepts {"intervals":[{start,end}]} or a bare [{start,end}] array, with
/// timestamps of the form HH:MM:SS(.fff) (comma decimals tolerated).
/// </summary>
public static class MuteFileService
{
    private static readonly string[] VideoExtensions =
    {
        ".mp4", ".m4v", ".mkv", ".webm", ".mov", ".avi", ".ts", ".m2ts", ".mpg", ".mpeg", ".wmv", ".ogv"
    };

    public static bool IsVideoPath(string path) =>
        VideoExtensions.Contains(Path.GetExtension(path.AsSpan()).ToString(), StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Finds the sidecar for a media path: "Movie.mute" (extension replaced) is
    /// preferred, "Movie.mp4.mute" (extension appended) is accepted as a fallback.
    /// </summary>
    public static string? FindSidecarPath(string mediaPath)
    {
        try
        {
            var primary = Path.ChangeExtension(mediaPath, ".mute");
            if (File.Exists(primary))
            {
                return primary;
            }

            var alt = mediaPath + ".mute";
            return File.Exists(alt) ? alt : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Parses a sidecar; returns sorted, valid intervals or null when absent/corrupt.</summary>
    public static List<MuteInterval>? Parse(string sidecarPath, ILogger logger)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(sidecarPath));
            var root = doc.RootElement;

            JsonElement? intervals = null;
            if (root.ValueKind == JsonValueKind.Array)
            {
                intervals = root;
            }
            else if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("intervals", out var iv) && iv.ValueKind == JsonValueKind.Array)
            {
                intervals = iv;
            }

            if (intervals is null)
            {
                return null;
            }

            var result = new List<MuteInterval>();
            foreach (var entry in intervals.Value.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var start = ParseTimestamp(TryGetString(entry, "start"));
                var end = ParseTimestamp(TryGetString(entry, "end"));
                if (start is null || end is null || end <= start)
                {
                    continue;
                }

                result.Add(new MuteInterval(start.Value, end.Value, TryGetString(entry, "start") ?? string.Empty, TryGetString(entry, "end") ?? string.Empty));
            }

            if (result.Count == 0)
            {
                return null;
            }

            result.Sort((a, b) => a.StartSeconds.CompareTo(b.StartSeconds));
            return result;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "JellyMute: could not parse sidecar {Sidecar}", sidecarPath);
            return null;
        }
    }

    /// <summary>Parses "HH:MM:SS", "HH:MM:SS.fff", "H:MM:SS,fff", "MM:SS" or plain seconds.</summary>
    public static double? ParseTimestamp(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var span = value.Trim().Replace(',', '.');

        if (span.Contains(':'))
        {
            var parts = span.Split(':');
            if (parts.Length is < 2 or > 3)
            {
                return null;
            }

            // All segments except the first are minutes/seconds and must be 0-59;
            // the first segment is hours (any value).
            for (var i = 1; i < parts.Length; i++)
            {
                if (!double.TryParse(parts[i], System.Globalization.CultureInfo.InvariantCulture, out var seg)
                    || seg < 0 || seg >= 60)
                {
                    return null;
                }
            }

            double seconds = 0;
            foreach (var part in parts)
            {
                if (!double.TryParse(part, System.Globalization.CultureInfo.InvariantCulture, out var n))
                {
                    return null;
                }

                seconds = (seconds * 60) + n;
            }

            return seconds >= 0 ? seconds : null;
        }

        if (double.TryParse(span, System.Globalization.CultureInfo.InvariantCulture, out var plain) && plain >= 0)
        {
            return plain;
        }

        return null;
    }

    private static string? TryGetString(JsonElement obj, string name)
    {
        if (obj.TryGetProperty(name, out var el))
        {
            return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
        }

        return null;
    }
}
