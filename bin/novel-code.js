#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { ReaderApp } from '../src/app.js';
import { Store } from '../src/store.js';
import { renderScreen } from '../src/screen.js';
import { safeText } from '../src/text.js';

const usage = `
  ✦ Novel Code 0.3.0
  在终端里安静读完一本书。

  用法
    novel-code [文件路径]       打开 TXT，或恢复上次阅读
    novel-code --demo           读一段内置原创故事
    novel-code --mode code      以代码助手外观启动
    novel-code --width auto     正文宽度跟随窗口
    novel-code --reflow on      合并中文正文的硬换行
    novel-code --work           乱打字模式；/ 唤起命令
    novel-code --help           显示帮助
    novel-code --version        显示版本

  界面
    空格 / ↓ / → 下翻    ↑ / ← 上翻    /step 5 每次翻动 5 行
    c 章节    s 搜索    b 书签    Esc 隐藏 / 恢复    q 退出
    工作模式：/ 唤起命令，方向键翻页，/work off 或 F2 退出模式

  命令
    /open 路径    /books    /chapters    /search 关键词
    /bookmarks    /goto 35%    /theme    /mode    /help
    /step 5 每次翻动 5 行    /step auto 恢复整页
    /width auto 或 /width 120    /reflow on | off    /work
    /auto 10 每 10 秒自动翻动    /auto off 停止    /auto 查看状态

  字号由终端的字体设置控制；一个汉字通常占两个终端列。

  进度保存在本机，无需账号、API Key 或网络。
  NOVEL_CODE_HOME 可指定独立的数据目录。

  非交互预览
    novel-code --demo --preview --plain --columns 100 --rows 35
`;

let app;
try {
  const args = process.argv.slice(2);
  let filename, demo = false, preview = false, plain = false, work = false, mode, contentWidth, reflow, columns = 100, rows = 35;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { console.log(usage); process.exit(0); }
    if (arg === '--version' || arg === '-v') { console.log('0.3.0'); process.exit(0); }
    if (arg === '--demo') demo = true;
    else if (arg === '--preview') preview = true;
    else if (arg === '--plain') plain = true;
    else if (arg === '--work') work = true;
    else if (arg === '--width') {
      const value = args[++i];
      if (value !== 'auto' && (!/^\d+$/.test(value || '') || Number(value) < 36 || Number(value) > 500)) throw new Error('--width 应为 auto 或 36–500 之间的整数。');
      contentWidth = value === 'auto' ? 'auto' : Number(value);
    } else if (arg === '--reflow') {
      const value = args[++i];
      if (!['on', 'off'].includes(value)) throw new Error('--reflow 应为 on 或 off。');
      reflow = value === 'on';
    } else if (arg === '--mode') {
      mode = args[++i];
      if (!['reader', 'code'].includes(mode)) throw new Error('--mode 应为 reader 或 code。');
    } else if (arg === '--columns' || arg === '--rows') {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < 17 || value > 500) throw new Error(`${arg} 应为 17–500 之间的整数。`);
      if (arg === '--columns') columns = value; else rows = value;
    } else if (arg === '--') {
      if (filename || args.length - i !== 2) throw new Error('每次打开一个文件。');
      filename = args[++i];
    } else if (arg.startsWith('-')) throw new Error(`未知参数：${arg}。使用 --help 查看帮助。`);
    else if (filename) throw new Error('每次打开一个文件；包含空格的路径请加引号。');
    else filename = arg;
  }
  if (!preview && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('请在交互式终端中运行；查看静态预览可加 --preview --plain。');
  const store = new Store();
  const originalSettings = { ...store.state.settings };
  if (mode) store.state.settings.mode = mode;
  if (contentWidth !== undefined) store.state.settings.width = contentWidth;
  if (reflow !== undefined) store.state.settings.reflow = reflow;
  if (preview) {
    // Preview is read-only, including progress, settings and bookmarks.
    store.save = () => {};
    app = new ReaderApp(store, { output: { columns, rows, write() {} } });
  } else app = new ReaderApp(store);
  const sample = fileURLToPath(new URL('../examples/长夜来信.txt', import.meta.url));
  if (demo) filename = sample;
  let resumed = false;
  if (!filename) {
    const recent = [...store.state.books].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const last = recent.find(b => b.id === store.state.lastBook);
    if (last) recent.unshift(last);
    for (const entry of recent) {
      try { app.open(entry.path); resumed = true; break; } catch {}
    }
  }
  if (!resumed) app.open(filename || sample);
  if (!filename && !resumed) app.message = '内置原创示例 · /open 导入你的小说';
  if (store.warning) app.message = store.warning;
  if (work) app.setWorkMode(true);
  if (preview) {
    console.log(renderScreen(app, columns, rows, !plain));
    clearTimeout(app.saveTimer);
    store.state.settings = originalSettings;
  } else {
    const finish = signal => { app.stop(); process.exit(signal === 'SIGTERM' ? 143 : 0); };
    process.once('SIGINT', () => finish('SIGINT'));
    process.once('SIGTERM', () => finish('SIGTERM'));
    process.once('SIGHUP', () => finish('SIGHUP'));
    process.once('uncaughtException', error => {
      app.stop(); console.error(`\n发生错误：${safeText(error.message)}`); process.exit(1);
    });
    process.on('exit', () => { if (app.started && !app.closed) app.stop(); });
    app.start();
  }
} catch (error) {
  if (app?.started) app.stop();
  console.error(`\n  Novel Code：${safeText(error.message)}\n`);
  process.exitCode = 1;
}
