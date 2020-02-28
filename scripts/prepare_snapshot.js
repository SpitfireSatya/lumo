/* eslint-disable padded-blocks */
/* eslint-disable global-require */
/* eslint-disable func-names */
/* eslint-disable flowtype/require-return-type */

(async function () {

  const fs = require('fs');

  const x = await fs.promises.readFile('target/main.js', 'utf8');

  await fs.promises.writeFile(
    'target/main.js',
    x.replace(/var boot={cljs:{}};boot.cljs.*?={};/, ''),
    'utf8',
  );

}());
