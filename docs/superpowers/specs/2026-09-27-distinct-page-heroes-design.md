# Distinct Animated Heroes Across Public Pages

## Goal

Give each public page a purposeful hero section with its own visual composition and motion idea. Keep RektoIQ's dark terminal identity for market and utility views, add a premium glass editorial treatment for stories, improve page orientation, and make the motion support the page's content.

## Scope

Cover the home page and public content routes: news, category, source directory, individual source, story detail, posts, about, live market, asset detail, signals, anomalies, and Degen Radar. Include public loading, not-found, and error states where a hero improves orientation. Admin pages remain outside this change.

## Design direction

Use the existing phosphor palette, terminal typography, borders, and restrained information-dense style for market, signals, anomalies, and utility views. Give editorial content—featured stories, news/category/source feeds, and story details—a modern premium treatment inspired by iOS glass surfaces: translucent dark surfaces, subtle backdrop blur, fine highlights, soft shadows, generous spacing, and clear editorial typography. Keep glass surfaces behind content rather than lowering text contrast. Share layout rules for hero spacing, heading hierarchy, text width, and responsive behavior. Give every page or page family a distinct animation and composition; do not reuse one animation across the whole site.

| Page | Hero composition and motion |
| --- | --- |
| Home | Retain and refine the connected-node network scene already used by `HeroNetwork`. |
| News | Layered headline rows with a slow vertical feed pulse and a fixed search/control area. |
| Category | Category-specific signal marks that assemble into a compact topic map. |
| Sources | A static directory motif with separate feed traces converging into a source index. |
| Individual source | An RSS waveform and publisher identity, with a small arrival pulse. |
| Story detail | A publication timeline that draws across the hero, with source markers and story metadata. |
| Posts | Terminal text blocks that type or resolve into post cards, without simulating unreadable rapid typing. |
| About | A simple system diagram that draws the hourly ingest path. |
| Live Market | Candlestick or price-line trace with a measured, low-amplitude update motion. |
| Asset detail | A symbol-specific chart trace and market-stat callouts. |
| Signals | A distinct threshold waveform with a crossing marker. |
| Anomalies | A radar sweep with a small number of plotted, non-flashing markers. |
| Degen Radar | A constellation/scatter field representing tracked assets, visually distinct from the anomaly radar. |
| Loading/error/not-found | Small state-specific progress, warning, or missing-route motif; avoid a large generic hero that distracts from recovery actions. |

Dynamic values must come from existing page data. Decorative layers must not invent prices, signal counts, or market activity.

## Editorial story treatment

- Apply glass styling to the home lead story and story cards, news/category/source result cards, and the story detail reading surface.
- Use translucent near-black layers, restrained blur and highlights, refined borders, larger radii, and generous spacing. Keep headline, source, publication time, and summary hierarchy unmistakable.
- Give story detail pages a focused reading column with comfortable line length; keep publisher links, source attribution, and timestamps easy to scan.
- Keep market tables, signal/anomaly feeds, and dense controls in the terminal/data visual language so editorial styling does not blur the product's information hierarchy.
- Keep the story timeline animation in the editorial hero; use subtle entrance or hover feedback on cards without making text move while reading.

## Implementation approach

Extend the existing `PageHero` system with page-specific variants or composition slots. Keep page content and data fetching in their current route components. Use CSS and lightweight inline SVG for decorative artwork and glass treatments; add no animation dependency and do not fetch external images for motion. The home hero remains a dedicated composition because its network scene already has a separate implementation.

Each decorative layer is `aria-hidden`. Headings, descriptions, search, and page controls remain ordinary semantic HTML. Motion must not control content visibility or delay access to page actions.

## Motion, accessibility, and performance

- Respect `prefers-reduced-motion` by disabling or replacing movement with a static composition.
- Keep animation slow and low contrast; no flashing, forced parallax, or motion that competes with readable content.
- Keep hero height stable while data loads and preserve mobile layouts.
- Use CSS transforms/opacity and small SVG shapes; avoid canvas, video, and heavy client-side animation code.
- Keep backdrop blur and layered shadows modest on mobile; ensure reading text remains opaque and high contrast.
- Ensure text remains legible over every decorative layer and that page titles remain the primary visual focus.

## Acceptance criteria

1. Every in-scope public route has a purposeful hero or a documented reason to use a compact state treatment.
2. Page heroes have distinct motion compositions suited to their content; no single animation is repeated as the site-wide hero effect.
3. Editorial story cards and reading pages have a premium glass treatment while market and signal interfaces retain the terminal/data style.
4. Story text remains comfortably readable, with no decorative blur or movement behind glyphs that reduces clarity.
5. Existing route data, navigation, search, and actions continue to work.
6. Reduced-motion users receive static compositions without losing information.
7. Heroes remain readable and do not cause horizontal overflow or unstable layout on mobile.
8. No decorative animation presents fabricated live data.

## Verification

Review each public route at desktop and mobile widths. Check reduced-motion behavior, keyboard access to controls, text contrast, overflow, and layout stability. Run the repository's typecheck and production build after implementation. Do not add or run automated tests unless requested.

## Risks and mitigations

- **Visual sameness:** assign each route its own composition and motion before implementation review.
- **Motion fatigue:** keep motion subtle, avoid flashing, and honor reduced-motion preferences.
- **Performance regressions:** use CSS/inline SVG and keep decorative layers small and isolated.
- **Misleading data visuals:** animate only decoration unless values are backed by existing page data.
