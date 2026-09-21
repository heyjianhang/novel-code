import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { safeText } from './text.js';

export function normalizePath(value) {
  let text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1);
  if (text.startsWith('file://')) return fileURLToPath(text);
  text = text.replace(/\\([ ()\[\]'"\\])/g, '$1');
  if (text === '~') text = os.homedir();
  else if (text.startsWith('~/')) text = path.join(os.homedir(), text.slice(2));
  return path.resolve(text);
}

export function decodeBuffer(buffer) {
  let encoding = 'UTF-8';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = 'UTF-16LE';
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = 'UTF-16BE';
  else {
    const head = buffer.subarray(0, 2000);
    if (head.length > 8) {
      let even = 0, odd = 0;
      for (let i = 0; i < head.length; i++) if (head[i] === 0) i % 2 ? odd++ : even++;
      if (odd > head.length * 0.25) encoding = 'UTF-16LE';
      else if (even > head.length * 0.25) encoding = 'UTF-16BE';
    }
  }
  let text;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(buffer); }
  catch {
    if (encoding !== 'UTF-8') throw new Error('文件编码不完整，请尝试另存为 UTF-8。');
    try {
      encoding = 'GB18030';
      text = new TextDecoder('gb18030', { fatal: true }).decode(buffer);
    } catch { throw new Error('无法识别文件编码，请将文件另存为 UTF-8 TXT。'); }
  }
  if (text.includes('\0')) throw new Error('这似乎是二进制文件，请打开 TXT 文本文件。');
  text = safeText(text).replace(/^\ufeff/, '').replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n').replace(/\t/g, '    ')
    .replace(/[ \u3000]+$/gm, '').replace(/\n{4,}/g, '\n\n\n').trimEnd();
  if (!text.trim()) throw new Error('文件没有可阅读的文字。');
  return { text, encoding };
}

export function findChapters(text) {
  const chapters = [];
  const heading = /^(?:第[\d０-９〇○零一二三四五六七八九十百千万两]{1,14}[章节回卷部篇集](?:[\s\u3000:：、.．]|$|[^\d])|chapter\s+[\divxlc]+\b|(?:序章|楔子|引子|序言|前言|后记|尾声|终章|番外)(?:\s|[：:.、]|$))/iu;
  let offset = 0;
  for (const line of text.split('\n')) {
    const label = line.trim().replace(/^#{1,6}\s*/, '');
    if (label.length <= 72 && heading.test(label)) chapters.push({ title: label, offset });
    offset += line.length + 1;
  }
  if (!chapters.length) chapters.push({ title: '全文', offset: 0 });
  else if (chapters[0].offset > 0 && text.slice(0, chapters[0].offset).trim()) chapters.unshift({ title: '开篇', offset: 0 });
  return chapters;
}

export function loadBook(filename) {
  const resolved = normalizePath(filename);
  let realPath, stat;
  try { realPath = fs.realpathSync(resolved); stat = fs.statSync(realPath); }
  catch (error) {
    throw new Error(error.code === 'ENOENT' ? `找不到文件：${resolved}` : `无法读取文件：${error.message}`);
  }
  if (!stat.isFile()) throw new Error('请选择一个 TXT 文件。');
  if (/\.(epub|pdf|docx?|zip|png|jpe?g|gif|exe)$/i.test(realPath)) throw new Error('这一版支持 TXT / 纯文本 Markdown；请先将这本书导出为 TXT。');
  if (stat.size > 50 * 1024 * 1024) throw new Error('文件超过 50 MB，请先拆分成较小的 TXT 文件。');
  const { text, encoding } = decodeBuffer(fs.readFileSync(realPath));
  return {
    path: realPath,
    id: createHash('sha256').update(realPath).digest('hex').slice(0, 24),
    title: safeText(path.basename(realPath, path.extname(realPath))),
    text, encoding, chapters: findChapters(text),
    fingerprint: `${stat.size}:${stat.mtimeMs}`,
  };
}

export function chapterAt(book, offset) {
  let current = book.chapters[0];
  for (const chapter of book.chapters) {
    if (chapter.offset > offset) break;
    current = chapter;
  }
  return current;
}

export function searchBook(book, query, limit = 300) {
  const needle = query.trim();
  if (!needle) return [];
  const results = [];
  let cursor = 0;
  while (results.length < limit) {
    const offset = book.text.indexOf(needle, cursor);
    if (offset < 0) break;
    const from = Math.max(book.text.lastIndexOf('\n', offset - 1) + 1, offset - 18);
    results.push({ offset, title: book.text.slice(from, offset + needle.length + 50).replace(/\n/g, ' '), chapter: chapterAt(book, offset).title });
    cursor = offset + Math.max(1, needle.length);
  }
  return results;
}
