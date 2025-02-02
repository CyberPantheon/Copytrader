const APP_ID = 68004; // Your Deriv application ID
let currentAccounts = [];
let selectedAccount = null;
let isConnected = false;
let ws;

// WebSocket Manager with proper connection handling
const derivWS = {
    conn: null,
    reqId: 1,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,

    connect: function (token) {
        // Close existing connection if any
        if (this.conn) {
            this.conn.close();
        }

        // Create new WebSocket with proper URL format
        this.conn = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

        // Connection handlers
        this.conn.onopen = () => {
            log('🔌 WebSocket connection established', 'success');
            this.reconnectAttempts = 0;
            isConnected = true;
            this.sendPing();
            this.authorize(token);
        };

        this.conn.onmessage = (e) => {
            try {
                const response = JSON.parse(e.data);
                this.handleMessage(response);
            } catch (error) {
                log(`❌ Message parse error: ${error.message}`, 'error');
            }
        };

        this.conn.onerror = (e) => {
            log(`⚠️ WebSocket error: ${e.message || 'Unknown error'}`, 'error');
        };

        this.conn.onclose = (e) => {
            isConnected = false;
            if (e.wasClean) {
                log(`🔌 Connection closed cleanly (code: ${e.code}, reason: ${e.reason})`, 'warning');
            } else {
                log('🔌 Connection died unexpectedly. Reconnecting...', 'error');
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    setTimeout(() => {
                        this.reconnectAttempts++;
                        this.connect(token);
                    }, Math.min(5000, this.reconnectAttempts * 2000));
                }
            }
        };
    },

    sendPing: function () {
        if (isConnected) {
            this.send({ ping: 1 });
            setTimeout(() => this.sendPing(), 30000); // Send ping every 30 seconds
        }
    },

    authorize: function (token) {
        this.send({
            authorize: token
        });
    },

    send: function (data) {
        if (this.conn && this.conn.readyState === WebSocket.OPEN) {
            data.req_id = this.reqId++;
            this.conn.send(JSON.stringify(data));
            log(`📤 Sent: ${JSON.stringify(data, null, 2)}`, 'info');
            return true;
        } else {
            log('⚠️ WebSocket not ready. Queuing message...', 'warning');
            return false;
        }
    },

    handleMessage: function (response) {
        // Handle ping response
        if (response.pong) {
            log('🏓 Received pong', 'info');
            return;
        }

        // Improved logging with formatted JSON
        log(`📥 Received: ${JSON.stringify(response, null, 2)}`, 'info');

        if (response.error) {
            this.handleError(response.error);
            return;
        }

        if (response.authorize) {
            handleAuthorization(response);
            // Request account list after successful authorization
            this.send({ account_list: 1 });
        } else if (response.account_list) {
            handleAccountList(response);
        } else if (response.set_settings) {
            handleSettingsResponse(response);
        } else if (response.copytrading_list) {
            handleCopierList(response);
        }
    },

    handleError: function (error) {
        const errorMessages = {
            1006: 'Connection failed - check network connection',
            'InvalidAppID': 'Invalid application ID',
            'RateLimit': 'Too many requests - wait 60 seconds',
            'InvalidToken': 'Session expired - please relogin'
        };

        const message = errorMessages[error.code] || error.message;
        log(`❌ API Error: ${message} (code: ${error.code})`, 'error');

        if (error.code === 'InvalidToken') {
            localStorage.removeItem('masterAccounts');
            //window.location.href = 'index.html';
        }
    }
};

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    // Try to load from localStorage first
    const savedAccounts = JSON.parse(localStorage.getItem('masterAccounts'));

    if (savedAccounts && savedAccounts.length > 0) {
        currentAccounts = savedAccounts;
        setupAccountsDropdown();
        derivWS.connect(savedAccounts[0].token);
    } else {
        // Process OAuth params from URL
        const params = new URLSearchParams(window.location.search);
        const tokens = parseTokensFromURL(params);

        if (tokens.length === 0) {
            log('⚠️ No valid accounts found in URL', 'error');
            return;
        }

        currentAccounts = tokens;
        localStorage.setItem('masterAccounts', JSON.stringify(tokens));
        setupAccountsDropdown();
        derivWS.connect(tokens[0].token);
    }
});

// Parse OAuth tokens from URL parameters
function parseTokensFromURL(params) {
    const accounts = [];
    let i = 1;

    while (params.get(`acct${i}`)) {
        accounts.push({
            id: params.get(`acct${i}`),
            token: params.get(`token${i}`),
            currency: params.get(`cur${i}`),
            balance: 'Loading...',
            allowCopiers: false
        });
        i++;
    }

    return accounts;
}

// Handle account list response
function handleAccountList(response) {
    const accounts = response.account_list.map(acc => ({
        id: acc.loginid,
        token: currentAccounts.find(a => a.id === acc.loginid)?.token || '',
        currency: acc.currency,
        balance: 'Loading...',
        allowCopiers: false,
        name: `${acc.account_type} (${acc.landing_company_name})`
    }));

    // Merge with existing OAuth tokens
    currentAccounts = accounts.map(newAcc => {
        const existing = currentAccounts.find(a => a.id === newAcc.id);
        return existing ? { ...newAcc, token: existing.token } : newAcc;
    });

    localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
    setupAccountsDropdown();
    log('📋 Account list updated from server', 'success');
}

// Update account dropdown UI
function setupAccountsDropdown() {
    const dropdown = document.getElementById('dropdownContent');
    dropdown.innerHTML = currentAccounts.map(acc => `
        <div class="account-item">
            <div>
                <strong>${acc.name}</strong><br>
                <small>${acc.id} • ${acc.currency.toUpperCase()}</small><br>
                ${acc.balance}
            </div>
            <button class="${acc.allowCopiers ? 'disable-btn' : 'enable-btn'}" 
                    onclick="toggleCopyPermissions('${acc.id}', this)">
                ${acc.allowCopiers ? '🚫 Disallow' : '✅ Allow Copy'}
            </button>
        </div>
    `).join('');

    // Show dropdown after update
    dropdown.style.display = 'block';
}

// Toggle copy permissions
function toggleCopyPermissions(accountId, button) {
    const account = currentAccounts.find(acc => acc.id === accountId);
    if (!account) return;

    const newState = !account.allowCopiers;

    if (derivWS.send({
        set_settings: 1,
        allow_copiers: newState ? 1 : 0,
        loginid: accountId
    })) {
        button.classList.toggle('enable-btn');
        button.classList.toggle('disable-btn');
        button.textContent = newState ? '🚫 Disallow' : '✅ Allow Copy';
    }
}

// Refresh copiers list
function refreshClients() {
    derivWS.send({ copytrading_list: 1 });
}

// Handle logout
function logout() {
    // Disable all copiers
    currentAccounts.forEach(acc => {
        if (acc.allowCopiers) {
            derivWS.send({
                set_settings: 1,
                allow_copiers: 0,
                loginid: acc.id
            });
        }
    });

    // Clear local data
    localStorage.removeItem('masterAccounts');

    // Redirect after cleanup
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
}

// Response handlers
function handleAuthorization(response) {
    const account = currentAccounts.find(acc => acc.token === response.echo_req.authorize);
    if (account) {
        account.balance = response.authorize.balance;
        account.allowCopiers = response.authorize.scopes.includes('admin');
        localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
        setupAccountsDropdown();
        log(`🔓 Authorized: ${account.id} - Balance: ${account.balance} ${account.currency}`, 'success');
    }
}

function handleSettingsResponse(response) {
    const account = currentAccounts.find(acc => acc.id === response.echo_req.loginid);
    if (account) {
        account.allowCopiers = response.echo_req.allow_copiers === 1;
        localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
        log(`⚙️ Settings updated for ${account.id}: Copiers ${account.allowCopiers ? 'allowed' : 'disallowed'}`,
            account.allowCopiers ? 'success' : 'error');
        setupAccountsDropdown();
    }
}

function handleCopierList(response) {
    const clientList = document.getElementById('clientList');
    if (response.copytrading_list?.copiers?.length > 0) {
        clientList.innerHTML = response.copytrading_list.copiers.map(copier => `
            <div class="client-item">
                <div>${copier.name || 'Anonymous'} (${copier.loginid})</div>
                <div>${copier.balance} ${copier.currency}</div>
            </div>
        `).join('');
    } else {
        clientList.innerHTML = '<div class="client-item">No active copiers found</div>';
    }
}

// Logging system
function log(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const icons = {
        info: 'ℹ️',
        success: '✅',
        error: '❌',
        warning: '⚠️'
    };

    const logEntry = document.createElement('div');
    logEntry.className = `log-${type}`;
    logEntry.innerHTML = `
        <div class="log-header">
            ${icons[type] || '📌'} 
            <span>[${new Date().toLocaleTimeString()}]</span>
        </div>
        <div class="log-content">${message}</div>
    `;

    // Cleanup old logs
    if (logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.firstChild);
    }

    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}
