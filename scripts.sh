#!/bin/sh

# Recall.ai's Open Source Microsoft Teams Bot Docker Helper Scripts

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# ===============================================
# Helper Functions
# ===============================================
print_message() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Source .env file if it exists, using a robust method
if [ -f .env ]; then
    print_message "Loading environment variables from .env file..."
    set -a
    . ./.env
    set +a
fi

# ===============================================
# Teams Bot (Standalone)
# ===============================================
build_teams_bot() {
    print_message "Building teams-bot Docker image..."
    docker build -t teams-bot:latest -f apps/teams-bot/Dockerfile .
}

run_teams_bot_standalone() {
    print_message "Running teams-bot Docker container in standalone mode..."
    
    PORT=${PORT:-4101}
    BOT_ID=${BOT_ID:-$(uuidgen)}

    if [ -z "$MEETING_URL" ] || [ -z "$NOTIFIER_URLS" ]; then
        print_error "MEETING_URL and NOTIFIER_URLS must be set in your .env file or on the command line."
        exit 1
    fi

    mkdir -p apps/teams-bot/screenshots
    docker run --rm \
      -p "${PORT}:${PORT}" \
      -e "NODE_ENV=production" \
      -e "PORT=${PORT}" \
      -e "MEETING_URL=${MEETING_URL}" \
      -e "NOTIFIER_URLS=${NOTIFIER_URLS}" \
      -e "BOT_ID=${BOT_ID}" \
      -v "$(pwd)/apps/teams-bot/screenshots:/usr/src/app/screenshots" \
      teams-bot:latest
}

# ===============================================
# Bot Launcher Service
# ===============================================
build_bot_launcher() {
    print_message "Building bot-launcher-server Docker image..."
    docker-compose build bot-launcher-server
}

# ===============================================
# ALL SERVICES (via Docker Compose)
# ===============================================
build_all() {
    print_message "Building all Docker images..."
    build_teams_bot
    build_bot_launcher
}

up() {
    print_message "Building and starting the bot-launcher-server..."
    build_all
    docker-compose up
}

upd() {
    print_message "Building and starting the bot-launcher-server in detached mode..."
    build_all
    docker-compose up -d
    print_message "Bot Launcher Server is running in the background."
    print_message "API is available at http://localhost:${BOT_LAUNCHER_SERVER_PORT:-4100}"
}

down() {
    print_message "Stopping all Docker Compose services..."
    docker-compose down
}

logs() {
    print_message "Showing logs for the bot-launcher-server..."
    docker-compose logs -f bot-launcher-server
}

logs_bot() {
    if [ -z "$1" ]; then
        print_error "BOT_ID is required. Usage: ./scripts.sh logs:bot <BOT_ID>"
        exit 1
    fi
    BOT_ID=$1
    CONTAINER_NAME="teams-bot-${BOT_ID}"
    print_message "Attaching to logs for container ${CONTAINER_NAME}..."
    docker logs -f ${CONTAINER_NAME}
}

deploy_bot_from_env() {
    print_message "Starting bot deployment from .env configuration..."

    if ! docker-compose ps | grep -q "bot-launcher-server"; then
        print_error "The bot-launcher-server is not running. Please start it with './scripts.sh upd'"
        exit 1
    fi

    if [ -z "$MEETING_URL" ] || [ -z "$NOTIFIER_URLS" ]; then
        print_error "MEETING_URL and NOTIFIER_URLS must be set in your .env file to deploy a bot."
        exit 1
    fi
    
    LAUNCHER_PORT=${BOT_LAUNCHER_SERVER_PORT:-4100}
    BOT_PORT=${PORT:-4101}
    
    # Correctly format the comma-separated URLs into a JSON array of strings
    JSON_NOTIFIER_URLS=$(echo "${NOTIFIER_URLS}" | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/')

    print_message "Sending deployment request to the launcher on port ${LAUNCHER_PORT}..."
    response=$(curl -s -X POST http://localhost:${LAUNCHER_PORT}/api/bot \
    -H "Content-Type: application/json" \
    -d "{
      \"port\": ${BOT_PORT},
      \"meetingUrl\": \"${MEETING_URL}\",
      \"notifierUrls\": [${JSON_NOTIFIER_URLS}],
      \"botId\": \"$(uuidgen)\"
    }")

    botId=$(echo $response | sed -n 's/.*"botId":"\([^"]*\)".*/\1/p')

    if [ -z "$botId" ]; then
        print_error "Failed to deploy bot. Server response: ${response}"
        exit 1
    fi

    print_message "Bot deployed successfully with BOT_ID: ${botId}"
    logs_bot $botId
}

# ===============================================
# Main Control
# ===============================================
show_help() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Primary Workflow:"
    echo "  up                    Starts services and attaches logs immediately."
    echo "  deploy-bot            Deploys a new bot using config from .env and tails its logs."
    echo "  down                  Stops all services."
    echo ""
    echo "Other Commands:"
    echo "  upd                   Starts the bot-launcher-server in the background."
    echo "  logs                  Follows logs from the bot-launcher-server."
    echo "  logs:bot <BOT_ID>     Follows logs for a specific teams-bot container."
    echo "  build                 Builds all necessary Docker images."
    echo "  run:teams-bot         Run a single teams-bot from .env configuration."
    echo ""
}

case "$1" in
    up)
        up
        ;;
    upd)
        upd
        ;;
    down)
        down
        ;;
    logs)
        logs
        ;;
    logs:bot)
        logs_bot "$2"
        ;;
    build)
        build_all
        ;;
    run:teams_bot)
        run_teams_bot_standalone
        ;;
    deploy_bot_from_env)
        deploy_bot_from_env
        ;;
    help|""|*)
        show_help
        ;;
esac
