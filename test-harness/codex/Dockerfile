FROM node:22-slim

# Install codex CLI
RUN npm install -g @openai/codex

WORKDIR /workspace

COPY scripts/run-codex.sh /run.sh
RUN chmod +x /run.sh
CMD ["/run.sh"]
