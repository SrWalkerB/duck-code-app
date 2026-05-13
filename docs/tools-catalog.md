# Catálogo de Tools — referência dos projetos exemplo

Inventário completo dos tools presentes em `example/claude-code/tools/` e `example/openclaude/src/tools/`. Os dois projetos têm praticamente o mesmo set (openclaude é fork do claude-code). Este documento serve como referência para o refactor do sistema de tool-calling do `duck-codex`.

**Status:**
- ✅ **v1** — incluir no refactor inicial
- 🟡 **v2** — útil mas não crítico; avaliar depois
- ❌ **skip** — fora de escopo para editor local

---

## Filesystem (5 tools)

| Tool | Status | Descrição | Arquivo-referência |
|------|:------:|-----------|--------------------|
| `FileReadTool` | ✅ v1 | Lê arquivo com offset/limit, formato `cat -n`, cache de staleness, suporte a binário/imagem/notebook | `example/openclaude/src/tools/FileReadTool/FileReadTool.ts` |
| `FileWriteTool` | ✅ v1 | Cria/sobrescreve arquivo. Se arquivo existe, exige `read_file` antes | `example/openclaude/src/tools/FileWriteTool/FileWriteTool.ts` |
| `FileEditTool` | ✅ v1 | Replace exato de string OU line-range. `findActualString` com 3 fallbacks (quote/whitespace), `preserveQuoteStyle`, uniqueness check | `example/openclaude/src/tools/FileEditTool/FileEditTool.ts` |
| `GlobTool` | ✅ v1 | Match por padrão (`**/*.ts`), ordena resultado por mtime, respeita `.gitignore` | `example/openclaude/src/tools/GlobTool/GlobTool.ts` |
| `GrepTool` | ✅ v1 | Busca via ripgrep com 3 output modes: `content` / `files_with_matches` / `count`. Suporta multiline, type filter | `example/openclaude/src/tools/GrepTool/GrepTool.ts` |

## Execução de comando (2)

| Tool | Status | Descrição | Arquivo-referência |
|------|:------:|-----------|--------------------|
| `BashTool` | 🟡 v2 | Executa shell command com timeout, size limit, approval obrigatório, cwd controlado | `example/openclaude/src/tools/BashTool/` |
| `PowerShellTool` | ❌ skip | Windows-only shell | `example/openclaude/src/tools/PowerShellTool/` |

## Notebook (1)

| Tool | Status | Descrição |
|------|:------:|-----------|
| `NotebookEditTool` | ❌ skip | Editar células de `.ipynb`. Nicho data-science |

## Interação com usuário (2)

| Tool | Status | Descrição | Arquivo-referência |
|------|:------:|-----------|--------------------|
| `AskUserQuestionTool` | ✅ v1 | Até 4 perguntas por chamada. Cada pergunta: `{question, header, options[{label, description, preview?}], multiSelect}` | `example/openclaude/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx` |
| `TodoWriteTool` | ✅ v1 | Checklist da sessão. Estados `pending` / `in_progress` / `completed`. Só 1 in_progress por vez | `example/openclaude/src/tools/TodoWriteTool/TodoWriteTool.ts` |

## Web (2)

| Tool | Status | Descrição |
|------|:------:|-----------|
| `WebFetchTool` | 🟡 v2 | Baixa URL, extrai texto (markdown-ify) |
| `WebSearchTool` | ❌ skip | Busca na web. Requer API externa (Brave/Google) — foco local por ora |

## Multi-agente / orquestração (9)

| Tool | Status | Descrição |
|------|:------:|-----------|
| `AgentTool` | ❌ skip | Spawn de sub-agente (Task). Complexo — só com foundation madura |
| `TaskCreateTool` | ❌ skip | Cria background task |
| `TaskGetTool` | ❌ skip | Consulta estado de task |
| `TaskListTool` | ❌ skip | Lista tasks |
| `TaskUpdateTool` | ❌ skip | Atualiza task |
| `TaskOutputTool` | ❌ skip | Lê output de task |
| `TaskStopTool` | ❌ skip | Cancela task |
| `SendMessageTool` | ❌ skip | Mensagem entre agentes |
| `WorkflowTool` (openclaude) | ❌ skip | Executa workflow pré-definido |

## Plan mode (2)

| Tool | Status | Descrição |
|------|:------:|-----------|
| `EnterPlanModeTool` | ❌ skip | Entra em modo planejamento |
| `ExitPlanModeTool` | ❌ skip | Sai com plano aprovado |

*Plan mode é recurso do host CLI; não faz sentido replicar dentro de um editor.*

## Git worktree (2)

| Tool | Status | Descrição |
|------|:------:|-----------|
| `EnterWorktreeTool` | ❌ skip | Cria worktree isolada |
| `ExitWorktreeTool` | ❌ skip | Destrói worktree |

## MCP — Model Context Protocol (4)

| Tool | Status | Descrição |
|------|:------:|-----------|
| `MCPTool` | ❌ skip | Chama ferramenta MCP genérica |
| `ListMcpResourcesTool` | ❌ skip | Lista recursos expostos por servidor MCP |
| `ReadMcpResourceTool` | ❌ skip | Lê recurso MCP |
| `McpAuthTool` | ❌ skip | Autentica servidor MCP |

*MCP é para integrar servidores externos — fora do escopo v1. Pode virar v3 se quiser expor MCP do duck-codex.*

## Remote / scheduling (3)

| Tool | Status | Descrição |
|------|:------:|-----------|
| `RemoteTriggerTool` | ❌ skip | Dispara trigger remoto |
| `ScheduleCronTool` | ❌ skip | Agenda execução via cron |
| `SleepTool` | ❌ skip | Pausa o agente por X segundos |

## Team / configuração (3)

| Tool | Status | Descrição |
|------|:------:|-----------|
| `TeamCreateTool` | ❌ skip | Cria team context (Anthropic internal) |
| `TeamDeleteTool` | ❌ skip | Deleta team context |
| `ConfigTool` | ❌ skip | Lê/altera config do CLI (não aplicável ao editor) |

## Desenvolvimento (7)

| Tool | Status | Descrição |
|------|:------:|-----------|
| `LSPTool` | 🟡 v2 | Consulta Language Server Protocol (hover, defs, refs). Feature premium que acelera navegação |
| `REPLTool` | ❌ skip | Executa JS/TS em REPL persistente |
| `MonitorTool` (openclaude) | ❌ skip | Monitora processo background |
| `BriefTool` | ❌ skip | Pede ao agente resumir saída longa |
| `SyntheticOutputTool` | ❌ skip | Injeta output sintético (teste interno) |
| `VerifyPlanExecutionTool` (openclaude) | ❌ skip | Verifica execução de plano |
| `TungstenTool` (openclaude) | ❌ skip | Tool interna Anthropic (sem documentação pública) |

## Skills / busca (3)

| Tool | Status | Descrição |
|------|:------:|-----------|
| `SkillTool` | ❌ skip | Invoca Claude skill |
| `ToolSearchTool` | ❌ skip | Busca tools deferidos (lazy loading de schemas) |
| `SuggestBackgroundPRTool` (openclaude) | ❌ skip | Sugere PR em paralelo |

---

## Resumo — decisão de escopo para duck-codex

### v1 (refactor imediato) — 7 tools
`FileReadTool` · `FileWriteTool` · `FileEditTool` · `GlobTool` · `GrepTool` · `AskUserQuestionTool` · `TodoWriteTool`

### v2 (roadmap futuro) — 3 tools
`BashTool` · `WebFetchTool` · `LSPTool`

### Skip permanente — ~34 tools
Multi-agente, MCP, git worktree, plan-mode, configuração interna, Windows-only, remote triggers, REPL, skills, scheduling.

---

## Estrutura por tool (padrão a replicar)

Cada tool nos exemplos é uma pasta com arquivos bem segmentados:

```
FooTool/
├── FooTool.ts       # buildTool() com name, description, prompt, inputSchema, call, validateInput, checkPermissions
├── prompt.ts        # texto do prompt + constantes (TOOL_NAME, DESCRIPTION, mensagens de erro)
├── types.ts         # inputSchema/outputSchema em zod (com lazySchema para quebrar circular deps)
├── UI.tsx           # rendering Ink/React da tool call (pode adaptar para duck-codex)
├── utils.ts         # funções puras auxiliares (findActualString, diff helpers)
└── constants.ts     # valores fixos (limites, códigos de erro)
```

Essa separação é o padrão adotado no refactor do `duck-codex/electron/main/services/tools/definitions/<tool>/`.

---

## Pontos-chave dos tools críticos (read_file e edit_file)

Destaques de robustez que **precisam ser portados**:

### FileReadTool
- Formato `cat -n` com tab entre número e conteúdo
- `FILE_UNCHANGED_STUB` quando read repetido sem modificação
- Binary detection (primeiros 8KB, procura `\0`)
- `findSimilarFile` para sugerir "você quis dizer X?" em not-found
- `readFileSyncWithMetadata` — detecta LF/CRLF e encoding
- Size limits dinâmicos via `limits.ts`

### FileEditTool
- `findActualString` com 3 fallbacks: exact → quote-normalization (curly→straight) → whitespace-normalization
- `preserveQuoteStyle` — mantém estilo de aspas original do arquivo
- `semanticBoolean` preprocessor em `replace_all` (aceita `"true"`, `"yes"`, `1`)
- `errorCode` numerado 1-10 por falha (identical / not-read / modified-externally / multiple-occurrences / not-found / etc.)
- Staleness check via mtime diff (> 1s = suspeito)
- Line-ending preservation (LF vs CRLF)
- Atomic write (tmp → rename)
- `structuredPatch` no output para diff inline no chat
- Uniqueness error inclui contagem: "Found 3 occurrences..."

### AskUserQuestionTool (schema rico)
- Até 4 perguntas por chamada
- Cada pergunta: `{question, header (chip max 12ch), options[{label, description, preview?}], multiSelect}`
- `preview` permite ASCII/HTML mockups lado-a-lado
- Refine check: perguntas/options labels únicos
