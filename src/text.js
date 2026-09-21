import { stripVTControlCharacters } from 'node:util';

const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
export const graphemes = text => [...segmenter.segment(text)].map(part => part.segment);

// Strip terminal control sequences from external text before it reaches stdout.
export function safeText(text) {
  return stripVTControlCharacters(String(text))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
}

export function cellWidth(char) {
  if (!char || /^[\p{Mark}\u200b-\u200f\ufeff]+$/u.test(char)) return 0;
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(char)) return 2;
  const c = char.codePointAt(0);
  return c >= 0x1100 && (
    c <= 0x115f || c === 0x2329 || c === 0x232a ||
    (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
    (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe10 && c <= 0xfe19) || (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x20000 && c <= 0x3fffd)
  ) ? 2 : 1;
}

export function width(text) {
  return graphemes(stripVTControlCharacters(text)).reduce((sum, c) => sum + cellWidth(c), 0);
}

export function truncate(text, limit, suffix = '…') {
  if (width(text) <= limit) return text;
  const available = Math.max(0, limit - width(suffix));
  let result = '', used = 0;
  for (const char of graphemes(text)) {
    const cells = cellWidth(char);
    if (used + cells > available) break;
    result += char;
    used += cells;
  }
  return result + (limit >= width(suffix) ? suffix : '');
}

export function fit(text, limit) {
  const clipped = truncate(text, limit);
  return clipped + ' '.repeat(Math.max(0, limit - width(clipped)));
}

export function wrapLine(text, columns, start = 0) {
  if (!text) return [{ text: '', start, end: start }];
  const chars = graphemes(text);
  const rows = [];
  let i = 0, offset = start;
  while (i < chars.length) {
    const begin = i;
    let cells = 0, space = -1;
    while (i < chars.length && cells + cellWidth(chars[i]) <= columns) {
      cells += cellWidth(chars[i]);
      if (chars[i] === ' ') space = i;
      i++;
    }
    if (i === begin) i++;
    // Prefer a word boundary in Latin text, keeping offsets and every character.
    if (i < chars.length && /[a-zA-Z0-9]/.test(chars[i]) && space > begin + 3) i = space + 1;
    if (i < chars.length && /^[，。！？；：、）》」』】…]$/u.test(chars[i]) && i > begin + 1) i--;
    const value = chars.slice(begin, i).join('');
    rows.push({ text: value, start: offset, end: offset + value.length });
    offset += value.length;
  }
  return rows;
}

export function wrapBook(text, columns) {
  const rows = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    rows.push(...wrapLine(line, columns, offset));
    offset += line.length + 1;
  }
  return rows;
}

export function rowAt(rows, offset) {
  let low = 0, high = rows.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (rows[mid].start <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}
