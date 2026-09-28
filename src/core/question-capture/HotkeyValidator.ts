import type { QuestionCaptureMode } from '../../shared/question-capture/types';

const ACCELERATOR_PART =
  /^(CommandOrControl|Command|Control|Ctrl|Alt|Option|AltGr|Shift|Super|Meta)$/i;
const KEY_PART = /^([A-Za-z0-9]|F([1-9]|1[0-9]|2[0-4])|Plus|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Escape|Up|Down|Left|Right)$/i;

/**
 * Validate Electron globalShortcut accelerators without registering them.
 */
export class HotkeyValidator {
  parse(hotkey: string): { ok: true; normalized: string } | { ok: false; reason: string } {
    const raw = hotkey.trim();
    if (!raw) {
      return { ok: false, reason: 'Hotkey is required.' };
    }
    if (raw.length > 80) {
      return { ok: false, reason: 'Hotkey is too long.' };
    }
    const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      return { ok: false, reason: 'Hotkey must include a modifier and a key.' };
    }
    const key = parts[parts.length - 1]!;
    const mods = parts.slice(0, -1);
    if (!KEY_PART.test(key)) {
      return { ok: false, reason: 'Invalid hotkey key.' };
    }
    if (mods.length === 0 || !mods.every((m) => ACCELERATOR_PART.test(m))) {
      return { ok: false, reason: 'Invalid hotkey modifier.' };
    }
    const normalizedMods = mods.map((m) => {
      if (/^ctrl$/i.test(m) || /^control$/i.test(m)) return 'CommandOrControl';
      if (/^cmd$/i.test(m) || /^command$/i.test(m)) return 'CommandOrControl';
      if (/^option$/i.test(m)) return 'Alt';
      if (/^commandorcontrol$/i.test(m)) return 'CommandOrControl';
      return m[0]!.toUpperCase() + m.slice(1).toLowerCase().replace('orcontrol', 'OrControl');
    });
    // Dedupe CommandOrControl
    const uniqueMods = [...new Set(normalizedMods.map((m) =>
      /commandorcontrol/i.test(m) ? 'CommandOrControl' : m,
    ))];
    const normalizedKey = /^[a-z]$/i.test(key) ? key.toUpperCase() : key;
    return { ok: true, normalized: [...uniqueMods, normalizedKey].join('+') };
  }

  isValidMode(mode: string): mode is QuestionCaptureMode {
    return mode === 'region' || mode === 'active_window' || mode === 'full_screen';
  }
}
