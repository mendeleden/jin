FROM node:22-slim

RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*

# Install opencode
RUN npm install -g opencode-ai@latest || curl -fsSL https://opencode.ai/install | bash || true

WORKDIR /workspace

COPY scripts/run-opencode.sh /run.sh
RUN chmod +x /run.sh
CMD ["/run.sh"]
