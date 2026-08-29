import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { avatarFile, directorySize, userFilePaths, userStorageBytes } from './userFiles.js';

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxify-userfiles-'));
  const write = (rel, bytes) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.alloc(bytes));
  };
  return { dir, write };
}

test('the figure counts all three places a user has files', () => {
  // The bug: only uploads/<id> was counted, so an account holding an avatar
  // and a folder of support attachments was reported as "0 MB of files will be
  // deleted". A figure that says zero when the answer is not zero is worse
  // than no figure at all, because it is used to decide.
  const { dir, write } = scratch();
  write('7/receipts/FY2025-2026/fuel/receipt.jpg', 1000);
  write('avatars/7-abc.png', 300);
  write('support/12/12-0.png', 500);

  const bytes = userStorageBytes(dir, { userId: 7, avatarPath: '7-abc.png', ticketIds: [12] });
  assert.equal(bytes, 1800);
});

test('an account with nothing is nothing, not an error', () => {
  const { dir } = scratch();
  assert.equal(userStorageBytes(dir, { userId: 99 }), 0);
  assert.equal(directorySize(path.join(dir, 'nope')), 0);
});


test('the count and the delete walk the same list', () => {
  // They used to be separate code, which is how one of them ended up knowing
  // about the avatar and the other not. Both go through userFilePaths now, so
  // the number shown is the number removed.
  const paths = userFilePaths('/uploads', { userId: 7, avatarPath: 'a.png', ticketIds: [1, 2] });
  assert.equal(paths.length, 4);
  assert.equal(paths.filter((p) => p.kind === 'dir').length, 3);
  assert.equal(paths.filter((p) => p.kind === 'file').length, 1);
});

test('an avatar path from the database cannot walk out of its folder', () => {
  // It is only ever a bare filename written by our own uploader, but it comes
  // back out of a database and gets joined into a path that something is about
  // to delete recursively. Refused rather than followed.
  for (const bad of ['../../etc/passwd', 'a/b.png', 'a\\b.png', '..']) {
    assert.equal(avatarFile('/uploads', bad), null, bad);
  }
  assert.equal(avatarFile('/uploads', null), null);
  assert.ok(avatarFile('/uploads', '7-abc.png').endsWith(path.join('avatars', '7-abc.png')));
});

test('no avatar and no tickets means just the one directory', () => {
  const paths = userFilePaths('/uploads', { userId: 3 });
  assert.equal(paths.length, 1);
  assert.equal(paths[0].kind, 'dir');
});
