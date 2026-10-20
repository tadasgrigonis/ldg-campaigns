// Run: node test/campaigns.test.js
'use strict';
var assert = require('assert');
var L = require('../campaigns.js');

var passed = 0;
function t(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; }
}
var TZ = 'Europe/Madrid';
var iso = function (ms) { return new Date(ms).toISOString(); };

/* Dates and times */
t('parseDate ISO', function () { assert.deepStrictEqual(L.parseDate('2026-10-19'), { y: 2026, mo: 10, d: 19 }); });
t('parseDate ISO with time', function () { assert.deepStrictEqual(L.parseDate('2026-10-19T00:00:00.000Z'), { y: 2026, mo: 10, d: 19 }); });
t('parseDate month name', function () { assert.deepStrictEqual(L.parseDate('October 19, 2026'), { y: 2026, mo: 10, d: 19 }); });
t('parseDate short month', function () { assert.deepStrictEqual(L.parseDate('Sep 3, 2026'), { y: 2026, mo: 9, d: 3 }); });
t('parseDate day first', function () { assert.deepStrictEqual(L.parseDate('19 October 2026'), { y: 2026, mo: 10, d: 19 }); });
t('parseDate US numeric', function () { assert.deepStrictEqual(L.parseDate('10/19/2026'), { y: 2026, mo: 10, d: 19 }); });
t('parseDate rejects junk', function () { assert.strictEqual(L.parseDate(''), null); assert.strictEqual(L.parseDate('soon'), null); assert.strictEqual(L.parseDate('2026-13-01'), null); });
t('parseTime', function () {
  assert.deepStrictEqual(L.parseTime('09:00', null), { h: 9, mi: 0, s: 0 });
  assert.strictEqual(L.parseTime('', 'fb'), 'fb');
  assert.strictEqual(L.parseTime('25:00', 'fb'), 'fb');
});

/* Barcelona time */
t('winter end of day', function () { assert.strictEqual(iso(L.endMoment({ y: 2026, mo: 12, d: 7 }, '', TZ)), '2026-12-07T22:59:59.000Z'); });
t('23:59 means end of day', function () { assert.strictEqual(iso(L.endMoment({ y: 2026, mo: 12, d: 7 }, '23:59', TZ)), '2026-12-07T22:59:59.000Z'); });
t('summer start default 00:00', function () { assert.strictEqual(iso(L.startMoment({ y: 2026, mo: 7, d: 1 }, '', TZ)), '2026-06-30T22:00:00.000Z'); });
t('start time option', function () { assert.strictEqual(iso(L.startMoment({ y: 2026, mo: 10, d: 15 }, '09:00', TZ)), '2026-10-15T07:00:00.000Z'); });
t('end time option', function () { assert.strictEqual(iso(L.endMoment({ y: 2026, mo: 11, d: 15 }, '18:00', TZ)), '2026-11-15T17:00:00.000Z'); });
t('day of the October DST change', function () { assert.strictEqual(iso(L.endMoment({ y: 2026, mo: 10, d: 25 }, '', TZ)), '2026-10-25T22:59:59.000Z'); });
t('day of the March DST change', function () { assert.strictEqual(iso(L.startMoment({ y: 2026, mo: 3, d: 29 }, '12:00', TZ)), '2026-03-29T10:00:00.000Z'); });

/* Small parsers */
t('toBool', function () {
  ['true', 'True', '1', 'yes', 'on', 'checked'].forEach(function (v) { assert.strictEqual(L.toBool(v), true, v); });
  ['false', '', '0', 'no', null, undefined].forEach(function (v) { assert.strictEqual(L.toBool(v), false, String(v)); });
});
t('cleanCountry', function () {
  assert.strictEqual(L.cleanCountry(' es '), 'ES');
  assert.strictEqual(L.cleanCountry('UK'), 'GB');
  assert.strictEqual(L.cleanCountry('Spain'), null);
});
t('hostIsStaging', function () {
  var b = ['lodgifyintegration.com'];
  assert.strictEqual(L.hostIsStaging('webflow-mkt.lodgifyintegration.com', b), true);
  assert.strictEqual(L.hostIsStaging('lodgifyintegration.com', b), true);
  assert.strictEqual(L.hostIsStaging('www.lodgify.com', b), false);
  assert.strictEqual(L.hostIsStaging('evil-lodgifyintegration.com', b), false);
});

/* Excluded pages */
var LOC = ['es', 'fr', 'pt', 'it', 'de', 'el'];
function m(field, full, bare) { return L.matchPath(L.parsePatterns(field), full, bare || full, LOC); }
t('plain path matches every language', function () {
  assert.strictEqual(m('/pricing', '/pricing'), true);
  assert.strictEqual(m('/pricing', '/de/pricing', '/pricing'), true);
  assert.strictEqual(m('pricing/', '/pricing'), true);
  assert.strictEqual(m('/pricing', '/pricing-old'), false);
});
t('locale folder', function () {
  assert.strictEqual(m('/es/*', '/es', '/'), true);
  assert.strictEqual(m('/es/*', '/es/precios', '/precios'), true);
  assert.strictEqual(m('/es/*', '/pricing'), false);
  assert.strictEqual(m('/es/*', '/de/pricing', '/pricing'), false);
});
t('section wildcard', function () {
  assert.strictEqual(m('/blog/*', '/blog'), true);
  assert.strictEqual(m('/blog/*', '/blog/post'), true);
  assert.strictEqual(m('/blog/*', '/de/blog/post', '/blog/post'), true);
  assert.strictEqual(m('/blog/*', '/blogger'), false);
});
t('several lines, full URLs, everything', function () {
  assert.strictEqual(m('/demo\n/pricing', '/pricing'), true);
  assert.strictEqual(m('https://www.lodgify.com/demo', '/demo'), true);
  assert.strictEqual(m('/*', '/anything'), true);
  assert.strictEqual(m('', '/pricing'), false);
});

/* Choosing a campaign */
var NOW = Date.UTC(2026, 9, 20, 10, 0, 0);
function c(slug, o) {
  o = o || {};
  return { slug: slug, live: o.live !== false, countries: o.countries || [], exclude: [], start: o.start || Date.UTC(2026, 9, 1), end: o.end || Date.UTC(2026, 11, 31), error: o.error };
}
function pick(items, ctx) { return L.decide(items, Object.assign({ now: NOW, staging: false }, ctx)); }

t('global only needs no country', function () {
  var r = pick([c('global')]);
  assert.strictEqual(r.needsCountry, false);
  assert.strictEqual(r.chosen.slug, 'global');
});
t('a regional campaign asks for the country', function () {
  var r = pick([c('global'), c('es', { countries: ['ES'] })]);
  assert.strictEqual(r.needsCountry, true);
  assert.strictEqual(r.chosen, null);
});
t('regional beats global for its country', function () {
  assert.strictEqual(pick([c('global'), c('es', { countries: ['ES'] })], { country: 'ES' }).chosen.slug, 'es');
  assert.strictEqual(pick([c('global'), c('es', { countries: ['ES'] })], { country: 'US' }).chosen.slug, 'global');
});
t('unknown country falls back to global', function () {
  assert.strictEqual(pick([c('global'), c('es', { countries: ['ES'] })], { country: null }).chosen.slug, 'global');
});
t('latest start wins among regional', function () {
  var r = pick([c('es-old', { countries: ['ES'], start: Date.UTC(2026, 9, 15) }), c('es-new', { countries: ['ES'], start: Date.UTC(2026, 9, 18) })], { country: 'ES' });
  assert.strictEqual(r.chosen.slug, 'es-new');
});
t('regional beats a newer global', function () {
  var r = pick([c('global', { start: Date.UTC(2026, 9, 19) }), c('es', { countries: ['ES'], start: Date.UTC(2026, 9, 1) })], { country: 'ES' });
  assert.strictEqual(r.chosen.slug, 'es');
});
t('five countries', function () {
  var five = c('five', { countries: ['FR', 'IT', 'PT', 'GR', 'AT'] });
  assert.strictEqual(pick([five], { country: 'AT' }).chosen.slug, 'five');
  assert.strictEqual(pick([five], { country: 'DE' }).chosen, null);
});
t('schedule and Live', function () {
  assert.strictEqual(pick([c('future', { start: Date.UTC(2026, 11, 1) })]).chosen, null);
  assert.strictEqual(pick([c('ended', { end: Date.UTC(2026, 9, 10) })]).chosen, null);
  assert.strictEqual(pick([c('off', { live: false })]).chosen, null);
  assert.strictEqual(pick([c('off', { live: false })], { staging: true }).chosen.slug, 'off');
});
t('broken items are skipped with a reason', function () {
  var r = pick([c('broken', { error: 'unreadable date' }), c('ok')]);
  assert.strictEqual(r.chosen.slug, 'ok');
  assert.strictEqual(r.verdicts.filter(function (v) { return v.slug === 'broken'; })[0].why, 'unreadable date');
});

console.log(passed + ' tests passed' + (process.exitCode ? ', some failed' : ''));
