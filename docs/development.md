# Development and release reference

[← English README](../README.md)

Detailed engineering and release notes shared by the localized READMEs. Commands run from the repository root.

## Development

- Run `npm run lint` for undefined JavaScript identifier checks.
- Run `npm test` for the unit-test baseline covering parsing, identifiers, package validation, conflicts, batch results, favorites, and recent-change normalization.
- Run `npm run test:locales` for source coverage, catalog keys, placeholders, and store text length checks.
- Run `npm run test:locales:browser` for all nine languages and English fallback, including manual language/theme settings, preference persistence, cross-surface updates, draft preservation, literal Cookie/Storage data, editing, import/export, and a 380px side panel. Screenshots and results are saved in `output/playwright/locales/`.
- Run `npm run test:theme:browser` for sun/moon switching, independent regular/incognito defaults and saved choices, native incognito action popup reopening, synchronization, keyboard controls, and save failure rollback. Screenshots and results are saved in `output/playwright/themes/`.
- Run `npm run test:acceptance` for the full Chrome extension workflow.
- Run `npm run test:acceptance -- --storage-only` for native scripting API coverage of website Local Storage and Session Storage workflows.
- Run `npm run test:acceptance:v032` for target isolation, editor drafts, history undo, and Saved States capacity regressions.
- Run `npm run test:acceptance:v033` for operation recovery, worker interruption, concurrent writes, retry, undo conflicts, and result views.
- Run `npm run test:acceptance:v030` for the focused data-package and saved-state workflow.
- The versioned site data interchange contract is documented in [site-data-package-v1.md](site-data-package-v1.md).
- Translation maintenance is documented in [localization.md](localization.md).
- Acceptance screenshots are written to `.tmp/` by default. Set `ACCEPTANCE_ARTIFACT_DIR` to choose another artifact directory for the full workflow.

## v0.3.7 release preparation

- Manifest version is `0.3.7` and the supported Chrome baseline is version 114 or newer.
- Upload `release/cookie-controller-0.3.7.zip`; package details are in [v0.3.7 release notes](release-notes-v0.3.7.md).
- The upload package contains only `manifest.json`, `assets/`, `src/`, and `_locales/`; release checks exclude tests, scripts, docs, temporary files, and dependencies.
- Chrome Web Store copy and four 1280×800 feature images are in `store-assets/`.
- Localized store copy is available in `store-assets/store-listing-{locale}.txt`. The existing feature images use English.

## v0.3.3 operation reliability

- Edits, deletions and imports share a background operation journal. Accepted tasks survive closing the extension surface; worker restarts reconcile interrupted writes before continuing.
- History > Operations retains batch results and per-item errors, supports retrying failed items and conflict-checked undo, and lets you remove completed records.
- Storage checks the expected value inside the target page before writing. Cookie operations verify identity and attributes before and after writing; Chrome does not provide atomic Cookie compare-and-set.
- Favorites and Saved States use coordinated incremental updates across extension surfaces. Journal capacity errors reject new writes without removing older records.
- Full values and recovery data stay in browser session storage. Restarting the browser or reloading the extension ends that recovery session; local summaries remain available. Older history entries without a complete operation journal are view-only.
- Implementation details and verification: [v0.3.3 release notes](release-notes-v0.3.3.md).

## v0.3.2 stability

- Site-data mutations keep their original tab, origin, browsing mode, and Cookie store. Storage checks the actual page origin inside the injected operation.
- History undo is available only for a verified target; Session Storage additionally requires its original tab. Older snapshots without target metadata remain viewable but cannot be undone.
- Unsaved value and expiration drafts stay in the open extension surface when switching items, views, sites, or refreshing. External changes require confirmation before overwriting. Drafts are not persisted after closing that surface.
- Saved States reject additions beyond 50 without deleting existing states; older collections above the limit remain readable and manageable. Storage quota failures preserve existing data and provide an actionable error.
- Reset updates the complete editor state. Error messages remain visible until dismissed or replaced.

Netscape/cURL import and export is Cookie-only. The format cannot represent SameSite, Partitioned/CHIPS, or the Chrome Cookie store, so use the JSON package when those attributes or web storage must round-trip without loss.
