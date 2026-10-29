# Forbidden Stars — карты и FAQ на русском

Русский справочник по Forbidden Stars и фанатским дополнениям: карты, составы фракций и ответы на вопросы о правилах.

Названия игровых материалов и представлений карт описаны в [глоссарии](GLOSSARY.md).

**[Открыть справочник](https://molonlabem.github.io/Forbidden_Star/page/)**

## Что есть на сайте

- База, Galaxy in Flames (Forgotten Worlds в версии Тролля), Symphony of War (Forsaken Voids в версии Тролля) и The Dying Light.
- Три версии карт: «Классический», «Обновлённый» и RNB. Можно сравнить оформление и изменения правил.
- Поиск по названиям и тексту карт: внутри выбранной фракции или «Везде», с фрагментом найденного эффекта.
- Общие вопросы по правилам и вопросы выбранной фракции, переходы от карты к её разъяснению и ссылки на источники.
- Увеличение карт и листов фракций, просмотр на телефоне и прямые ссылки на отдельные карты.
- Выбор карт для двусторонней печати: PDF с рубашками и метками реза, бумага A4 или Letter.

По умолчанию открыт «Обновлённый» — карты с заново набранным русским текстом и игровыми символами. «Классический» показывает исходные изображения, в том числе на английском. RNB использует проверенный снимок версии 1.3.2; для The Dying Light в этом режиме показываются обновлённые карты.

Каждый новый вход начинается с выбора фракции; прямые ссылки открывают указанный раздел или карту. Версия карт выбирается отдельно, HD и оформление жетонов — в меню «Вид». На телефоне под открытой картой сразу раскрыт текст; свайп листает карты, а после увеличения перемещает изображение. Увеличить можно кнопкой, двойным нажатием или жестом двумя пальцами. На компьютере доступны двойной щелчок и клавиши `+`, `−`, `0`.

## Печать

Нажмите «Печать», затем «Выбрать карты»: отметьте карты в картотеке или добавьте всю фракцию. Кнопка «Готово» завершает выбор, а «Печать» открывает набор и параметры PDF. Печать на сайте доступна для Базы, GiF и SoW.

Размер карт во всех дополнениях — 63×88 мм. Печатайте PDF в масштабе 100%, без подгонки, с выбранным в окне краем переворота. Сначала проверьте контрольный лист: размер, совмещение лиц и рубашек, читаемость мелкого текста.

## Запуск локально

Сайт лежит в `page/`, сборка не нужна. Из корня репозитория запустите:

```sh
python3 -m http.server 8000
```

Откройте <http://localhost:8000/page/>.

## Среда разработки и проверки

Сайт работает на HTML, CSS и JavaScript в браузере. Node.js нужен только для служебных проверок JavaScript; для просмотра сайта и публикации на GitHub Pages он не требуется. Зависимостей npm и шага сборки в проекте нет, поэтому `npm install` запускать не нужно.

Для проверок закреплён [Node.js 24.22.1 LTS](https://nodejs.org/en/blog/release/v24.22.1) в `.node-version`. Используйте эту версию через менеджер версий или отдельный официальный portable-дистрибутив. Portable-копию храните вне репозитория и запускайте её `node` по полному пути, если системная версия отличается. Версия проверяется командой `node --version`.

Из корня репозитория проверьте синтаксис всех JavaScript-файлов.

PowerShell:

```powershell
Get-ChildItem page/script -Filter *.js | ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $($_.Name)" }
}
```

macOS / Linux:

```sh
for file in page/script/*.js; do
    node --check "$file" || exit 1
done
```

Проверка всех JSON-файлов тем же Python 3, который используется для локального сервера (на Windows вместо `python3` можно вызвать `python`):

```sh
python3 -c "import json,pathlib; files=list(pathlib.Path('page').rglob('*.json')); [json.loads(p.read_text(encoding='utf-8')) for p in files]; print('JSON:',len(files))"
```

После изменений интерфейса, навигации или рендеринга проверьте сайт в браузере на компьютере и телефоне. После изменений печати создайте PDF и осмотрите обе стороны листа; проверки синтаксиса не заменяют эту проверку.

## Авторы и источники

- [MolonLabem](https://github.com/MolonLabem) — русская версия и доработки.
- [Frytkownica](https://github.com/Frytkownica) — [исходный английский справочник](https://github.com/Frytkownica/Forbidden_Star).

Источники FAQ и RNB — [библиотека FS League](https://fixed-crane-287.notion.site/387346118c5d80caa6c1d8d50a60bc74?v=388346118c5d80308e06000cf1c80ca0) и её [журнал изменений](https://fixed-crane-287.notion.site/Changelog-3ca346118c5d801d8d58ddfa5ae1972a). Для обработки части иллюстраций использован [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan).

## Лицензия

[PolyForm Noncommercial 1.0.0](LICENSE) разрешает некоммерческое использование, изменение и распространение. При передаче копий сохраняйте текст лицензии или ссылку на неё и обе строки об авторах:

```text
Required Notice: Russian edition and modifications by MolonLabem (https://github.com/MolonLabem), https://github.com/MolonLabem/Forbidden_Star.
Required Notice: Original project by Frytkownica (https://github.com/Frytkownica), https://github.com/Frytkownica/Forbidden_Star.
```

Права на прежние версии под GPL-3.0 сохраняются. Лицензия касается только материалов, которые авторы вправе лицензировать. Права на сторонние иллюстрации, правила, шрифты и товарные знаки, включая материалы Games Workshop, она не меняет. Это неофициальный фанатский проект.

## Card data and local preparation

У каждой из 16 фракций один редактируемый источник: `page/factions/<expansion>/<faction>/text.json` (schemaVersion 2). В `cards` каждая карта содержит стабильный ID, категорию/группу, оригинальное изображение, русский текст и профиль оформления. Стороны планшетов, обрезка и порядок карт заданы явно. Отдельных `cards.json` больше нет.

Примеры одинаковой структуры:

```text
page/factions/sow/inquisition/text.json
page/factions/dl/leaguesofvotann/text.json
page/data/faction.schema.json          # общая схема
page/data/render-profiles.json         # общие профили и геометрия
page/script/faction-data.js            # общий загрузчик/проверка
```

Редактируйте `cards`, `groups`, `factionSheet` и `materialsText`. В этом же файле временно сохранены старые массивы и шаблоны для уже кешированных скриптов и внешних потребителей: их нельзя удалить одновременно с переходом формата без нарушения старого контракта. `compatibility` перечисляет автоматически обновляемые и исторические поля; второго редактируемого файла фракции нет. После изменения текста обновите поля совместимости и проверьте данные:

```sh
node tools/export-legacy.cjs --write
node tools/validate-data.cjs
node --test tests/*.test.cjs
```

There are no production npm dependencies. Renderer fingerprints normalize line endings, and `.gitattributes` keeps shared text inputs in LF form across platforms. These tools use the optional Node LTS version pinned in `.node-version`; the website still runs as static HTML/CSS/JavaScript. `page/data/render-profiles.json` shares typography dispatch and usual measured geometry; individual cards retain only source-specific exceptions. Typography, text wrapping and font fitting remain shared renderer logic. Map annotations remain semantic overlays. DL remains excluded from PDF printing.

Фракционные листы во всех версиях используют базовый формат 1280×770. Просмотрщик и увеличение сохраняют эти пропорции; русский текст рисуется после приведения фона к нужной форме. Оригинальные изображения, обрезки сторон и размеры подготовленных фонов сохраняются. `FSCardRender.sourceInfo()` возвращает размеры исходника, а `FSCardRender.sheetSize` — базовый размер отображения листа.

Если иллюстрация перекрывает поле текста, `render.regions[].inkOutline` задаёт границу очистки старых букв в долях обрезанной стороны исходника. Оформление вне этого контура сохраняется. Ссылки на подготовленные PNG включают их SHA-256 из общего манифеста, чтобы новая вёрстка не использовала прежний фон из кеша браузера.

`page/pictures/prepared/` contains locally reconstructed **backgrounds**, cropped sheet backgrounds and native combat title layers, not finished translated card images or original clean masters. Russian wording stays editable. Original JPEGs, artwork hashes and citations are preserved. Native DL combat keeps its original JPEG artwork with a prepared title layer and measured effect-panel bounds, avoiding artwork resampling. Feathering a prepared layer is generic compositing, not raster text reconstruction.

Offline repair recipes and provenance live in `tools/preparation-manifest.json`; canonical runtime card records contain no repair patches. `page/data/prepared-templates.json` records output/input/source hashes, dimensions, quality and exact comparison evidence. For regenerated backgrounds:

```sh
node tools/prepare-templates.cjs --out-dir /absolute/path/outside-repository
```

Open the printed loopback URL, select **Подготовить и сравнить**, and inspect the results. The browser uses local images/fonts only. The server binds to `127.0.0.1`, checks the session token and request origin, and writes only to the requested staging folder. Optional `--baseline-renderer /path/to/original/cardrender.js` compares against a saved earlier renderer rather than the retained compatibility renderer. A complete set with zero pixel differences is required before applying:

```sh
node tools/apply-prepared.cjs --from /absolute/path/outside-repository
node tools/apply-prepared.cjs --from /absolute/path/outside-repository --write
node tools/validate-data.cjs
```

After applying, use `--verify-applied` on the preparation server with a fresh output folder to compare the actual canonical records/profile merge against the retained recipes. Stop the local server with Ctrl+C. Preparation is a developer action, never a page-load hook or a deployment requirement. Inspect backgrounds and final dense cards in the browser and representative PDFs after changing recipes/layouts. Exact comparison preserves the previous output; it does not certify the old retouching as an original clean master or replace physical printing acceptance.

Coordinate units are explicit in the recipe manifest: patch boxes and donor crops are fractions of their respective native images; enhanced artwork masks and feather widths use native pixels; sheet crops refer to the complete source atlas; region boxes refer to the cropped side. `template.artworkWindow` is a measured source-image rectangle in fractions: illustration only, excluding its frame and placeholder paint. It lets the illustration cover space freed by shorter combat text without exposing the template's white or colored filler. Explicit `template.body` preserves text placement formerly inferred from `body-erasure`. Repair provenance stays separate from wording. New runtime input files participate in `FSCatalog.sourcePaths()`/print fingerprints; offline recipes are represented by their prepared input hashes. Старые кешированные страницы и внешние потребители продолжают читать совместимые поля того же `text.json`, включая необходимые исторические сведения о восстановлении. Новые скрипты используют записи `cards` и подготовленные изображения.
