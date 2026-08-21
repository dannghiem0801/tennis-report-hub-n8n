/**
 * Tennis Report Hub - Google Apps Script Trigger
 * Binds to spreadsheet: 1Q1LWnF3DhE9xHovdgqWG09ir4fc8gNJ6lht-aj3KPm4
 * 
 * Install:
 * 1. Open spreadsheet → Extensions → Apps Script
 * 2. Paste this entire code
 * 3. Save (Ctrl+S)
 * 4. Triggers → Add Trigger → onSheetChange → From spreadsheet → On change
 * 5. Authorize permissions when prompted
 * 
 * What it does:
 * - Fires on ANY change to spreadsheet
 * - Checks ALL tabs (Tennis, Soccer) for rows with EMPTY Status
 * - POSTs each pending row to Hermes webhook instantly
 */

// === CONFIG ===
const WEBHOOK_URL = "http://100.89.83.117:8644/webhooks/sheets-recap";
const HMAC_SECRET = "y4zJC0JMD2KM3UkdDfGq9JerSneXeltXh2CwQHhz5cc";
const SPREADSHEET_ID = "1Q1LWnF3DhE9xHovdgqWG09ir4fc8gNJ6lht-aj3KPm4";

// Tab name → channel mapping
const TAB_CHANNEL = {
  "Tennis": "tennis",
  "Soccer": "soccer"
};

// Columns: Match(A), Link Youtube(B), Status(C), Report(D), Drive(E)
const COL_MATCH = 1;   // A
const COL_STATUS = 3;  // C

/**
 * Main trigger: runs on every spreadsheet change
 */
function onSheetChange(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(5000); // 5s max wait
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const changedTabs = getChangedTabs(e);
    
    let processed = 0;
    for (const tabName of Object.keys(TAB_CHANNEL)) {
      if (changedTabs.length > 0 && !changedTabs.includes(tabName)) continue;
      
      const tab = ss.getSheetByName(tabName);
      if (!tab) continue;
      
      const pending = findPendingRows(tab);
      for (const row of pending) {
        const match = tab.getRange(row, COL_MATCH).getValue();
        const link = tab.getRange(row, COL_MATCH + 1).getValue();
        sendToWebhook(tabName, row, match, link);
        processed++;
      }
    }
    
    if (processed > 0) {
      console.log(`GAS: Processed ${processed} pending row(s)`);
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Determine which tabs changed based on event
 */
function getChangedTabs(e) {
  // If source is a form submit, check all tabs
  if (e.changeType === "INSERT_GRID") return Object.keys(TAB_CHANNEL);
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  const changedTabs = [];
  
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (TAB_CHANNEL.hasOwnProperty(name)) {
      changedTabs.push(name);
    }
  }
  
  return changedTabs;
}

/**
 * Find rows where Status (col C) is empty
 */
function findPendingRows(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  
  if (lastRow < 2) return []; // No data beyond header
  
  const statusCol = sheet.getRange(2, COL_STATUS, lastRow - 1, 1).getValues();
  const pending = [];
  
  for (let i = 0; i < statusCol.length; i++) {
    const status = statusCol[i][0];
    if (!status || status.toString().trim() === "") {
      pending.push(i + 2); // +2 because 1-indexed + header row
    }
  }
  
  return pending;
}

/**
 * Compute HMAC-SHA256 signature (compatible with Node.js crypto)
 */
function computeHmac(payload) {
  const signature = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    payload,
    HMAC_SECRET
  );
  
  // Convert bytes to hex
  let hex = "";
  for (let i = 0; i < signature.length; i++) {
    hex += ("0" + (signature[i] < 0 ? signature[i] + 256 : signature[i]).toString(16)).slice(-2);
  }
  return "sha256=" + hex;
}

/**
 * POST to Hermes webhook
 */
function sendToWebhook(tabName, rowIndex, match, link) {
  const payload = JSON.stringify({
    tab: tabName,
    row_index: rowIndex,
    match: match,
    link: link || ""
  });
  
  const signature = computeHmac(payload);
  
  const options = {
    method: "POST",
    contentType: "application/json",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature
    },
    payload: payload,
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    console.log(`Webhook → row ${rowIndex} [${tabName}]: ${response.getResponseCode()} ${response.getContentText().slice(0, 100)}`);
    return response;
  } catch (err) {
    console.error(`Webhook error: ${err.message}`);
    return null;
  }
}

/**
 * Manual test: run this to process all pending rows now
 */
function processNow() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  for (const [tabName, channel] of Object.entries(TAB_CHANNEL)) {
    const tab = ss.getSheetByName(tabName);
    if (!tab) continue;
    
    const pending = findPendingRows(tab);
    console.log(`[${tabName}] Found ${pending.length} pending row(s): ${JSON.stringify(pending)}`);
    
    for (const row of pending) {
      const match = tab.getRange(row, COL_MATCH).getValue();
      const link = tab.getRange(row, COL_MATCH + 1).getValue();
      sendToWebhook(tabName, row, match, link);
    }
  }
}

/**
 * Install trigger — run once to set up the onChange trigger
 */
function installTrigger() {
  // Delete existing triggers first
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "onSheetChange") {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // Create new onChange trigger
  ScriptApp.newTrigger("onSheetChange")
    .forSpreadsheet(SPREADSHEET_ID)
    .onChange()
    .create();
  
  console.log("Trigger installed: onSheetChange → on change event");
}
