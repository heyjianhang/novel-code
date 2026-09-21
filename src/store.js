import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function dataDirectory() {
  return process.env.NOVEL_CODE_HOME || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'novel-code');
}

export class Store {
  constructor(directory = dataDirectory()) {
    this.directory = directory;
    this.filename = path.join(directory, 'state.json');
    this.warning = '';
    this.corrupt = false;
    this.state = { version: 1, settings: { theme: 'dark', mode: 'reader', width: 'auto', reflow: false, step: 'auto' }, books: [], lastBook: null };
    try {
      const input = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      if (!input || input.version !== 1 || !Array.isArray(input.books)) throw new Error('bad state');
      this.state.books = input.books.filter(b => b && typeof b.path === 'string' && typeof b.id === 'string')
        .map(b => ({ ...b, title: typeof b.title === 'string' ? b.title : path.basename(b.path), offset: Number.isFinite(b.offset) ? Math.max(0, b.offset) : 0, bookmarks: Array.isArray(b.bookmarks) ? b.bookmarks.filter(m => m && Number.isFinite(m.offset) && typeof m.title === 'string') : [] }));
      this.state.lastBook = typeof input.lastBook === 'string' ? input.lastBook : null;
      const s = input.settings || {};
      if (['dark', 'light', 'terminal'].includes(s.theme)) this.state.settings.theme = s.theme;
      if (['reader', 'code'].includes(s.mode)) this.state.settings.mode = s.mode;
      if (Number.isFinite(s.width)) this.state.settings.width = Math.max(36, Math.min(500, Math.round(s.width)));
      if (typeof s.reflow === 'boolean') this.state.settings.reflow = s.reflow;
      if (Number.isInteger(s.step) && s.step >= 1 && s.step <= 200) this.state.settings.step = s.step;
    } catch (error) {
      if (error.code !== 'ENOENT') { this.warning = '进度文件异常；旧文件将在下次保存时备份。'; this.corrupt = true; }
    }
  }

  record(book) {
    let entry = this.state.books.find(b => b.id === book.id);
    if (!entry) {
      entry = { id: book.id, path: book.path, title: book.title, offset: 0, bookmarks: [] };
      this.state.books.push(entry);
    }
    return entry;
  }

  remember(book, offset) {
    const entry = this.record(book);
    Object.assign(entry, { title: book.title, path: book.path, offset: Math.max(0, Math.min(offset, book.text.length - 1)), length: book.text.length, fingerprint: book.fingerprint, updatedAt: new Date().toISOString() });
    this.state.lastBook = book.id;
  }

  save() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (this.corrupt && fs.existsSync(this.filename)) {
      fs.copyFileSync(this.filename, `${this.filename}.backup-${Date.now()}`);
      this.corrupt = false;
    }
    const temp = `${this.filename}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(this.state, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temp, this.filename);
    } finally { try { fs.unlinkSync(temp); } catch {} }
  }
}
