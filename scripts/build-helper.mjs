import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'swift/nowplaying-helper.swift');
const output = resolve(root, 'bin/nowplaying-helper');

if (platform() !== 'darwin') {
    console.log('[SlashLyrics] Skipping MediaRemote helper build outside macOS');
    process.exit(0);
}

const sdk = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
if (sdk.status !== 0 || !sdk.stdout.trim()) {
    console.warn('[SlashLyrics] macOS SDK not found; MediaRemote helper will not be packaged');
    process.exit(0);
}

const swiftc = spawnSync('xcrun', ['--sdk', 'macosx', '--find', 'swiftc'], { encoding: 'utf8' });
if (swiftc.status !== 0 || !swiftc.stdout.trim()) {
    console.warn('[SlashLyrics] swiftc not found; MediaRemote helper will not be packaged');
    process.exit(0);
}

if (!existsSync(source)) {
    console.warn(`[SlashLyrics] Missing helper source: ${source}`);
    process.exit(0);
}

await mkdir(dirname(output), { recursive: true });

const result = spawnSync(
    'xcrun',
    [
        '--sdk',
        'macosx',
        'swiftc',
        '-O',
        '-target',
        process.env.SLASHLYRICS_HELPER_TARGET || 'x86_64-apple-macosx13.0',
        '-sdk',
        sdk.stdout.trim(),
        '-o',
        output,
        source,
        '-framework',
        'Foundation',
    ],
    { stdio: 'inherit' },
);

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

console.log(`[SlashLyrics] Built MediaRemote helper: ${output}`);
