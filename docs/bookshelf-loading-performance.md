# Bookshelf loading performance

## Acceptance dataset

- Catalog: 1,000 Books
- Bookshelf: 300 direct Books and Folders
- Folder: 20 Books

These are performance acceptance boundaries, not capacity limits.

## Confirmed experience

- An installed PWA with a warm local cache must render an interactive Bookshelf within 500 ms of launch on a mid-range mobile device.
- With that warm cache, every cover visible in the initial viewport must finish rendering within 800 ms of launch.
- On a first visit with no local cache, the Bookshelf must become interactive within 2 seconds on ordinary Wi-Fi.
- On that first uncached visit, every cover visible in the initial viewport must finish rendering within 3 seconds; off-screen covers remain demand-loaded.
- The Bookshelf becomes interactive as soon as its structure and metadata are ready; cover images load progressively and never block search, scrolling, opening a Folder, or opening a Book.
- Tapping a Folder must show an interactive panel within 100 ms without waiting for a new network request. The panel uses already loaded or cached membership data and revalidates it in the background.
- When a Folder is opened for the first time and its covers are not cached, every cover in the panel's initial viewport must finish rendering within 1 second on ordinary Wi-Fi.
- Startup loads one compressed, versioned, normalized library snapshot containing Bookshelf structure, the Catalog, Folder membership, and recent-reading references, as recorded in [ADR 0003](./adr/0003-load-a-normalized-library-snapshot.md).
- The server derives 384 px and 768 px WebP thumbnails from each EPUB cover. Bookshelf and Folder views select between those thumbnails instead of downloading the multi-megabyte source image.
- Existing Docker libraries are upgraded one Book at a time through a resumable, low-priority background thumbnail backfill that yields resources between Books, never blocks server readiness, and never requires EPUB files to be re-imported. Legacy covers remain available throughout the migration and are retained for rollback as recorded in [ADR 0002](./adr/0002-retain-source-covers-during-thumbnail-backfill.md).
- Critical Bookshelf and Folder styles load with the application shell. Reader-only styles load with the deferred reader code, and no route may expose unstyled content while its styles are loading.
- The PWA shows its last cached library state immediately and revalidates it in the background, as recorded in [ADR 0001](./adr/0001-show-cached-library-before-revalidation.md).
- Cached state revalidates on launch, application focus, network recovery, and after local mutations. Cross-device changes do not require polling or real-time push.
- Each device limits its runtime cover-thumbnail cache to approximately 100 MB and evicts least-recently-used covers first. Application-shell and library-state caches have separate budgets.
- Full PWA caching targets modern Safari, Chrome, and Edge environments that support Service Worker, Cache Storage, and WebP. Other browsers retain online functionality but have no offline-cache guarantee, and the project does not add a legacy-browser compatibility layer.
- Full PWA caching also requires a secure context. Production access from another phone or computer must use HTTPS; plain HTTP on a LAN address retains online functionality but does not promise Service Worker or offline-cache behavior. Localhost remains the development exception.
