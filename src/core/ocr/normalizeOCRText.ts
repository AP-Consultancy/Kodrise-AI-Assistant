export function normalizeOCRText(text: string, maxCharacters: number): string {
  const collapse = (value: string): string =>
    value
      .replace(/\r\n/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line, index, arr) => !(line === '' && arr[index - 1] === ''))
      .filter((line, index, arr) => line !== arr[index - 1])
      .join('\n')
      .trim();

  const normalized = collapse(text);
  if (normalized.length <= maxCharacters) {
    return normalized;
  }
  return collapse(`${normalized.slice(0, maxCharacters)}\n…[ocr truncated]`);
}
