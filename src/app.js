import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loadBook, normalizePath, searchBook, chapterAt } from './book.js';
import { safeText, wrapBook, rowAt, graphemes } from './text.js';
import { dimensions, renderScreen } from './screen.js';

export const commands = [
  { command: '/open', label: '打开 TXT 文件', hint: '/open ' },
  { command: '/books', label: '最近阅读' },
  { command: '/chapters', label: '章节目录' },
  { command: '/search', label: '搜索全文', hint: '/search ' },
  { command: '/bookmark', label: '添加 / 取消当前书签' },
  { command: '/bookmarks', label: '查看书签' },
  { command: '/goto', label: '跳转页码或百分比', hint: '/goto ' },
  { command: '/mode', label: '切换阅读 / 代码助手外观' },
  { command: '/theme', label: '切换深色 / 浅色 / 终端主题' },
  { command: '/width', label: '正文宽度（auto 或 36–500）', hint: '/width ' },
  { command: '/reflow', label: '合并正文硬换行（on / off）', hint: '/reflow ' },
  { command: '/work', label: '锁定文字输入，只保留翻页；F2 恢复' },
  { command: '/step', label: '每次翻动行数（如 /step 5）', hint: '/step ' },
  { command: '/help', label: '快捷键和使用说明' },
  { command: '/quit', label: '保存并退出' },
];

const help = [
  ['空格 / ↓ / → / Enter / PageDown', '下翻：默认整页，可用 /step 调整'], ['↑ / ← / PageUp', '按相同行数上翻'], ['j / k', '下一行 / 上一行'],
  ['Home / End', '书籍开头 / 结尾'], ['[ / ]', '上一章 / 下一章'], ['b', '添加或取消当前书签'],
  ['c', '章节目录'], ['s', '搜索全文'], ['n / p', '下一处 / 上一处搜索结果'],
  ['Esc', '隐藏正文；再次按下恢复'], ['/', '命令菜单'], ['q / Ctrl+C', '保存并退出'],
  ['/open 路径', '支持空格、中文、拖入文件'], ['/goto 35% 或 /goto 12', '跳转到进度或页码'],
  ['/mode reader | code', '外观切换'], ['/theme dark | light | terminal', '主题切换'],
  ['/width auto | 120', '自适应宽度，或指定 36–500 列'], ['/reflow on | off', '合并中文正文硬换行 / 保留原始换行'],
  ['/work / F2', '乱打字不显示；方向键翻页；F2 恢复输入'], ['字号', '在终端的字体设置中调整'],
  ['文件格式', 'TXT / 纯文本 MD；UTF-8、GB18030、UTF-16'],
  ['/step 5', '每次翻动 5 个显示行（含空行）'], ['/step auto', '恢复整页翻动；/step 查看当前值'],
];

export class ReaderApp {
  constructor(store, { input = process.stdin, output = process.stdout } = {}) {
    this.store = store;
    this.stdin = input; this.stdout = output;
    this.book = null; this.offset = 0; this.wrapped = []; this.rowIndex = 0;
    this.input = ''; this.inputActive = false; this.panel = null; this.selection = 0;
    this.message = store.warning; this.highlight = ''; this.results = []; this.resultIndex = -1;
    this.cover = false; this.workMode = false; this.closed = false; this.started = false;
    this.saveTimer = null; this.drawTimer = null;
    this.cacheWidth = 0; this.cacheBook = null;
    this.handleKey = this.handleKey.bind(this);
    this.handleResize = () => { this.reflow(); this.scheduleDraw(); };
  }

  get columns() { return this.stdout.columns || 100; }
  get rows() { return this.stdout.rows || 35; }
  get bodyHeight() { return dimensions(this.columns, this.rows, this.store.state.settings.width).bodyHeight; }
  get pageStep() {
    const step = this.store.state.settings.step;
    return step === 'auto' ? this.bodyHeight : Math.min(step, this.bodyHeight);
  }

  open(filename) {
    // Load first, so a failed open never discards the current book or position.
    const book = loadBook(filename);
    if (this.book) this.persist();
    this.book = book;
    const saved = this.store.record(book);
    this.offset = Math.min(saved.offset, book.text.length - 1);
    this.message = saved.fingerprint && saved.fingerprint !== book.fingerprint ? '文件已更新，已尽量恢复原位置。' : '已打开 · 阅读进度自动保存';
    this.highlight = ''; this.results = []; this.resultIndex = -1;
    this.closePanel(); this.reflow(); this.queueSave();
  }

  reflow() {
    if (!this.book) return;
    const d = dimensions(this.columns, this.rows, this.store.state.settings.width);
    const reflow = this.store.state.settings.reflow;
    if (this.cacheWidth !== d.contentWidth || this.cacheBook !== this.book || this.cacheReflow !== reflow) {
      this.wrapped = wrapBook(this.book.text, d.contentWidth, { reflow, chapterOffsets: this.book.chapters.map(ch => ch.offset) });
      this.cacheWidth = d.contentWidth; this.cacheBook = this.book; this.cacheReflow = reflow;
    }
    this.rowIndex = rowAt(this.wrapped, this.offset);
  }

  move(delta) {
    this.rowIndex = Math.max(0, Math.min(this.wrapped.length - 1, this.rowIndex + delta));
    this.offset = this.wrapped[this.rowIndex].start;
    this.message = this.rowIndex + this.bodyHeight >= this.wrapped.length ? '已到最后一页' : '';
    this.queueSave();
  }

  jump(offset) {
    this.offset = Math.max(0, Math.min(this.book.text.length - 1, offset));
    this.reflow(); this.closePanel(); this.queueSave();
  }

  turnPage(direction) {
    if (direction > 0 && this.rowIndex + this.bodyHeight >= this.wrapped.length) {
      this.message = '已到最后一页'; return;
    }
    const delta = direction * this.pageStep;
    // Fixed-line scrolling stops with the final screen filled when possible.
    this.move(direction > 0 && this.store.state.settings.step !== 'auto'
      ? Math.min(delta, Math.max(0, this.wrapped.length - this.bodyHeight - this.rowIndex))
      : delta);
  }

  queueSave() {
    if (this.book) this.store.remember(this.book, this.offset);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 220);
    this.saveTimer.unref?.();
  }

  persist() {
    clearTimeout(this.saveTimer);
    if (this.book) this.store.remember(this.book, this.offset);
    try { this.store.save(); this.saveError = null; }
    catch (error) { this.saveError = error; this.message = `无法保存进度：${safeText(error.message)}`; this.scheduleDraw(); }
  }

  bookmark() {
    const entry = this.store.record(this.book);
    const anchor = this.wrapped[this.rowIndex].start;
    const index = entry.bookmarks.findIndex(mark => rowAt(this.wrapped, mark.offset) === this.rowIndex);
    if (index >= 0) { entry.bookmarks.splice(index, 1); this.message = '已取消当前书签'; }
    else {
      entry.bookmarks.push({ offset: anchor, title: this.book.text.slice(anchor, anchor + 50).replace(/\n/g, ' '), chapter: chapterAt(this.book, anchor).title });
      entry.bookmarks.sort((a, b) => a.offset - b.offset);
      this.message = '书签已保存 · /bookmarks 查看';
    }
    this.queueSave();
  }

  openPanel(panel, input = '') {
    this.panel = panel; this.input = input; this.inputActive = true; this.selection = 0;
  }
  closePanel() { this.panel = null; this.input = ''; this.inputActive = false; this.selection = 0; }

  setWorkMode(enabled) {
    this.workMode = enabled;
    this.closePanel(); this.cover = false;
    this.message = enabled ? '输入已锁定 · 方向键翻页 · F2 恢复输入' : '已恢复输入';
  }

  panelMeta() {
    const metadata = {
      books: { title: '最近阅读', subtitle: 'Enter 继续阅读 · /open 打开其他文件', empty: '还没有阅读记录。' },
      chapters: { title: '章节目录', subtitle: `${this.book.chapters.length} 个章节 · 输入章节名称筛选` },
      bookmarks: { title: '我的书签', subtitle: 'Enter 跳转 · Delete 删除选中的书签', empty: '还没有书签；阅读时按 b 添加。' },
      search: { title: '搜索正文', subtitle: '输入关键词即搜索 · Enter 跳转 · 返回后 n / p 切换结果', empty: this.input ? '没有找到匹配文字。' : '输入要查找的文字。' },
      file: { title: '打开小说', subtitle: '输入或粘贴文件路径 · Tab 补全 · Enter 打开目录或文件', empty: '未找到匹配文件，可直接输入完整路径。' },
      help: { title: '使用说明', subtitle: '方向键浏览 · Esc 返回正文' },
    };
    return metadata[this.panel];
  }

  panelItems() {
    let items = [];
    if (this.panel === 'books') items = [...this.store.state.books].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .map(b => ({ title: safeText(b.title), detail: `${Math.floor(b.offset / Math.max(1, b.length || 1) * 100)}%`, filename: b.path }));
    if (this.panel === 'chapters') items = this.book.chapters.map((c, i) => ({ ...c, detail: String(i + 1).padStart(2, '0') }));
    if (this.panel === 'bookmarks') items = this.store.record(this.book).bookmarks.map(b => ({ ...b, detail: `${Math.floor(b.offset / this.book.text.length * 100)}%` }));
    if (this.panel === 'search') {
      // Cache while navigating results; do not rescan a large book on every draw.
      if (this.searchCache?.query !== this.input || this.searchCache?.book !== this.book) this.searchCache = { query: this.input, book: this.book, results: searchBook(this.book, this.input) };
      return this.searchCache.results.map(r => ({ ...r, detail: r.chapter }));
    }
    if (this.panel === 'help') items = help.map(([title, detail]) => ({ title, detail }));
    if (this.panel === 'file') return this.fileItems();
    const query = this.input.toLowerCase();
    return items.filter(i => (i.title + ' ' + (i.detail || '')).toLowerCase().includes(query));
  }

  fileItems() {
    try {
      const resolved = normalizePath(this.input || '.');
      const isDirectory = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
      const directory = isDirectory ? resolved : path.dirname(resolved);
      const prefix = isDirectory ? '' : path.basename(resolved).toLowerCase();
      const entries = fs.readdirSync(directory, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && e.name.toLowerCase().startsWith(prefix) && (e.isDirectory() || e.isSymbolicLink() || /\.(txt|text|md)$/i.test(e.name)))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh'))
        .slice(0, 300).map(e => ({ title: (e.isDirectory() ? '▸ ' : '  ') + safeText(e.name), detail: e.isDirectory() ? '目录' : 'TXT', filename: path.join(directory, e.name), directory: e.isDirectory() }));
      if (!prefix && path.dirname(directory) !== directory) entries.unshift({ title: '↰ ..', detail: '上一级', filename: path.dirname(directory), directory: true });
      return entries;
    } catch { return []; }
  }

  suggestions() {
    if (this.panel || !this.inputActive || !this.input.startsWith('/') || this.input.includes(' ')) return [];
    return commands.filter(c => c.command.startsWith(this.input.toLowerCase()));
  }

  selectPanel() {
    const items = this.panelItems();
    const selected = items[this.selection];
    if (this.panel === 'file') {
      const raw = normalizePath(this.input || '.');
      if (fs.existsSync(raw) && fs.statSync(raw).isFile()) this.open(raw);
      else if (selected) {
        if (fs.statSync(selected.filename).isDirectory()) { this.input = selected.filename + path.sep; this.selection = 0; }
        else this.open(selected.filename);
      } else this.open(raw);
    } else if (selected && this.panel === 'books') this.open(selected.filename);
    else if (selected && this.panel === 'search') {
      this.highlight = this.input.trim(); this.results = items; this.resultIndex = this.selection;
      this.jump(selected.offset); this.message = `${this.resultIndex + 1} / ${this.results.length} 处匹配 · n / p 切换`;
    } else if (selected && ['chapters', 'bookmarks'].includes(this.panel)) this.jump(selected.offset);
  }

  execute(text) {
    const raw = text.trim();
    const [command = ''] = raw.split(/\s+/);
    const argument = raw.slice(command.length).trim();
    this.closePanel();
    switch (command.toLowerCase()) {
      case '/open': if (argument) this.open(argument); else this.openPanel('file', process.cwd() + path.sep); break;
      case '/books': this.openPanel('books'); break;
      case '/chapters': this.openPanel('chapters'); break;
      case '/search': this.openPanel('search', argument); break;
      case '/bookmark': this.bookmark(); break;
      case '/bookmarks': this.openPanel('bookmarks'); break;
      case '/help': this.openPanel('help'); break;
      case '/quit': case '/exit': this.stop(); break;
      case '/theme': {
        const themes = ['dark', 'light', 'terminal'];
        const next = argument || themes[(themes.indexOf(this.store.state.settings.theme) + 1) % themes.length];
        if (!themes.includes(next)) throw new Error('用法：/theme dark | light | terminal');
        this.store.state.settings.theme = next; this.message = `主题：${next}`; this.queueSave(); break;
      }
      case '/mode': {
        const mode = argument || (this.store.state.settings.mode === 'reader' ? 'code' : 'reader');
        if (!['reader', 'code'].includes(mode)) throw new Error('用法：/mode reader | code');
        this.store.state.settings.mode = mode; this.message = mode === 'code' ? '已切换代码助手外观' : '已切换阅读外观'; this.queueSave(); break;
      }
      case '/width': {
        if (argument) {
          if (argument !== 'auto' && (!/^\d+$/.test(argument) || Number(argument) < 36 || Number(argument) > 500)) {
            throw new Error('用法：/width auto，或 /width 120（36–500 个终端列）');
          }
          this.store.state.settings.width = argument === 'auto' ? 'auto' : Number(argument);
          this.reflow(); this.queueSave();
        }
        const setting = this.store.state.settings.width;
        const current = dimensions(this.columns, this.rows, setting).contentWidth;
        this.message = `正文宽度：${setting === 'auto' ? '自适应' : setting + ' 列'}（当前 ${current} 列） · /reflow on 可合并硬换行`;
        break;
      }
      case '/reflow': {
        if (argument) {
          if (!['on', 'off'].includes(argument)) throw new Error('用法：/reflow on | off');
          this.store.state.settings.reflow = argument === 'on'; this.reflow(); this.queueSave();
        }
        this.message = this.store.state.settings.reflow ? '已合并中文正文硬换行 · /reflow off 恢复原始排版' : '保留文件原始换行 · /reflow on 合并正文硬换行';
        break;
      }
      case '/work': {
        if (argument && !['on', 'off'].includes(argument)) throw new Error('用法：/work，或 /work on | off；F2 恢复输入');
        this.setWorkMode(argument ? argument === 'on' : !this.workMode);
        break;
      }
      case '/step': {
        if (argument) {
          if (argument !== 'auto' && (!/^[1-9]\d*$/.test(argument) || Number(argument) > 200)) {
            throw new Error('用法：/step 5（1–200 行），或 /step auto 恢复整页');
          }
          this.store.state.settings.step = argument === 'auto' ? 'auto' : Number(argument);
          this.queueSave();
        }
        const step = this.store.state.settings.step;
        this.message = step === 'auto'
          ? `每次翻动：整页（当前 ${this.bodyHeight} 行） · /step 5 可调整`
          : `每次翻动：${this.pageStep} 行${step > this.bodyHeight ? `（设定 ${step} 行，按一屏上限）` : ''} · /step auto 恢复整页`;
        break;
      }
      case '/goto': {
        if (/^\d+(?:\.\d+)?%$/.test(argument)) {
          const percent = Number(argument.slice(0, -1));
          if (percent > 100) throw new Error('百分比应在 0%–100% 之间。');
          this.jump(percent === 100 ? this.wrapped[Math.floor((this.wrapped.length - 1) / this.bodyHeight) * this.bodyHeight].start : Math.floor((this.book.text.length - 1) * percent / 100));
        } else if (/^[1-9]\d*$/.test(argument)) {
          const page = Number(argument), total = Math.ceil(this.wrapped.length / this.bodyHeight);
          if (page > total) throw new Error(`当前共有 ${total} 页。`);
          this.jump(this.wrapped[(page - 1) * this.bodyHeight].start);
        } else throw new Error('用法：/goto 12 或 /goto 35%');
        break;
      }
      default:
        if (!raw) break;
        // Absolute Unix paths also start with '/': check actual paths before reporting a command error.
        if (fs.existsSync(normalizePath(raw)) || !raw.startsWith('/')) this.open(raw);
        else throw new Error('找不到命令或文件；输入 /help 查看帮助。');
    }
  }

  submit() {
    if (this.panel) { this.selectPanel(); return; }
    const menu = this.suggestions();
    const selected = menu[this.selection];
    if (selected && !commands.some(c => c.command === this.input)) {
      if (selected.hint && selected.command !== '/open') { this.input = selected.hint; this.selection = 0; return; }
      this.execute(selected.command); return;
    }
    this.execute(this.input);
  }

  handleKey(char, key = {}) {
    if (this.closed) return;
    try {
      if (key.ctrl && ['c', 'd'].includes(key.name)) { this.stop(); return; }
      if (key.name === 'f2') { this.setWorkMode(!this.workMode); this.scheduleDraw(); return; }
      if (this.workMode) {
        // Ignore printable keys, shortcuts, paste, Space and Enter before they
        // reach any input, menu, bookmark or file-opening handler.
        if (key.name === 'escape') this.cover = !this.cover;
        else if (!this.cover && ['down', 'right', 'pagedown'].includes(key.name)) this.turnPage(1);
        else if (!this.cover && ['up', 'left', 'pageup'].includes(key.name)) this.turnPage(-1);
        else return;
        this.scheduleDraw(); return;
      }
      if (this.cover) { if (key.name === 'escape') this.cover = false; else if (char === 'q') this.stop(); this.scheduleDraw(); return; }
      if (key.name === 'escape') {
        if (this.inputActive || this.panel) this.closePanel();
        else this.cover = true;
      } else if (this.inputActive) {
        const items = this.panel ? this.panelItems() : this.suggestions();
        if (key.name === 'return') this.submit();
        else if (key.name === 'up') this.selection = Math.max(0, this.selection - 1);
        else if (key.name === 'down') this.selection = Math.min(Math.max(0, items.length - 1), this.selection + 1);
        else if (key.name === 'pageup') this.selection = Math.max(0, this.selection - 8);
        else if (key.name === 'pagedown') this.selection = Math.min(Math.max(0, items.length - 1), this.selection + 8);
        else if (key.name === 'tab') {
          if (this.panel === 'file' && items[this.selection]) this.input = items[this.selection].filename + (items[this.selection].directory ? path.sep : '');
          else if (!this.panel && items[this.selection]) this.input = items[this.selection].hint || items[this.selection].command;
          this.selection = 0;
        } else if (key.name === 'delete' && this.panel === 'bookmarks' && items[this.selection]) {
          const bookmarks = this.store.record(this.book).bookmarks;
          const index = bookmarks.findIndex(b => b.offset === items[this.selection].offset);
          if (index >= 0) bookmarks.splice(index, 1);
          this.selection = Math.max(0, Math.min(this.selection, bookmarks.length - 1)); this.queueSave();
        } else if (key.name === 'backspace') {
          this.input = graphemes(this.input).slice(0, -1).join(''); this.selection = 0;
          if (!this.input && !this.panel) this.inputActive = false;
        } else if (key.ctrl && key.name === 'u') { this.input = ''; this.selection = 0; }
        else if (key.ctrl && key.name === 'w') { this.input = this.input.replace(/\S+\s*$/, ''); this.selection = 0; }
        else if (char && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(char)) {
          this.input = (this.input + safeText(char)).slice(0, 4096); this.selection = 0;
        }
      } else if (['down', 'right', 'pagedown', 'return'].includes(key.name) || char === ' ') this.turnPage(1);
      else if (['up', 'left', 'pageup'].includes(key.name)) this.turnPage(-1);
      else if (char === 'j') this.move(1);
      else if (char === 'k') this.move(-1);
      else if (key.name === 'home') this.jump(0);
      else if (key.name === 'end') this.jump(this.wrapped[Math.floor((this.wrapped.length - 1) / this.bodyHeight) * this.bodyHeight].start);
      else if (char === 'q') this.stop();
      else if (char === 'b') this.bookmark();
      else if (char === 'c') this.openPanel('chapters');
      else if (char === 's') this.openPanel('search');
      else if (char === '[' || char === ']') {
        const current = this.book.chapters.indexOf(chapterAt(this.book, this.offset));
        this.jump(this.book.chapters[Math.max(0, Math.min(this.book.chapters.length - 1, current + (char === ']' ? 1 : -1)))].offset);
      } else if ((char === 'n' || char === 'p') && this.results.length) {
        this.resultIndex = (this.resultIndex + (char === 'n' ? 1 : -1) + this.results.length) % this.results.length;
        this.jump(this.results[this.resultIndex].offset); this.message = `${this.resultIndex + 1} / ${this.results.length} 处匹配 · n / p 切换`;
      } else if (char && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(char)) {
        this.input = safeText(char); this.inputActive = true; this.selection = 0;
      }
    } catch (error) { this.message = safeText(error.message); }
    this.scheduleDraw();
  }

  scheduleDraw() {
    if (!this.started || this.closed || this.drawTimer) return;
    this.drawTimer = setTimeout(() => { this.drawTimer = null; this.draw(); }, 16);
  }
  draw() {
    if (this.closed) return;
    // Disable autowrap while painting a complete grid; restore it on exit.
    this.stdout.write('\x1b[?2026h\x1b[H' + renderScreen(this, this.columns, this.rows).replace(/\n/g, '\r\n') + '\x1b[?2026l');
  }
  start() {
    this.started = true;
    readline.emitKeypressEvents(this.stdin);
    this.stdin.setRawMode(true); this.stdin.resume(); this.stdin.on('keypress', this.handleKey);
    this.stdout.on('resize', this.handleResize);
    this.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h');
    this.draw();
  }
  stop() {
    if (this.closed) return;
    this.persist(); this.closed = true;
    clearTimeout(this.drawTimer); clearTimeout(this.saveTimer);
    if (this.started) {
      this.stdin.off('keypress', this.handleKey); this.stdout.off('resize', this.handleResize);
      if (this.stdin.isTTY) this.stdin.setRawMode(false);
      this.stdin.pause();
      this.stdout.write('\x1b[?2026l\x1b[0m\x1b[?7h\x1b[?25h\x1b[?2004l\x1b[?1049l');
      this.stdout.write(this.saveError ? `\n进度保存失败：${safeText(this.saveError.message)}\n` : '\n阅读进度已保存，下次见。\n');
    }
  }
}
