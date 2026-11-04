import { describe, expect, it } from "vitest";
import { GuestRequest, requestVia, walkInRequest } from "./requests";
import book from "../../fixtures/requests/requests.json";

describe("requestVia", () => {
  it("reads who · channel, with the app when known", () => {
    expect(requestVia({ via: { by: "agent", channel: "mcp" } })).toBe("AI agent · MCP");
    expect(requestVia({ via: { by: "agent", channel: "chat_app", app: "ChatGPT" } })).toBe(
      "AI agent · chat app (ChatGPT)",
    );
    expect(requestVia({ via: { by: "guest", channel: "resy_app", app: "iOS" } })).toBe(
      "Guest · Resy app (iOS)",
    );
    expect(requestVia({ via: { by: "guest", channel: "resy_web" } })).toBe("Guest · resy.com");
    expect(requestVia({ via: { by: "partner", channel: "api" } })).toBe("Partner · API");
    expect(requestVia({ via: { by: "staff", channel: "walk_in" } })).toBe("Staff · host stand");
  });

  it("reads 'not recorded' for a request without it", () => {
    expect(requestVia({})).toBe("not recorded");
  });

  it("is optional and strict", () => {
    const base = book.requests[1] as Record<string, unknown>;
    const { via: _drop, ...old } = base;
    expect(GuestRequest.safeParse(old).success).toBe(true);
    expect(
      GuestRequest.safeParse({ ...base, via: { by: "agent", channel: "mcp", extra: 1 } }).success,
    ).toBe(false);
    expect(GuestRequest.safeParse({ ...base, via: { by: "robot", channel: "mcp" } }).success).toBe(
      false,
    );
  });

  it("the fixtures: Whitaker's request came from an AI agent over MCP", () => {
    const q2 = GuestRequest.parse(book.requests.find((r) => r.id === "Q2"));
    expect(requestVia(q2)).toBe("AI agent · MCP");
    for (const r of book.requests) expect(GuestRequest.parse(r).via).toBeDefined();
  });

  it("a request taken at the host stand is staff · host stand", () => {
    const r = walkInRequest({
      id: "Q901",
      day: "Wed",
      bookRoomId: "dinner-peak",
      clock: "19:10",
      time: "19:30",
      partySize: 9,
      needs: [],
    });
    expect(requestVia(r)).toBe("Staff · host stand");
  });
});
