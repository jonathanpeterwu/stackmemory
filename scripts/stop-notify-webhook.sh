#!/bin/bash
# Stop StackMemory webhook services

echo "Stopping webhook services..."

if [ -f /tmp/stackmemory-webhook.pid ]; then
  kill $(cat /tmp/stackmemory-webhook.pid) 2>/dev/null && echo "Webhook server stopped"
  rm /tmp/stackmemory-webhook.pid
fi

if [ -f /tmp/stackmemory-ngrok.pid ]; then
  kill $(cat /tmp/stackmemory-ngrok.pid) 2>/dev/null && echo "Ngrok tunnel stopped"
  rm /tmp/stackmemory-ngrok.pid
fi

pkill -f "notify webhook" 2>/dev/null || true
pkill -f "ngrok http" 2>/dev/null || true

echo "Done"
