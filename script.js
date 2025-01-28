document.addEventListener("DOMContentLoaded", () => {
  const app_id = 66842
  const oauth_url = "https://oauth.deriv.com/oauth2/authorize?app_id=" + app_id
  let websocket = null
  const loggedTrades = new Set()
  let clientToken = localStorage.getItem("clientToken") || null
  let masterToken = localStorage.getItem("masterToken") || null

  // DOM Elements
  const masterTokenInput = document.getElementById("masterToken")
  const logs = document.getElementById("logs")
  const trades = document.getElementById("trades")
  const addMasterButton = document.getElementById("addMaster")
  const startCopying = document.getElementById("startCopying")
  const stopCopying = document.getElementById("stopCopying")
  const masterList = document.getElementById("masterList")
  const clientList = document.getElementById("clientList")
  const masterOAuthLogin = document.getElementById("masterOAuthLogin")
  const clientOAuthLogin = document.getElementById("clientOAuthLogin")

  function logMessage(message, type = "info") {
    const p = document.createElement("p")
    p.textContent = `${new Date().toLocaleTimeString()} - ${message}`
    p.className = type
    logs.appendChild(p)
    logs.scrollTop = logs.scrollHeight
  }

  function logTrade(tradeMessage, type = "info") {
    const p = document.createElement("p")
    p.textContent = `${new Date().toLocaleTimeString()} - ${tradeMessage}`
    p.className = type
    trades.appendChild(p)
    trades.scrollTop = trades.scrollHeight
  }

  function saveMasterToken(token) {
    localStorage.setItem("masterToken", token)
  }

  function saveClientToken(token) {
    localStorage.setItem("clientToken", token)
  }

  function renderMasterToken() {
    masterList.innerHTML = ""
    if (masterToken) {
      const li = document.createElement("li")
      li.innerHTML = `
        <span>${masterToken}</span>
        <button class="btn-delete">Delete</button>
      `
      masterList.appendChild(li)
      li.querySelector(".btn-delete").addEventListener("click", () => {
        masterToken = null
        saveMasterToken(null)
        renderMasterToken()
        logMessage("Master token removed.", "info")
      })
    }
  }

  function renderClientToken() {
    clientList.innerHTML = ""
    if (clientToken) {
      const li = document.createElement("li")
      li.innerHTML = `
        <span>${clientToken}</span>
        <button class="btn-delete">Delete</button>
      `
      clientList.appendChild(li)
      li.querySelector(".btn-delete").addEventListener("click", () => {
        clientToken = null
        saveClientToken(null)
        renderClientToken()
        logMessage("Client token removed.", "info")
      })
    }
  }

  function handleOAuthRedirect() {
    const urlParams = new URLSearchParams(window.location.search)
    const acct1 = urlParams.get("acct1")
    const token1 = urlParams.get("token1")

    if (acct1 && token1) {
      logMessage(`OAuth login successful for account: ${acct1}`, "success")
      if (!clientToken) {
        clientToken = token1
        saveClientToken(token1)
        renderClientToken()
      }
      // Clear the URL parameters
      window.history.replaceState({}, document.title, "/")
    }
  }

  function enableAllowCopiers(callback) {
    websocket.send(
      JSON.stringify({
        set_settings: 1,
        allow_copiers: 1,
      }),
    )
    logMessage("Sent request to enable allow copiers...", "info")
    if (callback) callback()
  }

  function authenticateClient(callback) {
    if (!clientToken) {
      logMessage("No client token provided.", "error")
      return
    }

    websocket.send(JSON.stringify({ authorize: clientToken }))

    websocket.onmessage = (event) => {
      const response = JSON.parse(event.data)

      if (response.authorize) {
        logMessage(
          `Client Authenticated: ${response.authorize.loginid}, Balance: ${response.authorize.balance} ${response.authorize.currency}, Scopes: ${response.authorize.scopes.join(", ")}`,
          "success",
        )
        if (callback) callback()
      }

      if (response.error) {
        logMessage(`Client Error: ${response.error.message}`, "error")
      }
    }
  }

  function listenForMasterTrades() {
    websocket.send(
      JSON.stringify({
        copy_start: 1,
        subscribe: 1,
      }),
    )
    logMessage("Listening for master trades...", "info")

    websocket.onmessage = (event) => {
      const response = JSON.parse(event.data)

      if (response.msg_type === "copy_start") {
        const trade = response.copy_start

        if (!loggedTrades.has(trade.transaction_id)) {
          loggedTrades.add(trade.transaction_id)

          const tradeMessage = `New trade: ID ${trade.transaction_id}, Type: ${trade.contract_type}, Symbol: ${trade.shortcode}`
          logTrade(tradeMessage, "info")

          logMessage(`Trade ID ${trade.transaction_id} copied to client account.`, "info")
        }
      }

      if (response.error) {
        logMessage(`Error: ${response.error.message}`, "error")
      }
    }
  }

  startCopying.addEventListener("click", () => {
    if (!masterToken) {
      logMessage("No master token provided.", "error")
      return
    }

    if (websocket) {
      logMessage("Already connected.", "info")
      return
    }

    websocket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`)

    websocket.onopen = () => {
      logMessage("WebSocket connection established.", "info")
      websocket.send(JSON.stringify({ authorize: masterToken }))
    }

    websocket.onmessage = (event) => {
      const response = JSON.parse(event.data)

      if (response.authorize) {
        logMessage(
          `Master Authenticated: ${response.authorize.loginid}, Balance: ${response.authorize.balance} ${response.authorize.currency}, Scopes: ${response.authorize.scopes.join(", ")}`,
          "success",
        )
        enableAllowCopiers(() => {
          authenticateClient(() => {
            listenForMasterTrades()
          })
        })
      }

      if (response.error) {
        logMessage(`Error: ${response.error.message}`, "error")
      }
    }

    websocket.onerror = (error) => {
      logMessage(`WebSocket error: ${error.message}`, "error")
    }

    websocket.onclose = () => {
      logMessage("WebSocket closed.", "info")
    }
  })

  stopCopying.addEventListener("click", () => {
    if (websocket) {
      websocket.send(JSON.stringify({ copy_stop: 1 }))
      logMessage("Stopped copying trades.", "success")
      websocket.close()
      websocket = null
    } else {
      logMessage("No active WebSocket connection.", "info")
    }
  })

  addMasterButton.addEventListener("click", () => {
    const token = masterTokenInput.value.trim()
    if (token) {
      masterToken = token
      saveMasterToken(token)
      renderMasterToken()
      logMessage(`Master token added: ${token}`, "success")
      masterTokenInput.value = ""
    } else {
      logMessage("Please enter a valid master token.", "error")
    }
  })

  masterOAuthLogin.addEventListener("click", () => {
    window.location.href = oauth_url
  })

  clientOAuthLogin.addEventListener("click", () => {
    window.location.href = oauth_url
  })

  // Check for OAuth redirect on page load
  handleOAuthRedirect()

  // Render tokens on page load
  renderMasterToken()
  renderClientToken()
})

