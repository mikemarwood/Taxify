import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeStaging, isSelfSigned, chainIsIncomplete } from './certChain.js';

// Three faults produce one Node error message — "unable to get local issuer
// certificate" — and they are fixed in three unrelated places. Telling them
// apart is the whole job of this module, so these are the real chains.

// What mail.mikesapphub.com was actually serving: a complete four-link chain
// from Let's Encrypt's staging environment, whose roots are trusted by nothing
// by design. The chain being complete is why "missing intermediate" was the
// wrong first guess.
const STAGING_CHAIN = [
  { subject: 'mail.example.com', issuer: "Let's Encrypt — (STAGING) Artificial Amaranth YE1" },
  { subject: "Let's Encrypt — (STAGING) Artificial Amaranth YE1", issuer: 'ISRG — (STAGING) Yearning Yucca Root YE' },
  {
    subject: 'ISRG — (STAGING) Yearning Yucca Root YE',
    issuer: '(STAGING) Internet Security Research Group — (STAGING) Bogus Broccoli X2',
  },
  {
    subject: '(STAGING) Internet Security Research Group — (STAGING) Bogus Broccoli X2',
    issuer: '(STAGING) Internet Security Research Group — (STAGING) Pretend Pear X1',
  },
];

const REAL_CHAIN = [
  { subject: 'mail.example.com', issuer: "Let's Encrypt — R11" },
  { subject: "Let's Encrypt — R11", issuer: 'ISRG — ISRG Root X1' },
];

const SELF_SIGNED = [{ subject: 'mail.example.com', issuer: 'mail.example.com' }];

const MISSING_INTERMEDIATE = [{ subject: 'mail.example.com', issuer: "Let's Encrypt — R11" }];

test('a staging chain is recognised however deep the staging name sits', () => {
  assert.equal(looksLikeStaging(STAGING_CHAIN), true);
  // The leaf itself carries no staging marker — only its issuers do — so a
  // check that looked at the leaf alone would miss this entirely.
  assert.equal(looksLikeStaging([STAGING_CHAIN[0]]), true);
});

test('a real Let’s Encrypt chain is not mistaken for staging', () => {
  assert.equal(looksLikeStaging(REAL_CHAIN), false);
  assert.equal(looksLikeStaging(SELF_SIGNED), false);
});

test('a staging chain is neither self-signed nor incomplete', () => {
  // The three verdicts are reported in order, so a staging chain wrongly
  // matching one of these would be told to fix the wrong thing.
  assert.equal(isSelfSigned(STAGING_CHAIN), false);
  assert.equal(chainIsIncomplete(STAGING_CHAIN), false);
});

test('self-signed and missing-intermediate are told apart', () => {
  // Both are one link long. Subject against issuer is the only thing
  // separating them.
  assert.equal(isSelfSigned(SELF_SIGNED), true);
  assert.equal(chainIsIncomplete(SELF_SIGNED), false);

  assert.equal(isSelfSigned(MISSING_INTERMEDIATE), false);
  assert.equal(chainIsIncomplete(MISSING_INTERMEDIATE), true);
});

test('a complete chain is not reported as incomplete', () => {
  assert.equal(chainIsIncomplete(REAL_CHAIN), false);
});
