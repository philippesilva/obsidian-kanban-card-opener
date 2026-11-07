/*
 * Kanban Card Opener
 * ---------------------------------------------------------------------------
 * Intercepta o clique (e a tecla Enter) em registros de qualquer view do Bases
 * (tabela, cards, lista e kanban) e abre a nota correspondente em uma janela
 * pop-out ou em um split, em vez de substituir a view na aba.
 *
 * Como funciona:
 *  - Um listener de "click"/"keydown" na fase de captura, registrado no
 *    document de cada janela (principal e pop-outs), roda antes dos handlers
 *    nativos do registro.
 *  - O arquivo é resolvido pelo objeto interno da view (linha/card ->
 *    entry.file), com fallback para o link do nome renderizado no registro.
 *  - Só interceptamos quando o clique abriria a própria nota; em caso de dúvida
 *    o comportamento nativo do Obsidian é preservado.
 */
"use strict";

const { Plugin, PluginSettingTab, Setting, TFile, Notice, Platform } = require("obsidian");

/** Linhas e cards de qualquer view do Bases. */
const RECORD_SELECTOR = ".bases-tr, .bases-cards-item, .bases-list-item, .bases-kanban-card";
/** Views em que o clique na linha abre a nota (tabela e lista abrem só pelo nome). */
const ROW_CLICK_SELECTOR = ".bases-cards-item, .bases-kanban-card";
/** Elementos interativos que mantêm o comportamento nativo. */
const WIDGET_SELECTOR =
	'button, input, select, textarea, [contenteditable="true"], [role="button"], ' +
	'[role="checkbox"], [role="menuitem"], [role="option"], .checkbox-container, .clickable-icon';

const DEFAULT_SETTINGS = {
	// "window" | "split-right" | "split-down" | "tab" | "native"
	openMode: "window",
	// Reutiliza uma única janela pop-out para todas as notas.
	reuseWindow: true,
};

class KanbanCardOpener extends Plugin {
	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		/** Janela pop-out reutilizada (modo "window"). */
		this.openLeaf = null;
		this.watchedDocs = new Set();

		this.addSettingTab(new KanbanCardOpenerSettingTab(this.app, this));

		// document principal (janela principal do Obsidian)
		this.watchDocument(document);

		// documentos das janelas pop-out abertas depois do carregamento
		this.registerEvent(
			this.app.workspace.on("window-open", (_win, win) => {
				if (win && win.document) this.watchDocument(win.document);
			})
		);

		// documentos de janelas pop-out já existentes no layout restaurado
		this.app.workspace.onLayoutReady(() => {
			this.app.workspace.iterateAllLeaves((leaf) => {
				const el = leaf.view && leaf.view.containerEl;
				const doc = el && el.ownerDocument;
				if (doc) this.watchDocument(doc);
			});
		});
	}

	onunload() {
		this.watchedDocs.clear();
		this.openLeaf = null;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/* ---------------------------------------------------------------------- */
	/* Listeners (fase de captura, antes dos handlers nativos)                 */
	/* ---------------------------------------------------------------------- */

	watchDocument(doc) {
		if (!doc || this.watchedDocs.has(doc)) return;
		this.watchedDocs.add(doc);
		this.registerDomEvent(doc, "click", (evt) => this.onActivation(evt), true);
		this.registerDomEvent(doc, "keydown", (evt) => this.onActivation(evt), true);
	}

	onActivation(evt) {
		try {
			if (this.settings.openMode === "native") return;
			if (evt.defaultPrevented) return;

			const isClick = evt.type === "click";
			if (isClick) {
				if (evt.button !== 0) return;
			} else if (evt.key !== "Enter" || evt.repeat) {
				return;
			}

			const target = evt.target;
			if (!target || typeof target.closest !== "function") return;

			const record = target.closest(RECORD_SELECTOR);
			if (!record) return;

			// Botões, inputs e checkboxes continuam nativos.
			if (target.closest(WIDGET_SELECTOR)) return;

			// Em tabela e lista o clique fora do nome não abre a nota (só seleciona
			// a célula), então nesses casos mantemos o comportamento nativo.
			const link = target.closest("[data-href], a[href]");
			if (!link && !record.matches(ROW_CLICK_SELECTOR)) return;

			const leaf = this.findLeaf(record);
			const file = this.resolveFile(record, leaf);
			if (!file) return;

			// Link para outra nota, âncora ou URL externa: comportamento nativo.
			if (link) {
				const dest = this.linkFile(link, file.path);
				if (!dest || dest.path !== file.path) return;
			}

			// Segundo clique de um duplo clique: só bloqueia o comportamento nativo
			// (evita abrir dois splits / duas janelas para o mesmo clique).
			if (isClick && evt.detail > 1) {
				evt.preventDefault();
				evt.stopPropagation();
				return;
			}

			evt.preventDefault();
			evt.stopPropagation();
			void this.openFile(file, leaf);
		} catch (err) {
			console.error("Kanban Card Opener: falha ao processar o clique.", err);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Arquivo do registro                                                     */
	/* ---------------------------------------------------------------------- */

	/** Leaf que contém o elemento. */
	findLeaf(el) {
		let found = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			const container = leaf.view && leaf.view.containerEl;
			if (!found && container && container.contains(el)) found = leaf;
		});
		return found;
	}

	/** Arquivo do registro: objeto interno da view, ou o link do nome nele. */
	resolveFile(record, leaf) {
		const view = leaf && leaf.view;
		const inner = (view && view.controller && view.controller.view) || view;

		if (inner) {
			const lists = [inner.items, inner.rows];
			for (const group of (inner.groups || []).concat(inner.columns || [])) {
				lists.push(group && group.items, group && group.rows);
			}
			for (const list of lists) {
				if (!Array.isArray(list)) continue;
				const row = list.find((item) => item && item.el === record);
				const file = row && row.entry && row.entry.file;
				if (file instanceof TFile) return file;
			}
		}

		// Fallback: link do nome/título renderizado dentro do registro.
		const link =
			record.querySelector(".mod-title [data-href]") || record.querySelector("[data-href]");
		return link ? this.linkFile(link) : null;
	}

	/** Arquivo apontado por um link interno (null para âncoras e URLs externas). */
	linkFile(link, sourcePath) {
		const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
		if (!href || href[0] === "#" || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
		try {
			return this.app.metadataCache.getFirstLinkpathDest(href, sourcePath || "");
		} catch (_) {
			return null;
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Abertura                                                                */
	/* ---------------------------------------------------------------------- */

	async openFile(file, sourceLeaf) {
		const mode = this.settings.openMode;
		try {
			if (mode === "window" && Platform.isDesktop) {
				await this.openInWindow(file);
				return;
			}
			if (mode === "tab") {
				const leaf = this.app.workspace.getLeaf("tab");
				await leaf.openFile(file);
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
				return;
			}
			// "window" fora do desktop cai para split
			const direction = mode === "split-down" ? "horizontal" : "vertical";
			await this.openInSplit(file, sourceLeaf, direction);
		} catch (err) {
			console.error("Kanban Card Opener: não foi possível abrir no modo escolhido.", err);
			new Notice("Kanban Card Opener: abrindo no local padrão.");
			try {
				await this.app.workspace.openLinkText(file.path, "", false);
			} catch (_) {
				/* ignora */
			}
		}
	}

	async openInWindow(file) {
		const ws = this.app.workspace;
		let leaf = this.settings.reuseWindow ? this.openLeaf : null;
		if (leaf && !this.isLeafUsable(leaf)) leaf = null;
		if (!leaf) leaf = ws.getLeaf("window");
		this.openLeaf = leaf;
		await leaf.openFile(file);
		try {
			ws.revealLeaf(leaf);
		} catch (_) {
			try {
				ws.setActiveLeaf(leaf, { focus: true });
			} catch (_) {
				/* ignora */
			}
		}
	}

	async openInSplit(file, sourceLeaf, direction) {
		const ws = this.app.workspace;
		let leaf = null;
		if (sourceLeaf && typeof ws.createLeafBySplit === "function") {
			try {
				leaf = ws.createLeafBySplit(sourceLeaf, direction);
			} catch (_) {
				leaf = null;
			}
		}
		if (!leaf) {
			if (sourceLeaf) {
				try {
					ws.setActiveLeaf(sourceLeaf, { focus: false });
				} catch (_) {
					/* ignora */
				}
			}
			leaf = ws.getLeaf("split", direction);
		}
		await leaf.openFile(file);
		try {
			ws.setActiveLeaf(leaf, { focus: true });
		} catch (_) {
			/* ignora */
		}
	}

	isLeafUsable(leaf) {
		try {
			const el = leaf && leaf.view && leaf.view.containerEl;
			if (!el || !el.isConnected) return false;
			const win = el.ownerDocument && el.ownerDocument.defaultView;
			if (win && win.closed) return false;
			return true;
		} catch (_) {
			return false;
		}
	}
}

/* -------------------------------------------------------------------------- */
/* Configurações                                                             */
/* -------------------------------------------------------------------------- */

class KanbanCardOpenerSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Modo de abertura")
			.setDesc(
				"Onde a nota abre ao clicar num registro (linha ou card) de qualquer view " +
				"do Bases. 'Comportamento padrão do Obsidian' desativa a interceptação."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("window", "Nova janela")
					.addOption("split-right", "Split à direita")
					.addOption("split-down", "Split abaixo")
					.addOption("tab", "Nova aba")
					.addOption("native", "Comportamento padrão do Obsidian")
					.setValue(this.plugin.settings.openMode)
					.onChange(async (value) => {
						this.plugin.settings.openMode = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.openMode === "window") {
			new Setting(containerEl)
				.setName("Reutilizar a mesma janela")
				.setDesc(
					"Todas as notas abrem na mesma janela pop-out (o conteúdo é substituído). " +
					"Desative para abrir uma nova janela a cada clique."
				)
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.reuseWindow).onChange(async (value) => {
						this.plugin.settings.reuseWindow = value;
						if (!value) this.plugin.openLeaf = null;
						await this.plugin.saveSettings();
					})
				);
		}
	}
}

module.exports = KanbanCardOpener;
