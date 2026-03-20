'use strict';

const path        = require('path');
const express     = require('express');
const compression = require('compression');
const session     = require('express-session');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const loginController = require('./controllers/loginController');
const tarefaModel     = require('./models/tarefaModel');
const anotacaoModel   = require('./models/anotacaoModel');

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(compression());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/css',    express.static(path.join(__dirname, 'public', 'css')));
app.use(cookieParser());
app.use(session({
  secret:            process.env.SESSION_SECRET || 'central_tarefas_secret_change_me',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 8 * 60 * 60 * 1000 }, // 8 horas
}));

// ─── Middleware global: currentPath + user locals ─────────────────────────────
app.use((req, res, next) => {
  res.locals.currentPath = req.path || '/';
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

// ─── Auth middleware ──────────────────────────────────────────────────────────
async function ensureAuth(req, res, next) {
  const token         = req.cookies && req.cookies.token;
  const refresh_token = req.cookies && req.cookies.refresh_token;
  if (!token && !refresh_token) {
    return res.redirect('/loginPage');
  }
  return next();
}

// ─── Public routes ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session && req.session.userID) return res.redirect('/dashboard');
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

// ─── Dashboard ────────────────────────────────────────────────────────────────
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

// ─── Quadro de Tarefas (Kanban) ───────────────────────────────────────────────
app.get('/tarefas/quadro', ensureAuth, async (req, res) => {
  let kanban = { A_FAZER: [], EM_ANDAMENTO: [], EM_REVISAO: [], CONCLUIDO: [] };
  try {
    kanban = await tarefaModel.getKanbanData();
  } catch (e) {
    console.error('Erro quadro:', e && e.message ? e.message : e);
  }
  return res.render('quadro_tarefas', { kanban, user: getSessionUser(req) });
});

// ─── Listagem de Tarefas ──────────────────────────────────────────────────────
app.get('/tarefas/listagem', ensureAuth, async (req, res) => {
  let tarefas      = [];
  let stats        = { total: 0, concluidas: 0, em_andamento: 0, atrasadas: 0 };
  let chartData    = { porStatus: [0,0,0,0], porPrioridade: [0,0,0] };
  let responsaveis = [];
  let categorias   = [];
  try {
    [tarefas, stats, chartData, responsaveis, categorias] = await Promise.all([
      tarefaModel.getAll(),
      tarefaModel.getStats(),
      tarefaModel.getChartData(),
      tarefaModel.getResponsaveis(),
      tarefaModel.getCategorias(),
    ]);
  } catch (e) {
    console.error('Erro listagem:', e && e.message ? e.message : e);
  }
  return res.render('listagem_tarefas', { tarefas, stats, chartData, responsaveis, categorias, user: getSessionUser(req) });
});

// ─── Anotações ────────────────────────────────────────────────────────────────
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

// ─── API: Tarefas ─────────────────────────────────────────────────────────────
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

// ─── API: Anotações ───────────────────────────────────────────────────────────
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

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Central de Tarefas rodando em http://localhost:${PORT}`);
  console.log(`Login: http://localhost:${PORT}/loginPage`);
});
