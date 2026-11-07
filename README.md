# Kanban Card Opener

Plugin do Obsidian que muda o clique em **registros de qualquer view do Bases** (`.base`): tabela, cards, lista e kanban.

- **Antes:** o clique abria a nota no lugar da view (substituía a aba).
- **Agora:** a nota abre em **nova janela pop-out** (padrão) ou em **split**, e a view continua na tela.

Requer **Obsidian 1.14+** (versão que trouxe o Bases).

## Como funciona

1. Um listener de `click`/`keydown` na fase de **captura** é registrado no `document` da janela principal e de cada janela pop-out — ele roda antes dos handlers nativos.
2. O plugin encontra o **registro** clicado (`.bases-tr`, `.bases-cards-item`, `.bases-list-item`, `.bases-kanban-card`) e resolve o **arquivo** por dois caminhos, nesta ordem:
   - objeto interno da view (`leaf.view.controller.view` → `items`/`rows`/`groups[].rows`/`columns[].items` → `entry.file`);
   - fallback: o link do nome/título renderizado dentro do registro (`[data-href]`).
3. Só então o evento é bloqueado (`preventDefault` + `stopPropagation`) e a nota abre no modo escolhido.

Se o arquivo não puder ser resolvido, **nada é interceptado** e o comportamento padrão é mantido.

Também continuam nativos:

- cliques em links para outras notas, âncoras e URLs externas;
- botões, inputs, checkboxes e demais elementos interativos dentro do registro;
- em **tabela** e **lista**, o clique fora do nome da nota (ele apenas seleciona/edita a célula) — nesses tipos só o clique no nome é redirecionado;
- em **cards** e **kanban**, qualquer clique na linha abre a nota (como já fazia o Obsidian).

## Instalação

Copie `manifest.json` e `main.js` para a pasta do plugin no seu vault:

```
<vault>/.obsidian/plugins/kanban-card-opener/
```

Depois, em **Configurações → Comunidade → Plugins instalados**, ative o **Kanban Card Opener**.

> Se o Modo restrito estiver ativo, desative-o primeiro para permitir plugins da comunidade.

## Configurações

**Modo de abertura**

| Opção | Comportamento |
| --- | --- |
| Nova janela (padrão) | Abre a nota numa janela pop-out do Obsidian |
| Split à direita | Abre a nota num painel à direita da view |
| Split abaixo | Abre a nota num painel abaixo da view |
| Nova aba | Abre a nota numa nova aba do mesmo painel |
| Comportamento padrão do Obsidian | Desativa a interceptação |

**Reutilizar a mesma janela** (somente no modo "Nova janela")

- Ativado (padrão): todas as notas abrem na mesma janela pop-out, substituindo o conteúdo — evita acúmulo de janelas.
- Desativado: cada clique abre uma nova janela.

## Limitações

- Em uma base **embutida numa nota** (embed), a resolução usa o link do nome; se o título do card não for a propriedade de arquivo, vale o comportamento nativo.
- No modo **Nova janela**, janelas pop-out são um recurso do Obsidian **desktop**; em mobile o plugin abre em split.
- Duplo clique é tratado como um único clique (o segundo evento é bloqueado para não abrir dois splits/janelas).
