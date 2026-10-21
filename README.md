# ldg-campaigns

Campaign banners and exit pop-ups for lodgify.com (Webflow).

Webflow renders every published item of the Campaigns collection as a hidden Collection Item inside the global Campaigns component. `campaigns.js` picks one campaign per visitor and adds what HTML can't: schedule (Barcelona time), country, bar push-down and retract, exit intent, countdown, click-to-copy and the lazy HubSpot form. It writes no content and no styles.

During development the repo is served by GitHub Pages and loaded only on the WIP page (webflow-mkt.lodgifyintegration.com/tracking-testing) through a dev loader. At go-live the script moves into Lodgify's Webflow site settings and the source into a Lodgify repository.

## Attribute contract

Classes follow Client-First with the `campaigns_` prefix (`campaigns_item`, `campaigns_bar`, `campaigns_dialog`, ...); the script never reads them. It reads only these attributes:

| Attribute | On | Script |
| --- | --- | --- |
| `data-hide-live` | Collection Item | Removed from the chosen item to show it |
| `data-campaign` | Collection Item, bound to Slug | Campaign key for preview, storage and debug |
| `data-campaign-live`, `data-campaign-start`, `data-campaign-start-time`, `data-campaign-end`, `data-campaign-end-time`, `data-campaign-exclude` | Collection Item, bound | Rules |
| `data-campaign-country` | Hidden text bound to Country: ISO code | Country code; empty means global |
| `data-campaign-bar` | Bar, fixed to the top | Slides in, retracts on scroll, closes |
| `promo-banner="push-down"` | Nav, hero and anything the bar covers | Pushed down by the bar's height while it shows |
| `data-campaign-dialog` | Dialog overlay, styled as open | Kept closed until exit intent; backdrop click closes |
| `data-campaign-panel`, `data-campaign-title` | Dialog panel and its title | Dialog role, label, focus trap, Escape |
| `data-campaign-close` | Close buttons in the bar and the dialog | Bar: hidden 24 h for that campaign. Dialog: closes |
| `data-campaign-copy`, `data-campaign-code`, `data-campaign-copied` | Copy module, the code text, the Copied label | Copies the code (without the label), shows the label for 2 s |
| `data-campaign-countdown="days" / "hours" / "minutes" / "seconds"` | Countdown numbers | Updated every second; campaign hides at zero |
| `data-campaign-form`, `data-campaign-hs-form` | Form container, bound to HubSpot form ID | HubSpot form mounted when the dialog opens |

Elements hidden by Webflow conditional visibility (`w-condition-invisible`) are ignored. Style everything as it looks when visible; the script hides what starts hidden (the dialog, the Copied label).

The dialog opens on exit intent on desktop only, at most once per session, and not again for 7 days once it has shown, however the visitor leaves it. Keyboard focus stays inside it, including a HubSpot form rendered in an iframe. When a campaign ends while the page is open, its bar and dialog hide and exit intent stops.

## URL parameters

| Parameter | Effect |
| --- | --- |
| `?ldpreview=slug` | Show that campaign now, ignoring Live, dates, country and frequency, and open its dialog |
| `?ldgeo=DE` | Treat the visitor as German for this session |
| `?lddebug=1` | Log every campaign and why it was or wasn't chosen |
| `?ldreset=1` | Clear dismissals, frequency state, the geo cache and a remembered geo failure |
| `?ldoff=1` / `?ldoff=0` | Turn the script off / on for this session |

On staging hosts (`*.lodgifyintegration.com`) campaigns with Live off count as on.

The country comes from `/cdn-cgi/trace`, only when a regional campaign is running, and is cached for 24 h. A failed lookup is remembered for the session, so later pages show global campaigns without waiting again.

## Events

The script fires `ldg:show`, `ldg:banner` (`detail.visible`), `ldg:banner_close`, `ldg:popup_open`, `ldg:popup_close`, `ldg:copy`, `ldg:submit` and `ldg:end` on `document`. `window.ldg` holds `{ version, country, campaign }`.

## Tests

```
node test/campaigns.test.js        # dates, Barcelona time, paths, selection
python3 test/browser_test.py       # bar, dialog, focus, HubSpot, copy, geo, countdown (Playwright)
```

`test/fixture.html` is a static page with the contract, for manual or browser checks (`test/fixture.html?ldgeo=ES&lddebug=1`).

## Naming

Webflow-facing names (classes, attributes) use `campaigns_` / `data-campaign-`, and bar and dialog rather than banner and popup, which ad blockers hide. Code-facing names keep the short `ldg` namespace so they don't clash with other scripts: `window.ldg`, the `ldg:*` events, the `ldg_*` storage keys and the `?ld*` URL parameters.
