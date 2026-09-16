#!/usr/bin/env node
// Four things have to agree about the Android app. This checks them.
//
//   client/android/app/build.gradle          the build you are about to make
//   client/capacitor.config.json             the marker that build will report
//   client/public/downloads/taxify.apk       the build people can actually get
//   server/src/app-version.json              what the server advertises
//
// The split that matters is between the last two and the first two. The source
// tree describes the *next* build; the APK sitting in downloads is the one a
// phone will really install. Advertising from the source tree is how the update
// banner ended up in a loop, twice: the numbers were bumped, the APK was not
// rebuilt, and so the server offered build 12 to people downloading an APK that
// reports 5. They tapped update, installed the same file, and were told again.
//
// So: the marker must match the build it is compiled into, and what the server
// advertises must match the APK actually published. Those are different checks
// and only the second one stops the loop.
//
// Run from the client build, so a mismatch stops a deploy rather than shipping.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readZipEntry, markerVersionFrom } from '../server/src/lib/apkVersion.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const problems = [];
const notes = [];

const gradle = read('client/android/app/build.gradle');
const gradleCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]);
const gradleName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];

const published = JSON.parse(read('server/src/app-version.json'));

const capacitor = JSON.parse(read('client/capacitor.config.json'));
const agent = capacitor?.android?.appendUserAgent || '';
const agentCode = Number(/TaxifyAndroid\/(\d+)/.exec(agent)?.[1]);

if (!Number.isInteger(gradleCode)) problems.push('No versionCode in client/android/app/build.gradle');
if (!gradleName) problems.push('No versionName in client/android/app/build.gradle');

// 1. The next build is internally consistent. A running app reports this
//    string, so leaving it behind makes every install look like an old one.
if (agentCode !== gradleCode) {
  problems.push(
    `capacitor.config.json appendUserAgent is "${agent}", but the build is versionCode ${gradleCode} — ` +
      `set it to "TaxifyAndroid/${gradleCode}"`
  );
}

// 2. The server advertises the APK that is actually there. This is the one
//    that stops the endless banner.
const apkPath = path.join(root, 'client/public/downloads/taxify.apk');
if (!fs.existsSync(apkPath)) {
  notes.push('No APK in client/public/downloads — nothing is being offered for download.');
} else {
  const apkCode = markerVersionFrom(readZipEntry(fs.readFileSync(apkPath), 'assets/capacitor.config.json'));

  if (apkCode === null) {
    problems.push(
      'Could not read the build marker out of client/public/downloads/taxify.apk. ' +
        'The server falls back to app-version.json when that happens, which is exactly the drift this checks for.'
    );
  } else {
    if (Number(published.versionCode) !== apkCode) {
      problems.push(
        `app-version.json versionCode is ${published.versionCode}, but the published APK reports ${apkCode} — ` +
          'the server would offer an update that installing the APK cannot satisfy, so the banner comes back ' +
          'every time and the person can never clear it'
      );
    }
    if (Number(published.minVersionCode) > apkCode) {
      problems.push(
        `app-version.json minVersionCode is ${published.minVersionCode}, above the published build ${apkCode} — ` +
          'that requires a version nobody can install'
      );
    }
    // 3. Not fatal. Deploying the website without rebuilding the app is
    //    normal; being unaware of it is not.
    if (apkCode !== gradleCode) {
      notes.push(
        `The published APK is build ${apkCode}; the source tree is at ${gradleCode} (${gradleName}). ` +
          'Rebuild and copy it into client/public/downloads before releasing the app, then set ' +
          'app-version.json to match.'
      );
    }
  }
}

if (notes.length) {
  console.warn('Android build notes:');
  for (const n of notes) console.warn(`  - ${n}`);
  console.warn('');
}

if (problems.length) {
  console.error('Android version mismatch:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nSee "Shipping an update" in README.md.');
  process.exit(1);
}

console.log(`android version ok — publishing build ${published.versionCode} (${published.versionName})`);
