using System.Reflection;
using JellyMute.Plugin.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace JellyMute.Plugin.Api;

/// <summary>
/// JellyMute API: interval lookup for playing items and the client script itself.
/// </summary>
[ApiController]
[Route("JellyMute")]
public class JellyMuteController : ControllerBase
{
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<JellyMuteController> _logger;

    public JellyMuteController(ILibraryManager libraryManager, ILogger<JellyMuteController> logger)
    {
        _libraryManager = libraryManager;
        _logger = logger;
    }

    /// <summary>
    /// Returns the mute intervals for an item, read from the .mute sidecar next to
    /// its media file. 404 when the item has no sidecar (the client then hides the toggle).
    /// </summary>
    [HttpGet("Item/{itemId}")]
    [Authorize]
    public ActionResult GetItemIntervals(Guid itemId)
    {
        _logger.LogInformation(
            "JellyMute: intervals requested for {ItemId} by client: {UserAgent}",
            itemId, Request.Headers.UserAgent.ToString());

        var item = _libraryManager.GetItemById(itemId);
        if (item is null || string.IsNullOrEmpty(item.Path))
        {
            _logger.LogInformation("JellyMute: item {ItemId} not found in library", itemId);
            return NotFound();
        }

        // Note: alternate versions of a movie are their own items with their own
        // paths, so item.Path is the correct sidecar anchor per played version.
        if (!MuteFileService.IsVideoPath(item.Path))
        {
            return NotFound();
        }

        var sidecar = MuteFileService.FindSidecarPath(item.Path);
        if (sidecar is null)
        {
            _logger.LogInformation(
                "JellyMute: no .mute sidecar next to {Path} (requested by: {UserAgent})",
                item.Path, Request.Headers.UserAgent.ToString());
            return NotFound();
        }

        var intervals = MuteFileService.Parse(sidecar, _logger);
        if (intervals is null)
        {
            return NotFound();
        }

        return Ok(new
        {
            itemId,
            mutedByDefault = JellyMutePlugin.Instance?.Configuration.MutedByDefault ?? true,
            source = Path.GetFileName(item.Path),
            intervals = intervals.Select(i => new
            {
                start = i.Start,
                end = i.End,
                startSeconds = i.StartSeconds,
                endSeconds = i.EndSeconds
            })
        });
    }

    /// <summary>
    /// Local-only diagnostic: shows which sidecar JellyMute resolves for items
    /// matching a search term. Only reachable from the server machine itself.
    /// </summary>
    [HttpGet("Debug")]
    [AllowAnonymous]
    public ActionResult Debug([FromQuery] string? search)
    {
        var remote = HttpContext.Connection.RemoteIpAddress;
        if (remote is null || !System.Net.IPAddress.IsLoopback(remote))
        {
            return StatusCode(403);
        }

        if (string.IsNullOrWhiteSpace(search))
        {
            return Ok(new { hint = "Append ?search=<part of an item name> to inspect sidecar resolution." });
        }

        var query = new InternalItemsQuery
        {
            SearchTerm = search,
            Limit = 20,
            Recursive = true
        };
        var items = _libraryManager.GetItemList(query)
            .Where(i => !i.IsFolder)
            .Take(8)
            .ToList();

        var results = items.Select(item =>
        {
            var path = item.Path;
            string? primary = null, alt = null;
            var intervals = -1;

            if (!string.IsNullOrEmpty(path))
            {
                primary = Path.ChangeExtension(path, ".mute");
                alt = path + ".mute";
                var sidecar = MuteFileService.FindSidecarPath(path);
                if (sidecar is not null)
                {
                    intervals = MuteFileService.Parse(sidecar, _logger)?.Count ?? 0;
                }
            }

            return new
            {
                name = item.Name,
                type = item.GetType().Name,
                path,
                sidecarPrimary = primary,
                primaryExists = primary is not null && System.IO.File.Exists(primary),
                sidecarAlt = alt,
                altExists = alt is not null && System.IO.File.Exists(alt),
                intervals
            };
        });

        return Ok(results);
    }

    /// <summary>
    /// Client-side diagnostic beacon: the injected script reports its internal
    /// state (playback binding, muting, toggle rendering) so issues on devices
    /// without a console (phones, tablets) can be diagnosed from the server log.
    /// </summary>
    [HttpGet("Log")]
    [AllowAnonymous]
    public ActionResult ClientLog([FromQuery] string? m)
    {
        var message = m is null ? string.Empty : (m.Length > 180 ? m[..180] : m);
        _logger.LogInformation(
            "JellyMute[client] {Message} ({UserAgent})",
            message, Request.Headers.UserAgent.ToString());
        return Ok();
    }

    /// <summary>
    /// The injected client script. Anonymous: it contains no data, only code —
    /// it authenticates itself for interval lookups with the viewer's own token.
    /// </summary>
    [HttpGet("ClientScript.js")]
    [Produces("application/javascript")]
    [AllowAnonymous]
    public ActionResult GetClientScript()
    {
        _logger.LogInformation(
            "JellyMute: ClientScript.js served to client: {UserAgent}",
            Request.Headers.UserAgent.ToString());

        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream("JellyMute.Plugin.Web.ClientScript.js");
        if (stream is null)
        {
            return NotFound();
        }

        using var reader = new StreamReader(stream);
        var body = reader.ReadToEnd();

        var config = JellyMutePlugin.Instance?.Configuration;
        var header =
            "window.__JELLYMUTE__ = { mutedByDefault: " +
            (config?.MutedByDefault ?? true ? "true" : "false") +
            ", showIndicator: " +
            (config?.ShowMutedIndicator ?? true ? "true" : "false") +
            " };\n";

        // no-store so configuration changes reach clients without a cache purge
        Response.Headers["Cache-Control"] = "no-store";
        return Content(header + body, "application/javascript");
    }
}
