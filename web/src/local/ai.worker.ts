import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// Runs the on-device AI model off the main thread so the app stays smooth while it thinks.
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
