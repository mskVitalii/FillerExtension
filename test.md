# Vitalii Popov — Cover Letter Source Document

> Назначение: единый источник фактов для генерации cover letter под конкретные вакансии.
> Факты и описания опыта написаны **от первого лица** — их можно копировать в письмо почти без изменений.
> Пояснения и предупреждения (в блоках-примечаниях и в §10) — это заметки для того, кто пишет письмо,
> они намеренно оставлены не от первого лица, чтобы не перепутать с текстом самого письма.
> Собрано и дважды перепроверено 2026-08-18 из: CV (07.05.26), диплома HSE, транскрипта TU Chemnitz,
> писем-рекомендаций, `src/data/{career,projects,skills,recommendations}.ts`, `messages/en.json` (FAQ, About),
> и памяти ассистента по этому проекту. Дополнено 2026-08-19 фактами и стилем из двух моих реальных
> черновиков писем (Staffbase, JetBrains) — они же разбираются в §0 как образец стиля.

---

## 0. Стиль письма (по двум моим реальным черновикам — Staffbase и JetBrains)

Это не общие советы, а разобранный паттерн из моих собственных писем. Копировать структуру, не изобретать новую.

**Структура абзацев (в этом порядке, не все обязательны):**
1. **Приветствие + одна фраза интереса к конкретной компании** — без воды, сразу называет компанию/продукт. Пример: *"I am writing to express my enthusiasm for the position at Staffbase."* / *"the opportunity to help build innovative AI-driven products is incredibly exciting."*
2. **Стек компании ↔ мой стек — сразу, вторым абзацем.** Называет конкретные технологии из вакансии/компании и сразу привязывает к конкретному месту, где их использовал. Пример: *"I work with relevant technologies for Staffbase: Go, ElasticSearch, PostgreSQL, Docker, K8s and monitoring infrastructure. I gained experience with them during my internship at OZON Tech..."*. Не нужно описывать технологии, с которыми я не работал.
3. **Инсайдерская рекомендация от текущего сотрудника компании, если есть** — называет имя, должность, где именно вместе работали. Пример: *"I got a recommendation from the current Staffbase employee Anastasiia Zibrova. We worked together on a University project and Anastasiia's personal project. Both times I was a backend engineer."*
4. **Технологии по годам, с числом лет и точкой отсчёта** — не просто список, а "X лет, с такого-то года, в таком-то месте, в проде/на учёбе". Пример: *"Golang: ~3 years. Started in 2021 (OZON Tech), used in production microservices with Elasticsearch, Kafka, Redis, Kubernetes, monitoring."*
5. **Честно про менее сильные/побочные стеки — и готовность учиться.** Не скрывает, что Java/C#/Kotlin — не основной стек, но показывает трансфер навыков и любопытство. Пример: *"I've done a tutorial on Kotlin. And I would appreciate a chance to learn Kotlin within Staffbase."*
6. **Явное предложение сделать coding assignment** на любой нужный стек — показывает уверенность и снимает риск для нанимающей стороны.
7. **Привязка к ценностям компании** — если известны (нашёл на сайте компании), явно называет их и объясняет через свой опыт. Пример: *"This resonates with me with the company's values such as Ownership, Care and Grow."*
8. **Текущая роль в Infineon — почти дословно одинаковый блок в обоих письмах** (см. готовый параграф в §11) — что строил, ownership, деплой-флоу, честная причина ухода (Werkstudent-контракт заканчивается вместе с магистратурой), notice period.
9. **Крупный масштаб/impact-проект (обычно OZON, 200M/5 сек)** — отдельным абзацем, если ещё не всплыл.
10. **Качество/тестирование** — конкретные инструменты + где именно применял TDD/тесты.
11. **Публичный вклад в индустрию (статьи)** — с конкретными цифрами просмотров и площадками, желательно с привязкой к теме, близкой компании (JetBrains → статья про Java Spring на Хабре).
12. **Готовность к релокации — с конкретными городами**, обычно рядом с офисом компании (для немецких компаний — Chemnitz, Leipzig, Dresden, Berlin), а не общий список стран.
13. **Короткая благодарность и подпись.** Без "Looking forward to hearing from you" клише — просто "Thank you for considering my application."

**Общие принципы тона:**
- Никогда не пишу "I believe I would be a great fit" или похожую воду — вместо этого называю конкретную технологию/цифру/имя.
- Юмор — редкий, короткий, в скобках или после двоеточия (":)" после шутки про C#/Java или "guerrilla marketing:)" про SEO-трюк) — не больше одного раза на письмо.
- Каждое достижение сразу увязано с технологией и цифрой — не бывает предложения без хотя бы одного из двух.

---

## 1. Контакты и идентификация

| Поле | Значение |
|---|---|
| Полное имя | Vitalii (Виталий Леонидович) Popov / Попов |
| Дата рождения | 26.11.2001 |
| Email | msk.vitaly@gmail.com |
| Телефон | 01745624691 |
| LinkedIn | linkedin.com/in/mskvitalii |
| GitHub | github.com/mskVitalii |
| Портфолио | https://vitalii-popov.dev |
| Адрес | Berlin, Germany |

---

## 2. Текущий статус поиска работы

- Я могу выйти на новую роль через **1 месяц** — это мой notice period на текущей позиции в Infineon Technologies.
- Я открыт к релокации: Германия, ЕС, UK, США, ОАЭ, Канада, Сингапур, Япония, Южная Корея, Австралия. Remote-first формат мне тоже подходит.
- Мои зарплатные ожидания — **€60–70K/год** (это также минимальный порог для German Blue Card).
- Я рассматриваю full-time контракты. Freelance — только через посредника/EOR-платформу (например remozo.com).
- Моя долгосрочная цель — стабильная роль на 5+ лет на стыке distributed systems и AI, в которой я смогу расти.
- Языки: English (свободно, C1+), German (B2 — уровень на сайте; в CV от мая 2026 указан B1, с тех пор прогресс), Russian (родной).
- Я готов делать **coding assignment на любой нужный стек**, чтобы показать работу с конкретной технологией — сам предлагаю это в письмах как способ снять риск для нанимающей стороны.
- Релокацию я формулирую конкретными городами рядом с офисом компании (например, для немецких компаний — Chemnitz, Leipzig, Dresden, Berlin), а не общим списком стран — так я делаю в письмах.

---

## 3. Образование

### Master's — Chemnitz University of Technology (TU Chemnitz), Web Engineering
- Я учился с 10/2023. Сайт указывает период дипломного проекта как «03/2025 – present» и помечает магистратуру как завершённую.
- **Статус — важное расхождение, требует уточнения перед использованием в cover letter:**
  - Память ассистента (запись от 2026-07-20): я лично подтвердил, что магистратура **завершена** ("заканчиваю" убрано из копирайта сайта). Дата защиты/финальная оценка не были названы.
  - Официальный транскрипт TU Chemnitz в файле (`TUC Transcript of records (ENG).pdf`), **дата выдачи 10.07.2026** (то есть выдан за 10 дней ДО этого подтверждения): показывает **Master-Arbeit (диплом) со статусом "AB" — "Module not completed"**, накоплено **85 из 120 ECTS**.
  - Возможные объяснения: (a) работа была защищена/сдана между 10 и 20 июля 2026, и обновлённый транскрипт ещё не запрошен; (b) я говорю о завершении в разговорном смысле (написание закончено, формальности продолжаются). **Уточнить точную дату защиты и финальную оценку, прежде чем писать "completed" с конкретной датой в cover letter.** Безопасная формулировка: "I completed my Master's in Web Engineering at TU Chemnitz in 2026" — без даты защиты и без GPA.
- Мой GPA по программе (немецкая шкала): **2.39**.
- Программа включала: Go, Redis, MongoDB, Cloud & Web-приложения, Software Service Engineering, model-driven software development, distributed systems, анализ software designs, кибербезопасность, Strategic IT Management.
- Оценки по модулям из транскрипта (шкала 1.0=отлично…5.0=провал):
  - Current Trends in Web Engineering — 3.3
  - Cloud & Web Anwendungen — 2.3
  - Software Service Engineering — 2.3
  - Datenbanken und Web-Techniken — 1.6 (моя лучшая оценка в программе)
  - Datenbanken und Objektorientierung — 2.7 (статус AB — не завершён на дату транскрипта)
  - Entwurf Verteilter Systeme (Distributed Systems Design) — **1.3** (сильнейшая оценка, "very good")
  - XML — 2.0
  - Mediencodierung (Media Coding) — 2.3
  - Strategic IT-Management — 3.7
  - Seminar Web Engineering — 3.0
  - Planspiel Web Engineering (симуляция/группа проект) — 2.4, 30 ECTS
  - Deutsch als Fremdsprache I (A1) — 2.7; Deutsch als Fremdsprache II (A2) — 3.0 — на момент этих курсов мой немецкий был на уровне A1–A2, сейчас B2.
- **Моя магистерская диссертация**: "Semantic Search Across Government Open Data" — семантический поисковый движок по открытым государственным данным, я построил его как 4 независимых микросервиса (детали в §5).

### Bachelor's — Higher School of Economics (HSE), Moscow — Software Engineering
- Я учился с 09/2019 по 06/2023. **Диплом мне присвоили 22 июня 2023**.
- Мой GPA: 2.2 (по немецкой шкале для сравнения) / **7.84 из 10** (родная 10-балльная шкала HSE — соответствует "хорошо/очень хорошо").
- Форма обучения — очная, программа рассчитана на 4 года/240 кредитов; фактически мне начислили 241 (основная программа) + 14 (факультативный английский) = **255 зачётных единиц**.
- Язык обучения: русский и частично английский.
- Мои сильные предметы (9–10/10, оценка A/A++): Algorithms and Data Structures, Analysis and Modeling of Business Processes, Computer Architecture, Safe Living Basics, Introduction into Software Engineering, Group Dynamics and Communication, Intellectual Property Law, History, Python workshops (Algebra, Math Analysis), Modern Information Technologies in Business, Applied Methods of Mathematical Statistics, Software Engineering Economics, IoT Ecosystems, исследовательские семинары ("Data Engineering", "Development of Cyber-Physical Systems", "Data and Knowledge Management" — все 9–10/10), Work Experience Internship — 10/10.
- Моё слабое место: Probability Theory and Mathematical Statistics — 5/10 ("удовлетворительно", C+) — единственная тройка в дипломе.
- **Моя дипломная работа (бакалавр)**: **"News Aggregator on Geographic Map"** / «Агрегатор новостей на географической карте» — 10 ECTS, оценка 7/хорошо (B+). На сайте я называю этот проект **Prospero** (см. §5) — я собрал и выпустил его примерно за месяц сфокусированной работы, с полноценным production-стеком observability.
- Программа в целом: Java, Python, SQL, QA, IoT, алгоритмы и структуры данных, теория массового обслуживания (queuing theory), архитектура ПО, БД, ОС, программирование, тестирование, анализ требований, управление проектами, agile, Microsoft Azure Cloud.

---

## 4. Опыт работы (хронология, самое свежее — первое)

### Infineon Technologies AG — Full-Stack Developer (**working student / Werkstudent**)
**09/2024 – настоящее время · Dresden, Germany · полупроводниковое производство**

Я строю с нуля Parking Guidance System (Parkdinsky/inner startup Infineon) — систему навигации по парковке, которая заменяет собой стороннего коммерческого поставщика и работает на собственных чипах Infineon PSoC Edge. Я отвечаю за весь стек целиком: backend, frontend и embedded computer vision прямо на устройстве. Конкретно я разработал: **страницу регистрации автомобильных номеров, административные страницы и экран настройки парковки с CV-алгоритмом, который автоматически определяет парковочные места.**

Я взял на себя **ownership поддержки проекта в проде**: сам разбираю **support tickets** по системе (в прошлой сессии это описывалось как "переписка с клиентами напрямую" — судя по черновикам писем, точнее говорить именно про support tickets), создаю задачи на улучшение и довожу их до конца — и **с августа (2026) проект не создаёт новых issue**. Кроме этого я участвовал в **изменении корпоративного deploy-флоу и risk management** — часть процесса не менялась **25 лет**, это отдельное, самостоятельное достижение, не только про код.

- **€480,000/год экономии** по сравнению с рыночными альтернативами.
- Приложение управления шлагбаумами: **8,000 пользователей, 3,000 monthly active users**.
- Конкретные фичи: страница регистрации номеров, админ-страницы, экран настройки парковки с CV-алгоритмом автоопределения парковочных мест.
- Embedded computer vision прямо на устройстве, написано на **C** (а не облачный инференс).
- Backend на **Python** и **C#**, frontend на **React** (JS/TS).
- Ownership продуктовой поддержки: с августа 2026 — ноль новых issue по проекту.
- Участвовал в изменении корпоративного deploy-флоу и risk management — часть процесса не менялась 25 лет.
- Часть кросс-функциональной команды на кампусе Infineon в Дрездене.
- Причина ухода (для писем): позиция working student, естественно заканчивается вместе с магистратурой. Notice period — 1 месяц.

Также я участвовал в **Thin[gk]athon "Distributed AI for Predictive Maintenance"** — 3-дневном внутреннем хакатоне Infineon (23–25.06.2026, совместно со Smart Systems Hub и ZEISS Digital Innovation) — и **занял 1-е место**.
- Мы построили edge-to-cloud AI-пайплайн для предиктивного обслуживания конвейерных линий на реальном тестовом стенде Infineon.
- Я использовал PSoC Edge для обнаружения аномалий звука/вибрации конвейера прямо на устройстве и выстроил цикл инкрементального обучения (устройство помечает аномалию → отчёт наверх → централизованное переобучение → downlink обновлённых весов).
- Также исследовал computer vision как сигнал позиционирования (точное измерение зазора между роликами конвейера).
- Благотворительный приз **€1,000** мы передали фонду против кибербуллинга.
- Стек: PSoC Edge, embedded systems, computer vision, machine learning, AWS/CNCF-экосистема, GenAI-ассистированное прототипирование.
- У меня есть **сертификат участия** (Smart Systems Hub, подписан CEO Michael Kaiser) и **личное рекомендательное письмо от тимлида команды** (см. §6).

### onlineTours — Full-Stack Developer
**08/2023 – 07/2024 · Remote · турагрегатор туров и отелей**

Я работал full-stack разработчиком в турагрегаторе, где отвечал за инфраструктуру A/B-тестирования и за новую библиотеку React-компонентов, постепенно заменявшую legacy-экраны в проде.

- Я разработал бизнес-логику **A/B-тестирования** в SEO и UX → **+11.63%** к ключевым метрикам.
- Серверная A/B-flag логика на **Ruby on Rails 7** с кешированием на **Redis** — каждое SEO/UX-изменение выкатывалось через тест, защищая конверсию бронирований.
- Поддерживал legacy UI на **React + Redux**.
- Собрал новую библиотеку компонентов: **React, TypeScript, Tailwind CSS, Jotai**, задокументировал в **Storybook**; она в проде с ноября 2023 и постепенно заменяла legacy-экраны один за другим.
- Деплой через **GitLab CI/CD** на **Docker & Kubernetes**.

### OZON Tech — Backend Developer
**07/2021 – 07/2023 · Moscow, Russia · крупнейший e-commerce в России**

Я работал backend-разработчиком в команде склада, внёс вклад в 2 проекта:

1. **Warehouse Search Engine** — я написал Go-микросервис, который ищет среди **200 миллионов товаров** на складе быстрее **5 секунд**. Использовал ElasticSearch (полнотекстовый поиск), Kafka (получение сущностей), покрыл unit- и нагрузочными тестами на моках, настроил observability через Prometheus + Grafana и трейсинг запросов через Jaeger, задеплоил на Docker & Kubernetes с кешированием Redis.
2. **Barcode Scanner Integration** — я интегрировал сканер штрихкодов через **WebSockets** (C#) с point-update сервисом на **PostgreSQL** для зоны возвратов OZON. Экономия — **€86,000**, сервис **до сих пор используется**. Также переписал Mattermost-бота мониторинга складских ошибок с Python на C#.

### WeDo.agency — Full-Stack Developer
**05/2020 – 06/2021 · Remote · бизнес-консалтинг и разработка**

За год в агентстве я сдал клиентам **13 стартапов и проектов** — от AI-инструментов до e-commerce платформ и Telegram-ботов, почти всегда в одиночку или с минимальной командой, беря идею клиента от нуля до рабочего продукта:

- E-commerce биддер рекламных ставок на Python — **€52,000/год** экономии клиенту (TDD, чистые функции).
- AI-поддержка для 5 магазинов Shopify — **660 обращений/месяц** (построено на Gorgias + Shopify API).
- AI-перевод и озвучка видео + программный SEO на Next.js — **первые 150 пользователей** через 60×59=3,540 программно сгенерированных лендингов языковых пар.
- AI-плагин генерации музыки для ChatGPT (Audioland) — трек генерируется **менее чем за 1 минуту**; часть ставки на IPO speechki.com на Кипрской бирже (сорвана политикой монетизации плагинов OpenAI).
- Блог и лендинг на GatsbyJS + GraphQL для строительной компании (17 объектов).
- Типографический сайт на Redux + Firebase, 4 опции кастомизации заказа.
- E-shop на React для перепродажи одежды с китайского маркетплейса Poizon (~200 товаров).
- **Админ-панель для NCahoots, Inc.** (Silicon Valley стартап по подаркам) — я руководил командой из 3 разработчиков, внедрил React, настроил linter/formatter/husky для качества кода. (Есть письменный отзыв от CEO NCahoots, Fedor Datnov — **10/10**, см. §6.)
- Real-time дашборд на Angular для 30 батарей метро (часть тендерной заявки).
- Программа контроля активности сотрудников на Angular, 9 модулей трекинга.
- Frontend на vanilla JS — визуализация обучения 2 нейросетей (MLP и RBF).
- Проект крипто-майнинга: дашборд, лендинг, магазин на 150 игровых предметов (React).
- Онлайн-игра Horsium (см. §5) — бэкенд на NestJS + MongoDB.
- 3 Telegram-бота на Python (aiogram) + PostgreSQL: я построил архитектуру, мониторинг, GitHub CI/CD с Docker-кешем (**деплой за ~10 секунд**), хранение изображений в AWS S3 (Minio), Redis для токенов/состояния.

---

## 5. Остальные проекты (фриланс, хакатоны, pet-проекты, образовательные) — самые содержательные

*(Полный список — 30+ проектов в `src/data/projects.ts`. Ниже — самые весомые для cover letter; не факт, что понадобятся все, но лучше иметь под рукой.)*

**Master's thesis — Semantic Search Across Government Open Data** (TU Chemnitz, 03/2025–2026)
- Я спроектировал архитектуру из 4 независимых Python/FastAPI сервисов — оркестратор, 4 контейнера с моделями эмбеддингов (**BAAI bge-m3, multilingual-e5-base, jina-embeddings-v3, LaBSE**), реранкер (**jina-reranker-v3**, готовая модель, не дообученная — это осознанное решение: мой научный вклад в **дизайне retrieval-пайплайна и методике бенчмарка**, взвешенная оценка релевантности по 4 моделям × режимам поиска).
- **Qdrant** — гибридный dense+sparse поиск через reciprocal rank fusion. MongoDB — остальные данные.
- Frontend на Vite/React, стримит пайплайн поиска вживую через Server-Sent Events.
- Есть демо-видео и 4 отдельных GitHub-репозитория (frontend/backend/embedder/reranker).

**Prospero — News Aggregator** (Bachelor's Thesis, HSE, 03/2023–06/2023)
- Мой первый проект на **Go** (Gin), PostgreSQL, ElasticSearch (поиск+автодополнение), gocron (плановый сбор RSS).
- Frontend Next.js/React (Mantine UI, RTK Query, Yandex Maps) + отдельная админка управления источниками.
- Полный observability: ELK (логи), Jaeger (трейсинг), Prometheus/Grafana (метрики), Яндекс.Метрика.
- CI/CD автодеплой на арендованный Docker-хост при каждом push в main.
- Оценка за диплом: **B+** (7/хорошо, см. диплом HSE — "News Aggregator on Geographic Map").

**Chemnitz Map — Project Assignment** (TU Chemnitz, 1-й семестр, 11/2023–01/2024)
- Я делал этот проект в паре с сокурсницей **Anastasiia Zibrova** — backend и инфраструктура на мне, Leaflet-фронтенд на ней. ⚠️ **Новый факт (из черновика письма в Staffbase, 2026-08-19): Anastasiia сейчас работает в Staffbase** — то есть это университетский проект с человеком, который стал инсайдером именно в Staffbase (см. §6).
- Реальные открытые данные Хемница (детсады, школы, молодёжные службы).
- Backend: Go (Gin), MongoDB, JWT + Google OAuth2, Swagger. Frontend: React/Vite, Leaflet + routing, TanStack Query, Formik/Yup, Tailwind.
- Полный стек observability: **Prometheus, Grafana, Loki, Jaeger, Sentry** — необычно полно для учебного задания.

**Semki — Staffbase "Code the Future" AI Challenge** (хакатон, 10–11/2025)
- RAG-платформа поиска сотрудников для крупных организаций (устранение "силосов" между отделами).
- Go (Gin) + MongoDB + **Qdrant** (векторный поиск) + Redis + OpenAI API (эмбеддинги, RAG retrieval).
- Frontend: React 19 + TypeScript, Mantine UI, Zustand, TanStack Query.
- Полный observability на Kubernetes (Prometheus, Grafana, Loki, Jaeger).

**Firebase Extension — New-User Slack Notifier** (личный проект, действующий, с 09/2024)
- Я опубликовал его в официальном маркетплейсе extensions.dev, сейчас он **установлен в 90 Firebase-проектах**.
- TypeScript Cloud Function на Firebase Auth trigger, настраиваемый Slack webhook + шаблон сообщения.

**Horsium — симулятор коневодства** (фриланс, действующий, с 08/2025)
- Реалистичная генетика лошадей, идея и продукт-видение — **Anastasia Zibrova** (основательница, сейчас также сотрудница Staffbase — см. §6), я делаю backend (NestJS + MongoDB).

**Другие показательные кейсы (для нужного контекста в письме):**
- **FassonAPI** — моя курсовая 1-го курса HSE, биометрическая веб-аутентификация в стиле FaceID (ASP.NET MVC, Azure Face API, WebRTC) — **признана одним из лучших студенческих проектов HSE** (мне сообщили о награде спустя 2 года после сдачи). Именно тогда освежённые C#-навыки напрямую помогли мне пройти собеседование в OZON.
- **AI-Character Telegram Bots** — сложный self-hosted CI/CD (GitHub Actions runner, Docker layer caching, ~10 сек деплой), интеграция Whisper для транскрибации голоса, обход рекламных ограничений Facebook через self-hosted клон t.me-страницы. Закрыт из-за экономики Telegram Stars/TON, не из-за продукта.
- **React Redux docs — перевод на русский** — я прошёл официальную университетскую практику, опубликовал перевод на поддоменах js.org, написал статью на Хабре о процессе.
- **Universal Insight Dashboard** — важный урок из моего опыта: скоуп вырос с ₽7,000 до ₽100,000 без письменного договора, оплату я получил не полностью → с тех пор всегда фиксирую scope и контракт письменно до старта.
- **iPhone Repair & Resale** (2018, школьные годы) — моя первая бизнес-попытка, ремонт/перепродажа iPhone, закрыл после неудачной партии запчастей.

---

## 6. Рекомендации и рефереры (с контактами — для "available upon request" или прямых цитат)

| Имя | Роль | Компания | Контекст | Ключевая цитата/суть |
|---|---|---|---|---|
| **Waldemar Kindler** | CEO | Think Ahead Technologies GmbH | Тимлид на хакатоне Thin[gk]athon, 06/2026 | "Ich empfehle Herrn Popov uneingeschränkt" (безоговорочно рекомендую). Хвалит embedded-экспертизу, Go, **AI-assisted engineering speed far above the norm**, креативность, командность. Экс-сотрудник Schwarz Gruppe (2015–2020) — пишет с прицелом на Schwarz Digits. Тел.: +49 1578 5161 921, waldemar.kindler@think-ahead.tech. Датировано **17.08.2026**. |
| **Fedor Datnov** | CEO | NCahoots, Inc. (Кремниевая долина) | Руководитель стажировки, 07/2021 (Amazon-парсер, JWT-auth, фронтенд-админка) | Оценка **10 из 10**. "Vitaly ... demonstrated his skills as a responsible team leader," руководил командой из 5 человек, всегда вовремя, задание выполнено полностью. |
| **Anastasiia Zibrova** | сейчас — сотрудница **Staffbase** (роль/должность не подтверждена, уточнить) | Staffbase (текущее место работы) | Дважды работали вместе: университетский проект **Chemnitz Map** (§5, она — Leaflet-фронтенд, я — backend/инфраструктура) и её личный проект **Horsium** (§5, она — основательница/продукт, я — backend). В обоих случаях я был backend-инженером. | Использовать только при отклике **в Staffbase** — это единственная компания, где она инсайдер. Перед использованием стоит уточнить: актуальна ли ещё её позиция в Staffbase, готова ли она дать формальную рекомендацию. |

---

## 7. Полный стек навыков

**Backend**: Go (expert, 3 года — Kafka consumers, REST API, высоконагруженные микросервисы), Python (expert, 2 года — FastAPI, CV-интеграции, data pipelines), C# (proficient, 3 года — device management, WebSocket, .NET), Node.js/NestJS (proficient, 3 года), Ruby on Rails (proficient, 1 год), C (embedded firmware, 2 года), Java (Spring Boot — из курсовых; туториал на Хабре с 27K просмотров, см. §9), **Kotlin** (прошёл туториал, стек не боевой — честно позиционируется как "готов учиться", подходящая фраза для Kotlin-ориентированных компаний типа JetBrains: *"I would appreciate a chance to learn Kotlin within [company]"*).

**Frontend**: React (expert, 5 лет — hooks, RSC, сложный state management), TypeScript (expert, 6 лет — strict mode, generics), Next.js (expert, 3 года — App Router, SSG/SSR/ISR, middleware, i18n), Tailwind CSS (expert, 3 года — v4), Redux/RTK, Jotai, Zustand, Angular (1 год), GatsbyJS, Vue, Astro, Storybook.

**Базы данных**: PostgreSQL (expert), Redis, ElasticSearch, MongoDB, Qdrant (vector DB), Firebase.

**Инфраструктура**: Docker (expert, 4 года), Kubernetes (proficient, 2 года), Helm, GitHub Actions (expert), GitLab CI/CD, Kafka (proficient, 2 года), RabbitMQ, Docker Registry (GHCR/ECR/Harbor).

**Observability**: Prometheus, Grafana, Jaeger, ELK, Loki, OpenTelemetry.

**AI/ML** (личный фокус последних лет): LLM Integration (proficient, 2 года — prompt engineering, GPT-3/4 API, RAG), RAG-пайплайны, Qdrant, Embedding models (text-embedding-ada-002, sentence-transformers, multilingual), LangChain, Ollama (локальный инференс — Llama 3, Mistral, Qwen), MCP Server (строит tool-use серверы), Context Engineering, Hugging Face (Transformers, fine-tuning), Computer Vision (ANPR, occupancy detection, embedded edge inference), **Claude Code (expert, сертифицирован Anthropic)**, GitHub Copilot (expert, 2 года).

**Методологии/подходы**: SOLID, KISS, DRY, ACID, TDD, DDD, FSD, Agile, Kanban, Scrum, Microservices.

**Тестирование**: unit tests, load tests, Jest, Vitest, Cypress, Selenium, Playwright (упомянут в черновиках писем 2026-08-19, не было в исходном списке навыков сайта), E2E через Puppeteer. TDD применял на OZON.

**API-документация**: OpenAPI, Swagger, Postman, gRPC, GraphQL, WebSockets.

**ОС/инструменты**: Linux (Ubuntu, Debian), macOS, Bash, VSCode, IntelliJ, PyCharm, GitHub, GitLab, Jira, Notion, Confluence, DataGrip.

**Облака**: AWS, Azure, Google Cloud (Storage), RunPod, Railway.

---

## 8. Мои собственные формулировки (готовые цитаты для писем)

Эти ответы я уже сформулировал сам для FAQ на сайте — их стоит переиспользовать почти дословно вместо того, чтобы придумывать заново:

- **Моё самое большое профессиональное достижение**: "Building Infineon's Parking Guidance System from the ground up — backend, frontend, and the embedded computer vision — replacing a paid vendor and now serving 8,000 users."
- **Что меня мотивирует**: "Building things that create measurable impact, plus a genuine love of technology — it's what got me into engineering in the first place."
- **Как я использую AI в разработке**: "Claude Code paired with TDD — tests are what make AI-generated code trustworthy, not just fast. Also familiar with structured agentic workflows like GSD and Superpowers for keeping AI-assisted development disciplined."
- **Как я остаюсь в теме индустрии**: "Hands-on experimentation — I hold Anthropic certifications in the Claude API/SDK and Claude Code, and I write the occasional article (the last one hit 5K+ views across Habr, Dev, and Medium)."
- **ROI, который я принёс**: "€480K/year in savings at Infineon, €86K at OZON Tech, and an 11.63% metric uplift at onlineTours."
- **Мой опыт 0→1**: "I built Infineon's Parking Guidance System from the ground up: backend, frontend, and the embedded computer vision, taking it from an idea to a live system used by 8,000 people."
- **Работа с нетехническим основателем**: "At WeDo.agency I shipped 9 startup projects working directly with founders, translating business goals into technical scope."
- **Как я работаю с размытыми требованиями**: "I ship the smallest version that tests the real assumption, then let actual usage tell me what to build next — that's how I scope every MVP."
- **Как я двигаюсь быстро не ломая систему**: "Automate the guardrails instead of skipping them — I've gotten CI/CD pipelines down to under 10 seconds per deploy."
- **Что я считаю самым важным качеством для успеха**: "Speed — shipping fast and iterating matters more today than getting the design perfect upfront."
- **Откуда у меня интерес к программированию** (About page, bio1): *"I got into programming not through some career plan, but out of a romantic pull toward startup culture — partly inspired by the sitcom Silicon Valley. I'm a geek, I love technology, and that's why I decided to build my life around it."*
- **Мой текущий фокус** (bio4): *"My current focus is on the intersection of distributed systems and AI — building things that are fast, reliable, and actually solve business problems."*

---

## 9. Личность, интересы, soft skills (для "culture fit" абзацев)

- **Хобби**: я увлекаюсь шахматами (профиль на chess.com показан на сайте), катаюсь на велосипеде, хожу в походы (Саксонская Швейцария, Snezka/Sněžka, Австрия), катаюсь на горных лыжах, танцую **Lindy Hop** (свинг-танцы) и занимаюсь **HEMA** (историческое европейское фехтование — на сайте есть фото "Fencing").
- **Менторство**: я наставлял **4 разработчиков**.
- **Писательство**: я пишу статьи на IT-темы.
  - Туториал про **Java Spring** на Хабре — **27,000 просмотров**. ⚠️ Новый факт из моего черновика письма в JetBrains (2026-08-19), не было в CV/памяти ранее. Ссылку на статью нужно найти/уточнить.
  - Статья про деплой и мониторинг-инфраструктуру (на основе магистратуры) — **5,000+ просмотров** на Habr, Medium и LinkedIn (в черновике для JetBrains указаны ссылки RU|EN). ⚠️ **Расхождение**: в CV эта статья с ~5K просмотров описана как *"about tech problems of startups on the path to enterprise"*, а в черновике для JetBrains — как *"educational article on deployment and monitoring infrastructure based on my Master's studies"*. Это может быть одна и та же статья, описанная по-разному под разные аудитории, либо две разные статьи с похожими цифрами. **Уточнить, прежде чем указывать тему статьи в письме.**
- **Переводы**: я перевёл официальную документацию React Redux на русский (университетская практика, 2022).
- **Языки**: English fluent, German B1→B2 (прогресс за время жизни в Германии), Russian native.
- **Домашнее животное**: у меня есть кошка по имени **Laska**.
- **Путешествия**: Россия, Германия, Чехия, Австрия, Испания, Нидерланды, Черногория, Италия, Узбекистан, Турция. Я прожил "всю сознательную жизнь" в двух городах — Москве и Хемнице.
- **Лидерство**: я неоднократно руководил небольшими командами (3–5 человек) на фрилансе и стажировках — NCahoots (3 разработчика), тендер батарей метро (3 разработчика), FlyBoots (3–4 человека), Universal Insight (3 разработчика), Prospero-курсовая-хакатон (соло, но координировал).
- **Уроки, которые я вынес и формулирую как ценность** (хорошо смотрится как "рефлексивность/зрелость" в письме): важность письменного scope до старта (Universal Insight), холодный outreach без аудитории плохо конвертируется (Effects/parallax editor), на хакатоне питч важнее кода (AMC Makeathon 2020).

---

## 10. Важные предупреждения перед использованием в реальном письме

*(Эти пункты — заметки для того, кто пишет письмо, а не текст самого письма.)*

1. **Уточнить текущий город проживания** — CV указывает Berlin, а сайт утверждает, что я живу в Хемнице, закончив магистратуру в TU Chemnitz. Не смешивать оба варианта в одном письме.
2. **Не заявлять точную дату защиты/финальный GPA магистратуры** без свежего подтверждения — официальный транскрипт на руках устарел относительно моего собственного заявления о завершении (см. §3).
3. **Немецкий уровень** — B1 в CV (дата CV: май 2026), B2 на сайте. Если CV прикладывается вместе с cover letter, использовать актуальную (более высокую) заявленную оценку только после подтверждения прогресса; иначе — B1, чтобы не завышать против собственного CV.
4. Если письмо адресовано **Schwarz Digits** конкретно — обязательно использовать контекст рекомендации Kindler (§6), это единственный по-настоящему "инсайдерский" сигнал в профиле.
5. Компания "**dunlimited**" (freelance-клиент, Shopify AI support, TripleWhale) не фигурирует в CV от 07.05.26 — это более новые ангажементы (проект `wedo-shopify-ai-support` датирован 03/2026–04/2026, то есть после даты CV). Если используется CV как приложение, эти проекты стоит упомянуть отдельно в cover letter как "recent freelance work" — CV может выглядеть устаревшим на этом фоне.
6. Формулировка про ownership поддержки в Infineon (§4) добавлена с моих слов в этой сессии — конкретные детали (какой канал переписки, какой объём обращений, "клиенты" vs. "support tickets") не подтверждены документами. Если для письма нужны точные цифры/детали — уточнить перед использованием.
7. **Werkstudent-статус в Infineon** (см. §4) — новый факт из черновиков писем, не подтверждённый CV/сайтом/памятью. Перед использованием стоит явно перепроверить, точно ли это working student контракт, и уточнить актуальный срок окончания магистратуры (в одном черновике — "через месяц", в другом — "через несколько месяцев").
8. **27,000 просмотров у статьи про Java Spring на Хабре** (§9) — взято из черновика письма в JetBrains, ссылки на статью нет. Нужно уточнить ссылку и точную цифру перед использованием.
9. **Тема статьи с ~5K просмотров** описана по-разному в CV ("про стартапы на пути к enterprise") и в черновике письма в JetBrains ("про деплой и мониторинг-инфраструктуру") — уточнить, прежде чем называть тему в письме (см. §9).
10. **Anastasiia Zibrova в Staffbase** (§5, §6) — упомянута только в одном черновике письма, не подтверждена другими источниками. Перед использованием в реальном письме уточнить, актуальна ли эта информация и готова ли Anastasiia выступить рекомендателем.

---

## 11. Готовые блоки и черновики писем (референс стиля и переиспользуемый текст)

### 11.1. Готовый параграф про Infineon (переиспользуется почти дословно в обоих черновиках)

> *"Currently I work at Infineon Technologies on an inner startup. As a fullstack I developed the page for car's plate registration, admin pages and parking setup screen with CV algorithm to automatically identify parking slots. I feel the ownership for the service: I resolved the support tickets, created tasks to improve it, and since august this project doesn't create new issues. Also I have participated in changing a corporate deploy flow and risk management – parts of the process did not change for 25 years. I'm leaving because that's a working student position and I will finish my master program in a month [or: in a few months]. And I have a notice period of 1 month."*

Использовать как основу почти в любом письме — менять только срок до конца магистратуры на актуальный.

### 11.2. Черновик №1 — Staffbase (Backend, целиком, для образца стиля и структуры)

> Dear Mark Crorkin,
> I am writing to express my enthusiasm for the position at Staffbase.
> I work with relevant technologies for Staffbase: Go, ElasticSearch, PostgreSQL, Docker, K8s and monitoring infrastructure. I gained experience with them during my internship at OZON Tech and played a role in building a new logistics system based on microservices to replace the outdated monolithic one.
> Also I got a recommendation from the current Staffbase employee Anastasiia Zibrova. We worked together on a University project and Anastasiia's personal project. Both times I was a backend engineer.
> According to tech stack, I was working with React, TypeScript, Go, MongoDB, Docker, Selenium and Playwright. When I was working in enterprise e-commerce OZON I followed Test Driven Development. Golang: ~3 years. Started in 2021 (OZON Tech), used in production microservices with Elasticsearch, Kafka, Redis, Kubernetes, monitoring. Check out some of my projects on Golang: Staffbase's Hackathon, university project.
> I worked with Java on university projects, I made backend on Spring Boot. Also I used to work with C#, that stole a lot of syntax from Java:) I've done a tutorial on Kotlin. And I would appreciate a chance to learn Kotlin within Staffbase. I do have successful experience of using different stacks (MERN, python FastAPI etc) – I can learn it fast. Also I'm willing to make a Coding assignment from the team to showcase the work with any technology needed.
> I have also worked on several startups and gained valuable insights into team collaboration. This entrepreneurial background has honed my ability to adapt quickly and deliver impactful solutions. This resonates with me with the company's values such as Ownership, Care and Grow.
> Currently I work at Infineon Technologies on an inner startup. As a fullstack I developed the page for car's plate registration, admin pages and parking setup screen with CV algorithm to automatically identify parking slots. I feel the ownership for the service: I resolved the support tickets, created tasks to improve it, and since august this project doesn't create new issues. Also I have participated in changing a corporate deploy flow and risk management – parts of the process did not change for 25 years. I'm leaving because that's a working student position and I will finish my master program in a month. And I have a notice period of 1 month.
> I am a Master's student at TU Chemnitz. Based on my studies, I authored an educational article on deploy and monitoring infrastructure that garnered 5k views (English link). In my master thesis I worked with AI: I built a RAG system for Government Open Data.
> I am open to working in Chemnitz, Leipzig, Dresden and Berlin and willing to relocate if needed.
> Thank you for considering my application!
> Sincerely,
> Vitalii Popov

⚠️ Замечание по фактам в этом черновике: упоминается "internship at OZON Tech" и "building a new logistics system based on microservices to replace the outdated monolithic one" — это отличается от формулировки в §4/CV ("Backend Developer... contribution to 2 projects"), не "internship" и без явного "monolith → microservices" нарратива про 200M search engine. Похоже на упрощение/адаптацию под контекст письма, а не на новый факт — **не переносить "internship" и "monolith replacement" в §4 без подтверждения**, это может быть просто вольная формулировка черновика.

### 11.3. Черновик №2 — JetBrains (Backend Customer Success Engineer, целиком)

> Dear Hiring Manager,
> I am writing to express my enthusiasm for the Backend Customer Success Engineer position at JetBrains. As a developer who has used JetBrains tools throughout my career, the opportunity to help build innovative AI-driven products is incredibly exciting.
> I am constantly using Claude Code, familiar with MCP concepts (I have certificates from Claude Academy). I use TDD with AI coding to make the code reliable. I adopted AI to make automatic support for 5 Shopify stores.
> In my master's thesis at TU Chemnitz, I built a RAG system for Government Open Data, gaining hands-on experience with AI-driven applications. During my work at WeDo.agency, I developed an AI video translation and dubbing application using Next.js and Python, which brought the first 100 users as guerrilla marketing:)
> I have extensive full-stack expertise in TypeScript, Node.js, Next.js, and React on the frontend, combined with solid backend experience in C#, Python, Golang. I work regularly with PostgreSQL and MongoDB, and have deployed production systems using Docker, Kubernetes.
> I bring a strong product development mindset. At Infineon Technologies, I'm working on an inner startup building a Parking Guidance System that saves €480,000 and that serves 8,000 users with 3,000 MAU. I developed the page for car's plate registration, admin pages and parking setup screen with CV algorithm to automatically identify parking slots. I feel the ownership for the service: I resolved the support tickets, created tasks to improve it, and since august this project doesn't create new issues. Also I have participated in changing a corporate deploy flow and risk management – parts of the process did not change for 25 years. I'm leaving because that's a working student position and I will finish my master program in a few months. I have a notice period of 1 month.
> My experience with high-scale systems comes from OZON Tech, where I built a Go microservice to search among 200 million items within 5 seconds using ElasticSearch, Kafka, Redis, and comprehensive monitoring with Prometheus and Grafana.
> Quality and testing are integral to my workflow. I have experience with Jest, Vitest, Cypress, Selenium, and Playwright, and followed TDD practices at OZON. At onlineTours, I deployed Storybook using GitLab CI/CD on Docker and Kubernetes, improving component development workflow.
> I also share JetBrains' commitment to knowledge sharing. I authored a tutorial on Java Spring that garnered 27,000 views on Habr, and an educational article on deployment and monitoring infrastructure based on my Master's studies that received 5,000 views across Habr, Medium, and LinkedIn (RU | EN)
> I would be thrilled to contribute to JetBrains' mission of creating tools that make developers more productive. Thank you for considering my application.
> Sincerely,
> Vitalii Popov

⚠️ Замечание по фактам: "first 100 users" здесь — а в §5/CV/сайте для этого же AI dubbing проекта (Dubbing/wedo-ai-video-dubbing) везде указано **150 первых пользователей**. Это, скорее всего, опечатка/округление в черновике письма, а не новый факт — **при использовании в новых письмах брать 150, если явно не будет сказано иначе.**

**Также в обоих письмах упоминаются инструменты тестирования Selenium и Playwright** — Playwright не фигурировал явно в §7 (там был Selenium, Cypress, Puppeteer). Добавлено в §7 как факт из писем.