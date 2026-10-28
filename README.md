# bb-plugins

Мои плагины для [bb](https://getbb.app) и синхронизация их набора между компьютерами.

| Плагин | Что делает |
| --- | --- |
| `bulk-delete` | Выделение нескольких тредов в сайдбаре и удаление или архивация разом; удаление всех простаивающих дочерних тредов |
| `clean-copy` | Копирование текста из окна bb без цветов темы, фонов и шрифтов |
| `nested-session-count` | Число дочерних сессий рядом со стрелкой раскрытия в сайдбаре |
| `new-chat-personal` | Кнопка и шорткат New thread всегда открывают чат без проекта |
| `obsidian` | Открывает ссылки на заметки Obsidian из чатов в Obsidian |
| `plugin-sync` | Ставит и обновляет плагины из этого репозитория по кнопке в настройках |
| `session-colors` | Цветные метки тредов в сайдбаре и заголовке |
| `statusline` | Строка над композером: заполнение контекста и лимиты провайдера |

## Новый компьютер

```sh
bb plugin install git:https://github.com/toolstik/bb-plugins.git@main --subdirectory plugins/plugin-sync
```

Затем Settings → Plugin Sync → **Sync**. Он ставит все плагины из `.bb/plugins.json` и сторонние из `sync.json` и выставляет шорткаты из `sync.json`.

Дальше `plugin-sync` раз в час проверяет репозиторий. Если появились новые плагины, обновления или расходятся шорткаты, в bb один раз всплывает уведомление с кнопками **Apply** и **Later**. Сам он ничего не ставит и не обновляет. Те же действия есть в настройках плагина и в CLI: `bb plugin-sync status|sync|update`.

## Что где лежит

- `plugins/<id>/`: исходники плагинов. Имя каталога и `name` в `.bb/plugins.json` совпадают с id плагина.
- `.bb/plugins.json`: список своих плагинов, они ставятся из git с отслеживанием `main`.
- `sync.json`: сторонние плагины (`external`, id и источник для `bb plugin install`) и переопределения шорткатов (`keyboard`).

## Разработка

На машине, где плагин правится, он установлен с локального пути, и `plugin-sync` его не трогает:

```sh
git clone https://github.com/toolstik/bb-plugins.git ~/src/bb-plugins
bb plugin install path:$HOME/src/bb-plugins/plugins/<id>
bb plugin dev ~/src/bb-plugins/plugins/<id>   # пересборка и перезагрузка при сохранении
```

Остальные машины увидят изменения после `git push` в `main`. Для пуша нужна авторизация: `gh auth login` и `gh auth setup-git`.

Новый плагин: положить его в `plugins/<id>/`, добавить строку в `.bb/plugins.json`, запушить. Удалённый из репозитория плагин с других машин не удаляется. `plugin-sync` покажет его как "no longer listed", а удалить можно через `bb plugin remove <id>`.
