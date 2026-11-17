import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function readRootFile(root: string, file: string): Promise<string | undefined> {
  const absoluteRoot = path.resolve(root);
  const absoluteFile = path.resolve(absoluteRoot, file);
  const within = (base: string, target: string) => { const relative = path.relative(base, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
  if (!within(absoluteRoot, absoluteFile)) throw new Error(`${file} is outside the repository`);
  const realRoot = await realpath(absoluteRoot);
  try {
    const realFile = await realpath(absoluteFile);
    if (!within(realRoot, realFile)) throw new Error(`${file} is outside the repository`);
    return await readFile(realFile, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
