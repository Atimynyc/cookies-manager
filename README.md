| **English ✓** | [简体中文](docs/readme/README.zh-CN.md) | [繁體中文](docs/readme/README.zh-TW.md) | [Español](docs/readme/README.es.md) | [Português (Brasil)](docs/readme/README.pt-BR.md) | [Deutsch](docs/readme/README.de.md) | [Français](docs/readme/README.fr.md) | [日本語](docs/readme/README.ja.md) | [Română](docs/readme/README.ro.md) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |

# ![](assets/icon-48.png) Cookie Controller

Manage cookies, Local Storage, and Session Storage for the website you choose, from a popup or the Chrome side panel. Built for developers, testers, and advanced users who want to inspect and change site data without opening DevTools.

## Get started

1. Install [Cookie Controller from the Chrome Web Store](https://chromewebstore.google.com/detail/cookie-controller/hmfnocennjjcieebhojphobilohcdfda).
2. Open an HTTP/HTTPS page and click the extension icon.
3. Approve access to the selected website when prompted, then choose Cookies, Local Storage, or Session Storage.
4. Search, edit, import, or export data. Open the side panel for a larger workspace, or enable automatic page reload after changes.

For local installation, clone this repository, open `chrome://extensions`, enable Developer mode, and use Load unpacked to select the repository folder containing `manifest.json`. The extension runs directly from the included files; no build step is required.

## Features

- Search cookies by name, value, domain, or path.
- The editor preserves each cookie's domain, path, SameSite, Secure, and HttpOnly attributes when you change its value or expiration time.
- Create and delete cookies, delete selected items, and set values in batches.
- View, create, edit, and delete Local Storage and Session Storage entries.
- Favorite HTTP cookies and web storage entries appear at the top of each data list.
- Preview exports and save the current view, selected items, or all site data as a versioned JSON package, to a file or the clipboard. Import with a difference preview, per-item selection, conflict strategies, progress, results, and batch undo.
- Import and export cookies in Netscape/cURL cookie-jar format, including the `#HttpOnly_` convention and session cookies.
- Save reusable site states locally with tags, origin rules, default conflict strategies, and variables entered when applying a state. Rename, duplicate, export, apply, or delete saved states.
- Quickly import cookies using separate Name and Value fields, or add a storage entry with `key=value`. Copy values, `name=value` pairs, or structured JSON.
- Use URL encoding/decoding, JSON formatting/compacting, and JWT payload decoding tools while editing values.
- Inspect recent changes and before/after differences, retry failed operations, and undo supported changes during the current browser session.
- Switch the target between HTTP/HTTPS tabs in the current browser window.

The Netscape/cURL format handles only cookies. It does not preserve the SameSite attribute, Partitioned/CHIPS partition information, or the Chrome cookie store identifier. Use JSON packages to preserve these attributes and web storage.

## Languages and themes

The interface supports English, Simplified Chinese, Traditional Chinese, Spanish, Brazilian Portuguese, German, French, Japanese, and Romanian. All translations are bundled with the extension and work offline.

On first use, a supported language is selected from Chrome's language and saved; unmatched languages fall back to English. Romanian locales such as `ro-RO` and `ro-MD` select Romanian. Change the language at any time using the settings button; switching languages preserves editor drafts.

Use the sun/moon button to switch between light and dark themes. Regular mode defaults to light and incognito mode defaults to dark. Each mode remembers its choice independently of the operating system, and preferences synchronize across open extension windows in the same mode.

## Privacy and data control

No ads, analytics, user tracking, or account required. Site data is processed on your device and is not uploaded, sold, or shared with the developer or third-party servers. Website access is requested for the site you select and can be revoked in Chrome's extension settings. Operations you start may finish after closing the popup or side panel.

Preferences, site-access confirmations, favorite identifiers (without item values), saved states, and history summaries remain in local extension storage. Saved states can contain the cookie and storage values you explicitly choose to save. Full before/after values and operation recovery data remain only for the current browser session; restarting Chrome or reloading the extension clears them. Clear extension data or uninstall the extension to remove locally saved extension data.

Cookies and web storage may contain sign-in information or other sensitive values. Protect copied and exported data. The JWT tool displays the Base64URL-decoded payload for inspection only. It does not verify signatures or check whether an authentication token is trustworthy or valid. Read the [privacy policy](docs/privacy-policy.html) for details.

## Software development

Install the development dependencies and run the checks from the repository root:

```sh
npm install
npm run lint
npm test
npm run test:locales
npm run test:acceptance -- --storage-only
```

The last command tests reading and changing a website's Local Storage and Session Storage data in Chromium. See the [development and release reference (English)](docs/development.md) for the full browser test commands, output locations, and operation reliability details.

## Release and documentation

Current version: **0.3.7**. Requires **Chrome 114 or newer**.

- [v0.3.7 release notes](docs/release-notes-v0.3.7.md)
- [Localization maintenance](docs/localization.md)
- [Versioned site data package format](docs/site-data-package-v1.md)
- [Store descriptions and promotional images for the Chrome Web Store](store-assets/)
- [Report an issue](https://github.com/Atimynyc/cookies-manager/issues)
