import type { ClientError } from "../api";

export function friendlyError(err: ClientError): { title: string; body: string } {
  switch (err.code) {
    case "rate_limited":
      return {
        title: "Slow down a little",
        body: "Too many messages in a short time. Wait a moment and try again.",
      };
    case "budget":
      return {
        title: "Demo budget reached",
        body: "The agent is paused for this demo. Manual controls and the build plan still work.",
      };
    case "no_key":
      return {
        title: "Agent not configured",
        body: "This server has no model API key, so the agent can't answer. Manual controls still work.",
      };
    case "timeout":
      return { title: "The agent took too long", body: "Try again, or ask a narrower question." };
    case "upstream":
      return {
        title: "Model provider error",
        body: "The model service returned an error. Try again shortly.",
      };
    case "bad_request":
      return { title: "Request rejected", body: err.message };
    case "network":
    case "not_found":
      return {
        title: "Can't reach the agent",
        body: "The API server isn't responding. Is it running?",
      };
    case "bad_response":
      return {
        title: "Unexpected response",
        body: "The server's answer didn't match the expected shape.",
      };
  }
}
