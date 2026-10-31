const DEFAULT_TRAINING = AiraConversation.training;

const IS_PRODUCTION_SITE = location.hostname === 'aira.superiorllc.org' || location.hostname === 'stately-syrniki-aa3804.netlify.app';
const DEFAULT_SERVER_URL = IS_PRODUCTION_SITE ? 'https://aira-web-service.onrender.com' : '';

function loadSavedTraining() {
  const savedTraining = localStorage.getItem("aira_training");
  if (!savedTraining) return DEFAULT_TRAINING;

  return savedTraining;
}

const state = {
  serverUrl: DEFAULT_SERVER_URL,
  training: loadSavedTraining(),
  voice: localStorage.getItem("aira_voice") || "Polly.Joanna-Neural",
  messages: JSON.parse(localStorage.getItem("aira_messages") || "[]"),
  calls: JSON.parse(localStorage.getItem("aira_calls") || "[]"),
  installPrompt: null,
  installStopped: localStorage.getItem("aira_install_stopped") || "",
  waitingWorker: null,
  refreshingForUpdate: false,
  refreshingMessages: false,
  remoteMessageIds: null,
  serviceWorkerRegistration: null,
  chat: [],
  lead: {},
  selectedMessageId: null,
  messageFilter: localStorage.getItem("aira_message_filter") || "active",
  tasks: JSON.parse(localStorage.getItem("aira_tasks") || "[]"),
  recognition: null,
  voiceActive: false,
  wakeListening: false,
  speaking: false,
  speakingUntil: 0,
  speechToken: 0,
  lastVoiceCommand: "",
  lastVoiceCommandAt: 0,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById('operatorToken').value=sessionStorage.getItem('aira_operator_token')||'';
  bindElements();
  bindEvents();
  hydrate();
  renderInbox();
  renderChat();
  if (location.hash === "#messages") switchTab("messages");
  refreshStatus();
  refreshMessages();
  setInterval(refreshMessages, 30000);
  refreshCalls();
  refreshPermissionState();
  lockPreferredOrientation();
  scheduleInstallNudge();
  registerServiceWorker();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  document.getElementById("installAppBtn").textContent = "Install AIRA";
  showInstallNudge();
});

window.addEventListener("appinstalled", () => {
  localStorage.setItem("aira_installed", "true");
  document.getElementById("installPanel").hidden = true;
});

window.addEventListener("pageshow", () => {
  restorePersistentSettings();
  lockPreferredOrientation();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    restorePersistentSettings();
    refreshMessages();
    refreshStatus();
    lockPreferredOrientation();
  }
});

function bindElements() {
  [
    "connectionLabel", "voiceSelect", "serverUrl", "trainingText", "messageCount",
    "totalCalls", "activeCalls", "activeCallList", "chatLog", "chatForm",
    "callerText", "messageForm", "inboxList", "operatorConsent", "installAppBtn",
    "permCamera", "permMicrophone", "connectionStatus", "trainingStatus", "messageStatus",
    "notificationStatus",
    "toast", "updateBanner", "applyUpdateBtn", "dismissUpdateBtn", "callerDetail",
    "leadSummary", "callLogList", "airaTaskList", "airaStatus", "airaCommandInput",
    "runAiraCommandBtn", "startVoiceCommandsBtn", "stopVoiceCommandsBtn", "airaListeningDot",
    "airaHeard"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.getElementById("saveServerBtn").addEventListener("click", saveServer);
  document.getElementById("enableNotificationsBtn").addEventListener("click", enableBrowserNotifications);
  document.getElementById("refreshBtn").addEventListener("click", refreshStatus);
  document.getElementById("refreshCallsBtn").addEventListener("click", refreshCalls);
  document.getElementById("saveTrainingBtn").addEventListener("click", saveTraining);
  document.getElementById("resetTrainingBtn").addEventListener("click", resetTraining);
  document.getElementById("speakBtn").addEventListener("click", speakPreview);
  document.getElementById("grantPermissionsBtn").addEventListener("click", requestSupportedPermissions);
  document.getElementById("installAppBtn").addEventListener("click", installApp);
  document.getElementById("stopInstallBtn").addEventListener("click", stopInstall);
  document.getElementById("dismissInstallPanel").addEventListener("click", () => {
    localStorage.setItem("aira_install_dismissed", new Date().toISOString());
    document.getElementById("installPanel").hidden = true;
  });
  els.applyUpdateBtn.addEventListener("click", applyAppUpdate);
  els.dismissUpdateBtn.addEventListener("click", () => {
    els.updateBanner.hidden = true;
  });

  els.operatorConsent.addEventListener("change", updateInstallGate);
  els.voiceSelect.addEventListener("change", saveVoice);
  els.chatForm.addEventListener("submit", simulateConversation);
  document.getElementById("resetConversation").addEventListener("click",()=>{if(!state.conversationBusy){renderChat();setConversationStatus("New practice call — no message will be sent.");}});
  els.messageForm.addEventListener("submit", saveMessage);
  els.inboxList.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-message-action]");
    if (actionButton) {
      handleMessageAction(actionButton.dataset.messageAction, actionButton.dataset.messageId);
      return;
    }
    const button = event.target.closest("[data-message-id]");
    if (button) selectCaller(button.dataset.messageId);
  });
  els.callerDetail.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-message-action]");
    if (actionButton) handleMessageAction(actionButton.dataset.messageAction, actionButton.dataset.messageId);
  });
  els.callLogList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-call-action]");
    if (button) handleCallAction(button.dataset.callAction, button.dataset.callId);
  });
  document.querySelectorAll("[data-message-filter]").forEach((button) => {
    button.addEventListener("click", () => setMessageFilter(button.dataset.messageFilter));
  });
  els.runAiraCommandBtn.addEventListener("click", () => runAiraCommand(els.airaCommandInput.value));
  els.airaCommandInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runAiraCommand(els.airaCommandInput.value);
  });
  els.startVoiceCommandsBtn.addEventListener("click", startVoiceCommands);
  els.stopVoiceCommandsBtn.addEventListener("click", stopVoiceCommands);
}

function hydrate() {
  restorePersistentSettings();
  els.trainingText.value = state.training;
  els.voiceSelect.value = state.voice;
  updateConnectionLabel();
  updateInstallGate();
  updateBrowserNotificationStatus();
  seedDailyTasks();
  renderTasks();
  updateMessageFilterButtons();
}

function restorePersistentSettings() {
  state.serverUrl = DEFAULT_SERVER_URL;
  localStorage.setItem("aira_server_url", DEFAULT_SERVER_URL);
  if (els.serverUrl && document.activeElement !== els.serverUrl) {
    els.serverUrl.value = state.serverUrl;
  }
  updateConnectionLabel();
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
  sessionStorage.setItem('aira_operator_token',document.getElementById('operatorToken').value.trim());
  persistServerDraft();
  updateConnectionLabel();
  if (!state.serverUrl) {
    setStatus(els.connectionStatus, "Saved local mode. Add a server URL when you want live call data.", "success");
    showToast("Server connection saved for local mode.", "success");
    refreshStatus();
    return;
  }

  setStatus(els.connectionStatus, "Checking server connection...", "");
  const ok = await refreshStatus();
  await refreshMessages();
  if (ok) {
    setStatus(els.connectionStatus, "Connected. AIRA can read live backend status.", "success");
    showToast("Server connection saved.", "success");
  } else {
    setStatus(els.connectionStatus, "Connection failed. Check your private inbox access token and the backend status.", "error");
    showToast("Connection failed. Check the server URL and backend.", "error");
  }
}

function persistServerDraft() {
  state.serverUrl = DEFAULT_SERVER_URL;
  els.serverUrl.value = DEFAULT_SERVER_URL;
  localStorage.setItem("aira_server_url", state.serverUrl);
  updateConnectionLabel();
}

function updateConnectionLabel() {
  els.connectionLabel.textContent = state.serverUrl ? "Render backend configured" : "Preview — live inbox disconnected";
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
    els.activeCalls.textContent = "0";
    els.totalCalls.textContent = String(state.calls.length);
    els.messageCount.textContent = String(state.messages.length);
    els.activeCallList.textContent = "No active calls are connected.";
    return true;
  }

  try {
    const data = await fetchJson(`${state.serverUrl}/api/status`);
    els.activeCalls.textContent = String(data.activeCalls?.length || 0);
    els.totalCalls.textContent = String(data.callLogCount || 0);
    els.messageCount.textContent = String(data.inboxCount || 0);
    els.activeCallList.innerHTML = data.activeCalls?.length
      ? data.activeCalls.map((call) => `<div class="list-item"><strong>${escapeHtml(call.caller)}</strong><span>${escapeHtml(call.screened || "Screening")}</span>${escapeHtml(call.lastMessage || "")}</div>`).join("")
      : "No active calls are connected.";
    return true;
  } catch {
    els.activeCallList.textContent = "Server is not reachable from this browser.";
    return false;
  }
}

async function refreshMessages() {
  if (!state.serverUrl || state.refreshingMessages) return false;
  state.refreshingMessages = true;

  try {
    const messages = await fetchJson(`${state.serverUrl}/api/messages`);
    const incomingMessages = messages.map(normalizeMessage);
    const incomingIds = new Set(incomingMessages.map((message) => String(message.id)));
    if (state.remoteMessageIds) {
      incomingMessages
        .filter((message) => !state.remoteMessageIds.has(String(message.id)))
        .forEach(notifyMessageTaken);
    }
    state.remoteMessageIds = incomingIds;
    state.messages = incomingMessages;
    localStorage.setItem("aira_messages", JSON.stringify(state.messages));
    renderInbox();
    return true;
  } catch {
    renderInbox();
    return false;
  } finally {
    state.refreshingMessages = false;
  }
}

function setMessageFilter(filter) {
  state.messageFilter = filter === "archived" ? "archived" : "active";
  localStorage.setItem("aira_message_filter", state.messageFilter);
  state.selectedMessageId = null;
  updateMessageFilterButtons();
  renderInbox();
}

function updateMessageFilterButtons() {
  document.querySelectorAll("[data-message-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.messageFilter === state.messageFilter);
  });
}

async function refreshCalls() {
  if (!els.callLogList) return true;
  if (!state.serverUrl) {
    renderCalls(state.calls);
    return true;
  }

  try {
    const calls = await fetchJson(`${state.serverUrl}/api/calls`);
    state.calls = Array.isArray(calls) ? calls : [];
    localStorage.setItem("aira_calls", JSON.stringify(state.calls));
    renderCalls(state.calls);
    return true;
  } catch {
    renderCalls(state.calls);
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
  state.installStopped = localStorage.getItem("aira_install_stopped");
  document.getElementById("installPanel").hidden = true;
}

function scheduleInstallNudge() {
  if (localStorage.getItem("aira_installed") === "true" || state.installStopped) return;
  const dismissedAt = Date.parse(localStorage.getItem("aira_install_dismissed") || "");
  const dismissedRecently = dismissedAt && Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000;
  if (dismissedRecently) return;

  setTimeout(() => {
    if (state.installPrompt || isLikelyStandalone()) showInstallNudge();
  }, 1200);
}

function showInstallNudge() {
  if (localStorage.getItem("aira_installed") === "true" || state.installStopped) return;
  if (isLikelyStandalone() && !state.installPrompt) return;
  document.getElementById("installPanel").hidden = false;
}

function isLikelyStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone;
}

async function lockPreferredOrientation() {
  if (!isLikelyStandalone() || !screen.orientation?.lock) return;
  try {
    await screen.orientation.lock("portrait-primary");
  } catch {
    // Some browsers only honor the manifest orientation lock.
  }
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
  const text=els.callerText.value.trim();
  if(!text || state.conversationBusy)return;
  if(text.length>2000){setConversationStatus('Please keep each turn under 2,000 characters.');return;}
  if(state.chat.length>=60){setConversationStatus('Start a new practice call to continue.');return;}
  state.conversationBusy=true;
  const submit=els.chatForm.querySelector('button[type="submit"]');
  if(submit)submit.disabled=true;
  const history=state.chat.map(turn=>({...turn}));
  addChat('user',text);els.callerText.value='';
  const typing=showTypingIndicator();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  let reply;
  try {
    const step=AiraConversation.advance(state.conversation,text);
    if(step) {
      if(step.save){state.lead={...step.save};AiraConversation.saved(state.conversation);reply="That's confirmed for this practice conversation. No message has been sent to the team.";}
      else reply=step.reply;
      setConversationStatus('Practice mode — details stay in this conversation.');
    } else {
      // Conversation uses the site's server-side model adapter, not the inbox host.
      const response=await fetch('/api/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,history}),signal:controller.signal});
      const data=await response.json();
      if(!response.ok || !data.reply)throw Object.assign(new Error('provider'),{code:data.error});
      reply=data.reply;
      state.conversation.offerMessage=/would you like to leave (?:a message|one)/i.test(reply);
      setConversationStatus(data.mode==='model'?'AI connected — practice conversation; nothing is sent.':'Guided practice — nothing is sent.');
    }
  } catch(error) {
    reply=AiraConversation.fallback(text,state.conversation);
    const reason=error.code==='provider_billing'?'AI provider billing needs attention':error.code==='provider_configuration'?'AI provider is not configured':'AI provider is unavailable';
    setConversationStatus(reason+'. Using local replies; no message is sent.');
  } finally {
    clearTimeout(timeout);removeTypingIndicator(typing);state.conversationBusy=false;
    if(submit)submit.disabled=false;
  }
  if(state.conversation.draft)state.lead={...state.conversation.draft};
  addChat('assistant',reply);renderLeadSummary();
}

function setConversationStatus(text){document.getElementById('conversationStatus').textContent=text;}

function showTypingIndicator() {
  const el = document.createElement("div");
  el.className = "chat-message assistant typing";
  el.textContent = "…";
  els.chatLog.appendChild(el);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  return el;
}

function removeTypingIndicator(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function renderChat() {
  els.chatLog.innerHTML = "";
  state.chat = [];
  state.lead = { source: "simulator" };
  state.conversation={};
  addChat("assistant", AiraConversation.greeting);
  renderLeadSummary();
}

function addChat(role, text) {
  state.chat.push({ role, text });
  const message = document.createElement("div");
  message.className = `chat-message ${role}`;
  message.textContent = text;
  els.chatLog.appendChild(message);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function pickOne(options) {
  return options[Math.floor(Math.random() * options.length)];
}

function getLocalAssistantReply(text) {
  const step=AiraConversation.advance(state.conversation,text);
  if(step?.save){AiraConversation.saved(state.conversation);return "That's confirmed for practice. No message has been sent.";}
  return step?.reply || AiraConversation.fallback(text,state.conversation);
}

function isGoodbye(lower) {
  return /\b(bye|goodbye|good bye|see you|take care|have a good|that's all|that is all|nothing else|I'm good|i'm done|gotta go)\b/.test(lower);
}

function isGratitude(lower) {
  return /\b(thanks|thank you|appreciate|grateful)\b/.test(lower) && !isSmallTalk(lower);
}

function isConfused(lower) {
  return /\b(i don't know|not sure|i'm not sure|confused|what do you do|what can you do|what services|what do you offer)\b/.test(lower);
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
    notifyMessageTaken(message);
  } catch (error) {
    setStatus(els.messageStatus, `Saved locally. Sync failed: ${error.message}. Check server URL and Supabase settings.`, "error");
    notifyMessageTaken(message, "Message saved locally. Check the backend connection.");
  }
}

function notifyMessageTaken(message, toastText = null) {
  const caller = message.name || "a caller";
  showToast(toastText || `New message taken from ${caller}.`, "success");
  if (state.remoteMessageIds) state.remoteMessageIds.add(String(message.id));
  if (document.visibilityState === "visible" || !("Notification" in window) || Notification.permission !== "granted") return;

  const showNotification = (registration) => registration.showNotification("AIRA took a message", {
    body: `New message from ${caller}. Open AIRA to review it.`,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-96.png",
    tag: `aira-message-${message.id}`,
    data: { url: "/#messages" },
  });

  if (state.serviceWorkerRegistration) {
    showNotification(state.serviceWorkerRegistration).catch(() => {});
  } else if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then(showNotification).catch(() => {});
  }
}

async function enableBrowserNotifications() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    setStatus(els.notificationStatus, "Browser notifications are not supported in this browser.", "error");
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    updateBrowserNotificationStatus();
    if (permission === "granted") showToast("Browser notifications enabled.", "success");
  } catch {
    setStatus(els.notificationStatus, "Could not enable browser notifications in this browser.", "error");
  }
}

function updateBrowserNotificationStatus() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    setStatus(els.notificationStatus, "Browser notifications are not supported here. In-app alerts work while AIRA is open.", "error");
    return;
  }

  if (Notification.permission === "granted") {
    setStatus(els.notificationStatus, "Browser notifications are enabled. Keep AIRA open in the background to watch for new messages.", "success");
  } else if (Notification.permission === "denied") {
    setStatus(els.notificationStatus, "Browser notifications are blocked in browser settings. In-app alerts work while AIRA is open.", "error");
  } else {
    setStatus(els.notificationStatus, "In-app alerts are active. Enable browser notifications for alerts while AIRA is open in the background.", "");
  }
}

function renderInbox() {
  state.messages = state.messages.map(normalizeMessage);
  const visibleMessages = getVisibleMessages();
  if (!state.selectedMessageId && visibleMessages.length) {
    state.selectedMessageId = visibleMessages[0].id;
  }
  els.messageCount.textContent = String(state.messages.filter((msg) => msg.status !== "archived").length);
  els.inboxList.innerHTML = visibleMessages.length
    ? visibleMessages.map((msg) => `
        <article class="list-item caller-row${msg.id === state.selectedMessageId ? " selected" : ""}">
          <button class="caller-select" type="button" data-message-id="${escapeHtml(msg.id)}">
            <strong>${escapeHtml(msg.name || "Unknown caller")}</strong>
            <span>${escapeHtml(formatCallerMeta(msg))}</span>
            ${escapeHtml(excerpt(msg.body))}
          </button>
          <div class="item-actions">
            <button class="ghost" type="button" data-message-action="${msg.status === "archived" ? "restore" : "archive"}" data-message-id="${escapeHtml(msg.id)}">${msg.status === "archived" ? "Restore" : "Archive"}</button>
            <button class="danger" type="button" data-message-action="delete" data-message-id="${escapeHtml(msg.id)}">Delete</button>
          </div>
        </article>
      `).join("")
    : `<div class="empty">No ${state.messageFilter === "archived" ? "archived" : "active"} messages yet.</div>`;
  renderCallerDetail();
}

function getVisibleMessages() {
  return state.messages.filter((msg) => state.messageFilter === "archived"
    ? msg.status === "archived"
    : msg.status !== "archived" && msg.status !== "deleted");
}

function selectCaller(id) {
  state.selectedMessageId = id;
  renderInbox();
}

async function handleMessageAction(action, id) {
  const message = state.messages.find((msg) => msg.id === id);
  if (!message) return;

  if (action === "delete") {
    state.messages = state.messages.filter((msg) => msg.id !== id);
    if (state.selectedMessageId === id) state.selectedMessageId = null;
    addTask("Deleted message after operator review", "done");
    await syncMessageAction(id, "delete");
  } else if (action === "archive" || action === "restore") {
    message.status = action === "archive" ? "archived" : "new";
    addTask(`${action === "archive" ? "Archived" : "Restored"} message for ${message.name || "caller"}`, "done");
    await syncMessageAction(id, action);
  } else if (action === "organize-one") {
    organizeMessage(message);
    message.status = message.status === "archived" ? "archived" : "organized";
    addTask(`Organized caller details for ${message.name || "caller"}`, "done");
    await syncMessageAction(id, "organize", message);
  } else if (action === "follow-up") {
    assignFollowUp(message, `Return call ${message.name || "caller"} about: ${message.body || "their message"}`);
  }

  localStorage.setItem("aira_messages", JSON.stringify(state.messages));
  renderInbox();
  renderTasks();
}

async function syncMessageAction(id, action, message = null) {
  if (!state.serverUrl) return;
  try {
    if (action === "delete") {
      await fetchJsonWithMethod(`${state.serverUrl}/api/messages/${encodeURIComponent(id)}`, "DELETE");
      return;
    }
    const status = action === "archive" ? "archived" : action === "restore" ? "new" : message?.status || "organized";
    await fetchJsonWithMethod(`${state.serverUrl}/api/messages/${encodeURIComponent(id)}`, "PATCH", { status, message });
  } catch {
    showToast("Action saved locally. Server sync failed.", "error");
  }
}

async function handleCallAction(action, id) {
  const call = state.calls.find((item) => String(item.id) === String(id));
  if (!call) return;

  if (action === "route") {
    const message = messageFromCall(call);
    state.messages.unshift(message);
    state.selectedMessageId = message.id;
    localStorage.setItem("aira_messages", JSON.stringify(state.messages));
    addTask(`Routed recorded call from ${message.name} into the message inbox`, "done");
    switchTab("messages");
    setMessageFilter("active");
    renderInbox();
    renderTasks();
    notifyMessageTaken(message, `Message from ${message.name || "caller"} added to the inbox.`);
    return;
  }

  if (action === "delete") {
    state.calls = state.calls.filter((item) => String(item.id) !== String(id));
    addTask("Deleted a call transcript after operator review", "done");
    await syncCallAction(id, "delete");
  } else if (action === "archive" || action === "restore") {
    call.status = action === "archive" ? "archived" : "completed";
    addTask(`${action === "archive" ? "Archived" : "Restored"} call transcript`, "done");
    await syncCallAction(id, action, call);
  }

  localStorage.setItem("aira_calls", JSON.stringify(state.calls));
  renderCalls(state.calls);
  renderTasks();
}

async function syncCallAction(id, action, call = null) {
  if (!state.serverUrl) return;
  try {
    if (action === "delete") {
      await fetchJsonWithMethod(`${state.serverUrl}/api/calls/${encodeURIComponent(id)}`, "DELETE");
      return;
    }
    await fetchJsonWithMethod(`${state.serverUrl}/api/calls/${encodeURIComponent(id)}`, "PATCH", {
      status: call?.status || (action === "archive" ? "archived" : "completed"),
    });
  } catch {
    showToast("Call log action saved locally. Server sync failed.", "error");
  }
}

function messageFromCall(call) {
  const transcript = formatTranscript(call.transcript, call.transcript_summary);
  const details = extractLeadDetails(transcript);
  const body = details.body || cleanTranscriptForMessage(transcript);
  return normalizeMessage({
    id: crypto.randomUUID(),
    name: details.name || call.caller || "Recorded caller",
    phone: details.phone || extractPhone(call.caller) || "",
    email: details.email || "",
    business_name: details.business_name || "",
    body,
    urgency: /urgent|as soon as possible|emergency/i.test(transcript) ? "Urgent" : "Normal",
    source: "call_log",
    status: "new",
    created_at: new Date().toISOString(),
  });
}

function cleanTranscriptForMessage(transcript) {
  return improveTranscriptText(String(transcript || "")
    .replace(/\b(caller|assistant|aira)\s*:/gi, "")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, 1000);
}

function renderCallerDetail() {
  const visibleMessages = getVisibleMessages();
  const selected = visibleMessages.find((msg) => msg.id === state.selectedMessageId) || visibleMessages[0];
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
      <div><dt>Status</dt><dd>${escapeHtml(selected.status || "new")}</dd></div>
      <div class="message-detail"><dt>Message left</dt><dd>${escapeHtml(selected.body || "No message recorded.")}</dd></div>
    </dl>
    <div class="detail-actions">
      <button type="button" data-message-action="follow-up" data-message-id="${escapeHtml(selected.id)}">Assign follow-up call</button>
      <button class="ghost" type="button" data-message-action="organize-one" data-message-id="${escapeHtml(selected.id)}">Let AIRA organize</button>
    </div>
  `;
}

function renderCalls(calls) {
  if (!els.callLogList) return;
  const normalized = Array.isArray(calls) ? calls : [];
  els.totalCalls.textContent = String(normalized.length);
  els.callLogList.innerHTML = normalized.length
    ? normalized.map((call) => `
        <article class="list-item transcript-item">
          <strong>${escapeHtml(call.caller || "Unknown caller")}</strong>
          <span>${escapeHtml(formatCallMeta(call))}</span>
          <pre>${escapeHtml(formatTranscript(call.transcript, call.transcript_summary))}</pre>
          <div class="item-actions">
            <button type="button" data-call-action="route" data-call-id="${escapeHtml(call.id)}">Route to inbox</button>
            <button class="ghost" type="button" data-call-action="${call.status === "archived" ? "restore" : "archive"}" data-call-id="${escapeHtml(call.id)}">${call.status === "archived" ? "Restore" : "Archive"}</button>
            <button class="danger" type="button" data-call-action="delete" data-call-id="${escapeHtml(call.id)}">Delete</button>
          </div>
        </article>
      `).join("")
    : `<div class="empty">No conversation logs yet. Completed phone calls will appear here with transcripts.</div>`;
}

function formatCallMeta(call) {
  const created = call.created_at ? new Date(call.created_at).toLocaleString() : "No date";
  return [call.screened, call.status, created].filter(Boolean).join(" | ");
}

function formatTranscript(transcript, summary) {
  if (Array.isArray(transcript) && transcript.length) {
    return transcript.map((turn) => `${turn.role || turn.speaker}: ${turn.content || turn.text_body || turn.text || ""}`).join("\n");
  }
  if (typeof transcript === "string" && transcript.trim()) return transcript;
  return summary || "Transcript not available yet.";
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
    status: message.status || "new",
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
  const utterance = new SpeechSynthesisUtterance("This is AIRA with Molecular Project Development LLC. I can route your call or take a message.");
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function operatorHeaders(url) {
  if(!state.serverUrl || new URL(url,location.origin).origin!==new URL(state.serverUrl).origin)return {};
  const token=sessionStorage.getItem('aira_operator_token');
  return token?{Authorization:'Bearer '+token}:{};
}

async function postJson(path, body) {
  if(!state.serverUrl)throw new Error("Live inbox is disconnected in this preview");
  if (!state.serverUrl) throw new Error("no server URL configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${state.serverUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...operatorHeaders(state.serverUrl) },
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
    const res = await fetch(url, { signal: controller.signal,headers:operatorHeaders(url) });
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithMethod(url, method, body = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method,
      headers: {...(body ? { "Content-Type": "application/json" } : {}),...operatorHeaders(url)},
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    return res.status === 204 ? null : res.json();
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

function seedDailyTasks() {
  if (state.tasks.length) return;
  state.tasks = [
    createTask("Listen for new recorded messages", "active"),
    createTask("Fix grammar and likely transcription errors", "queued"),
    createTask("Move caller details into the correct fields", "queued"),
    createTask("Flag messages that need follow-up calls", "queued"),
  ];
  persistTasks();
}

function createTask(title, status = "queued", meta = {}) {
  return {
    id: crypto.randomUUID(),
    title,
    status,
    created_at: new Date().toISOString(),
    ...meta,
  };
}

function addTask(title, status = "queued", meta = {}) {
  const duplicateIndex = state.tasks.findIndex((task) => task.title === title && task.status === status);
  if (duplicateIndex >= 0) {
    state.tasks.splice(duplicateIndex, 1);
  }
  state.tasks.unshift(createTask(title, status, meta));
  state.tasks = state.tasks.slice(0, 12);
  persistTasks();
}

function persistTasks() {
  localStorage.setItem("aira_tasks", JSON.stringify(state.tasks));
}

function renderTasks() {
  if (!els.airaTaskList) return;
  const visibleTasks = state.tasks.slice(0, 4);
  els.airaTaskList.innerHTML = visibleTasks.length
    ? visibleTasks.map((task) => `
        <div class="task-item ${escapeHtml(task.status)}">
          <span>${escapeHtml(task.status)}</span>
          <strong>${escapeHtml(task.title)}</strong>
        </div>
      `).join("")
    : `<div class="empty">No assigned AIRA tasks yet.</div>`;
}

function setAiraStatus(message, type = "") {
  setStatus(els.airaStatus, message, type);
}

function runAiraCommand(rawCommand) {
  const command = String(rawCommand || "").trim();
  if (!command) return;
  els.airaCommandInput.value = "";
  if (els.airaHeard) els.airaHeard.textContent = `Heard: "${command}"`;
  const lower = normalizeCommand(command);
  const now = Date.now();

  if (state.speaking || now < state.speakingUntil) return;
  if (lower && lower === state.lastVoiceCommand && now - state.lastVoiceCommandAt < 1800) return;
  state.lastVoiceCommand = lower;
  state.lastVoiceCommandAt = now;

  if (isWakeCommand(lower)) {
    state.wakeListening = true;
    setAiraStatus("I'm here", "success");
    speak("I'm here");
    addTask("Voice session activated", "active");
  } else if (!state.wakeListening && state.voiceActive) {
    setAiraStatus('I heard you. Say "ok AIRA activate" first.', "error");
    return;
  } else if (isOrganizeDetailsCommand(lower)) {
    acknowledgeCommand("organize");
    organizeAllMessages();
  } else if (lower.includes("fix transcription") || lower.includes("fix transcript") || lower.includes("fix grammatical") || lower.includes("clean transcript")) {
    acknowledgeCommand("transcription");
    fixAllTranscriptions();
  } else if (lower.includes("archive completed messages")) {
    acknowledgeCommand("archive");
    archiveCompletedMessages();
  } else if (lower.includes("show messages") || lower.includes("open messages")) {
    acknowledgeCommand("navigation");
    switchTab("messages");
    setMessageFilter("active");
    setAiraStatus("Showing active messages.", "success");
  } else if (lower.includes("refresh call logs") || lower.includes("update call logs")) {
    acknowledgeCommand("refresh");
    refreshCalls();
    setAiraStatus("Refreshing call logs.", "success");
  } else if (lower.includes("read daily tasks") || lower.includes("what are your tasks")) {
    acknowledgeCommand("tasks");
    const taskSummary = state.tasks.slice(0, 4).map((task) => task.title).join(". ");
    speak(taskSummary || "No tasks assigned.", { interrupt: false });
    setAiraStatus("Reading daily tasks.", "success");
  } else if (lower.includes("what can i say") || lower.includes("voice commands") || lower.includes("help")) {
    acknowledgeCommand("help");
    const help = "You can say organize caller details, fix transcription errors, show messages, refresh call logs, or return call with instructions.";
    setAiraStatus(help, "success");
    speak(help, { interrupt: false });
  } else if (lower.includes("return call") || lower.includes("follow up")) {
    acknowledgeCommand("follow_up");
    assignFollowUpFromCommand(command);
  } else {
    acknowledgeCommand("background");
    addTask(`Review command: ${command}`, "queued");
    setAiraStatus("Command noted. I added it to AIRA's task list.", "success");
  }

  persistTasks();
  renderTasks();
}

function acknowledgeCommand(type = "background") {
  const acknowledgements = {
    organize: "Got it. I'm organizing the caller details now.",
    transcription: "I'm on it. I'll clean up the transcription errors.",
    archive: "Copy that. I'm checking completed messages for archive.",
    navigation: "Got it. Opening that view now.",
    refresh: "Will do. I'm refreshing the call logs.",
    tasks: "Copy that. Here are my current tasks.",
    help: "Got it. I'll list the commands I understand.",
    follow_up: "Will do. I'll queue that follow-up and notify you when I'm done.",
    background: "Copy that. I'm running your task in the background.",
  };
  const message = acknowledgements[type] || acknowledgements.background;
  setAiraStatus(message, "success");
  speak(message);
}

function normalizeCommand(command) {
  return String(command || "")
    .toLowerCase()
    .replace(/\bair\s+a\b/g, "aira")
    .replace(/\bera\b/g, "aira")
    .replace(/\bara\b/g, "aira")
    .replace(/\bira\b/g, "aira")
    .replace(/\bokay\b/g, "ok")
    .replace(/[^a-z0-9:\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isWakeCommand(lower) {
  const compact = lower.replace(/\s+/g, "");
  return compact.includes("okairaactivate")
    || compact.includes("heyairaactivate")
    || compact.includes("airaactivate")
    || compact.includes("okactivateaira");
}

function isOrganizeDetailsCommand(lower) {
  const hasCallerDetails = lower.includes("caller detail") || lower.includes("caller information") || lower.includes("contact detail");
  const wantsOrganize = lower.includes("organize") || lower.includes("organized") || lower.includes("sort") || lower.includes("put") || lower.includes("move");
  const wantsFields = lower.includes("right section") || lower.includes("correct field") || lower.includes("right field") || lower.includes("separate field") || lower.includes("message box");
  return lower.includes("organize all caller details")
    || lower.includes("organize caller details")
    || lower.includes("organized caller details")
    || (hasCallerDetails && (wantsOrganize || wantsFields));
}

function organizeAllMessages() {
  state.messages.forEach((message) => {
    if (message.status !== "archived" && message.status !== "deleted") {
      organizeMessage(message);
      message.status = message.status === "new" ? "organized" : message.status;
    }
  });
  localStorage.setItem("aira_messages", JSON.stringify(state.messages));
  addTask("Organized all caller details into name, phone, email, business, and message fields", "done");
  renderInbox();
  setAiraStatus("Caller details organized.", "success");
}

function organizeMessage(message) {
  const combined = [message.name, message.contact, message.body, message.business_name].filter(Boolean).join(" ");
  const details = extractLeadDetails(combined);
  message.name = details.name || message.name || "Unknown caller";
  message.phone = details.phone || message.phone || extractPhone(message.contact);
  message.email = details.email || message.email || extractEmail(message.contact);
  message.business_name = details.business_name || message.business_name || "";
  message.contact = combineContact(message);
  message.body = improveTranscriptText(message.body);
}

function fixAllTranscriptions() {
  state.messages.forEach((message) => {
    message.body = improveTranscriptText(message.body);
    if (message.status === "new") message.status = "organized";
  });
  state.calls.forEach((call) => {
    if (Array.isArray(call.transcript)) {
      call.transcript = call.transcript.map((turn) => ({
        ...turn,
        content: improveTranscriptText(turn.content || turn.text || ""),
      }));
    } else if (typeof call.transcript === "string") {
      call.transcript = improveTranscriptText(call.transcript);
    }
  });
  localStorage.setItem("aira_messages", JSON.stringify(state.messages));
  localStorage.setItem("aira_calls", JSON.stringify(state.calls));
  addTask("Cleaned punctuation, casing, and common AIRA transcription mistakes", "done");
  renderInbox();
  renderCalls(state.calls);
  setAiraStatus("Transcription cleanup complete.", "success");
}

function improveTranscriptText(text) {
  let value = String(text || "").trim();
  if (!value) return "";
  value = value
    .replace(/\bIRA\b/g, "AIRA")
    .replace(/\bworkzone\b/gi, "Work Zone")
    .replace(/\bmolecular project development(?: llc)?\b/gi, "Molecular Project Development LLC")
    .replace(/\bi\b/g, "I")
    .replace(/\s+/g, " ");
  value = value.charAt(0).toUpperCase() + value.slice(1);
  if (!/[.!?]$/.test(value)) value += ".";
  return value;
}

function archiveCompletedMessages() {
  let count = 0;
  state.messages.forEach((message) => {
    const completed = /resolved|complete|completed|confirmed|done/i.test(message.body || "") || message.status === "completed";
    if (completed && message.status !== "archived") {
      message.status = "archived";
      count += 1;
    }
  });
  localStorage.setItem("aira_messages", JSON.stringify(state.messages));
  addTask(`Archived ${count} completed message${count === 1 ? "" : "s"}`, "done");
  renderInbox();
  setAiraStatus(`Archived ${count} completed message${count === 1 ? "" : "s"}.`, "success");
}

function assignFollowUpFromCommand(command) {
  const lower = command.toLowerCase();
  const targetName = command.match(/return call\s+(.+?)\s+(and|to|about|$)/i)?.[1]?.trim();
  const message = findMessageForCommand(targetName || lower);
  if (message) {
    assignFollowUp(message, command);
  } else {
    addTask(command, "queued", { type: "follow_up" });
    setAiraStatus("Follow-up task assigned. Add or select a caller when ready.", "success");
  }
}

function findMessageForCommand(target) {
  const value = String(target || "").toLowerCase().replace(/^mr\.?\s+|^ms\.?\s+|^mrs\.?\s+/, "");
  return state.messages.find((message) => String(message.name || "").toLowerCase().includes(value))
    || state.messages.find((message) => String(message.body || "").toLowerCase().includes(value));
}

async function assignFollowUp(message, instruction) {
  const title = instruction || `Return call ${message.name || "caller"}`;
  addTask(title, "queued", {
    type: "follow_up",
    message_id: message.id,
    phone: message.phone,
    caller: message.name,
  });
  message.status = "follow-up";
  localStorage.setItem("aira_messages", JSON.stringify(state.messages));
  renderInbox();
  renderTasks();
  setAiraStatus(`Follow-up assigned for ${message.name || "caller"}.`, "success");

  if (!state.serverUrl || !message.phone) return;
  try {
    const result = await postJson("/api/follow-up", {
      message_id: message.id,
      to: message.phone,
      caller_name: message.name,
      instruction: title,
    });
    addTask(result.placed ? `Follow-up call placed to ${message.name}` : `Follow-up call queued for ${message.name}`, result.placed ? "done" : "queued");
  } catch {
    showToast("Follow-up saved locally. Server call placement failed.", "error");
  }
}

async function startVoiceCommands() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setAiraStatus("Voice commands are not supported in this browser. Type commands instead.", "error");
    return;
  }
  if (state.recognition) stopVoiceCommands();

  try {
    if (navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    }
  } catch {
    setAiraStatus("Microphone permission is blocked. Allow microphone access, then press Talk to AIRA.", "error");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.onresult = (event) => {
    if (state.speaking || Date.now() < state.speakingUntil) return;
    let finalTranscript = "";
    let interimTranscript = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript?.trim() || "";
      if (!transcript) continue;
      if (result.isFinal) finalTranscript += `${transcript} `;
      else interimTranscript += `${transcript} `;
    }
    const heard = (finalTranscript || interimTranscript).trim();
    if (heard && els.airaHeard) els.airaHeard.textContent = `Heard: "${heard}"`;
    if (finalTranscript.trim()) runAiraCommand(finalTranscript.trim());
  };
  recognition.onend = () => {
    if (!state.voiceActive) return;
    restartRecognitionWhenReady(recognition);
  };
  recognition.onerror = (event) => {
    if (event.error === "no-speech") {
      setAiraStatus("Listening. Say a command when ready.", "success");
      return;
    }
    if (event.error === "aborted") return;
    setAiraStatus(`Voice listener issue: ${event.error}. Press Talk to AIRA to retry.`, "error");
  };
  state.recognition = recognition;
  state.voiceActive = true;
  state.wakeListening = false;
  state.lastVoiceCommand = "";
  state.lastVoiceCommandAt = 0;
  els.airaListeningDot.classList.add("listening");
  setAiraStatus('Listening. Say "ok AIRA activate" to begin.', "success");
  restartRecognitionWhenReady(recognition, 0);
}

function restartRecognitionWhenReady(recognition, delay = 250) {
  window.setTimeout(() => {
    if (!state.voiceActive || state.recognition !== recognition) return;
    if (state.speaking || Date.now() < state.speakingUntil) {
      restartRecognitionWhenReady(recognition, 150);
      return;
    }
    try {
      recognition.start();
      setAiraStatus(state.wakeListening ? "Listening for AIRA commands." : 'Listening. Say "ok AIRA activate" to begin.', "success");
    } catch {
      if (state.voiceActive) {
        restartRecognitionWhenReady(recognition, 500);
      }
    }
  }, delay);
}

function stopVoiceCommands() {
  state.voiceActive = false;
  state.wakeListening = false;
  els.airaListeningDot.classList.remove("listening");
  if (state.recognition) {
    state.recognition.onend = null;
    state.recognition.stop();
    state.recognition = null;
  }
  setAiraStatus("Voice commands stopped.", "success");
}

function speak(text, options = {}) {
  if (!("speechSynthesis" in window)) return;
  const { interrupt = true } = options;
  const utterance = new SpeechSynthesisUtterance(text);
  const speechToken = state.speechToken + 1;
  state.speechToken = speechToken;
  state.speaking = true;
  state.speakingUntil = Date.now() + Math.max(1000, String(text || "").length * 70);
  utterance.onend = () => {
    if (state.speechToken !== speechToken) return;
    state.speaking = false;
    state.speakingUntil = Date.now() + 600;
  };
  utterance.onerror = () => {
    if (state.speechToken !== speechToken) return;
    state.speaking = false;
    state.speakingUntil = Date.now() + 600;
  };
  if (interrupt) window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function updateLeadMemory(text) {
  const lower = text.toLowerCase();
  const details = extractLeadDetails(text);
  Object.entries(details).forEach(([key, value]) => {
    if (value && !state.lead[key]) state.lead[key] = value;
  });
  if (lower.includes("app")) state.lead.intent = "application development";
  if (lower.includes("work zone") || lower.includes("desk-less") || lower.includes("deskless")) state.lead.intent = "Work Zone OS";
  if (lower.includes("support") || lower.includes("bug") || lower.includes("broken")) state.lead.intent = "technical support";
}

function extractLeadDetails(text) {
  const value = String(text || "");
  const email = extractEmail(value);
  const phone = extractPhone(value);
  const name = matchLeadValue(value, [
    /\bmy name is\s+([^,.]+)$/i,
    /\bthis is\s+([^,.]+)$/i,
    /\bi am\s+([^,.]+)$/i,
    /\bi'm\s+([^,.]+)$/i,
    /\bname[:\s]+([^,.]+)$/i,
  ]);
  const business = matchLeadValue(value, [
    /\bmy business is\s+([^,.]+)$/i,
    /\bcompany is\s+([^,.]+)$/i,
    /\bbusiness is\s+([^,.]+)$/i,
    /\bfrom\s+([A-Z][A-Za-z0-9&.'\-\s]{2,})/,
    /\bat\s+([A-Z][A-Za-z0-9&.'\-\s]{2,})/,
  ]);
  const body = matchLeadValue(value, [
    /\bmessage is\s+(.+)$/i,
    /\btell (?:him|her|them|ray)\s+(.+)$/i,
    /\blet (?:him|her|them|ray) know\s+(.+)$/i,
  ]);

  return {
    name: cleanLeadValue(name),
    phone,
    email,
    business_name: cleanLeadValue(business),
    body: cleanLeadValue(body),
  };
}

function matchLeadValue(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function cleanLeadValue(value) {
  return String(value || "")
    .replace(/\b(and|with phone|phone|email|business|company)\b.*$/i, "")
    .trim();
}

function stripMessagePrefix(text) {
  return String(text || "")
    .replace(/^.*?\b(message is|tell him|tell her|tell them|tell ray|let him know|let her know|let them know|let ray know)\b/i, "")
    .trim() || text;
}

function renderLeadSummary() {
  if (!els.leadSummary) return;
  const fields = [
    ["Name", state.lead.name],
    ["Phone", state.lead.phone],
    ["Email", state.lead.email],
    ["Business", state.lead.business_name],
    ["Message", state.lead.body],
  ];
  els.leadSummary.innerHTML = fields.map(([label, value]) => `
    <div class="${value ? "captured" : ""}">
      <span>${label}</span>
      <strong>${escapeHtml(value || "Waiting")}</strong>
    </div>
  `).join("");
}

function maybeCreateSimulatorMessage() {
  // Practice conversations never create real inbox records or notifications.
}

function getNextMissingLeadField() {
  if (!state.lead.name) return "name";
  if (!state.lead.phone && !state.lead.email) return "contact";
  if (!state.lead.business_name) return "business_name";
  if (!state.lead.body) return "body";
  return "";
}

function hasLeadValue(field) {
  if (field === "contact") return Boolean(state.lead.phone || state.lead.email);
  return Boolean(state.lead[field]);
}

function askForLeadField(field) {
  const prompts = {
    name: [
      "What name should I put on the message?",
      "And who am I speaking with?",
      "Can I grab your name?",
      "What's your name?",
    ],
    contact: [
      "What's the best number or email to reach you?",
      "And what's a good callback number or email?",
      "Where should we reach you — phone or email?",
    ],
    business_name: [
      "What company are you calling from?",
      "And what business are you with?",
      "Are you calling on behalf of a company?",
    ],
    body: [
      "What message would you like me to pass along?",
      "Go ahead — what should I tell them?",
      "What would you like them to know?",
      "What's the message?",
    ],
  };
  const options = prompts[field];
  return options ? pickOne(options) : "What else should I include?";
}

function hasMessageIntent(lower) {
  return lower.includes("message") || lower.includes("callback") || lower.includes("call back") || lower.includes("tell ray") || lower.includes("let ray know");
}

function isSmallTalk(lower) {
  return /\b(hello|hi|hey|good morning|good afternoon|good evening|how are you|thanks|thank you|what's up|howdy|how's it going|yo)\b/.test(lower);
}

function getSmallTalkReply(lower) {
  if (lower.includes("thank")) {
    return pickOne([
      "You're welcome! Need anything else?",
      "Anytime! Was there something else I can help with?",
      "Of course! Anything else on your mind?",
      "Happy to help! Let me know if something else comes up.",
    ]);
  }
  if (lower.includes("how are you") || lower.includes("how's it going")) {
    return pickOne([
      "Doing great, thanks for asking! What can I do for you?",
      "I'm good! What's going on?",
      "All good here! What brings you in today?",
      "Can't complain! How can I help?",
    ]);
  }
  if (lower.includes("good morning")) {
    return pickOne([
      "Good morning! What can I help you with?",
      "Morning! How can I help you out today?",
      "Good morning! What's on your mind?",
    ]);
  }
  if (lower.includes("good afternoon")) {
    return pickOne([
      "Good afternoon! What can I do for you?",
      "Afternoon! How can I help?",
    ]);
  }
  if (lower.includes("good evening")) {
    return pickOne([
      "Good evening! What can I help with?",
      "Evening! How can I help you out?",
    ]);
  }
  return pickOne([
    "Hey there! This is AIRA with Molecular Project Development LLC. What can I do for you?",
    "Hi! Thanks for calling Molecular Project Development LLC. What's going on?",
    "Hey! You've reached Molecular Project Development LLC — I'm AIRA. How can I help?",
    "Hi there! What can I help you with today?",
  ]);
}

function isContextSwitch(lower) {
  return lower.includes("actually") || lower.includes("instead") || lower.includes("different question") || lower.includes("change that");
}

function inferPendingFromText(lower) {
  if (lower.includes("message") || lower.includes("callback")) return "body";
  if (lower.includes("phone") || lower.includes("email") || lower.includes("number")) return "contact";
  if (lower.includes("business") || lower.includes("company")) return "business_name";
  return "";
}

function isAffirmative(lower) {
  return ["yes", "yeah", "yep", "sure", "correct", "that is right", "please"].some((word) => lower.includes(word));
}

function looksLikeContact(text) {
  return /@/.test(text) || /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text);
}

function hasUrgency(lower) {
  return /\b(urgent|emergency|asap|deadline|today|tomorrow|court|eviction|shut off|down|broken|can't access|cannot access)\b/.test(lower);
}

function isDistressed(lower) {
  return /\b(emergency|crying|scared|afraid|panic|panicking|overwhelmed|desperate|unsafe|danger|threatened|harassed)\b/.test(lower);
}

function isAbusive(lower) {
  return /\b(stupid|idiot|shut up|useless|hate you)\b/.test(lower);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      state.serviceWorkerRegistration = registration;
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
      } else if (event.data?.type === "OPEN_MESSAGES") {
        switchTab("messages");
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
