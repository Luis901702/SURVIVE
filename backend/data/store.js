const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');

let cache = null;

function read() {
  if (!cache) {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    cache = JSON.parse(raw);
  }
  return cache;
}

function write(data) {
  cache = data;
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function update(fn) {
  const data = read();
  fn(data);
  write(data);
  return data;
}

module.exports = { read, write, update };
