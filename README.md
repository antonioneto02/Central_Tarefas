# 🏷️ Central de Tarefas

> Aplicação web de gerenciamento de tarefas, anotações e controle de tempo — organizada por espaços de trabalho.

## 📋 Sobre o Projeto

A **Central de Tarefas** é uma aplicação web para organizar e acompanhar tarefas, anotações e tempo gasto em atividades. O sistema suporta múltiplos **espaços de trabalho** (workspaces), permitindo separar tarefas por projeto, equipe ou contexto.

O sistema resolve a necessidade de:
- **Centralizar** tarefas e anotações em um único lugar
- **Organizar** atividades por espaços de trabalho
- **Acompanhar** o progresso com quadro visual e listagem
- **Controlar** tempo investido em cada tarefa
- **Visualizar** métricas no painel (total, concluídas, em andamento, atrasadas)

## 🛠️ Tecnologias

| Tecnologia | Descrição |
|---|---|
| **Node.js** | Ambiente de execução |
| **Express** | Framework web |
| **EJS** | Motor de templates (renderização no servidor) |
| **mssql** | Conexão com SQL Server |
| **cookie-parser + express-session** | Gerenciamento de sessão e cookies |
| **compression** | Compressão gzip das respostas |
| **swagger-ui-express** | Documentação da API |
| **PM2** | Gerenciador de processos (`central-tarefas`) |
| **Porta** | `3002` (padrão no código) / conforme `.env` |

## 🔧 Como Funciona

1. **Autenticação** — O usuário acessa via SSO do **Hub Cini**. O token SSO chega pela query string (`sso_token`, `sso_refresh`, `sso_username`) e é salvo em cookies. Também é possível fazer login local.
2. **Painel** — O dashboard exibe estatísticas das tarefas: total, concluídas, em andamento e atrasadas, além de gráficos por status e prioridade.
3. **Espaços de trabalho** — O usuário pode criar e gerenciar workspaces para separar tarefas por contexto.
4. **Tarefas** — Dentro de cada workspace, é possível criar, editar, concluir e excluir tarefas. As tarefas podem ser visualizadas em formato de listagem ou quadro (kanban).
5. **Anotações** — Notas avulsas podem ser criadas para registrar informações rápidas.
6. **Controle de tempo** — É possível registrar o tempo gasto em cada tarefa e gerenciar equipes (times).

## 📡 Funcionalidades

### Telas do sistema

| Tela | Descrição |
|---|---|
| **Dashboard** (`/dashboard`) | Painel com estatísticas e gráficos de tarefas |
| **Listagem de Tarefas** | Visualização em lista das tarefas |
| **Quadro de Tarefas** | Visualização em quadro (estilo kanban) |
| **Anotações** | Criação e gerenciamento de anotações |
| **Espaços de Trabalho** | Listagem e quadro de workspaces |
| **Times** | Cadastro e gerenciamento de equipes |
| **Controle de Tempo** | Registro de tempo por tarefa |

### Modelos de dados

| Modelo | Descrição |
|---|---|
| `tarefaModel` | CRUD de tarefas, estatísticas e dados para gráficos |
| `anotacaoModel` | CRUD de anotações |
| `timeModel` | Gerenciamento de equipes/times |
| `workspaceModel` | CRUD de espaços de trabalho |

## 🗄️ Banco de Dados

- **Tipo:** SQL Server (biblioteca `mssql`)
- **Bancos:**
  - `dw` — Data Warehouse (tarefas, anotações, workspaces, times)
  - `p11_prod` — Protheus ERP (dados auxiliares de usuários)

## 🔗 Integrações

| Sistema | Tipo | Descrição |
|---|---|---|
| **Hub Cini** | SSO | Autenticação via Single Sign-On (recebe tokens via query string) |
| **Protheus ERP** | Banco de dados | Validação de login via `loginController` |

## ⚙️ Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
# Porta do servidor
PORT=3002

# Banco de dados
DB_USER_CT=seu_usuario
DB_PASSWORD_CT=sua_senha
DB_SERVER_CT=localhost
DB_DATABASE_DW=dw
DB_DATABASE_PROTHEUS=p11_prod

# Segurança
JWT_SECRET_CT=sua_chave_secreta

# Protheus
PROTHEUS_SERVER=192.168.0.88

# Integração
GESTAO_WEBHOOK_TOKEN=token_do_webhook
```

## 📖 Documentação Swagger

A documentação interativa está disponível em:

```
http://localhost:3002/docs
```

## 🚀 Como Rodar

### Pré-requisitos
- Node.js instalado
- SQL Server com os bancos `dw` e `p11_prod` acessíveis
- PM2 (opcional, para produção)

### Instalação

```bash
# Acessar o diretório do projeto
cd E:/Projetos/Central_Tarefas

# Instalar dependências
npm install

# Configurar variáveis de ambiente
# Editar o arquivo .env com as credenciais corretas
```

### Executar em desenvolvimento

```bash
npm start
```

### Executar em produção (PM2)

```bash
pm2 start server.js --name central-tarefas
```

O sistema estará disponível em `http://localhost:3002`.

### Estrutura de pastas

```
Central_Tarefas/
├── config/          # Configurações de banco de dados
├── controllers/     # Controladores (loginController)
├── models/          # Modelos de dados (tarefa, anotação, time, workspace)
├── views/           # Templates EJS
│   ├── partials/    # Componentes reutilizáveis
│   └── System/      # Telas de sistema (login, etc.)
├── assets/          # Recursos estáticos
├── public/          # Arquivos públicos (CSS)
├── server.js        # Ponto de entrada
└── swagger.js       # Configuração Swagger
```
