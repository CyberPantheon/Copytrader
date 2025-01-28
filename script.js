document.addEventListener("DOMContentLoaded", () => {
  const app_id = 66842 // Replace with your actual app_id
  const websocket = null
  const clientTokens = JSON.parse(localStorage.getItem("clientTokens")) || []
  let masterToken = localStorage.getItem("masterToken") || null

  const masterTokenInput = document.getElementById("masterToken")
  const clientTokenInput = document.getElementById("clientToken")
  const logs = document.getElementById("logs")
  const trades = document.getElementById("trades")
  const addMasterButton = document.getElementById("addMaster")
  const addClientButton = document.getElementById("addClient")
  const startCopying = document.getElementById("startCopying")
  const stopCopying = document.getElementById("stopCopying")
  const masterList = document.getElementById("masterList")
  const clientList = document.getElementById("clientList")

  function logMessage(message, type = "info") {
    const p = document.createElement("p")
    p.textContent = `${new Date().toLocaleTimeString()} - ${message}`

    if (type === "success") p.style.color = "green"
    else if (type === "error") p.style.color = "red"
    else p.style.color = "blue"

    logs.appendChild(p)
    logs.scrollTop = logs.scrollHeight
    console.log(`${type.toUpperCase()}: ${message}`)
  }

  function logTrade(tradeMessage, type = "info") {
    const p = document.createElement("p")
    p.textContent = `${new Date().toLocaleTimeString()} - ${tradeMessage}`

    if (type === "profit") p.style.color = "green"
    else if (type === "loss") p.style.color = "red"
    else p.style.color = "blue"

    trades.appendChild(p)
    trades.scrollTop = trades.scrollHeight
  }

  function saveMasterToken(token) {
    localStorage.setItem("masterToken", token)
  }

  function saveClientTokens() {
    localStorage.setItem("clientTokens", JSON.stringify(clientTokens))
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

  function renderClientTokens() {
    clientList.innerHTML = ""

    clientTokens.forEach((token, index) => {
      const li = document.createElement("li")
      li.innerHTML = `
        <span>${token}</span>
        <button class="btn-delete" data-index="${index}">Delete</button>
      `
      clientList.appendChild(li)

      li.querySelector(".btn-delete").addEventListener("click", () => {
        clientTokens.splice(index, 1)
        saveClientTokens()
        renderClientTokens()
        logMessage("Client token removed.", "info")
      })
    })
  }

  function verifyAccountStatus(token, callback) {
    if (!token) {
      logMessage("No token provided for account verification.", "error")
      if (callback) callback(false, null, "No token provided")
      return
    }

    const verifyWebSocket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`)

    verifyWebSocket.onopen = () => {
      logMessage("WebSocket opened for account verification.", "info")
      verifyWebSocket.send(JSON.stringify({ authorize: token }))
    }

    verifyWebSocket.onmessage = (event) => {
      const response = JSON.parse(event.data)
      logMessage(`Received response: ${JSON.stringify(response)}`, "info")

      if (response.authorize) {
        const accountId = response.authorize.loginid
        logMessage(`Account ${accountId} authorized. Requesting account status...`, "info")
        verifyWebSocket.send(JSON.stringify({ get_account_status: 1 }))
      }

      if (response.get_account_status) {
        const accountId = response.get_account_status.loginid
        const status = response.get_account_status.status
        logMessage(`Received account status for ${accountId}: ${JSON.stringify(status)}`, "info")

        const isEligible = !status.includes("cashier_locked") && !status.includes("withdrawal_locked")

        if (isEligible) {
          logMessage(`Account ${accountId} is eligible for copy trading.`, "success")
        } else {
          const reasons = status.filter((s) => ["cashier_locked", "withdrawal_locked"].includes(s))
          logMessage(`Account ${accountId} is not eligible for copy trading. Reasons: ${reasons.join(", ")}`, "error")
        }

        verifyWebSocket.close()
        if (callback) callback(isEligible, accountId, isEligible ? null : reasons)
      }

      if (response.error) {
        logMessage(`Error verifying account status: ${response.error.message}`, "error")
        verifyWebSocket.close()
        if (callback) callback(false, null, response.error.message)
      }
    }

    verifyWebSocket.onerror = (error) => {
      logMessage(`WebSocket Error (Verify Account): ${error.message}`, "error")
      if (callback) callback(false, null, error.message)
    }

    verifyWebSocket.onclose = () => {
      logMessage("WebSocket for account verification closed.", "info")
    }
  }

  function startCopyTrading(callback) {
    const copyWebSocket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`)

    copyWebSocket.onopen = () => {
      logMessage("Establishing connection to start copy trading...", "info")
      copyWebSocket.send(JSON.stringify({ authorize: masterToken }))
    }

    copyWebSocket.onmessage = (event) => {
      const response = JSON.parse(event.data)
      logMessage(`Received response: ${JSON.stringify(response)}`, "info")

      if (response.authorize) {
        logMessage(
          `Master Authenticated: ${response.authorize.loginid}, Balance: ${response.authorize.balance} ${response.authorize.currency}, Scopes: ${response.authorize.scopes.join(", ")}`,
          "success",
        )

        // Start copy trading for each client
        clientTokens.forEach((clientToken) => {
          copyWebSocket.send(
            JSON.stringify({
              copy_start: 1,
              copy_settings: {
                max_trade_stake: 10, // Adjust as needed
                assets: ["EURUSD", "AUDUSD"], // Adjust as needed
                trade_types: ["CALL", "PUT"], // Adjust as needed
              },
              trader_id: clientToken,
            }),
          )
        })
      }

      if (response.copy_start) {
        logMessage(`Copy trading started for client: ${response.copy_start.client_id}`, "success")
      }

      if (response.error) {
        logMessage(`Error starting copy trading: ${response.error.message}`, "error")
      }

      if (callback) callback(response)
    }

    copyWebSocket.onerror = (error) => {
      logMessage(`WebSocket Error (Start Copy Trading): ${error.message}`, "error")
      if (callback) callback({ error: error.message })
    }

    copyWebSocket.onclose = () => {
      logMessage("Connection to start copy trading closed.", "info")
    }
  }

  function stopCopyTrading(callback) {
    const copyWebSocket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`)

    copyWebSocket.onopen = () => {
      logMessage("Establishing connection to stop copy trading...", "info")
      copyWebSocket.send(JSON.stringify({ authorize: masterToken }))
    }

    copyWebSocket.onmessage = (event) => {
      const response = JSON.parse(event.data)
      logMessage(`Received response: ${JSON.stringify(response)}`, "info")

      if (response.authorize) {
        // Stop copy trading for each client
        clientTokens.forEach((clientToken) => {
          copyWebSocket.send(
            JSON.stringify({
              copy_stop: 1,
              trader_id: clientToken,
            }),
          )
        })
      }

      if (response.copy_stop) {
        logMessage(`Copy trading stopped for client: ${response.copy_stop.client_id}`, "success")
      }

      if (response.error) {
        logMessage(`Error stopping copy trading: ${response.error.message}`, "error")
      }

      if (callback) callback(response)
    }

    copyWebSocket.onerror = (error) => {
      logMessage(`WebSocket Error (Stop Copy Trading): ${error.message}`, "error")
      if (callback) callback({ error: error.message })
    }

    copyWebSocket.onclose = () => {
      logMessage("Connection to stop copy trading closed.", "info")
    }
  }

  startCopying.addEventListener("click", () => {
    if (!masterToken) {
      logMessage("No master token provided.", "error")
      return
    }

    if (clientTokens.length === 0) {
      logMessage("No client tokens provided.", "error")
      return
    }

    verifyAccountStatus(masterToken, (isMasterEligible, accountId, reasons) => {
      if (!isMasterEligible) {
        logMessage(`Master account ${accountId} is not eligible for copy trading. Reasons: ${reasons}`, "error")
        return
      }

      startCopyTrading((response) => {
        if (response.error) {
          logMessage(`Failed to start copy trading: ${response.error}`, "error")
        } else {
          logMessage("Copy trading started successfully.", "success")
        }
      })
    })
  })

  stopCopying.addEventListener("click", () => {
    if (!masterToken) {
      logMessage("No master token provided.", "error")
      return
    }

    if (clientTokens.length === 0) {
      logMessage("No client tokens provided.", "error")
      return
    }

    stopCopyTrading((response) => {
      if (response.error) {
        logMessage(`Failed to stop copy trading: ${response.error}`, "error")
      } else {
        logMessage("Copy trading stopped successfully.", "success")
      }
    })
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

  addClientButton.addEventListener("click", () => {
    const token = clientTokenInput.value.trim()
    if (token && !clientTokens.includes(token)) {
      clientTokens.push(token)
      saveClientTokens()
      renderClientTokens()
      logMessage(`Client token added: ${token}`, "success")
      clientTokenInput.value = ""
    } else {
      logMessage("Invalid or duplicate client token.", "error")
    }
  })

  renderMasterToken()
  renderClientTokens()
})

