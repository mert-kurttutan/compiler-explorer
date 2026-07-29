// Copyright (c) 2026, Compiler Explorer Authors
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

type ViteManifestEntry = {
    file: string;
    name?: string;
    src?: string;
    isEntry?: boolean;
    css?: string[];
};

type ViteManifest = Record<string, ViteManifestEntry>;
type CeManifest = Record<string, string>;

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const viteStaticPath = path.resolve(__dirname, 'out', 'vite', 'static');
const viteManifestPath = path.resolve(viteStaticPath, '.vite', 'manifest.json');
const ceManifestPath = path.resolve(__dirname, 'out', 'vite', 'dist', 'manifest.json');
const publicPath = path.resolve(__dirname, 'public');

function findEntry(manifest: ViteManifest, source: string): ViteManifestEntry {
    const entry = manifest[source];
    if (!entry) {
        throw new Error(`Unable to find Vite manifest entry for ${source}`);
    }
    return entry;
}

function findNamedChunk(manifest: ViteManifest, name: string): ViteManifestEntry {
    const entry = Object.values(manifest).find(entry => entry.name === name);
    if (!entry) {
        throw new Error(`Unable to find Vite manifest chunk named ${name}`);
    }
    return entry;
}

function firstCss(entry: ViteManifestEntry, logicalName: string): string {
    const css = entry.css?.[0];
    if (!css) {
        throw new Error(`Unable to find CSS output for ${logicalName}`);
    }
    return css;
}

async function addPublicAssets(manifest: CeManifest, root: string, current: string): Promise<void> {
    const entries = await fs.readdir(current, {withFileTypes: true});
    for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
            await addPublicAssets(manifest, root, fullPath);
        } else if (entry.isFile()) {
            const relativePath = path.relative(root, fullPath).split(path.sep).join('/');
            manifest[relativePath] = relativePath;
        }
    }
}

async function main() {
    const viteManifest: ViteManifest = JSON.parse(await fs.readFile(viteManifestPath, 'utf-8'));
    const mainEntry = findEntry(viteManifest, 'static/main.ts');
    const noscriptEntry = findEntry(viteManifest, 'static/noscript.ts');
    const runtimeEntry = findNamedChunk(viteManifest, 'rolldown-runtime');
    const vendorEntry = findNamedChunk(viteManifest, 'vendor');

    const ceManifest: CeManifest = {
        'main.js': mainEntry.file,
        'main.css': firstCss(mainEntry, 'main.css'),
        'noscript.js': noscriptEntry.file,
        'noscript.css': firstCss(noscriptEntry, 'noscript.css'),
        'runtime.js': runtimeEntry.file,
        'vendor.js': vendorEntry.file,
        'vendor.css': firstCss(vendorEntry, 'vendor.css'),
    };

    await addPublicAssets(ceManifest, publicPath, publicPath);
    await fs.mkdir(path.dirname(ceManifestPath), {recursive: true});
    await fs.writeFile(ceManifestPath, `${JSON.stringify(ceManifest, null, 4)}\n`);
}

await main();
