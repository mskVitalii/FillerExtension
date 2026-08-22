# Job Application Assistant

## 1. Цель проекта

Создать Chrome Extension для ускорения подачи заявок на вакансии.

Главная проблема пользователя: при каждой вакансии приходится переключаться между сайтом вакансии, CV, ChatGPT/LLM, текстовым редактором и PDF-файлами, а затем вручную переносить одни и те же данные в ATS.

Extension должен объединить workflow в Chrome Side Panel:

```text
Open vacancy
    ↓
Extract job information
    ↓
Generate tailored Cover Letter
    ↓
Edit Cover Letter
    ↓
Export PDF
    ↓
Autofill application
    ↓
Insert missing values via context menu
    ↓
Upload CV / Cover Letter
    ↓
Submit manually
```

Основная цель — минимальное количество копирования и переключения между окнами.

---

# 2. Главный UX

После установки extension пользователь открывает Side Panel.

Первый запуск:

```text
Job Application Assistant

Welcome

OpenAI API Key
[ sk-................ ]

[ Save Key ]
```

После сохранения ключа:

```text
OpenAI API key saved ✓

[ Connect Google ]
```

После подключения Google:

```text
Google connected ✓

[ Upload CV ]

[ Edit Personal Legend ]
```

После initial setup пользователь открывает любую вакансию.

Side Panel:

```text
Job Application Assistant

Company
Example GmbH

Position
Senior Software Engineer

Location
Berlin

[ Generate Cover Letter ]

Cover Letter

┌─────────────────────────────┐
│ Dear Hiring Team,           │
│                             │
│ ...                         │
│                             │
└─────────────────────────────┘

[ Regenerate ] [ Export PDF ]

Profile

✓ Name
✓ Email
✓ Phone
✓ LinkedIn
✓ GitHub

[ Autofill Application ]
```

Пользователь самостоятельно предоставляет OpenAI API key и оплачивает использование OpenAI API. Ключ используется непосредственно из Chrome Extension и не отправляется на backend.

---

# 3. Основной стек

## Chrome Extension

* TypeScript
* React
* Vite
* Chrome Extension Manifest V3
* Chrome Side Panel API
* Chrome Storage API
* Chrome Context Menus API
* Chrome Scripting API
* Chrome Tabs API
* Chrome Downloads API
* Chrome Identity API
* Content Scripts
* Background Service Worker

## UI

* Tailwind CSS
* shadcn/ui
* Lucide React

## Editor

* TipTap
* ProseMirror

## PDF

* `@react-pdf/renderer`

## AI

* OpenAI API
* Structured Outputs / JSON Schema
* API key пользователя

## Google

* Google OAuth 2.0
* Chrome Identity API
* Google Drive API
* Google Docs API только при необходимости

## Backend

Не используется.

OpenAI API вызывается непосредственно из Chrome Extension с API key, который пользователь вводит самостоятельно.

## Infrastructure

Для MVP не требуется backend-инфраструктура.

GitHub Actions можно использовать для сборки и публикации extension.

Kubernetes не нужен.

---

# 4. Архитектура

Основная архитектура:

```text
                         ┌─────────────────────┐
                         │      Chrome         │
                         │     Extension       │
                         │                     │
                         │  ┌───────────────┐  │
                         │  │  Side Panel   │  │
                         │  └───────┬───────┘  │
                         │          │          │
                         │  ┌───────▼───────┐  │
                         │  │    Runtime     │  │
                         │  │   Messaging    │  │
                         │  └───────┬───────┘  │
                         │          │          │
                         │  ┌───────▼───────┐  │
                         │  │    Service     │  │
                         │  │    Worker      │  │
                         │  └───────┬───────┘  │
                         │          │          │
                         │  ┌───────▼───────┐  │
                         │  │ Content Script │  │
                         │  └───────┬───────┘  │
                         │          │          │
                         │       Website      │
                         └─────────────────────┘
                                    │
                                    │
                         ┌──────────▼──────────┐
                         │    Google Drive     │
                         │     appDataFolder   │
                         └─────────────────────┘

                                    │
                                    │ AI request
                                    ▼
                         ┌─────────────────────┐
                         │     OpenAI API      │
                         │  User's API key     │
                         └─────────────────────┘
```

AI-запросы выполняются непосредственно из extension:

```text
Chrome Extension
      ↓
job + user context
      ↓
OpenAI API
      ↓
generated cover letter
      ↓
Chrome Extension
      ↓
Google Drive
```

Backend, proxy и серверное хранилище не используются.

---

# 5. Важный privacy принцип

Данные пользователя не должны храниться на стороннем backend, поскольку backend отсутствует.

Пользовательские данные:

* имя;
* email;
* телефон;
* адрес;
* CV;
* Personal Legend;
* Cover Letters;
* application history;

должны храниться у пользователя.

Основное storage:

```text
Google Drive appDataFolder
```

Небольшие настройки и локальные данные:

```text
chrome.storage.local
chrome.storage.sync
```

API key пользователя хранится локально в extension storage и используется только для прямых запросов к OpenAI API.

Пример:

```text
Chrome Extension
      ↓
job + required user context
      ↓
OpenAI API
      ↓
generated cover letter
      ↓
Chrome Extension
      ↓
Google Drive
```

Никакие пользовательские документы не отправляются на сервер разработчика.

Важно явно сообщить пользователю:

* он самостоятельно предоставляет OpenAI API key;
* он самостоятельно оплачивает использование OpenAI API;
* extension не предоставляет общий API key;
* API key хранится локально в extension storage;
* абсолютную защиту API key в браузерном extension гарантировать нельзя.

Не создавать database для пользовательских данных в MVP.

---

# 6. Google integration

Пользователь не должен создавать Google Cloud Project.

Google Cloud Project создаётся разработчиком один раз.

Пользователь видит:

```text
[ Connect Google ]
```

После нажатия:

```text
Google OAuth
    ↓
Allow
    ↓
Google connected ✓
```

Использовать один OAuth Client для приложения.

Google Drive использовать для хранения application-specific данных.

Предпочтительно использовать:

```text
drive.appdata
```

и Google Drive `appDataFolder`.

Пример структуры:

```text
appDataFolder/
├── profile.json
├── settings.json
├── legend.md
├── cv.pdf
└── applications/
    ├── application-1.json
    ├── application-2.json
    └── ...
```

Google Docs не использовать как database.

Google Docs можно поддержать позже как удобный пользовательский редактор Personal Legend.

---

# 7. Profile

Профиль пользователя:

```text
firstName
lastName
fullName
email
phone
address
city
postalCode
country
linkedin
github
website
```

Дополнительно:

```text
CV
Personal Legend
```

Profile должен быть доступен Content Script и AI generator.

---

# 8. Personal Legend

Personal Legend — текстовый источник достоверной информации о пользователе.

Он может содержать:

```text
Experience
Projects
Achievements
Technologies
Education
Motivation
Career goals
Interesting stories
Preferred work environment
```

AI не должен придумывать факты.

Если информации нет в:

* profile;
* CV;
* Personal Legend;

AI не должен её выдумывать.

---

# 9. CV

Пользователь один раз загружает CV.

Оригинальный файл хранится в Google Drive.

Необходимо иметь:

```text
Upload CV
Replace CV
Delete CV
```

Для AI необходимо получать текстовое представление CV.

Не отправлять PDF целиком, если для конкретной модели это не требуется.

Извлекать текст локально, если возможно.

---

# 10. Job extraction

Content Script должен извлекать информацию с текущей страницы.

Структура:

```text
Job:
    company
    position
    location
    description
    requirements
    responsibilities
    salary
    techStack
    contact
    url
```

Сначала использовать DOM extraction.

Не отправлять весь HTML страницы в OpenAI API.

Использовать:

* headings;
* labels;
* semantic HTML;
* article/main;
* job-specific metadata;
* JSON-LD;
* meta tags;
* visible text.

Только при недостаточном качестве использовать AI fallback через OpenAI API пользователя.

---

# 11. Generic website architecture

Не строить приложение исключительно вокруг LinkedIn/Workday/Greenhouse/Lever.

Основная архитектура должна быть generic.

```text
Website
    ↓
DOM
    ↓
Extraction
    ↓
Semantic model
    ↓
Application logic
```

ATS-specific adapters можно добавлять позже.

---

# 12. Autofill

Content Script должен находить:

```text
input
textarea
select
[contenteditable]
[role="combobox"]
```

Для каждого поля определить semantic type.

Например:

```text
firstName
lastName
email
phone
address
city
postalCode
country
linkedin
github
website
```

Использовать сигналы:

```text
name
id
type
autocomplete
placeholder
aria-label
label
nearby text
DOM context
```

Например:

```text
Given name
Vorname
First name
First Name *
Your first name
```

должны определяться как:

```text
firstName
```

LLM fallback можно использовать для неоднозначных полей, отправляя только необходимый контекст в OpenAI API.

---

# 13. Autofill implementation

После определения semantic field:

```text
DOM element
    ↓
semantic field
    ↓
profile value
    ↓
set native value
    ↓
dispatch input/change events
```

Не просто устанавливать `.value`.

Необходимо корректно триггерить события, чтобы React/Vue/Angular формы увидели изменение.

Поддержать controlled inputs.

---

# 14. Context Menu

Добавить Chrome Context Menu.

UX:

```text
Right click
└── Insert
    ├── First name
    ├── Last name
    ├── Full name
    ├── Email
    ├── Phone
    ├── Address
    ├── LinkedIn
    ├── GitHub
    ├── Website
    ├── CV
    └── Cover Letter
```

При выборе значения оно вставляется в активное поле.

Custom fields должны быть возможны в будущем.

---

# 15. Cover Letter generation

Разделить AI pipeline.

Не использовать один giant prompt.

Pipeline:

```text
Job extraction
    ↓
Structured Job
    ↓
Job analysis
    ↓
Cover Letter generation
```

Input:

```text
profile
cv
personalLegend
job
```

Output:

```json
{
  "content": "..."
}
```

Использовать Structured Outputs / JSON Schema.

Cover Letter должен быть tailored под конкретную вакансию.

Не выдумывать:

* experience;
* technologies;
* companies;
* education;
* achievements;
* responsibilities.

Все AI-запросы отправляются напрямую в OpenAI API с API key пользователя.

---

# 16. Cover Letter editor

Использовать TipTap.

Flow:

```text
OpenAI API
    ↓
TipTap
    ↓
User edits
    ↓
Export PDF
```

Пользователь должен иметь возможность полностью редактировать generated text.

Поддержать:

* regenerate;
* edit;
* save;
* export.

---

# 17. PDF generation

Использовать:

```text
@react-pdf/renderer
```

Flow:

```text
TipTap content
    ↓
PDF renderer
    ↓
Blob
    ↓
File
```

Кнопки:

```text
[ Export PDF ]
[ Download PDF ]
```

PDF должен быть обычным `File`, пригодным для upload в ATS.

---

# 18. File upload

Для стандартных элементов:

```html
<input type="file">
```

использовать browser APIs.

Необходимо поддержать выбор:

```text
CV
Cover Letter
```

из application storage.

Для drag-and-drop upload zones поддержать:

```text
dragenter
dragover
drop
```

events.

Нужно учитывать, что некоторые ATS используют custom React components.

Нельзя гарантировать universal upload через один механизм.

---

# 19. Application storage

Каждая открытая/созданная заявка может иметь:

```text
id
company
position
url
job
coverLetter
createdAt
updatedAt
status
```

Status:

```text
draft
applied
interview
rejected
offer
```

Но полноценный tracker не является обязательной частью MVP.

---

# 20. Chrome Storage

Использовать:

```text
chrome.storage.sync
```

для небольших настроек:

```text
preferences
shortcuts
UI settings
```

Использовать:

```text
chrome.storage.local
```

для локальных настроек и API key пользователя:

```text
openaiApiKey
```

Использовать:

```text
Google Drive appDataFolder
```

для:

```text
profile
CV
legend
applications
cover letters
```

Не хранить большие документы в `chrome.storage`.

---

# 21. Messaging

Архитектура коммуникации:

```text
Side Panel
    ↕
Background Service Worker
    ↕
Content Script
```

Использовать:

```text
chrome.runtime.sendMessage()
chrome.runtime.onMessage()
```

Типизировать message protocol.

Например:

```text
GET_JOB
JOB_DATA
GET_PROFILE
AUTOFILL
INSERT_VALUE
GENERATE_COVER_LETTER
UPLOAD_FILE
EXPORT_PDF
```

Не использовать неструктурированные arbitrary messages.

AI-запросы могут выполняться из Side Panel или Service Worker, но API key должен передаваться только внутри extension runtime и не покидать extension напрямую, кроме запроса к OpenAI API.

---

# 22. Background Service Worker

Service Worker отвечает за:

* Context Menus;
* message routing;
* Google authentication;
* downloads;
* extension lifecycle;
* взаимодействие между Side Panel и Content Script.

Не хранить application state только в memory Service Worker.

Service Worker может быть выгружен Chrome.

---

# 23. Backend

Backend не используется ни в MVP, ни в основной архитектуре проекта.

OpenAI API key не предоставляется разработчиком и не хранится на сервере.

Пользователь самостоятельно вводит свой API key в extension:

```text
Extension
    ↓
User's OpenAI API key
    ↓
OpenAI API
```

Не создавать endpoints:

```text
POST /api/job/analyze
POST /api/cover-letter/generate
```

AI-функции реализуются через прямые вызовы OpenAI API из extension.

---

# 24. Security

Никогда не:

* коммитить API keys;
* использовать общий API key разработчика;
* отправлять API key на backend;
* отправлять весь DOM без необходимости;
* хранить CV на backend;
* хранить Personal Legend на backend;
* хранить OAuth tokens в обычных Git-tracked files;
* включать пользовательский API key в исходный код или build artifacts.

Использовать `.env` только для локальных development-настроек, если это необходимо.

Добавить:

```text
.env
.env.local
```

в `.gitignore`.

API key пользователя хранить локально, например в:

```text
chrome.storage.local
```

При необходимости добавить возможность:

```text
Replace API Key
Delete API Key
```

Использовать минимально необходимые Google OAuth scopes.

Не логировать API key, пользовательские документы и полные AI-запросы в production.

---

# 25. Project structure

Предпочтительная структура:

```text
job-application-assistant/
├── extension/
│   ├── src/
│   │   ├── background/
│   │   ├── content/
│   │   ├── sidepanel/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── autofill/
│   │   │   ├── cover-letter/
│   │   │   ├── job-extraction/
│   │   │   ├── profile/
│   │   │   ├── openai/
│   │   │   └── storage/
│   │   ├── lib/
│   │   ├── types/
│   │   └── main.ts
│   ├── public/
│   ├── manifest.json
│   ├── package.json
│   └── vite.config.ts
│
├── .github/
│   └── workflows/
│
├── .gitignore
└── README.md
```

Backend-директория не создаётся.

---

# 26. Development order

Реализовывать в таком порядке:

```text
1. React + TypeScript + Vite
2. Manifest V3
3. Side Panel
4. Background Service Worker
5. Content Script
6. Chrome messaging
7. Job extraction
8. Profile
9. Context Menu
10. Autofill
11. Google OAuth
12. Google Drive
13. Personal Legend
14. OpenAI API key setup
15. OpenAI integration
16. Cover Letter generation
17. TipTap editor
18. PDF generation
19. CV upload
20. ATS compatibility
21. API key management
22. CI/CD
23. Chrome Web Store
```

---

# 27. MVP scope

MVP должен содержать:

* Chrome Extension;
* Manifest V3;
* Side Panel;
* локальное сохранение OpenAI API key;
* прямые запросы к OpenAI API;
* Google login;
* Google Drive storage;
* profile;
* CV;
* Personal Legend;
* job extraction;
* AI Cover Letter;
* Cover Letter editor;
* PDF export;
* context menu;
* basic autofill;
* CV upload;
* Cover Letter upload.

Не включать в MVP:

* backend;
* PostgreSQL;
* Redis;
* Kubernetes;
* complex analytics;
* multi-user database;
* automatic application submission;
* полноценный CRM;
* десятки ATS-specific adapters;
* общий API key для всех пользователей.

---

# 28. Testing

Создать локальную test page с:

```text
<input name="first_name">
<input name="last_name">
<input name="email">
<input name="phone">
<input name="linkedin">
<textarea></textarea>
<select></select>
```

Также протестировать:

```text
aria-label
placeholder
autocomplete
React controlled input
contenteditable
custom combobox
file input
drag/drop upload
```

Проверить:

* сохранение API key;
* удаление API key;
* прямой запрос к OpenAI API;
* отсутствие отправки API key на сторонний сервер;
* корректную обработку ошибок OpenAI API;
* отсутствие утечки ключа в логи.

После этого протестировать реальные ATS:

```text
LinkedIn
Greenhouse
Lever
Workday
Indeed
обычная HTML форма
```

Не предполагать, что реализация, работающая на одном ATS, работает на всех.

---

# 29. Google setup для разработчика

Это единственная ручная Google-настройка, которую должен делать разработчик.

Создать Google Cloud Project.

Включить:

```text
Google Drive API
Google Docs API
```

Настроить OAuth Consent Screen.

Создать OAuth Client для Chrome Extension.

Добавить необходимые scopes.

Пользователю ничего из этого показывать не нужно.

User flow:

```text
Install extension
      ↓
[Connect Google]
      ↓
Google OAuth
      ↓
[Allow]
      ↓
Connected
```

OpenAI API key пользователь создаёт самостоятельно в OpenAI и вводит в extension.

---

# 30. Chrome Web Store

После готовности MVP:

1. Создать Chrome Web Store Developer account.
2. Зарегистрировать extension.
3. Подготовить extension package.
4. Подготовить название.
5. Подготовить description.
6. Подготовить screenshots.
7. Подготовить privacy policy.
8. Указать необходимые permissions.
9. Описать использование пользовательского OpenAI API key.
10. Отправить extension на review.
11. После approval дать пользователям ссылку на Chrome Web Store.

Пользователь должен устанавливать extension обычным способом:

```text
Add to Chrome
```

---

# 31. Privacy model

Пользовательские данные должны оставаться у пользователя:

```text
User
 │
 ├── Profile ──────── Google Drive
 ├── CV ───────────── Google Drive
 ├── Legend ───────── Google Drive
 ├── Cover Letters ── Google Drive
 ├── Applications ─── Google Drive
 └── OpenAI Key ───── Local Extension Storage
```

AI-запрос:

```text
Extension
   ↓
Job + selected user context
   ↓
OpenAI API
   ↓
Response
   ↓
Extension
   ↓
Optional save to Google Drive
```

Backend отсутствует, поэтому серверная database с пользовательскими CV/profile/application data не создаётся.

В Privacy Policy явно описать:

* какие данные extension читает;
* какие данные отправляются в OpenAI;
* что OpenAI API key предоставляется пользователем;
* что extension не использует общий API key;
* что сохраняется в Google Drive;
* что API key хранится локально;
* какие Google permissions используются;
* какие данные не отправляются разработчику;
* какие данные могут обрабатываться OpenAI согласно условиям OpenAI API.

---

# 32. Definition of Done

MVP считается готовым, если новый пользователь может:

```text
Install extension
    ↓
Enter personal OpenAI API key
    ↓
Connect Google with one button
    ↓
Upload CV
    ↓
Enter Personal Legend
    ↓
Open arbitrary job page
    ↓
Open Side Panel
    ↓
See extracted job
    ↓
Generate Cover Letter through OpenAI API
    ↓
Edit Cover Letter
    ↓
Export PDF
    ↓
Autofill application form
    ↓
Right-click → Insert missing values
    ↓
Upload CV / Cover Letter
    ↓
Submit application manually
```

Пользователь не должен:

* создавать Google Cloud Project;
* запускать локальный backend;
* настраивать database;
* вручную создавать Google Drive folders;
* вручную копировать данные между несколькими приложениями.

Пользователь должен самостоятельно создать и вставить только собственный OpenAI API key.

Главный принцип: после установки, сохранения API key и `Connect Google` extension должен быть практически готов к работе.
