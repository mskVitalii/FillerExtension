# Рефакторинг `extension/src/`: обзор и план

Пункты отсортированы по соотношению пользы и риска. Отметка **[сделано]** значит, что пункт
уже реализован на ветке `claude/refactor-review-910540` отдельным коммитом и поведение не
меняет: `make typecheck lint test` зелёные после каждого коммита. Остальное здесь только
предложения.

Пока параллельно идут сессии по моделям, авто-пиннингу, ключевым словам и распознаванию форм,
эти файлы не трогаем, их пункты ниже остаются только описанием: `src/features/autofill/`,
`src/content/`, `src/features/highlight/keyword-highlight.ts`,
`src/features/openai/analyze-job-brief.ts`, `src/features/openai/client.ts`, выбор моделей в
`SettingsPanel.tsx`, `src/background/index.ts`. `MainView.tsx` формально не в списке, но
почти наверняка меняется в сессиях про ключевые слова и вопросы формы, поэтому в нём
затронуты только строки, далёкие от этих областей.

## Сделано (безопасно, без изменения поведения)

### 1. [сделано] Общий хелпер cache-then-Drive для репозиториев

- **Где:** `features/profile/repository.ts` (7 копий), `features/cv-template/repository.ts` (1).
- **Что было:** каждая пара `getX`/`saveX` повторяла одни и те же ~15 строк: прочитать
  `chrome.storage.local`, иначе Drive, положить в кэш, на ошибке (Google не подключён)
  вернуть пустое значение. Шаблон расходился в мелочах: где-то пустой fallback, где-то
  миграция, где-то текстовый файл вместо JSON.
- **Что стало:** `features/storage/drive-cache.ts` с `readCachedJson` / `writeCachedJson`
  (JSON-документы) и `readCachedText` / `writeCachedText` (Markdown-правила с `updatedAt`).
  Тип ключа берётся из схемы `chrome.storage.local`, так что ключ кэша и тип документа
  проверяются компилятором. Исключение — `getProfile`: он мержит результат с `EMPTY_PROFILE`
  до записи в кэш, поэтому остался как был.
- **Риск:** низкий, порядок операций (сначала кэш, потом Drive) сохранён.

### 2. [сделано] Типизированные ответы сообщений и мёртвый код в `types/messages.ts`

- **Где:** `types/messages.ts`, `sidepanel/screens/CvAdaptPanel.tsx`, `JobSearchPanel.tsx`,
  `features/cv-template/adapt.ts`, часть `MainView.tsx`, `background/router.ts`,
  `features/file-upload/drop-catcher.ts`.
- **Что было:** ответ на каждый `sendMessage<...>` описывался вручную объектным литералом
  (`{ type: "UPLOAD_FILE_RESULT"; nativeInputs: number; dropZones: number }` встречается
  4 раза), и такие копии могли тихо разойтись с `RuntimeMessage`. Два вызова
  `chrome.runtime.sendMessage` (стрим-чанки в `router.ts`, `ATTACH_FILE_AT` в
  `drop-catcher.ts`) отправляли полезную нагрузку без проверки типа. `sendMessageToTab`
  нигде не использовался.
- **Что стало:** `MessageOf<"UPLOAD_FILE_RESULT">` (это `Extract<RuntimeMessage, { type }>`).
  Нетипизированные отправки помечены `satisfies RuntimeMessage`, `sendMessageToTab` удалён.
- **Риск:** низкий, изменения только на уровне типов.

### 3. [сделано] Общие JSON-схемы OpenAI для повторяющихся форм ответа

- **Где:** `features/openai/polish-cover-letter.ts`, `revise-cover-letter.ts`,
  `translate-cover-letter.ts` (одинаковая `{ content }`), `outreach-message.ts`,
  `revise-outreach-message.ts` (одинаковая `{ subject, body }`).
- **Что стало:** `features/openai/schemas.ts`: `CONTENT_SCHEMA` / `ContentResult`,
  `OUTREACH_SCHEMA`. Схема ответа outreach теперь живёт в одном месте, и генерация с
  ревизией не могут разъехаться.
- **Риск:** низкий, схемы побайтово те же.

### 4. [сделано] Мелкие дубли и мёртвый код

- `cv-template/latex.ts` держал свою копию base64-кодирования (`toBase64`), которая уже
  есть в `lib/base64.ts`. Вынесено в `bytesToBase64`, им же теперь пользуется `fileToBase64`.
- `lib/phone.ts` `callingCodeForCountry` нигде не вызывается — удалён.

## Предложения (не сделано: крупнее, рискованнее или задевают чужие файлы)

### P1. Разбить `sidepanel/screens/MainView.tsx` (2249 строк, 49 `useState`, 14 `useEffect`)

Самый большой выигрыш и самый большой риск конфликтов. В одном компоненте живут как минимум
шесть независимых подсистем:

| Хук / компонент | Что забирает (функции в `MainView.tsx`) |
|---|---|
| `useJobBootstrap(tabId)` | `handleNavigation`, `bootstrapJob`, `handleJobFieldCommit`, `checkExistingApplication`, `handleReset`, `handleExtractFromPastedText` |
| `useJobBrief` | `applyJobBrief`, `handleDetectJobBrief`, `handleToggleHighlightOnPage`, `withContactHighlight` |
| `usePageQuestions` | `handleDetectQuestions`, `answerAndFillQuestions`, `fillQuestionAnswers`, `handleAddManualQuestion`, picker (`ingestPickedFields*`, `handleStartPicker/StopPicker`), `handleAnalyzePageContent`, `applyPageContentQuestionAnswers` |
| `useCoverLetter` | `handleGenerate` + стрим-подписка, `handleImprove`, `handleTranslateLanguageChange`, `handleCoverLetterChange`, `handleExportPdf` |
| `useOutreach` | `handleGenerateOutreach`, `handleImproveOutreach`, `handleCopyOutreachMessage`, `outreachContactHref` |
| `useAttachments` | `handleUploadCoverLetterToPage`, `handleAttachCvToPage`, `handleAdaptedCv` — три почти одинаковых `UPLOAD_FILE`-вызова с одной и той же обработкой `nativeInputs/dropZones` |

JSX тоже стоит разрезать на секции (`JobCard`, `QuestionsSection`, `CoverLetterSection`,
`OutreachSection`, `AttachmentsBar`). Делать это стоит после того, как сольются ветки про
ключевые слова и распознавание форм: они почти наверняка правят этот файл. Начинать лучше с
`useOutreach` и `useAttachments`, они самые изолированные.

### P2. Разбить `sidepanel/screens/SettingsPanel.tsx` (1117 строк, 35 `useState`)

- Пять одинаковых `handleXxxModelChange` (`:187-211`) лучше сделать таблицей
  `{ key, label, get, set }[]` и одним обработчиком. Сейчас это зона сессии про список
  моделей, так что после её мержа.
- CV-библиотека (`handleCvSelected/SetActiveCv/DeleteCv`) и Legend-библиотека
  (`handleLegendFileSelected/SetActiveLegend/DeleteLegend`) — один и тот же UI «список +
  активный + удалить». Напрашивается общий `LibraryList`.
- Остальные секции (профиль, custom fields, language levels, FAQ, generation/outreach rules,
  ключи job search) — отдельные компоненты со своим состоянием. Тогда `SettingsPanel` станет
  просто раскладкой.

### P3. `requestStructured`: `parse` по умолчанию и проверка ответа (`openai/client.ts`)

16 вызовов передают одинаковое `parse: (raw) => JSON.parse(raw) as T`. Если сделать `parse`
необязательным с дефолтом `JSON.parse`, шум уйдёт. Отдельный вопрос: ответ модели нигде не
валидируется, `as T` только доверяет `strict: true`. Если когда-нибудь понадобится проверка,
её удобно добавить в одном месте. `client.ts` сейчас правит сессия про модели, поэтому только
после её мержа.

### P4. Связать запрос и ответ на уровне типов, роутер — таблицей обработчиков

`sendMessage<T>` верит вызывающему, что придёт `T`. Карта
`RequestResponse = { GET_JOB: "JOB_DATA"; UPLOAD_FILE: "UPLOAD_FILE_RESULT"; ... }` позволила
бы выводить тип ответа из запроса (`sendMessage(msg): Promise<MessageOf<RequestResponse[typeof msg.type]>>`)
и убрать дженерики со всех ~50 вызовов. Заодно `router.ts` (490 строк, 27 `case`) превращается
в `Record<RequestType, Handler>`, и компилятор ловит забытый обработчик. Риск средний, затрагивает
`router.ts` и `content/index.ts` (последний занят), поэтому позже.

### P5. Общие операции над «библиотеками» в `profile/repository.ts`

`getCvLibrary`/`getLegendLibrary`, `setActiveCv`/`setActiveLegend`, `deleteCv`/`deleteLegend`
повторяют одну логику над `{ items, activeId }`: найти по id, сменить активный, при удалении
активного взять первый оставшийся. Хватит чистых функций `withActive(library, id)` и
`withoutItem(library, id)` с тестами. Риск низкий, но заметно меняет форму модуля. Стоит
сделать вместе с P2 (общий `LibraryList`).

### P6. Несогласованности в репозиториях (заметки, не баги-блокеры)

- `getGenerationRules` / `getOutreachRules` при чтении из Drive ставят `updatedAt = now`, то
  есть дата меняется при каждом холодном чтении, а не при правке. Нужно либо хранить дату в
  Drive, либо явно назвать поле `cachedAt`. Это изменение поведения, поэтому не трогал.
- `applications/repository.ts` ходит только в Drive, без локального кэша, в отличие от
  остальных. Для списка заявок это, вероятно, правильно (их много, нужна свежесть), но стоит
  описать в CLAUDE.md, что шаблон cache-then-Drive относится только к документам профиля.
- Ни один `saveX` не обрабатывает ситуацию «кэш записан, Drive упал»: правка остаётся на
  устройстве, но молча не доезжает в Drive и перезапишется при следующем холодном чтении с
  другого устройства. Нужен общий механизм «грязного» флага или ретраев.

### P7. Экспорты, используемые только внутри своего файла

Около 60 экспортов (`isReactSelectLike`, `radioOptionLabel`, `KNOWN_VARIABLES`,
`LATEX_COMPILE_URL`, `parseSalary`, …) нигде не импортируются. Убирать `export` массово не
стоит: часть из них — намеренный тестируемый API. Лучше подключить `knip` в `make lint`,
чтобы новый мёртвый код ловился автоматически. Половина таких экспортов живёт в
`features/autofill/`, который сейчас занят.

### P8. Файлы, которые сейчас трогать нельзя (только наблюдения)

- `features/autofill/pick-questions.ts` (634 строки) смешивает DOM-сбор полей, нормализацию
  label'ов и сопоставление ответов. Если разделить на `collect` и `match`, станет проще
  тестировать.
- `content/index.ts` — один большой `switch` по сообщениям. Его тоже стоит сделать таблицей
  обработчиков, синхронно с P4.
- `features/cv-template/pdf.ts` (1280 строк) логически делится на парсинг content stream,
  декодирование шрифтов и layout pass. Он хорошо покрыт `test/cv-template-pdf.test.ts`, так
  что разрезать можно относительно безопасно, но польза в основном для читаемости.
