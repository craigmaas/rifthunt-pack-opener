# Riftbound Pack Opener

A browser-only booster pack simulator for the Riftbound TCG. Pick a set, tear open a pack
(or a 24-pack box), flip the cards, and watch your session value climb or crater.

**Live site:** https://craigmaas.github.io/rifthunt-pack-opener/

No build step, no framework, no server. Three static files on GitHub Pages.

## How it works

- **Card data and images** come straight from the free [RiftHunt API](https://rifthunt.com/api/)
  (`/cards/search?q=s:<set>&unique=prints`). Each set is fetched once and cached in
  `localStorage` for 24 hours, so new cards and price updates show up automatically.
- **Prices** are TCGplayer market estimates returned by the same API. Foil and showcase pulls
  use the foil price; everything else uses the normal price.
- **Pull rates** are a model, not Riot's official odds. Riot publishes the pack layout and the
  Ultimate Rare rate; the rest is calibrated to the
  [riftbound.gg rarity guide](https://riftbound.gg/riftbound-card-rarity-guide-pull-rates/)
  and community box openings.

### Pack model (14 cards)

| Slot | Contents |
|---|---|
| 7 × Common | common |
| 3 × Uncommon | uncommon |
| 1 × Token / Rune | token 50%, rune 48.6%, alt-art rune 1.4% |
| 1 × Foil (any rarity) | common 55%, uncommon 28%, rare 13%, epic 2%, showcase 2% |
| 2 × Rare or better | rare 83%, epic 13%, showcase 4% |

Showcase pulls split into alt art / special art 85%, overnumbered 13.5%, signature 1.5%.
Ultimate Rares replace a rare slot at Riot's stated rates (Unleashed under 0.1%, Radiance 0.025%).

Per 24-pack box that works out to roughly 6 epics, 2 alt arts, 1 overnumbered every 3 boxes
and 1 signature every 30 boxes.

Sets: Origins, Spiritforged, Unleashed, Vendetta, Radiance. Promo runes from starter decks
and bundles are excluded from the booster pool.

## Running locally

Open `index.html` in a browser, or serve the folder with any static server
(`python -m http.server`). The API is CORS-open so no proxy is needed.

## Credits

Unofficial fan project. Card data and images via RiftHunt. Riftbound and League of Legends
are trademarks of Riot Games. Not affiliated with or endorsed by Riot Games or RiftHunt.
