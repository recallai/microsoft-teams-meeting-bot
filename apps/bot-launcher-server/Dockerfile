# Use the official Docker image as a base
FROM docker:latest

# Install Node.js and npm using the Alpine package manager
RUN apk add --update nodejs npm

# Set the working directory in the container
WORKDIR /usr/src/app

# To leverage Docker cache, we copy all package.json files first.
COPY package*.json ./
COPY apps/bot-launcher-server/package.json ./apps/bot-launcher-server/

# Use npm ci for a clean, reliable install
RUN npm ci

# Now that dependencies are installed, copy the rest of the source code
COPY . .

# Grant execute permissions to the script
RUN chmod +x ./scripts.sh

# Only build the bot-launcher-server package
RUN npx turbo build --filter=bot-launcher-server

# Make port available
ARG BOT_LAUNCHER_SERVER_PORT=4100
EXPOSE ${BOT_LAUNCHER_SERVER_PORT}

# Run the app when the container launches
CMD ["npm", "run", "start", "-w", "bot-launcher-server"]
