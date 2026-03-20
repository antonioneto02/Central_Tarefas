'use strict';

const sql      = require('mssql');
const dbConfig = require('../config/dbConfig');

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

async function getAll(userId, includeArchived = false) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('userId',   sql.VarChar(200), userId);
  request.input('arquivado', sql.Bit, includeArchived ? 1 : 0);

  const result = await request.query(`
    SELECT
      a.id, a.titulo, a.conteudo, a.cor, a.fixado, a.arquivado,
      a.data_criacao, a.data_atualizacao,
      STUFF((
        SELECT ', ' + e.nome
        FROM ANOTACOES_ETIQUETAS ae2
        JOIN ETIQUETAS e ON e.id = ae2.id_etiqueta
        WHERE ae2.id_anotacao = a.id
        FOR XML PATH(''), TYPE
      ).value('.','NVARCHAR(MAX)'), 1, 2, '') AS etiquetas_nomes,
      STUFF((
        SELECT ',' + CAST(ae3.id_etiqueta AS VARCHAR)
        FROM ANOTACOES_ETIQUETAS ae3
        WHERE ae3.id_anotacao = a.id
        FOR XML PATH(''), TYPE
      ).value('.','NVARCHAR(MAX)'), 1, 1, '') AS etiquetas_ids
    FROM ANOTACOES a
    WHERE a.id_usuario = @userId AND a.arquivado = @arquivado
    ORDER BY a.fixado DESC, a.data_atualizacao DESC
  `);
  return result.recordset;
}

async function getById(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  const result = await request.query(`SELECT * FROM ANOTACOES WHERE id = @id`);
  return result.recordset[0] || null;
}

async function insert(payload) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('titulo',     sql.VarChar(300), payload.titulo || null);
  request.input('conteudo',   sql.Text,         payload.conteudo || null);
  request.input('cor',        sql.VarChar(30),  payload.cor || 'default');
  request.input('fixado',     sql.Bit,          payload.fixado ? 1 : 0);
  request.input('id_usuario', sql.VarChar(200), payload.id_usuario || null);

  const result = await request.query(`
    INSERT INTO ANOTACOES (titulo, conteudo, cor, fixado, id_usuario)
    OUTPUT INSERTED.id
    VALUES (@titulo, @conteudo, @cor, @fixado, @id_usuario)
  `);
  return result.recordset[0].id;
}

async function update(id, payload) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id',       sql.Int,         id);
  request.input('titulo',   sql.VarChar(300), payload.titulo || null);
  request.input('conteudo', sql.Text,         payload.conteudo || null);
  request.input('cor',      sql.VarChar(30),  payload.cor || 'default');

  await request.query(`
    UPDATE ANOTACOES SET
      titulo           = @titulo,
      conteudo         = @conteudo,
      cor              = @cor,
      data_atualizacao = GETDATE()
    WHERE id = @id
  `);
}

async function toggleFixado(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  const result = await request.query(`
    UPDATE ANOTACOES SET fixado = 1 - fixado, data_atualizacao = GETDATE()
    OUTPUT INSERTED.fixado
    WHERE id = @id
  `);
  return result.recordset[0] ? result.recordset[0].fixado : 0;
}

async function toggleArquivado(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  const result = await request.query(`
    UPDATE ANOTACOES SET arquivado = 1 - arquivado, data_atualizacao = GETDATE()
    OUTPUT INSERTED.arquivado
    WHERE id = @id
  `);
  return result.recordset[0] ? result.recordset[0].arquivado : 0;
}

async function deleteById(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  await request.query(`DELETE FROM ANOTACOES WHERE id = @id`);
}

async function getEtiquetas() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT id, nome, cor FROM ETIQUETAS ORDER BY nome
  `);
  return result.recordset;
}

async function addEtiquetaToNota(notaId, etiquetaId) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_anotacao', sql.Int, notaId);
  request.input('id_etiqueta', sql.Int, etiquetaId);
  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM ANOTACOES_ETIQUETAS WHERE id_anotacao = @id_anotacao AND id_etiqueta = @id_etiqueta)
      INSERT INTO ANOTACOES_ETIQUETAS (id_anotacao, id_etiqueta) VALUES (@id_anotacao, @id_etiqueta)
  `);
}

async function removeEtiquetaFromNota(notaId, etiquetaId) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_anotacao', sql.Int, notaId);
  request.input('id_etiqueta', sql.Int, etiquetaId);
  await request.query(`
    DELETE FROM ANOTACOES_ETIQUETAS WHERE id_anotacao = @id_anotacao AND id_etiqueta = @id_etiqueta
  `);
}

module.exports = {
  getAll,
  getById,
  insert,
  update,
  toggleFixado,
  toggleArquivado,
  deleteById,
  getEtiquetas,
  addEtiquetaToNota,
  removeEtiquetaFromNota,
};
