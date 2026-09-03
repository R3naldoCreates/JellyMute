using MediaBrowser.Model.Plugins;

namespace JellyMute.Plugin;

/// <summary>
/// JellyMute plugin configuration (Dashboard → Plugins → JellyMute → edit via config file).
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets a value indicating whether the client script is injected into the web UI.
    /// Disabling this stops the toggle and muting from appearing in web-based clients.
    /// </summary>
    public bool EnableInjection { get; set; } = true;

    /// <summary>
    /// Gets or sets the default state of the per-item toggle when a viewer
    /// has not explicitly switched it on or off yet.
    /// </summary>
    public bool MutedByDefault { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether a small "JellyMute" indicator is
    /// shown on screen while playback is inside a muted interval.
    /// </summary>
    public bool ShowMutedIndicator { get; set; } = true;
}
