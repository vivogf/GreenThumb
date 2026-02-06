<p align="center">
  <img src="client/public/icon-512.png" alt="GreenThumb" width="128" height="128" />
</p>

<h1 align="center">GreenThumb</h1>

<p align="center">
  PWA-приложение для отслеживания полива и ухода за комнатными растениями
</p>

<p align="center">
  <a href="https://greenthumb.xmpp.site">greenthumb.xmpp.site</a>
</p>

---

## Что это?

GreenThumb помогает не забывать поливать цветы. Добавляете растение, указываете частоту полива — приложение напомнит, когда пора заботиться о ваших зеленых друзьях.

**Работает как обычное приложение** — устанавливается на телефон прямо из браузера, присылает push-уведомления, работает офлайн.

## Возможности

- **Трекер полива** — отслеживание когда каждое растение нужно полить, с визуальными индикаторами (просрочено / сегодня / через N дней)
- **Расширенный уход** — удобрение, пересадка, обрезка с настраиваемыми интервалами
- **Push-уведомления** — напоминания о поливе прямо на телефон
- **Фото растений** — загрузка фотографий с автосжатием
- **Анонимная авторизация** — без email и пароля, вход по уникальному ключу восстановления
- **PWA** — устанавливается как приложение на Android/iOS/Desktop
- **Русский и английский** — автоопределение языка браузера
- **Темная тема** — теплая темная тема с синхронизацией системных настроек

## Стек

| Слой | Технология |
|------|------------|
| Frontend | React 18 + Vite + TypeScript |
| UI | Tailwind CSS + shadcn/ui + Framer Motion |
| Backend | Express.js + TypeScript |
| ORM | Drizzle |
| База данных | PostgreSQL (Neon) |
| PWA | Service Worker + Web Push API |
| i18n | react-i18next |

## Быстрый старт

```bash
# Клонировать
git clone https://github.com/vivogf/GreenThumb.git
cd GreenThumb

# Установить зависимости
npm install

# Настроить переменные окружения
cp .env.example .env
# Отредактировать .env — добавить DATABASE_URL, VAPID ключи, SESSION_SECRET

# Применить миграции БД
npm run db:push

# Запустить в dev-режиме
npm run dev
```

### Переменные окружения

| Переменная | Описание |
|-----------|----------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Секрет для сессий Express |
| `VAPID_PUBLIC_KEY` | Публичный VAPID ключ (web-push) |
| `VAPID_PRIVATE_KEY` | Приватный VAPID ключ |
| `VITE_VAPID_PUBLIC_KEY` | Тот же публичный VAPID ключ (для клиента) |

Сгенерировать VAPID ключи:
```bash
npx web-push generate-vapid-keys
```

## Структура проекта

```
client/              # React frontend
├── public/          # Static assets, SW, manifest
└── src/
    ├── components/  # UI компоненты
    ├── pages/       # Страницы (Dashboard, AddPlant, PlantDetails, Profile)
    ├── i18n/        # Переводы (ru.json, en.json)
    └── contexts/    # Auth context

server/              # Express backend
├── routes.ts       # API endpoints
├── storage.ts      # Database queries
└── app.ts          # Express app setup

shared/
└── schema.ts       # Drizzle ORM схема (общая для клиента и сервера)
```

## Лицензия

MIT
