#!/bin/bash
# Auto-setup for StackMemory WhatsApp/SMS webhook loop

set -e

WEBHOOK_PORT="${1:-3456}"
TWILIO_ACCOUNT_SID="${TWILIO_ACCOUNT_SID}"
TWILIO_AUTH_TOKEN="${TWILIO_AUTH_TOKEN}"

echo "=== StackMemory Webhook Setup ==="
echo ""

# Check dependencies
if ! command -v ngrok &> /dev/null; then
  echo "Installing ngrok..."
  if command -v brew &> /dev/null; then
    brew install ngrok
  else
    echo "Please install ngrok: https://ngrok.com/download"
    exit 1
  fi
fi

# Check Twilio credentials
if [ -z "$TWILIO_ACCOUNT_SID" ] || [ -z "$TWILIO_AUTH_TOKEN" ]; then
  echo "Error: Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN"
  exit 1
fi

# Kill any existing processes
pkill -f "notify webhook" 2>/dev/null || true
pkill -f "ngrok http $WEBHOOK_PORT" 2>/dev/null || true
sleep 1

# Start webhook server in background
echo "Starting webhook server on port $WEBHOOK_PORT..."
stackmemory notify webhook -p "$WEBHOOK_PORT" > /tmp/webhook.log 2>&1 &
WEBHOOK_PID=$!
sleep 2

# Start ngrok in background
echo "Starting ngrok tunnel..."
ngrok http "$WEBHOOK_PORT" --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!
sleep 3

# Get ngrok public URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"https://[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$NGROK_URL" ]; then
  echo "Error: Could not get ngrok URL. Check /tmp/ngrok.log"
  exit 1
fi

WEBHOOK_URL="${NGROK_URL}/sms/incoming"
echo ""
echo "Webhook URL: $WEBHOOK_URL"

# Configure Twilio WhatsApp sandbox webhook
echo ""
echo "Configuring Twilio WhatsApp sandbox..."

# Get sandbox configuration
SANDBOX_RESPONSE=$(curl -s "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Sandbox.json" \
  -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" 2>/dev/null)

if echo "$SANDBOX_RESPONSE" | grep -q "sms_url"; then
  # Update sandbox webhook URL
  curl -s -X POST "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Sandbox.json" \
    -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
    -d "SmsUrl=${WEBHOOK_URL}" \
    -d "SmsMethod=POST" > /dev/null
  echo "Sandbox webhook configured!"
else
  echo "Note: Configure webhook manually in Twilio console:"
  echo "  URL: $WEBHOOK_URL"
  echo "  https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn"
fi

# Install Claude hook
echo ""
echo "Installing Claude response hook..."
stackmemory notify install-response-hook 2>/dev/null || true

# Save PIDs for cleanup
echo "$WEBHOOK_PID" > /tmp/stackmemory-webhook.pid
echo "$NGROK_PID" > /tmp/stackmemory-ngrok.pid

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Webhook server: http://localhost:$WEBHOOK_PORT (PID: $WEBHOOK_PID)"
echo "Ngrok tunnel:   $NGROK_URL (PID: $NGROK_PID)"
echo "Webhook URL:    $WEBHOOK_URL"
echo ""
echo "The loop is now active:"
echo "  1. Send notification: stackmemory notify review 'Task'"
echo "  2. User replies via WhatsApp"
echo "  3. Response queued for action"
echo "  4. Claude hook processes it"
echo ""
echo "To stop: ./scripts/stop-notify-webhook.sh"
echo "Logs: /tmp/webhook.log, /tmp/ngrok.log"
