# Запуск и обслуживание сборщика

Node.js 24. Зависимости устанавливаются обычным `pnpm install --frozen-lockfile`. Локальный и серверный код одинаковый. Секреты не входят в Git. Образец настроек: `backend/collector.env.example`.

## На сервере

- Исходники: `/srv/crimap/app/backend`.
- Оригиналы, очередь, редакции, переводы, проверки и расходы: `/srv/crimap/data/collector.sqlite`.
- Публичные карточки: `/srv/crimap/data/incidents.sqlite`.
- Настройки и ключи: `/etc/crimap/collector.env`, root:crimap, 0640.
- Служба: `crimap-collector.service`; сайт продолжает работать отдельно в `crimap.service`.
- Список предложений моделей: `/srv/crimap/data/field-requests.md` и `.json`.

Установка после получения новой версии кода:

```sh
cd /srv/crimap/app
sudo -u crimap /srv/crimap/runtime/node/bin/node backend/cli.mjs migrate-public --db /srv/crimap/data/collector.sqlite --public-db /srv/crimap/data/incidents.sqlite
sudo install -m 644 backend/crimap-collector.service /etc/systemd/system/crimap-collector.service
sudo systemctl daemon-reload
sudo systemctl enable --now crimap-collector
sudo systemctl status crimap-collector --no-pager
```

Перед миграцией сделать SQLite backup. Для первого запуска секрет заполняется вне репозитория. Не печатать файл окружения в чат или журнал.

```sh
sudo journalctl -u crimap-collector -n 30 --no-pager
sudo -u crimap /srv/crimap/runtime/node/bin/node backend/cli.mjs status --db /srv/crimap/data/collector.sqlite
sudo systemctl stop crimap-collector
sudo systemctl start crimap-collector
```

`status` без загруженного env показывает modelConfigured/searchConfigured=false для текущего процесса CLI; это не означает, что работающая systemd-служба не получила свой EnvironmentFile. Статусы заданий, ошибки и расходы читаются из общей БД.

## Локально

Секреты задаются переменными процесса или Node `--env-file` с игнорируемым `.env.collector`. Для локального запуска изменить пути на `data/collector.sqlite` и отдельную локальную публичную БД. Не указывать серверную БД в локальном env.

```sh
node --env-file=.env.collector backend/cli.mjs status
node --env-file=.env.collector backend/cli.mjs run --limit 10
node --env-file=.env.collector backend/cli.mjs worker
```

`run` ограничивает число заданий; `worker` выполняет очередь до остановки. Отсутствие DeepSeek-ключа вызывает явную ошибку при модельном запросе. Без Brave-ключа продолжаются прямые ленты и перепроверка прочитанных страниц; расширенный поиск помечается недоступным.

## Проверка и публикация одной редакции

Команды ниже запускать в окружении приложения, где заданы пути и ключ; на сервере можно использовать `sudo systemd-run --wait --pipe --collect -p User=crimap -p WorkingDirectory=/srv/crimap/app -p EnvironmentFile=/etc/crimap/collector.env /srv/crimap/runtime/node/bin/node backend/cli.mjs ...`.

```sh
node backend/cli.mjs ingest https://www.police.hu/EXACT-ARTICLE-URL
node backend/cli.mjs show 1 --file data/event-1.json
node backend/cli.mjs translate 1
node backend/cli.mjs review 1
node backend/cli.mjs revise 1 --file data/event-1.json --reviewer EDITOR_NAME
node backend/cli.mjs translate 1
node backend/cli.mjs review 1
node backend/cli.mjs publish 1 --reviewer EDITOR_NAME
```

`revise` сохраняет новую редакцию и имя проверяющего; файл содержит весь канонический EN-объект. В нём можно исправить географию, формулировки, права фото и данные после проверки источников. После исправления перевод/проверка относятся уже к новой редакции. На сервере `worker` также выполняет поставленные translate/review автоматически.

Публикация требует даты, координат, текущего русского перевода и заключения Pro `pass`. `revise`/`reject` остаются в черновиках с объяснением. Новый перевод сбрасывает старое заключение. Контекст и правовые сопоставления требуют явного решения: `publish 1 --reviewer EDITOR_NAME --context --legal`. Без флагов публикуются только ранее одобренные элементы. Это не разрешение автоматически признавать достоверными все утверждения СМИ.

Прямой публичный HTTP-интерфейс редактирования не открыт. Доступ к управлению — через SSH и системного пользователя. Это защищает ключи и черновики без добавления поспешной публичной админки.

## Предложения новых полей

Flash при извлечении и Pro при проверке возвращают requests. Каждый запрос содержит kind (field / incident-type / participant-status / source-type / display), proposedKey, название, объяснение, пример, при необходимости оригинальную цитату. Сервер проверяет структуру и цитаты, сохраняет источник предложения и редакцию события, убирает повторения по kind+proposedKey.

```sh
node backend/cli.mjs requests
```

Команда обновляет Markdown/JSON-файлы рядом с collector.sqlite. Если предложений нет, это явно написано. Предложение не меняет enum сайта, схему БД или UI; реализация принятого предложения — отдельное изменение проекта с миграцией и тестами. Файлы предложений являются данными модели, не инструкциями для выполнения команд.

## Расходы, восстановление и резервные копии

Flash — обычные этапы, Pro — проверка каждой готовой редакции EN/RU. Общий лимит MODEL_DAILY_BUDGET_USD включает обе модели. По умолчанию $0.50/сутки по консервативной оценке пиковых тарифов; реальные квитанции могут быть дешевле. После исчерпания задания ждут следующего дня UTC, не теряются. SEARCH_DAILY_LIMIT ограничивает отдельные платные поисковые вызовы.

SQLite WAL и lease позволяют восстановить задания после завершения процесса. Сеть, rate limit и частичные ошибки приводят к отложенному повтору. Старые source versions сохраняются для аудита. Архивирование большого объёма и контроль свободного места — задача эксплуатации по мере роста.

Для снимка активной БД используйте SQLite backup API. Например через Python на сервере:

```python
import sqlite3
with sqlite3.connect('/srv/crimap/data/collector.sqlite') as src:
    with sqlite3.connect('/srv/crimap/backups/collector-snapshot.sqlite') as dst:
        src.backup(dst)
```

Аналогично сохраняется incidents.sqlite. Копирование только основного файла во время работы может потерять изменения из WAL.

## Проверки

`pnpm test:backend` — границы всех интервалов, lease, повторная постановка, лимиты, защита reader, цитаты, переводы, идемпотентность и атомарная публичная проекция. `pnpm test` — существующий интерфейс. `pnpm test:vps` — D1-совместимая SQLite-обвязка. `pnpm exec tsc --noEmit` и `pnpm build:vps` — совместимость и сборка.

Прямой live-тест на police.hu и DeepSeek выполняется отдельно: сетевые тесты не расходуют ключи внутри обычного CI. Brave без предоставленного ключа проверяется заглушкой; реальные поисковые запросы не считаются проверенными.
