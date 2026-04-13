const swaggerUi = require('swagger-ui-express');

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Central de Tarefas',
    version: '1.0.0',
    description: 'Sistema de gestão de tarefas com workspaces, quadro kanban, anotações e times. Autenticação via sessão.',
  },
  servers: [{ url: 'http://localhost:3006', description: 'Servidor local' }],
  tags: [
    { name: 'Autenticação' },
    { name: 'Workspaces', description: 'Espaços de trabalho (projetos)' },
    { name: 'Tarefas' },
    { name: 'Checklist' },
    { name: 'Anotações' },
    { name: 'Times' },
    { name: 'Páginas', description: 'Rotas que retornam HTML' },
  ],
  paths: {
    '/loginPage': { get: { tags: ['Autenticação'], summary: 'Página de login', responses: { 200: { description: 'HTML' } } } },
    '/login': {
      post: {
        tags: ['Autenticação'], summary: 'Autentica usuário',
        requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string', format: 'password' } } } } } },
        responses: { 302: { description: 'Redireciona para /dashboard' } },
      },
    },
    '/logout': { get: { tags: ['Autenticação'], summary: 'Encerra sessão', responses: { 302: { description: 'Redireciona para /loginPage' } } } },
    '/dashboard': { get: { tags: ['Páginas'], summary: 'Dashboard principal', security: [{ cookieAuth: [] }], responses: { 200: { description: 'Página' } } } },
    '/workspaces': { get: { tags: ['Páginas'], summary: 'Lista workspaces', security: [{ cookieAuth: [] }], responses: { 200: { description: 'Página de workspaces' } } } },
    '/workspaces/{id}/quadro': { get: { tags: ['Páginas'], summary: 'Quadro kanban do workspace', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Kanban' } } } },
    '/workspaces/{id}/listagem': { get: { tags: ['Páginas'], summary: 'Listagem de tarefas do workspace', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Listagem' } } } },
    '/anotacoes': { get: { tags: ['Páginas'], summary: 'Página de anotações', security: [{ cookieAuth: [] }], responses: { 200: { description: 'Anotações' } } } },
    '/times': { get: { tags: ['Páginas'], summary: 'Página de times', security: [{ cookieAuth: [] }], responses: { 200: { description: 'Times' } } } },
    '/time/{id}': { get: { tags: ['Páginas'], summary: 'Detalhes de um time', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Detalhe do time' } } } },

    '/api/workspaces': {
      post: {
        tags: ['Workspaces'], summary: 'Cria workspace', security: [{ cookieAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { nome: { type: 'string' }, descricao: { type: 'string' } } } } } },
        responses: { 200: { description: 'Workspace criado' } },
      },
    },
    '/api/workspaces/{id}/delete': { post: { tags: ['Workspaces'], summary: 'Remove workspace', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Removido' } } } },
    '/api/workspaces/{id}/colunas': { post: { tags: ['Workspaces'], summary: 'Adiciona coluna ao kanban', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Coluna criada' } } } },
    '/api/workspaces/{id}/colunas/reorder': { post: { tags: ['Workspaces'], summary: 'Reordena colunas', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Reordenado' } } } },
    '/api/workspaces/{id}/acessos': { post: { tags: ['Workspaces'], summary: 'Gerencia acessos do workspace', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Acesso atualizado' } } } },

    '/api/tarefas': {
      get: { tags: ['Tarefas'], summary: 'Lista tarefas', security: [{ cookieAuth: [] }], responses: { 200: { description: 'Array de tarefas' } } },
      post: { tags: ['Tarefas'], summary: 'Cria tarefa', security: [{ cookieAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { titulo: { type: 'string' }, descricao: { type: 'string' }, workspaceId: { type: 'integer' }, colunaId: { type: 'integer' } } } } } }, responses: { 200: { description: 'Tarefa criada' } } },
    },
    '/api/tarefas/{id}': { get: { tags: ['Tarefas'], summary: 'Detalhe da tarefa', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Tarefa' } } } },
    '/api/tarefas/{id}/update': { post: { tags: ['Tarefas'], summary: 'Atualiza tarefa', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Atualizado' } } } },
    '/api/tarefas/{id}/delete': { post: { tags: ['Tarefas'], summary: 'Remove tarefa', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Removido' } } } },
    '/api/tarefas/{id}/status': { post: { tags: ['Tarefas'], summary: 'Muda status/coluna da tarefa', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Status atualizado' } } } },
    '/api/tarefas/{id}/checklist': {
      get: { tags: ['Checklist'], summary: 'Lista itens do checklist', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Checklist' } } },
      post: { tags: ['Checklist'], summary: 'Adiciona item ao checklist', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Item criado' } } },
    },
    '/api/checklist/{id}/toggle': { post: { tags: ['Checklist'], summary: 'Marca/desmarca item', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Alterado' } } } },
    '/api/checklist/{id}/delete': { post: { tags: ['Checklist'], summary: 'Remove item do checklist', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Removido' } } } },

    '/api/anotacoes': { post: { tags: ['Anotações'], summary: 'Cria anotação', security: [{ cookieAuth: [] }], responses: { 200: { description: 'Anotação criada' } } } },
    '/api/anotacoes/{id}': { get: { tags: ['Anotações'], summary: 'Detalhe da anotação', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Anotação' } } } },
    '/api/anotacoes/{id}/update': { post: { tags: ['Anotações'], summary: 'Atualiza anotação', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Atualizado' } } } },
    '/api/anotacoes/{id}/pin': { post: { tags: ['Anotações'], summary: 'Fixa/desfixa anotação', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Alterado' } } } },
    '/api/anotacoes/{id}/archive': { post: { tags: ['Anotações'], summary: 'Arquiva anotação', security: [{ cookieAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Arquivado' } } } },

    '/api/time/membros': {
      get:  { tags: ['Times'], summary: 'Lista membros', security: [{ cookieAuth: [] }], responses: { 200: { description: 'Array de membros' } } },
      post: { tags: ['Times'], summary: 'Adiciona membro', security: [{ cookieAuth: [] }], responses: { 200: { description: 'Membro adicionado' } } },
    },
    '/api/time/times': {
      get:  { tags: ['Times'], summary: 'Lista times', security: [{ cookieAuth: [] }], responses: { 200: { description: 'Array de times' } } },
      post: { tags: ['Times'], summary: 'Cria time', security: [{ cookieAuth: [] }], responses: { 200: { description: 'Time criado' } } },
    },
  },
  components: {
    securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'connect.sid' } },
  },
};

module.exports = { swaggerUi, swaggerDocument };
