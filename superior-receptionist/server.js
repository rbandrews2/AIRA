require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const conversation = require("./public/conversation");
const {gatewayReply}=require('./lib/gateway');
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.AIRA_DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "aira-store.json");

const DEFAULT_VOICE = process.env.AIRA_VOICE || "Polly.Joanna-Neural";
const TRANSFER_NUMBER = process.env.AIRA_TRANSFER_NUMBER || process.env.TWILIO_FORWARD_TO || "";
const RECORD_CALLS = process.env.AIRA_RECORD_CALLS === "true";
const AIRA_OWNER_ID = process.env.AIRA_OWNER_ID || "";
const AIRA_ASSISTANT_FUNCTION_URL = process.env.AIRA_ASSISTANT_FUNCTION_URL || "";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 6500, maxRetries: 0 })
  : null;
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

const store = loadStore();
const activeCalls = new Map();
// Express 4 does not automatically forward rejected async route handlers.
function post(route, handler) { app.post(route, (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next)); }
function get(route, handler) { app.get(route, (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next)); }

app.use((req, res, next) => {
  if (process.env.AIRA_ALLOWED_ORIGIN) res.setHeader("Access-Control-Allow-Origin", process.env.AIRA_ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

get("/health", (_req, res) => {
  res.json({ ok: true, service: "aira-ai-receptionist", timestamp: new Date().toISOString() });
});

app.use("/voice", (req, res, next) => {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const publicUrl = process.env.PUBLIC_URL;
  if (process.env.AIRA_LOCAL_TEST === "true" && process.env.NODE_ENV !== "production" && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return next();
  if (!token || !publicUrl) return res.status(503).json({error: "Voice webhook validation is not configured"});
  const valid = twilio.validateRequest(token, req.get("X-Twilio-Signature") || "", publicUrl.replace(/\/$/, "") + req.originalUrl, req.body);
  if (!valid) return res.sendStatus(403);
  next();
});

post("/voice/incoming", async (req, res) => {
  const callSid = req.body.CallSid;
  if (!callSid) return res.sendStatus(400);
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
  appendGather(twiml, conversation.greeting, call.voice);

  res.type("text/xml").send(twiml.toString());
});

post("/voice/respond", async (req, res) => {
  const callSid = req.body.CallSid;
  const speech = (req.body.SpeechResult || "").trim();
  const call = activeCalls.get(callSid);
  const twiml = new twilio.twiml.VoiceResponse();

  if (!call) {
    twiml.say({ voice: store.settings.voice || DEFAULT_VOICE }, "I am sorry, this call session could not be found. Please call again.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  if (!speech) return handleSilence(callSid, twiml, res);
  call.silenceCount = 0;
  if (req.body.Confidence !== undefined && Number(req.body.Confidence) < 0.45) {
    appendGather(twiml, "The line broke up a little. Would you say that again?", call.voice);
    return res.type("text/xml").send(twiml.toString());
  }

  call.transcript.push({ role: "caller", content: speech, at: new Date().toISOString() });
  call.screened = screenCall(speech, call.screened);

  if (!call.memory.stage && wantsTransfer(speech) && TRANSFER_NUMBER) {
    await persistSupabaseTurn(call, "caller", speech);
    twiml.say({ voice: call.voice }, "I can connect you now. Please hold while I transfer the call.");
    twiml.dial({ answerOnBridge: true, action: "/voice/transfer-result", method: "POST", timeout: 20 }, TRANSFER_NUMBER);
    return res.type("text/xml").send(twiml.toString());
  }

  if (!call.memory.stage && isGoodbye(speech)) {
    await persistSupabaseTurn(call, "caller", speech);
    twiml.say({ voice: call.voice }, "Thanks for calling. Take care!");
    twiml.hangup();
    await finalizeCall(callSid, "completed");
    return res.type("text/xml").send(twiml.toString());
  }

  const { reply, persistedByEdge } = await getAssistantReply(call, speech);
  if (/would you like to leave (?:a message|one)/i.test(reply)) call.memory.offerMessage = true;
  call.transcript.push({ role: "assistant", content: reply, at: new Date().toISOString() });
  if (!persistedByEdge) {
    await persistSupabaseTurn(call, "caller", speech);
    await persistSupabaseTurn(call, "aira", reply);
  }

  appendGather(twiml, reply, call.voice);
  res.type("text/xml").send(twiml.toString());
});

function handleSilence(callSid, twiml, res) {
  const call = activeCalls.get(callSid);
  if (!call || (call.silenceCount = (call.silenceCount || 0) + 1) >= 3) {
    twiml.say({voice: call?.voice || DEFAULT_VOICE}, "I can't hear you, so I'll let you go. You're welcome to call again. Goodbye.");
    twiml.hangup();
    finalizeCall(callSid, "completed").catch(() => console.error("Could not finalize silent call"));
  } else appendGather(twiml, call.silenceCount === 1 ? "Are you still there? Take your time." : "I'm having trouble hearing you. Could you try once more?", call.voice);
  return res.type("text/xml").send(twiml.toString());
}
post("/voice/no-input", (req, res) => handleSilence(req.body.CallSid, new twilio.twiml.VoiceResponse(), res));
post("/voice/transfer-result", async (req, res) => {
  const call = activeCalls.get(req.body.CallSid);
  const twiml = new twilio.twiml.VoiceResponse();
  if (req.body.DialCallStatus === "completed") {
    twiml.hangup();
    await finalizeCall(req.body.CallSid, "transferred");
  } else if (call) {
    call.memory.offerMessage = true;
    appendGather(twiml, "I couldn't reach anyone just now. Would you like to leave a message?", call.voice);
  } else twiml.hangup();
  res.type("text/xml").send(twiml.toString());
});

post("/voice/status", (req, res) => {
  if (["completed", "busy", "failed", "no-answer", "canceled"].includes(req.body.CallStatus)) {
    finalizeCall(req.body.CallSid, req.body.CallStatus).catch((error) => {
      console.error("Finalize call error:", error.message);
    });
  }
  res.sendStatus(200);
});

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const expected = process.env.AIRA_OPERATOR_TOKEN;
  if (!expected) return res.status(503).json({error: "Operator access is not configured"});
  const actual = req.get("Authorization") || "";
  const a = Buffer.from(actual), b = Buffer.from("Bearer " + expected);
  if (a.length !== b.length || !require("node:crypto").timingSafeEqual(a,b)) return res.sendStatus(401);
  next();
});

get("/api/status", async (_req, res) => {
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

get("/api/calls", async (_req, res) => {
  const calls = await getSupabaseCalls();
  res.json(calls || store.calls);
});

get("/api/messages", async (_req, res) => {
  const messages = await getSupabaseMessages();
  const pending = store.messages.filter(message => message.sync_pending);
  res.json(messages ? [...pending.filter(message => !messages.some(remote => remote.id === message.id)), ...messages] : store.messages);
});

// Private inbox mutations use the same durable store as the live phone service.
for (const collection of ["messages", "calls"]) {
  for (const method of ["patch", "delete"]) {
    app[method](`/api/${collection}/:id`, (req, res, next) => {
      try {
        // A different storage authority must not receive a false local success.
        if (supabase && AIRA_OWNER_ID) return res.status(503).json({error:"Inbox changes require the configured database adapter"});
        const index = store[collection].findIndex(item => String(item.id) === req.params.id);
        if (index < 0) return res.status(404).json({error:"Record not found"});
        const previous = store[collection];
        const record = previous[index];
        let updated;
        if (method === "patch") {
          const allowed = collection === "messages" ? ["new", "archived", "organized"] : ["completed", "archived"];
          if (!allowed.includes(req.body.status)) return res.status(400).json({error:"Invalid status"});
          updated = {...record, status:req.body.status};
          if (collection === "messages" && req.body.message) {
            for (const key of ["name","phone","email","business_name","contact","body","urgency"]) {
              if (typeof req.body.message[key] === "string") updated[key] = req.body.message[key].slice(0,key === "body" ? 2000 : 220);
            }
          }
          store[collection] = previous.map((item,i) => i === index ? updated : item);
        } else store[collection] = previous.filter((_,i) => i !== index);
        try { persistStore(); } catch(error) { store[collection] = previous; throw error; }
        res.json(method === "delete" ? {ok:true,id:req.params.id} : updated);
      } catch(error) { next(error); }
    });
  }
}

get("/api/training", async (_req, res) => {
  const prompt = await getSupabaseTraining();
  res.json({ prompt: conversation.normalizeBrand(prompt || store.training) });
});

// Authenticated, idempotent recovery of records preserved before a deployment.
post('/api/restore',async(req,res)=>{
  const incoming=req.body;
  if(!incoming||!Array.isArray(incoming.calls)||!Array.isArray(incoming.messages)||incoming.calls.length>1000||incoming.messages.length>1000||[...incoming.calls,...incoming.messages].some(item=>!item||typeof item.id!=='string'))return res.status(400).json({error:'Invalid recovery snapshot'});
  const previous={calls:store.calls,messages:store.messages,training:store.training};
  for(const key of ['calls','messages']){
    const known=new Set(store[key].map(item=>item.id));
    store[key]=[...store[key],...incoming[key].filter(item=>{if(known.has(item.id))return false;known.add(item.id);return true;})];
  }
  if(typeof incoming.training==='string' && !store.trainingVersions.length)store.training=incoming.training.slice(0,12000);
  try{persistStore();}catch(error){Object.assign(store,previous);throw error;}
  res.json({ok:true,calls:store.calls.length,messages:store.messages.length});
});

post("/api/messages", async (req, res) => {
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

post("/api/training", async (req, res) => {
  if (!req.body.prompt || typeof req.body.prompt !== "string") {
    return res.status(400).json({ error: "prompt is required" });
  }
  store.training = conversation.normalizeBrand(req.body.prompt.slice(0, 12000));
  store.trainingVersions.unshift({ prompt: store.training, created_at: new Date().toISOString() });
  persistStore();
  await persistSupabaseTraining(store.training);
  res.json({ ok: true });
});

post("/api/settings/voice", (req, res) => {
  store.settings.voice = String(req.body.voice || DEFAULT_VOICE);
  persistStore();
  res.json({ ok: true, voice: store.settings.voice });
});

post("/api/simulate", async (req, res) => {
  const text = String(req.body.text || "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({error: "text is required"});
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-40) : [];
  const call = {memory: {}, transcript: [], simulation: true};
  // Replay caller turns only, preserving deterministic message state without trusting client state.
  for (const turn of history) {
    const content = String(turn.content || turn.text || "").slice(0,2000);
    if (["user", "caller"].includes(turn.role)) {
      const step = conversation.advance(call.memory, content);
      if (step?.save) conversation.saved(call.memory);
      call.transcript.push({role: "caller", content});
    } else if (turn.role === "assistant") {
      if (/would you like to leave (?:a message|one)/i.test(content)) call.memory.offerMessage = true;
      call.transcript.push({role: "assistant", content});
    }
  }
  call.transcript.push({role: "caller", content: text});
  const result = await getAssistantReply(call, text);
  res.json({reply: result.reply});
});

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((error, req, res, _next) => {
  console.error("AIRA request failed:", error.name);
  if (res.headersSent) return;
  if (req.path.startsWith("/voice/")) {
    const twiml = new twilio.twiml.VoiceResponse();
    appendGather(twiml, "I'm sorry, something went wrong. Please try that again.");
    return res.type("text/xml").send(twiml.toString());
  }
  res.status(500).json({error: "Unable to complete request"});
});

if (require.main === module) app.listen(PORT, process.env.AIRA_BIND_HOST || "0.0.0.0", () => {
  console.log(`AIRA AI receptionist running at http://localhost:${PORT}`);
});

module.exports = { app, activeCalls, store, getAssistantReply };

function appendGather(twiml, prompt, voice = DEFAULT_VOICE) {
  const gather = twiml.gather({input: "speech", action: "/voice/respond", method: "POST", speechTimeout: 2, language: "en-US", timeout: 8, actionOnEmptyResult: true});
  if (prompt) gather.say({voice, language: "en-US"}, prompt);
}

async function getAssistantReply(call, speech, provider = anthropic) {
  const step = conversation.advance(call.memory, speech);
  if (step) {
    if (!step.save) return {reply: step.reply, persistedByEdge: false};
    if (call.simulation) {
      conversation.saved(call.memory);
      return {reply: "In a real call, I'd save that confirmed message now. This practice message hasn't been sent.", persistedByEdge: false};
    }
    const message = {id: cryptoId(), ...step.save, business_name: "", sync_pending: true, created_at: new Date().toISOString()};
    store.messages.unshift(message);
    try { persistStore(); }
    catch (error) {
      store.messages.shift();
      return {reply: "I'm sorry, I couldn't save your message. Shall I try again?", persistedByEdge: false};
    }
    conversation.saved(call.memory);
    if (await persistSupabaseMessage(message)) {
      message.sync_pending = false;
      try { persistStore(); } catch { console.error("Could not update message sync status"); }
    }
    return {reply: "Thanks, I've saved your message for the team. Is there anything else I can help with?", persistedByEdge: false};
  }
  if (wantsTransfer(speech)) return {reply: localReply(speech, call), persistedByEdge: false};
  if(process.env.AIRA_GATEWAY_URL){
    try{return {reply:conversation.normalizeBrand(await gatewayReply(call.transcript)),persistedByEdge:false};}
    catch(error){console.error('Aira phone gateway unavailable:',error.message);return {reply:localReply(speech,call),persistedByEdge:false};}
  }
  const edgeReply = !provider ? await getEdgeAssistantReply(call, speech) : null;
  if (edgeReply) return edgeReply;

  if (!provider) return { reply: localReply(speech, call), persistedByEdge: false };

  try {
    const messages = call.transcript
      .filter((turn) => turn.role === "caller" || turn.role === "assistant")
      .slice(-12)
      .map((turn) => ({ role: turn.role === "caller" ? "user" : "assistant", content: turn.content }));

    const response = await provider.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 180,
      system: buildTraining(),
      messages,
    });

    return { reply: conversation.normalizeBrand(response.content?.find(part => part.type === "text")?.text) || localReply(speech, call), persistedByEdge: false };
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
      signal: AbortSignal.timeout(7000),
      headers: {
        "Content-Type": "application/json",
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        owner_id: AIRA_OWNER_ID || undefined,
        training: buildTraining(),
        caller_text: speech,

        history: call.transcript.slice(0, -1).slice(-12).map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
      }),
    });

    if (!response.ok) throw new Error(`Edge Function returned ${response.status}`);
    const data = await response.json();
    // Ignore older deployed keyword-only adapters rather than masking a provider failure.
    if (!data.reply || data.mode !== "conversational") return null;
    return { reply: conversation.normalizeBrand(data.reply), persistedByEdge: false };
  } catch (error) {
    console.error("AIRA Edge Function error:", error.message);
    return null;
  }
}

function buildTraining() {
  return conversation.training + "\nAdditional operator context (use only compatible business facts):\n" + conversation.normalizeBrand(store.training);
}
function localReply(speech, call = {}) {
  const reply = conversation.fallback(speech);
  if (call.memory && /would you like to leave (?:a message|one)/i.test(reply)) call.memory.offerMessage = true;
  return reply;
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

function wantsTransfer(text) { return conversation.wantsTransfer(text); }
function isGoodbye(text) { return conversation.goodbye(text); }

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
  if (!supabase || !AIRA_OWNER_ID) return false;

  const { error } = await supabase.from("aira_messages").insert({
    id: message.id,
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
  return !error;
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
  const temporary = DATA_FILE + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2));
  fs.renameSync(temporary, DATA_FILE);
}

function defaultTraining() { return conversation.training; }

function cryptoId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
