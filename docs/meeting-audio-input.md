# Meeting / System Audio Input — Phase 2M

User-controlled audio source selection for the live interview pipeline.

## Modes

| `AudioInputMode` | Behavior |
|------------------|----------|
| `microphone` (default) | Existing mic → STT path unchanged |
| `meeting_audio` | Windows display-media loopback → STT (no silent mic fallback) |
| `microphone_and_meeting` | Two independent STT streams; transcript segments tagged by `source` |

Separate from `InterviewExecutionMode` (`real` | `simulation`). Simulation never auto-starts meeting audio.

## Architecture

```
AudioInputMode (Settings / publicConfig.audioInput)
        ↓
Renderer capture (getUserMedia and/or getDisplayMedia)
        ↓
audio.pushChunk { source }
        ↓
AudioHost → STT (primary) [+ optional meeting STT]
        ↓
TranscriptStore (source-tagged segments)
        ↓
Existing Question Detection → Context → AI
```

No second AI pipeline. Deepgram / Mock STT unchanged.

## Windows

- Capability: `process.platform === 'win32'`
- Path: Electron `session.setDisplayMediaRequestHandler` with documented `audio: 'loopback'`
- Synthetic device: `windows-system-loopback` (“System / Meeting Audio (loopback)”)
- Requires explicit Settings selection + Start Interview (+ consent banner)

## Limitations

- macOS / Linux: Meeting Audio reports unavailable (no native helper in this phase)
- Successful API init ≠ every meeting app’s share UI
- Dual stream uses two STT connections (not PCM mixing)
- No stealth, injection, or capture-bypass features

## Config

`publicConfig.audioInput`:

- `inputMode`
- `microphoneDeviceId`
- `meetingAudioDeviceId`
