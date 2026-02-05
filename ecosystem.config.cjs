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
      name: "daily-digest-10",
      script: "runDigest.js",
      time: true,
      autorestart: false,
      cron_restart: "0 10 * * *",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "daily-digest-14",
      script: "runDigest.js",
      time: true,
      autorestart: false,
      cron_restart: "0 14 * * *",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "daily-digest-19",
      script: "runDigest.js",
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
