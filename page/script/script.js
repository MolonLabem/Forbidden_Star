async function preloadCanvasFonts() {
    if (!document.fonts) {
        return;
    }

    const families = ['ForbiddenStars', 'Headline', 'EventFont'];
    const fontLoads = families.map((family) => document.fonts.load(`1em ${family}`));

    try {
        await Promise.all([...fontLoads, document.fonts.ready]);
    } catch (error) {
        console.warn('Некоторые шрифты не успели загрузиться до первой отрисовки.', error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await preloadCanvasFonts();

    /* =========================
       DOM
    ========================= */

    const expansionTabsContainer = document.getElementById('expansion-tabs');
    const factionTabsContainer = document.getElementById('faction-tabs');
    const cardTypeTabs = document.getElementById('cards-tabs');
    const cardsContainer = document.getElementById('cards-container');

    const faqContainer = document.getElementById('faq-container');
    const faqContent = document.getElementById('faq-content');
    const faqSearchInput = document.getElementById('faq-search-input');
    const faqSearchMeta = document.getElementById('faq-search-meta');

    const FAQ_JSON_PATH = './data/FAQ.json';

    /* =========================
       STATE
    ========================= */

    const state = {
        expansionKey: null,
        factionKey: null,
        cardType: null
    };

    let generalData = null;

    let faqOriginalData = [];
    let faqLoaded = false;
    let faqLoadingPromise = null;

    let activeExpansionTab = null;
    let activeFactionTab = null;
    let activeCardTab = null;

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
        backs: 'Задники',
        faction_card: 'Фракция',
        map: 'Домашка'
    };

    const CARD_TYPE_CONFIG = {
        combat: { render: createCombatContent, textKey: 'combatText' },
        orders: { render: createOrdersContent, textKey: 'ordersText' },
        events: { render: createEventContent, textKey: 'eventsText' },
        faction_card: { render: createFactioncardContent },
        backs: { render: backCardContent },
        map: { render: mapCardContent }
    };

    /* =========================
       CACHES
    ========================= */

    const jsonCache = new Map();
    const imageCache = new Map();

    async function fetchJsonCached(path) {
        if (jsonCache.has(path)) {
            return jsonCache.get(path);
        }

        const promise = fetch(path, { cache: 'no-store' })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Failed to load JSON: ${path} (${response.status})`);
                }
                return response.json();
            });

        jsonCache.set(path, promise);
        return promise;
    }

    async function loadImage(url) {
        if (imageCache.has(url)) {
            return imageCache.get(url);
        }

        const promise = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });

        imageCache.set(url, promise);
        return promise;
    }

    /* =========================
       GENERAL HELPERS
    ========================= */

    function withArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function normalize(value) {
        return String(value ?? '').toLowerCase();
    }

    function matches(value, query) {
        return normalize(value).includes(query);
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeMainText(value) {
        return String(value ?? '')
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n');
    }

    function getPicture(node) {
        return node && typeof node === 'object' ? node.picture || '' : '';
    }

    function createPlaceholderWithSpinner() {
        const placeholder = document.createElement('div');
        placeholder.classList.add('card-placeholder');

        const spinner = document.createElement('div');
        spinner.classList.add('card-spinner');

        placeholder.appendChild(spinner);
        return placeholder;
    }

    function replaceForbiddenStarsElements(str) {
        str = String(str ?? '');
        str = str.replace(/\[B\]/g, "}");
        str = str.replace(/\[S\]/g, "{");
        str = str.replace(/\[M\]/g, "<");
        str = str.replace(/\[D\]/g, "|");
        str = str.replace(/\(B\)/g, "#");
        str = str.replace(/\(S\)/g, "@");
        return str;
    }

    function calculateTextHeight(context, text, extraHeight, marginHeight, interline, fontSize) {
        context.font = `${fontSize}px ForbiddenStars`;
        const words = text.split(' ');
        let line = '';
        const lineHeight = parseInt(context.font.match(/\d+/), 10);
        let returnHeight = 0;

        for (let n = 0; n < words.length; n++) {
            if (words[n] === '*newline*') {
                returnHeight += lineHeight + interline;
                line = '';
            }
            else if (words[n] === '*newpara*') {
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
    }

    function drawStyledWrappedText(ctx, text, x, y, maxW, interline, fontSize, align = 'left') {
        const baseFont = `${fontSize}px ForbiddenStars`;
        const italicFont = `italic ${fontSize}px ForbiddenStars`;
        const getLH = () => parseInt(ctx.font.match(/\d+/), 10);

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

        const measure = (txt, italic) => {
            ctx.font = italic ? italicFont : baseFont;
            return ctx.measureText(txt).width;
        };

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

    /* =========================
       FAQ HELPERS
    ========================= */

    const normalizeFaqValue = (value) => String(value ?? '').toLowerCase();
    const faqMatches = (value, query) => normalizeFaqValue(value).includes(query);
    const faqWithArray = (value) => Array.isArray(value) ? value : [];
    const getFaqPicture = (node) => node && typeof node === 'object' ? node.picture || '' : '';

    function faqEscapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeFaqMainText(value) {
        return String(value ?? '')
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n');
    }

    function highlightFaqText(text, query) {
        const raw = String(text ?? '');
        if (!query) {
            return faqEscapeHtml(raw);
        }

        const escaped = faqEscapeHtml(raw);
        const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${safeQuery})`, 'ig');
        return escaped.replace(regex, '<mark>$1</mark>');
    }

    function createFaqLevelRow(textHtml, picture) {
        const row = document.createElement('div');
        row.className = `faq-level-row ${picture ? '' : 'no-picture'}`.trim();

        const textWrap = document.createElement('div');
        textWrap.innerHTML = textHtml;
        row.appendChild(textWrap);

        if (picture) {
            const img = document.createElement('img');
            img.className = 'faq-level-image';
            img.src = picture;
            img.alt = '';
            img.loading = 'lazy';
            row.appendChild(img);
        }

        return row;
    }

    function renderFaqPhraseBlock(phraseObj, query) {
        const phraseBlock = document.createElement('section');
        phraseBlock.className = 'faq-phrase-block faq-level-block';

        const phraseText = phraseObj.Phrase ?? '';
        const mainText = normalizeFaqMainText(phraseObj.Main ?? '');
        const picture = getFaqPicture(phraseObj);

        const textHtml = `
            <div class="faq-phrase-title"><strong>${highlightFaqText(phraseText, query)}</strong></div>
            <div class="faq-main-text">${highlightFaqText(mainText, query)}</div>
        `;

        phraseBlock.appendChild(createFaqLevelRow(textHtml, picture));
        return phraseBlock;
    }

    function renderFaqFactionBlock(factionObj, query) {
        const block = document.createElement('section');
        block.className = 'faq-faction-block faq-level-block';

        const title = factionObj.Faction ?? '';
        const picture = getFaqPicture(factionObj);

        const headerHtml = `
            <h3>${highlightFaqText(title, query)}</h3>
            <div class="faq-separator"></div>
        `;

        block.appendChild(createFaqLevelRow(headerHtml, picture));

        faqWithArray(factionObj.items).forEach((phraseObj) => {
            block.appendChild(renderFaqPhraseBlock(phraseObj, query));
        });

        return block;
    }

    function renderFaqSubCategoryBlock(subObj, query) {
        const block = document.createElement('section');
        block.className = 'faq-subcategory-block faq-level-block';

        const title = subObj.SubCategory ?? '';
        const picture = getFaqPicture(subObj);

        const headerHtml = `
            <h2>${highlightFaqText(title, query)}</h2>
            <div class="faq-separator"></div>
        `;

        block.appendChild(createFaqLevelRow(headerHtml, picture));

        faqWithArray(subObj.items).forEach((factionObj) => {
            block.appendChild(renderFaqFactionBlock(factionObj, query));
        });

        return block;
    }

    function renderFaqCategoryBlock(categoryObj, query) {
        const block = document.createElement('section');
        block.className = 'faq-category-block faq-level-block';

        const title = categoryObj.Category ?? '';
        const picture = getFaqPicture(categoryObj);

        const headerHtml = `
            <h1>${highlightFaqText(title, query)}</h1>
            <div class="faq-separator"></div>
        `;

        block.appendChild(createFaqLevelRow(headerHtml, picture));

        faqWithArray(categoryObj.items).forEach((subObj) => {
            block.appendChild(renderFaqSubCategoryBlock(subObj, query));
        });

        return block;
    }

    function renderFaq(data, query = '') {
        if (!faqContent) {
            return;
        }

        faqContent.innerHTML = '';

        if (!data.length) {
            const empty = document.createElement('div');
            empty.className = 'faq-empty-state';
            empty.textContent = query ? 'Ничего не найдено.' : 'FAQ пока пуст.';
            faqContent.appendChild(empty);
            return;
        }

        data.forEach((categoryObj) => {
            faqContent.appendChild(renderFaqCategoryBlock(categoryObj, query));
        });
    }

    function filterFaqData(data, rawQuery) {
        const query = normalizeFaqValue(rawQuery).trim();
        if (!query) {
            return data;
        }

        return faqWithArray(data).flatMap((categoryObj) => {
            const filteredSubCategories = faqWithArray(categoryObj.items).flatMap((subObj) => {
                if (faqMatches(subObj.SubCategory, query)) {
                    return [subObj];
                }

                const filteredFactions = faqWithArray(subObj.items).flatMap((factionObj) => {
                    if (faqMatches(factionObj.Faction, query)) {
                        return [factionObj];
                    }

                    const filteredPhrases = faqWithArray(factionObj.items).filter((phraseObj) => {
                        return faqMatches(phraseObj.Phrase, query) || faqMatches(phraseObj.Main, query);
                    });

                    if (filteredPhrases.length) {
                        return [{
                            ...factionObj,
                            items: filteredPhrases
                        }];
                    }

                    return [];
                });

                if (filteredFactions.length) {
                    return [{
                        ...subObj,
                        items: filteredFactions
                    }];
                }

                return [];
            });

            if (filteredSubCategories.length) {
                return [{
                    ...categoryObj,
                    items: filteredSubCategories
                }];
            }

            return [];
        });
    }

    function updateFaqSearchResults(rawQuery) {
        const query = rawQuery.trim();
        const filtered = filterFaqData(faqOriginalData, rawQuery);
        renderFaq(filtered, query);

        if (faqSearchMeta) {
            faqSearchMeta.textContent = query
                ? `Поиск: «${query}»`
                : 'Показан полный FAQ';
        }
    }

    function debounce(fn, delay = 200) {
        let timer = null;
        return (...args) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => fn(...args), delay);
        };
    }

    async function loadFaq() {
        if (faqLoaded) {
            return faqOriginalData;
        }

        if (faqLoadingPromise) {
            return faqLoadingPromise;
        }

        faqLoadingPromise = fetchJsonCached(FAQ_JSON_PATH)
            .then((data) => {
                faqOriginalData = Array.isArray(data) ? data : [];
                faqLoaded = true;
                updateFaqSearchResults(faqSearchInput?.value ?? '');
                return faqOriginalData;
            })
            .catch((error) => {
                console.error(error);
                faqLoaded = false;

                if (faqContent) {
                    faqContent.innerHTML = '<div class="faq-empty-state">Не удалось загрузить данные FAQ.</div>';
                }

                throw error;
            })
            .finally(() => {
                faqLoadingPromise = null;
            });

        return faqLoadingPromise;
    }

    function showCardsView() {
        if (factionTabsContainer) factionTabsContainer.style.display = '';
        if (cardTypeTabs) cardTypeTabs.style.display = '';
        if (cardsContainer) cardsContainer.style.display = '';
        if (faqContainer) faqContainer.classList.remove('active');
    }

    function showFaqView() {
        if (factionTabsContainer) factionTabsContainer.style.display = 'none';
        if (cardTypeTabs) cardTypeTabs.style.display = 'none';
        if (cardsContainer) cardsContainer.style.display = 'none';
        if (faqContainer) faqContainer.classList.add('active');
        loadFaq().catch(() => { });
    }

    if (faqSearchInput) {
        faqSearchInput.addEventListener(
            'input',
            debounce((event) => {
                updateFaqSearchResults(event.target.value);
            }, 150)
        );
    }

    /* =========================
       CARD RENDERERS
    ========================= */

    async function drawCombatCard(data, ctx) {
        const bottomImageHeight = maxHeight * 0.025;
        const maxFieldsHeight = maxHeight * 0.4;

        const extraForegroundTriangle = maxHeight * 0.0455;
        const extraBackgroundBorder = maxHeight * 0.0385;

        let interline = maxHeight * 0.0077;
        let marginHeight = maxWidth * 0.05;
        let fontSize = maxHeight * 0.03;

        const picture = await loadImage(data.picture);
        const backgroundImg = await loadImage('pictures/background.png');
        const foregroundImg = await loadImage('pictures/foreground.png');
        const bottomImg = await loadImage('pictures/bottom.png');

        ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

        ctx.font = `${titleFontSize}px Headline`;
        ctx.textAlign = 'left';
        ctx.fillText(data.title || '', maxWidth * 0.27, maxHeight * 0.077);

        if (!data.hasText) {
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
            return;
        }

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

        if (backgroundText && foregroundText) {
            while (backgroundTextHeight + foregroundTextHeight > maxFieldsHeight) {
                shrinkTextToFit();
            }
        } else {
            while (Math.max(backgroundTextHeight, foregroundTextHeight) > maxFieldsHeight) {
                shrinkTextToFit();
            }
        }

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

        if (foregroundText) {
            const foregroundY = maxHeight - (foregroundTextHeight + extraForegroundTriangle * 0.35);
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

        if (data.icons && data.icons.length) {
            const iconPromises = [...data.icons].map((ch) => {
                const key = ch.toUpperCase();
                return iconMap[key] ? loadImage(iconMap[key]) : null;
            }).filter(Boolean);

            const icons = await Promise.all(iconPromises);
            let currentY = startY;

            for (const iconImg of icons) {
                ctx.drawImage(iconImg, iconX, currentY, iconSize, iconSize);
                currentY += iconSize + iconSpacing;
            }
        }

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
            const maxFieldsHeight = maxHeight * 0.455;
            const textPosition = maxHeight * 0.54;
            const marginOrderWidth = maxHeight * 0.1;

            let interline = maxHeight * 0.0077;
            let fontSize = maxHeight * 0.03;

            const picture = new Image();
            picture.src = data.picture;

            const finishDraw = () => {
                ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

                ctx.font = `${titleFontSize}px Headline`;
                ctx.textAlign = 'center';
                ctx.fillText(data.title || '', maxWidth * 0.5, maxHeight * 0.2325);

                if (data.hasText) {
                    drawStyledWrappedText(
                        ctx,
                        replaceForbiddenStarsElements(data.general || ''),
                        maxWidth * 0.5,
                        textPosition,
                        maxWidth - 2 * marginOrderWidth,
                        interline,
                        fontSize,
                        'center'
                    );
                }

                resolve();
            };

            if (!data.hasText) {
                picture.onload = finishDraw;
                picture.onerror = () => reject(new Error('Failed to load order card image'));
                return;
            }

            let generalTextHeight = 0;
            const generalText = replaceForbiddenStarsElements(data.general || '');

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

            picture.onload = finishDraw;
            picture.onerror = () => reject(new Error('Failed to load order card image'));
        });
    }

    function drawEventCard(data, ctx) {
        return new Promise((resolve, reject) => {
            const maxFieldsHeight = maxHeight * 0.278;
            const textPosition = maxHeight * 0.685;

            let interline = maxHeight * 0.0077;
            let fontSize = maxHeight * 0.03;

            const picture = new Image();
            picture.src = data.picture;

            const finishDraw = () => {
                ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

                ctx.font = `bold ${titleFontSize * 0.8}px EventFont`;
                ctx.textAlign = 'center';
                ctx.fillText(data.type || '', maxWidth * 0.5, maxHeight * 0.573);

                ctx.font = `${titleFontSize}px Headline`;
                ctx.textAlign = 'left';
                ctx.fillText(data.title || '', maxWidth * 0.05, maxHeight * 0.0735);

                if (data.hasText) {
                    drawStyledWrappedText(
                        ctx,
                        replaceForbiddenStarsElements(data.general || ''),
                        marginWidth,
                        textPosition,
                        maxWidth - 2 * marginWidth,
                        interline,
                        fontSize,
                        'left'
                    );
                }

                resolve();
            };

            if (!data.hasText) {
                picture.onload = finishDraw;
                picture.onerror = () => reject(new Error('Failed to load event card image'));
                return;
            }

            let generalTextHeight = 0;
            const generalText = replaceForbiddenStarsElements(data.general || '');

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

            picture.onload = finishDraw;
            picture.onerror = () => reject(new Error('Failed to load event card image'));
        });
    }

    /* =========================
       CARD BUILDERS
    ========================= */

    function createCombatContent(container, expansionFolder, factionFolder, files, textData) {
        const sections = {
            's-section': withArray(files?.[0]),
            't1-section': withArray(files?.[1]),
            't2-section': withArray(files?.[2]),
            't3-section': withArray(files?.[3])
        };

        const combatText = textData
            ? {
                's-section': withArray(textData?.[0]),
                't1-section': withArray(textData?.[1]),
                't2-section': withArray(textData?.[2]),
                't3-section': withArray(textData?.[3])
            }
            : false;

        Object.keys(sections).forEach((section) => {
            const sectionContainer = document.createElement('div');
            sectionContainer.classList.add('grid', 'combat', section);

            sections[section].forEach((file, idx) => {
                const placeholder = createPlaceholderWithSpinner();
                sectionContainer.appendChild(placeholder);

                const jsonData = {
                    picture: `factions/${expansionFolder}/${factionFolder}/combat/${file}`,
                    hasText: !!combatText,
                    title: combatText ? (combatText[section][idx]?.title || '') : '',
                    background: combatText ? (combatText[section][idx]?.general || '') : '',
                    foreground: combatText ? (combatText[section][idx]?.unit || '') : '',
                    icons: combatText ? (combatText[section][idx]?.icons || '') : ''
                };

                const canvas = document.createElement('canvas');
                canvas.width = maxWidth;
                canvas.height = maxHeight;
                const context = canvas.getContext('2d');

                drawCombatCard(jsonData, context)
                    .then(() => {
                        placeholder.replaceWith(canvas);
                    })
                    .catch((err) => {
                        console.error('Error drawing combat card:', err);
                        placeholder.innerHTML = '<span style="color:red;">Ошибка загрузки карты</span>';
                    });
            });

            container.appendChild(sectionContainer);
        });
    }

    function createOrdersContent(container, expansionFolder, factionFolder, files, textData) {
        const categoryContainer = document.createElement('div');
        categoryContainer.classList.add('grid', 'orders');

        withArray(files).forEach((file, idx) => {
            const placeholder = createPlaceholderWithSpinner();
            categoryContainer.appendChild(placeholder);

            const jsonData = {
                picture: `factions/${expansionFolder}/${factionFolder}/orders/${file}`,
                hasText: !!textData,
                title: textData ? (textData[idx]?.title || '') : '',
                general: textData ? (textData[idx]?.general || '') : ''
            };

            const canvas = document.createElement('canvas');
            canvas.width = maxWidth;
            canvas.height = maxHeight;
            const context = canvas.getContext('2d');

            drawOrderCard(jsonData, context)
                .then(() => {
                    placeholder.replaceWith(canvas);
                })
                .catch((err) => {
                    console.error('Error drawing order card:', err);
                    placeholder.innerHTML = '<span style="color:red;">Ошибка загрузки карты</span>';
                });
        });

        container.appendChild(categoryContainer);
    }

    function createEventContent(container, expansionFolder, factionFolder, files, textData) {
        const categoryContainer = document.createElement('div');
        categoryContainer.classList.add('grid', 'events');

        withArray(files).forEach((file, idx) => {
            const placeholder = createPlaceholderWithSpinner();
            categoryContainer.appendChild(placeholder);

            const jsonData = {
                picture: `factions/${expansionFolder}/${factionFolder}/events/${file}`,
                hasText: !!textData,
                title: textData ? (textData[idx]?.title || '') : '',
                general: textData ? (textData[idx]?.general || '') : '',
                type: textData ? (textData[idx]?.type || '') : ''
            };

            const canvas = document.createElement('canvas');
            canvas.width = maxWidth;
            canvas.height = maxHeight;
            const context = canvas.getContext('2d');

            drawEventCard(jsonData, context)
                .then(() => {
                    placeholder.replaceWith(canvas);
                })
                .catch((err) => {
                    console.error('Error drawing event card:', err);
                    placeholder.innerHTML = '<span style="color:red;">Ошибка загрузки карты</span>';
                });
        });

        container.appendChild(categoryContainer);
    }

    function imageLoaderUniversal(files, maxW, maxH, pathToImage, container, categoryContainer) {
        withArray(files).forEach((file) => {
            const placeholder = createPlaceholderWithSpinner();
            categoryContainer.appendChild(placeholder);

            const img = document.createElement('img');
            img.src = `${pathToImage}${file}`;
            if (maxW) img.width = maxW;
            if (maxH) img.height = maxH;

            img.onload = () => {
                placeholder.replaceWith(img);
            };

            img.onerror = () => {
                placeholder.innerHTML = '<span style="color:red;">Ошибка загрузки изображения</span>';
            };
        });

        container.appendChild(categoryContainer);
    }

    function createFactioncardContent(container, expansionFolder, factionFolder, files) {
        const categoryContainer = document.createElement('div');
        categoryContainer.classList.add('grid', 'factionCardImage');

        imageLoaderUniversal(
            files,
            maxWidth * 3,
            false,
            `factions/${expansionFolder}/${factionFolder}/faction_card/`,
            container,
            categoryContainer
        );
    }

    function backCardContent(container, expansionFolder, factionFolder, files) {
        const categoryContainer = document.createElement('div');
        categoryContainer.classList.add('grid', 'cardBackImages');

        imageLoaderUniversal(
            files,
            maxWidth,
            maxHeight,
            `factions/${expansionFolder}/${factionFolder}/backs/`,
            container,
            categoryContainer
        );
    }

    function mapCardContent(container, expansionFolder, factionFolder, files) {
        const categoryContainer = document.createElement('div');
        categoryContainer.classList.add('grid', 'mapImages');

        imageLoaderUniversal(
            files,
            maxWidth * 2,
            false,
            `factions/${expansionFolder}/${factionFolder}/maps/`,
            container,
            categoryContainer
        );
    }

    /* =========================
       UI RENDERING
    ========================= */

    function renderCardTypeTabs(cardTypes) {
        cardTypeTabs.innerHTML = '';

        cardTypes.forEach((type, i) => {
            const tab = document.createElement('div');
            tab.className = `card-header${i === 0 ? ' active' : ''}`;
            tab.textContent = CARD_TYPE_LABELS_RU[type] ?? type;
            tab.dataset.cardType = type;
            cardTypeTabs.appendChild(tab);

            if (i === 0) {
                activeCardTab = tab;
            }
        });

        state.cardType = cardTypes[0] ?? null;
    }

    async function loadCards(expansionFolder, factionFolder, cardTypeReference) {
        if (!generalData) {
            return;
        }

        cardsContainer.innerHTML = '';

        const subTabContents = document.createElement('div');
        subTabContents.classList.add('card-contents');
        subTabContents.id = `cards-${expansionFolder}-${factionFolder}-${cardTypeReference}`;
        cardsContainer.appendChild(subTabContents);

        const textPath = `factions/${expansionFolder}/${factionFolder}/text.json`;

        try {
            const textData = await fetchJsonCached(textPath);

            const cardsFilenameCombatList = textData?.filenames?.combat ?? generalData?.filenames?.combat ?? [];
            const cardsFilenameOrderList = textData?.filenames?.orders ?? generalData?.filenames?.orders ?? [];
            const cardsFilenameEventList = textData?.filenames?.events ?? generalData?.filenames?.events ?? [];
            const cardsFilenameFactioncardList = textData?.filenames?.faction_card ?? generalData?.filenames?.faction_card ?? [];
            const cardsFilenameBacksList = textData?.filenames?.backs ?? generalData?.filenames?.backs ?? [];
            const cardsFilenameMapList = textData?.filenames?.map ?? generalData?.filenames?.map ?? [];

            const cardsOrdersText = textData?.ordersText ?? false;
            const cardsEventsText = textData?.eventsText ?? false;
            const cardsCombatText = textData?.combatText ?? false;

            if (cardTypeReference === 'combat') {
                createCombatContent(subTabContents, expansionFolder, factionFolder, cardsFilenameCombatList, cardsCombatText);
            } else if (cardTypeReference === 'orders') {
                createOrdersContent(subTabContents, expansionFolder, factionFolder, cardsFilenameOrderList, cardsOrdersText);
            } else if (cardTypeReference === 'events') {
                createEventContent(subTabContents, expansionFolder, factionFolder, cardsFilenameEventList, cardsEventsText);
            } else if (cardTypeReference === 'faction_card') {
                createFactioncardContent(subTabContents, expansionFolder, factionFolder, cardsFilenameFactioncardList);
            } else if (cardTypeReference === 'backs') {
                backCardContent(subTabContents, expansionFolder, factionFolder, cardsFilenameBacksList);
            } else if (cardTypeReference === 'map') {
                mapCardContent(subTabContents, expansionFolder, factionFolder, cardsFilenameMapList);
            }
        } catch (error) {
            console.error('Ошибка загрузки text.json:', error);
        }
    }

    function loadCardsMenu(expansionFolder, factionFolder) {
        if (!generalData) {
            return;
        }

        const cardsDefaultName = generalData.cardsDefault.name;
        const cardsDefaultReference = generalData.cardsDefault.reference;

        cardTypeTabs.innerHTML = '';

        cardsDefaultReference.forEach((reference, referenceIndex) => {
            const cardTabHeader = document.createElement('div');
            cardTabHeader.textContent = cardsDefaultName[referenceIndex] ?? CARD_TYPE_LABELS_RU[reference] ?? reference;
            cardTabHeader.classList.add('card-header');
            cardTabHeader.dataset.faction = factionFolder;
            cardTabHeader.dataset.expansion = expansionFolder;
            cardTabHeader.dataset.cardType = reference;

            if (referenceIndex === 0) {
                cardTabHeader.classList.add('active');
                activeCardTab = cardTabHeader;
            }

            cardTypeTabs.appendChild(cardTabHeader);
        });

        state.cardType = cardsDefaultReference[0] ?? null;

        if (state.cardType) {
            loadCards(expansionFolder, factionFolder, state.cardType);
        }
    }

    function loadFactions(expansionFolder) {
        state.expansionKey = expansionFolder;
        factionTabsContainer.innerHTML = '';

        const factionPath = `factions/${expansionFolder}/faction.json`;

        fetchJsonCached(factionPath)
            .then((expansionData) => {
                const factionFolderList = expansionData.folder;
                const factionNameList = expansionData.name;

                factionFolderList.forEach((factionFolder, factionFolderIndex) => {
                    const factionTabHeader = document.createElement('div');
                    factionTabHeader.textContent = factionNameList[factionFolderIndex];
                    factionTabHeader.classList.add('faction-header');
                    factionTabHeader.dataset.faction = factionFolder;
                    factionTabHeader.dataset.expansion = expansionFolder;

                    if (factionFolderIndex === 0) {
                        factionTabHeader.classList.add('active');
                        activeFactionTab = factionTabHeader;
                    }

                    factionTabsContainer.appendChild(factionTabHeader);
                });

                state.factionKey = factionFolderList[0] ?? null;

                if (state.factionKey) {
                    loadCardsMenu(expansionFolder, state.factionKey);
                }
            })
            .catch((error) => console.error('Ошибка загрузки faction.json:', error));
    }

    function showCardsView() {
        if (factionTabsContainer) factionTabsContainer.style.display = '';
        if (cardTypeTabs) cardTypeTabs.style.display = '';
        if (cardsContainer) cardsContainer.style.display = '';
        if (faqContainer) faqContainer.classList.remove('active');
    }

    function showFaqView() {
        if (factionTabsContainer) factionTabsContainer.style.display = 'none';
        if (cardTypeTabs) cardTypeTabs.style.display = 'none';
        if (cardsContainer) cardsContainer.style.display = 'none';
        if (faqContainer) faqContainer.classList.add('active');
        loadFaq().catch(() => { });
    }

    /* =========================
       EVENT DELEGATION
    ========================= */

    expansionTabsContainer.addEventListener('click', (e) => {
        const tab = e.target.closest('.expansion-header');
        if (!tab) return;

        const isFaqTab = tab.dataset.special === 'faq';
        const buttonExp = tab.dataset.expansion;

        if (activeExpansionTab) {
            activeExpansionTab.classList.remove('active');
        }
        tab.classList.add('active');
        activeExpansionTab = tab;

        if (isFaqTab) {
            showFaqView();
        } else {
            showCardsView();
            loadFactions(buttonExp);
        }
    });

    factionTabsContainer.addEventListener('click', (e) => {
        const tab = e.target.closest('.faction-header');
        if (!tab) return;

        if (activeFactionTab) {
            activeFactionTab.classList.remove('active');
        }
        tab.classList.add('active');
        activeFactionTab = tab;

        state.expansionKey = tab.dataset.expansion;
        state.factionKey = tab.dataset.faction;

        loadCardsMenu(state.expansionKey, state.factionKey);
    });

    cardTypeTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.card-header');
        if (!tab) return;

        if (activeCardTab) {
            activeCardTab.classList.remove('active');
        }
        tab.classList.add('active');
        activeCardTab = tab;

        state.cardType = tab.dataset.cardType;

        if (state.expansionKey && state.factionKey && state.cardType) {
            loadCards(state.expansionKey, state.factionKey, state.cardType);
        }
    });

    /* =========================
       INIT
    ========================= */

    try {
        generalData = await fetchJsonCached('factions/general.json');

        const expansionFolderList = generalData.expansion.folder;
        const expansionNameList = generalData.expansion.name;

        expansionTabsContainer.innerHTML = '';

        expansionFolderList.forEach((key, i) => {
            const el = document.createElement('div');
            el.className = `expansion-header${i === 0 ? ' active' : ''}`;
            el.textContent = expansionNameList[i];
            el.dataset.expansion = key;
            expansionTabsContainer.appendChild(el);

            if (i === 0) {
                activeExpansionTab = el;
            }
        });

        const faqTabHeader = document.createElement('div');
        faqTabHeader.textContent = 'FAQ';
        faqTabHeader.classList.add('expansion-header');
        faqTabHeader.dataset.expansion = 'faq';
        faqTabHeader.dataset.special = 'faq';
        expansionTabsContainer.appendChild(faqTabHeader);

        state.expansionKey = expansionFolderList[0] ?? null;

        showCardsView();
        if (state.expansionKey) {
            loadFactions(state.expansionKey);
        }
    } catch (error) {
        console.error('Ошибка загрузки general.json:', error);
    }
});