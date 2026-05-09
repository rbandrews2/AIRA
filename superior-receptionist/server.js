require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "aira-store.json");

const DEFAULT_VOICE = process.env.AIRA_VOICE || "Polly.Joanna-Neural";
const TRANSFER_NUMBER = process.env.AIRA_TRANSFER_NUMBER || process.env.TWILIO_FORWARD_TO || "";
const RECORD_CALLS = process.env.AIRA_RECORD_CALLS === "true";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const store = loadStore();
const activeCalls = new Map();

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "aira-ai-receptionist", timestamp: new Date().toISOString() });
});

app.post("/voice/incoming", (req, res) => {
  const callSid = req.body.CallSid;
  const caller = req.body.From || "Unknown";

  activeCalls.set(callSid, {
    caller,
    startedAt: Date.now(),
    voice: store.settings.voice || DEFAULT_VOICE,
    screened: "New caller",
    transcript: [],
    pendingMessage: {},
  });

  const twiml = new twilio.twiml.VoiceResponse();
  if (RECORD_CALLS) {
    twiml.say({ voice: store.settings.voice || DEFAULT_VOICE }, "This call may be recorded for quality and training purposes.");
  }
  twiml.say(
    { voice: store.settings.voice || DEFAULT_VOICE, language: "en-US" },
    "Thank you for calling Superior Consultation, LLC. This is AIRA AI. How may I help you today?"
  );
  appendGather(twiml);
  twiml.redirect("/voice/no-input");

  res.type("text/xml").send(twiml.toString());
});

app.post("/voice/respond", async (req, res) => {
  const callSid = req.body.CallSid;
  const speech = (req.body.SpeechResult || "").trim();
  const call = activeCalls.get(callSid);
  const twiml = new twilio.twiml.VoiceResponse();

  if (!call) {
    twiml.say({ voice: store.settings.voice || DEFAULT_VOICE }, "I am sorry, this call session could not be found. Please call again.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  if (!speech) {
    twiml.say({ voice: call.voice }, "I did not catch that. Please say that again.");
    appendGather(twiml);
    return res.type("text/xml").send(twiml.toString());
  }

  call.transcript.push({ role: "caller", content: speech, at: new Date().toISOString() });
  call.screened = screenCall(speech, call.screened);

  if (wantsTransfer(speech) && TRANSFER_NUMBER) {
    twiml.say({ voice: call.voice }, "I can connect you now. Please hold while I transfer the call.");
    twiml.dial({ answerOnBridge: true }, TRANSFER_NUMBER);
    finalizeCall(callSid, "transferred");
    return res.type("text/xml").send(twiml.toString());
  }

  if (isGoodbye(speech)) {
    twiml.say({ voice: call.voice }, "Thank you for calling Superior Consultation. Have a productive day.");
    twiml.hangup();
    finalizeCall(callSid, "completed");
    return res.type("text/xml").send(twiml.toString());
  }

  const reply = await getAssistantReply(call, speech);
  call.transcript.push({ role: "assistant", content: reply, at: new Date().toISOString() });
  maybeCaptureMessage(call, speech);

  twiml.say({ voice: call.voice, language: "en-US" }, reply);
  appendGather(twiml);
  twiml.redirect("/voice/no-input");
  res.type("text/xml").send(twiml.toString());
});

app.post("/voice/no-input", (req, res) => {
  const call = activeCalls.get(req.body.CallSid);
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: call?.voice || store.settings.voice || DEFAULT_VOICE }, "I am still here if you need help.");
  appendGather(twiml);
  res.type("text/xml").send(twiml.toString());
});

app.post("/voice/status", (req, res) => {
  if (["completed", "busy", "failed", "no-answer", "canceled"].includes(req.body.CallStatus)) {
    finalizeCall(req.body.CallSid, req.body.CallStatus);
  }
  res.sendStatus(200);
});

app.get("/api/status", (_req, res) => {
  res.json({
    activeCalls: Array.from(activeCalls.entries()).map(([sid, call]) => ({
      sid,
      caller: call.caller,
      duration: Math.round((Date.now() - call.startedAt) / 1000),
      screened: call.screened,
      lastMessage: call.transcript.at(-1)?.content || "",
    })),
    callLogCount: store.calls.length,
    inboxCount: store.messages.length,
  });
});

app.get("/api/calls", (_req, res) => res.json(store.calls));
app.get("/api/messages", (_req, res) => res.json(store.messages));
app.get("/api/training", (_req, res) => res.json({ prompt: store.training }));

app.post("/api/messages", (req, res) => {
  const message = {
    id: req.body.id || cryptoId(),
    name: String(req.body.name || "Unknown").slice(0, 120),
    contact: String(req.body.contact || "").slice(0, 160),
    body: String(req.body.body || req.body.message || "").slice(0, 2000),
    urgency: String(req.body.urgency || "Normal").slice(0, 24),
    created_at: req.body.created_at || new Date().toISOString(),
  };
  store.messages.unshift(message);
  persistStore();
  res.status(201).json(message);
});

app.post("/api/training", (req, res) => {
  if (!req.body.prompt || typeof req.body.prompt !== "string") {
    return res.status(400).json({ error: "prompt is required" });
  }
  store.training = req.body.prompt.slice(0, 12000);
  store.trainingVersions.unshift({ prompt: store.training, created_at: new Date().toISOString() });
  persistStore();
  res.json({ ok: true });
});

app.post("/api/settings/voice", (req, res) => {
  store.settings.voice = String(req.body.voice || DEFAULT_VOICE);
  persistStore();
  res.json({ ok: true, voice: store.settings.voice });
});

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`AIRA AI receptionist running at http://localhost:${PORT}`);
});

function appendGather(twiml) {
  twiml.gather({
    input: "speech",
    action: "/voice/respond",
    method: "POST",
    speechTimeout: "auto",
    language: "en-US",
    timeout: 10,
  });
}

async function getAssistantReply(call, speech) {
  if (!anthropic) return localReply(speech);

  try {
    const messages = call.transcript
      .filter((turn) => turn.role === "caller" || turn.role === "assistant")
      .slice(-12)
      .map((turn) => ({ role: turn.role === "caller" ? "user" : "assistant", content: turn.content }));

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
      max_tokens: 180,
      system: store.training,
      messages,
    });

    return response.content?.[0]?.text || localReply(speech);
  } catch (error) {
    console.error("AIRA AI provider error:", error.message);
    return localReply(speech);
  }
}

function localReply(speech) {
  const lower = speech.toLowerCase();
  if (lower.includes("price") || lower.includes("cost")) {
    return "Our prices range from $9.99 to $4500 depending on the product, service, and personnel needed. I can collect a few details and route you to the right person.";
  }
  if (lower.includes("work zone") || lower.includes("desk-less") || lower.includes("deskless")) {
    return "Work Zone OS is our operating system for desk-less workers. It helps mobile crews and teams coordinate field work from one operational hub.";
  }
  if (lower.includes("contact") || lower.includes("email") || lower.includes("phone")) {
    return "Corporate inquiries can email info@superiorllc.org. Everyone else can email ray@workzoneos.org, or call 540-797-0405 or 844-685-7207 toll free.";
  }
  if (lower.includes("message") || lower.includes("callback") || lower.includes("call back")) {
    return "I can take a message. Please give me your name, best contact information, business name, and the reason for your call.";
  }
  return "Superior Consultation consults and develops applications for growing businesses. Tell me what you need built or solved, and I will help route the conversation.";
}

function screenCall(text, fallback) {
  const lower = text.toLowerCase();
  if (lower.includes("billing") || lower.includes("invoice") || lower.includes("payment")) return "Billing";
  if (lower.includes("support") || lower.includes("bug") || lower.includes("broken")) return "Technical support";
  if (lower.includes("sales") || lower.includes("price") || lower.includes("quote")) return "Sales";
  if (lower.includes("app") || lower.includes("build") || lower.includes("project")) return "New project";
  if (lower.includes("work zone")) return "Work Zone OS";
  return fallback || "General";
}

function maybeCaptureMessage(call, speech) {
  const lower = speech.toLowerCase();
  if (!lower.includes("message") && !lower.includes("callback") && !lower.includes("call back")) return;
  store.messages.unshift({
    id: cryptoId(),
    name: "Phone caller",
    contact: call.caller,
    body: speech,
    urgency: lower.includes("urgent") ? "Urgent" : "Normal",
    created_at: new Date().toISOString(),
  });
  persistStore();
}

function wantsTransfer(text) {
  const lower = text.toLowerCase();
  return lower.includes("transfer") || lower.includes("representative") || lower.includes("human") || lower.includes("person");
}

function isGoodbye(text) {
  const lower = text.toLowerCase();
  return lower.includes("goodbye") || lower === "bye" || lower.includes("hang up") || lower.includes("that's all");
}

function finalizeCall(callSid, status) {
  const call = activeCalls.get(callSid);
  if (!call) return;
  const durationSeconds = Math.round((Date.now() - call.startedAt) / 1000);
  store.calls.unshift({
    id: callSid,
    caller: call.caller,
    status,
    screened: call.screened,
    duration_seconds: durationSeconds,
    transcript: call.transcript,
    created_at: new Date(call.startedAt).toISOString(),
    ended_at: new Date().toISOString(),
  });
  activeCalls.delete(callSid);
  persistStore();
}

function loadStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
  return {
    settings: { voice: DEFAULT_VOICE },
    training: defaultTraining(),
    trainingVersions: [],
    messages: [],
    calls: [],
  };
}

function persistStore() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function defaultTraining() {
  return `You are AIRA AI, the professional secretary and receptionist for Superior Consultation, LLC.
Superior Consultation consults and develops applications. Superior Consultation is home to Work Zone OS - The operating system for desk-less workers.
Prices range from $9.99 to $4500 depending on the specific product and personnel.
Corporate email is info@superiorllc.org. Everyone else can email ray@workzoneos.org.
Phone numbers are 540-797-0405 and 844-685-7207 toll free.
AIRA AI is currently a call assistant with secretary-like duties. The long-term plan is to develop AIRA into a full AI smart phone operating system through legitimate native, carrier, telephony, and device AI integrations.
Keep responses short, warm, and natural. Ask one question at a time. Take messages when needed.`;
}

function cryptoId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
