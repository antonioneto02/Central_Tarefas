'use strict';
const { QueryTypes } = require('sequelize');
const sequelizeCt = require('../database/sequelize/dbSequelizeCt');

const DEFAULT_COLUNAS = [
  { id: null, nome: 'A Fazer',      cor: '#94a3b8', chave: 'A_FAZER'      },
  { id: null, nome: 'Em Andamento', cor: '#f59e0b', chave: 'EM_ANDAMENTO' },
  { id: null, nome: 'Em Revisão',   cor: '#6366f1', chave: 'EM_REVISAO'   },
  { id: null, nome: 'Concluído',    cor: '#22c55e', chave: 'CONCLUIDO'    },
];

async function getAll(username) {
  return await sequelizeCt.query(`
    SELECT DISTINCT w.id, w.nome, w.descricao, w.criado_por, w.privado, w.data_criacao, w.ativo,
      (SELECT COUNT(*) FROM TAREFAS t WHERE t.id_workspace = w.id AND t.ativo = 1) AS total_tarefas
    FROM WORKSPACES w
    WHERE w.ativo = 1 AND (
      w.criado_por = :username
      OR (w.privado = 0 AND (
        EXISTS (SELECT 1 FROM WORKSPACE_ACESSOS wa WHERE wa.id_workspace = w.id AND wa.tipo = 'usuario' AND wa.codigo = :username)
        OR EXISTS (SELECT 1 FROM WORKSPACE_ACESSOS wa JOIN TIME_MEMBROS tm ON tm.grupo = wa.codigo
                   WHERE wa.id_workspace = w.id AND wa.tipo = 'grupo' AND (tm.codigo = :username OR tm.nome = :username) AND tm.ativo = 1)
        OR NOT EXISTS (SELECT 1 FROM WORKSPACE_ACESSOS wa2 WHERE wa2.id_workspace = w.id)
      ))
    )
    ORDER BY w.data_criacao DESC
  `, { replacements: { username }, type: QueryTypes.SELECT });
}

async function getById(id) {
  const r = await sequelizeCt.query(`
    SELECT w.id, w.nome, w.descricao, w.criado_por, w.privado, w.data_criacao, w.ativo
    FROM WORKSPACES w WHERE w.id = :id AND w.ativo = 1
  `, { replacements: { id }, type: QueryTypes.SELECT });
  return r[0] || null;
}

async function create({ nome, descricao, criado_por, privado }) {
  const r = await sequelizeCt.query(`
    INSERT INTO WORKSPACES (nome, descricao, criado_por, privado)
    OUTPUT INSERTED.id VALUES (:nome, :descricao, :criado_por, :privado)
  `, {
    replacements: { nome: nome||'', descricao: descricao||null, criado_por: criado_por||'', privado: privado ? 1 : 0 },
    type: QueryTypes.SELECT,
  });
  return r[0].id;
}

async function getColunas(id_workspace) {
  return await sequelizeCt.query(`
    SELECT id, id_workspace, nome, cor, posicao FROM WORKSPACE_COLUNAS
    WHERE id_workspace = :id_workspace AND ativo = 1 ORDER BY posicao ASC
  `, { replacements: { id_workspace }, type: QueryTypes.SELECT });
}

async function addColuna(id_workspace, nome, cor, posicao) {
  const r = await sequelizeCt.query(`
    INSERT INTO WORKSPACE_COLUNAS (id_workspace, nome, cor, posicao)
    OUTPUT INSERTED.id VALUES (:id_workspace, :nome, :cor, :posicao)
  `, {
    replacements: { id_workspace, nome: nome||'', cor: cor||'#6366f1', posicao: posicao||0 },
    type: QueryTypes.SELECT,
  });
  return r[0].id;
}

async function deleteColuna(id) {
  await sequelizeCt.query('UPDATE WORKSPACE_COLUNAS SET ativo = 0 WHERE id = :id',
    { replacements: { id }, type: QueryTypes.UPDATE });
}

async function reorderColunas(items) {
  for (const item of items) {
    await sequelizeCt.query('UPDATE WORKSPACE_COLUNAS SET posicao = :posicao WHERE id = :id',
      { replacements: { id: item.id, posicao: item.posicao }, type: QueryTypes.UPDATE });
  }
}

async function getAcessos(id_workspace) {
  return await sequelizeCt.query(`
    SELECT id, id_workspace, tipo, codigo, nome_display, permissao
    FROM WORKSPACE_ACESSOS WHERE id_workspace = :id_workspace
  `, { replacements: { id_workspace }, type: QueryTypes.SELECT });
}

async function addAcesso(id_workspace, tipo, codigo, nome_display, permissao) {
  const r = await sequelizeCt.query(`
    INSERT INTO WORKSPACE_ACESSOS (id_workspace, tipo, codigo, nome_display, permissao)
    OUTPUT INSERTED.id VALUES (:id_workspace, :tipo, :codigo, :nome_display, :permissao)
  `, {
    replacements: { id_workspace, tipo, codigo, nome_display: nome_display||null, permissao: permissao||'editor' },
    type: QueryTypes.SELECT,
  });
  return r[0].id;
}

async function removeAcesso(id) {
  await sequelizeCt.query('DELETE FROM WORKSPACE_ACESSOS WHERE id = :id',
    { replacements: { id }, type: QueryTypes.DELETE });
}

async function softDelete(id) {
  await sequelizeCt.query('UPDATE WORKSPACES SET ativo = 0 WHERE id = :id',
    { replacements: { id }, type: QueryTypes.UPDATE });
}

async function hasAccess(id_workspace, username) {
  const colsRes = await sequelizeCt.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TIME_MEMBROS' AND COLUMN_NAME = 'TIME_ID'",
    { type: QueryTypes.SELECT }
  );
  const hasTimeId = colsRes.length > 0;
  const timeJoin = hasTimeId ? `OR EXISTS (
    SELECT 1 FROM WORKSPACE_ACESSOS wa
    JOIN TIME_MEMBROS tm ON tm.time_id = CONVERT(INT, wa.codigo)
    WHERE wa.id_workspace = w.id AND wa.tipo = 'time'
      AND (tm.codigo = :username OR tm.nome = :username) AND tm.ativo = 1
  )` : '';
  const sqlText = `
    SELECT TOP 1 1 AS ok FROM WORKSPACES w
    WHERE w.id = :id_workspace AND w.ativo = 1
      AND (
        w.criado_por = :username
        OR (w.privado = 0 AND (
          EXISTS (SELECT 1 FROM WORKSPACE_ACESSOS wa WHERE wa.id_workspace = w.id AND wa.tipo = 'usuario' AND wa.codigo = :username)
          OR EXISTS (SELECT 1 FROM WORKSPACE_ACESSOS wa JOIN TIME_MEMBROS tm ON tm.grupo = wa.codigo
                     WHERE wa.id_workspace = w.id AND wa.tipo = 'grupo' AND (tm.codigo = :username OR tm.nome = :username) AND tm.ativo = 1)
          ${timeJoin}
          OR NOT EXISTS (SELECT 1 FROM WORKSPACE_ACESSOS wa2 WHERE wa2.id_workspace = w.id)
        ))
      )
  `;
  const r = await sequelizeCt.query(sqlText, { replacements: { id_workspace, username }, type: QueryTypes.SELECT });
  return r.length > 0;
}

async function getPermissao(id_workspace, username) {
  const ownerR = await sequelizeCt.query(
    'SELECT criado_por FROM WORKSPACES WHERE id = :id_workspace AND ativo = 1',
    { replacements: { id_workspace }, type: QueryTypes.SELECT }
  );
  if (!ownerR[0]) return null;
  if (ownerR[0].criado_por === username) return 'owner';
  const userR = await sequelizeCt.query(`
    SELECT permissao FROM WORKSPACE_ACESSOS
    WHERE id_workspace = :id_workspace AND tipo = 'usuario' AND codigo = :username
  `, { replacements: { id_workspace, username }, type: QueryTypes.SELECT });
  if (userR[0]) return userR[0].permissao;

  const colsRes = await sequelizeCt.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TIME_MEMBROS' AND COLUMN_NAME = 'TIME_ID'",
    { type: QueryTypes.SELECT }
  );
  const hasTimeId = colsRes.length > 0;
  let sqlText = `
    SELECT TOP 1 wa.permissao FROM WORKSPACE_ACESSOS wa
    JOIN TIME_MEMBROS tm ON tm.grupo = wa.codigo
    WHERE wa.id_workspace = :id_workspace AND wa.tipo = 'grupo'
      AND (tm.codigo = :username OR tm.nome = :username) AND tm.ativo = 1
  `;
  if (hasTimeId) {
    sqlText += `
    UNION
    SELECT TOP 1 wa.permissao FROM WORKSPACE_ACESSOS wa
    JOIN TIME_MEMBROS tm ON tm.time_id = CONVERT(INT, wa.codigo)
    WHERE wa.id_workspace = :id_workspace AND wa.tipo = 'time'
      AND (tm.codigo = :username OR tm.nome = :username) AND tm.ativo = 1
    `;
  }
  const groupR = await sequelizeCt.query(sqlText, { replacements: { id_workspace, username }, type: QueryTypes.SELECT });
  if (groupR[0]) return groupR[0].permissao;

  const pubR = await sequelizeCt.query(
    'SELECT w.privado FROM WORKSPACES w WHERE w.id = :id_workspace AND w.ativo = 1',
    { replacements: { id_workspace }, type: QueryTypes.SELECT }
  );
  if (pubR[0] && pubR[0].privado === false) return 'viewer';
  return null;
}

async function getKanbanData(id_workspace) {
  const colunas = await getColunas(id_workspace);
  const hasCustomColunas = colunas.length > 0;
  const r = await sequelizeCt.query(`
    SELECT t.id, t.titulo, t.descricao, t.status, t.prioridade,
      t.data_vencimento, t.posicao, t.data_criacao, t.responsavel_nome, t.id_coluna,
      LEFT(ISNULL(t.responsavel_nome,'?'), 1) AS avatar_initials,
      c.nome AS categoria_nome, c.cor AS categoria_cor, wc.nome AS coluna_nome,
      (SELECT COUNT(*) FROM CHECKLIST_ITEMS ci WHERE ci.id_tarefa = t.id) AS checklist_total,
      (SELECT COUNT(*) FROM CHECKLIST_ITEMS ci WHERE ci.id_tarefa = t.id AND ci.concluido = 1) AS checklist_done
    FROM TAREFAS t
    LEFT JOIN CATEGORIAS c ON c.id = t.id_categoria
    LEFT JOIN WORKSPACE_COLUNAS wc ON wc.id = t.id_coluna
    WHERE t.id_workspace = :id_workspace AND t.ativo = 1
    ORDER BY t.posicao ASC, t.id DESC
  `, { replacements: { id_workspace }, type: QueryTypes.SELECT });
  let colunasResult;
  let kanban = {};
  if (hasCustomColunas) {
    colunasResult = colunas.map(col => ({ ...col, chave: 'col_' + col.id }));
    colunasResult.forEach(col => { kanban[col.chave] = []; });
    r.forEach(row => {
      const chave = row.id_coluna ? 'col_' + row.id_coluna : null;
      if (chave && kanban[chave] !== undefined) kanban[chave].push(row);
      else if (colunasResult.length > 0) kanban[colunasResult[0].chave].push(row);
    });
  } else {
    colunasResult = DEFAULT_COLUNAS.map(c => ({ ...c }));
    DEFAULT_COLUNAS.forEach(col => { kanban[col.chave] = []; });
    r.forEach(row => {
      if (kanban[row.status] !== undefined) kanban[row.status].push(row);
      else kanban['A_FAZER'].push(row);
    });
  }
  return { colunas: colunasResult, kanban, hasCustomColunas };
}

async function getAllTasks(id_workspace) {
  return await sequelizeCt.query(`
    SELECT t.id, t.titulo, t.descricao, t.status, t.prioridade,
      t.data_vencimento, t.posicao, t.ativo, t.criado_por,
      t.data_criacao, t.data_atualizacao, t.responsavel_nome, t.id_coluna,
      LEFT(ISNULL(t.responsavel_nome,'?'), 1) AS avatar_initials,
      c.nome AS categoria_nome, c.cor AS categoria_cor, wc.nome AS coluna_nome
    FROM TAREFAS t
    LEFT JOIN CATEGORIAS c ON c.id = t.id_categoria
    LEFT JOIN WORKSPACE_COLUNAS wc ON wc.id = t.id_coluna
    WHERE t.id_workspace = :id_workspace AND t.ativo = 1
    ORDER BY t.id DESC
  `, { replacements: { id_workspace }, type: QueryTypes.SELECT });
}

async function getStats(id_workspace) {
  const r = await sequelizeCt.query(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'CONCLUIDO' THEN 1 ELSE 0 END) AS concluidas,
      SUM(CASE WHEN status IN ('EM_ANDAMENTO','EM_REVISAO') THEN 1 ELSE 0 END) AS em_andamento,
      SUM(CASE WHEN status != 'CONCLUIDO' AND data_vencimento < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS atrasadas
    FROM TAREFAS WHERE ativo = 1 AND id_workspace = :id_workspace
  `, { replacements: { id_workspace }, type: QueryTypes.SELECT });
  return r[0] || { total: 0, concluidas: 0, em_andamento: 0, atrasadas: 0 };
}

async function getGrupos() {
  return await sequelizeCt.query(
    'SELECT DISTINCT grupo FROM TIME_MEMBROS WHERE grupo IS NOT NULL AND ativo = 1 ORDER BY grupo',
    { type: QueryTypes.SELECT }
  );
}

module.exports = {
  getAll, getById, create, getColunas, addColuna, deleteColuna, reorderColunas,
  getAcessos, addAcesso, removeAcesso, softDelete, hasAccess, getPermissao,
  getKanbanData, getAllTasks, getStats, getGrupos, DEFAULT_COLUNAS,
};
