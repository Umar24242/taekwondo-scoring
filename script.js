const defaults = {
	sensitivity: -32,
	dbCalibrationEnabled: true,
	playerColor: "blue",
	roundDuration: 120,
	countdownDuration: 5,
	breakDuration: 30,
	aiEnabled: true,
	aiAggression: 3,
	sensorEnabled: true,
	timingEnabled: true,
	beepTempo: 3,
	reactionWindow: 2,
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
	sensorToggle: document.querySelector("#sound-sensor-toggle"),
	timingToggle: document.querySelector("#timing-toggle"),
	settingsScreen: document.querySelector("#settings-screen"),
	appShell: document.querySelector("#app-shell"),
	beep: document.querySelector("#beep-audio"),
	roundAudio: document.querySelector("#round-audio"),
	pointAudio: document.querySelector("#point-audio"),
	level: document.querySelector("#level-value"),
	micTestStatus: document.querySelector("#mic-test-status"),
	micTestButton: document.querySelector("#mic-test-button"),
	soundMeter: document.querySelector("#sound-meter"),
	micCurrentLevel: document.querySelector("#mic-current-level"),
	micPeakLevel: document.querySelector("#mic-peak-level"),
	equalizer: document.querySelector("#equalizer"),
};

for (let index = 0; index < 24; index += 1) {
	const bar = document.createElement("span");
	bar.className = "equalizer-bar";
	ui.equalizer.append(bar);
}
const equalizerBars = [...ui.equalizer.children];

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
let micTestRunning = false;
let micTestPeakDb = -Infinity;

function loadSettings() {
	try {
		const stored = JSON.parse(localStorage.getItem("taekwondo-sound-settings")) || {};
		const loaded = { ...defaults, ...stored };
		delete loaded.mode;
		delete loaded.techniqueBeepTempo;
		delete loaded.techniqueReactionWindow;
		if (!stored.playerColor) {
			loaded.playerColor = stored.timingColor || stored.testColor || defaults.playerColor;
		}
		for (const key of ["beepVolume", "punchVolume", "roundVolume"]) {
			loaded[key] = stored[key] ?? stored.soundVolume ?? defaults[key];
		}
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
	ui.roundLabel.textContent = "ROUND";
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
	ui.start.disabled = (settings.sensorEnabled && !microphoneReady) || roundTransitionPending || micTestRunning;
	ui.settingsSensorButton.textContent = settings.sensorEnabled && microphoneReady ? "Mikrofon aktif" : "Aktifkan mikrofon";
}

function syncSettingsForm() {
	document.querySelectorAll("[data-color]").forEach((button) => {
		button.setAttribute("aria-pressed", String(button.dataset.color === selectedColor()));
	});
	document.querySelector("#ai-toggle").checked = settings.aiEnabled;
	ui.sensorToggle.checked = settings.sensorEnabled;
	ui.timingToggle.checked = settings.timingEnabled;
	document.querySelector("#ai-aggression-input").disabled = !settings.aiEnabled;
	document.querySelector("#ai-aggression-control").classList.toggle("is-disabled", !settings.aiEnabled);
	document.querySelector("#timing-settings-panel").classList.toggle("is-disabled", !settings.timingEnabled);
	document.querySelectorAll("#reaction-window-input, #beep-tempo-input").forEach((input) => {
		input.disabled = !settings.timingEnabled;
	});
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
	document.querySelector("#ai-aggression-input").value = settings.aiAggression;
	document.querySelector("#ai-aggression-value").textContent = `${settings.aiAggression} / 10`;
	document.querySelector("#beep-tempo-input").value = settings.beepTempo;
	document.querySelector("#beep-tempo-value").textContent = `${settings.beepTempo} / 10`;
	for (const input of document.querySelectorAll("[data-sound-volume]")) {
		const key = input.dataset.soundVolume;
		input.value = settings[key];
		document.querySelector(`#${input.id.replace("-input", "-value")}`).textContent = `${settings[key]}%`;
	}
	ui.settingsSensorButton.textContent = settings.sensorEnabled && microphoneReady ? "Mikrofon aktif" : "Aktifkan mikrofon";
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
	const points = 2;
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
	if (!matchActive || matchPaused || phase !== "round") return false;
	return !settings.timingEnabled || startedAt >= windowOpenAt && startedAt <= windowClosesAt && windowOpenAt > 0;
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
	if (settings.sensorEnabled && !micTestRunning && wasEligible && matchActive && phase === "round" && detectedRound === currentRound) addPoint(scoreColor, "player");
}

function effectiveThreshold() {
	const ambientThreshold = ambientFloorDb + 9;
	return settings.dbCalibrationEnabled ? Math.max(settings.sensitivity, ambientThreshold) : ambientThreshold;
}

function updateSoundMeter(db, frequencyData) {
	const currentDb = Math.max(-60, Math.min(0, db));
	const displayedDb = db <= -99 ? "−∞" : `${Math.round(db)}`;
	ui.micCurrentLevel.textContent = `${displayedDb} dBFS`;
	ui.micPeakLevel.textContent = micTestPeakDb <= -99 ? "−∞ dBFS" : `${Math.round(micTestPeakDb)} dBFS`;
	ui.soundMeter.setAttribute("aria-valuenow", String(Math.round(currentDb)));
	ui.soundMeter.setAttribute("aria-valuetext", `${displayedDb} dBFS`);

	const startBin = Math.max(1, Math.floor(60 / (audioContext.sampleRate / analyser.fftSize)));
	const endBin = Math.min(frequencyData.length, Math.ceil(12000 / (audioContext.sampleRate / analyser.fftSize)));
	for (let index = 0; index < equalizerBars.length; index += 1) {
		const lowerBin = Math.floor(startBin * (endBin / startBin) ** (index / equalizerBars.length));
		const upperBin = Math.max(lowerBin + 1, Math.floor(startBin * (endBin / startBin) ** ((index + 1) / equalizerBars.length)));
		let bandLevel = 0;
		for (let bin = lowerBin; bin < Math.min(upperBin, frequencyData.length); bin += 1) {
			bandLevel = Math.max(bandLevel, frequencyData[bin]);
		}
		const normalizedLevel = Math.max(0.025, Math.pow(bandLevel / 255, 1.15));
		equalizerBars[index].style.setProperty("--bar-level", String(normalizedLevel));
	}
}

function monitorMicrophone() {
	if (!analyser) return;
	const samples = new Float32Array(analyser.fftSize);
	const frequencyData = new Uint8Array(analyser.frequencyBinCount);
	const tick = () => {
		if (!analyser) return;
		analyser.getFloatTimeDomainData(samples);
		analyser.getByteFrequencyData(frequencyData);
		let sum = 0;
		for (const sample of samples) sum += sample * sample;
		const rms = Math.sqrt(sum / samples.length);
		const db = rms > 0 ? 20 * Math.log10(rms) : -100;
		const now = performance.now();
		ui.level.textContent = db <= -99 ? "−∞" : `${Math.round(db)}`;
		updateSoundMeter(db, frequencyData);
		if (micTestRunning) {
			micTestPeakDb = Math.max(micTestPeakDb, db);
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
		microphoneStream?.getTracks().forEach((track) => track.stop());
		microphoneStream = undefined;
		analyser = undefined;
		const failedAudioContext = audioContext;
		audioContext = undefined;
		if (failedAudioContext && failedAudioContext.state !== "closed") {
			try {
				await failedAudioContext.close();
			} catch {
				setSensorStatus("Mikrofon gagal disiapkan dan audio tidak dapat ditutup", "error");
				return false;
			}
		}
		setSensorStatus(error.name === "NotAllowedError" ? "Izin mikrofon ditolak" : "Mikrofon tidak tersedia", "error");
		return false;
	}
}

async function setSensorEnabled(enabled) {
	settings.sensorEnabled = enabled;
	ui.sensorToggle.checked = enabled;
	saveSettings();
	if (!enabled) {
		if (audioFrame) cancelAnimationFrame(audioFrame);
		audioFrame = undefined;
		ui.level.textContent = "−∞";
		ui.micCurrentLevel.textContent = "−∞ dBFS";
		ui.micPeakLevel.textContent = "−∞ dBFS";
		ui.soundMeter.setAttribute("aria-valuenow", "-60");
		ui.soundMeter.setAttribute("aria-valuetext", "−∞ dBFS");
		equalizerBars.forEach((bar) => bar.style.setProperty("--bar-level", "0.025"));
		pulseStartedAt = 0;
		pulsePeakDb = -Infinity;
		pulseInvalid = false;
		pulseEligible = false;
		ui.micTestStatus.textContent = "Sensor suara nonaktif.";
		micTestRunning = false;
		micTestPeakDb = -Infinity;
		ui.micTestButton.textContent = "Tes mikrofon";
		ui.micTestButton.disabled = false;
		ui.soundMeter.dataset.testing = "false";
		microphoneStream?.getTracks().forEach((track) => track.stop());
		microphoneStream = undefined;
		analyser = undefined;
		microphoneReady = false;
		if (audioContext && audioContext.state !== "closed") {
			try {
				await audioContext.close();
			} catch {
				setSensorStatus("Gagal menutup audio mikrofon", "error");
				render();
				return false;
			}
		}
		audioContext = undefined;
		setSensorStatus("Sensor nonaktif", "off");
		render();
		return true;
	}

	if (!await enableMicrophone()) {
		settings.sensorEnabled = false;
		ui.sensorToggle.checked = false;
		saveSettings();
		render();
		return false;
	}
	if (!settings.sensorEnabled) {
		await setSensorEnabled(false);
		return false;
	}
	render();
	return true;
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
	setStatus("BIP · BERSIAP");
	playNextCueBeep();
}

function playNextCueBeep() {
	if (!matchActive || matchPaused || phase !== "round") return;
	const cueAudio = ui.beep;
	cueAudio.currentTime = 0;
	cueAudio.onended = () => {
		if (!matchActive || matchPaused || phase !== "round") return;
		windowOpenAt = performance.now();
		const reactionWindow = settings.reactionWindow;
		windowClosesAt = windowOpenAt + reactionWindow * 1000;
		windowHit = false;
		setStatus("JENDELA POIN TERBUKA", "window");
		windowTimeout = window.setTimeout(() => {
			if (settings.sensorEnabled && !windowHit) registerMiss(selectedColor());
			if (!matchActive || matchPaused || phase !== "round") return;
			windowOpenAt = 0;
			windowClosesAt = 0;
			setStatus("Menunggu bip berikutnya");
			scheduleCue();
		}, reactionWindow * 1000 + 300);
	};
	cueAudio.play().catch(() => setStatus("Gagal memutar bip.mp3", "error"));
}

function scheduleCue() {
	if (!matchActive || matchPaused || !settings.timingEnabled) return;
	const playerColor = selectedColor();
	const gap = scores[playerColor === "blue" ? "red" : "blue"] - scores[playerColor];
	const baseDelay = Math.max(1000, 11800 - settings.beepTempo * 1000);
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
	if (settings.timingEnabled) scheduleCue();
	else setStatus("RONDE DIMULAI · POIN DARI SENSOR AKTIF");
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
			if (settings.timingEnabled) scheduleCue();
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
	if (settings.sensorEnabled && !microphoneReady) {
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
	settings.aiEnabled = document.querySelector("#ai-toggle").checked;
	settings.aiAggression = clampNumber("#ai-aggression-input", 1, 10, 3);
	settings.timingEnabled = ui.timingToggle.checked;
	settings.beepTempo = clampNumber("#beep-tempo-input", 1, 10, 3);
	for (const input of document.querySelectorAll("[data-sound-volume]")) {
		settings[input.dataset.soundVolume] = clampNumber(`#${input.id}`, 0, 100, 80);
	}
	saveSettings();
	closeSettings();
}

async function testMicrophone() {
	if (micTestRunning) {
		micTestRunning = false;
		ui.soundMeter.dataset.testing = "false";
		ui.micTestButton.textContent = "Tes mikrofon";
		render();
		if (micTestPeakDb <= -99) {
			ui.micTestStatus.textContent = "Tes selesai. Tidak ada suara terdeteksi.";
			return;
		}
		const peakDb = Math.round(micTestPeakDb);
		const threshold = Math.min(-8, Math.max(-60, peakDb));
		settings.sensitivity = threshold;
		settings.dbCalibrationEnabled = true;
		document.querySelector("#db-calibration-toggle").checked = true;
		document.querySelector("#db-threshold-control").hidden = false;
		document.querySelector("#db-threshold-control").classList.remove("is-disabled");
		document.querySelector("#sensitivity-input").disabled = false;
		document.querySelector("#sensitivity-input").value = threshold;
		document.querySelector("#sensitivity-value").textContent = `${threshold} dBFS`;
		saveSettings();
		ui.micTestStatus.textContent = `Tes selesai. Puncak ${peakDb} dBFS; ambang disetel ke ${threshold} dBFS.`;
		return;
	}

	if (!await setSensorEnabled(true)) {
		ui.micTestStatus.textContent = "Mikrofon tidak dapat diakses.";
		return;
	}
	micTestPeakDb = -Infinity;
	micTestRunning = true;
	ui.micTestButton.textContent = "Selesaikan tes";
	ui.micTestStatus.textContent = "Tes berjalan. Buat suara, lalu selesaikan untuk memakai puncak level.";
	ui.soundMeter.dataset.testing = "true";
	render();
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
ui.sensorToggle.addEventListener("change", (event) => {
	setSensorEnabled(event.target.checked);
});
ui.timingToggle.addEventListener("change", (event) => {
	settings.timingEnabled = event.target.checked;
	if (!settings.timingEnabled) {
		clearTimeout(cueTimeout);
		clearTimeout(windowTimeout);
		cueTimeout = undefined;
		windowTimeout = undefined;
		nextCueAt = 0;
		windowOpenAt = 0;
		windowClosesAt = 0;
		windowHit = false;
	}
	syncSettingsForm();
	saveSettings();
});

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
for (const input of document.querySelectorAll("[data-sound-volume]")) {
	input.addEventListener("input", (event) => {
		const volume = Number(event.target.value);
		const key = event.target.dataset.soundVolume;
		settings[key] = volume;
		if (key === "punchVolume") {
			ui.pointAudio.volume = volume / 100;
		} else {
			ui[key === "beepVolume" ? "beep" : "roundAudio"].volume = volume / 100;
		}
		document.querySelector(`#${event.target.id.replace("-input", "-value")}`).textContent = `${volume}%`;
	});
}

ui.sensorButton.addEventListener("click", () => setSensorEnabled(true));
ui.settingsSensorButton.addEventListener("click", () => setSensorEnabled(true));
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && !ui.settingsScreen.hidden) closeSettings();
});

syncSettingsForm();
setSensorStatus("Sensor mati", "off");
render();
