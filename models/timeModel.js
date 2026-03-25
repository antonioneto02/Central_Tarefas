'use strict';

const sql        = require('mssql');
const dbConfig   = require('../config/dbConfig');
const dbConfigDw = require('../config/dbConfigDw');

let _pool = null;
let _poolPromise = null;

async function getPool() {
  if (_pool && _pool.connected) return _pool;
  if (!_poolPromise) {
    _poolPromise = (async () => {
      try {
        const pool = new sql.ConnectionPool(dbConfig);
        _pool = await pool.connect();
        _pool.on('error', () => { _pool = null; _poolPromise = null; });
        return _pool;
      } catch (err) {
        _poolPromise = null;
        throw err;
      }
    })();
  }
  return _poolPromise;
}

async function buscarUsuarios(nome) {
  let pool = null;
  try {
    const connectionPool = new sql.ConnectionPool(dbConfigDw);
    pool = await connectionPool.connect();
    if (!nome) {
      const result = await pool.request().query(`SELECT TOP 1000 * FROM [${dbConfigDw.database}].[dbo].[SYS_USR] WHERE D_E_L_E_T_ <> '*'`);
      return {
        colunas: result.recordset.length > 0 ? Object.keys(result.recordset[0]) : [],
        registros: result.recordset,
      };
    }

    const colsRes = await pool.request()
      .input('tableName', sql.VarChar(128), 'SYS_USR')
      .query(`SELECT COLUMN_NAME FROM [${dbConfigDw.database}].INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tableName`);

    const availableCols = colsRes.recordset.map(r => r.COLUMN_NAME);
    const desiredCols = ['USR_ID','USR_CODIGO','USR_NOME','USR_CARGO'];
    const showCols = desiredCols.filter(c => availableCols.includes(c));
      const selectClause = (showCols && showCols.length > 0) ? showCols.map(c => `[${c}]`).join(', ') : '*';
      const termo = '%' + nome + '%';
      const request = pool.request();
      request.input('termo', sql.VarChar(200), termo);
      const whereParts = [];
      if (availableCols.includes('USR_CODIGO')) whereParts.push('[USR_CODIGO] LIKE @termo');
      if (availableCols.includes('USR_NOME'))   whereParts.push('[USR_NOME] LIKE @termo');
      if (whereParts.length === 0) {
        const textCols = availableCols.filter(c => typeof c === 'string');
        for (const c of textCols) whereParts.push('[' + c + '] LIKE @termo');
      }

      const sqlText = `SELECT TOP 1000 ${selectClause} FROM [${dbConfigDw.database}].[dbo].[SYS_USR] WHERE D_E_L_E_T_ <> '*' AND (${whereParts.join(' OR ')})`;
      const result = await request.query(sqlText);
      return {
        colunas: showCols && showCols.length > 0 ? showCols : (result.recordset.length > 0 ? Object.keys(result.recordset[0]) : []),
        registros: result.recordset,
      };
  } catch (error) {
    throw error;
  } finally {
    if (pool) {
      try { await pool.close(); } catch (_) {}
    }
  }
  }

async function getMembros(timeId) {
  const pool = await getPool();
  const colsRes = await pool.request()
    .query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TIME_MEMBROS'`);
  const colNames = colsRes.recordset.map(r => r.COLUMN_NAME);
  const usrIdCol = colNames.find(c => c.toUpperCase() === 'USR_ID');
  const timeIdCol = colNames.find(c => c.toUpperCase() === 'TIME_ID');

  const selectCols = ['id', 'codigo', 'nome', 'grupo', 'data_cadastro'];
  if (usrIdCol) selectCols.splice(1, 0, usrIdCol);
  if (timeIdCol) selectCols.splice((usrIdCol ? 2 : 1), 0, timeIdCol);

  let request = pool.request();
  let sqlText = `SELECT ${selectCols.join(', ')} FROM TIME_MEMBROS WHERE ativo = 1`;
  if (timeIdCol && timeId) {
    request.input('timeId', sql.Int, parseInt(timeId, 10));
    sqlText += ` AND ${timeIdCol} = @timeId`;
  }
  sqlText += ` ORDER BY nome`;

  const result = await request.query(sqlText);
  const rows = result.recordset.map(r => {
    if (usrIdCol) r.usr_id = r[usrIdCol];
    if (timeIdCol) r.time_id = r[timeIdCol];
    return r;
  });
  return rows;
}

async function addMembro(codigo, nome, grupo) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('codigo', sql.VarChar(200),  codigo || '');
  request.input('nome',   sql.VarChar(200), nome   || '');
  request.input('grupo',  sql.VarChar(100), grupo  || null);
  const colsRes = await pool.request()
    .query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TIME_MEMBROS'`);
  const colNames = colsRes.recordset.map(r => r.COLUMN_NAME);
  const usrIdCol = colNames.find(c => c.toUpperCase() === 'USR_ID');
  const timeIdCol = colNames.find(c => c.toUpperCase() === 'TIME_ID');

  if (usrIdCol) {
    request.input('usrId', sql.VarChar(200), arguments[3] || null);
    if (timeIdCol) {
      request.input('timeId', sql.Int, arguments[4] || null);
      const sqlText = `INSERT INTO TIME_MEMBROS (codigo, ${usrIdCol}, ${timeIdCol}, nome, grupo) OUTPUT INSERTED.id VALUES (@codigo, @usrId, @timeId, @nome, @grupo)`;
      const result = await request.query(sqlText);
      return result.recordset[0].id;
    }
    const sqlText = `INSERT INTO TIME_MEMBROS (codigo, ${usrIdCol}, nome, grupo) OUTPUT INSERTED.id VALUES (@codigo, @usrId, @nome, @grupo)`;
    const result = await request.query(sqlText);
    return result.recordset[0].id;
  }
  const result = await request.query(`
    INSERT INTO TIME_MEMBROS (codigo, nome, grupo)
    OUTPUT INSERTED.id
    VALUES (@codigo, @nome, @grupo)
  `);
  return result.recordset[0].id;
}

async function removeMembro(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  await request.query(`UPDATE TIME_MEMBROS SET ativo = 0 WHERE id = @id`);
}

module.exports = { buscarUsuarios, getMembros, addMembro, removeMembro };
module.exports.getTimes = async function () {
  const pool = await getPool();

  const colsRes = await pool.request().query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TIME_MEMBROS' AND COLUMN_NAME = 'TIME_ID'`
  );
  const hasTimeId = colsRes.recordset.length > 0;

  let sqlText;
  if (hasTimeId) {
    sqlText = `
      SELECT t.id, t.codigo, t.nome, t.descricao, t.criado_em, t.ativo,
        (SELECT COUNT(*) FROM TIME_MEMBROS m WHERE m.ativo = 1 AND m.TIME_ID = t.id) AS total_membros
      FROM TIME_TIMES t WHERE t.ativo = 1 ORDER BY t.nome`;
  } else {
    sqlText = `
      SELECT t.id, t.codigo, t.nome, t.descricao, t.criado_em, t.ativo,
        (SELECT COUNT(*) FROM TIME_MEMBROS m WHERE m.ativo = 1) AS total_membros
      FROM TIME_TIMES t WHERE t.ativo = 1 ORDER BY t.nome`;
  }

  const result = await pool.request().query(sqlText);
  return result.recordset;
};

module.exports.addTime = async function (codigo, nome, descricao) {
  const pool = await getPool();
  const request = pool.request();
  request.input('codigo',    sql.VarChar(100), codigo    || null);
  request.input('nome',      sql.VarChar(200), nome      || null);
  request.input('descricao', sql.VarChar(500), descricao || null);
  const result = await request.query(`INSERT INTO TIME_TIMES (codigo, nome, descricao) OUTPUT INSERTED.id VALUES (@codigo, @nome, @descricao)`);
  return result.recordset[0].id;
};

module.exports.updateTime = async function (id, codigo, nome, descricao) {
  const pool = await getPool();
  const request = pool.request();
  request.input('id',        sql.Int,          id);
  request.input('codigo',    sql.VarChar(100), codigo    || null);
  request.input('nome',      sql.VarChar(200), nome      || null);
  request.input('descricao', sql.VarChar(500), descricao || null);
  await request.query(`UPDATE TIME_TIMES SET codigo = @codigo, nome = @nome, descricao = @descricao WHERE id = @id`);
};

module.exports.deleteTime = async function (id) {
  const pool = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  await request.query(`UPDATE TIME_TIMES SET ativo = 0 WHERE id = @id`);
};
