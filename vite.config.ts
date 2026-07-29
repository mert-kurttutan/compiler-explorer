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

import {execSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {defineConfig, type Plugin} from 'vite';

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const hasGit = fs.existsSync(path.resolve(__dirname, '.git'));
const pug = require('pug') as {
    compile: (source: string, options: {filename: string}) => (locals: Record<string, unknown>) => string;
};
const goldenLayoutDistPath = require.resolve('golden-layout/dist/goldenlayout.js');
const goldenLayoutCompatModuleId = '\0ce-golden-layout-compat';

const expectedHashes: Record<string, string> = {
    cookies: '08712179739d3679',
    privacy: '074dd09a246ad6fe',
};

function execGit(command: string) {
    if (!hasGit) return 'no-git-available';

    const gitResult = execSync(command);
    if (!gitResult) {
        throw new Error(`Failed to execute ${command}`);
    }
    return gitResult.toString();
}

function createParsedPugPlugin(): Plugin {
    return {
        name: 'ce-parsed-pug',
        transform(source, id) {
            if (!id.endsWith('.pug')) return undefined;

            const filename = path.basename(id, '.pug');
            const lastTime = execGit(`git log -1 --format=%cd "${id}"`).trimEnd();
            const lastCommit = execGit(`git log -1 --format=%h "${id}"`).trimEnd();
            const gitChanges = execGit('git log --date=local --after="3 months ago" "--grep=(#[0-9]*)" --oneline')
                .split('\n')
                .map(line => line.match(/(?<hash>\w+) (?<description>.*)/))
                .filter(match => match !== null)
                .map(match => match.groups);

            const compiled = pug.compile(source, {filename: id});
            const htmlTextForHash = compiled({gitChanges, lastTime: 'some-last-time', lastCommit: 'some-last-commit'});
            const hashDigest = createHash('sha256').update(htmlTextForHash).digest('hex').substring(0, 16);
            const expectedHash = expectedHashes[filename];

            if (hasGit && expectedHash !== undefined && expectedHash !== hashDigest) {
                this.error(
                    `Hash for file '${id}' changed from '${expectedHash}' to '${hashDigest}'` +
                        ` - if expected, update the definition in vite.config.ts`,
                );
            }

            const htmlText = compiled({gitChanges, lastTime, lastCommit});
            return {
                code: `export default ${JSON.stringify({hash: hashDigest, text: htmlText})};`,
                map: null,
            };
        },
    };
}

function readGoldenLayoutCss(importPath: string) {
    const goldenLayoutPath = importPath.substring('~golden-layout/'.length);
    const packageJsonPath = require.resolve('golden-layout/package.json');
    const packageDir = path.dirname(packageJsonPath);
    const finalPath = goldenLayoutPath.endsWith('.css') ? goldenLayoutPath : `${goldenLayoutPath}.css`;
    return fs.readFileSync(path.join(packageDir, finalPath), 'utf8');
}

function createScssCompatPlugin(): Plugin {
    return {
        name: 'ce-scss-compat',
        enforce: 'pre',
        transform(source, id) {
            if (!id.endsWith('.scss')) return undefined;

            const code = source.replace(/@import\s+['"]([^'"]+)['"];?/g, (match, importPath: string) => {
                if (importPath.startsWith('~golden-layout/')) {
                    return readGoldenLayoutCss(importPath);
                }
                if (importPath.startsWith('~')) {
                    return match.replace(importPath, importPath.substring(1));
                }
                return match;
            });

            return {
                code,
                map: null,
            };
        },
    };
}

function createGoldenLayoutCompatPlugin(): Plugin {
    return {
        name: 'ce-golden-layout-compat',
        enforce: 'pre',
        resolveId(source) {
            if (source === 'golden-layout') return goldenLayoutCompatModuleId;
            return undefined;
        },
        load(id) {
            if (id !== goldenLayoutCompatModuleId) return undefined;

            const source = fs.readFileSync(goldenLayoutDistPath, 'utf8');
            const constructableComponentFactory =
                'this.instance = new ComponentConstructor( this.container, componentConfig );';
            const jqueryGlobalWrapper = /\}\)\(window\.\$\);\s*$/;
            if (!source.includes(constructableComponentFactory) || !jqueryGlobalWrapper.test(source)) {
                this.error(`Could not patch GoldenLayout wrapper in ${goldenLayoutDistPath}`);
            }

            const code = source
                .replace(
                    constructableComponentFactory,
                    [
                        'if ( ComponentConstructor.prototype === undefined ) {',
                        '    this.instance = ComponentConstructor( this.container, componentConfig );',
                        '} else {',
                        '    this.instance = new ComponentConstructor( this.container, componentConfig );',
                        '}',
                    ].join('\n\t'),
                )
                .replace(jqueryGlobalWrapper, '})($);');

            return {
                code: [`import $ from 'jquery';`, code, `export default window.GoldenLayout;`].join('\n'),
                map: null,
            };
        },
    };
}

export default defineConfig(({mode}) => {
    const isDev = mode !== 'production';

    return {
        define: {
            'window.PRODUCTION': JSON.stringify(!isDev),
        },
        plugins: [createScssCompatPlugin(), createParsedPugPlugin(), createGoldenLayoutCompatPlugin()],
        optimizeDeps: {
            exclude: ['golden-layout'],
        },
        resolve: {
            alias: [
                {
                    find: /^monaco-editor$/,
                    replacement: path.resolve(__dirname, 'static/monaco-vite.ts'),
                },
                {
                    find: 'path',
                    replacement: 'path-browserify',
                },
                {
                    find: /^~(.+)$/,
                    replacement: path.resolve(__dirname, 'node_modules') + '/$1',
                },
            ],
        },
        build: {
            assetsInlineLimit: 8192,
            emptyOutDir: true,
            manifest: true,
            outDir: 'out/vite/static',
            rollupOptions: {
                input: {
                    main: path.resolve(__dirname, 'static/main.ts'),
                    noscript: path.resolve(__dirname, 'static/noscript.ts'),
                },
                output: {
                    assetFileNames: 'assets/[name].[hash][extname]',
                    chunkFileNames: 'assets/[name].[hash].js',
                    entryFileNames: 'assets/[name].[hash].js',
                    manualChunks(id) {
                        if (id.includes('/node_modules/')) {
                            return 'vendor';
                        }
                        return undefined;
                    },
                },
            },
            sourcemap: true,
            target: 'es2015',
        },
        css: {
            preprocessorOptions: {
                scss: {
                    loadPaths: [path.resolve(__dirname, 'node_modules')],
                },
            },
        },
    };
});
