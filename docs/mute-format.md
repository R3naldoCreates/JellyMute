# The `.mute` file format

A `.mute` file is a small JSON sidecar that sits **next to a video file** and describes
the time intervals that should be muted during playback (e.g. swear words).

## Location and naming

For a video file, the sidecar is stored in the same folder with the extension replaced by `.mute`:

```
/Movies/Movie (2024)/Movie (2024).mp4
/Movies/Movie (2024)/Movie (2024).mute      <-- sidecar
```

The JellyMute plugin also accepts the appended form `Movie (2024).mp4.mute` as a fallback.

## Structure

```json
{
  "version": 1,
  "generator": "JellyMute Desktop 1.0.0",
  "source": "Movie (2024).mp4",
  "intervals": [
    { "start": "00:14:32.480", "end": "00:14:35.120" },
    { "start": "01:02:00", "end": "01:02:03" }
  ]
}
```

| Key         | Required | Meaning                                            |
|-------------|----------|----------------------------------------------------|
| `version`   | no       | Format version, currently `1`.                     |
| `generator` | no       | Name/version of the tool that wrote the file.      |
| `source`    | no       | File name of the video this sidecar belongs to.    |
| `intervals` | yes      | Array of `{ "start": ..., "end": ... }` objects.   |

A **bare array** (without the wrapper object) is also valid and accepted by the plugin:

```json
[
  { "start": "00:14:32.480", "end": "00:14:35.120" }
]
```

## Timestamps

- Format: `HH:MM:SS` (24-hour), with an optional fractional part `.mmm`.
- Milliseconds are included **only when needed** — intervals that land exactly on
  whole seconds are written as plain `HH:MM:SS`.
- The parser accepts `H:MM:SS`, `HH:MM:SS.f`, `HH:MM:SS.ff`, `HH:MM:SS.fff` and
  comma as the decimal separator (`HH:MM:SS,fff`).
- `start` must be before `end`. Intervals must not overlap. An interval shorter
  than 0.1 s is ignored.
- Timestamps are offsets from the **start of the media file** (as played by
  Jellyfin), not from any chapter boundaries.

## Semantics during playback

While playback time `t` satisfies `start <= t < end`, the client mutes the audio;
the viewer's previous volume level is restored when playback exits the interval.
Muting is frame-tight (polled every animation frame, not on coarse time-update events).
