# Sistema de Tools — Duck Code App

## Visao Geral

O sistema de tools permite que modelos de IA (via LM Studio, OpenAI, Claude API) executem operacoes reais no filesystem do usuario: criar arquivos, editar codigo, buscar padroes, rodar comandos. O sistema e inspirado na arquitetura do Claude Code (OpenClaude) e do OpenCode.

O transporte usa tags XML `<tool_call>` para compatibilidade com modelos locais (LM Studio) que nao suportam function calling nativo.

---

## Arquitetura em Camadas

```
+---------------------------------------------------------+
|                    tool-executor.ts                      |
|         (Loop principal: LLM <-> Tools)                  |
|                                                          |
|  1. Monta system prompt com contexto do projeto          |
|  2. Chama o LLM via provider                             |
|  3. Parseia <tool_call> do stream                        |
|  4. Delega para camada de orquestracao                   |
|  5. Monta <tool_result> e reenvia ao LLM                |
|  6. Repete ate o LLM parar de chamar tools               |
+--------------------------+------------------------------+
                           |
+--------------------------v------------------------------+
|               tool-orchestration.ts                      |
|         (Particionamento e concorrencia)                 |
|                                                          |
|  - Recebe array de tool calls                            |
|  - Separa em: read-only (paralelo) e write (serial)     |
|  - Executa read-only com Promise.all()                   |
|  - Executa write um por um                               |
+--------------------------+------------------------------+
                           |
+--------------------------v------------------------------+
|                tool-execution.ts                         |
|         (Execucao individual de cada tool)               |
|                                                          |
|  Para cada tool call:                                    |
|  1. findToolByName() -> busca no registry                |
|  2. inputSchema.safeParse() -> valida com Zod            |
|  3. tool.validateInput() -> validacao custom             |
|  4. tool.checkPermissions() -> allow/ask/deny            |
|  5. Se "ask" -> onApprovalNeeded() -> UI pede aprovacao  |
|  6. tool.call(input, context) -> executa                 |
|  7. Logger registra no banco                             |
|  8. Retorna ToolResult { success, output, metadata }     |
+--------------------------+------------------------------+
                           |
+--------------------------v------------------------------+
|              definitions/*.ts (Registry)                 |
|         (Uma tool por arquivo)                           |
|                                                          |
|  Cada tool implementa a interface ToolDef:               |
|  - name, description, inputSchema (Zod)                  |
|  - isReadOnly, isConcurrencySafe                         |
|  - checkPermissions(input, ctx) -> allow/ask/deny        |
|  - validateInput(input, ctx) -> valid/error              |
|  - call(input, ctx) -> ToolResult                        |
|                                                          |
|  Tools disponiveis:                                      |
|  read_file, write_file, edit_file, delete_file,          |
|  glob, grep, list_files, rename_file,                    |
|  create_directory, bash                                   |
+----------------------------------------------------------+
```

---

## Interface ToolDef — O contrato de cada tool

```typescript
interface ToolDef<TInput> {
  name: string;              // Identificador unico (ex: "read_file")
  description: string;       // Descricao passada ao LLM no system prompt
  inputSchema: z.ZodType;    // Schema Zod para validacao de input

  isReadOnly: boolean;       // true = nao modifica filesystem
  isConcurrencySafe: boolean; // true = pode rodar em paralelo

  checkPermissions(input, ctx): PermissionDecision;
  // -> { behavior: "allow" }         -> executa direto
  // -> { behavior: "ask", description }  -> pede aprovacao ao usuario
  // -> { behavior: "deny", reason }  -> bloqueia

  validateInput(input, ctx): ValidationResult;
  // -> { valid: true }               -> prossegue
  // -> { valid: false, error }       -> retorna erro ao LLM

  call(input, ctx): Promise<ToolResult>;
  // -> { success: true, output }
  // -> { success: false, output }
}
```

---

## buildTool() — Factory com defaults seguros (fail-closed)

Se voce nao especificar um campo, o default e o mais seguro:

| Campo | Default | Razao |
|-------|---------|-------|
| `isReadOnly` | `false` | Assume que escreve -> pede aprovacao |
| `isConcurrencySafe` | `false` | Assume nao seguro -> executa serial |
| `checkPermissions` | ask em suggest, allow em full-auto | Delega ao approvalMode |
| `validateInput` | Usa inputSchema.safeParse() | Validacao automatica via Zod |

---

## ToolUseContext — O que cada tool recebe

```typescript
interface ToolUseContext {
  projectPath: string;       // Diretorio raiz do projeto
  threadId: string;          // ID da thread atual
  runId: string;             // ID da execucao atual
  approvalMode: ApprovalMode; // "suggest" | "auto-edit" | "full-auto"
  signal?: AbortSignal;      // Para cancelamento
  onActivity: (activity) => void; // Emitir eventos para a UI
}
```

---

## Fluxo Completo — Do pedido do usuario ao arquivo criado

```
1. Usuario digita: "crie um snake game com html, css e js"

2. tool-executor.ts:
   a. Le key files do projeto (package.json, etc.)
   b. Gera file tree do diretorio
   c. Monta system prompt com:
      - Identidade do assistente
      - Contexto do projeto (file tree + key files)
      - Regras de comportamento (ler antes de editar, nomes descritivos, etc.)
      - Formato <tool_call> (minimo necessario)
      - Referencia das tools disponiveis
   d. Chama provider.sendMessageStream()

3. LLM responde (streaming):
   "Vou criar o snake game com 3 arquivos..."
   <tool_call>
   {"name": "write_file", "args": {"path": "snake-game.html", "content": "..."}}
   </tool_call>

4. tool-parser.ts:
   - Detecta <tool_call> no stream
   - Parseia o JSON
   - Retorna ParsedToolCall { name: "write_file", args: {...} }

5. tool-orchestration.ts:
   - Recebe [write_file call]
   - write_file.isConcurrencySafe = false -> executa serial

6. tool-execution.ts:
   a. findToolByName("write_file") -> WriteFileTool
   b. inputSchema.safeParse({path, content}) -> valido
   c. validateInput() -> valido
   d. checkPermissions() -> approvalMode e "suggest" -> { behavior: "ask" }
   e. onApprovalNeeded() -> UI mostra card de aprovacao -> usuario aprova
   f. tool.call() -> writeFile("snake-game.html", content)
   g. Retorna { success: true, output: "File created: snake-game.html" }

7. tool-executor.ts:
   - Monta <tool_result> com resultado
   - Reenvia ao LLM como mensagem do usuario
   - LLM continua com proximo tool_call (snake-game.css, snake-game.js)
   - Loop repete ate LLM parar de chamar tools

8. Resultado final:
   - 3 arquivos criados no disco
   - LLM responde: "Criei o snake game com 3 arquivos: ..."
```

---

## Orquestracao — Concorrencia vs Serial

```
Exemplo: LLM pede 3 operacoes numa resposta:
- read_file("index.html")     -> isReadOnly=true,  isConcurrencySafe=true
- read_file("style.css")      -> isReadOnly=true,  isConcurrencySafe=true
- write_file("app.js", "...") -> isReadOnly=false, isConcurrencySafe=false

Particionamento:
  concurrent: [read_file("index.html"), read_file("style.css")]
  serial:     [write_file("app.js", "...")]

Execucao:
  1. Promise.all([read index.html, read style.css]) -> paralelo
  2. write_file("app.js") -> serial, apos reads concluirem
```

---

## Permissoes por Tool e ApprovalMode

| Tool | suggest | auto-edit | full-auto |
|------|---------|-----------|-----------|
| read_file | Auto | Auto | Auto |
| list_files | Auto | Auto | Auto |
| grep | Auto | Auto | Auto |
| glob | Auto | Auto | Auto |
| write_file | Aprovacao | Auto | Auto |
| edit_file | Aprovacao | Auto | Auto |
| rename_file | Aprovacao | Auto | Auto |
| create_directory | Aprovacao | Auto | Auto |
| delete_file | Aprovacao | Aprovacao | Auto |
| bash | Aprovacao | Aprovacao | Auto |

---

## Validacao de Input com Zod

Cada tool define um schema Zod que valida automaticamente:

```typescript
// Exemplo: write_file
inputSchema: z.object({
  path: z.string().min(1),    // obrigatorio, nao vazio
  content: z.string(),         // obrigatorio
})

// Se o modelo mandar: {"name": "write_file", "args": {}}
// Zod retorna: "Required at path" -> erro enviado de volta ao LLM
// O modelo corrige e tenta novamente
```

---

## Seguranca — Path Sandboxing

Toda tool que opera em arquivos usa `resolveSafe()`:
```typescript
function resolveSafe(projectPath: string, relativePath: string): string {
  const resolved = path.resolve(projectPath, relativePath);
  if (!resolved.startsWith(projectPath)) {
    throw new Error("Path traversal blocked: " + relativePath);
  }
  return resolved;
}
```

Isso impede o modelo de acessar caminhos fora do projeto.

---

## System Prompt — Estrutura

O prompt e composto por 5 secoes:

1. **Identidade** (~50 palavras) — Quem e o assistente
2. **Ambiente** (variavel) — Project root, file tree, conteudo de key files
3. **Comportamento** (~200 palavras) — Regras de qualidade:
   - "Leia antes de editar"
   - "Nomes descritivos para arquivos"
   - "Codigo completo, sem placeholders"
   - "Siga o estilo existente do projeto"
4. **Formato tool_call** (~80 palavras) — Minimo necessario para o XML
5. **Referencia de tools** (auto-gerada) — Descricoes de cada tool

O prompt e adaptado por modelo via `prompt-variants.ts` (budget de tokens, exemplos, etc.).

---

## Como Adicionar uma Nova Tool

1. Criar arquivo em `definitions/nova-tool.ts`:

```typescript
import { z } from "zod";
import { buildTool } from "../tool.js";

export const NovaToolDef = buildTool({
  name: "nova_tool",
  description: "O que essa tool faz",
  inputSchema: z.object({
    param1: z.string(),
    param2: z.number().optional(),
  }),
  isReadOnly: true,  // ou false
  isConcurrencySafe: true,  // ou false
  call: async (input, ctx) => {
    // Implementacao
    return { success: true, output: "resultado" };
  },
});
```

2. Registrar em `definitions/index.ts`:

```typescript
import { NovaToolDef } from "./nova-tool.js";
export const TOOL_REGISTRY: ToolDef[] = [
  // ... tools existentes
  NovaToolDef,
];
```

A tool automaticamente:
- Aparece no system prompt
- E validada com Zod
- Tem permissoes baseadas no approvalMode
- E logada no banco
- Participa da orquestracao concurrent/serial

---

## Estrutura de Arquivos

```
electron/main/services/tools/
  tool.ts                    # Interface ToolDef, ToolUseContext, buildTool()
  tool-execution.ts          # runToolUse() — execucao individual
  tool-orchestration.ts      # runTools() — particionamento concurrent/serial
  tool-executor.ts           # Loop principal LLM <-> tools
  tool-definitions.ts        # buildSystemPrompt() focado em qualidade
  tool-parser.ts             # Parser de <tool_call> XML tags
  tool-logger.ts             # Logging para DB
  prompt-variants.ts         # Variantes de prompt por modelo
  definitions/               # Uma tool por arquivo
    index.ts                 # Registry + findToolByName()
    read-file.ts
    write-file.ts
    edit-file.ts
    delete-file.ts
    glob.ts
    grep.ts
    list-files.ts
    rename-file.ts
    create-directory.ts
    bash.ts
```
