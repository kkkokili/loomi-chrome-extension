let currentFragmentReminderInterval = 1;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PAGE_CONTEXT") {
    setTimeout(() => {
      sendResponse(extractPageContext());
    }, 2000);

    return true;
  }

  if (message.type === "SHOW_START_OVERLAY") {
    showStartOverlay(message);
  }

  if (message.type === "SHOW_DEVIATION_OVERLAY") {
    showDeviationOverlay(message);
  }
});

function removeExistingOverlay() {
  const existing = document.getElementById("time-circle-overlay");
  if (existing) {
    existing.remove();
  }
}

function showStartOverlay(data) {
  removeExistingOverlay();

  const overlay = document.createElement("div");
  overlay.id = "time-circle-overlay";

  overlay.innerHTML = `
    <div class="time-circle-card">
      <div class="time-circle-icon">◐</div>

      <div class="time-circle-time">
        ${escapeHtml(data.minutesText || "0m left today")}
      </div>

      <div class="time-circle-title">
        Current focus
      </div>

      <div class="time-circle-goal">
        ${escapeHtml(data.goal || "Choose your next small step")}
      </div>

      <div class="time-circle-prompt">
        What kind of time is this?
      </div>

      <div class="time-circle-buttons">
        <button data-purpose="Working">Working</button>
        <button data-purpose="Learning">Learning</button>
        <button data-purpose="Break">Break</button>
      </div>

      <canvas id="time-circle-canvas" width="420" height="260"></canvas>

      <div class="time-circle-message">
        Use your attention gently.
      </div>

      <button id="time-circle-close">let it fade</button>
    </div>
  `;

  document.body.appendChild(overlay);

  const canvas = overlay.querySelector("#time-circle-canvas");

  if (canvas) {
    const cursorUrl = chrome.runtime.getURL("img/circle_cursor.svg");
    canvas.style.cursor = `url("${cursorUrl}") 16 16, auto`;
  }

  initTimeCircleCanvas(overlay, data);

  document.getElementById("time-circle-close").addEventListener("click", () => {
    overlay.remove();
  });
}

function showDeviationOverlay(data) {
  removeExistingOverlay();

  const overlay = document.createElement("div");
  overlay.id = "time-circle-overlay";

  overlay.innerHTML = `
    <div class="time-circle-card deviation-card">
      <div class="time-circle-icon">◐</div>

      <div class="time-circle-time">
        This page may not match your current circle
      </div>

      <div class="time-circle-title">
        Current purpose
      </div>

      <div class="time-circle-goal">
        ${escapeHtml(data.currentPurpose)}
      </div>

      <div class="time-circle-url">
        ${escapeHtml(data.title || data.url || "")}
      </div>

      <div class="time-circle-message">
        It looks like this tab may be drifting away from your previous intention.
        Would you like to close the previous circle and start a new one?
      </div>

      <div class="time-circle-buttons">
        <button id="time-circle-yes">Yes, start a new circle</button>
        <button id="time-circle-no">No, close this tab</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document
    .getElementById("time-circle-yes")
    .addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        type: "DEVIATION_YES_START_NEW",
      });
    });

  document
    .getElementById("time-circle-no")
    .addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        type: "DEVIATION_NO_CLOSE_TAB",
      });
    });
}

function showFloatingFragment({
  points,
  purpose,
  startedAt,
  reminderIntervalMinutes = 1,
}) {
  currentFragmentReminderInterval = reminderIntervalMinutes;
  const old = document.getElementById("time-circle-fragment");
  if (old) old.remove();

  const fragment = document.createElement("div");
  fragment.id = "time-circle-fragment";

  fragment.innerHTML = `
    <canvas id="time-circle-fragment-canvas" width="120" height="90"></canvas>
    <div id="time-circle-fragment-duration">&lt;1m</div>
  `;

  document.body.appendChild(fragment);

  const canvas = fragment.querySelector("#time-circle-fragment-canvas");
  const ctx = canvas.getContext("2d");

  drawScaledPathOnFragment(ctx, canvas, points, false);

  const durationLabel = fragment.querySelector(
    "#time-circle-fragment-duration",
  );

  let lastBlinkedInterval = 0;

  const timer = setInterval(() => {
    if (!document.body.contains(fragment)) {
      clearInterval(timer);
      return;
    }

    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - startedAt) / 1000),
    );

    durationLabel.textContent = formatDuration(elapsedSeconds);

    const intervalSeconds = currentFragmentReminderInterval * 60;
    const currentInterval = Math.floor(elapsedSeconds / intervalSeconds);

    if (currentInterval > lastBlinkedInterval) {
      lastBlinkedInterval = currentInterval;
      startSoftBlink(fragment, points, purpose);
    }
  }, 1000);

  makeFragmentDraggable(fragment);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initTimeCircleCanvas(overlay, data) {
  const canvas = overlay.querySelector("#time-circle-canvas");
  const ctx = canvas.getContext("2d");

  let isDrawing = false;
  let selectedPurpose = null;
  let points = [];
  let startedAt = null;

  const message = overlay.querySelector(".time-circle-message");

  overlay.querySelectorAll("[data-purpose]").forEach((button) => {
    button.addEventListener("click", async () => {
      selectedPurpose = button.dataset.purpose;

      startedAt = Date.now();

      await chrome.runtime.sendMessage({
        type: "START_SESSION",
        purpose: selectedPurpose,
      });

      overlay.querySelectorAll("[data-purpose]").forEach((btn) => {
        if (btn.dataset.purpose === selectedPurpose) {
          btn.classList.add("selected");
          btn.style.display = "inline-block";
        } else {
          btn.style.display = "none";
        }
      });

      if (message) {
        message.textContent = `${selectedPurpose} circle left open at ${formatClockTime(startedAt)}`;
      }
    });
  });

  function getPos(event) {
    const rect = canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(255, 252, 246, 0.78)";
    roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 28);
    ctx.fill();

    if (points.length < 2) return;

    ctx.strokeStyle = "rgba(90, 72, 55, 0.28)";
    ctx.lineWidth = 11;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawSmoothPath(ctx, points);

    ctx.strokeStyle = getInkColor(false);
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawSmoothPath(ctx, points);
  }

  canvas.addEventListener("mousedown", (event) => {
    if (!selectedPurpose) {
      if (message) {
        message.textContent = "Choose Working, Learning, or Break first.";
      }
      return;
    }

    isDrawing = true;
    points = [getPos(event)];

    if (!startedAt) {
      startedAt = Date.now();
    }

    if (message) {
      message.textContent = `${selectedPurpose} circle left open at ${formatClockTime(startedAt)}`;
    }

    redraw();
  });

  canvas.addEventListener("mousemove", (event) => {
    if (!isDrawing) return;

    points.push(getPos(event));
    redraw();
  });

  canvas.addEventListener("mouseup", async () => {
    if (!isDrawing) return;

    isDrawing = false;

    if (points.length > 6) {
      if (message) {
        message.textContent = "Your time trace is now floating on the page.";
      }

      await chrome.runtime.sendMessage({
        type: "UPDATE_SESSION_TRACE",
        points,
        purpose: selectedPurpose,
        startedAt,
      });

      setTimeout(() => {
        overlay.remove();

        showFloatingFragment({
          points,
          purpose: selectedPurpose,
          startedAt,
          reminderIntervalMinutes: data.fragmentReminderInterval || 1,
        });
      }, 450);
    }
  });

  redraw();
}

function drawSmoothPath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];

    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;

    ctx.quadraticCurveTo(current.x, current.y, midX, midY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawScaledPathOnFragment(ctx, canvas, points, isBlinking) {
  if (!points || points.length < 2) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const srcW = Math.max(1, maxX - minX);
  const srcH = Math.max(1, maxY - minY);

  const target = 78;
  const scale = Math.min(target / srcW, target / srcH);

  const offsetX = (canvas.width - srcW * scale) / 2 - minX * scale;
  const offsetY = 12 + (70 - srcH * scale) / 2 - minY * scale;

  const scaledPoints = points.map((p) => ({
    x: p.x * scale + offsetX,
    y: p.y * scale + offsetY,
  }));

  ctx.strokeStyle = "rgba(80, 62, 48, 0.24)";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  drawSmoothPath(ctx, scaledPoints);

  ctx.strokeStyle = getInkColor(isBlinking);
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  drawSmoothPath(ctx, scaledPoints);
}

function makeFragmentDraggable(fragment) {
  let dragging = false;
  let moved = false;
  let offsetX = 0;
  let offsetY = 0;
  let startX = 0;
  let startY = 0;

  fragment.addEventListener("mousedown", (event) => {
    dragging = true;
    moved = false;

    startX = event.clientX;
    startY = event.clientY;

    const rect = fragment.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;

    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragging) return;

    if (
      Math.abs(event.clientX - startX) > 6 ||
      Math.abs(event.clientY - startY) > 6
    ) {
      moved = true;
    }

    if (moved) {
      fragment.style.left = `${event.clientX - offsetX}px`;
      fragment.style.top = `${event.clientY - offsetY}px`;
      fragment.style.right = "auto";
      fragment.style.bottom = "auto";
    }
  });

  document.addEventListener("mouseup", () => {
    dragging = false;
  });
}

function drawSmoothPath(ctx, points) {
  if (!points || points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];

    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;

    ctx.quadraticCurveTo(current.x, current.y, midX, midY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function getInkColor(isBlinking) {
  if (isBlinking) {
    return "#ffffff";
  }

  return "#5E554B";
}

function formatDuration(seconds) {
  const minutes = Math.max(0, Math.floor(seconds / 60));

  if (minutes < 1) {
    return "<1m";
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }

  return `${mins}m`;
}

function formatClockTime(timestamp) {
  const date = new Date(timestamp);

  return date
    .toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(/^0/, "");
}

function startSoftBlink(fragment, points, purpose) {
  const canvas = fragment.querySelector("#time-circle-fragment-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  let blinkCount = 0;

  const blinkTimer = setInterval(() => {
    blinkCount += 1;

    const useWhite = blinkCount % 2 === 1;
    drawScaledPathOnFragment(ctx, canvas, points, useWhite);

    if (blinkCount >= 10) {
      clearInterval(blinkTimer);
      drawScaledPathOnFragment(ctx, canvas, points, false);
    }
  }, 180);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (!changes.config) return;

  const newConfig = changes.config.newValue;

  if (!newConfig) return;

  currentFragmentReminderInterval =
    Number(newConfig.fragmentReminderInterval) || 1;

  console.log(
    "fragment reminder interval updated:",
    currentFragmentReminderInterval,
  );
});

function extractPageContext() {
  const url = location.href;
  const title = document.title || "";
  const pageType = detectPageType(url);

  if (pageType === "youtube_search") {
    return extractYouTubeSearchContext(url, title);
  }

  if (pageType === "youtube_video") {
    return extractYouTubeVideoContext(url, title);
  }

  return {
    pageType,
    title,
    url,
    text: extractFallbackText(),
  };
}

function detectPageType(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");

    if (host.includes("youtube.com")) {
      if (u.pathname === "/results") return "youtube_search";
      if (u.pathname === "/watch") return "youtube_video";
      if (u.pathname.startsWith("/shorts/")) return "youtube_shorts";
      return "youtube_other";
    }

    if (host.includes("bilibili.com")) {
      if (u.pathname.includes("/video/")) return "bilibili_video";
      if (u.pathname.includes("/search")) return "bilibili_search";
      return "bilibili_other";
    }

    return "web_page";
  } catch {
    return "unknown";
  }
}

function extractSearchQuery(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");

    if (host.includes("youtube.com")) {
      return u.searchParams.get("search_query") || "";
    }

    if (host.includes("bilibili.com")) {
      return u.searchParams.get("keyword") || "";
    }

    return "";
  } catch {
    return "";
  }
}

function extractMainText(pageType) {
  if (pageType === "youtube_search") {
    const results = Array.from(
      document.querySelectorAll("ytd-video-renderer #video-title"),
    )
      .map((el) => el.textContent.trim())
      .filter(Boolean)
      .slice(0, 8);

    return results.join("\n");
  }

  if (pageType === "youtube_video") {
    const videoTitle =
      document.querySelector("h1 yt-formatted-string")?.textContent?.trim() ||
      document.title ||
      "";

    const description =
      document
        .querySelector("#description-inline-expander")
        ?.innerText?.trim() || "";

    return [videoTitle, description].filter(Boolean).join("\n").slice(0, 1500);
  }

  const main =
    document.querySelector("main") ||
    document.querySelector("#content") ||
    document.body;

  return (main.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1500);
}

function extractYouTubeSearchContext(url, title) {
  const searchQuery = extractSearchQuery(url);

  const resultTitles = Array.from(
    document.querySelectorAll("ytd-video-renderer #video-title"),
  )
    .map((el) => el.textContent.trim())
    .filter(Boolean)
    .slice(0, 8);

  return {
    pageType: "youtube_search",
    title,
    url,
    searchQuery,
    resultTitles,
  };
}

function extractYouTubeVideoContext(url, title) {
  const videoTitle =
    document.querySelector("h1.ytd-watch-metadata")?.innerText?.trim() ||
    document.querySelector("h1 yt-formatted-string")?.innerText?.trim() ||
    document.querySelector("#title h1")?.innerText?.trim() ||
    title ||
    "";

  const channelName =
    document
      .querySelector("ytd-watch-metadata ytd-channel-name a")
      ?.innerText?.trim() ||
    document.querySelector("#owner ytd-channel-name a")?.innerText?.trim() ||
    document.querySelector("#channel-name a")?.innerText?.trim() ||
    "";

  const description =
    document.querySelector("#description-inline-expander")?.innerText?.trim() ||
    document.querySelector("ytd-text-inline-expander")?.innerText?.trim() ||
    "";

  return {
    pageType: "youtube_video",
    title,
    url,
    videoTitle,
    channelName,
    description: description.slice(0, 1200),
  };
}
