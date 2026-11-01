const defaults = {
	mode: "timing",
	sensitivity: -32,
	dbCalibrationEnabled: true,
	playerColor: "blue",
	roundDuration: 120,
	countdownDuration: 5,
	breakDuration: 30,
	aiEnabled: true,
	aiAggression: 3,
	beepTempo: 3,
	techniqueBeepTempo: 3,
	reactionWindow: 2,
	techniqueReactionWindow: 2,
	beepVolume: 80,
	punchVolume: 80,
	roundVolume: 80,
};

const settings = loadSettings();
const scores = { blue: 0, red: 0 };
const roundWins = { blue: 0, red: 0 };
const penalties = { blue: 0, red: 0 };
const missStreak = { blue: 0, red: 0 };
let lastPointColor = null;
let roundLastPointColor = null;
let consecutiveRoundWinner = null;
let consecutiveRoundWins = 0;
let lastRoundWinner = null;
let lastRoundScore = { blue: 0, red: 0 };
let matchWinnerColor = null;
const ui = {
	blueScore: document.querySelector("#blue-score"),
	redScore: document.querySelector("#red-score"),
	bluePenalties: document.querySelector("#blue-penalties"),
	redPenalties: document.querySelector("#red-penalties"),
	round: document.querySelector("#round"),
	roundTotal: document.querySelector("#round-total"),
	timer: document.querySelector("#timer"),
	timerLabel: document.querySelector("#timer-label"),
	roundLabel: document.querySelector("#round-label"),
	status: document.querySelector("#match-status"),
	timingSettings: document.querySelector("#timing-settings"),
	techniqueSettings: document.querySelector("#technique-settings"),
	center: document.querySelector("#match-center"),
	breakSummary: document.querySelector("#break-summary"),
	breakRoundScore: document.querySelector("#break-round-score"),
	breakRoundWinner: document.querySelector("#break-round-winner"),
	breakMatchScore: document.querySelector("#break-match-score"),
	winnerSummary: document.querySelector("#winner-summary"),
	winnerName: document.querySelector("#winner-name"),
	winnerRole: document.querySelector("#winner-role"),
	winnerMatchScore: document.querySelector("#winner-match-score"),
	aiStatus: document.querySelector("#ai-status"),
	start: document.querySelector("#start-button"),
	reset: document.querySelector("#reset-button"),
	sensorStatus: document.querySelector("#sensor-status"),
	sensorStatusText: document.querySelector("#sensor-status-text"),
	sensorButton: document.querySelector("#sensor-button"),
	settingsSensorButton: document.querySelector("#settings-sensor-button"),
	settingsScreen: document.querySelector("#settings-screen"),
	appShell: document.querySelector("#app-shell"),
	beep: document.querySelector("#beep-audio"),
	roundAudio: document.querySelector("#round-audio"),
	pointAudio: document.querySelector("#point-audio"),
	level: document.querySelector("#level-value"),
	micTestStatus: document.querySelector("#mic-test-status"),
};

ui.beep.volume = settings.beepVolume / 100;
ui.pointAudio.volume = settings.punchVolume / 100;
ui.roundAudio.volume = settings.roundVolume / 100;

let matchActive = false;
let matchPaused = false;
let phase = "idle";
let remainingSeconds = 0;
let currentRound = 0;
let timerInterval;
let cueTimeout;
let windowTimeout;
let aiTimeout;
let transitionTimeout;
let roundTransitionPending = false;
let nextCueAt = 0;
let activeCuePoints = 2;
let activeCueBeepCount = 1;
let cueBeepIndex = 0;
let windowOpenAt = 0;
let windowClosesAt = 0;
let windowHit = false;
let audioContext;
let analyser;
let microphoneStream;
let audioFrame;
let microphoneReady = false;
let pulseStartedAt = 0;
let pulsePeakDb = -Infinity;
let pulseLastLoudAt = 0;
let pulseInvalid = false;
let pulseEligible = false;
let pulseColor = "blue";
let pulseRound = 0;
let ambientFloorDb = -60;
let floorReadyAt = 0;
let micTestUntil = 0;
let micTestPeakDb = -Infinity;
let micTestReported = false;

function loadSettings() {
	try {
		const stored = JSON.parse(localStorage.getItem("taekwondo-sound-settings")) || {};
		const loaded = { ...defaults, ...stored };
		if (!stored.playerColor) {
			loaded.playerColor = stored.mode === "timing" ? stored.timingColor || defaults.playerColor : stored.testColor || defaults.playerColor;
		}
		for (const key of ["beepVolume", "punchVolume", "roundVolume"]) {
			loaded[key] = stored[key] ?? stored.soundVolume ?? defaults[key];
		}
		if (loaded.mode !== "technique") loaded.mode = "timing";
		return loaded;
	} catch {
		return { ...defaults };
	}
}

function saveSettings() {
	localStorage.setItem("taekwondo-sound-settings", JSON.stringify(settings));
}

function formatTime(seconds) {
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function setStatus(message, state = "") {
	ui.status.textContent = message;
	ui.status.dataset.state = state;
}

function render() {
	ui.blueScore.value = String(scores.blue);
	ui.redScore.value = String(scores.red);
	ui.bluePenalties.value = String(penalties.blue);
	ui.redPenalties.value = String(penalties.red);
	ui.round.value = String(currentRound);
	ui.roundTotal.textContent = "/ 3";
	const isBreak = phase === "break";
	const isComplete = phase === "complete";
	ui.center.dataset.phase = phase;
	ui.timerLabel.textContent = isComplete ? matchWinnerColor ? "WINNER" : "PERTANDINGAN SERI" : isBreak ? "ISTIRAHAT" : phase === "countdown" ? "MULAI DALAM" : "WAKTU RONDE";
	ui.roundLabel.textContent = settings.mode === "technique" ? "MODE TEKNIK" : "ROUND";
	ui.roundLabel.dataset.mode = settings.mode;
	ui.roundLabel.hidden = isBreak || isComplete;
	document.querySelector(".round-count").hidden = isBreak || isComplete;
	ui.status.hidden = isBreak || isComplete;
	ui.breakSummary.hidden = !isBreak;
	ui.winnerSummary.hidden = !isComplete;
	ui.aiStatus.hidden = !settings.aiEnabled || isBreak || isComplete;
	ui.aiStatus.textContent = `AI AKTIF · ${selectedColor() === "blue" ? "MERAH" : "BIRU"}`;
	if (isComplete) {
		ui.timer.value = matchWinnerColor === "blue" ? "BIRU" : matchWinnerColor === "red" ? "MERAH" : "SERI";
		ui.winnerName.textContent = matchWinnerColor === "blue" ? "BIRU" : matchWinnerColor === "red" ? "MERAH" : "SERI";
		ui.winnerRole.textContent = matchWinnerColor
			? settings.aiEnabled && matchWinnerColor !== selectedColor() ? "PEMENANG · AI" : "PEMENANG · PEMAIN"
			: "KEDUA TIM IMBANG";
		ui.winnerMatchScore.textContent = `HASIL PERTANDINGAN · ${roundWins.blue}-${roundWins.red}`;
	} else if (isBreak) {
		ui.timer.value = formatTime(remainingSeconds);
		ui.breakRoundScore.textContent = `${roundWins.blue}-${roundWins.red}`;
		const winnerName = lastRoundWinner === "blue" ? "BIRU" : "MERAH";
		const winnerRole = settings.aiEnabled && lastRoundWinner !== selectedColor() ? "AI" : "PEMAIN";
		ui.breakRoundWinner.textContent = lastRoundWinner
			? `PEMENANG RONDE · ${winnerName} (${winnerRole})`
			: "RONDE SERI";
		ui.breakMatchScore.textContent = `SKOR RONDE · ${lastRoundScore.blue}-${lastRoundScore.red}`;
	} else if (matchActive || matchPaused) {
		ui.timer.value = formatTime(remainingSeconds);
	} else {
		ui.timer.value = formatTime(settings.roundDuration);
	}
	ui.start.textContent = matchPaused ? "Lanjut" : matchActive ? "Jeda" : phase === "complete" || currentRound === 3 ? "Ulangi" : "Mulai";
	ui.start.disabled = !microphoneReady || roundTransitionPending;
}

function syncSettingsForm() {
	document.querySelectorAll("[data-mode]").forEach((button) => {
		button.setAttribute("aria-pressed", String(button.dataset.mode === settings.mode));
	});
	ui.timingSettings.hidden = settings.mode !== "timing";
	ui.techniqueSettings.hidden = settings.mode !== "technique";
	document.querySelectorAll("[data-color]").forEach((button) => {
		button.setAttribute("aria-pressed", String(button.dataset.color === selectedColor()));
	});
	document.querySelector("#ai-toggle").checked = settings.aiEnabled;
	document.querySelector("#ai-aggression-input").disabled = !settings.aiEnabled;
	document.querySelector("#ai-aggression-control").classList.toggle("is-disabled", !settings.aiEnabled);
	document.querySelector("#db-calibration-toggle").checked = settings.dbCalibrationEnabled;
	document.querySelector("#db-threshold-control").hidden = !settings.dbCalibrationEnabled;
	document.querySelector("#sensitivity-input").disabled = !settings.dbCalibrationEnabled;
	document.querySelector("#db-threshold-control").classList.toggle("is-disabled", !settings.dbCalibrationEnabled);
	document.querySelector("#sensitivity-input").value = settings.sensitivity;
	document.querySelector("#sensitivity-value").textContent = `${settings.sensitivity} dBFS`;
	document.querySelector("#match-duration-input").value = settings.roundDuration;
	document.querySelector("#countdown-duration-input").value = settings.countdownDuration;
	document.querySelector("#break-duration-input").value = settings.breakDuration;
	document.querySelector("#reaction-window-input").value = settings.reactionWindow;
	document.querySelector("#technique-reaction-window-input").value = settings.techniqueReactionWindow;
	document.querySelector("#ai-aggression-input").value = settings.aiAggression;
	document.querySelector("#ai-aggression-value").textContent = `${settings.aiAggression} / 10`;
	document.querySelector("#beep-tempo-input").value = settings.beepTempo;
	document.querySelector("#beep-tempo-value").textContent = `${settings.beepTempo} / 10`;
	document.querySelector("#technique-beep-tempo-input").value = settings.techniqueBeepTempo;
	document.querySelector("#technique-beep-tempo-value").textContent = `${settings.techniqueBeepTempo} / 10`;
	for (const input of document.querySelectorAll("[data-sound-volume]")) {
		const key = input.dataset.soundVolume;
		input.value = settings[key];
		document.querySelector(`#${input.id.replace("-input", "-value")}`).textContent = `${settings[key]}%`;
	}
	ui.settingsSensorButton.textContent = microphoneReady ? "Mikrofon aktif" : "Aktifkan mikrofon";
}

function selectedColor() {
	return settings.playerColor;
}

function openSettings() {
	if (matchActive && !matchPaused) pauseMatch();
	syncSettingsForm();
	ui.settingsScreen.hidden = false;
	document.body.style.overflow = "auto";
}

function closeSettings() {
	ui.settingsScreen.hidden = true;
	document.body.style.overflow = "hidden";
	render();
}

function playClip(audio) {
	audio.currentTime = 0;
	audio.play().catch(() => {});
}

function addPoint(color, source) {
	const points = source === "player" ? settings.mode === "technique" ? activeCuePoints : 2 : 2;
	scores[color] += points;
	lastPointColor = color;
	roundLastPointColor = color;
	if (source === "player") {
		missStreak[color] = 0;
		playClip(ui.pointAudio);
		windowHit = true;
	} else if (source === "ai") {
		playClip(ui.pointAudio);
	}
	setStatus(source === "ai" ? `AI +2 · ${color === "blue" ? "Biru" : "Merah"}` : `POIN +${points} · ${color === "blue" ? "BIRU" : "MERAH"}`, source === "player" ? "point" : "");
	render();
}

function activeWindowAllows(startedAt) {
	return matchActive && !matchPaused && phase === "round" && startedAt >= windowOpenAt && startedAt <= windowClosesAt && windowOpenAt > 0;
}

function finishPulse(endedAt) {
	if (!pulseStartedAt) return;
	const duration = endedAt - pulseStartedAt;
	const peak = pulsePeakDb;
	const wasInvalid = pulseInvalid;
	const wasEligible = pulseEligible;
	const scoreColor = pulseColor;
	const detectedRound = pulseRound;
	pulseStartedAt = 0;
	pulsePeakDb = -Infinity;
	pulseInvalid = false;
	pulseEligible = false;
	if (wasInvalid || duration < 30 || duration > 650 || peak < effectiveThreshold()) return;
	if (wasEligible && matchActive && phase === "round" && detectedRound === currentRound) addPoint(scoreColor, "player");
}

function effectiveThreshold() {
	const ambientThreshold = ambientFloorDb + 9;
	return settings.dbCalibrationEnabled ? Math.max(settings.sensitivity, ambientThreshold) : ambientThreshold;
}

function monitorMicrophone() {
	if (!analyser) return;
	const samples = new Float32Array(analyser.fftSize);
	const tick = () => {
		if (!analyser) return;
		analyser.getFloatTimeDomainData(samples);
		let sum = 0;
		for (const sample of samples) sum += sample * sample;
		const rms = Math.sqrt(sum / samples.length);
		const db = rms > 0 ? 20 * Math.log10(rms) : -100;
		const now = performance.now();
		ui.level.textContent = db <= -99 ? "−∞" : `${Math.round(db)}`;
		if (micTestUntil && now < micTestUntil) {
			micTestPeakDb = Math.max(micTestPeakDb, db);
			ui.micTestStatus.textContent = `Mendengarkan… ${Math.ceil((micTestUntil - now) / 1000)} dtk`;
		} else if (micTestUntil && !micTestReported) {
			micTestReported = true;
			ui.micTestStatus.textContent = micTestPeakDb <= -99 ? "Tidak ada suara terdeteksi." : `Puncak suara ${Math.round(micTestPeakDb)} dBFS.`;
		}
		if (!pulseStartedAt && now > floorReadyAt) {
			ambientFloorDb = ambientFloorDb * .97 + db * .03;
		}
		if (db >= effectiveThreshold()) {
			if (!pulseStartedAt) {
				pulseStartedAt = now;
				pulsePeakDb = db;
				pulseInvalid = false;
				pulseEligible = activeWindowAllows(now);
				pulseColor = selectedColor();
				pulseRound = currentRound;
			} else {
				pulsePeakDb = Math.max(pulsePeakDb, db);
			}
			pulseLastLoudAt = now;
			if (now - pulseStartedAt > 650) pulseInvalid = true;
		} else if (pulseStartedAt && now - pulseLastLoudAt > 90) {
			finishPulse(pulseLastLoudAt);
		}
		audioFrame = requestAnimationFrame(tick);
	};
	if (audioFrame) cancelAnimationFrame(audioFrame);
	floorReadyAt = performance.now() + 1200;
	audioFrame = requestAnimationFrame(tick);
}

async function enableMicrophone() {
	if (microphoneReady) return true;
	if (!navigator.mediaDevices?.getUserMedia) {
		setSensorStatus("Gunakan localhost/HTTPS", "error");
		return false;
	}
	try {
		microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
		audioContext = new (window.AudioContext || window.webkitAudioContext)();
		await audioContext.resume();
		analyser = audioContext.createAnalyser();
		analyser.fftSize = 2048;
		analyser.smoothingTimeConstant = 0;
		audioContext.createMediaStreamSource(microphoneStream).connect(analyser);
		microphoneReady = true;
		ambientFloorDb = -60;
		setSensorStatus("Sensor siap", "ready");
		ui.settingsSensorButton.textContent = "Mikrofon aktif";
		render();
		monitorMicrophone();
		return true;
	} catch (error) {
		setSensorStatus(error.name === "NotAllowedError" ? "Izin mikrofon ditolak" : "Mikrofon tidak tersedia", "error");
		return false;
	}
}

function setSensorStatus(message, state) {
	ui.sensorStatusText.textContent = message;
	ui.sensorStatus.dataset.state = state;
	ui.sensorButton.setAttribute("aria-label", message);
	ui.sensorButton.title = message;
}

function clearMatchTimers() {
	clearInterval(timerInterval);
	clearTimeout(cueTimeout);
	clearTimeout(windowTimeout);
	clearTimeout(aiTimeout);
	clearTimeout(transitionTimeout);
	timerInterval = undefined;
	cueTimeout = undefined;
	windowTimeout = undefined;
	aiTimeout = undefined;
	transitionTimeout = undefined;
	nextCueAt = 0;
	windowOpenAt = 0;
	windowClosesAt = 0;
	windowHit = false;
	cueBeepIndex = 0;
}

function registerMiss(color) {
	missStreak[color] += 1;
	if (missStreak[color] >= 2) {
		if (penalties[color] < 5) penalties[color] += 1;
		setStatus(`GAM-JEOM ${color === "blue" ? "BIRU" : "MERAH"} ${penalties[color]} · MISS ${missStreak[color]}`);
		if (penalties[color] >= 5) {
			const winner = color === "blue" ? "red" : "blue";
			setStatus(`5 GAM-JEOM · ${color === "blue" ? "BIRU" : "MERAH"} KALAH`);
			endRound(winner);
			return;
		}
	} else {
		setStatus(`MISS ${missStreak[color]} · BERIKUTNYA GAM-JEOM`);
	}
	render();
}

function playCue() {
	if (!matchActive || matchPaused || phase !== "round") return;
	windowOpenAt = 0;
	windowClosesAt = 0;
	activeCuePoints = settings.mode === "technique" ? 1 + Math.floor(Math.random() * 3) : 2;
	activeCueBeepCount = settings.mode === "technique" ? activeCuePoints : 1;
	cueBeepIndex = 0;
	setStatus(settings.mode === "technique" ? `URUTAN TEKNIK · ${activeCueBeepCount} BIP` : "BIP · BERSIAP");
	playNextCueBeep();
}

function playNextCueBeep() {
	if (!matchActive || matchPaused || phase !== "round") return;
	ui.beep.currentTime = 0;
	ui.beep.onended = () => {
		if (!matchActive || matchPaused || phase !== "round") return;
		cueBeepIndex += 1;
		if (cueBeepIndex < activeCueBeepCount) {
			cueTimeout = window.setTimeout(playNextCueBeep, 320);
			return;
		}
		windowOpenAt = performance.now();
		const reactionWindow = settings.mode === "technique" ? settings.techniqueReactionWindow : settings.reactionWindow;
		windowClosesAt = windowOpenAt + reactionWindow * 1000;
		windowHit = false;
		setStatus("JENDELA POIN TERBUKA", "window");
		windowTimeout = window.setTimeout(() => {
			if (!windowHit) registerMiss(selectedColor());
			if (!matchActive || matchPaused || phase !== "round") return;
			windowOpenAt = 0;
			windowClosesAt = 0;
			activeCuePoints = 2;
			activeCueBeepCount = 1;
			setStatus("Menunggu bip berikutnya");
			scheduleCue();
		}, reactionWindow * 1000 + 300);
	};
	ui.beep.play().catch(() => setStatus("Gagal memutar bip.mp3", "error"));
}

function scheduleCue() {
	if (!matchActive || matchPaused) return;
	const playerColor = selectedColor();
	const gap = scores[playerColor === "blue" ? "red" : "blue"] - scores[playerColor];
	const tempo = settings.mode === "technique" ? settings.techniqueBeepTempo : settings.beepTempo;
	const baseDelay = Math.max(1000, 11800 - tempo * 1000);
	const catchUpFactor = gap > 0 ? Math.max(.42, 1 - gap * .12) : 1;
	const delay = (baseDelay + Math.random() * 2600) * catchUpFactor;
	nextCueAt = performance.now() + delay;
	cueTimeout = window.setTimeout(playCue, delay);
}

function scheduleAI() {
	if (!matchActive || matchPaused || !settings.aiEnabled) return;
	const playerColor = selectedColor();
	const aiColor = playerColor === "blue" ? "red" : "blue";
	const gap = scores[playerColor] - scores[aiColor];
	const baseInterval = 21000 - settings.aiAggression * 2200;
	const interval = Math.max(3500, baseInterval - Math.max(0, gap) * 650 + Math.random() * 5000);
	aiTimeout = window.setTimeout(() => {
		if (!matchActive || matchPaused) return;
		if (Math.random() < Math.min(.98, .62 + settings.aiAggression * .055)) addPoint(aiColor, "ai");
		scheduleAI();
	}, interval);
}

function startTimer() {
	clearInterval(timerInterval);
	timerInterval = window.setInterval(() => {
		if (!matchActive || matchPaused) return;
		remainingSeconds = Math.max(0, remainingSeconds - 1);
		render();
		if (remainingSeconds === 0) {
			if (phase === "countdown") startRound();
			else if (phase === "break") beginCountdown();
			else if (phase === "round") endRound();
		}
	}, 1000);
}

function startRound() {
	currentRound += 1;
	phase = "round";
	remainingSeconds = Number(settings.roundDuration);
	scores.blue = 0;
	scores.red = 0;
	roundLastPointColor = null;
	penalties.blue = 0;
	penalties.red = 0;
	missStreak.blue = 0;
	missStreak.red = 0;
	matchActive = true;
	matchPaused = false;
	setStatus(`RONDE ${currentRound} DIMULAI`);
	playClip(ui.roundAudio);
	startTimer();
	scheduleCue();
	scheduleAI();
	render();
}

function endRound(penaltyWinner = null) {
	clearMatchTimers();
	matchActive = false;
	matchPaused = false;
	lastRoundScore = { ...scores };
	const roundWinner = penaltyWinner || (scores.blue === scores.red
		? roundLastPointColor
		: scores.blue > scores.red ? "blue" : "red");
	lastRoundWinner = roundWinner;
	if (roundWinner) {
		roundWins[roundWinner] += 1;
		if (consecutiveRoundWinner === roundWinner) consecutiveRoundWins += 1;
		else {
			consecutiveRoundWinner = roundWinner;
			consecutiveRoundWins = 1;
		}
	} else {
		consecutiveRoundWinner = null;
		consecutiveRoundWins = 0;
	}
	const matchWinner = consecutiveRoundWins >= 2 ? roundWinner : currentRound >= 3
		? roundWins.blue === roundWins.red ? lastPointColor
			: roundWins.blue > roundWins.red ? "blue" : "red"
		: null;
	matchWinnerColor = matchWinner;
	scores.blue = 0;
	scores.red = 0;
	if (currentRound < 3 && !matchWinner) {
		phase = "break";
		remainingSeconds = Number(settings.breakDuration);
		matchActive = true;
		setStatus(`HASIL PERTANDINGAN ${roundWins.blue}-${roundWins.red} · ISTIRAHAT ${remainingSeconds} DETIK`);
		roundTransitionPending = true;
		playClip(ui.roundAudio);
		render();
		if (remainingSeconds === 0) beginCountdown();
		else startTimer();
	} else {
		roundTransitionPending = false;
		phase = "complete";
		const winnerName = matchWinner === "blue" ? "BIRU" : "MERAH";
		const winnerRole = matchWinner && settings.aiEnabled && matchWinner !== selectedColor() ? "AI" : "PEMAIN";
		const result = matchWinner ? `WINNER: ${winnerName} (${winnerRole})` : "PERTANDINGAN SERI";
		setStatus(`${result} · HASIL PERTANDINGAN ${roundWins.blue}-${roundWins.red}`);
		matchActive = false;
		matchPaused = false;
		playClip(ui.roundAudio);
		render();
	}
}

function beginCountdown() {
	phase = "countdown";
	remainingSeconds = Number(settings.countdownDuration);
	matchActive = true;
	matchPaused = false;
	roundTransitionPending = false;
	if (remainingSeconds === 0) {
		startRound();
		return;
	}
	setStatus(`BERSIAP · RONDE ${currentRound + 1}`);
	render();
	startTimer();
}

function startTimingMatch() {
	if (matchPaused && phase !== "idle") {
		matchPaused = false;
		matchActive = true;
		setStatus(`${phase === "break" ? "ISTIRAHAT" : phase === "countdown" ? "BERSIAP" : `RONDE ${currentRound}`} DILANJUTKAN`);
		startTimer();
		if (phase === "round") {
			scheduleCue();
			scheduleAI();
		}
		render();
		return;
	}
	if (matchActive) {
		pauseMatch();
		return;
	}
	if (currentRound === 3 || phase === "complete") {
		scores.blue = 0;
		scores.red = 0;
		roundWins.blue = 0;
		roundWins.red = 0;
		lastPointColor = null;
		roundLastPointColor = null;
		consecutiveRoundWinner = null;
		consecutiveRoundWins = 0;
		lastRoundWinner = null;
		lastRoundScore = { blue: 0, red: 0 };
		matchWinnerColor = null;
		penalties.blue = 0;
		penalties.red = 0;
		missStreak.blue = 0;
		missStreak.red = 0;
		currentRound = 0;
	}
	if (currentRound === 0) {
		scores.blue = 0;
		scores.red = 0;
		roundWins.blue = 0;
		roundWins.red = 0;
		lastPointColor = null;
		roundLastPointColor = null;
		consecutiveRoundWinner = null;
		consecutiveRoundWins = 0;
		lastRoundWinner = null;
		lastRoundScore = { blue: 0, red: 0 };
		matchWinnerColor = null;
	}
	beginCountdown();
}

function pauseMatch() {
	if (!matchActive) return;
	matchActive = false;
	matchPaused = true;
	clearMatchTimers();
	setStatus("Pertandingan dijeda");
	render();
}

function resetMatch() {
	clearMatchTimers();
	matchActive = false;
	matchPaused = false;
	phase = "idle";
	roundTransitionPending = false;
	remainingSeconds = 0;
	currentRound = 0;
	scores.blue = 0;
	scores.red = 0;
	roundWins.blue = 0;
	roundWins.red = 0;
	lastPointColor = null;
	roundLastPointColor = null;
	consecutiveRoundWinner = null;
	consecutiveRoundWins = 0;
	lastRoundWinner = null;
	lastRoundScore = { blue: 0, red: 0 };
	matchWinnerColor = null;
	penalties.blue = 0;
	penalties.red = 0;
	missStreak.blue = 0;
	missStreak.red = 0;
	setStatus("PERTANDINGAN DI-RESET");
	render();
}

function startOrToggle() {
	if (!microphoneReady) {
		setStatus("Aktifkan sensor mikrofon terlebih dahulu");
		return;
	}
	startTimingMatch();
}

function applySettings() {
	settings.sensitivity = Number(document.querySelector("#sensitivity-input").value);
	settings.dbCalibrationEnabled = document.querySelector("#db-calibration-toggle").checked;
	settings.roundDuration = clampNumber("#match-duration-input", 10, 600, 120);
	settings.countdownDuration = clampNumber("#countdown-duration-input", 0, 60, 5);
	settings.breakDuration = clampNumber("#break-duration-input", 0, 600, 30);
	settings.reactionWindow = clampNumber("#reaction-window-input", .5, 8, 2);
	settings.techniqueReactionWindow = clampNumber("#technique-reaction-window-input", .5, 8, 2);
	settings.aiEnabled = document.querySelector("#ai-toggle").checked;
	settings.aiAggression = clampNumber("#ai-aggression-input", 1, 10, 3);
	settings.beepTempo = clampNumber("#beep-tempo-input", 1, 10, 3);
	settings.techniqueBeepTempo = clampNumber("#technique-beep-tempo-input", 1, 10, 3);
	for (const input of document.querySelectorAll("[data-sound-volume]")) {
		settings[input.dataset.soundVolume] = clampNumber(`#${input.id}`, 0, 100, 80);
	}
	saveSettings();
	closeSettings();
}

async function testMicrophone() {
	if (!await enableMicrophone()) {
		ui.micTestStatus.textContent = "Mikrofon tidak dapat diakses.";
		return;
	}
	micTestPeakDb = -Infinity;
	micTestReported = false;
	micTestUntil = performance.now() + 5000;
	ui.micTestStatus.textContent = "Tes 5 detik dimulai. Buat suara pendek.";
}

function clampNumber(selector, minimum, maximum, fallback) {
	const input = document.querySelector(selector);
	const value = Number(input.value);
	const safeValue = Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
	input.value = String(safeValue);
	return safeValue;
}

document.querySelector("#settings-button").addEventListener("click", openSettings);
document.querySelector("#back-button").addEventListener("click", closeSettings);
document.querySelector("#apply-button").addEventListener("click", applySettings);
ui.start.addEventListener("click", startOrToggle);
ui.reset.addEventListener("click", resetMatch);
document.querySelector("#mic-test-button").addEventListener("click", testMicrophone);

for (const button of document.querySelectorAll("[data-mode]")) {
	button.addEventListener("click", () => {
		if (settings.mode !== button.dataset.mode) {
			clearMatchTimers();
			matchActive = false;
			matchPaused = false;
			roundTransitionPending = false;
			currentRound = 0;
			phase = "idle";
			remainingSeconds = 0;
			scores.blue = 0;
			scores.red = 0;
			roundWins.blue = 0;
			roundWins.red = 0;
			penalties.blue = 0;
			penalties.red = 0;
			missStreak.blue = 0;
			missStreak.red = 0;
			lastPointColor = null;
			roundLastPointColor = null;
			lastRoundWinner = null;
			lastRoundScore = { blue: 0, red: 0 };
			matchWinnerColor = null;
			consecutiveRoundWinner = null;
			consecutiveRoundWins = 0;
		}
		settings.mode = button.dataset.mode;
		saveSettings();
		syncSettingsForm();
		setStatus("Siap memulai");
		render();
	});
}

for (const button of document.querySelectorAll("[data-color]")) {
	button.addEventListener("click", () => {
		settings.playerColor = button.dataset.color;
		syncSettingsForm();
	});
}

document.querySelector("#sensitivity-input").addEventListener("input", (event) => {
	document.querySelector("#sensitivity-value").textContent = `${event.target.value} dBFS`;
	settings.sensitivity = Number(event.target.value);
	});
document.querySelector("#db-calibration-toggle").addEventListener("change", (event) => {
	settings.dbCalibrationEnabled = event.target.checked;
	document.querySelector("#db-threshold-control").hidden = !settings.dbCalibrationEnabled;
	document.querySelector("#sensitivity-input").disabled = !settings.dbCalibrationEnabled;
	document.querySelector("#db-threshold-control").classList.toggle("is-disabled", !settings.dbCalibrationEnabled);
});
document.querySelector("#ai-toggle").addEventListener("change", (event) => {
	settings.aiEnabled = event.target.checked;
	document.querySelector("#ai-aggression-input").disabled = !settings.aiEnabled;
	document.querySelector("#ai-aggression-control").classList.toggle("is-disabled", !settings.aiEnabled);
});
document.querySelector("#ai-aggression-input").addEventListener("input", (event) => {
	document.querySelector("#ai-aggression-value").textContent = `${event.target.value} / 10`;
	settings.aiAggression = Number(event.target.value);
});
document.querySelector("#beep-tempo-input").addEventListener("input", (event) => {
	document.querySelector("#beep-tempo-value").textContent = `${event.target.value} / 10`;
	settings.beepTempo = Number(event.target.value);
});
document.querySelector("#technique-reaction-window-input").addEventListener("input", (event) => {
	settings.techniqueReactionWindow = Number(event.target.value);
});
document.querySelector("#technique-beep-tempo-input").addEventListener("input", (event) => {
	document.querySelector("#technique-beep-tempo-value").textContent = `${event.target.value} / 10`;
	settings.techniqueBeepTempo = Number(event.target.value);
});
for (const input of document.querySelectorAll("[data-sound-volume]")) {
	input.addEventListener("input", (event) => {
		const volume = Number(event.target.value);
		const key = event.target.dataset.soundVolume;
		settings[key] = volume;
		ui[key === "beepVolume" ? "beep" : key === "punchVolume" ? "pointAudio" : "roundAudio"].volume = volume / 100;
		document.querySelector(`#${event.target.id.replace("-input", "-value")}`).textContent = `${volume}%`;
	});
}

ui.sensorButton.addEventListener("click", enableMicrophone);
ui.settingsSensorButton.addEventListener("click", enableMicrophone);
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && !ui.settingsScreen.hidden) closeSettings();
});

syncSettingsForm();
setSensorStatus("Sensor mati", "off");
render();
