import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  isAllowedAttachment,
  storedFilename,
  ticketDir,
  isInsideTicket,
  removeTicketFiles,
  MAX_ATTACHMENT_BYTES,
} from './supportAttachments.js';

test('images are allowed and everything else is not', () => {
  assert.equal(isAllowedAttachment({ mimetype: 'image/png' }), true);
  assert.equal(isAllowedAttachment({ mimetype: 'image/jpeg' }), true);
  assert.equal(isAllowedAttachment({ mimetype: 'application/pdf' }), false);
  assert.equal(isAllowedAttachment({ mimetype: 'application/x-msdownload' }), false);
});

test('SVG is refused, because it is a document that can carry script', () => {
  // It looks like a picture and behaves like a web page. Serving one back to
  // somebody signed in is a way to run script in their session.
  assert.equal(isAllowedAttachment({ mimetype: 'image/svg+xml' }), false);
});

test('the stored name never comes from the browser', () => {
  // The uploaded filename is attacker-controlled text. It only has to contain
  // a slash or a pair of dots once to write somewhere it should not.
  const name = storedFilename(7, 0, { mimetype: 'image/png', originalname: '../../etc/passwd' });
  assert.equal(name, '7-0.png');
  assert.equal(name.includes('/'), false);
  assert.equal(name.includes('..'), false);
});

test('a ticket folder is named after the ticket and nothing else', () => {
  const dir = ticketDir('/uploads', 42);
  assert.equal(dir, path.join('/uploads', 'support', '42'));
});

test('a ticket id that is not a number cannot point the folder elsewhere', () => {
  assert.equal(ticketDir('/uploads', '../../etc'), path.join('/uploads', 'support', '0'));
});

test('a file outside the ticket folder is not treated as inside it', () => {
  assert.equal(isInsideTicket('/uploads', 42, '/uploads/support/42/7-0.png'), true);
  assert.equal(isInsideTicket('/uploads', 42, '/uploads/support/43/7-0.png'), false);
  assert.equal(isInsideTicket('/uploads', 42, '/uploads/receipts/9/private.png'), false);
});

test('deleting refuses to act outside the support folder', () => {
  // The guard that matters: this call is a recursive delete, and a bad id must
  // never be able to aim it at the uploads root or anywhere above it.
  assert.equal(removeTicketFiles('/uploads', '../../'), false);
  assert.equal(removeTicketFiles('/uploads', ''), false);
});

test('the size limit is large enough for a screenshot and no larger', () => {
  assert.ok(MAX_ATTACHMENT_BYTES >= 4 * 1024 * 1024);
  assert.ok(MAX_ATTACHMENT_BYTES <= 16 * 1024 * 1024);
});
