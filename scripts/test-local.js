/**
 * scripts/test-local.js
 * Run with: node scripts/test-local.js
 * Requires a .env file with real credentials.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const handler = require('../api/check-availability');

// Minimal mock of Vercel req/res
function mockReq(body, headers = {}) {
  return { method: 'POST', body, headers };
}

function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; this._ended = true; console.log(`\nStatus: ${this._status}\nBody:`, JSON.stringify(body, null, 2)); },
    end() { this._ended = true; },
  };
  return res;
}

async function run() {
  const testCases = [
    {
      label: 'Check availability – mañana a las 10:00',
      body: { datetime: tomorrowAt(10, 0) },
    },
    {
      label: 'Check availability – mañana a las 11:30',
      body: { datetime: tomorrowAt(11, 30) },
    },
    {
      label: 'Bad request – no datetime',
      body: {},
    },
    {
      label: 'Bad request – invalid date',
      body: { datetime: 'not-a-date' },
    },
  ];

  for (const tc of testCases) {
    console.log('\n' + '─'.repeat(60));
    console.log('TEST:', tc.label);
    console.log('Input:', JSON.stringify(tc.body));
    await handler(mockReq(tc.body), mockRes());
  }
}

function tomorrowAt(hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

run().catch(console.error);
