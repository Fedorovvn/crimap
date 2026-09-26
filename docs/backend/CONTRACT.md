# Контракт события Crimap 2.0

Источник истины — `backend/contract.mjs`. Машиночитаемые схемы: `contracts/v2/event.schema.json`, `extraction.schema.json`, `translation.schema.json`. Перегенерация: `pnpm contract:generate`. Старый снимок UI сохранён в `contracts/v1/`; он не является входным форматом нового сборщика.

Проверено по текущим компонентам карты, карточки события, участников, контекстных ссылок, ориентировок и правовой строки. Полнота контракта означает возможность выразить все блоки, а не требование выдумать недостающие сведения.

## Поля редакционной EN-версии

| Поле | Тип / допустимые значения | Использование |
|---|---|---|
| title, summary | непустые строки | Заголовок на фото или над текстом, краткое описание |
| type | traffic-accident, assault, fight, robbery, accident, fire, rescue, missing-person, transport-disruption, weather, other | Тип происшествия, подпись и иконка |
| status | reported, investigating, suspects-detained, wanted, resolved, closed, unknown | Текущий статус события |
| signals | массив: death, injury, suspect-detained, suspect-wanted | Череп, медицинский крест, наручники, розыск; могут сосуществовать |
| occurredAt | ISO 8601 с часовым поясом или null | Время происшествия, возраст для повторных проверок |
| timePrecision | exact, hour, day, unknown | Не выдавать день за известную минуту |
| location | city, district?, label, precision, latitude?, longitude? | Карта и строка под хронологией |
| location.precision | exact, street, district, city, unknown | Точность места, независимая от точности времени |
| caseReferences | строки | Официальные номера дел, если опубликованы |
| participants | массив Participant, максимум 50 | Подозреваемые, потерпевшие, другие участники |
| context | массив ContextClaim | Атрибутированные предположения и сообщения очевидцев |
| legal | массив LegalAssessment | Статья, санкция и справочное пояснение |
| updates | key, publishedAt, title, detail, sourceUrl | Хронология, включая источник каждого обновления |
| media | imageUrl, sourceUrl, outlet, credit, caption, isSensitive, rights | Фотографии, авторство и скрытие чувствительного изображения |
| evidence | field, documentId, quote, attribution? | Точные оригинальные цитаты для каждого факта |

`rights`: unknown, link-only, licensed, permission, public-domain. Загрузка статьи не означает разрешение на повторное использование фото. Автоизвлечение оставляет unknown; публикация изображения требует редакционно подтверждённого права. URL фото проверяется по изображениям прочитанной страницы.

Все массивы обязательны, допустимы пустые. Неизвестные необязательные атрибуты отсутствуют. `occurredAt=null` требует `timePrecision=unknown`. Координаты должны присутствовать парой. Публикация на текущую карту требует известной даты и проверенных координат: сборщик не подставляет время публикации или выдуманный адрес.

## Участник

Обязательные поля: `key`, `role`, `label`, `status`, `profile`, `sourceUrl`, `sourceLabel`, `asOf`. Дополнительно: `note`, `wantedNotice`.

- `role`: suspect, victim, convicted, involved.
- `status`: detained, wanted, in-custody, charged, convicted, released, deceased, injured, unknown.
- `profile.kind=person`: name?, gender? (male/female), age? (0–120), ageGroup? (child/adult/older), citizenship? ({code: ISO 3166-1 alpha-2, name}). Неизвестное гражданство не отображается.
- `profile.kind=group`: count?, gender?, leader? ({person, status, sourceUrl}). UI раскрывает известную группу до пяти человек в отдельные нейтральные представления; это не создаёт новые установленные личности. От пяти — группа, при наличии данных выделяется лидер.
- `wantedNotice`: description, sourceUrl?, isDemo? (для настоящих данных допустимо только false). Только при status=wanted. Аватар выбирает UI из возраста/пола, он не является фотографией человека и не доказывает внешность.

Роль и статус не взаимозаменяемы. Задержание не равно заключению под стражу или приговору. Несколько людей в одном событии могут иметь разные статусы. У каждого атрибута личности и процессуального статуса есть собственная цитата. Предположительное гражданство, занятие или жилищное положение хранится в context, а не как установленный профиль.

## Контекст и источники

`subject`: {kind:event} или {kind:participant, participantKey}. `topic`: motive, circumstances, citizenship, occupation, visitor-status, housing-status, appearance. `text` — законченная атрибутированная фраза для существующих текстовых ссылок. `origin`: source/model; `verification`: unverified/corroborated/disputed/retracted; `reviewStatus`: pending/approved; `asOf`, optional `rationale`.

`evidence[]`: kind (official/media/eyewitness/social), label, url, attribution?, relation (supports/disputes/background). Тип источника устанавливает реестр доменов. Статья СМИ со ссылкой на полицию остаётся статьёй СМИ. Цитаты проверяются на буквальное присутствие в сохранённой версии документа; это проверка происхождения, а не автоматическое доказательство логической истинности каждого вывода.

Автопарсер не делает предположения о личных характеристиках. Поддержанный UI формат гипотезы модели ограничен обстоятельствами события, требует объяснения и редакционного одобрения. Неподтверждённое не превращается в «официальное» от количества перепечаток.

## Правовой блок

Совместим с `app/legal-model.ts`: key, jurisdiction=HU, subjectLabel, participantKey?, offense, qualification (official/reported/possible), stage (investigation/charged/trial/judgment), source, statuteMatch (source-explicit/editorial), statutes[], penalties[], condition, reviewStatus, checkedAt.

Статья: code (criminal/petty-offense/administrative), act, section, url, versionDate. Санкции: imprisonment (years/months), fine (HUF), detention (days), community-service (hours), life-imprisonment, driving-ban, other. Для числовых санкций max и необязательный min; для последних двух — text.

В карточке из этого формируется нейтральный бэдж состава, срок слева, ссылки на статьи справа и пояснение в tooltip. Квалификация органа и редакционное сопоставление с законом различаются. Новое сопоставление требует проверки. Справочник `backend/verified-laws.json` начинается с трёх уже проверенных в проекте составов; он не покрывает всё венгерское право.

## Хранение и публичная проекция

Служебные поля БД: id, slug, first_seen_at, revision, published_revision, state, review_reason, next_check_at, last_checked_at. Документы содержат URL, реестровый источник, дату первой загрузки, дату публикации, оригинальный язык, текст, хэш и все версии. Наблюдения связывают событие с конкретным хэшем документа.

Публичный формат остаётся совместим с текущим IncidentView: id, slug, title, category, status, verification, district, locationLabel, locationPrecision, latitude, longitude, occurredAt, summary, updatedAt; sources[], updates[], media[], participants[], context[], legal[]. Добавлены необязательные `eventType` и `signals`: новые карточки используют коды, старые сохраняют совместимость. `incident_metadata` дополнительно хранит версию контракта, редакции и точность времени. Индексы источников и фото уникальны внутри события, поэтому одна публикация может описывать несколько происшествий.

EN — канонический редакционный текст; RU — версия конкретной редакции; HU — оригинальные документы и цитаты. При переводе меняются только разрешённые текстовые пути, числа и структура остаются неизменными. Полная локализация оболочки сайта EN/HU является отдельной задачей, переключатели пока не реализуют её.

## Служебные данные автоматической подготовки

Публичный контракт 2.0 не изменён. Координаты и точность уже входят в location, ссылки/подписи/атрибуция/чувствительность — в media. Полный текст доказательств и оригинальный язык остаются в документах источников.

В приватной БД отдельно хранятся preparation (провайдер геокодирования, точность, ссылка на OSM, объяснение приблизительной метки, сохранённые публичные фото), triage_log (решение/способ/причина), campaigns (период и общий бюджет), archive_pages (охват), usage.campaign_id и events.auto_repairs. Это операционные данные, не новые факты о происшествии. Отбор по словам не назначает категорию, тяжесть или статус: их извлекает Flash с цитатами, затем проверяет Pro.

Административная проекция различает новое событие и обновление по public_id; обе операции требуют проверки текущей редакции. Для media.rights значение unknown сохраняется честно: показ внешней ссылки с атрибуцией не меняет его на licensed. link-only исключается из встраивания.
