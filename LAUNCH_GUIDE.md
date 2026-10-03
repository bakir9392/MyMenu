# Saveur - Launch Guide

One **server** (`server/`) and one **web app** (`web/`) serve several restaurants. The web app contains the
client menu (`/`), the cashier (`/caisse/`) and the admin dashboard (`/admin/`).

```bash
npm run install:all   # once
npm run dev           # development: http://localhost:8080/, /caisse/, /admin/, /login
npm run build && npm start   # production, single process: http://localhost:3001/, /caisse/, /admin/
```

First start: open `/login` and choose **Create my restaurant**. The first account created takes over any data that
already existed in the database. Your cashiers sign in on that same page with their e-mail and password and are sent to the cashier screen. If you forget your password, use the activation key linked to your account.

See [README.md](README.md) for details (currency, VAT per table, languages, printing, hosting).

