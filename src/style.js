'use strict';

const enabled = !process.env.NO_COLOR && Boolean(process.stdout.isTTY);

const paint = (code) => (value) => (enabled ? `\x1b[${code}m${value}\x1b[0m` : String(value));

module.exports = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  cyan: paint('36'),
};
