import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PYTHON_TIMEOUT_MS = 15_000;
export const TS_TIMEOUT_MS = 20_000;
export const CSHARP_TIMEOUT_MS = 60_000;
// After a timeout kill, how long to keep waiting for 'close' before settling
// anyway (a kill-race orphan can hold the stdio pipes open forever).
export const KILL_GRACE_MS = 5_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = join(__dirname, '..', '..', '..', 'server');

/** Lazy so server can set TUTOR_RUN_SCRATCH_DIR before first use. */
export function csharpScratch(): string {
  const runScratch = process.env.TUTOR_RUN_SCRATCH_DIR
    ? resolve(process.env.TUTOR_RUN_SCRATCH_DIR)
    : join(SERVER_DIR, '.run-scratch');
  return join(runScratch, 'csharp');
}

export const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <OutputType>Exe</OutputType>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>disable</Nullable>
  </PropertyGroup>
</Project>
`;
