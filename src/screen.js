import { fit, truncate, width, safeText } from './text.js';
import { chapterAt } from './book.js';

const palettes = {
  dark: { bg: [23, 22, 20], text: [222, 215, 202], dim: [142, 137, 128], accent: [225, 144, 103], rule: [73, 70, 65], selected: [53, 48, 42], good: [154, 188, 146] },
  light: { bg: [248, 244, 236], text: [51, 48, 42], dim: [119, 109, 94], accent: [158, 75, 38], rule: [207, 196, 179], selected: [231, 220, 201], good: [60, 115, 68] },
  terminal: { bg: null, text: null, dim: [138, 138, 138], accent: [225, 144, 103], rule: [104, 104, 104], selected: [52, 52, 52], good: [154, 188, 146] },
};

export function dimensions(columns, rows, requested = 'auto') {
  const w = Math.max(1, Math.floor(columns));
  const h = Math.max(1, Math.floor(rows));
  const contentWidth = Math.max(12, Math.min(requested === 'auto' ? w - 8 : requested, w - 8));
  return { columns: w, rows: h, contentWidth, bodyHeight: Math.max(1, h - 13), left: Math.floor((w - contentWidth) / 2) };
}

export function renderScreen(app, columns = 100, rows = 35, color = true) {
  const d = dimensions(columns, rows, app.store.state.settings.width);
  const colors = palettes[app.store.state.settings.theme];
  const noColor = !color || Object.hasOwn(process.env, 'NO_COLOR');
  const fg = rgb => rgb ? `\x1b[38;2;${rgb.join(';')}m` : '\x1b[39m';
  const bg = rgb => rgb ? `\x1b[48;2;${rgb.join(';')}m` : '\x1b[49m';
  const paint = (text, role = 'text', selected = false) => {
    const line = safeText(text).replace(/[\r\n\t]/g, ' ');
    return noColor ? line : bg(selected ? colors.selected : colors.bg) + fg(colors[role]) + line;
  };
  const lines = [];
  const add = (text = '', role = 'text') => lines.push(paint(fit(safeText(text), d.columns), role));
  const margin = (text = '', role = 'text') => add('  ' + truncate(text, d.columns - 4), role);
  const pair = (left, right, role = 'dim') => {
    const available = d.columns - 4;
    const l = truncate(left, Math.max(0, available - width(right) - 2));
    margin(l + ' '.repeat(Math.max(1, available - width(l) - width(right))) + right, role);
  };
  const rule = () => margin('─'.repeat(d.columns - 4), 'rule');
  if (columns < 38 || rows < 17) {
    add(); margin('✦ Novel', 'accent'); add();
    margin('请将终端调大一些'); margin('建议至少 38 列 × 17 行', 'dim'); add();
    margin(app.workMode ? 'F2 恢复输入 · Ctrl+C 退出' : '按 q 或 Ctrl+C 退出', 'dim');
    while (lines.length < d.rows) add();
    return lines.slice(0, rows).join('\n') + (noColor ? '' : '\x1b[0m');
  }
  const code = app.workMode || app.store.state.settings.mode === 'code';
  if (app.cover) {
    add(); margin('✦ Code Session', 'accent'); margin('~/workspace/app', 'dim'); add();
    margin('● Reviewing project structure…'); add();
    margin('  src/'); margin('  ├── modules/'); margin('  ├── components/'); margin('  └── utils/'); add();
    margin('  Waiting for next instruction.', 'dim');
    while (lines.length < d.rows - 4) add();
    rule(); margin('❯'); rule(); margin(app.workMode ? 'Esc 返回 · F2 恢复输入 · Ctrl+C 退出' : '  session ready', 'dim');
    return lines.slice(0, d.rows).join('\n') + (noColor ? '' : '\x1b[0m');
  }
  const book = app.book;
  const page = Math.floor(app.rowIndex / d.bodyHeight) + 1;
  const pages = Math.max(1, Math.ceil(app.wrapped.length / d.bodyHeight));
  const progress = app.rowIndex + d.bodyHeight >= app.wrapped.length ? 100 : Math.floor(app.offset / Math.max(1, book.text.length) * 100);
  add(); pair(code ? '✦ Code Session' : '✦ Novel', code ? '~/workspace/notes' : '本地阅读', 'accent'); add();
  pair(code ? '● Read(docs/context.md)' : `${book.title}  /  ${chapterAt(book, app.offset).title}`, code ? `segment ${String(page).padStart(3, '0')}` : `${progress}%`, 'text');
  rule(); add();

  if (app.panel) {
    const meta = app.panelMeta();
    margin(meta.title, 'accent');
    margin(meta.subtitle, 'dim');
    add();
    const items = app.panelItems();
    const visible = Math.max(1, d.bodyHeight - 4);
    const start = Math.max(0, app.selection - visible + 1);
    if (!items.length) margin(meta.empty || '没有匹配的结果。', 'dim');
    for (let i = start; i < Math.min(items.length, start + visible); i++) {
      const item = items[i];
      const selected = i === app.selection;
      const label = (selected ? '› ' : '  ') + item.title;
      const right = item.detail || '';
      const maxLabel = Math.max(8, d.columns - 8 - Math.min(width(right), 24));
      const left = truncate(safeText(label), maxLabel);
      const rightText = truncate(safeText(right), 24);
      const body = left + ' '.repeat(Math.max(1, d.columns - 6 - width(left) - width(rightText))) + rightText;
      lines.push(paint('  ') + paint(fit(body, d.columns - 4), selected ? 'accent' : 'text', selected) + paint('  '));
    }
    while (lines.length < 6 + d.bodyHeight) add();
  } else {
    const menu = app.suggestions();
    const menuCount = Math.min(5, menu.length, Math.max(1, d.bodyHeight - 1));
    const menuHeight = menu.length ? menuCount + 1 : 0;
    const readable = d.bodyHeight - menuHeight;
    for (let i = 0; i < readable; i++) {
      const row = app.wrapped[app.rowIndex + i];
      if (!row) { add(); continue; }
      const isHeading = book.chapters.some(ch => ch.offset === row.start && ch.title !== '全文');
      const prefix = ' '.repeat(d.left);
      const text = truncate(row.text, d.contentWidth);
      if (app.highlight && text.includes(app.highlight) && !noColor) {
        const split = text.split(app.highlight);
        const composed = split.map(p => paint(p)).join(paint(app.highlight, 'accent'));
        lines.push(paint(prefix) + composed + paint(' '.repeat(Math.max(0, d.columns - d.left - width(text)))));
      } else add(prefix + text, isHeading ? 'accent' : 'text');
    }
    if (menuHeight) {
      add();
      const begin = Math.max(0, app.selection - menuCount + 1);
      for (let i = begin; i < Math.min(menu.length, begin + menuCount); i++) {
        const item = menu[i];
        const text = fit(item.command, 16) + item.label;
        lines.push(paint('  ') + paint(fit(' ' + text, d.columns - 4), i === app.selection ? 'accent' : 'dim', i === app.selection) + paint('  '));
      }
      while (lines.length < 6 + d.bodyHeight) add();
    }
  }
  add();
  pair(app.message || (code ? 'Context ready' : '进度自动保存'), app.panel ? `${app.panelItems().length} 项` : `${page} / ${pages}`, 'dim');
  rule();
  const input = app.inputActive ? app.input : '';
  const label = app.panel === 'file' ? '路径' : app.panel === 'search' ? '搜索' : app.panel ? '筛选' : '';
  const prefix = `❯ ${label ? label + ' ' : ''}`;
  let shown = input;
  const limit = d.columns - width(prefix) - 6;
  while (width(shown) > limit) shown = graphemeTail(shown);
  const placeholder = app.panel === 'help' ? 'Esc 返回' : app.panel ? '输入文字筛选，↑↓ 选择，Enter 确认' : app.workMode ? '/ 唤起命令' : code ? '输入 / 查看命令' : '输入 / 查看命令，或粘贴文件路径';
  margin(prefix + (shown || (!app.inputActive ? placeholder : '')) + (app.inputActive ? '▏' : ''), app.inputActive ? 'text' : 'dim');
  rule();
  const next = app.store.state.settings.step === 'auto' ? '下一页' : `下翻${app.pageStep}行`;
  const previous = app.store.state.settings.step === 'auto' ? '上一页' : `上翻${app.pageStep}行`;
  margin(app.panel ? '↑↓ 选择   Enter 确认   Esc 返回' : app.inputActive ? '↑↓ 选择   Tab 补全   Enter 执行   Esc 返回' : app.workMode ? (d.columns < 65 ? '↓↑ 翻页  / 命令  F2 解锁' : `↓/→ ${next}   ↑/← ${previous}   / 命令   F2 解锁   Ctrl+C 退出`) : d.columns < 65 ? `↓↑ ${app.store.state.settings.step === 'auto' ? '翻页' : app.pageStep + '行'}  空格 下翻  / 命令  q 退出` : `空格/↓ ${next}   ↑/← ${previous}   j/k 逐行   / 命令   F2 锁定输入   q 退出`, 'dim');
  const session = app.autoSeconds ? `自动 ${app.autoSeconds}s${app.autoPaused ? ' · 暂停' : ''}` : code ? 'local session' : '离线 · 无需账号';
  pair(session, `${book.encoding} · ${code ? 'context.md' : 'TXT'}`, 'dim');
  return lines.slice(0, d.rows).join('\n') + (noColor ? '' : '\x1b[0m');
}

function graphemeTail(text) {
  const iterator = new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)[Symbol.iterator]();
  return text.slice(iterator.next().value.segment.length);
}
