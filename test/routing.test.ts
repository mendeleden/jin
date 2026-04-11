import { describe, expect, test } from "bun:test";
import type { RouteConfig } from "../src/config";
import type { Conversation } from "../src/contracts/conversations";
import {
  matchesRoute,
  sinkIdsForConversation,
  sinksForConversation,
} from "../src/routing";
import type { Sink } from "../src/sinks/types";

type RoutableConversation = Pick<
  Conversation,
  "gitRemote" | "adapterId" | "branch" | "name"
>;

function makeConversation(
  overrides: Partial<RoutableConversation> = {},
): RoutableConversation {
  return {
    gitRemote: "github.com/Acme/API.git/",
    adapterId: "Cursor",
    branch: "fix/Auth",
    name: "Fix auth middleware",
    ...overrides,
  };
}

function makeSink(id: string): Sink {
  return {
    id,
    name: id,
    async push() {
      return {
        pushed: 0,
        failed: 0,
        errors: [],
      };
    },
    async healthCheck() {
      return { ok: true };
    },
    async close() {},
  };
}

const ALL_SINKS = [
  makeSink("postgres-team"),
  makeSink("s3-archive"),
  makeSink("webhook-cursor"),
];

describe("matchesRoute", () => {
  test("matches normalized remote globs case-insensitively", () => {
    const conversation = makeConversation();

    expect(
      matchesRoute({ remote: "github.com/acme/*" }, conversation),
    ).toBe(true);
    expect(
      matchesRoute({ remote: "git@github.com:acme/api.git" }, conversation),
    ).toBe(true);
  });

  test("matches adapter globs case-insensitively", () => {
    const conversation = makeConversation();

    expect(matchesRoute({ adapter: "cursor" }, conversation)).toBe(true);
    expect(matchesRoute({ adapter: "CURS?R" }, conversation)).toBe(true);
  });

  test("matches branch and name globs case-sensitively", () => {
    const conversation = makeConversation();

    expect(matchesRoute({ branch: "fix/*" }, conversation)).toBe(true);
    expect(matchesRoute({ branch: "FIX/*" }, conversation)).toBe(false);
    expect(matchesRoute({ name: "Fix auth middlewar?" }, conversation)).toBe(
      true,
    );
    expect(matchesRoute({ name: "fix auth *" }, conversation)).toBe(false);
  });

  test("uses AND semantics across every specified field", () => {
    const conversation = makeConversation({
      branch: "release/candidate",
      name: "Release candidate",
    });

    expect(
      matchesRoute(
        {
          remote: "github.com/acme/*",
          adapter: "cursor",
          branch: "release/*",
          name: "Release *",
        },
        conversation,
      ),
    ).toBe(true);

    expect(
      matchesRoute(
        {
          remote: "github.com/acme/*",
          branch: "main",
        },
        conversation,
      ),
    ).toBe(false);
  });

  test("treats an empty match object as a wildcard route", () => {
    expect(matchesRoute({}, makeConversation())).toBe(true);
  });
});

describe("routing engine", () => {
  test("unions sink ids from all matching routes", () => {
    const conversation = makeConversation();
    const routes: RouteConfig[] = [
      {
        match: { remote: "github.com/acme/*" },
        sinks: ["s3-archive", "postgres-team"],
      },
      {
        match: { adapter: "cursor" },
        sinks: ["postgres-team", "webhook-cursor"],
      },
      {
        match: { branch: "release/*" },
        sinks: ["never-used"],
      },
    ];

    expect(sinkIdsForConversation(conversation, routes)).toEqual([
      "s3-archive",
      "postgres-team",
      "webhook-cursor",
    ]);

    expect(
      sinksForConversation(conversation, routes, ALL_SINKS).map((sink) => sink.id),
    ).toEqual(["postgres-team", "s3-archive", "webhook-cursor"]);
  });

  test("returns an empty sink set when no routes match", () => {
    const conversation = makeConversation();
    const routes: RouteConfig[] = [
      { match: { remote: "github.com/acme/other" }, sinks: ["postgres-team"] },
    ];

    expect(sinkIdsForConversation(conversation, routes)).toEqual([]);
    expect(sinksForConversation(conversation, routes, ALL_SINKS)).toEqual([]);
  });

  test("returns an empty sink set when no routes are configured", () => {
    expect(sinkIdsForConversation(makeConversation(), [])).toEqual([]);
    expect(sinksForConversation(makeConversation(), [], ALL_SINKS)).toEqual([]);
  });

  test("accepts wider session-shaped callers without a routing bridge", () => {
    const conversation = {
      ...makeConversation(),
      adapterName: "Cursor",
      sourcePath: "/tmp/conversation.jsonl",
    };
    const routes: RouteConfig[] = [
      { match: { remote: "github.com/acme/*" }, sinks: ["postgres-team"] },
      { match: { adapter: "cursor" }, sinks: ["webhook-cursor"] },
    ];

    expect(
      sinksForConversation(conversation, routes, ALL_SINKS).map(
        (sink) => sink.id,
      ),
    ).toEqual(["postgres-team", "webhook-cursor"]);
  });
});
