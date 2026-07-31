FROM node:22-slim

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm@10.26.1

# Copy workspace manifest files first (for layer caching)
COPY package.json pnpm-workspace.yaml ./
COPY tsconfig.json ./

# Copy all package.json files for each workspace member
COPY lib/db/package.json ./lib/db/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/bingo-app/package.json ./artifacts/bingo-app/

# Copy lockfile and install dependencies
COPY pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy full source
COPY . .

# Build server + frontend
RUN pnpm run build

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 8080

CMD ["./docker-entrypoint.sh"]
