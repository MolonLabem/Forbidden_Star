document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('loading-spinner').style.display = 'block';
    const expansionTabsContainer = document.getElementById('expansion-tabs');
    const factionTabsContainer = document.getElementById('faction-tabs');
    const cardsContentsContainer = document.getElementById('cards-tabs');
    const cardsContainer = document.getElementById('cards-container');

    // ---- CARD SIZING ----
    const maxWidth = 635;
    const maxHeight = 880;

    // Size of boxes for combat cards.
    const textBackgroundSize = 759;
    const textBottomBarHeight = 18;
    const textBottomBarWidth = 454;

    const titleFontSize = maxHeight * 0.05;
    const marginWidth = maxWidth * 0.0578;
    const maxTextWidth = maxWidth - 2 * marginWidth;

    // ---- TYPE NORMALIZATION (RU only) ----
    const TYPE_MAP = { "SCHEME": "ПЛАН", "TACTIC": "ТАКТИКА", "ПЛАН": "ПЛАН", "ТАКТИКА": "ТАКТИКА" };
    function normEventType(t) { if (!t) return ""; const k = String(t).trim().toUpperCase(); return TYPE_MAP[k] ?? k; }

    // ---- TOKENS (single-pass replacement) ----
    const FB_TOKEN_RE = /\([BS]\)|\[[BSMD]\]/g;
    function replaceForbiddenStarsElements(str = "") {
        return str.replace(FB_TOKEN_RE, (m) => {
            switch (m) {
                case "[B]": return "}"; // Bolter cube
                case "[S]": return "{"; // Shield cube
                case "[M]": return "<"; // Aquila cube
                case "[D]": return "|"; // Faith/Dice cube
                case "(B)": return "#"; // temp Bolter (black circle)
                case "(S)": return "@"; // temp Shield (black circle)
                default: return m;
            }
        });
    }

    // ---- STATE ----
    let dataCache = null;

    // ---- LOAD MENU ROOT ----
    fetch('factions/file_names.json')
        .then(r => r.json())
        .then(data => {
            dataCache = data;
            buildExpansionTabs();
            const firstExp = data.expansion.folder[0];
            loadFactions(firstExp);
        })
        .catch(err => console.error('Error loading file_names.json:', err))
        .finally(() => {
            document.getElementById('loading-spinner').style.display = 'none';
        });

    // ---- BUILDERS ----
    function buildExpansionTabs() {
        const { expansion } = dataCache;
        expansionTabsContainer.innerHTML = '';
        expansion.folder.forEach((expansionType, i) => {
            const el = document.createElement('div');
            el.textContent = expansion.name[i];
            el.classList.add('expansion-header');
            el.dataset.expansion = expansionType;
            if (i === 0) el.classList.add('active');
            expansionTabsContainer.appendChild(el);
        });

        expansionTabsContainer.onclick = (e) => {
            const target = e.target.closest('.expansion-header');
            if (!target) return;
            document.querySelectorAll('.expansion-header').forEach(h => h.classList.remove('active'));
            target.classList.add('active');
            loadFactions(target.dataset.expansion);
        };
    }

    function loadFactions(expansionSet) {
        const { faction, cards } = dataCache;
        factionTabsContainer.innerHTML = '';

        const factionsInExpansion = faction[expansionSet].folder;
        const factionNamesInExpansion = faction[expansionSet].name;

        factionsInExpansion.forEach((factionType, i) => {
            const el = document.createElement('div');
            el.textContent = factionNamesInExpansion[i];
            el.classList.add('faction-header');
            el.dataset.faction = factionType;
            el.dataset.expansion = expansionSet;
            if (i === 0) el.classList.add('active');
            factionTabsContainer.appendChild(el);
        });

        factionTabsContainer.onclick = (e) => {
            const target = e.target.closest('.faction-header');
            if (!target) return;
            document.querySelectorAll('.faction-header').forEach(h => h.classList.remove('active'));
            target.classList.add('active');
            loadCardsMenu(target.dataset.expansion, target.dataset.faction);
        };

        // автозагрузка первой фракции
        loadCardsMenu(expansionSet, factionsInExpansion[0]);

        // вкладки типов карт
        cardsContentsContainer.innerHTML = '';
        Object.keys(cards).forEach((cardType, i) => {
            const el = document.createElement('div');
            el.textContent = cardType;
            el.classList.add('card-header');
            el.dataset.cardType = cardType;
            el.dataset.expansion = expansionSet;
            el.dataset.faction = factionsInExpansion[0];
            if (i === 0) el.classList.add('active');
            cardsContentsContainer.appendChild(el);
        });

        cardsContentsContainer.onclick = (e) => {
            const target = e.target.closest('.card-header');
            if (!target) return;
            document.querySelectorAll('.card-header').forEach(h => h.classList.remove('active'));
            target.classList.add('active');
            loadCards(target.dataset.expansion, target.dataset.faction, target.dataset.cardType);
        };
    }

    function loadCardsMenu(expansionSet, factionSet) {
        const { cards } = dataCache;
        document.getElementById('loading-spinner').style.display = 'block';

        document.querySelectorAll('.card-header').forEach(h => {
            h.dataset.expansion = expansionSet;
            h.dataset.faction = factionSet;
        });

        loadCards(expansionSet, factionSet, Object.keys(cards)[0]);

        document.getElementById('loading-spinner').style.display = 'none';
    }

    function loadCards(expansionFolder, factionFolder, cardType) {
        const { cards } = dataCache;
        cardsContainer.innerHTML = '';

        const subTab = document.createElement('div');
        subTab.classList.add('card-contents');
        subTab.id = `cards-${expansionFolder}-${factionFolder}-${cardType}`;
        cardsContainer.appendChild(subTab);

        fetch(`factions/${expansionFolder}/${factionFolder}/text.json`)
            .then(r => r.json())
            .then(textData => {
                if (cardType === Object.keys(cards)[0]) {
                    createCombatContent(subTab, expansionFolder, factionFolder, cards[cardType], textData.combatText);
                } else if (cardType === Object.keys(cards)[1]) {
                    createOrdersContent(subTab, expansionFolder, factionFolder, cards[cardType], textData.ordersText);
                } else if (cardType === Object.keys(cards)[2]) {
                    createEventContent(subTab, expansionFolder, factionFolder, cards[cardType], textData.eventsText);
                } else if (cardType === Object.keys(cards)[3]) {
                    createFactioncardContent(subTab, expansionFolder, factionFolder, cards[cardType]);
                } else if (cardType === Object.keys(cards)[4]) {
                    backCardContent(subTab, expansionFolder, factionFolder, cards[cardType]);
                }
            })
            .catch(err => console.error(`Error loading text data for ${factionFolder} in ${expansionFolder}:`, err));
    }

    // ---- CONTENT BUILDERS ----
    function createCombatContent(container, expansionFolder, factionfolder, files, textData) {
        const sections = {
            's-section': files.slice(0, 5),
            't1-section': files.slice(5, 9),
            't2-section': files.slice(9, 12),
            't3-section': files.slice(12, 14)
        };
        const combatText = {
            's-section': textData.slice(0, 5),
            't1-section': textData.slice(5, 9),
            't2-section': textData.slice(9, 12),
            't3-section': textData.slice(12, 14)
        };

        Object.keys(sections).forEach(section => {
            const sectionContainer = document.createElement('div');
            sectionContainer.classList.add('grid', 'combat', section);

            sections[section].forEach((file, idx) => {
                const jsonData = {
                    picture: `factions/${expansionFolder}/${factionfolder}/combat/${file}`,
                    title: (combatText[section][idx].title || ""),
                    background: (combatText[section][idx].general || ""),
                    foreground: (combatText[section][idx].unit || "")
                };
                const canvas = document.createElement('canvas');
                canvas.width = maxWidth;
                canvas.height = maxHeight;
                const context = canvas.getContext('2d');
                sectionContainer.appendChild(canvas);
                drawCombatCard(jsonData, context);
            });

            container.appendChild(sectionContainer);
        });
    }

    function createOrdersContent(container, expansionFolder, factionfolder, files, textData) {
        const categoryContainer = document.createElement('div');
        categoryContainer.classList.add('grid', 'orders');
        files.forEach((file, idx) => {
            const jsonData = {
                picture: `factions/${expansionFolder}/${factionfolder}/orders/${file}`,
                title: (textData[idx].title || ""),
                general: (textData[idx].general || "")
            };
            const canvas = document.createElement('canvas');
            canvas.width = maxWidth;
            canvas.height = maxHeight;
            const ctx = canvas.getContext('2d');
            categoryContainer.appendChild(canvas);
            drawOrderCard(jsonData, ctx);
        });
        container.appendChild(categoryContainer);
    }

    function createEventContent(container, expansionFolder, factionfolder, files, textData) {
        const categoryContainer = document.createElement('div');
        categoryContainer.classList.add('grid', 'events');
        files.forEach((file, idx) => {
            const jsonData = {
                picture: `factions/${expansionFolder}/${factionfolder}/events/${file}`,
                title: (textData[idx].title || ""),
                general: (textData[idx].general || ""),
                type: normEventType(textData[idx].type || "")
            };
            const canvas = document.createElement('canvas');
            canvas.width = maxWidth;
            canvas.height = maxHeight;
            const ctx = canvas.getContext('2d');
            categoryContainer.appendChild(canvas);
            drawEventCard(jsonData, ctx);
        });
        container.appendChild(categoryContainer);
    }

    function createFactioncardContent(container, expansionFolder, factionfolder, files) {
        const categoryContainer = document.createElement('div');
        categoryContainer.classList.add('factionCard');
        files.forEach((file) => {
            const img = document.createElement('img');
            img.src = `factions/${expansionFolder}/${factionfolder}/faction_card/${file}`;
            categoryContainer.appendChild(img);
        });
        container.appendChild(categoryContainer);
    }

    function backCardContent(container, expansionFolder, factionfolder, files) {
        const categoryContainer = document.createElement('div');
        categoryContainer.classList.add('grid', 'cardBack');
        files.forEach((file) => {
            const img = document.createElement('img');
            img.src = `factions/${expansionFolder}/${factionfolder}/backs/${file}`;
            img.width = maxWidth;
            img.height = maxHeight;
            categoryContainer.appendChild(img);
        });
        container.appendChild(categoryContainer);
    }

    // ---- CANVAS UTILS ----
    function calculateTextHeight(context, text, extraHeight, marginHeight, interline, fontSize) {
        context.font = `${fontSize}px ForbiddenStars`;
        const words = (text || "").split(' ');
        let line = '';
        let lineHeight = Math.trunc(fontSize);
        let returnHeight = 0;
        for (let n = 0; n < words.length; n++) {
            if (words[n] === "*newline*") {
                returnHeight += lineHeight + interline; line = '';
            } else if (words[n] === "*newpara*") {
                returnHeight += 2 * lineHeight; line = '';
            } else {
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

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load image: ' + url));
            img.src = url;
        });
    }

    // ---- DRAWERS ----
    async function drawCombatCard(data, ctx) {
        const bottomImageheight = maxHeight * 0.025;
        const maxFieldsHeight = maxHeight * 0.4;
        const extraForegroundTriangle = maxHeight * 0.0455;
        const extraBackgroundborder = maxHeight * 0.0385;

        let interline = maxHeight * 0.0077;
        let marginHeight = maxWidth * 0.05;
        let fontSize = maxHeight * 0.03;

        const picture = await loadImage(data.picture);
        const background = await loadImage('pictures/background.png');
        const foreground = await loadImage('pictures/foreground.png');
        const bottomImage = await loadImage('pictures/bottom.png');

        const backgroundText = replaceForbiddenStarsElements(data.background || "");
        const foregroundText = replaceForbiddenStarsElements(data.foreground || "");

        let backgroundTextHeight = 0, foregroundTextHeight = 0;
        const recalcHeights = () => {
            backgroundTextHeight = backgroundText.length
                ? calculateTextHeight(ctx, backgroundText, extraBackgroundborder, marginHeight, interline, fontSize)
                : 0;
            foregroundTextHeight = foregroundText.length
                ? calculateTextHeight(ctx, foregroundText, extraForegroundTriangle, marginHeight, interline, fontSize)
                : 0;
        };
        recalcHeights();

        const shrink = () => {
            marginHeight *= 0.8;
            fontSize *= 0.99;
            interline *= 0.95;
            recalcHeights();
        };

        if (backgroundText && foregroundText) {
            while ((backgroundTextHeight + foregroundTextHeight) > maxFieldsHeight) shrink();
        } else {
            while (Math.max(backgroundTextHeight, foregroundTextHeight) > maxFieldsHeight) shrink();
        }

        // простая обрезка БЕЗ сдвигов (откат фиксов белого зазора)
        function drawImageCropped(img, height) {
            ctx.drawImage(img, 0, 0, textBackgroundSize, maxHeight - height, 0, height, maxWidth, maxHeight - height);
        }

        // эвристика: определяем, надо ли курсив до двоеточия в текущем сегменте
        const UNIT_KEYWORDS = [
            "Сестра", "Крейсер", "Лёгкий", "Легкий", "Экзорцист", "Гранд-Крейсер",
            "Валкирия", "Корабль", "Чёрный", "Рыцарь", "Немезиды",
            "Опустошитель", "Солнце", "Гаснушее", "Скитарий", "Катафрон",
            "Онагр", "Ковчег", "Механикус", "Титан", "Кабалит", "Ведьма",
            "Бастион", "Живой"
        ];
        function segmentShouldItalicize(preColon) {
            const text = preColon.replace(/[«»"(),.!?;]+/g, ' ').trim();
            if (!text) return false;
            if (text.includes('/')) return true;
            return UNIT_KEYWORDS.some(k => text.includes(k));
        }

        // рендер с курсивом до первого ":" в каждом сегменте; "-или-" всегда курсив
        function drawRichText(text, yPosition, extra) {
            ctx.textAlign = "left";
            let lineHeight = Math.trunc(fontSize);
            let y = yPosition + marginHeight + extra + lineHeight;
            let x = marginWidth;
            const maxLine = maxWidth - 2 * marginWidth;

            const rawWords = (text || "").split(' ');
            let i = 0;
            let inSegment = true;
            let italicActive = false;
            let decidedForSegment = false; // решили ли, надо ли курсив в сегменте

            while (i < rawWords.length) {
                const w = rawWords[i];

                // контрольные токены -> сброс сегмента
                if (w === "*newline*" || w === "*newpara*") {
                    x = marginWidth;
                    y += (w === "*newline*") ? (lineHeight + interline) : (2 * lineHeight);
                    inSegment = true;
                    italicActive = false;
                    decidedForSegment = false;
                    i++;
                    continue;
                }

                // в начале сегмента — заглядываем до двоеточия
                if (inSegment && !decidedForSegment) {
                    let j = i, pre = "", foundColon = false;
                    while (j < rawWords.length) {
                        const ww = rawWords[j];
                        if (ww === "*newline*" || ww === "*newpara*") break;
                        pre += (pre ? " " : "") + ww;
                        if (ww.includes(':')) { foundColon = true; break; }
                        j++;
                    }
                    italicActive = foundColon ? segmentShouldItalicize(pre) : false;
                    decidedForSegment = true;
                }

                // спец-слово «-или-» курсивом
                const isIli = (w === "-или-" || w === "—или—" || w === "–или–");

                const token = w + (i < rawWords.length - 1 ? " " : "");
                const metrics = ctx.measureText(token);
                if (x + metrics.width > marginWidth + maxLine) {
                    x = marginWidth;
                    y += lineHeight + interline;
                }

                ctx.font = ((italicActive || isIli) ? `italic ${fontSize}px ForbiddenStars` : `${fontSize}px ForbiddenStars`);
                ctx.fillText(token, x, y);
                x += ctx.measureText(token).width;

                // если встретили двоеточие — заканчиваем курсив до конца сегмента
                if (italicActive && w.includes(':')) {
                    italicActive = false;
                }

                // мы уже внутри сегмента
                inSegment = false;
                i++;
            }
        }

        // картинка
        ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

        // заголовок
        ctx.font = `${titleFontSize}px HeadlinerNo45`;
        ctx.textAlign = "left";
        ctx.fillText(data.title || "", maxWidth * 0.27, maxHeight * 0.077);

        // верхний (general)
        if (backgroundText.length > 0) {
            const backgroundY = maxHeight - (backgroundTextHeight + foregroundTextHeight);
            drawImageCropped(background, backgroundY);
            drawRichText(backgroundText, backgroundY, extraBackgroundborder);
        }

        // нижний (unit)
        if (foregroundText.length > 0) {
            const foregroundY = maxHeight - (foregroundTextHeight + extraForegroundTriangle * 0.35);
            drawImageCropped(foreground, foregroundY);
            drawRichText(foregroundText, foregroundY, extraForegroundTriangle);
        }

        // нижняя планка
        ctx.drawImage(
            bottomImage,
            0, 0, textBottomBarWidth, textBottomBarHeight,
            0, maxHeight - bottomImageheight, maxWidth, bottomImageheight
        );
    }

    function drawOrderCard(data, ctx) {
        const maxFieldsHeight = maxHeight * 0.455;
        const textPosition = maxHeight * 0.54;
        const marginOrderWidth = maxHeight * 0.1;

        let interline = maxHeight * 0.0077;
        let fontSize = maxHeight * 0.03;

        const picture = new Image();
        picture.src = data.picture;

        const generalText = replaceForbiddenStarsElements(data.general || "");

        const recalcHeight = () => calculateTextHeight(ctx, generalText, 0, marginOrderWidth, interline, fontSize);
        let generalTextHeight = recalcHeight();
        while (generalTextHeight > maxFieldsHeight) {
            fontSize *= 0.95; interline *= 0.97;
            generalTextHeight = recalcHeight();
        }

        function drawText(text, yPosition) {
            ctx.font = `${fontSize}px ForbiddenStars`;
            ctx.textAlign = "center";
            const words = (text || "").split(' ');
            let line = '';
            let lineHeight = Math.trunc(fontSize);
            yPosition += lineHeight;
            for (let n = 0; n < words.length; n++) {
                if (words[n] === "*newline*") {
                    ctx.fillText(line, maxWidth * 0.5, yPosition);
                    yPosition += lineHeight + interline; line = '';
                } else if (words[n] === "*newpara*") {
                    ctx.fillText(line, maxWidth * 0.5, yPosition);
                    yPosition += 2 * lineHeight; line = '';
                } else {
                    const testLine = line + words[n] + ' ';
                    const metrics = ctx.measureText(testLine);
                    if (metrics.width > maxWidth - 2 * marginOrderWidth && n > 0) {
                        ctx.fillText(line, maxWidth * 0.5, yPosition);
                        yPosition += lineHeight + interline; line = words[n] + ' ';
                    } else {
                        line = testLine;
                    }
                }
            }
            ctx.fillText(line, maxWidth * 0.5, yPosition);
        }

        picture.onload = function () {
            ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);
            ctx.font = `${titleFontSize}px HeadlinerNo45`;
            ctx.textAlign = "center";
            ctx.fillText(data.title || "", maxWidth * 0.5, maxHeight * 0.2325);
            drawText(generalText, textPosition);
        };
    }

    function drawEventCard(data, ctx) {
        const maxFieldsHeight = maxHeight * 0.278;
        const textPosition = maxHeight * 0.685;

        let interline = maxHeight * 0.0077;
        let fontSize = maxHeight * 0.03;

        const picture = new Image();
        picture.src = data.picture;
        const generalText = replaceForbiddenStarsElements(data.general || "");

        const recalcHeight = () => calculateTextHeight(ctx, generalText, 20, 0, interline, fontSize);
        let generalTextHeight = recalcHeight();
        while (generalTextHeight > maxFieldsHeight) {
            fontSize *= 0.95; interline *= 0.97;
            generalTextHeight = recalcHeight();
        }

        function drawText(text, yPosition) {
            ctx.font = `${fontSize}px ForbiddenStars`;
            ctx.textAlign = "left";
            const words = (text || "").split(' ');
            let line = '';
            let lineHeight = Math.trunc(fontSize);
            yPosition += lineHeight;
            for (let n = 0; n < words.length; n++) {
                if (words[n] === "*newline*") {
                    ctx.fillText(line, marginWidth, yPosition);
                    yPosition += lineHeight + interline; line = '';
                } else if (words[n] === "*newpara*") {
                    ctx.fillText(line, marginWidth, yPosition);
                    yPosition += 2 * lineHeight; line = '';
                } else {
                    const testLine = line + words[n] + ' ';
                    const metrics = ctx.measureText(testLine);
                    if (metrics.width > maxWidth - 2 * marginWidth && n > 0) {
                        ctx.fillText(line, marginWidth, yPosition);
                        yPosition += lineHeight + interline; line = words[n] + ' ';
                    } else {
                        line = testLine;
                    }
                }
            }
            ctx.fillText(line, marginWidth, yPosition);
        }

        picture.onload = function () {
            ctx.drawImage(picture, 0, 0, maxWidth, maxHeight);

            // Тип — делаем жирным стандартный FrizQuadrataStd (без отдельного bold-файла)
            ctx.textAlign = "center";
            ctx.font = `bold ${titleFontSize * 0.85}px FrizQuadrataStd`;
            ctx.fillText(normEventType(data.type || ""), maxWidth * 0.5, maxHeight * 0.573);

            // Заголовок события
            ctx.textAlign = "left";
            ctx.font = `${titleFontSize}px HeadlinerNo45`;
            ctx.fillText(data.title || "", maxWidth * 0.05, maxHeight * 0.0735);

            drawText(generalText, textPosition);
        };
    }
});
