using JellyMute.Plugin.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace JellyMute.Plugin;

/// <summary>
/// Registers JellyMute's services with Jellyfin's DI container — most importantly
/// the <see cref="IStartupFilter"/> that injects the client script tag into the
/// jellyfin-web index.html response at request time (no files on disk are modified).
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<IStartupFilter, ScriptInjectionStartupFilter>();
    }
}
