'use strict';

const fs = require('fs');
const path = require('path');

class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Resolve against cwd, create the parent directory, return the absolute path.
function resolvePath(target, base = process.cwd()) {
  const abs = path.isAbsolute(target) ? target : path.resolve(base, target);
  ensureDir(path.dirname(abs));
  return abs;
}

function parseVars(pairs = []) {
  const vars = {};
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index < 1) throw new UserError(`--var expects key=value, got "${pair}"`);
    vars[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return vars;
}

function lookup(vars, dotted) {
  let current = vars;
  for (const part of dotted.split('.')) {
    if (current == null || typeof current !== 'object' || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function template(value, vars) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    const found = lookup(vars, key);
    if (found === undefined) throw new UserError(`Unknown template variable ${match}`);
    return String(found);
  });
}

// Quote-aware tokenizer for the interactive shell.
function splitArgs(line) {
  const out = [];
  const re = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+)/g;
  let match;
  while ((match = re.exec(line)) !== null) {
    out.push(match[1] ?? match[2] ?? match[3]);
  }
  return out;
}

function parseRegex(value) {
  if (typeof value !== 'string') return null;
  const match = /^\/(.*)\/([a-z]*)$/s.exec(value);
  if (!match) return null;
  try {
    return new RegExp(match[1], match[2]);
  } catch {
    return null;
  }
}

function formatMs(ms) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function shortErr(err) {
  let message = (err && err.message) || String(err);
  if (!process.stdout.isTTY) message = message.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  return message.split('\n').slice(0, 8).join('\n');
}

module.exports = {
  UserError,
  ensureDir,
  formatMs,
  parseRegex,
  parseVars,
  resolvePath,
  shortErr,
  splitArgs,
  template,
};
