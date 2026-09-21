import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { decodeBuffer, loadBook, findChapters, searchBook, normalizePath } from '../src/book.js';
import { wrapLine, wrapBook, width, rowAt, safeText } from '../src/text.js';
import { Store } from '../src/store.js';
import { ReaderApp } from '../src/app.js';
import { dimensions, renderScreen } from '../src/screen.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const sample = path.join(root, 'examples', '长夜来信.txt');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-code-test-'));
  const output = { columns: 100, rows: 35, write() {}, on() {}, off() {} };
  const store = new Store(path.join(dir, 'state'));
  const app = new ReaderApp(store, { output });
  t.after(() => { clearTimeout(app.saveTimer); clearTimeout(app.drawTimer); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, output, store, app };
}

test('decodes UTF-8, GBK-compatible GB18030 and UTF-16 without damaging Chinese', () => {
  assert.equal(decodeBuffer(Buffer.from('中文测试')).text, '中文测试');
  assert.equal(decodeBuffer(Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4])).text, '中文测试');
  const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文测试', 'utf16le')]);
  assert.equal(decodeBuffer(little).text, '中文测试');
  const big = Buffer.from(little).swap16();
  assert.equal(decodeBuffer(big).text, '中文测试');
});

test('cleans hostile ANSI/OSC content and rejects binary and empty files', () => {
  const text = '\x1b[2J第一章\x1b]52;c;aGVsbG8=\x07\n内容\r\n';
  assert.equal(decodeBuffer(Buffer.from(text)).text, '第一章\n内容');
  assert.equal(safeText('abc\x1b[31mdef'), 'abcdef');
  assert.throws(() => decodeBuffer(Buffer.from([0, 0, 0, 1])), /二进制/);
  assert.throws(() => decodeBuffer(Buffer.from(' \n\t')), /没有可阅读/);
});

test('chapter detection preserves source offsets and handles Chinese/English headings', () => {
  const text = '书名\n\n第一章 雨夜\n你好\n\nChapter 2: Arrival\nnext\n尾声\n完';
  const chapters = findChapters(text);
  assert.deepEqual(chapters.map(c => c.title), ['开篇', '第一章 雨夜', 'Chapter 2: Arrival', '尾声']);
  assert.equal(chapters[1].offset, text.indexOf('第一章'));
  assert.equal(findChapters('没有章节的小说')[0].title, '全文');
});

test('wrapping preserves every character and respects CJK, combining marks and emoji widths', () => {
  const text = '中文测试，Hello world! 👩‍💻 café e\u0301 后面还有一些文字。';
  for (const columns of [4, 8, 13, 20, 84]) {
    const lines = wrapLine(text, columns);
    assert.equal(lines.map(r => r.text).join(''), text);
    assert.ok(lines.every(r => width(r.text) <= columns));
    for (const row of lines) assert.equal(text.slice(row.start, row.end), row.text);
  }
  assert.equal(width('中文👩‍💻e\u0301'), 7);
});

test('row lookup and search offsets agree with the original book including newlines', () => {
  const book = loadBook(sample);
  const rows = wrapBook(book.text, 42);
  const hits = searchBook(book, '林舟');
  assert.ok(hits.length > 4);
  for (const hit of hits) {
    assert.equal(book.text.slice(hit.offset, hit.offset + 2), '林舟');
    const row = rows[rowAt(rows, hit.offset)];
    assert.ok(row.start <= hit.offset && row.end >= hit.offset);
  }
});

test('quoted and shell-escaped paths with spaces load correctly', t => {
  const { dir } = fixture(t);
  const filename = path.join(dir, '我的 小说.txt');
  fs.writeFileSync(filename, '第一章\n\n正文');
  assert.equal(normalizePath('"' + filename + '"'), filename);
  assert.equal(loadBook(filename.replace(/ /g, '\\ ')).text, '第一章\n\n正文');
});

test('page movement, resize and relaunch retain a stable text position', t => {
  const { dir, app, output, store } = fixture(t);
  app.open(sample);
  app.turnPage(1);
  const offset = app.offset;
  assert.ok(offset > 0);
  output.columns = 52; output.rows = 25; app.reflow();
  assert.equal(app.offset, offset);
  assert.ok(app.wrapped[app.rowIndex].start <= offset);
  app.persist();
  const restored = new Store(store.directory);
  const other = new ReaderApp(restored, { output });
  other.open(sample);
  assert.equal(other.offset, offset);
  clearTimeout(other.saveTimer);
  assert.ok(fs.existsSync(path.join(dir, 'state', 'state.json')));
});

test('bad imports preserve the open book and progress', t => {
  const { app, dir } = fixture(t);
  app.open(sample); app.turnPage(1);
  const before = app.offset, title = app.book.title;
  assert.throws(() => app.open(path.join(dir, 'missing.txt')), /找不到/);
  assert.equal(app.offset, before); assert.equal(app.book.title, title);
});

test('custom step applies to all four arrows while j/k retain single-line scrolling', t => {
  const { app } = fixture(t);
  app.open(sample);
  for (const char of '/step 5') app.handleKey(char, { name: char });
  app.handleKey('', { name: 'return' });
  assert.equal(app.store.state.settings.step, 5);
  assert.equal(app.rowIndex, 0, 'changing step must not move the book');
  for (const [char, key] of [[' ', 'space'], ['', 'down'], ['', 'right'], ['', 'return'], ['', 'pagedown']]) {
    const before = app.rowIndex;
    app.handleKey(char, { name: key });
    assert.equal(app.rowIndex, before + 5);
  }
  app.handleKey('', { name: 'left' }); assert.equal(app.rowIndex, 20);
  app.handleKey('', { name: 'pageup' }); assert.equal(app.rowIndex, 15);
  app.handleKey('', { name: 'up' }); assert.equal(app.rowIndex, 10);
  app.handleKey('j', { name: 'j' }); assert.equal(app.rowIndex, 11);
  app.handleKey('k', { name: 'k' }); assert.equal(app.rowIndex, 10);
  assert.ok(renderScreen(app, 100, 35, false).includes('下翻5行'));
  app.jump(0); app.turnPage(-1); assert.equal(app.rowIndex, 0);
  app.jump(app.wrapped[app.wrapped.length - app.bodyHeight - 2].start);
  const beforeEnd = app.rowIndex;
  app.turnPage(1); assert.equal(app.rowIndex, beforeEnd + 2);
  app.turnPage(1); assert.equal(app.rowIndex, beforeEnd + 2, 'stop when the end is visible');
});

test('step adapts to smaller windows without skipping unread rows, and auto resumes full-page navigation', t => {
  const { app, output } = fixture(t);
  app.open(sample); app.execute('/step 10');
  output.rows = 18; app.reflow();
  app.turnPage(1); assert.equal(app.rowIndex, 5);
  assert.equal(app.store.state.settings.step, 10, 'retain the requested value on resize');
  assert.ok(renderScreen(app, 100, 18, false).includes('下翻5行'));
  output.rows = 35; app.reflow();
  app.turnPage(1); assert.equal(app.rowIndex, 15);
  const anchor = app.offset;
  app.execute('/step auto'); assert.equal(app.offset, anchor);
  app.turnPage(1); assert.equal(app.rowIndex, 37);
  assert.ok(renderScreen(app, 100, 35, false).includes('下一页'));
});

test('custom step and reset survive relaunch while legacy or invalid saved values default to auto', t => {
  const { app, store } = fixture(t);
  app.open(sample); app.execute('/step 3'); app.turnPage(1); app.persist();
  const restored = new Store(store.directory);
  assert.equal(restored.state.settings.step, 3);
  const other = new ReaderApp(restored, { output: { columns: 100, rows: 35, write() {} } });
  try {
    other.open(sample); assert.equal(other.rowIndex, 3);
    other.turnPage(1); assert.equal(other.rowIndex, 6);
    other.execute('/step auto'); other.persist();
    assert.equal(new Store(store.directory).state.settings.step, 'auto');
  } finally { clearTimeout(other.saveTimer); }
  for (const step of [undefined, null, -1, 0, 1.5, '5', 201]) {
    const state = JSON.parse(fs.readFileSync(store.filename, 'utf8'));
    state.settings.step = step;
    fs.writeFileSync(store.filename, JSON.stringify(state));
    assert.equal(new Store(store.directory).state.settings.step, 'auto');
  }
});

test('step validates input without losing the previous setting and reports the current value', t => {
  const { app } = fixture(t);
  app.open(sample); app.execute('/step 5');
  for (const value of ['0', '-1', '1.5', '201', 'NaN', 'abc', '1e2']) {
    assert.throws(() => app.execute('/step ' + value), /1–200/);
    assert.equal(app.store.state.settings.step, 5);
  }
  app.execute('/step'); assert.match(app.message, /5 行/);
  app.execute('/step 1'); assert.equal(app.pageStep, 1);
  app.execute('/step 200'); assert.equal(app.pageStep, app.bodyHeight);
  assert.match(app.message, /一屏上限/);
});

test('auto width follows window resizing, wider fixed widths persist and old widths are retained', t => {
  const { app, store, output } = fixture(t);
  app.open(sample); app.turnPage(1);
  const offset = app.offset;
  assert.equal(store.state.settings.width, 'auto');
  output.columns = 180; app.reflow();
  assert.equal(dimensions(output.columns, output.rows, store.state.settings.width).contentWidth, 172);
  assert.equal(app.offset, offset);
  app.execute('/width 160'); app.persist();
  assert.equal(new Store(store.directory).state.settings.width, 160);
  assert.equal(dimensions(180, 35, 160).contentWidth, 160);
  output.columns = 60; app.reflow();
  assert.equal(dimensions(60, 35, 160).contentWidth, 52);
  assert.equal(store.state.settings.width, 160);
  assert.equal(app.offset, offset);
  for (const value of ['0', '35', '501', 'NaN', '1e2', '120.5']) {
    assert.throws(() => app.execute('/width ' + value), /36–500/);
    assert.equal(store.state.settings.width, 160);
  }
  app.execute('/width auto'); app.persist();
  assert.equal(new Store(store.directory).state.settings.width, 'auto');
  app.execute('/width'); assert.match(app.message, /自适应/);
  app.execute('/width 84'); app.persist();
  assert.equal(new Store(store.directory).state.settings.width, 84);
});

test('prose reflow widens hard-wrapped text while preserving chapters, verse and source offsets', () => {
  const first = '山间的风穿过很长很长的树林，把远处的人声和雨声一同带到了门前。';
  const next = '寻找此处的旅人停下脚步，抬头看向山顶。';
  const text = ['第一○回 山路', first, next, '', '明月照山川。', '清风过树林。', first,
    '第十一回 新章', first, '　　另起一段，保留缩进。', 'English source line one', 'English source line two'].join('\n');
  const chapters = findChapters(text);
  assert.equal(chapters[0].title, '第一○回 山路');
  const options = { reflow: true, chapterOffsets: chapters.map(c => c.offset) };
  const raw = wrapBook(text, 160);
  const joined = wrapBook(text, 160, options);
  assert.ok(joined.some(r => r.text === first + next));
  assert.ok(raw.every(r => r.text !== first + next));
  for (const exact of ['第一○回 山路', '第十一回 新章', '明月照山川。', '清风过树林。', '　　另起一段，保留缩进。', 'English source line one', 'English source line two']) {
    assert.ok(joined.some(r => r.text === exact), exact);
  }
  for (const columns of [20, 58, 84, 160]) {
    const rows = wrapBook(text, columns, options);
    assert.equal(rows.map(r => r.text).join(''), text.replaceAll('\n', ''));
    for (const row of rows) {
      assert.equal(text.slice(row.start, row.end).replaceAll('\n', ''), row.text);
      assert.ok(width(row.text) <= columns);
    }
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') continue;
      const row = rows[rowAt(rows, i)];
      assert.ok(row.start <= i && row.end > i, `source position ${i} at width ${columns}`);
    }
  }
});

test('reflow toggling and relaunch retain reading anchors, search targets and bookmarks', t => {
  const { app, store, dir, output } = fixture(t);
  output.columns = 160;
  const filename = path.join(dir, '换行.txt');
  fs.writeFileSync(filename, '第一章 山路\n' + ('很长的故事沿着山路一直向前延伸。'.repeat(2) + '\n继续往前寻找青石桥，那里还有未完的故事。\n\n').repeat(30));
  app.open(filename); app.execute('/search 青石桥'); app.selectPanel();
  const anchor = app.offset;
  const source = app.book.text;
  const before = app.wrapped.length;
  app.execute('/reflow on');
  assert.equal(app.offset, anchor);
  assert.equal(app.book.text, source);
  assert.ok(app.wrapped.length < before);
  assert.ok(renderScreen(app, 100, 35, false).includes('青石桥'));
  app.bookmark();
  const mark = store.record(app.book).bookmarks[0].offset;
  app.execute('/reflow off'); app.jump(0); app.openPanel('bookmarks'); app.selectPanel();
  assert.equal(app.offset, mark);
  app.execute('/reflow on'); app.jump(anchor); app.persist();
  const restored = new Store(store.directory);
  assert.equal(restored.state.settings.reflow, true);
  const other = new ReaderApp(restored, { output: { columns: 130, rows: 35, write() {} } });
  try { other.open(filename); assert.equal(other.offset, anchor); }
  finally { clearTimeout(other.saveTimer); }
  assert.throws(() => app.execute('/reflow yes'), /on \| off/);
  assert.equal(store.state.settings.reflow, true);
});

test('work mode ignores typing and normal shortcuts, retaining only navigation and an explicit unlock', t => {
  const { app, store } = fixture(t);
  app.open(sample); app.execute('/step 5');
  for (const char of '/work') app.handleKey(char, { name: char });
  app.handleKey('', { name: 'return' });
  assert.ok(app.workMode);
  const screen = renderScreen(app, 100, 35, false);
  assert.match(screen, /Code Session/);
  for (const char of 'qbcjksnp[]/quit abc123中文乱打字') app.handleKey(char, { name: char });
  app.handleKey('/open /tmp/do-not-open.txt', {});
  for (const name of ['return', 'space', 'tab', 'backspace', 'delete', 'home', 'end', 'paste-start', 'paste-end']) app.handleKey('', { name });
  app.handleKey('', { ctrl: true, name: 'w' });
  assert.equal(renderScreen(app, 100, 35, false), screen);
  assert.equal(app.rowIndex, 0); assert.equal(app.input, '');
  assert.equal(app.inputActive, false); assert.equal(app.panel, null); assert.equal(app.closed, false);
  assert.deepEqual(store.record(app.book).bookmarks, []);
  for (const name of ['down', 'right', 'pagedown']) app.handleKey('', { name });
  assert.equal(app.rowIndex, 15);
  for (const name of ['up', 'left', 'pageup']) app.handleKey('', { name });
  assert.equal(app.rowIndex, 0);
  app.handleKey('', { name: 'escape' }); assert.ok(app.cover);
  app.handleKey('q', { name: 'q' }); app.handleKey('', { name: 'down' });
  assert.equal(app.closed, false); assert.equal(app.rowIndex, 0);
  app.handleKey('', { name: 'escape' }); assert.equal(app.cover, false);
  app.handleKey('', { name: 'f2' }); assert.equal(app.workMode, false);
  assert.equal(store.state.settings.mode, 'reader');
  app.handleKey('c', { name: 'c' }); assert.equal(app.panel, 'chapters');
  app.handleKey('', { name: 'f2' }); assert.ok(app.workMode); assert.equal(app.panel, null);
  app.persist();
  const other = new ReaderApp(new Store(store.directory));
  assert.equal(other.workMode, false, 'input lock is session-only');
  app.handleKey('', { name: 'c', ctrl: true }); assert.ok(app.closed);
});

test('bookmarks can be added, jumped to, deleted and persisted', t => {
  const { app, store } = fixture(t);
  app.open(sample); app.turnPage(1); app.bookmark();
  const anchor = app.offset;
  app.jump(0); app.openPanel('bookmarks'); app.selectPanel();
  assert.equal(app.offset, anchor);
  app.openPanel('bookmarks'); app.handleKey('', { name: 'delete' }); app.persist();
  assert.equal(new Store(store.directory).state.books[0].bookmarks.length, 0);
});

test('search result navigation and goto validation work from actual command input', t => {
  const { app } = fixture(t);
  app.open(sample); app.execute('/search 林舟'); app.selectPanel();
  const first = app.offset;
  app.handleKey('n', { name: 'n' });
  assert.ok(app.offset > first);
  app.handleKey('p', { name: 'p' }); assert.equal(app.offset, first);
  app.execute('/goto 100%'); assert.ok(app.rowIndex + app.bodyHeight >= app.wrapped.length);
  app.execute('/goto 1'); assert.equal(app.offset, 0);
  assert.throws(() => app.execute('/goto 99999'), /共有/);
  assert.throws(() => app.execute('/goto -4'), /用法/);
});

test('slash menu, theme, code mode and cover switch preserve reading progress', t => {
  const { app } = fixture(t);
  app.open(sample); app.turnPage(1); const offset = app.offset;
  app.handleKey('/', { name: '/' }); assert.ok(app.suggestions().length > 5);
  app.handleKey('', { name: 'down' }); app.handleKey('', { name: 'return' });
  assert.equal(app.panel, 'books');
  app.handleKey('', { name: 'escape' }); app.execute('/mode code'); app.execute('/theme light');
  app.handleKey('', { name: 'escape' }); assert.ok(app.cover);
  assert.ok(!renderScreen(app, 100, 35, false).includes('林舟'));
  app.handleKey('', { name: 'escape' }); assert.equal(app.offset, offset);
  assert.equal(app.store.state.settings.mode, 'code');
});

test('every screen fits the terminal grid, including narrow windows and menus', t => {
  const { app, output } = fixture(t);
  app.open(sample);
  app.book.title = '一个包含\n换行符的文件名';
  for (const [columns, rows] of [[120, 40], [80, 28], [42, 18], [38, 17], [25, 12], [10, 5]]) {
    output.columns = columns; output.rows = rows; app.reflow();
    for (const state of ['reading', 'commands', 'books', 'chapters', 'search', 'help', 'file', 'cover', 'work']) {
      app.closePanel(); app.cover = false; app.workMode = false;
      if (state === 'commands') { app.inputActive = true; app.input = '/'; }
      else if (state === 'work') app.setWorkMode(true);
      else if (state === 'cover') app.cover = true;
      else if (state !== 'reading') app.openPanel(state, state === 'search' ? '林舟' : '');
      const lines = renderScreen(app, columns, rows, false).split('\n');
      assert.equal(lines.length, rows, `${columns}x${rows} ${state}`);
      assert.ok(lines.every(line => width(line) <= columns), `${columns}x${rows} ${state}: overflows`);
      if (columns >= 38 && rows >= 17 && state !== 'cover') assert.ok(lines.at(-1).includes(state === 'work' ? 'context.md' : 'TXT'), `${state}: missing footer`);
    }
  }
});

test('a corrupted state is backed up before a replacement is saved', t => {
  const { dir } = fixture(t);
  fs.writeFileSync(path.join(dir, 'state.json'), '{broken');
  const store = new Store(dir);
  assert.ok(store.warning);
  store.save();
  const backup = fs.readdirSync(dir).find(f => f.includes('.backup-'));
  assert.equal(fs.readFileSync(path.join(dir, backup), 'utf8'), '{broken');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))).version, 1);
});

test('packaged CLI preview is read-only and non-TTY interaction fails cleanly', t => {
  const { dir } = fixture(t);
  const env = { ...process.env, NOVEL_CODE_HOME: path.join(dir, 'preview-data') };
  const preview = spawnSync(process.execPath, ['bin/novel-code.js', '--demo', '--preview', '--plain'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.ok(preview.stdout.includes('雨停的时候')); assert.ok(!preview.stdout.includes('\x1b'));
  assert.ok(!fs.existsSync(env.NOVEL_CODE_HOME));
  const piped = spawnSync(process.execPath, ['bin/novel-code.js'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(piped.status, 1); assert.ok(piped.stderr.includes('交互式终端'));
  const work = spawnSync(process.execPath, ['bin/novel-code.js', '--demo', '--preview', '--plain', '--width', 'auto', '--reflow', 'on', '--work'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(work.status, 0, work.stderr);
  assert.match(work.stdout, /Code Session/); assert.match(work.stdout, /F2 恢复输入/);
  assert.ok(!fs.existsSync(env.NOVEL_CODE_HOME));
  for (const flags of [['--width', '501'], ['--width'], ['--reflow', 'yes'], ['--reflow']]) {
    const invalid = spawnSync(process.execPath, ['bin/novel-code.js', '--preview', ...flags], { cwd: root, env, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /应为/);
  }
});
