// Twin Block entry point. The app itself lives in lib/app.mjs so tests can start it on a random port.
import { createServer } from './lib/app.mjs';

const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
createServer().listen(port, host, () => console.log(`Twin Block on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} · Qloo key ${process.env.QLOO_API_KEY ? 'configured' : 'NOT configured'}`));
