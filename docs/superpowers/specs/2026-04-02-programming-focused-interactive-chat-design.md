# Duck Codex v2 — Programming-Focused Interactive Chat

**Data:** 2026-04-02  
**Status:** Aprovado  

## Contexto

O Duck Codex é um app desktop (Tauri 2 + React) que serve como interface visual para o Claude Code CLI. Atualmente funciona como chat simples: envia prompts e recebe respostas em streaming. Porém, o CLI emite eventos interativos (permissões de tools, perguntas ao usuário, plan mode) que hoje são ignorados porque o backend não conecta stdin ao processo. Isso impede o uso real para programação.

**Objetivo:** Transformar o Duck Codex numa ferramenta de programação completa, com suporte a todos os eventos interativos do CLI, painéis auxiliares (file explorer, terminal, git) e design limpo inspirado no Codex da OpenAI.

## Decisões de Design

| Decisão | Escolha |
|---------|---------|
| Layout geral | Chat-centric com painéis sob demanda |
| Permissões | Inline no chat (cards com botões) |
| Plan mode | Card colapsável inline |
| Permissão padrão | Sempre perguntar |
| Ferramentas extras | File explorer, terminal integrado, git visual |
| Imagens | Suporte a paste (Ctrl+V) e drag & drop |
| Status bar | Rica: permissões, custo, tokens, tempo, versão CLI |
| Design | Estilo Codex: limpo, ícones Lucide, espaçado, dark-first |

## Arquitetura

### 1. Eventos Interativos (core)

**Problema:** O backend spawna o Claude CLI com stdout pipe mas sem stdin. Eventos interativos travam o processo.

**Solução: stdin/stdout bidirecional + event parsing**

#### Backend (Rust) — `src-tauri/src/process/mod.rs`

- Adicionar `stdin` pipe ao `Command::new("claude")`
- Armazenar `ChildStdin` no `ProcessState` (junto com o PID)
- Parsear novos event types do stream-json além de `assistant` e `result`
- Emitir eventos Tauri específicos por tipo:
  - `chat:permission:{threadId}` — tool quer executar, precisa aprovação
  - `chat:question:{threadId}` — Claude faz pergunta ao usuário
  - `chat:plan:{threadId}` — Claude entra em plan mode
  - `chat:tool_result:{threadId}` — resultado de execução de tool
- Novo IPC command: `respond_to_prompt(thread_id, response: String)`
  - Busca o `ChildStdin` do processo ativo
  - Escreve a resposta + newline no stdin

#### Frontend (React) — Novos componentes

**`PermissionCard`** (`src/components/chat/permission-card.tsx`)
- Borda amarela (#f59e0b)
- Badge "PERMISSÃO"
- Mostra: nome da tool + argumentos (ex: `Bash: npm install passport`)
- Botões: Permitir, Negar, Permitir sempre
- Ao clicar, invoca `respond_to_prompt` com a resposta adequada

**`PlanCard`** (`src/components/chat/plan-card.tsx`)
- Borda azul (#3b82f6)
- Badge "PLAN"
- Header com título, colapsável
- Body com passos numerados, arquivos referenciados como `<code>`
- Botões: Aprovar, Rejeitar, Editar (abre input para comentário)

**`QuestionCard`** (`src/components/chat/question-card.tsx`)
- Borda roxa (#a855f7)
- Badge "PERGUNTA"
- Texto da pergunta
- Opções como botões clicáveis (se multiple choice)
- Campo de texto livre (se open-ended)

**`ToolResultCard`** (`src/components/chat/tool-result-card.tsx`)
- Borda cinza (#334155)
- Badge "TOOL"
- Header inline: `Write → src/auth/google.ts ✓ done`
- Colapsável: expandir para ver conteúdo completo
- Syntax highlight para código

#### Fluxo completo

```
1. CLI emite evento JSON no stdout (ex: permission request)
2. Backend (Rust) parseia o tipo do evento
3. Backend emite evento Tauri específico (chat:permission:{threadId})
4. Frontend (use-chat hook) recebe evento
5. Hook adiciona card interativo ao state do chat
6. Componente renderiza card inline no fluxo de mensagens
7. Usuário clica num botão (ex: "Permitir")
8. Frontend invoca IPC: respond_to_prompt(threadId, "yes")
9. Backend escreve "yes\n" no stdin do processo CLI
10. CLI continua execução
```

### 2. Painéis Sob Demanda

Botões no header da chat area: 📂 Arquivos, ⬛ Terminal, 🔀 Git

#### File Explorer (painel direito)

- **Componente:** `src/components/panels/file-explorer.tsx`
- Usa Tauri FS API (`readDir`, `readTextFile`) para navegar o diretório do projeto
- Árvore de diretórios colapsável com ícones por tipo de arquivo
- Clicar num arquivo abre preview read-only com syntax highlight
- Badge "modificado" quando Claude edita um arquivo (detectado via `chat:tool_result` com tool Write/Edit)
- Diff view: antes/depois de edições (armazenar snapshot pre-edit)

#### Terminal (painel inferior)

- **Componente:** `src/components/panels/terminal-panel.tsx`
- Usa `xterm.js` + `xterm-addon-fit` para terminal embutido
- Conecta ao shell do sistema via Tauri shell plugin (pty)
- Roda no `cwd` do projeto ativo
- Suporte a múltiplas tabs de terminal
- Independente do processo Claude — para o usuário rodar seus próprios comandos

#### Git (painel direito, alternativo ao file explorer)

- **Componente:** `src/components/panels/git-panel.tsx`
- Executa comandos `git` via Tauri command (shell)
- Views:
  - **Status:** staged, unstaged, untracked com ícones de status
  - **Diff:** viewer para arquivos modificados (inline diff)
  - **Commit:** stage files + mensagem + botão commit
  - **Branches:** listar, criar, trocar
  - **Log:** últimos N commits com hash, autor, mensagem

### 3. Image Paste

- **Onde:** `src/components/chat/chat-input.tsx`
- `onPaste` handler detecta imagem no clipboard (`clipboardData.items`)
- Mostra thumbnail preview acima do textarea
- Drag & drop na área do chat também aceita imagens
- Imagem salva como temp file via Tauri FS API
- Enviada ao Claude CLI (investigar suporte: flag `--image` ou base64 inline)
- Botão 🖼️ no input para selecionar imagem via file dialog

### 4. Status Bar

- **Componente:** `src/components/status-bar.tsx`
- Barra fixa na parte inferior do app
- Itens (esquerda → direita):
  - 🖥️ **Local** — indicador de modo
  - 🔒 **Sempre perguntar** — dropdown para mudar nível de permissão
  - 💰 **$0.042** — custo acumulado da thread (vem do `chat:complete` payload)
  - 📊 **12.4k tokens** — tokens usados na sessão
  - ⏱️ **2m 34s** — duração da sessão ativa
  - 📟 **claude v1.x.x** — versão do CLI (detectada via `claude --version` no startup)

### 5. Design Visual

Inspirado no Codex da OpenAI:
- **Ícones:** Lucide React (já usado no projeto) — outline style, consistentes
- **Tipografia:** System font stack, hierarquia clara (14px body, 12px secondary, 11px meta)
- **Espaçamento:** Generoso — padding 16px+ em áreas principais, gap 12px entre mensagens
- **Cores:** Dark theme como base. Cards interativos usam borda colorida sutil (não background gritante)
- **Bordas:** Mínimas — usar background differentiation ao invés de bordas pesadas
- **Transições:** Suave para abertura/fechamento de painéis e collapse de cards (200ms ease)
- **Hover states:** Sutil — opacidade ou background shift, nunca color change brusco

## Arquivos Críticos a Modificar

| Arquivo | Mudança |
|---------|---------|
| `src-tauri/src/process/mod.rs` | Adicionar stdin pipe, parsear novos event types, `respond_to_prompt` |
| `src-tauri/src/commands/mod.rs` | Novo command `respond_to_prompt`, handler de permissões |
| `src/hooks/use-chat.ts` | Listeners para novos eventos, state para cards interativos |
| `src/stores/app-store.ts` | State para painéis, status bar, permissões pendentes |
| `src/components/chat/chat-area.tsx` | Renderizar novos tipos de card |
| `src/components/chat/chat-input.tsx` | Image paste, drag & drop, botão de imagem |
| `src/components/chat/message-bubble.tsx` | Integrar cards dentro do fluxo de mensagens |
| `src/lib/types.ts` | Novos tipos para eventos interativos |

## Arquivos Novos

| Arquivo | Propósito |
|---------|-----------|
| `src/components/chat/permission-card.tsx` | Card de permissão inline |
| `src/components/chat/plan-card.tsx` | Card de plan mode |
| `src/components/chat/question-card.tsx` | Card de pergunta |
| `src/components/chat/tool-result-card.tsx` | Card de resultado de tool |
| `src/components/panels/file-explorer.tsx` | Navegador de arquivos do projeto |
| `src/components/panels/terminal-panel.tsx` | Terminal embutido |
| `src/components/panels/git-panel.tsx` | Interface git visual |
| `src/components/status-bar.tsx` | Barra de status inferior |

## Dependências Novas

| Pacote | Propósito |
|--------|-----------|
| `xterm` + `xterm-addon-fit` | Terminal embutido |
| `react-diff-viewer` ou similar | Diff view no file explorer e git |
| `highlight.js` ou `shiki` | Syntax highlight para file preview |

## Verificação

1. **Eventos interativos:** Rodar Claude CLI com `--output-format stream-json -p "read a file"` e verificar o formato dos eventos de permissão
2. **stdin pipe:** Testar que `respond_to_prompt` escreve corretamente e o CLI continua
3. **Plan mode:** Verificar que o card renderiza, colapsa, e os botões enviam a resposta certa
4. **Perguntas:** Testar com prompts que geram AskUserQuestion
5. **File explorer:** Navegar projeto real, abrir arquivos, verificar syntax highlight
6. **Terminal:** Rodar comandos básicos (ls, npm test), verificar que funciona no diretório do projeto
7. **Git:** Status, diff, commit em repo real
8. **Image paste:** Ctrl+V com imagem, drag & drop, verificar que chega ao CLI
9. **Status bar:** Verificar que custo, tokens e tempo atualizam em tempo real
