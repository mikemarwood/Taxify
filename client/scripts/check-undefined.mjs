import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// Catches reading a name that was never declared.
//
// This has now shipped twice, both times invisibly. EditRow took fileWord from
// useTaxWords but not filingWord, and the archiving note below it reads
// filingWord — so opening a book to edit it threw "filingWord is not defined"
// and the page went to the error screen. The invite route called
// parseYearGrant(financialYears) where nothing had ever destructured
// financialYears from the body, so every invitation scoped to particular years
// threw before it reached the database.
//
// Neither is a syntax error, so the build passes and the module loads. The line
// simply is not reached until somebody presses the button, and then it is a
// blank page or a 500. check-imports.mjs finds a helper that was never
// imported; this finds a variable that was never anything at all.
//
// It resolves scopes properly rather than matching text: Babel's scope
// information already knows what is declared where, so a name with no binding
// and no global is the whole test.

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const ROOTS = [
  path.join(here, '..', 'src'),
  path.join(here, '..', '..', 'server', 'src'),
];

// Everything a browser or Node hands you without being asked. Anything not
// here and not declared is the bug this is looking for.
const GLOBALS = new Set([
  'console', 'window', 'document', 'navigator', 'location', 'history', 'screen',
  'localStorage', 'sessionStorage', 'fetch', 'Request', 'Response', 'Headers',
  'FormData', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'Image',
  'AbortController', 'Event', 'CustomEvent', 'MessageChannel', 'Notification',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'matchMedia', 'getComputedStyle', 'alert', 'confirm', 'prompt', 'atob', 'btoa', 'open', 'close', 'print',
  'structuredClone', 'crypto', 'performance', 'IntersectionObserver',
  'ResizeObserver', 'MutationObserver', 'DOMParser', 'XMLHttpRequest', 'WebSocket',
  'HTMLElement', 'Node', 'Element', 'Audio', 'AudioContext', 'webkitAudioContext',
  'CanvasRenderingContext2D', 'OffscreenCanvas', 'ServiceWorkerRegistration',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math',
  'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Intl',
  'ArrayBuffer', 'DataView', 'Uint8Array', 'Uint8ClampedArray', 'Int8Array',
  'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array',
  'Float64Array', 'BigInt64Array', 'BigUint64Array', 'TextEncoder', 'TextDecoder',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'globalThis', 'undefined',
  'NaN', 'Infinity', 'arguments', 'eval',
  // Node
  'process', 'Buffer', 'global', '__dirname', '__filename', 'require', 'module',
  'exports', 'URLPattern', 'setImmediate', 'clearImmediate', 'AbortSignal',
  'ReadableStream', 'WritableStream', 'TransformStream', 'CompressionStream',
  'DecompressionStream', 'FinalizationRegistry', 'WeakRef', 'Iterator',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(p);
  }
  return out;
}

const problems = [];
let scanned = 0;

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, 'utf8');
    let ast;
    try {
      ast = parse(src, {
        sourceType: 'module',
        plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
      });
    } catch (err) {
      problems.push(`${file}: could not parse — ${err.message}`);
      continue;
    }
    scanned += 1;

    traverse(ast, {
      Program(programPath) {
        // Babel collects every unresolvable reference on the program scope.
        for (const [name, paths] of Object.entries(programPath.scope.globals || {})) {
          if (GLOBALS.has(name)) continue;
          const line = paths?.node?.loc?.start?.line ?? paths?.loc?.start?.line;
          problems.push(
            `${path.relative(process.cwd(), file)}${line ? `:${line}` : ''}  "${name}" is never declared`
          );
        }
      },
    });
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} undeclared name(s):\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('');
  process.exit(1);
}

console.log(`no undeclared names — ${scanned} files checked`);
