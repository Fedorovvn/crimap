# Размещение Crimap на VPS

Опубликован 26 сентября 2026 года: https://crimap.online/

## Подключение и расположение

```sh
ssh vencar@63.250.53.127
```

Пароль вводится отдельно и не хранится в репозитории.

| Назначение | Путь / значение |
| --- | --- |
| Исходники и локальный Git на сервере | `/srv/crimap/app` |
| Ветка | `main`, удалённый репозиторий не подключён |
| Пользователь приложения | `crimap`, системный пользователь без интерактивного входа |
| База событий | `/srv/crimap/data/incidents.sqlite` |
| Node.js | `/srv/crimap/runtime/node/bin/node`, версия 24.21.0 |
| pnpm | `/srv/crimap/tools/node_modules/.bin/pnpm`, версия 11.25.0 |
| Служба | `/etc/systemd/system/crimap.service` |
| Адрес приложения | `127.0.0.1:8082`, доступ через Nginx |
| Nginx | `/etc/nginx/sites-available/crimap-online` |
| Сертификат | `/etc/letsencrypt/live/crimap.online/` |
| Проверка владения доменом | `/srv/crimap/acme` |
| Резервная копия Nginx до публикации | `/srv/crimap/backups/nginx-before-crimap.tar.gz` |

Служба запускается при загрузке сервера и перезапускается после сбоя. HTTP перенаправляется на HTTPS. Сертификат выпущен до 25 декабря 2026 года; автоматическое продление настроено через существующий `certbot.timer`. Скрипт `/etc/letsencrypt/renewal-hooks/deploy/crimap-nginx-reload` перезагружает конфигурацию Nginx после успешного продления этого сертификата.

На момент публикации `crimap.online` указывает на `63.250.53.127`, а DNS-запись `www.crimap.online` не найдена. HTTP-маршрут для `www` подготовлен. Для полноценного HTTPS на `www` сначала нужна DNS-запись, затем расширение сертификата и отдельный HTTPS-редирект на основной домен.

## Как устроен запуск

VPS использует производственную сборку Vinext для Node.js. `SITE_TARGET=vps` выбирает этот вариант сборки в `vite.config.ts`. Совместимый с используемыми операциями D1 адаптер `db/sqlite-binding.mjs` работает с SQLite через Node.js; исходный локальный режим Cloudflare сохраняется.

База на сервере создана из согласованного снимка локальной базы: два текущих события, источники, фотографии, участники, версии и правовые сведения. Данные находятся вне каталога сборки и Git. При обновлении приложения нельзя заменять эту базу старым локальным снимком.

## Проверка состояния

```sh
sudo systemctl status crimap.service
sudo journalctl -u crimap.service -n 60 --no-pager
curl -I https://crimap.online/
sudo nginx -t
```

## Пересборка после обновления исходников

Для первой установки была использована загрузка файлов по SSH; автоматической синхронизации и GitHub пока нет. Перед обновлением исходников сохраните резервную копию текущей версии и базы. Изменения схемы базы требуют отдельного применения миграций.

```sh
cd /srv/crimap/app
sudo -u crimap env PATH=/srv/crimap/runtime/node/bin:/usr/bin:/bin /srv/crimap/tools/node_modules/.bin/pnpm install --frozen-lockfile
sudo -u crimap env PATH=/srv/crimap/runtime/node/bin:/usr/bin:/bin /srv/crimap/tools/node_modules/.bin/pnpm run build:vps
sudo systemctl restart crimap.service
curl -f https://crimap.online/ -o /dev/null
```

Сборка производится в том же каталоге, поэтому для будущих регулярных обновлений желательно перейти на отдельные каталоги версий с переключением после проверки. Первая публикация выполнена до подключения маршрута Nginx.

## Проверено при публикации

- Проверка TypeScript и производственные сборки на Windows и Ubuntu.
- 30 тестов приложения.
- Отдельный тест SQLite: работа через Drizzle, откат транзакции при ошибке, сохранность после повторного открытия базы.
- HTTPS, загрузка карты и переключение событий в браузере.
- Синтаксис Nginx и автозапуск службы приложения.

Конфигурации сайтов Vencar, Wannascale и Tripandme не редактировались.
