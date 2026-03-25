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

const DEFAULT_COLUNAS = [
  { id: null, nome: 'A Fazer',      cor: '#94a3b8', chave: 'A_FAZER'      },
  { id: null, nome: 'Em Andamento', cor: '#f59e0b', chave: 'EM_ANDAMENTO' },
  { id: null, nome: 'Em Revisão',   cor: '#6366f1', chave: 'EM_REVISAO'   },
  { id: null, nome: 'Concluído',    cor: '#22c55e', chave: 'CONCLUIDO'    },
];

async function getAll(username) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('username', sql.VarChar(200), username);
  const result = await request.query(`
    SELECT DISTINCT
      w.id, w.nome, w.descricao, w.criado_por, w.privado, w.data_criacao, w.ativo,
      (SELECT COUNT(*) FROM TAREFAS t WHERE t.id_workspace = w.id AND t.ativo = 1) AS total_tarefas
    FROM WORKSPACES w
    WHERE w.ativo = 1
      AND (
        w.criado_por = @username
        OR (
          w.privado = 0
          AND (
            EXISTS (
              SELECT 1 FROM WORKSPACE_ACESSOS wa
              WHERE wa.id_workspace = w.id
                AND wa.tipo = 'usuario'
                AND wa.codigo = @username
            )
            OR EXISTS (
              SELECT 1 FROM WORKSPACE_ACESSOS wa
              JOIN TIME_MEMBROS tm ON tm.grupo = wa.codigo
              WHERE wa.id_workspace = w.id
                AND wa.tipo = 'grupo'
                AND (tm.codigo = @username OR tm.nome = @username)
                AND tm.ativo = 1
            )
            OR NOT EXISTS (
              SELECT 1 FROM WORKSPACE_ACESSOS wa2
              WHERE wa2.id_workspace = w.id
            )
          )
        )
      )
    ORDER BY w.data_criacao DESC
  `);
  return result.recordset;
}

async function getById(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  const result = await request.query(`
    SELECT w.id, w.nome, w.descricao, w.criado_por, w.privado, w.data_criacao, w.ativo
    FROM WORKSPACES w
    WHERE w.id = @id AND w.ativo = 1
  `);
  return result.recordset[0] || null;
}

async function create({ nome, descricao, criado_por, privado }) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('nome',       sql.VarChar(200), nome || '');
  request.input('descricao',  sql.VarChar(500), descricao || null);
  request.input('criado_por', sql.VarChar(200), criado_por || '');
  request.input('privado',    sql.Bit,          privado ? 1 : 0);
  const result = await request.query(`
    INSERT INTO WORKSPACES (nome, descricao, criado_por, privado)
    OUTPUT INSERTED.id
    VALUES (@nome, @descricao, @criado_por, @privado)
  `);
  return result.recordset[0].id;
}

async function getColunas(id_workspace) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_workspace', sql.Int, id_workspace);
  const result = await request.query(`
    SELECT id, id_workspace, nome, cor, posicao
    FROM WORKSPACE_COLUNAS
    WHERE id_workspace = @id_workspace AND ativo = 1
    ORDER BY posicao ASC
  `);
  return result.recordset;
}

async function addColuna(id_workspace, nome, cor, posicao) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_workspace', sql.Int,         id_workspace);
  request.input('nome',         sql.VarChar(100), nome || '');
  request.input('cor',          sql.VarChar(20),  cor || '#6366f1');
  request.input('posicao',      sql.Int,          posicao || 0);
  const result = await request.query(`
    INSERT INTO WORKSPACE_COLUNAS (id_workspace, nome, cor, posicao)
    OUTPUT INSERTED.id
    VALUES (@id_workspace, @nome, @cor, @posicao)
  `);
  return result.recordset[0].id;
}

async function deleteColuna(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  await request.query(`UPDATE WORKSPACE_COLUNAS SET ativo = 0 WHERE id = @id`);
}

async function reorderColunas(items) {
  const pool = await getPool();
  for (const item of items) {
    const request = pool.request();
    request.input('id', sql.Int, item.id);
    request.input('posicao', sql.Int, item.posicao);
    await request.query(`UPDATE WORKSPACE_COLUNAS SET posicao = @posicao WHERE id = @id`);
  }
}

async function getAcessos(id_workspace) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_workspace', sql.Int, id_workspace);
  const result = await request.query(`
    SELECT id, id_workspace, tipo, codigo, nome_display, permissao
    FROM WORKSPACE_ACESSOS
    WHERE id_workspace = @id_workspace
  `);
  return result.recordset;
}

async function addAcesso(id_workspace, tipo, codigo, nome_display, permissao) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_workspace', sql.Int,         id_workspace);
  request.input('tipo',         sql.VarChar(50),  tipo);
  request.input('codigo',       sql.VarChar(200), codigo);
  request.input('nome_display', sql.VarChar(200), nome_display || null);
  request.input('permissao',    sql.VarChar(50),  permissao || 'editor');
  const result = await request.query(`
    INSERT INTO WORKSPACE_ACESSOS (id_workspace, tipo, codigo, nome_display, permissao)
    OUTPUT INSERTED.id
    VALUES (@id_workspace, @tipo, @codigo, @nome_display, @permissao)
  `);
  return result.recordset[0].id;
}

async function removeAcesso(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  await request.query(`DELETE FROM WORKSPACE_ACESSOS WHERE id = @id`);
}

async function softDelete(id) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id', sql.Int, id);
  await request.query(`UPDATE WORKSPACES SET ativo = 0 WHERE id = @id`);
}

async function hasAccess(id_workspace, username) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_workspace', sql.Int,         id_workspace);
  request.input('username',     sql.VarChar(200), username);
  const colsRes = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TIME_MEMBROS' AND COLUMN_NAME = 'TIME_ID'");
  const hasTimeId = colsRes.recordset.length > 0;
  const sqlText = `
    SELECT TOP 1 1 AS ok
    FROM WORKSPACES w
    WHERE w.id = @id_workspace AND w.ativo = 1
      AND (
        w.criado_por = @username
        OR (
          w.privado = 0
          AND (
            EXISTS (
              SELECT 1 FROM WORKSPACE_ACESSOS wa
              WHERE wa.id_workspace = w.id
                AND wa.tipo = 'usuario'
                AND wa.codigo = @username
            )
            OR EXISTS (
              SELECT 1 FROM WORKSPACE_ACESSOS wa
              JOIN TIME_MEMBROS tm ON tm.grupo = wa.codigo
              WHERE wa.id_workspace = w.id
                AND wa.tipo = 'grupo'
                AND (tm.codigo = @username OR tm.nome = @username)
                AND tm.ativo = 1
            )
            ${hasTimeId ? `OR EXISTS (
              SELECT 1 FROM WORKSPACE_ACESSOS wa
              JOIN TIME_MEMBROS tm ON tm.time_id = CONVERT(INT, wa.codigo)
              WHERE wa.id_workspace = w.id
                AND wa.tipo = 'time'
                AND (tm.codigo = @username OR tm.nome = @username)
                AND tm.ativo = 1
            )` : ''}
            OR NOT EXISTS (
              SELECT 1 FROM WORKSPACE_ACESSOS wa2
              WHERE wa2.id_workspace = w.id
            )
          )
        )
      )
  `;
  const result = await request.query(sqlText);
  return result.recordset.length > 0;
}

async function getPermissao(id_workspace, username) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_workspace', sql.Int,         id_workspace);
  request.input('username',     sql.VarChar(200), username);
  const ownerResult = await request.query(`
    SELECT criado_por FROM WORKSPACES WHERE id = @id_workspace AND ativo = 1
  `);
  if (!ownerResult.recordset[0]) return null;
  if (ownerResult.recordset[0].criado_por === username) return 'owner';
  const r2 = pool.request();
  r2.input('id_workspace', sql.Int,         id_workspace);
  r2.input('username',     sql.VarChar(200), username);
  const userAccess = await r2.query(`
    SELECT permissao FROM WORKSPACE_ACESSOS
    WHERE id_workspace = @id_workspace AND tipo = 'usuario' AND codigo = @username
  `);
  if (userAccess.recordset[0]) return userAccess.recordset[0].permissao;
  const r3 = pool.request();
  r3.input('id_workspace', sql.Int,         id_workspace);
  r3.input('username',     sql.VarChar(200), username);
  const colsRes = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TIME_MEMBROS' AND COLUMN_NAME = 'TIME_ID'");
  const hasTimeId = colsRes.recordset.length > 0;
  let sqlText = `
    SELECT TOP 1 wa.permissao FROM WORKSPACE_ACESSOS wa
    JOIN TIME_MEMBROS tm ON tm.grupo = wa.codigo
    WHERE wa.id_workspace = @id_workspace
      AND wa.tipo = 'grupo'
      AND (tm.codigo = @username OR tm.nome = @username)
      AND tm.ativo = 1
  `;
  if (hasTimeId) {
    sqlText += `\nUNION\nSELECT TOP 1 wa.permissao FROM WORKSPACE_ACESSOS wa\nJOIN TIME_MEMBROS tm ON tm.time_id = CONVERT(INT, wa.codigo)\nWHERE wa.id_workspace = @id_workspace\n  AND wa.tipo = 'time'\n  AND (tm.codigo = @username OR tm.nome = @username)\n  AND tm.ativo = 1\n`;
  }
  const groupAccess = await r3.query(sqlText);
  if (groupAccess.recordset[0]) return groupAccess.recordset[0].permissao;
  const r4 = pool.request();
  r4.input('id_workspace', sql.Int, id_workspace);
  const pubCheck = await r4.query(`
    SELECT w.privado FROM WORKSPACES w WHERE w.id = @id_workspace AND w.ativo = 1
  `);
  if (pubCheck.recordset[0] && pubCheck.recordset[0].privado === false) {
    return 'viewer';
  }
  return null;
}

async function getKanbanData(id_workspace) {
  const pool    = await getPool();
  const colunas = await getColunas(id_workspace);
  const hasCustomColunas = colunas.length > 0;
  const request = pool.request();
  request.input('id_workspace', sql.Int, id_workspace);
  const result = await request.query(`
    SELECT
      t.id, t.titulo, t.descricao, t.status, t.prioridade,
      t.data_vencimento, t.posicao, t.data_criacao,
      t.responsavel_nome, t.id_coluna,
      LEFT(ISNULL(t.responsavel_nome,'?'), 1) AS avatar_initials,
      c.nome AS categoria_nome, c.cor AS categoria_cor,
      wc.nome AS coluna_nome,
      (SELECT COUNT(*) FROM CHECKLIST_ITEMS ci WHERE ci.id_tarefa = t.id) AS checklist_total,
      (SELECT COUNT(*) FROM CHECKLIST_ITEMS ci WHERE ci.id_tarefa = t.id AND ci.concluido = 1) AS checklist_done
    FROM TAREFAS t
    LEFT JOIN CATEGORIAS c ON c.id = t.id_categoria
    LEFT JOIN WORKSPACE_COLUNAS wc ON wc.id = t.id_coluna
    WHERE t.id_workspace = @id_workspace AND t.ativo = 1
    ORDER BY t.posicao ASC, t.id DESC
  `);

  let colunasResult;
  let kanban = {};

  if (hasCustomColunas) {
    colunasResult = colunas.map(col => ({
      ...col,
      chave: 'col_' + col.id,
    }));
    colunasResult.forEach(col => { kanban[col.chave] = []; });
    result.recordset.forEach(row => {
      const chave = row.id_coluna ? 'col_' + row.id_coluna : null;
      if (chave && kanban[chave] !== undefined) {
        kanban[chave].push(row);
      } else if (colunasResult.length > 0) {
        kanban[colunasResult[0].chave].push(row);
      }
    });
  } else {
    colunasResult = DEFAULT_COLUNAS.map(c => ({ ...c }));
    DEFAULT_COLUNAS.forEach(col => { kanban[col.chave] = []; });
    result.recordset.forEach(row => {
      if (kanban[row.status] !== undefined) {
        kanban[row.status].push(row);
      } else {
        kanban['A_FAZER'].push(row);
      }
    });
  }

  return { colunas: colunasResult, kanban, hasCustomColunas };
}

async function getAllTasks(id_workspace) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_workspace', sql.Int, id_workspace);
  const result = await request.query(`
    SELECT
      t.id, t.titulo, t.descricao, t.status, t.prioridade,
      t.data_vencimento, t.posicao, t.ativo, t.criado_por,
      t.data_criacao, t.data_atualizacao,
      t.responsavel_nome, t.id_coluna,
      LEFT(ISNULL(t.responsavel_nome,'?'), 1) AS avatar_initials,
      c.nome AS categoria_nome, c.cor AS categoria_cor,
      wc.nome AS coluna_nome
    FROM TAREFAS t
    LEFT JOIN CATEGORIAS c ON c.id = t.id_categoria
    LEFT JOIN WORKSPACE_COLUNAS wc ON wc.id = t.id_coluna
    WHERE t.id_workspace = @id_workspace AND t.ativo = 1
    ORDER BY t.id DESC
  `);
  return result.recordset;
}

async function getStats(id_workspace) {
  const pool    = await getPool();
  const request = pool.request();
  request.input('id_workspace', sql.Int, id_workspace);
  const result = await request.query(`
    SELECT
      COUNT(*)                                                                                  AS total,
      SUM(CASE WHEN status = 'CONCLUIDO' THEN 1 ELSE 0 END)                                   AS concluidas,
      SUM(CASE WHEN status IN ('EM_ANDAMENTO','EM_REVISAO') THEN 1 ELSE 0 END)                AS em_andamento,
      SUM(CASE WHEN status != 'CONCLUIDO' AND data_vencimento < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS atrasadas
    FROM TAREFAS
    WHERE ativo = 1 AND id_workspace = @id_workspace
  `);
  return result.recordset[0] || { total: 0, concluidas: 0, em_andamento: 0, atrasadas: 0 };
}

async function getGrupos() {
  const pool   = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT grupo FROM TIME_MEMBROS
    WHERE grupo IS NOT NULL AND ativo = 1
    ORDER BY grupo
  `);
  return result.recordset;
}

module.exports = {
  getAll,
  getById,
  create,
  getColunas,
  addColuna,
  deleteColuna,
  reorderColunas,
  getAcessos,
  addAcesso,
  removeAcesso,
  softDelete,
  hasAccess,
  getPermissao,
  getKanbanData,
  getAllTasks,
  getStats,
  getGrupos,
  DEFAULT_COLUNAS,
};
