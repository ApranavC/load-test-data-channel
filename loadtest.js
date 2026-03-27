// ─── URL Params ───────────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const TOKEN = params.get("token");
const MEETING_ID = params.get("meetingId");
const FREQ = parseInt(params.get("freq") || "1000", 10); // ms between messages

// ─── State ────────────────────────────────────────────────────────────────────
let meeting = null;
let msgRecvThisSecond = 0;
let bytesRecvThisSecond = 0;
let totalMsgRecv = 0;
let totalBytesRecv = 0;
let totalMsgSent = 0;
let sendInterval = null;
let cpuSamples = [];

// ─── DOM Helpers ──────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function setStatus(text) {
    $("status").innerText = text;
    logLine("[STATUS] " + text);
}

function logLine(msg) {
    const div = $("logOutput");
    const ts = new Date().toISOString().substring(11, 23);
    div.innerHTML += `<div>[${ts}] ${msg}</div>`;
    div.scrollTop = div.scrollHeight;
}

function updateStats() {
    $("msgPerSec").innerText = msgRecvThisSecond;
    $("totalMsgRecv").innerText = totalMsgRecv;
    $("bytesPerSec").innerText = bytesRecvThisSecond;
    $("totalBytesRecv").innerText = totalBytesRecv;
    $("totalMsgSent").innerText = totalMsgSent;

    if (meeting) {
        $("participantCount").innerText = (meeting.participants.size + 1);
    }

    // CPU via performance.measureUserAgentSpecificMemory is not widely available.
    // Best effort: use PerformanceObserver + Long Task detection as a proxy, or just N/A.
    estimateCPU();

    msgRecvThisSecond = 0;
    bytesRecvThisSecond = 0;
}

// ─── CPU Estimation ───────────────────────────────────────────────────────────
let lastCpuTime = null;
let lastCpuIdle = null;

async function estimateCPU() {
    // Use requestIdleCallback budget as a rough CPU proxy
    if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback((idleDeadline) => {
            const budget = idleDeadline.timeRemaining(); // ms available in idle (0-50)
            // The less time remaining, the busier the CPU
            const busyPercent = Math.max(0, Math.round((1 - budget / 50) * 100));
            $("cpuUsage").innerText = "~" + busyPercent + "% (estimated)";
        }, { timeout: 500 });
    } else {
        // Fallback: try navigation.deviceMemory or just say N/A
        $("cpuUsage").innerText = "N/A (API unavailable)";
    }
}

// ─── Validate params ──────────────────────────────────────────────────────────
function validateAndInit() {
    $("meetingIdDisplay").innerText = MEETING_ID || "MISSING";
    $("freqDisplay").innerText = FREQ;

    if (!TOKEN || !MEETING_ID) {
        setStatus("ERROR: Missing token or meetingId in URL params. Usage: ?token=XXX&meetingId=YYY&freq=500");
        logLine("Required params: token, meetingId, freq (optional, default 1000ms)");
        return;
    }

    logLine("Params OK. Token length=" + TOKEN.length + " MeetingId=" + MEETING_ID + " Freq=" + FREQ + "ms");
    initMeeting();
}

// ─── Meeting Init ─────────────────────────────────────────────────────────────
function initMeeting() {
    setStatus("Configuring SDK...");
    VideoSDK.config(TOKEN);

    setStatus("Initializing meeting...");
    meeting = VideoSDK.initMeeting({
        meetingId: MEETING_ID,
        name: "LoadTestBot-" + Math.floor(Math.random() * 9000 + 1000),
        micEnabled: false,
        webcamEnabled: false,
    });

    meeting.join();
    setStatus("Joining...");

    meeting.on("meeting-joined", () => {
        setStatus("Joined meeting. Sending 1 msg every " + FREQ + "ms...");
        logLine("Meeting joined. Participant count: " + (meeting.participants.size + 1));
        startSending();
        startStatsTimer();
    });

    meeting.on("meeting-left", () => {
        setStatus("Left meeting.");
        stopSending();
    });

    meeting.on("participant-joined", (p) => {
        logLine("Participant joined: " + p.displayName + " (" + p.id + ") mode=" + p.mode);
    });

    meeting.on("participant-left", (p) => {
        logLine("Participant left: " + p.id);
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
    });
}

// ─── Send Loop ────────────────────────────────────────────────────────────────
function startSending() {
    const payload = JSON.stringify({
        type: "LOAD_TEST",
        t: Date.now(),
        seq: 0,
        data: "X".repeat(100), // ~100 byte message body
    });

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
    if (sendInterval) {
        clearInterval(sendInterval);
        sendInterval = null;
    }
}

// ─── Stats Timer ──────────────────────────────────────────────────────────────
function startStatsTimer() {
    setInterval(updateStats, 1000);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
validateAndInit();
