| [English](../../README.md) | **简体中文 ✓** | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [Română](README.ro.md) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |

# ![](../../assets/icon-48.png) Cookie Controller

您可以通过弹出窗口或 Chrome 侧边栏，管理所选网站的 Cookie、Local Storage 和 Session Storage。该功能专为希望在不打开 DevTools 的情况下检查和修改网站数据的开发者、测试人员及高级用户而设计。

## 开始使用

1. 从 Chrome 网上应用店安装 [Cookie Controller](https://chromewebstore.google.com/detail/cookie-controller/hmfnocennjjcieebhojphobilohcdfda)。
2. 打开一个 HTTP/HTTPS 页面，然后点击扩展程序图标。
3. 在系统提示时，批准对所选网站的访问权限，然后选择“Cookies”、“Local Storage”或“Session Storage”。
4. 搜索、编辑、导入或导出数据。打开侧边栏以获得更大的工作区，或启用修改后自动刷新页面功能。

如需在本地安装，请克隆此仓库，打开 `chrome://extensions`，启用开发者模式，点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的仓库目录。扩展可直接运行，无需构建。

## 功能

- 按名称、值、域名或路径搜索 Cookie。
- 当您更改 Cookie 的值或过期时间时，编辑器会保留每个 Cookie 的域名、路径以及 SameSite、Secure 和 HttpOnly 属性。
- 创建和删除 Cookie、删除选定项目，以及批量设置值。
- 查看、创建、编辑和删除 Local Storage 和 Session Storage 条目。
- 收藏的 HTTP Cookie 和 Web 存储条目会显示在每个数据列表的顶部。
- 预览导出内容，并将当前视图、所选项目或所有站点数据保存为带版本的 JSON 包，保存至文件或剪贴板。导入时支持差异预览、逐项选择、冲突处理策略、进度显示、结果显示以及批量撤销。
- 以 Netscape/cURL cookie-jar 格式导入和导出 Cookie，包括 `#HttpOnly_` 规范和会话 Cookie。
- 将可重用的站点状态（包括标签、源规则、默认冲突策略以及应用状态时输入的变量）保存在本地。可以对已保存的状态进行重命名、复制、导出、应用或删除。
- 使用独立的 Name 和 Value 字段快速导入 Cookie，或使用 `key=value` 添加存储条目。复制值、`name=value` 对或结构化 JSON。
- 在编辑数值时，请使用 URL 编码/解码、JSON 格式化/压缩以及 JWT 有效载荷解码工具。
- 查看最近的更改和“之前/之后”的差异，重试失败的操作，并在当前浏览器会话期间撤销受支持的更改。
- 在当前浏览器窗口中，在 HTTP/HTTPS 标签页之间切换目标。

Netscape/cURL 格式仅处理 Cookie。它不会保留 SameSite 属性、Partitioned/CHIPS 分区信息或 Chrome Cookie 存储标识符。请使用 JSON 包来保留这些属性及 Web 存储。

## 语言与主题

该界面支持英语、简体中文、繁体中文、西班牙语、巴西葡萄牙语、德语、法语、日语和罗马尼亚语。所有翻译内容均随扩展程序捆绑提供，并支持离线使用。

首次使用时，系统会从 Chrome 的语言中选择一种受支持的语言并保存；若未匹配到语言，则默认使用英语。罗马尼亚语区域设置（如 `ro-RO` 和 `ro-MD`）将选择罗马尼亚语。您可以随时通过“设置”按钮更改语言；切换语言时，编辑器中的草稿将被保留。

使用太阳/月亮按钮在浅色和深色主题之间切换。常规模式默认使用浅色主题，无痕模式默认使用深色主题。每种模式都会独立于操作系统记住其设置，且同一模式下所有已打开的扩展程序窗口会同步这些设置。

## 隐私与数据控制

无广告、无分析、无用户追踪，也无需注册账号。网站数据在您的设备上进行处理，不会被上传、出售或与开发者或第三方服务器共享。仅会针对您选择的网站请求访问权限，您可在 Chrome 的扩展程序设置中撤销该权限。您启动的操作可能会在关闭弹出窗口或侧边栏后完成。

首选项、网站访问确认、收藏标识符（不含项目值）、保存的状态以及历史记录摘要将保留在本地扩展程序存储中。保存的状态可包含您明确选择保存的 Cookie 和存储值。完整的“之前/之后”值和操作恢复数据仅在当前浏览器会话中保留；重启 Chrome 或重新加载扩展程序将清除这些数据。若要删除本地保存的扩展程序数据，请清除扩展程序数据或卸载该扩展程序。

Cookie 和 Web 存储中可能包含登录信息或其他敏感数据。请保护已复制和导出的数据。JWT 工具仅显示经过 Base64URL 解码的有效载荷供您查看，不会验证签名，也不会检查身份验证令牌是否可信或有效。详情请参阅 [隐私政策](../../docs/privacy-policy.html)。

## 软件开发

在仓库根目录下安装开发依赖项并运行检查：

```sh
npm install
npm run lint
npm test
npm run test:locales
npm run test:acceptance -- --storage-only
```

最后一条命令会在 Chromium 中测试网站 Local Storage 和 Session Storage 数据的读取与修改。完整的浏览器测试命令、输出位置和操作可靠性说明见 [开发与发布参考（英文）](../../docs/development.md)。

## 发布与文档

当前版本：**0.3.7**。需要 **Chrome 114 或更高版本**。

- [v0.3.7 发布说明](../../docs/release-notes-v0.3.7.md)
- [本地化维护](../../docs/localization.md)
- [版本化站点数据包格式](../../docs/site-data-package-v1.md)
- [Chrome 网上应用店说明和宣传图片](../../store-assets/)
- [报告问题](https://github.com/Atimynyc/cookies-manager/issues)
