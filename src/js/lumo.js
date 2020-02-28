/* eslint-disable no-await-in-loop */
/* @flow */

import fs from 'fs';
import Module from 'module';
import path from 'path';
import { REPLServer } from 'repl';
import v8 from 'v8';
import zlib from 'zlib';
import JSZip from 'jszip';
import ArrayStream from './array-stream';
import * as util from './util';

type PackageJsonType = {
  directories: {
    lib: string,
    cache: string,
  },
};

async function packageJson(nodeDir: string, moduleName: string): ?PackageJsonType {
  let pkgJson = null;

  try {
    pkgJson = JSON.parse(
      fs.promises.readFile(path.join(nodeDir, moduleName, 'package.json'), 'utf8'),
    );
  } catch (_) {} // eslint-disable-line no-empty

  return pkgJson;
}

function inferClasspathLib(
  nodeDir: string,
  moduleName: string,
  pkgJson: PackageJsonType,
): ?string {
  let libPath = null;

  try {
    if (pkgJson.directories != null) {
      libPath = pkgJson.directories.lib;

      if (libPath != null) {
        libPath = path.resolve(nodeDir, moduleName, libPath);
      }
    }
  } catch (_) {} // eslint-disable-line no-empty

  return libPath;
}

async function scanModules(
  libPaths: string[],
  baseDir: string,
  moduleName: string,
): string[] {
  const pkgJson = await packageJson(baseDir, moduleName);

  if (pkgJson) {
    const libPath = inferClasspathLib(baseDir, moduleName, pkgJson);
    return libPath ? libPaths.concat(libPath) : libPaths;
  }

  let newLibPaths = libPaths;

  if (moduleName.startsWith('@')) {
    try {
      const modulePath = path.resolve(baseDir, moduleName);

      if (fs.lstatSync(modulePath).isDirectory()) {
        newLibPaths = await (fs.promises
          .readdir(modulePath))
          .reduce(async (acc: string[], childName: string) => {
            const parentPath = path.join(baseDir, moduleName);
            return acc.concat(await scanModules(acc, parentPath, childName));
          }, libPaths);
      }
    } catch (_) {} // eslint-disable-line no-empty
  }
  return newLibPaths;
}

async function modulesByNodeDir(): Map<string, string[]> {
  const moduleByDir: Map<string, string[]> = new Map();

  // $FlowIssue: it's there
  await Module._nodeModulePaths(process.cwd()).forEach(async (nodeDir: string) => {
    try {
      moduleByDir.set(nodeDir, await fs.readdirSync(nodeDir));
    } catch (_) {} // eslint-disable-line no-empty
  });

  return moduleByDir;
}

/* eslint-disable no-loop-func */
async function inferNodeModulesClasspathLibs(): string[] {
  let result = [];

  for (const [nodeDir, modules] of await modulesByNodeDir()) {
    modules
      .filter((moduleName: string) => !moduleName.startsWith('.'))
      .forEach(async (moduleName: string) => {
        result = result.concat(await scanModules([], nodeDir, moduleName));
      });
  }
  return result;
}
/* eslint-enable no-loop-func */

const sourcePaths = {
  manual: new Set([process.cwd()]),
  // $FlowIssue: doesn't support getters yet
  get inferred(): string[] {
    delete this.inferred;
    this.inferred = inferNodeModulesClasspathLibs();
    return this.inferred;
  },
  // $FlowIssue: doesn't support getters yet
  get paths(): Set<string> {
    return this.inferred.then((values) => {
      return new Set([...this.manual, ...values]);
    });
  },
};

type SourceType = {|
  source: string,
  modified: number,
|};

type ResourceType =
  | {|
      type: 'bundled',
      src: string,
    |}
  | {|
      type: 'file',
      src: string,
    |}
  | {|
      type: 'jar',
      jarPath: string,
      src: string,
      modified: number,
    |};

function isBundled(filename: string): boolean {
  if (__DEV__) {
    return fs.existsSync(`./target/${filename}`);
  }

  const fname = util.isWindows ? filename.replace(/\//g, '\\') : filename;

  return lumo.internal.embedded.resources[fname] != null;
}

export async function load(filename: string): ?string {
  if (__DEV__) {
    try {
      return await fs.promises.readFile(`${__dirname}/${filename}`, 'utf8');
    } catch (e) {
      return null;
    }
  }

  const fname = util.isWindows ? filename.replace(/\//g, '\\') : filename;
  const gzipped = lumo.internal.embedded.get(fname);
  if (gzipped != null) {
    return zlib.inflateSync(gzipped).toString();
  }

  return null;
}

// eslint-disable-next-line flowtype/no-weak-types
export function getGoogleClosureCompiler(): Function {
  v8.setFlagsFromString('--nouse_strict');

  // eslint-disable-next-line global-require
  const googleClosureCompiler = require('google-closure-compiler-js');

  // TODO: don't set use_strict back if it was never on in the first place
  v8.setFlagsFromString('--use_strict');
  return __DEV__ ? googleClosureCompiler.compile : googleClosureCompiler;
}

// TODO: cache JARs that we know have a given file / path
export async function readSource(filename: string): ?SourceType {
  // $FlowIssue: getters not supported
  for (const srcPath of (await sourcePaths.paths).values()) {
    try {
      if (srcPath.endsWith('.jar')) {
        const data = await fs.promises.readFile(srcPath);
        const zip = new JSZip().load(data);
        const file = zip.file(filename);

        if (file != null) {
          return {
            source: file.asText(),
            modified: file.date.getTime(),
          };
        }
      }
      const filePath = path.join(srcPath, filename);
      return {
        source: await fs.promises.readFile(filePath, 'utf8'),
        modified: fs.statSync(filePath).mtimeMs,
      };
    } catch (_) {} // eslint-disable-line no-empty
  }
  return null;
}

export async function readFile(filename: string): ?SourceType {
  try {
    return {
      source: await fs.promises.readFile(filename, 'utf8'),
      modified: fs.statSync(filename).mtimeMs,
    };
  } catch (_) {} // eslint-disable-line no-empty

  return null;
}

export async function readCache(filename: string): ?SourceType {
  try {
    return {
      source: await fs.promises.readFile(filename, 'utf8'),
      modified: fs.statSync(filename).mtimeMs,
    };
  } catch (_) {
    return null;
  }
}

export async function writeCache(filename: string, source: string): ?Error {
  try {
    return await fs.promises.writeFile(filename, source, 'utf8');
  } catch (e) {
    return e;
  }
}

export async function loadUpstreamJsLibs(): string[] {
  const ret = [];
  // $FlowIssue: getters not supported
  for (const srcPath of (await sourcePaths.paths).values()) {
    try {
      if (srcPath.endsWith('.jar')) {
        const data = await fs.promises.readFile(srcPath);
        const zip = new JSZip().load(data);
        const source = zip.file('deps.cljs');

        if (source != null) {
          ret.push(source.asText());
        }
      } else {
        const source = await fs.promises.readFile(path.join(srcPath, 'deps.cljs'), 'utf8');
        ret.push(source);
      }
    } catch (_) {} // eslint-disable-line no-empty
  }
  return ret;
}

export async function loadUpstreamDataReaders(): { url: string, source: string }[] {
  const ret = [];
  // $FlowIssue: getters not supported
  for (const srcPath of (await sourcePaths.paths).values()) {
    for (const filename of ['data_readers.cljs', 'data_readers.cljc']) {
      const url = path.join(srcPath, filename);

      try {
        if (srcPath.endsWith('.jar')) {
          const data = fs.promises.readFile(srcPath);
          const zip = new JSZip().load(data);
          const source = zip.file(filename);

          if (source != null) {
            ret.push({
              url,
              source: source.asText(),
            });
          }
        } else {
          const source = await fs.promises.readFile(url, 'utf8');
          ret.push({
            url,
            source,
          });
        }
      } catch (_) {} // eslint-disable-line no-empty
    }
  }
  return ret;
}

export async function resource(filename: string): ?ResourceType {
  if (isBundled(filename)) {
    return {
      type: 'bundled',
      src: filename,
    };
  }

  // $FlowIssue: getters not supported
  for (const srcPath of (await sourcePaths.paths).values()) {
    if (srcPath.endsWith('.jar')) {
      const data = await fs.promises.readFile(srcPath);
      const zip = new JSZip().load(data);
      const entries = zip.filter((pathInJar: string) => pathInJar === filename);

      if (entries.length > 0) {
        const entry = entries[0];
        return {
          type: 'jar',
          jarPath: path.resolve(srcPath),
          src: filename,
          modified: entry.date.getTime(),
        };
      }
    }

    if (fs.existsSync(path.join(srcPath, filename))) {
      return {
        type: 'file',
        src: path.resolve(srcPath, filename),
      };
    }
  }

  return null;
}

export async function getSourcePaths(): string[] {
  // $FlowIssue: getters not supported
  return [...(await sourcePaths.paths)];
}

export async function addSourcePaths(srcPaths: string[]): void {
  const expanded = srcPaths.map((srcPath: string) =>
    path.normalize(util.expandPath(srcPath)),
  );

  await expanded.forEach(async (p: string) => sourcePaths.manual.add(p));
}

export async function removeSourcePath(srcPath: string): boolean {
  return sourcePaths.manual.delete(util.expandPath(srcPath));
}

export async function readSourceFromJar({
  jarPath,
  src,
}: {
  type: string,
  jarPath: string,
  src: string,
}): string {
  const data = await fs.promises.readFile(jarPath);
  const zip = new JSZip().load(data);
  const source = zip.file(src);

  return source.asText();
}

export async function readDirFromJar(jarPath: string, dir: string): string[] {
  const data = await fs.promises.readFile(jarPath);
  const zip = new JSZip().load(data);

  return zip.file(new RegExp(`^${dir}`)).map((x: { name: string }) => x.name);
}

export async function dumpSDK(outdir: string): void {
  if (!__DEV__) {
    await lumo.internal.embedded.keys().forEach(async (res: string) => {
      const idx = res.lastIndexOf('/');

      if (idx !== -1) {
        util.ensureDir(path.join(outdir, res.slice(0, idx)));
      }

      // $FlowFixMe: need to check result of res, but bundled resources will be
      await fs.promises.writeFile(path.join(outdir, res), await load(res), 'utf8');
    });
  }
}

// based on https://github.com/nodejs/node/blob/712596/lib/repl.js#L710
export function getJSCompletions(
  line: string,
  match: string,
  cb: (string[]) => void,
): void {
  const flat = new ArrayStream();
  // $FlowIssue: stream needs to be the 2nd arg
  const nodeReplServer = new REPLServer('', flat);
  const lineWithoutMatch = line.substring(0, line.length - match.length);

  // $FlowIssue: it's there
  return nodeReplServer.completer(
    match,
    (err: ?Error, [jsCompletions]: [string[], string]) => {
      const completions = jsCompletions.reduce((cs: string[], c: string) => {
        if (c === '') {
          return cs;
        }

        cs.push(`${lineWithoutMatch}${c}`);
        return cs;
      }, []);
      return cb(completions);
    },
  );
}
