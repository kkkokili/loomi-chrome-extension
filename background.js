const DEFAULT_CONFIG = {
  sleepTime: "22:00",
  goal: "Finish your MVP",
  restrictedSites: ["youtube.com", "bilibili.com"],
  fragmentReminderInterval: 1,
};

const DEFAULT_STATE = {
  activeSession: null,
  restrictedTabs: {},
  config: DEFAULT_CONFIG,
};

function minutesUntilSleep(sleepTimeStr) {
  const now = new Date();
  const [hour, minute] = sleepTimeStr.split(":").map(Number);

  const sleepDate = new Date(now);
  sleepDate.setHours(hour, minute, 0, 0);

  if (sleepDate < now) {
    sleepDate.setDate(sleepDate.getDate() + 1);
  }

  return Math.max(0, Math.floor((sleepDate - now) / 1000 / 60));
}

function formatMinutes(minutesLeft) {
  const hours = Math.floor(minutesLeft / 60);
  const minutes = minutesLeft % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m left today`;
  }

  return `${minutes}m left today`;
}

function isRestrictedUrl(url, config) {
  if (!url) return false;

  const restrictedSites =
    config?.restrictedSites || DEFAULT_CONFIG.restrictedSites;

  return restrictedSites.some((site) => {
    return url.includes(site);
  });
}

function getSiteKey(url) {
  if (!url) return "";

  try {
    const u = new URL(url);
    return u.hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function getPageKey(url) {
  if (!url) return "";

  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");

    if (host.includes("youtube.com")) {
      const videoId = u.searchParams.get("v");

      if (videoId) {
        return `youtube:watch:${videoId}`;
      }

      if (u.pathname.startsWith("/shorts/")) {
        const shortsId = u.pathname.split("/")[2] || "";
        return `youtube:shorts:${shortsId}`;
      }

      return `youtube:${u.pathname}`;
    }

    if (host.includes("bilibili.com")) {
      const bvMatch = u.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);

      if (bvMatch) {
        return `bilibili:video:${bvMatch[1]}`;
      }

      return `bilibili:${u.pathname}`;
    }

    return `${host}:${u.pathname}`;
  } catch {
    return url;
  }
}

async function getState() {
  const result = await chrome.storage.local.get(DEFAULT_STATE);

  let activeSession = result.activeSession || null;

  if (activeSession) {
    const startedAt = activeSession.startedAt || 0;

    const hoursPassed = (Date.now() - startedAt) / 1000 / 60 / 60;

    if (hoursPassed > 8) {
      activeSession = null;
    }
  }

  return {
    activeSession,
    restrictedTabs: result.restrictedTabs || {},
    config: {
      ...DEFAULT_CONFIG,
      ...(result.config || {}),
    },
  };
}

async function setState(nextState) {
  await chrome.storage.local.set(nextState);
}

async function sendMessageSafe(tabId, message) {
  try {
    console.log("sending message:", message);

    await chrome.tabs.sendMessage(tabId, message);

    console.log("message sent");
  } catch (error) {
    console.log("sendMessage failed:", error);
  }
}

async function injectContentIntoTab(tabId) {
  try {
    console.log("injecting into tab:", tabId);

    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["overlay.css"],
    });

    console.log("css injected");

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });

    console.log("content injected");
  } catch (error) {
    console.log("inject failed:", error);
  }
}

function buildStartOverlayMessage(tab, config) {
  const minutesLeft = minutesUntilSleep(config.sleepTime);

  return {
    type: "SHOW_START_OVERLAY",
    url: tab.url,
    title: tab.title || "",
    minutesText: formatMinutes(minutesLeft),
    goal: config.goal || "Choose your next small step",
    sleepTime: config.sleepTime,
    fragmentReminderInterval: config.fragmentReminderInterval || 1,
  };
}

function mockAiCheckPageFitsGoal({ title, url, currentPurpose }) {
  const text = `${title || ""} ${url || ""}`.toLowerCase();

  if (!currentPurpose) return false;

  if (currentPurpose === "Working") {
    const workKeywords = [
      "github",
      "docs",
      "developer",
      "stackoverflow",
      "tutorial",
      "course",
      "javascript",
      "python",
      "chrome extension",
      "programming",
      "coding",
      "react",
      "vue",
    ];

    return workKeywords.some((keyword) => text.includes(keyword));
  }

  if (currentPurpose === "Learning") {
    const learningKeywords = [
      "tutorial",
      "course",
      "lecture",
      "learn",
      "study",
      "explain",
      "documentary",
      "lesson",
    ];

    return learningKeywords.some((keyword) => text.includes(keyword));
  }

  if (currentPurpose === "Break") {
    return true;
  }

  return false;
}

async function handleRestrictedTab(tab) {
  const state = await getState();
  const config = state.config;

  console.log("checking tab:", tab.url);
  console.log("config:", config);
  console.log("is restricted:", isRestrictedUrl(tab.url, config));

  if (!tab || !tab.id || !isRestrictedUrl(tab.url, config)) return;

  const restrictedTabs = {
    ...state.restrictedTabs,
    [tab.id]: {
      url: tab.url,
      title: tab.title || "",
      site: getSiteKey(tab.url),
      pageKey: getPageKey(tab.url),
      lastSeenAt: Date.now(),
    },
  };

  const previousTab = state.restrictedTabs[tab.id];
  const currentPageKey = getPageKey(tab.url);
  const previousPageKey = previousTab?.pageKey;
  const sessionPageKey =
    state.activeSession?.currentPageKey ||
    getPageKey(state.activeSession?.startedUrl || "");

  if (
    state.activeSession &&
    sessionPageKey &&
    currentPageKey === sessionPageKey
  ) {
    console.log("same as active session pageKey, ignore:", currentPageKey);

    await setState({
      activeSession: state.activeSession,
      restrictedTabs,
      config,
    });

    return;
  }

  if (
    state.activeSession &&
    previousTab &&
    previousPageKey === currentPageKey
  ) {
    console.log("same pageKey, ignore:", currentPageKey);

    await setState({
      activeSession: {
        ...state.activeSession,
        currentPageKey,
      },
      restrictedTabs,
      config,
    });

    return;
  }

  if (!state.activeSession) {
    await setState({
      activeSession: null,
      restrictedTabs,
      config,
    });

    await injectContentIntoTab(tab.id);
    await sendMessageSafe(tab.id, buildStartOverlayMessage(tab, config));
    return;
  }

  const pageContext = await getPageContext(tab.id);

  console.log("PAGE CONTEXT:");
  console.log(pageContext);

  const fitsGoal = mockAiCheckPageFitsGoal({
    title: tab.title || "",
    url: tab.url,
    currentPurpose: state.activeSession.purpose,
  });

  await setState({
    activeSession: state.activeSession,
    restrictedTabs,
    config,
  });

  if (!fitsGoal) {
    console.log("DEVIATION DETECTED, but overlay disabled for testing");
    console.log({
      purpose: state.activeSession.purpose,
      goal: state.activeSession.goal,
      url: tab.url,
      title: tab.title || "",
      pageContext,
    });

    return;
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = tab.url || changeInfo.url;

  if (!url) return;

  const currentTab = {
    ...tab,
    id: tabId,
    url: url,
  };

  console.log("tab updated:", currentTab.url);

  const state = await getState();

  if (isRestrictedUrl(currentTab.url, state.config)) {
    await handleRestrictedTab(currentTab);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  const state = await getState();

  if (!isRestrictedUrl(tab.url, state.config)) return;

  // 已经有 session 时，只是切回旧 tab，不要重新判断 deviation
  if (state.activeSession) {
    console.log("tab activated during active session, ignore:", tab.url);
    return;
  }

  await handleRestrictedTab(tab);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();

  if (!state.restrictedTabs[tabId]) return;

  const restrictedTabs = { ...state.restrictedTabs };
  delete restrictedTabs[tabId];

  const remainingRestrictedCount = Object.keys(restrictedTabs).length;

  if (remainingRestrictedCount === 0 && state.activeSession) {
    const completedSession = {
      ...state.activeSession,
      completedAt: Date.now(),
    };

    console.log("Session auto completed:", completedSession);

    await setState({
      activeSession: null,
      restrictedTabs: {},
      config: state.config,
    });

    return;
  }

  await setState({
    activeSession: state.activeSession,
    restrictedTabs,
    config: state.config,
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === "START_SESSION") {
    getState().then(async (state) => {
      const activeSession = {
        purpose: message.purpose,
        startedAt: Date.now(),
        startedUrl: sender.tab?.url || "",
        currentPageKey: getPageKey(sender.tab?.url || ""),
        startedTitle: sender.tab?.title || "",
        goal: state.config.goal,
        sleepTime: state.config.sleepTime,
        fragmentReminderInterval: state.config.fragmentReminderInterval,
      };

      await setState({
        activeSession,
        restrictedTabs: state.restrictedTabs || {},
        config: state.config,
      });

      sendResponse({ ok: true });
    });

    return true;
  }

  if (message.type === "DEVIATION_YES_START_NEW") {
    getState().then(async (state) => {
      const oldSession = state.activeSession;

      console.log("Old session closed:", {
        ...oldSession,
        completedAt: Date.now(),
      });

      await setState({
        activeSession: null,
        restrictedTabs: state.restrictedTabs || {},
        config: state.config,
      });

      if (tabId) {
        await sendMessageSafe(
          tabId,
          buildStartOverlayMessage(sender.tab, state.config),
        );
      }

      sendResponse({ ok: true });
    });

    return true;
  }

  if (message.type === "DEVIATION_NO_CLOSE_TAB") {
    if (tabId) {
      chrome.tabs.remove(tabId);
    }

    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "UPDATE_SESSION_TRACE") {
    getState().then(async (state) => {
      if (!state.activeSession) {
        sendResponse({ ok: false });
        return;
      }

      await setState({
        activeSession: {
          ...state.activeSession,
          purpose: message.purpose || state.activeSession.purpose,
          startedAt: message.startedAt || state.activeSession.startedAt,
          points: message.points || [],
        },
        restrictedTabs: state.restrictedTabs || {},
        config: state.config,
      });

      sendResponse({ ok: true });
    });

    return true;
  }
});

console.log("background running");

async function getPageContext(tabId) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "GET_PAGE_CONTEXT",
    });

    return result;
  } catch (error) {
    console.error("getPageContext failed", error);

    return null;
  }
}
