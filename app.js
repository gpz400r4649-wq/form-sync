(() => {
  "use strict";

  const modelVideo = document.querySelector("#modelVideo");
  const studentVideo = document.querySelector("#studentVideo");
  const modelFile = document.querySelector("#modelFile");
  const studentFile = document.querySelector("#studentFile");
  const modelEmpty = document.querySelector("#modelEmpty");
  const studentEmpty = document.querySelector("#studentEmpty");
  const modelTime = document.querySelector("#modelTime");
  const studentTime = document.querySelector("#studentTime");
  const currentTime = document.querySelector("#currentTime");
  const durationTime = document.querySelector("#durationTime");
  const seekBar = document.querySelector("#seekBar");
  const playButton = document.querySelector("#playButton");
  const backButton = document.querySelector("#backButton");
  const forwardButton = document.querySelector("#forwardButton");
  const offsetMinus = document.querySelector("#offsetMinus");
  const offsetPlus = document.querySelector("#offsetPlus");
  const offsetReset = document.querySelector("#offsetReset");
  const offsetValue = document.querySelector("#offsetValue");
  const speedButtons = [...document.querySelectorAll("[data-speed]")];

  let modelUrl = "";
  let studentUrl = "";
  let logicalTime = 0;
  let offset = 0;
  let playbackRate = 1;
  let isPlaying = false;
  let isSeeking = false;
  let lastFrameTime = 0;
  let playbackTimer = 0;

  const hasModel = () => Boolean(modelUrl) && Number.isFinite(modelVideo.duration);
  const hasStudent = () => Boolean(studentUrl) && Number.isFinite(studentVideo.duration);
  const hasAnyVideo = () => hasModel() || hasStudent();

  function formatTime(seconds) {
    const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const minutes = Math.floor(safe / 60);
    const remaining = safe - minutes * 60;
    return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(1).padStart(4, "0")}`;
  }

  function timelineDuration() {
    const modelEnd = hasModel() ? modelVideo.duration : 0;
    const studentEnd = hasStudent() ? Math.max(0, studentVideo.duration - offset) : 0;
    return Math.max(modelEnd, studentEnd, 0);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function videoTargetTime(video, target) {
    if (!Number.isFinite(video.duration)) return 0;
    return clamp(target, 0, Math.max(0, video.duration - 0.001));
  }

  function setVideoTime(video, target) {
    if (Number.isFinite(video.duration)) {
      const next = videoTargetTime(video, target);
      if (Math.abs(video.currentTime - next) > 0.015) video.currentTime = next;
    }
  }

  function syncVideos() {
    if (hasModel()) {
      const target = videoTargetTime(modelVideo, logicalTime);
      setVideoTime(modelVideo, target);
    }
    if (hasStudent()) {
      const target = videoTargetTime(studentVideo, logicalTime + offset);
      setVideoTime(studentVideo, target);
      studentVideo.playbackRate = playbackRate;
    }
  }

  function updateInterface() {
    const duration = timelineDuration();
    logicalTime = clamp(logicalTime, 0, duration);
    const progress = duration > 0 ? logicalTime / duration : 0;
    seekBar.value = String(Math.round(progress * 1000));
    seekBar.style.setProperty("--seek-progress", `${progress * 100}%`);
    currentTime.textContent = formatTime(logicalTime);
    durationTime.textContent = formatTime(duration);
    modelTime.textContent = formatTime(hasModel() ? modelVideo.currentTime : 0);
    studentTime.textContent = formatTime(hasStudent() ? studentVideo.currentTime : 0);

    const enabled = hasAnyVideo();
    playButton.disabled = !enabled;
    backButton.disabled = !enabled;
    forwardButton.disabled = !enabled;
    seekBar.disabled = !enabled;
    playButton.classList.toggle("playing", isPlaying);
    playButton.setAttribute("aria-label", isPlaying ? "一時停止" : "再生");
  }

  function pauseAll() {
    isPlaying = false;
    modelVideo.pause();
    studentVideo.pause();
    clearTimeout(playbackTimer);
    updateInterface();
  }

  async function startAll() {
    if (!hasAnyVideo()) return;
    if (logicalTime >= timelineDuration() - 0.001) {
      logicalTime = 0;
      syncVideos();
    }

    isPlaying = true;
    lastFrameTime = performance.now();
    [modelVideo, studentVideo].forEach((video) => {
      video.playbackRate = playbackRate;
    });
    // 再生開始時だけ位置をそろえる。再生中のcurrentTime変更は
    // iPhone Safariでデコーダーを停止させるため行わない。
    syncVideos();

    const promises = [];
    if (hasModel() && logicalTime < modelVideo.duration) promises.push(modelVideo.play());
    if (hasStudent() && logicalTime + offset >= 0 && logicalTime + offset < studentVideo.duration) {
      promises.push(studentVideo.play());
    }

    try {
      await Promise.all(promises);
    } catch {
      pauseAll();
      return;
    }

    updateInterface();
    playbackTimer = window.setTimeout(playbackLoop, 200);
  }

  function playbackLoop() {
    if (!isPlaying) return;
    const now = performance.now();
    const elapsed = Math.min((now - lastFrameTime) / 1000, 0.25);
    lastFrameTime = now;

    // お手本動画を基準時計にする。動画自身のデコード時計を使うことで、
    // 端末負荷が高い場合も強制シークの連続を避けられる。
    if (hasModel() && !modelVideo.paused && modelVideo.currentTime < modelVideo.duration - 0.01) {
      logicalTime = modelVideo.currentTime;
    } else if (
      hasStudent() &&
      !studentVideo.paused &&
      studentVideo.currentTime < studentVideo.duration - 0.01
    ) {
      logicalTime = studentVideo.currentTime - offset;
    } else {
      logicalTime += elapsed * playbackRate;
    }

    if (logicalTime >= timelineDuration()) {
      logicalTime = timelineDuration();
      pauseAll();
      return;
    }

    const studentTarget = logicalTime + offset;
    if (hasStudent() && studentVideo.paused && studentTarget >= 0 && studentTarget < studentVideo.duration) {
      studentVideo.play().catch(() => {});
    }
    if (hasStudent() && !studentVideo.paused && (studentTarget < 0 || studentTarget >= studentVideo.duration)) {
      studentVideo.pause();
    }
    if (hasModel() && modelVideo.paused && logicalTime < modelVideo.duration) {
      modelVideo.play().catch(() => {});
    }
    if (hasModel() && !modelVideo.paused && logicalTime >= modelVideo.duration) {
      modelVideo.pause();
    }

    // 操作表示は5fpsで十分。動画描画はSafariのネイティブ再生に任せる。
    updateInterface();
    playbackTimer = window.setTimeout(playbackLoop, 200);
  }

  function seekTo(time) {
    logicalTime = clamp(time, 0, timelineDuration());
    syncVideos();
    updateInterface();
  }

  function loadFile(input, video, emptyState, type) {
    const file = input.files?.[0];
    if (!file) return;

    pauseAll();
    if (type === "model" && modelUrl) URL.revokeObjectURL(modelUrl);
    if (type === "student" && studentUrl) URL.revokeObjectURL(studentUrl);

    const url = URL.createObjectURL(file);
    if (type === "model") modelUrl = url;
    if (type === "student") studentUrl = url;
    video.src = url;
    video.load();
    emptyState.classList.add("hidden");
  }

  modelFile.addEventListener("change", () => loadFile(modelFile, modelVideo, modelEmpty, "model"));
  studentFile.addEventListener("change", () => loadFile(studentFile, studentVideo, studentEmpty, "student"));

  [modelVideo, studentVideo].forEach((video) => {
    video.addEventListener("loadedmetadata", () => {
      video.playbackRate = playbackRate;
      logicalTime = clamp(logicalTime, 0, timelineDuration());
      syncVideos();
      updateInterface();
    });
    video.addEventListener("error", updateInterface);
  });

  playButton.addEventListener("click", () => {
    if (isPlaying) pauseAll();
    else startAll();
  });

  backButton.addEventListener("click", () => seekTo(logicalTime - 0.1));
  forwardButton.addEventListener("click", () => seekTo(logicalTime + 0.1));

  seekBar.addEventListener("input", () => {
    isSeeking = true;
    seekTo((Number(seekBar.value) / 1000) * timelineDuration());
  });
  seekBar.addEventListener("change", () => {
    isSeeking = false;
    syncVideos();
  });

  speedButtons.forEach((button) => {
    button.addEventListener("click", () => {
      playbackRate = Number(button.dataset.speed);
      modelVideo.playbackRate = playbackRate;
      studentVideo.playbackRate = playbackRate;
      speedButtons.forEach((item) => item.classList.toggle("active", item === button));
    });
  });

  function setOffset(nextOffset) {
    offset = Math.round(clamp(nextOffset, -10, 10) * 10) / 10;
    const sign = offset > 0 ? "+" : offset < 0 ? "−" : "±";
    offsetValue.textContent = `${sign}${Math.abs(offset).toFixed(1)} 秒`;
    syncVideos();
    updateInterface();
  }

  offsetMinus.addEventListener("click", () => setOffset(offset - 0.1));
  offsetPlus.addEventListener("click", () => setOffset(offset + 0.1));
  offsetReset.addEventListener("click", () => setOffset(0));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseAll();
  });

  window.addEventListener("pagehide", () => {
    pauseAll();
    if (modelUrl) URL.revokeObjectURL(modelUrl);
    if (studentUrl) URL.revokeObjectURL(studentUrl);
  });

  updateInterface();
})();
