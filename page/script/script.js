// cards-app.js (with italics feature)
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
        data: null,
        expansionKey: null,
        factionKey: null,
        cardTypeKey: null
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

    // ===== Event Delegation (one-time) =====
    expansionTabs.addEventListener('click', async (e) => {
        const el = e.target.closest('.expansion-header');
        if (!el) return;

        updateActive(expansionTabs, el);
        state.expansionKey = el.dataset.expansion;

        try {
            showSpinner();
            renderFactionTabs(state.expansionKey);

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
                text: type,
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

        const cardOrder = Object.keys(state.data.cards);

        switch (cardTypeKey) {
            case cardOrder[0]: // Combat
                await createCombatContent(subTab, expansionKey, factionKey, files, textData.combatText);
                break;
            case cardOrder[1]: // Orders
                await createOrdersContent(subTab, expansionKey, factionKey, files, textData.ordersText);
                break;
            case cardOrder[2]: // Events
                await createEventContent(subTab, expansionKey, factionKey, files, textData.eventsText);
                break;
            case cardOrder[3]: // FactionCard
                createFactionCardContent(subTab, expansionKey, factionKey, files);
                break;
            case cardOrder[4]: // Backs
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
            's-section': files.slice(0, 5),
            't1-section': files.slice(5, 9),
            't2-section': files.slice(9, 12),
            't3-section': files.slice(12, 14)
        };

        const textSections = {
            's-section': textData.slice(0, 5),
            't1-section': textData.slice(5, 9),
            't2-section': textData.slice(9, 12),
            't3-section': textData.slice(12, 14)
        };

        for (const key of Object.keys(sections)) {
            const sectionEl = el('div', { class: ['grid', 'combat', key] });
            container.appendChild(sectionEl);

            for (let i = 0; i < sections[key].length; i++) {
                const file = sections[key][i];
                const text = textSections[key]?.[i];
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
                await drawCombatCard(jsonData, ctx);
            }
        }
    }

    async function createOrdersContent(container, expansion, faction, files, textData) {
        if (!Array.isArray(files) || !Array.isArray(textData)) {
            errorBanner(container, 'Orders data malformed.');
            return;
        }
        const wrap = el('div', { class: ['grid', 'orders'] });
        container.appendChild(wrap);

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
            await drawOrderCard(jsonData, ctx);
        }
    }

    async function createEventContent(container, expansion, faction, files, textData) {
        if (!Array.isArray(files) || !Array.isArray(textData)) {
            errorBanner(container, 'Events data malformed.');
            return;
        }

        const wrap = el('div', { class: ['grid', 'events'] });
        container.appendChild(wrap);

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
            await drawEventCard(jsonData, ctx);
        }
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

    // ===== Canvas Text Styling (Italics rules) =====

    // Check rule #1: exact dash-или-dash token
    function isDashIliToken(tok) {
        const t = tok.trim();
        return t === '-или-' || t === '—или—' || t === '–или–';
    }

    // Tokenize by spaces while preserving control markers; we mark line/paragraph boundaries.
    function tokenize(text) {
        const raw = String(text).split(' ');
        return raw.map(w => {
            if (w === '*newline*') return { type: 'newline' };
            if (w === '*newpara*') return { type: 'newpara' };
            return { type: 'word', text: w };
        });
    }

    // Compute lines with inline italics + wrapping; returns an array of lines, each line is [{text, italic}]
    function layoutStyledLines(ctx, text, maxW, interline, fontSize, align) {
        const tokens = tokenize(text);
        const lines = [];
        let line = [];
        let lineWidth = 0;
        let atParagraphStart = true;
        let colonSeenInPara = false;

        const flushLine = () => {
            lines.push(line.length ? line : []);
            line = [];
            lineWidth = 0;
        };

        const splitOnFirstColon = (word) => {
            const i = word.indexOf(':');
            if (i === -1) return [{ text: word, kind: 'word' }];
            const head = word.slice(0, i);
            const tail = word.slice(i + 1);
            const segs = [];
            if (head) segs.push({ text: head, kind: 'word' });
            segs.push({ text: ':', kind: 'colon' });
            if (tail) segs.push({ text: tail, kind: 'word' }); // rare case, e.g. "Крейсер:что-то"
            return segs;
        };

        const pushSeg = (segText, italic) => {
            ctx.font = `${italic ? 'italic ' : ''}${fontSize}px ForbiddenStars`;
            const w = ctx.measureText(segText + ' ').width;
            if (lineWidth + w > maxW && line.length > 0) {
                flushLine();
            }
            line.push({ text: segText, italic });
            lineWidth += w;
        };

        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];

            if (tok.type === 'newline' || tok.type === 'newpara') {
                flushLine();
                atParagraphStart = true;
                colonSeenInPara = false;
                continue;
            }

            // word token -> split around the first colon (if any)
            const segs = splitOnFirstColon(tok.text);

            for (const seg of segs) {
                if (seg.kind === 'colon') {
                    // Colon itself: never italic, and marks end of the "before colon" zone
                    pushSeg(':', /*italic*/ false);
                    colonSeenInPara = true;
                    atParagraphStart = false;
                    continue;
                }

                const word = seg.text;
                const italicByRule1 = isDashIliToken(word);
                const italicByRule2 = atParagraphStart && !colonSeenInPara; // before first colon in this paragraph
                const italic = italicByRule1 || italicByRule2;

                pushSeg(word, italic);

                if (word.trim().length > 0) atParagraphStart = false;
            }
        }
        flushLine();
        return lines;
    }


    // Styled height calc to match layoutStyledLines (adds top/bottom padding like original)
    function calculateTextHeightStyled(ctx, text, extraHeight, marginHeight, interline, fontSize, maxW) {
        const lines = layoutStyledLines(ctx, text, maxW, interline, fontSize, 'left');
        ctx.font = `${fontSize}px ForbiddenStars`;
        const lineHeight = parseInt(ctx.font.match(/\d+/), 10);
        // number of non-empty visual lines; even empty lines get baseline height for consistency
        const visualLines = Math.max(1, lines.length);
        // Each line contributes lineHeight; between lines we add interline (lines-1 times)
        const bodyHeight = visualLines * lineHeight + Math.max(0, visualLines - 1) * interline;
        return bodyHeight + lineHeight + extraHeight + marginHeight * 2; // +one extra line like the original method
    }

    // Draw styled text with italics and wrapping
    function drawWrappedTextStyled(ctx, text, x, y, maxW, interline, fontSize, align = 'left') {
        const lines = layoutStyledLines(ctx, text, maxW, interline, fontSize, align);
        ctx.font = `${fontSize}px ForbiddenStars`;
        const lineHeight = parseInt(ctx.font.match(/\d+/), 10);

        let cursorY = y + lineHeight;

        for (const line of lines) {
            // compute total width for alignment if needed
            let totalW = 0;
            for (const seg of line) {
                ctx.font = `${seg.italic ? 'italic ' : ''}${fontSize}px ForbiddenStars`;
                totalW += ctx.measureText(seg.text + ' ').width;
            }

            let startX = x;
            if (align === 'center') startX = x - totalW / 2;
            else if (align === 'right') startX = x - totalW;

            // draw segments
            let cursorX = startX;
            for (const seg of line) {
                ctx.font = `${seg.italic ? 'italic ' : ''}${fontSize}px ForbiddenStars`;
                ctx.fillText(seg.text, cursorX, cursorY);
                cursorX += ctx.measureText(seg.text + ' ').width;
            }

            cursorY += lineHeight + interline;
        }
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

    async function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
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

        const bgTextRaw = replaceForbiddenStarsElements(data.background || '');
        const fgTextRaw = replaceForbiddenStarsElements(data.foreground || '');

        let bgH = 0;
        let fgH = 0;

        const recalc = () => {
            if (bgTextRaw.length) {
                bgH = calculateTextHeightStyled(
                    ctx,
                    bgTextRaw,
                    extraBackgroundBorder,
                    marginHeight,
                    interline,
                    fontSize,
                    maxTextWidth
                );
            }
            if (fgTextRaw.length) {
                fgH = calculateTextHeightStyled(
                    ctx,
                    fgTextRaw,
                    extraForegroundTriangle,
                    marginHeight,
                    interline,
                    fontSize,
                    maxTextWidth
                );
            }
        };

        const shrinkTextToFit = () => {
            marginHeight *= 0.8;
            fontSize *= 0.99;
            interline *= 0.95;
            recalc();
        };

        recalc();

        if (bgTextRaw && fgTextRaw) {
            while (bgH + fgH > maxFieldsHeight) shrinkTextToFit();
        } else {
            while (Math.max(bgH, fgH) > maxFieldsHeight) shrinkTextToFit();
        }

        const cropPaint = (img, y) => {
            ctx.drawImage(img, 0, 0, textBackgroundSize, maxHeight - y, 0, y, maxWidth, maxHeight - y);
        };

        // Base
        ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

        // Title
        ctx.font = `${titleFontSize}px HeadlinerNo45`;
        ctx.textAlign = 'left';
        ctx.fillText(data.title || '', maxWidth * 0.27, maxHeight * 0.077);

        if (bgTextRaw) {
            const y = maxHeight - (bgH + fgH);
            cropPaint(backgroundImg, y);
            drawWrappedTextStyled(
                ctx,
                bgTextRaw,
                marginWidth,
                y + marginHeight + extraBackgroundBorder,
                maxTextWidth,
                interline,
                fontSize,
                'left'
            );
        }

        if (fgTextRaw) {
            const y = maxHeight - (fgH + extraForegroundTriangle * 0.35);
            cropPaint(foregroundImg, y);
            drawWrappedTextStyled(
                ctx,
                fgTextRaw,
                marginWidth,
                y + marginHeight + extraForegroundTriangle,
                maxTextWidth,
                interline,
                fontSize,
                'left'
            );
        }

        ctx.drawImage(
            bottomImg,
            0, 0, textBottomBarWidth, textBottomBarHeight,
            0, maxHeight - bottomImageHeight, maxWidth, bottomImageHeight
        );
    }

    // ===== Drawing: Orders =====
    async function drawOrderCard(data, ctx) {
        const maxFieldsHeight = maxHeight * 0.455;
        const textPositionY = maxHeight * 0.54;
        const marginOrderWidth = maxHeight * 0.1;

        let interline = maxHeight * 0.0077;
        let fontSize = maxHeight * 0.03;

        const picture = await loadImage(data.picture);
        const textRaw = replaceForbiddenStarsElements(data.general || '');
        const maxW = maxWidth - 2 * marginOrderWidth;

        let generalH = 0;
        const recalc = () => {
            generalH = calculateTextHeightStyled(
                ctx,
                textRaw,
                0,
                marginOrderWidth,
                interline,
                fontSize,
                maxW
            );
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

        // Body (centered)
        drawWrappedTextStyled(
            ctx,
            textRaw,
            maxWidth * 0.5, // center anchor
            textPositionY,
            maxW,
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
        const textRaw = replaceForbiddenStarsElements(data.general || '');

        let generalH = 0;
        const recalc = () => {
            generalH = calculateTextHeightStyled(
                ctx,
                textRaw,
                20,
                0,
                interline,
                fontSize,
                maxTextWidth
            );
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
        ctx.font = `${titleFontSize * 0.8}px FrizQuadrataStd`;
        ctx.textAlign = 'center';
        ctx.fillText(data.type || '', maxWidth * 0.5, maxHeight * 0.573);

        // Title
        ctx.font = `${titleFontSize}px HeadlinerNo45`;
        ctx.textAlign = 'left';
        ctx.fillText(data.title || '', maxWidth * 0.05, maxHeight * 0.0735);

        // Body (left)
        drawWrappedTextStyled(
            ctx,
            textRaw,
            marginWidth,
            textPositionY,
            maxTextWidth,
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
