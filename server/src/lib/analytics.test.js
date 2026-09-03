import test from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignFrom,
  changeBetween,
  classifyReferrer,
  countryFrom,
  countryFromLocale,
  fillDays,
  isBot,
  normalisePath,
  referrerHost,
} from './analytics.js';

test('a referrer becomes a host, or nothing', () => {
  assert.equal(referrerHost('https://www.google.com/search?q=taxify'), 'google.com');
  assert.equal(referrerHost('https://m.facebook.com/'), 'm.facebook.com');
  assert.equal(referrerHost(''), null);
  assert.equal(referrerHost(null), null);
  // Not a URL. Android sends these and they are not a source.
  assert.equal(referrerHost('android-app://com.example'), null);
  assert.equal(referrerHost('nonsense'), null);
});

test('the sources worth acting on are separated from the rest', () => {
  assert.deepEqual(classifyReferrer('https://www.google.com.au/'), { kind: 'search', name: 'Google' });
  assert.deepEqual(classifyReferrer('https://l.facebook.com/l.php?u=x'), { kind: 'social', name: 'Facebook' });
  assert.deepEqual(classifyReferrer('https://t.co/abc'), { kind: 'social', name: 'X' });
  assert.deepEqual(classifyReferrer('https://chatgpt.com/'), { kind: 'ai', name: 'ChatGPT' });

  // No referrer is "we were not told", which is most of a native app, a PDF
  // and a QR code — not somebody typing the address.
  assert.deepEqual(classifyReferrer(''), { kind: 'direct', name: 'Direct' });

  // Our own pages are movement, not traffic. Counted as a source they would be
  // the biggest one on the chart and would bury every real answer.
  assert.equal(classifyReferrer('https://taxify.mikesapphub.com/app/expenses').kind, 'internal');
  assert.equal(classifyReferrer('https://mikesapphub.com/apps/taxify').kind, 'internal');

  // Anything else keeps its host, which is the only useful thing about it.
  assert.deepEqual(classifyReferrer('https://someblog.example/post'), { kind: 'other', name: 'someblog.example' });
});

test('campaign tags survive a click that lost its referrer', () => {
  const utm = campaignFrom('/?utm_source=facebook&utm_medium=cpc&utm_campaign=shoebox');
  assert.deepEqual(utm, { source: 'facebook', medium: 'cpc', campaign: 'shoebox' });

  // A click id and nothing else is still a paid click. Facebook strips the
  // referrer often enough that this is the only thing left to file it under.
  const fb = campaignFrom('https://taxify.mikesapphub.com/?fbclid=ABC123');
  assert.equal(fb.source, 'facebook');
  assert.equal(fb.medium, 'cpc');
  assert.equal(fb.campaign, null);

  const none = campaignFrom('/app/login');
  assert.deepEqual(none, { source: null, medium: null, campaign: null });
});

test('crawlers and link previews are not visitors', () => {
  assert.ok(isBot('facebookexternalhit/1.1'));
  assert.ok(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'));
  assert.ok(isBot('curl/8.4.0'));
  assert.ok(isBot('WhatsApp/2.23'));
  assert.ok(isBot('Mozilla/5.0 HeadlessChrome/120'));
  assert.ok(!isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1'));
  assert.ok(!isBot('Mozilla/5.0 (Linux; Android 14) Chrome/120 TaxifyAndroid/11'));
});

test('paths group by page, not by record', () => {
  assert.equal(normalisePath('/app/expenses?tab=all'), '/app/expenses');
  assert.equal(normalisePath('/app/support/482'), '/app/support/:id');
  assert.equal(normalisePath('/'), '/');
  assert.equal(normalisePath('/app/'), '/app');
  assert.equal(normalisePath('app/login'), '/app/login');
  assert.equal(normalisePath('/app//expenses'), '/app/expenses');
  // A token in a path is one visit to one page, not a page of its own.
  assert.equal(normalisePath('/support/a1b2c3d4e5f60718'), '/support/:id');
});

test('an unknown country stays unknown', () => {
  assert.equal(countryFrom({ 'cf-ipcountry': 'AU' }), 'AU');
  assert.equal(countryFrom({ 'x-geo-country': 'nz' }), 'NZ');
  // The whole point. Filing every unread visitor under one country is not
  // reporting, it is deciding.
  assert.equal(countryFrom({}), null);
  assert.equal(countryFrom({ 'cf-ipcountry': 'XX' }), null);
  assert.equal(countryFrom({ 'cf-ipcountry': 'T1' }), null);
  assert.equal(countryFrom({ 'cf-ipcountry': 'Australia' }), null);
});

test('the regional setting stands in when nothing else knows where they are', () => {
  assert.equal(countryFromLocale('en-AU,en;q=0.9'), 'AU');
  assert.equal(countryFromLocale('en-GB'), 'GB');
  assert.equal(countryFromLocale('fr-CA,fr;q=0.8,en;q=0.6'), 'CA');
  // A script subtag sits between the language and the region.
  assert.equal(countryFromLocale('zh-Hans-CN'), 'CN');

  // A bare language says nothing about where anybody is, and turning it into
  // a country would be inventing the answer this whole function exists to
  // avoid inventing.
  assert.equal(countryFromLocale('en'), null);
  assert.equal(countryFromLocale('en,fr'), null);
  assert.equal(countryFromLocale(''), null);
  assert.equal(countryFromLocale(null), null);
  assert.equal(countryFromLocale('*'), null);
});

test('a quiet day is a zero, not a missing column', () => {
  const days = fillDays([], 7);
  assert.equal(days.length, 7);
  assert.ok(days.every((d) => d.value === 0));
  // Ordered oldest to newest, so a chart reads left to right.
  assert.ok(days[0].day < days[6].day);

  const today = new Date().toISOString().slice(0, 10);
  const withOne = fillDays([{ day: today, n: 4 }], 7);
  assert.equal(withOne[6].value, 4);
  assert.equal(withOne[5].value, 0);
});

test('growth from nothing is not a percentage', () => {
  assert.equal(changeBetween(150, 100), 50);
  assert.equal(changeBetween(50, 100), -50);
  assert.equal(changeBetween(100, 100), 0);
  // Ten visits after a week of none is not "1000% growth", and drawing it as
  // a number says something the data does not support.
  assert.equal(changeBetween(10, 0), null);
  assert.equal(changeBetween(0, 0), null);
});
