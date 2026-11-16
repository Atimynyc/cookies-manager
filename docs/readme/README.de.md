| [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | **Deutsch ✓** | [Français](README.fr.md) | [日本語](README.ja.md) | [Română](README.ro.md) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |

# ![](../../assets/icon-48.png) Cookie Controller

Verwalten Sie Cookies, Local Storage und Session Storage für die von Ihnen ausgewählte Website über ein Popup-Fenster oder das Chrome Seitenpanel. Entwickelt für Entwickler, Tester und fortgeschrittene Benutzer, die Website-Daten überprüfen und ändern möchten, ohne DevTools zu öffnen.

## Los geht’s

1. Installieren Sie [Cookie Controller](https://chromewebstore.google.com/detail/cookie-controller/hmfnocennjjcieebhojphobilohcdfda) aus dem Chrome Web Store.
2. Öffnen Sie eine HTTP/HTTPS-Seite und klicken Sie auf das Symbol der Erweiterung.
3. Erlauben Sie den Zugriff auf die ausgewählte Website, wenn Sie dazu aufgefordert werden, und wählen Sie anschließend „Cookies“, „Local Storage“ oder „Session Storage“ aus.
4. Daten suchen, bearbeiten, importieren oder exportieren. Öffnen Sie das Seitenpanel, um den Arbeitsbereich zu vergrößern, oder aktivieren Sie das automatische Neuladen der Seite nach Änderungen.

Für die lokale Installation klonen Sie dieses Repository, öffnen Sie „`chrome://extensions`“, aktivieren Sie den Entwicklermodus und wählen Sie über „Load unpacked“ den Repository-Ordner aus, der „`manifest.json`“ enthält. Die Erweiterung wird direkt aus den enthaltenen Dateien ausgeführt; es ist kein Build-Schritt erforderlich.

## Funktionen

- Suchen Sie Cookies nach Name, Wert, Domain oder Pfad.
- Der Editor behält die Attribute „Domain“, „Path“, „SameSite“, „Secure“ und „HttpOnly“ jedes Cookies bei, wenn Sie dessen Wert oder Ablaufzeit ändern.
- Cookies erstellen und löschen, ausgewählte Elemente löschen und Werte stapelweise festlegen.
- Einträge für Local Storage und Session Storage anzeigen, anlegen, bearbeiten und löschen.
- Die bevorzugten HTTP-Cookies und Webspeicher-Einträge werden oben in jeder Datenliste angezeigt.
- Exporte in der Vorschau anzeigen und die aktuelle Ansicht, ausgewählte Elemente oder alle Website-Daten als versioniertes JSON-Paket in einer Datei oder in die Zwischenablage speichern. Importieren mit Differenzvorschau, elementweiser Auswahl, Konfliktstrategien, Fortschrittsanzeige, Ergebnissen und stapelweiser Rückgängig-Funktion.
- Importieren und exportieren Sie Cookies im Netscape/cURL-Cookie-Jar-Format, einschließlich der `#HttpOnly_`-Konvention und der Sitzungscookies.
- Speichern Sie wiederverwendbare Website-Zustände lokal zusammen mit Tags, Ursprungsregeln, Standard-Konfliktstrategien und Variablen, die bei der Anwendung eines Zustands eingegeben wurden. Sie können gespeicherte Zustände umbenennen, duplizieren, exportieren, anwenden oder löschen.
- Importieren Sie Cookies schnell mithilfe der separaten Felder „Name“ und „Value“ oder fügen Sie einen Speichereintrag mit „`key=value`“ hinzu. Kopieren Sie Werte, „`name=value`“-Paare oder strukturierte „JSON“-Einträge.
- Verwenden Sie beim Bearbeiten von Werten die Tools zur URL-Kodierung/-Dekodierung, zur Formatierung/Komprimierung (JSON) sowie zur Dekodierung der Nutzdaten (JWT).
- Letzte Änderungen und Vorher-Nachher-Unterschiede anzeigen, fehlgeschlagene Vorgänge erneut ausführen und unterstützte Änderungen während der aktuellen Browsersitzung rückgängig machen.
- Wechseln Sie im aktuellen Browserfenster zwischen den Registerkarten „HTTP“ und „HTTPS“.

Das Format Netscape/cURL verarbeitet ausschließlich Cookies. Es behält weder das Attribut SameSite noch die Partitionsinformationen Partitioned/CHIPS noch die Kennung des Chrome-Cookie-Speichers bei. Verwenden Sie JSON-Pakete, um diese Attribute und den Webspeicher beizubehalten.

## Sprachen und Themen

Die Benutzeroberfläche unterstützt Englisch, vereinfachtes Chinesisch, traditionelles Chinesisch, Spanisch, brasilianisches Portugiesisch, Deutsch, Französisch, Japanisch und Rumänisch. Alle Übersetzungen sind in der Erweiterung enthalten und funktionieren auch offline.

Bei der ersten Nutzung wird eine unterstützte Sprache aus den von Chrome angebotenen Sprachen ausgewählt und gespeichert; nicht übereinstimmende Sprachen werden standardmäßig auf Englisch umgestellt. Rumänische Sprachversionen wie `ro-RO` und `ro-MD` wählen Rumänisch aus. Sie können die Sprache jederzeit über die Schaltfläche „Einstellungen“ ändern; beim Wechsel der Sprache bleiben die Entwürfe im Editor erhalten.

Verwenden Sie die Sonne-/Mond-Schaltfläche, um zwischen hellem und dunklem Design zu wechseln. Im normalen Modus ist standardmäßig das helle Design aktiviert, im Inkognito-Modus das dunkle. Jeder Modus speichert seine Einstellung unabhängig vom Betriebssystem, und die Einstellungen werden zwischen allen geöffneten Erweiterungsfenstern im selben Modus synchronisiert.

## Datenschutz und Datenkontrolle

Keine Werbung, keine Analysen, kein Nutzer-Tracking und kein Konto erforderlich. Die Daten der Website werden auf Ihrem Gerät verarbeitet und werden weder hochgeladen noch verkauft oder an den Entwickler oder Server von Drittanbietern weitergegeben. Der Zugriff auf die von Ihnen ausgewählte Website wird angefordert und kann in den Erweiterungseinstellungen von Chrome widerrufen werden. Von Ihnen gestartete Vorgänge werden möglicherweise nach dem Schließen des Popups oder des Seitenpanels abgeschlossen.

Einstellungen, Bestätigungen für den Zugriff auf Websites, Favoriten-Kennungen (ohne Elementwerte), gespeicherte Zustände und Verlaufsübersichten verbleiben im lokalen Speicher der Erweiterung. Gespeicherte Zustände können die Cookie- und Speicherdaten enthalten, die Sie ausdrücklich zum Speichern ausgewählt haben. Vollständige Vorher-/Nachher-Werte und Daten zur Wiederherstellung von Vorgängen bleiben nur für die aktuelle Browsersitzung erhalten; ein Neustart von Chrome oder das Neuladen der Erweiterung löscht sie. Löschen Sie die Erweiterungsdaten oder deinstallieren Sie die Erweiterung, um lokal gespeicherte Erweiterungsdaten zu entfernen.

Cookies und Webspeicher können Anmeldedaten oder andere sensible Werte enthalten. Schützen Sie kopierte und exportierte Daten. Das Tool JWT zeigt die Base64URL-dekodierte Nutzlast ausschließlich zu Überprüfungszwecken an. Es überprüft weder Signaturen noch die Vertrauenswürdigkeit oder Gültigkeit eines Authentifizierungstokens. Weitere Informationen finden Sie in der [Datenschutzerklärung](../../docs/privacy-policy.html).

## Softwareentwicklung

Installieren Sie die Entwicklungsabhängigkeiten und führen Sie die Prüfungen vom Stammverzeichnis des Repositorys aus durch:

```sh
npm install
npm run lint
npm test
npm run test:locales
npm run test:acceptance -- --storage-only
```

Der letzte Befehl dient zum Testen des Lesens und Änderns der Daten „Local Storage“ und „Session Storage“ einer Website in „Chromium“. Die vollständigen Browser-Testbefehle, Ausgabeorte und Details zur Betriebszuverlässigkeit finden Sie in der [Entwicklungs- und Release-Referenz (Englisch)](../../docs/development.md).

## Veröffentlichung und Dokumentation

Aktuelle Version: **0.3.7**. Erfordert **Chrome 114 oder neuer**.

- [Versionshinweise zu v0.3.7](../../docs/release-notes-v0.3.7.md)
- [Pflege der Lokalisierung](../../docs/localization.md)
- [Format für versionierte Website-Datenpakete](../../docs/site-data-package-v1.md)
- [Produktbeschreibungen und Werbebilder für den Chrome-Webshop](../../store-assets/)
- [Ein Problem melden](https://github.com/Atimynyc/cookies-manager/issues)
