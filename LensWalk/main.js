const VIDEO_DURATION = 118;
const FRAME_PREVIEW_FPS = 2;
const FRAME_PREVIEW_COUNT = 237;
const MAX_FRAME_PREVIEWS = 9;
const MAX_STITCH_PREVIEWS = 28;
const MAX_TIMELINE_DOTS = 180;

const state = {
  activeTool: "scan",
  dragTarget: null,
  scan: {
    start: 0,
    end: 110,
    numSlices: 5,
    fps: 0.25,
    maxFrames: 40,
    query: "Find candidate moments that mention supernovae, stellar explosions, or astronomy evidence."
  },
  focus: {
    start: 36,
    end: 64,
    fps: 2,
    maxFrames: 28,
    query: "Inspect this interval and identify the visual evidence relevant to the question."
  },
  stitch: {
    activeTarget: "global",
    activeSegment: 0,
    globalStart: 0,
    globalEnd: 118,
    globalFps: 0.5,
    maxFrames: 128,
    query: "Compare the selected moments and decide whether they refer to the same astronomy topic.",
    segments: [
      { start: 0, end: 18, fps: 1 },
      { start: 42, end: 64, fps: 1 },
      { start: 84, end: 112, fps: 1 }
    ]
  }
};

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value), min), max);
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.min(VIDEO_DURATION, Math.round(Number(seconds))));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function rangeText(start, end) {
  return `[${formatTime(start)}, ${formatTime(end)}]`;
}

function pct(seconds) {
  return `${(clamp(seconds, 0, VIDEO_DURATION) / VIDEO_DURATION) * 100}%`;
}

function framePreviewSrc(seconds) {
  const index = Math.round(clamp(seconds, 0, VIDEO_DURATION - 0.01) * FRAME_PREVIEW_FPS) + 1;
  const bounded = Math.min(Math.max(index, 1), FRAME_PREVIEW_COUNT);
  return `assets/demo_frames/f_${String(bounded).padStart(4, "0")}.jpg`;
}

function sampleTimes(start, end, fps, maxFrames) {
  const duration = Math.max(1, end - start);
  const requested = Math.max(1, Math.ceil(duration * Number(fps)));
  const count = Math.min(Math.max(1, Math.round(Number(maxFrames))), requested);
  if (count === 1) return [round1((start + end) / 2)];
  const step = duration / (count - 1);
  return Array.from({ length: count }, (_, index) => round1(start + index * step));
}

function desiredFrameCount(start, end, fps) {
  return Math.max(1, Math.ceil(Math.max(0, end - start) * Number(fps)));
}

function selectPreviewTimes(times) {
  if (times.length <= MAX_FRAME_PREVIEWS) return times;
  const step = (times.length - 1) / (MAX_FRAME_PREVIEWS - 1);
  return Array.from({ length: MAX_FRAME_PREVIEWS }, (_, index) => times[Math.round(index * step)]);
}

function downsampleItems(items, maxItems) {
  const limit = Math.max(1, Math.round(Number(maxItems)));
  if (items.length <= limit) return [...items];
  if (limit === 1) return [items[Math.floor(items.length / 2)]];
  const step = (items.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * step)]);
}

function buildStitchPieces(cfg) {
  const g0 = round1(clamp(cfg.globalStart, 0, VIDEO_DURATION - 4));
  const g1 = round1(clamp(cfg.globalEnd, g0 + 4, VIDEO_DURATION));
  const segmentRecords = cfg.segments
    .map((segment, index) => {
      const start = round1(Math.max(g0, Math.min(g1, segment.start)));
      const end = round1(Math.max(g0, Math.min(g1, segment.end)));
      return {
        start,
        end,
        fps: Number(segment.fps),
        label: `S${index + 1}`,
        index
      };
    })
    .filter((segment) => segment.end > segment.start && segment.fps > 0);

  const boundaries = new Set([g0, g1]);
  segmentRecords.forEach((segment) => {
    boundaries.add(segment.start);
    boundaries.add(segment.end);
  });

  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = round1(sorted[i]);
    const end = round1(sorted[i + 1]);
    if (end <= start) continue;

    const active = segmentRecords.filter(
      (segment) => segment.end > start && segment.start < end
    );
    const maxSegmentFps = active.length ? Math.max(...active.map((segment) => segment.fps)) : null;
    const owners = active.filter((segment) => segment.fps === maxSegmentFps);
    const isOverride = owners.length > 0;
    const fps = isOverride ? maxSegmentFps : Number(cfg.globalFps);

    pieces.push({
      start,
      end,
      fps,
      kind: isOverride ? "stitch" : "global",
      label: isOverride ? owners.map((segment) => segment.label).join("+") : "Global"
    });
  }

  return pieces;
}

function sampleStitchPieces(pieces, maxFrames) {
  const rawItems = pieces.flatMap((piece) => {
    const times = sampleTimes(
      piece.start,
      piece.end,
      piece.fps,
      desiredFrameCount(piece.start, piece.end, piece.fps)
    );
    return times.map((time) => ({ ...piece, time }));
  });

  const byTime = new Map();
  rawItems.forEach((item) => {
    const key = item.time.toFixed(1);
    const existing = byTime.get(key);
    if (!existing || (existing.kind === "global" && item.kind === "stitch")) {
      byTime.set(key, item);
    }
  });

  const merged = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  const sampled = downsampleItems(merged, Math.max(1, Math.round(Number(maxFrames))));
  const preview = downsampleItems(sampled, Math.min(MAX_STITCH_PREVIEWS, sampled.length || 1));
  return { rawItems: merged, sampledItems: sampled, previewItems: preview };
}

function countByLabel(items) {
  const counts = new Map();
  items.forEach((item) => counts.set(item.label, (counts.get(item.label) || 0) + 1));
  return Array.from(counts.entries())
    .map(([label, count]) => `${label}: ${count}`)
    .join(" · ");
}

function splitScanIntervals() {
  const cfg = state.scan;
  const width = Math.max(1, (cfg.end - cfg.start) / cfg.numSlices);
  return Array.from({ length: cfg.numSlices }, (_, index) => {
    const start = round1(cfg.start + index * width);
    const end = round1(index === cfg.numSlices - 1 ? cfg.end : cfg.start + (index + 1) * width);
    return { start, end, fps: cfg.fps, label: `Worker ${index + 1}` };
  });
}

function selectedStitchRange() {
  const cfg = state.stitch;
  if (cfg.activeTarget === "global") {
    return {
      start: cfg.globalStart,
      end: cfg.globalEnd,
      fps: cfg.globalFps,
      label: "Global"
    };
  }
  return cfg.segments[cfg.activeSegment];
}

function selectedStitchLabel() {
  if (state.stitch.activeTarget === "global") return "Global";
  return `S${state.stitch.activeSegment + 1}`;
}

function normalizeGlobalRange() {
  const cfg = state.stitch;
  cfg.globalStart = clamp(cfg.globalStart, 0, VIDEO_DURATION - 4);
  cfg.globalEnd = clamp(cfg.globalEnd, cfg.globalStart + 4, VIDEO_DURATION);
}

function setSelectedStitchRange(value) {
  if (value === "global") {
    state.stitch.activeTarget = "global";
    return;
  }
  const [, rawIndex] = String(value).split(":");
  state.stitch.activeTarget = "segment";
  state.stitch.activeSegment = Math.round(clamp(rawIndex, 0, state.stitch.segments.length - 1));
}

function activeRange() {
  if (state.activeTool === "scan") return state.scan;
  if (state.activeTool === "focus") return state.focus;
  return selectedStitchRange();
}

function normalizeRange(range) {
  range.start = clamp(range.start, 0, VIDEO_DURATION - 4);
  range.end = clamp(range.end, range.start + 4, VIDEO_DURATION);
}

function setRangePoint(which, seconds) {
  if (state.activeTool === "stitch") {
    const cfg = state.stitch;
    const range = selectedStitchRange();
    if (cfg.activeTarget === "global") {
      if (which === "start") {
        cfg.globalStart = clamp(seconds, 0, range.end - 4);
      } else {
        cfg.globalEnd = clamp(seconds, range.start + 4, VIDEO_DURATION);
      }
    } else {
      const segment = cfg.segments[cfg.activeSegment];
      if (which === "start") {
        segment.start = clamp(seconds, 0, segment.end - 4);
      } else {
        segment.end = clamp(seconds, segment.start + 4, VIDEO_DURATION);
      }
    }
    renderDashboard();
    return;
  }

  const range = activeRange();
  if (which === "start") {
    range.start = clamp(seconds, 0, range.end - 4);
  } else {
    range.end = clamp(seconds, range.start + 4, VIDEO_DURATION);
  }
  renderDashboard();
}

function buildUserPrompt(query, intervalText) {
  return `Based on the following frames, please answer this specific question: ${query}

Visual Context:
The frames provided are sampled from a specific time interval of a video. ${intervalText}
The timestamps preceding image groups pinpoint the exact time window for the frames that immediately follow. Ground the answer in the visual evidence within these markers if necessary.`;
}

function buildContext() {
  if (state.activeTool === "scan") {
    const cfg = state.scan;
    const intervals = splitScanIntervals();
    const perSliceBudget = Math.max(1, Math.floor(cfg.maxFrames / intervals.length));
    const messages = intervals.map((interval, index) => {
      const times = sampleTimes(interval.start, interval.end, cfg.fps, perSliceBudget);
      return {
        id: `scan-${index}`,
        label: interval.label,
        kind: "scan",
        intervals: [interval],
        times,
        prompt: buildUserPrompt(
          cfg.query,
          `Frames from ${rangeText(interval.start, interval.end)}.`
        )
      };
    });
    return {
      title: "Scan Search",
      summary: `${messages.length} parallel observer user messages over ${rangeText(cfg.start, cfg.end)}.`,
      toolName: "scan_observer",
      segments: intervals.map((interval, index) => ({ ...interval, kind: "scan", lane: index })),
      frameTimes: messages.flatMap((message) => message.times),
      messages,
      controls: [
        ["start", "Start sec", cfg.start, 0, VIDEO_DURATION - 4, 1],
        ["end", "End sec", cfg.end, 4, VIDEO_DURATION, 1],
        ["numSlices", "Parallel slices", cfg.numSlices, 2, 12, 1],
        ["fps", "FPS per slice", cfg.fps, 0.05, 2, 0.05],
        ["maxFrames", "Max frames", cfg.maxFrames, 8, 180, 4]
      ]
    };
  }

  if (state.activeTool === "focus") {
    const cfg = state.focus;
    const times = sampleTimes(cfg.start, cfg.end, cfg.fps, cfg.maxFrames);
    return {
      title: "Segment Focus",
      summary: `One dense observer user message over ${rangeText(cfg.start, cfg.end)}.`,
      toolName: "segment_observer",
      segments: [{ start: cfg.start, end: cfg.end, kind: "focus", lane: 0 }],
      frameTimes: times,
      messages: [
        {
          id: "focus-0",
          label: "Focus message",
          kind: "focus",
          intervals: [{ start: cfg.start, end: cfg.end }],
          times,
          prompt: buildUserPrompt(
            cfg.query,
            `The frames cover an overall time window from ${cfg.start}s to ${cfg.end}s of the video.`
          )
        }
      ],
      controls: [
        ["start", "Start sec", cfg.start, 0, VIDEO_DURATION - 4, 1],
        ["end", "End sec", cfg.end, 4, VIDEO_DURATION, 1],
        ["fps", "FPS", cfg.fps, 0.25, 8, 0.25],
        ["maxFrames", "Max frames", cfg.maxFrames, 4, 96, 4]
      ]
    };
  }

  const cfg = state.stitch;
  const selectedRange = selectedStitchRange();
  const selectedLabel = selectedStitchLabel();
  const selectedIsGlobal = cfg.activeTarget === "global";
  const globalInterval = {
    start: cfg.globalStart,
    end: cfg.globalEnd,
    fps: cfg.globalFps,
    label: "Global"
  };
  const groups = cfg.segments.map((segment, index) => ({
    ...segment,
    label: `S${index + 1}`
  }));
  const pieces = buildStitchPieces(cfg);
  const { rawItems, sampledItems, previewItems } = sampleStitchPieces(pieces, cfg.maxFrames);
  const allTimes = sampledItems.map((item) => item.time);
  const pieceLine = pieces
    .map((piece) => `${piece.label} ${rangeText(piece.start, piece.end)} @ ${piece.fps} fps`)
    .join("; ");
  const intervalLine = [
    `Global interval: ${rangeText(globalInterval.start, globalInterval.end)} at ${globalInterval.fps} fps`,
    `Segment overrides: ${groups
      .map((segment) => `${segment.label} ${rangeText(segment.start, segment.end)} at ${segment.fps} fps`)
      .join("; ")}`,
    `Effective disjoint sampling pieces: ${pieceLine}.`,
    `The merged weighted sequence is capped by max_total_frames=${cfg.maxFrames}; preview thumbnails are uniformly downsampled from that capped sequence.`
  ].join("; ");
  return {
    title: "Stitch Verify",
    summary: `Global ${globalInterval.fps} fps over ${rangeText(globalInterval.start, globalInterval.end)} with ${groups.length} segment fps overrides; ${sampledItems.length}/${rawItems.length} sampled frames after max-frame cap.`,
    toolName: "stitched_observer",
    segments: [
      {
        start: globalInterval.start,
        end: globalInterval.end,
        kind: "global",
        lane: 0,
        label: `Global ${globalInterval.fps} fps`,
        active: selectedIsGlobal
      },
      ...groups.map((segment, index) => ({
        start: segment.start,
        end: segment.end,
        kind: "stitch",
        lane: index + 1,
        index,
        label: segment.label,
        active: !selectedIsGlobal && index === cfg.activeSegment
      }))
    ],
    frameTimes: allTimes,
    frameItems: downsampleItems(sampledItems, Math.min(MAX_TIMELINE_DOTS, sampledItems.length || 1)),
    messages: [
      {
        id: "stitch-0",
        label: "Stitched message",
        kind: "stitch",
        intervals: [globalInterval, ...groups],
        times: allTimes,
        previewItems,
        countSummary: countByLabel(sampledItems),
        badge: `${sampledItems.length} sampled · ${previewItems.length} shown`,
        prompt: buildUserPrompt(cfg.query, intervalLine)
      }
    ],
    controls: [
      {
        type: "select",
        key: "selectedRange",
        label: "Selected range",
        value: selectedIsGlobal ? "global" : `segment:${cfg.activeSegment}`,
        options: [
          ["global", "Global interval"],
          ...cfg.segments.map((_, index) => [`segment:${index}`, `S${index + 1} override`])
        ]
      },
      ["start", `${selectedLabel} start`, selectedRange.start, 0, VIDEO_DURATION - 4, 1],
      ["end", `${selectedLabel} end`, selectedRange.end, 4, VIDEO_DURATION, 1],
      [
        "fps",
        `${selectedLabel} FPS`,
        selectedRange.fps,
        selectedIsGlobal ? 0.05 : 0.25,
        selectedIsGlobal ? 2 : 8,
        selectedIsGlobal ? 0.05 : 0.25
      ],
      ["maxFrames", "Max frames", cfg.maxFrames, 12, 192, 4]
    ]
  };
}

function renderToolTabs() {
  document.querySelectorAll("[data-tool]").forEach((button) => {
    const active = button.dataset.tool === state.activeTool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function inputMarkup(control) {
  if (!Array.isArray(control)) {
    const options = control.options
      .map(([value, label]) => `<option value="${value}"${value === control.value ? " selected" : ""}>${label}</option>`)
      .join("");
    return `
      <label class="field">
        <span>${control.label}</span>
        <select data-control="${control.key}">${options}</select>
      </label>
    `;
  }

  const [key, label, value, min, max, step] = control;
  return `
    <label class="field">
      <span>${label}</span>
      <input type="number" data-control="${key}" value="${value}" min="${min}" max="${max}" step="${step}">
    </label>
  `;
}

function renderControls(ctx) {
  const root = document.getElementById("tool-controls");
  const activeState = state.activeTool === "stitch" ? state.stitch : state[state.activeTool];
  root.innerHTML = `
    <div class="control-title">
      <span>${ctx.toolName}</span>
      <strong>${ctx.title}</strong>
    </div>
    <div class="field-grid">${ctx.controls.map(inputMarkup).join("")}</div>
    <label class="field query-field">
      <span>Observer user query</span>
      <textarea data-control="query">${activeState.query}</textarea>
    </label>
  `;

  root.querySelectorAll("[data-control]").forEach((input) => {
    const eventName = input.tagName === "SELECT" ? "change" : "input";
    input.addEventListener(eventName, () => {
      const key = input.dataset.control;
      if (state.activeTool === "scan") {
        if (key === "query") state.scan.query = input.value;
        if (key === "start" || key === "end") {
          state.scan[key] = Number(input.value);
          normalizeRange(state.scan);
        }
        if (key === "numSlices") state.scan.numSlices = Math.round(clamp(input.value, 2, 12));
        if (key === "fps") state.scan.fps = clamp(input.value, 0.05, 2);
        if (key === "maxFrames") state.scan.maxFrames = Math.round(clamp(input.value, 8, 180));
      } else if (state.activeTool === "focus") {
        if (key === "query") state.focus.query = input.value;
        if (key === "start" || key === "end") {
          state.focus[key] = Number(input.value);
          normalizeRange(state.focus);
        }
        if (key === "fps") state.focus.fps = clamp(input.value, 0.25, 8);
        if (key === "maxFrames") state.focus.maxFrames = Math.round(clamp(input.value, 4, 96));
      } else {
        if (key === "query") state.stitch.query = input.value;
        if (key === "selectedRange") {
          setSelectedStitchRange(input.value);
        }
        if (key === "start" || key === "end") {
          if (state.stitch.activeTarget === "global") {
            if (key === "start") state.stitch.globalStart = Number(input.value);
            if (key === "end") state.stitch.globalEnd = Number(input.value);
            normalizeGlobalRange();
          } else {
            const segment = state.stitch.segments[state.stitch.activeSegment];
            segment[key] = Number(input.value);
            normalizeRange(segment);
          }
        }
        if (key === "fps") {
          if (state.stitch.activeTarget === "global") {
            state.stitch.globalFps = clamp(input.value, 0.05, 2);
          } else {
            state.stitch.segments[state.stitch.activeSegment].fps = clamp(input.value, 0.25, 8);
          }
        }
        if (key === "maxFrames") state.stitch.maxFrames = Math.round(clamp(input.value, 12, 192));
      }
      renderDashboard(key === "selectedRange");
    });
  });
}

function renderTimeline(ctx) {
  const lanes = document.getElementById("timeline-lanes");
  const dots = document.getElementById("timeline-dots");
  const startHandle = document.getElementById("handle-start");
  const endHandle = document.getElementById("handle-end");
  lanes.innerHTML = "";
  dots.innerHTML = "";

  const laneCount = Math.max(1, ...ctx.segments.map((segment) => segment.lane + 1));
  document.documentElement.style.setProperty("--lane-count", laneCount);

  ctx.segments.forEach((segment) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `timeline-segment ${segment.kind}`;
    if (segment.active) element.classList.add("active");
    element.style.left = pct(segment.start);
    element.style.width = `${Math.max(0.6, ((segment.end - segment.start) / VIDEO_DURATION) * 100)}%`;
    element.style.top = `${segment.lane * 32 + 10}px`;
    element.textContent = segment.label || (segment.kind === "scan" ? `P${segment.lane + 1}` : "");
    element.setAttribute("aria-label", `${segment.kind} segment ${rangeText(segment.start, segment.end)}`);
    if (state.activeTool === "stitch" && segment.kind === "global") {
      element.addEventListener("click", () => {
        state.stitch.activeTarget = "global";
        renderDashboard();
      });
    }
    if (state.activeTool === "stitch" && segment.kind === "stitch") {
      element.addEventListener("click", () => {
        state.stitch.activeTarget = "segment";
        state.stitch.activeSegment = segment.index;
        renderDashboard();
      });
    }
    lanes.appendChild(element);
  });

  const frameItems = ctx.frameItems || ctx.frameTimes.map((time) => ({ time, kind: state.activeTool }));
  frameItems.slice(0, MAX_TIMELINE_DOTS).forEach((item) => {
    const dot = document.createElement("span");
    dot.className = `frame-dot ${item.kind || state.activeTool}`;
    dot.style.left = pct(item.time);
    dots.appendChild(dot);
  });

  const range = activeRange();
  startHandle.style.left = pct(range.start);
  endHandle.style.left = pct(range.end);
}

function renderFrames(container, times, label) {
  container.innerHTML = "";
  selectPreviewTimes(times).forEach((time) => {
    const figure = document.createElement("figure");
    figure.className = "sample-frame";
    const image = document.createElement("img");
    image.src = framePreviewSrc(time);
    image.alt = `${label} sampled frame at ${formatTime(time)}`;
    const caption = document.createElement("figcaption");
    caption.innerHTML = `<strong>${label}</strong><span>${formatTime(time)}</span>`;
    figure.append(image, caption);
    container.appendChild(figure);
  });
}

function renderFrameItems(container, items) {
  container.innerHTML = "";
  items.forEach((item) => {
    const figure = document.createElement("figure");
    figure.className = `sample-frame ${item.kind}`;
    const image = document.createElement("img");
    image.src = framePreviewSrc(item.time);
    image.alt = `${item.label} sampled frame at ${formatTime(item.time)}`;
    const caption = document.createElement("figcaption");
    caption.innerHTML = `<strong>${item.label}</strong><span>${formatTime(item.time)}</span>`;
    figure.append(image, caption);
    container.appendChild(figure);
  });
}

function renderMessages(ctx) {
  const root = document.getElementById("message-stack");
  root.innerHTML = "";
  ctx.messages.forEach((message) => {
    const article = document.createElement("article");
    article.className = `message-card ${message.kind}`;

    const ranges = message.intervals
      .map((interval) => `${interval.label ? `${interval.label} ` : ""}${rangeText(interval.start, interval.end)}`)
      .join("  ");

    const head = document.createElement("div");
    head.className = "message-head";
    head.innerHTML = `
      <div>
        <span>${message.label}</span>
        <strong>${ranges}</strong>
        ${message.countSummary ? `<small>${message.countSummary}</small>` : ""}
      </div>
      <code>${message.badge || `${message.times.length} frames`}</code>
    `;

    const prompt = document.createElement("pre");
    prompt.className = "prompt-preview";
    prompt.textContent = message.prompt;

    const frames = document.createElement("div");
    frames.className = "message-frames";
    if (message.previewItems && message.previewItems.length) {
      renderFrameItems(frames, message.previewItems);
    } else if (message.frameGroups && message.frameGroups.length) {
      frames.classList.add("grouped");
      message.frameGroups.forEach((group) => {
        const groupElement = document.createElement("section");
        groupElement.className = "frame-group";

        const groupTitle = document.createElement("div");
        groupTitle.className = "frame-group-title";
        groupTitle.innerHTML = `<strong>${group.label}</strong><span>${group.times.length} frames</span>`;

        const groupFrames = document.createElement("div");
        groupFrames.className = "message-frames";
        renderFrames(groupFrames, group.times, group.label.replace(/\s*\([^)]*\)/g, ""));

        groupElement.append(groupTitle, groupFrames);
        frames.appendChild(groupElement);
      });
    } else {
      renderFrames(frames, message.times, message.label.replace(" message", ""));
    }

    article.append(head, prompt, frames);
    root.appendChild(article);
  });
}

function renderDashboard(renderControlPanel = true) {
  renderToolTabs();
  const ctx = buildContext();
  document.getElementById("dashboard-title").textContent = ctx.title;
  document.getElementById("dashboard-summary").textContent = ctx.summary;
  document.getElementById("active-tool-name").textContent = ctx.toolName;
  if (renderControlPanel) renderControls(ctx);
  renderTimeline(ctx);
  renderMessages(ctx);
}

function initToolTabs() {
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTool = button.dataset.tool;
      renderDashboard();
    });
  });
}

function initTimelineDrag() {
  const timeline = document.getElementById("timeline");
  const startHandle = document.getElementById("handle-start");
  const endHandle = document.getElementById("handle-end");

  function begin(which, event) {
    state.dragTarget = which;
    timeline.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function move(event) {
    if (!state.dragTarget) return;
    const rect = timeline.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setRangePoint(state.dragTarget, round1(ratio * VIDEO_DURATION));
  }

  function end() {
    state.dragTarget = null;
  }

  startHandle.addEventListener("pointerdown", (event) => begin("start", event));
  endHandle.addEventListener("pointerdown", (event) => begin("end", event));
  timeline.addEventListener("pointermove", move);
  timeline.addEventListener("pointerup", end);
  timeline.addEventListener("pointercancel", end);
}

function initVideoSeek() {
  document.getElementById("message-stack").addEventListener("click", (event) => {
    const frame = event.target.closest(".sample-frame");
    if (!frame) return;
    const timeText = frame.querySelector("figcaption span")?.textContent;
    if (!timeText) return;
    const [minutes, seconds] = timeText.split(":").map(Number);
    const video = document.getElementById("demo-video");
    video.currentTime = minutes * 60 + seconds;
    video.play().catch(() => {});
  });
}

function init() {
  initToolTabs();
  initTimelineDrag();
  initVideoSeek();
  renderDashboard();
}

document.addEventListener("DOMContentLoaded", init);
