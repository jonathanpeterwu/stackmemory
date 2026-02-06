/**
 * Background Service Worker
 * Handles context menu and message passing
 */

import { createCapturedContent, generateTitle } from './transforms.js';
import { getAuth, isAuthenticated } from './storage.js';

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'create-linear-ticket',
    title: 'Create Linear Ticket',
    contexts: ['selection'],
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'create-linear-ticket') return;
  if (!tab?.url || !info.selectionText) return;

  // Check if authenticated
  const isAuthed = await isAuthenticated();
  if (!isAuthed) {
    // Open popup to prompt auth
    chrome.action.openPopup();
    return;
  }

  // Store captured content for popup
  const captured = createCapturedContent(info.selectionText, tab.url);
  const title = generateTitle(captured);

  await chrome.storage.local.set({
    pendingTicket: {
      captured,
      title,
    },
  });

  // Open popup
  chrome.action.openPopup();
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PENDING_TICKET') {
    chrome.storage.local.get('pendingTicket').then((result) => {
      sendResponse(result.pendingTicket || null);
      // Clear pending ticket
      chrome.storage.local.remove('pendingTicket');
    });
    return true; // Keep channel open for async response
  }
});

// Handle OAuth callback
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  // Check if this is our OAuth callback
  const url = new URL(changeInfo.url);
  if (url.pathname === '/oauth/callback' && url.searchParams.has('code')) {
    const code = url.searchParams.get('code')!;

    // Exchange code for token (would need backend endpoint)
    // For now, just log it
    console.log('OAuth code received:', code);

    // Close the OAuth tab
    chrome.tabs.remove(tabId);
  }
});

export {};
