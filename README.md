# JellyMute 🔇
<img width="1385" height="864" alt="Screenshot 2026-09-03 170802" src="https://github.com/user-attachments/assets/9547a212-bc9e-4f4a-9d18-760e2ebc775e" />

**Mute the parts you don't want to hear — in Jellyfin, on every screen.**

## Download

Grab both files from the [**Releases**](../../releases) page:

| File | What it is |
|------|------------|
| `JellyMute-Setup-1.0.0.exe` | The Windows desktop editor — install and start marking videos |
| `JellyMute-plugin-1.0.0.zip` | The Jellyfin 10.11 server plugin — unzip into your plugins folder |

JellyMute is two tools that work together:

| Part | What it is | Where it runs |
|------|------------|---------------|
| **JellyMute Desktop** | A video editor with a live audio waveform. Drag in a movie, listen, and drop markers over swear words (or anything else). Markers save to a `.mute` file next to the video automatically. | Your Windows PC (installer EXE) |
| **JellyMute Plugin** | A Jellyfin server plugin. When someone plays that video, the plugin reads the `.mute` file, shows a **JellyMute: On/Off** toggle on the details page, and mutes the audio exactly during the marked sections. | Your Jellyfin server (targets 10.11.x) |

```
you mark it                    Jellyfin plays it
┌─────────────────────┐        ┌──────────────────────────┐
│  Movie.mkv          │        │  Movie.mkv               │
│  Movie.mute  ◄────┐ │        │  Movie.mute  ──► plugin  │
│  (auto-created)   │ │        │              mutes audio │
└───────────────────┼─┘        └────────────▲─────────────┘
                    └── JellyMute Desktop   │ toggle: On/Off
                        (drag video in,     on the details page —
                         right-click to     viewer chooses
                         mark swears)       (tablet / PC / phone)
```

---

## Supported clients

Muting happens **in the player**, so it works wherever Jellyfin loads its web UI:

- ✅ Any browser (PC, laptop, tablet, phone)
- ✅ Jellyfin **Android app** (phones & tablets)
- ✅ Jellyfin **iOS app** (iPhone & iPad)
- ❌ Native TV apps (Android TV / Fire TV / Roku / etc.) — these apps don't load the
  web UI, so no server plugin can control their volume. On a TV, use the browser
  or cast from a supported client.

## Install

### 1. Desktop editor

Download `JellyMute-Setup-x.y.z.exe` from [Releases](../../releases) and run it.
Then just **drag a video onto the window** — JellyMute creates `VideoName.mute`
next to the video and keeps it saved as you work.

You can also right-click any video → *Open with* → JellyMute, or run
`JellyMute.exe "C:\path\Movie.mp4"`.

### 2. Jellyfin plugin (manual install, 10.11.x)

1. Download `JellyMute-plugin-x.y.z.zip` from [Releases](../../releases).
2. Unzip it into your Jellyfin plugins folder:
   - **Windows:** `C:\ProgramData\Jellyfin\Server\plugins\JellyMute\JellyMute.dll`
   - **Linux:** `/var/lib/jellyfin/plugins/JellyMute/JellyMute.dll`
   - **Docker:** inside the container at `/config/plugins/JellyMute/JellyMute.dll`
3. Restart Jellyfin.
4. Check **Dashboard → Plugins → JellyMute** is listed and enabled.

> Check your server version first: **Dashboard → About**. Plugin builds are
> version-specific — this build targets **10.11.x**.

That's it. Open any movie that has a `.mute` file next to it — the details page
now shows a **JellyMute** toggle (green dot = on), and playback mutes during the
marked sections. Each viewer's on/off choice is remembered.

## The editor, in one minute

- **Drag a video in** → waveform builds automatically (cached, so it's instant next time).
- **Right-click** the waveform → drops a 1-second marker.
- **Right-drag** on empty space → draw a marker exactly where the swear is.
- **Right-drag a marker's edge** → trim it tight. **Right-drag its middle** → slide it.
- **Left-click** → move the playhead. **Left-drag on the playhead** → scrub. **Left-drag anywhere else** → pan the timeline.
- **Mouse wheel** → zoom around the cursor (Shift+wheel = pan; double-click a marker = zoom to it).
- **Keyboard:** `Space` play/pause · `S`/`E` mark start/end while listening · `[` `]` jump between markers · `A` add at playhead · `Del` delete · `←`/`→` ±1 s (Shift = ±0.1 s) · `F` fullscreen · `Ctrl+O` open.
- **Preview mutes** (on by default) — playback goes silent wherever you've marked, exactly like Jellyfin will play it.
- Every change **auto-saves** to `VideoName.mute` — nothing to export, the plugin sees updates immediately.

## The `.mute` file

```json
{
  "version": 1,
  "generator": "JellyMute Desktop 1.0.0",
  "source": "Movie.mp4",
  "intervals": [
    { "start": "00:14:32.480", "end": "00:14:35.120" }
  ]
}
```

Timestamps are `HH:MM:SS`, with milliseconds only when needed. Full spec:
[docs/mute-format.md](docs/mute-format.md). The plugin also understands a bare
`[{ "start": ..., "end": ... }]` array.

## Building from source

**Desktop** (Node 20+ on Windows):
```bash
cd desktop
npm install
npm test          # unit + waveform integration tests
npm start         # run the app
npm run dist      # build JellyMute-Setup-x.y.z.exe
```

**Plugin** (.NET 9 SDK):
```bash
dotnet test plugin/JellyMute.Tests -c Release
dotnet publish plugin/JellyMute -c Release -o publish
# → publish/JellyMute.dll
```

## Releases (GitHub Actions)

- Push a tag `desktop-v1.0.1` → builds and attaches `JellyMute-Setup-1.0.1.exe`.
- Push a tag `plugin-v1.0.1` → builds, tests and attaches `JellyMute-plugin-1.0.1.zip`.

## Troubleshooting

- **No toggle on the details page?** The plugin looks for the sidecar *next to the
  video file Jellyfin streams*. Make sure `Movie.mute` sits in the same folder as
  the file, spelled exactly like the video with the extension replaced.
- **Viewer unmutes during a swear** — that's respected: JellyMute won't fight the
  viewer; it resumes muting at the next marker.
- **Exotic codecs (DTS/TrueHD audio, HEVC)** play fine in Jellyfin but can't be
  *previewed* in the desktop editor — the waveform and marking still work.
- **After a Jellyfin upgrade** the plugin may need a rebuild against the new
  version (plugins are version-specific).

## License

[MIT](LICENSE) — © 2026 Renaldo Goosen
