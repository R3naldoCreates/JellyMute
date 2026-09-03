using JellyMute.Plugin.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace JellyMute.Tests;

public class TimestampParsingTests
{
    [Theory]
    [InlineData("00:14:32", 872.0)]
    [InlineData("00:14:32.480", 872.48)]
    [InlineData("00:14:32,480", 872.48)]
    [InlineData("1:01:01", 3661.0)]
    [InlineData("23:59:59", 86399.0)]
    [InlineData("01:02:03.04", 3723.04)]
    [InlineData("90", 90.0)]
    [InlineData("90.5", 90.5)]
    public void ParsesValidTimestamps(string input, double expected)
    {
        Assert.Equal(expected, MuteFileService.ParseTimestamp(input));
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("-5")]
    [InlineData("12:99")]
    [InlineData("01:02:03:04")]
    public void RejectsInvalidTimestamps(string? input)
    {
        Assert.Null(MuteFileService.ParseTimestamp(input));
    }
}

public class SidecarParsingTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "jellymute-tests-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, true);
        }
    }

    private string WriteSidecar(string content, string name = "Movie.mute")
    {
        Directory.CreateDirectory(_dir);
        var path = Path.Combine(_dir, name);
        File.WriteAllText(path, content);
        return path;
    }

    [Fact]
    public void ParsesWrappedObject()
    {
        var path = WriteSidecar("""
            {
              "version": 1,
              "generator": "JellyMute Desktop 1.0.0",
              "source": "Movie.mp4",
              "intervals": [
                { "start": "00:14:32.480", "end": "00:14:35.120" },
                { "start": "01:02:00", "end": "01:02:03" }
              ]
            }
            """);

        var intervals = MuteFileService.Parse(path, NullLogger.Instance);

        Assert.NotNull(intervals);
        Assert.Equal(2, intervals!.Count);
        Assert.Equal(872.48, intervals[0].StartSeconds);
        Assert.Equal(875.12, intervals[0].EndSeconds);
        Assert.Equal(3720.0, intervals[1].StartSeconds);
    }

    [Fact]
    public void ParsesBareArray()
    {
        var path = WriteSidecar("""[ { "start": "00:01:00", "end": "00:01:30" } ]""");
        var intervals = MuteFileService.Parse(path, NullLogger.Instance);
        Assert.NotNull(intervals);
        Assert.Single(intervals!);
        Assert.Equal(60, intervals![0].StartSeconds);
    }

    [Fact]
    public void DropsInvalidEntries()
    {
        var path = WriteSidecar("""
            [
              { "start": "00:05:00", "end": "00:05:10" },
              { "start": "bogus", "end": "00:06:00" },
              { "start": "00:07:00", "end": "00:06:00" },
              { "start": 42, "end": 45.5 }
            ]
            """);

        var intervals = MuteFileService.Parse(path, NullLogger.Instance);

        Assert.NotNull(intervals);
        Assert.Equal(2, intervals!.Count);
        Assert.Equal(42.0, intervals[0].StartSeconds);
        Assert.Equal(300.0, intervals[1].StartSeconds);
    }

    [Fact]
    public void ReturnsNullForCorruptFile()
    {
        var path = WriteSidecar("{ definitely not json");
        Assert.Null(MuteFileService.Parse(path, NullLogger.Instance));
    }

    [Fact]
    public void FindSidecarPrefersReplacedExtension()
    {
        Directory.CreateDirectory(_dir);
        var video = Path.Combine(_dir, "Show.mkv");
        File.WriteAllText(video, "x");

        Assert.Null(MuteFileService.FindSidecarPath(video));

        File.WriteAllText(Path.Combine(_dir, "Show.mkv.mute"), "[]");
        Assert.Equal(Path.Combine(_dir, "Show.mkv.mute"), MuteFileService.FindSidecarPath(video));

        File.WriteAllText(Path.Combine(_dir, "Show.mute"), "[]");
        Assert.Equal(Path.Combine(_dir, "Show.mute"), MuteFileService.FindSidecarPath(video));
    }

    [Fact]
    public void IsVideoPathChecksExtensions()
    {
        Assert.True(MuteFileService.IsVideoPath("/x/Movie.MP4"));
        Assert.True(MuteFileService.IsVideoPath("/x/Movie.mkv"));
        Assert.False(MuteFileService.IsVideoPath("/x/image.jpg"));
        Assert.False(MuteFileService.IsVideoPath("/x/srt"));
    }
}
