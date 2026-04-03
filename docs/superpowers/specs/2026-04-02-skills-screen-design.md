# Skills Screen — Design Spec

**Data:** 2026-04-02  
**Status:** Aprovado

---

## Contexto

O Duck Codex já possui um botão "Skills" na sidebar, mas está desabilitado. O objetivo é ativar essa tela para que o usuário consiga visualizar todas as skills disponíveis na máquina, lendo diretamente de `~/.claude/plugins/`. Isso dá visibilidade ao conjunto de capacidades instaladas no Claude Code CLI.

---

## Abordagem

View switching simples com leitura direta do filesystem via comando Tauri. Sem cache — skills são arquivos estáticos que raramente mudam. A leitura ocorre a cada vez que o usuário abre a tela.

---

## Estrutura de Dados

```typescript
interface Skill {
  name: string        // do frontmatter (campo `name`) ou nome do arquivo sem .md
  description: string // do frontmatter (campo `description`), string vazia se ausente
  file: string        // nome do arquivo .md
}

interface PluginSkills {
  plugin: string      // nome do subdiretório em ~/.claude/plugins/
  skills: Skill[]
}
```

Retornado pelo comando Tauri como `Vec<PluginSkills>`.

---

## Backend — Comando Tauri `list_skills`

**Arquivo:** `src-tauri/src/commands/mod.rs` (novo comando adicionado ao módulo existente)

**Lógica:**
1. Resolve `~/.claude/plugins/` via `dirs::home_dir()`
2. Lista subdiretórios — cada um é um plugin
3. Para cada plugin, entra em `<plugin>/skills/` e lista arquivos `.md`
4. Lê cada arquivo e extrai `name` e `description` do frontmatter YAML (bloco entre `---`)
5. Se frontmatter não existir ou campo ausente, usa o nome do arquivo (sem `.md`) como `name` e `""` como `description`
6. Retorna `Vec<PluginSkills>` ordenado alfabeticamente por plugin

**Tratamento de erros:**
- Diretório `~/.claude/plugins/` não existe → retorna `Vec` vazio (sem erro)
- Plugin sem subdiretório `skills/` → plugin ignorado silenciosamente
- Arquivo `.md` ilegível → skill ignorada silenciosamente

**Dependência Rust:** `dirs` (já comum em projetos Tauri) para resolver home dir.

---

## Frontend

### 1. `src/stores/app-store.ts`

Adicionar ao estado existente:
```typescript
activeView: 'chat' | 'skills'  // default: 'chat'
setActiveView: (view: 'chat' | 'skills') => void
```

### 2. `src/App.tsx`

Substituir renderização condicional:
```tsx
{activeView === 'skills' ? <SkillsScreen /> : <ChatArea />}
```

### 3. `src/components/sidebar/sidebar.tsx`

- Remover `disabled` do botão Skills
- Ao clicar: `setActiveView('skills')`
- Ao clicar em qualquer projeto/thread: `setActiveView('chat')` (já acontece implicitamente via `setActiveThread`)

### 4. `src/components/skills/skills-screen.tsx` (novo)

**Comportamento:**
- Ao montar: chama `invoke('list_skills')` com loading state
- Exibe seções colapsáveis por plugin, todas expandidas por padrão
- Cada skill exibe: nome (destaque), descrição (texto secundário)
- Header da seção mostra: nome do plugin + contagem `(N)`

**Estados:**
- `loading` → spinner centralizado
- `empty` (lista vazia) → mensagem: *"Nenhum plugin instalado. Instale skills via Claude Code CLI."*
- `error` → mensagem de erro genérica
- `loaded` → grid/lista de cards agrupados

**Estrutura visual:**
```
Skills
━━━━━━━━━━━━━━━━━━━━━

▼ superpowers  (12)
  ┌──────────────────────────────┐
  │ brainstorming                │
  │ Explores user intent and...  │
  └──────────────────────────────┘

▶ commit-commands  (3)
```

---

## Arquivos a Criar/Modificar

| Ação     | Arquivo |
|----------|---------|
| Modificar | `src-tauri/src/commands/mod.rs` |
| Modificar | `src-tauri/src/lib.rs` (registrar comando) |
| Modificar | `src/stores/app-store.ts` |
| Modificar | `src/App.tsx` |
| Modificar | `src/components/sidebar/sidebar.tsx` |
| Criar     | `src/components/skills/skills-screen.tsx` |

---

## Verificação

1. Buildar o app: `npm run tauri dev`
2. Clicar em "Skills" na sidebar → tela de skills aparece no painel principal
3. Skills aparecem agrupadas por plugin com nome e descrição
4. Clicar em um projeto/thread → volta para o chat normalmente
5. Testar com `~/.claude/plugins/` inexistente → mensagem de estado vazio aparece
