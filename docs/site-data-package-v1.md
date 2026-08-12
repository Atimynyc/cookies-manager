# 站点数据包 v1 协议

站点数据包用于在后续版本中保存、比较和迁移 Cookie、Local Storage 与 Session Storage。v1 数据包是纯 JSON，所有解析与校验均在本地完成。

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
