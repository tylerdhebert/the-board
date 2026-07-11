import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT: string = join(here, '..', '..');
export const SCHEMA_PATH: string = process.env.TUTOR_SCHEMA_PATH
  ? resolve(process.env.TUTOR_SCHEMA_PATH)
  : join(REPO_ROOT, 'schema.json');
export const PROMPTS_DIR: string = process.env.TUTOR_PROMPTS_DIR
  ? resolve(process.env.TUTOR_PROMPTS_DIR)
  : join(REPO_ROOT, 'prompts');
