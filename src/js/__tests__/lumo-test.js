/* @flow */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

let lumo = require('../lumo');

jest.mock('jszip');
// this needs to be here or tests start randomly failing with `can't find .babelrc`
require('jszip');

describe('lumo', () => {
  const { existsSync } = fs;
  const { readFile } = fs.promises;

  beforeEach(() => {
    fs.promises.readFile = jest.fn((p: string) => {
      if (/foo/.test(p)) {
        return Promise.resolve('fooContents');
      }
      throw new Error(`file doesn't exist: ${p}`);
    });
  });

  afterEach(() => {
    fs.promises.readFile = readFile;
    fs.existsSync = existsSync;
  });

  describe('load', () => {
    describe('in __DEV__', () => {
      fs.existsSync = jest.fn(() => true);
      it('returns the contents of a (bundled) file when it exists', async () => {
        expect(await lumo.load('foo')).toBe('fooContents');
      });

      it("returns null when a file doesn't exist", async () => {
        expect(await lumo.load('nonExistent')).toBe(null);
      });
    });

    describe('in production', () => {
      const { inflateSync } = zlib;

      beforeEach(() => {
        jest.resetModules();
        zlib.inflateSync = jest.fn((x: string) => x);
        global.lumo = {
          internal: {
            embedded: {
              keys: jest.fn(() => ['foo']),
              get: jest.fn((resource: string) => {
                if (resource === 'foo') {
                  return 'fooContents';
                }
                return null;
              }),
            },
          },
        };

        __DEV__ = false;
        lumo = require('../lumo'); // eslint-disable-line global-require
      });

      afterEach(() => {
        __DEV__ = true;
        zlib.inflateSync = inflateSync;
        delete global.lumo;
      });

      it('returns the contents of a (bundled) file when it exists', async () => {
        expect(await lumo.load('foo')).toBe('fooContents');
      });

      it("returns null when a file doesn't exist", async () => {
        expect(await lumo.load('nonExistent')).toBe(null);
      });
    });
  });

  describe('readCache', () => {
    const { statSync } = fs;
    beforeEach(() => {
      fs.statSync = jest.fn((filename: string) => ({
        mtimeMs: new Date().getTime(),
      }));
    });

    afterEach(() => {
      fs.statSync = statSync;
    });

    it('returns the contents of a (cached) file when it exists', async () => {
      expect(await lumo.readCache('foo')).toEqual({
        source: 'fooContents',
        modified: expect.any(Number),
      });
    });

    it("returns null when a file doesn't exist", async () => {
      expect(await lumo.readCache('nonExistent')).toBe(null);
    });
  });

  describe('writeCache', () => {
    const { writeFile } = fs.promises;
    beforeEach(() => {
      fs.promises.writeFile = jest.fn(
        (fname: string, contents: string, encoding: string) => {
          if (/foo/.test(fname)) {
            return Promise.resolve();
          }
          throw new Error('some error');
        },
      );
    });

    afterEach(() => {
      fs.writeFileSync = writeFile;
    });

    it('writes correctly if directory exists', async () => {
      expect(await lumo.writeCache('foo', 'bar')).toBeUndefined();
    });

    it("catches and returns an error if it can't write", async () => {
      expect(await lumo.writeCache('nonExistent', 'contents')).toBeInstanceOf(Error);
    });
  });

  describe('readSource', () => {
    const pathResolve = path.resolve;

    beforeEach(() => {
      jest.resetModules();
      lumo = require('../lumo'); // eslint-disable-line global-require
      path.resolve = jest.fn((x: string) => x);
    });

    afterEach(() => {
      path.resolve = pathResolve;
    });

    it('cycles through the source paths', async () => {
      const srcPaths = ['a', 'b', 'c'];
      await lumo.addSourcePaths(srcPaths);
      const lumoPaths = [process.cwd(), ...srcPaths];

      fs.promises.readFile = jest.fn((filename: string) => {
        throw new Error(`file doesn't exist: ${filename}`);
      });

      const source = await lumo.readSource('bar/baz');
      const mockCalls = fs.promises.readFile.mock.calls;

      expect(source).toBe(null);
      expect(
        mockCalls
          .map((x: string[]) => x[0])
          .filter((x: string) =>
            new Set(lumoPaths.map((p: string) => path.join(p, 'bar/baz'))).has(
              x,
            ),
          ),
      ).toEqual(lumoPaths.map((p: string) => path.join(p, 'bar/baz')));
    });

    describe('reads JAR archives', () => {
      it('should return the source when JAR has the source', async () => {
        const srcPaths = ['foo.jar'];
        await lumo.addSourcePaths(srcPaths);

        const source = await lumo.readSource('some/thing');

        expect(source).toEqual({
          source: 'zipContents',
          modified: expect.any(Number),
        });
      });

      it("should return null when the JAR doesn't have the source", async () => {
        const source = await lumo.readSource('some/thing');

        expect(source).toBe(null);
      });
    });
  });

  describe('loadUpstreamJsLibs', () => {
    beforeEach(() => {
      jest.resetModules();
      lumo = require('../lumo'); // eslint-disable-line global-require
    });

    it('should return an array with the file contents when JAR has deps.cljs', async () => {
      const srcPaths = ['foo.jar'];
      await lumo.addSourcePaths(srcPaths);

      const source = await lumo.loadUpstreamJsLibs('some/thing');

      expect(source).toEqual(['zipContents']);
    });

    it("should return an empty array when the JAR doesn't have deps.cljs", async () => {
      const source = await lumo.loadUpstreamJsLibs('some/thing');

      expect(source).toEqual([]);
    });

    it("shouldn't crash when a JAR isn't found", async () => {
      const srcPaths = ['bar.jar'];
      await lumo.addSourcePaths(srcPaths);

      const source = await lumo.loadUpstreamJsLibs('some/thing');

      expect(source).toEqual([]);
    });
  });

  describe('resource', () => {
    const pathResolve = path.resolve;

    beforeEach(() => {
      jest.resetModules();
      lumo = require('../lumo'); // eslint-disable-line global-require
      path.resolve = jest.fn((x: string) => x);
    });

    afterEach(() => {
      path.resolve = pathResolve;
    });

    it('cycles through the source paths', async () => {
      const srcPaths = ['a', 'b', 'c'];
      await lumo.addSourcePaths(srcPaths);
      const lumoPaths = [process.cwd(), ...srcPaths];

      fs.existsSync = jest.fn((_: string) => false);

      const exists = await lumo.resource('bar/baz');
      const mockCalls = fs.existsSync.mock.calls;

      expect(exists).toBe(null);
      expect(fs.existsSync).toHaveBeenCalledTimes(5);
      expect(mockCalls.map((x: string[]) => x[0])).toEqual(
        ['./target/bar/baz'].concat(
          lumoPaths.map((p: string) => path.join(p, 'bar/baz')),
        ),
      );
    });

    it('returns the representation for the resource when it exists', async () => {
      fs.existsSync = jest.fn((_: string) => true);
      expect(await lumo.resource('some-file')).toEqual({
        type: 'bundled',
        src: 'some-file',
      });
    });

    describe('reads JAR archives', () => {
      it('should return true when JAR has the file', async () => {
        const srcPaths = ['foo.jar'];
        await lumo.addSourcePaths(srcPaths);

        fs.existsSync = jest.fn((fname: string) => /foo/.test(fname));

        expect(await lumo.resource('some/thing')).toMatchObject({
          type: 'jar',
          src: 'some/thing',
        });
      });

      it("should return false when the JAR doesn't have the file", async () => {
        expect(await lumo.resource('some/thing')).toBe(null);
      });
    });
  });
});
