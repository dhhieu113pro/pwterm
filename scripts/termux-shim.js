#!/usr/bin/env node
'use strict';

// Termux has no /usr/bin/env, so an npm-created bin symlink fails with
// "bad interpreter". Replace it with a tiny sh wrapper that hardcodes the
// node binary and this package's entry point.
//
// Runs automatically as `postinstall` on Termux; harmless everywhere else.

const fs = require('fs');
const path = require('path');

const MARKER = '# pwterm termux shim';
const pkgRoot = path.resolve(__dirname, '..');
const prefix = process.env.PREFIX || '';
const isTermux = process.platform === 'android' || prefix.includes('com.termux');

if (!isTermux || process.env.PWTERM_NO_SHIM) process.exit(0);

const entry = path.join(pkgRoot, 'bin', 'pwterm.js');
if (!fs.existsSync(entry)) {
  console.warn(`pwterm: ${entry} missing, skipping shim`);
  process.exit(0);
}

const binDir = path.join(prefix, 'bin');
const shimPath = path.join(binDir, 'pwterm');
const sh = path.join(prefix, 'bin', 'sh');
const node = process.execPath;

fs.mkdirSync(binDir, { recursive: true });

let existing = null;
try {
  existing = fs.lstatSync(shimPath);
} catch {
  // nothing there
}

if (existing) {
  if (existing.isSymbolicLink()) {
    fs.unlinkSync(shimPath);
  } else {
    const body = fs.readFileSync(shimPath, 'utf8');
    if (!body.includes(MARKER)) {
      console.warn(`pwterm: ${shimPath} belongs to another program, leaving it alone`);
      process.exit(0);
    }
  }
}

const script = [
  `#!${sh}`,
  MARKER,
  `exec "${node}" "${entry}" "$@"`,
  '',
].join('\n');

fs.writeFileSync(shimPath, script, { mode: 0o755 });
fs.chmodSync(shimPath, 0o755);

console.log(`pwterm: installed ${shimPath} -> ${entry}`);
