# Отчёт по практике DevOps №3

- **ФИО**: [Ваше ФИО]
- **Группа**: Б-24 ИВО-2
- **Репозиторий**: https://github.com/[username]/devops-practice-3

---

## Задание 1. Оптимизация контейнера

### Размер образа

- **До оптимизации**: ~1200 MB (node:20)
- **После оптимизации**: ~180 MB (node:20-alpine + multi-stage)
- **Уменьшение**: ~85%

### Пользователь процесса

```bash
$ docker exec <container-id> id
uid=1001(nodejs) gid=1001(nodejs) groups=1001(nodejs)
```

### Healthcheck

Healthcheck проверяет доступность эндпоинта `/health` каждые 30 секунд:
- **interval**: 30s - баланс между частотой проверок и нагрузкой
- **timeout**: 10s - достаточно для ответа приложения
- **start-period**: 40s - время для запуска Node.js приложения
- **retries**: 3 - количество неудачных попыток до статуса "unhealthy"

### Безопасность

Включенные флаги безопасности:
- `no-new-privileges:true` - запрет повышения привилегий
- `cap_drop: ALL` - удаление всех capabilities
- `cap_add: NET_BIND_SERVICE` - разрешение только для биндинга портов
- `read_only: true` - read-only файловая система (где возможно)
- Запуск от непривилегированного пользователя `nodejs`

### Скриншоты

![docker ps](screenshots/01_docker_ps.png)

---

## Задание 2. Метрики и дашборды

### Собираемые метрики

**Экспортеры:**
1. **Node Exporter** (9100) - метрики хоста (CPU, RAM, disk, network)
2. **cAdvisor** (8080) - метрики Docker контейнеров
3. **Redis Exporter** (9121) - метрики Redis
4. **Application** (8080/metrics) - метрики приложения через prom-client

### Основные метрики

1. **http_request_duration_ms** (Histogram)
   - Важность: показывает распределение времени ответа, позволяет отслеживать p95/p99 перцентили
   - Использование: выявление проблем с производительностью

2. **container_memory_usage_bytes** (Gauge)
   - Важность: отслеживание использования памяти контейнерами
   - Использование: предотвращение OOM kills, оптимизация ресурсов

3. **redis_connected_clients** (Gauge)
   - Важность: количество подключений к Redis
   - Использование: мониторинг нагрузки на Redis, выявление утечек соединений

### Дашборд

![Grafana Dashboard](screenshots/02_grafana_dashboard.jpeg)

### Алерты

**Пример правила:**
```yaml
- alert: HighLatency
  expr: histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m])) > 1000
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "High request latency detected"
    description: "95th percentile latency is above 1000ms"
```

![Alert Firing](screenshots/02_alert_firing.jpeg)

---

## Задание 3. Централизованные логи

### Схема сбора (Loki/Promtail)

**Используемые лейблы:**
- `container` - имя Docker контейнера
- `service` - имя сервиса из docker-compose
- `stream` - stdout/stderr
- `level` - уровень логирования (ERROR, WARN, INFO, DEBUG)

**Процесс сбора:**
1. Promtail подключается к Docker socket
2. Читает логи из `/var/lib/docker/containers`
3. Добавляет метаданные из Docker labels
4. Парсит логи с помощью pipeline stages
5. Отправляет в Loki

### Запрос для ошибок

```logql
{container="web"} |= "ERROR"
```

### Скриншоты

![Loki Errors Panel](screenshots/03_loki_errors.png)

---

## Задание 4. Балансировка и масштабирование

### Балансировщик

**Выбран Traefik v2:**
- Нативная интеграция с Docker
- Автоматическое обнаружение сервисов
- Встроенные health checks
- Поддержка weighted load balancing для canary deployments

### Реплики

**Количество реплик web**: N = 3

**Проверка равномерности:**
1. Запуск нагрузочного теста k6
2. Проверка метрики `http_requests_total` с label `instance`
3. Анализ распределения запросов между репликами в Grafana

### Canary маршрут

**Конфигурация:**
- Production (web): 90% трафика
- Canary (web-canary): 10% трафика

**Реализация через Traefik labels:**
```yaml
traefik.http.services.weighted.weighted.services[0].name=web-service
traefik.http.services.weighted.weighted.services[0].weight=90
traefik.http.services.weighted.weighted.services[1].name=web-canary-service
traefik.http.services.weighted.weighted.services[1].weight=10
```

### Скриншоты

![Traffic Distribution](screenshots/04_canary.png)

---

## Задание 5. Нагрузочное тестирование и SLO

### SLO (Service Level Objectives)

- **p95 latency**: ≤ 200 ms
- **Error rate**: ≤ 0.1%

### k6 профиль нагрузки

![K6](screenshots/05_k6_results.png)

**Сценарий:**
1. Ramp-up: 30s до 20 VUs
2. Ramp-up: 1m до 50 VUs
3. Steady: 2m на 100 VUs
4. Ramp-down: 1m до 0 VUs

### Итоговые метрики

| Метрика | Факт | SLO | Статус |
|---------|------|-----|--------|
| p95 latency | 185 ms | ≤ 200 ms | ✅ OK |
| p99 latency | 245 ms | - | ℹ️ Info |
| Error rate | 0.05% | ≤ 0.1% | ✅ OK |
| RPS | 95 req/s | - | ℹ️ Info |

### Выводы и план улучшений

1. **Кеширование**: Внедрить Redis кеширование для часто запрашиваемых данных
   - Ожидаемое улучшение: снижение p95 до <100ms

2. **Connection Pooling**: Оптимизировать пул соединений Redis
   - Текущая конфигурация: по умолчанию
   - Предлагаемая: maxClients=50, минимальные соединения=10

3. **Горизонтальное масштабирование**: Увеличить количество реплик до 5 для обработки пиковых нагрузок
   - Текущее: 3 реплики
   - Предлагаемое: 5 реплик с автоскейлингом

---

## Общие выводы

Практическая работа продемонстрировала:

1. ✅ Успешную оптимизацию Docker образа с уменьшением размера на 85%
2. ✅ Настройку полного стека мониторинга (Prometheus, Grafana, Loki)
3. ✅ Реализацию централизованного логирования с возможностью поиска
4. ✅ Балансировку нагрузки с canary deployments (90/10%)
5. ✅ Достижение установленных SLO по производительности

**Полученные навыки:**
- Контейнеризация с best practices безопасности
- Настройка observability stack
- Load balancing и blue-green deployments
- Performance testing и SLO engineering