#!/usr/bin/env node
// Three files have to agree about which Android build exists. This checks it.
//
//   client/android/app/build.gradle   versionCode / versionName — what the APK is
//   server/src/app-version.json       what the server advertises as available
//   client/capacitor.config.json      appendUserAgent, TaxifyAndroid/<versionCode>
//                                     — how a running app says which build it is
//
// The third is the one that drifts. It is the only one not visible while
// building or releasing, and it had been left at 5 while the other two moved on
// to 11 — six releases where every installed app told the server it was build
// 5. The update banner therefore offered an update to people who already had
// it, and LoginIntro, which uses the same marker to notice a new install,
// could not have told one build from the next.
//
// The README has warned about exactly this since the marker was introduced and
// it drifted anyway, which is the argument for a check rather than a sentence.
// Run from the client build, so a mismatch stops a deploy rather than shipping.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const problems = [];

const gradle = read('client/android/app/build.gradle');
const gradleCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]);
const gradleName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];

const published = JSON.parse(read('server/src/app-version.json'));

const capacitor = JSON.parse(read('client/capacitor.config.json'));
const agent = capacitor?.android?.appendUserAgent || '';
const agentCode = Number(/TaxifyAndroid\/(\d+)/.exec(agent)?.[1]);

if (!Number.isInteger(gradleCode)) problems.push('No versionCode in client/android/app/build.gradle');
if (!gradleName) problems.push('No versionName in client/android/app/build.gradle');

if (Number(published.versionCode) !== gradleCode) {
  problems.push(
    `app-version.json versionCode is ${published.versionCode}, build.gradle says ${gradleCode} — ` +
      'the server would advertise a build that is not the one that was built'
  );
}
if (published.versionName !== gradleName) {
  problems.push(`app-version.json versionName is "${published.versionName}", build.gradle says "${gradleName}"`);
}
if (agentCode !== gradleCode) {
  problems.push(
    `capacitor.config.json appendUserAgent is "${agent}", but the build is versionCode ${gradleCode} — ` +
      'set it to "TaxifyAndroid/' +
      gradleCode +
      '". A running app reports this string, so leaving it behind makes every install look like an ' +
      'old one: the update banner nags people who are up to date, and a new install cannot be told from an old one'
  );
}

if (problems.length) {
  console.error('Android version mismatch:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nSee "Shipping an update" in README.md.');
  process.exit(1);
}

console.log(`android version ok — build ${gradleCode} (${gradleName})`);
