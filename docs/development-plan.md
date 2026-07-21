# Cookie 与 Web Storage 控制 Chrome 插件开发计划

## 1. 项目目标

开发一个面向开发、测试、联调场景的 Chrome 插件，用于快速查看和修改当前页面 Cookie、Local Storage 和 Session Storage，降低通过 Chrome DevTools 手动查找、编辑站点状态数据的操作成本。

核心目标：

- 展示当前页面相关 Cookie、Local Storage 和 Session Storage。
- 支持快速搜索、复制、修改 Cookie value 与 Storage value。
- 支持删除 Cookie 和 Storage 条目。
- 修改后可选择自动刷新当前页面。
- 尽量保留 Cookie 的原始属性，避免修改 value 时意外改变 `domain`、`path`、`secure`、`httpOnly`、`sameSite`、`expirationDate` 等字段。
- 所有数据仅在本地处理，不上传、不同步、不采集。

非目标：

- 不做跨设备 Cookie 同步。
- 不做账号体系。
- 不做复杂抓包或网络请求重放。
- 第一版不替代完整 DevTools Application 面板，只聚焦 Cookie、Local Storage、Session Storage 的单条值编辑。

## 2. 典型使用场景

### 2.1 修改登录态或灰度标识

开发者打开业务页面，点击插件图标，搜索目标 Cookie，例如 `SESSION`、`token`、`ab_bid`、`gray_user`，直接修改 value 并保存，页面自动刷新后立即验证效果。

### 2.2 复制 Cookie 值给同事或接口工具

用户选中某个 Cookie，点击复制 value 或复制 `name=value`，用于接口调试、问题复现或临时排查。

### 2.3 快速删除异常 Cookie

用户发现某个 Cookie 造成页面异常，点击删除并刷新页面，用于恢复干净状态。

### 2.4 查看结构化 Cookie

当 Cookie value 是 JSON、URL 编码、JWT 或 Base64 风格字符串时，插件提供辅助解析视图，帮助用户快速确认字段内容。

### 2.5 管理 Local Storage 与 Session Storage

开发者打开业务页面，点击插件图标，切换到 Local Storage 或 Session Storage，搜索目标 key，例如 `token`、`userInfo`、`debug_flags`、`lastRoute`，直接查看、复制、修改或删除 value。保存或删除后可选择刷新页面，使前端应用重新读取最新状态。

## 3. 功能范围

### 3.1 MVP 功能

MVP 目标是做出一个“打开即能改”的轻量编辑器。

- 当前 tab Cookie 列表
  - 显示 `Name`、`Value`、`Domain`、`Path`、`Expires`、`HttpOnly`、`Secure`、`SameSite`、`Size`。
  - 支持同名 Cookie 的区分展示。
- 搜索过滤
  - 按 name、value、domain、path 模糊搜索。
- Cookie 编辑
  - 点击行后进入编辑状态。
  - 默认只允许修改 value。
  - 保存时保留原 Cookie 的其他属性。
- Cookie 删除
  - 按 `name + url + storeId` 删除。
  - 删除前做二次确认或提供撤销入口。
- 复制能力
  - 复制 value。
  - 复制 `name=value`。
  - 复制完整 Cookie 信息 JSON。
- 刷新能力
  - 手动刷新 Cookie 列表。
  - 保存或删除后可选自动刷新页面。
- 状态提示
  - 保存成功。
  - 保存失败，并展示 Chrome API 返回的错误信息。
  - 当前页面不支持 Cookie 操作时给出提示。
- 当前 tab Local Storage / Session Storage 列表
  - 显示 `Key`、`Value`、`Storage`、`Origin`、`Size`。
  - 支持在 Cookie、Local Storage、Session Storage 三种数据类型之间切换。
  - 按 key、value、origin 模糊搜索。
- Storage 条目编辑
  - 点击行后进入编辑状态。
  - 修改 value 后通过页面上下文写回对应 storage。
  - 保存后重新读取列表，确认实际写入结果。
- Storage 条目删除
  - 按 `storageType + origin + key` 删除。
  - 删除前做二次确认。
- Storage 复制与导入导出
  - 复制 value。
  - 复制 `key=value`。
  - 复制完整条目 JSON。
  - 导出当前 storage 列表 JSON 到剪贴板。
  - 从剪贴板导入单个 `key=value` 条目。

### 3.2 第二阶段功能

- URL Decode / Encode 视图。
- JSON 格式化和压缩。
- JWT payload 解码展示。
- 最近修改记录。
- 单个 Cookie 撤销到修改前的值。
- 批量导出当前站点 Cookie。
- 从剪贴板导入 `name=value`。
- 记住 UI 偏好，例如表格列宽、自动刷新开关、默认解码模式。

### 3.3 第三阶段功能

- Side Panel 模式，提供比 popup 更大的编辑空间。
- 多站点 Cookie 快速切换。
- Cookie 模板，例如测试环境、预发环境、灰度用户模板。
- 批量编辑和批量删除。
- 支持 Partitioned Cookie / CHIPS 的更完整展示与编辑。
- Cookie 变更监听，页面运行时实时更新列表。

## 4. 产品交互设计

### 4.1 Popup 布局

建议第一版采用 popup，尺寸约 `760px x 560px`。

顶部区域：

- 当前页面 host。
- Cookie 数量。
- 搜索框。
- 刷新按钮。
- 自动刷新页面开关。

主体区域：

- 左侧或上方为 Cookie 表格。
- 选中某行后，在右侧或底部展示详情编辑面板。

编辑面板：

- Cookie name，只读。
- Cookie value，可编辑 textarea。
- domain、path、expires、sameSite、secure、httpOnly 等属性，只读展示。
- 保存、还原、删除、复制按钮。

### 4.2 交互原则

- 修改 value 是最高频操作，入口要直接。
- 删除是危险操作，需要明显区分。
- 同名 Cookie 必须展示 domain/path，避免误改。
- 对 `HttpOnly`、`Secure`、`SameSite=None` 等特殊属性使用简洁标识。
- 保存失败时不要只显示“失败”，需要给出失败原因。

## 5. 技术方案

### 5.1 扩展架构

使用 Chrome Extension Manifest V3。

推荐目录结构：

```text
cookiesManager/
  manifest.json
  src/
    popup/
      popup.html
      popup.css
      popup.js
    background/
      service-worker.js
    shared/
      cookie-api.js
      cookie-format.js
      storage-api.js
      storage-format.js
      url.js
  assets/
    icon-16.png
    icon-32.png
    icon-48.png
    icon-128.png
  docs/
    development-plan.md
```

### 5.2 Manifest 初始配置

建议先使用较克制的权限策略。

```json
{
  "manifest_version": 3,
  "name": "Cookie Controller",
  "version": "0.1.0",
  "description": "View and edit cookies for the current page.",
  "permissions": ["cookies", "activeTab", "tabs", "storage", "scripting"],
  "optional_host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "src/popup/popup.html"
  },
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  }
}
```

权限策略说明：

- `cookies`：读取、设置、删除 Cookie 的核心权限。
- `activeTab`：用户点击插件时，临时获得当前 tab 的访问能力。
- `tabs`：读取当前 tab URL 和刷新页面。
- `storage`：保存插件偏好。
- `scripting`：在用户当前 tab 的页面上下文中读取和写入 Local Storage / Session Storage。
- `optional_host_permissions`：当 `activeTab` 无法满足 Cookie API 访问时，引导用户授予当前站点或全部站点权限。

### 5.3 Cookie 查询流程

1. popup 打开时查询当前激活 tab。
2. 校验 URL 是否为 `http:` 或 `https:`。
3. 调用 `chrome.cookies.getAll({ url })`。
4. 按 `domain + path + name` 排序。
5. 将 Cookie 转换为 UI 可展示模型。

示例：

```js
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const cookies = await chrome.cookies.getAll({ url: tab.url });
```

### 5.4 Cookie 修改流程

修改时要尽量复用原 Cookie 属性。

```js
await chrome.cookies.set({
  url,
  name: cookie.name,
  value: nextValue,
  domain: cookie.hostOnly ? undefined : cookie.domain,
  path: cookie.path,
  secure: cookie.secure,
  httpOnly: cookie.httpOnly,
  sameSite: cookie.sameSite,
  expirationDate: cookie.session ? undefined : cookie.expirationDate,
  storeId: cookie.storeId,
  partitionKey: cookie.partitionKey
});
```

注意事项：

- `hostOnly` Cookie 不应传 `domain`。
- Session Cookie 不应传 `expirationDate`。
- `SameSite=None` 通常需要 `Secure`。
- `partitionKey` 需要在支持的 Chrome 版本中保留。
- 保存后重新读取 Cookie，确认实际写入结果。

### 5.5 Cookie 删除流程

删除时使用当前 Cookie 推导 URL，并保留 `storeId`。

```js
await chrome.cookies.remove({
  url,
  name: cookie.name,
  storeId: cookie.storeId
});
```

删除后需要刷新列表并提示结果。

### 5.6 数据模型

UI 层建议使用稳定 id 区分 Cookie。

```js
const cookieId = [
  cookie.storeId,
  cookie.partitionKey?.topLevelSite || "",
  cookie.domain,
  cookie.path,
  cookie.name
].join("|");
```

展示模型：

```ts
type CookieRow = {
  id: string;
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: string;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  session: boolean;
  storeId: string;
  raw: chrome.cookies.Cookie;
};
```

### 5.7 Local Storage / Session Storage 查询流程

Web Storage 没有类似 `chrome.cookies` 的专用扩展 API，需要通过 `chrome.scripting.executeScript` 在当前 tab 的主 frame 页面上下文中读取。

1. popup 打开时查询当前激活 tab。
2. 校验 URL 是否为 `http:` 或 `https:`。
3. 根据当前视图选择 `localStorage` 或 `sessionStorage`。
4. 注入只读取 key/value 的小函数，返回 `[{ key, value }]`。
5. 按 key 排序并转换为 UI 展示模型。

示例：

```js
const [{ result }] = await chrome.scripting.executeScript({
  target: { tabId },
  func: (storageType) => {
    const storage = storageType === "session" ? sessionStorage : localStorage;
    return Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index);
      return { key, value: storage.getItem(key) || "" };
    });
  },
  args: ["local"]
});
```

### 5.8 Local Storage / Session Storage 修改流程

Storage 修改需要在页面上下文中执行 `setItem`，保存后重新读取对应 storage。

```js
await chrome.scripting.executeScript({
  target: { tabId },
  func: (storageType, key, value) => {
    const storage = storageType === "session" ? sessionStorage : localStorage;
    storage.setItem(key, value);
  },
  args: ["local", key, nextValue]
});
```

注意事项：

- Storage value 固定按字符串处理，与浏览器原生行为保持一致。
- Session Storage 绑定到当前 tab 的当前页面上下文，不做跨 tab 同步。
- 对跨域 iframe 的 storage 暂不读取，第一版只管理当前 tab 主 frame 的 origin。
- 某些站点若禁止脚本执行或扩展无站点权限，需要展示 Chrome 返回的原始错误。

### 5.9 Local Storage / Session Storage 删除流程

删除时在页面上下文中执行 `removeItem`，并在删除前提示用户确认。

```js
await chrome.scripting.executeScript({
  target: { tabId },
  func: (storageType, key) => {
    const storage = storageType === "session" ? sessionStorage : localStorage;
    storage.removeItem(key);
  },
  args: ["session", key]
});
```

### 5.10 Storage 数据模型

UI 层建议使用稳定 id 区分 Storage 条目。

```js
const storageId = [storageType, origin, key].join("|");
```

展示模型：

```ts
type StorageRow = {
  id: string;
  type: "local" | "session";
  key: string;
  value: string;
  origin: string;
  size: number;
  raw: {
    type: "local" | "session";
    key: string;
    value: string;
    origin: string;
  };
};
```

## 6. 安全与隐私

Cookie 常包含登录态、token、用户标识，插件必须默认谨慎。

安全原则：

- 不上传 Cookie。
- 不上传 Local Storage 或 Session Storage。
- 不记录完整 Cookie 值到远程服务。
- 不使用第三方分析 SDK。
- 不在页面注入脚本读取 Cookie。
- 优先使用 `chrome.cookies` API。
- 读取和修改 Storage 时只在当前 tab 执行最小页面脚本，不注入持久内容脚本。
- 敏感操作，例如删除、批量修改，需要确认或撤销。
- 导出 Cookie 或 Storage 时提示用户文件包含敏感信息。

隐私说明建议写入 README 或插件详情页：

- 插件只在用户点击后读取当前页面 Cookie。
- Cookie 数据只在本机浏览器内处理。
- Local Storage 和 Session Storage 数据只在当前浏览器页面上下文内处理。
- 插件不会访问远程服务器。

## 7. 兼容性与限制

- 仅支持 `http://` 和 `https://` 页面。
- 不支持 `chrome://`、`edge://`、`file://`、Chrome Web Store 页面等特殊页面。
- 某些 Cookie 属性组合可能被浏览器拒绝。
- 无痕窗口需要用户允许插件在无痕模式运行。
- 企业策略可能限制 Cookie API。
- Partitioned Cookie 在不同 Chrome 版本中的 API 行为可能存在差异，需要单独测试。
- Storage 管理仅覆盖当前 tab 主 frame 的 origin，不覆盖同页面内跨域 iframe。
- Session Storage 是 tab 级别数据，同 origin 的其他 tab 不一定能看到相同内容。

## 8. 测试计划

### 8.1 手动测试

- 普通 Cookie 展示。
- `HttpOnly` Cookie 展示和修改。
- Session Cookie 修改后仍为 Session Cookie。
- 带 `expirationDate` 的 Cookie 修改后过期时间保留。
- `Secure` Cookie 修改后属性保留。
- `SameSite=Lax/Strict/None` 展示与保留。
- 同名不同 path Cookie 的展示和修改。
- 同名不同 domain Cookie 的展示和修改。
- 删除 Cookie 后页面刷新验证。
- 搜索过滤。
- 当前页面无 Cookie。
- 当前页面为特殊 URL，例如 `chrome://extensions`。
- Local Storage 条目展示、搜索、复制、修改、删除。
- Session Storage 条目展示、搜索、复制、修改、删除。
- Storage value 为 JSON、URL 编码、JWT 时辅助工具可复用。
- Storage 保存或删除后可选自动刷新页面。
- Storage 当前页面无数据时展示空状态。

### 8.2 本地测试页面

建议准备一个本地测试页面，用于写入多种 Cookie：

- hostOnly Cookie。
- domain Cookie。
- path 不同的同名 Cookie。
- session Cookie。
- expires Cookie。
- secure Cookie。
- sameSite Cookie。
- Local Storage 普通 key/value。
- Session Storage 普通 key/value。
- JSON、URL 编码、JWT 风格的 Storage value。

### 8.3 验收标准

MVP 完成时至少满足：

- 在普通业务页面点击插件后能看到当前页面 Cookie。
- 能准确修改指定 Cookie value。
- 修改后其他属性没有明显丢失。
- 能删除指定 Cookie。
- 同名 Cookie 不会误改。
- 保存失败时能显示可理解的错误。
- 插件没有远程请求。
- 能在 Local Storage 和 Session Storage 中准确修改、删除指定 key。
- Cookie、Local Storage、Session Storage 三种视图切换时不会误操作其他类型数据。

## 9. 开发里程碑

### Milestone 1：项目骨架

交付内容：

- Manifest V3 基础结构。
- popup 页面。
- service worker。
- 基础样式。
- 图标占位。

验收：

- 插件可通过 `chrome://extensions` 开发者模式加载。
- 点击插件图标可以打开 popup。

### Milestone 2：Cookie 列表

交付内容：

- 获取当前 tab。
- 读取当前页面 Cookie。
- 表格展示。
- 搜索过滤。
- 空状态和错误状态。

验收：

- 当前页面 Cookie 能正确展示。
- 特殊页面有明确提示。

### Milestone 3：编辑与删除

交付内容：

- 选中 Cookie。
- 编辑 value。
- 保存修改。
- 删除 Cookie。
- 保存后刷新列表。
- 可选自动刷新页面。

验收：

- 可稳定完成 Cookie value 修改。
- 删除指定 Cookie 后列表同步更新。

### Milestone 4：辅助工具

交付内容：

- 复制 value。
- 复制 `name=value`。
- URL Decode。
- JSON 格式化。
- JWT payload 解码。
- 最近修改记录。

验收：

- 常见调试操作可以在插件内完成。

### Milestone 5：体验与发布准备

交付内容：

- README。
- 隐私说明。
- 使用截图。
- 图标。
- 错误提示优化。
- 打包说明。

验收：

- 可交给团队成员安装试用。
- 关键限制和隐私边界说明清楚。

### Milestone 6：Local Storage 与 Session Storage 管理

交付内容：

- Cookie / Local Storage / Session Storage 视图切换。
- 当前 tab 主 frame Local Storage 列表、搜索、详情展示。
- 当前 tab 主 frame Session Storage 列表、搜索、详情展示。
- Storage value 编辑、保存、删除。
- Storage value 复制、`key=value` 复制、JSON 复制。
- Storage 导出 JSON 到剪贴板。
- 从剪贴板导入单个 `key=value` Storage 条目。
- 复用 URL Decode / Encode、JSON 格式化、JWT payload 解码。
- 保存或删除后可选自动刷新页面。

验收：

- 在普通业务页面能切换查看 Cookie、Local Storage 和 Session Storage。
- 能准确修改指定 Storage key 的 value。
- 能删除指定 Storage key，且不会影响 Cookie 或另一类 Storage。
- Storage 搜索、复制、导入导出和辅助解析工具可正常使用。
- 特殊页面或缺少站点权限时能显示可理解的错误。

## 10. 风险点与应对

### 10.1 权限过大导致用户不信任

应对：

- 优先使用 `activeTab`。
- 必要时再申请站点权限。
- README 清晰说明不上传数据。

### 10.2 修改 Cookie 时属性丢失

应对：

- 保存时从原 Cookie 复制属性。
- 保存后重新读取并对比。
- 测试覆盖 session、expires、secure、sameSite、httpOnly。

### 10.3 同名 Cookie 误操作

应对：

- UI 中始终展示 domain 和 path。
- 内部使用 `storeId + partitionKey + domain + path + name` 作为 id。

### 10.4 特殊 Cookie API 行为差异

应对：

- 对 Partitioned Cookie 单独标识。
- 对保存失败返回原始错误。
- 在 README 中说明 Chrome 版本要求。

### 10.5 Popup 空间不足

应对：

- MVP 保持 popup。
- 第二阶段评估 side panel。
- 大文本编辑使用 textarea，并支持展开编辑。

### 10.6 Storage 页面脚本权限不足

应对：

- 仅对当前 active tab 执行 `chrome.scripting.executeScript`。
- 对执行失败返回原始错误。
- README 中说明 Storage 管理依赖 `scripting` 与当前站点权限。

### 10.7 Cookie 与 Storage 操作混淆

应对：

- UI 顶部使用明确的分段切换控件。
- 表格列名和详情标题随数据类型变化。
- 内部使用 `kind + origin/domain + key/name` 作为 id，避免跨类型误选。

## 11. 后续待确认问题

- 插件名称使用中文还是英文？
- 是否只面向内部团队使用，还是计划发布到 Chrome Web Store？
- 第一版是否允许申请 `<all_urls>`，还是坚持最小权限策略？
- 是否需要支持批量导入导出？
- 是否需要给 Cookie value 做脱敏展示？
- 是否需要给 Storage value 做脱敏展示？
- 是否需要支持跨域 iframe 的 Local Storage / Session Storage？
- UI 技术栈使用原生 HTML/CSS/JS，还是引入 React/Vite？

## 12. 推荐第一版技术选择

如果目标是尽快可用，建议第一版使用原生 HTML、CSS、JavaScript。

理由：

- Chrome 插件 popup 体量较小。
- 不需要构建步骤，方便开发者模式直接加载。
- 权限、Cookie API、浏览器行为才是第一版主要风险，框架不是核心问题。

如果后续要做 side panel、复杂编辑器、模板管理和批量操作，再迁移到 React/Vite 会更合适。
