// Runs before every test file: a real IndexedDB (in memory) and no on-device AI, so tests check Kold's own rules.
import "fake-indexeddb/auto";
import { vi } from "vitest";

vi.mock("@/local/ai", () => ({
  aiReady: () => false,
  aiLabel: () => "",
  generate: async () => null,
  generateJson: async () => null,
  onAiStatus: () => () => {},
  detect: async () => ({ supported: false, reason: "tests", recommended: "light" }),
  resume: async () => {},
  TIERS: {},
}));
