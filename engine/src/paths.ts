import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT: string = join(here, '..', '..');
export const SCHEMA_PATH: string = join(REPO_ROOT, 'schema.json');
export const PROMPTS_DIR: string = join(REPO_ROOT, 'prompts');
