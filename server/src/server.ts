import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { appPaths } from './appPaths.js';
import { attachLspBridge } from './lsp.js';
import { pruneEmptySessions, seedCardsIfNeeded, sweepTeacherScratch } from './routes/boot.js';
import { createRequestHandler } from './routes/index.js';

const PORT = Number(process.env.PORT ?? 8787);
const paths = appPaths();
// Engine package cannot import server — push resolved locations via env before first use.
process.env.TUTOR_LOGS_DIR = paths.logsDir;
process.env.TUTOR_RUN_SCRATCH_DIR = paths.runScratchDir;
mkdirSync(paths.logsDir, { recursive: true });
mkdirSync(paths.artifactsDir, { recursive: true });

const server = http.createServer(createRequestHandler());

attachLspBridge(server);

async function boot(): Promise<void> {
  await seedCardsIfNeeded();
  await sweepTeacherScratch();

  server.listen(PORT, () => {
    const addr = server.address();
    const actualPort =
      typeof addr === 'object' && addr !== null ? addr.port : PORT;
    console.log(`TUTOR_READY {"port":${actualPort}}`);
    void pruneEmptySessions()
      .catch((err) => console.warn('prune failed', err))
      .finally(() => {
        console.log(`tutor server on http://localhost:${actualPort}`);
      });
  });
}

boot().catch((err: unknown) => {
  console.error('boot failed', err);
  process.exit(1);
});
