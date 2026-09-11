
# ![](assets/icon-48.png) cookies-manager
Cookie Controller is a site data management tool for developers, testers, and advanced users. It lets you inspect and manage cookies, Local Storage, and Session Storage for the current page from a popup or the Chrome side panel, without opening the full developer tools.

Main features

- View cookies for the current page and quickly search by name, value, domain, or path.
- Favorite frequently used cookies and Local/Session Storage entries so they stay at the top of each list.
- Edit an individual cookie value or expiration time while preserving its domain, path, SameSite, Secure, and HttpOnly attributes.
- Create or delete cookies, delete multiple selected cookies, and set values in batches.
- View, create, edit, and remove Local Storage and Session Storage entries.
- Switch the management target between HTTP/HTTPS tabs in the current browser window.
- Open export directly above the data list, preview the generated content, then export the current view, selected items, or all site data as a versioned JSON package to the clipboard or a file.
- Open import directly above the data list and choose quick entry, a JSON package, or Netscape/cURL; package imports include per-item selection, conflict strategies, progress, exact failures, and batch undo.
- Import and export Cookies in the common Netscape/cURL cookie-jar format, including cURL's `#HttpOnly_` convention and session cookies.
- Open Saved States directly above the data list and save reusable site states locally, including tags, origin rules, default conflict behavior, and apply-time variables; rename, duplicate, export, apply, or delete them.
- Quickly import one or more Cookies with separate Name and Value fields; Storage keeps the lightweight key=value entry point.
- Copy a cookie value, a name=value pair, or structured JSON with one action.
- Use built-in URL encode/decode, JSON format/compact, and JWT payload decoding tools.
- Review recent changes and before/after differences, and undo changes during the current browser session.
- Optionally reload the page automatically after a change.
- Use the extension from either its popup or the Chrome side panel.

Cookie Controller 是一款面向开发者、测试人员和高级用户的站点数据管理工具。它可以在弹出窗口或 Chrome 侧边栏中查看和管理当前网页的 Cookie、Local Storage 与 Session Storage，无需打开完整的开发者工具。

主要功能

- 查看当前网页的 Cookie，并按名称、值、域名或路径快速搜索。
- 修改单个 Cookie 的值或过期时间，同时保留其域名、路径、SameSite、Secure 和 HttpOnly 等属性。
- 新增、删除或批量删除 Cookie，并为多个选中项批量设置值。
- 查看、添加、修改和删除 Local Storage 与 Session Storage 数据。
- 在当前浏览器窗口的多个 HTTP/HTTPS 标签页之间快速切换管理目标。
- 从数据列表上方直接打开导出，先预览生成内容，再将当前视图、选中项或全部站点数据导出为带版本号的 JSON 数据包，并复制到剪贴板或保存为文件。
- 从数据列表上方直接打开导入，并选择快速输入、JSON 数据包或 Netscape/cURL；数据包导入支持逐项选择、冲突策略、进度、精确失败原因和整批撤销。
- 以常用的 Netscape/cURL cookie jar 格式导入和导出 Cookie，支持 cURL 的 `#HttpOnly_` 约定和会话 Cookie。
- 从数据列表上方直接打开 Saved States（已保存状态），在浏览器本地保存可复用的站点状态，支持标签、Origin 规则、默认冲突策略、应用时变量，以及重命名、复制、导出、应用和删除。
- 使用独立的 Name 与 Value 输入框快速导入一条或多条 Cookie；Storage 继续保留轻量的 key=value 入口。
- 一键复制 Cookie 值、name=value 键值对或结构化 JSON。
- 内置 URL 编码与解码、JSON 格式化与压缩、JWT Payload 解码工具。
- 查看最近的修改记录和修改前后差异，并在当前操作会话中撤销变更。
- 可选自动刷新页面，让修改后的站点状态立即生效。
- 同时支持扩展弹出窗口和 Chrome 侧边栏模式。

Development

- Run `npm run lint` for undefined JavaScript identifier checks.
- Run `npm test` for the unit-test baseline covering parsing, identifiers, package validation, conflicts, batch results, favorites, and recent-change normalization.
- Run `npm run test:acceptance` for the full Chrome extension workflow.
- Run `npm run test:acceptance:v032` for target isolation, editor drafts, history undo, and Saved States capacity regressions.
- Run `npm run test:acceptance:v033` for operation recovery, worker interruption, concurrent writes, retry, undo conflicts, and result views.
- Run `npm run test:acceptance:v030` for the focused data-package and saved-state workflow.
- The versioned site data interchange contract is documented in `docs/site-data-package-v1.md`.
- Acceptance screenshots are written to `.tmp/` by default. Set `ACCEPTANCE_ARTIFACT_DIR` to choose another artifact directory for the full workflow.

v0.3.5 release preparation

- Manifest version is `0.3.5` and the supported Chrome baseline is version 114 or newer.
- The upload package contains only `manifest.json`, `assets/`, and `src/`; release checks exclude tests, scripts, docs, temporary files, and dependencies.
- Chrome Web Store copy and four 1280×800 feature images are in `store-assets/`.

v0.3.3 operation reliability

- Edits, deletions and imports share a background operation journal. Accepted tasks survive closing the extension surface; worker restarts reconcile interrupted writes before continuing.
- History > Operations retains batch results and per-item errors, supports retrying failed items and conflict-checked undo, and lets you remove completed records.
- Storage checks the expected value inside the target page before writing. Cookie operations verify identity and attributes before and after writing; Chrome does not provide atomic Cookie compare-and-set.
- Favorites and Saved States use coordinated incremental updates across extension surfaces. Journal capacity errors reject new writes without removing older records.
- Full values and recovery data stay in browser session storage. Restarting the browser or reloading the extension ends that recovery session; local summaries remain available. Older history entries without a complete operation journal are view-only.
- Implementation details and verification: [v0.3.3 release notes](docs/release-notes-v0.3.3.md).

v0.3.2 stability

- Site-data mutations keep their original tab, origin, browsing mode, and Cookie store. Storage checks the actual page origin inside the injected operation.
- History undo is available only for a verified target; Session Storage additionally requires its original tab. Older snapshots without target metadata remain viewable but cannot be undone.
- Unsaved value and expiration drafts stay in the open extension surface when switching items, views, sites, or refreshing. External changes require confirmation before overwriting. Drafts are not persisted after closing that surface.
- Saved States reject additions beyond 50 without deleting existing states; older collections above the limit remain readable and manageable. Storage quota failures preserve existing data and provide an actionable error.
- Reset updates the complete editor state. Error messages remain visible until dismissed or replaced.

Netscape/cURL import and export is Cookie-only. The format cannot represent SameSite, Partitioned/CHIPS, or the Chrome Cookie store, so use the JSON package when those attributes or web storage must round-trip without loss.
