import { spawn } from 'node:child_process';
import { createServer } from 'vite';
await import('./build-electron.mjs');
const server = await createServer({ server: { host: '127.0.0.1' } });
await server.listen();
const electron = (await import('electron')).default;
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: server.resolvedUrls.local[0], ELECTRON_RUN_AS_NODE: '' } });
child.on('exit', async code => { await server.close(); process.exit(code ?? 0); });
