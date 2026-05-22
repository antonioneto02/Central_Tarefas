'use strict';
const { QueryTypes } = require('sequelize');
const sequelizeCt = require('../database/sequelize/dbSequelizeCt');
const sequelizeDw = require('../database/sequelize/dbSequelizeDw');

async function buscarUsuarios(nome) {
  if (!nome) {
    const result = await sequelizeDw.query(
      "SELECT TOP 1000 * FROM [dbo].[SYS_USR] WHERE D_E_L_E_T_ <> '*'",
      { type: QueryTypes.SELECT }
    );
    return {
      colunas: result.length > 0 ? Object.keys(result[0]) : [],
      registros: result,
    };
  }
  const colsRes = await sequelizeDw.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :tableName",
    { replacements: { tableName: 'SYS_USR' }, type: QueryTypes.SELECT }
  );
  const availableCols = colsRes.map(r => r.COLUMN_NAME);
  const desiredCols = ['USR_ID','USR_CODIGO','USR_NOME','USR_CARGO'];
  const showCols = desiredCols.filter(c => availableCols.includes(c));
  const selectClause = (showCols && showCols.length > 0) ? showCols.map(c => '[' + c + ']').join(', ') : '*';
  const termo = '%' + nome + '%';
  const whereParts = [];
  if (availableCols.includes('USR_CODIGO')) whereParts.push('[USR_CODIGO] LIKE :termo');
  if (availableCols.includes('USR_NOME'))   whereParts.push('[USR_NOME] LIKE :termo');
  if (whereParts.length === 0) {
    for (const c of availableCols.filter(c => typeof c === 'string'))
      whereParts.push('[' + c + '] LIKE :termo');
  }
  const sqlText = "SELECT TOP 1000 " + selectClause + " FROM [dbo].[SYS_USR] WHERE D_E_L_E_T_ <> '*' AND (" + whereParts.join(' OR ') + ")";
  const result = await sequelizeDw.query(sqlText, { replacements: { termo }, type: QueryTypes.SELECT });
  return {
    colunas: showCols && showCols.length > 0 ? showCols : (result.length > 0 ? Object.keys(result[0]) : []),
    registros: result,
  };
}

async function getMembros(timeId) {
  const colsRes = await sequelizeCt.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TIME_MEMBROS'",
    { type: QueryTypes.SELECT }
  );
  const colNames = colsRes.map(r => r.COLUMN_NAME);
  const usrIdCol = colNames.find(c => c.toUpperCase() === 'USR_ID');
  const timeIdCol = colNames.find(c => c.toUpperCase() === 'TIME_ID');
  const selectCols = ['id', 'codigo', 'nome', 'grupo', 'data_cadastro'];
  if (usrIdCol) selectCols.splice(1, 0, usrIdCol);
  if (timeIdCol) selectCols.splice((usrIdCol ? 2 : 1), 0, timeIdCol);
  let sqlText = 'SELECT ' + selectCols.join(', ') + ' FROM TIME_MEMBROS WHERE ativo = 1';
  const replacements = {};
  if (timeIdCol && timeId) {
    sqlText += ' AND ' + timeIdCol + ' = :timeId';
    replacements.timeId = parseInt(timeId, 10);
  }
  sqlText += ' ORDER BY nome';
  const result = await sequelizeCt.query(sqlText, { replacements, type: QueryTypes.SELECT });
  return result.map(r => {
    if (usrIdCol) r.usr_id = r[usrIdCol];
    if (timeIdCol) r.time_id = r[timeIdCol];
    return r;
  });
}

async function addMembro(codigo, nome, grupo) {
  const colsRes = await sequelizeCt.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TIME_MEMBROS'",
    { type: QueryTypes.SELECT }
  );
  const colNames = colsRes.map(r => r.COLUMN_NAME);
  const usrIdCol = colNames.find(c => c.toUpperCase() === 'USR_ID');
  const timeIdCol = colNames.find(c => c.toUpperCase() === 'TIME_ID');
  const usrId = arguments[3] || null;
  if (usrIdCol) {
    if (timeIdCol) {
      const timeId = arguments[4] || null;
      const r = await sequelizeCt.query(
        'INSERT INTO TIME_MEMBROS (codigo, ' + usrIdCol + ', ' + timeIdCol + ', nome, grupo) OUTPUT INSERTED.id VALUES (:codigo, :usrId, :timeId, :nome, :grupo)',
        { replacements: { codigo: codigo||'', nome: nome||'', grupo: grupo||null, usrId, timeId }, type: QueryTypes.SELECT }
      );
      return r[0].id;
    }
    const r = await sequelizeCt.query(
      'INSERT INTO TIME_MEMBROS (codigo, ' + usrIdCol + ', nome, grupo) OUTPUT INSERTED.id VALUES (:codigo, :usrId, :nome, :grupo)',
      { replacements: { codigo: codigo||'', nome: nome||'', grupo: grupo||null, usrId }, type: QueryTypes.SELECT }
    );
    return r[0].id;
  }
  const r = await sequelizeCt.query(
    'INSERT INTO TIME_MEMBROS (codigo, nome, grupo) OUTPUT INSERTED.id VALUES (:codigo, :nome, :grupo)',
    { replacements: { codigo: codigo||'', nome: nome||'', grupo: grupo||null }, type: QueryTypes.SELECT }
  );
  return r[0].id;
}

async function removeMembro(id) {
  await sequelizeCt.query('UPDATE TIME_MEMBROS SET ativo = 0 WHERE id = :id',
    { replacements: { id }, type: QueryTypes.UPDATE });
}

module.exports = { buscarUsuarios, getMembros, addMembro, removeMembro };

module.exports.getTimes = async function () {
  const colsRes = await sequelizeCt.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TIME_MEMBROS' AND COLUMN_NAME = 'TIME_ID'",
    { type: QueryTypes.SELECT }
  );
  const hasTimeId = colsRes.length > 0;
  const sqlText = hasTimeId
    ? `SELECT t.id, t.codigo, t.nome, t.descricao, t.criado_em, t.ativo,
        (SELECT COUNT(*) FROM TIME_MEMBROS m WHERE m.ativo = 1 AND m.TIME_ID = t.id) AS total_membros
      FROM TIME_TIMES t WHERE t.ativo = 1 ORDER BY t.nome`
    : `SELECT t.id, t.codigo, t.nome, t.descricao, t.criado_em, t.ativo,
        (SELECT COUNT(*) FROM TIME_MEMBROS m WHERE m.ativo = 1) AS total_membros
      FROM TIME_TIMES t WHERE t.ativo = 1 ORDER BY t.nome`;
  return await sequelizeCt.query(sqlText, { type: QueryTypes.SELECT });
};

module.exports.addTime = async function (codigo, nome, descricao) {
  const r = await sequelizeCt.query(
    'INSERT INTO TIME_TIMES (codigo, nome, descricao) OUTPUT INSERTED.id VALUES (:codigo, :nome, :descricao)',
    { replacements: { codigo: codigo||null, nome: nome||null, descricao: descricao||null }, type: QueryTypes.SELECT }
  );
  return r[0].id;
};

module.exports.updateTime = async function (id, codigo, nome, descricao) {
  await sequelizeCt.query(
    'UPDATE TIME_TIMES SET codigo = :codigo, nome = :nome, descricao = :descricao WHERE id = :id',
    { replacements: { id, codigo: codigo||null, nome: nome||null, descricao: descricao||null }, type: QueryTypes.UPDATE }
  );
};

module.exports.deleteTime = async function (id) {
  await sequelizeCt.query('UPDATE TIME_TIMES SET ativo = 0 WHERE id = :id',
    { replacements: { id }, type: QueryTypes.UPDATE });
};
