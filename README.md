# VideoSDK DataStream Load Test

A browser-based load testing tool for VideoSDK DataStream (data channel). Opens a meeting, sends messages at a specified frequency, and reports live stats.

## Usage

### On Vercel (production)
Pass all params in the URL:
```
https://your-deployment.vercel.app/?token=YOUR_VIDEOSDK_TOKEN&meetingId=YOUR_MEETING_ID&freq=500
```

| Param | Required | Description |
|-------|----------|-------------|
| `token` | Yes | VideoSDK auth token |
| `meetingId` | No (auto-creates) | Existing meeting ID to join |
| `freq` | No | Send interval in ms. Omit to observe only (no sending) |

### Locally

1. Copy `config.example.js` → `config.js`
2. Paste your VideoSDK token inside `config.js`
3. Run `npx live-server`
4. Open `http://127.0.0.1:8080`

The manual join UI appears when no URL params are detected.

## Live Stats

- Messages Recv/s
- Total Messages Recv
- Bytes Recv/s
- Total Bytes Recv
- Active Participants
- CPU Usage (estimated)
- Messages Sent

## Security

`config.js` is gitignored. Your token is never pushed to the repository.
