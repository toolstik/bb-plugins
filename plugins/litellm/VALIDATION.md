# Проверка версии 0.1.0

Дата: 2026-11-09. Проверено на macOS, BB 0.49.0, Plugin SDK 0.6.132.

## Локальные проверки

- `npm test`: 9 тестов, все прошли.
- Gateway tests: приватность credential-файла, ротация ключа и кеша, фильтрация и псевдонимы моделей, авторизация локального прокси, оба API, потоковый ответ, безопасные ошибки и отказ при удалении ключа.
- Conformance Claude Code: все 18 сценариев опубликованного SDK прошли на scripted SDK, включая session start, resume, fork и stop.
- Conformance Codex: все 21 сценарий прошли на supervised fake app-server, включая независимые сессии, interrupt и recovery.
- Public SDK scan: нет приватных импортов или зависимостей `@bb/*`. Публичный `/process` SDK 0.6.132 явно разрешен, поскольку встроенный список сканера его еще не учитывает.
- `npm run typecheck`: без ошибок.
- `bb plugin types --check .`: версия деклараций совпадает с установленным BB.
- `bb plugin build .`: собраны server и host.

## Работающий BB

Плагин `litellm@0.1.0` установлен из локального исходника и загружен со статусом running. В `bb provider list` присутствуют личные `claude-code`, `codex` и новые `litellm-claude-code`, `litellm-codex`.

Оба корпоративных провайдера через исполняющий host получили по 34 модели с правами предоставленного virtual key. Проверена установка предпочтительных моделей и сопоставление канонических имен Codex.

Настройки этой установки:

- Шлюз: `https://llm.finstar-ai.cc`.
- Claude Code по умолчанию: `02 Coding - Anthropic - Claude Sonnet 5`.
- Codex по умолчанию: `gpt-6.1-sol`.
- Псевдонимы для двух OpenAI-моделей настроены по корпоративной инструкции.
- Секрет получен через защищенную форму BB. По явному разрешению пользователя он перенесен в постоянный приватный файл `/Users/viktor/.bb/plugins/litellm/secrets/credentials.env` с правами `600`. Оба провайдера повторно получили каталоги с новым путем; временная копия из хранилища чата удалена.

## Реальные агенты и корпоративный шлюз

| Исполнитель | Версия CLI | Модель | Запуск | Запись и чтение файла | Продолжение после нового процесса bridge |
| --- | --- | --- | --- | --- | --- |
| Codex | 0.167.0 | `gpt-6.1-sol` | Успех | Успех | Успех |
| Claude Code | 2.1.319 | `02 Coding - Anthropic - Claude Sonnet 5` | Успех | Успех | Успех |

Каждый агент получил короткую задачу записать маркер в файл в пустом временном каталоге, прочитать файл инструментом и вернуть содержимое. Файл действительно создан с ожидаемым содержимым, ответ содержит маркер, статус хода completed, ошибок провайдера нет. Затем сессии освобождены, bridge перезапущены в новых процессах, те же сессии продолжены с успешным повторением задачи.

Проверки не создавали дополнительных чатов BB. История тестовых сессий хранится штатными CLI. Временные рабочие каталоги удалены. Ключ в отчете, исходниках, argv и сообщениях не сохранялся.

## Границы проверки

Все 34 модели не проходили агентные тесты. Удаленные машины, Windows, cross-engine перенос истории, Goals UI, reasoning overrides, premium tiers и полный набор MCP/Computer Use взаимодействий не проверялись. Автоматические conformance-тесты подтверждают протокол адаптеров, реальные smoke-тесты подтверждают две указанные связки CLI и модели. Визуальная проверка меню через GUI не выполнялась; регистрация и каталоги проверены через работающий BB CLI.


## Обновление 0.1.1: ввод ключа в настройках

- Добавлена форма с выбором исполняющей машины, скрытым полем и кнопкой сохранения ключа в настроенный env-файл.
- Все 14 тестов прошли. Новые тесты проверяют создание файла с правами 600, замену ключа с сохранением остальных переменных, отказ при дубликатах и symlink, отсутствие ключа в результате операции, маскирование и очистку поля формы.
- Проверка типов и сборка server/app/host прошли.
- На работающем BB проверены RPC списка машин и статуса существующего приватного файла. Действующий ключ не перезаписывался ради проверки.
- Визуальная проверка окна BB не выполнена: управление приложением завершилось по таймауту. Форма проверена через официальный UI-harness SDK.

## 0.1.2: budget usage

Added /key/info and /user/info collection on the execution host and provider-usage.v1 resources for both engines. Verified the live gateway returns a user budget of $30 (30d), with reset at 2026-12-01T00:00:00Z; the key has no separate max_budget. Only whitelisted numeric budget fields were inspected; no credentials or raw key/user responses were printed. Requests use an explicit bb-litellm User-Agent; Python's default User-Agent received HTTP 403 while the plugin User-Agent succeeded.

18 tests pass, including new budget tests covering user-budget fallback, secret stripping, cache sharing and rotation, overage, forbidden API access, missing budgets, resource discovery and host routing. Both plugins pass type checking and production builds.

Live StatusLine usage_limits RPC returned status ok for both litellm-codex and litellm-claude-code with the same cached observation and USD cost fields. A React server-render check verified the visible $30 label, rounded 1% and $0.19 spending, while preserving the 5h subscription label.

## 0.1.4: paid model budget

User budget denominator now comes exclusively from user_info.metadata.paid_model_budget, not user_info.max_budget. Live API reports paid_model_budget=20 and max_budget=30; the StatusLine must use $20. Spending remains user_info.spend. Regression coverage rejects missing, null, zero, negative and string metadata limits without falling back to max_budget.

## 0.1.5: inherited native behavior settings

Added allowlisted behavior-setting inheritance from provider-claude-code and provider-codex, refreshed at plugin load and before every corporate dispatch. Tests cover engine isolation, plan mode, subagent disablement, immediate setting updates, personal-dispatch isolation, invalid/unavailable sources and stripping unrelated/secret fields. The suite now has 22 passing tests. Gateway launch configuration and personal provider declarations remain independent.
