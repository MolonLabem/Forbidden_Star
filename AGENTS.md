# Project instructions

- This is the Russian Forbidden Stars card and FAQ site. Preserve Russian terminology and source links.
- Darkest Dawn (`dd`) is permanently excluded by the project owner. Do not add, translate, synchronize, or recommend it. Its absence is intentional and must not be reported as a content gap.
- Keep this repository limited to the website in `page/`, its assets, README, licence, site configuration and project instructions. Keep development tooling, tests, generated previews, exports and review reports outside the repository unless explicitly requested.
- Supported expansion folders are `base`, `gif`, `sow` and `dl` (The Dying Light). The last reviewed English upstream is `Frytkownica/Forbidden_Star` at `a31d0e9dd83d82691389341c7f412d9ff787fdc2`. Keep legacy `tdl` card routes working through `navigation.js`; new paths and links use `dl`, matching upstream. SoW folders `adepta_sororitas`, `adeptus_mechanicus` and `dark_eldar` map to `adeptasororitas`, `adeptusmechanicus` and `darkeldar`.
- Prepare review evidence outside the repository before applying rule changes. Do not automatically overwrite Russian text or advance the reviewed upstream commit. Preserve source citations and stable card/FAQ identifiers.
- Preserve explicit token wording in source JSON. Token icons are a presentation preference, not a replacement for canonical rules text.
- TDL terminology uses «Тысяча Сынов», «Тзаангор», «Солнечный Дозор» and «Гиканаты». Keep card-name lookups synchronized with rendered titles. Fan-created ship names retain their source-specific wording; do not present uncertain community translations as official GW terminology.
- When migrating existing Russian raster cards to text templates, use the current Russian images and preserve approved samples. Do not use FS League/Notion wording variants or silently correct rules during this visual migration.
- Validate JSON data and JavaScript syntax; check the site in a browser when changing navigation, accessibility, rendering or font glyphs. Keep temporary verification scripts and output outside the repository.
- Grid, search and printing share `page/script/catalog.js`, built from the existing faction manifests and text. `page/data/print-catalog.json` contains print settings, eligible expansions and control IDs only; do not add a second card/faction list or stored array indices.
- Use `FSCache.json` for shared session data; failed requests must remain retryable. Print source fingerprints must match the local generator's current source files.
- The reusable release checks and visual references live in the sibling `Forbidden_Star-QA` directory. Follow its README; do not automatically replace visual baselines after a failing comparison.
