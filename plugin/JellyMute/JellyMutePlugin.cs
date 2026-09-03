using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;

namespace JellyMute.Plugin;

/// <summary>
/// JellyMute — reads ".mute" sidecar files placed next to media files and mutes
/// those intervals in web-based Jellyfin clients.
/// </summary>
public class JellyMutePlugin : BasePlugin<PluginConfiguration>
{
    public static JellyMutePlugin? Instance { get; private set; }

    public JellyMutePlugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public override string Name => "JellyMute";

    public override string Description =>
        "Automatically mutes marked sections of a video during playback, using .mute sidecar " +
        "files created by the JellyMute desktop editor. Adds a per-item on/off toggle to the " +
        "details page of web-based clients.";

    public override Guid Id => new("7f2b9c4e-1d5a-4e8f-9c3b-a60d8e2f1b45");
}
