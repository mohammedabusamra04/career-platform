/**
 * ============================================================================
 * LinkedIn Email Alerts Ingestor for DeployMe (Google Apps Script)
 * ============================================================================
 *
 * PURPOSE:
 * Automates the collection of fresh job postings from official LinkedIn Job Alert
 * emails delivered to Gmail, parses and cleans the job details, and securely
 * pushes them into the DeployMe backend API (/api/internal/jobs/ingest).
 *
 * 100% Free - Eliminates the need for paid RapidAPI JSearch or Firecrawl scrapers.
 *
 * ----------------------------------------------------------------------------
 * SETUP INSTRUCTIONS:
 * ----------------------------------------------------------------------------
 * 1. Open Google Apps Script:
 *    Go to https://script.google.com and click "New project".
 *    Name the project: "DeployMe LinkedIn Ingestor".
 *
 * 2. Paste this Code:
 *    Replace everything in Code.gs with this entire script.
 *
 * 3. Configure Script Properties (Credentials):
 *    - Click on the gear icon (Project Settings ⚙️) on the left sidebar.
 *    - Scroll down to "Script Properties" and click "Edit script properties" -> "Add script property".
 *    - Add the following two properties:
 *      * API_URL          -> https://<your-render-app>.onrender.com/api/internal/jobs/ingest
 *      * API_BEARER_TOKEN -> <YOUR_PIPELINE_API_SECRET_OR_API_BEARER_TOKEN>
 *    - Click "Save script properties".
 *
 * 4. Test Ingestion:
 *    - In the editor toolbar, select "ingestLinkedInAlerts" from the function dropdown.
 *    - Click "Run".
 *    - Grant the required Gmail & UrlFetch permissions when prompted.
 *    - Check "Execution log" below the editor to verify processed jobs.
 *
 * 5. Configure Daily Trigger (20:30 Asia/Gaza):
 *    - Click the clock icon (Triggers ⏰) on the left sidebar.
 *    - Click "+ Add Trigger" in the bottom-right corner.
 *    - Choose which function to run: ingestLinkedInAlerts
 *    - Choose which runs should be handled: Head
 *    - Select event source: Time-driven
 *    - Select type of time based trigger: Day timer
 *    - Select time of day: 8pm to 9pm (or create a specific 20:30 trigger using createDailyTrigger())
 *    - Ensure your script timezone in Project Settings is set to "(GMT+02:00) Asia/Gaza" or your local timezone.
 *    - Click "Save".
 * ============================================================================
 */

// Configuration Defaults
var CONFIG = {
  SEARCH_QUERY: 'from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com) newer_than:1d -label:Processed-DeployMe',
  LABEL_NAME: 'Processed-DeployMe',
  MAX_THREADS: 15,
  REQUEST_TIMEOUT_MS: 30000,
};

/**
 * Main entry point: Searches Gmail for LinkedIn alert emails, extracts jobs,
 * pushes them to the backend ingestion endpoint, and labels processed threads.
 */
function ingestLinkedInAlerts() {
  var scriptProps = PropertiesService.getScriptProperties();
  var apiUrl = scriptProps.getProperty('API_URL');
  var apiToken = scriptProps.getProperty('API_BEARER_TOKEN');

  if (!apiUrl || !apiToken) {
    Logger.log('[DeployMe] ERROR: Missing API_URL or API_BEARER_TOKEN in Script Properties. Ingestion aborted.');
    return;
  }

  Logger.log('[DeployMe] Searching Gmail for LinkedIn job alert threads...');
  var threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, CONFIG.MAX_THREADS);

  if (!threads || threads.length === 0) {
    Logger.log('[DeployMe] No unprocessed LinkedIn job alert emails found.');
    return;
  }

  Logger.log('[DeployMe] Found ' + threads.length + ' unprocessed email thread(s).');

  // Ensure tracking label exists
  var label = getOrCreateLabel(CONFIG.LABEL_NAME);

  var collectedJobs = [];
  var seenUrls = {};

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();

    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      var htmlBody = message.getBody();
      var messageDate = message.getDate();

      var parsedJobs = extractJobsFromHtml(htmlBody, messageDate);

      for (var j = 0; j < parsedJobs.length; j++) {
        var job = parsedJobs[j];
        if (job.url && !seenUrls[job.url]) {
          seenUrls[job.url] = true;
          collectedJobs.push(job);
        }
      }
    }
  }

  Logger.log('[DeployMe] Total unique LinkedIn jobs extracted: ' + collectedJobs.length);

  if (collectedJobs.length === 0) {
    Logger.log('[DeployMe] No valid job items could be extracted from messages. Marking threads as processed.');
    for (var k = 0; k < threads.length; k++) {
      threads[k].addLabel(label);
      threads[k].markRead();
    }
    return;
  }

  // Send jobs to DeployMe backend API
  var success = sendJobsToBackend(apiUrl, apiToken, collectedJobs);

  if (success) {
    Logger.log('[DeployMe] Ingestion API call successful! Tagging threads with label "' + CONFIG.LABEL_NAME + '".');
    for (var t = 0; t < threads.length; t++) {
      threads[t].addLabel(label);
      threads[t].markRead();
    }
  } else {
    Logger.log('[DeployMe] Ingestion API call failed. Threads left unlabeled for next retry.');
  }
}

/**
 * Extracts job items from LinkedIn Job Alert HTML email body.
 */
function extractJobsFromHtml(html, messageDate) {
  var jobs = [];
  if (!html) return jobs;

  // Pattern 1: Match <a> anchors linking to /jobs/view/ or containing currentJobId
  // Examples:
  // href="https://www.linkedin.com/comm/jobs/view/1234567890?..."
  // href="https://www.linkedin.com/jobs/view/1234567890/..."
  var linkRegex = /<a[^>]+href=["'](https?:\/\/[^"']*(?:linkedin\.com\/(?:comm\/)?jobs\/view\/|currentJobId=)(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

  var match;
  var jobMap = {};

  while ((match = linkRegex.exec(html)) !== null) {
    var rawUrl = match[1];
    var jobId = match[2];
    var anchorContent = match[3];

    var cleanUrl = 'https://www.linkedin.com/jobs/view/' + jobId;
    if (jobMap[cleanUrl]) {
      continue;
    }

    var title = cleanHtmlText(anchorContent);
    // Discard generic non-job anchor text
    if (!title || title.length < 3 || isGenericText(title)) {
      continue;
    }

    // Attempt to extract company and location near the matched anchor
    var surroundingContext = extractSurroundingContext(html, match.index, 1200);
    var metadata = extractCompanyAndLocation(surroundingContext, title);

    jobMap[cleanUrl] = {
      title: title,
      company: metadata.company || 'Company',
      location: metadata.location || 'Remote',
      url: cleanUrl,
      description: title + (metadata.company ? ' at ' + metadata.company : '') + (metadata.location ? ' - ' + metadata.location : ''),
      publishedAt: messageDate ? messageDate.toISOString() : new Date().toISOString()
    };
  }

  for (var key in jobMap) {
    if (jobMap.hasOwnProperty(key)) {
      jobs.push(jobMap[key]);
    }
  }

  return jobs;
}

/**
 * Extracts company and location from surrounding HTML text blocks.
 */
function extractCompanyAndLocation(contextHtml, title) {
  var plainText = cleanHtmlText(contextHtml);
  var lines = plainText.split('\n')
    .map(function(l) { return l.trim(); })
    .filter(function(l) { return l.length > 0; });

  var company = '';
  var location = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line === title && i + 1 < lines.length) {
      company = cleanCompanyName(lines[i + 1]);
      if (i + 2 < lines.length && !isGenericText(lines[i + 2])) {
        location = lines[i + 2];
      }
      break;
    }
  }

  return {
    company: company || 'Company',
    location: location || 'Remote'
  };
}

/**
 * Strips HTML tags, decodes common entities, and normalizes whitespaces.
 */
function cleanHtmlText(htmlSnippet) {
  if (!htmlSnippet) return '';
  return htmlSnippet
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Filters out generic navigation and button text.
 */
function isGenericText(text) {
  var lower = text.toLowerCase();
  var genericPhrases = [
    'see all jobs',
    'view job',
    'apply',
    'unsubscribe',
    'privacy policy',
    'help',
    'manage alerts',
    'view more',
    'see more',
    'linkedin',
    'learn more'
  ];
  for (var i = 0; i < genericPhrases.length; i++) {
    if (lower === genericPhrases[i] || lower.indexOf(genericPhrases[i]) !== -1) {
      return true;
    }
  }
  return false;
}

/**
 * Sanitizes company name from common email artifacts.
 */
function cleanCompanyName(text) {
  if (!text) return 'Company';
  var cleaned = text.replace(/^(at|by)\s+/i, '').trim();
  if (isGenericText(cleaned) || cleaned.length > 80) {
    return 'Company';
  }
  return cleaned;
}

/**
 * Takes a snippet of HTML surrounding the matched index.
 */
function extractSurroundingContext(html, index, length) {
  var start = Math.max(0, index - 200);
  var end = Math.min(html.length, index + length);
  return html.substring(start, end);
}

/**
 * Sends parsed jobs to the backend internal ingestion endpoint.
 */
function sendJobsToBackend(apiUrl, apiToken, jobs) {
  var payload = {
    jobs: jobs
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiToken
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(apiUrl, options);
    var statusCode = response.getResponseCode();
    var responseText = response.getContentText();

    Logger.log('[DeployMe] Backend Response Code: ' + statusCode);
    Logger.log('[DeployMe] Backend Response Body: ' + responseText);

    if (statusCode >= 200 && statusCode < 300) {
      return true;
    } else {
      Logger.log('[DeployMe] ERROR: Backend returned error status ' + statusCode);
      return false;
    }
  } catch (err) {
    Logger.log('[DeployMe] ERROR: Exception occurred during UrlFetchApp: ' + err.toString());
    return false;
  }
}

/**
 * Retrieves an existing Gmail label or creates it if it doesn't exist.
 */
function getOrCreateLabel(labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
    Logger.log('[DeployMe] Created new Gmail label: ' + labelName);
  }
  return label;
}

/**
 * Helper function to programmatically set up a daily trigger at 20:30 Asia/Gaza.
 * Run this function once from the Apps Script editor toolbar if preferred.
 */
function createDailyTrigger() {
  // Delete existing triggers for this function to prevent duplicate schedules
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ingestLinkedInAlerts') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Create new daily trigger at 20:30
  ScriptApp.newTrigger('ingestLinkedInAlerts')
    .timeBased()
    .atHour(20)
    .nearMinute(30)
    .everyDays(1)
    .inTimezone('Asia/Gaza')
    .create();

  Logger.log('[DeployMe] Daily trigger successfully created for 20:30 Asia/Gaza.');
}

