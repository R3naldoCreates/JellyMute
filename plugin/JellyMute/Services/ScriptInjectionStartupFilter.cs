using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace JellyMute.Plugin.Services;

/// <summary>
/// ASP.NET middleware (registered via IStartupFilter) that injects the JellyMute
/// client script tag into the jellyfin-web index.html response at request time.
///
/// - Only ever touches GET responses for the web shell ("/web", "/web/", "/web/index.html").
/// - Idempotent: no-ops when the script tag is already present.
/// - Defensive: on any error the original HTML is served unchanged.
/// - Never writes to the web folder on disk (survives Jellyfin updates, Docker-safe).
/// </summary>
public class ScriptInjectionStartupFilter : IStartupFilter
{
    private readonly ILogger<ScriptInjectionStartupFilter> _logger;

    public ScriptInjectionStartupFilter(ILogger<ScriptInjectionStartupFilter> logger)
    {
        _logger = logger;
    }

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        // Registered before the rest of the pipeline so this middleware runs
        // outermost: stripping compression/range headers below then reliably
        // yields a plain, complete response body we can rewrite.
        return app =>
        {
            app.Use(InvokeAsync);
            next(app);
        };
    }

    private async Task InvokeAsync(HttpContext context, Func<Task> nextMiddleware)
    {
        if (!IsIndexRequest(context.Request.Path.Value))
        {
            await nextMiddleware().ConfigureAwait(false);
            return;
        }

        // Only rewrite complete GET HTML responses; other verbs must pass through
        // untouched so the host emits correct headers for them.
        if (!HttpMethods.IsGet(context.Request.Method))
        {
            await nextMiddleware().ConfigureAwait(false);
            return;
        }

        var config = JellyMutePlugin.Instance?.Configuration;
        if (config is null || !config.EnableInjection)
        {
            await nextMiddleware().ConfigureAwait(false);
            return;
        }

        // Request a plain, complete 200 we can rewrite: no compression, no ranges.
        context.Request.Headers.Remove("Accept-Encoding");
        context.Request.Headers.Remove("Range");
        context.Request.Headers.Remove("If-Range");

        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await nextMiddleware().ConfigureAwait(false);
        }
        catch
        {
            // Downstream failure is not ours to swallow: restore the real body and
            // let the host's exception handler deal with it.
            context.Response.Body = originalBody;
            throw;
        }

        context.Response.Body = originalBody;
        buffer.Seek(0, SeekOrigin.Begin);

        var isHtml = context.Response.StatusCode == StatusCodes.Status200OK
            && (context.Response.ContentType?.Contains("text/html", StringComparison.OrdinalIgnoreCase) ?? false);

        if (!isHtml)
        {
            await buffer.CopyToAsync(originalBody).ConfigureAwait(false);
            return;
        }

        string html;
        using (var reader = new StreamReader(buffer, System.Text.Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 1024, leaveOpen: true))
        {
            html = await reader.ReadToEndAsync().ConfigureAwait(false);
        }

        try
        {
            var scriptUrl = $"{context.Request.PathBase.Value?.TrimEnd('/')}/JellyMute/ClientScript.js?v={PluginVersion}";
            var scriptTag = $"<script src=\"{scriptUrl}\" defer></script>";

            var bodyClose = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
            if (bodyClose < 0)
            {
                _logger.LogDebug("JellyMute: no </body> found in index.html; skipping injection.");
            }
            else if (html.Contains(scriptUrl, StringComparison.OrdinalIgnoreCase))
            {
                // already injected — idempotent no-op
            }
            else
            {
                html = html.Substring(0, bodyClose) + scriptTag + html.Substring(bodyClose);

                _logger.LogInformation(
                    "JellyMute: injected script into index.html for client: {UserAgent}",
                    context.Request.Headers.UserAgent.ToString());
            }
        }
        catch (Exception ex)
        {
            // Never break index.html — serve whatever we have.
            _logger.LogWarning(ex, "JellyMute: script injection failed; serving original HTML.");
        }

        var bytes = System.Text.Encoding.UTF8.GetBytes(html);
        context.Response.ContentType = "text/html;charset=utf-8";
        context.Response.ContentLength = bytes.Length;
        // The body changed, so validators/range metadata from the static handler
        // no longer match what we are sending.
        context.Response.Headers.Remove("ETag");
        context.Response.Headers.Remove("Last-Modified");
        context.Response.Headers.Remove("Accept-Ranges");
        await originalBody.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
    }

    private static string PluginVersion =>
        JellyMutePlugin.Instance is null ? "0" : JellyMutePlugin.Instance.Version.ToString(3);

    // Matches the web shell however it is requested: bare "/web", "/web/"
    // (SPA serve) and explicit "/web/index.html". EndsWith keeps this correct
    // when Jellyfin sits behind a base URL such as "/jellyfin/web/".
    private static bool IsIndexRequest(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return false;
        }

        return path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/web", StringComparison.OrdinalIgnoreCase);
    }
}
