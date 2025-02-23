/*
 * importResolver.test.ts
 *
 * importResolver tests.
 */

import assert from 'assert';

import { ImportResolver } from '../analyzer/importResolver';
import { ConfigOptions } from '../common/configOptions';
import { lib, sitePackages, typeshedFallback } from '../common/pathConsts';
import { combinePaths, getDirectoryPath, normalizeSlashes } from '../common/pathUtils';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { TestAccessHost } from './harness/testAccessHost';
import { TestFileSystem } from './harness/vfs/filesystem';
import { ServiceProvider } from '../common/serviceProvider';
import { createServiceProvider } from '../common/serviceProviderExtensions';

const libraryRoot = combinePaths(normalizeSlashes('/'), lib, sitePackages);

test('partial stub file exists', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
            content: 'def test(): pass',
        },
    ];

    const importResult = getImportResult(files, ['myLib', 'partialStub']);
    assert(importResult.isImportFound);
    assert(importResult.isStubFile);
    assert.strictEqual(
        1,
        importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', 'partialStub.pyi')).length
    );
});

test('partial stub __init__ exists', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
            content: 'def test(): pass',
        },
    ];

    const importResult = getImportResult(files, ['myLib']);
    assert(importResult.isImportFound);
    assert(importResult.isStubFile);
    assert.strictEqual(
        1,
        importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', '__init__.pyi')).length
    );
});

test('side by side files', () => {
    const myFile = combinePaths('src', 'file.py');
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.pyi'),
            content: '# empty',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
            content: 'def test(): pass',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'partialStub2.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub2.py'),
            content: 'def test(): pass',
        },
        {
            path: myFile,
            content: '# not used',
        },
    ];

    const sp = createServiceProviderFromFiles(files);
    const configOptions = new ConfigOptions(normalizeSlashes('/'));
    const importResolver = new ImportResolver(
        sp,
        configOptions,
        new TestAccessHost(sp.fs().getModulePath(), [libraryRoot])
    );

    // Stub package wins over original package (per PEP 561 rules).
    const sideBySideResult = importResolver.resolveImport(myFile, configOptions.findExecEnvironment(myFile), {
        leadingDots: 0,
        nameParts: ['myLib', 'partialStub'],
        importedSymbols: new Set<string>(),
    });

    assert(sideBySideResult.isImportFound);
    assert(sideBySideResult.isStubFile);

    const sideBySideStubFile = combinePaths(libraryRoot, 'myLib', 'partialStub.pyi');
    assert.strictEqual(1, sideBySideResult.resolvedPaths.filter((f) => f === sideBySideStubFile).length);
    assert.strictEqual('def test(): ...', sp.fs().readFileSync(sideBySideStubFile, 'utf8'));

    // Side by side stub doesn't completely disable partial stub.
    const partialStubResult = importResolver.resolveImport(myFile, configOptions.findExecEnvironment(myFile), {
        leadingDots: 0,
        nameParts: ['myLib', 'partialStub2'],
        importedSymbols: new Set<string>(),
    });

    assert(partialStubResult.isImportFound);
    assert(partialStubResult.isStubFile);

    const partialStubFile = combinePaths(libraryRoot, 'myLib', 'partialStub2.pyi');
    assert.strictEqual(1, partialStubResult.resolvedPaths.filter((f) => f === partialStubFile).length);
});

test('stub package', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'stub.pyi'),
            content: '# empty',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
            content: '# empty',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
            content: 'def test(): pass',
        },
    ];

    // If fully typed stub package exists, that wins over the real package.
    const importResult = getImportResult(files, ['myLib', 'partialStub']);
    assert(!importResult.isImportFound);
});

test('stub namespace package', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'stub.pyi'),
            content: '# empty',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'partialStub.py'),
            content: 'def test(): pass',
        },
    ];

    // If fully typed stub package exists, that wins over the real package.
    const importResult = getImportResult(files, ['myLib', 'partialStub']);
    assert(importResult.isImportFound);
    assert(!importResult.isStubFile);
    assert.strictEqual(
        1,
        importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', 'partialStub.py')).length
    );
});

test('stub in typing folder over partial stub package', () => {
    const typingFolder = combinePaths(normalizeSlashes('/'), 'typing');
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(typingFolder, 'myLib.pyi'),
            content: '# empty',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
            content: 'def test(): pass',
        },
    ];

    // If the package exists in typing folder, that gets picked up first.
    const importResult = getImportResult(files, ['myLib'], (c) => (c.stubPath = typingFolder));
    assert(importResult.isImportFound);
    assert(importResult.isStubFile);
    assert.strictEqual(
        0,
        importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', '__init__.pyi')).length
    );
});

test('partial stub package in typing folder', () => {
    const typingFolder = combinePaths(normalizeSlashes('/'), 'typing');
    const files = [
        {
            path: combinePaths(typingFolder, 'myLib-stubs', '__init__.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(typingFolder, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
            content: 'def test(): pass',
        },
    ];

    const importResult = getImportResult(files, ['myLib'], (c) => (c.stubPath = typingFolder));
    assert(importResult.isImportFound);
    assert(importResult.isStubFile);
    assert.strictEqual(
        1,
        importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', '__init__.pyi')).length
    );
});

test('typeshed folder', () => {
    const typeshedFolder = combinePaths(normalizeSlashes('/'), 'ts');
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(typeshedFolder, 'stubs', 'myLibPackage', 'myLib.pyi'),
            content: '# empty',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
            content: 'def test(): pass',
        },
    ];

    // Stub packages win over typeshed.
    const importResult = getImportResult(files, ['myLib'], (c) => (c.typeshedPath = typeshedFolder));
    assert(importResult.isImportFound);
    assert(importResult.isStubFile);
    assert.strictEqual(
        1,
        importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', '__init__.pyi')).length
    );
});

test('typeshed fallback folder', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths('/', typeshedFallback, 'stubs', 'myLibPackage', 'myLib.pyi'),
            content: '# empty',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
            content: 'def test(): pass',
        },
    ];

    // Stub packages win over typeshed.
    const importResult = getImportResult(files, ['myLib']);
    assert(importResult.isImportFound);
    assert(importResult.isStubFile);
    assert.strictEqual(
        1,
        importResult.resolvedPaths.filter((f) => f === combinePaths(libraryRoot, 'myLib', '__init__.pyi')).length
    );
});

test('py.typed file', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', '__init__.pyi'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'myLib-stubs', 'py.typed'),
            content: 'partial\n',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', '__init__.py'),
            content: 'def test(): pass',
        },
        {
            path: combinePaths(libraryRoot, 'myLib', 'py.typed'),
            content: '# typed',
        },
    ];

    // Partial stub package always overrides original package.
    const importResult = getImportResult(files, ['myLib']);
    assert(importResult.isImportFound);
    assert(importResult.isStubFile);
});

test('py.typed library', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'os', '__init__.py'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths(libraryRoot, 'os', 'py.typed'),
            content: '',
        },
        {
            path: combinePaths('/', typeshedFallback, 'stubs', 'os', 'os', '__init__.pyi'),
            content: '# empty',
        },
    ];

    const importResult = getImportResult(files, ['os']);
    assert(importResult.isImportFound);
    assert.strictEqual(files[0].path, importResult.resolvedPaths[importResult.resolvedPaths.length - 1]);
});

test('non py.typed library', () => {
    const files = [
        {
            path: combinePaths(libraryRoot, 'os', '__init__.py'),
            content: 'def test(): ...',
        },
        {
            path: combinePaths('/', typeshedFallback, 'stubs', 'os', 'os', '__init__.pyi'),
            content: '# empty',
        },
    ];

    const importResult = getImportResult(files, ['os']);
    assert(importResult.isImportFound);
    assert.strictEqual(files[1].path, importResult.resolvedPaths[importResult.resolvedPaths.length - 1]);
});

test('no empty import roots', () => {
    const sp = createServiceProviderFromFiles([]);
    const configOptions = new ConfigOptions(''); // Empty, like open-file mode.
    const importResolver = new ImportResolver(
        sp,
        configOptions,
        new TestAccessHost(sp.fs().getModulePath(), [libraryRoot])
    );
    importResolver.getImportRoots(configOptions.getDefaultExecEnvironment()).forEach((path) => assert(path));
});

test('multiple typeshedFallback', () => {
    const files = [
        {
            path: combinePaths('/', typeshedFallback, 'stubs', 'aLib', 'aLib', '__init__.pyi'),
            content: '# empty',
        },
        {
            path: combinePaths('/', typeshedFallback, 'stubs', 'bLib', 'bLib', '__init__.pyi'),
            content: '# empty',
        },
    ];

    const sp = createServiceProviderFromFiles(files);
    const configOptions = new ConfigOptions(''); // Empty, like open-file mode.
    const importResolver = new ImportResolver(
        sp,
        configOptions,
        new TestAccessHost(sp.fs().getModulePath(), [libraryRoot])
    );
    const importRoots = importResolver.getImportRoots(configOptions.getDefaultExecEnvironment());

    assert.strictEqual(1, importRoots.filter((f) => f === combinePaths('/', typeshedFallback, 'stubs', 'aLib')).length);
    assert.strictEqual(1, importRoots.filter((f) => f === combinePaths('/', typeshedFallback, 'stubs', 'bLib')).length);
});

test('import side by side file root', () => {
    const files = [
        {
            path: combinePaths('/', 'file1.py'),
            content: 'def test1(): ...',
        },
        {
            path: combinePaths('/', 'file2.py'),
            content: 'def test2(): ...',
        },
    ];

    const importResult = getImportResult(files, ['file1']);
    assert(importResult.isImportFound);
    assert.strictEqual(1, importResult.resolvedPaths.filter((f) => f === combinePaths('/', 'file1.py')).length);
});

test('import side by side file sub folder', () => {
    const files = [
        {
            path: combinePaths('/test', 'file1.py'),
            content: 'def test1(): ...',
        },
        {
            path: combinePaths('/test', 'file2.py'),
            content: 'def test2(): ...',
        },
    ];

    const importResult = getImportResult(files, ['file1']);
    assert(importResult.isImportFound);
    assert.strictEqual(1, importResult.resolvedPaths.filter((f) => f === combinePaths('/test', 'file1.py')).length);
});

test('import side by side file sub under src folder', () => {
    const files = [
        {
            path: combinePaths('/src/nested', 'file1.py'),
            content: 'def test1(): ...',
        },
        {
            path: combinePaths('/src/nested', 'file2.py'),
            content: 'def test2(): ...',
        },
    ];

    const importResult = getImportResult(files, ['file1']);
    assert(importResult.isImportFound);
    assert.strictEqual(
        1,
        importResult.resolvedPaths.filter((f) => f === combinePaths('/src/nested', 'file1.py')).length
    );
});

test('import file sub under containing folder', () => {
    const files = [
        {
            path: combinePaths('/src/nested', 'file1.py'),
            content: 'def test1(): ...',
        },
        {
            path: combinePaths('/src/nested/nested2', 'file2.py'),
            content: 'def test2(): ...',
        },
    ];

    const importResult = getImportResult(files, ['file1']);
    assert(importResult.isImportFound);
    assert.strictEqual(
        1,
        importResult.resolvedPaths.filter((f) => f === combinePaths('/src/nested', 'file1.py')).length
    );
});

test('import side by side file sub under lib folder', () => {
    const files = [
        {
            path: combinePaths('/lib/site-packages/myLib', 'file1.py'),
            content: 'def test1(): ...',
        },
        {
            path: combinePaths('/lib/site-packages/myLib', 'file2.py'),
            content: 'def test2(): ...',
        },
    ];

    const importResult = getImportResult(files, ['file1']);
    assert(!importResult.isImportFound);
});

test("don't walk up the root", () => {
    const files = [
        {
            path: combinePaths('/', 'file1.py'),
            content: 'def test1(): ...',
        },
    ];

    const importResult = getImportResult(files, ['notExist'], (c) => (c.projectRoot = ''));
    assert(!importResult.isImportFound);
});

test('nested namespace package 1', () => {
    const files = [
        {
            path: combinePaths('/', 'packages1', 'a', 'b', 'c', 'd.py'),
            content: 'def f(): pass',
        },
        {
            path: combinePaths('/', 'packages1', 'a', '__init__.py'),
            content: '',
        },
        {
            path: combinePaths('/', 'packages2', 'a', '__init__.py'),
            content: '',
        },
    ];

    const importResult = getImportResult(files, ['a', 'b', 'c', 'd'], (config) => {
        config.defaultExtraPaths = [combinePaths('/', 'packages1'), combinePaths('/', 'packages2')];
    });
    assert(importResult.isImportFound);
});

test('nested namespace package 2', () => {
    const files = [
        {
            path: combinePaths('/', 'packages1', 'a', 'b', 'c', 'd.py'),
            content: 'def f(): pass',
        },
        {
            path: combinePaths('/', 'packages1', 'a', 'b', 'c', '__init__.py'),
            content: '',
        },
        {
            path: combinePaths('/', 'packages2', 'a', 'b', 'c', '__init__.py'),
            content: '',
        },
    ];

    const importResult = getImportResult(files, ['a', 'b', 'c', 'd'], (config) => {
        config.defaultExtraPaths = [combinePaths('/', 'packages1'), combinePaths('/', 'packages2')];
    });
    assert(importResult.isImportFound);
});

test('nested namespace package 3', () => {
    const files = [
        {
            path: combinePaths('/', 'packages1', 'a', 'b', 'c', 'd.py'),
            content: 'def f(): pass',
        },
        {
            path: combinePaths('/', 'packages2', 'a', '__init__.py'),
            content: '',
        },
    ];

    const importResult = getImportResult(files, ['a', 'b', 'c', 'd'], (config) => {
        config.defaultExtraPaths = [combinePaths('/', 'packages1'), combinePaths('/', 'packages2')];
    });
    assert(!importResult.isImportFound);
});

test('nested namespace package 4', () => {
    const files = [
        {
            path: combinePaths('/', 'packages1', 'a', 'b', '__init__.py'),
            content: '',
        },
        {
            path: combinePaths('/', 'packages1', 'a', 'b', 'c.py'),
            content: 'def f(): pass',
        },
        {
            path: combinePaths('/', 'packages2', 'a', '__init__.py'),
            content: '',
        },
        {
            path: combinePaths('/', 'packages2', 'a', 'b', '__init__.py'),
            content: '',
        },
    ];

    const importResult = getImportResult(files, ['a', 'b', 'c'], (config) => {
        config.defaultExtraPaths = [combinePaths('/', 'packages1'), combinePaths('/', 'packages2')];
    });
    assert(!importResult.isImportFound);
});

function getImportResult(
    files: { path: string; content: string }[],
    nameParts: string[],
    setup?: (c: ConfigOptions) => void
) {
    setup =
        setup ??
        ((c) => {
            /* empty */
        });

    const sp = createServiceProviderFromFiles(files);
    const configOptions = new ConfigOptions(normalizeSlashes('/'));
    setup(configOptions);

    const file = files.length > 0 ? files[files.length - 1].path : combinePaths('src', 'file.py');
    if (files.length === 0) {
        files.push({
            path: file,
            content: '# not used',
        });
    }

    const importResolver = new ImportResolver(
        sp,
        configOptions,
        new TestAccessHost(sp.fs().getModulePath(), [libraryRoot])
    );
    const importResult = importResolver.resolveImport(file, configOptions.findExecEnvironment(file), {
        leadingDots: 0,
        nameParts: nameParts,
        importedSymbols: new Set<string>(),
    });

    return importResult;
}

function createFileSystem(files: { path: string; content: string }[]): PyrightFileSystem {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });

    for (const file of files) {
        const path = normalizeSlashes(file.path);
        const dir = getDirectoryPath(path);
        fs.mkdirpSync(dir);

        fs.writeFileSync(path, file.content);
    }

    return new PyrightFileSystem(fs);
}

function createServiceProviderFromFiles(files: { path: string; content: string }[]): ServiceProvider {
    const fs = createFileSystem(files);
    return createServiceProvider(fs);
}
