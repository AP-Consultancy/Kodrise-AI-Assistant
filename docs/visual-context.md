# Visual Context Foundation — Phase 2G

> Explicit visual capture → validate → bound → transient store → ContextSnapshot  
> Phase 2G scope: capture foundation only. OCR/vision live in Phase 2H — see `docs/visual-intelligence.md`.

---

## Architecture

```
User explicit action
        ↓
VisualContextHost (main)
        ↓
VisualCaptureProvider (Electron desktopCapturer / manual dialog)
        ↓
VisualContextManager (validate, dedupe, bound)
        ↓
VisualContextSnapshot (metadata + frame refs)
        ↓
ContextEngine / ContextSnapshot.visualContext
```

Image bytes stay in main-process memory only. IPC events carry metadata (ids, sizes, dimensions).

---

## Capture sources

| Source | Behavior |
|--------|----------|
| DISPLAY | `desktopCapturer` screen sources |
| WINDOW | `desktopCapturer` window sources |
| REGION | Screen capture + crop (`PARTIAL`) |
| MANUAL_IMAGE | Main-process file dialog |
| NONE | No capture |

Capture never starts on application launch.

---

## Electron APIs

- `desktopCapturer.getSources`
- `nativeImage` resize/crop/PNG/JPEG
- `dialog.showOpenDialog` for manual images
- macOS: `systemPreferences.getMediaAccessStatus('screen')`

Project Electron: **36.x**

---

## Configuration (`publicConfig.visualContext`)

```json
{
  "enabled": false,
  "source": "NONE",
  "maxFrames": 3,
  "maxImageBytes": 1500000,
  "maxWidth": 1280,
  "maxHeight": 720,
  "captureIntervalMs": 0,
  "maxVisualContextBytes": 4000000
}
```

Images are **not** written to `public-config.json`.

---

## Context Engine

`ContextSnapshot.visualContext` is optional. Priority remains text-first; visual metadata records frame counts / discarded / payload bytes.

---

## Session lifecycle

| Event | Visual behavior |
|-------|-----------------|
| Session start | Initialize subsystem (ready if enabled) |
| Session pause | Pause if capturing |
| Session resume | Resume if paused |
| Session stop | Stop capture, clear transient frames |

---

## Known limitations

- Region capture is crop-based (`PARTIAL`)
- macOS requires Screen Recording permission for reliable capture
- Linux depends on compositor / display server
- OCR / vision analysis are provided by Phase 2H (`docs/visual-intelligence.md`)
- `desktopCapturer` thumbnails are not a continuous video stream

---

## Security

- Renderer never calls Electron capture APIs directly
- No image bytes in logs
- Explicit user controls only
- Existing isolation / IPC validation unchanged
