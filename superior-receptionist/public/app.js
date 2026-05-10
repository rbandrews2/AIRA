const DEFAULT_TRAINING = `You are AIRA, the professional secretary and receptionist for Superior Consultation, LLC.

Core identity:
AIRA works for Superior Consultation, LLC. Superior Consultation consults on and develops applications. Superior Consultation is home to Work Zone OS - The operating system for desk-less road crews and field teams.

Current role:
AIRA is an upbeat, professional, polite receptionist. She answers calls, determines caller intent, takes messages, and collects the caller's name, contact number, email address, business represented, and message when available.

Pricing and contacts:
Prices range from $9.99 to $4500 depending on the product, service, and personnel required. Corporate inquiries should email info@superiorllc.org. Everyone else can email ray@workzoneos.org. Phone numbers are 540-797-0405 and 844-685-7207 toll free.

Conversation rules:
Optimize for phone conversations. Keep each response under 20 words when possible. Be conversational, direct, and empathetic. Use contractions. Ask one clear follow-up question at a time. Use occasional natural phrases like "Got it," "Sure thing," and "Let me see." Never say "As an AI," "AI language model," or "How can I assist you today?" If the caller refuses a detail, continue politely and capture what they will provide.

Opening:
Thanks for calling Superior Consultation, LLC. This is AIRA. How can I help?

Examples:
Caller: I need a callback.
AIRA: Sure thing. What's your name and the best number to reach you?
Caller: I do not want to give my email.
AIRA: That's perfectly alright. What's the message you'd like me to pass along?
Caller: We need help with field crews.
AIRA: Got it. Is this for dispatch, job tracking, communication, or all three?

Target customers:
Young professionals who are on the go, building businesses, and trying to outperform competitors.

Escalation:
For urgent sales, technical, billing, or partnership issues, collect name, best contact method, business name, and reason for calling.`;

const state = {
  serverUrl: localStorage.getItem("aira_server_url") || "",
  connectionState: localStorage.getItem("aira_server_url") ? "saved" : "local",
  training: localStorage.getItem("aira_training") || DEFAULT_TRAINING,
  voice: localStorage.getItem("aira_voice") || "Polly.Joanna-Neural",
  messages: JSON.parse(localStorage.getItem("aira_messages") || "[]"),
  calls: JSON.parse(localStorage.getItem("aira_calls") || "[]"),
  installPrompt: null,
  waitingWorker: null,
  refreshingForUpdate: false,
  chat: [],
  lead: {},
  selectedMessageId: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  hydrate();
  renderInbox();
  renderChat();
  refreshStatus();
  refreshMessages();
  refreshPermissionState();
  registerServiceWorker();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  document.getElementById("installAppBtn").textContent = "Install AIRA";
});

function bindElements() {
  [
    "connectionLabel", "voiceSelect", "serverUrl", "trainingText", "messageCount",
    "totalCalls", "activeCalls", "activeCallList", "chatLog", "chatForm",
    "callerText", "messageForm", "inboxList", "operatorConsent", "installAppBtn",
    "permCamera", "permMicrophone", "connectionStatus", "trainingStatus", "messageStatus",
    "toast", "updateBanner", "applyUpdateBtn", "dismissUpdateBtn", "callerDetail", "connectionDot"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.getElementById("saveServerBtn").addEventListener("click", saveServer);
  document.getElementById("refreshBtn").addEventListener("click", refreshStatus);
  document.getElementById("saveTrainingBtn").addEventListener("click", saveTraining);
  document.getElementById("resetTrainingBtn").addEventListener("click", resetTraining);
  document.getElementById("speakBtn").addEventListener("click", speakPreview);
  document.getElementById("grantPermissionsBtn").addEventListener("click", requestSupportedPermissions);
  document.getElementById("installAppBtn").addEventListener("click", installApp);
  document.getElementById("stopInstallBtn").addEventListener("click", stopInstall);
  document.getElementById("dismissInstallPanel").addEventListener("click", () => {
    document.getElementById("installPanel").hidden = true;
  });
  els.applyUpdateBtn.addEventListener("click", applyAppUpdate);
  els.dismissUpdateBtn.addEventListener("click", () => {
    els.updateBanner.hidden = true;
  });

  els.operatorConsent.addEventListener("change", updateInstallGate);
  els.voiceSelect.addEventListener("change", saveVoice);
  els.chatForm.addEventListener("submit", simulateConversation);
  els.messageForm.addEventListener("submit", saveMessage);
  els.inboxList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-message-id]");
    if (button) selectCaller(button.dataset.messageId);
  });
}

function hydrate() {
  els.serverUrl.value = state.serverUrl;
  els.trainingText.value = state.training;
  els.voiceSelect.value = state.voice;
  updateConnectionLabel();
  updateInstallGate();
}

function switchTab(tabName) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabName);
  });
}

async function saveServer() {
  state.serverUrl = els.serverUrl.value.trim().replace(/\/$/, "");
  localStorage.setItem("aira_server_url", state.serverUrl);
  if (!state.serverUrl) {
    updateConnectionLabel("local");
    setStatus(els.connectionStatus, "Saved local mode. Add a server URL when you want live call data.", "success");
    showToast("Server connection saved for local mode.", "success");
    refreshStatus();
    return;
  }

  if (isSupabaseFunctionUrl(state.serverUrl)) {
    updateConnectionLabel("function");
    setStatus(
      els.connectionStatus,
      "That is a Supabase assistant function URL. It can power AIRA replies, but this dashboard needs the Render web service URL for live status, messages, and training sync.",
      "error"
    );
    showToast("Use the Render web service URL for dashboard connection.", "error");
    renderInbox();
    return;
  }

  updateConnectionLabel("checking");
  setStatus(els.connectionStatus, "Checking server connection...", "");
  const statusOk = await refreshStatus();
  const messagesOk = await refreshMessages();
  if (statusOk && messagesOk) {
    updateConnectionLabel("connected");
    setStatus(els.connectionStatus, "Connected. AIRA can read live backend status.", "success");
    showToast("Server connection saved.", "success");
  } else {
    updateConnectionLabel("error");
    setStatus(els.connectionStatus, "Connection failed. Use the Render web service base URL, and make sure it allows browser API requests.", "error");
    showToast("Connection failed. Check the server URL and backend.", "error");
  }
}

function updateConnectionLabel(status = state.connectionState) {
  state.connectionState = status;
  const labels = {
    local: "Local mode",
    saved: "Backend URL saved",
    checking: "Checking backend",
    connected: "Backend connected",
    function: "Assistant function URL",
    error: "Backend not connected",
  };
  els.connectionLabel.textContent = labels[status] || labels.local;
  els.connectionDot.className = `status-dot ${status}`;
}

function saveVoice() {
  state.voice = els.voiceSelect.value;
  localStorage.setItem("aira_voice", state.voice);
  postJson("/api/settings/voice", { voice: state.voice })
    .then(() => showToast("Voice saved.", "success"))
    .catch(() => showToast("Voice saved locally. Check server connection to sync it.", "error"));
}

async function refreshStatus() {
  if (!state.serverUrl) {
    updateConnectionLabel("local");
    els.activeCalls.textContent = "0";
    els.totalCalls.textContent = String(state.calls.length);
    els.messageCount.textContent = String(state.messages.length);
    els.activeCallList.textContent = "No active calls are connected.";
    return true;
  }

  if (isSupabaseFunctionUrl(state.serverUrl)) {
    updateConnectionLabel("function");
    els.activeCalls.textContent = "0";
    els.activeCallList.textContent = "Supabase assistant function saved. Use the Render web service URL for dashboard live status.";
    return false;
  }

  try {
    updateConnectionLabel("checking");
    const data = await fetchJson(`${state.serverUrl}/api/status`);
    els.activeCalls.textContent = String(data.activeCalls?.length || 0);
    els.totalCalls.textContent = String(data.callLogCount || 0);
    els.messageCount.textContent = String(data.inboxCount || 0);
    els.activeCallList.innerHTML = data.activeCalls?.length
      ? data.activeCalls.map((call) => `<div class="list-item"><strong>${escapeHtml(call.caller)}</strong><span>${escapeHtml(call.screened || "Screening")}</span>${escapeHtml(call.lastMessage || "")}</div>`).join("")
      : "No active calls are connected.";
    updateConnectionLabel("connected");
    return true;
  } catch {
    updateConnectionLabel(isSupabaseFunctionUrl(state.serverUrl) ? "function" : "error");
    els.activeCallList.textContent = "Server is not reachable from this browser.";
    return false;
  }
}

async function refreshMessages() {
  if (!state.serverUrl) {
    renderInbox();
    return true;
  }

  if (isSupabaseFunctionUrl(state.serverUrl)) {
    renderInbox();
    return false;
  }

  try {
    const messages = await fetchJson(`${state.serverUrl}/api/messages`);
    state.messages = messages.map(normalizeMessage);
    localStorage.setItem("aira_messages", JSON.stringify(state.messages));
    renderInbox();
    return true;
  } catch {
    renderInbox();
    return false;
  }
}

function isSupabaseFunctionUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.includes("supabase.co") && url.pathname.includes("/functions/v1/");
  } catch {
    return false;
  }
}

async function refreshPermissionState() {
  await setPermissionLabel("camera", els.permCamera);
  await setPermissionLabel("microphone", els.permMicrophone);
}

async function setPermissionLabel(name, target) {
  const row = target.closest(".permission-row");
  row.classList.remove("granted", "denied");

  if (!navigator.permissions?.query) {
    target.textContent = "Browser prompt required";
    return;
  }

  try {
    const status = await navigator.permissions.query({ name });
    target.textContent = status.state;
    row.classList.toggle("granted", status.state === "granted");
    row.classList.toggle("denied", status.state === "denied");
    status.onchange = () => refreshPermissionState();
  } catch {
    target.textContent = "Browser prompt required";
  }
}

async function requestSupportedPermissions() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    stream.getTracks().forEach((track) => track.stop());
    showToast("Camera and microphone permission check completed.", "success");
  } catch {
    showToast("Permission request failed. Check browser site settings for camera and microphone.", "error");
  }
  await refreshPermissionState();
  updateInstallGate();
}

function updateInstallGate() {
  els.installAppBtn.disabled = !els.operatorConsent.checked;
}

async function installApp() {
  if (!els.operatorConsent.checked) return;
  if (state.installPrompt) {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => null);
    state.installPrompt = null;
    return;
  }
  alert("Use your browser menu to add AIRA AI to your home screen. Chrome and Edge usually show Install App; Safari uses Share, then Add to Home Screen.");
}

function stopInstall() {
  localStorage.setItem("aira_install_stopped", new Date().toISOString());
  document.getElementById("installPanel").hidden = true;
}

async function saveTraining() {
  state.training = els.trainingText.value.trim() || DEFAULT_TRAINING;
  localStorage.setItem("aira_training", state.training);
  setStatus(els.trainingStatus, "Saving training...", "");
  try {
    await postJson("/api/training", { prompt: state.training });
    setStatus(els.trainingStatus, "Training saved and synced to the backend.", "success");
    showToast("Training saved.", "success");
  } catch (error) {
    setStatus(els.trainingStatus, `Saved locally. Sync failed: ${error.message}. Check server URL and Supabase settings.`, "error");
    showToast("Training saved locally. Check server/Supabase connection.", "error");
  }
}

function resetTraining() {
  state.training = DEFAULT_TRAINING;
  els.trainingText.value = DEFAULT_TRAINING;
  saveTraining();
}

async function simulateConversation(event) {
  event.preventDefault();
  const text = els.callerText.value.trim();
  if (!text) return;
  addChat("user", text);
  els.callerText.value = "";

  if (state.serverUrl) {
    try {
      const data = await postJson("/api/simulate", { text, history: state.chat.slice(-12) });
      addChat("assistant", data.reply || getLocalAssistantReply(text));
    } catch {
      addChat("assistant", getLocalAssistantReply(text));
    }
  } else {
    addChat("assistant", getLocalAssistantReply(text));
  }
}

function renderChat() {
  els.chatLog.innerHTML = "";
  state.chat = [];
  state.lead = {};
  addChat("assistant", "Thanks for calling Superior Consultation, LLC. This is AIRA. How can I help?");
}

function addChat(role, text) {
  state.chat.push({ role, text });
  const message = document.createElement("div");
  message.className = `chat-message ${role}`;
  message.textContent = text;
  els.chatLog.appendChild(message);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function getLocalAssistantReply(text) {
  const lower = text.toLowerCase();
  updateLeadMemory(text);

  if (isAffirmative(lower) && state.lead.pending === "details") {
    state.lead.pending = "contact";
    return "Great. What name, number, email, and business should I include?";
  }

  if (state.lead.pending === "contact" && looksLikeContact(text)) {
    state.lead.contact = text;
    state.lead.pending = null;
    return "Got it. I have your details and message. I will route this to the right person.";
  }

  if (lower.includes("i need") || lower.includes("we need") || lower.includes("looking for") || lower.includes("want to build")) {
    state.lead.intent = text;
    state.lead.pending = "details";
    return "That makes sense. Is it a new app, existing system, or Work Zone OS?";
  }

  if (lower.includes("permission") || lower.includes("admin") || lower.includes("phone")) {
    return "AIRA can request browser permissions here. Deeper phone controls need approved native, carrier, or telephony access.";
  }
  if (lower.includes("price") || lower.includes("cost")) {
    state.lead.pending = "details";
    return "Pricing ranges from $9.99 to $4500. What are you trying to launch or improve?";
  }
  if (lower.includes("work zone") || lower.includes("desk-less") || lower.includes("deskless")) {
    state.lead.intent = "Work Zone OS";
    return "Work Zone OS supports desk-less crews. Are you focused on dispatch, job tracking, or communication?";
  }
  if (lower.includes("email") || lower.includes("contact") || lower.includes("phone")) {
    return "Corporate inquiries can use info@superiorllc.org. Everyone else can reach Ray at ray@workzoneos.org, or call 540-797-0405 or 844-685-7207 toll free.";
  }
  if (lower.includes("message") || lower.includes("callback") || lower.includes("call back")) {
    state.lead.pending = "contact";
    return "Sure thing. What's your name, number, email, business, and message?";
  }
  if (state.lead.intent && !state.lead.contact) {
    state.lead.pending = "contact";
    return `Got it, ${state.lead.intent}. Who should we contact, and what number or email should we use?`;
  }
  return "I can take a message, discuss Work Zone OS, or route support. What do you need handled?";
}

async function saveMessage(event) {
  event.preventDefault();
  const message = {
    id: crypto.randomUUID(),
    name: document.getElementById("msgName").value.trim(),
    phone: document.getElementById("msgPhone").value.trim(),
    email: document.getElementById("msgEmail").value.trim(),
    business_name: document.getElementById("msgBusiness").value.trim(),
    body: document.getElementById("msgBody").value.trim(),
    urgency: document.getElementById("msgUrgency").value,
    created_at: new Date().toISOString(),
  };
  message.contact = combineContact(message);
  state.messages.unshift(message);
  state.selectedMessageId = message.id;
  localStorage.setItem("aira_messages", JSON.stringify(state.messages));
  event.currentTarget.reset();
  renderInbox();
  setStatus(els.messageStatus, "Saving message...", "");
  try {
    await postJson("/api/messages", message);
    setStatus(els.messageStatus, "Message saved and synced to the backend.", "success");
    showToast("Message saved.", "success");
  } catch (error) {
    setStatus(els.messageStatus, `Saved locally. Sync failed: ${error.message}. Check server URL and Supabase settings.`, "error");
    showToast("Message saved locally. Check server/Supabase connection.", "error");
  }
}

function renderInbox() {
  state.messages = state.messages.map(normalizeMessage);
  if (!state.selectedMessageId && state.messages.length) {
    state.selectedMessageId = state.messages[0].id;
  }
  els.messageCount.textContent = String(state.messages.length);
  els.inboxList.innerHTML = state.messages.length
    ? state.messages.map((msg) => `
        <button class="list-item caller-row${msg.id === state.selectedMessageId ? " selected" : ""}" type="button" data-message-id="${escapeHtml(msg.id)}">
          <strong>${escapeHtml(msg.name || "Unknown caller")}</strong>
          <span>${escapeHtml(formatCallerMeta(msg))}</span>
          ${escapeHtml(excerpt(msg.body))}
        </button>
      `).join("")
    : `<div class="empty">No messages yet.</div>`;
  renderCallerDetail();
}

function selectCaller(id) {
  state.selectedMessageId = id;
  renderInbox();
}

function renderCallerDetail() {
  const selected = state.messages.find((msg) => msg.id === state.selectedMessageId) || state.messages[0];
  if (!selected) {
    els.callerDetail.className = "caller-detail empty";
    els.callerDetail.textContent = "Select a caller to view their details.";
    return;
  }

  state.selectedMessageId = selected.id;
  els.callerDetail.className = "caller-detail";
  els.callerDetail.innerHTML = `
    <div class="detail-heading">
      <span>Caller Details</span>
      <strong>${escapeHtml(selected.name || "Unknown caller")}</strong>
    </div>
    <dl>
      <div><dt>Contact number</dt><dd>${escapeHtml(selected.phone || "Not provided")}</dd></div>
      <div><dt>Email address</dt><dd>${escapeHtml(selected.email || "Not provided")}</dd></div>
      <div><dt>Business</dt><dd>${escapeHtml(selected.business_name || "Not provided")}</dd></div>
      <div><dt>Urgency</dt><dd>${escapeHtml(selected.urgency || "Normal")}</dd></div>
      <div class="message-detail"><dt>Message left</dt><dd>${escapeHtml(selected.body || "No message recorded.")}</dd></div>
    </dl>
  `;
}

function normalizeMessage(message) {
  const contact = String(message.contact || "");
  const phone = message.phone || extractPhone(contact);
  const email = message.email || extractEmail(contact);
  return {
    ...message,
    id: String(message.id || crypto.randomUUID()),
    name: message.name || "Unknown caller",
    phone,
    email,
    business_name: message.business_name || message.business || "",
    contact: contact || combineContact({ phone, email }),
    body: message.body || message.message || "",
    urgency: message.urgency || "Normal",
  };
}

function combineContact(message) {
  return [message.phone, message.email].filter(Boolean).join(" | ");
}

function formatCallerMeta(message) {
  const parts = [message.business_name, message.phone, message.email, message.urgency].filter(Boolean);
  return parts.length ? parts.join(" | ") : "No contact details provided";
}

function excerpt(text) {
  const value = String(text || "");
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function extractPhone(value) {
  return String(value || "").match(/\+?\d[\d().\-\s]{7,}\d/)?.[0]?.trim() || "";
}

function extractEmail(value) {
  return String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

function speakPreview() {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance("This is AIRA with Superior Consultation. I can route your call or take a message.");
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

async function postJson(path, body) {
  if (!state.serverUrl) throw new Error("no server URL configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${state.serverUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function setStatus(target, message, type) {
  if (!target) return;
  target.textContent = message;
  target.classList.remove("success", "error");
  if (type) target.classList.add(type);
}

function showToast(message, type = "success") {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.className = `toast ${type} show`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.classList.remove("show");
  }, 3200);
}

function updateLeadMemory(text) {
  const lower = text.toLowerCase();
  if (lower.includes("app")) state.lead.intent = "application development";
  if (lower.includes("work zone") || lower.includes("desk-less") || lower.includes("deskless")) state.lead.intent = "Work Zone OS";
  if (lower.includes("support") || lower.includes("bug") || lower.includes("broken")) state.lead.intent = "technical support";
  if (looksLikeContact(text)) state.lead.contact = text;
}

function isAffirmative(lower) {
  return ["yes", "yeah", "yep", "sure", "correct", "that is right", "please"].some((word) => lower.includes(word));
}

function looksLikeContact(text) {
  return /@/.test(text) || /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (registration.waiting) {
        promptForUpdate(registration.waiting);
      }

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            promptForUpdate(newWorker);
          }
        });
      });

      setInterval(() => registration.update(), 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") registration.update();
      });
    }).catch(() => {
      showToast("Update service unavailable. Check browser service worker support.", "error");
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (state.refreshingForUpdate) return;
      state.refreshingForUpdate = true;
      window.location.reload();
    });

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "AIRA_UPDATED") {
        showToast("AIRA is running the latest version.", "success");
      }
    });
  }
}

function promptForUpdate(worker) {
  state.waitingWorker = worker;
  els.updateBanner.hidden = false;
  showToast("AIRA update available.", "success");
}

function applyAppUpdate() {
  if (!state.waitingWorker) {
    window.location.reload();
    return;
  }
  els.updateBanner.hidden = true;
  state.waitingWorker.postMessage({ type: "SKIP_WAITING" });
}
