'use strict';
const path        = require('path');
const express     = require('express');
const compression = require('compression');
const session     = require('express-session');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const loginController  = require('./controllers/loginController');
const tarefaModel      = require('./models/tarefaModel');
const anotacaoModel    = require('./models/anotacaoModel');
const timeModel        = require('./models/timeModel');
const workspaceModel   = require('./models/workspaceModel');
const app  = express();
const PORT = process.env.PORT || 3002;

app.use(compression());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const { swaggerUi, swaggerDocument } = require('./swagger');
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/css',    express.static(path.join(__dirname, 'public', 'css')));
app.use(cookieParser());
app.use((req, res, next) => {
  try {
    if (req.query && (req.query.sso_token || req.query.sso_refresh)) {
      if (req.query.sso_token) {
        res.cookie('token', req.query.sso_token, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 3600000 });
        if (req.query.sso_username) {
          res.cookie('username', req.query.sso_username, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 43200000 });
        }
      }
      if (req.query.sso_refresh) {
        res.cookie('refresh_token', req.query.sso_refresh, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 43200000 });
      }
      const clean = req.originalUrl.replace(/(\?|&)(sso_token|sso_refresh|sso_username)=[^&]*/g, '').replace(/[?&]$/, '');
      return res.redirect(clean || '/');
    }
  } catch (e) {}
  return next();
});
app.use(session({
  secret:            process.env.SESSION_SECRET || 'central_tarefas_secret_change_me',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 8 * 60 * 60 * 1000 },
}));

app.use((req, res, next) => {
  res.locals.currentPath      = req.path || '/';
  res.locals.currentWorkspace = null;
  res.locals.user = {
    nome:     req.session.username || req.cookies.username || 'Usuário',
    email:    '',
    id:       req.session.userID   || null,
    initials: (req.session.username || req.cookies.username || 'U').charAt(0).toUpperCase(),
  };
  next();
});

function getSessionUser(req) {
  const nome = req.session.username || req.cookies.username || 'Usuário';
  return {
    nome:     nome,
    email:    '',
    id:       req.session.userID || null,
    initials: nome.charAt(0).toUpperCase(),
  };
}

async function ensureAuth(req, res, next) {
  const token         = req.cookies && req.cookies.token;
  const refresh_token = req.cookies && req.cookies.refresh_token;
  if (!token && !refresh_token) {
    return res.redirect('/loginPage');
  }
  return next();
}

app.get('/', (req, res) => {
  const hasSession = req.session && req.session.userID;
  const hasCookies = req.cookies && (req.cookies.token || req.cookies.refresh_token);
  if (hasSession || hasCookies) return res.redirect('/dashboard');
  return res.redirect('/loginPage');
});

app.get('/loginPage', (req, res) => {
  const error = req.query.error || null;
  return res.render('System/loginPage', { error, req });
});

app.post('/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (!username || !password) return res.status(400).json({ message: 'Preencha todos os campos' });
  try {
    await loginController.validaLogin(username, password, res, req);
  } catch (err) {
    console.error('Erro no login:', err && err.message ? err.message : err);
    return res.redirect('/loginPage?error=invalid_credentials');
  }
});

app.get('/logout', (req, res) => {
  if (req.session) req.session.destroy(() => {});
  return res.redirect('/loginPage?logout=true');
});

app.get('/dashboard', ensureAuth, async (req, res) => {
  let stats     = { total: 0, concluidas: 0, em_andamento: 0, atrasadas: 0 };
  let chartData = { porStatus: [0,0,0,0], porPrioridade: [0,0,0] };
  try {
    [stats, chartData] = await Promise.all([tarefaModel.getStats(), tarefaModel.getChartData()]);
  } catch (e) {
    console.error('Erro dashboard:', e && e.message ? e.message : e);
  }
  return res.render('dashboard', { stats, chartData, user: getSessionUser(req) });
});

app.get('/tarefas/quadro',   ensureAuth, (req, res) => res.redirect('/workspaces'));
app.get('/tarefas/listagem', ensureAuth, (req, res) => res.redirect('/workspaces'));
app.get('/workspaces', ensureAuth, async (req, res) => {
  const username = req.session.username || req.cookies.username || 'Usuário';
  let workspaces = [];
  try {
    workspaces = await workspaceModel.getAll(username);
  } catch (e) {
    console.error('Erro workspaces:', e && e.message ? e.message : e);
  }
  return res.render('workspaces', { workspaces, user: getSessionUser(req) });
});

app.get('/workspaces/:id/quadro', ensureAuth, async (req, res) => {
  const id       = parseInt(req.params.id, 10);
  const username = req.session.username || req.cookies.username || 'Usuário';
  try {
    const workspace = await workspaceModel.getById(id);
    if (!workspace) return res.redirect('/workspaces');
    const acesso = await workspaceModel.hasAccess(id, username);
    if (!acesso) return res.redirect('/workspaces');
    const [permissao, { colunas, kanban, hasCustomColunas }] = await Promise.all([
      workspaceModel.getPermissao(id, username),
      workspaceModel.getKanbanData(id),
    ]);
    res.locals.currentWorkspace = { id: workspace.id, nome: workspace.nome };
    return res.render('workspace_quadro', { workspace, colunas, kanban, hasCustomColunas, permissao, user: getSessionUser(req) });
  } catch (e) {
    console.error('Erro workspace quadro:', e && e.message ? e.message : e);
    return res.redirect('/workspaces');
  }
});

app.get('/workspaces/:id/listagem', ensureAuth, async (req, res) => {
  const id       = parseInt(req.params.id, 10);
  const username = req.session.username || req.cookies.username || 'Usuário';
  try {
    const workspace = await workspaceModel.getById(id);
    if (!workspace) return res.redirect('/workspaces');
    const acesso = await workspaceModel.hasAccess(id, username);
    if (!acesso) return res.redirect('/workspaces');
    const [permissao, tarefas, stats, colunasRaw] = await Promise.all([
      workspaceModel.getPermissao(id, username),
      workspaceModel.getAllTasks(id),
      workspaceModel.getStats(id),
      workspaceModel.getColunas(id),
    ]);
    const hasCustomColunas = colunasRaw.length > 0;
    const colunas = hasCustomColunas
      ? colunasRaw.map(c => ({ ...c, chave: 'col_' + c.id }))
      : workspaceModel.DEFAULT_COLUNAS;
    res.locals.currentWorkspace = { id: workspace.id, nome: workspace.nome };
    return res.render('workspace_listagem', { workspace, tarefas, stats, colunas, hasCustomColunas, permissao, user: getSessionUser(req) });
  } catch (e) {
    console.error('Erro workspace listagem:', e && e.message ? e.message : e);
    return res.redirect('/workspaces');
  }
});

app.post('/api/workspaces', ensureAuth, async (req, res) => {
  try {
    const username = req.session.username || req.cookies.username || 'Usuário';
    const { nome, descricao, privado, membros, colunas } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ success: false, message: 'Nome é obrigatório' });
    const wsId = await workspaceModel.create({
      nome: nome.trim(),
      descricao: descricao || null,
      criado_por: username,
      privado: privado ? true : false,
    });
    if (Array.isArray(membros)) {
      for (const m of membros) {
        try {
          let tipo = m.tipo;
          let codigo = m.codigo;
          let nome_display = m.nome_display;
          if (tipo === 'grupo' && codigo) {
            try {
              const times = await timeModel.getTimes();
              const found = times.find(t => String(t.codigo) === String(codigo) || String(t.nome) === String(codigo));
              if (found) {
                tipo = 'time';
                codigo = String(found.id);
                nome_display = found.nome;
              }
            } catch (e) { console.error('Erro ao resolver grupo para time (batch):', e && e.message ? e.message : e); }
          }
          await workspaceModel.addAcesso(wsId, tipo, codigo, nome_display, m.permissao || 'editor');
        } catch (_) {}
      }
    }
    if (Array.isArray(colunas)) {
      for (let i = 0; i < colunas.length; i++) {
        const col = colunas[i];
        if (col.nome && col.nome.trim()) {
          try { await workspaceModel.addColuna(wsId, col.nome.trim(), col.cor || '#6366f1', i); } catch (_) {}
        }
      }
    }
    return res.json({ success: true, id: wsId });
  } catch (e) {
    console.error('Erro criar workspace:', e && e.message ? e.message : e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workspaces/:id/delete', ensureAuth, async (req, res) => {
  try {
    const id       = parseInt(req.params.id, 10);
    const username = req.session.username || req.cookies.username || 'Usuário';
    const ws = await workspaceModel.getById(id);
    if (!ws) return res.status(404).json({ success: false, message: 'Workspace não encontrado' });
    if (ws.criado_por !== username) return res.status(403).json({ success: false, message: 'Sem permissão' });
    await workspaceModel.softDelete(id);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workspaces/:wsId/tarefas', ensureAuth, async (req, res) => {
  try {
    const wsId    = parseInt(req.params.wsId, 10);
    const username = req.session.username || req.cookies.username || 'Usuário';
    const payload  = Object.assign({}, req.body, {
      criado_por:   username,
      id_workspace: wsId,
    });
    const id = await tarefaModel.insert(payload);
    return res.json({ success: true, id });
  } catch (e) {
    console.error('Erro inserir tarefa workspace:', e && e.message ? e.message : e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workspaces/:wsId/tarefas/reorder', ensureAuth, async (req, res) => {
  try {
    const { cards } = req.body;
    if (!Array.isArray(cards)) return res.status(400).json({ success: false, message: 'cards inválido' });
    const hasColuna = cards.length > 0 && cards[0].id_coluna !== undefined;
    if (hasColuna) {
      await tarefaModel.updatePosicoesWorkspace(cards);
    } else {
      await tarefaModel.updatePosicoes(cards);
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('Erro reorder workspace:', e && e.message ? e.message : e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workspaces/:id/colunas', ensureAuth, async (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
    const { nome, cor, posicao } = req.body;
    const colId = await workspaceModel.addColuna(id, nome, cor || '#6366f1', posicao || 0);
    return res.json({ success: true, id: colId });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workspaces/:id/colunas/reorder', ensureAuth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ success: false, message: 'items inválido' });
    await workspaceModel.reorderColunas(items);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workspaces/colunas/:id/delete', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await workspaceModel.deleteColuna(id);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workspaces/:id/acessos', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    let { tipo, codigo, nome_display, permissao } = req.body;
    if (tipo === 'grupo' && codigo) {
      try {
        const times = await timeModel.getTimes();
        const found = times.find(t => String(t.codigo) === String(codigo) || String(t.nome) === String(codigo));
        if (found) {
          tipo = 'time';
          codigo = String(found.id);
          nome_display = found.nome;
        }
      } catch (e) {
        console.error('Erro ao resolver grupo para time:', e && e.message ? e.message : e);
      }
    }

    const acessoId = await workspaceModel.addAcesso(id, tipo, codigo, nome_display, permissao || 'editor');
    return res.json({ success: true, id: acessoId });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workspaces/acessos/:id/delete', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await workspaceModel.removeAcesso(id);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/anotacoes', ensureAuth, async (req, res) => {
  const userId         = req.session.username || req.cookies.username || '';
  const includeArchived = req.query.arquivadas === '1';
  let anotacoes = [];
  let etiquetas = [];
  try {
    [anotacoes, etiquetas] = await Promise.all([
      anotacaoModel.getAll(userId, includeArchived),
      anotacaoModel.getEtiquetas(),
    ]);
  } catch (e) {
    console.error('Erro anotações:', e && e.message ? e.message : e);
  }
  return res.render('anotacoes', { anotacoes, etiquetas, includeArchived, user: getSessionUser(req) });
});

app.get('/api/tarefas', ensureAuth, async (req, res) => {
  try {
    const data = await tarefaModel.getAll();
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/tarefas/:id', ensureAuth, async (req, res) => {
  try {
    const id   = parseInt(req.params.id, 10);
    const data = await tarefaModel.getById(id);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/tarefas', ensureAuth, async (req, res) => {
  try {
    const payload = Object.assign({}, req.body, { criado_por: getSessionUser(req).nome });
    const id = await tarefaModel.insert(payload);
    return res.json({ success: true, id });
  } catch (e) {
    console.error('Erro inserir tarefa:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/tarefas/reorder', ensureAuth, async (req, res) => {
  try {
    const { cards } = req.body;
    if (!Array.isArray(cards)) return res.status(400).json({ success: false, message: 'cards inválido' });
    await tarefaModel.updatePosicoes(cards);
    return res.json({ success: true });
  } catch (e) {
    console.error('Erro reorder:', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/tarefas/:id/update', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await tarefaModel.update(id, req.body);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/tarefas/:id/delete', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await tarefaModel.deleteById(id);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/tarefas/:id/status', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await tarefaModel.updateStatus(id, req.body.status);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/tarefas/:id/checklist', ensureAuth, async (req, res) => {
  try {
    const id   = parseInt(req.params.id, 10);
    const data = await tarefaModel.getChecklistItems(id);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/tarefas/:id/checklist', ensureAuth, async (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
    const newId = await tarefaModel.addChecklistItem(id, req.body.descricao);
    return res.json({ success: true, id: newId });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/checklist/:id/toggle', ensureAuth, async (req, res) => {
  try {
    const id       = parseInt(req.params.id, 10);
    const concluido = await tarefaModel.toggleChecklistItem(id);
    return res.json({ success: true, concluido });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/checklist/:id/delete', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await tarefaModel.deleteChecklistItem(id);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/checklist/:id/update', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { descricao } = req.body;
    if (!descricao || !descricao.trim()) return res.status(400).json({ success: false, message: 'Descrição obrigatória' });
    await tarefaModel.updateChecklistItem(id, descricao.trim());
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/tarefas/:id/checklist/reorder', ensureAuth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ success: false, message: 'items inválido' });
    await tarefaModel.reorderChecklistItems(items);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/anotacoes/grupos', ensureAuth, async (req, res) => {
  try {
    const data = await anotacaoModel.getGrupos();
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/anotacoes/:id', ensureAuth, async (req, res) => {
  try {
    const id   = parseInt(req.params.id, 10);
    const data = await anotacaoModel.getById(id);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/anotacoes', ensureAuth, async (req, res) => {
  try {
    const payload = Object.assign({}, req.body, { id_usuario: req.session.username || req.cookies.username || null });
    console.log('Payload anotacao:', payload);
    const id = await anotacaoModel.insert(payload);
    return res.json({ success: true, id });
  } catch (e) {
    console.error('Erro inserir anotacao:', e && e.message ? e.message : e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/anotacoes/:id/update', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await anotacaoModel.update(id, req.body);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/anotacoes/:id/delete', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await anotacaoModel.deleteById(id);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/anotacoes/:id/pin', ensureAuth, async (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const fixado = await anotacaoModel.toggleFixado(id);
    return res.json({ success: true, fixado });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/anotacoes/:id/archive', ensureAuth, async (req, res) => {
  try {
    const id       = parseInt(req.params.id, 10);
    const arquivado = await anotacaoModel.toggleArquivado(id);
    return res.json({ success: true, arquivado });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/time', ensureAuth, (req, res) => res.redirect('/times'));

app.get('/times', ensureAuth, async (req, res) => {
  try {
    const times = await timeModel.getTimes();
    return res.render('times', { times, user: getSessionUser(req) });
  } catch (e) {
    console.error('Erro times:', e && e.message ? e.message : e);
    return res.redirect('/');
  }
});

app.get('/time/:id', ensureAuth, async (req, res) => {
  const timeId = parseInt(req.params.id, 10);
  try {
    const times = await timeModel.getTimes();
    const selected = times.find(t => t.id === timeId) || null;
    const membros = await timeModel.getMembros(timeId);
    return res.render('cadastro_time', { membros, selectedTime: selected, user: getSessionUser(req) });
  } catch (e) {
    console.error('Erro time:', e && e.message ? e.message : e);
    return res.redirect('/times');
  }
});

app.get('/api/time/buscar', ensureAuth, async (req, res) => {
  try {
    const nome = req.query.nome || null;
    const result = await timeModel.buscarUsuarios(nome);
    return res.json({ success: true, colunas: result.colunas, data: result.registros });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/time/membros', ensureAuth, async (req, res) => {
  try {
    const timeId = req.query.timeId || null;
    const data = await timeModel.getMembros(timeId);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/time/times', ensureAuth, async (req, res) => {
  try {
    const data = await timeModel.getTimes();
    return res.json({ success: true, data });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/time/times', ensureAuth, async (req, res) => {
  try {
    const { codigo, nome, descricao } = req.body;
    if (!nome) return res.status(400).json({ success: false, message: 'Nome do time é obrigatório' });
    const id = await timeModel.addTime(codigo, nome, descricao);
    return res.json({ success: true, id });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/time/times/:id/update', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { codigo, nome, descricao } = req.body;
    if (!nome) return res.status(400).json({ success: false, message: 'Nome é obrigatório' });
    await timeModel.updateTime(id, codigo, nome, descricao);
    return res.json({ success: true });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/time/times/:id/delete', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await timeModel.deleteTime(id);
    return res.json({ success: true });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/time/grupos', ensureAuth, async (req, res) => {
  try {
    const data = await workspaceModel.getGrupos();
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/time/membros', ensureAuth, async (req, res) => {
  try {
    const { codigo, nome, grupo, usrId, timeId } = req.body;
    if (!codigo || !nome) return res.status(400).json({ success: false, message: 'Código e nome são obrigatórios' });
    const id = await timeModel.addMembro(codigo, nome, grupo, usrId, timeId);
    return res.json({ success: true, id });
  } catch (e) {
    console.error('Erro adicionar membro:', e && e.message ? e.message : e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/time/membros/:id/delete', ensureAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await timeModel.removeMembro(id);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Central de Tarefas rodando em http://localhost:${PORT}`);
  console.log(`Login: http://localhost:${PORT}/loginPage`);
});
