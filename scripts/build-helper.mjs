import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'swift/nowplaying-helper.swift');
const output = resolve(root, 'bin/nowplaying-helper');
const buildDir = resolve(root, 'bin/.helper-build');

if (process.env.SLASHLYRICS_SKIP_HELPER === '1') {
    console.log('[SlashLyrics] Skipping MediaRemote helper build by SLASHLYRICS_SKIP_HELPER=1');
    process.exit(0);
}

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

if (process.env.SLASHLYRICS_HELPER_TARGET) {
    compileHelper(output, process.env.SLASHLYRICS_HELPER_TARGET);
} else {
    await rm(buildDir, { recursive: true, force: true });
    await mkdir(buildDir, { recursive: true });

    const arm64Output = resolve(buildDir, 'nowplaying-helper-arm64');
    const x64Output = resolve(buildDir, 'nowplaying-helper-x64');
    compileHelper(arm64Output, 'arm64-apple-macosx13.0');
    compileHelper(x64Output, 'x86_64-apple-macosx13.0');

    const lipo = spawnSync(
        'xcrun',
        ['lipo', '-create', arm64Output, x64Output, '-output', output],
        { stdio: 'inherit' },
    );
    if (lipo.status !== 0) {
        process.exit(lipo.status ?? 1);
    }

    await rm(buildDir, { recursive: true, force: true });
}

console.log(`[SlashLyrics] Built MediaRemote helper: ${output}`);

function compileHelper(outputPath, target) {
    const result = spawnSync(
        'xcrun',
        [
            '--sdk',
            'macosx',
            'swiftc',
            '-O',
            '-target',
            target,
            '-sdk',
            sdk.stdout.trim(),
            '-o',
            outputPath,
            source,
            '-framework',
            'Foundation',
        ],
        { stdio: 'inherit' },
    );

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}
