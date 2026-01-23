document.addEventListener('DOMContentLoaded', () => {

	/* =========================
	   DOM
	========================= */

	const expansionTabsContainer = document.getElementById('expansion-tabs');
	const factionTabsContainer = document.getElementById('faction-tabs');
	const cardTypeTabs = document.getElementById('cards-tabs');
	const cardsContainer = document.getElementById('cards-container');

	/* =========================
	   STATE
	========================= */

	const state = {
		expansionKey: null,
		factionKey: null,
		cardType: null
	};

	/* =========================
	   CONSTANTS
	========================= */

	const maxWidth = 450;
	const maxHeight = 650;

	const textBackgroundSize = 759;
	const textBottomBarHeight = 18;
	const textBottomBarWidth = 454;

	const titleFontSize = maxHeight * 0.05;
	const marginWidth = maxWidth * 0.0578;
	const maxTextWidth = maxWidth - 2 * marginWidth;

	const iconSize = maxWidth * 0.097;
	const iconSpacing = maxWidth * 0.011;
	const iconX = maxWidth * 0.0632;
	const startY = maxHeight * 0.242;

	const iconMap = {
		B: 'pictures/bolter.png',
		S: 'pictures/shield.png',
		M: 'pictures/moral.png'
	};

	const CARD_TYPE_LABELS_RU = {
		combat: 'Боевые',
		orders: 'Приказы',
		events: 'События',
		faction_card: 'Фракция',
		backs: 'Задники'
	};

	const CARD_TYPE_CONFIG = {
		combat: { render: createCombatContent, textKey: 'combatText' },
		orders: { render: createOrdersContent, textKey: 'ordersText' },
		events: { render: createEventContent, textKey: 'eventsText' },
		faction_card: { render: createFactioncardContent },
		backs: { render: backCardContent }
	};

	/* =========================
	   INIT
	========================= */

	fetch('factions/file_names.json')
		.then(r => r.json())
		.then(initUI)
		.catch(console.error);

	function initUI(data) {
		const { expansion, faction, cards } = data;

		/* ---------- EXPANSIONS ---------- */

		expansionTabsContainer.innerHTML = '';
		expansion.folder.forEach((key, i) => {
			const el = document.createElement('div');
			el.className = `expansion-header${i === 0 ? ' active' : ''}`;
			el.textContent = expansion.name[i];
			el.dataset.expansion = key;
			expansionTabsContainer.appendChild(el);
		});

		state.expansionKey = expansion.folder[0];
		loadFactions(faction, cards);

		expansionTabsContainer.addEventListener('click', e => {
			const tab = e.target.closest('.expansion-header');
			if (!tab) return;

			document.querySelectorAll('.expansion-header')
				.forEach(h => h.classList.remove('active'));
			tab.classList.add('active');

			state.expansionKey = tab.dataset.expansion;
			loadFactions(faction, cards);
		});
	}

	/* =========================
	   FACTIONS
	========================= */

	function loadFactions(factionData, cards) {
		factionTabsContainer.innerHTML = '';

		const set = factionData[state.expansionKey];
		set.folder.forEach((key, i) => {
			const el = document.createElement('div');
			el.className = `faction-header${i === 0 ? ' active' : ''}`;
			el.textContent = set.name[i];
			el.dataset.faction = key;
			factionTabsContainer.appendChild(el);
		});

		state.factionKey = set.folder[0];
		renderCardTypeTabs(Object.keys(cards));
		loadCards(cards);

		factionTabsContainer.onclick = e => {
			const tab = e.target.closest('.faction-header');
			if (!tab) return;

			document.querySelectorAll('.faction-header')
				.forEach(h => h.classList.remove('active'));
			tab.classList.add('active');

			state.factionKey = tab.dataset.faction;
			renderCardTypeTabs(Object.keys(cards));
			loadCards(cards);
		};
	}

	/* =========================
	   CARD TYPE TABS (RU)
	========================= */

	function renderCardTypeTabs(cardTypes) {
		cardTypeTabs.innerHTML = '';

		cardTypes.forEach((type, i) => {
			const tab = document.createElement('div');
			tab.className = `card-header${i === 0 ? ' active' : ''}`;
			tab.textContent = CARD_TYPE_LABELS_RU[type] ?? type;
			tab.dataset.cardType = type;
			cardTypeTabs.appendChild(tab);
		});

		state.cardType = cardTypes[0];
	}

	cardTypeTabs.addEventListener('click', e => {
		const tab = e.target.closest('.card-header');
		if (!tab) return;

		document.querySelectorAll('.card-header')
			.forEach(h => h.classList.remove('active'));
		tab.classList.add('active');

		state.cardType = tab.dataset.cardType;
		loadCards(window.__cards);
	});

	/* =========================
	   LOAD CARDS
	========================= */

	function loadCards(cards) {
		window.__cards = cards;
		cardsContainer.innerHTML = '';

		const wrap = document.createElement('div');
		cardsContainer.appendChild(wrap);

		fetch(`factions/${state.expansionKey}/${state.factionKey}/text.json`)
			.then(r => r.json())
			.then(textData => {
				const cfg = CARD_TYPE_CONFIG[state.cardType];
				if (!cfg) return;

				const files = cards[state.cardType];
				const text = cfg.textKey ? textData[cfg.textKey] : null;

				cfg.render(wrap, state.expansionKey, state.factionKey, files, text);
			});
	}

	/* =====================================================
	   KEEP UNTOUCHED — SEMANTIC → GLYPH REPLACEMENT
	===================================================== */

	function replaceForbiddenStarsElements(str) {
		str = str.replace(/\[B\]/g, "}");
		str = str.replace(/\[S\]/g, "{");
		str = str.replace(/\[M\]/g, "<");
		str = str.replace(/\[D\]/g, "|");
		str = str.replace(/\(B\)/g, "#");
		str = str.replace(/\(S\)/g, "@");
		return str;
	}

	/* =========================
	   TOKEN BUILDER (READY)
	========================= */

	//   CREATING CONTENT FOR CANVAS
	function createCombatContent(container, expansionFolder, factionfolder, files, textData) {
		const sections = {
			's-section': files.slice(0, 5),
			't1-section': files.slice(5, 9),
			't2-section': files.slice(9, 12),
			't3-section': files.slice(12, 14)
		};

		console.log(textData);
		const combatText = {
			's-section': textData.slice(0, 5),
			't1-section': textData.slice(5, 9),
			't2-section': textData.slice(9, 12),
			't3-section': textData.slice(12, 14)
		};
		console.log(combatText);

		Object.keys(sections).forEach(section => {
			const sectionContainer = document.createElement('div');
			sectionContainer.classList.add('grid', 'combat', section);
			sections[section].forEach((file, idx) => {
				// Create placeholder with spinner
				const placeholder = document.createElement('div');
				placeholder.classList.add('card-placeholder');
				const spinner = document.createElement('div');
				spinner.classList.add('card-spinner');
				placeholder.appendChild(spinner);
				sectionContainer.appendChild(placeholder);

				// Prepare card data
				const jsonData = {};
				jsonData["picture"] = `factions/${expansionFolder}/${factionfolder}/combat/${file}`;
				jsonData["title"] = combatText[section][idx].title || "";
				jsonData["background"] = combatText[section][idx].general || "";
				jsonData["foreground"] = combatText[section][idx].unit || "";
				jsonData["icons"] = combatText[section][idx].icons || "";

				// Create canvas for this card
				const canvas = document.createElement('canvas');
				canvas.width = maxWidth;
				canvas.height = maxHeight;
				const context = canvas.getContext('2d');

				// Draw the card asynchronously and replace placeholder when done
				drawCombatCard(jsonData, context).then(() => {
					placeholder.replaceWith(canvas);
				}).catch(err => {
					console.error('Error drawing combat card:', err);
					placeholder.innerHTML = '<span style="color:red;">Error loading card</span>';
				});
			});

			container.appendChild(sectionContainer);
		});
	}

	function createOrdersContent(container, expansionFolder, factionfolder, files, textData) {
		const categoryContainer = document.createElement('div');
		categoryContainer.classList.add('grid', 'orders');

		files.forEach((file, idx) => {
			// Create placeholder with spinner
			const placeholder = document.createElement('div');
			placeholder.classList.add('card-placeholder');
			const spinner = document.createElement('div');
			spinner.classList.add('card-spinner');
			placeholder.appendChild(spinner);
			categoryContainer.appendChild(placeholder);

			const jsonData = {};
			jsonData["picture"] = `factions/${expansionFolder}/${factionfolder}/orders/${file}`;
			jsonData["title"] = `${textData[idx].title}`;
			jsonData["general"] = `${textData[idx].general}`;

			const canvas = document.createElement('canvas');
			canvas.width = maxWidth;
			canvas.height = maxHeight;
			const context = canvas.getContext('2d');

			// Draw card and replace placeholder when done
			drawOrderCard(jsonData, context).then(() => {
				placeholder.replaceWith(canvas);
			}).catch(err => {
				console.error('Error drawing order card:', err);
				placeholder.innerHTML = '<span style="color:red;">Error loading card</span>';
			});
		});

		container.appendChild(categoryContainer);
	}

	function createEventContent(container, expansionFolder, factionfolder, files, textData) {
		const categoryContainer = document.createElement('div');
		categoryContainer.classList.add('grid', 'events');

		files.forEach((file, idx) => {
			// Create placeholder with spinner
			const placeholder = document.createElement('div');
			placeholder.classList.add('card-placeholder');
			const spinner = document.createElement('div');
			spinner.classList.add('card-spinner');
			placeholder.appendChild(spinner);
			categoryContainer.appendChild(placeholder);

			const jsonData = {};
			jsonData["picture"] = `factions/${expansionFolder}/${factionfolder}/events/${file}`;
			jsonData["title"] = `${textData[idx].title}`;
			jsonData["general"] = `${textData[idx].general}`;
			jsonData["type"] = `${textData[idx].type}`;

			const canvas = document.createElement('canvas');
			canvas.width = maxWidth;
			canvas.height = maxHeight;
			const context = canvas.getContext('2d');

			// Draw card and replace placeholder when done
			drawEventCard(jsonData, context).then(() => {
				placeholder.replaceWith(canvas);
			}).catch(err => {
				console.error('Error drawing event card:', err);
				placeholder.innerHTML = '<span style="color:red;">Error loading card</span>';
			});
		});

		container.appendChild(categoryContainer);
	}

	function createFactioncardContent(container, expansionFolder, factionfolder, files) {
		const categoryContainer = document.createElement('div');
		categoryContainer.classList.add('factionCard');

		files.forEach((file, _) => {
			// Create placeholder with spinner
			const placeholder = document.createElement('div');
			placeholder.classList.add('card-placeholder');
			const spinner = document.createElement('div');
			spinner.classList.add('card-spinner');
			placeholder.appendChild(spinner);
			categoryContainer.appendChild(placeholder);

			const img = document.createElement('img');
			img.src = `factions/${expansionFolder}/${factionfolder}/faction_card/${file}`;

			img.onload = () => {
				placeholder.replaceWith(img);
			};
			img.onerror = () => {
				placeholder.innerHTML = '<span style="color:red;">Error loading image</span>';
			};
		});

		container.appendChild(categoryContainer);
	}

	function backCardContent(container, expansionFolder, factionfolder, files) {
		const categoryContainer = document.createElement('div');
		categoryContainer.classList.add('grid', 'cardBack');

		files.forEach((file, _) => {
			// Create placeholder with spinner
			const placeholder = document.createElement('div');
			placeholder.classList.add('card-placeholder');
			const spinner = document.createElement('div');
			spinner.classList.add('card-spinner');
			placeholder.appendChild(spinner);
			categoryContainer.appendChild(placeholder);

			const img = document.createElement('img');
			img.src = `factions/${expansionFolder}/${factionfolder}/backs/${file}`;
			img.width = maxWidth;
			img.height = maxHeight;

			img.onload = () => {
				placeholder.replaceWith(img);
			};
			img.onerror = () => {
				placeholder.innerHTML = '<span style="color:red;">Error loading image</span>';
			};
		});

		container.appendChild(categoryContainer);
	}


	// CANVAS TOOLS
	function replaceForbiddenStarsElements(str) {
		str = str.replace(/\[B\]/g, "}");
		str = str.replace(/\[S\]/g, "{");
		str = str.replace(/\[M\]/g, "<");
		str = str.replace(/\[D\]/g, "|");
		str = str.replace(/\(B\)/g, "#");
		str = str.replace(/\(S\)/g, "@");
		return str
	}

	function calculateTextHeight(context, text, extraHeight, marginHeight, interline, fontSize) {
		context.font = `${fontSize}px ForbiddenStars`;
		const words = text.split(' ');
		let line = '';
		let lineHeight = parseInt(context.font.match(/\d+/), 10);
		let returnHeight = 0;
		for (let n = 0; n < words.length; n++) {
			if (words[n] === "*newline*") {
				returnHeight += lineHeight + interline;
				line = '';
			}
			else if (words[n] === "*newpara*") {
				returnHeight += 2 * lineHeight;
				line = '';
			}
			else {
				const testLine = line + words[n] + ' ';
				const metrics = context.measureText(testLine);
				if (metrics.width > maxTextWidth && n > 0) {
					returnHeight += lineHeight + interline;
					line = words[n] + ' ';
				} else {
					line = testLine;
				}
			}
		}
		returnHeight += lineHeight * 2 + extraHeight + marginHeight * 2;
		return returnHeight;
	};


	function loadImage(url) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('Failed to load image'));
			// img.src = `${url}?cb=${new Date().getTime()}`;
			img.src = url;
		});
	};

	// DRAWING CANVAS SECTION
	async function drawCombatCard(data, ctx) {
		/* =========================
		   LAYOUT CONSTANTS
		========================= */

		const bottomImageHeight = maxHeight * 0.025;
		const maxFieldsHeight = maxHeight * 0.4;

		const extraForegroundTriangle = maxHeight * 0.0455;
		const extraBackgroundBorder = maxHeight * 0.0385;

		let interline = maxHeight * 0.0077;
		let marginHeight = maxWidth * 0.05;
		let fontSize = maxHeight * 0.03;

		/* =========================
		   LOAD IMAGES
		========================= */

		const picture = await loadImage(data.picture);
		const backgroundImg = await loadImage('pictures/background.png');
		const foregroundImg = await loadImage('pictures/foreground.png');
		const bottomImg = await loadImage('pictures/bottom.png');

		/* =========================
		   TEXT PREP
		========================= */

		// ❗ KEEP UNTOUCHED LOGIC
		const backgroundText = replaceForbiddenStarsElements(data.background || '');
		const foregroundText = replaceForbiddenStarsElements(data.foreground || '');

		let backgroundTextHeight = 0;
		let foregroundTextHeight = 0;

		const recalcTextHeights = () => {
			if (backgroundText) {
				backgroundTextHeight = calculateTextHeight(
					ctx,
					backgroundText,
					extraBackgroundBorder,
					marginHeight,
					interline,
					fontSize
				);
			}
			if (foregroundText) {
				foregroundTextHeight = calculateTextHeight(
					ctx,
					foregroundText,
					extraForegroundTriangle,
					marginHeight,
					interline,
					fontSize
				);
			}
		};

		recalcTextHeights();

		const shrinkTextToFit = () => {
			marginHeight *= 0.8;
			fontSize *= 0.99;
			interline *= 0.95;
			recalcTextHeights();
		};

		// Fit both fields into available area
		if (backgroundText && foregroundText) {
			while (backgroundTextHeight + foregroundTextHeight > maxFieldsHeight) {
				shrinkTextToFit();
			}
		} else {
			while (Math.max(backgroundTextHeight, foregroundTextHeight) > maxFieldsHeight) {
				shrinkTextToFit();
			}
		}

		/* =========================
		   DRAW HELPERS
		========================= */

		const drawImageCropped = (img, y) => {
			ctx.drawImage(
				img,
				0,
				0,
				textBackgroundSize,
				maxHeight - y,
				0,
				y,
				maxWidth,
				maxHeight - y
			);
		};

		/* =========================
		   DRAW CARD
		========================= */

		// Base picture
		ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

		// Title
		ctx.font = `${titleFontSize}px HeadlinerNo45`;
		ctx.textAlign = 'left';
		ctx.fillText(data.title || '', maxWidth * 0.27, maxHeight * 0.077);

		/* ---------- BACKGROUND BLOCK ---------- */

		if (backgroundText) {
			const backgroundY = maxHeight - (backgroundTextHeight + foregroundTextHeight);

			drawImageCropped(backgroundImg, backgroundY);

			drawStyledWrappedText(
				ctx,
				backgroundText,
				marginWidth,
				backgroundY + marginHeight + extraBackgroundBorder,
				maxTextWidth,
				interline,
				fontSize,
				'left'
			);
		}

		/* ---------- FOREGROUND BLOCK ---------- */

		if (foregroundText) {
			const foregroundY =
				maxHeight - (foregroundTextHeight + extraForegroundTriangle * 0.35);

			drawImageCropped(foregroundImg, foregroundY);

			drawStyledWrappedText(
				ctx,
				foregroundText,
				marginWidth,
				foregroundY + marginHeight + extraForegroundTriangle,
				maxTextWidth,
				interline,
				fontSize,
				'left'
			);
		}

		/* ---------- ICONS ---------- */

		if (data.icons && data.icons.length) {
			let currentY = startY;

			for (const ch of data.icons) {
				const key = ch.toUpperCase();
				if (!iconMap[key]) continue;

				const iconImg = await loadImage(iconMap[key]);
				ctx.drawImage(iconImg, iconX, currentY, iconSize, iconSize);
				currentY += iconSize + iconSpacing;
			}
		}

		/* ---------- BOTTOM BAR ---------- */

		ctx.drawImage(
			bottomImg,
			0,
			0,
			textBottomBarWidth,
			textBottomBarHeight,
			0,
			maxHeight - bottomImageHeight,
			maxWidth,
			bottomImageHeight
		);
	}


	function drawOrderCard(data, ctx) {
		return new Promise((resolve, reject) => {

			/* =========================
			   LAYOUT CONSTANTS
			========================= */

			const maxFieldsHeight = maxHeight * 0.455;
			const textPosition = maxHeight * 0.54;
			const marginOrderWidth = maxHeight * 0.1;

			let interline = maxHeight * 0.0077;
			let fontSize = maxHeight * 0.03;

			/* =========================
			   IMAGE
			========================= */

			const picture = new Image();
			picture.src = data.picture;

			/* =========================
			   TEXT PREP
			========================= */

			// ❗ KEEP UNTOUCHED LOGIC
			const generalText = replaceForbiddenStarsElements(data.general || '');

			let generalTextHeight = 0;

			const recalcTextHeight = () => {
				generalTextHeight = calculateTextHeight(
					ctx,
					generalText,
					0,
					marginOrderWidth,
					interline,
					fontSize
				);
			};

			const shrinkTextToFit = () => {
				fontSize *= 0.95;
				interline *= 0.97;
				recalcTextHeight();
			};

			recalcTextHeight();
			while (generalTextHeight > maxFieldsHeight) {
				shrinkTextToFit();
			}

			/* =========================
			   DRAW
			========================= */

			picture.onload = () => {
				// Base image
				ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

				// Title
				ctx.font = `${titleFontSize}px HeadlinerNo45`;
				ctx.textAlign = 'center';
				ctx.fillText(data.title || '', maxWidth * 0.5, maxHeight * 0.2325);

				// Text block
				drawStyledWrappedText(
					ctx,
					generalText,
					maxWidth * 0.5,
					textPosition,
					maxWidth - 2 * marginOrderWidth,
					interline,
					fontSize,
					'center'
				);

				resolve();
			};

			picture.onerror = () => {
				reject(new Error('Failed to load order card image'));
			};
		});
	}

	function drawEventCard(data, ctx) {
		return new Promise((resolve, reject) => {

			/* =========================
			   LAYOUT CONSTANTS
			========================= */

			const maxFieldsHeight = maxHeight * 0.278;
			const textPosition = maxHeight * 0.685;

			let interline = maxHeight * 0.0077;
			let fontSize = maxHeight * 0.03;

			/* =========================
			   IMAGE
			========================= */

			const picture = new Image();
			picture.src = data.picture;

			/* =========================
			   TEXT PREP
			========================= */

			const generalText = replaceForbiddenStarsElements(data.general || '');

			let generalTextHeight = 0;

			const recalcTextHeight = () => {
				generalTextHeight = calculateTextHeight(
					ctx,
					generalText,
					20,
					0,
					interline,
					fontSize
				);
			};

			const shrinkTextToFit = () => {
				fontSize *= 0.95;
				interline *= 0.97;
				recalcTextHeight();
			};

			recalcTextHeight();
			while (generalTextHeight > maxFieldsHeight) {
				shrinkTextToFit();
			}

			/* =========================
			   DRAW
			========================= */

			picture.onload = () => {
				// Base image
				ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

				// Event type (centered)
				ctx.font = `bold ${titleFontSize * 0.8}px FrizQuadrataStd`;
				ctx.textAlign = 'center';
				ctx.fillText(data.type || '', maxWidth * 0.5, maxHeight * 0.573);

				// Title (top-left)
				ctx.font = `${titleFontSize}px HeadlinerNo45`;
				ctx.textAlign = 'left';
				ctx.fillText(data.title || '', maxWidth * 0.05, maxHeight * 0.0735);

				// Text block
				drawStyledWrappedText(
					ctx,
					generalText,
					marginWidth,
					textPosition,
					maxWidth - 2 * marginWidth,
					interline,
					fontSize,
					'left'
				);

				resolve();
			};

			picture.onerror = () => {
				reject(new Error('Failed to load event card image'));
			};
		});
	}
	function drawStyledWrappedText(
		ctx,
		text,
		x,
		y,
		maxW,
		interline,
		fontSize,
		align = 'left'
	) {
		// ---- Fonts & metrics
		const baseFont = `${fontSize}px ForbiddenStars`;
		const italicFont = `italic ${fontSize}px ForbiddenStars`;
		const getLH = () => parseInt(ctx.font.match(/\d+/), 10);

		// ---- Normalize control tokens
		const normalize = (s) =>
			String(s)
				.replace(/\s*\*newpara\*\s*/g, '\n\n')
				.replace(/\s*\*newline\*\s*/g, '\n')
				.replace(/[ \t]+/g, ' ')
				.replace(/ *\n */g, '\n')
				.trim();

		const paragraphs = normalize(text).split('\n');

		const buildTokens = (p) => {
			if (p.trim() === '') return [];
			if (p.trim() === '-или-') return [{ text: '-или-', italic: true, glue: true }];

			if (p.includes(':')) {
				const i = p.indexOf(':');
				const before = p.slice(0, i).trimEnd();
				const after = p.slice(i + 1).trimStart();
				const tokens = [];
				if (before) tokens.push({ text: before, italic: true, glue: true });
				tokens.push({ text: ':', italic: false, glue: true });
				if (after) tokens.push({ text: ' ' + after, italic: false, glue: true });
				return tokens;
			}
			return [{ text: p, italic: false, glue: true }];
		};


		// ---- Measurement with style
		const measure = (txt, italic) => {
			ctx.font = italic ? italicFont : baseFont;
			return ctx.measureText(txt).width;
		};

		// ---- Render one composed line
		const renderLine = (segments, yy) => {
			let totalW = 0;
			for (const s of segments) totalW += measure(s.text, s.italic);

			let startX = x;
			if (align === 'center') startX = x - totalW / 2;

			let cx = startX;
			for (const s of segments) {
				ctx.font = s.italic ? italicFont : baseFont;
				ctx.textAlign = 'left';
				ctx.fillText(s.text, cx, yy);
				cx += measure(s.text, s.italic);
			}
		};

		// ---- Layout
		ctx.font = baseFont;
		ctx.textAlign = align;
		const lineHeight = getLH();
		let yy = y + lineHeight;

		for (let p of paragraphs) {
			if (p === '') {
				yy += lineHeight;
				continue;
			}

			const tokens = buildTokens(p);
			let line = [];
			let lineWidth = 0;

			const pushWord = (word, italic, glue) => {
				const segText = (line.length === 0 || glue) ? word : (' ' + word);
				const w = measure(segText, italic);

				if (lineWidth + w > maxW && line.length > 0) {
					renderLine(line, yy);
					yy += lineHeight + interline;
					line = [];
					lineWidth = 0;

					line.push({ text: word, italic });
					lineWidth += measure(word, italic);
				} else {
					line.push({ text: segText, italic });
					lineWidth += w;
				}
			};

			for (const t of tokens) {
				if (t.text === ':') {
					pushWord(':', false, true);
					continue;
				}
				const words = t.text.split(' ');
				for (let i = 0; i < words.length; i++) {
					if (!words[i]) continue;
					const glue = line.length === 0 || (t.glue && i === 0);
					pushWord(words[i], t.italic, glue);
				}
			}

			if (line.length) {
				renderLine(line, yy);
				yy += lineHeight + interline;
			}
		}
	}
});