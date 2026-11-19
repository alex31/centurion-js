'use strict';

const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve(process.argv[2] || 'dist');
const ts = require(path.join(output, 'node_modules', 'typescript'));

function compile(entries, root, out, module) {
    const options = {
        rootDir: path.join(__dirname, root),
        outDir: path.join(output, out),
        target: ts.ScriptTarget.ES2022,
        module,
        noCheck: true,
        noEmitOnError: true,
    };
    // A program emit resolves and inlines const enums across the source.
    const program = ts.createProgram(entries.map(entry => path.join(__dirname, entry)), options);
    const result = program.emit();
    if (result.emitSkipped) {
        const host = {
            getCanonicalFileName: filename => filename,
            getCurrentDirectory: () => __dirname,
            getNewLine: () => '\n',
        };
        throw new Error(ts.formatDiagnostics(result.diagnostics, host));
    }
}

compile(['src/cen.ts'], 'src', 'js', ts.ModuleKind.AMD);
fs.copyFileSync(path.join(__dirname, 'src/firmware-spec.json'), path.join(output, 'js/firmware-spec.json'));
// CoreEmulator loads the browser bridge through a dynamic require.
compile(['server/src/server.ts', 'server/src/core/cpu-real.ts'],
    '.', '.', ts.ModuleKind.CommonJS);

fs.cpSync(path.join(__dirname, 'web'), path.join(output, 'web'), {recursive: true});
