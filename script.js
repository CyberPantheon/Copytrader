const APP_ID = 68004;
let currentAccounts = [];
let selectedAccount = null;
let isConnected = false;
let ws;

// Enhanced WebSocket Manager
const derivWS = {
    conn: null,
    reqId: 1,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,

    connect: function(token) {
        if(this.conn) this.conn.close();
        
        this.conn = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

        this.conn.onopen = () => {
            log('🔌 WebSocket connected', 'success');
            this.reconnectAttempts = 0;
            isConnected = true;
            this.sendPing();
            this.authorize(token);
        };

        this.conn.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
        this.conn.onerror = (e) => log(`⚠️ WebSocket error: ${e.message || 'Unknown'}`, 'error');
        this.conn.onclose = (e) => this.handleClose(e);
    },

    handleClose: function(e) {
        isConnected = false;
        const messages = {
            1006: '🔌 Connection lost - Check network',
            1000: '🔌 Connection closed normally'
        };
        log(messages[e.code] || '🔌 Connection closed unexpectedly', 'warning');
        
        if(!e.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => this.reconnect(), Math.pow(2, this.reconnectAttempts) * 1000);
            this.reconnectAttempts++;
        }
    },

    reconnect: function() {
        const token = currentAccounts[0]?.token;
        if(token) this.connect(token);
    },

    sendPing: function() {
        if(isConnected) {
            this.send({ ping: 1 });
            setTimeout(() => this.sendPing(), 30000);
        }
    },

    authorize: function(token) {
        this.send({ authorize: token });
    },

    send: function(data) {
        if(this.conn?.readyState === WebSocket.OPEN) {
            data.req_id = this.reqId++;
            this.conn.send(JSON.stringify(data));
            log(`📤 ${data.msg_type || 'Request'} sent`, 'info', data);
            return true;
        }
        log('⚠️ WebSocket not ready', 'warning');
        return false;
    },

    handleMessage: function(response) {
        if(response.pong) return log('🏓 Pong received', 'info');
        if(response.error) return this.handleError(response.error);
        
        log(`📥 ${response.msg_type || 'Response'} received`, 'info', response);

        switch(response.msg_type) {
            case 'authorize': 
                handleAuthorization(response);
                derivWS.send({ account_list: 1 });
                break;
            case 'account_list':
                handleAccountList(response);
                break;
            case 'set_settings':
                handleSettingsResponse(response);
                break;
            case 'copytrading_list':
                handleCopierList(response);
                break;
        }
    },

    handleError: function(error) {
        const errorMap = {
            'InvalidToken': '🔑 Session expired - Please relogin',
            'RateLimit': '🚦 Too many requests - Wait 1 minute',
            'InvalidAppID': '❌ Invalid Application ID'
        };
        log(errorMap[error.code] || `⚠️ Error: ${error.message}`, 'error');
        
        if(error.code === 'InvalidToken') {
            localStorage.removeItem('masterAccounts');
            window.location.href = 'index.html';
        }
    }
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const savedAccounts = JSON.parse(localStorage.getItem('masterAccounts'));
    
    if(savedAccounts?.length) {
        currentAccounts = savedAccounts;
        setupAccountsDropdown();
        derivWS.connect(savedAccounts[0].token);
    } else {
        const tokens = parseTokensFromURL(params);
        if(!tokens.length) return log('⚠️ No accounts found in URL', 'error');
        
        currentAccounts = tokens;
        localStorage.setItem('masterAccounts', JSON.stringify(tokens));
        setupAccountsDropdown();
        derivWS.connect(tokens[0].token);
    }
});

// Account Handling
function parseTokensFromURL(params) {
    const accounts = [];
    let i = 1;
    
    while(params.get(`acct${i}`)) {
        accounts.push({
            loginid: params.get(`acct${i}`),
            token: params.get(`token${i}`),
            currency: params.get(`cur${i}`),
            balance: 'Loading...',
            allowCopiers: false
        });
        i++;
    }
    
    return accounts;
}

function handleAccountList(response) {
    const fullAccounts = response.account_list
        .filter(acc => !acc.is_disabled)
        .map(acc => ({
            loginid: acc.loginid,
            currency: acc.currency,
            type: acc.account_type,
            is_virtual: acc.is_virtual,
            created_at: acc.created_at,
            balance: 'Loading...',
            allowCopiers: false
        }));

    // Merge with OAuth tokens
    currentAccounts = fullAccounts.map(fullAcc => 
        currentAccounts.find(oaAcc => oaAcc.loginid === fullAcc.loginid) || fullAcc
    );
    
    localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
    setupAccountsDropdown();
    log('📋 Account list updated', 'success');
}

function setupAccountsDropdown() {
    const dropdown = document.getElementById('dropdownContent');
    dropdown.innerHTML = currentAccounts.map(acc => `
        <div class="account-item">
            <div>
                <strong>${acc.loginid}</strong>
                <div class="account-details">
                    ${acc.currency} • ${acc.is_virtual ? 'Virtual' : 'Real'} • 
                    ${new Date(acc.created_at * 1000).toLocaleDateString()}
                </div>
            </div>
            <button class="${acc.allowCopiers ? 'disable-btn' : 'enable-btn'}" 
                    onclick="toggleCopyPermissions('${acc.loginid}', this)">
                ${acc.allowCopiers ? '🚫 Disable' : '✅ Enable'} Copying
            </button>
        </div>
    `).join('');
}

// Enhanced Logging System
function log(message, type = 'info', data = null) {
    const logContainer = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    const dataPreview = data ? `<div class="log-data">${formatLogData(data)}</div>` : '';
    
    entry.innerHTML = `
        <div class="log-header">
            <span class="log-timestamp">${timestamp}</span>
            <span class="log-message">${message}</span>
        </div>
        ${dataPreview}
    `;
    
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function formatLogData(data) {
    const MAX_LENGTH = 150;
    const strData = JSON.stringify(data, null, 2);
    const truncated = strData.length > MAX_LENGTH ? 
        strData.substring(0, MAX_LENGTH) + '...' : strData;
        
    return `<pre>${truncated}</pre>`;
}

// Add this CSS
const enhancedLogStyles = `
.log-entry {
    padding: 8px 12px;
    margin: 4px 0;
    border-radius: 4px;
    background: rgba(255,255,255,0.05);
}

.log-header {
    display: flex;
    gap: 10px;
    align-items: center;
}

.log-timestamp {
    color: #888;
    font-size: 0.8em;
}

.log-data {
    margin-top: 4px;
    padding: 8px;
    background: rgba(0,0,0,0.2);
    border-radius: 4px;
    font-size: 0.9em;
    max-height: 200px;
    overflow: auto;
}

.log-data pre {
    margin: 0;
    white-space: pre-wrap;
}

.log-info { border-left: 3px solid #3498db; }
.log-success { border-left: 3px solid #00ffa5; }
.log-error { border-left: 3px solid #ff4444; }
.log-warning { border-left: 3px solid #ffa500; }
`;

document.styleSheets[0].insertRule(enhancedLogStyles);
