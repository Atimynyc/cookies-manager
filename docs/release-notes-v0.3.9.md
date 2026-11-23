# v0.3.9 发布

版本从 `0.3.8` 升级为 `0.3.9`，用于发布 Chrome Web Store。

- 新增可选的“允许所有网站”访问：默认仍按网站逐站授权；设置页开启或站点授权弹框中点击黄色按钮后，必须经过二次确认，才会申请所有 HTTP/HTTPS 网站的 Cookie、Local Storage 和 Session Storage 权限。
- 关闭设置中的全站访问后立即恢复逐站授权，不会自动再次弹出当前站点授权框；用户仍可通过手动入口重新授权当前站点。
- 全站授权请求支持拒绝后重试、跨 Popup/Side Panel 同步、浏览器外部撤权检测和延迟授权结果保护。
- 授权弹框将“Allow all sites”改为与 Cancel、Allow access 同行的紧凑黄色按钮；设置页说明改为整行悬浮提示。
- 保留 Cookie 的 HTTP/HTTPS、精确父域权限兼容处理，以及既有 History、Operations 和数据编辑能力。

发布文件：`release/cookie-controller-0.3.9.zip`；校验文件：`release/cookie-controller-0.3.9.zip.sha256`。ZIP 根目录只包含 `manifest.json`、`assets/`、`src/` 和 `_locales/`。

发布包大小为 320,422 bytes，共 69 个文件。SHA-256：`12F0B63433DCFA21721F2C06FC7560E1818482901964227F1488D02E71961683`。包内 Manifest 版本为 `0.3.9`，九种语言词库和扩展入口均已确认存在。

2026-11-23 验证通过：

- `npm test`：215 项单元测试全部通过。
- `npm run lint`、`npm run test:locales`：静态检查通过，九种语言各 572 条文案校验通过。
- `npm run test:all-sites`：验证设置页和站点授权弹框的二次确认、拒绝重试、跨站 Cookie/Local/Session 读取、关闭后无自动弹框、跨界面同步、外部撤权和 380px 侧边栏布局。
- `npm run test:cookie-permissions`：真实 Chromium 中验证旧权限与完整 HTTP/HTTPS 父域权限下的 Cookie 读取范围。
- `npm run test:acceptance -- --site-access-only`：逐站授权的取消、拒绝重试、持久化和窄侧边栏回归通过。
- `git diff --check`。

Chrome 原生可选主机权限提示未由自动化操作；全站权限的真实请求与撤销 API 已验证，拒绝场景使用模拟回调。
