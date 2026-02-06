/**
 * Popup UI Logic
 */

import { LinearClient } from '../linear-client.js';
import { getAuth, isAuthenticated, getConfig } from '../storage.js';
import {
  draftToLinearCreate,
  generateTitle,
  createCapturedContent,
} from '../transforms.js';
import { validateTicketDraft } from '../validation.js';
import type {
  CapturedContent,
  LinearProject,
  TicketDraft,
  LinearAuth,
} from '../types.js';

// DOM Elements
const screens = {
  authRequired: document.getElementById('auth-required')!,
  createForm: document.getElementById('create-form')!,
  success: document.getElementById('success')!,
  loading: document.getElementById('loading')!,
  error: document.getElementById('error')!,
};

const elements = {
  authBtn: document.getElementById('auth-btn') as HTMLButtonElement,
  title: document.getElementById('title') as HTMLInputElement,
  project: document.getElementById('project') as HTMLSelectElement,
  priority: document.getElementById('priority') as HTMLSelectElement,
  description: document.getElementById('description') as HTMLTextAreaElement,
  autoAgent: document.getElementById('auto-agent') as HTMLInputElement,
  sourceUrl: document.getElementById('source-url')!,
  sourceInfo: document.getElementById('source-info')!,
  createBtn: document.getElementById('create-btn') as HTMLButtonElement,
  cancelBtn: document.getElementById('cancel-btn') as HTMLButtonElement,
  ticketLink: document.getElementById('ticket-link')!,
  viewBtn: document.getElementById('view-btn') as HTMLButtonElement,
  newBtn: document.getElementById('new-btn') as HTMLButtonElement,
  loadingText: document.getElementById('loading-text')!,
  errorMessage: document.getElementById('error-message')!,
  retryBtn: document.getElementById('retry-btn') as HTMLButtonElement,
};

// State
let captured: CapturedContent | null = null;
let auth: LinearAuth | null = null;
let projects: LinearProject[] = [];
let createdIssueUrl: string | null = null;

/**
 * Show a specific screen
 */
function showScreen(name: keyof typeof screens): void {
  Object.values(screens).forEach((s) => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

/**
 * Initialize popup
 */
async function init(): Promise<void> {
  // Check auth
  const isAuthed = await isAuthenticated();
  if (!isAuthed) {
    showScreen('authRequired');
    return;
  }

  auth = await getAuth();

  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab?.url) {
    // Get selected text from page
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: () => window.getSelection()?.toString() || '',
    });

    const selectedText = result?.result || '';
    captured = createCapturedContent(selectedText, tab.url);

    // Pre-fill form
    if (selectedText) {
      elements.title.value = generateTitle(captured);
      elements.description.value = selectedText;
    }

    // Show source URL
    try {
      const hostname = new URL(tab.url).hostname;
      elements.sourceUrl.textContent = hostname;
      elements.sourceInfo.classList.remove('hidden');
    } catch {
      elements.sourceInfo.classList.add('hidden');
    }
  }

  // Load projects
  await loadProjects();

  showScreen('createForm');
}

/**
 * Load projects for dropdown
 */
async function loadProjects(): Promise<void> {
  if (!auth) return;

  const client = new LinearClient(auth);
  const result = await client.getProjects();

  if (result.ok) {
    projects = result.value;
    elements.project.innerHTML = '<option value="">Select project...</option>';
    projects.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      elements.project.appendChild(option);
    });
  }
}

/**
 * Handle create ticket
 */
async function handleCreate(): Promise<void> {
  if (!auth || !captured) return;

  const draft: Partial<TicketDraft> = {
    title: elements.title.value,
    description: elements.description.value,
    projectId: elements.project.value,
    priority: elements.priority.value as TicketDraft['priority'],
    captured,
  };

  // Add automation label if auto-agent is checked
  const config = await getConfig();
  if (elements.autoAgent.checked) {
    draft.labelIds = config.defaultLabels.map((name) => name); // Would need to resolve to IDs
  }

  // Validate
  const validation = validateTicketDraft(draft);
  if (!validation.ok) {
    showError(validation.error.message);
    return;
  }

  // Show loading
  showScreen('loading');
  elements.loadingText.textContent = 'Creating ticket...';

  try {
    const client = new LinearClient(auth);
    const createReq = draftToLinearCreate(validation.value, auth);

    // Add automation labels by name (Linear SDK handles resolution)
    if (elements.autoAgent.checked) {
      // The description will trigger the webhook handler
      createReq.description += '\n\n*Labels: automated*';
    }

    const result = await client.createIssue(createReq);

    if (!result.ok) {
      showError(result.error.message);
      return;
    }

    // Success!
    createdIssueUrl = result.value.url;
    elements.ticketLink.textContent = result.value.identifier;
    showScreen('success');
  } catch (error) {
    showError(
      error instanceof Error ? error.message : 'Failed to create ticket'
    );
  }
}

/**
 * Show error screen
 */
function showError(message: string): void {
  elements.errorMessage.textContent = message;
  showScreen('error');
}

/**
 * Handle OAuth flow
 */
async function handleAuth(): Promise<void> {
  // Open OAuth flow in new tab
  // This would redirect to Linear OAuth and handle the callback
  chrome.tabs.create({
    url: 'https://linear.app/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=...',
  });
}

// Event Listeners
elements.authBtn.addEventListener('click', handleAuth);
elements.createBtn.addEventListener('click', handleCreate);
elements.cancelBtn.addEventListener('click', () => window.close());
elements.viewBtn.addEventListener('click', () => {
  if (createdIssueUrl) {
    chrome.tabs.create({ url: createdIssueUrl });
  }
});
elements.newBtn.addEventListener('click', () => {
  elements.title.value = '';
  elements.description.value = '';
  elements.project.selectedIndex = 0;
  showScreen('createForm');
});
elements.retryBtn.addEventListener('click', () => showScreen('createForm'));

// Initialize
init().catch(console.error);
