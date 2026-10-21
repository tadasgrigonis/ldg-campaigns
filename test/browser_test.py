"""Browser checks for campaigns.js. Run: python3 test/browser_test.py (needs Playwright + Chromium). Serves the repo at http://localhost:9999 through Playwright routes."""
import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright

REPO = pathlib.Path(__file__).resolve().parent.parent
BASE = 'http://localhost:9999/test/fixture.html'
results = []

def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (('  ' + str(info)) if info else ''))

async def setup(ctx, trace='hang', hs_delay=0):
    state = {'hs_loads': 0}
    async def handler(route):
        url = route.request.url
        if '/cdn-cgi/trace' in url:
            if trace == 'hang':
                return  # never answer: the script's 1.5 s timeout has to kick in
            if trace == 'fail':
                return await route.abort()
            return await route.fulfill(body='fl=1\nloc=%s\n' % trace, content_type='text/plain')
        if 'hsforms.net' in url:
            state['hs_loads'] += 1
            if hs_delay: await asyncio.sleep(hs_delay)
            return await route.fulfill(content_type='application/javascript', body="""
              window.hsCreates = (window.hsCreates || 0);
              window.hbspt = { forms: { create: function (o) { window.hsCreates++; var t = document.querySelector(o.target);
                var f = document.createElement('iframe'); f.className = 'hs-form-iframe'; f.style.height = '40px'; t.appendChild(f); } } };""")
        path = url.split('localhost:9999/', 1)[1].split('?')[0]
        f = REPO / path
        if f.exists():
            ctype = 'text/html' if path.endswith('.html') else 'application/javascript'
            return await route.fulfill(body=f.read_bytes(), content_type=ctype)
        return await route.fulfill(status=404, body='')
    await ctx.route('**/*', handler)
    return state

async def exit_intent(p):
    await p.mouse.move(600, 300)
    await p.evaluate("document.dispatchEvent(new MouseEvent('mouseout', {clientY: 2, relatedTarget: null, bubbles: true}))")

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        errors = []

        # 1. Expired campaign: exit intent after the end must not open the pop-up or swallow Tab
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        await setup(ctx)
        p = await ctx.new_page(); p.on('pageerror', lambda e: errors.append(str(e)))
        await p.clock.install(time='2026-12-31T22:59:50Z')        # 23:59:50 in Barcelona, global ends 23:59:59
        await p.goto(BASE + '?ldgeo=US')
        await p.clock.run_for(4000)
        check('global campaign shows before the end', await p.evaluate("!document.querySelector('[data-ldg-campaign=\"test-global\"]').hasAttribute('data-hide-live')"))
        await p.clock.run_for(8000)                                 # past the end
        check('campaign hidden after the end', await p.evaluate("document.querySelector('[data-ldg-campaign=\"test-global\"]').hasAttribute('data-hide-live')"))
        await exit_intent(p)
        check('no pop-up session flag after the end', await p.evaluate("sessionStorage.getItem('ldg_popup_session')") is None)
        await p.evaluate("document.body.insertAdjacentHTML('afterbegin', '<a id=\"t1\" href=\"#\">one</a><a id=\"t2\" href=\"#\">two</a>'); document.getElementById('t1').focus()")
        await p.keyboard.press('Tab')
        check('Tab still works on the page', await p.evaluate("document.activeElement.id") == 't2', await p.evaluate("document.activeElement.id || document.activeElement.tagName"))
        await ctx.close()

        # 2. Pause starts when the pop-up opens; HubSpot loads once; iframe is reachable; focus stays in the dialog
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        hs = await setup(ctx, hs_delay=0.5)
        p = await ctx.new_page(); p.on('pageerror', lambda e: errors.append(str(e)))
        await p.goto(BASE + '?ldgeo=US')
        await p.evaluate("""() => {
          const s = document.createElement('script'); s.src = 'https://js.hsforms.net/forms/embed/v2.js'; s.async = true; document.head.appendChild(s);
          document.querySelector('[data-ldg-campaign="test-global"] [data-ldg-dialog]').insertAdjacentHTML('beforeend', '<div data-ldg-form data-ldg-hs-form="abc"></div>');
          document.body.insertAdjacentHTML('beforeend', '<a id="outside" href="#">outside</a>');
        }""")
        await p.wait_for_timeout(3200)
        await exit_intent(p)
        await p.wait_for_timeout(100)
        check('pop-up opens on exit intent', await p.evaluate("getComputedStyle(document.querySelector('[data-ldg-campaign=\"test-global\"] [data-ldg-popup]')).display") != 'none')
        check('7-day pause set on open, before any close', await p.evaluate("localStorage.getItem('ldg_popup_test-global')") is not None)
        await p.wait_for_timeout(900)
        check('HubSpot script requested once', hs['hs_loads'] == 1, hs['hs_loads'])
        check('one HubSpot script tag', await p.evaluate("document.querySelectorAll('script[src*=\"hsforms.net\"]').length") == 1)
        check('form created once', await p.evaluate("window.hsCreates") == 1, await p.evaluate("window.hsCreates"))
        # Tab order: CTA, Close, iframe
        await p.evaluate("document.querySelector('[data-ldg-campaign=\"test-global\"] [data-ldg-popup] button').focus()")
        await p.keyboard.press('Tab')
        check('Tab reaches the HubSpot iframe', await p.evaluate("document.activeElement.className") == 'hs-form-iframe', await p.evaluate("document.activeElement.tagName"))
        await p.evaluate("document.getElementById('outside').focus()")
        check('focus pulled back into the dialog', await p.evaluate("!!document.activeElement.closest('[data-ldg-dialog]')"), await p.evaluate("document.activeElement.textContent"))
        await p.keyboard.press('Escape')
        check('Escape closes', await p.evaluate("getComputedStyle(document.querySelector('[data-ldg-campaign=\"test-global\"] [data-ldg-popup]')).display") == 'none')
        await p.goto(BASE + '?ldgeo=US&lddebug=1')
        logs = []
        p.on('console', lambda m: logs.append(m.text))
        await p.reload(); await p.wait_for_timeout(300)
        check('not armed again (session and 7-day pause)', any('not armed' in l for l in logs), [l for l in logs if 'armed' in l])

        # 3. ResizeObserver: banner height change moves the nav
        await p.evaluate("localStorage.clear(); sessionStorage.clear()")
        await p.goto(BASE + '?ldgeo=US'); await p.wait_for_timeout(600)
        before = await p.evaluate("getComputedStyle(document.querySelector('.nav')).marginTop")
        await p.evaluate("document.querySelector('[data-ldg-campaign=\"test-global\"] [data-ldg-bar]').style.height = '72px'")
        await p.wait_for_timeout(200)
        after = await p.evaluate("getComputedStyle(document.querySelector('.nav')).marginTop")
        check('push-down follows the banner height', before == '40px' and after == '72px', (before, after))

        # 4. Copy without a code element skips the Copied label; repeat clicks restart the timer
        await p.evaluate("""() => {
          window.__copied = [];
          navigator.clipboard.writeText = t => { window.__copied.push(t); return Promise.resolve(); };
          const c = document.querySelector('[data-ldg-code]'); c.replaceWith(document.createTextNode(c.textContent));
        }""")
        await p.click('text=TESTGLOBAL'); await p.wait_for_timeout(1500)
        await p.click('text=TESTGLOBAL'); await p.wait_for_timeout(1000)
        check('copies the code only', await p.evaluate("window.__copied[0]") == 'TESTGLOBAL', await p.evaluate("window.__copied"))
        check('label still shown 2.5 s after the first click', await p.evaluate("getComputedStyle(document.querySelector('[data-ldg-copied]')).display") != 'none')
        await ctx.close()

        # 5. Failed geo lookup is remembered for the session
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        await setup(ctx, trace='hang')
        p = await ctx.new_page(); p.on('pageerror', lambda e: errors.append(str(e)))
        await p.goto(BASE); await p.wait_for_timeout(1800)
        check('global shows after the trace timeout', await p.evaluate("window.ldg.campaign") == 'test-global')
        check('failure remembered', await p.evaluate("sessionStorage.getItem('ldg_geo_failed')") == '1')
        await p.goto(BASE); await p.wait_for_timeout(200)
        check('next page decides without waiting', await p.evaluate("window.ldg.campaign") == 'test-global')
        await p.goto(BASE + '?ldreset=1'); await p.wait_for_timeout(100)
        check('ldreset clears the failure', await p.evaluate("sessionStorage.getItem('ldg_geo_failed')") is None)
        await ctx.close()

        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        await setup(ctx, trace='ES')
        p = await ctx.new_page(); p.on('pageerror', lambda e: errors.append(str(e)))
        await p.goto(BASE); await p.wait_for_timeout(400)
        check('trace answer picks the Spain campaign', await p.evaluate("window.ldg.campaign") == 'test-spain', await p.evaluate("window.ldg"))
        await ctx.close()

        # 6. Countdown stops once nothing is live (tablet width: no pop-up; banner closed)
        ctx = await b.new_context(viewport={'width': 800, 'height': 800})
        await setup(ctx)
        p = await ctx.new_page(); p.on('pageerror', lambda e: errors.append(str(e)))
        await p.goto(BASE + '?ldgeo=US'); await p.wait_for_timeout(600)
        sec = "document.querySelector('[data-ldg-campaign=\"test-global\"] [data-countdown=\"seconds\"]').textContent"
        a = await p.evaluate(sec); await p.wait_for_timeout(1100); b2 = await p.evaluate(sec)
        check('countdown ticks while the banner shows', a != b2, (a, b2))
        await p.click('text=Close banner'); await p.wait_for_timeout(100)
        a = await p.evaluate(sec); await p.wait_for_timeout(2100); b2 = await p.evaluate(sec)
        check('countdown stops after the banner closes', a == b2, (a, b2))
        await ctx.close()

        # 7. Preview of an ended campaign still shows; ldoff still works
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        await setup(ctx)
        p = await ctx.new_page(); p.on('pageerror', lambda e: errors.append(str(e)))
        await p.goto(BASE + '?ldpreview=test-ended'); await p.wait_for_timeout(400)
        check('preview shows an ended campaign', await p.evaluate("!document.querySelector('[data-ldg-campaign=\"test-ended\"]').hasAttribute('data-hide-live')"))
        await p.goto(BASE + '?ldoff=1&ldgeo=US'); await p.wait_for_timeout(300)
        check('ldoff turns it off', await p.evaluate("[...document.querySelectorAll('[data-ldg-campaign]:not([data-hide-live])')].length") == 0)
        await ctx.close()

        check('no page errors', not errors, errors)
        await b.close()
    failed = [n for n, ok in results if not ok]
    print('\n%d/%d passed' % (len(results) - len(failed), len(results)))
    sys.exit(1 if failed else 0)

asyncio.run(main())
