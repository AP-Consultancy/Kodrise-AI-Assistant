# Capture Policy & Window Privacy — Phase 2F

> Documented Electron/OS window content protection + capability diagnostics  
> Electron API: `BrowserWindow.setContentProtection` (Electron 36.x)

---

## Architecture

```
Public config.capture.windowPrivacyPolicy
        ↓
CapturePolicyHost (main)
        ↓
CapturePolicyService (core)
        ↓
ElectronCaptureCapabilityProvider
        ↓
BrowserWindow.setContentProtection(true|false)
```

Core is platform-independent. Electron/OS details live in `src/main/capture/`.

---

## Policies

| Policy | Behavior |
|--------|----------|
| `STANDARD` | Normal window; content protection off |
| `PRIVACY_AWARE` | Enable documented content protection where supported |
| `DISABLED` | Explicitly keep protection off |

Persisted as `publicConfig.capture.windowPrivacyPolicy`.

---

## Electron API

- **API:** [`win.setContentProtection(boolean)`](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable)
- **Project Electron:** `^36.4.0`
- **Windows:** Uses OS window display affinity (exclude-from-capture on supported Windows 10 2004+)
- **macOS:** API available; effectiveness varies by capture path/OS
- **Linux:** No equivalent documented guarantee; capability reported `UNSUPPORTED`

---

## Capability statuses

`SUPPORTED` · `PARTIAL` · `UNSUPPORTED` · `UNKNOWN` · `NOT_CONFIGURED` · `ERROR`

Successful API configuration ≠ every third-party recorder honoring the setting.

---

## Platform summary

| Platform | Window protection | Overall typical |
|----------|-------------------|-----------------|
| Windows | SUPPORTED (API) | PARTIAL (coverage) |
| macOS | PARTIAL | PARTIAL |
| Linux (X11/Wayland) | UNSUPPORTED | UNSUPPORTED |

---

## IPC

```
capture.getPlatform()
capture.getCapabilities()
capture.getStatus()
capture.getPolicy()
capture.applyPolicy(policy)
capture.resetPolicy()
capture.getHarness()
```

Events: `capture.policy.changed`, `capture.capability.changed`, `capture.diagnostic.updated`

---

## Manual test matrix

For each row record: Platform, OS version, Electron version, Capture mechanism, Expected documented behavior, Observed behavior, PASS/FAIL/PARTIAL, Limitations.

### Windows

| Capture mechanism | Expected (documented) | Notes |
|-------------------|----------------------|-------|
| Full-display capture | PARTIAL — may still include window | Distinguish API configured vs recorder respected |
| Application/window capture | Often excludes protected window | Verify with OS Snipping Tool / Game Bar / OBS |
| Local recording | PARTIAL | Depends on recorder API |
| Multi-monitor | Same as above per display share mode | |

### macOS

| Capture mechanism | Expected | Notes |
|-------------------|----------|-------|
| Full-display | PARTIAL / UNKNOWN | Validate per OS version |
| App/window capture | PARTIAL | |
| Local recording | PARTIAL | |

### Linux

| Display server | Expected | Notes |
|----------------|----------|-------|
| X11 | UNSUPPORTED | Policy apply returns failure for PRIVACY_AWARE |
| Wayland | UNSUPPORTED | Same |

**Critical distinction:** “API successfully configured” ≠ “third-party capture application respected protection.”

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| PRIVACY_AWARE fails | Platform capabilities in diagnostics |
| Protection enabled but still captured | Expected for some full-display paths — see limitations |
| Policy not restored | `public-config.json` → `capture.windowPrivacyPolicy` |

---

## Security

- No injection, meeting-app modification, or undocumented hooks
- Existing Electron security flags unchanged
- Logs: policy/status metadata only
