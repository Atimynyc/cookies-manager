| [English](../../README.md) | [简体中文](README.zh-CN.md) | **繁體中文 ✓** | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [Română](README.ro.md) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |

# ![](../../assets/icon-48.png) Cookie Controller

您可以透過彈出視窗或 Chrome 側邊欄，管理您所選網站的 Cookie、Local Storage 及 Session Storage。此功能專為開發人員、測試人員及進階使用者設計，讓您無需開啟 DevTools 即可檢視和修改網站資料。

## 開始使用

1. 請從 Chrome 網路商店安裝 [Cookie Controller](https://chromewebstore.google.com/detail/cookie-controller/hmfnocennjjcieebhojphobilohcdfda)。
2. 開啟一個 HTTP/HTTPS 網頁，然後點擊擴充功能圖示。
3. 在系統提示時，請核准對所選網站的存取權限，然後選擇「Cookies」、「Local Storage」或「Session Storage」。
4. 搜尋、編輯、匯入或匯出資料。展開側邊面板以獲得更大的工作區，或啟用修改後自動重新載入頁面的功能。

若要在本機安裝，請先複製此儲存庫，開啟 `chrome://extensions`，啟用開發者模式，再使用「載入未封裝項目（Load unpacked）」選取包含 `manifest.json` 的儲存庫資料夾。擴充功能可直接執行，無需建置。

## 特色

- 可依名稱、值、網域或路徑搜尋 Cookie。
- 當您變更 Cookie 的值或過期時間時，編輯器會保留每個 Cookie 的網域、路徑，以及 SameSite、Secure 和 HttpOnly 屬性。
- 建立與刪除 Cookie、刪除選取的項目，以及批次設定值。
- 檢視、建立、編輯及刪除 Local Storage 和 Session Storage 項目。
- 收藏的 HTTP Cookie 與網頁儲存項目會置頂顯示於各資料清單。
- 預覽匯出內容，並將當前檢視、選取的項目或所有網站資料儲存為具版本控制的 JSON 套件，儲存至檔案或剪貼簿。匯入時可預覽差異、逐項選取、設定衝突處理策略，並顯示進度、結果及批次撤銷功能。
- 以 Netscape/cURL cookie-jar 格式匯入及匯出 Cookie，包括 `#HttpOnly_` 規範及會話 Cookie。
- 將可重複使用的網站狀態連同標籤、來源規則、預設衝突策略，以及套用狀態時輸入的變數，一併儲存至本機。您可以對已儲存的狀態進行重新命名、複製、匯出、套用或刪除。
- 可透過獨立的 Name 和 Value 欄位快速匯入 Cookie，或使用 `key=value` 新增儲存項目。複製值、`name=value` 配對，或結構化的 JSON。
- 在編輯數值時，請使用 URL 編碼／解碼、JSON 格式化／壓縮，以及 JWT 有效載荷解碼工具。
- 檢視最近的變更及變更前後的差異、重新嘗試失敗的操作，並在當前的瀏覽器工作階段中撤銷受支援的變更。
- 在當前瀏覽器視窗中，於 HTTP/HTTPS 標籤頁之間切換目標。

Netscape/cURL 格式僅處理 Cookie。它不會保留 SameSite 屬性、Partitioned/CHIPS 分區資訊，或是 Chrome Cookie 儲存區識別碼。若要保留這些屬性及 Web 儲存空間，請使用 JSON 封裝。

## 語言與主題

此介面支援英語、簡體中文、繁體中文、西班牙語、巴西葡萄牙語、德語、法語、日語及羅馬尼亞語。所有翻譯內容均隨擴充功能一併提供，並可在離線狀態下使用。

首次使用時，系統會從 Chrome 的語言中選取一種受支援的語言並儲存；若無相符語言，則預設使用英文。羅馬尼亞語地區設定（例如 `ro-RO` 和 `ro-MD`）會選取羅馬尼亞語。您可隨時透過設定按鈕變更語言；切換語言時，編輯器中的草稿內容將予以保留。

使用太陽／月亮按鈕在淺色與深色主題之間切換。一般模式預設為淺色，無痕模式預設為深色。每種模式都會獨立於作業系統記憶其設定，且在同一模式下，所有開啟的擴充功能視窗會同步套用相同的偏好設定。

## 隱私權與資料控制

無廣告、無分析追蹤、無使用者追蹤，亦無需註冊帳號。網站資料會在您的裝置上進行處理，不會上傳、出售或與開發者或第三方伺服器分享。預設會按網站個別請求存取權限，您可於 Chrome 的擴充功能設定中撤銷此權限。您啟動的操作可能會在關閉彈出視窗或側邊面板後結束。

您可在設定或網站授權對話框中開啟**允許所有網站**，申請讀取您造訪的所有 HTTP/HTTPS 網站的 Cookie、localStorage 和 sessionStorage 資料。經 Chrome 核准後，造訪新網站時無需再逐站確認；關閉開關後恢復逐站授權。

偏好設定、網站存取確認、收藏項目識別碼（不含項目值）、儲存狀態及歷史紀錄摘要將保留於本地擴充功能儲存空間中。儲存狀態可包含您明確選擇儲存的 Cookie 及儲存空間值。完整的「前後」值及操作恢復資料僅保留於當前的瀏覽器工作階段中；重新啟動 Chrome 或重新載入擴充功能將清除這些資料。若要移除本機儲存的擴充功能資料，請清除擴充功能資料或解除安裝該擴充功能。

Cookie 和網頁儲存空間可能包含登入資訊或其他敏感資料。請妥善保護已複製及匯出的資料。JWT 工具僅會顯示經 Base64URL 解碼後的有效載荷供檢視之用，並不會驗證簽名，也不會檢查認證憑證是否可信或有效。詳情請參閱 [隱私權政策](../../docs/privacy-policy.html)。

## 軟體開發

請在儲存庫根目錄下安裝開發依賴項，並執行檢查：

```sh
npm install
npm run lint
npm test
npm run test:locales
npm run test:acceptance -- --storage-only
```

最後一個指令用於測試讀取及修改網站中 Local Storage 和 Session Storage 資料（位於 Chromium）。有關完整的瀏覽器測試指令、輸出位置及操作可靠性詳情，請參閱 [開發與發行參考（英文）](../../docs/development.md)。

## 發行與文件

當前版本：**0.3.9**。需搭配 **Chrome 114 或更新版本**。

- [v0.3.9 發行說明](../../docs/release-notes-v0.3.9.md)
- [在地化維護](../../docs/localization.md)
- [版本化網站資料封裝格式](../../docs/site-data-package-v1.md)
- [Chrome 網路商店的商品說明與宣傳圖片](../../store-assets/)
- [回報問題](https://github.com/Atimynyc/cookies-manager/issues)
