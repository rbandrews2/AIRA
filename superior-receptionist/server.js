require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "aira-store.json");

const DEFAULT_VOICE = process.env.AIRA_VOICE || "Polly.Joanna-Neural";
const TRANSFER_NUMBER = process.env.AIRA_TRANSFER_NUMBER || process.env.TWILIO_FORWARD_TO || "";
const RECORD_CALLS = process.env.AIRA_RECORD_CALLS === "true";
const AIRA_OWNER_ID = process.env.AIRA_OWNER_ID || "";
const AIRA_ASSISTANT_FUNCTION_URL = process.env.AIRA_ASSISTANT_FUNCTION_URL || "";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

const store = loadStore();
const activeCalls = new Map();

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "aira-ai-receptionist", timestamp: new Date().toISOString() });
});

app.post("/voice/incoming", async (req, res) => {
  const callSid = req.body.CallSid;
  const caller = req.body.From || "Unknown";
  const call = {
    caller,
    startedAt: Date.now(),
    voice: store.settings.voice || DEFAULT_VOICE,
    screened: "New caller",
    transcript: [],
    pendingMessage: {},
    dbCallId: null,
    memory: {},
  };

  call.dbCallId = await createSupabaseCall(callSid, call);
  activeCalls.set(callSid, call);

  const twiml = new twilio.twiml.VoiceResponse();
  if (RECORD_CALLS) {
    twiml.say({ voice: store.settings.voice || DEFAULT_VOICE }, "This call may be recorded for quality and training purposes.");
  }
  twiml.say(
    { voice: store.settings.voice || DEFAULT_VOICE, language: "en-US" },
    "Thanks for calling Superior Consultation, LLC. This is AIRA. How can I help?"
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
    await persistSupabaseTurn(call, "caller", speech);
    twiml.say({ voice: call.voice }, "I can connect you now. Please hold while I transfer the call.");
    twiml.dial({ answerOnBridge: true }, TRANSFER_NUMBER);
    await finalizeCall(callSid, "transferred");
    return res.type("text/xml").send(twiml.toString());
  }

  if (isGoodbye(speech)) {
    await persistSupabaseTurn(call, "caller", speech);
    twiml.say({ voice: call.voice }, "Thank you for calling Superior Consultation. Have a productive day.");
    twiml.hangup();
    await finalizeCall(callSid, "completed");
    return res.type("text/xml").send(twiml.toString());
  }

  const { reply, persistedByEdge } = await getAssistantReply(call, speech);
  call.transcript.push({ role: "assistant", content: reply, at: new Date().toISOString() });
  if (!persistedByEdge) {
    await persistSupabaseTurn(call, "caller", speech);
    await persistSupabaseTurn(call, "aira", reply);
  }
  await maybeCaptureMessage(call, speech);

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
    finalizeCall(req.body.CallSid, req.body.CallStatus).catch((error) => {
      console.error("Finalize call error:", error.message);
    });
  }
  res.sendStatus(200);
});

app.get("/api/status", async (_req, res) => {
  const supabaseCounts = await getSupabaseCounts();
  res.json({
    activeCalls: Array.from(activeCalls.entries()).map(([sid, call]) => ({
      sid,
      caller: call.caller,
      duration: Math.round((Date.now() - call.startedAt) / 1000),
      screened: call.screened,
      lastMessage: call.transcript.at(-1)?.content || "",
    })),
    callLogCount: supabaseCounts.calls ?? store.calls.length,
    inboxCount: supabaseCounts.messages ?? store.messages.length,
  });
});

app.get("/api/calls", async (_req, res) => {
  const calls = await getSupabaseCalls();
  res.json(calls || store.calls);
});

app.get("/api/messages", async (_req, res) => {
  const messages = await getSupabaseMessages();
  res.json(messages || store.messages);
});

app.get("/api/training", async (_req, res) => {
  const prompt = await getSupabaseTraining();
  res.json({ prompt: prompt || store.training });
});

app.post("/api/messages", async (req, res) => {
  const phone = String(req.body.phone || "").slice(0, 80);
  const email = String(req.body.email || "").slice(0, 120);
  const message = {
    id: req.body.id || cryptoId(),
    name: String(req.body.name || "Unknown").slice(0, 120),
    phone,
    email,
    business_name: String(req.body.business_name || req.body.business || "").slice(0, 160),
    contact: String(req.body.contact || [phone, email].filter(Boolean).join(" | ")).slice(0, 220),
    body: String(req.body.body || req.body.message || "").slice(0, 2000),
    urgency: String(req.body.urgency || "Normal").slice(0, 24),
    created_at: req.body.created_at || new Date().toISOString(),
  };
  store.messages.unshift(message);
  persistStore();
  await persistSupabaseMessage(message);
  res.status(201).json(message);
});

app.post("/api/training", async (req, res) => {
  if (!req.body.prompt || typeof req.body.prompt !== "string") {
    return res.status(400).json({ error: "prompt is required" });
  }
  store.training = req.body.prompt.slice(0, 12000);
  store.trainingVersions.unshift({ prompt: store.training, created_at: new Date().toISOString() });
  persistStore();
  await persistSupabaseTraining(store.training);
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
  const edgeReply = await getEdgeAssistantReply(call, speech);
  if (edgeReply) return edgeReply;

  if (!anthropic) return { reply: localReply(speech, call), persistedByEdge: false };

  try {
    const messages = call.transcript
      .filter((turn) => turn.role === "caller" || turn.role === "assistant")
      .slice(-12)
      .map((turn) => ({ role: turn.role === "caller" ? "user" : "assistant", content: turn.content }));

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
      max_tokens: 90,
      system: store.training,
      messages,
    });

    return { reply: response.content?.[0]?.text || localReply(speech, call), persistedByEdge: false };
  } catch (error) {
    console.error("AIRA AI provider error:", error.message);
    return { reply: localReply(speech, call), persistedByEdge: false };
  }
}

async function getEdgeAssistantReply(call, speech) {
  if (!AIRA_ASSISTANT_FUNCTION_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  try {
    const response = await fetch(AIRA_ASSISTANT_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        owner_id: AIRA_OWNER_ID || undefined,
        caller_text: speech,
        call_id: call.dbCallId || undefined,
        history: call.transcript.slice(-8).map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
      }),
    });

    if (!response.ok) throw new Error(`Edge Function returned ${response.status}`);
    const data = await response.json();
    if (!data.reply) return null;
    return { reply: String(data.reply), persistedByEdge: Boolean(call.dbCallId) };
  } catch (error) {
    console.error("AIRA Edge Function error:", error.message);
    return null;
  }
}

function localReply(speech, call = {}) {
  const lower = speech.toLowerCase();
  const memory = call.memory || {};
  updateCallMemory(memory, speech);

  if (memory.pending === "contact" && looksLikeContact(speech)) {
    memory.contact = speech;
    memory.pending = null;
    return "Got it. I have your details and message. I will route this to the right person.";
  }

  if (isAffirmative(lower) && memory.pending === "details") {
    memory.pending = "contact";
    return "Great. What name, number, email, and business should I include?";
  }

  if (lower.includes("i need") || lower.includes("we need") || lower.includes("looking for") || lower.includes("want to build")) {
    memory.intent = speech;
    memory.pending = "details";
    return "I can route that. Is it a new app, existing system, or Work Zone OS?";
  }

  if (lower.includes("price") || lower.includes("cost")) {
    memory.pending = "details";
    return "Pricing ranges from $9.99 to $4500. What are you trying to launch or improve?";
  }
  if (lower.includes("work zone") || lower.includes("desk-less") || lower.includes("deskless")) {
    memory.intent = "Work Zone OS";
    return "Work Zone OS supports desk-less crews. Are you focused on dispatch, job tracking, or communication?";
  }
  if (lower.includes("contact") || lower.includes("email") || lower.includes("phone")) {
    return "Corporate inquiries can email info@superiorllc.org. Everyone else can email ray@workzoneos.org, or call 540-797-0405 or 844-685-7207 toll free.";
  }
  if (lower.includes("message") || lower.includes("callback") || lower.includes("call back")) {
    memory.pending = "contact";
    return "Sure thing. What's your name, number, email, business, and message?";
  }
  if (memory.intent && !memory.contact) {
    memory.pending = "contact";
    return `Got it, ${memory.intent}. Who should we contact, and what number or email should we use?`;
  }
  return "I can take a message, discuss Work Zone OS, or route support. What do you need handled?";
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

async function maybeCaptureMessage(call, speech) {
  const lower = speech.toLowerCase();
  if (!lower.includes("message") && !lower.includes("callback") && !lower.includes("call back")) return;
  const message = {
    id: cryptoId(),
    name: "Phone caller",
    contact: call.caller,
    phone: call.caller,
    email: "",
    business_name: "",
    body: speech,
    urgency: lower.includes("urgent") ? "Urgent" : "Normal",
    created_at: new Date().toISOString(),
  };
  store.messages.unshift(message);
  persistStore();
  await persistSupabaseMessage(message);
}

function wantsTransfer(text) {
  const lower = text.toLowerCase();
  return lower.includes("transfer") || lower.includes("representative") || lower.includes("human") || lower.includes("person");
}

function isGoodbye(text) {
  const lower = text.toLowerCase();
  return lower.includes("goodbye") || lower === "bye" || lower.includes("hang up") || lower.includes("that's all");
}

async function finalizeCall(callSid, status) {
  const call = activeCalls.get(callSid);
  if (!call) return;
  const durationSeconds = Math.round((Date.now() - call.startedAt) / 1000);
  const completedCall = {
    id: callSid,
    caller: call.caller,
    status,
    screened: call.screened,
    duration_seconds: durationSeconds,
    transcript: call.transcript,
    created_at: new Date(call.startedAt).toISOString(),
    ended_at: new Date().toISOString(),
  };
  store.calls.unshift(completedCall);
  activeCalls.delete(callSid);
  persistStore();
  await finalizeSupabaseCall(call, status, durationSeconds);
}

async function createSupabaseCall(callSid, call) {
  if (!supabase || !AIRA_OWNER_ID) return null;

  const { data, error } = await supabase
    .from("aira_calls")
    .insert({
      owner_id: AIRA_OWNER_ID,
      provider: "twilio",
      provider_call_id: callSid,
      caller_number: call.caller,
      call_status: "active",
      screened_category: call.screened,
      started_at: new Date(call.startedAt).toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("Supabase call create error:", error.message);
    return null;
  }
  return data.id;
}

async function finalizeSupabaseCall(call, status, durationSeconds) {
  if (!supabase || !call.dbCallId) return;

  const normalizedStatus = normalizeCallStatus(status);
  const transcriptSummary = summarizeTranscript(call.transcript);
  const { error } = await supabase
    .from("aira_calls")
    .update({
      call_status: normalizedStatus,
      screened_category: call.screened || "General",
      duration_seconds: durationSeconds,
      transcript_summary: transcriptSummary,
      ended_at: new Date().toISOString(),
    })
    .eq("id", call.dbCallId);

  if (error) console.error("Supabase call finalize error:", error.message);
}

async function persistSupabaseTurn(call, speaker, textBody) {
  if (!supabase || !call.dbCallId || !textBody) return;

  const { error } = await supabase.from("aira_call_turns").insert({
    call_id: call.dbCallId,
    speaker,
    text_body: textBody,
  });
  if (error) console.error("Supabase turn insert error:", error.message);
}

async function persistSupabaseMessage(message) {
  if (!supabase || !AIRA_OWNER_ID) return;

  const { error } = await supabase.from("aira_messages").insert({
    owner_id: AIRA_OWNER_ID,
    caller_name: message.name || "Unknown",
    caller_contact: message.contact || "",
    business_name: message.business_name || "",
    message_body: message.body || "",
    urgency: normalizeUrgency(message.urgency),
    source: "aira",
    status: "new",
    created_at: message.created_at || new Date().toISOString(),
  });
  if (error) console.error("Supabase message insert error:", error.message);
}

async function persistSupabaseTraining(prompt) {
  if (!supabase || !AIRA_OWNER_ID) return;

  await supabase
    .from("aira_training_versions")
    .update({ is_active: false })
    .eq("owner_id", AIRA_OWNER_ID)
    .eq("is_active", true);

  const { error } = await supabase.from("aira_training_versions").insert({
    owner_id: AIRA_OWNER_ID,
    title: "AIRA AI Receptionist Training",
    prompt,
    source: "dashboard",
    is_active: true,
  });
  if (error) console.error("Supabase training insert error:", error.message);
}

async function getSupabaseCounts() {
  if (!supabase || !AIRA_OWNER_ID) return {};

  const [calls, messages] = await Promise.all([
    supabase
      .from("aira_calls")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", AIRA_OWNER_ID),
    supabase
      .from("aira_messages")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", AIRA_OWNER_ID),
  ]);

  if (calls.error) console.error("Supabase call count error:", calls.error.message);
  if (messages.error) console.error("Supabase message count error:", messages.error.message);
  return {
    calls: calls.error ? null : calls.count,
    messages: messages.error ? null : messages.count,
  };
}

async function getSupabaseCalls() {
  if (!supabase || !AIRA_OWNER_ID) return null;

  const { data, error } = await supabase
    .from("aira_call_transcripts")
    .select("*")
    .eq("owner_id", AIRA_OWNER_ID)
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Supabase calls fetch error:", error.message);
    return null;
  }

  return data.map((call) => ({
    id: call.provider_call_id || call.id,
    caller: call.caller_number || "Unknown",
    status: call.call_status,
    screened: call.screened_category,
    duration_seconds: call.duration_seconds,
    transcript: call.transcript,
    created_at: call.started_at,
    ended_at: call.ended_at,
  }));
}

async function getSupabaseMessages() {
  if (!supabase || !AIRA_OWNER_ID) return null;

  const { data, error } = await supabase
    .from("aira_messages")
    .select("*")
    .eq("owner_id", AIRA_OWNER_ID)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Supabase messages fetch error:", error.message);
    return null;
  }

  return data.map((message) => ({
    id: message.id,
    name: message.caller_name,
    contact: message.caller_contact,
    phone: extractPhone(message.caller_contact),
    email: extractEmail(message.caller_contact),
    business_name: message.business_name,
    body: message.message_body,
    urgency: message.urgency,
    status: message.status,
    created_at: message.created_at,
  }));
}

async function getSupabaseTraining() {
  if (!supabase || !AIRA_OWNER_ID) return null;

  const { data, error } = await supabase
    .from("aira_training_versions")
    .select("prompt")
    .eq("owner_id", AIRA_OWNER_ID)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Supabase training fetch error:", error.message);
    return null;
  }
  return data?.prompt || null;
}

function normalizeCallStatus(status) {
  if (status === "transferred") return "transferred";
  if (status === "completed") return "completed";
  if (status === "busy" || status === "no-answer" || status === "canceled") return "missed";
  if (status === "failed") return "failed";
  return "completed";
}

function normalizeUrgency(urgency) {
  if (["Low", "Normal", "High", "Urgent"].includes(urgency)) return urgency;
  return "Normal";
}

function summarizeTranscript(transcript) {
  return transcript
    .slice(-6)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join("\n")
    .slice(0, 2000);
}

function updateCallMemory(memory, speech) {
  const lower = speech.toLowerCase();
  if (lower.includes("app")) memory.intent = "application development";
  if (lower.includes("work zone") || lower.includes("desk-less") || lower.includes("deskless")) memory.intent = "Work Zone OS";
  if (lower.includes("support") || lower.includes("bug") || lower.includes("broken")) memory.intent = "technical support";
  if (looksLikeContact(speech)) memory.contact = speech;
}

function looksLikeContact(text) {
  return /@/.test(text) || /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text);
}

function extractPhone(value) {
  return String(value || "").match(/\+?\d[\d().\-\s]{7,}\d/)?.[0]?.trim() || "";
}

function extractEmail(value) {
  return String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

function isAffirmative(lower) {
  return ["yes", "yeah", "yep", "sure", "correct", "that is right", "please"].some((word) => lower.includes(word));
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
  return `You are AIRA, the upbeat, professional, polite receptionist for Superior Consultation, LLC.
Superior Consultation consults and develops applications. Superior Consultation is home to Work Zone OS - The operating system for desk-less road crews and field teams.
Prices range from $9.99 to $4500 depending on the specific product and personnel.
Corporate email is info@superiorllc.org. Everyone else can email ray@workzoneos.org.
Phone numbers are 540-797-0405 and 844-685-7207 toll free.
AIRA answers calls, determines caller intent, takes messages, and collects caller name, contact number, email address, business represented, and message when available.
Keep responses under 20 words when possible. Use contractions. Ask one question at a time. Avoid AI cliches.`;
}

function cryptoId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
