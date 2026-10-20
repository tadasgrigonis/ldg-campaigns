# ldg-campaigns

Campaign banners and exit pop-ups for lodgify.com (Webflow).

Webflow renders every published item of the Campaigns collection as a hidden Collection Item inside the global Campaigns component. `campaigns.js` picks one campaign per visitor and adds what HTML can't: schedule (Barcelona time), country, banner push-down and retract, exit intent, countdown, click-to-copy and the lazy HubSpot form. It writes no content and no styles.

During development the repo is served by GitHub Pages and loaded only on the WIP page (webflow-mkt.lodgifyintegration.com/tracking-testing) through a dev loader. At go-live the script moves into Lodgify's Webflow site settings and the source into a Lodgify repository.

## Attribute contract

| Attribute | On | Script |
| --- | --- | --- |
| `data-hide-live` | Collection Item | Removed from the chosen item to show it |
| `data-ldg-campaign` | Collection Item, bound to Slug | Campaign key for preview, storage and debug |
| `data-ldg-live`, `data-ldg-start`, `data-ldg-start-time`, `data-ldg-end`, `data-ldg-end-time`, `data-ldg-exclude` | Collection Item, bound | Rules |
| `data-ldg-country` | Five hidden texts bound to Country N: ISO code | Country codes; empty ones ignored |
| `data-ldg-bar` | Banner block, fixed to the top | Slides in, retracts on scroll, closes |
| `promo-banner="push-down"` | Nav, hero and anything the banner covers | Pushed down by the banner's height while it shows |
| `data-ldg-popup` | Pop-up overlay, styled as open | Kept closed until exit intent; backdrop click closes |
| `data-ldg-dialog`, `data-ldg-title` | Pop-up panel and title | Dialog role, label, focus trap, Escape |
| `data-ldg-close` | Close buttons in banner and pop-up | Banner: hidden 24 h for that campaign. Pop-up: 7-day pause |
| `data-ldg-copy`, `data-ldg-code`, `data-ldg-copied` | Copy module, the code text, the Copied label | Copies the code, shows the label for 2 s |
| `data-countdown="days" / "hours" / "minutes" / "seconds"` | Countdown digits | Updated every second; campaign hides at zero |
| `data-ldg-form`, `data-ldg-hs-form` | Form container, bound to HubSpot form ID | HubSpot form mounted when the pop-up opens |

Elements hidden by Webflow conditional visibility (`w-condition-invisible`) are ignored. Style everything as it looks when visible; the script hides what starts hidden (the pop-up, the Copied label).

## URL parameters

| Parameter | Effect |
| --- | --- |
| `?ldpreview=slug` | Show that campaign now, ignoring Live, dates, country and frequency, and open its pop-up |
| `?ldgeo=DE` | Treat the visitor as German for this session |
| `?lddebug=1` | Log every campaign and why it was or wasn't chosen |
| `?ldreset=1` | Clear dismissals, frequency state and the geo cache |
| `?ldoff=1` / `?ldoff=0` | Turn the script off / on for this session |

On staging hosts (`*.lodgifyintegration.com`) campaigns with Live off count as on.

## Events

The script fires `ldg:show`, `ldg:banner` (`detail.visible`), `ldg:banner_close`, `ldg:popup_open`, `ldg:popup_close`, `ldg:copy`, `ldg:submit` and `ldg:end` on `document`. `window.ldg` holds `{ version, country, campaign }`.

## Tests

```
node test/campaigns.test.js        # dates, Barcelona time, paths, selection
```

`test/fixture.html` is a static page with the contract, for manual or browser checks (`test/fixture.html?ldgeo=ES&lddebug=1`).
