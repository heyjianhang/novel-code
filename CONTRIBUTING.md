# 参与贡献

欢迎通过 Issue 报告问题，或提交 Pull Request。项目使用 Node.js 原生能力，无第三方运行依赖。

## 本地开发

要求 Node.js 20 或更新版本。

```sh
git clone https://github.com/heyjianhang/novel-code.git
cd novel-code
npm ci --ignore-scripts
npm test
npm run demo
```

运行只读界面预览：

```sh
node bin/novel-code.js --demo --preview --plain --columns 100 --rows 35
```

测试使用临时数据目录。手动体验时也可以使用 `NOVEL_CODE_HOME` 指定单独的数据目录，避免改动自己的阅读记录：

```sh
NOVEL_CODE_HOME=./work/dev-data npm run demo
```

## 提交修改

- 在 Issue 或 Pull Request 中说明问题、预期效果和验证方式。
- 行为修复请附上可复现的步骤；涉及解析、翻动或进度保存时补充回归测试。
- 尽量保留无第三方运行依赖的设计，以及现有阅读数据的兼容性。
- 请勿提交小说全文、个人阅读记录、账号凭据或 `.npmrc`；复现文本尽量使用简短原创内容。

提交终端显示问题时，请附上操作系统、Node.js 版本、终端名称、窗口行列数，以及使用的快捷键。

贡献代码按本仓库的 MIT License 提供。
