# StackMemory Notifications Spec

## Overview

StackMemory Notifications enables SMS/WhatsApp alerts for AI coding workflows with interactive prompts and response handling. This creates a human-in-the-loop system where developers can approve, reject, or direct AI actions remotely.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  StackMemory    │────▶│   Twilio     │────▶│  User Phone │
│  CLI/Hooks      │     │   API        │     │  (SMS/WA)   │
└─────────────────┘     └──────────────┘     └─────────────┘
        ▲                      │
        │                      │
        │               ┌──────▼──────┐
        │               │   ngrok     │
        │               │   tunnel    │
        │               └──────┬──────┘
        │                      │
        └──────────────────────┘
              Webhook response
```

## Features

### Notification Types
- **Task Complete**: Alert when long-running tasks finish
- **Review Ready**: Prompt for code review with options
- **Error Alert**: Notify on failures with context
- **Custom Prompt**: Yes/No or numbered options

### Interactive Prompts
```
Review Ready: PR #123

Feature: Add user authentication

What would you like to do?
1. Approve and merge
2. Request changes
3. Skip for now

Reply with number to select
```

### Response Handling
1. User replies via SMS/WhatsApp
2. Webhook captures response
3. Action queued for execution
4. Claude Code hook processes action

## Configuration

### Environment Variables

```bash
# Required - Twilio Credentials
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx

# Channel Selection (whatsapp recommended)
TWILIO_CHANNEL=whatsapp  # or 'sms'

# WhatsApp Numbers
TWILIO_WHATSAPP_FROM=+14155238886  # Twilio sandbox or business number
TWILIO_WHATSAPP_TO=+1234567890      # User's phone

# SMS Numbers (fallback)
TWILIO_SMS_FROM=+1234567890  # Twilio number (requires A2P 10DLC)
TWILIO_SMS_TO=+1234567890    # User's phone
```

### Config File

`~/.stackmemory/sms-notify.json`:
```json
{
  "enabled": true,
  "channel": "whatsapp",
  "notifyOn": {
    "taskComplete": true,
    "reviewReady": true,
    "error": true,
    "custom": true
  },
  "quietHours": {
    "enabled": true,
    "start": "22:00",
    "end": "08:00"
  },
  "responseTimeout": 300
}
```

## Setup Guide

### Quick Start (WhatsApp Sandbox)

1. **Create Twilio Account**
   ```bash
   # Get credentials from https://console.twilio.com
   export TWILIO_ACCOUNT_SID=ACxxxxx
   export TWILIO_AUTH_TOKEN=xxxxx
   ```

2. **Join WhatsApp Sandbox**
   - Go to: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
   - Send join code from your phone to sandbox number
   - Note the sandbox number (e.g., +14155238886)

3. **Configure StackMemory**
   ```bash
   export TWILIO_WHATSAPP_FROM=+14155238886
   export TWILIO_WHATSAPP_TO=+1234567890  # Your phone
   export TWILIO_CHANNEL=whatsapp

   stackmemory notify enable
   stackmemory notify test
   ```

4. **Set Up Webhook Loop**
   ```bash
   # Auto-setup (starts webhook + ngrok)
   ./scripts/setup-notify-webhook.sh

   # Configure Twilio webhook URL (shown in output)
   # https://xxx.ngrok.io/sms/incoming
   ```

### Production Setup

1. **Register WhatsApp Business** (or use Twilio toll-free for SMS)
2. **Deploy webhook** to public server (Railway, Vercel, etc.)
3. **Configure Twilio** with permanent webhook URL

### SMS Setup (A2P 10DLC Required)

US carriers require 10DLC registration for business SMS:

1. Register brand at: https://console.twilio.com/us1/develop/sms/settings/compliance
2. Register campaign for notifications
3. Wait for approval (1-7 days)
4. Configure SMS numbers

## CLI Commands

```bash
# Configuration
stackmemory notify status          # Show config status
stackmemory notify enable          # Enable notifications
stackmemory notify disable         # Disable notifications
stackmemory notify channel <type>  # Set channel (whatsapp|sms)

# Send Notifications
stackmemory notify test                    # Send test message
stackmemory notify send "Message"          # Custom notification
stackmemory notify review "PR #123"        # Review prompt with options
stackmemory notify ask "Deploy?"           # Yes/No prompt
stackmemory notify complete "Task name"    # Task complete alert

# Webhook Management
stackmemory notify webhook -p 3456         # Start webhook server
stackmemory notify pending                 # List pending prompts
stackmemory notify actions                 # List queued actions
stackmemory notify run-actions             # Execute pending actions

# Setup
stackmemory notify install-hook            # Install notify hook
stackmemory notify install-response-hook   # Install response handler
```

## Claude Code Integration

### Hooks

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "pre_tool_use": [
      "node ~/.claude/hooks/sms-response-handler.js"
    ],
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [{
          "type": "command",
          "command": "stackmemory notify complete '$TASK_NAME'"
        }]
      }
    ]
  }
}
```

### Programmatic Usage

```typescript
import {
  sendNotification,
  notifyReviewReady,
  notifyWithYesNo,
  notifyTaskComplete
} from '@stackmemoryai/stackmemory/hooks/sms-notify';

// Simple notification
await sendNotification({
  type: 'custom',
  title: 'Build Complete',
  message: 'All tests passing'
});

// Review with options
await notifyReviewReady('PR #123', 'Feature: Auth', [
  { label: 'Approve', action: 'gh pr merge 123' },
  { label: 'Reject', action: 'gh pr close 123' }
]);

// Yes/No prompt
await notifyWithYesNo(
  'Deploy',
  'Deploy to production?',
  'npm run deploy',  // Yes action
  'echo "Skipped"'   // No action
);
```

## Webhook API

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sms/incoming` | POST | Receive messages |
| `/sms/status` | POST | Delivery status callbacks |
| `/status` | GET | Notification status |

### Incoming Message Format (Twilio)

```
POST /sms/incoming
Content-Type: application/x-www-form-urlencoded

From=whatsapp:+1234567890
To=whatsapp:+14155238886
Body=1
MessageSid=SMxxxxx
```

### Response Format (TwiML)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Got it! Action queued.</Message>
</Response>
```

## Pricing

### WhatsApp (Recommended)
- Conversation-based pricing (~$0.005-0.015 per 24h window)
- User-initiated conversations are cheaper
- No carrier registration required

### SMS
- Per-message pricing (~$0.0079/segment)
- Requires A2P 10DLC registration (US)
- $2-15/month for number + campaign fees

## Security

- Credentials stored in environment variables only
- Config file excludes sensitive data
- Phone numbers masked in logs/status
- Webhook validates Twilio signature (optional)

## Limitations

- WhatsApp Sandbox: Must re-join every 72 hours of inactivity
- SMS: Requires 10DLC registration (US carriers block unregistered)
- ngrok free: URL changes on restart (use paid for static URL)
- Response timeout: 5 minutes default (configurable)

## Troubleshooting

### Message Not Received

1. Check `stackmemory notify status` - verify enabled and configured
2. For SMS: Check A2P 10DLC registration status
3. For WhatsApp: Verify sandbox join is active
4. Check Twilio console for error codes

### Webhook Not Receiving

1. Verify ngrok running: `curl http://localhost:4040/api/tunnels`
2. Check webhook URL in Twilio console matches ngrok URL
3. Test endpoint: `curl -X POST http://localhost:3456/sms/incoming`

### Common Error Codes

| Code | Meaning | Fix |
|------|---------|-----|
| 30034 | Message blocked | Register for 10DLC (SMS) or use WhatsApp |
| 21608 | Unverified number | Verify destination in Twilio console |
| 63016 | WhatsApp not opted-in | User must send join code first |

## Future Enhancements

- [ ] Slack/Discord integration
- [ ] Email fallback
- [ ] Voice call for critical alerts
- [ ] Multi-user routing
- [ ] Response analytics dashboard
- [ ] Scheduled quiet hours per user
- [ ] Template library for common prompts
