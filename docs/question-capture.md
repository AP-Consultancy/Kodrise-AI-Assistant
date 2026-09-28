# Question Capture (Phase 2Q)

User-triggered screenshot → OCR/Vision → AI answer in the live interview chat.

## What this is

An **explicit** hotkey workflow. The candidate presses a configured shortcut, selects a question region, confirms **Analyze Question**, and the app:

1. Captures the region (no background polling)
2. Runs OCR (Vision fallback)
3. Extracts / classifies the question (language & dialect when present)
4. Routes coding/SQL/debug/output problems through Problem Intelligence
5. Publishes the answer into the existing interview conversation UI

## What this is not

- Continuous screen polling
- Automatic Teams/Zoom/Meet chat monitoring
- Clipboard polling
- Hidden / stealth capture
- Separate user-facing modes for “SQL” / “Java” / “Coding”

## Settings

**Settings → Appearance**

- **Question Capture Hotkey** (default `CommandOrControl+Shift+Q`)
- **Capture Mode**: Select Region (default) | Active Window | Full Screen

## Flow

```
Hotkey
  → Select region (Retake / Analyze / Cancel)
  → Screenshot
  → OCR → Vision fallback
  → CapturedQuestion
  → Problem Intelligence (when applicable)
  → Existing AI chat answer
```

## Privacy

- Frames stay in memory
- Cleared after analysis / cancel / session end
- Screenshot bytes are never logged

## Manual tests

1. Live interview → press hotkey → select region → Analyze → answer appears in chat
2. Escape / Cancel aborts cleanly
3. Pause interview → hotkey shows a friendly error
4. End / New Interview clears capture state
5. Unsupported SQL dialect shows verification unavailable (not claimed verified)
6. Multiple numbered questions prompts selection

## Limitations

- Region crop depends on `desktopCapturer` thumbnails (scaled); very small regions may be low quality
- Active Window / Full Screen skip the drag UI but are still user-triggered via hotkey
- Real OS sandbox execution remains the Problem Intelligence mock/pluggable providers
