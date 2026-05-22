'use strict';
const { QueryTypes } = require('sequelize');
const sequelizeCt = require('../database/sequelize/dbSequelizeCt');

async function getAll(userId, includeArchived = false) {
  return await sequelizeCt.query(`
    SELECT
      a.id, a.titulo, a.conteudo, a.cor, a.fixado, a.arquivado,
      a.data_criacao, a.data_atualizacao,
      ISNULL(a.visibilidade, 'privado') AS visibilidade,
      a.grupo_acesso,
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
    WHERE (
      (ISNULL(a.visibilidade, 'privado') = 'privado' AND a.id_usuario = :userId)
      OR (ISNULL(a.visibilidade, 'privado') = 'grupo' AND (
        a.id_usuario = :userId
        OR a.grupo_acesso IN (
          SELECT DISTINCT grupo FROM TIME_MEMBROS
          WHERE (codigo = :userId OR nome = :userId) AND ativo = 1
        )
      ))
      OR (ISNULL(a.visibilidade, 'privado') = 'usuario' AND (
        a.id_usuario = :userId OR a.grupo_acesso = :userId
      ))
    ) AND a.arquivado = :arquivado
    ORDER BY a.fixado DESC, a.data_atualizacao DESC
  `, { replacements: { userId, arquivado: includeArchived ? 1 : 0 }, type: QueryTypes.SELECT });
}

async function getById(id) {
  const r = await sequelizeCt.query(
    'SELECT * FROM ANOTACOES WHERE id = :id',
    { replacements: { id }, type: QueryTypes.SELECT }
  );
  return r[0] || null;
}

async function insert(payload) {
  const r = await sequelizeCt.query(`
    INSERT INTO ANOTACOES (titulo, conteudo, cor, fixado, id_usuario, visibilidade, grupo_acesso)
    OUTPUT INSERTED.id
    VALUES (:titulo, :conteudo, :cor, :fixado, :id_usuario, :visibilidade, :grupo_acesso)
  `, {
    replacements: {
      titulo: payload.titulo || null, conteudo: payload.conteudo || null,
      cor: payload.cor || 'default', fixado: payload.fixado ? 1 : 0,
      id_usuario: payload.id_usuario || null,
      visibilidade: payload.visibilidade || 'privado',
      grupo_acesso: payload.grupo_acesso || null,
    },
    type: QueryTypes.SELECT,
  });
  return r[0].id;
}

async function update(id, payload) {
  await sequelizeCt.query(`
    UPDATE ANOTACOES SET
      titulo = :titulo, conteudo = :conteudo, cor = :cor,
      visibilidade = :visibilidade, grupo_acesso = :grupo_acesso,
      data_atualizacao = GETDATE()
    WHERE id = :id
  `, {
    replacements: {
      id, titulo: payload.titulo || null, conteudo: payload.conteudo || null,
      cor: payload.cor || 'default', visibilidade: payload.visibilidade || 'privado',
      grupo_acesso: payload.grupo_acesso || null,
    },
    type: QueryTypes.UPDATE,
  });
}

async function toggleFixado(id) {
  const r = await sequelizeCt.query(`
    UPDATE ANOTACOES SET fixado = 1 - fixado, data_atualizacao = GETDATE()
    OUTPUT INSERTED.fixado WHERE id = :id
  `, { replacements: { id }, type: QueryTypes.SELECT });
  return r[0] ? r[0].fixado : 0;
}

async function toggleArquivado(id) {
  const r = await sequelizeCt.query(`
    UPDATE ANOTACOES SET arquivado = 1 - arquivado, data_atualizacao = GETDATE()
    OUTPUT INSERTED.arquivado WHERE id = :id
  `, { replacements: { id }, type: QueryTypes.SELECT });
  return r[0] ? r[0].arquivado : 0;
}

async function deleteById(id) {
  await sequelizeCt.query('DELETE FROM ANOTACOES WHERE id = :id',
    { replacements: { id }, type: QueryTypes.DELETE });
}

async function getEtiquetas() {
  return await sequelizeCt.query('SELECT id, nome, cor FROM ETIQUETAS ORDER BY nome',
    { type: QueryTypes.SELECT });
}

async function addEtiquetaToNota(notaId, etiquetaId) {
  await sequelizeCt.query(`
    IF NOT EXISTS (SELECT 1 FROM ANOTACOES_ETIQUETAS WHERE id_anotacao = :id_anotacao AND id_etiqueta = :id_etiqueta)
      INSERT INTO ANOTACOES_ETIQUETAS (id_anotacao, id_etiqueta) VALUES (:id_anotacao, :id_etiqueta)
  `, { replacements: { id_anotacao: notaId, id_etiqueta: etiquetaId }, type: QueryTypes.RAW });
}

async function removeEtiquetaFromNota(notaId, etiquetaId) {
  await sequelizeCt.query(`
    DELETE FROM ANOTACOES_ETIQUETAS WHERE id_anotacao = :id_anotacao AND id_etiqueta = :id_etiqueta
  `, { replacements: { id_anotacao: notaId, id_etiqueta: etiquetaId }, type: QueryTypes.DELETE });
}

async function getGrupos() {
  return await sequelizeCt.query(
    'SELECT id, nome FROM TIME_TIMES WHERE ativo = 1 ORDER BY nome',
    { type: QueryTypes.SELECT }
  );
}

module.exports = {
  getAll, getById, insert, update, toggleFixado, toggleArquivado, deleteById,
  getEtiquetas, addEtiquetaToNota, removeEtiquetaFromNota, getGrupos,
};
