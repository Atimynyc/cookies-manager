# v0.3.7 发布

发布版本从 `0.3.6` 升级为 `0.3.7`，用于重新提交 Chrome Web Store。

- 网页存储操作改为在 `src/shared/storage-api.js` 中直接调用 `chrome.scripting.executeScript({...})`，使用原生 Promise 返回值；保留既有来源校验与读写、删除、撤销逻辑。
- 保留 `scripting` 权限，用于访问已授权网站的 Local Storage 和 Session Storage。
- 更新中英文权限说明和英文审核说明；英文审核说明为 774 个字符，符合 1,000 字符限制。
- 发布包：`release/cookie-controller-0.3.7.zip`，311,909 bytes，68 个文件，包含九种语言（含罗马尼亚语）。
- SHA-256：`D989D9B7D142395F69C5943489F9DAFDFD3F0459876B0A0D072E688E4589B373`；校验文件：`release/cookie-controller-0.3.7.zip.sha256`。
- ZIP 根目录包含 `manifest.json`，包内仅包含 `manifest.json`、`assets/`、`src/` 和完整的 `_locales/`；已逐文件校验与当前源码一致，并检查版本号、资源路径、权限和直接 API 调用。

本次验证通过：

- `npm run lint`。
- `npm test`：192 项单元测试全部通过。
- `npm run test:locales`：九种语言各 562 条文案，键与占位符校验通过。
- `npm run test:acceptance -- --storage-only`：真实 Chromium 中验证 Local Storage 与 Session Storage 的读取、编辑、导入、导出、删除，以及 Local Storage 撤销，并与网页中的实际数据核对。
- `git diff --check`。

浏览器验收使用临时扩展副本预先授权测试站点，验证授权后的存储操作，未覆盖浏览器原生的可选站点权限弹窗。无头模式下工具栏弹窗不可用，测试使用既有备用入口完成验收。本次未重跑完整扩展浏览器验收。
