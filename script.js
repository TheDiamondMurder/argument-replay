const setupPanel = document.querySelector("#setup-panel");
const listPanel = document.querySelector("#list-panel");
const replayPanel = document.querySelector("#replay-panel");
const setupForm = document.querySelector("#setup-form");
const chatFile = document.querySelector("#chat-file");
const parseStatus = document.querySelector("#parse-status");
const argumentList = document.querySelector("#argument-list");
const replayTitle = document.querySelector("#replay-title");
const replayMeta = document.querySelector("#replay-meta");
const dramaFill = document.querySelector("#drama-fill");
const timeline = document.querySelector("#timeline");
const backToList = document.querySelector("#back-to-list");
const playReplay = document.querySelector("#play-replay");

let chatTitleSender = "";
let messages = [];
let argumentsFound = [];
let currentArgument = null;
let replayTimers = [];

function cleanText(text) {
  return text
    .replace(/\u200e/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseChatExport(text) {
  const entryRegex = /^[\u200e\s]*\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s+([^:]+):\s*([\s\S]*)$/;
  const parsed = [];

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const match = line.match(entryRegex);

    if (match) {
      const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
      parsed.push({
        date: new Date(year, Number(match[1]) - 1, Number(match[2]), Number(match[4]), Number(match[5]), Number(match[6] || 0)),
        sender: cleanText(match[7]),
        text: cleanText(match[8]),
      });
      return;
    }

    const last = parsed[parsed.length - 1];
    if (last && line.trim()) {
      last.text = cleanText(`${last.text} ${line}`);
    }
  });

  return parsed;
}

function isPseudoSender(sender) {
  const normalized = sender.toLowerCase().trim();
  const blockedSenders = ["you", "meta ai", "whatsapp"];
  return blockedSenders.includes(normalized) || normalized === chatTitleSender;
}

function isSystemOrMediaMessage(message) {
  const text = message.text.toLowerCase();
  const banned = [
    "messages and calls are end-to-end encrypted",
    "this message was deleted",
    "image omitted",
    "video omitted",
    "audio omitted",
    "sticker omitted",
    "gif omitted",
    "document omitted",
    "contact card omitted",
    "poll omitted",
    "created group",
    "changed this group's icon",
    "tap to change who can add other members",
    "added you",
    " added ",
    " left",
    " removed ",
  ];

  return banned.some((phrase) => text.includes(phrase));
}

function getWords(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function getPlayableMessages(parsed) {
  return parsed
    .filter((message) => !isPseudoSender(message.sender))
    .filter((message) => !isSystemOrMediaMessage(message))
    .filter((message) => getWords(message.text).length >= 2);
}

function scoreMessage(message) {
  const text = message.text.toLowerCase();
  const dramaWords = [
    "shut",
    "poor",
    "unloved",
    "wrong",
    "stupid",
    "idiot",
    "dumb",
    "mad",
    "lie",
    "lying",
    "bro",
    "nah",
    "no one",
    "what are you",
    "why are you",
    "explain",
    "ratio",
    "cringe",
    "hate",
  ];
  let score = 0;

  score += (message.text.match(/[?!]/g) || []).length * 2;
  score += (message.text.match(/\b[A-Z]{4,}\b/g) || []).length * 3;
  score += dramaWords.filter((word) => text.includes(word)).length * 4;
  score += message.text.length > 90 ? 3 : 0;

  return score;
}

function minutesBetween(first, second) {
  return Math.abs(second.date.getTime() - first.date.getTime()) / 60000;
}

function scoreSequence(sequence) {
  const senders = new Set(sequence.map((message) => message.sender));
  const switches = sequence.slice(1).filter(
    (message, index) => message.sender !== sequence[index].sender,
  ).length;
  const messageDrama = sequence.reduce((sum, message) => sum + scoreMessage(message), 0);
  const density = Math.max(1, sequence.length / Math.max(1, minutesBetween(sequence[0], sequence[sequence.length - 1])));

  return Math.round(messageDrama + senders.size * 8 + switches * 3 + density * 8);
}

function findArguments(allMessages) {
  const sequences = [];
  let current = [];

  allMessages.forEach((message) => {
    const previous = current[current.length - 1];
    const closeToPrevious = previous && minutesBetween(previous, message) <= 8;

    if (!previous || closeToPrevious) {
      current.push(message);
      return;
    }

    if (current.length >= 8) {
      sequences.push(current);
    }
    current = [message];
  });

  if (current.length >= 8) {
    sequences.push(current);
  }

  return sequences
    .map((sequence, index) => {
      const senders = [...new Set(sequence.map((message) => message.sender))];
      const score = scoreSequence(sequence);
      const title = `${senders.slice(0, 3).join(" vs ")}${senders.length > 3 ? " and others" : ""}`;

      return {
        id: index,
        title,
        score,
        senders,
        messages: sequence,
        start: sequence[0].date,
        end: sequence[sequence.length - 1].date,
      };
    })
    .filter((argument) => argument.senders.length >= 2)
    .filter((argument) => argument.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function showPanel(panel) {
  setupPanel.hidden = panel !== setupPanel;
  listPanel.hidden = panel !== listPanel;
  replayPanel.hidden = panel !== replayPanel;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderArgumentList() {
  const cards = argumentsFound.map((argument, index) => {
    const card = document.createElement("button");
    card.className = "argument-card";
    card.type = "button";
    card.innerHTML = `
      <span>incident ${index + 1}</span>
      <strong>${argument.title}</strong>
      <small>${argument.messages.length} messages / ${argument.senders.length} people / drama ${argument.score}</small>
    `;
    card.addEventListener("click", () => renderReplay(argument));
    return card;
  });

  argumentList.replaceChildren(...cards);
}

function renderTimeline(argument, animated = false) {
  replayTimers.forEach(clearTimeout);
  replayTimers = [];

  const items = argument.messages.map((message, index) => {
    const item = document.createElement("article");
    item.className = "timeline-item";
    if (animated) {
      item.classList.add("queued");
    }
    item.innerHTML = `
      <div>
        <strong>${message.sender}</strong>
        <span>${formatTime(message.date)}</span>
      </div>
      <p>${message.text}</p>
    `;

    if (animated) {
      replayTimers.push(
        setTimeout(() => {
          item.classList.add("visible");
          item.scrollIntoView({ behavior: "smooth", block: "center" });
        }, index * 650),
      );
    }

    return item;
  });

  timeline.replaceChildren(...items);
}

function renderReplay(argument) {
  currentArgument = argument;
  replayTitle.textContent = argument.title;
  replayMeta.textContent = `${argument.messages.length} messages / drama ${argument.score}`;
  dramaFill.style.width = `${Math.min(100, argument.score)}%`;
  renderTimeline(argument);
  showPanel(replayPanel);
}

chatFile.addEventListener("change", async () => {
  const [file] = chatFile.files;
  if (!file) {
    return;
  }

  const text = await file.text();
  const parsed = parseChatExport(text);
  chatTitleSender = parsed[0]?.sender.toLowerCase().trim() || "";
  messages = getPlayableMessages(parsed);
  argumentsFound = findArguments(messages);
  parseStatus.textContent = `${messages.length} usable messages. ${argumentsFound.length} argument timelines found.`;
});

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!argumentsFound.length) {
    parseStatus.textContent = "No strong arguments found. This chat may be too peaceful, somehow.";
    return;
  }

  renderArgumentList();
  showPanel(listPanel);
});

backToList.addEventListener("click", () => {
  replayTimers.forEach(clearTimeout);
  showPanel(listPanel);
});

playReplay.addEventListener("click", () => {
  if (currentArgument) {
    renderTimeline(currentArgument, true);
  }
});
