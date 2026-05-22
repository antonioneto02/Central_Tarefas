'use strict';
const { QueryTypes } = require('sequelize');
const sequelizeCt = require('../database/sequelize/dbSequelizeCt');

async function getKanbanData() {
  const r = await sequelizeCt.query(`
    SELECT t.id, t.titulo, t.descricao, t.status, t.prioridade,
      t.data_vencimento, t.posicao, t.data_criacao, t.responsavel_nome,
      LEFT(ISNULL(t.responsavel_nome,'?'), 1) AS avatar_initials,
      c.nome AS categoria_nome, c.cor AS categoria_cor,
      (SELECT COUNT(*) FROM CHECKLIST_ITEMS ci WHERE ci.id_tarefa = t.id) AS checklist_total,
      (SELECT COUNT(*) FROM CHECKLIST_ITEMS ci WHERE ci.id_tarefa = t.id AND ci.concluido = 1) AS checklist_done
    FROM TAREFAS t LEFT JOIN CATEGORIAS c ON c.id = t.id_categoria
    WHERE t.ativo = 1 ORDER BY t.posicao ASC, t.id DESC
  `, { type: QueryTypes.SELECT });
  const kanban = { A_FAZER: [], EM_ANDAMENTO: [], EM_REVISAO: [], CONCLUIDO: [] };
  r.forEach(row => { if (kanban[row.status]) kanban[row.status].push(row); });
  return kanban;
}

async function getAll() {
  return await sequelizeCt.query(`
    SELECT t.id, t.titulo, t.descricao, t.status, t.prioridade,
      t.data_vencimento, t.posicao, t.ativo, t.criado_por,
      t.data_criacao, t.data_atualizacao, t.responsavel_nome,
      LEFT(ISNULL(t.responsavel_nome,'?'), 1) AS avatar_initials,
      c.nome AS categoria_nome, c.cor AS categoria_cor
    FROM TAREFAS t LEFT JOIN CATEGORIAS c ON c.id = t.id_categoria
    WHERE t.ativo = 1 ORDER BY t.id DESC
  `, { type: QueryTypes.SELECT });
}

async function getStats() {
  const r = await sequelizeCt.query(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'CONCLUIDO' THEN 1 ELSE 0 END) AS concluidas,
      SUM(CASE WHEN status IN ('EM_ANDAMENTO','EM_REVISAO') THEN 1 ELSE 0 END) AS em_andamento,
      SUM(CASE WHEN status != 'CONCLUIDO' AND data_vencimento < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS atrasadas
    FROM TAREFAS WHERE ativo = 1
  `, { type: QueryTypes.SELECT });
  return r[0] || { total: 0, concluidas: 0, em_andamento: 0, atrasadas: 0 };
}

async function getChartData() {
  const r = await sequelizeCt.query(`
    SELECT
      SUM(CASE WHEN status = 'A_FAZER' THEN 1 ELSE 0 END) AS a_fazer,
      SUM(CASE WHEN status = 'EM_ANDAMENTO' THEN 1 ELSE 0 END) AS em_andamento,
      SUM(CASE WHEN status = 'EM_REVISAO' THEN 1 ELSE 0 END) AS em_revisao,
      SUM(CASE WHEN status = 'CONCLUIDO' THEN 1 ELSE 0 END) AS concluido,
      SUM(CASE WHEN prioridade = 'ALTA' THEN 1 ELSE 0 END) AS alta,
      SUM(CASE WHEN prioridade = 'MEDIA' THEN 1 ELSE 0 END) AS media,
      SUM(CASE WHEN prioridade = 'BAIXA' THEN 1 ELSE 0 END) AS baixa
    FROM TAREFAS WHERE ativo = 1
  `, { type: QueryTypes.SELECT });
  const row = r[0] || {};
  return {
    porStatus: [row.a_fazer||0, row.em_andamento||0, row.em_revisao||0, row.concluido||0],
    porPrioridade: [row.alta||0, row.media||0, row.baixa||0],
  };
}

async function getById(id) {
  const r = await sequelizeCt.query(`
    SELECT t.*, c.nome AS categoria_nome
    FROM TAREFAS t LEFT JOIN CATEGORIAS c ON c.id = t.id_categoria
    WHERE t.id = :id AND t.ativo = 1
  `, { replacements: { id }, type: QueryTypes.SELECT });
  return r[0] || null;
}

async function insert(payload) {
  const r = await sequelizeCt.query(`
    INSERT INTO TAREFAS
      (titulo, descricao, status, prioridade, responsavel_nome, id_categoria,
       data_vencimento, posicao, criado_por, id_workspace, id_coluna)
    OUTPUT INSERTED.id
    VALUES (:titulo, :descricao, :status, :prioridade, :responsavel_nome, :id_categoria,
            :data_vencimento, :posicao, :criado_por, :id_workspace, :id_coluna)
  `, {
    replacements: {
      titulo: payload.titulo || '', descricao: payload.descricao || null,
      status: payload.status || 'A_FAZER', prioridade: payload.prioridade || 'MEDIA',
      responsavel_nome: payload.responsavel_nome || null,
      id_categoria: payload.id_categoria || null,
      data_vencimento: payload.data_vencimento || null,
      posicao: payload.posicao || 0, criado_por: payload.criado_por || null,
      id_workspace: payload.id_workspace || null, id_coluna: payload.id_coluna || null,
    },
    type: QueryTypes.SELECT,
  });
  return r[0].id;
}

async function update(id, payload) {
  await sequelizeCt.query(`
    UPDATE TAREFAS SET
      titulo = :titulo, descricao = :descricao, status = :status,
      prioridade = :prioridade, responsavel_nome = :responsavel_nome,
      id_categoria = :id_categoria, data_vencimento = :data_vencimento,
      id_workspace = CASE WHEN :id_workspace IS NOT NULL THEN :id_workspace ELSE id_workspace END,
      id_coluna = CASE WHEN :id_coluna IS NOT NULL THEN :id_coluna ELSE id_coluna END,
      data_atualizacao = GETDATE()
    WHERE id = :id AND ativo = 1
  `, {
    replacements: {
      id, titulo: payload.titulo || '', descricao: payload.descricao || null,
      status: payload.status || 'A_FAZER', prioridade: payload.prioridade || 'MEDIA',
      responsavel_nome: payload.responsavel_nome || null,
      id_categoria: payload.id_categoria || null,
      data_vencimento: payload.data_vencimento || null,
      id_workspace: payload.id_workspace !== undefined ? payload.id_workspace : null,
      id_coluna: payload.id_coluna !== undefined ? payload.id_coluna : null,
    },
    type: QueryTypes.UPDATE,
  });
}

async function updateStatus(id, newStatus) {
  await sequelizeCt.query(
    'UPDATE TAREFAS SET status = :status, data_atualizacao = GETDATE() WHERE id = :id AND ativo = 1',
    { replacements: { id, status: newStatus }, type: QueryTypes.UPDATE }
  );
}

async function updatePosicoes(items) {
  for (const item of items) {
    await sequelizeCt.query(
      'UPDATE TAREFAS SET posicao = :posicao, status = :status, data_atualizacao = GETDATE() WHERE id = :id AND ativo = 1',
      { replacements: { id: item.id, posicao: item.posicao, status: item.status || null }, type: QueryTypes.UPDATE }
    );
  }
}

async function updatePosicoesWorkspace(items) {
  for (const item of items) {
    await sequelizeCt.query(`
      UPDATE TAREFAS SET
        posicao = :posicao,
        id_coluna = ISNULL(:id_coluna, id_coluna),
        data_atualizacao = GETDATE()
      WHERE id = :id AND ativo = 1
    `, {
      replacements: { id: item.id, posicao: item.posicao, id_coluna: item.id_coluna || null },
      type: QueryTypes.UPDATE,
    });
  }
}

async function deleteById(id) {
  await sequelizeCt.query('UPDATE TAREFAS SET ativo = 0 WHERE id = :id',
    { replacements: { id }, type: QueryTypes.UPDATE });
}

async function getChecklistItems(tarefaId) {
  return await sequelizeCt.query(`
    SELECT id, descricao, concluido, posicao FROM CHECKLIST_ITEMS
    WHERE id_tarefa = :id_tarefa ORDER BY posicao ASC
  `, { replacements: { id_tarefa: tarefaId }, type: QueryTypes.SELECT });
}

async function addChecklistItem(tarefaId, descricao) {
  const r = await sequelizeCt.query(`
    INSERT INTO CHECKLIST_ITEMS (id_tarefa, descricao, posicao)
    OUTPUT INSERTED.id
    VALUES (:id_tarefa, :descricao,
      (SELECT ISNULL(MAX(posicao),0)+1 FROM CHECKLIST_ITEMS WHERE id_tarefa = :id_tarefa))
  `, { replacements: { id_tarefa: tarefaId, descricao }, type: QueryTypes.SELECT });
  return r[0].id;
}

async function toggleChecklistItem(itemId) {
  const r = await sequelizeCt.query(`
    UPDATE CHECKLIST_ITEMS SET concluido = 1 - concluido OUTPUT INSERTED.concluido WHERE id = :id
  `, { replacements: { id: itemId }, type: QueryTypes.SELECT });
  return r[0] ? r[0].concluido : 0;
}

async function deleteChecklistItem(itemId) {
  await sequelizeCt.query('DELETE FROM CHECKLIST_ITEMS WHERE id = :id',
    { replacements: { id: itemId }, type: QueryTypes.DELETE });
}

async function updateChecklistItem(itemId, descricao) {
  await sequelizeCt.query('UPDATE CHECKLIST_ITEMS SET descricao = :descricao WHERE id = :id',
    { replacements: { id: itemId, descricao }, type: QueryTypes.UPDATE });
}

async function reorderChecklistItems(items) {
  for (const item of items) {
    await sequelizeCt.query('UPDATE CHECKLIST_ITEMS SET posicao = :posicao WHERE id = :id',
      { replacements: { id: item.id, posicao: item.posicao }, type: QueryTypes.UPDATE });
  }
}

async function getResponsaveis() {
  return await sequelizeCt.query(`
    SELECT DISTINCT responsavel_nome AS nome FROM TAREFAS
    WHERE responsavel_nome IS NOT NULL AND ativo = 1
    ORDER BY responsavel_nome
  `, { type: QueryTypes.SELECT });
}

async function getCategorias() {
  return await sequelizeCt.query(
    'SELECT id, nome, cor, icone FROM CATEGORIAS WHERE ativo = 1 ORDER BY nome',
    { type: QueryTypes.SELECT }
  );
}

module.exports = {
  getKanbanData, getAll, getStats, getChartData, getById, insert, update,
  updateStatus, updatePosicoes, updatePosicoesWorkspace, deleteById,
  getChecklistItems, addChecklistItem, toggleChecklistItem, deleteChecklistItem,
  updateChecklistItem, reorderChecklistItems, getResponsaveis, getCategorias,
};
