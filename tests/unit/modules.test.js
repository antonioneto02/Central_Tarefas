'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const modules = [
  ['loginController', '../../controllers/loginController'],
  ['anotacaoModel', '../../models/anotacaoModel'],
  ['tarefaModel', '../../models/tarefaModel'],
  ['timeModel', '../../models/timeModel'],
  ['workspaceModel', '../../models/workspaceModel'],
];

test('modules', async (t) => {
  for (const [name, rel] of modules) {
    await t.test(`${name} carrega e exporta um objeto de funções não vazio`, () => {
      const mod = require(path.join(__dirname, rel));
      assert.equal(typeof mod, 'object', `${name} não exporta um objeto`);
      const keys = Object.keys(mod);
      assert.ok(keys.length > 0, `${name} não exporta nada`);
      for (const key of keys) {
        // Alguns módulos exportam constantes/config junto com funções
        // (ex: workspaceModel.DEFAULT_COLUNAS).
        assert.ok(['function', 'string', 'number', 'object'].includes(typeof mod[key]), `${name}.${key} tem tipo inesperado`);
      }
    });
  }
});
