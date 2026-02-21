FROM oven/bun:1-slim AS builder

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src/ ./src/
RUN bun install && bun build ./src/index.ts --compile --outfile /usr/local/bin/jin

FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates postgresql-client && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/jin /usr/local/bin/jin

# jin stores state here
VOLUME /root/.config/jin

ENTRYPOINT ["jin"]
CMD ["watch"]
