// DEV ONLY: a fake Qloo API on localhost so the UI can be clicked through without a key.
// Never deploy this. Start it, then run the app with QLOO_BASE_URL=http://127.0.0.1:4999 QLOO_API_KEY=dev.
import http from 'node:http';
import { mockFetch } from '../test/mock-qloo.mjs';

const fake = mockFetch();
http.createServer(async (req, res) => {
  const r = await fake(new URL(req.url, 'http://127.0.0.1:4999'));
  res.writeHead(r.status, { 'Content-Type': 'application/json' });
  res.end(await r.text());
}).listen(4999, '127.0.0.1', () => console.log('DEV fake Qloo on http://127.0.0.1:4999 (not real data)'));
