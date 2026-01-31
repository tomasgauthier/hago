/**
 * Tombot Admin Dashboard
 * Modern, maintainable JavaScript following best practices
 */

// === Constants ===
const CONFIG = {
    API_BASE: '/api',
    STORAGE_KEY: 'tombot_admin_pass',
    CHAT_SESSION_KEY: 'admin:dashboard',
    UPDATE_INTERVAL: 30000, // 30 seconds
    TOAST_DURATION: 3000,
};

const PERMISSION_LEVELS = {
    1: { label: 'Level 1 - READ_ONLY', color: 'success' },
    2: { label: 'Level 2 - WRITE_SAFE', color: 'success' },
    3: { label: 'Level 3 - EXECUTE_SAFE', color: 'warning' },
    4: { label: 'Level 4 - PRIVILEGED', color: 'error' },
};

// === State ===
const State = {
    config: null,
    authPassword: localStorage.getItem(CONFIG.STORAGE_KEY) || '',
    updateInterval: null,
    isSaving: false,
};

// === Utility Functions ===
const Utils = {
    formatTokens(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return n.toString();
    },

    formatCost(cost) {
        return `$${cost.toFixed(4)}`;
    },

    formatTime(date) {
        return new Date(date).toLocaleTimeString();
    },

    parseCSV(text) {
        return text
            .split(',')
            .map(s => s.trim())
            .filter(s => s);
    },

    parseIntCSV(text) {
        return text
            .split(',')
            .map(s => parseInt(s.trim()))
            .filter(n => !isNaN(n));
    },

    showToast(text, isError = false) {
        const toast = document.getElementById('toast');
        const icon = document.getElementById('toast-icon');
        const textEl = document.getElementById('toast-text');

        textEl.textContent = text;
        icon.textContent = isError ? '❌' : '✅';
        toast.style.borderColor = isError ? 'var(--error)' : 'var(--success)';
        toast.classList.add('toast--visible');

        setTimeout(() => {
            toast.classList.remove('toast--visible');
        }, CONFIG.TOAST_DURATION);
    },

    async fetchWithAuth(url, options = {}) {
        const headers = {
            ...options.headers,
            'Authorization': `Bearer ${State.authPassword}`,
        };

        const response = await fetch(url, { ...options, headers });

        if (response.status === 401) {
            Auth.showAuthOverlay();
            throw new Error('Unauthorized');
        }

        return response;
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
};

// === Authentication ===
const Auth = {
    showAuthOverlay() {
        document.getElementById('auth-overlay').classList.add('auth-overlay--visible');
    },

    hideAuthOverlay() {
        document.getElementById('auth-overlay').classList.remove('auth-overlay--visible');
    },

    async authenticate() {
        const input = document.getElementById('admin-pass');
        State.authPassword = input.value;
        localStorage.setItem(CONFIG.STORAGE_KEY, State.authPassword);
        input.value = '';
        await App.init();
    },

    logout() {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
        State.authPassword = '';
        location.reload();
    },
};

// === API Calls ===
const API = {
    async getConfig() {
        const res = await Utils.fetchWithAuth(`${CONFIG.API_BASE}/config`);
        return res.json();
    },

    async saveConfig(config) {
        const res = await Utils.fetchWithAuth(`${CONFIG.API_BASE}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || 'Update failed');
        }

        return res.json();
    },

    async getUsage() {
        const res = await Utils.fetchWithAuth(`${CONFIG.API_BASE}/usage`);
        return res.json();
    },

    async getIdentity() {
        const res = await fetch('/identity');
        return res.json();
    },

    async getChatHistory(sessionKey) {
        const res = await Utils.fetchWithAuth(`${CONFIG.API_BASE}/messages?sessionKey=${sessionKey}`);
        return res.json();
    },

    async sendChatMessage(sessionKey, text) {
        return Utils.fetchWithAuth(`${CONFIG.API_BASE}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionKey, text }),
        });
    },
};

// === UI Rendering ===
const UI = {
    updateLastSync() {
        const el = document.getElementById('last-update');
        if (el) {
            el.textContent = `Last synced: ${Utils.formatTime(new Date())}`;
        }
    },

    renderUsage(data) {
        const costEl = document.getElementById('total-cost');
        const tokensEl = document.getElementById('total-tokens');

        if (costEl) costEl.textContent = Utils.formatCost(data.totalCost);
        if (tokensEl) tokensEl.textContent = Utils.formatTokens(data.totalTokens);
    },

    renderIdentity(identity) {
        const personaEl = document.getElementById('bot-persona');
        const principlesEl = document.getElementById('bot-principles');

        if (personaEl) personaEl.textContent = identity.persona;

        if (principlesEl) {
            principlesEl.innerHTML = identity.principles
                .map(
                    p => `
                    <div class="principle-card">
                        <h4>${p.name.toUpperCase()}</h4>
                        <p>${p.rule}</p>
                    </div>
                `
                )
                .join('');
        }
    },

    renderProviders(providers) {
        const listEl = document.getElementById('providers-list');
        const countEl = document.getElementById('provider-count');

        if (!listEl) return;

        listEl.innerHTML = providers
            .map(
                (p, i) => `
            <div class="provider-item">
                <div class="provider-icon">${p.type[0].toUpperCase()}</div>
                <div class="provider-info">
                    <div class="provider-info__name">${p.id}</div>
                    <div class="provider-info__model">${p.model}</div>
                </div>
                <div class="provider-key">
                    <input
                        type="password"
                        class="form-control"
                        value="${p.apiKey || p.googleApiKey || ''}"
                        data-provider-index="${i}"
                        data-provider-type="${p.type}"
                        placeholder="API Key">
                </div>
            </div>
        `
            )
            .join('');

        if (countEl) countEl.textContent = providers.length;

        // Add event listeners for provider keys
        listEl.querySelectorAll('input[data-provider-index]').forEach(input => {
            input.addEventListener('change', UI.handleProviderKeyChange);
        });
    },

    handleProviderKeyChange(event) {
        const index = parseInt(event.target.dataset.providerIndex);
        const type = event.target.dataset.providerType;
        const value = event.target.value;

        const provider = State.config.providers[index];
        if (type === 'gemini') {
            provider.googleApiKey = value;
        } else {
            provider.apiKey = value;
        }
    },

    renderConfig(config) {
        // Core capabilities
        UI.setValue('telegram-token', config.channels.telegram?.token || '');
        UI.setValue('authorized-users', (config.channels.telegram?.authorizedUsers || []).join(', '));
        UI.setValue('memory-enabled', String(config.memory.enabled));
        UI.setValue('tools-enabled', String(config.tools.enabled));
        UI.setValue('obsidian-path', config.obsidian.vaultPath || '');

        // Advanced features
        UI.setValue('browser-enabled', String(config.browser?.enabled || false));
        UI.setValue('filesystem-enabled', String(config.filesystem?.enabled || false));
        UI.setValue('selfmod-enabled', String(config.selfModification?.enabled || false));

        // Permission system
        const perms = config.permissions || { maxLevel: 2 };
        UI.setValue('permission-level', String(perms.maxLevel || 2));
        UI.setValue('allowed-dirs', (perms.allowedDirectories || []).join(', '));
        UI.setValue('denied-dirs', (perms.deniedDirectories || []).join(', '));
        UI.setValue('allowed-domains', (perms.allowedDomains || []).join(', '));
        UI.setValue('approval-level', String(perms.requireApprovalLevel || ''));

        // Update permission badge
        UI.updatePermissionBadge(perms.maxLevel || 2);
    },

    setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    },

    getValue(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    },

    updatePermissionBadge(level) {
        const badge = document.getElementById('permission-badge');
        if (!badge) return;

        const info = PERMISSION_LEVELS[level] || PERMISSION_LEVELS[2];
        badge.textContent = info.label;
        badge.className = `badge badge--${info.color}`;
    },
};

// === Config Management ===
const ConfigManager = {
    async save() {
        if (State.isSaving) return;

        const saveBtn = document.getElementById('save-btn');
        State.isSaving = true;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            const config = ConfigManager.buildConfig();

            await API.saveConfig(config);

            State.config = config;
            Utils.showToast('Configuration updated successfully');
            UI.updateLastSync();
        } catch (err) {
            Utils.showToast(err.message, true);
            console.error('Save error:', err);
        } finally {
            State.isSaving = false;
            saveBtn.disabled = false;
            saveBtn.textContent = 'Apply Changes';
        }
    },

    buildConfig() {
        const config = JSON.parse(JSON.stringify(State.config));

        // Core capabilities
        config.channels.telegram.token = UI.getValue('telegram-token');
        config.channels.telegram.authorizedUsers = Utils.parseIntCSV(UI.getValue('authorized-users'));
        config.memory.enabled = UI.getValue('memory-enabled') === 'true';
        config.tools.enabled = UI.getValue('tools-enabled') === 'true';
        config.obsidian.vaultPath = UI.getValue('obsidian-path');

        // Advanced features
        config.browser = config.browser || {};
        config.browser.enabled = UI.getValue('browser-enabled') === 'true';

        config.filesystem = config.filesystem || {};
        config.filesystem.enabled = UI.getValue('filesystem-enabled') === 'true';

        config.selfModification = config.selfModification || {};
        config.selfModification.enabled = UI.getValue('selfmod-enabled') === 'true';

        // Permission system
        config.permissions = config.permissions || {};
        config.permissions.maxLevel = parseInt(UI.getValue('permission-level'));
        config.permissions.allowedDirectories = Utils.parseCSV(UI.getValue('allowed-dirs'));
        config.permissions.deniedDirectories = Utils.parseCSV(UI.getValue('denied-dirs'));
        config.permissions.allowedDomains = Utils.parseCSV(UI.getValue('allowed-domains'));

        const approvalLevel = UI.getValue('approval-level');
        if (approvalLevel) {
            config.permissions.requireApprovalLevel = parseInt(approvalLevel);
        } else {
            delete config.permissions.requireApprovalLevel;
        }

        return config;
    },
};

// === Chat Management ===
const Chat = {
    isOpen: false,
    historyLoaded: false,

    toggle() {
        const sidebar = document.getElementById('chat-sidebar');
        const input = document.getElementById('chat-input');

        Chat.isOpen = !Chat.isOpen;
        sidebar.classList.toggle('chat-sidebar--open', Chat.isOpen);

        if (Chat.isOpen) {
            input?.focus();
            if (!Chat.historyLoaded) {
                Chat.loadHistory();
            }
        }
    },

    async loadHistory() {
        try {
            const history = await API.getChatHistory(CONFIG.CHAT_SESSION_KEY);
            const messagesEl = document.getElementById('chat-messages');

            if (messagesEl) {
                messagesEl.innerHTML = '';
                history.forEach(msg => {
                    Chat.addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot');
                });
            }

            Chat.historyLoaded = true;
        } catch (err) {
            console.error('Failed to load chat history:', err);
        }
    },

    async send() {
        const input = document.getElementById('chat-input');
        const text = input?.value.trim();

        if (!text) return;

        Chat.addMessage(text, 'user');
        input.value = '';

        const botMsg = Chat.addMessage('', 'bot');
        const sendBtn = document.getElementById('send-chat-btn');
        sendBtn.disabled = true;

        try {
            const response = await API.sendChatMessage(CONFIG.CHAT_SESSION_KEY, text);

            if (!response.ok) {
                const err = await response.json();
                botMsg.textContent = `Error: ${err.error || response.statusText}`;
                return;
            }

            // Handle streaming
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                fullResponse += chunk;

                // Render markdown
                if (typeof marked !== 'undefined') {
                    botMsg.innerHTML = marked.parse(fullResponse);
                } else {
                    botMsg.textContent = fullResponse;
                }

                Chat.scrollToBottom();
            }
        } catch (err) {
            botMsg.textContent = `Connection Error: ${err.message}`;
        } finally {
            sendBtn.disabled = false;
        }
    },

    addMessage(text, role) {
        const messagesEl = document.getElementById('chat-messages');
        if (!messagesEl) return null;

        const div = document.createElement('div');
        div.className = `message message--${role}`;

        if (role === 'bot' && typeof marked !== 'undefined') {
            div.innerHTML = marked.parse(text || '');
        } else {
            div.textContent = text;
        }

        messagesEl.appendChild(div);
        Chat.scrollToBottom();

        return div;
    },

    scrollToBottom() {
        const messagesEl = document.getElementById('chat-messages');
        if (messagesEl) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
    },
};

// === Main Application ===
const App = {
    async init() {
        try {
            // Load config
            State.config = await API.getConfig();

            // Render UI
            UI.renderProviders(State.config.providers);
            UI.renderConfig(State.config);

            // Load identity
            const identity = await API.getIdentity();
            UI.renderIdentity(identity);

            // Load usage stats
            await App.updateUsage();

            // Hide auth overlay
            Auth.hideAuthOverlay();
            UI.updateLastSync();

            // Start periodic updates
            App.startPeriodicUpdates();
        } catch (err) {
            if (err.message !== 'Unauthorized') {
                Utils.showToast('Failed to load dashboard', true);
                console.error('Init error:', err);
            }
        }
    },

    async updateUsage() {
        try {
            const usage = await API.getUsage();
            UI.renderUsage(usage);
        } catch (err) {
            console.error('Usage fetch error:', err);
        }
    },

    startPeriodicUpdates() {
        if (State.updateInterval) {
            clearInterval(State.updateInterval);
        }

        State.updateInterval = setInterval(() => {
            App.updateUsage();
        }, CONFIG.UPDATE_INTERVAL);
    },

    setupEventListeners() {
        // Save button
        const saveBtn = document.getElementById('save-btn');
        saveBtn?.addEventListener('click', ConfigManager.save);

        // Permission level change
        const permLevel = document.getElementById('permission-level');
        permLevel?.addEventListener('change', e => {
            UI.updatePermissionBadge(parseInt(e.target.value));
        });

        // Chat
        const chatToggleBtn = document.querySelector('.chat-toggle-btn');
        chatToggleBtn?.addEventListener('click', Chat.toggle);

        const chatCloseBtn = document.querySelector('.chat-header .btn--outline');
        chatCloseBtn?.addEventListener('click', Chat.toggle);

        const sendBtn = document.getElementById('send-chat-btn');
        sendBtn?.addEventListener('click', Chat.send);

        const chatInput = document.getElementById('chat-input');
        chatInput?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                Chat.send();
            }
        });

        // Auth
        const authBtn = document.querySelector('.auth-card .btn--primary');
        authBtn?.addEventListener('click', Auth.authenticate);

        const adminPass = document.getElementById('admin-pass');
        adminPass?.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                Auth.authenticate();
            }
        });

        // Logout
        const logoutBtns = document.querySelectorAll('[data-action="logout"]');
        logoutBtns.forEach(btn => {
            btn.addEventListener('click', Auth.logout);
        });
    },
};

// === Initialize on DOM Ready ===
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        App.setupEventListeners();
        App.init();
    });
} else {
    App.setupEventListeners();
    App.init();
}

// === Export for inline use (if needed) ===
window.TombotAdmin = {
    auth: Auth,
    chat: Chat,
    config: ConfigManager,
    utils: Utils,
};
