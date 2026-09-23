import { loadConfig, startMockServer } from './server.mjs';

const config = loadConfig(process.env);
const running = await startMockServer(config);
console.log(`TypeSafe mock listening on ${running.url}`);
console.log('POST /v1/systemone');
console.log('GET /v1/models');
