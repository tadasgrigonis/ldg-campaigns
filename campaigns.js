/*! ldg-campaigns | campaign banners and exit pop-ups for lodgify.com
 *
 * Webflow renders every published campaign (Campaigns collection) as a hidden
 * Collection Item. This script picks one campaign per visitor and wires the
 * behaviour HTML can't do: schedule, country, banner push-down and retract,
 * exit intent, countdown, click-to-copy and the lazy HubSpot form.
 * Contract: see README.md. Debug: add ?lddebug=1 to any page.
 */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.boot();
})(function () {
  'use strict';

  var VERSION = '0.3.0';

  var CFG = {
    tz: 'Europe/Madrid',                       // every date and time is Barcelona time
    stagingHosts: ['lodgifyintegration.com'],  // and their subdomains: Live off counts as on
    globalExcludes: [],                        // paths, same format as the Excluded pages field
    geoTtlMs: 24 * 3600e3,
    geoTimeoutMs: 1500,
    bannerDismissMs: 24 * 3600e3,              // banner close: hidden for this long, per campaign
    popupPauseMs: 7 * 24 * 3600e3,             // pop-up shown: not again for this long, per campaign
    exitArmMs: 3000,                           // exit intent ignored for the first 3 s
    exitTopPx: 8,
    retractAtPx: 10,                           // banner slides out past this scroll position
    returnAtPx: 0,                             // and back in at the very top
    animMs: 350,
    desktopQuery: '(min-width: 992px) and (hover: hover)',
    hubspot: { portalId: '589108', region: 'na1', src: 'https://js.hsforms.net/forms/embed/v2.js' }
  };

  /* ---------------------------------------------------------------------------
   * Pure helpers (unit-tested in test/campaigns.test.js)
   * ------------------------------------------------------------------------- */

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function ymd(y, mo, d) {
    y = +y; mo = +mo; d = +d;
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, mo: mo, d: d };
  }

  // Reads the date part only; the time comes from the Start time / End time fields.
  function parseDate(s) {
    s = String(s == null ? '' : s).trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);                    // 2026-10-19, ISO
    if (m) return ymd(m[1], m[2], m[3]);
    m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);          // October 19, 2026
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return ymd(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);          // 19 October 2026
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ymd(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);                       // 10/19/2026, US order
    if (m) return ymd(m[3], m[1], m[2]);
    return null;
  }

  function parseTime(s, fallback) {
    var m = String(s == null ? '' : s).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m || +m[1] > 23 || +m[2] > 59) return fallback;
    return { h: +m[1], mi: +m[2], s: 0 };
  }

  // Offset in ms between a time zone and UTC at a given instant (DST-aware via Intl).
  function tzOffsetMs(tz, date) {
    var p = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
  }

  // UTC epoch ms for a wall-clock time in a zone; the second pass settles DST edges.
  function wallTimeToUtc(y, mo, d, h, mi, s, tz) {
    var guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
    var off = tzOffsetMs(tz, new Date(guess));
    var res = guess - off;
    var off2 = tzOffsetMs(tz, new Date(res));
    if (off2 !== off) res = guess - off2;
    return res;
  }

  function startMoment(date, time, tz) {
    var t = parseTime(time, { h: 0, mi: 0, s: 0 });
    return wallTimeToUtc(date.y, date.mo, date.d, t.h, t.mi, t.s, tz);
  }

  function endMoment(date, time, tz) {
    var t = parseTime(time, { h: 23, mi: 59, s: 0 });        // empty means 23:59
    if (t.h === 23 && t.mi === 59) t.s = 59;                 // and 23:59 means the end of the day
    return wallTimeToUtc(date.y, date.mo, date.d, t.h, t.mi, t.s, tz);
  }

  function toBool(v) {
    if (v === true) return true;
    if (v === false || v == null) return false;
    return /^(true|1|yes|on|checked)$/i.test(String(v).trim());
  }

  function normPath(p) {
    p = String(p || '/').split(/[?#]/)[0].toLowerCase().replace(/\/+$/, '');
    return p.charAt(0) === '/' ? p : '/' + p;
  }

  // Splits the Excluded pages field: one path per line (commas also work).
  function parsePatterns(text) {
    return String(text || '').split(/[\n\r,]+/).map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) {
      var m = p.match(/^https?:\/\/[^/]+(\/.*)?$/i);
      if (m) p = m[1] || '/';
      return p.charAt(0) === '/' ? p : '/' + p;
    });
  }

  // A pattern that starts with a locale prefix (/es/*) matches the full path;
  // any other pattern (/pricing) matches the path with its locale prefix removed,
  // so it covers that page in every language. A trailing * covers a folder.
  function matchPath(patterns, fullPath, barePath, locales) {
    return patterns.some(function (raw) {
      var pat = raw.toLowerCase();
      var wild = /\*$/.test(pat);
      if (wild) pat = pat.replace(/\*+$/, '');
      pat = normPath(pat || '/');
      var first = pat.split('/')[1] || '';
      var target = locales.indexOf(first) !== -1 ? fullPath : barePath;
      if (!wild) return target === pat;
      return pat === '/' || target === pat || target.indexOf(pat + '/') === 0;
    });
  }

  function hostIsStaging(host, bases) {
    host = String(host || '').toLowerCase();
    return bases.some(function (b) { b = b.toLowerCase(); return host === b || host.slice(-(b.length + 1)) === '.' + b; });
  }

  var COUNTRY_FIX = { UK: 'GB' };
  function cleanCountry(c) {
    c = String(c || '').trim().toUpperCase();
    c = COUNTRY_FIX[c] || c;
    return /^[A-Z]{2}$/.test(c) ? c : null;
  }

  /* Chooses one campaign. ctx: { now, staging, country } where country is
   * undefined (not looked up yet), null (lookup failed) or an ISO code.
   * Returns { chosen, verdicts, needsCountry }. Excluded pages are applied
   * after the choice, so a page never shows a different offer. */
  function decide(items, ctx) {
    var verdicts = [], pool = [];
    items.forEach(function (it) {
      var why = !it.slug ? 'no slug'
        : it.error ? it.error
        : (!it.live && !ctx.staging) ? 'Live is off'
        : ctx.now < it.start ? 'starts later'
        : ctx.now >= it.end ? 'ended'
        : '';
      if (why) verdicts.push({ slug: it.slug, ok: false, why: why });
      else pool.push(it);
    });
    var needsCountry = pool.some(function (it) { return it.countries.length > 0; });
    if (needsCountry && ctx.country === undefined) return { chosen: null, verdicts: verdicts, needsCountry: true };
    var ok = [];
    pool.forEach(function (it) {
      if (!it.countries.length) ok.push(it);
      else if (!ctx.country) verdicts.push({ slug: it.slug, ok: false, why: 'country unknown' });
      else if (it.countries.indexOf(ctx.country) === -1) verdicts.push({ slug: it.slug, ok: false, why: 'targets ' + it.countries.join(', ') + ', not ' + ctx.country });
      else ok.push(it);
    });
    ok.sort(function (a, b) {
      var ra = a.countries.length ? 1 : 0, rb = b.countries.length ? 1 : 0;
      if (ra !== rb) return rb - ra;                       // regional beats global
      if (a.start !== b.start) return b.start - a.start;   // then the latest start
      return a.slug < b.slug ? -1 : 1;
    });
    ok.forEach(function (it, i) {
      verdicts.push({ slug: it.slug, ok: i === 0, why: i === 0 ? 'chosen' : 'lost to ' + ok[0].slug });
    });
    return { chosen: ok[0] || null, verdicts: verdicts, needsCountry: needsCountry };
  }

  /* ---------------------------------------------------------------------------
   * Browser side
   * ------------------------------------------------------------------------- */

  var memory = {};
  function store(kind) {
    return {
      get: function (k) { try { return window[kind].getItem(k); } catch (e) { return memory[kind + k] == null ? null : memory[kind + k]; } },
      set: function (k, v) { try { window[kind].setItem(k, v); } catch (e) { memory[kind + k] = String(v); } },
      del: function (k) { try { window[kind].removeItem(k); } catch (e) { delete memory[kind + k]; } }
    };
  }

  var local, session, debugOn = false, state = { version: VERSION };

  function log() {
    if (!debugOn) return;
    console.log.apply(console, ['[ldg]'].concat(Array.from(arguments)));
  }

  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent('ldg:' + name, { detail: detail }));
  }

  function toArray(list) { return Array.from(list || []); }

  // Elements hidden by Webflow conditional visibility stay in the HTML with this class.
  function rendered(node, root) {
    for (var n = node; n && n !== root; n = n.parentElement) {
      if (n.classList && n.classList.contains('w-condition-invisible')) return false;
    }
    return !!node;
  }

  function find(root, sel) {
    var all = toArray(root.querySelectorAll(sel));
    for (var i = 0; i < all.length; i++) if (rendered(all[i], root)) return all[i];
    return null;
  }

  function localePrefixes() {
    var set = {};
    toArray(document.querySelectorAll('link[rel="alternate"][hreflang]')).forEach(function (l) {
      try {
        var seg = new URL(l.href, location.href).pathname.split('/')[1] || '';
        if (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(seg)) set[seg.toLowerCase()] = 1;
      } catch (e) { /* ignore */ }
    });
    var lang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    var first = (location.pathname.split('/')[1] || '').toLowerCase();
    if (lang && first === lang) set[lang] = 1;
    return Object.keys(set);
  }

  function readItems() {
    return toArray(document.querySelectorAll('[data-campaign]')).map(function (el) {
      function attr(a) { return (el.getAttribute(a) || '').trim(); }
      var sd = parseDate(attr('data-campaign-start')), ed = parseDate(attr('data-campaign-end'));
      var countries = [], bad = [];
      toArray(el.querySelectorAll('[data-campaign-country]')).forEach(function (c) {
        var raw = (c.textContent || '').trim();
        if (!raw) return;
        var iso = cleanCountry(raw);
        if (iso) { if (countries.indexOf(iso) === -1) countries.push(iso); } else bad.push(raw);
      });
      var item = {
        el: el,
        slug: attr('data-campaign'),
        live: toBool(attr('data-campaign-live')),
        countries: countries,
        exclude: parsePatterns(attr('data-campaign-exclude')),
        raw: { start: attr('data-campaign-start'), end: attr('data-campaign-end'), startTime: attr('data-campaign-start-time'), endTime: attr('data-campaign-end-time') }
      };
      if (!sd || !ed) item.error = 'unreadable date (' + item.raw.start + ' / ' + item.raw.end + ')';
      else {
        item.start = startMoment(sd, item.raw.startTime, CFG.tz);
        item.end = endMoment(ed, item.raw.endTime, CFG.tz);
      }
      if (bad.length) item.badCountries = bad;
      return item;
    });
  }

  function getCountry(cb) {
    var forced = session.get('ldg_geo');
    if (forced) return cb(forced, 'ldgeo');
    try {
      var cached = JSON.parse(local.get('geo_country') || 'null');
      if (cached && cached.c) {
        // geo_country is a shared key: accept a timestamp in seconds too, in case another script writes it
        var t = +cached.t; if (t && t < 1e12) t *= 1000;
        if (t && Date.now() - t < CFG.geoTtlMs) return cb(cleanCountry(cached.c), 'cache');
      }
    } catch (e) { /* ignore a malformed cache */ }
    // A failed lookup is remembered for the session, so later pages don't wait for it again
    if (session.get('ldg_geo_failed')) return cb(null, 'failed earlier this session');
    var done = false;
    function finish(c, src) {
      if (done) return;
      done = true;
      if (!c) session.set('ldg_geo_failed', '1');
      cb(c, src);
    }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    setTimeout(function () { if (ctrl) ctrl.abort(); finish(null, 'timeout'); }, CFG.geoTimeoutMs);
    fetch('/cdn-cgi/trace', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) {
        var m = /(?:^|\n)loc=([A-Za-z0-9]{2})/.exec(txt);
        var c = m ? cleanCountry(m[1]) : null;
        if (c) local.set('geo_country', JSON.stringify({ c: c, t: Date.now() }));
        finish(c, c ? 'trace' : 'trace failed');
      })
      .catch(function () { finish(null, 'trace failed'); });
  }

  /* Banner: push-down, retract on scroll, close ---------------------------- */

  function startBanner(item, bar, opts) {
    var pushEls = toArray(document.querySelectorAll('[promo-banner="push-down"]'));
    var dur = CFG.animMs + 'ms cubic-bezier(.2,.7,.2,1)';
    var visible = false, closed = false, ticking = false, height = 0;

    function y() { return window.scrollY || document.documentElement.scrollTop || 0; }
    function offset(px, animate) {
      pushEls.forEach(function (el) {
        el.style.transition = animate ? 'margin-top ' + dur : 'none';
        el.style.setProperty('margin-top', px + 'px', 'important');
      });
    }
    // Runs only when the banner slides in or out, not on every scroll frame
    function place(on, animate) {
      bar.style.transition = animate ? 'transform ' + dur + ', opacity ' + dur : 'none';
      bar.style.transform = on ? 'translateY(0)' : 'translateY(-100%)';
      bar.style.opacity = on ? '1' : '0';
      bar.style.pointerEvents = on ? '' : 'none';
      if (on) height = bar.offsetHeight;
      offset(on ? height : 0, animate);
      if (on !== visible) { visible = on; emit('banner', { visible: on, campaign: item.slug }); }
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        if (closed) return;
        var pos = y();
        if (visible && pos > CFG.retractAtPx) place(false, true);
        else if (!visible && pos <= CFG.returnAtPx) place(true, true);
      });
    }
    // The banner's height changes with the window width, and when web fonts load or the text wraps:
    // keep the push-down equal to it. Unchanged heights are ignored, so the slide-in isn't cut short.
    function onResize() {
      if (!visible || closed) return;
      var h = bar.offsetHeight;
      if (h !== height) { height = h; offset(h, false); }
    }
    var watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    function unwatch() {
      window.removeEventListener('scroll', onScroll);
      if (watcher) watcher.disconnect(); else window.removeEventListener('resize', onResize);
    }

    bar.style.display = '';
    place(false, false);
    void bar.offsetHeight;                                   // commit the hidden state so the slide-in animates
    if (y() <= CFG.retractAtPx) requestAnimationFrame(function () { place(true, true); });
    window.addEventListener('scroll', onScroll, { passive: true });
    if (watcher) watcher.observe(bar); else window.addEventListener('resize', onResize);

    return {
      close: function () {
        if (closed) return;
        closed = true;
        place(false, true);
        if (!opts.preview) local.set('ldg_bar_' + item.slug, String(Date.now()));
        setTimeout(function () { bar.style.display = 'none'; }, CFG.animMs + 30);
        unwatch();
        emit('banner_close', { campaign: item.slug });
      },
      stop: function () {
        if (closed) return;
        closed = true;
        place(false, true);
        unwatch();
      }
    };
  }

  /* Pop-up: exit intent, dialog behaviour, HubSpot form --------------------- */

  // Loads the HubSpot forms script once, reusing a copy the page already has or is loading.
  var hsWaiting = null;
  function loadHubspot(cb) {
    if (window.hbspt && window.hbspt.forms) return cb();
    if (hsWaiting) { hsWaiting.push(cb); return; }
    hsWaiting = [cb];
    var s = document.querySelector('script[src*="hsforms.net/forms/"]');
    if (!s) {
      s = document.createElement('script');
      s.src = CFG.hubspot.src;
      s.async = true;
      document.head.appendChild(s);
    }
    s.addEventListener('load', function () {
      var q = hsWaiting || [];
      hsWaiting = null;
      q.forEach(function (f) { f(); });
    });
    s.addEventListener('error', function () { hsWaiting = null; log('HubSpot script failed to load'); });
  }

  function mountForm(item, popup) {
    var box = find(popup, '[data-campaign-form]');
    if (!box || box.getAttribute('data-campaign-mounted')) return;
    var formId = (box.getAttribute('data-campaign-hs-form') || '').trim();
    if (!formId) { log('no HubSpot form ID on', item.slug); return; }
    box.setAttribute('data-campaign-mounted', '1');
    if (!box.id) box.id = 'ldg-form-' + item.slug;
    loadHubspot(function () {
      if (!window.hbspt || !window.hbspt.forms) { log('HubSpot forms unavailable'); return; }
      window.hbspt.forms.create({
        region: CFG.hubspot.region, portalId: CFG.hubspot.portalId, formId: formId, target: '#' + box.id,
        onFormSubmitted: function () { emit('submit', { campaign: item.slug }); }
      });
    });
  }

  // iframe: a standard HubSpot embed renders the form inside one
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

  // popup = the overlay ([data-campaign-dialog]); dialog = the panel inside it ([data-campaign-panel])
  function createPopup(item, popup, opts) {
    var dialog = find(popup, '[data-campaign-panel]') || popup;
    var title = find(popup, '[data-campaign-title]');
    var lastFocus = null, isOpen = false, onOut = null;

    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('tabindex', '-1');
    if (title) {
      if (!title.id) title.id = 'ldg-title-' + item.slug;
      dialog.setAttribute('aria-labelledby', title.id);
    }

    function focusables() {
      return toArray(dialog.querySelectorAll(FOCUSABLE)).filter(function (el) { return rendered(el, dialog) && el.offsetParent !== null; });
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) { e.preventDefault(); dialog.focus(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function onBackdrop(e) { if (e.target === popup) close(); }
    // Tab out of an iframe (the HubSpot form) skips onKey, so catch focus that lands outside the dialog
    function onFocusIn(e) {
      if (dialog.contains(e.target)) return;
      var f = focusables();
      (f[0] || dialog).focus();
    }

    function disarm() {
      if (onOut) document.removeEventListener('mouseout', onOut);
      onOut = null;
    }
    function open() {
      if (isOpen) return;
      isOpen = true;
      disarm();
      // Any exit counts (close, CTA, form, leaving the page): both caps start when the pop-up shows
      if (!opts.preview) {
        session.set('ldg_popup_session', item.slug);
        local.set('ldg_popup_' + item.slug, String(Date.now()));
      }
      lastFocus = document.activeElement;
      popup.style.display = '';                                // back to the display its class gives it
      mountForm(item, popup);
      var f = focusables();
      (f[0] || dialog).focus();
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('focusin', onFocusIn);
      popup.addEventListener('click', onBackdrop);
      emit('popup_open', { campaign: item.slug });
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      popup.style.display = 'none';
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
      popup.removeEventListener('click', onBackdrop);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      emit('popup_close', { campaign: item.slug });
    }

    // Returns true when the pop-up is armed (or opened, in preview)
    function arm() {
      if (opts.preview) { open(); return true; }
      var why = '';
      if (!window.matchMedia(CFG.desktopQuery).matches) why = 'not a desktop';
      else if (session.get('ldg_popup_session')) why = 'already shown this session';
      else {
        var shownAt = +local.get('ldg_popup_' + item.slug) || 0;
        if (shownAt && Date.now() - shownAt < CFG.popupPauseMs) why = 'shown within the last 7 days';
      }
      if (why) { log('pop-up not armed:', why); return false; }
      var armedAt = Date.now() + CFG.exitArmMs;
      onOut = function (e) {
        if (Date.now() < armedAt || e.relatedTarget) return;
        if (e.clientY > CFG.exitTopPx) return;
        open();
      };
      document.addEventListener('mouseout', onOut);
      log('pop-up armed for exit intent');
      return true;
    }
    // Campaign ended: no exit intent from now on, and close it if it's open
    function stop() { disarm(); close(); }

    popup.style.display = 'none';                              // closed until exit intent
    return { arm: arm, open: open, close: close, stop: stop };
  }

  /* Countdown and copy ------------------------------------------------------ */

  function startCountdown(item, onEnd) {
    var units = { days: [], hours: [], minutes: [], seconds: [] };
    toArray(item.el.querySelectorAll('[data-campaign-countdown]')).forEach(function (el) {
      var u = el.getAttribute('data-campaign-countdown');
      if (units[u]) units[u].push(el);
    });
    function set(u, n) { units[u].forEach(function (el) { el.textContent = n < 10 ? '0' + n : String(n); }); }
    var timer = null;
    function tick() {
      var diff = item.end - Date.now();
      if (diff <= 0) {
        set('days', 0); set('hours', 0); set('minutes', 0); set('seconds', 0);
        clearInterval(timer);
        onEnd();
        return;
      }
      var s = Math.floor(diff / 1000);
      set('days', Math.floor(s / 86400));
      set('hours', Math.floor((s % 86400) / 3600));
      set('minutes', Math.floor((s % 3600) / 60));
      set('seconds', s % 60);
    }
    tick();
    if (Date.now() < item.end) timer = setInterval(tick, 1000);
    return function stop() { clearInterval(timer); };
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  /* Showing the chosen campaign --------------------------------------------- */

  function show(item, opts) {
    var el = item.el;
    var bar = find(el, '[data-campaign-bar]');
    var popupEl = find(el, '[data-campaign-dialog]');
    var popup = popupEl ? createPopup(item, popupEl, opts) : null;
    toArray(el.querySelectorAll('[data-campaign-copied]')).forEach(function (l) { l.style.display = 'none'; });

    var barDismissed = false;
    if (bar && !opts.preview) {
      var closedAt = +local.get('ldg_bar_' + item.slug) || 0;
      barDismissed = closedAt && Date.now() - closedAt < CFG.bannerDismissMs;
    }
    if (bar && barDismissed) bar.style.display = 'none';

    el.removeAttribute('data-hide-live');
    var banner = bar && !barDismissed ? startBanner(item, bar, opts) : null;
    var bannerLive = !!banner, popupLive = false, stopCountdown = null;
    // Once the banner is closed and the pop-up is closed or never armed, nothing needs the countdown
    function settle() { if (!bannerLive && !popupLive && stopCountdown) stopCountdown(); }

    el.addEventListener('click', function (e) {
      var close = e.target.closest('[data-campaign-close]');
      if (close && el.contains(close)) {
        e.preventDefault();
        if (popupEl && popupEl.contains(close)) { if (popup) popup.close(); }
        else if (banner) { banner.close(); bannerLive = false; settle(); }
        return;
      }
      var copy = e.target.closest('[data-campaign-copy]');
      if (copy && el.contains(copy)) {
        e.preventDefault();
        var codeEl = copy.querySelector('[data-campaign-code]');
        if (!codeEl) {                                         // no code element: read the module without its Copied label
          codeEl = copy.cloneNode(true);
          toArray(codeEl.querySelectorAll('[data-campaign-copied]')).forEach(function (n) { n.remove(); });
        }
        var code = codeEl.textContent.trim();
        var label = copy.querySelector('[data-campaign-copied]');
        copyText(code).then(function () {
          if (label) {
            label.style.display = '';
            clearTimeout(label.ldgTimer);                      // a second click restarts the 2 s
            label.ldgTimer = setTimeout(function () { label.style.display = 'none'; }, 2000);
          }
          emit('copy', { campaign: item.slug });
        }).catch(function () { log('copy failed'); });
      }
    });

    // However the pop-up closes (button, Escape, backdrop), it won't open again on this page
    if (popup) document.addEventListener('ldg:popup_close', function (e) {
      if (e.detail && e.detail.campaign === item.slug) { popupLive = false; settle(); }
    });

    stopCountdown = startCountdown(item, function () {
      if (opts.preview) return;                                // preview keeps showing an ended campaign
      log('campaign ended:', item.slug);
      if (banner) banner.stop();
      if (popup) popup.stop();
      el.setAttribute('data-hide-live', '');
      emit('end', { campaign: item.slug });
    });

    if (popup) popupLive = popup.arm();
    settle();
    emit('show', { campaign: item.slug, banner: !!banner, popup: !!popup });
  }

  /* Boot --------------------------------------------------------------------- */

  function debugTable(items, result, extra) {
    if (!debugOn) return;
    var byslug = {};
    result.verdicts.forEach(function (v) { byslug[v.slug] = v.why; });
    console.groupCollapsed('[ldg] ' + VERSION + ' · ' + (result.chosen ? 'showing ' + result.chosen.slug : 'nothing to show'));
    console.table(items.map(function (it) {
      return {
        campaign: it.slug,
        live: it.live,
        starts: it.start ? new Date(it.start).toISOString() : it.raw.start,
        ends: it.end ? new Date(it.end).toISOString() : it.raw.end,
        countries: it.countries.join(' ') + (it.badCountries ? ' (bad: ' + it.badCountries.join(' ') + ')' : ''),
        exclude: it.exclude.join(' '),
        verdict: byslug[it.slug] || ''
      };
    }));
    console.log(extra);
    console.groupEnd();
  }

  function run() {
    var params = new URLSearchParams(location.search);
    local = store('localStorage');
    session = store('sessionStorage');
    debugOn = params.get('lddebug') === '1';

    if (params.get('ldoff') === '1') session.set('ldg_off', '1');
    if (params.get('ldoff') === '0') session.del('ldg_off');
    if (params.get('ldreset') === '1') {
      ['geo_country'].forEach(local.del);
      ['ldg_geo', 'ldg_geo_failed', 'ldg_popup_session', 'ldg_off'].forEach(session.del);
      try {
        Object.keys(window.localStorage).forEach(function (k) { if (/^ldg_(bar|popup)_/.test(k)) local.del(k); });
      } catch (e) { /* storage blocked */ }
      log('reset done');
    }
    var geoParam = cleanCountry(params.get('ldgeo'));
    if (geoParam) session.set('ldg_geo', geoParam);

    window.ldg = state;
    if (session.get('ldg_off') === '1') { log('off for this session (?ldoff=0 turns it back on)'); return; }

    var items = readItems();
    if (!items.length) { log('no campaigns on this page'); return; }

    var locales = localePrefixes();
    var fullPath = normPath(location.pathname);
    var first = fullPath.split('/')[1] || '';
    var barePath = locales.indexOf(first) !== -1 ? normPath(fullPath.slice(first.length + 1) || '/') : fullPath;
    var staging = hostIsStaging(location.hostname, CFG.stagingHosts);
    var ctx = { now: Date.now(), staging: staging, country: undefined };

    var previewSlug = params.get('ldpreview');
    if (previewSlug) {
      var forced = items.find(function (it) { return it.slug === previewSlug; });
      if (forced && !forced.error) {
        state.campaign = forced.slug;
        state.preview = true;
        log('preview:', forced.slug);
        show(forced, { preview: true });
        return;
      }
      log('preview: no campaign with slug', previewSlug, forced && forced.error ? '(' + forced.error + ')' : '');
    }

    function finish(result, country, source) {
      state.country = country || null;
      var chosen = result.chosen;
      var where = { page: fullPath, bare: barePath, locales: locales, staging: staging, country: country, countrySource: source };
      if (chosen) {
        var patterns = chosen.exclude.concat(CFG.globalExcludes);
        if (matchPath(patterns, fullPath, barePath, locales)) {
          result.verdicts.forEach(function (v) { if (v.slug === chosen.slug) v.why = 'chosen, but this page is excluded'; });
          debugTable(items, result, where);
          state.campaign = chosen.slug;
          state.excluded = true;
          return;
        }
        state.campaign = chosen.slug;
        debugTable(items, result, where);
        show(chosen, { preview: false });
      } else {
        state.campaign = null;
        debugTable(items, result, where);
      }
    }

    var first0 = decide(items, ctx);
    if (!first0.needsCountry) return finish(first0, session.get('ldg_geo') || null, 'not needed');
    getCountry(function (country, source) {
      ctx.country = country;
      finish(decide(items, ctx), country, source);
    });
  }

  function boot() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  return {
    VERSION: VERSION, CFG: CFG, boot: boot,
    parseDate: parseDate, parseTime: parseTime, wallTimeToUtc: wallTimeToUtc, startMoment: startMoment, endMoment: endMoment,
    toBool: toBool, normPath: normPath, parsePatterns: parsePatterns, matchPath: matchPath,
    hostIsStaging: hostIsStaging, cleanCountry: cleanCountry, decide: decide
  };
});
