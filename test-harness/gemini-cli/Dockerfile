FROM node:22-slim

RUN npm install -g @google/gemini-cli

# Create a sample project to work on
WORKDIR /workspace

# Entry: run gemini with a prompt, then keep container alive so jin can read data
COPY scripts/run-gemini.sh /run.sh
RUN chmod +x /run.sh
CMD ["/run.sh"]
