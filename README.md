# Novel Code

[![npm version](https://img.shields.io/npm/v/novel-code)](https://www.npmjs.com/package/novel-code)
[![CI](https://github.com/heyjianhang/novel-code/actions/workflows/ci.yml/badge.svg)](https://github.com/heyjianhang/novel-code/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

一个本地终端小说阅读器。暖黑背景、陶土橙强调、中文正文和斜杠命令菜单；也可切换成代码助手风格。

**要求 Node.js 20 或更新版本。无第三方运行依赖，阅读时无需 API Key、账号或网络。** 首次从 npm 下载或安装需要联网。

## 立即运行

直接运行：

```sh
npx novel-code
```

第一次会打开内置原创示例；之后自动续读最近打开的书。你也可以输入 `/open` 选择本地 TXT。

打开自己的小说：

```sh
npx novel-code "/你的路径/小说.txt"
```

## 安装为全局命令

安装后，可以在任意目录使用 `novel-code`：

```sh
npm install -g novel-code
novel-code
novel-code "/路径/小说.txt"
```

安装不需要下载第三方依赖。如果全局目录不可写，可使用用户目录：

```sh
npm install -g --prefix "$HOME/.local" novel-code
"$HOME/.local/bin/novel-code"
```

此方式无需修改系统目录；将 `$HOME/.local/bin` 加入 PATH 后可直接输入 `novel-code`。

卸载：`npm uninstall -g novel-code`；使用自定义 prefix 安装的，卸载时添加同样的 `--prefix` 参数。卸载程序会保留阅读数据。

## 离线安装 / 源码运行

已获得 npm 安装包的用户可执行 `npm install -g /路径/novel-code-0.2.0.tgz`。已解压源码的用户可以在源码目录执行 `node bin/novel-code.js`，或运行 `npm install -g .`。

从 GitHub 获取源码：

```sh
git clone https://github.com/heyjianhang/novel-code.git
cd novel-code
node bin/novel-code.js
```

macOS 也可以双击源码目录中的 `启动阅读器.command`。若 macOS 拦截下载的启动脚本，可使用上面的终端命令。

## 使用方式

| 按键 | 功能 |
| --- | --- |
| 空格、↓、→、Enter、PageDown | 下翻，默认一整页，可用 `/step` 设置行数 |
| ↑、←、PageUp | 按相同行数上翻 |
| j / k | 逐行移动 |
| Home / End | 开头 / 最后一页 |
| [ / ] | 上一章 / 下一章 |
| c | 章节目录 |
| s | 搜索全文 |
| n / p | 下一处 / 上一处搜索结果 |
| b | 添加或取消当前页首书签 |
| / | 命令菜单；↑↓ 选择，Tab 补全，Enter 执行 |
| Esc | 在正文隐藏 / 恢复；在菜单返回正文 |
| F2 | 开启 / 关闭乱打字模式（部分 Mac 键盘需 Fn+F2） |
| q、Ctrl+C、Ctrl+D | 保存退出 |

主界面支持粘贴或拖入文件的绝对路径后按 Enter，也可以先输入 `/open ` 再粘贴路径。在命令输入中支持退格、Ctrl+U 清空、Ctrl+W 删除末尾单词；这一版暂不支持移动输入光标到中间编辑。

## 调整每次翻动行数

在阅读器底部输入 `/step 5`，之后每次空格、↓、→、Enter、PageDown 下翻 5 行，↑、←、PageUp 上翻 5 行。也可以设置 `/step 1`、`/step 10` 等，范围为 1–200。

行数按终端自动换行后的显示行计算，包含段落间的空行。超过一屏可显示的行数时，会按一屏翻动，避免跳过没显示的文字；窗口变大后会继续使用原来的设定值。到开头或结尾时，只移动剩余的行数。j / k 一次移动一行；菜单中的 ↑ / ↓ 仍逐项选择。

输入 `/step` 查看当前设置，`/step auto` 恢复整页翻动。设置自动保存，下次启动仍生效。底部快捷键提示会同步显示“下翻5行 / 上翻5行”。从 0.1.0 升级会保留已有阅读进度，默认翻动方式仍为整页；已打开的阅读器需要退出后重启。

0.1.2 修正了 `/step` 对 ↑ / ↓ 不生效的问题。更新源码或安装新版后，请退出已打开的阅读器并重新启动。

## 宽度、换行和字号

输入 `/width auto`，正文会随窗口变宽、变窄；新安装默认使用这个设置。也可以输入 `/width 120` 固定阅读栏宽度，支持 36–500 个终端列，一个汉字通常占两列。旧版保存的宽度会保留，可用 `/width auto` 切换；`/width` 查看当前设置。

有些 TXT（例如 Project Gutenberg 的中文小说）在文件里已经每隔几十字换行。只扩大阅读栏不会合并这些换行。输入 `/reflow on`，会合并较长中文正文的连续行，再按窗口排版；空行、章节标题、缩进的新段落、短诗行和非中文文本保留原换行。此功能按文字特征判断，特殊排版不合适时输入 `/reflow off` 恢复。只调整显示，不修改原文件；搜索、书签和进度仍对应原文位置。宽度和重排设置都会保存。

字号和字体由终端控制，请在 Terminal、iTerm2 或所用终端的字体设置中调整。阅读器的 `/width` 改变每行容量，不会改变字体大小。

## 乱打字模式

输入 `/work` 或按 F2 开启：保持代码助手外观和当前阅读页，随意敲字母、数字、中文、标点、空格、回车、退格或粘贴文字，都不会显示输入，也不会触发 q、b、c 等阅读快捷键。

- ↓ / → / PageDown 下翻，↑ / ← / PageUp 上翻，沿用 `/step` 行数。
- F2 恢复正常输入；部分 Mac 键盘需要按 Fn+F2，再输入 `/step`、`/width` 等命令。
- Esc 仍可隐藏 / 恢复正文；Ctrl+C 或 Ctrl+D 保存退出。

普通文字键不会自动翻页。模式只对当前会话生效，下次启动默认恢复输入，也可以通过 `--work` 直接进入：

```sh
novel-code "/路径/小说.txt" --width auto --reflow on --work
```

关闭模式后恢复之前的阅读外观。此功能只改变界面与键盘响应，不会执行输入的代码或操作其他程序。

## 命令

| 命令 | 说明 |
| --- | --- |
| `/open` | 本地文件选择器，Tab 补全路径 |
| `/open "路径/小说.txt"` | 直接打开文件 |
| `/books` | 最近阅读，支持名称筛选 |
| `/chapters` | 自动识别的章节目录 |
| `/search 关键词` | 全文精确匹配，最多显示 300 处结果 |
| `/bookmark` | 添加 / 取消当前书签 |
| `/bookmarks` | 书签列表；Delete 删除选中书签 |
| `/goto 12`、`/goto 35%` | 跳页或跳进度 |
| `/theme` | 轮换 dark、light、terminal 主题 |
| `/theme light` | 指定主题 |
| `/mode` | 轮换 reader、code 外观 |
| `/mode code` | 代码助手风格：Read 状态、底部输入框；正文保持正常排版 |
| `/width auto`、`/width 120` | 正文自适应宽度，或指定 36–500 列 |
| `/width` | 查看设定和当前实际宽度 |
| `/reflow on`、`/reflow off` | 合并中文正文硬换行 / 恢复原始换行，自动保存 |
| `/work` | 开启 / 关闭乱打字模式；锁定时用 F2 恢复输入 |
| `/step 5` | 每次翻动 5 个显示行（1–200，最多一屏），自动保存 |
| `/step`、`/step auto` | 查看翻动设置 / 恢复整页 |
| `/help`、`/quit` | 帮助 / 保存退出 |

隐藏模式和代码助手外观是本地界面效果，不会运行代码、构建任务或调用 AI。

## 格式和进度

- 支持 TXT、纯文本 Markdown（不会渲染 Markdown 语法）；EPUB、PDF 尚未支持。
- 自动识别 UTF-8、带 BOM 的 UTF-16LE / BE，兼容 GB18030 / 常见 GBK 文件；无 BOM 的 UTF-16 仅做启发式识别，若不正确请另存为 UTF-8。
- 章节识别支持“第十二章”“第一卷”“楔子”“尾声”“Chapter 12”等，特别的标题格式可能需要用全文搜索定位。
- 单文件上限 50 MB。大文件在打开和重排时可能短暂等待。
- 进度按文字位置保存；窗口改变后重排，页数会随窗口和宽度变化。
- 数据默认在 `~/.local/share/novel-code/state.json`，优先使用 `$XDG_DATA_HOME/novel-code`。`NOVEL_CODE_HOME` 可指定完整数据目录。
- 输入内容仅作为文件路径或程序内命令处理，不会交给 Shell 执行。TXT 内的终端控制序列会被清理。
- 数据保留书籍路径和书签片段，不会复制或上传整本小说。适合单个会话使用；多个会话同时读同一数据目录可能互相覆盖最后进度。

## 开发与验证

```sh
npm test
node bin/novel-code.js --demo
node bin/novel-code.js --demo --mode code
node bin/novel-code.js --demo --width auto --reflow on --work
node bin/novel-code.js --demo --preview --plain --columns 100 --rows 35
npm pack
```

`--preview` 只读，不保存阅读进度或设置。交互模式要求 TTY；可在 Terminal、iTerm2、VS Code 终端等使用。未提供网页版。推荐终端至少 80 列 × 28 行，最小 38 列 × 17 行；中文字体需要由终端提供。

安装包不含构建步骤和下载脚本；JS 源码可直接阅读和修改。MIT License。

## 参与贡献

问题反馈和功能建议请提交 [Issue](https://github.com/heyjianhang/novel-code/issues)。开发和贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。
