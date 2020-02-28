/* eslint-disable no-await-in-loop */
/* eslint-disable no-return-await */
/* eslint-disable flowtype/require-parameter-type */
/* eslint-disable flowtype/require-return-type */
const path = require('path');
const fs = require('fs');

function accessor(key) {
  const resource = lumo.internal.embedded.resources[key];
  if (resource != null) {
    return Buffer.from(resource, 'base64');
  }
}

async function encode(filePath) {
  return await fs.promises.readFile(filePath).toString('base64');
}

async function embed(resourceFiles = [], resourceRoot = '') {
  if (!Array.isArray(resourceFiles)) {
    throw new Error('Bad Argument: resourceFiles is not an array');
  }

  let buffer =
    '\nlumo.internal={embedded: {}};lumo.internal.embedded.resources={\n';
  for (let i = 0; i < resourceFiles.length; i++) {
    buffer +=
      `${JSON.stringify(path.relative(resourceRoot, resourceFiles[i]))}:"`;
    buffer += `${await encode(resourceFiles[i])}",\n`;
  }

  buffer +=
    '\n};\n\nlumo.internal.embedded.keys=function(){return Object.keys(lumo.internal.embedded.resources);}';
  buffer += '\n\nlumo.internal.embedded.get=';
  buffer += accessor.toString();
  fs.appendFileSync('target/main.js', buffer);
}

module.exports = embed;
