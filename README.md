# Telegram Task Bot

> Telegram group bot for field teams — log tasks with `#prefix`, track status, auto-alerts, EOD summaries.

## Features

- **Task creation** — Send `#Fix the AC` in the group, bot creates a formatted task card with Start/Done/Note buttons
- **Status tracking** — Anyone can type `/status` to see pending tasks
- **Auto alerts** — Owner gets DM if tasks stay unattended
- **Doer reminders** — Reminds the person who started a task if it's taking too long
- **EOD summary** — Daily summary of completed vs carried-forward tasks
- **Morning brief** — Morning recap of all pending tasks
- **Weekly report** — CSV report every Monday
- **Schedule tasks** — Owner can schedule tasks for a future date
- **Search** — `/find keyword` to search all tasks
- **Age coding** — 🟢 < 4h | 🟡 4-24h | 🔴 > 24h

## Requirements

| Requirement | Why |
|---|---|
| [Node.js](https://nodejs.org) v18+ | Runtime for the bot |
| npm | Comes with Node.js, installs dependencies |
| [Git](https://git-scm.com) | Clone the repo |
| [Telegram](https://telegram.org) account | Create bot via @BotFather |
| [Supabase](https://supabase.com) account (free) | Database for tasks |

## Setup — Windows

### 1. Install Node.js
Download and install from [nodejs.org](https://nodejs.org) (LTS version). Verify:
```powershell
node --version    # should show v18 or higher
npm --version     # should show a version number
```

### 2. Clone and install
```powershell
git clone https://github.com/GMNEdits/telegram-task-bot.git
cd telegram-task-bot
npm install
```

### 3. Create your Telegram bot
1. Open Telegram, search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name (e.g. "My Task Bot")
4. Choose a username ending in `bot` (e.g. "mytask123_bot")
5. Copy the **bot token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 4. Set up Supabase
1. Go to [supabase.com](https://supabase.com), create a free project
2. Go to **SQL Editor** → **New query**
3. Paste and run this SQL:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  submitted_by BIGINT,
  submitted_by_name TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'not_started',
  started_by BIGINT,
  started_by_name TEXT,
  started_at TIMESTAMPTZ,
  done_by BIGINT,
  done_by_name TEXT,
  done_at TIMESTAMPTZ,
  carried_forward BOOLEAN DEFAULT false,
  carry_count INTEGER DEFAULT 0,
  last_alerted_at TIMESTAMPTZ,
  message_id BIGINT,
  source_message_id BIGINT,
  chat_id BIGINT,
  cancel_reason TEXT,
  cancelled_by BIGINT,
  cancelled_by_name TEXT,
  cancelled_at TIMESTAMPTZ,
  is_scheduled BOOLEAN DEFAULT false,
  scheduled_for TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notes (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
  author_id BIGINT,
  author_name TEXT,
  text TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS scheduled_dm (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
  chat_id BIGINT,
  message_id BIGINT
);
```

4. Go to **Settings** → **API** and copy:
   - **Project URL** (looks like `https://abcxyz.supabase.co`)
   - **Service Role Key** (long `eyJ...` string)

### 5. Configure environment
```powershell
copy .env.example .env
notepad .env
```
Fill in:
- `TELEGRAM_BOT_TOKEN` — the token from @BotFather
- `SUPABASE_URL` — your project URL
- `SUPABASE_SERVICE_ROLE_KEY` — your service role key

### 6. Set timezone
Open `config.js` and change `TIMEZONE` to yours:
```js
TIMEZONE: 'America/New_York',  // or 'Europe/London', 'Asia/Tokyo', etc.
```

### 7. Run
```powershell
node index.js
```
You should see:
```
🤖 Telegram Task Bot starting...
Bot launched (polling)
```

---

## Setup — Linux (Ubuntu/Debian)

### 1. Install Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version    # should show v20 or higher
```

### 2. Clone and install
```bash
git clone https://github.com/GMNEdits/telegram-task-bot.git
cd telegram-task-bot
npm install
```

### 3. Create your Telegram bot
1. Open Telegram, search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name and username (ending in `bot`)
4. Copy the bot token

### 4. Set up Supabase
Same as Windows — create project, run the 4 SQL queries, copy URL and key.

### 5. Configure environment
```bash
cp .env.example .env
nano .env
```
Fill in your bot token, Supabase URL, and service role key. Save with `Ctrl+O`, exit with `Ctrl+X`.

### 6. Set timezone
```bash
nano config.js
```
Change `TIMEZONE` to yours (e.g. `'America/New_York'`).

### 7. Run
```bash
node index.js
```

### 8. Run in background (optional)
```bash
# Using pm2 (recommended)
npm install -g pm2
pm2 start index.js --name telegram-task-bot
pm2 save
pm2 startup    # follow the instructions it gives you

# Or using screen
screen -S bot
node index.js
# Press Ctrl+A then D to detach
```

---

## Setup — macOS

### 1. Install Node.js
```bash
# Using Homebrew (install from brew.sh if you don't have it)
brew install node
node --version    # should show v18 or higher
```

### 2. Clone and install
```bash
git clone https://github.com/GMNEdits/telegram-task-bot.git
cd telegram-task-bot
npm install
```

### 3. Create your Telegram bot
1. Open Telegram, search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name and username (ending in `bot`)
4. Copy the bot token

### 4. Set up Supabase
Same as Windows — create project, run the 4 SQL queries, copy URL and key.

### 5. Configure environment
```bash
cp .env.example .env
open -e .env    # opens in TextEdit, or use: nano .env
```
Fill in your bot token, Supabase URL, and service role key.

### 6. Set timezone
```bash
open -e config.js    # or: nano config.js
```
Change `TIMEZONE` to yours (e.g. `'America/Los_Angeles'`).

### 7. Run
```bash
node index.js
```

---

## Telegram Setup (All OS)

After the bot is running:

1. **Owner**: Open the bot in Telegram and send `/start` in **private chat**
2. **Group**: Create a group, add the bot, make it admin with these rights:
   - Delete Messages
   - Send Messages
3. **Test**: Send `#test task` in the group — a task card should appear
4. **Team**: Add your team members to the group

## Configuration

Edit `config.js` to adjust settings, then restart the bot:

| Setting | Default | Description |
|---|---|---|
| `ACTIVE_START_HOUR` | 0 | Active hours start |
| `ACTIVE_END_HOUR` | 20 | Active hours end |
| `EOD_SUMMARY_HOUR` | 19 | Daily summary time |
| `EOD_SUMMARY_MINUTE` | 30 | |
| `MORNING_BRIEF_HOUR` | 9 | Morning brief time |
| `ALERT_AFTER_HOURS` | 2 | Alert owner after this |
| `DOER_REMIND_AFTER_HOURS` | 3 | Remind doer after this |
| `LANGUAGE` | english | `english` or `hinglish` |
| `TIMEZONE` | Asia/Kolkata | Your IANA timezone |

## How It Works

| Action | Result |
|---|---|
| `#Fix the AC` | Creates task, posts card with buttons |
| `Fix the AC` | Ignored (normal chat) |
| Click **Start** | Task moves to In Progress |
| Click **Done** | Task marked complete |
| Click **📝 Note** | Bot prompts for note, updates card |
| Owner clicks **❌ Cancel** | Prompts for reason, cancels task |
| Owner clicks **📅 Schedule** | Prompts for date, schedules task |
| `/status` | Shows all pending tasks |
| `/find keyword` | Searches tasks |

## Tech Stack

- **Runtime**: Node.js (cross-platform — Windows, Linux, macOS)
- **Bot framework**: [Telegraf](https://telegraf.js.org/)
- **Database**: [Supabase](https://supabase.com) (PostgreSQL)
- **Platform**: Telegram Bot API

## License

MIT
