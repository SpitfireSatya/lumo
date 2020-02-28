/* eslint-disable padded-blocks */
/* eslint-disable no-useless-escape */
/* eslint-disable no-console */
/* eslint-disable no-nested-ternary */
/* eslint-disable flowtype/require-parameter-type */
/* eslint-disable global-require */
/* eslint-disable no-unused-vars */
/* eslint-disable func-names */
/* eslint-disable flowtype/require-return-type */
(async function () {

  const async = require('async');
  const nexe = require('../vendor/nexe');
  const monkeyPatch = require('../vendor/nexe/monkeypatch');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const zlib = require('zlib');
  const embed = require('./embed');

  const argv = process.argv.slice(0);
  const nodeVersion = argv[2];
  const staticBinary = /^true$/.test(argv[3]);

  async function getDirContents(dir, accumPath = dir) {
    const filenames = await fs.promises.readdir(dir);

    return filenames.reduce((ret, filename) => {
      const fname = path.resolve(accumPath, filename);
      const fStat = fs.statSync(fname);

      if (fStat.isDirectory()) {
        const newAccum = path.join(accumPath, filename);
        return ret.concat(getDirContents(newAccum, newAccum));
      }

      ret.push(path.join(accumPath, filename));
      return ret;
    }, []);
  }

  function deflate(fname) {
    return new Promise((resolve, reject) => {
      fs.readFile(fname, (err, input) => {
        fs.writeFileSync(fname, zlib.deflateSync(input));
        resolve();
      });
    });
  }

  const isWindows = /^Windows/.test(os.type());
  const outputPath = `build/${isWindows ? 'lumo.exe' : 'lumo'}`;

  const resources = getDirContents('target').filter(
    fname =>
      fname.endsWith('.aot.js.map') ||
      (!fname.endsWith('main.js') &&
        !fname.endsWith('bundle.js') &&
        !fname.endsWith('bundle.min.js') &&
        !fname.endsWith('google-closure-compiler-js.js') &&
        !fname.endsWith('aot.edn') &&
        !/target[\\\/]cljs[\\/]core.js/.test(fname) &&
        !fname.endsWith('.map')),
  );

  await Promise.all(resources.map(deflate)).then(async () => {
    await embed(resources, 'target');
    const options = {
      input: 'target/bundle.min.js',
      output: outputPath,
      nodeTempDir: 'tmp',
      nodeConfigureArgs: [
        '--without-dtrace',
        '--without-npm',
        '--without-inspector',
        '--without-etw',
        '--with-snapshot',
      ].concat(
        isWindows
          ? ['--openssl-no-asm']
          : staticBinary
          ? ['--fully-static']
          : [],
      ),
      nodeMakeArgs: ['-j', '8'],
      nodeVCBuildArgs: ['nosign', 'x64', 'noetw'],
      flags: true,
      startupSnapshot: 'target/main.js',
      noBundle: true,
      framework: 'node',
      nodeVersion,
    };

    console.dir(options);

    nexe.compile(options, (err) => {
      if (err) {
        throw err;
      }
      console.log(
        `Finished bundling. Nexe binary can be found in ${outputPath}`,
      );
    });
  });

}());
