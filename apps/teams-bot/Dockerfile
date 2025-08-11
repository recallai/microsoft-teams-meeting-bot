FROM mcr.microsoft.com/playwright:v1.44.0-focal

WORKDIR /usr/src/app

# To leverage Docker cache, we copy all package.json files first.
# This includes the root and all workspaces.
COPY package*.json ./
COPY apps/teams-bot/package.json ./apps/teams-bot/

# Use npm ci for a clean, reliable install from the lockfile in CI/CD environments
RUN npm ci

# Install playwright browsers right after npm install to cache this layer
RUN npx playwright install --with-deps

# Now that dependencies are installed, copy the rest of the source code
COPY . .

# Only build the teams-bot package, as the client is built in its own container
RUN npx turbo build --filter=teams-bot

ENV PORT=$PORT
EXPOSE $PORT

# Run the start command for the teams-bot workspace
CMD ["npm", "run", "start", "-w", "teams-bot"] 