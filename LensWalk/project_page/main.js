const VIDEO_DURATION = 180;
const DISPLAY_FRAME_LIMIT = 36;
const FRAME_PREVIEW_FPS = 2;
const FRAME_PREVIEW_COUNT = 360;

const state = {
  activeTool: "scan",
  dragTarget: null,
  scan: {
    start: 0,
    end: 160,
    slices: 6,
    fps: 0.2,
    maxFrames: 48,
    query: "Locate moments that introduce supernovae, stellar explosions, or astronomy evidence."
  },
  segment: {
    start: 42,
    end: 78,
    fps: 2,
    maxFrames: 28,
    query: "Inspect the local visual evidence around the narration and space imagery."
  },
  stitch: {
    active: 0,
    maxFrames: 54,
    query: "Compare non-contiguous shots to verify whether they discuss the same astronomy topic.",
    segments: [
      { start: 0, end: 24, fps: 1 },
      { start: 48, end: 80, fps: 1.5 },
      { start: 120, end: 156, fps: 1 }
    ]
  },
  memory: {
    observation: "At [00:48,01:20], the video connects a narrator quote with space imagery and star visuals.",
    newSubject: "supernova explainer sequence",
    subjectId: "S2",
    current: {
      S1: {
        description: ["opening narrator sequence introduces the astronomy context"],
        appeared_intervals: ["[00:00,00:24]"]
      }
    }
  }
};

let currentContext = null;
const runState = {
  signature: "",
  tool: "",
  running: false,
  renderedCount: 0,
  totalCount: 0
};

const resultSets = {
  long: {
    title: "Long-video benchmarks",
    chartMetric: "Video MME",
    note: "Higher is better. LensWalk improves strong base models without offline video indexing.",
    columns: ["Method", "Group", "LVBench", "LongVideoBench", "Video MME", "EgoSchema"],
    rows: [
      ["Gemini-1.5-Pro", "Commercial VLM", 33.1, 58.6, 67.4, null],
      ["Gemini-2.0-Flash", "Commercial VLM", 48.3, 45.7, 63.0, 71.2],
      ["GPT-4o", "Commercial VLM", 48.9, 60.9, 65.3, 70.4],
      ["GPT-4.1", "Commercial VLM", 51.9, 64.6, 63.1, 72.2],
      ["o3", "Commercial VLM", 57.1, 60.6, 64.7, 63.2],
      ["GPT-5", "Commercial VLM", 59.8, 61.8, 68.4, 73.8],
      ["LLaVA-Video-72B", "Open-Source VLM", 38.7, null, 59.6, 74.7],
      ["InternVL2.5-78B", "Open-Source VLM", 43.6, null, 62.6, null],
      ["Qwen2.5-VL-72B", "Open-Source VLM", 47.7, 54.2, 63.1, 75.4],
      ["AdaReTaKe", "Open-Source VLM", 53.3, null, 65.0, null],
      ["VideoAgent", "Video Agent", 29.3, null, null, 63.2],
      ["VCA", "Video Agent", 41.3, null, null, 73.6],
      ["Ego-R1", "Video Agent", null, null, 64.9, 68.2],
      ["MR. Video", "Video Agent", 60.8, 61.6, 61.8, 73.0],
      ["Deep Video Discovery", "Video Agent", 74.2, 68.6, 67.3, 76.6],
      ["LensWalk (o3/GPT-4.1)", "LensWalk", 66.8, 69.9, 70.0, 74.8],
      ["LensWalk (o3/Qwen2.5-VL-72B)", "LensWalk", 59.4, 67.3, 66.7, 77.2],
      ["LensWalk (o3)", "LensWalk", 68.6, 70.6, 71.4, 74.8],
      ["LensWalk (GPT-5)", "LensWalk", 66.9, 68.8, 69.2, 74.6]
    ]
  },
  reasoning: {
    title: "Video reasoning benchmarks",
    chartMetric: "Video-MMMU Overall",
    note: "LensWalk separates reasoning from visual evidence acquisition and can pair different reasoners and observers.",
    columns: ["Method", "MMVU", "Perception", "Comprehension", "Adaptation", "Video-MMMU Overall"],
    rows: [
      ["Gemini-1.5-Flash", 66.6, 57.33, 49.0, 43.0, 49.78],
      ["Gemini-1.5-Pro", 74.7, 59.0, 53.33, 49.33, 53.89],
      ["GPT-4o", 78.1, 66.0, 62.0, 55.67, 61.22],
      ["GPT-4.1", 76.3, 76.0, 70.67, 55.67, 67.44],
      ["o3", 78.9, 79.33, 75.67, 71.33, 75.44],
      ["Aria", 60.6, 65.67, 46.67, 40.0, 50.78],
      ["InternVL2-8B", 49.1, 47.33, 33.33, 31.67, 37.44],
      ["Qwen2.5-VL-7B", 60.6, 58.33, 44.33, 39.67, 47.44],
      ["Qwen2.5-VL-72B", 69.3, 69.33, 61.0, 50.33, 60.22],
      ["LensWalk (o3/GPT-4.1)", 80.9, 82.0, 77.67, 71.67, 77.11],
      ["LensWalk (o3)", 79.2, 81.33, 81.33, 72.33, 78.33]
    ]
  },
  ablation: {
    title: "Tool and grounding ablations on Video-MME long",
    chartMetric: "VideoMME Long",
    note: "Each observation tool and grounding component contributes to the final o3/GPT-4.1 setup.",
    columns: ["Scan", "Segment", "Stitch", "Timestamp Anchor", "Subject Registry", "VideoMME Long"],
    rows: [
      ["No", "Yes", "Yes", "No", "No", 65.4],
      ["Yes", "No", "Yes", "No", "No", 68.1],
      ["Yes", "Yes", "No", "No", "No", 66.8],
      ["Yes", "Yes", "Yes", "Yes", "No", 69.7],
      ["Yes", "Yes", "Yes", "No", "Yes", 69.4],
      ["Yes", "Yes", "Yes", "Yes", "Yes", 70.0]
    ]
  },
  efficiency: {
    title: "Adaptive budget allocation",
    chartMetric: "Avg. Frames Used",
    note: "LensWalk spends more observation budget on longer or reasoning-intensive settings.",
    columns: ["Benchmark", "Split", "Acc.", "Gain", "Avg. Video Length", "Reasoning-Intensive", "Avg. Steps", "Avg. Frames Used"],
    rows: [
      ["Video-MME", "Short", 82.3, "+1.7", 80.7, "No", 2.8, 89.7],
      ["Video-MME", "Medium", 79.9, "+8.3", 515.9, "No", 4.2, 233.0],
      ["Video-MME", "Long", 70.0, "+6.9", 2466.7, "No", 6.8, 387.1],
      ["EgoSchema", "-", 74.8, "+2.6", 180.0, "No", 2.6, 89.7],
      ["Video-MMMU", "-", 77.1, "+9.7", 506.2, "Yes", 4.8, 178.4],
      ["MMVU", "-", 80.9, "+2.0", 51.4, "Yes", 3.1, 58.5]
    ]
  }
};

const galleryCaptions = {
  "tool_behavior_trace.png": "Tool-use behavior trace from the paper supplement.",
  "reasoning_type_stat.png": "Distribution of observed LensWalk reasoning behaviors.",
  "acc_cost_comparison.png": "Accuracy and cost comparison against dense and agentic baselines.",
  "main_illu_1114.png": "A real LensWalk trajectory with planned observation and subject registry updates."
};

let resultMode = "long";
let sortState = { index: null, asc: false };

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value), min), max);
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.min(VIDEO_DURATION, Math.round(seconds)));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function rangeToText(start, end) {
  return `[${formatTime(start)}, ${formatTime(end)}]`;
}

function pct(seconds) {
  return `${(clamp(seconds, 0, VIDEO_DURATION) / VIDEO_DURATION) * 100}%`;
}

function sampleTimes(start, end, fps, maxFrames) {
  const duration = Math.max(1, end - start);
  const requested = Math.max(1, Math.ceil(duration * Number(fps)));
  const count = Math.min(Math.max(1, Number(maxFrames)), requested);
  if (count === 1) return [round1((start + end) / 2)];
  const step = duration / (count - 1);
  return Array.from({ length: count }, (_, i) => round1(start + i * step));
}

function compactTimes(times, limit = 12) {
  const values = times.map(formatTime);
  if (values.length <= limit) return values;
  return [...values.slice(0, 6), "...", ...values.slice(-5)];
}

function frameItemsFromCards(cards) {
  return cards.flatMap((card, cardIndex) =>
    (card.times || []).map((time) => ({
      time,
      label: card.shortLabel || `Batch ${cardIndex + 1}`,
      title: card.title
    }))
  );
}

function splitScanIntervals(cfg) {
  const width = Math.max(1, (cfg.end - cfg.start) / cfg.slices);
  return Array.from({ length: cfg.slices }, (_, i) => {
    const start = round1(cfg.start + i * width);
    const end = round1(i === cfg.slices - 1 ? cfg.end : cfg.start + (i + 1) * width);
    return { start, end, fps: cfg.fps };
  });
}

function activeRange() {
  if (state.activeTool === "scan") return state.scan;
  if (state.activeTool === "segment") return state.segment;
  if (state.activeTool === "stitch") return state.stitch.segments[state.stitch.active];
  return null;
}

function normalizeRange(obj) {
  obj.start = clamp(obj.start, 0, VIDEO_DURATION - 5);
  obj.end = clamp(obj.end, obj.start + 5, VIDEO_DURATION);
}

function setRangePoint(which, seconds) {
  const range = activeRange();
  if (!range) return;
  if (which === "start") {
    range.start = clamp(seconds, 0, range.end - 5);
  } else {
    range.end = clamp(seconds, range.start + 5, VIDEO_DURATION);
  }
  renderWorkbench();
}

function controlInput(label, id, type, value, attrs = "") {
  return `<label><span>${label}</span><input id="${id}" type="${type}" value="${value}" ${attrs}></label>`;
}

function renderControls() {
  const container = document.getElementById("tool-controls");
  if (!container) return;

  if (state.activeTool === "scan") {
    const c = state.scan;
    container.innerHTML = `
      <div class="control-group">
        <h3>Scan Search arguments</h3>
        <div class="range-pair">
          ${controlInput("Start (sec)", "scan-start", "number", c.start, "min='0' max='175' step='1'")}
          ${controlInput("End (sec)", "scan-end", "number", c.end, "min='5' max='180' step='1'")}
        </div>
        ${controlInput("Slices", "scan-slices", "number", c.slices, "min='2' max='20' step='1'")}
        ${controlInput("FPS per slice", "scan-fps", "number", c.fps, "min='0.05' max='2' step='0.05'")}
        ${controlInput("Max total frames", "scan-frames", "number", c.maxFrames, "min='12' max='360' step='4'")}
      </div>
      <div class="control-group">
        <label><span>Observer query</span><textarea id="scan-query">${c.query}</textarea></label>
        <div class="preset-row">
          <button type="button" data-preset="find-topic">Find topic</button>
          <button type="button" data-preset="locate-text">Locate text</button>
          <button type="button" data-preset="scene-change">Scene changes</button>
        </div>
      </div>`;
  } else if (state.activeTool === "segment") {
    const c = state.segment;
    container.innerHTML = `
      <div class="control-group">
        <h3>Segment Focus arguments</h3>
        <div class="range-pair">
          ${controlInput("Start (sec)", "segment-start", "number", c.start, "min='0' max='175' step='1'")}
          ${controlInput("End (sec)", "segment-end", "number", c.end, "min='5' max='180' step='1'")}
        </div>
        ${controlInput("FPS", "segment-fps", "number", c.fps, "min='0.25' max='8' step='0.25'")}
        ${controlInput("Max frames", "segment-frames", "number", c.maxFrames, "min='4' max='96' step='4'")}
      </div>
      <div class="control-group">
        <label><span>Observer query</span><textarea id="segment-query">${c.query}</textarea></label>
      </div>`;
  } else if (state.activeTool === "stitch") {
    const c = state.stitch;
    const active = c.segments[c.active];
    container.innerHTML = `
      <div class="control-group">
        <h3>Stitched Verify arguments</h3>
        <label><span>Active segment</span>
          <select id="stitch-active">
            ${c.segments.map((_, i) => `<option value="${i}" ${i === c.active ? "selected" : ""}>Segment ${i + 1}</option>`).join("")}
          </select>
        </label>
        <div class="range-pair">
          ${controlInput("Start (sec)", "stitch-start", "number", active.start, "min='0' max='175' step='1'")}
          ${controlInput("End (sec)", "stitch-end", "number", active.end, "min='5' max='180' step='1'")}
        </div>
        ${controlInput("Segment FPS", "stitch-fps", "number", active.fps, "min='0.25' max='8' step='0.25'")}
        ${controlInput("Global max frames", "stitch-frames", "number", c.maxFrames, "min='12' max='256' step='4'")}
      </div>
      <div class="control-group">
        <label><span>Observer query</span><textarea id="stitch-query">${c.query}</textarea></label>
      </div>`;
  } else {
    const c = state.memory;
    container.innerHTML = `
      <div class="control-group">
        <h3>Subject registry update</h3>
        <label><span>Subject ID</span><input id="memory-id" type="text" value="${c.subjectId}"></label>
        <label><span>New subject description</span><input id="memory-subject" type="text" value="${c.newSubject}"></label>
      </div>
      <div class="control-group">
        <label><span>Latest tool observation</span><textarea id="memory-observation">${c.observation}</textarea></label>
      </div>`;
  }
  bindControlEvents();
}

function bindControlEvents() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", fn);
  };

  bind("scan-start", (e) => {
    state.scan.start = Number(e.target.value);
    normalizeRange(state.scan);
    renderWorkbench();
  });
  bind("scan-end", (e) => {
    state.scan.end = Number(e.target.value);
    normalizeRange(state.scan);
    renderWorkbench();
  });
  bind("scan-slices", (e) => {
    state.scan.slices = Math.round(clamp(e.target.value, 2, 20));
    renderWorkbench();
  });
  bind("scan-fps", (e) => {
    state.scan.fps = clamp(e.target.value, 0.05, 2);
    renderWorkbench();
  });
  bind("scan-frames", (e) => {
    state.scan.maxFrames = Math.round(clamp(e.target.value, 12, 360));
    renderWorkbench();
  });
  bind("scan-query", (e) => {
    state.scan.query = e.target.value;
    renderWorkbench(false);
  });

  bind("segment-start", (e) => {
    state.segment.start = Number(e.target.value);
    normalizeRange(state.segment);
    renderWorkbench();
  });
  bind("segment-end", (e) => {
    state.segment.end = Number(e.target.value);
    normalizeRange(state.segment);
    renderWorkbench();
  });
  bind("segment-fps", (e) => {
    state.segment.fps = clamp(e.target.value, 0.25, 8);
    renderWorkbench();
  });
  bind("segment-frames", (e) => {
    state.segment.maxFrames = Math.round(clamp(e.target.value, 4, 96));
    renderWorkbench();
  });
  bind("segment-query", (e) => {
    state.segment.query = e.target.value;
    renderWorkbench(false);
  });

  bind("stitch-active", (e) => {
    state.stitch.active = Number(e.target.value);
    renderWorkbench();
  });
  bind("stitch-start", (e) => {
    const seg = state.stitch.segments[state.stitch.active];
    seg.start = Number(e.target.value);
    normalizeRange(seg);
    renderWorkbench();
  });
  bind("stitch-end", (e) => {
    const seg = state.stitch.segments[state.stitch.active];
    seg.end = Number(e.target.value);
    normalizeRange(seg);
    renderWorkbench();
  });
  bind("stitch-fps", (e) => {
    state.stitch.segments[state.stitch.active].fps = clamp(e.target.value, 0.25, 8);
    renderWorkbench();
  });
  bind("stitch-frames", (e) => {
    state.stitch.maxFrames = Math.round(clamp(e.target.value, 12, 256));
    renderWorkbench();
  });
  bind("stitch-query", (e) => {
    state.stitch.query = e.target.value;
    renderWorkbench(false);
  });

  bind("memory-id", (e) => {
    state.memory.subjectId = e.target.value.trim() || "S2";
    renderWorkbench(false);
  });
  bind("memory-subject", (e) => {
    state.memory.newSubject = e.target.value.trim() || "new subject";
    renderWorkbench(false);
  });
  bind("memory-observation", (e) => {
    state.memory.observation = e.target.value;
    renderWorkbench(false);
  });

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = button.dataset.preset;
      if (preset === "find-topic") state.scan.query = "Locate moments that introduce supernovae, stellar explosions, or astronomy evidence.";
      if (preset === "locate-text") state.scan.query = "Find any title cards, labels, or scoreboard text relevant to the question.";
      if (preset === "scene-change") state.scan.query = "Summarize major scene changes and candidate event boundaries.";
      renderWorkbench();
    });
  });
}

function observerContext() {
  if (state.activeTool === "scan") {
    const c = state.scan;
    const intervals = splitScanIntervals(c);
    const perSliceBudget = Math.max(1, Math.floor(c.maxFrames / intervals.length));
    const cards = intervals.map((interval, i) => {
      const times = sampleTimes(interval.start, interval.end, c.fps, perSliceBudget);
      return {
        title: `Slice ${i + 1}: ${rangeToText(interval.start, interval.end)}`,
        shortLabel: `Slice ${i + 1}`,
        meta: `${times.length} sampled frames at ${c.fps} fps cap`,
        times,
        interval
      };
    });
    const totalFrames = cards.reduce((sum, card) => sum + card.times.length, 0);
    const payload = {
      tool: "scan_observer",
      arguments: {
        global_interval: { start_sec: c.start, end_sec: c.end },
        num_slices: c.slices,
        fps: c.fps,
        max_total_frames: c.maxFrames,
        query: c.query
      },
      observer_context: cards.map((card) => ({
        interval: card.interval,
        frame_timestamps: card.times,
        prompt: `Frames from ${rangeToText(card.interval.start, card.interval.end)}: ${c.query}`
      }))
    };
    return {
      title: "Scan Search context",
      summary: `${cards.length} parallel observer calls across ${rangeToText(c.start, c.end)}.`,
      segments: intervals.map((x) => ({ ...x, kind: "scan" })),
      frames: cards.flatMap((card) => card.times),
      frameItems: frameItemsFromCards(cards),
      cards,
      payloadFields: [
        { label: "Tool", value: "scan_observer" },
        { label: "Global interval", value: rangeToText(c.start, c.end) },
        { label: "Sampling policy", chips: [`${c.slices} slices`, `${c.fps} fps cap`, `${c.maxFrames} max frames`, `${totalFrames} scheduled`] },
        { label: "Observer query", value: c.query },
        { label: "Observer batches", items: cards.map((card) => `${card.shortLabel}: ${rangeToText(card.interval.start, card.interval.end)} with ${card.times.length} timestamps`) },
        { label: "Return contract", value: "Timestamped evidence snippets for likely answer-relevant moments." }
      ],
      payload
    };
  }

  if (state.activeTool === "segment") {
    const c = state.segment;
    const times = sampleTimes(c.start, c.end, c.fps, c.maxFrames);
    const cards = [{
      title: `Focused interval: ${rangeToText(c.start, c.end)}`,
      shortLabel: "Focus",
      meta: `${times.length} sampled frames, dense local context`,
      times,
      interval: { start: c.start, end: c.end }
    }];
    return {
      title: "Segment Focus context",
      summary: `One detailed observer call over ${rangeToText(c.start, c.end)}.`,
      segments: [{ start: c.start, end: c.end, kind: "segment" }],
      frames: times,
      frameItems: frameItemsFromCards(cards),
      cards,
      payloadFields: [
        { label: "Tool", value: "segment_observer" },
        { label: "Focused interval", value: rangeToText(c.start, c.end) },
        { label: "Sampling policy", chips: [`${c.fps} fps`, `${c.maxFrames} max frames`, `${times.length} scheduled`] },
        { label: "Observer query", value: c.query },
        { label: "Return contract", value: "Dense local evidence with timestamps and visual details." }
      ],
      payload: {
        tool: "segment_observer",
        arguments: {
          interval: { start_sec: c.start, end_sec: c.end },
          fps: c.fps,
          max_total_frames: c.maxFrames,
          query: c.query
        },
        observer_context: [{
          interval: { start_sec: c.start, end_sec: c.end },
          frame_timestamps: times,
          prompt: c.query
        }]
      }
    };
  }

  if (state.activeTool === "stitch") {
    const c = state.stitch;
    const perSegBudget = Math.max(1, Math.floor(c.maxFrames / c.segments.length));
    const cards = c.segments.map((segment, i) => {
      const times = sampleTimes(segment.start, segment.end, segment.fps, perSegBudget);
      return {
        title: `Segment ${i + 1}: ${rangeToText(segment.start, segment.end)}`,
        shortLabel: `S${i + 1}`,
        meta: `${times.length} frames at ${segment.fps} fps; stitched into one observer batch`,
        times,
        interval: segment
      };
    });
    const totalFrames = cards.reduce((sum, card) => sum + card.times.length, 0);
    return {
      title: "Stitched Verify context",
      summary: `${cards.length} non-contiguous intervals are merged into one observer request.`,
      segments: c.segments.map((x, i) => ({ ...x, kind: "stitch", active: i === c.active, index: i, label: `S${i + 1}` })),
      frames: cards.flatMap((card) => card.times),
      frameItems: frameItemsFromCards(cards),
      cards,
      payloadFields: [
        { label: "Tool", value: "stitched_observer" },
        { label: "Selected segment", value: `S${c.active + 1}` },
        { label: "Stitched intervals", items: cards.map((card) => `${card.shortLabel}: ${rangeToText(card.interval.start, card.interval.end)} at ${card.interval.fps} fps`) },
        { label: "Sampling policy", chips: [`${c.maxFrames} global max`, `${totalFrames} scheduled`, "one observer batch"] },
        { label: "Observer query", value: c.query },
        { label: "Return contract", value: "Cross-moment comparison evidence with source timestamps preserved." }
      ],
      payload: {
        tool: "stitched_observer",
        arguments: {
          segments: c.segments.map((segment) => ({
            start_sec: segment.start,
            end_sec: segment.end,
            fps: segment.fps
          })),
          max_total_frames: c.maxFrames,
          query: c.query
        },
        observer_context: cards.map((card) => ({
          interval: { start_sec: card.interval.start, end_sec: card.interval.end },
          frame_timestamps: card.times
        })),
        prompt: c.query
      }
    };
  }

  const c = state.memory;
  const nextRegistry = JSON.parse(JSON.stringify(c.current));
  nextRegistry[c.subjectId] = {
    description: [c.newSubject],
    appeared_intervals: ["[00:48,01:20]"]
  };
  return {
    title: "Subject Registry update",
    summary: "A compact update prompt reconciles new per-observation subjects with the global registry.",
    segments: [],
    frames: [],
    frameItems: [],
    cards: [
      {
        title: "Current registry",
        meta: Object.keys(c.current).join(", ") || "empty",
        times: []
      },
      {
        title: "New observation",
        meta: c.observation,
        times: []
      },
      {
        title: "Updated registry",
        meta: `${Object.keys(nextRegistry).length} subjects retained`,
        times: []
      }
    ],
    payloadFields: [
      { label: "Prompt module", value: "SUBJECT_REGISTRY_UPDATE_PROMPT" },
      { label: "Current registry", items: Object.entries(c.current).map(([id, value]) => `${id}: ${value.description.join("; ")} @ ${value.appeared_intervals.join(", ")}`) },
      { label: "Latest observation", value: c.observation },
      { label: "New observed subject", value: `${c.subjectId}: ${c.newSubject}` },
      { label: "Required output", value: "updated_subject_registry, preserving stable subject IDs and appeared_intervals." }
    ],
    payload: {
      system: "SUBJECT_REGISTRY_UPDATE_PROMPT",
      user_context: {
        current_subject_registry: c.current,
        current_turn: {
          raw_observation: c.observation,
          new_observed_subject_registry: {
            [c.subjectId]: {
              description: [c.newSubject],
              appeared_intervals: ["[00:48,01:20]"]
            }
          }
        }
      },
      required_output: {
        updated_subject_registry: nextRegistry
      }
    }
  };
}

function renderTimeline(ctx) {
  const segmentRoot = document.getElementById("timeline-segments");
  const frameRoot = document.getElementById("timeline-frames");
  const startHandle = document.getElementById("handle-start");
  const endHandle = document.getElementById("handle-end");
  segmentRoot.innerHTML = "";
  frameRoot.innerHTML = "";

  ctx.segments.forEach((seg) => {
    const element = seg.kind === "stitch" ? document.createElement("button") : document.createElement("div");
    element.className = `timeline-segment ${seg.kind || ""}`;
    if (seg.kind === "stitch") {
      element.type = "button";
      element.textContent = seg.label;
      element.setAttribute("aria-label", `Select stitched segment ${seg.label}`);
      element.addEventListener("click", () => {
        state.stitch.active = seg.index;
        renderWorkbench();
      });
    }
    if (seg.active) element.classList.add("active");
    element.style.left = pct(seg.start);
    element.style.width = `${Math.max(0.3, ((seg.end - seg.start) / VIDEO_DURATION) * 100)}%`;
    segmentRoot.appendChild(element);
  });

  ctx.frames.slice(0, 260).forEach((seconds) => {
    const dot = document.createElement("span");
    dot.className = "frame-dot";
    dot.style.left = pct(seconds);
    frameRoot.appendChild(dot);
  });

  const range = activeRange();
  if (!range) {
    startHandle.hidden = true;
    endHandle.hidden = true;
    return;
  }
  startHandle.hidden = false;
  endHandle.hidden = false;
  startHandle.style.left = pct(range.start);
  endHandle.style.left = pct(range.end);
}

function renderContextCards(cards) {
  const root = document.getElementById("context-cards");
  root.innerHTML = "";
  cards.forEach((card) => {
    const article = document.createElement("article");
    article.className = "context-card";
    const title = document.createElement("strong");
    title.textContent = card.title;
    const meta = document.createElement("p");
    meta.textContent = card.meta;
    article.append(title, meta);
    if (card.times && card.times.length) {
      const times = document.createElement("div");
      compactTimes(card.times).forEach((time) => {
        const chip = document.createElement("code");
        chip.textContent = time;
        times.appendChild(chip);
      });
      article.appendChild(times);
    }
    root.appendChild(article);
  });
}

function renderPayloadFields(fields) {
  const root = document.getElementById("payload-fields");
  root.innerHTML = "";
  fields.forEach((field) => {
    const article = document.createElement("article");
    article.className = "payload-field";

    const label = document.createElement("span");
    label.className = "payload-label";
    label.textContent = field.label;
    article.appendChild(label);

    if (field.value) {
      const value = document.createElement("p");
      value.textContent = field.value;
      article.appendChild(value);
    }

    if (field.chips && field.chips.length) {
      const chips = document.createElement("div");
      chips.className = "payload-chips";
      field.chips.forEach((chipText) => {
        const chip = document.createElement("code");
        chip.textContent = chipText;
        chips.appendChild(chip);
      });
      article.appendChild(chips);
    }

    if (field.items && field.items.length) {
      const list = document.createElement("ul");
      field.items.forEach((itemText) => {
        const item = document.createElement("li");
        item.textContent = itemText;
        list.appendChild(item);
      });
      article.appendChild(list);
    }

    root.appendChild(article);
  });
}

function contextSignature(ctx) {
  return JSON.stringify({
    tool: state.activeTool,
    payload: ctx.payload
  });
}

function clearFrameStrip(message) {
  const root = document.getElementById("frame-strip");
  if (!root) return;
  root.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty-run";
  empty.textContent = message;
  root.appendChild(empty);
}

function updateRunStatus(ctx) {
  const status = document.getElementById("run-status");
  const button = document.getElementById("run-tool");
  if (!status || !button) return;

  if (!ctx.frameItems.length) {
    button.disabled = true;
    status.textContent = "Registry updates do not sample video frames; the structured fields update immediately.";
    if (runState.tool !== state.activeTool) {
      runState.tool = state.activeTool;
      runState.signature = "";
      clearFrameStrip("No video sampling is needed for registry updates.");
    }
    return;
  }

  button.disabled = runState.running;
  const signature = contextSignature(ctx);
  if (runState.tool && runState.tool !== state.activeTool) {
    runState.tool = state.activeTool;
    runState.signature = "";
    runState.renderedCount = 0;
    runState.totalCount = 0;
    clearFrameStrip("No frames rendered for this tool yet.");
  }

  if (runState.running) {
    status.textContent = "Sampling video frames from the current tool arguments...";
  } else if (runState.signature === signature) {
    status.textContent = `Rendered ${runState.renderedCount} of ${runState.totalCount} scheduled frames from the current arguments.`;
  } else if (runState.signature) {
    status.textContent = "Arguments changed; click Run Tool to refresh the rendered frames.";
  } else {
    status.textContent = "Adjust arguments, then run the tool to render sampled frames.";
  }
}

function selectFrameItems(items, limit) {
  if (items.length <= limit) return items;
  const step = (items.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * step)]);
}

function framePreviewSrc(seconds) {
  const index = Math.round(clamp(seconds, 0, VIDEO_DURATION - 0.01) * FRAME_PREVIEW_FPS) + 1;
  const bounded = Math.min(Math.max(index, 1), FRAME_PREVIEW_COUNT);
  return `assets/demo_frames/f_${String(bounded).padStart(4, "0")}.jpg`;
}

async function captureVideoFrame(frameItem) {
  return {
    ...frameItem,
    src: framePreviewSrc(frameItem.time)
  };
}

function appendRenderedFrame(root, frame) {
  const figure = document.createElement("figure");
  figure.className = "sample-frame";

  const image = document.createElement("img");
  image.src = frame.src;
  image.alt = `${frame.label} sampled at ${formatTime(frame.time)}`;

  const caption = document.createElement("figcaption");
  const label = document.createElement("strong");
  label.textContent = frame.label;
  const time = document.createElement("span");
  time.textContent = formatTime(frame.time);
  caption.append(label, time);

  figure.append(image, caption);
  root.appendChild(figure);
}

async function runCurrentTool() {
  const ctx = currentContext || observerContext();
  if (!ctx.frameItems.length || runState.running) return;

  const root = document.getElementById("frame-strip");
  const signature = contextSignature(ctx);
  const selected = selectFrameItems(ctx.frameItems, DISPLAY_FRAME_LIMIT);

  runState.running = true;
  runState.tool = state.activeTool;
  updateRunStatus(ctx);
  root.innerHTML = "";

  try {
    const video = document.getElementById("demo-video");
    if (video) video.pause();
    for (const [index, item] of selected.entries()) {
      const frame = await captureVideoFrame(item);
      appendRenderedFrame(root, frame);
      if (index % 12 === 11) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
    runState.signature = signature;
    runState.renderedCount = selected.length;
    runState.totalCount = ctx.frameItems.length;
  } catch (error) {
    clearFrameStrip(error.message);
    runState.signature = "";
    runState.renderedCount = 0;
    runState.totalCount = 0;
  } finally {
    runState.running = false;
    updateRunStatus(currentContext || ctx);
  }
}

function renderWorkbench(renderControlPanel = true) {
  if (renderControlPanel) renderControls();
  const ctx = observerContext();
  currentContext = ctx;
  document.getElementById("preview-title").textContent = ctx.title;
  document.getElementById("preview-summary").textContent = ctx.summary;
  renderTimeline(ctx);
  renderContextCards(ctx.cards);
  renderPayloadFields(ctx.payloadFields);
  updateRunStatus(ctx);
}

function initToolTabs() {
  document.querySelectorAll(".tool-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTool = button.dataset.tool;
      document.querySelectorAll(".tool-tab").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
        tab.setAttribute("aria-selected", tab === button ? "true" : "false");
      });
      renderWorkbench();
    });
  });
}

function initTimelineDrag() {
  const timeline = document.getElementById("timeline");
  const start = document.getElementById("handle-start");
  const end = document.getElementById("handle-end");

  function begin(which, event) {
    if (!activeRange()) return;
    state.dragTarget = which;
    event.preventDefault();
    timeline.setPointerCapture(event.pointerId);
  }

  function move(event) {
    if (!state.dragTarget) return;
    const rect = timeline.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setRangePoint(state.dragTarget, round1(ratio * VIDEO_DURATION));
  }

  function endDrag() {
    state.dragTarget = null;
  }

  start.addEventListener("pointerdown", (event) => begin("start", event));
  end.addEventListener("pointerdown", (event) => begin("end", event));
  timeline.addEventListener("pointermove", move);
  timeline.addEventListener("pointerup", endDrag);
  timeline.addEventListener("pointercancel", endDrag);
}

function renderResults() {
  const set = resultSets[resultMode];
  const filter = document.getElementById("result-filter").value.trim().toLowerCase();
  const table = document.getElementById("results-table");
  const columns = set.columns;
  let rows = set.rows.filter((row) => row.join(" ").toLowerCase().includes(filter));

  if (sortState.index !== null) {
    rows = [...rows].sort((a, b) => {
      const va = a[sortState.index];
      const vb = b[sortState.index];
      const na = typeof va === "number" ? va : Number.NEGATIVE_INFINITY;
      const nb = typeof vb === "number" ? vb : Number.NEGATIVE_INFINITY;
      if (Number.isFinite(na) && Number.isFinite(nb)) return sortState.asc ? na - nb : nb - na;
      return sortState.asc
        ? String(va ?? "").localeCompare(String(vb ?? ""))
        : String(vb ?? "").localeCompare(String(va ?? ""));
    });
  }

  table.innerHTML = `
    <thead>
      <tr>
        ${columns.map((col, i) => `<th class="${i > 1 ? "numeric" : ""}" data-col="${i}">${col}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => {
        const isLensWalk = String(row[0]).includes("LensWalk") || row.includes("Yes") && row[row.length - 1] === 70;
        return `<tr class="${isLensWalk ? "lenswalk" : ""}">
          ${row.map((value, i) => `<td class="${typeof value === "number" ? "numeric" : ""}">${value === null ? "-" : value}</td>`).join("")}
        </tr>`;
      }).join("")}
    </tbody>`;

  table.querySelectorAll("th").forEach((header) => {
    header.addEventListener("click", () => {
      const index = Number(header.dataset.col);
      sortState = {
        index,
        asc: sortState.index === index ? !sortState.asc : false
      };
      renderResults();
    });
  });

  renderChart(set, rows);
}

function renderChart(set, rows) {
  const metricIndex = set.columns.indexOf(set.chartMetric);
  const root = document.getElementById("bar-chart");
  document.getElementById("chart-title").textContent = set.title;
  document.getElementById("chart-note").textContent = set.note;
  const numericRows = rows
    .map((row) => ({ label: String(row[0]), value: row[metricIndex] }))
    .filter((item) => typeof item.value === "number")
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const max = Math.max(...numericRows.map((item) => item.value), 1);
  root.innerHTML = numericRows.map((item) => `
    <div class="bar-row">
      <span title="${item.label}">${item.label}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(item.value / max) * 100}%"></span></span>
      <strong>${item.value}</strong>
    </div>`).join("");
}

function initResults() {
  document.querySelectorAll(".result-tab").forEach((button) => {
    button.addEventListener("click", () => {
      resultMode = button.dataset.result;
      sortState = { index: null, asc: false };
      document.querySelectorAll(".result-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
      renderResults();
    });
  });
  document.getElementById("result-filter").addEventListener("input", renderResults);
  renderResults();
}

function initGallery() {
  const image = document.getElementById("gallery-image");
  const caption = document.getElementById("gallery-caption");
  document.querySelectorAll(".gallery-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const file = button.dataset.image;
      image.src = `assets/${file}`;
      caption.textContent = galleryCaptions[file];
      document.querySelectorAll(".gallery-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    });
  });
}

function initToolRun() {
  document.getElementById("run-tool").addEventListener("click", runCurrentTool);
}

function init() {
  initToolTabs();
  initTimelineDrag();
  initToolRun();
  initResults();
  initGallery();
  renderWorkbench();
}

document.addEventListener("DOMContentLoaded", init);
