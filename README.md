# Open Source Microsoft Teams Meeting Bot

This is an open source Microsoft Teams bot built by Recall.ai. It is designed to be deployed dynamically to join Microsoft Teams meetings, capture transcription data, and forward it to specified webhook or WebSocket endpoints.

## Architecture

The system consists of two main services:

1.  **Bot Launcher Server**: A lightweight Node.js server that exposes an API to launch new bot instances on demand. It uses Dockerode to interact with the Docker daemon.
2.  **Teams Bot**: A Playwright-based bot that runs in a headless browser. Each instance is a separate container, launched by the Bot Launcher Server, that joins a specific meeting.

This architecture allows you to scale and manage a fleet of meeting bots

## Prerequisites

Before you begin, ensure you have the following installed:

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [ngrok](https://ngrok.com/download) (for local development)

## Getting Started

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/recallai/microsoft-teams-meeting-bot.git
    cd microsoft-teams-meeting-bot
    ```

2.  **Start ngrok tunnel:**

    Start an ngrok tunnel on port 4100 (or whatever port you configure in `.env`). This exposes your local bot launcher server to the internet so that bot instances can send data back to it.

    ```bash
    ngrok http 4100
    ```

    Copy the public ngrok URL (e.g., `https://abc123.ngrok.io`) - you'll need this for the next step.

3.  **Create and configure `.env` file:**

    Copy the sample environment file:

    ```bash
    cp .env.sample .env
    ```

    Open `.env` and configure the following variables:

    **Required:**

    - `BOT_LAUNCHER_SERVER_PORT`: The port for the launcher server (e.g., `4100`)
    - `MEETING_URL`: The default Teams meeting URL for bots to join
    - `NOTIFIER_URLS`: Comma-separated URLs where bots send data. Use your ngrok URL here:
      ```
      NOTIFIER_URLS=wss://YOUR_NGROK_URL/api/ws/bot,https://YOUR_NGROK_URL/api/wh/bot
      ```

    **⚠️ Important:** Both `deploy-bot` and `run:teams-bot` commands read configuration from this `.env` file. If you update the `.env` file, make sure to restart any running services or redeploy bots to pick up the changes. Not updating the `.env` properly may lead to bots trying to connect to old URLs or using incorrect configuration.

4.  **Start the Bot Launcher Server:**

    Build and start the launcher server:

    ```bash
    ./scripts.sh up
    ```

    The server will be running on your configured port and accessible via your ngrok URL.

5.  **Deploy a Bot:**

    Use the `deploy-bot` command to launch a bot with your `.env` configuration:

    ```bash
    ./scripts.sh deploy-bot
    ```

    This command will:

    - Read `MEETING_URL`, `NOTIFIER_URLS`, and other settings from your `.env`
    - Deploy a new bot instance
    - Automatically start tailing the bot's logs

## Available Commands

This project includes a helper script `./scripts.sh` to manage the application.

**Usage:** `./scripts.sh [COMMAND]`

### Primary Workflow

| Command      | Description                                              |
| ------------ | -------------------------------------------------------- |
| `up`         | Builds and starts services, attaching logs immediately   |
| `deploy-bot` | Deploys a new bot using `.env` config and tails its logs |
| `down`       | Stops all services                                       |

### Other Commands

| Command             | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `upd`               | Starts the bot-launcher-server in detached mode        |
| `logs`              | Follows logs from the bot-launcher-server              |
| `logs:bot <BOT_ID>` | Follows logs for a specific teams-bot container        |
| `build`             | Builds all necessary Docker images                     |
| `run:teams-bot`     | Runs a standalone teams-bot using `.env` configuration |

**Note:** Commands `deploy-bot` and `run:teams-bot` both read from the same `.env` file. Always update your `.env` file and restart services when changing configuration to avoid connection issues.

## API Usage

You can also deploy bots by calling the launcher's API directly instead of using the `deploy-bot` script.

**Endpoint**: `POST /api/bot`
**Host**: `http://localhost:${BOT_LAUNCHER_SERVER_PORT}` or your ngrok URL

### Example `curl` Request

```bash
curl -X POST http://localhost:4100/api/bot \
-H "Content-Type: application/json" \
-d '{
  "port": 4102,
  "meetingUrl": "YOUR_TEAMS_MEETING_URL",
  "notifierUrls": [
    "wss://YOUR_NGROK_URL/api/ws/bot",
    "https://YOUR_NGROK_URL/api/wh/bot"
  ],
  "botId": "'$(uuidgen)'"
}'
```

**Important:**

- Replace `YOUR_TEAMS_MEETING_URL` with an actual Teams meeting URL
- Replace `YOUR_NGROK_URL` with your ngrok public URL (e.g., `abc123.ngrok.io`)
- The `notifierUrls` should point to your ngrok URL so the bot can send data back to your local server
- Using the `deploy-bot` script is recommended as it automatically uses your `.env` configuration
