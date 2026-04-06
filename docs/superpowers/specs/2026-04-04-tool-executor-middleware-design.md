# Tool Executor Middleware — Design Spec

**Data:** 2026-04-04  
**Objetivo:** Permitir que qualquer provider (LM Studio, OpenAI, Claude API) crie, edite e gerencie arquivos no diretório do projeto, independente de suportar function calling nativo.

## Contexto

O Duck Code App suporta múltiplos providers de IA (LM Studio, OpenAI, Claude API, Claude Code CLI, Codex CLI). Os CLI providers (Claude Code, Codex) já possuem ferramentas nativas para manipulação de arquivos. Porém, providers API (LM Studio, OpenAI, Claude API) apenas retornam texto — não conseguem criar ou editar arquivos reais.

O usuário quer enviar comandos como "crie uma página HTML e CSS sobre Gemma 4" e ter os arquivos realmente criados no diretório do projeto, independente do provider.

## Decisões de Design

1. **System prompt com ferramentas simuladas** — O app injeta um system prompt com definições de ferramentas em formato XML. O modelo responde com `<tool_call>` tags e o app executa.
2. **Approval mode existente** — O seletor Suggest/Auto-edit/Full-auto já existente na UI controla o nível de permissão das operações.
3. **Conjunto completo de ferramentas** — create_file, edit_file, read_file, delete_file, list_files, search_files, rename_file, create_directory, run_command.
4. **Formato XML universal** — `<tool_call>` tags funcionam com qualquer modelo que siga instruções, sem depender de function calling nativo.
5. **Thread Logs** — Página de logs por thread mostrando o prompt original enviado ao provider, tool calls, tool results e re-requests.

## Arquitetura

### Fluxo Atual

```
User → message:send → streamResponse() → provider.sendMessageStream() → resposta texto
```

### Novo Fluxo

```
User → message:send → streamResponse() → toolExecutor.run()
  │
  ├─ Provider tem supportsNativeTools? → Sim → provider.sendMessageStream() direto (CLI providers)
  │
  └─ Não → toolExecutor orquestra:
       1. Injeta system prompt com ferramentas disponíveis
       2. Chama provider.sendMessageStream()
       3. Acumula resposta e faz parse procurando <tool_call> tags
       4. Se encontra tool_call:
          a. Verifica approvalMode
          b. Se precisa aprovação → emite chat:tool-approval:${threadId} → aguarda resposta
          c. Se aprovado ou auto → executa ferramenta (fs operation)
          d. Emite chat:activity com detalhes da ferramenta
          e. Salva log da operação
          f. Monta <tool_result> e faz nova chamada ao provider
          g. Volta ao passo 3 (loop)
       5. Se não tem tool_call → retorna resposta final
```

### Arquivos Novos

| Arquivo | Responsabilidade |
|---|---|
| `electron/main/services/tools/tool-executor.ts` | Orquestrador principal — injeta prompt, coordena loop parse→execute→re-call |
| `electron/main/services/tools/tool-definitions.ts` | Definições das ferramentas e geração do system prompt |
| `electron/main/services/tools/tool-handlers.ts` | Implementação de cada ferramenta (operações fs reais) |
| `electron/main/services/tools/tool-parser.ts` | Parse de `<tool_call>` tags na resposta streamed |
| `electron/main/services/tools/tool-logger.ts` | Logger de operações para a view de logs |
| `src/components/chat/tool-approval-card.tsx` | Card de aprovação na UI (modo suggest) |
| `src/components/thread-logs/thread-logs.tsx` | Página de logs da thread |

### Arquivos Modificados

| Arquivo | Mudança |
|---|---|
| `electron/main/ipc/messages.ts` | `streamResponse()` usa ToolExecutor para providers sem ferramentas nativas |
| `electron/main/services/providers/types.ts` | Adicionar `supportsNativeTools: boolean` na interface |
| `electron/main/services/providers/lm-studio.ts` | `supportsNativeTools = false` |
| `electron/main/services/providers/openai.ts` | `supportsNativeTools = false` |
| `electron/main/services/providers/claude.ts` | `supportsNativeTools = false` |
| `electron/main/services/providers/claude-code.ts` | `supportsNativeTools = true` |
| `electron/main/services/providers/codex.ts` | `supportsNativeTools = true` |
| `electron/main/ipc/index.ts` | Registrar handlers de tool approval |
| `src/hooks/use-chat.ts` | Listener para `chat:tool-approval` events |
| `src/stores/app-store.ts` | Estado para pending tool approvals e logs |
| `src/components/chat/chat-area.tsx` | Renderizar tool-approval-card |

## System Prompt

Injetado como primeiro item do histórico (role: "system" ou "user" dependendo do provider):

```
You are a coding assistant with access to file system tools. When you need to create, read, edit, or manage files, use the tools below.

To use a tool, write a tool call in this exact format:

<tool_call>
{"name": "tool_name", "args": {"param1": "value1", "param2": "value2"}}
</tool_call>

IMPORTANT RULES:
- Always use exactly one <tool_call> block per tool invocation
- Wait for the <tool_result> before making another tool call
- All file paths are relative to the project root directory
- Do NOT create files by just writing code in your response — use create_file tool instead
- After creating or editing files, briefly explain what you did

Available tools:

## create_file
Create a new file with the given content.
Args: path (string, required), content (string, required)

## edit_file  
Replace a specific part of a file's content.
Args: path (string, required), old_content (string, required), new_content (string, required)

## read_file
Read the contents of a file.
Args: path (string, required)

## delete_file
Delete a file.
Args: path (string, required)

## list_files
List files and directories at a path.
Args: path (string, optional — defaults to project root)

## search_files
Search for text/pattern in files within a directory.
Args: path (string, optional — defaults to project root), pattern (string, required)

## rename_file
Rename or move a file.
Args: old_path (string, required), new_path (string, required)

## create_directory
Create a directory (and parent directories if needed).
Args: path (string, required)

## run_command
Run a shell command in the project directory.
Args: command (string, required), cwd (string, optional — relative to project root)
```

## Tool Parser

O parser opera sobre o texto acumulado da resposta:

1. Texto antes de `<tool_call>` → emitido como delta normal pro chat
2. Conteúdo entre `<tool_call>` e `</tool_call>` → extraído e parseado como JSON
3. Se o JSON é válido → retorna `{ name, args }` para execução
4. Se inválido → emite como texto normal (modelo errou o formato)

### Estados do Parser

```
NORMAL → detecta "<tool_call>" → COLLECTING → detecta "</tool_call>" → PARSE → NORMAL
```

No estado COLLECTING, deltas não são emitidos pro chat (o tool call fica invisível pro usuário, aparece como activity).

## Approval Mode — Permissões por Ferramenta

| Ferramenta | Suggest | Auto-edit | Full-auto |
|---|---|---|---|
| `read_file` | Auto | Auto | Auto |
| `list_files` | Auto | Auto | Auto |
| `search_files` | Auto | Auto | Auto |
| `create_file` | Aprovação | Auto | Auto |
| `edit_file` | Aprovação | Auto | Auto |
| `rename_file` | Aprovação | Auto | Auto |
| `create_directory` | Aprovação | Auto | Auto |
| `delete_file` | Aprovação | Aprovação | Auto |
| `run_command` | Aprovação | Aprovação | Auto |

### Fluxo de Aprovação (modo Suggest)

1. ToolExecutor detecta tool_call que precisa aprovação
2. Emite `chat:tool-approval:${threadId}` com: `{ runId, tool, args, description }`
3. Renderer mostra card com detalhes da operação e botões Aprovar/Rejeitar
4. Usuário clica → renderer envia `message:tool-approval-response` com `{ threadId, runId, approved: boolean }`
5. Se aprovado → executa e continua loop
6. Se rejeitado → injeta `<tool_result>Operation rejected by user.</tool_result>` e continua

## Tool Handlers — Implementação

Cada handler recebe `(args, projectPath)` e retorna `{ success: boolean, output: string }`.

### Segurança

- **Path sandboxing**: Todo path é resolvido como `path.resolve(projectPath, relativePath)` e validado com `resolvedPath.startsWith(projectPath)`. Rejeita traversal (`../`).
- **run_command**: Em modo suggest e auto-edit, sempre pede aprovação. Timeout de 30s. Não permite comandos destrutivos óbvios (rm -rf /, etc.).
- **Tamanho de arquivo**: Limite de 1MB para create_file e edit_file.

### Implementação de cada handler

```typescript
// create_file: writeFile(resolvedPath, content, 'utf-8') — cria diretórios pai se necessário
// edit_file: readFile → replace old_content → writeFile
// read_file: readFile(resolvedPath, 'utf-8')
// delete_file: unlink(resolvedPath)
// list_files: readdir com formatação tree-like
// search_files: grep recursivo com node (ou child_process rg/grep)
// rename_file: rename(oldResolved, newResolved)
// create_directory: mkdir(resolvedPath, { recursive: true })
// run_command: execFile com shell, timeout 30s, retorna stdout+stderr
```

## Thread Logs

### O que é logado

Cada interação com o provider é registrada como um `ToolLog` entry:

```typescript
interface ToolLog {
  id: string;
  threadId: string;
  runId: string;
  timestamp: number;
  type: "system_prompt" | "request" | "response" | "tool_call" | "tool_result" | "re_request";
  content: string; // JSON stringificado do payload completo
}
```

### Armazenamento

Campo `logs` na tabela Message (JSON) ou tabela separada `ToolLog` no Prisma. Recomendação: campo JSON no metadata da Message para simplicidade, separando por `runId`.

### UI

- Botão "Logs" no header da thread (ou ícone de terminal)
- Abre um painel/modal com timeline das operações
- Cada entry é expandível mostrando o JSON completo
- System prompt injetado aparece como primeiro entry
- Filtros por tipo (system_prompt, tool_call, etc.)

## Providers e ToolExecutor

| Provider | `supportsNativeTools` | Comportamento |
|---|---|---|
| LM Studio | `false` | ToolExecutor ativo — injeta prompt, parseia, executa |
| OpenAI API | `false` | ToolExecutor ativo |
| Claude API | `false` | ToolExecutor ativo |
| Claude Code CLI | `true` | ToolExecutor ignorado — CLI já tem ferramentas |
| Codex CLI | `true` | ToolExecutor ignorado — CLI já tem ferramentas |

## Verificação

1. Criar um projeto apontando para um diretório de teste
2. Selecionar LM Studio com um modelo local
3. Enviar "crie um arquivo index.html com um hello world"
4. Verificar que o modelo responde com `<tool_call>` e o arquivo é criado no disco
5. Verificar que a activity aparece no chat
6. Testar com approvalMode "suggest" — verificar que o card de aprovação aparece
7. Abrir logs da thread e verificar que o system prompt e tool calls estão registrados
8. Testar edit_file, delete_file, run_command
9. Testar path traversal (deve ser bloqueado)
10. Testar com OpenAI e Claude API — mesmo comportamento
