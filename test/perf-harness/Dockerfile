FROM oven/bun:1.3-alpine

RUN apk add --no-cache procps curl bash coreutils

# Create test user
RUN adduser -D -h /home/testuser testuser
USER testuser
WORKDIR /home/testuser

# Copy the jin source and build
COPY --chown=testuser:testuser . /home/testuser/jin-src
RUN cd /home/testuser/jin-src && bun install && bun run scripts/embed-spa.ts && bun build ./src/index.ts --compile --outfile /home/testuser/bin/jin

# Add to PATH
ENV PATH="/home/testuser/bin:${PATH}"

# Copy conversation fixtures (populated by run.sh before build)
COPY --chown=testuser:testuser test/perf-harness/fixtures/ /home/testuser/.claude/projects/

# The harness script
COPY --chown=testuser:testuser test/perf-harness/harness.sh /home/testuser/harness.sh
RUN chmod +x /home/testuser/harness.sh

CMD ["/home/testuser/harness.sh"]
