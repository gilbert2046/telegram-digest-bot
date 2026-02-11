module.exports = {
  apps: [
    {
      name: "telegram-bot",
      script: "chatbot.js",
      time: true,
      autorestart: true,
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "digest-daily-11",
      script: "scripts/digest_daily.js",
      time: true,
      autorestart: false,
      cron_restart: "0 11 * * *",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "digest-ai-14",
      script: "scripts/digest_ai_finance.js",
      time: true,
      autorestart: false,
      cron_restart: "0 14 * * *",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "digest-paris-19",
      script: "scripts/digest_paris_events.js",
      time: true,
      autorestart: false,
      cron_restart: "0 19 * * *",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "auto-update",
      script: "scripts/auto_update.sh",
      time: true,
      autorestart: false,
      cron_restart: "0 3 * * *",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
