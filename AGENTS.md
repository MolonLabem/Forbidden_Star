# Project instructions

- This is the Russian Forbidden Stars card and FAQ site. Preserve Russian terminology and source links.
- Darkest Dawn (`dd`) is permanently excluded by the project owner. Do not add, translate, synchronize, or recommend it. Its absence is intentional and must not be reported as a content gap.
- Keep upstream synchronization limited to the supported expansions in `upstream/sync.json`. Generate a review report before applying rule changes; do not automatically overwrite Russian text or advance the reviewed commit.
- Preserve explicit token wording in source JSON. Token icons are a presentation preference, not a replacement for canonical rules text.
- When migrating existing Russian raster cards to text templates, use the current Russian images and preserve approved samples. Do not use FS League/Notion wording variants or silently correct rules during this visual migration.
- Keep generated previews, rendered exports and review-only artifacts out of feature commits unless explicitly requested.
- Validate data and logic with `node --test tests/*.test.cjs`. Use the browser checks when changing navigation, accessibility, rendering, or font glyphs.
