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

async function getKanbanData() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT
      t.id, t.titulo, t.descricao, t.status, t.prioridade,
      t.data_vencimento, t.posicao, t.data_criacao,
      t.responsavel_nome,
      LEFT(ISNULL(t.responsavel_nome,'?'), 1) AS avatar_initials,
      c.nome AS categoria_nome, c.cor AS categoria_cor,
      (SELECT COUNT(*) FROM CHECKLIST_ITEMS ci WHERE ci.id_tarefa = t.id) AS checklist_total,
      (SELECT COUNT(*) FROM CHECKLIST_ITEMS ci WHERE ci.id_tarefa = t.id AND ci.concluido = 1) AS checklist_done
    FROM TAREFAS t
    LEFT JOIN CATEGORIAS c ON c.id = t.id_categoria
    WHERE t.ativo = 1
    ORDER BY t.posicao ASC, t.id DESC
  `);
  const kanban = { A_FAZER: [], EM_ANDAMENTO: [], EM_REVISAO: [], CONCLUIDO: [] };
  result.recordset.forEach(row => {
    if (kanban[row.status]) kanban[row.status].push(row);
  });
  return kanban;
}

async function getAll() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT
      t.id, t.titulo, t.descricao, t.status, t.prioridade,
      t.data_vencimento, t.posicao, t.ativo, t.criado_por,
      t.data_criacao, t.data_atualizacao,
      t.responsavel_nome,
      LEFT(ISNULL(t.responsavel_nome,'?'), 1) AS avatar_initials,
      c.nome AS categoria_nome, c.cor AS categoria_cor
    FROM TAREFAS t
    LEFT JOIN CATEGORIAS c ON c.id = t.id_categoria
    WHERE t.ativo = 1
    ORDER BY t.id DESC
  `);
  return result.recordset;
}

async function getStats() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT
      COUNT(*)                                                                                  AS total,
      SUM(CASE WHEN status = 'CONCLUIDO' THEN 1 ELSE 0 END)                                   AS concluidas,
      SUM(CASE WHEN status IN ('EM_ANDAMENTO','EM_REVISAO') THEN 1 ELSE 0 END)                AS em_andamento,
      SUM(CASE WHEN status != 'CONCLUIDO' AND data_vencimento < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS atrasadas
    FROM TAREFAS WHERE ativo = 1
  `);
  return result.recordset[0] || { total: 0, concluidas: 0, em_andamento: 0, atrasadas: 0 };
}

async function getChartData() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT
      SUM(CASE WHEN status = 'A_FAZER'      THEN 1 ELSE 0 END) AS a_fazer,
      SUM(CASE WHEN status = 'EM_ANDAMENTO' THEN 1 ELSE 0 END) AS em_andamento,
      SUM(CASE WHEN status = 'EM_REVISAO'   THEN 1 ELSE 0 END) AS em_revisao,
      SUM(CASE WHEN status = 'CONCLUIDO'    THEN 1 ELSE 0 END) AS concluido,
      SUM(CASE WHEN prioridade = 'ALTA'     THEN 1 ELSE 0 END) AS alta,
      SUM(CASE WHEN prioridade = 'MEDIA'    THEN 1 ELSE 0 END) AS media,
      SUM(CASE WHEN prioridade = 'BAIXA'    THEN 1 ELSE 0 END) AS baixa
    FROM TAREFAS WHERE ativo = 1
  `);
  const row = result.recordset[0] || {};
  return {
    porStatus:     [row.a_fazer||0, row.em_andamento||0, row.em_revisao||0, row.concluido||0],
    porPrioridade: [row.alta||0, row.media||0, row.baixa||0],
  };
}

async function getById(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  const result = await request.query(`
    SELECT t.*, c.nome AS categoria_nome
    FROM TAREFAS t
    LEFT JOIN CATEGORIAS c ON c.id = t.id_categoria
    WHERE t.id = @id AND t.ativo = 1
  `);
  return result.recordset[0] || null;
}

async function insert(payload) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('titulo',           sql.VarChar(300), payload.titulo || '');
  request.input('descricao',        sql.Text,         payload.descricao || null);
  request.input('status',           sql.VarChar(20),  payload.status || 'A_FAZER');
  request.input('prioridade',       sql.VarChar(10),  payload.prioridade || 'MEDIA');
  request.input('responsavel_nome', sql.VarChar(200), payload.responsavel_nome || null);
  request.input('id_categoria',     sql.Int,          payload.id_categoria || null);
  request.input('data_vencimento',  sql.Date,         payload.data_vencimento || null);
  request.input('posicao',          sql.Int,          payload.posicao || 0);
  request.input('criado_por',       sql.VarChar(100), payload.criado_por || null);
  request.input('id_workspace',     sql.Int,          payload.id_workspace || null);
  request.input('id_coluna',        sql.Int,          payload.id_coluna || null);

  const result = await request.query(`
    INSERT INTO TAREFAS
      (titulo, descricao, status, prioridade, responsavel_nome, id_categoria, data_vencimento, posicao, criado_por, id_workspace, id_coluna)
    OUTPUT INSERTED.id
    VALUES
      (@titulo, @descricao, @status, @prioridade, @responsavel_nome, @id_categoria, @data_vencimento, @posicao, @criado_por, @id_workspace, @id_coluna)
  `);
  return result.recordset[0].id;
}

async function update(id, payload) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id',               sql.Int,          id);
  request.input('titulo',           sql.VarChar(300), payload.titulo || '');
  request.input('descricao',        sql.Text,         payload.descricao || null);
  request.input('status',           sql.VarChar(20),  payload.status || 'A_FAZER');
  request.input('prioridade',       sql.VarChar(10),  payload.prioridade || 'MEDIA');
  request.input('responsavel_nome', sql.VarChar(200), payload.responsavel_nome || null);
  request.input('id_categoria',     sql.Int,          payload.id_categoria || null);
  request.input('data_vencimento',  sql.Date,         payload.data_vencimento || null);
  request.input('id_workspace',     sql.Int,          payload.id_workspace !== undefined ? payload.id_workspace : null);
  request.input('id_coluna',        sql.Int,          payload.id_coluna !== undefined ? payload.id_coluna : null);

  await request.query(`
    UPDATE TAREFAS SET
      titulo           = @titulo,
      descricao        = @descricao,
      status           = @status,
      prioridade       = @prioridade,
      responsavel_nome = @responsavel_nome,
      id_categoria     = @id_categoria,
      data_vencimento  = @data_vencimento,
      id_workspace     = CASE WHEN @id_workspace IS NOT NULL THEN @id_workspace ELSE id_workspace END,
      id_coluna        = CASE WHEN @id_coluna IS NOT NULL THEN @id_coluna ELSE id_coluna END,
      data_atualizacao = GETDATE()
    WHERE id = @id AND ativo = 1
  `);
}

async function updateStatus(id, newStatus) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id',     sql.Int,        id);
  request.input('status', sql.VarChar(20), newStatus);
  await request.query(`
    UPDATE TAREFAS SET status = @status, data_atualizacao = GETDATE()
    WHERE id = @id AND ativo = 1
  `);
}

async function updatePosicoes(items) {
  const pool = await getPool();
  for (const item of items) {
    const request = pool.request();
    request.input('id',      sql.Int,         item.id);
    request.input('posicao', sql.Int,         item.posicao);
    request.input('status',  sql.VarChar(20), item.status || null);
    await request.query(`
      UPDATE TAREFAS SET posicao = @posicao, status = @status, data_atualizacao = GETDATE()
      WHERE id = @id AND ativo = 1
    `);
  }
}

async function updatePosicoesWorkspace(items) {
  const pool = await getPool();
  for (const item of items) {
    const request = pool.request();
    request.input('id',        sql.Int, item.id);
    request.input('posicao',   sql.Int, item.posicao);
    request.input('id_coluna', sql.Int, item.id_coluna || null);
    await request.query(`
      UPDATE TAREFAS SET
        posicao          = @posicao,
        id_coluna        = ISNULL(@id_coluna, id_coluna),
        data_atualizacao = GETDATE()
      WHERE id = @id AND ativo = 1
    `);
  }
}

async function deleteById(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  await request.query(`UPDATE TAREFAS SET ativo = 0 WHERE id = @id`);
}

async function getChecklistItems(tarefaId) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_tarefa', sql.Int, tarefaId);
  const result = await request.query(`
    SELECT id, descricao, concluido, posicao
    FROM CHECKLIST_ITEMS
    WHERE id_tarefa = @id_tarefa
    ORDER BY posicao ASC
  `);
  return result.recordset;
}

async function addChecklistItem(tarefaId, descricao) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_tarefa', sql.Int,         tarefaId);
  request.input('descricao', sql.VarChar(500), descricao);
  const result = await request.query(`
    INSERT INTO CHECKLIST_ITEMS (id_tarefa, descricao, posicao)
    OUTPUT INSERTED.id
    VALUES (@id_tarefa, @descricao,
      (SELECT ISNULL(MAX(posicao),0)+1 FROM CHECKLIST_ITEMS WHERE id_tarefa = @id_tarefa))
  `);
  return result.recordset[0].id;
}

async function toggleChecklistItem(itemId) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, itemId);
  const result = await request.query(`
    UPDATE CHECKLIST_ITEMS SET concluido = 1 - concluido
    OUTPUT INSERTED.concluido
    WHERE id = @id
  `);
  return result.recordset[0] ? result.recordset[0].concluido : 0;
}

async function deleteChecklistItem(itemId) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, itemId);
  await request.query(`DELETE FROM CHECKLIST_ITEMS WHERE id = @id`);
}

async function updateChecklistItem(itemId, descricao) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id',        sql.Int,          itemId);
  request.input('descricao', sql.VarChar(500),  descricao);
  await request.query(`UPDATE CHECKLIST_ITEMS SET descricao = @descricao WHERE id = @id`);
}

async function reorderChecklistItems(items) {
  const pool = await getPool();
  for (const item of items) {
    const request = pool.request();
    request.input('id',      sql.Int, item.id);
    request.input('posicao', sql.Int, item.posicao);
    await request.query(`UPDATE CHECKLIST_ITEMS SET posicao = @posicao WHERE id = @id`);
  }
}

async function getResponsaveis() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT responsavel_nome AS nome
    FROM TAREFAS
    WHERE responsavel_nome IS NOT NULL AND ativo = 1
    ORDER BY responsavel_nome
  `);
  return result.recordset;
}

async function getCategorias() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT id, nome, cor, icone FROM CATEGORIAS WHERE ativo = 1 ORDER BY nome
  `);
  return result.recordset;
}

module.exports = {
  getKanbanData,
  getAll,
  getStats,
  getChartData,
  getById,
  insert,
  update,
  updateStatus,
  updatePosicoes,
  updatePosicoesWorkspace,
  deleteById,
  getChecklistItems,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  updateChecklistItem,
  reorderChecklistItems,
  getResponsaveis,
  getCategorias,
};
