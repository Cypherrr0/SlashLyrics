#!/usr/bin/env tsx

import fs from 'node:fs/promises';
import path from 'node:path';

import type { BuildContext, BuildOptions } from 'esbuild';
import esbuild from 'esbuild';

const isWatchMode = process.argv.includes('--watch');
const options: BuildOptions = {
    color: true,
    logLevel: 'info',
    entryPoints: ['src/extension.ts'],
    bundle: true,
    metafile: process.argv.includes('--metafile'),
    outdir: './out/src',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'ESNext',
    tsconfig: './src/tsconfig.json',
    sourcemap: process.argv.includes('--sourcemap'),
    minify: process.argv.includes('--minify'),
    plugins: [
        {
            name: 'meta',
            setup(build) {
                build.onEnd(async (result) => {
                    if (result.metafile && result.errors.length === 0) {
                        return fs.writeFile(
                            path.resolve(__dirname, '../meta.json'),
                            JSON.stringify(result.metafile),
                        );
                    }
                });
            },
        },
    ],
};

async function main() {
    let ctx: BuildContext | undefined;
    try {
        if (isWatchMode) {
            ctx = await esbuild.context(options);
            await ctx.watch();
        } else {
            const result = await esbuild.build(options);
            if (process.argv.includes('--analyze')) {
                const chunksTree = await esbuild.analyzeMetafile(result.metafile!, { color: true });
                console.log(chunksTree);
            }
        }
    } catch (error) {
        console.error(error);
        ctx?.dispose();
        process.exit(1);
    }
}

main();
