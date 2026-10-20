# Maker Console listing: RSS Reader

Copy-paste kit for the Elgato Maker Console (https://maker.elgato.com). Values below were
drafted against the Elgato product guidelines (https://docs.elgato.com/guidelines/products)
as researched in October 2026; re-check the guidelines before submitting, because limits can change.

## Product name

RSS Reader

(10 characters; the limit is 30. "RSS Reader" names a file format, not a third-party service, so no "for X" wording is needed. It uses no logo; the icon is the generic RSS glyph.)

## Tagline

Up to five RSS and Atom feeds as tabs or one merged stream, with thumbnails and touch reading, on the Xeneon Edge.

(114 characters.)

## Description

Read your RSS and Atom feeds on the Xeneon Edge. The widget shows up to five feeds, either as tabs or merged into one date-sorted stream, with article thumbnails, relative-time chips and a story count. Touch the header to switch feeds, touch a story for its image, author, tags and summary, and touch Open to launch the article in your desktop browser. Many feeds send no CORS headers, so a widget cannot fetch them directly. This one tries a chain of routes and uses the first that returns stories: a direct fetch, the WordPress.com REST API, your own relay if you set one, then public bridges such as rss2json and allorigins. Name a feed with Label|https://..., and read-more boilerplate is trimmed from excerpts. The last good stories stay on screen with an amber dot if every route fails. It works at every Xeneon Edge slot size, with colors, background image, glass blur and transparency settings. Requires iCUE 5.52 or later on Windows and a Xeneon Edge; a self-hosted CORS relay is optional. It is free software under the MIT license, and the source is on GitHub.

(1070 characters; Maker Console asks for 250 to 1500. Counted with Python `len()` on the paragraph above.)

## Category

Productivity. (A news and feed reader; Productivity is the closest observed category, with Social as a second choice.) The exact Maker Console category list for iCUE widgets was not verified when this kit was
written. The categories observed live on the Elgato Marketplace iCUE widgets page in October 2026 were Audio, Productivity,
Gaming, Artistic, Monitoring, Engagement and Social; pick the closest one the console offers.

## Release notes

Version 1.3.4

- Makes `<head>` well-formed XML for iCUE 5.52 and declares the url network permission (`any`).
- Sets `min_app_version` to 5.52.
- Builds the package with the iCUE CLI from a clean staging directory.
- Uses a placeholder relay origin in the test harness.
- Adds a security policy, an Install section and badges.

(Condensed from the GitHub release notes for v1.3.4 (`gh release view v1.3.4 -R joshuawowk/icue-widget-rss`).)

## Requirements

- CORSAIR iCUE 5.52 or later (the manifest sets `min_app_version` to 5.52).
- Windows PC (the manifest targets `os` windows).
- A CORSAIR Xeneon Edge (`dashboard_lcd` device).
- iCUE's link provider plugin `widgetbuilder.linkprovider:Url:1.0` (declared in `required_plugins` in the manifest).
- Optional: a self-hosted CORS relay (for example https://github.com/joshuawowk/cors-relay) for feeds that block browser CORS. Without one, the widget falls back to public relays.

## Network permissions

The manifest declares one permission: `{ "type": "url", "domain": "any" }`, the iCUE spec's wildcard for all external hosts, because feeds can live on any host. Disclose this plainly to reviewers: when a feed does not send CORS headers, the widget routes the request through the WordPress.com REST API and then public bridges (rss2json, allorigins, feedrapp, codetabs), which means the feed URL, and for some bridges the feed content, passes through those third-party services unless the user sets their own Custom Proxy URL. Feeds that need an Authorization header or a session cookie do not work through the public routes. The wildcard does not cover `localhost` or a relay on the LAN: iCUE asks at runtime the first time the widget uses one and the user clicks Allow. iCUE shows the permission at install, and it can be revoked in the widget settings.

## License

MIT, see `LICENSE` in the repository root. Source: https://github.com/joshuawowk/icue-widget-rss

## Submission notes

- Asset specification unverified. The iCUE-specific listing asset requirements (icon size, gallery image count and
  dimensions, description limits) were not found in Elgato's documentation when this kit was written. This kit reuses the
  sizes of the Stream Deck kit: a 288x288 listing icon and 1920x960 gallery images, with a description of 250 to 1500
  characters. Re-check the Maker Console form and resize or re-render (`marketplace/build.sh`) if it asks for something else.
- Submission route unverified. Elgato's become-a-maker page lists Stream Deck, Wave Link, OBS and 3D as self-serve Maker
  Console categories but does not list iCUE widgets. If the console has no iCUE widget option, the fallback is the
  maker@elgato.com "New Product Submission" email route.
- File to upload: `RSS-Reader-1.3.4.icuewidget`, the `.icuewidget` attached to GitHub release v1.3.4:
  https://github.com/joshuawowk/icue-widget-rss/releases/download/v1.3.4/RSS-Reader-1.3.4.icuewidget
  Download it from the release; do not zip the folder by hand. To rebuild it, use `npm run package` (needs
  `npm install -g icuewidget-cli`).
- Manifest version is 1.3.4 and the file above matches release v1.3.4. If you submit a later release, update the
  version, release notes and file name in this kit first.
- Listing icon: `resources/icon.png` is 256x256 and was upscaled to 288x288 with ImageMagick (`convert resources/icon.png -resize 288x288!`), so it is slightly soft; re-export `resources/icon.svg` at 288 for a sharper icon if needed.
- Packaging caveat: `npm run package` stages an explicit list of widget files (`tools/package.js`), so the `marketplace/` folder is not included in the `.icuewidget`.
- Validator note: `icuewidget validate` (CLI 0.5.0, run in October 2026 on the unzipped local `dist/` build of that version) passes with one warning that the `any` url permission grants access to every external host. The permission is intentional because the host is user-entered; expect reviewers to ask about it and point them at the Network permissions section.
- Not tested on hardware: the kit was written without Windows, iCUE or a Xeneon Edge. Gallery slides show the shipped preview and text only; no screenshot was taken from a running panel.

## Assets in this folder

| File | Size | Use |
| --- | --- | --- |
| `listing-icon-288.png` | 288x288 | Product icon |
| `gallery-01.png` | 1920x960 | Overview: product name and the widget preview (`resources/preview.png`) with author names hidden |
| `gallery-02.png` | 1920x960 | Feature cards: feeds, touch reading, thumbnails, naming, offline |
| `gallery-03.png` | 1920x960 | The fetch route chain, setup steps and network permission |

Slide 1 shows the widget's own `resources/preview.png`, with the six author byline names covered by background-colored boxes in `marketplace/src/gallery-01.html` (the source PNG is untouched). The story titles are real public Hackaday headlines used as sample text; swap the preview if you would rather not show a third-party site's headlines.
`marketplace/src/` holds the HTML sources and `marketplace/build.sh` re-renders the gallery PNGs with
headless Chromium.

## Trademark note

Feed names and site names shown in the gallery (for example Hackaday) belong to their owners. This widget is independent and unaffiliated with any feed publisher.
