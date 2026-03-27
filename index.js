// ─── URL Params ───────────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
// Token priority: URL param → config.js (window.TOKEN) → empty (will show join UI)
let TOKEN = params.get("token") || window.TOKEN || null;
let MEETING_ID = params.get("meetingId");
let FREQ = params.has("freq") ? parseInt(params.get("freq"), 10) : null; // null = observe only

// ─── State ────────────────────────────────────────────────────────────────────
let meeting = null;
let sendInterval = null;
let msgRecvThisSecond = 0;
let bytesRecvThisSecond = 0;
let totalMsgRecv = 0;
let totalBytesRecv = 0;
let totalMsgSent = 0;

// ─── DOM helpers ──────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function setStatus(text) {
    $("status").innerText = text;
    logLine("[STATUS] " + text);
}

function logLine(msg) {
    const div = $("logOutput");
    if (!div) return;
    const ts = new Date().toISOString().substring(11, 23);
    div.innerHTML += `<div>[${ts}] ${msg}</div>`;
    div.scrollTop = div.scrollHeight;
}

// ─── Boot: decide UI mode ─────────────────────────────────────────────────────
function boot() {
    if (TOKEN && MEETING_ID) {
        // Full auto mode from URL params
        showMeetingScreen();
        startMeeting(TOKEN, MEETING_ID);
    } else {
        // Fallback: show manual join UI
        $("join-screen").style.display = "block";
    }
}

// ─── Manual Join (from UI) ────────────────────────────────────────────────────
async function handleManualJoin() {
    TOKEN = $("tokenInput").value.trim();
    if (!TOKEN) { alert("Please enter a token."); return; }

    const inputId = $("meetingIdInput").value.trim();
    const freqVal = $('freqInput').value.trim();
    FREQ = freqVal ? parseInt(freqVal, 10) : null;

    if (inputId) {
        MEETING_ID = inputId;
    } else {
        // Create new meeting via API
        try {
            const res = await fetch("https://api.classplus-dev.videosdk.live/v2/rooms", {
                method: "POST",
                headers: { Authorization: TOKEN, "Content-Type": "application/json" },
            });
            const data = await res.json();
            if (!data.roomId) { alert("Failed to create meeting: " + JSON.stringify(data)); return; }
            MEETING_ID = data.roomId;
        } catch (e) {
            alert("Error creating meeting: " + e.message);
            return;
        }
    }

    showMeetingScreen();
    startMeeting(TOKEN, MEETING_ID);
}

function showMeetingScreen() {
    $("join-screen").style.display = "none";
    $("grid-screen").style.display = "block";
    $("meetingIdDisplay").innerText = MEETING_ID;
    $("freqDisplay").innerText = FREQ !== null ? FREQ + " ms" : "none (observe only)";
}

// ─── Meeting Init ─────────────────────────────────────────────────────────────
function startMeeting(token, meetingId) {
    VideoSDK.config(token);

    meeting = VideoSDK.initMeeting({
        meetingId: meetingId,
        name: "LoadTestBot-" + Math.floor(Math.random() * 9000 + 1000),
        micEnabled: false,
        webcamEnabled: false,
        signalingBaseUrl: "api.classplus-dev.videosdk.live"
    });

    meeting.join();
    setStatus("Joining...");

    meeting.on("meeting-joined", () => {
        const freqMsg = FREQ !== null
            ? `Sending 1 msg every ${FREQ}ms`
            : `Observing (no send freq specified)`;
        setStatus("Joined. " + freqMsg);
        logLine("Participant count: " + (meeting.participants.size + 1));

        if (FREQ !== null) startSending();
        startStatsTimer();
    });

    meeting.on("meeting-left", () => {
        setStatus("Left meeting.");
        stopSending();
    });

    meeting.on("participant-joined", (p) => {
        logLine(`Participant joined: ${p.displayName} (${p.id}) mode=${p.mode}`);
        updateParticipantCount();
    });

    meeting.on("participant-left", (p) => {
        logLine(`Participant left: ${p.id}`);
        updateParticipantCount();
    });

    // ─── Receive DataStream ───────────────────────────────────────────────
    meeting.on("data", (data) => {
        const { payload, from } = data;
        const byteSize = typeof payload === "string"
            ? new TextEncoder().encode(payload).byteLength
            : payload.byteLength;

        msgRecvThisSecond++;
        totalMsgRecv++;
        bytesRecvThisSecond += byteSize;
        totalBytesRecv += byteSize;

        // Display in chat if it looks like a chat message (not a load-test payload)
        let isChat = false;
        try {
            const parsed = JSON.parse(payload);
            if (parsed.type !== "LOAD_TEST") isChat = true;
            if (parsed.type === "CHAT") appendChatMsg(from, parsed.text || payload);
        } catch {
            isChat = true; // plain string = treat as chat
        }
        if (isChat && !payload.startsWith("{")) appendChatMsg(from, payload);
    });
}

function appendChatMsg(from, text) {
    const box = $("chatMessages");
    if (!box) return;
    const sender = meeting.participants.get(from)?.displayName || from;
    box.innerHTML += `<div><b>${sender}:</b> ${text}</div>`;
    box.scrollTop = box.scrollHeight;
}

// ─── Manual chat send ─────────────────────────────────────────────────────────
async function sendChatMessage() {
    const input = $("chatInput");
    const msg = input.value.trim();
    if (!msg || !meeting) return;

    try {
        await meeting.send(JSON.stringify({ type: "CHAT", text: msg }), {
            reliability: VideoSDK.Constants.reliabilityMode.RELIABLE,
        });
        totalMsgSent++;
        appendChatMsg("me", msg);
        input.value = "";
    } catch (e) {
        logLine("Chat send error: " + e.message);
    }
}

// ─── Load Test Send Loop ──────────────────────────────────────────────────────
function startSending() {
    let seq = 0;
    sendInterval = setInterval(async () => {
        const msg = JSON.stringify({ type: "LOAD_TEST", t: Date.now(), seq: seq++ });
        try {
            await meeting.send(msg, {
                reliability: VideoSDK.Constants.reliabilityMode.RELIABLE,
            });
            totalMsgSent++;
        } catch (e) {
            logLine("Send error: " + e.message);
        }
    }, FREQ);
}

function stopSending() {
    if (sendInterval) { clearInterval(sendInterval); sendInterval = null; }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateParticipantCount() {
    if (meeting) $("participantCount").innerText = meeting.participants.size + 1;
}

function updateStats() {
    $("msgPerSec").innerText = msgRecvThisSecond;
    $("totalMsgRecv").innerText = totalMsgRecv;
    $("bytesPerSec").innerText = bytesRecvThisSecond;
    $("totalBytesRecv").innerText = totalBytesRecv;
    $("totalMsgSent").innerText = totalMsgSent;
    updateParticipantCount();
    estimateCPU();
    msgRecvThisSecond = 0;
    bytesRecvThisSecond = 0;
}

function estimateCPU() {
    if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback((dl) => {
            $("cpuUsage").innerText = "~" + Math.max(0, Math.round((1 - dl.timeRemaining() / 50) * 100)) + "% (est)";
        }, { timeout: 500 });
    } else {
        $("cpuUsage").innerText = "N/A";
    }
}

function startStatsTimer() {
    setInterval(updateStats, 1000);
}

// ─── Start ────────────────────────────────────────────────────────────────────
boot();