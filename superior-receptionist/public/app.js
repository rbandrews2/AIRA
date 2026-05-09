const DEFAULT_TRAINING = `You are AIRA AI, the professional secretary and receptionist for Superior Consultation, LLC.

Core identity:
AIRA AI works for Superior Consultation, LLC. Superior Consultation consults on and develops applications. Superior Consultation is home to Work Zone OS - The operating system for desk-less workers.

Current role:
AIRA AI is aimed at acting as a call assistant with secretary-like duties. The long-term product roadmap is to develop her into a full AI smart phone operating system. Super-user-style permissions must be transparently requested and granted by the user or phone operator through legitimate operating-system, carrier, or telephony-provider mechanisms.

Pricing and contacts:
Prices range from $9.99 to $4500 depending on the product, service, and personnel required. Corporate inquiries should email info@superiorllc.org. Everyone else can email ray@workzoneos.org. Phone numbers are 540-797-0405 and 844-685-7207 toll free.

Conversation rules:
Be warm, concise, and natural. Speak like a capable receptionist, not a chatbot. Ask one clear question at a time. If the caller wants a person, offer to take a message or route the call. Never promise hidden phone access or recording without consent.

Target customers:
Young professionals who are on the go, building businesses, and trying to outperform competitors.

Escalation:
For urgent sales, technical, billing, or partnership issues, collect name, best contact method, business name, and reason for calling.`;

const state = {
  serverUrl: localStorage.getItem("aira_server_url") || "",
  training: localStorage.getItem("aira_training") || DEFAULT_TRAINING,
  voice: localStorage.getItem("aira_voice") || "Polly.Joanna-Neural",
  messages: JSON.parse(localStorage.getItem("aira_messages") || "[]"),
  calls: JSON.parse(localStorage.getItem("aira_calls") || "[]"),
  installPrompt: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  hydrate();
  renderInbox();
  renderChat();
  refreshStatus();
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
    "permCamera", "permMicrophone"
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

  els.operatorConsent.addEventListener("change", updateInstallGate);
  els.voiceSelect.addEventListener("change", saveVoice);
  els.chatForm.addEventListener("submit", simulateConversation);
  els.messageForm.addEventListener("submit", saveMessage);
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

function saveServer() {
  state.serverUrl = els.serverUrl.value.trim().replace(/\/$/, "");
  localStorage.setItem("aira_server_url", state.serverUrl);
  updateConnectionLabel();
  refreshStatus();
}

function updateConnectionLabel() {
  els.connectionLabel.textContent = state.serverUrl ? "Connected target saved" : "Local mode";
}

function saveVoice() {
  state.voice = els.voiceSelect.value;
  localStorage.setItem("aira_voice", state.voice);
  postJson("/api/settings/voice", { voice: state.voice }).catch(() => {});
}

async function refreshStatus() {
  if (!state.serverUrl) {
    els.activeCalls.textContent = "0";
    els.totalCalls.textContent = String(state.calls.length);
    els.messageCount.textContent = String(state.messages.length);
    els.activeCallList.textContent = "No active calls are connected.";
    return;
  }

  try {
    const data = await fetch(`${state.serverUrl}/api/status`).then((res) => res.json());
    els.activeCalls.textContent = String(data.activeCalls?.length || 0);
    els.totalCalls.textContent = String(data.callLogCount || 0);
    els.messageCount.textContent = String(data.inboxCount || 0);
    els.activeCallList.innerHTML = data.activeCalls?.length
      ? data.activeCalls.map((call) => `<div class="list-item"><strong>${escapeHtml(call.caller)}</strong><span>${escapeHtml(call.screened || "Screening")}</span>${escapeHtml(call.lastMessage || "")}</div>`).join("")
      : "No active calls are connected.";
  } catch {
    els.activeCallList.textContent = "Server is not reachable from this browser.";
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
  } catch {
    // The browser owns the denial UI. We update state below.
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

function saveTraining() {
  state.training = els.trainingText.value.trim() || DEFAULT_TRAINING;
  localStorage.setItem("aira_training", state.training);
  postJson("/api/training", { prompt: state.training }).catch(() => {});
}

function resetTraining() {
  state.training = DEFAULT_TRAINING;
  els.trainingText.value = DEFAULT_TRAINING;
  saveTraining();
}

function simulateConversation(event) {
  event.preventDefault();
  const text = els.callerText.value.trim();
  if (!text) return;
  addChat("user", text);
  els.callerText.value = "";
  addChat("assistant", getLocalAssistantReply(text));
}

function renderChat() {
  els.chatLog.innerHTML = "";
  addChat("assistant", "Thank you for calling Superior Consultation, LLC. This is AIRA AI. How may I help you today?");
}

function addChat(role, text) {
  const message = document.createElement("div");
  message.className = `chat-message ${role}`;
  message.textContent = text;
  els.chatLog.appendChild(message);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function getLocalAssistantReply(text) {
  const lower = text.toLowerCase();
  if (lower.includes("permission") || lower.includes("admin") || lower.includes("phone")) {
    return "AIRA can request supported browser permissions in this PWA. Deeper phone controls need a native app, carrier, or telephony-provider approval from the phone operator.";
  }
  if (lower.includes("price") || lower.includes("cost")) {
    return "Our prices range from $9.99 to $4500 depending on the product, service, and personnel needed. I can take a few details and have the right person follow up.";
  }
  if (lower.includes("work zone") || lower.includes("desk-less") || lower.includes("deskless")) {
    return "Work Zone OS is our operating system for desk-less workers. It is built to help mobile teams coordinate work, communication, and field operations.";
  }
  if (lower.includes("email") || lower.includes("contact") || lower.includes("phone")) {
    return "Corporate inquiries can use info@superiorllc.org. Everyone else can reach Ray at ray@workzoneos.org, or call 540-797-0405 or 844-685-7207 toll free.";
  }
  if (lower.includes("message") || lower.includes("callback") || lower.includes("call back")) {
    return "I can take a message. Please share your name, best callback number, business name, and the reason for your call.";
  }
  return "Superior Consultation consults and develops applications for people building serious businesses. Tell me what you are trying to build or solve, and I will route you correctly.";
}

function saveMessage(event) {
  event.preventDefault();
  const message = {
    id: crypto.randomUUID(),
    name: document.getElementById("msgName").value.trim(),
    contact: document.getElementById("msgContact").value.trim(),
    body: document.getElementById("msgBody").value.trim(),
    urgency: document.getElementById("msgUrgency").value,
    created_at: new Date().toISOString(),
  };
  state.messages.unshift(message);
  localStorage.setItem("aira_messages", JSON.stringify(state.messages));
  event.currentTarget.reset();
  renderInbox();
  postJson("/api/messages", message).catch(() => {});
}

function renderInbox() {
  els.messageCount.textContent = String(state.messages.length);
  els.inboxList.innerHTML = state.messages.length
    ? state.messages.map((msg) => `<div class="list-item"><strong>${escapeHtml(msg.name)}</strong><span>${escapeHtml(msg.contact)} | ${escapeHtml(msg.urgency)}</span>${escapeHtml(msg.body)}</div>`).join("")
    : `<div class="empty">No messages yet.</div>`;
}

function speakPreview() {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance("This is AIRA AI with Superior Consultation. I can help route your call or take a message.");
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

async function postJson(path, body) {
  if (!state.serverUrl) return null;
  const res = await fetch(`${state.serverUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}
