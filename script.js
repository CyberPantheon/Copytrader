const APP_ID = 68004; // Your Deriv application ID
let currentAccounts = [];
let activeCopies = new Map();
let masterAccount = null;
let ws;
let isConnected = false;

// WebSocket Manager with proper connection handling
const derivWS = {
    conn: null,
    reqId: 1,
    currentToken: null,
    accountListRequested: false, // Track if account list was requested
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,

    connect: function (token) {
        this.currentToken = token;
        if (this.conn) {
            this.conn.close();
        }

        this.conn = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

        this.conn.onopen = () => {
            log('🔌 WebSocket connected', 'success');
            this.reconnectAttempts = 0;
            isConnected = true;
            this.authorize(token);
            if (!this.accountListRequested) {
                this.send({ account_list: 1 });
                this.accountListRequested = true;
            }
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

    authorize: function (token) {
        this.currentToken = token;
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
        if (response.pong) {
            log('🏓 Received pong', 'info');
            return;
        }

        log(`📥 Received: ${JSON.stringify(response, null, 2)}`, 'info');

        if (response.error) {
            this.handleError(response.error);
            return;
        }

        if (response.authorize) {
            handleAuthorization(response);
            if (!this.accountListRequested) {
                this.send({ account_list: 1 });
                this.accountListRequested = true;
            }
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
            window.location.href = 'index.html';
        }
    }
};

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    const savedAccounts = JSON.parse(localStorage.getItem('masterAccounts'));

    if (savedAccounts && savedAccounts.length > 0) {
        currentAccounts = savedAccounts;
        setupAccountsDropdown();
        derivWS.connect(savedAccounts[0].token);
    } else {
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
        allowCopiers: currentAccounts.find(a => a.id === acc.loginid)?.allowCopiers || false,
        name: `${acc.account_type} (${acc.landing_company_name})`
    }));

    currentAccounts = accounts;
    localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
    updateAccountsUI();
    log('📋 Account list updated from server', 'success');
}

// Update account dropdown UI
function updateAccountsUI() {
    const dropdown = document.getElementById('dropdownContent');
    const accountItems = Array.from(dropdown.getElementsByClassName('account-item'));

    currentAccounts.forEach(acc => {
        const existingItem = accountItems.find(item => item.dataset.accountId === acc.id);

        if (existingItem) {
            const button = existingItem.querySelector('button');
            button.className = acc.allowCopiers ? 'disable-btn' : 'enable-btn';
            button.textContent = acc.allowCopiers ? '🚫 Disallow' : '✅ Allow Copy';
        } else {
            const newItem = document.createElement('div');
            newItem.className = 'account-item';
            newItem.dataset.accountId = acc.id;
            newItem.innerHTML = `
                <div>
                    <strong>${acc.name}</strong><br>
                    <small>${acc.id} • ${acc.currency.toUpperCase()}</small><br>
                    ${acc.balance}
                </div>
                <button class="${acc.allowCopiers ? 'disable-btn' : 'enable-btn'}" 
                        onclick="toggleCopyPermissions('${acc.id}', this)">
                    ${acc.allowCopiers ? '🚫 Disallow' : '✅ Allow Copy'}
                </button>
            `;
            dropdown.appendChild(newItem);
        }
    });
}

// Toggle copy permissions with token switching
const pendingRequests = new Map();
async function toggleCopyPermissions(accountId, button) {
    if (pendingRequests.has(accountId)) {
        log('⚠️ Request already in progress for this account', 'warning');
        return;
    }

    const account = currentAccounts.find(acc => acc.id === accountId);
    if (!account) return;

    button.disabled = true;
    button.textContent = '⏳ Updating...';
    pendingRequests.set(accountId, true);

    try {
        if (derivWS.currentToken !== account.token) {
            await new Promise((resolve) => {
                derivWS.conn.addEventListener('message', function authHandler(e) {
                    const response = JSON.parse(e.data);
                    if (response.authorize && response.authorize.loginid === accountId) {
                        derivWS.conn.removeEventListener('message', authHandler);
                        resolve();
                    }
                });
                derivWS.authorize(account.token);
            });
        }

        const success = derivWS.send({
            set_settings: 1,
            allow_copiers: !account.allowCopiers ? 1 : 0,
            loginid: accountId
        });

        if (!success) {
            throw new Error('Failed to send request');
        }
    } catch (error) {
        log(`❌ Update failed: ${error.message}`, 'error');
        button.className = account.allowCopiers ? 'disable-btn' : 'enable-btn';
        button.textContent = account.allowCopiers ? '🚫 Disallow' : '✅ Allow Copy';
    } finally {
        setTimeout(() => {
            button.disabled = false;
            pendingRequests.delete(accountId);
        }, 1000);
    }
}

// Handle settings response
function handleSettingsResponse(response) {
    const account = currentAccounts.find(acc => acc.id === response.echo_req.loginid);
    if (account) {
        const newState = response.echo_req.allow_copiers === 1;
        account.allowCopiers = newState;
        localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));

        const button = document.querySelector(`[data-account-id="${account.id}"] button`);
        if (button) {
            button.className = newState ? 'disable-btn' : 'enable-btn';
            button.textContent = newState ? '🚫 Disallow' : '✅ Allow Copy';
        }

        log(`⚙️ Settings updated for ${account.id}: Copiers ${newState ? 'allowed' : 'disallowed'}`,
            newState ? 'success' : 'error');

        if (account.id !== currentAccounts[0].id) {
            derivWS.authorize(currentAccounts[0].token);
        }
    }
}

// Handle logout
function logout() {
    currentAccounts.forEach(acc => {
        if (acc.allowCopiers) {
            derivWS.send({
                set_settings: 1,
                allow_copiers: 0,
                loginid: acc.id
            });
        }
    });

    localStorage.removeItem('masterAccounts');
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
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

    if (logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.firstChild);
    }

    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Authorization handler
function handleAuthorization(response) {
    const account = currentAccounts.find(acc => acc.token === response.echo_req.authorize);
    if (account) {
        account.balance = response.authorize.balance;
        localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
        updateAccountsUI();
        log(`🔓 Authorized: ${account.id} - Balance: ${account.balance} ${account.currency}`, 'success');
    }
}
