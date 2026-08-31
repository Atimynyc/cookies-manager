# 站点数据包 v1 协议

站点数据包用于保存、批量导入、比较和迁移 Cookie、Local Storage 与 Session Storage。v1 数据包是纯 JSON，所有解析、预览和校验均在本地完成。

## 数据结构

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-11T10:00:00.000Z",
  "source": {
    "url": "https://uat.example.com/page",
    "origin": "https://uat.example.com"
  },
  "data": {
    "cookies": [
      {
        "name": "session",
        "value": "value",
        "domain": "uat.example.com",
        "path": "/",
        "session": true,
        "secure": true,
        "httpOnly": true,
        "sameSite": "lax",
        "storeId": "0"
      }
    ],
    "localStorage": [
      {
        "key": "featureFlag",
        "value": "enabled",
        "origin": "https://uat.example.com"
      }
    ],
    "sessionStorage": []
  }
}
```

## 校验规则

- `schemaVersion` 必须为 `1`；未知版本返回 `UNSUPPORTED_SCHEMA_VERSION`。
- `exportedAt` 必须是有效时间，解析后规范化为 ISO 8601 字符串。
- `source.url` 仅允许 HTTP/HTTPS，`source.origin` 必须与 URL 一致。
- `data.cookies`、`data.localStorage`、`data.sessionStorage` 必须同时存在且为数组。
- Cookie 必须包含字符串类型的 `name`、`value`、`domain`；缺省 `path` 规范化为 `/`。
- Storage 的 `key` 和 `value` 必须是字符串；缺省 `origin` 使用 `source.origin`。
- 未知字段会被忽略，不会写入规范化结果。
- JSON、版本或字段校验失败时不返回部分数据，也不执行任何 Chrome 写入 API。

扩展界面复制或保存 JSON 时，会在标准 v1 数据包顶层附加以下兼容元数据：

- `url`：当前管理目标的完整 URL。
- `host`：当前管理目标的主机名及端口。
- `type`：导出当前视图或选中项时为 `cookies`、`localStorage` 或 `sessionStorage`，导出全部站点数据时为 `siteData`。
- `count`：本次数据包中三类数据项的总数。

这些字段不属于解析 v1 数据包时的必填字段，不影响其他实现生成的标准数据包导入。

## 项目标识

内部标识使用字段数组的 JSON 编码并进行 URI 编码，避免字段本身包含分隔符时发生碰撞，同时可安全用于 DOM 属性：

- Cookie：`[storeId, partitionKey.topLevelSite, partitionKey.hasCrossSiteAncestor, domain, path, name]`
- Storage：`[type, origin, key]`

Cookie 的 `partitionKey` 不存在时使用空值；Storage 的 `type` 为 `local` 或 `session`。

## 代码入口

`src/shared/site-data-package.js` 提供：

- `createSiteDataPackage`：创建并规范化 v1 数据包。
- `parseSiteDataPackage`：解析字符串或对象，失败时抛出 `SiteDataPackageError`。
- `tryParseSiteDataPackage`：返回 `{ success, data, error }`，便于导入预览流程无副作用处理错误。
- `serializeCookie` / `serializeStorageItem`：生成协议数据项。
- `classifySiteDataItem`：将项目分类为 `new`、`same` 或 `conflict`。

## v0.3.0 导入行为

- 导出范围支持当前视图、选中项目和当前目标的全部三类数据，可复制到剪贴板或保存为 `.json` 文件。
- 写入前读取目标状态，并将项目区分为新增、仅值修改、属性冲突、相同和不支持。
- 冲突策略支持覆盖、跳过、仅新增和逐项选择；目标中额外存在的数据不会被删除。
- 来源与目标 origin 不同时默认禁止写入，只有用户显式启用映射后才会将可映射的 Cookie domain 和 Storage origin 改写到目标。
- 批量执行每 10 项向浏览器事件循环让出控制权并更新进度；失败项目保留 Chrome API 原始错误消息。
- 成功写入项的操作前状态只保存在 `chrome.storage.session`，用于当前浏览器会话内的整批撤销。

## Netscape/cURL Cookie jar 兼容格式

v0.3.0 同时支持 Netscape HTTP Cookie File 格式，方便与 `curl` 及其他常见 Cookie 工具交换数据。该格式仅处理 Cookie，不包含 Local Storage 或 Session Storage；导入后会转换为内部 v1 数据包，继续复用差异预览、冲突策略、逐项结果和整批撤销流程。

每条有效记录必须包含 7 个以 Tab 分隔的字段：

```text
domain  includeSubdomains  path  secure  expires  name  value
```

- `includeSubdomains` 和 `secure` 只接受 `TRUE` 或 `FALSE`。
- `expires` 使用 Unix 秒；`0` 表示会话 Cookie。
- 支持 cURL 使用的 `#HttpOnly_` domain 前缀，普通 `#` 开头的行视为注释。
- 导入时逐行校验格式、重复 Cookie、控制字符、过期时间和目标域名；错误会包含行号，且不会产生部分写入。
- 文件可使用 `.txt` 或 `.cookies` 扩展名；选择文件时会根据 JSON 扩展名或 Netscape 文件头/记录自动切换格式。
- 导出可选择当前 Cookie 视图、已选择的 Cookie 或当前目标的全部 Cookie，并复制文本或保存为 `*-cookies-YYYY-MM-DD.txt`。
- Netscape 格式无法表达 SameSite、Partitioned/CHIPS 和 Chrome Cookie store。需要保留这些属性时应使用 JSON 数据包。

对应实现位于 `src/shared/netscape-cookies.js`，提供 `parseNetscapeCookieFile` 和 `serializeNetscapeCookieFile`。

## 配置组

配置组使用同一份 v1 数据包作为内容，附加名称、说明、标签、精确 origin 规则、默认冲突策略和变量定义，并保存在 `chrome.storage.local`。以 `!name=current-value` 创建的变量会把捕获值替换为 `${name}`，只在应用时请求输入，捕获值和输入值都不会写入配置组。
