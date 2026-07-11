import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const serverRoot = path.resolve(__dirname, '..');

export type AppPaths = {
  dataDir: string | null; // TUTOR_DATA_DIR or null (repo layout)
  dbPath: string; // TUTOR_DB_PATH > dataDir/tutor.db > <repo>/tutor.db
  cardsDir: string; // dataDir/cards > <repo>/cards
  logsDir: string; // dataDir/logs > <repo>/logs
  scratchDir: string; // TUTOR_SCRATCH_DIR > dataDir/scratch > <repo>/server
  teacherScratchDir: string; // TUTOR_TEACHER_SCRATCH_DIR > scratchDir/.teacher-scratch
  runScratchDir: string; // scratchDir/.run-scratch
  lspScratchDir: string; // scratchDir/.lsp-scratch (+ '-py' sibling derived where used)
  webDistDir: string | null; // TUTOR_WEB_DIST > null (null = no static serving)
  seedCardsDir: string | null; // TUTOR_SEED_CARDS > null
};

export function appPaths(): AppPaths {
  const dataDir = process.env.TUTOR_DATA_DIR
    ? path.resolve(process.env.TUTOR_DATA_DIR)
    : null;

  const dbPath = process.env.TUTOR_DB_PATH
    ? path.resolve(process.env.TUTOR_DB_PATH)
    : dataDir
      ? path.join(dataDir, 'tutor.db')
      : path.join(repoRoot, 'tutor.db');

  const cardsDir = dataDir
    ? path.join(dataDir, 'cards')
    : path.join(repoRoot, 'cards');

  const logsDir = process.env.TUTOR_LOGS_DIR
    ? path.resolve(process.env.TUTOR_LOGS_DIR)
    : dataDir
      ? path.join(dataDir, 'logs')
      : path.join(repoRoot, 'logs');

  const scratchDir = process.env.TUTOR_SCRATCH_DIR
    ? path.resolve(process.env.TUTOR_SCRATCH_DIR)
    : dataDir
      ? path.join(dataDir, 'scratch')
      : serverRoot;

  const teacherScratchDir = process.env.TUTOR_TEACHER_SCRATCH_DIR
    ? path.resolve(process.env.TUTOR_TEACHER_SCRATCH_DIR)
    : path.join(scratchDir, '.teacher-scratch');

  const runScratchDir = path.join(scratchDir, '.run-scratch');
  const lspScratchDir = path.join(scratchDir, '.lsp-scratch');

  const webDistDir = process.env.TUTOR_WEB_DIST
    ? path.resolve(process.env.TUTOR_WEB_DIST)
    : null;

  const seedCardsDir = process.env.TUTOR_SEED_CARDS
    ? path.resolve(process.env.TUTOR_SEED_CARDS)
    : null;

  return {
    dataDir,
    dbPath,
    cardsDir,
    logsDir,
    scratchDir,
    teacherScratchDir,
    runScratchDir,
    lspScratchDir,
    webDistDir,
    seedCardsDir,
  };
}
