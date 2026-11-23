# v0.3.8 发布

版本从 `0.3.7` 升级为 `0.3.8`，用于重新提交 Chrome Web Store。

- 修复 Cookie 读取不全：按当前主机及各级父域主机申请 HTTP、HTTPS 权限，读取适用于当前页面的父域、非 Secure 和 HttpOnly Cookie。列表仍按页面 URL 和 Cookie 存储区筛选。旧授权范围不足时需要用户补充批准。
- 修复站点授权重复确认和消息端口关闭导致无法继续的问题：点击 Allow 时直接保存当前站点的确认，授权不再依赖后台消息；拒绝授权后支持再次尝试，兼容旧的确认记录。
- 修复 History 中 Operations 报空节点错误、无法切回 Recent Changes 的问题，保留共享详情节点并同步更新页签。
- 保持 Manifest V3、Chrome 114 最低版本、按需申请站点权限和九种语言资源。

发布文件：`release/cookie-controller-0.3.8.zip`；校验文件：`release/cookie-controller-0.3.8.zip.sha256`。ZIP 根目录包含 `manifest.json`，仅收录 `manifest.json`、`assets/`、`src/` 和 `_locales/`。

发布包大小为 313,132 bytes，共 69 个文件。SHA-256：`84193B73356166CB1ACF2AD77BD8C3F7347218353736554F8A5FCF08F0BFF6FA`。包内全部文件已逐项比对当前源码，确认根目录 Manifest 版本为 `0.3.8`、入口与图标存在、九种语言词库完整。

2026-11-23 验证通过：

- `npm test`：203 项单元测试全部通过。
- `npm run lint`、`npm run test:locales`：静态检查与九种语言各 562 条文案校验通过。
- `npm run test:cookie-permissions`：真实 Chromium 中复现旧权限只返回 1/5 或 0 个 Cookie，修复后返回全部 5 个适用 Cookie，与 Chrome 的 URL 范围查询一致；重开后正常。
- `npm run test:acceptance -- --site-access-only`：确认前零读取、取消、拒绝后重试、确认持久化、页面关闭重开，以及中文窄侧边栏验证通过。
- `npm run test:acceptance:v033`：History 页签、操作关闭重开、部分失败重试、冲突撤销、并发写入、后台恢复和响应式布局验证通过；原生工具栏弹窗提交、关闭和重新打开已通过 CDP 验证。
- `git diff --check`。

浏览器原生可选站点权限提示未自动化验证；Cookie 权限专项使用限定主机范围的临时扩展副本，未预授予所有网站权限。英文审核说明更新在 `store-assets/review-scripting-en.txt`，不包含在 ZIP 中。
