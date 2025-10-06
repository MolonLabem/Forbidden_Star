// cards-app.js
document.addEventListener('DOMContentLoaded', () => {
    // ===== DOM =====
    const spinner = mustGet('#loading-spinner');
    const expansionTabs = mustGet('#expansion-tabs');
    const factionTabs = mustGet('#faction-tabs');
    const cardTypeTabs = mustGet('#cards-tabs');
    const cardsContainer = mustGet('#cards-container');

    // ===== Sizing (root) =====
    const maxWidth = 450;
    const maxHeight = 650;

    // Combat box assets sizing
    const textBackgroundSize = 759;
    const textBottomBarHeight = 18;
    const textBottomBarWidth = 454;

    const titleFontSize = maxHeight * 0.05;
    const marginWidth = maxWidth * 0.0578;
    const maxTextWidth = maxWidth - 2 * marginWidth;

    // ===== App State =====
    const state = {
        data: null,             // file_names.json content
        expansionKey: null,     // e.g., "core"
        factionKey: null,       // e.g., "space-marines"
        cardTypeKey: null       // e.g., "Combat" | "Orders" | "Events" | "FactionCard" | "Backs"
    };

    // ===== Bootstrap =====
    (async function init() {
        showSpinner();
        try {
            state.data = await fetchJSON('factions/file_names.json');
            renderExpansionTabs(state.data.expansion);

            // Set default selection
            state.expansionKey = state.data.expansion.folder?.[0];
            renderFactionTabs(state.expansionKey);

            const firstFaction = state.data.faction[state.expansionKey].folder?.[0];
            state.factionKey = firstFaction;

            const cardTypes = Object.keys(state.data.cards);
            state.cardTypeKey = cardTypes[0];

            renderCardTypeTabs(cardTypes);
            await renderCards(state.expansionKey, state.factionKey, state.cardTypeKey);
        } catch (err) {
            console.error(err);
            errorBanner(cardsContainer, 'Failed to initialize. Check console for details.');
        } finally {
            hideSpinner();
        }
    })();

    // === PATCH: RU labels while keeping original keys in data-* ===
        const CARD_TYPE_LABELS_RU = {
            combat: 'Боевые',
            orders: 'Приказы',
            events: 'События',
            faction_card: 'Фракция',
            backs: 'Задники'
        };



    // ===== Event Delegation (one-time) =====
    expansionTabs.addEventListener('click', async (e) => {
        const el = e.target.closest('.expansion-header');
        if (!el) return;

        updateActive(expansionTabs, el);
        state.expansionKey = el.dataset.expansion;

        try {
            showSpinner();
            renderFactionTabs(state.expansionKey);

            // Reset faction + cards to defaults for new expansion
            const firstFaction = state.data.faction[state.expansionKey].folder?.[0];
            state.factionKey = firstFaction;

            const cardTypes = Object.keys(state.data.cards);
            state.cardTypeKey = cardTypes[0];
            renderCardTypeTabs(cardTypes);

            await renderCards(state.expansionKey, state.factionKey, state.cardTypeKey);
        } catch (err) {
            console.error(err);
            errorBanner(cardsContainer, 'Failed to load factions/cards for expansion.');
        } finally {
            hideSpinner();
        }
    });

    factionTabs.addEventListener('click', async (e) => {
        const el = e.target.closest('.faction-header');
        if (!el) return;

        updateActive(factionTabs, el);
        state.factionKey = el.dataset.faction;

        try {
            showSpinner();
            // Keep current card type
            await renderCards(state.expansionKey, state.factionKey, state.cardTypeKey);
        } catch (err) {
            console.error(err);
            errorBanner(cardsContainer, 'Failed to load cards for faction.');
        } finally {
            hideSpinner();
        }
    });

    cardTypeTabs.addEventListener('click', async (e) => {
        const el = e.target.closest('.card-header');
        if (!el) return;

        updateActive(cardTypeTabs, el);
        state.cardTypeKey = el.dataset.cardType;

        try {
            showSpinner();
            await renderCards(state.expansionKey, state.factionKey, state.cardTypeKey);
        } catch (err) {
            console.error(err);
            errorBanner(cardsContainer, 'Failed to render selected card type.');
        } finally {
            hideSpinner();
        }
    });

    // ===== Rendering Tabs =====
    function renderExpansionTabs(expansion) {
        if (!expansion?.folder || !expansion?.name) {
            throw new Error('Invalid expansion data');
        }
        expansionTabs.innerHTML = '';
        expansion.folder.forEach((key, i) => {
            const tab = el('div', {
                class: ['expansion-header', i === 0 ? 'active' : ''],
                text: expansion.name[i],
                dataset: { expansion: key }
            });
            expansionTabs.appendChild(tab);
        });
    }

    function renderFactionTabs(expansionKey) {
        const fx = state.data.faction?.[expansionKey];
        if (!fx?.folder || !fx?.name) {
            factionTabs.innerHTML = '';
            return;
        }
        factionTabs.innerHTML = '';
        fx.folder.forEach((fKey, i) => {
            const tab = el('div', {
                class: ['faction-header', i === 0 ? 'active' : ''],
                text: fx.name[i],
                dataset: { faction: fKey, expansion: expansionKey }
            });
            factionTabs.appendChild(tab);
        });
    }

    function renderCardTypeTabs(cardTypes) {
        cardTypeTabs.innerHTML = '';
        cardTypes.forEach((type, i) => {
            const tab = el('div', {
                class: ['card-header', i === 0 ? 'active' : ''],
                text: CARD_TYPE_LABELS_RU[type] ?? type, // RU label
                dataset: { cardType: type, faction: state.factionKey, expansion: state.expansionKey }
            });
            cardTypeTabs.appendChild(tab);
        });
    }

    // ===== Cards Rendering =====
    async function renderCards(expansionKey, factionKey, cardTypeKey) {
        if (!expansionKey || !factionKey || !cardTypeKey) return;

        cardsContainer.innerHTML = '';
        const subTab = el('div', {
            class: ['card-contents'],
            attrs: { id: `cards-${expansionKey}-${factionKey}-${cardTypeKey}` }
        });
        cardsContainer.appendChild(subTab);

        let textData;
        try {
            textData = await fetchJSON(`factions/${expansionKey}/${factionKey}/text.json`);
        } catch (err) {
            console.error(err);
            errorBanner(subTab, `Failed to load text.json for ${factionKey}/${expansionKey}`);
            return;
        }

        const files = state.data.cards?.[cardTypeKey];
        if (!Array.isArray(files)) {
            errorBanner(subTab, `Invalid card files for type "${cardTypeKey}"`);
            return;
        }

        switch (cardTypeKey) {
            case Object.keys(state.data.cards)[0]: // Combat
                await createCombatContent(subTab, expansionKey, factionKey, files, textData.combatText);
                break;
            case Object.keys(state.data.cards)[1]: // Orders
                await createOrdersContent(subTab, expansionKey, factionKey, files, textData.ordersText);
                break;
            case Object.keys(state.data.cards)[2]: // Events
                await createEventContent(subTab, expansionKey, factionKey, files, textData.eventsText);
                break;
            case Object.keys(state.data.cards)[3]: // FactionCard
                createFactionCardContent(subTab, expansionKey, factionKey, files);
                break;
            case Object.keys(state.data.cards)[4]: // Backs
                createBackCardContent(subTab, expansionKey, factionKey, files);
                break;
            default:
                errorBanner(subTab, `Unknown card type: ${cardTypeKey}`);
        }
    }

    // ===== Content Builders =====
    async function createCombatContent(container, expansion, faction, files, textData) {
        if (!Array.isArray(files) || !Array.isArray(textData)) {
            errorBanner(container, 'Combat data malformed.');
            return;
        }

        const sections = {
            's-section': { files: files.slice(0, 5), texts: textData.slice(0, 5) },
            't1-section': { files: files.slice(5, 9), texts: textData.slice(5, 9) },
            't2-section': { files: files.slice(9, 12), texts: textData.slice(9, 12) },
            't3-section': { files: files.slice(12, 14), texts: textData.slice(12, 14) }
        };

        const tasks = [];
        for (const key of Object.keys(sections)) {
            const sectionEl = el('div', { class: ['grid', 'combat', key] });
            container.appendChild(sectionEl);

            const { files: f, texts: t } = sections[key];
            for (let i = 0; i < f.length; i++) {
                const file = f[i];
                const text = t?.[i];
                if (!text) continue;

                const jsonData = {
                    picture: `factions/${expansion}/${faction}/combat/${file}`,
                    title: text.title ?? '',
                    background: text.general ?? '',
                    foreground: text.unit ?? ''
                };

                const canvas = makeCanvas(maxWidth, maxHeight);
                sectionEl.appendChild(canvas);
                const ctx = canvas.getContext('2d');

                // enqueue without awaiting (parallel)
                tasks.push(drawCombatCard(jsonData, ctx).catch(err => console.error('[combat draw]', err)));
            }
        }
        await Promise.allSettled(tasks);
    }

    // === PATCH: parallelize Orders drawing ===
    async function createOrdersContent(container, expansion, faction, files, textData) {
        if (!Array.isArray(files) || !Array.isArray(textData)) {
            errorBanner(container, 'Orders data malformed.');
            return;
        }
        const wrap = el('div', { class: ['grid', 'orders'] });
        container.appendChild(wrap);

        const tasks = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const text = textData[i];
            if (!text) continue;

            const jsonData = {
                picture: `factions/${expansion}/${faction}/orders/${file}`,
                title: text.title ?? '',
                general: text.general ?? ''
            };

            const canvas = makeCanvas(maxWidth, maxHeight);
            wrap.appendChild(canvas);
            const ctx = canvas.getContext('2d');

            tasks.push(drawOrderCard(jsonData, ctx).catch(err => console.error('[orders draw]', err)));
        }
        await Promise.allSettled(tasks);
    }

    // === PATCH: parallelize Events drawing ===
    async function createEventContent(container, expansion, faction, files, textData) {
        if (!Array.isArray(files) || !Array.isArray(textData)) {
            errorBanner(container, 'Events data malformed.');
            return;
        }

        const wrap = el('div', { class: ['grid', 'events'] });
        container.appendChild(wrap);

        const tasks = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const text = textData[i];
            if (!text) continue;

            const jsonData = {
                picture: `factions/${expansion}/${faction}/events/${file}`,
                title: text.title ?? '',
                general: text.general ?? '',
                type: text.type ?? ''
            };

            const canvas = makeCanvas(maxWidth, maxHeight);
            wrap.appendChild(canvas);
            const ctx = canvas.getContext('2d');

            tasks.push(drawEventCard(jsonData, ctx).catch(err => console.error('[events draw]', err)));
        }
        await Promise.allSettled(tasks);
    }

    function createFactionCardContent(container, expansion, faction, files) {
        const wrap = el('div', { class: ['factionCard'] });
        container.appendChild(wrap);

        files.forEach((file) => {
            const img = new Image();
            img.src = `factions/${expansion}/${faction}/faction_card/${file}`;
            img.loading = 'lazy';
            wrap.appendChild(img);
        });
    }

    function createBackCardContent(container, expansion, faction, files) {
        const wrap = el('div', { class: ['grid', 'cardBack'] });
        container.appendChild(wrap);

        files.forEach((file) => {
            const img = new Image();
            img.src = `factions/${expansion}/${faction}/backs/${file}`;
            img.width = maxWidth;
            img.height = maxHeight;
            img.loading = 'lazy';
            wrap.appendChild(img);
        });
    }

    // ===== Canvas Helpers =====
    function replaceForbiddenStarsElements(str = '') {
        return String(str)
            .replace(/\[B\]/g, '}')
            .replace(/\[S\]/g, '{')
            .replace(/\[M\]/g, '<')
            .replace(/\[D\]/g, '|')
            .replace(/\(B\)/g, '#')
            .replace(/\(S\)/g, '@');
    }

    function calculateTextHeight(context, text, extraHeight, marginHeight, interline, fontSize) {
        context.font = `${fontSize}px ForbiddenStars`;
        const words = String(text).split(' ');
        let line = '';
        const lineHeight = parseInt(context.font.match(/\d+/), 10);
        let h = 0;

        for (let n = 0; n < words.length; n++) {
            const w = words[n];
            if (w === '*newline*') {
                h += lineHeight + interline;
                line = '';
            } else if (w === '*newpara*') {
                h += 2 * lineHeight;
                line = '';
            } else {
                const test = `${line}${w} `;
                if (context.measureText(test).width > maxTextWidth && n > 0) {
                    h += lineHeight + interline;
                    line = `${w} `;
                } else {
                    line = test;
                }
            }
        }
        // last line + padding
        h += lineHeight * 2 + extraHeight + marginHeight * 2;
        return h;
    }

    function drawWrappedText(ctx, text, x, y, maxW, interline, fontSize, align = 'left') {
        ctx.font = `${fontSize}px ForbiddenStars`;
        ctx.textAlign = align;
        const words = String(text).split(' ');
        let line = '';
        const lineHeight = parseInt(ctx.font.match(/\d+/), 10);
        let yy = y + lineHeight;

        for (let n = 0; n < words.length; n++) {
            const w = words[n];
            if (w === '*newline*') {
                ctx.fillText(line, x, yy);
                yy += lineHeight + interline;
                line = '';
            } else if (w === '*newpara*') {
                ctx.fillText(line, x, yy);
                yy += 2 * lineHeight;
                line = '';
            } else {
                const test = `${line}${w} `;
                if (ctx.measureText(test).width > maxW && n > 0) {
                    ctx.fillText(line, x, yy);
                    yy += lineHeight + interline;
                    line = `${w} `;
                } else {
                    line = test;
                }
            }
        }
        ctx.fillText(line, x, yy);
    }

    // === PATCH: concurrency-friendly image loader ===
    async function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.decoding = 'async';
            img.loading = 'eager';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });
    }


    function makeCanvas(w, h) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
    }
    // === Rich/styled text: italics before colon, and "-или-" special ===
    // Replace your existing drawWrappedText with this enhanced version
    function drawStyledWrappedText(ctx, text, x, y, maxW, interline, fontSize, align = 'left') {
        // ---- Fonts & metrics
        const baseFont = `${fontSize}px ForbiddenStars`;
        const italicFont = `italic ${fontSize}px ForbiddenStars`;
        const getLH = () => parseInt(ctx.font.match(/\d+/), 10);

        // ---- Normalize control tokens to paragraphs/lines
        const normalize = (s) =>
            String(s)
                .replace(/\s*\*newpara\*\s*/g, '\n\n')
                .replace(/\s*\*newline\*\s*/g, '\n')
                .replace(/[ \t]+/g, ' ')
                .replace(/ *\n */g, '\n')
                .trim();

        const paragraphs = normalize(text).split('\n'); // empty string => paragraph gap

        // ---- Build styled tokens per paragraph based on your rules
        // Each paragraph becomes an array of {text, italic, glue}
        const buildTokens = (p) => {
            if (p.trim() === '') return []; // blank paragraph separator
            if (p.trim() === '-или-') return [{ text: '-или-', italic: true, glue: true }];

            if (p.includes(':')) {
                const i = p.indexOf(':');
                const before = p.slice(0, i).trimEnd();
                const after = p.slice(i + 1).trimStart();
                const tokens = [];
                if (before) tokens.push({ text: before, italic: true, glue: true });
                tokens.push({ text: ':', italic: false, glue: true }); // stick to label
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

        // ---- Render a fully composed line (array of segments) honoring alignment
        const renderLine = (segments, yy) => {
            // Compute the total width of this line
            let totalW = 0;
            for (const s of segments) totalW += measure(s.text, s.italic);

            // Alignment (left/center like the original)
            let startX = x;
            if (align === 'center') startX = x - totalW / 2;

            // Draw
            let cursorX = startX;
            for (const s of segments) {
                ctx.font = s.italic ? italicFont : baseFont;
                ctx.textAlign = 'left';
                ctx.fillText(s.text, cursorX, yy);
                cursorX += measure(s.text, s.italic);
            }
        };

        // ---- Wrapping logic (kept conceptually identical: accumulate, measure, break)
        ctx.font = baseFont;
        ctx.textAlign = align;
        const lineHeight = getLH();
        let yy = y + lineHeight;

        for (let p of paragraphs) {
            // Paragraph gap (from *newpara*): add extra vertical space
            if (p === '') { yy += lineHeight; continue; }

            const tokens = buildTokens(p);
            let line = [];         // [{text, italic}]
            let lineWidth = 0;

            const pushWord = (word, italic, glue) => {
                const segText = (line.length === 0 || glue) ? word : (' ' + word);
                const w = measure(segText, italic);

                if (lineWidth + w > maxW && line.length > 0) {
                    renderLine(line, yy);
                    yy += lineHeight + interline;
                    line = [];
                    lineWidth = 0;

                    // first on a new line: no leading space
                    const w2 = measure(word, italic);
                    line.push({ text: word, italic });
                    lineWidth += w2;
                } else {
                    line.push({ text: segText, italic });
                    lineWidth += w;
                }
            };

            for (const t of tokens) {
                if (t.text === ':') { // special glued colon
                    pushWord(':', false, true);
                    continue;
                }
                const words = t.text.split(' ');
                for (let i = 0; i < words.length; i++) {
                    const w = words[i];
                    if (!w) continue;
                    const glue = (line.length === 0) || (t.glue && i === 0);
                    pushWord(w, t.italic, glue);
                }
            }

            if (line.length) {
                renderLine(line, yy);
                yy += lineHeight + interline;
            }
        }
    }

    // ===== Drawing: Combat =====
    async function drawCombatCard(data, ctx) {
        const bottomImageHeight = maxHeight * 0.025;
        const maxFieldsHeight = maxHeight * 0.4;
        const extraForegroundTriangle = maxHeight * 0.0455;
        const extraBackgroundBorder = maxHeight * 0.0385;

        let interline = maxHeight * 0.0077;
        let marginHeight = maxWidth * 0.05;
        let fontSize = maxHeight * 0.03;

        const [picture, backgroundImg, foregroundImg, bottomImg] = await Promise.all([
            loadImage(data.picture),
            loadImage('pictures/background.png'),
            loadImage('pictures/foreground.png'),
            loadImage('pictures/bottom.png')
        ]);

        const bgText = replaceForbiddenStarsElements(data.background || '');
        const fgText = replaceForbiddenStarsElements(data.foreground || '');

        let bgH = 0;
        let fgH = 0;

        const recalc = () => {
            if (bgText.length) bgH = calculateTextHeight(ctx, bgText, extraBackgroundBorder, marginHeight, interline, fontSize);
            if (fgText.length) fgH = calculateTextHeight(ctx, fgText, extraForegroundTriangle, marginHeight, interline, fontSize);
        };

        const shrinkTextToFit = () => {
            marginHeight *= 0.8;
            fontSize *= 0.99;
            interline *= 0.95;
            recalc();
        };

        recalc();

        if (bgText && fgText) {
            while (bgH + fgH > maxFieldsHeight) shrinkTextToFit();
        } else {
            while (Math.max(bgH, fgH) > maxFieldsHeight) shrinkTextToFit();
        }

        const cropPaint = (img, y) => {
            ctx.drawImage(img, 0, 0, textBackgroundSize, maxHeight - y, 0, y, maxWidth, maxHeight - y);
        };

        // Paint base image
        ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

        // Title
        ctx.font = `${titleFontSize}px HeadlinerNo45`;
        ctx.textAlign = 'left';
        ctx.fillText(data.title || '', maxWidth * 0.27, maxHeight * 0.077);

        // Background text (left-aligned)
        if (bgText) {
            const y = maxHeight - (bgH + fgH);
            cropPaint(backgroundImg, y);
            drawStyledWrappedText(
                ctx,
                bgText,
                marginWidth,
                y + marginHeight + extraBackgroundBorder,
                maxWidth - 2 * marginWidth,
                interline,
                fontSize,
                'left'
            );
        }

        // Foreground text (left-aligned)
        if (fgText) {
            const y = maxHeight - (fgH + extraForegroundTriangle * 0.35);
            cropPaint(foregroundImg, y);
            drawStyledWrappedText(
                ctx,
                fgText,
                marginWidth,
                y + marginHeight + extraForegroundTriangle,
                maxWidth - 2 * marginWidth,
                interline,
                fontSize,
                'left'
            );
        }


        ctx.drawImage(bottomImg, 0, 0, textBottomBarWidth, textBottomBarHeight, 0, maxHeight - bottomImageHeight, maxWidth, bottomImageHeight);
    }

    // ===== Drawing: Orders =====
    async function drawOrderCard(data, ctx) {
        const maxFieldsHeight = maxHeight * 0.455;
        const textPositionY = maxHeight * 0.54;
        const marginOrderWidth = maxHeight * 0.1;

        let interline = maxHeight * 0.0077;
        let fontSize = maxHeight * 0.03;

        const picture = await loadImage(data.picture);
        const text = replaceForbiddenStarsElements(data.general || '');

        let generalH = 0;
        const recalc = () => {
            generalH = calculateTextHeight(ctx, text, 0, marginOrderWidth, interline, fontSize);
        };

        const shrinkTextToFit = () => {
            fontSize *= 0.95;
            interline *= 0.97;
            recalc();
        };

        recalc();
        while (generalH > maxFieldsHeight) shrinkTextToFit();

        // Base
        ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

        // Title
        ctx.font = `${titleFontSize}px HeadlinerNo45`;
        ctx.textAlign = 'center';
        ctx.fillText(data.title || '', maxWidth * 0.5, maxHeight * 0.2325);

        // Body
        drawWrappedText(
            ctx,
            text,
            maxWidth * 0.5,
            textPositionY,
            maxWidth - 2 * marginOrderWidth,
            interline,
            fontSize,
            'center'
        );
    }

    // ===== Drawing: Events =====
    async function drawEventCard(data, ctx) {
        const maxFieldsHeight = maxHeight * 0.278;
        const textPositionY = maxHeight * 0.685;

        let interline = maxHeight * 0.0077;
        let fontSize = maxHeight * 0.03;

        const picture = await loadImage(data.picture);
        const text = replaceForbiddenStarsElements(data.general || '');

        let generalH = 0;
        const recalc = () => {
            generalH = calculateTextHeight(ctx, text, 20, 0, interline, fontSize);
        };

        const shrinkTextToFit = () => {
            fontSize *= 0.95;
            interline *= 0.97;
            recalc();
        };

        recalc();
        while (generalH > maxFieldsHeight) shrinkTextToFit();

        // Base
        ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

        // Type
        ctx.font = `bold ${titleFontSize * 0.8}px FrizQuadrataStd`;
        ctx.textAlign = 'center';
        ctx.fillText(data.type || '', maxWidth * 0.5, maxHeight * 0.573);

        // Title
        ctx.font = `${titleFontSize}px HeadlinerNo45`;
        ctx.textAlign = 'left';
        ctx.fillText(data.title || '', maxWidth * 0.05, maxHeight * 0.0735);

        // Body
        drawWrappedText(
            ctx,
            text,
            marginWidth,
            textPositionY,
            maxWidth - 2 * marginWidth,
            interline,
            fontSize,
            'left'
        );
    }

    // ===== Utilities =====
    function mustGet(selector) {
        const node = document.querySelector(selector);
        if (!node) throw new Error(`Missing required element: ${selector}`);
        return node;
    }

    async function fetchJSON(url) {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return res.json();
    }

    function el(tag, { class: classes = [], text, dataset = {}, attrs = {} } = {}) {
        const node = document.createElement(tag);
        if (classes.length) node.classList.add(...classes.filter(Boolean));
        if (text != null) node.textContent = text;
        Object.entries(dataset).forEach(([k, v]) => (node.dataset[k] = v));
        Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
        return node;
    }

    function updateActive(container, activeEl) {
        container.querySelectorAll('.active').forEach(n => n.classList.remove('active'));
        activeEl.classList.add('active');
    }

    function showSpinner() {
        spinner.style.display = 'block';
    }

    function hideSpinner() {
        spinner.style.display = 'none';
    }

    function errorBanner(container, msg) {
        const box = el('div', { class: ['error-banner'], text: msg });
        container.appendChild(box);
    }
});
